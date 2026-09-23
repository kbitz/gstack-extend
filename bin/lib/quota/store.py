"""Private SQLite store and bounded cross-process locks."""
from contextlib import contextmanager
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import stat
import time

from .common import QuotaError, budget, now


def private_dir(path):
    if path.is_symlink():
        raise QuotaError('store_refused')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir():
        raise QuotaError('store_refused')
    os.chmod(path, 0o700)


def private_file(path, create=False, readonly=False):
    flags = (os.O_RDONLY if readonly else os.O_RDWR) | os.O_NOFOLLOW | os.O_NONBLOCK
    if create:
        flags |= os.O_CREAT
    try:
        fd = os.open(path, flags, 0o600)
    except FileNotFoundError:
        if not create:
            return None
        raise
    except OSError:
        raise QuotaError('store_refused')
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
        os.close(fd)
        raise QuotaError('store_refused')
    if not readonly:
        os.fchmod(fd, 0o600)
    return fd


class Store:
    def __init__(self, root, readonly=False):
        self.root, self.directory = Path(root), Path(root)/'quota'
        self.readonly = readonly
        self.path = self.directory/'quota.sqlite3'
        self.db = None
        self.key = None
        if readonly and not self.path.exists() and not self.path.is_symlink():
            return
        try:
            if readonly:
                if self.root.is_symlink() or self.directory.is_symlink():
                    raise QuotaError('store_refused')
            else:
                private_dir(self.root)
                private_dir(self.directory)
            for suffix in ('', '-wal', '-shm'):
                fd = private_file(Path(str(self.path)+suffix), create=not suffix and not readonly, readonly=readonly)
                if fd is not None:
                    os.close(fd)
            if readonly:
                self.db = sqlite3.connect(self.path.as_uri()+'?mode=ro', uri=True, timeout=budget(1))
            else:
                self.db = sqlite3.connect(self.path, timeout=budget(1))
                self.db.execute('PRAGMA journal_mode=WAL')
                self.db.execute('PRAGMA synchronous=FULL')
                self.db.execute('CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated REAL NOT NULL, PRIMARY KEY(kind,key))')
                self.db.execute('CREATE INDEX IF NOT EXISTS documents_time ON documents(kind,updated)')
                self.db.execute("CREATE INDEX IF NOT EXISTS usage_time ON documents(json_extract(value,'$.ts')) WHERE kind='usage'")
                self.db.execute("CREATE INDEX IF NOT EXISTS usage_session ON documents(json_extract(value,'$.session')) WHERE kind='usage'")
                self.db.execute("CREATE INDEX IF NOT EXISTS usage_pool ON documents(json_extract(value,'$.pool')) WHERE kind='usage'")
                self.db.execute("CREATE INDEX IF NOT EXISTS sample_pool_time ON documents(json_extract(value,'$.pool_kind'),json_extract(value,'$.pool'),json_extract(value,'$.observed_at')) WHERE kind='sample'")
                self.db.commit()
            self.db.row_factory = sqlite3.Row
            self.db.execute('PRAGMA busy_timeout='+str(max(1,int(budget(8)*1000))))
            keypath = self.directory/'identity.key'
            fd = private_file(keypath, create=not readonly, readonly=readonly)
            if fd is not None:
                try:
                    deadline=time.monotonic()+budget(1)
                    while True:
                        try:
                            fcntl.flock(fd, (fcntl.LOCK_SH if readonly else fcntl.LOCK_EX) | fcntl.LOCK_NB)
                            break
                        except BlockingIOError:
                            if time.monotonic()>=deadline:
                                raise QuotaError('timeout')
                            time.sleep(.01)
                    self.key = os.read(fd, 33)
                    if not self.key and not readonly:
                        self.key = os.urandom(32)
                        view = memoryview(self.key)
                        sent = 0
                        while sent < len(view):
                            wrote = os.write(fd, view[sent:])
                            if wrote <= 0:
                                raise QuotaError('store_error')
                            sent += wrote
                        if getattr(fcntl, 'F_FULLFSYNC', None) is not None:
                            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
                        else:
                            os.fsync(fd)
                        dirfd = os.open(self.directory, os.O_RDONLY)
                        try:
                            os.fsync(dirfd)
                        finally:
                            os.close(dirfd)
                    if len(self.key) != 32:
                        raise QuotaError('store_refused')
                finally:
                    os.close(fd)
        except (OSError, sqlite3.Error):
            if self.db:
                self.db.close()
            raise QuotaError('store_error')

    def close(self):
        if self.db:
            self.db.close()

    def digest(self, value, namespace='identity'):
        return hmac.new(self.key, (namespace+'\0'+str(value)).encode(), hashlib.sha256).hexdigest()

    def pool(self, kind, identity):
        return kind+':'+self.digest(identity, kind)[:12] if identity else 'pending'

    def get(self, kind, key, default=None):
        if not self.db:
            return default
        row = self.db.execute('SELECT value FROM documents WHERE kind=? AND key=?', (kind, str(key))).fetchone()
        return json.loads(row[0]) if row else default

    def all(self, kind):
        if not self.db:
            return []
        return [json.loads(row[0]) for row in self.db.execute('SELECT value FROM documents WHERE kind=? ORDER BY updated,key', (kind,))]

    def put(self, kind, key, value):
        if self.readonly:
            raise QuotaError('store_error')
        self.db.execute('INSERT INTO documents VALUES (?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,updated=excluded.updated',
                        (kind, str(key), json.dumps(value, separators=(',', ':'), allow_nan=False), now()))
        if kind=='sample' and value['status'] in ('ok','partial'):
            pool=value['pool']
            present={meter['meter'] for meter in value['meters']}
            if value['status']=='ok':
                for entry in self.all('meter'):
                    if entry['pool']==pool and entry['meter']['meter'] not in present and entry['observed_at']<=value['observed_at']:
                        entry['absent']=True
                        self.put('meter',entry['key'],entry)
            for meter in value['meters']:
                meter_key=json.dumps([pool,meter['meter']])
                previous=self.get('meter',meter_key)
                if previous and previous['observed_at']>value['observed_at']:
                    continue
                self.put('meter',meter_key,dict(key=meter_key,pool=pool,pool_kind=value['pool_kind'],meter=meter,
                                               observed_at=value['observed_at'],absent=False))

    def usage_between(self,start,end):
        return [json.loads(row[0]) for row in self.db.execute("SELECT value FROM documents WHERE kind='usage' AND json_extract(value,'$.ts')>=? AND json_extract(value,'$.ts')<?",(start,end))]

    def usage_for_session(self,session):
        return [json.loads(row[0]) for row in self.db.execute("SELECT value FROM documents WHERE kind='usage' AND json_extract(value,'$.session')=?",(session,))]

    def unresolved_count(self):
        return self.db.execute("SELECT count(*) FROM documents WHERE kind='usage' AND json_extract(value,'$.pool')='unresolved'").fetchone()[0]

    def get_many(self,kind,keys):
        result=[]
        keys=list(keys)
        for offset in range(0,len(keys),500):
            batch=keys[offset:offset+500]
            placeholders=','.join('?' for _ in batch)
            result.extend(json.loads(row[0]) for row in self.db.execute('SELECT value FROM documents WHERE kind=? AND key IN ('+placeholders+')',[kind]+batch))
        return result

    def latest_sample(self,kind,pool,status=None):
        query="SELECT value FROM documents WHERE kind='sample' AND json_extract(value,'$.pool_kind')=? AND json_extract(value,'$.pool')=?"
        values=[kind,pool]
        if status:
            query+=" AND json_extract(value,'$.status')=?"
            values.append(status)
        ordering="json_extract(value,'$.observed_at') DESC,rowid DESC" if status else "updated DESC,rowid DESC"
        row=self.db.execute(query+' ORDER BY '+ordering+' LIMIT 1',values).fetchone()
        return json.loads(row[0]) if row else None

    def delete(self, kind, key):
        self.db.execute('DELETE FROM documents WHERE kind=? AND key=?', (kind, str(key)))

    @contextmanager
    def transaction(self):
        try:
            self.db.execute('BEGIN IMMEDIATE')
            yield self
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    @contextmanager
    def lock(self, key, deadline=None):
        deadline = deadline or time.monotonic()+budget(8)
        path = self.directory/('lock-'+hashlib.sha256(key.encode()).hexdigest())
        fd = private_file(path, create=True)
        try:
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise QuotaError('timeout')
                    time.sleep(min(.02, max(0, deadline-time.monotonic())))
            yield
        finally:
            os.close(fd)

    def count(self, name, increment=1):
        value = self.get('counter', name, {'name': name, 'count': 0})
        value['count'] += increment
        self.put('counter', name, value)


def record_refusal(root):
    """Separate private breadcrumb because a refused DB cannot receive a count."""
    try:
        if Path(root).is_symlink():
            return
        private_dir(Path(root))
        fd = private_file(Path(root)/'quota-refusals', create=True)
        with os.fdopen(fd, 'ab') as stream:
            stream.write(b'1\n')
    except (OSError, QuotaError):
        pass
