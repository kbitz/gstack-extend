/**
 * Track 64C: `bin/review-delegate` runs named specialist parts through caller-configured provider commands.
 * Every case uses a fake delegate (a Bun script) and a fake upstream root in each installed layout; no model is called.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from './helpers/child-stdio';
import { recover } from '../src/outside-review/recovery';
import { attackerInventory, delegateInventory } from '../src/upstream-check/cli';
import {
  ADVERSARIAL_SCHEMA, ATTACKER_PARTS, CLAUDE_CODE_DISALLOWED_FLAGS, CLAUDE_CODE_PREFIX_FLAGS, CONFIG_SCHEMA, DELEGATE_POLICY, FALLBACK_REASONS, PART_KEYS, PARTS, POLICY_FORMAT, RECEIPT_KEYS, RED_TEAM_FRAMING, REFUSAL_REASONS, SPECIALIST_PARTS, TOOLS_POLICY,
  buildPrompt, callId, decide, effectiveArgv, extractAdversarialChecklist, parseFindings, readReply, validateConfig,
} from '../src/review-delegate/delegate';
import { main as runMain, withinDeadline } from '../src/review-delegate/cli';

const REPO = join(import.meta.dir, '..');
const LAUNCHER = join(REPO, 'bin', 'review-delegate');
const scratch = mkdtempSync(join(tmpdir(), 'extend-review-delegate-'));
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+rwx', scratch]);
  rmSync(scratch, { recursive: true, force: true });
});
let counter = 0;
const fresh = (label: string) => { const dir = join(scratch, `${label}-${counter++}`); mkdirSync(dir, { recursive: true }); return dir; };
const put = (path: string, body: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body); };

const DELEGATE = (() => { const inv = delegateInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const ATTACKER = (() => { const inv = attackerInventory(REPO); if (!inv.ok) throw new Error(inv.reason); return inv; })();
const ADVERSARIAL_BODY = [
  ATTACKER.adversarial[0],
  `${ATTACKER.adversarial[1]} Focus on concrete failure modes.`,
  'Read the diff for this branch. First list changed files: git diff origin/main --stat',
  `${ATTACKER.adversarial[2]} Classify each finding as FIXABLE or INVESTIGATE."`,
  `**FIXABLE ${ATTACKER.adversarial[3]}`,
].join('\n') + '\n';

// A strict stand-in for the installed classifier: the review gate needs a recommendation, a tagged finding or an explicit
// no-findings line, and a refusal is unavailable with the installed reason.
const CLASSIFIER = `export function classifyOutsideReview({ text, gate, exit }) {
  const none = { highest: null };
  if (exit || !text.trim()) return { execution: { state: 'unavailable', reason: 'execution_failed' }, findings: none, verdict: 'unavailable', reason: 'execution_failed' };
  if (/^I cannot review/m.test(text)) return { execution: { state: 'unavailable', reason: 'review_refused' }, findings: none, verdict: 'unavailable', reason: 'review_refused' };
  const highest = /\\[(P[0-3])\\]/.exec(text)?.[1] ?? null;
  const findings = { highest };
  if (gate === 'review' && !/^Recommendation: .+ because .+/m.test(text)) return { execution: { state: 'ran' }, findings, verdict: 'unavailable', reason: 'missing_markers' };
  if (!highest && !/^NO_FINDINGS(?:: none)?$/m.test(text)) return { execution: { state: 'ran' }, findings, verdict: 'unverified', reason: 'untagged_review' };
  return { execution: { state: 'ran' }, findings, verdict: highest === 'P0' || highest === 'P1' ? 'findings' : 'clean' };
}
`;
const MODULES = {
  'claude-code': 'export async function runClaudeCode() {}\n',
  'claude-bin': 'export function resolveClaudeCommand() { return null; }\n',
  'outside-review-result': CLASSIFIER,
};

/** A minimal installed upstream: the nested layout has review/SKILL.md, the sibling layout does not. Checklists carry the inventory anchors. */
function upstream(layout: 'nested' | 'sibling') {
  const root = join(fresh(layout), 'gstack');
  put(join(root, 'VERSION'), '1.2.3.4\n');
  if (layout === 'nested') {
    put(join(root, 'review', 'SKILL.md'), '# review\n');
    put(join(root, 'review', 'sections', 'adversarial.md'), ADVERSARIAL_BODY);
  } else {
    put(join(root, '..', 'gstack-review', 'SKILL.md'), `# review\n${ADVERSARIAL_BODY}`);
  }
  for (const part of SPECIALIST_PARTS) put(join(root, 'review', 'specialists', `${part}.md`), `${DELEGATE[part].join('\n')}\nCHECKLIST-MARKER-${part}\n`);
  put(join(root, 'review', 'specialists', 'red-team.md'), `${ATTACKER['red-team'].join('\n')}\nCHECKLIST-MARKER-red-team\n`);
  for (const [name, body] of Object.entries(MODULES)) put(join(root, 'lib', `${name}.ts`), body);
  return root;
}
const adversarialPath = (s: { layout: 'nested' | 'sibling'; root: string }) =>
  s.layout === 'nested' ? join(s.root, 'review', 'sections', 'adversarial.md') : join(s.root, '..', 'gstack-review', 'SKILL.md');

const git = (repo: string, ...args: string[]) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
/** Two commits; `outside.txt` is in both and never in the diff. */
function repository() {
  const repo = fresh('repo');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  put(join(repo, 'outside.txt'), 'REPO-ONLY-MARKER\n');
  put(join(repo, 'changed.txt'), 'one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'one');
  const base = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  put(join(repo, 'changed.txt'), 'one\nDIFF-MARKER\n');
  git(repo, 'commit', '-q', '-am', 'two');
  return { repo, base, candidate: git(repo, 'rev-parse', 'HEAD').stdout.trim() };
}

const FAKE = join(fresh('fake'), 'delegate.ts');
put(FAKE, `import { appendFileSync, readdirSync, writeFileSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
const [, , mode, state] = process.argv;
const prompt = await Bun.stdin.text();
appendFileSync(join(state, 'spawns.log'), mode + '\\n');
const writeAll = (fd, text) => {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (off < buf.length) {
    try {
      off += writeSync(fd, buf, off, Math.min(65536, buf.length - off));
    } catch (e) {
      if (e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK')) { Atomics.wait(wait, 0, 0, 5); continue; }
      throw e;
    }
  }
};
const out = (line) => writeAll(1, line + '\\n');
const err = (line) => writeAll(2, line + '\\n');
const finding = (severity, label) => label + ' ' + JSON.stringify({ severity, confidence: 8, path: 'changed.txt', line: 2, category: 'testing', summary: 'a gap', fix: 'add a test', specialist: 'someone-else', extra: 'dropped' });
const rec = 'Recommendation: fix because a gap remains.';
const envelope = (result, usage) => JSON.stringify({ result, usage });
if (mode === 'findings') out(envelope(finding('CRITICAL', '[P1]') + '\\n' + finding('INFORMATIONAL', '[P3]') + '\\n' + rec, { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 }));
else if (mode === 'plain') out(finding('CRITICAL', '[P0]') + '\\n' + rec);
else if (mode === 'clean') out(envelope('NO_FINDINGS: none\\nRecommendation: merge because nothing is wrong.', { input_tokens: 90, output_tokens: 4 }));
else if (mode === 'exit') { err('STDERR-MARKER boom'); process.exit(3); }
else if (mode === 'sleep') { writeFileSync(join(state, 'pid.txt'), String(process.pid)); await new Promise((resolve) => setTimeout(resolve, 5000)); writeFileSync(join(state, 'finished.txt'), 'natural completion'); }
else if (mode === 'refusal') out('I cannot review this.\\nRecommendation: none because I refuse.');
else if (mode === 'needs-context') out('NEEDS_CONTEXT: the callers of changed.txt\\nNO_FINDINGS: none\\nRecommendation: wait because callers are missing.');
else if (mode === 'uncredited') out('Looks fine to me.\\nRecommendation: merge because it reads well.');
else if (mode === 'not-json') out('[P1] not json\\n' + rec);
else if (mode === 'mismatch') out(finding('CRITICAL', '[P2]') + '\\n' + rec);
else if (mode === 'missing-field') out('[P1] {"severity":"CRITICAL","path":"changed.txt","category":"testing","summary":"x"}\\n' + rec);
else if (mode === 'is-error') out(JSON.stringify({ result: 'NO_FINDINGS: none\\nRecommendation: merge because clean.', usage: {}, is_error: true }));
else if (mode === 'overflow') writeAll(1, 'x'.repeat(1024 * 1024 + 4096));
else if (mode === 'write') { writeFileSync(join(readFileSync(join(state, 'repo.txt'), 'utf8'), 'leak.txt'), 'x'); out('NO_FINDINGS: none\\nRecommendation: merge because clean.'); }
else if (mode === 'rewrite') { writeFileSync(readFileSync(join(state, 'target.txt'), 'utf8'), 'after\\n'); out('NO_FINDINGS: none\\nRecommendation: merge because clean.'); }
else if (mode === 'inspect') {
  writeFileSync(join(state, 'inspect.json'), JSON.stringify({ cwd: process.cwd(), entries: readdirSync(process.cwd()), env: Object.keys(process.env), prompt }));
  err('STDERR-MARKER inspected');
  out('NO_FINDINGS: none\\nRecommendation: merge because inspected.');
}
`);

interface Setup { layout: 'nested' | 'sibling'; root: string; repo: string; base: string; candidate: string; state: string; calls: string; config: string }
type Provider = { mode: string; timeout_s?: number; model?: string };
/** A configuration whose providers are fake delegates; `parts` maps each part to a provider label. */
function setup(layout: 'nested' | 'sibling', providers: Record<string, Provider>, parts: Record<string, string>): Setup {
  const { repo, base, candidate } = repository();
  const state = fresh('state');
  writeFileSync(join(state, 'repo.txt'), repo);
  const config = join(fresh('config'), 'delegates.json');
  put(config, JSON.stringify({ schema: CONFIG_SCHEMA, parts, providers: Object.fromEntries(Object.entries(providers).map(([label, p]) =>
    [label, { argv: [process.execPath, FAKE, p.mode, state], timeout_s: p.timeout_s ?? 30, model: p.model ?? `model-${label}` }])) }));
  return { layout, root: upstream(layout), repo, base, candidate, state, calls: join(fresh('calls'), 'delegate-calls'), config };
}
const spawns = (s: Setup) => existsSync(join(s.state, 'spawns.log')) ? readFileSync(join(s.state, 'spawns.log'), 'utf8').split('\n').filter(Boolean) : [];

const PRELOAD = join(fresh('preload'), 'preload.ts');
put(PRELOAD, `import { writeSync, WriteStream } from 'node:fs';
const origEnd = WriteStream.prototype.end;
WriteStream.prototype.end = function (this: any, chunk?: any, enc?: any, cb?: any) {
  for (const s of Object.getOwnPropertySymbols(this)) {
    if (s.toString() === 'Symbol(kWriteStreamFastPath)' && this[s] && typeof this[s]._getFd === 'function') {
      const fd = this[s]._getFd();
      if (typeof fd === 'number' && fd >= 0) {
        try {
          if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof enc === 'string' ? (enc as BufferEncoding) : 'utf8');
            let off = 0;
            const wait = new Int32Array(new SharedArrayBuffer(4));
            while (off < buf.length) {
              try {
                off += writeSync(fd, buf, off, Math.min(65536, buf.length - off));
              } catch (e: any) {
                if (e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK')) { Atomics.wait(wait, 0, 0, 5); continue; }
                throw e;
              }
            }
          }
        } catch (e) {
          this.emit('error', e);
        }
        try { this[s].close(); } catch {}
        this[s] = { end: () => 0, close: () => 0, flush: () => 0, write: () => 0, ref: () => {}, unref: () => {}, _getFd: () => -1 };
        if (typeof chunk === 'function') chunk();
        else if (typeof enc === 'function') enc();
        else if (typeof cb === 'function') cb();
        return this;
      }
    }
  }
  return origEnd.apply(this, arguments as any);
};
`);

function cli(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(LAUNCHER, args, { encoding: 'utf8', timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', HOME: fresh('home'), BUN_OPTIONS: `--preload=${PRELOAD}`, ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), ...env } });
  let json: any;
  try { json = JSON.parse(r.stdout); } catch { json = undefined; }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
const checkArgs = (s: Setup, parts: string) => ['check', '--config', s.config, '--gstack-root', s.root, '--parts', parts];
const runArgs = (s: Setup, parts: string) => ['run', '--config', s.config, '--gstack-root', s.root, '--parts', parts, '--repo', s.repo, '--base', s.base, '--candidate', s.candidate, '--calls', s.calls];
const row = (json: any, part: string) => json.parts.find((p: any) => p.part === part);

describe('check', () => {
  test.each(['nested', 'sibling'] as const)('%s layout: a valid configuration reports each part, provider and model without any call', (layout) => {
    const s = setup(layout, { alpha: { mode: 'clean', model: 'model-a' }, beta: { mode: 'clean', model: 'model-b' } }, { testing: 'alpha', performance: 'beta' });
    const r = cli(checkArgs(s, 'testing,performance'));
    expect([r.status, r.stderr]).toEqual([0, '']);
    expect(r.json).toEqual({ v: 1, status: 'ok', config_sha256: createHash('sha256').update(readFileSync(s.config)).digest('hex'),
      parts: [{ part: 'testing', provider: 'alpha', model: 'model-a' }, { part: 'performance', provider: 'beta', model: 'model-b' }] });
    expect(spawns(s)).toEqual([]);
  });

  test('a checklist whose anchors changed refuses the whole run with checklist-anchor, in both layouts', () => {
    for (const layout of ['nested', 'sibling'] as const) {
      const s = setup(layout, { alpha: { mode: 'clean' } }, { testing: 'alpha', maintainability: 'alpha' });
      const path = join(s.root, 'review', 'specialists', 'maintainability.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace('Output: JSON objects, one finding per line. Schema:', 'Output: prose.'));
      for (const args of [checkArgs(s, 'testing,maintainability'), runArgs(s, 'testing,maintainability')]) {
        const r = cli(args);
        expect([layout, r.status, r.json]).toEqual([layout, 1, { v: 1, status: 'refused', reason: 'checklist-anchor' }]);
      }
      expect(spawns(s)).toEqual([]);
      // A part that is not named does not matter, and a missing checklist refuses too.
      expect(cli(checkArgs(s, 'testing')).status).toBe(0);
      rmSync(path);
      expect(cli(checkArgs(s, 'maintainability')).json.reason).toBe('checklist-anchor');
    }
  });

  test('an installed root without the classifier refuses with helper-missing', () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    rmSync(join(s.root, 'lib', 'outside-review-result.ts'));
    expect(cli(checkArgs(s, 'testing')).json).toEqual({ v: 1, status: 'refused', reason: 'helper-missing' });
    put(join(s.root, 'lib', 'outside-review-result.ts'), 'export const classifyOutsideReview = 1;\n');
    expect(cli(checkArgs(s, 'testing')).json.reason).toBe('helper-missing');
  });
});

describe('refused part names and usage errors (exit 2, no work)', () => {
  const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
  test.each(['security', 'state-machines', 'data-migration', 'api-contract', 'design', 'native-adversarial', 'outside', 'documentation', 'coverage', 'testing,testing', 'testing,security', '', 'Testing'])(
    'a part list of %p is a usage error that makes no call', (parts) => {
      for (const args of [checkArgs(s, parts), runArgs(s, parts)]) {
        const r = cli(args);
        expect([r.status, r.stdout]).toEqual([2, '']);
        expect(r.stderr).toMatch(/^ERROR USAGE: .+\nFIX: .+\n$/);
      }
      expect(spawns(s)).toEqual([]);
      expect(existsSync(s.calls)).toBe(false);
    });

  test.each([
    ['an unknown flag', [...checkArgs(s, 'testing'), '--bogus', 'x']],
    ['a duplicate flag', [...checkArgs(s, 'testing'), '--parts', 'testing']],
    ['a missing value', ['check', '--config', s.config, '--gstack-root', s.root, '--parts']],
    ['a missing flag', ['check', '--config', s.config, '--parts', 'testing']],
    ['an unknown command', ['review', '--config', s.config]],
    ['a relative config', ['check', '--config', 'delegates.json', '--gstack-root', s.root, '--parts', 'testing']],
    ['a short SHA', ['run', '--config', s.config, '--gstack-root', s.root, '--parts', 'testing', '--repo', s.repo, '--base', 'abc123', '--candidate', s.candidate, '--calls', s.calls]],
    ['a run flag on check', [...checkArgs(s, 'testing'), '--repo', s.repo]],
    ['a calls directory inside the repository', [...runArgs(s, 'testing').slice(0, -1), join(s.repo, 'calls')]],
    ['adversarial without --adversarial on check', checkArgs(s, 'adversarial')],
    ['adversarial without --adversarial on run', runArgs(s, 'adversarial')],
    ['--adversarial without adversarial on check', [...checkArgs(s, 'testing'), '--adversarial', adversarialPath(s)]],
    ['--adversarial without adversarial on run', [...runArgs(s, 'testing'), '--adversarial', adversarialPath(s)]],
    ['a relative --adversarial', [...checkArgs(s, 'adversarial'), '--adversarial', 'adversarial.md']],
    ['red-team without --caught on run', runArgs(s, 'red-team')],
    ['--caught without red-team on run', [...runArgs(s, 'testing'), '--caught', join(s.state, 'caught.txt')]],
    ['--caught on check', [...checkArgs(s, 'red-team'), '--caught', join(s.state, 'caught.txt')]],
    ['a relative --caught', [...runArgs(s, 'red-team'), '--caught', 'caught.txt']],
    ['a --caught file inside the repository', [...runArgs(s, 'red-team'), '--caught', join(s.repo, 'caught.txt')]],
  ])('%s is a usage error with empty stdout', (_name, args) => {
    const r = cli(args as string[]);
    expect([r.status, r.stdout]).toEqual([2, '']);
    expect(r.stderr).toMatch(/^ERROR USAGE: .+\nFIX: .+\n$/);
  });

  test('--help prints the contract and exits 0', () => {
    const r = cli(['--help']);
    expect(r.status).toBe(0);
    for (const word of ['check', 'run', '--calls', '--adversarial', '--caught', 'docs/delegated-review.md', ...PARTS]) expect(r.stdout).toContain(word);
  });
});

describe('configuration errors refuse before any call', () => {
  const good = (state: string) => ({ schema: CONFIG_SCHEMA,
    providers: { alpha: { argv: [process.execPath, FAKE, 'clean', state], timeout_s: 30, model: 'model-a' } }, parts: { testing: 'alpha' } });
  const cases: Array<[string, (c: any) => any, string]> = [
    ['wrong schema', (c) => ({ ...c, schema: 'review-delegates/v2' }), 'config-malformed'],
    ['an unknown top-level key', (c) => ({ ...c, extra: 1 }), 'config-malformed'],
    ['a missing top-level key', (c) => { const { parts, ...rest } = c; return rest; }, 'config-malformed'],
    ['an unknown provider key', (c) => { c.providers.alpha.env = {}; return c; }, 'config-malformed'],
    ['a missing provider key', (c) => { delete c.providers.alpha.model; return c; }, 'config-malformed'],
    ['an uppercase label', (c) => ({ ...c, providers: { Alpha: c.providers.alpha }, parts: { testing: 'Alpha' } }), 'config-malformed'],
    ['a label that starts with a digit', (c) => ({ ...c, providers: { '1a': c.providers.alpha }, parts: { testing: '1a' } }), 'config-malformed'],
    ['a relative argv[0]', (c) => { c.providers.alpha.argv[0] = 'delegate'; return c; }, 'config-malformed'],
    ['an empty argv', (c) => { c.providers.alpha.argv = []; return c; }, 'config-malformed'],
    ['an empty argument', (c) => { c.providers.alpha.argv.push(''); return c; }, 'config-malformed'],
    ['sixty-five arguments', (c) => { c.providers.alpha.argv = ['/bin/x', ...Array(64).fill('a')]; return c; }, 'config-malformed'],
    ['timeout_s 0', (c) => { c.providers.alpha.timeout_s = 0; return c; }, 'config-malformed'],
    ['timeout_s 1801', (c) => { c.providers.alpha.timeout_s = 1801; return c; }, 'config-malformed'],
    ['a fractional timeout_s', (c) => { c.providers.alpha.timeout_s = 1.5; return c; }, 'config-malformed'],
    ['a string timeout_s', (c) => { c.providers.alpha.timeout_s = '30'; return c; }, 'config-malformed'],
    ['a bad model', (c) => { c.providers.alpha.model = 'model a'; return c; }, 'config-malformed'],
    ['an empty providers object', (c) => ({ ...c, providers: {} }), 'config-malformed'],
    ['a part outside the four', (c) => ({ ...c, parts: { ...c.parts, security: 'alpha' } }), 'config-malformed'],
    ['a part mapped to an unknown label', (c) => ({ ...c, parts: { testing: 'ghost' } }), 'config-malformed'],
    ['a part mapped to a non-string', (c) => ({ ...c, parts: { testing: 7 } }), 'config-malformed'],
    ['a named part without a mapping', (c) => ({ ...c, parts: { performance: 'alpha' } }), 'part-unmapped'],
  ];
  test.each(cases)('%s', (_name, mutate, reason) => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    put(s.config, JSON.stringify(mutate(good(s.state))));
    for (const args of [checkArgs(s, 'testing'), runArgs(s, 'testing')]) {
      const r = cli(args);
      expect([r.status, r.json]).toEqual([1, { v: 1, status: 'refused', reason }]);
    }
    expect(spawns(s)).toEqual([]);
  });

  test('a missing file, a non-JSON file, a directory and an oversized file refuse', () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    rmSync(s.config);
    expect(cli(checkArgs(s, 'testing')).json).toEqual({ v: 1, status: 'refused', reason: 'config-missing' });
    put(s.config, 'not json');
    expect(cli(checkArgs(s, 'testing')).json.reason).toBe('config-malformed');
    put(s.config, JSON.stringify({ ...good(s.state), pad: 'x'.repeat(70 * 1024) }));
    expect(cli(checkArgs(s, 'testing')).json.reason).toBe('config-malformed');
    expect(cli(['check', '--config', join(s.config, '..'), '--gstack-root', s.root, '--parts', 'testing']).json.reason).toBe('config-malformed');
    expect(spawns(s)).toEqual([]);
  });

  test('validateConfig accepts the documented shape and keeps the closed schema string', () => {
    const ok = validateConfig(JSON.stringify(good('/state')));
    expect(ok.ok).toBe(true);
    expect(validateConfig('[]').ok).toBe(false);
    expect(validateConfig('null').ok).toBe(false);
  });
});

describe('run', () => {
  test.each(['nested', 'sibling'] as const)('%s layout: credited parts carry stamped findings, envelope tokens and the provider and model', (layout) => {
    const s = setup(layout, { alpha: { mode: 'findings', model: 'model-a' }, beta: { mode: 'clean', model: 'model-b' }, gamma: { mode: 'plain', model: 'model-c' } },
      { testing: 'alpha', maintainability: 'beta', performance: 'gamma' });
    const r = cli(runArgs(s, 'testing,maintainability,performance'));
    expect([r.status, r.stderr]).toEqual([0, '']);
    expect(r.json).toMatchObject({ v: 1, status: 'ran', config_sha256: createHash('sha256').update(readFileSync(s.config)).digest('hex') });
    expect(r.json.parts.map((p: any) => p.part)).toEqual(['testing', 'maintainability', 'performance']);
    for (const p of r.json.parts) expect(Object.keys(p)).toEqual([...PART_KEYS]);

    const testing = row(r.json, 'testing');
    expect(testing).toMatchObject({ provider: 'alpha', model: 'model-a', replay: false, dispatched: true, parse: 'valid', verdict: 'findings', outcome: 'credited', fallback_reason: null,
      input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 });
    expect(typeof testing.wall_ms).toBe('number');
    expect(testing.dispatched_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(testing.call_id).toMatch(/^[0-9a-f]{64}$/);
    expect(testing.findings).toEqual([
      { severity: 'CRITICAL', confidence: 8, path: 'changed.txt', line: 2, category: 'testing', summary: 'a gap', fix: 'add a test', specialist: 'testing' },
      { severity: 'INFORMATIONAL', confidence: 8, path: 'changed.txt', line: 2, category: 'testing', summary: 'a gap', fix: 'add a test', specialist: 'testing' },
    ]);
    // a clean reply is credited with no findings, and its envelope tokens are read where reported
    expect(row(r.json, 'maintainability')).toMatchObject({ provider: 'beta', model: 'model-b', outcome: 'credited', verdict: 'clean', findings: [], input_tokens: 90, output_tokens: 4, cache_read_input_tokens: null });
    // a plain-text reply is credited with the part stamped and no token counts
    const plain = row(r.json, 'performance');
    expect(plain).toMatchObject({ provider: 'gamma', outcome: 'credited', input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null });
    expect(plain.findings).toHaveLength(1);
    expect(plain.findings[0]).toMatchObject({ severity: 'CRITICAL', specialist: 'performance' });
    expect(spawns(s).sort()).toEqual(['clean', 'findings', 'plain']);
  });

  const CAUSES: Array<[string, string, string]> = [
    ['a nonzero exit', 'exit', 'failed'],
    ['an is_error envelope', 'is-error', 'failed'],
    ['output past 1 MiB', 'overflow', 'failed'],
    ['refusal text', 'refusal', 'refused'],
    ['NEEDS_CONTEXT', 'needs-context', 'needs-context'],
    ['a reply the classifier does not credit', 'uncredited', 'uncredited'],
    ['a label line that is not JSON', 'not-json', 'unparsed-finding'],
    ['a label that disagrees with its severity', 'mismatch', 'unparsed-finding'],
    ['a finding without a required field', 'missing-field', 'unparsed-finding'],
  ];
  test.each(CAUSES)('%s falls back to the host with reason %s, beside a part that is still credited', (_name, mode, reason) => {
    const s = setup('nested', { alpha: { mode }, beta: { mode: 'clean' } }, { testing: 'alpha', maintainability: 'beta' });
    const r = cli(runArgs(s, 'testing,maintainability'));
    expect(r.status).toBe(4);
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'fell-back', fallback_reason: reason, findings: [], dispatched: true });
    expect(row(r.json, 'maintainability')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    expect(FALLBACK_REASONS).toContain(reason as any);
  }, 60_000);

  test('a delegate that outlives its timeout is killed and falls back with reason timeout', () => {
    const s = setup('sibling', { alpha: { mode: 'sleep', timeout_s: 1 } }, { testing: 'alpha' });
    const r = cli(runArgs(s, 'testing'));
    expect(r.status).toBe(4);
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'timeout' });
    const pid = Number(readFileSync(join(s.state, 'pid.txt'), 'utf8'));
    let code: string | undefined;
    try { process.kill(pid, 0); } catch (error) { code = (error as NodeJS.ErrnoException).code; }
    expect(code).toBe('ESRCH'); // the owned child has exited; no scheduling-dependent elapsed bound
    expect(existsSync(join(s.state, 'finished.txt'))).toBe(false); // natural completion cannot masquerade as timeout enforcement
  }, 30_000);

  test('a claim without a result is unresolved-claim and makes no call', () => {
    const s = setup('nested', { alpha: { mode: 'findings' } }, { testing: 'alpha' });
    const first = cli(runArgs(s, 'testing'));
    expect(row(first.json, 'testing').outcome).toBe('credited');
    const id = row(first.json, 'testing').call_id;
    rmSync(join(s.calls, `${id}.json`)); // a crash after the claim and before the result
    const again = cli(runArgs(s, 'testing'));
    expect(again.status).toBe(4);
    expect(row(again.json, 'testing')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'unresolved-claim', dispatched: false, call_id: id });
    expect(spawns(s)).toEqual(['findings']);
  });

  test('a work-tree write during the calls discards every dispatched part, exits 1 and reverts nothing', () => {
    const s = setup('nested', { alpha: { mode: 'write' }, beta: { mode: 'clean' } }, { testing: 'alpha', maintainability: 'beta' });
    const r = cli(runArgs(s, 'testing,maintainability'));
    expect(r.status).toBe(1);
    expect(r.json.status).toBe('ran');
    for (const part of ['testing', 'maintainability']) {
      expect(row(r.json, part)).toMatchObject({ outcome: 'fell-back', fallback_reason: 'worktree-changed', findings: [] });
    }
    expect(readFileSync(join(s.repo, 'leak.txt'), 'utf8')).toBe('x'); // nothing is reverted
  });

  // Value: protects=the read-only guard detects bytes even when porcelain status stays unchanged; fails_when=dirty files are rewritten unnoticed; why_new=review F1; seam=real temporary git repository
  test.each(['changed.txt', 'already-untracked.txt'])('review regression: changing %s bytes with unchanged status stops the run', (name) => {
    const s = setup('nested', { alpha: { mode: 'rewrite' } }, { testing: 'alpha' });
    const target = join(s.repo, name);
    put(target, 'before\n');
    put(join(s.state, 'target.txt'), target);
    const before = git(s.repo, 'status', '--porcelain=v1', '-z').stdout;
    const r = cli(runArgs(s, 'testing'));
    expect(git(s.repo, 'status', '--porcelain=v1', '-z').stdout).toBe(before);
    expect([r.status, row(r.json, 'testing').fallback_reason]).toEqual([1, 'worktree-changed']);
    expect(readFileSync(target, 'utf8')).toBe('after\n');
  });

  // Value: protects=discarded responses never regain coverage on replay; fails_when=the raw saved response is credited after a mutation stop; why_new=review F2; seam=runner persistence
  test('review regression: worktree-changed remains disqualified on replay without another call', () => {
    const s = setup('nested', { alpha: { mode: 'write' }, beta: { mode: 'clean' } }, { testing: 'alpha', maintainability: 'beta' });
    const first = cli(runArgs(s, 'testing,maintainability'));
    expect(first.status).toBe(1);
    const second = cli(runArgs(s, 'testing,maintainability'));
    expect(second.status).toBe(1);
    for (const part of ['testing', 'maintainability']) expect(row(second.json, part)).toMatchObject({ replay: true, dispatched: false, outcome: 'fell-back', fallback_reason: 'worktree-changed', findings: [] });
    expect(spawns(s).sort()).toEqual(['clean', 'write']);
  });

  // Value: protects=local launch failures preserve one result per requested part and the no-resend claim; fails_when=temporary cwd creation rejects the aggregate; why_new=review F7; seam=invalid temporary directory
  test('review regression: an unusable temporary root returns failed parts instead of losing the aggregate', () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha', maintainability: 'alpha' });
    const r = cli(runArgs(s, 'testing,maintainability'), { TMPDIR: join(s.state, 'missing', 'temp') });
    expect(r.status).toBe(4);
    expect(r.json.parts).toHaveLength(2);
    for (const part of r.json.parts) expect(part).toMatchObject({ outcome: 'fell-back', fallback_reason: 'failed' });
    expect(spawns(s)).toEqual([]);
  });

  test('a moved HEAD during the calls is also a work-tree change', () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    const script = join(fresh('mover'), 'mover.ts');
    put(script, `import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
await Bun.stdin.text();
spawnSync('git', ['-C', ${JSON.stringify(s.repo)}, 'commit', '-q', '--allow-empty', '-m', 'moved']);
writeSync(1, 'NO_FINDINGS: none\\nRecommendation: merge because clean.\\n');
`);
    put(s.config, JSON.stringify({ schema: CONFIG_SCHEMA, parts: { testing: 'alpha' },
      providers: { alpha: { argv: [process.execPath, script], timeout_s: 30, model: 'model-a' } } }));
    const r = cli(runArgs(s, 'testing'));
    expect([r.status, row(r.json, 'testing').fallback_reason]).toEqual([1, 'worktree-changed']);
  });

  test('an unreadable repository refuses with repo-unreadable and makes no call', () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    const r = cli(['run', '--config', s.config, '--gstack-root', s.root, '--parts', 'testing', '--repo', fresh('not-a-repo'), '--base', s.base, '--candidate', s.candidate, '--calls', s.calls]);
    expect([r.status, r.json]).toEqual([1, { v: 1, status: 'refused', reason: 'repo-unreadable' }]);
    expect(REFUSAL_REASONS).toContain('repo-unreadable');
    expect(spawns(s)).toEqual([]);
  });

  // The call is never retried with unchanged input: a rerun over the same calls directory replays saved results.
  test.each([['credited', 'findings'], ['fell-back', 'refusal'], ['failed', 'exit']])('a rerun replays a %s part with no new spawn', (_name, mode) => {
    const s = setup('nested', { alpha: { mode } }, { testing: 'alpha' });
    const first = cli(runArgs(s, 'testing'));
    expect(spawns(s)).toHaveLength(1);
    const second = cli(runArgs(s, 'testing'));
    expect(spawns(s)).toHaveLength(1);
    const [a, b] = [row(first.json, 'testing'), row(second.json, 'testing')];
    expect(b).toMatchObject({ replay: true, dispatched: false, dispatched_at: null, returned_at: null, call_id: a.call_id, outcome: a.outcome, fallback_reason: a.fallback_reason });
    expect(b.findings).toEqual(a.findings);
    expect(b.wall_ms).toBe(a.wall_ms);
    expect(second.status).toBe(first.status);
    // a changed diff or a changed model is a changed input: it is a new call
    const other = cli(runArgs({ ...s, candidate: s.base }, 'testing'));
    expect(other.json.parts[0].call_id).not.toBe(a.call_id);
  });

  test('the part with the same input but a different model is a new call', () => {
    const s = setup('nested', { alpha: { mode: 'clean', model: 'model-a' } }, { testing: 'alpha' });
    const first = cli(runArgs(s, 'testing'));
    const config = JSON.parse(readFileSync(s.config, 'utf8'));
    config.providers.alpha.model = 'model-b';
    put(s.config, JSON.stringify(config));
    const second = cli(runArgs(s, 'testing'));
    expect(row(second.json, 'testing').call_id).not.toBe(row(first.json, 'testing').call_id);
    expect(row(second.json, 'testing').replay).toBe(false);
    expect(spawns(s)).toHaveLength(2);
  });

  test('isolation: an empty private cwd outside the repository, an allowlisted environment, and only the diff and checklist on stdin', () => {
    const s = setup('sibling', { alpha: { mode: 'inspect' } }, { testing: 'alpha' });
    const r = cli(runArgs(s, 'testing'), { SECRET_TOKEN: 'leak-me', ANTHROPIC_API_KEY: 'key', TZ: 'UTC', LANG: 'C' });
    expect(r.status).toBe(0);
    const seen = JSON.parse(readFileSync(join(s.state, 'inspect.json'), 'utf8'));
    expect(seen.entries).toEqual([]);
    expect(seen.cwd).not.toContain(s.repo);
    expect(existsSync(seen.cwd)).toBe(false); // removed afterwards
    expect(seen.env).not.toContain('SECRET_TOKEN');
    expect(seen.env).not.toContain('ANTHROPIC_API_KEY');
    const allowed = new Set(['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']);
    expect(seen.env.filter((name: string) => !allowed.has(name) && !name.startsWith('BUN_'))).toEqual([]);
    expect(seen.env).toContain('TZ');
    // the prompt holds the diff and that one checklist, and nothing from the repository outside the diff
    expect(seen.prompt).toContain('DIFF-MARKER');
    expect(seen.prompt).toContain('CHECKLIST-MARKER-testing');
    expect(seen.prompt).not.toContain('CHECKLIST-MARKER-maintainability');
    expect(seen.prompt).not.toContain('REPO-ONLY-MARKER');
    expect(seen.prompt).toContain(JSON.stringify({ part: 'testing', base: s.base, candidate: s.candidate }));
    expect(seen.prompt).toContain("These response-format instructions override the checklist's output-format instructions");
    expect(seen.prompt).not.toContain(s.repo);
    expect(seen.prompt).not.toContain(s.config);
  });

  test('output never carries the prompt, the reply prose or standard error', () => {
    const s = setup('nested', { alpha: { mode: 'inspect' }, beta: { mode: 'exit' } }, { testing: 'alpha', maintainability: 'beta' });
    const r = cli(runArgs(s, 'testing,maintainability'));
    expect(r.status).toBe(4);
    for (const text of ['STDERR-MARKER', 'DIFF-MARKER', 'CHECKLIST-MARKER', 'inspected', 'Recommendation', 'boom', 'REPO-ONLY-MARKER']) expect(r.stdout).not.toContain(text);
    expect(r.stderr).toBe('');
    const saved = readdirSync(s.calls);
    expect(saved.filter((name) => name.endsWith('.claim'))).toHaveLength(2);
    for (const name of saved.filter((n) => n.endsWith('.claim'))) {
      const claim = JSON.parse(readFileSync(join(s.calls, name), 'utf8'));
      expect(Object.keys(claim).sort()).toEqual(['call_id', 'dispatched_at', 'part', 'prompt_bytes']);
    }
  });

  test.each(['nested', 'sibling'] as const)('%s layout: check and run credit adversarial and red-team with their stamped specialist fields', (layout) => {
    const s = setup(layout, { alpha: { mode: 'findings', model: 'model-adv' }, beta: { mode: 'plain', model: 'model-rt' } },
      { adversarial: 'alpha', 'red-team': 'beta' });
    const adv = adversarialPath(s);
    const caught = join(s.state, 'caught.txt');
    put(caught, '[P1] changed.txt:1 — earlier finding\n');
    const chk = cli([...checkArgs(s, 'adversarial,red-team'), '--adversarial', adv]);
    expect([chk.status, chk.stderr]).toEqual([0, '']);
    expect(chk.json.parts).toEqual([
      { part: 'adversarial', provider: 'alpha', model: 'model-adv' },
      { part: 'red-team', provider: 'beta', model: 'model-rt' },
    ]);
    expect(spawns(s)).toEqual([]);

    const ran = cli([...runArgs(s, 'adversarial,red-team'), '--adversarial', adv, '--caught', caught]);
    expect([ran.status, ran.stderr]).toEqual([0, '']);
    expect(row(ran.json, 'adversarial')).toMatchObject({
      provider: 'alpha', model: 'model-adv', outcome: 'credited',
      findings: [
        expect.objectContaining({ severity: 'CRITICAL', specialist: 'adversarial' }),
        expect.objectContaining({ severity: 'INFORMATIONAL', specialist: 'adversarial' }),
      ],
    });
    expect(row(ran.json, 'red-team')).toMatchObject({
      provider: 'beta', model: 'model-rt', outcome: 'credited',
      findings: [expect.objectContaining({ severity: 'CRITICAL', specialist: 'red-team' })],
    });
  });

  test('the adversarial prompt carries the extracted framing, criteria and schema without the upstream tool-instructions line', () => {
    const s = setup('nested', { alpha: { mode: 'inspect' } }, { adversarial: 'alpha' });
    const adv = adversarialPath(s);
    const r = cli([...runArgs(s, 'adversarial'), '--adversarial', adv]);
    expect(r.status).toBe(0);
    const seen = JSON.parse(readFileSync(join(s.state, 'inspect.json'), 'utf8'));
    const payload = JSON.parse(seen.prompt.trimEnd().split('\n').at(-1)!);
    expect(payload.checklist).toContain(ATTACKER.adversarial[1].slice(1));
    expect(payload.checklist).toContain(ATTACKER.adversarial[2]);
    expect(payload.checklist).toContain(ADVERSARIAL_SCHEMA);
    expect(seen.prompt).not.toContain('Read the diff for this branch');
    expect(seen.prompt).not.toContain('already_caught');
  });

  // Value: protects=a sibling review file that inlines Review Army's defensive framing ahead of the adversarial prompt (the Cursor rendering) still extracts the prompt's own framing; fails_when=the extractor refuses a repeated framing line elsewhere in the file or picks the Review Army copy; why_new=the Cursor sibling copy repeats the framing line, so delegate=adversarial refused there; seam=none
  test('a sibling file that inlines Review Army\'s defensive framing before the adversarial prompt still extracts the prompt\'s framing', () => {
    const s = setup('sibling', { alpha: { mode: 'inspect' } }, { adversarial: 'alpha' });
    const adv = adversarialPath(s);
    put(adv, `# review\n\n4. **Defensive framing.** Begin the prompt with:\n${ATTACKER.adversarial[1]} REVIEW-ARMY-COPY."\n\n${ADVERSARIAL_BODY}`);
    expect(cli([...checkArgs(s, 'adversarial'), '--adversarial', adv]).status).toBe(0);
    const r = cli([...runArgs(s, 'adversarial'), '--adversarial', adv]);
    expect(r.status).toBe(0);
    const seen = JSON.parse(readFileSync(join(s.state, 'inspect.json'), 'utf8'));
    const payload = JSON.parse(seen.prompt.trimEnd().split('\n').at(-1)!);
    expect(payload.checklist).toContain('Focus on concrete failure modes.');
    expect(payload.checklist).not.toContain('REVIEW-ARMY-COPY');
  });

  test('drifted, misplaced or repeated prompt, framing or criteria lines in --adversarial refuse with checklist-anchor', () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { adversarial: 'alpha' });
    const adv = adversarialPath(s);
    const [promptLine, framingAnchor, criteriaAnchor] = ATTACKER.adversarial as [string, string, string];
    const criteriaLine = ADVERSARIAL_BODY.split('\n').find((line) => line.startsWith(criteriaAnchor))!;
    for (const bad of [
      ADVERSARIAL_BODY.replace(framingAnchor, '"A rewritten framing line.'),
      ADVERSARIAL_BODY.replace(criteriaAnchor, 'A rewritten criteria line.'),
      // the framing line no longer directly follows the prompt line
      ADVERSARIAL_BODY.replace(`${promptLine}\n`, `${promptLine}\n\n`),
      // a second prompt line
      `${ADVERSARIAL_BODY}${promptLine}\n${framingAnchor} again\n`,
      `${ADVERSARIAL_BODY}${criteriaAnchor} duplicate"\n`,
      // the criteria line comes before the prompt block
      `${criteriaLine}\n${ADVERSARIAL_BODY.replace(`${criteriaLine}\n`, '')}`,
      ADVERSARIAL_BODY.replace('Classify each finding as FIXABLE or INVESTIGATE."', 'Classify each finding without a closing quote.'),
    ]) {
      put(adv, bad);
      expect(cli([...checkArgs(s, 'adversarial'), '--adversarial', adv]).json).toEqual({ v: 1, status: 'refused', reason: 'checklist-anchor' });
      expect(cli([...runArgs(s, 'adversarial'), '--adversarial', adv]).json).toEqual({ v: 1, status: 'refused', reason: 'checklist-anchor' });
    }
    expect(spawns(s)).toEqual([]);
  });

  test('red-team prompt carries already_caught, a different caught list produces a new call_id, and missing or oversized --caught refuses with caught-unreadable', () => {
    const s = setup('sibling', { alpha: { mode: 'inspect' } }, { 'red-team': 'alpha' });
    const caught = join(s.state, 'caught.txt');
    put(caught, 'finding-one\n');
    const first = cli([...runArgs(s, 'red-team'), '--caught', caught]);
    expect(first.status).toBe(0);
    const seen = JSON.parse(readFileSync(join(s.state, 'inspect.json'), 'utf8'));
    expect(seen.prompt).toContain('"already_caught":"finding-one\\n"');
    // The red-team checklist opens with the defensive framing upstream gives its Red Team dispatch, then red-team.md.
    const redTeamChecklist = JSON.parse(seen.prompt.trimEnd().split('\n').at(-1)!).checklist as string;
    expect(redTeamChecklist.startsWith(`${RED_TEAM_FRAMING}\n\n${ATTACKER['red-team'][0]}`)).toBe(true);
    const firstId = row(first.json, 'red-team').call_id;

    put(caught, 'finding-one\nfinding-two\n');
    const second = cli([...runArgs(s, 'red-team'), '--caught', caught]);
    expect(second.status).toBe(0);
    expect(row(second.json, 'red-team').call_id).not.toBe(firstId);
    expect(row(second.json, 'red-team').replay).toBe(false);

    rmSync(caught);
    expect(cli([...runArgs(s, 'red-team'), '--caught', caught]).json).toEqual({ v: 1, status: 'refused', reason: 'caught-unreadable' });
    put(caught, 'x'.repeat(64 * 1024 + 1));
    expect(cli([...runArgs(s, 'red-team'), '--caught', caught]).json).toEqual({ v: 1, status: 'refused', reason: 'caught-unreadable' });
  });

  test.each(CAUSES)('attacker fallback: %s falls back for adversarial and red-team beside a credited specialist', (_name, mode, reason) => {
    const s = setup('nested', { bad: { mode }, good: { mode: 'clean' } }, { adversarial: 'bad', 'red-team': 'bad', testing: 'good' });
    const caught = join(s.state, 'caught.txt');
    put(caught, '');
    const r = cli([...runArgs(s, 'testing,adversarial,red-team'), '--adversarial', adversarialPath(s), '--caught', caught]);
    expect(r.status).toBe(4);
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    for (const part of ATTACKER_PARTS) {
      expect(row(r.json, part)).toMatchObject({ outcome: 'fell-back', fallback_reason: reason, findings: [], dispatched: true });
    }
  }, 60_000);

  test('specialist prompt bytes and callId are byte-identical to pre-72B so saved specialist results replay', () => {
    const base = 'a'.repeat(40);
    const candidate = 'b'.repeat(40);
    const prompt = buildPrompt('testing', base, candidate, 'diff-body', 'checklist-body');
    expect(prompt).toBe(`${DELEGATE_POLICY}${JSON.stringify({ part: 'testing', base, candidate })}\n${JSON.stringify({ diff: 'diff-body', checklist: 'checklist-body' })}\n`);
    expect(prompt).not.toContain('already_caught');
    // Even if a caller passes a caught string for a specialist part, buildPrompt ignores it so specialist callIds cannot drift.
    expect(buildPrompt('testing', base, candidate, 'diff-body', 'checklist-body', 'ignored')).toBe(prompt);
    const provider = { argv: ['/bin/delegate', '--ro'], timeout_s: 30, model: 'model-a' };
    expect(callId(prompt, provider, 'alpha')).toBe(
      createHash('sha256').update(JSON.stringify([prompt, provider.argv, provider.model, 'alpha'])).digest('hex'),
    );
  });
});

describe('reply parsing and the receipt contract', () => {
  test('recover reports needs_context only for a NEEDS_CONTEXT reply', () => {
    const classify = ({ text }: { text: string }) => ({ execution: { state: 'ran' }, findings: { highest: null }, verdict: /NO_FINDINGS/.test(text) ? 'clean' as const : 'unverified' as const });
    const clean = 'NO_FINDINGS: none\nRecommendation: merge because clean.';
    expect(recover(`NEEDS_CONTEXT: callers\n${clean}`, 'review', 0, '', classify as any)).toMatchObject({ needs_context: true, credited: false, parse: 'failed' });
    expect(recover(`**NEEDS_CONTEXT:** callers\n${clean}`, 'review', 0, '', classify as any).needs_context).toBe(true);
    expect(recover(clean, 'review', 0, '', classify as any)).toMatchObject({ needs_context: false, credited: true });
    expect(recover(`\`\`\`text\n${clean}`, 'review', 0, '', classify as any)).toMatchObject({ needs_context: false, credited: false }); // an open fence
    expect(recover(clean, 'review', 3, '', classify as any)).toMatchObject({ needs_context: false, credited: false, parse: 'not-applicable' }); // not applicable
  });

  test('readReply takes tokens only from non-negative integers in a JSON envelope', () => {
    expect(readReply(JSON.stringify({ result: 'text', usage: { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: -1, cache_creation_input_tokens: 1.5 } })))
      .toEqual({ reply: 'text', isError: false, tokens: { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: null, cache_creation_input_tokens: null } });
    expect(readReply('plain reply').tokens).toEqual({ input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null });
    expect(readReply('{"result":7}').reply).toBe('{"result":7}');
    expect(readReply('{"result":"x","is_error":true}').isError).toBe(true);
  });

  test('parseFindings rejects unparsed content and requires every label line to parse', () => {
    const line = (label: string, severity: string) => `${label} ${JSON.stringify({ severity, confidence: 5, path: 'a.ts', category: 'testing', summary: 's' })}`;
    const complete = (body: string) => `${body}\nRecommendation: fix because findings remain.`;
    expect(parseFindings(`${line('[P2]', 'INFORMATIONAL')}\n\`\`\`\n[P1] not json\n\`\`\`\nprose [P1] inside a sentence`, 'testing')).toEqual({ ok: false });
    expect(parseFindings(complete(`${line('[P0]', 'CRITICAL')}\n${line('[P3]', 'INFORMATIONAL')}`), 'testing')).toMatchObject({ ok: true, findings: [{ specialist: 'testing' }, { severity: 'INFORMATIONAL' }] });
    for (const bad of [line('[P1]', 'INFORMATIONAL'), line('[P3]', 'CRITICAL'), '[P1]', '[P1] []', '[P1] {"severity":"CRITICAL","confidence":11,"path":"a","category":"c","summary":"s"}',
      '[P1] {"severity":"CRITICAL","confidence":5,"path":"","category":"c","summary":"s"}', `${line('[P1]', 'CRITICAL').slice(0, -1)},"line":0}`, `${line('[P1]', 'CRITICAL').slice(0, -1)},"fix":3}`]) {
      expect(parseFindings(complete(`${line('[P2]', 'INFORMATIONAL')}\n${bad}`), 'testing')).toEqual({ ok: false });
    }
  });

  // Value: protects=upstream decision metadata survives transport without severity downgrades; fails_when=advice becomes an automatic defect fix or cause/evidence identity is lost; why_new=review F3; seam=upstream finding schema
  test('review regression: finding metadata is preserved and malformed metadata is refused', () => {
    const value = { severity: 'INFORMATIONAL', confidence: 8, path: 'a.ts', category: 'shrink', summary: 's', advisory: true,
      lines_removable: 12, evidence_paths: ['a.ts', 'b.ts'], helper_target: { path: 'shared.ts', symbol: 'helper' }, cause: { path: 'c.ts', line: 3 } };
    const parse = (v: any, part: 'testing' | 'simplification' = 'simplification', label = '[P2]') => parseFindings(`${label} ${JSON.stringify(v)}\nRecommendation: fix because findings remain.`, part);
    expect(parse(value)).toEqual({ ok: true, findings: [{ ...value, specialist: 'simplification' }] });
    expect(parse({ ...value, severity: 'CRITICAL' }, 'testing', '[P1]')).toMatchObject({ ok: true, findings: [{ severity: 'CRITICAL', advisory: true }] });
    expect(parse({ ...value, severity: 'CRITICAL' }, 'simplification', '[P1]')).toEqual({ ok: false });
    for (const patch of [{ advisory: 'true' }, { advisory: false }, { lines_removable: 1.5 }, { evidence_paths: [2] },
      { helper_target: { path: 'x' } }, { cause: { path: 'x', line: 0 } }]) expect(parse({ ...value, ...patch })).toEqual({ ok: false });
  });

  // Value: protects=testing's documented structured evidence survives without narrowing its unspecified value types; fails_when=valid evidence is rejected or lost; why_new=review F10; seam=upstream testing checklist
  test('review regression: testing evidence preserves its four documented fields and string evidence', () => {
    const finding = { severity: 'INFORMATIONAL', confidence: 8, path: 'a.test.ts', category: 'testing', summary: 'duplicate coverage' };
    const evidence = { detects: 'same failure', non_test_callers: [{ path: 'a.ts', count: 2 }], search_command: ['git', 'grep'], stronger_proof: null };
    const parse = (value: unknown) => parseFindings(`[P2] ${JSON.stringify({ ...finding, evidence: value })}\nRecommendation: fix because coverage is duplicated.`, 'testing');
    expect(parse(evidence)).toEqual({ ok: true, findings: [{ ...finding, evidence, specialist: 'testing' }] });
    expect(parse('a textual proof')).toMatchObject({ ok: true, findings: [{ evidence: 'a textual proof' }] });
    for (const invalid of [[], null, 3, { detects: 'incomplete' }, { ...evidence, invented: 'outside the schema' }]) expect(parse(invalid)).toEqual({ ok: false });
  });

  // Value: protects=classifier recovery cannot credit truncated replies or a recommendation without an explicit clean marker; fails_when=missing completion syntax is treated as complete; why_new=review F12; seam=reply parser after recovered classifier verdict
  test('review regression: a reply needs its closing recommendation and explicit empty-result marker', () => {
    const finding = '[P2] {"severity":"INFORMATIONAL","confidence":8,"path":"a.ts","category":"testing","summary":"s"}';
    const recommendation = 'Recommendation: merge because no defects remain.';
    for (const incomplete of ['NO_FINDINGS: none', finding, recommendation, '']) expect(parseFindings(incomplete, 'testing')).toEqual({ ok: false });
    expect(parseFindings(`NO_FINDINGS: none\n${recommendation}`, 'testing')).toEqual({ ok: true, findings: [] });
    expect(parseFindings(`${finding}\nRecommendation: fix because a finding remains.`, 'testing')).toMatchObject({ ok: true, findings: [{ summary: 's' }] });
    expect(parseFindings(`${recommendation}\nNO_FINDINGS: none`, 'testing')).toEqual({ ok: false });
  });

  // Value: protects=no credited reply loses unsupported finding text; fails_when=an upstream clean verdict or one valid line hides other findings; why_new=review F4; seam=classifier and strict parser
  test('review regression: partially parseable credited replies fall back without dropping findings', () => {
    const valid = '[P3] {"severity":"INFORMATIONAL","confidence":8,"path":"a.ts","category":"testing","summary":"s"}';
    const classify = () => ({ execution: { state: 'ran' }, findings: { highest: 'P2' }, verdict: 'clean' as const });
    for (const reply of ['P2: unparsed prose', `${valid}\nP1: a blocking issue`, `${valid}\n\`\`\`\n[P1] hidden\n\`\`\``]) {
      const result = decide('testing', { exit_code: 0, signal: null, timed_out: false, overflow: false, spawn_error: false,
        stdout: `${reply}\nRecommendation: fix because defects remain.`, stderr: '', wall_ms: 1 }, classify as any);
      expect(result).toMatchObject({ outcome: 'fell-back', fallback_reason: 'unparsed-finding', findings: [] });
    }
  });

  test('the receipt keys name only keys the runner outputs, and the part keys are the documented set', () => {
    for (const source of Object.values(RECEIPT_KEYS)) expect(PART_KEYS).toContain(source);
    expect(Object.keys(RECEIPT_KEYS)).toEqual(['part', 'provider', 'model', 'outcome', 'reason', 'wall_ms', 'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'findings', 'call']);
    const docs = readFileSync(join(REPO, 'docs', 'delegated-review.md'), 'utf8').replace(/\s+/g, ' ');
    expect(docs).toContain(PART_KEYS.join(' '));
    for (const reason of [...FALLBACK_REASONS, ...REFUSAL_REASONS]) expect(docs, reason).toContain(`\`${reason}\``);
  });
});

describe('documentation', () => {
  test('the example configuration validates and names only placeholder labels, paths and models', () => {
    const docs = readFileSync(join(REPO, 'docs', 'delegated-review.md'), 'utf8');
    const example = /```json\n([\s\S]*?)\n```/.exec(docs)![1]!;
    const checked = validateConfig(example);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(Object.keys(checked.config.providers).every((label) => /^provider-[a-z]$/.test(label))).toBe(true);
    for (const provider of Object.values(checked.config.providers)) {
      expect(provider.argv[0]).toMatch(/^\/path\/to\//);
      expect(provider.model).toMatch(/^model-[a-z]$/);
    }
    expect(Object.keys(checked.config.parts).sort()).toEqual([...PARTS].sort());
  });

  test('the attacker-parts acceptance record names pending PM1 and PM2 rows and claims no installed-agent run yet', () => {
    const record = readFileSync(join(REPO, 'docs', 'acceptance', 'attacker-parts.md'), 'utf8');
    expect(record).toContain('No installed-agent run backs\nit yet');
    expect(record).toContain('| `PM1` | pending |');
    expect(record).toContain('| `PM2` | pending |');
    expect(record).toContain('297f50c7e1d46aab1404f5f2e8a9584af76ad6b2');
    expect(record).toContain('red-team=ensure');
    expect(record).toContain('delegate=adversarial,red-team');
  });

  test('the tools-mode quickstart example validates and the flag list and acceptance record stay locked to code constants', () => {
    const docs = readFileSync(join(REPO, 'docs', 'delegated-review.md'), 'utf8');
    const jsonBlocks = [...docs.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
    expect(jsonBlocks.length).toBeGreaterThanOrEqual(2);
    const quickstart = validateConfig(jsonBlocks[1]!);
    expect(quickstart.ok).toBe(true);
    if (quickstart.ok) {
      expect(quickstart.config.providers['claude-tools']).toMatchObject({
        access: 'tools',
        cli: 'claude-code',
        model: 'sonnet',
        commands: ['bun install --frozen-lockfile', 'bun test *'],
      });
    }
    const expectedFlags = [...CLAUDE_CODE_PREFIX_FLAGS, '<one Bash(<entry>) per commands entry>', ...CLAUDE_CODE_DISALLOWED_FLAGS].join(' ');
    expect(docs).toContain(expectedFlags);
    const record = readFileSync(join(REPO, 'docs', 'acceptance', 'delegate-tools-mode.md'), 'utf8');
    expect(record).toContain(expectedFlags);
    expect(record).toContain('No installed-agent run backs\nit yet: a static prose test is not installed-agent acceptance');
    expect(record).toContain('| `PM1` | pending |');
  });
});

const DEFAULT_TOOLS_STATE = fresh('default-tools-state');
const TOOLS_WRAPPER = join(fresh('tools-wrapper'), 'fake-claude');
put(TOOLS_WRAPPER, `#!/usr/bin/env bash
exec "${process.execPath}" "${join(fresh('tools-script'), 'tools-delegate.ts')}" "$@"
`);
chmodSync(TOOLS_WRAPPER, 0o755);
const TOOLS_SCRIPT = /"([^"]+tools-delegate\.ts)"/.exec(readFileSync(TOOLS_WRAPPER, 'utf8'))![1]!;
put(TOOLS_SCRIPT, `import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const writeAll = (fd: number, text: string) => {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (off < buf.length) {
    try {
      off += writeSync(fd, buf, off, Math.min(65536, buf.length - off));
    } catch (e: any) {
      if (e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK')) { Atomics.wait(wait, 0, 0, 5); continue; }
      throw e;
    }
  }
};

const args = process.argv.slice(2);
const prompt = await Bun.stdin.text();
const state = process.env.TMPDIR || ${JSON.stringify(DEFAULT_TOOLS_STATE)};
appendFileSync(join(state, 'tools-spawns.log'), JSON.stringify({ argv: process.argv, cwd: process.cwd(), env: process.env, prompt }) + '\\n');
const mode = existsSync(join(state, 'mode.txt')) ? readFileSync(join(state, 'mode.txt'), 'utf8').trim() : 'clean';

if (mode === 'old-cli') {
  writeAll(2, "error: unknown option '--restricted'\\n");
  process.exit(1);
}
if (mode === 'inspect-copy') {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const status = spawnSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join('changed.txt'), 'mutated-in-copy\\n');
  mkdirSync('readonly-dir', { mode: 0o700 });
  writeFileSync(join('readonly-dir', 'artifact.txt'), 'locked\\n');
  chmodSync('readonly-dir', 0o500);
  const bg = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  bg.unref();
  writeFileSync(join(state, 'bg-pid.txt'), String(bg.pid));
  writeFileSync(join(state, 'copy-info.json'), JSON.stringify({
    cwd: process.cwd(),
    head,
    status,
    hasGitDir: existsSync('.git'),
    entries: readdirSync('.').sort(),
    outsideText: readFileSync('outside.txt', 'utf8'),
    changedText: readFileSync('changed.txt', 'utf8'),
    args,
    envKeys: Object.keys(process.env).sort(),
    pathValue: process.env.PATH,
    disableAutoupdater: process.env.DISABLE_AUTOUPDATER,
    hasAnthropicKey: 'ANTHROPIC_API_KEY' in process.env,
  }));
}
if (mode === 'write-real-tracked') {
  const realRepo = readFileSync(join(state, 'real-repo.txt'), 'utf8').trim();
  writeFileSync(join(realRepo, 'changed.txt'), 'tampered\\n');
}
if (mode === 'write-real-ignored') {
  const realRepo = readFileSync(join(state, 'real-repo.txt'), 'utf8').trim();
  writeFileSync(join(realRepo, 'ignored.log'), 'ignored-tamper\\n');
}
const reply = 'NO_FINDINGS: none\\nRecommendation: merge because tools check passed.';
writeAll(1, JSON.stringify({ result: reply, usage: { input_tokens: 15, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) + '\\n');
process.exit(0);
`);

describe('tools mode', () => {
  const validToolsProvider = (overrides: Record<string, unknown> = {}) => ({
    access: 'tools',
    cli: 'claude-code',
    argv: [TOOLS_WRAPPER, '--effort', 'high', '--max-budget-usd', '0.25'],
    timeout_s: 30,
    model: 'sonnet',
    commands: ['bun install --frozen-lockfile', 'bun test *'],
    ...overrides,
  });
  const wrapConfig = (provider: Record<string, unknown>, extraProviders: Record<string, unknown> = {}, parts: Record<string, string> = { testing: 'alpha' }) =>
    JSON.stringify({ schema: CONFIG_SCHEMA, providers: { alpha: provider, ...extraProviders }, parts });

  test('validateConfig accepts valid tools-mode and explicit diff-mode providers and enforces closed keys and precedence', () => {
    const okTools = validateConfig(wrapConfig(validToolsProvider()));
    expect(okTools.ok).toBe(true);
    if (okTools.ok) {
      expect(okTools.config.providers.alpha).toEqual({
        access: 'tools',
        cli: 'claude-code',
        argv: [TOOLS_WRAPPER, '--effort', 'high', '--max-budget-usd', '0.25'],
        timeout_s: 30,
        model: 'sonnet',
        commands: ['bun install --frozen-lockfile', 'bun test *'],
      });
    }

    const okDiff = validateConfig(wrapConfig({ access: 'diff', argv: ['/bin/echo'], timeout_s: 30, model: 'model-a' }));
    expect(okDiff.ok).toBe(true);
    if (okDiff.ok) expect(okDiff.config.providers.alpha.access).toBe('diff');

    // Diff mode forbids cli and commands
    for (const extra of [{ cli: 'claude-code' }, { commands: ['bun test *'] }, { access: 'diff', cli: 'claude-code' }, { access: 'diff', commands: ['bun test *'] }]) {
      expect(validateConfig(wrapConfig({ argv: ['/bin/echo'], timeout_s: 30, model: 'model-a', ...extra }))).toMatchObject({ ok: false, reason: 'config-malformed' });
    }

    // Invalid access value
    expect(validateConfig(wrapConfig(validToolsProvider({ access: 'sandbox' })))).toMatchObject({
      ok: false,
      reason: 'config-malformed',
      detail: 'provider alpha access must be "diff" or "tools"',
    });

    // tools-unsupported only after structural validation succeeds
    expect(validateConfig(wrapConfig(validToolsProvider({ cli: 'codex' })))).toEqual({
      ok: false,
      reason: 'tools-unsupported',
      detail: 'provider alpha cli is not supported in tools mode',
      fix: 'remove `access`, `cli` and `commands` from provider `alpha` to run it diff-only, or set `cli` to `claude-code`; see docs/delegated-review.md#tools-mode',
    });
    expect(validateConfig(wrapConfig(validToolsProvider({ cli: 'codex', commands: [] })))).toMatchObject({ ok: false, reason: 'config-malformed' });
    expect(validateConfig(wrapConfig(validToolsProvider({ cli: 'codex', argv: ['relative/claude'] })))).toMatchObject({ ok: false, reason: 'config-malformed' });
    expect(validateConfig(wrapConfig(validToolsProvider({ cli: 'codex', model: 'bad model!' })))).toMatchObject({ ok: false, reason: 'config-malformed' });
    expect(validateConfig(wrapConfig(validToolsProvider({ cli: 'codex', timeout_s: 0 })))).toMatchObject({ ok: false, reason: 'config-malformed' });
    expect(validateConfig(wrapConfig(validToolsProvider({ cli: 'Bad_Name' })))).toMatchObject({
      ok: false,
      reason: 'config-malformed',
      detail: 'provider alpha cli must match ^[a-z][a-z0-9-]{0,31}$',
    });
  });

  test('validateConfig restricts tools-mode argv to argv[0], --effort <val>, and --max-budget-usd <val>', () => {
    const rejectedFlags: [string[], string][] = [
      [[TOOLS_WRAPPER, '--add-dir', '/tmp'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--settings', '/tmp/s.json'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--mcp-config', '/tmp/m.json'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--permission-prompt-tool', 'mcp__x'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--tools', 'Bash'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--model', 'sonnet'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--effort=high'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--dangerously-skip-permissions'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--allowedTools', 'Bash(*)'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, 'bare-word'], 'provider alpha argv[1] is not an allowed tools-mode flag'],
      [[TOOLS_WRAPPER, '--effort', 'high', '--effort', 'low'], 'provider alpha argv[3] repeats an allowed flag'],
      [[TOOLS_WRAPPER, '--effort', '-bad'], 'provider alpha argv[2] must be a non-empty value not starting with -'],
      [[TOOLS_WRAPPER, '--max-budget-usd'], 'provider alpha argv[1] must be a non-empty value not starting with -'],
    ];
    for (const [argv, detail] of rejectedFlags) {
      const res = validateConfig(wrapConfig(validToolsProvider({ argv })));
      expect(res).toMatchObject({ ok: false, reason: 'config-malformed', detail });
      if (!res.ok) expect(res.detail).not.toContain(TOOLS_WRAPPER);
    }
  });

  test('validateConfig enforces the commands grammar and gives a dedicated FIX for deprecated :* syntax', () => {
    const badCommands: [unknown, string, string?][] = [
      [[], 'provider alpha commands must be a non-empty array'],
      ['bun test *', 'provider alpha commands must be a non-empty array'],
      [[''], 'provider alpha commands[0] must be a non-empty string'],
      [['bun test *', 'bun test *'], 'provider alpha commands[1] is a duplicate entry'],
      [[' bun test *'], 'provider alpha commands[0] contains an invalid character or wildcard placement'],
      [['bun test * '], 'provider alpha commands[0] contains an invalid character or wildcard placement'],
      [['bun  test *'], 'provider alpha commands[0] contains an invalid character or wildcard placement'],
      [['bun test a,b'], 'provider alpha commands[0] contains an invalid character or wildcard placement'],
      [['bun test && id'], 'provider alpha commands[0] contains an invalid character or wildcard placement'],
      [['bun * test'], 'provider alpha commands[0] contains an invalid character or wildcard placement'],
      [['bun test:*'], 'provider alpha commands[0] uses a trailing colon or legacy :* wildcard', 'write the space form, for example `bun test *`; see docs/delegated-review.md#tools-mode'],
      [['bun: *'], 'provider alpha commands[0] uses a trailing colon or legacy :* wildcard'],
    ];
    for (const [commands, detail, fix] of badCommands) {
      const res = validateConfig(wrapConfig(validToolsProvider({ commands })));
      expect(res).toMatchObject({ ok: false, reason: 'config-malformed', detail, ...(fix ? { fix } : {}) });
    }
    // Single-word command without * and multi-word with allowed punctuation (including mid-word colon) succeed
    expect(validateConfig(wrapConfig(validToolsProvider({ commands: ['pytest', 'bun:test *', 'cargo test --package a_b.1/2:=@+- *'] }))).ok).toBe(true);
  });

  test('effectiveArgv, callId, and buildPrompt preserve diff-mode byte identity and bind tools-mode flags and policy', () => {
    expect(DELEGATE_POLICY.endsWith(POLICY_FORMAT)).toBe(true);
    const diffPrompt = buildPrompt('testing', 'aaaa', 'bbbb', 'diff-body', 'checklist-body');
    // Independent bytes from origin/main@5b54ffe, not the current policy constants.
    expect(createHash('sha256').update(diffPrompt).digest('hex')).toBe('33a606a718152f541918b576e5c55769c958a49a81fabcd2875ed5d05980a957');
    expect(diffPrompt).toContain(DELEGATE_POLICY);
    expect(diffPrompt).not.toContain('disposable copy of the repository');

    const toolsPrompt = buildPrompt('testing', 'aaaa', 'bbbb', 'diff-body', 'checklist-body', undefined, ['bun install --frozen-lockfile', 'bun test *']);
    expect(toolsPrompt).toContain(TOOLS_POLICY);
    expect(toolsPrompt).toContain('Allowed shell commands: bun install --frozen-lockfile; bun test *');
    expect(toolsPrompt).toContain(POLICY_FORMAT);
    expect(toolsPrompt).not.toContain('Do not simulate repository access, run commands, start agents or write files.');

    const parsed = validateConfig(wrapConfig(validToolsProvider()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const toolsProv = parsed.config.providers.alpha!;
    expect(effectiveArgv(toolsProv)).toEqual([
      TOOLS_WRAPPER, '--effort', 'high', '--max-budget-usd', '0.25',
      '--model', 'sonnet',
      ...CLAUDE_CODE_PREFIX_FLAGS,
      'Bash(bun install --frozen-lockfile)',
      'Bash(bun test *)',
      ...CLAUDE_CODE_DISALLOWED_FLAGS,
    ]);

    const parsed2 = validateConfig(wrapConfig(validToolsProvider({ commands: ['bun test *'] })));
    expect(parsed2.ok).toBe(true);
    if (!parsed2.ok) return;
    expect(callId(toolsPrompt, toolsProv, 'alpha')).not.toBe(callId(toolsPrompt, parsed2.config.providers.alpha!, 'alpha'));

    const diffParsed = validateConfig(wrapConfig({ argv: ['/bin/echo', 'hi'], timeout_s: 30, model: 'model-a' }));
    expect(diffParsed.ok).toBe(true);
    if (!diffParsed.ok) return;
    const diffProv = diffParsed.config.providers.alpha!;
    expect(effectiveArgv(diffProv)).toEqual(['/bin/echo', 'hi']);
    expect(callId(diffPrompt, diffProv, 'alpha')).toBe('b218b7573fa01e79e0e81fb639f5594afe5bb41cbe0a9893a3fd195410109c55');
    expect(callId(diffPrompt, diffProv, 'alpha')).toBe(
      createHash('sha256').update(JSON.stringify([diffPrompt, ['/bin/echo', 'hi'], 'model-a', 'alpha'])).digest('hex'),
    );
  });

  // Value: protects=tools-mode accepts a repository subdirectory like diff mode; fails_when=fetch receives the subdirectory rather than repository top; why_new=existing copy tests always pass the top; seam=none
  test('tools-mode resolves a subdirectory --repo to the repository top for copy setup', () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    const state = fresh('subdirectory-copy');
    const subdirectory = join(s.repo, 'nested');
    mkdirSync(subdirectory);
    put(s.config, wrapConfig(validToolsProvider()));
    const r = cli(runArgs({ ...s, repo: subdirectory }, 'testing'), { TMPDIR: state });
    expect(r.status).toBe(0);
    expect(row(r.json, 'testing').outcome).toBe('credited');
    const launched = JSON.parse(readFileSync(join(state, 'tools-spawns.log'), 'utf8').trim());
    expect(launched.cwd).not.toBe(subdirectory);
    expect(existsSync(launched.cwd)).toBe(false);
    expect(git(s.repo, 'rev-parse', 'HEAD').stdout.trim()).toBe(s.candidate);
    // External review artifacts must also be outside the resolved root.
    const insideCalls = join(s.repo, 'calls');
    const rejected = cli(runArgs({ ...s, repo: subdirectory, calls: insideCalls }, 'testing'), { TMPDIR: state });
    expect([rejected.status, rejected.stdout]).toEqual([2, '']);
    expect(rejected.stderr).toContain('--calls is inside --repo');
    expect(existsSync(insideCalls)).toBe(false);
    expect(readFileSync(join(state, 'tools-spawns.log'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  test('check reports access:"tools" on tools-mode parts only, refusal stderr omits config values, and --help documents tools mode', () => {
    const helpRes = cli(['--help']);
    expect(helpRes.status).toBe(0);
    expect(helpRes.stdout).toContain('"access": "tools"');
    expect(helpRes.stdout).toContain('tools-unsupported');

    const s = setup('nested', { beta: { mode: 'clean', model: 'model-b' } }, { testing: 'alpha', performance: 'beta' });
    put(s.config, wrapConfig(
      validToolsProvider(),
      { beta: { argv: [process.execPath, FAKE, 'clean', s.state], timeout_s: 30, model: 'model-b' } },
      { testing: 'alpha', performance: 'beta' },
    ));
    const checkRes = cli(checkArgs(s, 'testing,performance'));
    expect([checkRes.status, checkRes.stderr]).toEqual([0, '']);
    expect(checkRes.json.parts).toEqual([
      { part: 'testing', provider: 'alpha', model: 'sonnet', access: 'tools' },
      { part: 'performance', provider: 'beta', model: 'model-b' },
    ]);

    // Malformed tools config writes ERROR and FIX on stderr without leaking secret config value
    const secretValue = 'SECRET-TOKEN-VALUE-999';
    put(s.config, wrapConfig(validToolsProvider({ argv: [TOOLS_WRAPPER, '--settings', secretValue] })));
    const badRes = cli(checkArgs(s, 'testing'));
    expect(badRes.status).toBe(1);
    expect(badRes.json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
    expect(badRes.stderr).toContain('ERROR config-malformed: provider alpha argv[1] is not an allowed tools-mode flag');
    expect(badRes.stderr).toContain('FIX: pass only --effort <value> and --max-budget-usd <value> pairs after argv[0] in tools mode');
    expect(badRes.stderr).not.toContain(secretValue);
  });

  test('spawnProvider prepares a detached shallow copy at candidate (including an unreachable snapshot commit), filters env/PATH, kills background processes, and cleans up 0500 directories', async () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    // Create an unreachable snapshot commit via commit-tree (as review-and-prep snapshot procedure does)
    const tree = git(s.repo, 'rev-parse', `${s.candidate}^{tree}`).stdout.trim();
    const unreachable = git(s.repo, 'commit-tree', tree, '-p', s.base, '-m', 'unreachable snapshot').stdout.trim();
    s.candidate = unreachable;

    const tmpState = fresh('tools-tmp');
    writeFileSync(join(tmpState, 'mode.txt'), 'inspect-copy');
    put(s.config, wrapConfig(validToolsProvider()));

    const r = cli(runArgs(s, 'testing'), {
      TMPDIR: tmpState,
      PATH: `relative/bin:${process.env.PATH ?? ''}:./another-rel`,
      ANTHROPIC_API_KEY: 'should-not-leak',
    });
    expect([r.status, r.stderr]).toEqual([0, '']);
    const part = row(r.json, 'testing');
    expect(part.outcome).toBe('credited');

    const info = JSON.parse(readFileSync(join(tmpState, 'copy-info.json'), 'utf8'));
    expect(info.head).toBe(unreachable);
    expect(info.status).toBe('');
    expect(info.hasGitDir).toBe(true);
    expect(info.cwd).not.toBe(s.repo);
    expect(info.outsideText).toBe('REPO-ONLY-MARKER\n');
    expect(info.changedText).toBe('mutated-in-copy\n');
    expect(info.disableAutoupdater).toBe('1');
    expect(info.hasAnthropicKey).toBe(false);
    expect(info.pathValue.split(':').every((p: string) => p.startsWith('/'))).toBe(true);
    expect(info.args).toEqual([
      '--effort', 'high', '--max-budget-usd', '0.25',
      '--model', 'sonnet',
      ...CLAUDE_CODE_PREFIX_FLAGS,
      'Bash(bun install --frozen-lockfile)',
      'Bash(bun test *)',
      ...CLAUDE_CODE_DISALLOWED_FLAGS,
    ]);

    // Real repo was untouched by the copy edit
    expect(readFileSync(join(s.repo, 'changed.txt'), 'utf8')).toBe('one\nDIFF-MARKER\n');
    // Copy directory (including 0500 readonly-dir) was cleaned up
    expect(existsSync(info.cwd)).toBe(false);
    expect(readdirSync(tmpState).filter((name) => name.startsWith('extend-delegate-'))).toEqual([]);

    // Background child in the same process group was killed on exit
    const bgPid = Number(readFileSync(join(tmpState, 'bg-pid.txt'), 'utf8').trim());
    const running = () => {
      try {
        process.kill(bgPid, 0);
        // An owned Linux child can be terminated but not yet reaped by init.
        if (process.platform === 'linux') {
          const stat = readFileSync(`/proc/${bgPid}/stat`, 'utf8');
          if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')) return false;
        }
        return true;
      } catch { return false; }
    };
    const reapDeadline = Date.now() + 5000;
    // gstack-timing-ok: poll owned child termination with a deadline, allowing delayed OS reaping.
    while (running() && Date.now() < reapDeadline) await Bun.sleep(20);
    expect(running()).toBe(false);

    // Saved result has setup timing in stderr, and replay creates no temp dir and spawns no process
    const saved = JSON.parse(readFileSync(join(s.calls, `${part.call_id}.json`), 'utf8'));
    expect(saved.spawned.stderr).toMatch(/^review-delegate: tools-mode setup took \d+ ms\n/);
    const spawnLinesBefore = readFileSync(join(tmpState, 'tools-spawns.log'), 'utf8').trim().split('\n').length;
    const replayRes = cli(runArgs(s, 'testing'), { TMPDIR: tmpState });
    expect(replayRes.status).toBe(0);
    expect(row(replayRes.json, 'testing')).toMatchObject({ outcome: 'credited', replay: true, dispatched: false });
    expect(readFileSync(join(tmpState, 'tools-spawns.log'), 'utf8').trim().split('\n').length).toBe(spawnLinesBefore);
  });

  test('writes to the real repo trigger worktree-changed, ignored real-repo writes do not, and old CLI flag rejection falls back cleanly with stderr notice', () => {
    // 1. Write to tracked file in real repo -> worktree-changed (exit 1)
    const s1 = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    const tmp1 = fresh('tools-tmp1');
    writeFileSync(join(tmp1, 'mode.txt'), 'write-real-tracked');
    writeFileSync(join(tmp1, 'real-repo.txt'), s1.repo);
    put(s1.config, wrapConfig(validToolsProvider()));
    const r1 = cli(runArgs(s1, 'testing'), { TMPDIR: tmp1 });
    expect(r1.status).toBe(1);
    expect(row(r1.json, 'testing')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'worktree-changed', findings: [] });
    expect(r1.stderr).toContain('review-delegate: testing fell back (worktree-changed); saved result:');

    // 2. Write to gitignored file in real repo -> not in worktreeState (documented limit)
    const s2 = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    put(join(s2.repo, '.gitignore'), '*.log\n');
    git(s2.repo, 'add', '.gitignore');
    git(s2.repo, 'commit', '-q', '-m', 'ignore logs');
    s2.candidate = git(s2.repo, 'rev-parse', 'HEAD').stdout.trim();
    const tmp2 = fresh('tools-tmp2');
    writeFileSync(join(tmp2, 'mode.txt'), 'write-real-ignored');
    writeFileSync(join(tmp2, 'real-repo.txt'), s2.repo);
    put(s2.config, wrapConfig(validToolsProvider()));
    const r2 = cli(runArgs(s2, 'testing'), { TMPDIR: tmp2 });
    expect(r2.status).toBe(0);
    expect(row(r2.json, 'testing').outcome).toBe('credited');

    // 3. Old CLI rejecting --restricted -> fallback_reason: "failed" (exit 4) + stderr pointer
    const s3 = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    const tmp3 = fresh('tools-tmp3');
    writeFileSync(join(tmp3, 'mode.txt'), 'old-cli');
    put(s3.config, wrapConfig(validToolsProvider()));
    const r3 = cli(runArgs(s3, 'testing'), { TMPDIR: tmp3 });
    expect(r3.status).toBe(4);
    const part3 = row(r3.json, 'testing');
    expect(part3).toMatchObject({ outcome: 'fell-back', fallback_reason: 'failed' });
    expect(r3.stderr).toBe(`review-delegate: testing fell back (failed); saved result: ${join(s3.calls, `${part3.call_id}.json`)}\n`);
    const saved3 = JSON.parse(readFileSync(join(s3.calls, `${part3.call_id}.json`), 'utf8'));
    expect(saved3.spawned.stderr).toContain("error: unknown option '--restricted'");
    // An interrupted synthetic call has a claim and no saved result to inspect.
    rmSync(join(s3.calls, `${part3.call_id}.json`));
    const unresolved = cli(runArgs(s3, 'testing'), { TMPDIR: tmp3 });
    expect(row(unresolved.json, 'testing').fallback_reason).toBe('unresolved-claim');
    expect(unresolved.stderr).toContain(`result not saved; call: ${part3.call_id}`);
    expect(unresolved.stderr).not.toContain('saved result:');
  });

  // Value: protects=approved Git setup controls; fails_when=template, hook or filter suppression is removed; why_new=copy contents tests miss setup flags; seam=none
  test('copy setup disables templates, hooks and LFS and runs in the owned temporary directory', () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    const state = fresh('setup-controls');
    const fakeBin = fresh('setup-controls-bin');
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    const script = join(fakeBin, 'record.ts');
    put(script, `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.some(a => ['init', 'fetch', 'checkout'].includes(a))) {
  appendFileSync(${JSON.stringify(join(state, 'setup.jsonl'))}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    put(join(fakeBin, 'git'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(join(fakeBin, 'git'), 0o755);
    put(s.config, wrapConfig(validToolsProvider()));
    const r = cli(runArgs(s, 'testing'), { TMPDIR: state, PATH: `${fakeBin}:${process.env.PATH ?? ''}` });
    expect(r.status).toBe(0);
    const steps = readFileSync(join(state, 'setup.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(steps).toHaveLength(3);
    expect(steps[0].args).toContain('--template=');
    expect(steps[1].args).toContain('core.hooksPath=/dev/null');
    expect(steps[1].args).toContain('--no-tags');
    expect(steps[1].args).toContain('--no-recurse-submodules');
    for (const setting of ['core.hooksPath=/dev/null', 'filter.lfs.process=', 'filter.lfs.smudge=', 'filter.lfs.required=false']) {
      expect(steps[2].args).toContain(setting);
    }
    const spawned = JSON.parse(readFileSync(join(state, 'tools-spawns.log'), 'utf8').trim());
    for (const step of steps) expect(step.cwd).toBe(join(spawned.cwd, '..'));
  });

  // Value: protects=cleanup cannot execute a PATH-provided chmod; fails_when=cleanup resolves chmod through PATH; why_new=normal removal never enters repair; seam=existing rmDir injection
  test('cleanup retries removal with system chmod instead of a PATH-provided executable', async () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    put(s.config, wrapConfig(validToolsProvider()));
    const fakeBin = fresh('cleanup-bin');
    const marker = join(fakeBin, 'unexpected-chmod');
    put(join(fakeBin, 'chmod'), `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(join(fakeBin, 'chmod'), 0o755);
    const previousPath = process.env.PATH;
    let attempts = 0;
    let output = '';
    try {
      process.env.PATH = `${fakeBin}:${previousPath ?? ''}`;
      const code = await runMain(runArgs(s, 'testing'), { stdout: t => { output += t; }, stderr: () => {} }, {
        rmDir: async target => {
          if (++attempts === 1) throw new Error('synthetic first-removal failure');
          rmSync(target, { recursive: true, force: true });
        },
      });
      expect(code).toBe(0);
      expect(row(JSON.parse(output), 'testing').outcome).toBe('credited');
      expect(attempts).toBe(2);
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test('prepareCopy records step names on init/fetch/checkout failures, bounds setup timeout, isolates concurrent copies, and bounds stalled cleanup', async () => {
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    const fakeGitDir = fresh('fake-git-bin');
    const fakeGit = join(fakeGitDir, 'git');
    put(fakeGit, `#!/usr/bin/env bash
step_fail="\${FAKE_GIT_FAIL:-}"
for arg in "$@"; do
  if [[ "$arg" == "init" && "$step_fail" == "init" ]]; then exit 1; fi
  if [[ "$arg" == "fetch" && "$step_fail" == "fetch" ]]; then exit 1; fi
  if [[ "$arg" == "checkout" && "$step_fail" == "checkout" ]]; then exit 1; fi
  if [[ "$arg" == "fetch" && "$step_fail" == "hang" ]]; then sleep 30; exit 0; fi
done
exec "${realGit}" "$@"
`);
    chmodSync(fakeGit, 0o755);

    for (const step of ['init', 'fetch', 'checkout'] as const) {
      const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
      const tmp = fresh(`tools-git-${step}`);
      put(s.config, wrapConfig(validToolsProvider()));
      const r = cli(runArgs(s, 'testing'), {
        TMPDIR: tmp,
        PATH: `${fakeGitDir}:${process.env.PATH ?? ''}`,
        FAKE_GIT_FAIL: step,
      });
      expect(r.status).toBe(4);
      const part = row(r.json, 'testing');
      expect(part).toMatchObject({ outcome: 'fell-back', fallback_reason: 'failed' });
      const saved = JSON.parse(readFileSync(join(s.calls, `${part.call_id}.json`), 'utf8'));
      expect(saved.spawned.stderr).toMatch(new RegExp(`^review-delegate: tools-mode setup failed \\(${step}\\)\\nreview-delegate: tools-mode setup took \\d+ ms\\n$`));
      expect(readdirSync(tmp).filter((name) => name.startsWith('extend-delegate-'))).toEqual([]);

      // Replay of saved setup failure returns failed without creating a copy
      const replay = cli(runArgs(s, 'testing'), { TMPDIR: tmp });
      expect(replay.status).toBe(4);
      expect(row(replay.json, 'testing')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'failed', replay: true });
    }

    // Setup exceeding deadline returns fallback_reason: "timeout"
    const sTimeout = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha' });
    const tmpTimeout = fresh('tools-git-timeout');
    put(sTimeout.config, wrapConfig(validToolsProvider({ timeout_s: 1 })));
    const rTimeout = cli(runArgs(sTimeout, 'testing'), {
      TMPDIR: tmpTimeout,
      PATH: `${fakeGitDir}:${process.env.PATH ?? ''}`,
      FAKE_GIT_FAIL: 'hang',
    });
    expect(rTimeout.status).toBe(4);
    const partTimeout = row(rTimeout.json, 'testing');
    expect(partTimeout).toMatchObject({ outcome: 'fell-back', fallback_reason: 'timeout' });
    const savedTimeout = JSON.parse(readFileSync(join(sTimeout.calls, `${partTimeout.call_id}.json`), 'utf8'));
    expect(savedTimeout.spawned.stderr).toContain('review-delegate: tools-mode setup failed (fetch: timeout)');

    // Two concurrent tools-mode parts get distinct copy directories and both are removed
    const sConc = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha', performance: 'alpha' });
    const tmpConc = fresh('tools-conc');
    put(sConc.config, wrapConfig(validToolsProvider(), {}, { testing: 'alpha', performance: 'alpha' }));
    const rConc = cli(runArgs(sConc, 'testing,performance'), { TMPDIR: tmpConc });
    expect(rConc.status).toBe(0);
    const spawnsConc = readFileSync(join(tmpConc, 'tools-spawns.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(spawnsConc).toHaveLength(2);
    expect(spawnsConc[0].cwd).not.toBe(spawnsConc[1].cwd);
    expect(existsSync(spawnsConc[0].cwd)).toBe(false);
    expect(existsSync(spawnsConc[1].cwd)).toBe(false);

    // Stalled cleanup on one part does not delay a sibling part's timeout (via Deps injection)
    const sStall = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha', performance: 'beta' });
    const slowWrapper = join(fresh('slow-wrapper'), 'slow-claude');
    put(slowWrapper, `#!/usr/bin/env bash\nsleep 10\n`);
    chmodSync(slowWrapper, 0o755);
    put(sStall.config, wrapConfig(
      validToolsProvider({ timeout_s: 5 }),
      { beta: validToolsProvider({ argv: [slowWrapper], timeout_s: 1 }) },
      { testing: 'alpha', performance: 'beta' },
    ));
    let outBuf = '', errBuf = '';
    const stalledTargets: string[] = [];
    const code = await runMain(
      runArgs(sStall, 'testing,performance'),
      { stdout: (t) => { outBuf += t; }, stderr: (t) => { errBuf += t; } },
      { rmDir: (target) => { stalledTargets.push(target); return new Promise(() => { /* never resolves */ }); }, cleanupLimitMs: 1500 },
    );
    for (const target of stalledTargets) rmSync(target, { recursive: true, force: true });
    expect(code).toBe(4);
    expect(stalledTargets).toHaveLength(2);
    const parsedOut = JSON.parse(outBuf);
    expect(row(parsedOut, 'testing')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'failed' });
    expect(row(parsedOut, 'performance')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'timeout' });
    expect(errBuf).toContain('testing fell back (failed); saved result:');
    expect(errBuf).toContain('performance fell back (timeout); saved result:');
    expect(await withinDeadline(Promise.resolve('ok'), 0)).toEqual({ ok: false });
  });

  // Value: protects=a sibling deadline fires while another part awaits cleanup; fails_when=parts or cleanup serialize the sibling deadline; why_new=final fallback outcomes do not prove event ordering; seam=existing rmDir injection
  test('a sibling reaches timeout before the first cleanup is released', async () => {
    const s = setup('nested', { alpha: { mode: 'clean' } }, { testing: 'alpha', performance: 'beta' });
    const slowWrapper = join(fresh('overlap-wrapper'), 'slow-claude');
    put(slowWrapper, '#!/bin/sh\nsleep 10\n');
    chmodSync(slowWrapper, 0o755);
    put(s.config, wrapConfig(validToolsProvider({ timeout_s: 5 }), {
      beta: validToolsProvider({ argv: [slowWrapper], timeout_s: 1 }),
    }, { testing: 'alpha', performance: 'beta' }));
    let releaseFirst!: () => void;
    let siblingEntered!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const siblingGate = new Promise<void>(resolve => { siblingEntered = resolve; });
    let cleanupCalls = 0;
    let output = '';
    const run = runMain(runArgs(s, 'testing,performance'), { stdout: t => { output += t; }, stderr: () => {} }, {
      rmDir: async target => {
        if (++cleanupCalls === 1) await firstGate;
        else siblingEntered();
        rmSync(target, { recursive: true, force: true });
      },
      cleanupLimitMs: 15_000,
    });
    let observed: Awaited<ReturnType<typeof withinDeadline>>;
    let code: number;
    try {
      // gstack-timing-ok: hang guard while first cleanup is explicitly held; no elapsed-time performance assertion.
      observed = await withinDeadline(siblingGate, 5000);
    } finally {
      releaseFirst();
      code = await run;
    }
    expect(observed!.ok).toBe(true);
    expect(code!).toBe(4);
    expect(cleanupCalls).toBe(2);
    expect(row(JSON.parse(output), 'testing').outcome).toBe('credited');
    expect(row(JSON.parse(output), 'performance')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'timeout' });
  });
});

// Value: protects=the installed classifier credits both reply forms the runner asks for and still does not credit the checklist's own plain
//   JSON lines; fails_when=an upstream classifier change stops crediting the reply form (every delegated part would silently fall back);
//   why_new=the stub cannot show what the installed classifier reads; seam=installed gstack lib (GSTACK_OUTSIDE_TEST_ROOT);
//   no_claim=that a model follows the prompt
describe('installed classifier', () => {
  test.skipIf(!process.env.GSTACK_OUTSIDE_TEST_ROOT)('credits a labelled finding reply and a no-findings reply, and does not credit plain upstream JSON lines', async () => {
    const { classifyOutsideReview } = await import(join(process.env.GSTACK_OUTSIDE_TEST_ROOT!, 'lib/outside-review-result.ts'));
    const json = { severity: 'CRITICAL', confidence: 9, path: 'a.ts', line: 1, category: 'testing', summary: 'gap', fix: 'test', specialist: 'testing' };
    const labelled = `[P1] ${JSON.stringify(json)}\nRecommendation: fix because a gap remains.`;
    const clean = 'NO_FINDINGS: none\nRecommendation: merge because nothing is wrong.';
    const plain = JSON.stringify(json);
    const found = recover(labelled, 'review', 0, '', classifyOutsideReview);
    expect([found.credited, found.parse, found.classification.verdict]).toEqual([true, 'valid', 'findings']);
    expect(parseFindings(labelled, 'testing')).toMatchObject({ ok: true, findings: [{ specialist: 'testing' }] });
    const none = recover(clean, 'review', 0, '', classifyOutsideReview);
    expect([none.credited, none.parse, none.classification.verdict]).toEqual([true, 'valid', 'clean']);
    expect(recover(plain, 'review', 0, '', classifyOutsideReview).credited).toBe(false);
    expect(recover(`${plain}\nRecommendation: fix because a gap remains.`, 'review', 0, '', classifyOutsideReview).credited).toBe(false);
    const refused = recover('I cannot review this.\nRecommendation: none because I refuse.', 'review', 0, '', classifyOutsideReview);
    expect(refused.credited).toBe(false);
  });
});
