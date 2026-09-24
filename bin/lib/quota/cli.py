"""Versioned CLI contract. The store is intentionally not a public interface."""
import argparse
from collections import Counter
import json
import math
import os
import re
import statistics
import sys
import time

from .common import (CLASSES, KINDS, QuotaError, budget, check_fixture, config_enabled, config_value, context_from,
                     explanation, fixture_dir, iso, now, state_root, timestamp)
from .cursor_cost import decorate, settle
from .identity import identity
from .index import scan
from .intervals import interval, intervals
from .ledger import lifecycle, run_rows
from .samples import refresh
from .store import Store, record_refusal


class Parser(argparse.ArgumentParser):
    def error(self,message):
        # Argument values may contain credentials. Do not echo argparse's text.
        raise QuotaError('usage','Invalid quota arguments. Run the command with --help.',2)


def parser():
    root=Parser(prog='gstack-extend quota',description='Local capacity and consumption ledger.',
                epilog='Example: gstack-extend quota status --refresh --json')
    sub=root.add_subparsers(dest='command',required=True,parser_class=Parser)
    examples={'status':'status --refresh --json','sample':'sample --session-id build-1 --phase start --agent codex --json',
              'runs':'runs --active --session-id build-1 --json','summary':'summary --by stage,agent,model --since 7d --json',
              'intervals':'intervals --pool codex --since 7d --json','settle':'settle --json',
              'probe':'probe claude --raw','doctor':'doctor --json'}
    for name,example in examples.items():
        p=sub.add_parser(name,epilog='Example: gstack-extend quota '+example)
        p.add_argument('--json',action='store_true')
        p.add_argument('--pool')
        p.add_argument('--since')
        p.add_argument('--days',type=float)
        for field in ('claude-config-dir','codex-home','cursor-projects-dir','conductor-store','cwd','repo-root'):
            p.add_argument('--'+field)
        if name in ('sample','runs','summary'):
            for field in ('session-id','stage','agent','model','effort','route'):
                choices=('claude','codex','cursor','grok','unknown') if field=='agent' else ('cli','conductor','sdk','unknown') if field=='route' else None
                p.add_argument('--'+field,choices=choices)
        if name=='sample':
            p.add_argument('--phase',choices=('start','attach','finish','abandon'))
            p.add_argument('--auth',choices=('subscription','api','unknown'))
            p.add_argument('--harness-session')
        if name=='runs':
            p.add_argument('--active',action='store_true')
        if name=='summary':
            p.add_argument('--by',default='stage,agent,model')
        if name=='status':
            p.add_argument('--refresh',action='store_true')
            p.add_argument('--force',action='store_true')
        if name=='probe':
            p.add_argument('kind',choices=KINDS)
            p.add_argument('--raw',action='store_true',required=True)
    return root


def since(args):
    if args.days is not None:
        if args.days<0:
            raise QuotaError('usage','--days must be nonnegative.',2)
        return now()-args.days*86400
    if not args.since:
        return None
    match=re.fullmatch(r'(\d+(?:\.\d+)?)([dh])',args.since)
    value=now()-float(match[1])*(86400 if match[2]=='d' else 3600) if match else timestamp(args.since)
    if value is None:
        raise QuotaError('usage','--since needs ISO-8601, 7d or 12h.',2)
    return value


def matches(row,args):
    for field in ('session_id','stage','agent','model','effort','route'):
        value=getattr(args,field,None)
        if value and row.get(field)!=value:
            return False
    if args.pool and args.pool not in (row.get('pool'),row.get('pool_kind')):
        return False
    boundary=since(args)
    if boundary is None:
        return True
    end=row.get('ended_at')
    # An open run is still in the window even when it started earlier.
    return end is None or end>=boundary


def status(store,args,context,sampled):
    coverage=scan(store,context)
    pools=[]
    for kind in KINDS:
        if args.pool and args.pool.split(':')[0]!=kind:
            continue
        current=identity(store,kind,context)
        pool_id=args.pool if args.pool and ':' in args.pool else current['pool']
        last=store.latest_sample(kind,pool_id)
        meters={}
        for saved in store.all('meter'):
            if saved['pool']==pool_id and saved['pool_kind']==kind:
                meter=saved['meter']
                observed=saved['observed_at']
                age=now()-observed
                stale=min(observed+300,meter['resets_at']) if meter['resets_at'] is not None else observed+300
                entry=dict(meter,sampled_at=observed,age_s=max(0,age),stale_after=stale,clock_skew=age<0,
                           state='unknown' if now()>stale else 'ok',why=['stale'] if now()>stale else [])
                if meter['resets_at'] is not None and now()>=meter['resets_at']:
                    entry.update(used=None,why=['reset_crossed'])
                if saved['absent']:
                    entry.update(state='absent',used=None,why=['absent'])
                meters[meter['meter']]=entry
        ok=store.latest_sample(kind,pool_id,'ok')
        reason=last.get('reason') if last else 'no_sample'
        entry=dict(pool=current['pool'] if not last else last['pool'],pool_kind=kind,status=last['status'] if last else 'unavailable',
                   plan_label=last.get('plan_label',kind.title()) if last else kind.title(),support='experimental',meters=sorted(meters.values(),key=lambda m:m['meter']),
                   latest_attempt=last['ts'] if last else None,reused_sample=any(r['pool_kind']==kind and r.get('reused_sample') for r in sampled),
                   since_last_ok=interval(store,ok,None,coverage) if ok else dict(complete=False,consumption=None,why=['no_before_sample']))
        if reason:
            entry.update(explanation(reason))
        pools.append(entry)
    return dict(v=1,pools=pools,as_of=now(),coverage=coverage)


def discovery_key(context):
    return tuple(context.get(name) for name in ('claude_config_dir','codex_home','cursor_projects_dir','conductor_store','grok_home','cwd','repo_root'))


def coverage_for(store,context,cache):
    key=discovery_key(context)
    if key not in cache:
        cache[key]=scan(store,context)
    return cache[key]


def get_runs(store,args,context):
    cache={}
    coverage=coverage_for(store,context,cache)
    if args.active:
        rows=[]
        for state in store.all('state'):
            if state['ended_at'] is None and (not args.session_id or state['session_id']==args.session_id):
                own_coverage=coverage_for(store,state['metadata']['context'],cache)
                rows.extend(run_rows(store,state,own_coverage))
    else:
        stored=store.all('run')
        rows=[]
        for state in store.all('state'):
            if state['ended_at'] is None or (args.session_id and state['session_id']!=args.session_id):
                continue
            own_coverage=coverage_for(store,state['metadata']['context'],cache)
            current=run_rows(store,state,own_coverage)
            for row in current:
                previous=next((r for r in stored if (r['session_id'],r['pool_kind'],r['pool'])==(row['session_id'],row['pool_kind'],row['pool'])),{})
                row['local_persisted_at']=previous.get('local_persisted_at') or (store.get('receipt',state['session_id']+':finish') or store.get('receipt',state['session_id']+':abandon') or {}).get('local_persisted_at')
                row['lifecycle']='interrupted' if state.get('outcome')=='interrupted' else 'recorded'
                rows.append(row)
        covered={(r['session_id'],r['pool_kind'],r['pool']) for r in rows}
        rows.extend(r for r in stored if (r['session_id'],r['pool_kind'],r['pool']) not in covered)
    # External provenance fills missing config only; explicit lifecycle values win.
    path=store.root/'analytics/stage-runs.jsonl'
    if path.is_file() and not path.is_symlink():
        from telemetry import tail_records
        provenance={r.get('session_id'):r for r in tail_records(path)}
        for row in rows:
            for field in ('stage','agent','model','effort','route'):
                if row.get(field) is None:
                    row[field]=provenance.get(row['session_id'],{}).get(field)
    rows=decorate(store,rows)
    resolved={(r['session_id'],r['pool_kind']) for r in rows if r['pool']!='pending'}
    rows=[r for r in rows if r['pool']!='pending' or (r['session_id'],r['pool_kind']) not in resolved]
    return dict(v=1,runs=[r for r in rows if matches(r,args)],as_of=now(),coverage=coverage)


def summary(store,args,context):
    fields=args.by.split(',')
    if any(f not in ('stage','agent','model','effort','route','pool') for f in fields):
        raise QuotaError('usage','Invalid --by field.',2)
    args.active=False
    rows=get_runs(store,args,context)['runs']
    groups={}
    claimed=set()
    shared={}
    cents_seen=set()
    for row in sorted(rows,key=lambda r:(r['started_at'],r['session_id'],r['pool'])):
        key=tuple(row.get(f) for f in fields)
        group=groups.setdefault(key,dict(config=dict(zip(fields,key)),sessions=set(),attribution=Counter(),settlement=Counter(),
                                        run_values={},model_values={},excluded=Counter(),attributable_cents=0,events=set()))
        group['sessions'].add(row['session_id'])
        group['attribution'][row['attribution']]+=1
        group['settlement'][row['settlement']]+=1
        sources=[]
        for source in row['sources']:
            exclusions=set(source.get('why',[])) & {'ambiguous','shared_turn','boundary_unknown','identity_unknown','identity_changed'}
            if not source.get('complete'):
                exclusions.add('partial_source')
            if source['attribution']=='unknown':
                exclusions.add('attribution_unknown')
            if exclusions:
                group['excluded'].update(exclusions)
            else:
                sources.append(source)
        ids={ident for s in sources for ident in s['event_ids']}-claimed
        facts=store.get_many('usage',ids)
        facts.extend(store.get_many('cursor_event',ids))
        if not facts:
            group['excluded']['no_usage_or_duplicate']+=1
        claimed|=ids
        run_values=group['run_values'].setdefault(row['session_id'],{k:[] for k in CLASSES})
        for fact in facts:
            model_values=group['model_values'].setdefault(fact.get('model') or 'unknown',{}).setdefault(row['session_id'],{k:[] for k in CLASSES})
            for token_class in CLASSES:
                run_values[token_class].append(fact['tokens'].get(token_class))
                model_values[token_class].append(fact['tokens'].get(token_class))
        for event in row.get('events',[]):
            if event['shared_turn'] and 'ambiguous' not in event['why']:
                shared[event['event_id']]=dict(event_id=event['event_id'],charged_cents=event['charged_cents'])
            if event['attributable_cents'] is not None and event['event_id'] not in cents_seen:
                group['attributable_cents']+=event['attributable_cents']
                group['events'].add(event['event_id'])
                cents_seen.add(event['event_id'])
    result=[]
    def metrics_for(runs):
        metrics={}
        for key in CLASSES:
            values=[sum(run[key]) for run in runs.values() if run[key] and all(v is not None for v in run[key])]
            values.sort()
            metrics[key]=dict(median=statistics.median(values) if values else None,p90=values[max(0,math.ceil(.9*len(values))-1)] if values else None,
                              n=len(values),excluded=len(runs)-len(values),why=[] if values else ['not_reported'])
        return metrics
    for group in groups.values():
        metrics=metrics_for(group.pop('run_values'))
        group['by_billed_model']=[dict(model=model,consumption=metrics_for(runs)) for model,runs in sorted(group.pop('model_values').items())]
        group['run_count']=len(group.pop('sessions'))
        group['attributable_event_count']=len(group.pop('events'))
        group['consumption']=metrics
        group['excluded']=dict(group['excluded'])
        result.append(group)
    return dict(v=1,groups=result,shared_events=list(shared.values()),shared_cents=sum(x['charged_cents'] for x in shared.values()),as_of=now())


def doctor(store,context,warnings,args):
    samples=store.all('sample')
    pools=[]
    for kind in KINDS:
        if args.pool and args.pool.split(':')[0]!=kind:
            continue
        boundary=since(args)
        rows=[s for s in samples if s['pool_kind']==kind and s['ts']>=(boundary if boundary is not None else now()-86400) and
              (not args.pool or ':' not in args.pool or s['pool']==args.pool)]
        ok=[s for s in rows if s['status']=='ok']
        evidence=identity(store,kind,context) if store.key else {}
        reasons=dict(Counter(s['reason'] for s in rows if s.get('reason')))
        from .common import vendor_binary
        try:
            if kind in ('claude','codex'):
                vendor_binary(kind)
            executable_available=True
        except QuotaError:
            executable_available=False
        available=bool(os.environ.get('CURSOR_API_KEY')) if kind=='cursor' and not fixture_dir() else evidence.get('pool','pending')!='pending'
        pools.append(dict(pool_kind=kind,pool=args.pool if args.pool and ':' in args.pool else evidence.get('pool','pending'),
                          support='experimental',credential_available=available,
                          executable_available=executable_available,credential_source='fixture' if fixture_dir() else 'CURSOR_API_KEY' if kind=='cursor' else 'vendor-managed account',
                          coverage=len(ok)/len(rows) if rows else None,attempts=len(rows),last_ok_age_s=max(0,now()-max(s['observed_at'] for s in ok)) if ok else None,
                          reasons=reasons,diagnostics=[explanation(code) for code in reasons],drift_count=sum(len(s['unknown_fields']) for s in rows)))
    states=store.all('state')
    try:
        from telemetry import read_capped
        refusals=read_capped(store.root/'quota-refusals',1 << 20).count(b'\n')
    except OSError:
        refusals=0
    return dict(v=1,pools=pools,test_variable_warnings=warnings,open_runs=sum(s['ended_at'] is None for s in states),
                stale_runs=sum(s['ended_at'] is None and now()-s['lease_at']>48*3600 for s in states),
                unsettled_cursor_rows=sum(r['pool_kind']=='cursor' and r['settlement']!='final' for r in store.all('run')),
                refusals=refusals,malformed_records=sum(f.get('malformed',0) for f in store.all('file')),
                counters=store.all('counter'),store_bytes=store.path.stat().st_size if store.path.exists() else 0,
                notice='Only explicit quota commands sample vendors. Telemetry has no quota hook. Disable with bin/config set quota off.')


TIME_FIELDS={'ts','observed_at','sampled_at','stale_after','resets_at','started_at','ended_at','as_of','local_persisted_at',
             'settled_at','observed_through','latest_attempt','retry_at','turn_start','turn_end','event_ts','verified_at','credential_mtime'}


def public(value,key=None):
    if isinstance(value,dict):
        return {k:public(v,k) for k,v in value.items()}
    if isinstance(value,list):
        return [public(v) for v in value]
    if key in TIME_FIELDS and isinstance(value,(float,int)):
        return iso(value)
    return value


def human(result):
    if result.get('disabled'):
        return 'Quota ledger disabled.'
    if 'error' in result:
        error=result['error']
        return error['message']+' Fix: '+error['fix']
    if 'refusals' in result and 'pools' in result:
        lines=[result.get('notice') or 'Quota doctor']
        lines.append('open '+str(result.get('open_runs',0))+'; stale '+str(result.get('stale_runs',0))+'; refusals '+str(result.get('refusals',0))+'; unsettled cursor '+str(result.get('unsettled_cursor_rows',0)))
        for pool in result['pools']:
            coverage=pool.get('coverage')
            lines.append(pool['pool_kind']+' ['+pool.get('support','experimental')+'] coverage '+(('%.0f%%'%(coverage*100)) if isinstance(coverage,(int,float)) else 'unknown'))
            for code,count in sorted(pool.get('reasons',{}).items()):
                lines.append('  '+code+' x'+str(count))
        return '\n'.join(lines)
    if 'pools' in result:
        lines=[]
        for pool in result['pools']:
            lines.append(pool.get('plan_label',pool['pool_kind'])+' ['+pool.get('support','experimental')+']')
            for meter in pool.get('meters',[]):
                age=round(meter['age_s'])
                reset=max(0,round(meter['resets_at']-now())) if meter['resets_at'] is not None else None
                reset_text='resets in '+str(reset)+'s' if reset is not None else 'no reset time'
                lines.append('  '+meter['label']+': '+str(meter['used'])+' / '+str(meter['limit'])+' '+meter['unit']+'; age '+str(age)+'s; '+reset_text+'; '+meter['state'])
            if pool.get('reason'):
                lines.append('  '+pool['reason']+'. Fix: '+pool['fix'])
        return '\n'.join(lines)
    return json.dumps(public(result),indent=2)


def main(argv=None):
    argv=list(sys.argv[1:] if argv is None else argv)
    as_json='--json' in argv
    root=state_root()
    if not config_enabled(root,'quota'):
        print(json.dumps(dict(v=1,disabled=True)) if as_json else 'Quota ledger disabled.')
        return 0
    store=None
    report=bool(argv and argv[0]=='doctor')
    try:
        warnings=check_fixture()
        if fixture_dir():
            print('Quota fixture mode: no vendor credentials or network.',file=sys.stderr)
        args=parser().parse_args(argv)
        context=context_from(args)
        since(args)
        if args.pool and args.pool.split(':')[0] not in (*KINDS,'grok','unknown','api'):
            raise QuotaError('usage','Unknown pool kind.',2)
        store=Store(root,readonly=report)
        if args.command=='doctor':
            result=doctor(store,context,warnings,args)
        elif args.command=='status':
            kinds=[args.pool.split(':')[0]] if args.pool else list(KINDS)
            if args.pool and ':' in args.pool and identity(store,kinds[0],context)['pool']!=args.pool:
                kinds=[]
            sampled=refresh(root,[k for k in kinds if k in KINDS],context,force=args.force) if args.refresh else []
            result=status(store,args,context,sampled)
        elif args.command=='sample':
            if args.phase:
                if not args.session_id:
                    raise QuotaError('usage','--phase requires --session-id.',2)
                receipt_key=args.session_id+':'+args.phase
                if args.phase=='attach' and args.harness_session:
                    receipt_key+=':'+store.digest([args.agent,args.harness_session],'attach')
                had_receipt=store.get('receipt',receipt_key)
                result=lifecycle(store,args,context)
                state=store.get('state',args.session_id)
                agent=state['metadata'].get('agent')
                if not had_receipt and args.phase in ('start','finish','attach'):
                    kinds=([agent] if agent in KINDS else []) if args.phase!='finish' else sorted({r['pool_kind'] for r in store.all('run') if r['session_id']==args.session_id and r['pool_kind'] in KINDS})
                    if args.pool:
                        kinds=[kind for kind in kinds if args.pool==kind or args.pool==identity(store,kind,state['metadata']['context'])['pool']]
                    if state['metadata'].get('auth')!='api':
                        sampling_context=dict(state['metadata']['context'],sandboxed=context['sandboxed'])
                        refresh(root,kinds,sampling_context,{'start':'run_start','finish':'run_finish','attach':'attach'}[args.phase],args.session_id)
            elif args.pool and args.pool.split(':')[0] in KINDS:
                kind=args.pool.split(':')[0]
                if ':' in args.pool and identity(store,kind,context)['pool']!=args.pool:
                    result=dict(v=1,samples=[],**explanation('identity_unknown'))
                else:
                    result=dict(v=1,samples=refresh(root,[kind],context,'periodic'))
            else:
                raise QuotaError('usage','Supply --session-id and --phase, or --pool.',2)
        elif args.command=='runs':
            result=get_runs(store,args,context)
        elif args.command=='summary':
            result=summary(store,args,context)
        elif args.command=='intervals':
            coverage=scan(store,context)
            result=dict(v=1,intervals=[r for r in intervals(store,coverage) if matches(r,args)],coverage=coverage,as_of=now())
        elif args.command=='settle':
            result=settle(store,context,args.pool,since(args))
        elif args.command=='probe':
            if context['sandboxed']:
                raise QuotaError('sandboxed')
            evidence=identity(store,args.kind,context)
            if args.pool and args.pool not in (args.kind,evidence['pool']):
                raise QuotaError('identity_unknown')
            if args.kind not in [p.strip() for p in config_value(root,'quota_pools',','.join(KINDS)).split(',')]:
                raise QuotaError('disabled')
            from .readers import claude,codex,cursor
            deadline=time.monotonic()+budget(8)
            with store.lock('sample:'+args.kind,deadline):
                backoff=store.get('backoff',evidence['fingerprint'],{})
                if backoff.get('retry_at',0)>now():
                    raise QuotaError('http_429',retry_at=backoff['retry_at'])
                try:
                    _,body={'claude':claude,'codex':codex,'cursor':cursor}[args.kind].read(store,context,deadline)
                except QuotaError as error:
                    if error.code=='http_429':
                        with store.transaction():
                            store.put('backoff',evidence['fingerprint'],dict(retry_at=error.retry_at or now()+300))
                    raise
            print(json.dumps(body))
            return 0
        print(json.dumps(public(result),separators=(',',':'),allow_nan=False) if as_json else human(result))
        return 0
    except Exception as error:
        if not isinstance(error,QuotaError):
            error=QuotaError('store_error')
        if error.code=='store_refused' and not report:
            record_refusal(root)
        detail=dict(code=error.code,message=error.message,**{k:v for k,v in explanation(error.code).items() if k!='reason'})
        if error.retry_at is not None:
            detail['retry_at']=error.retry_at
        result=dict(v=1,error=detail)
        print(json.dumps(public(result),separators=(',',':'),allow_nan=False) if as_json else human(result),file=sys.stdout if as_json or report else sys.stderr)
        return 0 if report and error.code in ('store_error','store_refused') else error.exit_code
    finally:
        if store:
            store.close()


if __name__=='__main__':
    sys.exit(main())
