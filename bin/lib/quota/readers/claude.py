import hashlib
import json
from ..common import QuotaError, fixture_dir, number, run_vendor, timestamp
from .transport import response
from ..identity import identity


def parse(body):
    report = body.get('usage_report', body) if isinstance(body, dict) else {}
    rates = report.get('rate_limits', report)
    if not isinstance(rates,dict):
        raise QuotaError('schema_changed')
    limits = rates.get('limits') if isinstance(rates,dict) else None
    if limits is None:
        limits = [dict(kind=name, percent=value.get('utilization'), resets_at=value.get('resets_at'))
                  for name,value in rates.items() if name in ('five_hour','seven_day') and isinstance(value,dict)]
    if not isinstance(limits,list) or not limits:
        raise QuotaError('schema_changed')
    meters, invalid = [], 0
    for limit in limits:
        if not isinstance(limit,dict) or not isinstance(limit.get('kind'),str) or number(limit.get('percent')) is None:
            invalid += 1
            continue
        scope = limit.get('scope') or {}
        full = [limit['kind'], limit.get('group'), scope]
        key = hashlib.sha256(json.dumps(full,sort_keys=True).encode()).hexdigest()[:16]
        kind = limit['kind']
        window = 18000 if kind in ('session','five_hour') else 604800 if 'week' in kind or kind=='seven_day' else None
        model = scope.get('model') or {}
        label = ('5h session' if window == 18000 else 'weekly' if window == 604800 else kind)
        label += ' '+model.get('display_name','')
        meters.append(dict(meter='claude:'+kind+':'+key, label=label.strip(), used=limit['percent'], limit=100,
                           unit='percent', resolution=1, resets_at=timestamp(limit.get('resets_at')),
                           window_s=window, window_kind='rolling', severity=limit.get('severity'), active=limit.get('is_active')))
    if not meters:
        raise QuotaError('schema_changed')
    return meters, bool(invalid)


def read(store, context, deadline):
    if fixture_dir() and not (fixture_dir()/'bin/claude').exists():
        body = response('claude-usage', '', deadline)
    else:
        raw = run_vendor('claude', ['-p','/usage','--output-format','stream-json','--verbose',
                                  '--no-session-persistence','--safe-mode','--strict-mcp-config','--mcp-config','{"mcpServers":{}}'], context, deadline)
        body = None
        for line in raw.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event,dict) and isinstance(event.get('usage_report'),dict):
                body = event
        if body is None:
            raise QuotaError('schema_changed')
    meters, partial = parse(body)
    report=body.get('usage_report',body)
    account=report.get('account') or body.get('account') or {}
    organization=account.get('organizationUuid') or account.get('organization_uuid') if isinstance(account,dict) else None
    supplied=store.pool('claude',organization) if isinstance(organization,str) else None
    local=identity(store,'claude',context)['pool']
    mismatch=supplied is not None and supplied!=local
    return dict(source='claude-usage', meters=meters, status='partial' if partial else 'ok',
                pool='pending' if mismatch else local,reason='identity_changed' if mismatch else 'schema_changed' if partial else None,
                plan_label='Claude subscription'), body
