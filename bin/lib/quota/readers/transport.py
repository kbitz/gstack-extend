import json
import time
import urllib.error
import urllib.request
from ..common import QuotaError, budget, fixture_dir, json_file, now


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never resend Authorization to a redirected host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise QuotaError('http_4xx')


def response(name, url, deadline, token=None, body=None):
    fixture = fixture_dir()
    if fixture:
        row = json_file(fixture/(name+'.json'))
        if not row:
            raise QuotaError('no_credentials')
        delay = row.get('delay_ms', 0)/1000 * budget(1)
        if time.monotonic()+delay >= deadline:
            raise QuotaError('timeout')
        time.sleep(delay)
        error = row.get('error')
        if error:
            raise QuotaError('timeout' if error == 'timeout' else 'network_error')
        status = row.get('status', 200)
        if status >= 400:
            raise http_error(status, row.get('retry_after'))
        return row.get('body')
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1'}
    if token:
        headers['Authorization'] = 'Bearer '+token
    request = urllib.request.Request(url, headers=headers, data=json.dumps(body).encode() if body is not None else None)
    try:
        opener = urllib.request.build_opener(_NoRedirect)
        with opener.open(request, timeout=max(.001, min(budget(5), deadline-time.monotonic()))) as result:
            data=bytearray()
            while len(data)<=1 << 20:
                remaining=deadline-time.monotonic()
                if remaining<=0:
                    raise QuotaError('timeout')
                sock=getattr(getattr(getattr(result,'fp',None),'raw',None),'_sock',None)
                if sock:
                    sock.settimeout(min(budget(5),remaining))
                chunk=result.read1(min(65536,(1 << 20)+1-len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            if len(data) > 1 << 20:
                raise QuotaError('schema_changed')
            return json.loads(data)
    except urllib.error.HTTPError as error:
        raise http_error(error.code, error.headers.get('Retry-After'))
    except TimeoutError:
        raise QuotaError('timeout')
    except (urllib.error.URLError, OSError):
        raise QuotaError('network_error')
    except ValueError:
        raise QuotaError('schema_changed')


def http_error(status, retry_after=None):
    code = 'http_'+str(status) if status in (401,403,429) else 'http_5xx' if status >= 500 else 'http_4xx'
    retry = None
    if status == 429:
        try:
            retry = now()+max(0,float(retry_after))
        except (TypeError, ValueError):
            from email.utils import parsedate_to_datetime
            try:
                retry = parsedate_to_datetime(retry_after).timestamp()
            except (TypeError, ValueError):
                retry = now()+300
        # Honor Retry-After, but a poisoned far-future value must not disable the pool.
        retry = min(retry, now()+86400)
    return QuotaError(code, retry_at=retry)
