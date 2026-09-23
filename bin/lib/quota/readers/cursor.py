import os
from ..common import QuotaError, fixture_dir, now, number, timestamp
from .transport import response

BASE = 'https://api2.cursor.sh'
DASHBOARD = BASE+'/aiserver.v1.DashboardService/'


def credential_key():
    return os.environ.get('CURSOR_API_KEY')


def token(store, deadline):
    if getattr(store,'cursor_access',None):
        return store.cursor_access
    if fixture_dir():
        return None, 'fixture'
    key = credential_key()
    if not key:
        raise QuotaError('no_credentials')
    fingerprint = store.digest(key, 'credential')
    with store.lock('exchange:'+fingerprint,deadline):
        previous = store.get('exchange',fingerprint,{}).get('at',0)
        if now()-previous < 60:
            raise QuotaError('exchange_throttled', retry_at=previous+60)
        with store.transaction():
            store.put('exchange',fingerprint,{'at':now()})
            store.count('cursor_exchanges')
        body = response('cursor-exchange',BASE+'/auth/exchange_user_api_key',deadline,key,{})
        value = body.get('accessToken') or body.get('access_token') if isinstance(body,dict) else None
        if not isinstance(value,str):
            raise QuotaError('schema_changed')
        store.cursor_access=(value,fingerprint)
        return store.cursor_access


def parse(body):
    if not isinstance(body,dict) or not isinstance(body.get('planUsage'),dict):
        raise QuotaError('schema_changed')
    plan = body['planUsage']
    start, end = timestamp(body.get('billingCycleStart')), timestamp(body.get('billingCycleEnd'))
    meters, bad = [], False
    fields = [('included_cents','includedSpend','limit','cents',.01),('auto_percent','autoPercentUsed',None,'percent',1),('api_percent','apiPercentUsed',None,'percent',1)]
    for name, used, cap, unit, resolution in fields:
        value, limit = number(plan.get(used)), number(plan.get(cap)) if cap else 100
        if value is None or limit is None:
            bad = True
            continue
        meters.append(dict(meter='cursor:'+name,label=name.replace('_',' '),used=value,limit=limit,unit=unit,
                           resolution=resolution,resets_at=end,window_s=end-start if start is not None and end is not None else None,
                           window_kind='fixed_cycle'))
    if not meters:
        raise QuotaError('schema_changed')
    return meters,bad


def events(store, deadline, start, end, access=None):
    access, fingerprint = access or token(store,deadline)
    result, complete = [], False
    for page in range(1,21):
        name = 'cursor-events' if page == 1 else 'cursor-events-'+str(page)
        data = response(name,DASHBOARD+'GetFilteredUsageEvents',deadline,access,
                        {'startDate':str(int(start*1000)),'endDate':str(int(end*1000)),'page':page,'pageSize':1000})
        rows = data.get('usageEventsDisplay') if isinstance(data,dict) else None
        if not isinstance(rows,list):
            raise QuotaError('schema_changed')
        result.extend(rows)
        if len(rows)<1000 or len(result)>=data.get('totalUsageEventsCount',float('inf')):
            complete=True
            break
    return result, complete, fingerprint


def read(store, context, deadline):
    access = token(store,deadline)
    body = response('cursor-period',DASHBOARD+'GetCurrentPeriodUsage',deadline,access[0],{})
    meters, bad = parse(body)
    cached = store.get('cursor_identity',access[1],{})
    event_error=None
    try:
        rows, complete, _ = events(store,deadline,now()-6*3600,now()+600,access)
        from ..cursor_cost import ingest
        ingest(store,rows,complete)
        owners = {str(r['owningUser']) for r in rows if isinstance(r,dict) and r.get('owningUser') is not None}
        if len(owners)==1:
            pool=store.pool('cursor',next(iter(owners)))
            if cached.get('pool') not in (None,'pending',pool):
                pool='pending'
            cached={'pool':pool}
            with store.transaction():
                store.put('cursor_identity',access[1],cached)
    except QuotaError as error:
        event_error=error.code
        if error.code=='http_429':
            with store.transaction():
                store.put('backoff',access[1],{'retry_at':error.retry_at or now()+300})
    label='Cursor subscription'
    try:
        plan=response('cursor-plan',DASHBOARD+'GetPlanInfo',deadline,access[0],{})
        if isinstance(plan,dict) and isinstance(plan.get('planName'),str) and len(plan['planName'])<80:
            label='Cursor '+plan['planName']
    except QuotaError as error:
        if error.code=='http_429':
            with store.transaction():
                store.put('backoff',access[1],{'retry_at':error.retry_at or now()+300})
    return dict(source='cursor-api2',meters=meters,status='partial' if bad else 'ok',reason='schema_changed' if bad else None,
                pool=cached.get('pool','pending'),plan_label=label,event_reason=event_error),body
