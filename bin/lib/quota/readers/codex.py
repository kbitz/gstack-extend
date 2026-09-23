import json
from pathlib import Path
import time
from ..common import QuotaError, fixture_dir, now, number, run_vendor, timestamp
from ..identity import bind, fresh_codex_token, identity
from .transport import response


def parse(body):
    if not isinstance(body,dict):
        raise QuotaError('schema_changed')
    body = body.get('result', body)
    pools = body.get('rateLimitsByLimitId')
    if not isinstance(pools,dict) or not pools:
        single = body.get('rateLimits', body.get('rate_limits', body))
        pools = {single.get('limitId',single.get('limit_id','codex')): single} if isinstance(single,dict) else {}
    meters, bad = [], False
    for ident, pool in pools.items():
        if not isinstance(pool,dict):
            bad = True
            continue
        for slot in ('primary','secondary'):
            window = pool.get(slot)
            if window is None:
                continue
            if not isinstance(window,dict):
                bad = True
                continue
            used = number(window.get('usedPercent',window.get('used_percent')))
            duration = number(window.get('windowDurationMins',window.get('window_minutes')))
            if used is None or duration is None:
                bad = True
                continue
            if duration == 0:
                continue
            meters.append(dict(meter='codex:'+str(ident)+':'+slot, label='weekly' if duration==10080 else str(duration)+' min',
                               used=used, limit=100, unit='percent', resolution=1, resets_at=timestamp(window.get('resetsAt',window.get('resets_at'))),
                               window_s=duration*60, window_kind='rolling'))
    if not meters:
        raise QuotaError('schema_changed')
    return meters, bad


def rollout(context, deadline):
    # Capacity needs the newest observed fact; consumption uses the full source index.
    from telemetry import tail_records
    best = None
    root = (Path(context['codex_home'])/'sessions')
    try:
        base = root.resolve()
    except OSError:
        return None
    for i,path in enumerate(root.glob('*/*/*/rollout-*.jsonl')):
        if i >= 10000 or time.monotonic() >= deadline:
            break
        try:
            if path.is_symlink() or path.stat().st_nlink != 1 or not path.resolve().is_relative_to(base):
                continue
            if path.stat().st_mtime < now()-300:
                continue
        except OSError:
            continue
        for row in tail_records(path):
            payload = row.get('payload') or {}
            stamp = timestamp(row.get('timestamp'))
            if payload.get('type') == 'token_count' and payload.get('rate_limits') and stamp is not None and stamp >= now()-300:
                if best is None or stamp > best[0]:
                    best = stamp, payload
    return best


def current_account_rollout(store, context, recent):
    """Keep a rollout only when it was written during the current account period."""
    if not recent:
        return None
    stamp, _body = recent
    evidence = identity(store, 'codex', context)
    history = bind(store, 'codex', context, evidence)
    period = (history.get('periods') or [None])[-1]
    if period and period.get('pool')==evidence.get('pool') and period['start']<=stamp and (period.get('end') is None or stamp<period['end']):
        return recent
    return None


def read(store, context, deadline):
    recent = current_account_rollout(store, context, rollout(context, min(deadline,time.monotonic()+.4))) if not fixture_dir() else None
    if recent:
        stamp, body = recent
        source = 'codex-rollout'
    else:
        source, stamp = 'codex-app-server', now()
        if fixture_dir() and not (fixture_dir()/'bin/codex').exists():
            body = response('codex-rate-limits', '', deadline)
        else:
            if not fresh_codex_token(context):
                raise QuotaError('auth_expired')
            raw = run_vendor('codex', ['-s','read-only','-a','never','app-server'], context, deadline, requests=[
                dict(id=1,method='initialize',params={'clientInfo':{'name':'gstack-extend-quota','version':'1'}}),
                dict(method='initialized'), dict(id=2,method='account/rateLimits/read')])
            try:
                body = json.loads(raw)
            except ValueError:
                raise QuotaError('schema_changed')
    meters, partial = parse(body)
    envelope=body.get('result',body)
    limits=envelope.get('rateLimits') or envelope.get('rate_limits') or {}
    plan=limits.get('planType') or limits.get('plan_type')
    return dict(source=source, observed_at=stamp, meters=meters, status='partial' if partial else 'ok',
                reason='schema_changed' if partial else None, plan_label='ChatGPT '+str(plan).title() if plan else 'ChatGPT subscription'), body
