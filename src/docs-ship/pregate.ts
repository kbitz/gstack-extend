/**
 * pregate.ts — parse, bind and filter `gstack-pregate --stage tests --explain --json`
 * output without spawning pregate.
 *
 * Upstream behavior matches installed gstack 1.97.0.0:
 * - JSON envelope and refused payload: `bin/gstack-pregate:191,215`, `lib/pregate/index.ts:106-109`
 * - Policy labels: `lib/pregate/config.ts:324,327,334,356,365`
 * - Nonexecution (`inputs.command` and `REPO_COMMANDS_NOT_ALLOWED`): `lib/pregate/checks/lanes.ts:553,568,624`
 * - Thrown/incomplete checks: `lib/pregate/context.ts:276-290`
 * - Provenance lines and selection hash: `lib/pregate/import-graph.ts:541,545`,
 *   `lib/pregate/lane-selection.ts:225-228,238,288,295`
 * - No-lane lines: `lib/pregate/checks/lanes.ts:434-439`
 */
import { createHash } from 'node:crypto';
import { PREGATE_POLICY } from './config.ts';
import { Refusal, type Git } from './git.ts';
import type { Selected } from './pinning.ts';

export const PREGATE_CODES = [
  'PREGATE_INVALID',
  'PREGATE_REFUSED',
  'PREGATE_BINDING',
  'PREGATE_EXECUTED',
  'PREGATE_INCOMPLETE',
  'PREGATE_EXPLAIN_MISMATCH',
] as const;

export type NoLaneItem = { file: string; mode: 'fail' | 'warn' };

type SeedEntry = { test: string; seed: string; suffix: string };
type AlwaysEntry = { test: string; suffix: string };

export type BoundPregate = {
  policy: string;
  base: string;
  head: string;
  tree: string;
  seeded: SeedEntry[];
  alwaysRun: AlwaysEntry[];
  noLane: NoLaneItem[];
};

export type FilteredPregate = {
  tests: Selected[];
  noLane: NoLaneItem[];
};

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const quoteField = (s: string) => (/[|\n\r]/.test(s) ? JSON.stringify(s) : s);

function invalid(message: string, fix = 'pass the JSON stdout of gstack-pregate --stage tests --explain --json'): never {
  throw new Refusal('PREGATE_INVALID', message, fix);
}

function bindMismatch(field: string, expected: string, actual: string): never {
  throw new Refusal(
    'PREGATE_BINDING',
    `pregate ${field} mismatch: expected ${expected}, got ${actual}`,
    'rerun gstack-pregate on the current checkout and base branch',
  );
}

export function parseAndBindPregate(
  text: string,
  git: Git,
  head: string,
  configCommit: string,
  configRef: string,
): BoundPregate {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    invalid('pregate output is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    invalid('pregate output is not a JSON object');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.ok === false && obj.status === 'refused') {
    const code = typeof obj.code === 'string' && obj.code ? obj.code : 'PREGATE_REFUSED';
    const detail = typeof obj.detail === 'string' && obj.detail ? obj.detail : 'pregate refused';
    const fix = typeof obj.fix === 'string' && obj.fix ? obj.fix : 'fix the base pregate policy or environment and rerun';
    throw new Refusal('PREGATE_REFUSED', `${code}: ${detail}`, fix);
  }

  if (obj.schema_version !== 1) invalid(`pregate schema_version must be 1, got ${String(obj.schema_version)}`);
  if (typeof obj.head !== 'string' || !/^[0-9a-f]{40}$/.test(obj.head)) invalid('pregate head is not a 40-hex SHA');
  if (typeof obj.tree !== 'string' || !/^[0-9a-f]+$/.test(obj.tree)) invalid('pregate tree is not a hex SHA');
  if (typeof obj.base !== 'string' || !/^origin\/.+@[0-9a-f]{12}$/.test(obj.base)) {
    invalid('pregate base must match origin/<branch>@<12-hex>');
  }
  if (!Array.isArray(obj.explain) || !obj.explain.every((x): x is string => typeof x === 'string')) {
    invalid('pregate explain array is missing', 'rerun with --explain');
  }
  if (!Array.isArray(obj.checks)) invalid('pregate checks array is missing');

  const laneChecks = obj.checks.filter(
    (c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c) && (c as Record<string, unknown>).id === 'lanes' && (c as Record<string, unknown>).stage === 'tests',
  );
  if (laneChecks.length !== 1) invalid('pregate checks must contain exactly one lanes check at stage tests');
  const lane = laneChecks[0]!;
  const inputs = lane.inputs && typeof lane.inputs === 'object' && !Array.isArray(lane.inputs)
    ? (lane.inputs as Record<string, unknown>)
    : undefined;
  const selectionHash = inputs?.selection;
  if (typeof selectionHash !== 'string' || !/^[0-9a-f]{64}$/.test(selectionHash)) {
    invalid('pregate lanes check is missing a 64-hex inputs.selection');
  }
  if (lane.lines !== undefined && (!Array.isArray(lane.lines) || !lane.lines.every((x): x is string => typeof x === 'string'))) {
    invalid('pregate lanes check lines must be a string array');
  }

  // Bind to verified inputs.
  const baseMatch = /^origin\/(.+)@([0-9a-f]{12})$/.exec(obj.base)!;
  const labelBranch = baseMatch[1]!;
  const refIsFullSha = /^[0-9a-f]{40}$/i.test(configRef);
  const expectedBranch = refIsFullSha ? labelBranch : configRef.replace(/^origin\//, '');
  if (!refIsFullSha && labelBranch !== expectedBranch) {
    bindMismatch('branch', expectedBranch, labelBranch);
  }
  const expectedBase = `origin/${expectedBranch}@${configCommit.slice(0, 12)}`;
  if (obj.base !== expectedBase) {
    bindMismatch('base', expectedBase, obj.base);
  }
  const expectedPolicy = `${expectedBase}:${PREGATE_POLICY}`;
  const actualPolicy = typeof obj.policy === 'string' ? obj.policy : String(obj.policy ?? '');
  if (actualPolicy !== expectedPolicy) {
    bindMismatch('policy', expectedPolicy, actualPolicy);
  }
  if (obj.head !== head) {
    bindMismatch('head', head, obj.head);
  }
  const expectedTree = git(['rev-parse', `${head}^{tree}`]).stdout.trim();
  if (obj.tree !== expectedTree) {
    bindMismatch('tree', expectedTree, obj.tree);
  }

  // Nonexecution check.
  if (inputs && 'command' in inputs && inputs.command !== undefined && inputs.command !== null) {
    throw new Refusal('PREGATE_EXECUTED', 'pregate lanes check recorded inputs.command (runner executed)', 'rerun without --allow-repo-commands');
  }

  const status = typeof lane.status === 'string' ? lane.status : '';
  const code = typeof lane.code === 'string' && lane.code ? lane.code : undefined;
  const validOutcome =
    (status === 'pass' && code === undefined) ||
    (status === 'incomplete' && code === 'REPO_COMMANDS_NOT_ALLOWED') ||
    (status === 'requires-remote' && (code === undefined || code === 'PREGATE_NO_LANE' || code === 'PREGATE_NO_POLICY')) ||
    (status === 'fail' && code === 'PREGATE_NO_LANE') ||
    (status === 'warn' && (code === 'PREGATE_NO_LANE' || code === 'PREGATE_NO_POLICY'));
  if (!validOutcome) {
    const detail = typeof lane.detail === 'string' && lane.detail ? `: ${lane.detail}` : '';
    const fix = typeof lane.fix === 'string' && lane.fix ? lane.fix : 'inspect pregate output and rerun gstack-pregate --stage tests --explain --json';
    throw new Refusal('PREGATE_INCOMPLETE', `lanes status=${status}${code ? ` code=${code}` : ''}${detail}`, fix);
  }

  // Provenance parsing.
  const seeded: SeedEntry[] = [];
  const alwaysRun: AlwaysEntry[] = [];
  const allTests = new Set<string>();

  for (const line of obj.explain) {
    if (line.includes(' ← ')) {
      const parenIdx = line.lastIndexOf(' (');
      if (parenIdx > 0 && /^ \([^()]+\) \[[^\]]+\]$/.test(line.slice(parenIdx))) {
        const chain = line.slice(0, parenIdx).split(' ← ');
        if (chain.length >= 2 && chain[0] && chain[chain.length - 1]) {
          const test = chain[0]!;
          const seed = chain[chain.length - 1]!;
          const suffix = line.slice(test.length).trimStart();
          seeded.push({ test, seed, suffix });
          allTests.add(test);
        }
      }
      continue;
    }
    const selfMatch = /^(.+) \(itself a test\) (\[[^\]]+\])$/.exec(line);
    if (selfMatch) {
      const test = selfMatch[1]!;
      seeded.push({ test, seed: test, suffix: `(itself a test) ${selfMatch[2]!}` });
      allTests.add(test);
      continue;
    }
    const alwaysMatch = /^(.+) (\(always_run, .*\))$/.exec(line);
    if (alwaysMatch) {
      const test = alwaysMatch[1]!;
      alwaysRun.push({ test, suffix: alwaysMatch[2]! });
      allTests.add(test);
    }
  }

  // Cross-check against inputs.selection.
  const computedSelection = sha256([...allTests].sort().join('\n'));
  if (computedSelection !== selectionHash) {
    throw new Refusal(
      'PREGATE_EXPLAIN_MISMATCH',
      `explain selection hash ${computedSelection} does not match inputs.selection ${selectionHash}`,
      'rerun gstack-pregate --stage tests --explain --json or resolve removed-path waivers',
    );
  }

  // No-lane lines.
  const noLane: NoLaneItem[] = [];
  const laneLines = (lane.lines as string[] | undefined) ?? [];
  for (const line of laneLines) {
    const failMatch = /^FAIL lanes — (.+) has no test lane$/.exec(line);
    if (failMatch) {
      noLane.push({ file: failMatch[1]!, mode: 'fail' });
      continue;
    }
    const warnMatch = /^WARN lanes — (.+) has no test lane \(/.exec(line);
    if (warnMatch) {
      noLane.push({ file: warnMatch[1]!, mode: 'warn' });
      continue;
    }
    const noPolicyMatch = /^no lane policy: (.+) have no test lane\b/.exec(line);
    if (noPolicyMatch) {
      for (const file of noPolicyMatch[1]!.split(' ').filter(Boolean)) {
        noLane.push({ file, mode: 'warn' });
      }
    }
  }
  if (status === 'fail' && code === 'PREGATE_NO_LANE' && !noLane.some((n) => n.mode === 'fail')) {
    invalid('pregate lanes check failed with PREGATE_NO_LANE but reported no FAIL lanes line');
  }

  return {
    policy: expectedPolicy,
    base: expectedBase,
    head: obj.head,
    tree: obj.tree,
    seeded,
    alwaysRun,
    noLane,
  };
}

export function filterPregate(bound: BoundPregate, delta: 'all' | ReadonlySet<string>): FilteredPregate {
  const byTest = new Map<string, string[]>();
  const addSuffix = (test: string, suffix: string) => {
    const list = byTest.get(test) ?? [];
    if (!list.includes(suffix)) list.push(suffix);
    byTest.set(test, list);
  };

  for (const entry of bound.seeded) {
    if (delta === 'all' || delta.has(entry.seed)) {
      addSuffix(entry.test, entry.suffix);
    }
  }

  if (delta === 'all' || byTest.size > 0) {
    for (const entry of bound.alwaysRun) {
      addSuffix(entry.test, entry.suffix);
    }
  }

  const tests: Selected[] = [...byTest.entries()]
    .map(([test, suffixes]) => ({
      test,
      reasons: [quoteField(`pregate: ${suffixes.join('; ')}`)],
    }))
    .sort((a, b) => (a.test < b.test ? -1 : a.test > b.test ? 1 : 0));

  const noLane = delta === 'all'
    ? [...bound.noLane]
    : bound.noLane.filter((n) => delta.has(n.file));

  return { tests, noLane };
}
