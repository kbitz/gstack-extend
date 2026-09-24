"""Shared contracts, bounded IO and injectable vendor process boundary."""
import json
import math
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time
from datetime import datetime, timezone

from telemetry import parse_ts, valid_session, which, executable, config_enabled, config_value

VERSION = 1
KINDS = ('claude', 'codex', 'cursor')
CLASSES = ('input', 'cache_read', 'cache_write', 'output', 'reasoning')
REASONS = {
    'no_sample': ('No capacity observation recorded', 'Run gstack-extend quota status --refresh.'),
    'no_credentials': ('No usable credential source; capacity unknown', 'Sign in with the vendor CLI; Cursor needs CURSOR_API_KEY.'),
    'auth_expired': ('Access token expired; capacity unknown', 'Use the vendor CLI to sign in again.'),
    'missing_executable': ('Vendor CLI absent', 'Install the vendor CLI and check PATH.'),
    'unsupported_version': ('Required CLI flags unavailable', 'Upgrade the vendor CLI.'),
    'http_401': ('Authentication rejected', 'Sign in again with the vendor CLI.'),
    'http_403': ('Account access denied', 'Check account permissions with the vendor.'),
    'http_429': ('Vendor backoff active', 'Wait until retry_at; force does not bypass backoff.'),
    'http_4xx': ('Endpoint rejected the request', 'Run doctor quota and check adapter compatibility.'),
    'http_5xx': ('Vendor service failure', 'Retry after the service recovers.'),
    'network_error': ('Connection, DNS or TLS failure', 'Check connectivity and retry.'),
    'timeout': ('Read, process or lock budget exhausted', 'Retry when the source is responsive.'),
    'schema_changed': ('Response does not match the adapter', 'Upgrade or regenerate a scrubbed fixture.'),
    'spawn_failed': ('Vendor process could not start', 'Check executable permissions and retry.'),
    'disabled': ('Pool disabled in quota_pools', 'Enable the pool in quota_pools.'),
    'sandboxed': ('Network forbidden by sandbox markers', 'Retry from an unsandboxed caller.'),
    'exchange_throttled': ('Cursor key exchanged within 60 seconds', 'Retry after retry_at.'),
    'identity_unknown': ('Paying account cannot be established', 'Attach a session with verified subscription identity.'),
    'identity_changed': ('Account changed during observation', 'Finish this run and start a new bracket.'),
    'log_too_large': ('Source exceeds the per-file read cap', 'Narrow declared roots or archive completed vendor logs.'),
    'source_unreadable': ('A declared source cannot be scanned', 'Repair source permissions and retry.'),
    'scan_budget': ('Discovery or parsing budget exhausted', 'Repeat the query to advance checkpoints.'),
    'malformed_record': ('A source contains an invalid record', 'Check vendor log integrity.'),
    'no_usage': ('No attributable usage record is available', 'Attach the correct harness session and retry.'),
    'not_reported': ('Source does not report structured usage', 'Keep consumption unknown; inspect another supported source.'),
    'ordering_unknown': ('Usage counter order cannot be established', 'Check vendor log integrity.'),
    'boundary_unknown': ('Turn boundaries are not recorded', 'Keep the charge uncertain; do not allocate it.'),
    'ambiguous': ('Evidence matches several identities or parents', 'Supply an explicit harness identity.'),
    'store_refused': ('Store path is not a private regular file', 'Remove the unsafe link or repair permissions.'),
    'store_error': ('Transaction could not commit', 'Free disk space and retry the same command.'),
    'no_start_state': ('Run has no start state', 'Start this session ID before attaching or finishing.'),
    'run_finished': ('Run has already finished', 'Start a new session ID before attaching more work.'),
    'conflict': ('Session ID has different start metadata', 'Retry with the original metadata or use a new session ID.'),
    'fixture_refused': ('Test variables require an isolated fixture state directory', 'Unset test variables, or set fixture mode and a private state directory.'),
    'usage': ('Invalid command arguments', 'Run the command with --help.'),
}


class QuotaError(Exception):
    def __init__(self, code, message=None, exit_code=1, retry_at=None):
        self.code, self.exit_code, self.retry_at = code, exit_code, retry_at
        self.message = message or REASONS.get(code, (code,))[0]
        super().__init__(self.message)


def explanation(code):
    cause, fix = REASONS.get(code, (code, 'Run gstack-extend quota --help.'))
    return dict(reason=code, fix=fix, doc='docs/quota-ledger.md#troubleshooting')


def fixture_dir():
    value = os.environ.get('GSTACK_EXTEND_QUOTA_FIXTURES')
    return Path(value) if value else None


def state_root():
    return Path(os.environ.get('GSTACK_EXTEND_STATE_DIR') or Path.home()/'.gstack-extend').absolute()


def check_fixture():
    names = [k for k in os.environ if k.startswith('GSTACK_EXTEND_QUOTA_')]
    test_names = [k for k in names if k in ('GSTACK_EXTEND_QUOTA_FIXTURES', 'GSTACK_EXTEND_QUOTA_NOW', 'GSTACK_EXTEND_QUOTA_BUDGET_SCALE')]
    if test_names:
        explicit = os.environ.get('GSTACK_EXTEND_STATE_DIR')
        if not fixture_dir() or not explicit or state_root().resolve() == (Path.home()/'.gstack-extend').resolve():
            raise QuotaError('fixture_refused', 'Test variables require fixture mode and an isolated state directory.')
        if os.environ.get('CURSOR_API_KEY'):
            raise QuotaError('fixture_refused', 'Fixture processes must not inherit vendor credentials.')
    return test_names


def now():
    value = os.environ.get('GSTACK_EXTEND_QUOTA_NOW') if fixture_dir() else None
    return (parse_ts(value) if value and 'T' in value else float(value)) if value else time.time()


_MAX_TS = 253402300799


def iso(value):
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        if not math.isfinite(value) or value < 0 or value > _MAX_TS:
            return None
        return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (OverflowError, OSError, ValueError):
        return None


def timestamp(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value):
            return None
        value = value / 1000 if value > 100000000000 else value
        return value if 0 <= value <= _MAX_TS else None
    if isinstance(value, str) and value.isdigit():
        return timestamp(int(value))
    return parse_ts(value)


def budget(seconds):
    try:
        scale = float(os.environ.get('GSTACK_EXTEND_QUOTA_BUDGET_SCALE', '1')) if fixture_dir() else 1
        return seconds * max(.001, min(1, scale))
    except ValueError:
        raise QuotaError('usage', 'Invalid fixture budget scale.', 2)


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def json_file(path, cap=1 << 20):
    from telemetry import read_capped
    try:
        return json.loads(read_capped(Path(path), cap))
    except (OSError, ValueError):
        return {}


def vendor_binary(name):
    fixtures = fixture_dir()
    candidate = str(fixtures/'bin'/name) if fixtures else which(name)
    if fixtures and candidate and Path(candidate).exists():
        bin_dir = (fixtures/'bin').absolute()
        path = Path(candidate)
        unsafe = bin_dir.is_symlink() or not bin_dir.is_dir() or path.is_symlink() or not path.is_file() or path.parent != bin_dir
        if not unsafe:
            try:
                info = path.stat()
                unsafe = info.st_nlink != 1 or not path.resolve().is_relative_to(bin_dir.resolve())
            except OSError:
                unsafe = True
        if unsafe:
            raise QuotaError('fixture_refused', 'Fixture vendor binaries must be local regular files.')
    if not executable(candidate):
        raise QuotaError('missing_executable')
    return candidate


def _write_bounded(stream, payload, deadline):
    fd = stream.fileno()
    os.set_blocking(fd, False)
    view = memoryview(payload)
    sent = 0
    while sent < len(view):
        if time.monotonic() >= deadline:
            raise QuotaError('timeout')
        try:
            wrote = os.write(fd, view[sent:])
        except BlockingIOError:
            time.sleep(min(.02, max(0, deadline-time.monotonic())))
            continue
        except BrokenPipeError:
            return
        if wrote <= 0:
            raise QuotaError('timeout')
        sent += wrote


def vendor_env(context, kind):
    allowed = ('HOME', 'PATH', 'USER', 'TMPDIR', 'LANG')
    result = {key: value for key, value in os.environ.items() if key in allowed}
    if kind == 'claude' and Path(context['claude_config_dir']) != Path.home()/'.claude':
        # The default directory must stay unset. Setting it, even to ~/.claude,
        # makes current Claude omit the /usage report.
        result['CLAUDE_CONFIG_DIR'] = context['claude_config_dir']
    if kind == 'codex':
        result['CODEX_HOME'] = context['codex_home']
    return result


def run_vendor(name, args, context, deadline, requests=None):
    """Bounded, nonblocking pipes; no raw stderr or command in errors."""
    binary = vendor_binary(name)
    try:
        process = subprocess.Popen([binary] + args, stdin=subprocess.PIPE if requests else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env=vendor_env(context, name), start_new_session=True, close_fds=True)
    except OSError:
        raise QuotaError('spawn_failed')
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    data, pending, initialized = bytearray(), b'', False
    try:
        if requests:
            _write_bounded(process.stdin, json.dumps(requests[0]).encode()+b'\n', deadline)
        while time.monotonic() < deadline:
            for key, _ in selector.select(min(.05, max(0, deadline-time.monotonic()))):
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    try:
                        code = process.wait(timeout=max(.01, deadline-time.monotonic()))
                    except subprocess.TimeoutExpired:
                        raise QuotaError('timeout')
                    if code != 0:
                        raise QuotaError('unsupported_version' if not data else 'schema_changed')
                    return bytes(data)
                data.extend(chunk)
                if len(data) > 1 << 20:
                    raise QuotaError('schema_changed')
                if requests:
                    pending += chunk
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        try:
                            reply = json.loads(line)
                        except ValueError:
                            continue
                        if reply.get('id') == 1 and not initialized:
                            initialized = True
                            for request in requests[1:]:
                                _write_bounded(process.stdin, json.dumps(request).encode()+b'\n', deadline)
                        if reply.get('id') == requests[-1].get('id'):
                            return json.dumps(reply).encode()
        raise QuotaError('timeout')
    finally:
        # Always reap the process group, including descendants ignoring SIGTERM.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        selector.close()
        process.stdout.close()
        if process.stdin:
            process.stdin.close()


def context_from(args):
    home = Path.home()
    cwd = getattr(args, 'cwd', None) or str(Path.cwd())
    auth=getattr(args,'auth',None) or 'unknown'
    session=getattr(args,'harness_session',None)
    agent=getattr(args,'agent',None)
    if not getattr(args,'auth',None) and session:
        if agent=='claude' and session==os.environ.get('CLAUDE_CODE_SESSION_ID'):
            auth='api' if any(os.environ.get(k) not in (None,'','0') for k in ('ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY')) else 'subscription'
        elif agent=='codex' and session==os.environ.get('CODEX_THREAD_ID') and not fixture_dir():
            codex_root=Path(getattr(args,'codex_home',None) or os.environ.get('CODEX_HOME') or home/'.codex')
            record=json_file(codex_root/'auth.json')
            auth='api' if record.get('auth_mode') in ('apikey','api_key') or record.get('OPENAI_API_KEY') else 'subscription'
            from telemetry import read_capped
            try:
                import re
                config=read_capped(codex_root/'config.toml',1 << 20).decode()
                provider=re.search(r'^model_provider\s*=\s*"([^"]+)"',config,re.M)
                if provider and provider[1]!='openai':
                    auth='api'
            except OSError:
                pass
    return dict(cwd=str(Path(cwd).absolute()), repo_root=str(Path(getattr(args, 'repo_root', None) or cwd).absolute()),
                claude_config_dir=str(Path(getattr(args, 'claude_config_dir', None) or os.environ.get('CLAUDE_CONFIG_DIR') or home/'.claude').absolute()),
                codex_home=str(Path(getattr(args, 'codex_home', None) or os.environ.get('CODEX_HOME') or home/'.codex').absolute()),
                cursor_projects_dir=str(Path(getattr(args, 'cursor_projects_dir', None) or home/'.cursor/projects').absolute()),
                conductor_store=str(Path(getattr(args, 'conductor_store', None) or home/'Library/Application Support/com.conductor.app/cursor-sdk-store').absolute()),
                grok_home=str(home/'.grok'), auth=auth,
                sandboxed=bool(os.environ.get('CODEX_SANDBOX') or os.environ.get('CODEX_SANDBOX_NETWORK_DISABLED')))


def model_vendor(model):
    import re
    for pattern, vendor in ((r'claude|opus|sonnet|haiku|fable', 'anthropic'), (r'gpt-|o[1-9]', 'openai'),
                            (r'grok-', 'xai'), (r'composer-|vega', 'cursor')):
        if re.match(pattern, model or '', re.I):
            return vendor
    return None
