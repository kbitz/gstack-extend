export type FileFact = {
  path: string;
  path_b64?: string;
  old_path: string | null;
  old_path_b64?: string;
  old_mode: string;
  new_mode: string;
  old_oid: string;
  new_oid: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  submodule: boolean;
  api_skipped?: 'too_large';
};

const STATUS_OK = new Set(['A', 'M', 'D', 'R', 'T']);

export function decodePath(buf: Buffer): { path: string; path_b64?: string } {
  try {
    const path = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { path };
  } catch {
    const path = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    return { path, path_b64: buf.toString('base64') };
  }
}

export function parseRawNumstat(buf: Buffer): { files: FileFact[]; badStatus: string[] } {
  const fields = splitNul(buf);
  const raw: {
    oldMode: string;
    newMode: string;
    oldOid: string;
    newOid: string;
    status: string;
    path: Buffer;
    oldPath: Buffer | null;
  }[] = [];
  let i = 0;
  while (i < fields.length) {
    const header = fields[i];
    if (!header || header[0] !== 0x3a) break;
    const text = header.toString('utf8');
    const parts = text.slice(1).split(' ');
    const oldMode = parts[0] ?? '';
    const newMode = parts[1] ?? '';
    const oldOid = parts[2] ?? '';
    const newOid = parts[3] ?? '';
    const statusTok = parts[parts.length - 1] ?? '';
    const status = statusTok[0] ?? '';
    i++;
    const path = fields[i];
    if (!path) break;
    i++;
    let oldPath: Buffer | null = null;
    let newPath = path;
    if (status === 'R' || status === 'C') {
      const dest = fields[i];
      if (!dest) break;
      i++;
      oldPath = path;
      newPath = dest;
    }
    raw.push({ oldMode, newMode, oldOid, newOid, status, path: newPath, oldPath });
  }
  const stats: { add: string; del: string; path: Buffer; oldPath: Buffer | null }[] = [];
  while (i < fields.length) {
    const field = fields[i];
    if (!field) break;
    i++;
    const parsed = parseNumstatField(field);
    if (!parsed) continue;
    if (parsed.rename) {
      const oldPath = fields[i];
      const newPath = fields[i + 1];
      i += 2;
      if (!oldPath || !newPath) break;
      stats.push({ add: parsed.add, del: parsed.del, path: newPath, oldPath });
    } else {
      stats.push({ add: parsed.add, del: parsed.del, path: parsed.path ?? Buffer.alloc(0), oldPath: null });
    }
  }
  const files: FileFact[] = [];
  const badStatus: string[] = [];
  for (let n = 0; n < raw.length; n++) {
    const rec = raw[n];
    if (!rec) continue;
    const stat = stats[n];
    if (!STATUS_OK.has(rec.status)) {
      const decoded = decodePath(rec.path);
      badStatus.push(decoded.path);
      continue;
    }
    const decoded = decodePath(rec.path);
    const oldDecoded = rec.oldPath ? decodePath(rec.oldPath) : null;
    const binary = stat ? stat.add === '-' || stat.del === '-' : false;
    const additions = binary || !stat ? 0 : Number(stat.add);
    const deletions = binary || !stat ? 0 : Number(stat.del);
    const submodule = rec.oldMode === '160000' || rec.newMode === '160000';
    const fact: FileFact = {
      path: decoded.path,
      old_path: oldDecoded?.path ?? null,
      old_mode: rec.oldMode,
      new_mode: rec.newMode,
      old_oid: rec.oldOid,
      new_oid: rec.newOid,
      status: rec.status,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
      binary,
      submodule,
    };
    if (decoded.path_b64) fact.path_b64 = decoded.path_b64;
    if (oldDecoded?.path_b64) fact.old_path_b64 = oldDecoded.path_b64;
    files.push(fact);
  }
  return { files, badStatus };
}

function parseNumstatField(field: Buffer): { add: string; del: string; path: Buffer | null; rename: boolean } | null {
  const tab1 = field.indexOf(0x09);
  if (tab1 < 0) return null;
  const tab2 = field.indexOf(0x09, tab1 + 1);
  if (tab2 < 0) return null;
  const add = field.subarray(0, tab1).toString('utf8');
  const del = field.subarray(tab1 + 1, tab2).toString('utf8');
  const rest = field.subarray(tab2 + 1);
  if (rest.length === 0) return { add, del, path: null, rename: true };
  return { add, del, path: rest, rename: false };
}

function splitNul(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      if (i > start) out.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < buf.length) out.push(buf.subarray(start));
  return out;
}

export type PatchFile = { added: string[]; removed: string[] };

export function parseUnified(buf: Buffer): Map<string, PatchFile> {
  const lines = splitLines(buf);
  const map = new Map<string, PatchFile>();
  let current: PatchFile | null = null;
  let key = '';
  for (const lineBuf of lines) {
    const line = new TextDecoder('utf-8', { fatal: false }).decode(lineBuf);
    if (line.startsWith('diff --git ')) {
      current = null;
      key = '';
      continue;
    }
    if (line.startsWith('rename to ')) {
      key = unquoteGitPath(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = pathFromPrefix(line.slice(4), 'b/');
      if (path !== null) {
        key = path;
        current = map.get(key) ?? { added: [], removed: [] };
        map.set(key, current);
      }
      continue;
    }
    if (line.startsWith('--- ')) {
      const path = pathFromPrefix(line.slice(4), 'a/');
      if (path !== null && key === '') key = path;
      continue;
    }
    if (!current && key !== '') {
      current = map.get(key) ?? { added: [], removed: [] };
      map.set(key, current);
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.added.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('---')) current.removed.push(line.slice(1));
  }
  return map;
}

function pathFromPrefix(rest: string, prefix: string): string | null {
  const text = unquoteGitPath(rest.trim());
  if (text === '/dev/null') return null;
  if (text.startsWith(prefix)) return text.slice(prefix.length);
  return text;
}

export function unquoteGitPath(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length < 2 || trimmed[0] !== '"') return trimmed;
  let body = trimmed;
  if (body.endsWith('"')) body = body.slice(1, -1);
  else body = body.slice(1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      out += ch ?? '';
      continue;
    }
    const n = body[i + 1];
    if (n === undefined) break;
    if (n === 'n') { out += '\n'; i++; continue; }
    if (n === 't') { out += '\t'; i++; continue; }
    if (n === '\\' || n === '"') { out += n; i++; continue; }
    if (/[0-7]/.test(n)) {
      const oct = body.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(oct)) {
        out += String.fromCharCode(parseInt(oct, 8));
        i += 3;
        continue;
      }
    }
    out += n;
    i++;
  }
  return out;
}

function splitLines(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      let end = i;
      if (end > start && buf[end - 1] === 0x0d) end--;
      out.push(buf.subarray(start, end));
      start = i + 1;
    }
  }
  if (start < buf.length) out.push(buf.subarray(start));
  return out;
}

export type BlobBody = { oid: string; missing: boolean; size: number; body: Buffer | null };

export function parseCatFileBatch(buf: Buffer): BlobBody[] {
  const out: BlobBody[] = [];
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i);
    if (nl < 0) break;
    const header = buf.subarray(i, nl).toString('utf8');
    i = nl + 1;
    const missing = / missing$/.test(header);
    if (missing) {
      const oid = header.split(' ')[0] ?? '';
      out.push({ oid, missing: true, size: 0, body: null });
      continue;
    }
    const parts = header.split(' ');
    const oid = parts[0] ?? '';
    const size = Number(parts[2] ?? '0');
    const body = buf.subarray(i, i + size);
    out.push({ oid, missing: false, size, body });
    i += size;
    if (buf[i] === 0x0a) i++;
  }
  return out;
}

export function parseBatchCheck(buf: Buffer): Map<string, number | null> {
  const map = new Map<string, number | null>();
  const text = buf.toString('utf8');
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const parts = line.split(' ');
    const oid = parts[0] ?? '';
    if (line.endsWith(' missing')) map.set(oid, null);
    else map.set(oid, Number(parts[2] ?? 'NaN'));
  }
  return map;
}
