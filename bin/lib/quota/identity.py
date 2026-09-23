import base64
import json
import os
from pathlib import Path
from .common import fixture_dir, json_file, now


def identity(store, kind, context):
    fixture = fixture_dir()
    if fixture:
        data = json_file(fixture/'identities.json').get(kind, {})
        return dict(pool=store.pool(kind, data.get('id')), credential_mtime=data.get('mtime', 0),
                    evidence='fixture', verified_at=now(), fingerprint=store.digest(data.get('id', ''), kind))
    path = Path(context['codex_home'])/'auth.json' if kind == 'codex' else Path(context['claude_config_dir'])/'.claude.json'
    if kind == 'claude' and Path(context['claude_config_dir']) == Path.home()/'.claude':
        path = Path.home()/'.claude.json'
    if kind == 'cursor':
        key = os.environ.get('CURSOR_API_KEY')
        cached = store.get('cursor_identity', store.digest(key, 'credential'), {}) if key else {}
        return dict(pool=cached.get('pool', 'pending'), credential_mtime=None, evidence='cursor-events',
                    verified_at=now(), fingerprint=store.digest(key or '', 'credential'))
    data = json_file(path, 16 << 20 if kind == 'claude' else 1 << 20)
    raw = (data.get('oauthAccount') or {}).get('organizationUuid') if kind == 'claude' else (data.get('tokens') or {}).get('account_id')
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = None
    return dict(pool=store.pool(kind, raw), credential_mtime=mtime, evidence='account-file', verified_at=now(),
                fingerprint=store.digest(raw or '', kind))


def fresh_codex_token(context):
    data = json_file(Path(context['codex_home'])/'auth.json')
    token = (data.get('tokens') or {}).get('access_token') or ''
    try:
        claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))
        return isinstance(claims.get('exp'), (int,float)) and claims['exp'] > now()+30
    except (ValueError, IndexError, TypeError):
        return False


def bind(store, kind, context, evidence):
    anchor = evidence.get('fingerprint') if kind == 'cursor' else (
        context.get('claude_config_dir') if kind == 'claude' else context.get('codex_home'))
    key = store.digest([kind, anchor], 'binding')
    history = store.get('bindings', key, {'key':key, 'kind':kind, 'periods':[]})
    pool = evidence.get('pool')
    # A missing credential is not an account switch. Do not close a verified period.
    if pool in (None, 'pending', 'unresolved'):
        return history
    periods = history['periods']
    if not periods or periods[-1]['pool'] != pool:
        if periods:
            periods[-1]['end'] = now()
        periods.append(dict(start=now(), end=None, pool=pool))
    store.put('bindings', key, history)
    return history
