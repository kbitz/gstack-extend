import { basename } from 'node:path';
import { DEP_GRAMMAR, LOCKFILES, UNSUPPORTED_MANIFESTS, regex as re } from './registry.ts';

export type DepClass = 'remote' | 'local' | 'indirect';
export type DepEntry = { name: string; classification: DepClass };

export type ManifestParse = {
  added: DepEntry[];
  removed: DepEntry[];
  unverifiable: string | null;
};

export type ManifestKind = 'package.json' | 'requirements' | 'pyproject' | 'gomod' | 'cargo' | 'gemfile' | 'unsupported' | 'lockfile' | 'other';

/**
 * One statement of a line-oriented manifest: the lines it spans, the entries it
 * defines, and a grammar violation. A violation counts only when one of its
 * lines was added (or the manifest is new).
 */
type Stmt = { lines: number[]; entries: DepEntry[]; violation: string | null };

const LIMIT = '(documented limitation)';
const RANK: Record<DepClass, number> = { local: 1, indirect: 2, remote: 3 };

export function manifestKind(path: string): ManifestKind {
  const base = basename(path);
  if (LOCKFILES.includes(base)) return 'lockfile';
  if (base === 'package.json') return 'package.json';
  if (/^requirements.*\.txt$/.test(base)) return 'requirements';
  if (base === 'pyproject.toml') return 'pyproject';
  if (base === 'go.mod') return 'gomod';
  if (base === 'Cargo.toml') return 'cargo';
  if (base === 'Gemfile') return 'gemfile';
  if (unsupportedLabel(base) !== null) return 'unsupported';
  return 'other';
}

function unsupportedLabel(base: string): string | null {
  for (const row of UNSUPPORTED_MANIFESTS) {
    const hit = row.name.startsWith('*') ? base.endsWith(row.name.slice(1)) : base === row.name;
    if (hit) return row.label;
  }
  return null;
}

export function unsupportedDetail(path: string): string {
  const label = unsupportedLabel(basename(path)) ?? basename(path);
  return `${label} manifests are not parsed by collector v1 ${LIMIT}`;
}

export function parseManifest(kind: ManifestKind, base: string | null, head: string): ManifestParse {
  if (kind === 'package.json') return parsePackageJson(base, head);
  const read = READERS[kind];
  if (!read) return { added: [], removed: [], unverifiable: null };
  const headStmts = read(head);
  const added = addedMask(base, head);
  for (const stmt of headStmts) {
    if (stmt.violation && stmt.lines.some(n => added[n])) {
      return { added: [], removed: [], unverifiable: stmt.violation };
    }
  }
  const baseStmts = base === null ? [] : read(base);
  return diffNames(entryMap(baseStmts.flatMap(s => s.entries)), entryMap(headStmts.flatMap(s => s.entries)));
}

const READERS: Partial<Record<ManifestKind, (text: string) => Stmt[]>> = {
  requirements: readRequirements,
  gemfile: readGemfile,
  gomod: readGoMod,
  pyproject: text => readToml(text, pyprojectLoc),
  cargo: text => readToml(text, cargoLoc),
};

/** Head lines with no matching base line (multiset, whitespace-trimmed). A new manifest is all added. */
function addedMask(base: string | null, head: string): boolean[] {
  const headLines = head.split('\n');
  if (base === null) return headLines.map(() => true);
  const counts = new Map<string, number>();
  for (const line of base.split('\n')) counts.set(line.trim(), (counts.get(line.trim()) ?? 0) + 1);
  return headLines.map(line => {
    const n = counts.get(line.trim()) ?? 0;
    if (n === 0) return true;
    counts.set(line.trim(), n - 1);
    return false;
  });
}

function entryMap(entries: DepEntry[]): Map<string, DepEntry> {
  const map = new Map<string, DepEntry>();
  for (const entry of entries) {
    const prev = map.get(entry.name);
    if (!prev || RANK[entry.classification] > RANK[prev.classification]) map.set(entry.name, entry);
  }
  return map;
}

function diffNames(baseNames: Map<string, DepEntry>, headNames: Map<string, DepEntry>): ManifestParse {
  const byName = (a: DepEntry, b: DepEntry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const added = [...headNames.values()].filter(e => !baseNames.has(e.name)).sort(byName);
  const removed = [...baseNames.values()].filter(e => !headNames.has(e.name)).sort(byName);
  return { added, removed, unverifiable: null };
}

function normalizePy(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

// package.json

function parsePackageJson(base: string | null, head: string): ManifestParse {
  const headMap = readPackageJson(head);
  const baseMap = base === null ? new Map<string, DepEntry>() : readPackageJson(base);
  if (headMap === null || baseMap === null) {
    return { added: [], removed: [], unverifiable: 'package.json could not be parsed (invalid JSON or a non-string dependency spec)' };
  }
  return diffNames(baseMap, headMap);
}

function readPackageJson(text: string): Map<string, DepEntry> | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  const entries: DepEntry[] = [];
  for (const section of DEP_GRAMMAR.npm_sections) {
    if (!(section in obj)) continue;
    const value = obj[section];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const [name, spec] of Object.entries(value as Record<string, unknown>)) {
      if (typeof spec !== 'string') return null;
      const local = DEP_GRAMMAR.npm_local_prefixes.some(p => spec.startsWith(p));
      entries.push({ name, classification: local ? 'local' : 'remote' });
    }
  }
  return entryMap(entries);
}

// requirements*.txt

function readRequirements(text: string): Stmt[] {
  const out: Stmt[] = [];
  const phys = text.split('\n');
  let buf = '';
  let lines: number[] = [];
  for (let i = 0; i < phys.length; i++) {
    const line = (phys[i] ?? '').replace(/\r$/, '');
    lines.push(i);
    if (line.endsWith('\\') && !/^\s*#/.test(line)) {
      buf += `${line.slice(0, -1)} `;
      continue;
    }
    out.push(requirementStmt(buf + line, lines));
    buf = '';
    lines = [];
  }
  if (lines.length > 0) out.push(requirementStmt(buf, lines));
  return out;
}

function requirementStmt(raw: string, lines: number[]): Stmt {
  const g = DEP_GRAMMAR.requirements;
  const ok = (entries: DepEntry[]): Stmt => ({ lines, entries, violation: null });
  const bad = (why: string): Stmt => ({ lines, entries: [], violation: why });
  const text = raw.replace(re(g.comment), '').trim();
  if (text === '') return ok([]);
  const option = re(g.option).exec(text);
  if (option) {
    const flag = option[1] ?? '';
    const value = (option[2] ?? '').trim();
    if (g.include_options.includes(flag)) {
      return bad(`requirements include (${flag}) is not parsed by collector v1 ${LIMIT}`);
    }
    if (g.editable_options.includes(flag)) {
      return ok([{ name: text, classification: re(g.local).test(value) ? 'local' : 'remote' }]);
    }
    if (g.ignored_options.includes(flag)) return ok([]);
    return bad(`requirements option ${flag} is outside the collector v1 grammar ${LIMIT}`);
  }
  const noOpts = text.replace(re(g.trailing_option), '');
  const semi = noOpts.indexOf(';');
  const body = (semi >= 0 ? noOpts.slice(0, semi) : noOpts).trim();
  if (re(g.local).test(body)) return ok([{ name: body, classification: 'local' }]);
  if (re(g.url).test(body)) return ok([{ name: body, classification: 'remote' }]);
  const m = re(g.requirement).exec(body);
  if (!m?.[1]) return bad(`requirements line is outside the collector v1 grammar ${LIMIT}`);
  const direct = (m[2] ?? '').trim();
  return ok([{ name: normalizePy(m[1]), classification: re(g.local).test(direct) ? 'local' : 'remote' }]);
}

// Gemfile

function readGemfile(text: string): Stmt[] {
  const g = DEP_GRAMMAR.gemfile;
  const out: Stmt[] = [];
  const phys = text.split('\n');
  let buf = '';
  let lines: number[] = [];
  for (let i = 0; i < phys.length; i++) {
    const line = (phys[i] ?? '').replace(/\r$/, '').replace(re(g.comment), '').trim();
    lines.push(i);
    buf = buf === '' ? line : `${buf} ${line}`;
    if (/[,\\]$/.test(line)) continue;
    out.push(gemStmt(buf, lines));
    buf = '';
    lines = [];
  }
  if (lines.length > 0) out.push(gemStmt(buf, lines));
  return out;
}

function gemStmt(text: string, lines: number[]): Stmt {
  const g = DEP_GRAMMAR.gemfile;
  if (text === '') return { lines, entries: [], violation: null };
  const gem = re(g.gem).exec(text);
  if (gem?.[1]) {
    return { lines, entries: [{ name: gem[1], classification: re(g.local_option).test(text) ? 'local' : 'remote' }], violation: null };
  }
  if (re(g.gemspec).test(text)) {
    return { lines, entries: [], violation: `Gemfile gemspec line is not parsed by collector v1 ${LIMIT}` };
  }
  if (g.allowed.some(spec => re(spec).test(text))) return { lines, entries: [], violation: null };
  return { lines, entries: [], violation: `Gemfile line is outside the collector v1 grammar ${LIMIT}` };
}

// go.mod

function readGoMod(text: string): Stmt[] {
  const g = DEP_GRAMMAR.gomod;
  const out: Stmt[] = [];
  const phys = text.split('\n');
  let block: string | null = null;
  for (let i = 0; i < phys.length; i++) {
    const raw = (phys[i] ?? '').replace(/\r$/, '');
    const indirect = re(g.indirect).test(raw);
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line === '') continue;
    if (block !== null) {
      if (line === ')') {
        block = null;
        continue;
      }
      out.push(goStmt(block, line, indirect, [i]));
      continue;
    }
    const m = /^([A-Za-z]+)\s*(.*)$/.exec(line);
    if (!m?.[1]) {
      out.push({ lines: [i], entries: [], violation: `go.mod line is outside the collector v1 grammar ${LIMIT}` });
      continue;
    }
    const directive = m[1];
    const rest = (m[2] ?? '').trim();
    if (rest === '(') {
      block = directive;
      out.push({ lines: [i], entries: [], violation: goDirectiveViolation(directive) });
      continue;
    }
    out.push(goStmt(directive, rest, indirect, [i]));
  }
  return out;
}

function goDirectiveViolation(directive: string): string | null {
  const g = DEP_GRAMMAR.gomod;
  if (directive === g.require || g.ignored_directives.includes(directive)) return null;
  if (g.unsupported_directives.includes(directive)) {
    return `go.mod ${directive} is not parsed by collector v1 ${LIMIT}`;
  }
  return `go.mod directive ${directive} is outside the collector v1 grammar ${LIMIT}`;
}

function goStmt(directive: string, rest: string, indirect: boolean, lines: number[]): Stmt {
  if (directive !== DEP_GRAMMAR.gomod.require) {
    return { lines, entries: [], violation: goDirectiveViolation(directive) };
  }
  const m = /^"?([^\s"]+)"?\s+(\S+)$/.exec(rest);
  if (!m?.[1]) return { lines, entries: [], violation: `go.mod require line is outside the collector v1 grammar ${LIMIT}` };
  return { lines, entries: [{ name: m[1], classification: indirect ? 'indirect' : 'remote' }], violation: null };
}

// TOML (pyproject.toml, Cargo.toml)

type TomlStmt =
  | { kind: 'table'; path: string[]; array: boolean; lines: number[] }
  | { kind: 'kv'; table: string[]; inArray: boolean; key: string[]; value: string; lines: number[] }
  | { kind: 'bad'; lines: number[] };

/**
 * Where a fully qualified TOML key sits in the dependency grammar:
 * `table` is an inline table of name to spec, `dep` names one dependency
 * (`attrs` are the keys below it), `pep508` is an array of PEP 508 strings,
 * and `pep508-groups` is an inline table of such arrays.
 */
type DepLoc =
  | { kind: 'none' }
  | { kind: 'unsupported' }
  | { kind: 'table' }
  | { kind: 'dep'; name: string; def: string; attrs: string[] }
  | { kind: 'pep508' }
  | { kind: 'pep508-groups' };

function startsWithPath(full: string[], prefix: readonly string[]): boolean {
  return prefix.every((seg, i) => full[i] === seg);
}

function depAt(full: string[], idx: number, normalize: (s: string) => string): DepLoc {
  if (full.length === idx) return { kind: 'table' };
  const raw = full[idx] ?? '';
  return { kind: 'dep', name: normalize(raw), def: full.slice(0, idx + 1).join('\0'), attrs: full.slice(idx + 1) };
}

function cargoLoc(full: string[]): DepLoc {
  const t = DEP_GRAMMAR.cargo.dep_tables;
  if (t.includes(full[0] ?? '')) return depAt(full, 1, s => s);
  if (full[0] === 'workspace' && full[1] === 'dependencies') return depAt(full, 2, s => s);
  if (full[0] === 'target' && full.length >= 3 && t.includes(full[2] ?? '')) return depAt(full, 3, s => s);
  return { kind: 'none' };
}

function pyprojectLoc(full: string[]): DepLoc {
  const p = DEP_GRAMMAR.pyproject;
  if (full.length === 2 && startsWithPath(full, p.project_dependencies)) return { kind: 'pep508' };
  if (startsWithPath(full, p.project_optional)) {
    if (full.length === 2) return { kind: 'pep508-groups' };
    if (full.length === 3) return { kind: 'pep508' };
    return { kind: 'unsupported' };
  }
  let idx = -1;
  for (const table of p.poetry_tables) {
    if (startsWithPath(full, table)) idx = table.length;
  }
  if (idx < 0 && full.length >= 5 && startsWithPath(full, p.poetry_group_prefix) && full[4] === p.poetry_group_suffix) idx = 5;
  if (idx < 0) return { kind: 'none' };
  if (full.length > idx && p.poetry_skip_keys.includes(full[idx] ?? '')) return { kind: 'none' };
  return depAt(full, idx, normalizePy);
}

function readToml(text: string, locate: (full: string[]) => DepLoc): Stmt[] {
  const out: Stmt[] = [];
  const defs = new Map<string, { name: string; local: boolean; lines: number[] }>();
  const define = (loc: { name: string; def: string }, local: boolean, lines: number[]) => {
    const prev = defs.get(loc.def);
    if (prev) {
      prev.local = prev.local || local;
      prev.lines.push(...lines);
    } else defs.set(loc.def, { name: loc.name, local, lines: [...lines] });
  };
  const bad = (lines: number[], why: string) => out.push({ lines, entries: [], violation: `${why} ${LIMIT}` });
  const ok = (lines: number[], entries: DepEntry[]) => out.push({ lines, entries, violation: null });

  for (const st of tomlStatements(text)) {
    if (st.kind === 'bad') {
      bad(st.lines, 'TOML line could not be parsed by collector v1');
      continue;
    }
    if (st.kind === 'table') {
      const loc = locate(st.path);
      if (loc.kind === 'none') continue;
      if (st.array || loc.kind === 'unsupported') {
        bad(st.lines, 'TOML array of tables under a dependency table is not parsed by collector v1');
        continue;
      }
      if (loc.kind === 'dep') define(loc, false, st.lines);
      else ok(st.lines, []);
      continue;
    }
    const loc = locate([...st.table, ...st.key]);
    if (loc.kind === 'none') continue;
    if (st.inArray || loc.kind === 'unsupported') {
      bad(st.lines, 'TOML dependency key under an array of tables is not parsed by collector v1');
      continue;
    }
    if (loc.kind === 'pep508') {
      const entries = pep508Array(st.value);
      if (entries === null) bad(st.lines, 'pyproject dependency array is outside the collector v1 grammar');
      else ok(st.lines, entries);
      continue;
    }
    if (loc.kind === 'pep508-groups') {
      const groups = inlineEntries(st.value);
      const entries = groups?.map(g => pep508Array(g.value));
      if (!entries || entries.some(e => e === null)) bad(st.lines, 'pyproject optional-dependencies is outside the collector v1 grammar');
      else ok(st.lines, entries.flatMap(e => e ?? []));
      continue;
    }
    if (loc.kind === 'table') {
      const specs = inlineEntries(st.value);
      if (!specs) {
        bad(st.lines, 'TOML dependency table value is outside the collector v1 grammar');
        continue;
      }
      const entries: DepEntry[] = [];
      let invalid = false;
      for (const spec of specs) {
        const inner = locate([...st.table, ...st.key, ...spec.key]);
        if (inner.kind === 'none') continue;
        if (inner.kind !== 'dep') {
          invalid = true;
          continue;
        }
        const cls = inner.attrs.length === 0 ? classifySpec(spec.value) : (isLocalAttr(inner.attrs, spec.value) ? 'local' : 'remote');
        if (cls === null) invalid = true;
        else entries.push({ name: inner.name, classification: cls });
      }
      if (invalid) bad(st.lines, 'TOML dependency table value is outside the collector v1 grammar');
      else ok(st.lines, entries);
      continue;
    }
    if (loc.attrs.length === 0) {
      const cls = classifySpec(st.value);
      if (cls === null) {
        out.push({
          lines: st.lines,
          entries: [{ name: loc.name, classification: 'remote' }],
          violation: `TOML dependency spec is outside the collector v1 grammar ${LIMIT}`,
        });
      } else ok(st.lines, [{ name: loc.name, classification: cls }]);
      continue;
    }
    define(loc, isLocalAttr(loc.attrs, st.value), st.lines);
  }
  for (const def of defs.values()) {
    ok(def.lines, [{ name: def.name, classification: def.local ? 'local' : 'remote' }]);
  }
  return out;
}

function isLocalAttr(attrs: string[], value: string): boolean {
  const key = attrs[0] ?? '';
  if (DEP_GRAMMAR.toml_local_attrs.includes(key)) return true;
  return key === DEP_GRAMMAR.toml_workspace_attr && value.trim() === 'true';
}

/** A dependency spec: a version string, an inline table, or (Poetry) an array of inline tables. */
function classifySpec(value: string): 'remote' | 'local' | null {
  if (tomlString(value) !== null) return 'remote';
  const table = inlineEntries(value);
  if (table) return table.some(e => isLocalAttr(e.key, e.value)) ? 'local' : 'remote';
  const items = tomlArray(value);
  if (!items) return null;
  const tables = items.map(inlineEntries);
  if (tables.length === 0 || tables.some(t => t === null)) return null;
  return tables.some(t => t?.some(e => isLocalAttr(e.key, e.value))) ? 'local' : 'remote';
}

function pep508Array(value: string): DepEntry[] | null {
  const items = tomlArray(value);
  if (!items) return null;
  const out: DepEntry[] = [];
  for (const item of items) {
    const spec = tomlString(item);
    if (spec === null) return null;
    const m = re(DEP_GRAMMAR.pyproject.pep508).exec(spec.split(';')[0]?.trim() ?? '');
    if (!m?.[1]) return null;
    const local = re(DEP_GRAMMAR.requirements.local).test((m[2] ?? '').trim());
    out.push({ name: normalizePy(m[1]), classification: local ? 'local' : 'remote' });
  }
  return out;
}

function tomlStatements(text: string): TomlStmt[] {
  const lines = text.split('\n');
  const out: TomlStmt[] = [];
  let table: string[] = [];
  let inArray = false;
  let i = 0;
  while (i < lines.length) {
    const start = i;
    const raw = (lines[i] ?? '').replace(/\r$/, '');
    i++;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      const header = tomlHeader(trimmed);
      if (!header) {
        out.push({ kind: 'bad', lines: [start] });
        continue;
      }
      table = header.path;
      inArray = header.array;
      out.push({ kind: 'table', path: header.path, array: header.array, lines: [start] });
      continue;
    }
    const key = readTomlKey(raw, 0);
    const eq = key ? skipBlank(raw, key.end) : -1;
    if (!key || raw[eq] !== '=') {
      out.push({ kind: 'bad', lines: [start] });
      continue;
    }
    const scan: TomlScan = { depth: 0, str: '', clean: '', malformed: false };
    feedToml(scan, raw.slice(eq + 1));
    const used = [start];
    while ((scan.depth > 0 || scan.str.length === 3) && !scan.malformed && i < lines.length) {
      feedToml(scan, `\n${(lines[i] ?? '').replace(/\r$/, '')}`);
      used.push(i);
      i++;
    }
    if (scan.depth !== 0 || scan.str !== '' || scan.malformed) {
      out.push({ kind: 'bad', lines: used });
      continue;
    }
    out.push({ kind: 'kv', table, inArray, key: key.parts, value: scan.clean.trim(), lines: used });
  }
  return out;
}

function tomlHeader(line: string): { path: string[]; array: boolean } | null {
  const array = line.startsWith('[[');
  const key = readTomlKey(line, array ? 2 : 1);
  if (!key) return null;
  const close = array ? ']]' : ']';
  const at = skipBlank(line, key.end);
  if (!line.startsWith(close, at)) return null;
  const rest = line.slice(at + close.length).trim();
  if (rest !== '' && !rest.startsWith('#')) return null;
  return { path: key.parts, array };
}

function skipBlank(s: string, pos: number): number {
  let i = pos;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  return i;
}

/** A dotted key of bare, "basic", or 'literal' parts starting at `pos`. */
function readTomlKey(s: string, pos: number): { parts: string[]; end: number } | null {
  const parts: string[] = [];
  let i = skipBlank(s, pos);
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      let part = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\') {
          part += s[j + 1] ?? '';
          j += 2;
          continue;
        }
        part += s[j];
        j++;
      }
      if (j >= s.length) return null;
      parts.push(part);
      i = j + 1;
    } else if (s[i] === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
      parts.push(s.slice(i + 1, j));
      i = j + 1;
    } else {
      const m = re(DEP_GRAMMAR.toml_bare_key).exec(s.slice(i));
      if (!m) return null;
      parts.push(m[0]);
      i += m[0].length;
    }
    i = skipBlank(s, i);
    if (s[i] !== '.') return { parts, end: i };
    i = skipBlank(s, i + 1);
  }
}

type TomlScan = { depth: number; str: '' | '"' | "'" | '"""' | "'''"; clean: string; malformed: boolean };

/** Advance a value scan: strings, bracket depth, and comments (dropped from `clean`). */
function feedToml(scan: TomlScan, chunk: string): void {
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i] ?? '';
    if (scan.str === '"""' || scan.str === "'''") {
      if (chunk.startsWith(scan.str, i)) {
        scan.clean += scan.str;
        i += 3;
        scan.str = '';
        continue;
      }
      const step = scan.str === '"""' && ch === '\\' ? 2 : 1;
      scan.clean += chunk.slice(i, i + step);
      i += step;
      continue;
    }
    if (scan.str === '"' || scan.str === "'") {
      if (ch === '\n') {
        scan.malformed = true;
        return;
      }
      const step = scan.str === '"' && ch === '\\' ? 2 : 1;
      if (ch === scan.str) scan.str = '';
      scan.clean += chunk.slice(i, i + step);
      i += step;
      continue;
    }
    if (ch === '#') {
      const nl = chunk.indexOf('\n', i);
      i = nl < 0 ? chunk.length : nl;
      continue;
    }
    if (chunk.startsWith('"""', i) || chunk.startsWith("'''", i)) {
      scan.str = chunk.slice(i, i + 3) as '"""' | "'''";
      scan.clean += scan.str;
      i += 3;
      continue;
    }
    if (ch === '"' || ch === "'") scan.str = ch;
    else if (ch === '[' || ch === '{') scan.depth++;
    else if (ch === ']' || ch === '}') {
      scan.depth--;
      if (scan.depth < 0) scan.malformed = true;
    }
    scan.clean += ch;
    i++;
  }
}

/** Split at top-level commas, outside strings and nested brackets. */
function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let str = '';
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (str !== '') {
      if ((str === '"' || str === '"""') && ch === '\\') {
        i++;
        continue;
      }
      if (body.startsWith(str, i)) {
        i += str.length - 1;
        str = '';
      }
      continue;
    }
    if (body.startsWith('"""', i) || body.startsWith("'''", i)) {
      str = body.slice(i, i + 3);
      i += 2;
    } else if (ch === '"' || ch === "'") str = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map(p => p.trim()).filter(p => p !== '');
}

function tomlString(value: string): string | null {
  const t = value.trim();
  if (t.length >= 2 && t[0] === '"' && t.endsWith('"') && !t.startsWith('"""')) {
    return t.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (t.length >= 2 && t[0] === "'" && t.endsWith("'") && !t.startsWith("'''")) return t.slice(1, -1);
  return null;
}

function tomlArray(value: string): string[] | null {
  const t = value.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  return splitTop(t.slice(1, -1));
}

function inlineEntries(value: string): { key: string[]; value: string }[] | null {
  const t = value.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  const out: { key: string[]; value: string }[] = [];
  for (const part of splitTop(t.slice(1, -1))) {
    const key = readTomlKey(part, 0);
    const eq = key ? skipBlank(part, key.end) : -1;
    if (!key || part[eq] !== '=') return null;
    out.push({ key: key.parts, value: part.slice(eq + 1).trim() });
  }
  return out;
}
