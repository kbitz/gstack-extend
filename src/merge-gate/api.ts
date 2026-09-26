import { basename, extname } from 'node:path';
import { API_RULES, TEST_PATHS, regex, type ApiMatcher, type ApiName, type ApiRule } from './registry.ts';

export type ApiPair = { rule: string; name: string };

/** Lines from one side of one hunk, with the function-context text git printed after `@@ ... @@`. */
export type ScanHunk = { context: string; lines: string[] };

export function extensionOf(path: string): string {
  const base = basename(path);
  if (base.endsWith('.d.ts')) return '.d.ts';
  return extname(base);
}

export function rulesFor(path: string): ApiRule[] {
  const ext = extensionOf(path);
  return API_RULES.filter(r => r.extensions.includes(ext));
}

export function hasApiRule(path: string): boolean {
  return rulesFor(path).length > 0;
}

export function scanLines(path: string, lines: string[], context = ''): ApiPair[] {
  return scanHunks(path, [{ context, lines }]);
}

/**
 * Every rule and matcher comes from API_RULES; this function only interprets
 * the table. Rules are chosen by `rulePath` (a rename's old path for its
 * removed lines); file-keyed names always use `path`.
 */
export function scanHunks(path: string, hunks: ScanHunk[], rulePath = path): ApiPair[] {
  const rules = rulesFor(rulePath);
  const pairs: ApiPair[] = [];
  if (rules.length === 0) return pairs;
  const blocks = rules.flatMap(r => r.matchers).filter(m => m.within);
  for (const hunk of hunks) {
    const inside = new Map<ApiMatcher, boolean>();
    for (const m of blocks) inside.set(m, m.within ? regex(m.within.open).test(hunk.context) : false);
    for (const line of hunk.lines) {
      const hit = new Set<string>();
      for (const rule of rules) {
        if (rule.unless && hit.has(rule.unless)) continue;
        for (const m of rule.matchers) {
          if (m.within && (!inside.get(m) || regex(m.within.close).test(line))) continue;
          const match = regex(m.pattern).exec(line);
          if (!match) continue;
          hit.add(rule.id);
          for (const name of namesOf(m.name, match, path)) pairs.push({ rule: rule.id, name });
          break;
        }
      }
      for (const m of blocks) {
        if (!m.within) continue;
        if (inside.get(m)) {
          if (regex(m.within.close).test(line)) inside.set(m, false);
        } else if (regex(m.within.open).test(line)) inside.set(m, true);
      }
    }
  }
  return pairs;
}

function namesOf(spec: ApiName, m: RegExpExecArray, path: string): string[] {
  switch (spec.from) {
    case 'group': {
      const name = spec.groups.map(g => m[g]).find(v => v !== undefined && v !== '');
      return name ? [name] : [];
    }
    case 'file':
      return [`${spec.label}@${path}`];
    case 'export-list':
      return exportList(m[spec.group] ?? '', path);
    case 'idents':
      return (m[spec.group] ?? '').split(',').map(s => s.trim()).filter(s => regex(spec.keep).test(s));
    case 'receiver': {
      const recv = (m[spec.receiver] ?? '').replace(/\[[^\]]*\]/g, '').trim();
      const type = (recv.split(/\s+/).pop() ?? '').replace(/^\*+/, '');
      const method = m[spec.group] ?? '';
      return method === '' ? [] : [type === '' ? method : `${type}.${method}`];
    }
    case 'star': {
      const alias = m[spec.alias];
      return [alias ? alias : `*:${m[spec.source] ?? ''}`];
    }
  }
}

/** `a`, `a as b`, `type a`, `default as b`, `a as default`; a `default` export is keyed by file. */
function exportList(body: string, path: string): string[] {
  const names: string[] = [];
  for (const part of body.split(',')) {
    const bit = part.trim().replace(/^type\s+/, '');
    if (bit === '') continue;
    const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(bit);
    const name = as?.[1] ?? /^([A-Za-z_$][\w$]*)/.exec(bit)?.[1];
    if (name) names.push(name === 'default' ? `default@${path}` : name);
  }
  return names;
}

export function isTestPath(path: string): boolean {
  if (path.split('/').some(s => TEST_PATHS.segments.includes(s))) return true;
  const base = basename(path);
  return TEST_PATHS.basenames.some(spec => regex(spec).test(base));
}
