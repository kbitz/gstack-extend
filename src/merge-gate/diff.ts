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
  api_skipped?: ApiSkip;
};

/** Why a file with a public-API rule was not scanned; any of these makes API coverage partial. */
export type ApiSkip = 'too_large' | 'non_utf8_path' | 'patch_missing' | 'patch_failed';

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

export type PatchHunk = { context: string; added: string[]; removed: string[] };
export type PatchFile = { hunks: PatchHunk[] };

const HUNK_RE = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@ ?(.*)$/;

/**
 * Read `git diff -U0` output. Header lines are recognized only between hunks;
 * inside a hunk exactly the `@@ -a,b +c,d @@` line counts are consumed, so a
 * source line such as `++ b/x` cannot pose as a file header. Files are keyed by
 * their new path, or their old path when deleted.
 */
export function parseUnified(buf: Buffer): Map<string, PatchFile> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const map = new Map<string, PatchFile>();
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let hunk: PatchHunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  for (const lineBuf of splitLines(buf)) {
    const line = decoder.decode(lineBuf);
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0];
      if (c === '+' && newLeft > 0) {
        hunk.added.push(line.slice(1));
        newLeft--;
        continue;
      }
      if (c === '-' && oldLeft > 0) {
        hunk.removed.push(line.slice(1));
        oldLeft--;
        continue;
      }
      if (c === ' ' && oldLeft > 0 && newLeft > 0) {
        oldLeft--;
        newLeft--;
        continue;
      }
      if (c === '\\') continue;
      oldLeft = 0;
      newLeft = 0;
    }
    if (line.startsWith('diff --git ')) {
      oldPath = null;
      newPath = null;
      hunk = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      oldPath = headerPath(line.slice(4), 'a/');
      continue;
    }
    if (line.startsWith('+++ ')) {
      newPath = headerPath(line.slice(4), 'b/');
      continue;
    }
    const m = HUNK_RE.exec(line);
    if (m) {
      const key = newPath ?? oldPath;
      if (key === null) continue;
      const file = map.get(key) ?? { hunks: [] };
      map.set(key, file);
      hunk = { context: m[3] ?? '', added: [], removed: [] };
      file.hunks.push(hunk);
      oldLeft = m[1] === undefined ? 1 : Number(m[1]);
      newLeft = m[2] === undefined ? 1 : Number(m[2]);
    }
  }
  return map;
}

/** Git appends one tab to a `---`/`+++` name that contains a space; strip only that. */
function headerPath(rest: string, prefix: string): string | null {
  const text = unquoteGitPath(rest.endsWith('\t') ? rest.slice(0, -1) : rest);
  if (text === '/dev/null') return null;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

const NAMED_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Decode a C-quoted git path. Octal escapes are bytes, so multibyte UTF-8 decodes correctly. */
export function unquoteGitPath(s: string): string {
  if (s.length < 2 || s[0] !== '"' || !s.endsWith('"')) return s;
  const chars = Array.from(s.slice(1, -1));
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? '';
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = chars[i + 1];
    if (next === undefined) break;
    const named = NAMED_ESCAPES[next];
    if (named !== undefined) {
      bytes.push(named);
      i++;
      continue;
    }
    const oct = chars.slice(i + 1, i + 4).join('');
    if (/^[0-7]{3}$/.test(oct)) {
      bytes.push(parseInt(oct, 8));
      i += 3;
      continue;
    }
    bytes.push(...Buffer.from(next, 'utf8'));
    i++;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(bytes));
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
