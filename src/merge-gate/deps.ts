import { basename } from 'node:path';
import {
  DEP_GRAMMAR,
  LOCKFILES,
  UNSUPPORTED_MANIFESTS,
  UNSUPPORTED_SUFFIXES,
} from './registry.ts';

export type DepEntry = { name: string; classification: 'remote' | 'local' };

export type ManifestParse = {
  added: DepEntry[];
  removed: DepEntry[];
  unverifiable: string | null;
};

export type ManifestKind = 'package.json' | 'requirements' | 'pyproject' | 'gomod' | 'cargo' | 'gemfile' | 'unsupported' | 'lockfile' | 'other';

export function manifestKind(path: string): ManifestKind {
  const base = basename(path);
  if (LOCKFILES.includes(base)) return 'lockfile';
  if (base === 'package.json') return 'package.json';
  if (/^requirements.*\.txt$/.test(base)) return 'requirements';
  if (base === 'pyproject.toml') return 'pyproject';
  if (base === 'go.mod') return 'gomod';
  if (base === 'Cargo.toml') return 'cargo';
  if (base === 'Gemfile') return 'gemfile';
  if (UNSUPPORTED_MANIFESTS.includes(base) || UNSUPPORTED_SUFFIXES.some(s => base.endsWith(s))) {
    return 'unsupported';
  }
  return 'other';
}

export function unsupportedDetail(path: string): string {
  const base = basename(path);
  const label =
    base === 'pom.xml' ? 'Maven' :
    base === 'build.gradle' || base === 'build.gradle.kts' ? 'Gradle' :
    base === 'build.sbt' ? 'sbt' :
    base === 'composer.json' ? 'Composer' :
    base === 'Pipfile' ? 'Pipfile' :
    base === 'setup.py' || base === 'setup.cfg' ? 'setuptools' :
    base === 'environment.yml' ? 'Conda' :
    base.endsWith('.gemspec') ? 'gemspec' :
    base === 'Package.swift' ? 'Swift Package Manager' :
    base === 'Podfile' ? 'CocoaPods' :
    base === 'pubspec.yaml' ? 'Pub' :
    base === 'deno.json' ? 'Deno' :
    base === 'mix.exs' ? 'Mix' :
    base.endsWith('.csproj') || base === 'packages.config' ? '.NET' :
    base;
  return `${label} manifests are not parsed by collector v1 (documented limitation)`;
}

export function parseManifest(kind: ManifestKind, base: string | null, head: string): ManifestParse {
  if (kind === 'package.json') return parsePackageJson(base, head);
  if (kind === 'requirements') return parseRequirements(base, head);
  if (kind === 'pyproject') return parsePyproject(base, head);
  if (kind === 'gomod') return parseGoMod(base, head);
  if (kind === 'cargo') return parseCargo(base, head);
  if (kind === 'gemfile') return parseGemfile(base, head);
  return { added: [], removed: [], unverifiable: null };
}

function addedLines(base: string | null, head: string): string[] {
  if (base === null) return head.split('\n');
  const counts = new Map<string, number>();
  for (const line of base.split('\n')) counts.set(line, (counts.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of head.split('\n')) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added.push(line);
  }
  return added;
}

function diffNames(baseNames: Map<string, DepEntry>, headNames: Map<string, DepEntry>): ManifestParse {
  const added: DepEntry[] = [];
  const removed: DepEntry[] = [];
  for (const [name, entry] of headNames) {
    if (!baseNames.has(name)) added.push(entry);
  }
  for (const [name, entry] of baseNames) {
    if (!headNames.has(name)) removed.push(entry);
  }
  added.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  removed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { added, removed, unverifiable: null };
}

function parsePackageJson(base: string | null, head: string): ManifestParse {
  const headMap = readPackageJson(head);
  if (headMap === 'bad') {
    return { added: [], removed: [], unverifiable: 'package.json could not be parsed (invalid JSON)' };
  }
  const baseMap = base === null ? new Map<string, DepEntry>() : readPackageJson(base);
  if (baseMap === 'bad') {
    return { added: [], removed: [], unverifiable: 'package.json could not be parsed (invalid JSON)' };
  }
  return diffNames(baseMap, headMap);
}

function readPackageJson(text: string): Map<string, DepEntry> | 'bad' {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return 'bad';
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return 'bad';
  const obj = json as Record<string, unknown>;
  const map = new Map<string, DepEntry>();
  for (const section of DEP_GRAMMAR.npm_sections) {
    if (!(section in obj)) continue;
    const value = obj[section];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'bad';
    for (const [name, spec] of Object.entries(value as Record<string, unknown>)) {
      if (typeof spec !== 'string') return 'bad';
      const classification = DEP_GRAMMAR.npm_local_prefixes.some(p => spec.startsWith(p)) ? 'local' : 'remote';
      const prev = map.get(name);
      if (!prev || (prev.classification === 'local' && classification === 'remote')) {
        map.set(name, { name, classification });
      }
    }
  }
  return map;
}

function parseRequirements(base: string | null, head: string): ManifestParse {
  const bad = requirementViolation(addedLines(base, head));
  if (bad) return { added: [], removed: [], unverifiable: bad };
  const headMap = readRequirements(head);
  if (typeof headMap === 'string') return { added: [], removed: [], unverifiable: headMap };
  const baseMap = base === null ? new Map<string, DepEntry>() : readRequirements(base);
  if (typeof baseMap === 'string') return { added: [], removed: [], unverifiable: baseMap };
  return diffNames(baseMap, headMap);
}

function requirementViolation(lines: string[]): string | null {
  for (const raw of lines) {
    const line = stripReqComment(raw).trim();
    if (line === '') continue;
    if (/^(-r|--requirement|-c|--constraint)(\s|$)/.test(line)) {
      return 'requirements include (-r/-c) was added; included files are not parsed by collector v1 (documented limitation)';
    }
    if (classifyReq(line) === 'bad') {
      return 'requirements line is outside the collector v1 grammar (documented limitation)';
    }
  }
  return null;
}

function readRequirements(text: string): Map<string, DepEntry> | string {
  const map = new Map<string, DepEntry>();
  for (const raw of text.split('\n')) {
    const line = stripReqComment(raw).trim();
    if (line === '') continue;
    if (/^(-r|--requirement|-c|--constraint)(\s|$)/.test(line)) continue;
    const item = classifyReq(line);
    if (item === 'bad') return 'requirements line is outside the collector v1 grammar (documented limitation)';
    if (!map.has(item.name)) map.set(item.name, item);
  }
  return map;
}

function stripReqComment(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '#' && (i === 0 || line[i - 1] === ' ')) break;
    out += line[i];
  }
  return out;
}

function classifyReq(line: string): DepEntry | 'bad' {
  let body = line.trim();
  const semi = indexOutside(body, ';');
  if (semi >= 0) body = body.slice(0, semi).trim();
  if (/^(-e|--editable)(\s|$)/.test(body) || /^[a-z][a-z0-9+.-]*:\/\//i.test(body) || body.startsWith('git+')) {
    const rest = body.replace(/^(-e|--editable)\s+/, '');
    const local = !/^[a-z][a-z0-9+.-]*:\/\//i.test(rest) && !rest.startsWith('git+') && (/^(\.\.?\/|\/)/.test(rest) || rest.includes('file:'));
    return { name: line.trim(), classification: local ? 'local' : 'remote' };
  }
  if (/^(\.\.?\/|\/)/.test(body) || body.startsWith('file:')) {
    return { name: body, classification: 'local' };
  }
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(body);
  if (!m || !m[1]) return 'bad';
  const name = m[1].toLowerCase().replace(/[_.]/g, '-');
  return { name, classification: 'remote' };
}

function indexOutside(s: string, ch: string): number {
  return s.indexOf(ch);
}

function parseGemfile(base: string | null, head: string): ManifestParse {
  const bad = gemViolation(addedLines(base, head));
  if (bad) return { added: [], removed: [], unverifiable: bad };
  const headMap = readGemfile(head);
  if (typeof headMap === 'string') return { added: [], removed: [], unverifiable: headMap };
  const baseMap = base === null ? new Map<string, DepEntry>() : readGemfile(base);
  if (typeof baseMap === 'string') return { added: [], removed: [], unverifiable: baseMap };
  return diffNames(baseMap, headMap);
}

function gemViolation(lines: string[]): string | null {
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line === '') continue;
    if (/^\s*gemspec\b/.test(raw)) {
      return 'Gemfile gemspec line was added; gemspec dependencies are not parsed by collector v1 (documented limitation)';
    }
    if (!gemLineAllowed(line)) {
      return 'Gemfile line is outside the collector v1 grammar (documented limitation)';
    }
  }
  return null;
}

function gemLineAllowed(line: string): boolean {
  if (/^gem\s+['"][^'"]+['"]/.test(line)) return true;
  if (/^source\s+['"][^'"]+['"]/.test(line)) return true;
  if (/^group\b/.test(line)) return true;
  if (line === 'end' || line === 'do') return true;
  if (/^gemspec\b/.test(line)) return true;
  return false;
}

function readGemfile(text: string): Map<string, DepEntry> | string {
  const map = new Map<string, DepEntry>();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line === '' || /^gemspec\b/.test(line)) continue;
    const m = /^gem\s+['"]([^'"]+)['"]/.exec(line);
    if (!m) continue;
    const name = m[1] ?? '';
    if (!map.has(name)) map.set(name, { name, classification: 'remote' });
  }
  return map;
}

function parseGoMod(base: string | null, head: string): ManifestParse {
  const bad = goViolation(addedLines(base, head));
  if (bad) return { added: [], removed: [], unverifiable: bad };
  return diffNames(readGo(base ?? ''), readGo(head));
}

function goViolation(lines: string[]): string | null {
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;
    if (/^(replace|exclude|retract)\b/.test(line)) {
      return 'go.mod replace/exclude/retract was added and is not parsed by collector v1 (documented limitation)';
    }
  }
  return null;
}

function readGo(text: string): Map<string, DepEntry> {
  const present = new Set<string>();
  const direct = new Set<string>();
  const lines = text.split('\n');
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('require') && line.endsWith('(')) { inBlock = true; continue; }
    if (inBlock && line === ')') { inBlock = false; continue; }
    const single = /^require\s+(\S+)\s+(\S+)/.exec(line);
    const block = inBlock ? /^(\S+)\s+(\S+)/.exec(line) : null;
    const m = single ?? block;
    if (!m || !m[1]) continue;
    const name = m[1];
    present.add(name);
    if (!/\/\/\s*indirect\b/.test(line)) direct.add(name);
  }
  const map = new Map<string, DepEntry>();
  for (const name of direct) map.set(name, { name, classification: 'remote' });
  for (const name of present) {
    if (!map.has(name)) map.set(name, { name, classification: 'local' });
  }
  return map;
}

type TomlName = Map<string, DepEntry>;

function parsePyproject(base: string | null, head: string): ManifestParse {
  return parseTomlDeps(base, head, 'pyproject');
}

function parseCargo(base: string | null, head: string): ManifestParse {
  return parseTomlDeps(base, head, 'cargo');
}

function parseTomlDeps(base: string | null, head: string, kind: 'pyproject' | 'cargo'): ManifestParse {
  const bad = tomlViolation(addedLines(base, head), kind);
  if (bad) return { added: [], removed: [], unverifiable: bad };
  const headMap = readToml(head, kind);
  if (typeof headMap === 'string') return { added: [], removed: [], unverifiable: headMap };
  const baseMap = base === null ? new Map<string, DepEntry>() : readToml(base, kind);
  if (typeof baseMap === 'string') return { added: [], removed: [], unverifiable: baseMap };
  return diffNames(baseMap, headMap);
}

function tomlViolation(lines: string[], kind: 'pyproject' | 'cargo'): string | null {
  return scanToml(lines, kind);
}

function scanToml(added: string[], kind: 'pyproject' | 'cargo'): string | null {
  // `added` is the added-line list. Section headers may be unchanged, so the
  // caller passes only added lines and we treat a quoted key as a violation
  // when it shows up at all in that list under a dependency-looking key.
  for (const raw of added) {
    const line = stripTomlComment(raw).trim();
    if (line === '' || line.startsWith('[')) continue;
    if (line.startsWith('[[')) {
      return 'TOML array of tables under a dependency section is not parsed by collector v1 (documented limitation)';
    }
    if (/^['"]/.test(line) || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_]/.test(line)) {
      return 'dotted or quoted TOML keys are not parsed by collector v1 (documented limitation)';
    }
  }
  void kind;
  return null;
}

function readToml(text: string, kind: 'pyproject' | 'cargo'): TomlName | string {
  const map = new Map<string, DepEntry>();
  const lines = text.split('\n');
  let section = '';
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = stripTomlComment(raw).trim();
    i++;
    if (line === '') continue;
    if (line.startsWith('[[')) return 'TOML array of tables is not parsed by collector v1 (documented limitation)';
    if (line.startsWith('[')) {
      section = normalizeSection(line);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value === '[' || value.endsWith('[') && !value.includes(']')) {
      const collected = [value];
      while (i < lines.length && !collected.join('\n').includes(']')) {
        collected.push(lines[i] ?? '');
        i++;
      }
      value = collected.join('\n');
    }
    if (!sectionIsDeps(section, kind) && !isProjectArray(section, key, kind)) continue;
    if (kind === 'pyproject' && DEP_GRAMMAR.poetry_skip_keys.includes(key) && section.startsWith('tool.poetry')) {
      continue;
    }
    if (isProjectArray(section, key, kind) || (section === 'project.optional-dependencies' && value.includes('['))) {
      for (const name of readStringArray(value)) {
        if (!map.has(name)) map.set(name, { name, classification: 'remote' });
      }
      continue;
    }
    const headerName = depHeaderName(section, kind);
    const name = headerName ?? key;
    if (name === '' || name.startsWith('#')) continue;
    const classification = tomlLocal(value) ? 'local' : 'remote';
    const prev = map.get(name);
    if (!prev || (prev.classification === 'local' && classification === 'remote')) {
      map.set(name, { name, classification });
    }
  }
  return map;
}

function isProjectArray(section: string, key: string, kind: 'pyproject' | 'cargo'): boolean {
  if (kind !== 'pyproject') return false;
  if (section === 'project' && (key === 'dependencies' || key === 'optional-dependencies')) return true;
  return false;
}

function depHeaderName(section: string, kind: 'pyproject' | 'cargo'): string | null {
  if (kind !== 'cargo') return null;
  const m = /^(?:dependencies|dev-dependencies|build-dependencies)\.([^.]+)$/.exec(section);
  return m?.[1] ?? null;
}

function sectionIsDeps(section: string, kind: 'pyproject' | 'cargo'): boolean {
  if (kind === 'cargo') {
    if (DEP_GRAMMAR.cargo_sections.includes(section)) return true;
    if (section === 'workspace.dependencies') return true;
    if (/^target\..+\.(dependencies|dev-dependencies|build-dependencies)$/.test(section)) return true;
    if (/^(dependencies|dev-dependencies|build-dependencies)\.[^.]+$/.test(section)) return true;
    return false;
  }
  if (section === 'project' || section === 'project.optional-dependencies') return true;
  if (section === 'tool.poetry.dependencies' || section === 'tool.poetry.dev-dependencies') return true;
  if (/^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)) return true;
  return false;
}

function normalizeSection(line: string): string {
  const m = /^\[+([^[\]]+)\]+/.exec(line);
  const inner = m?.[1] ?? '';
  return inner.replace(/['"]/g, '').trim();
}

function tomlLocal(value: string): boolean {
  if (/\bpath\s*=/.test(value)) return true;
  if (/\bworkspace\s*=\s*true\b/.test(value)) return true;
  return false;
}

function readStringArray(value: string): string[] {
  const names: string[] = [];
  const re = /['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const spec = m[1] ?? '';
    const name = pep508Name(spec);
    if (name) names.push(name);
  }
  return names;
}

function pep508Name(spec: string): string | null {
  const body = spec.split(';')[0]?.trim() ?? '';
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(body);
  if (!m?.[1]) return null;
  return m[1].toLowerCase().replace(/[_.]/g, '-');
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}
