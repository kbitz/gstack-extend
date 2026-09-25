import { basename, extname } from 'node:path';
import { API_RULES } from './registry.ts';

export type ApiPair = { rule: string; name: string };

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs']);

export function scanLines(path: string, lines: string[], side: 'added' | 'removed'): ApiPair[] {
  const ext = extensionOf(path);
  const pairs: ApiPair[] = [];
  for (const line of lines) {
    pairs.push(...matchLine(path, ext, line));
  }
  void side;
  return pairs;
}

export function extensionOf(path: string): string {
  const base = basename(path);
  if (base.endsWith('.d.ts')) return '.d.ts';
  return extname(base);
}

function matchLine(path: string, ext: string, line: string): ApiPair[] {
  const out: ApiPair[] = [];
  if (TS_EXTS.has(ext)) {
    const decl = apply('ts-decl', line);
    if (decl) out.push({ rule: 'ts-decl', name: decl });
    else if (apply('ts-default', line)) out.push({ rule: 'ts-default', name: `default@${path}` });
    const list = listNames(line);
    if (list) {
      if (list.length === 0 && /^\s*export\s*(type\s*)?\{/.test(line) && !line.includes('}')) {
        out.push({ rule: 'ts-list-open', name: `{multi-line}@${path}` });
      } else {
        for (const name of list) out.push({ rule: 'ts-list', name });
      }
    } else if (/^export\s*(type\s*)?\{/.test(line) && !line.includes('}')) {
      out.push({ rule: 'ts-list-open', name: `{multi-line}@${path}` });
    }
    const star = starName(line);
    if (star) out.push({ rule: 'ts-star', name: star });
  }
  if (ext === '.js' || ext === '.cjs') {
    if (/^module\.exports\s*=/.test(line)) out.push({ rule: 'js-cjs', name: `module.exports@${path}` });
    const m = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (m?.[1]) out.push({ rule: 'js-cjs', name: m[1] });
  }
  if (ext === '.py') {
    if (/^\s/.test(line)) return out;
    const def = /^(?:async\s+)?def\s+([A-Za-z]\w*)/.exec(line);
    const cls = /^class\s+([A-Za-z]\w*)/.exec(line);
    const name = def?.[1] ?? cls?.[1];
    if (name && !name.startsWith('_')) out.push({ rule: 'py-def', name });
  }
  if (ext === '.go') {
    const method = /^func\s+\([^)]*?(\w+)(?:\[[^\]]*\])?\)\s*([A-Z]\w*)/.exec(line);
    if (method?.[1] && method[2]) out.push({ rule: 'go-exported', name: `${method[1]}.${method[2]}` });
    else {
      const fn = /^func\s+([A-Z]\w*)/.exec(line);
      const ty = /^type\s+([A-Z]\w*)/.exec(line);
      const vc = /^(?:var|const)\s+([A-Z]\w*)/.exec(line);
      const name = fn?.[1] ?? ty?.[1] ?? vc?.[1];
      if (name) out.push({ rule: 'go-exported', name });
    }
  }
  if (ext === '.rs') {
    if (/^\s*pub\s*\(/.test(line)) return out;
    const m = /^\s*pub\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|static|mod|union)\s+([A-Za-z_]\w*)/.exec(line);
    if (m?.[1]) out.push({ rule: 'rust-pub', name: m[1] });
  }
  return out;
}

function apply(id: string, line: string): string | null {
  const rule = API_RULES.find(r => r.id === id);
  if (!rule) return null;
  const m = new RegExp(rule.pattern.source, rule.pattern.flags).exec(line);
  if (!m) return null;
  if (rule.group === 0) return m[0] ?? '';
  return m[rule.group] ?? null;
}

function listNames(line: string): string[] | null {
  const m = /^export\s*(?:type\s*)?\{([^}]*)\}/.exec(line);
  if (!m) return null;
  const body = m[1] ?? '';
  if (body.trim() === '') return [];
  const names: string[] = [];
  for (const part of body.split(',')) {
    const bit = part.trim();
    if (bit === '') continue;
    const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(bit);
    if (as?.[1]) names.push(as[1]);
    else {
      const id = /^([A-Za-z_$][\w$]*)/.exec(bit);
      if (id?.[1]) names.push(id[1]);
    }
  }
  return names;
}

function starName(line: string): string | null {
  const m = /^export\s*\*\s*(?:as\s+(\w+)\s+)?from\s+['"]([^'"]+)/.exec(line);
  if (!m) return null;
  if (m[1]) return m[1];
  return `*:${m[2] ?? ''}`;
}

export function binExecPair(path: string, status: string, oldMode: string, newMode: string): ApiPair | null {
  const segments = path.split('/');
  if (!segments.includes('bin')) return null;
  const mode = (m: string) => m.slice(-6);
  if (status === 'A' && mode(newMode) === '100755') return { rule: 'bin-exec', name: path };
  if (mode(oldMode) === '100644' && mode(newMode) === '100755') return { rule: 'bin-exec', name: path };
  return null;
}

export function isTestPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.some(s => s === 'test' || s === 'tests' || s === '__tests__' || s === 'spec')) return true;
  const base = basename(path);
  if (/\.test\.[^.]+$/.test(base) || /\.spec\.[^.]+$/.test(base)) return true;
  if (base.endsWith('_test.go')) return true;
  if (base.startsWith('test_') && base.endsWith('.py')) return true;
  if (base.endsWith('_test.py')) return true;
  if (base === 'conftest.py') return true;
  return false;
}
