from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import time
import uuid
from .common import KINDS, QuotaError, budget, config_value, fixture_dir, now
from .identity import identity, bind
from .readers import claude, codex, cursor
from .store import Store


def shape(body):
    def walk(value):
        if isinstance(value,dict):
            return {key:len(item) if key in ('rateLimitsByLimitId','model_usage') and isinstance(item,dict) else walk(item) for key,item in value.items()}
        if isinstance(value,list):
            return [walk(value[0])] if value else []
        return type(value).__name__
    return hashlib.sha256(json.dumps(walk(body),sort_keys=True).encode()).hexdigest()


def drift(kind,body):
    """Unknown field names may be data. Retain hashes/counts, never map keys."""
    if not isinstance(body,dict):
        return [],{}
    body=body.get('result',body)
    known={
        'claude':{'usage_report','rate_limits','session','limits','extra_usage','five_hour','seven_day'},
        'codex':{'rateLimits','rateLimitsByLimitId','accountId','ordinaryUsageAllowed','rateLimitResetCredits','rateLimitUpsell','rate_limits','type','info'},
        'cursor':{'billingCycleStart','billingCycleEnd','planUsage','spendLimitUsage','autoBucketModels','displayMessage','displayThreshold','enabled','namedModelSelectedDisplayMessage','autoModelSelectedDisplayMessage'},
    }[kind]
    nested={
        'claude':{'kind','group','percent','resets_at','scope','model','surface','id','display_name','severity','is_active','utilization','is_enabled','monthly_limit','used_credits'},
        'codex':{'limitId','limit_id','limitName','primary','secondary','usedPercent','used_percent','windowDurationMins','window_minutes','resetsAt','resets_at','credits','hasCredits','unlimited','balance','planType','plan_type','rateLimitReachedType','spendControlReached','individualLimit','total_token_usage','last_token_usage','model_context_window','input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'},
        'cursor':{'totalSpend','includedSpend','remaining','limit','autoPercentUsed','apiPercentUsed','totalPercentUsed','remainingBonus','bonusTooltip','spendLimit','used','remainingSpend','model'},
    }[kind]
    unknown=[]
    maps={}
    def visit(value,path=''):
        if isinstance(value,list):
            for entry in value[:100]:
                visit(entry,path+'[]')
        elif isinstance(value,dict):
            for key,item in value.items():
                next_path=path+'.'+key if path else key
                if key in ('rateLimitsByLimitId','model_usage') and isinstance(item,dict):
                    maps[next_path]=len(item)
                    if key=='rateLimitsByLimitId':
                        for record in list(item.values())[:100]:
                            visit(record,next_path+'.*')
                    continue
                if key not in known|nested and len(unknown)<50:
                    hashed=hashlib.sha256(next_path.encode()).hexdigest()
                    if hashed not in unknown:
                        unknown.append(hashed)
                visit(item,next_path)
    visit(body)
    return unknown,maps


def sample_one(root,kind,context,trigger,session_id=None,force=False,deadline=None):
    deadline=deadline or time.monotonic()+budget(8)
    store=Store(root)
    try:
        evidence=identity(store,kind,context)
        with store.lock('sample:'+kind,deadline):
            minimum=float(config_value(root,'quota_min_interval','60'))
            pool=evidence['pool']
            enabled=[p.strip() for p in config_value(root,'quota_pools',','.join(KINDS)).split(',')]
            key=evidence['fingerprint']
            backoff=store.get('backoff',key,{})
            latest=store.latest_sample(kind,pool,'ok') if pool!='pending' else None
            if not force and latest and 0<=now()-latest['observed_at']<minimum and kind in enabled and backoff.get('retry_at',0)<=now():
                return dict(latest,reused_sample=True)
            row=dict(v=1,sample_id=str(uuid.uuid4()),ts=now(),observed_at=now(),pool=pool,pool_kind=kind,
                     source={'claude':'claude-usage','codex':'codex-app-server','cursor':'cursor-api2'}[kind],
                     status='unavailable',reason=None,meters=[],trigger=trigger,session_id=session_id,
                     identity=evidence,raw_shape_hash=None,unknown_fields=[],fixture=bool(fixture_dir()))
            try:
                if kind not in enabled:
                    raise QuotaError('disabled')
                if backoff.get('retry_at',0)>now():
                    raise QuotaError('http_429',retry_at=backoff['retry_at'])
                if context.get('sandboxed') and kind!='codex':
                    raise QuotaError('sandboxed')
                if context.get('sandboxed') and kind=='codex':
                    recent_rollout=codex.rollout(context,deadline)
                    if not recent_rollout:
                        raise QuotaError('sandboxed')
                    meters,partial=codex.parse(recent_rollout[1])
                    result,body=dict(source='codex-rollout',meters=meters,status='partial' if partial else 'ok',observed_at=recent_rollout[0]),recent_rollout[1]
                else:
                    result,body={'claude':claude,'codex':codex,'cursor':cursor}[kind].read(store,context,deadline)
                row.update(result)
                row['raw_shape_hash']=shape(body)
                row['unknown_fields'],row['data_keyed_map_counts']=drift(kind,body)
                row['ts']=now()
                row['observed_at']=result.get('observed_at',now())
                after=identity(store,kind,context)
                if kind!='cursor' and after['pool']!=evidence['pool']:
                    row.update(pool='pending',identity=after,reason='identity_changed')
            except (QuotaError,TypeError,KeyError,AttributeError,ValueError) as error:
                if not isinstance(error,QuotaError):
                    error=QuotaError('schema_changed')
                row.update(status='unavailable',reason=error.code,meters=[],retry_at=error.retry_at)
                if error.code=='http_429':
                    with store.transaction():
                        store.put('backoff',key,{'retry_at':error.retry_at or now()+300})
            with store.transaction():
                bind(store,kind,context,evidence)
                store.put('sample',row['sample_id'],row)
            return dict(row,reused_sample=False)
    finally:
        store.close()


def refresh(root,kinds,context,trigger='refresh',session_id=None,force=False):
    deadline=time.monotonic()+budget(8)
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures=[executor.submit(sample_one,root,kind,context,trigger,session_id,force,deadline) for kind in kinds]
        rows=[]
        for kind,future in zip(kinds,futures):
            try:
                rows.append(future.result())
            except QuotaError as error:
                if error.code!='timeout':
                    raise
                store=Store(root)
                try:
                    row=dict(v=1,sample_id=str(uuid.uuid4()),ts=now(),observed_at=now(),pool=identity(store,kind,context)['pool'],
                             pool_kind=kind,source='unavailable',status='unavailable',reason='timeout',meters=[],trigger=trigger,
                             session_id=session_id,identity=None,raw_shape_hash=None,unknown_fields=[],fixture=bool(fixture_dir()))
                    with store.transaction():
                        store.put('sample',row['sample_id'],row)
                    rows.append(row)
                finally:
                    store.close()
        return rows
