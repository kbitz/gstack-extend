/**
 * Track 64C: `bin/review-delegate` runs named specialist parts through caller-configured provider commands.
 * Every case uses a fake delegate (a Bun script) and a fake upstream root in each installed layout; no model is called.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from './helpers/child-stdio';
import { createServer, type Socket } from 'node:net';
import { recover } from '../src/outside-review/recovery';
import { attackerInventory, delegateInventory } from '../src/upstream-check/cli';
import {
  ADVERSARIAL_SCHEMA, ATTACKER_PARTS, CONFIG_SCHEMA, DELEGATE_POLICY, FALLBACK_REASONS, PART_KEYS, PARTS, RECEIPT_KEYS, RED_TEAM_FRAMING, REFUSAL_REASONS, REPO_POLICY, SPECIALIST_PARTS,
  buildPrompt, callId, decide, extractAdversarialChecklist, parseFindings, readReply, sandboxArgs, validateConfig, type Access,
} from '../src/review-delegate/delegate';
import { main, parseWorktreeList, passwdHome, probeSandbox, type Deps } from '../src/review-delegate/cli';

const REPO = join(import.meta.dir, '..');
const LAUNCHER = join(REPO, 'bin', 'review-delegate');
const scratch = mkdtempSync(join(tmpdir(), 'extend-review-delegate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
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
put(FAKE, `import { appendFileSync, existsSync, readdirSync, writeFileSync, readFileSync, writeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
const [, , mode, state] = process.argv;
// Repo mode persists nothing on the host, so sandboxed modes report through stderr (the runner saves it, never parses it) or a localhost socket.
const report = (value) => err('REPORT ' + JSON.stringify(value));
const prompt = await Bun.stdin.text();
try { appendFileSync(join(state, 'spawns.log'), mode + '\\n'); } catch {}
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
else if (mode === 'sleep') { try { writeFileSync(join(state, 'pid.txt'), String(process.pid)); } catch {} await new Promise((resolve) => setTimeout(resolve, 5000)); try { writeFileSync(join(state, 'finished.txt'), 'natural completion'); } catch {} }
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
} else if (mode === 'repo-probe') {
  const realRepo = readFileSync(join(state, 'repo.txt'), 'utf8').trim();
  const exposeDir = readFileSync(join(state, 'expose-dir.txt'), 'utf8').trim();
  const callsDir = readFileSync(join(state, 'calls-dir.txt'), 'utf8').trim();
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
  const log = spawnSync('git', ['log', '-1', '--oneline'], { encoding: 'utf8' }).stdout.trim();
  const remotes = spawnSync('git', ['remote'], { encoding: 'utf8' }).stdout.trim();
  const pushStatus = spawnSync('git', ['push'], { encoding: 'utf8' }).status;
  const outside = readFileSync(join(process.cwd(), 'outside.txt'), 'utf8');
  writeFileSync(join(process.cwd(), 'clone-only.txt'), 'CLONE\\n');
  const realRepoEntries = existsSync(realRepo) ? readdirSync(realRepo) : ['missing'];
  const callsEntries = existsSync(callsDir) ? readdirSync(callsDir) : ['missing'];
  const secretInReal = existsSync(join(realRepo, 'ignored-secret.txt'));
  const secretInCopy = existsSync(join(process.cwd(), 'ignored-secret.txt'));
  const homeCred = existsSync(join(process.env.HOME ?? '', 'cred.txt'));
  const sshExists = existsSync(join(process.env.HOME ?? '', '.ssh'));
  const runUser = existsSync('/run/user');
  const hostsLen = readFileSync('/etc/hosts', 'utf8').length;
  const exposedBefore = readFileSync(join(exposeDir, 'info.txt'), 'utf8');
  writeFileSync(join(exposeDir, 'info.txt'), 'THROW-AWAY\\n');
  writeFileSync(join(exposeDir, 'extra.txt'), 'THROW-AWAY\\n');
  writeFileSync(join(state, 'kept.txt'), 'DISCARDED-MARKER\\n');
  writeFileSync('/tmp/probe-tmp.txt', 'TMP-OK\\n');
  const tmpBack = readFileSync('/tmp/probe-tmp.txt', 'utf8');
  const snapshotOnly = existsSync(join(process.cwd(), 'snapshot-only.txt'));
  const varLib = existsSync('/var/lib');
  // The host reads the passwd home (a lookup inside the sandbox can miss accounts served from /run or /var).
  const passwdHome = existsSync(join(state, 'passwd-home.txt')) ? readFileSync(join(state, 'passwd-home.txt'), 'utf8').trim() : '';
  const passwdHomeEntries = passwdHome && passwdHome !== process.env.HOME && existsSync(passwdHome) ? readdirSync(passwdHome) : [];
  let procKeys = 'unreadable';
  try { procKeys = readFileSync('/proc/keys', 'utf8'); } catch {}
  report({
    cwd: process.cwd(), head, status, log, remotes, pushStatus, outside, realRepoEntries, callsEntries,
    secretInReal, secretInCopy, homeCred, sshExists, runUser, hostsLen, exposedBefore, tmpdir: process.env.TMPDIR, tmpBack,
    snapshotOnly, varLib, passwdHome, passwdHomeEntries, home: process.env.HOME, procKeys,
    env: Object.keys(process.env), prompt,
  });
  out('[P1] ' + JSON.stringify({
    severity: 'CRITICAL', confidence: 9, path: 'changed.txt', line: 2, category: 'adversarial',
    summary: 'verified in clone', fix: 'guard it', evidence: 'git rev-parse HEAD -> ' + head,
  }) + '\\nRecommendation: fix because reproduced in clone.');
} else if (mode === 'keyring') {
  // Ask the kernel for the session keyring id (KEYCTL_GET_KEYRING_ID, KEY_SPEC_SESSION_KEYRING); the sandbox's seccomp filter must refuse it.
  const r = spawnSync('/usr/bin/python3', ['-c', 'import ctypes,os;libc=ctypes.CDLL(None,use_errno=True);nr={"x86_64":250,"aarch64":219}[os.uname().machine];r=libc.syscall(nr,0,-3,0);print(r,ctypes.get_errno())'], { encoding: 'utf8' });
  report({ keyring: (r.stdout ?? '').trim() });
  out('NO_FINDINGS: none\\nRecommendation: merge because keyring probed.');
} else if (mode === 'escape-write') {
  const realRepo = readFileSync(join(state, 'repo.txt'), 'utf8').trim();
  const attempts: Record<string, string> = {};
  for (const [name, target] of [
    ['worktree', join(realRepo, 'changed.txt')],
    ['worktreeNew', join(realRepo, 'escape.txt')],
    ['gitObjects', join(realRepo, '.git', 'objects', 'escape')],
    ['homeCred', join(process.env.HOME ?? '', 'cred.txt')],
    ['etc', '/etc/extend-escape-probe'],
    ['etcHosts', '/etc/hosts'],
    ['stagedScript', process.argv[1]!],
  ] as const) {
    try { writeFileSync(target, 'ESCAPED\\n'); attempts[name] = 'wrote-in-sandbox'; }
    catch (err: any) { attempts[name] = err?.code ?? 'error'; }
  }
  report(attempts);
  out('NO_FINDINGS: none\\nRecommendation: merge because escape probes ran.');
} else if (mode === 'background') {
  const port = Number(readFileSync(join(state, 'port.txt'), 'utf8'));
  const child = spawn(process.execPath, ['-e', \`setTimeout(() => { const s = require('node:net').connect(\${port}, '127.0.0.1', () => s.end('alive')); s.on('error', () => {}); }, 1500);\`], { detached: true, stdio: 'ignore' });
  child.unref();
  out('NO_FINDINGS: none\\nRecommendation: merge because background spawned.');
} else if (mode === 'signal-wait') {
  const port = Number(readFileSync(join(state, 'port.txt'), 'utf8'));
  await new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => socket.write('ready'));
    socket.on('data', () => { socket.end(); resolve(null); });
    socket.on('error', () => resolve(null));
    setTimeout(() => resolve(null), 5000);
  });
  out('NO_FINDINGS: none\\nRecommendation: merge because signal received.');
}
`);

interface Setup { layout: 'nested' | 'sibling'; root: string; repo: string; base: string; candidate: string; state: string; calls: string; config: string }
type Provider = { mode: string; timeout_s?: number; model?: string; access?: Access; expose?: string[] };
/** The bun runtime runs every fake delegate; when the sandbox would hide it (bun under a home, /tmp, /var or /run), repo-mode providers expose it. */
const PASSWD_HOME = passwdHome();
const RUNTIME_DIR = dirname(realpathSync(process.execPath));
const RUNTIME_EXPOSE = [process.env.HOME ?? '', PASSWD_HOME, tmpdir(), '/tmp', '/var', '/run']
  .some((root) => root && (RUNTIME_DIR === root || RUNTIME_DIR.startsWith(`${root}/`))) ? [RUNTIME_DIR] : [];
/** A configuration whose providers are fake delegates; `parts` maps each part to a provider label. */
function setup(layout: 'nested' | 'sibling', providers: Record<string, Provider>, parts: Record<string, string>): Setup {
  const { repo, base, candidate } = repository();
  const state = fresh('state');
  writeFileSync(join(state, 'repo.txt'), repo);
  writeFileSync(join(state, 'passwd-home.txt'), PASSWD_HOME);
  const config = join(fresh('config'), 'delegates.json');
  put(config, JSON.stringify({ schema: CONFIG_SCHEMA, parts, providers: Object.fromEntries(Object.entries(providers).map(([label, p]) =>
    [label, {
      argv: [process.execPath, FAKE, p.mode, state],
      timeout_s: p.timeout_s ?? 30,
      model: p.model ?? `model-${label}`,
      ...(p.access !== undefined ? { access: p.access } : {}),
      ...(p.access === 'repo' && RUNTIME_EXPOSE.length ? { expose: [...(p.expose ?? []), ...RUNTIME_EXPOSE] } : p.expose !== undefined ? { expose: p.expose } : {}),
    }])) }));
  return { layout, root: upstream(layout), repo, base, candidate, state, calls: join(fresh('calls'), 'delegate-calls'), config };
}
const spawns = (s: Setup) => existsSync(join(s.state, 'spawns.log')) ? readFileSync(join(s.state, 'spawns.log'), 'utf8').split('\n').filter(Boolean) : [];

const PRELOAD = join(fresh('preload'), 'preload.ts');
put(PRELOAD, `import { closeSync, writeSync, WriteStream } from 'node:fs';
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
        try { closeSync(fd); } catch {}
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
/** The REPORT line a sandboxed fake wrote to stderr, read back from the runner's saved result (repo mode persists nothing on the host). */
const reportOf = (s: Setup, json: any, part: string) => {
  const saved = JSON.parse(readFileSync(join(s.calls, `${row(json, part).call_id}.json`), 'utf8'));
  const line = String(saved.spawned.stderr).split('\n').find((l: string) => l.startsWith('REPORT '));
  if (!line) throw new Error(`no REPORT line from ${part}: ${String(saved.spawned.stderr).slice(0, 200)}`);
  return JSON.parse(line.slice('REPORT '.length));
};
/** Add the state dir to a provider's expose list: the fake reads its inputs there, and anything it writes there is discarded. */
const exposeState = (s: Setup, label: string) => {
  const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
  cfg.providers[label].expose = [...(cfg.providers[label].expose ?? []), s.state];
  writeFileSync(s.config, JSON.stringify(cfg));
};
/** A localhost server the sandbox can reach through the shared network; the port goes to the fake through the exposed state dir. */
async function socketChannel(state: string, onData?: (socket: Socket, data: string) => void) {
  let connections = 0;
  const server = createServer((socket) => { connections++; socket.on('error', () => {}); socket.on('data', (d) => onData?.(socket, d.toString())); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  writeFileSync(join(state, 'port.txt'), String((server.address() as { port: number }).port));
  return { connections: () => connections, close: () => new Promise<void>((done) => server.close(() => done())) };
}

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
    for (const word of ['check', 'run', '--calls', '--adversarial', '--caught', 'sandbox-unavailable', 'docs/delegated-review.md', ...PARTS]) expect(r.stdout).toContain(word);
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
    ['a bad access value', (c) => { c.providers.alpha.access = 'write'; return c; }, 'config-malformed'],
    ['expose without repo mode', (c) => { c.providers.alpha.expose = ['/path/to/x']; return c; }, 'config-malformed'],
    ['a relative expose path', (c) => { c.providers.alpha.access = 'repo'; c.providers.alpha.expose = ['relative/path']; return c; }, 'config-malformed'],
    ['an unnormalized expose path with ..', (c) => { c.providers.alpha.access = 'repo'; c.providers.alpha.expose = ['/a/../b']; return c; }, 'config-malformed'],
    ['a trailing-slash path in expose', (c) => { c.providers.alpha.access = 'repo'; c.providers.alpha.expose = ['/a/b/']; return c; }, 'config-malformed'],
    ['root / in expose', (c) => { c.providers.alpha.access = 'repo'; c.providers.alpha.expose = ['/']; return c; }, 'config-malformed'],
    ['a keep key (repo mode has no writable host path)', (c) => { c.providers.alpha.access = 'repo'; c.providers.alpha.keep = ['/path/to/x']; return c; }, 'config-malformed'],
    ['a keep key in diff mode', (c) => { c.providers.alpha.keep = []; return c; }, 'config-malformed'],
    ['a control character in expose', (c) => { c.providers.alpha.access = 'repo'; c.providers.alpha.expose = ['/path/to/\nfile']; return c; }, 'config-malformed'],
    ['duplicate path within expose', (c) => { c.providers.alpha.access = 'repo'; c.providers.alpha.expose = ['/a/b', '/a/b']; return c; }, 'config-malformed'],
    ['more than 32 entries in expose', (c) => { c.providers.alpha.access = 'repo'; c.providers.alpha.expose = Array.from({ length: 33 }, (_, i) => `/path/e${i}`); return c; }, 'config-malformed'],
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

  // Value: protects=a configuration that still names keep is refused by name, never silently ignored; fails_when=keep is accepted or refused without naming it; why_new=owner decision to drop keep (2026-11-08); seam=none
  test('a provider that still names keep refuses as config-malformed and standard error names the key', () => {
    const s = setup('nested', { p: { mode: 'clean' } }, { testing: 'p' });
    const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
    cfg.providers.p.access = 'repo';
    cfg.providers.p.keep = ['/path/to/delegate-login'];
    writeFileSync(s.config, JSON.stringify(cfg));
    const r = cli(checkArgs(s, 'testing'));
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
    expect(r.stderr).toContain('key "keep" is not supported');
  });

  test('validateConfig accepts the documented shape, repo-mode providers for all six parts, and keeps the closed schema string', () => {
    const ok = validateConfig(JSON.stringify(good('/state')));
    expect(ok.ok).toBe(true);
    const repoCfg = validateConfig(JSON.stringify({
      schema: CONFIG_SCHEMA,
      providers: {
        alpha: {
          argv: ['/path/to/bin'],
          timeout_s: 60,
          model: 'model-a',
          access: 'repo',
          expose: Array.from({ length: 32 }, (_, i) => `/path/expose/${i}`),
        },
      },
      parts: Object.fromEntries(PARTS.map((p) => [p, 'alpha'])),
    }));
    expect(repoCfg.ok).toBe(true);
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
    const provider = { argv: ['/bin/delegate', '--ro'], timeout_s: 30, model: 'model-a', access: 'diff' as const, expose: [] as string[] };
    expect(callId(prompt, provider, 'alpha')).toBe(
      createHash('sha256').update(JSON.stringify([prompt, provider.argv, provider.model, 'alpha'])).digest('hex'),
    );
    expect(buildPrompt('testing', base, candidate, 'diff-body', 'checklist-body', undefined, 'diff')).toBe(prompt);
    const repoPrompt = buildPrompt('adversarial', base, candidate, 'diff-body', 'checklist-body', undefined, 'repo');
    const diffAdvPrompt = buildPrompt('adversarial', base, candidate, 'diff-body', 'checklist-body', undefined, 'diff');
    expect(repoPrompt.startsWith(REPO_POLICY)).toBe(true);
    expect(repoPrompt).not.toBe(diffAdvPrompt);
    expect(repoPrompt.slice(REPO_POLICY.length)).toBe(diffAdvPrompt.slice(DELEGATE_POLICY.length));
    expect(callId(repoPrompt, { ...provider, access: 'repo' }, 'alpha')).not.toBe(callId(diffAdvPrompt, provider, 'alpha'));
  });

  test('sandboxArgs orders hides after exposes, puts the copy bind and chdir last, and binds no hidden path', () => {
    const args = sandboxArgs({
      home: '/home/tester',
      copy: '/tmp/extend-delegate-1/copy',
      expose: [
        { kind: 'dir', path: '/home/tester/.codex/skills' },
        { kind: 'file', path: '/home/tester/.codex/auth.json', staged: '/tmp/extend-delegate-1/staged/0' },
      ],
      hidden: ['/work/repo', '/work/repo/.git', '/work/calls', '/run/user/1000', '/work/repo'],
      resolvDir: '/run/systemd/resolve',
    });
    expect(args).toContain('--share-net');
    expect(args).toContain('--die-with-parent');
    expect(args).toContain('--new-session');
    const lastExpose = args.lastIndexOf('/home/tester/.codex/auth.json');
    const firstHidden = args.indexOf('/work/repo');
    expect(firstHidden).toBeGreaterThan(lastExpose);
    expect(args.slice(-5)).toEqual(['--bind', '/tmp/extend-delegate-1/copy', '/tmp/extend-delegate-1/copy', '--chdir', '/tmp/extend-delegate-1/copy']);
    for (const hidden of ['/work/repo', '/work/repo/.git', '/work/calls', '/run/user/1000']) {
      for (let i = 0; i < args.length - 2; i++) {
        if (args[i] === '--bind') expect(args[i + 2]).not.toBe(hidden);
      }
    }
  });
});

describe('repository-mode sandbox and check', () => {
  const probe = probeSandbox();
  const runInProcess = async (argv: string[], deps?: Deps, envPatch?: Record<string, string | undefined>) => {
    const out: string[] = [];
    const err: string[] = [];
    const saved: Record<string, string | undefined> = {};
    if (envPatch) {
      for (const [k, v] of Object.entries(envPatch)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    try {
      const status = await main(argv, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }, deps);
      return { status, stdout: out.join(''), stderr: err.join(''), json: JSON.parse(out.join('').trim()) };
    } finally {
      if (envPatch) {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }
  };

  test('injected darwin or missing bwrap refuses repo-mode check and run with sandbox-unavailable while diff-only still checks ok', async () => {
    const s = setup(
      'nested',
      { 'repo-prov': { mode: 'clean', access: 'repo', expose: [FAKE] }, 'diff-prov': { mode: 'clean' } },
      { adversarial: 'repo-prov', testing: 'diff-prov' },
    );
    for (const deps of [{ platform: 'darwin' as const }, { platform: 'linux' as const, bwrapPaths: ['/nonexistent/bwrap'] }]) {
      const chk = await runInProcess([...checkArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)], deps);
      expect(chk.status).toBe(1);
      expect(chk.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
      const run = await runInProcess([...runArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)], deps);
      expect(run.status).toBe(1);
      expect(run.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
    }
    expect(existsSync(join(s.state, 'spawns.log'))).toBe(false);
    const diffChk = await runInProcess(checkArgs(s, 'testing'), { platform: 'darwin' });
    expect(diffChk.status).toBe(0);
    expect(diffChk.json).toMatchObject({
      v: 1, status: 'ok',
      parts: [{ part: 'testing', provider: 'diff-prov', model: 'model-diff-prov' }],
    });
  });

  test('expose equal to HOME or an ancestor of HOME, or relative HOME, refuses with config-malformed', async () => {
    const homeDir = fresh('fake-home');
    const sHome = setup('nested', { p: { mode: 'clean', access: 'repo', expose: [homeDir] } }, { testing: 'p' });
    const r1 = await runInProcess(checkArgs(sHome, 'testing'), undefined, { HOME: homeDir });
    expect(r1.status).toBe(1);
    expect(r1.json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });

    const sAncestor = setup('nested', { p: { mode: 'clean', access: 'repo', expose: [ scratch ] } }, { testing: 'p' });
    const r2 = await runInProcess(checkArgs(sAncestor, 'testing'), undefined, { HOME: homeDir });
    expect(r2.status).toBe(1);
    expect(r2.json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });

    const sRelHome = setup('nested', { p: { mode: 'clean', access: 'repo' } }, { testing: 'p' });
    const r3 = await runInProcess(checkArgs(sRelHome, 'testing'), undefined, { HOME: 'relative/home' });
    expect(r3.status).toBe(1);
    expect(r3.json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
  });

  test.if(probe)('check emits access: "repo" only on repo-mode parts and keeps diff-mode part rows at 3 keys', () => {
    const s = setup(
      'nested',
      { 'repo-prov': { mode: 'clean', access: 'repo', expose: [FAKE] }, 'diff-prov': { mode: 'clean' } },
      { testing: 'diff-prov', adversarial: 'repo-prov' },
    );
    const r = cli([...checkArgs(s, 'testing,adversarial'), '--adversarial', adversarialPath(s)]);
    expect(r.status).toBe(0);
    expect(r.json.parts).toEqual([
      { part: 'testing', provider: 'diff-prov', model: 'model-diff-prov' },
      { part: 'adversarial', provider: 'repo-prov', model: 'model-repo-prov', access: 'repo' },
    ]);
    expect(Object.keys(r.json.parts[0])).toEqual(['part', 'provider', 'model']);
    expect(Object.keys(r.json.parts[1])).toEqual(['part', 'provider', 'model', 'access']);
  });
  test.if(!probe)('check refuses with sandbox-unavailable when sandbox probe is false', () => {
    const s = setup('nested', { 'repo-prov': { mode: 'clean', access: 'repo', expose: [FAKE] } }, { adversarial: 'repo-prov' });
    const r = cli([...checkArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)]);
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  test.if(probe)('repo-probe runs inside a bubblewrap-sandboxed copy at the candidate SHA with throwaway expose layers, hidden paths and no remotes', async () => {
    const fakeHome = fresh('home');
    put(join(fakeHome, 'cred.txt'), 'SECRET-CRED\n');
    put(join(fakeHome, '.ssh', 'id_ed25519'), 'PRIVATE-KEY\n');
    const exposeDir = join(fakeHome, '.codex', 'skills');
    put(join(exposeDir, 'info.txt'), 'HOST-SKILL\n');
    const exposeFile = join(fakeHome, '.codex', 'config.toml');
    put(exposeFile, 'model = "o3"\n');
    const s = setup(
      'nested',
      { 'repo-prov': { mode: 'repo-probe', access: 'repo', expose: [FAKE, exposeDir, exposeFile, fresh('state-placeholder')] } },
      { adversarial: 'repo-prov' },
    );
    // The state dir is exposed read-only-in-effect: FAKE reads its inputs there, and every write it makes there is discarded.
    const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
    cfg.providers['repo-prov'].expose[3] = s.state;
    writeFileSync(s.config, JSON.stringify(cfg));
    writeFileSync(join(s.state, 'expose-dir.txt'), exposeDir);
    writeFileSync(join(s.state, 'calls-dir.txt'), s.calls);
    git(s.repo, 'remote', 'add', 'origin', 'https://example.invalid/repo.git');
    put(join(s.repo, '.gitignore'), 'ignored-secret.txt\n');
    git(s.repo, 'add', '.gitignore');
    git(s.repo, 'commit', '-q', '-m', 'ignore secret');
    s.candidate = git(s.repo, 'rev-parse', 'HEAD').stdout.trim();
    put(join(s.repo, 'ignored-secret.txt'), 'DONT-COPY-ME\n');

    const r = await runInProcess([...runArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)], undefined, { HOME: fakeHome });
    expect(r.status).toBe(0);
    expect(row(r.json, 'adversarial')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    const report = reportOf(s, r.json, 'adversarial');
    expect(report.cwd).not.toBe(s.repo);
    expect(report.head).toBe(s.candidate);
    expect(report.status).toBe('');
    expect(report.log).toContain('ignore secret');
    // /proc/keys and /proc/key-users are masked, so not even key descriptions are listed.
    expect(report.procKeys).toBe('');
    expect(report.remotes).toBe('');
    expect(report.pushStatus).not.toBe(0);
    expect(report.outside).toBe('REPO-ONLY-MARKER\n');
    expect(report.realRepoEntries.filter((e: string) => e !== '.git')).toEqual([]);
    expect(report.callsEntries).toEqual([]);
    expect(report.secretInReal).toBe(false);
    expect(report.secretInCopy).toBe(false);
    expect(report.homeCred).toBe(false);
    expect(report.sshExists).toBe(false);
    expect(report.runUser).toBe(false);
    expect(report.hostsLen).toBeGreaterThan(0);
    expect(report.exposedBefore).toBe('HOST-SKILL\n');
    expect(report.tmpdir).toBe('/tmp');
    expect(report.tmpBack).toBe('TMP-OK\n');
    // /var is a tmpfs (privileged daemons' path sockets live under it), and the passwd home is hidden even when HOME differs.
    expect(report.varLib).toBe(false);
    expect(report.passwdHome).toBeTruthy();
    expect(report.passwdHome).not.toBe(fakeHome);
    expect(report.passwdHomeEntries).toEqual([]);
    expect(report.prompt.startsWith(REPO_POLICY)).toBe(true);
    // Host state after the run: every exposed path is untouched (no write persists), the host repo has no clone-only.txt and still
    // has origin, and the disposable root is removed.
    expect(readFileSync(join(exposeDir, 'info.txt'), 'utf8')).toBe('HOST-SKILL\n');
    expect(existsSync(join(exposeDir, 'extra.txt'))).toBe(false);
    expect(existsSync(join(s.state, 'kept.txt'))).toBe(false);
    expect(existsSync(join(s.repo, 'clone-only.txt'))).toBe(false);
    expect(git(s.repo, 'remote').stdout.trim()).toBe('origin');
    expect(existsSync(report.cwd)).toBe(false);
  });
  test.if(!probe)('repo-probe twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup('nested', { 'repo-prov': { mode: 'repo-probe', access: 'repo', expose: [FAKE] } }, { adversarial: 'repo-prov' });
    const r = cli([...runArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)]);
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  test.if(probe)('escape-write cannot modify the host worktree, git objects, HOME, or /etc, and still returns a clean review', async () => {
    const fakeHome = fresh('home-esc');
    put(join(fakeHome, 'cred.txt'), 'HOST-CRED\n');
    const s = setup('nested', { esc: { mode: 'escape-write', access: 'repo', expose: [FAKE] } }, { testing: 'esc' });
    exposeState(s, 'esc');
    const r = await runInProcess(runArgs(s, 'testing'), undefined, { HOME: fakeHome });
    expect(r.status).toBe(0);
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    const attempts = reportOf(s, r.json, 'testing');
    expect(attempts.gitObjects).toBe('ENOENT');
    expect(['EACCES', 'EROFS']).toContain(attempts.etc);
    expect(['EACCES', 'EROFS']).toContain(attempts.etcHosts);
    expect(readFileSync(join(s.repo, 'changed.txt'), 'utf8')).toBe('one\nDIFF-MARKER\n');
    expect(existsSync(join(s.repo, 'escape.txt'))).toBe(false);
    expect(readFileSync(join(fakeHome, 'cred.txt'), 'utf8')).toBe('HOST-CRED\n');
    expect(readFileSync(FAKE, 'utf8')).toContain('escape-write');
  });
  test.if(!probe)('escape-write twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup('nested', { esc: { mode: 'escape-write', access: 'repo', expose: [FAKE] } }, { testing: 'esc' });
    const r = cli(runArgs(s, 'testing'));
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  test.if(probe)('background child inside bwrap dies with parent when the provider exits', async () => {
    // The detached child would connect to this socket 1.5 s after the provider exits; the PID namespace must end it first.
    const s = setup('nested', { bg: { mode: 'background', access: 'repo', expose: [FAKE] } }, { testing: 'bg' });
    const channel = await socketChannel(s.state);
    exposeState(s, 'bg');
    try {
      const r = cli(runArgs(s, 'testing'));
      expect(r.status).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect(channel.connections()).toBe(0);
    } finally { await channel.close(); }
  }, 15_000);
  test.if(!probe)('background twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup('nested', { bg: { mode: 'background', access: 'repo', expose: [FAKE] } }, { testing: 'bg' });
    const r = cli(runArgs(s, 'testing'));
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  test.if(probe)('repo-mode timeout records fallback_reason: timeout and removes the disposable root', () => {
    const s = setup('nested', { slow: { mode: 'sleep', timeout_s: 1, access: 'repo', expose: [FAKE] } }, { testing: 'slow' });
    const r = cli(runArgs(s, 'testing'));
    expect(r.status).toBe(4);
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'timeout', findings: [] });
  }, 15_000);
  test.if(!probe)('repo-mode timeout twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup('nested', { slow: { mode: 'sleep', timeout_s: 1, access: 'repo', expose: [FAKE] } }, { testing: 'slow' });
    const r = cli(runArgs(s, 'testing'));
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  test.if(probe)('missing expose path records fallback_reason: failed on that part without refusing a sibling diff-mode part, and replays without a second spawn', () => {
    const s = setup(
      'nested',
      { 'broken-repo': { mode: 'clean', access: 'repo', expose: [FAKE, '/nonexistent/expose-path-xyz'] }, 'good-diff': { mode: 'clean' } },
      { adversarial: 'broken-repo', testing: 'good-diff' },
    );
    const first = cli([...runArgs(s, 'testing,adversarial'), '--adversarial', adversarialPath(s)]);
    expect(first.status).toBe(4);
    expect(row(first.json, 'testing')).toMatchObject({ outcome: 'credited', fallback_reason: null, replay: false });
    expect(row(first.json, 'adversarial')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'failed', replay: false, dispatched: true });
    expect(readFileSync(join(s.state, 'spawns.log'), 'utf8').trim().split('\n')).toEqual(['clean']);
    // The saved result names the setup step that failed, so a sandbox setup failure is distinguishable from a provider exit.
    const savedSetup = JSON.parse(readFileSync(join(s.calls, `${row(first.json, 'adversarial').call_id}.json`), 'utf8'));
    expect(savedSetup.spawned.stderr).toContain('review-delegate: repo-mode setup failed (expose)');

    const second = cli([...runArgs(s, 'testing,adversarial'), '--adversarial', adversarialPath(s)]);
    expect(second.status).toBe(4);
    expect(row(second.json, 'testing').replay).toBe(true);
    expect(row(second.json, 'adversarial')).toMatchObject({ outcome: 'fell-back', fallback_reason: 'failed', replay: true, dispatched: false });
    expect(readFileSync(join(s.state, 'spawns.log'), 'utf8').trim().split('\n')).toEqual(['clean']);
  });
  test.if(!probe)('missing expose twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup('nested', { 'broken-repo': { mode: 'clean', access: 'repo', expose: [FAKE, '/nonexistent/expose-path-xyz'] } }, { adversarial: 'broken-repo' });
    const r = cli([...runArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)]);
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  test.if(probe)('host worktree change during a repo-mode run refuses with worktree-changed and marks dispatched parts worktree-changed', async () => {
    // The fake signals 'ready' over a localhost socket; the test mutates the host repository, then answers 'go'.
    const s = setup('nested', { sig: { mode: 'signal-wait', access: 'repo', expose: [FAKE] } }, { testing: 'sig' });
    let mutated = false;
    const channel = await socketChannel(s.state, (socket, data) => {
      if (!data.includes('ready')) return;
      put(join(s.repo, 'changed.txt'), 'mutated on host during repo-mode run\n');
      mutated = true;
      socket.write('go');
    });
    exposeState(s, 'sig');
    const r = await runInProcess(runArgs(s, 'testing')).finally(() => channel.close());
    expect(mutated).toBe(true);
    expect(r.status).toBe(1);
    expect(r.json.status).toBe('ran');
    expect(row(r.json, 'testing')).toMatchObject({ part: 'testing', outcome: 'fell-back', fallback_reason: 'worktree-changed', findings: [], dispatched: true });
    const files = readdirSync(s.calls).filter((name) => name.endsWith('.json'));
    expect(files.length).toBe(1);
    const saved = JSON.parse(readFileSync(join(s.calls, files[0]!), 'utf8'));
    expect(saved).toMatchObject({ v: 1, worktree_changed: true });
  }, 15_000);
  test.if(!probe)('worktree-changed twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup('nested', { sig: { mode: 'signal-wait', access: 'repo', expose: [FAKE] } }, { testing: 'sig' });
    const r = cli(runArgs(s, 'testing'));
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  test.if(probe)('mixed diff and repo call in one invocation gives diff mode DELEGATE_POLICY and repo mode REPO_POLICY and credits both', () => {
    const s = setup(
      'nested',
      {
        'diff-inspect': { mode: 'findings' },
        'repo-probe': { mode: 'repo-probe', access: 'repo', expose: [FAKE, fresh('expose-mix')] },
      },
      { testing: 'diff-inspect', adversarial: 'repo-probe' },
    );
    const exposeDir = JSON.parse(readFileSync(s.config, 'utf8')).providers['repo-probe'].expose[1];
    put(join(exposeDir, 'info.txt'), 'MIX-SKILL\n');
    exposeState(s, 'repo-probe');
    writeFileSync(join(s.state, 'expose-dir.txt'), exposeDir);
    writeFileSync(join(s.state, 'calls-dir.txt'), s.calls);

    const r = cli([...runArgs(s, 'testing,adversarial'), '--adversarial', adversarialPath(s)]);
    expect(r.status).toBe(0);
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    expect(row(r.json, 'adversarial')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    const report = reportOf(s, r.json, 'adversarial');
    expect(report.prompt.startsWith(REPO_POLICY)).toBe(true);
    expect(report.cwd).not.toBe(s.repo);
    // The launcher starts with a HOME override (cli() sets a fresh one), the case where Bun's userInfo() reports HOME, not the passwd home.
    expect(report.passwdHome).toBeTruthy();
    expect(report.passwdHome).not.toBe(report.home);
    expect(report.passwdHomeEntries).toEqual([]);
  });
  test.if(!probe)('mixed call twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup(
      'nested',
      { 'diff-inspect': { mode: 'findings' }, 'repo-probe': { mode: 'repo-probe', access: 'repo', expose: [FAKE] } },
      { testing: 'diff-inspect', adversarial: 'repo-probe' },
    );
    const r = cli([...runArgs(s, 'testing,adversarial'), '--adversarial', adversarialPath(s)]);
    expect(r.status).toBe(1);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  // Value: protects=/review-and-prep's --candidate is a frozen snapshot commit no ref reaches; fails_when=the copy only carries ref-reachable objects; why_new=cycle-1 finding (QA reproduced); seam=none
  test.if(probe)('repo mode checks out an unreferenced snapshot candidate, including the untracked file it captured', async () => {
    const s = setup('nested', { 'repo-prov': { mode: 'repo-probe', access: 'repo', expose: [FAKE, fresh('expose-snap')] } }, { adversarial: 'repo-prov' });
    const exposeDir = JSON.parse(readFileSync(s.config, 'utf8')).providers['repo-prov'].expose[1];
    put(join(exposeDir, 'info.txt'), 'SNAP-SKILL\n');
    exposeState(s, 'repo-prov');
    writeFileSync(join(s.state, 'expose-dir.txt'), exposeDir);
    writeFileSync(join(s.state, 'calls-dir.txt'), s.calls);
    put(join(s.repo, 'snapshot-only.txt'), 'UNTRACKED-IN-SNAPSHOT\n');
    const env = { ...process.env, GIT_INDEX_FILE: join(fresh('snap-index'), 'index') };
    spawnSync('git', ['-C', s.repo, 'read-tree', 'HEAD'], { env });
    spawnSync('git', ['-C', s.repo, 'add', '-A'], { env });
    const tree = spawnSync('git', ['-C', s.repo, 'write-tree'], { env, encoding: 'utf8' }).stdout.trim();
    s.candidate = git(s.repo, 'commit-tree', tree, '-p', 'HEAD', '-m', 'snapshot').stdout.trim();
    expect(s.candidate).toMatch(/^[0-9a-f]{40}$/);
    expect(git(s.repo, 'for-each-ref', '--contains', s.candidate).stdout.trim()).toBe('');
    const r = await runInProcess([...runArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)]);
    expect(row(r.json, 'adversarial')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    const report = reportOf(s, r.json, 'adversarial');
    expect(report.head).toBe(s.candidate);
    expect(report.snapshotOnly).toBe(true);
    expect(report.status).toBe('');
  });
  test.if(!probe)('snapshot-candidate twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup('nested', { 'repo-prov': { mode: 'repo-probe', access: 'repo', expose: [FAKE] } }, { adversarial: 'repo-prov' });
    const r = cli([...runArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)]);
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  // Value: protects=repository setup on the host runs no filter or setting from global or system git config; fails_when=setup git inherits ~/.gitconfig; why_new=cycle-1 finding (Codex P1); seam=none
  test.if(probe)('repo-mode setup ignores global git config, so a filter the candidate selects never runs on the host', async () => {
    const fakeHome = fresh('home-filter');
    const marker = join(fresh('filter-marker'), 'smudge-ran.txt');
    put(join(fakeHome, '.gitconfig'), `[filter "evil"]\n\tsmudge = "sh -c 'echo ran > ${marker}; cat'"\n`);
    const s = setup('nested', { f: { mode: 'clean', access: 'repo', expose: [FAKE] } }, { testing: 'f' });
    put(join(s.repo, '.gitattributes'), '*.txt filter=evil\n');
    git(s.repo, 'add', '.gitattributes');
    git(s.repo, 'commit', '-q', '-m', 'attributes');
    s.candidate = git(s.repo, 'rev-parse', 'HEAD').stdout.trim();
    const r = await runInProcess(runArgs(s, 'testing'), undefined, { HOME: fakeHome });
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    expect(existsSync(marker)).toBe(false);
  });
  test.if(!probe)('global-git-config twin refuses with sandbox-unavailable when probe is false', () => {
    const s = setup('nested', { f: { mode: 'clean', access: 'repo', expose: [FAKE] } }, { testing: 'f' });
    expect(cli(runArgs(s, 'testing')).json).toEqual({ v: 1, status: 'refused', reason: 'sandbox-unavailable' });
  });

  // Value: protects=the HOME guard holds for symlinked spellings, the passwd home and the sandbox's own tmpfs roots; fails_when=entries are compared only as written; why_new=cycle-1 finding (security reproduced); seam=none
  test('an expose entry that resolves to HOME, the passwd home or an ancestor, or names a hidden root, refuses with config-malformed', async () => {
    const base = fresh('symhome');
    const realHome = join(base, 'var', 'home', 'kb');
    mkdirSync(realHome, { recursive: true });
    symlinkSync(join('var', 'home'), join(base, 'home'));
    const entries: [string, string][] = [['expose', join(base, 'home', 'kb')], ['expose', join(base, 'home')], ['expose', '/tmp'], ['expose', '/var'], ['expose', '/run'], ['expose', tmpdir()]];
    if (PASSWD_HOME && PASSWD_HOME !== '/') entries.push(['expose', PASSWD_HOME]);
    for (const [list, entry] of entries) {
      const s = setup('nested', { p: { mode: 'clean', access: 'repo', [list]: [entry] } }, { testing: 'p' });
      const r = await runInProcess(checkArgs(s, 'testing'), undefined, { HOME: realHome });
      expect(r.json, `${list} ${entry}`).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
    }
  });

  // Value: protects=a provider the sandbox would hide refuses at check instead of failing every run; fails_when=argv[0] visibility is not checked; why_new=cycle-1 finding (adversarial, red team); seam=none
  test('a repo-mode provider whose argv[0] lies under a hidden path refuses with config-malformed unless expose covers it', async () => {
    const fakeHome = fresh('home-argv');
    const tool = join(fakeHome, 'bin', 'provider');
    put(tool, '#!/bin/sh\n');
    chmodSync(tool, 0o755);
    const s = setup('nested', { p: { mode: 'clean', access: 'repo' } }, { testing: 'p' });
    const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
    cfg.providers.p.argv = [tool];
    writeFileSync(s.config, JSON.stringify(cfg));
    const hidden = await runInProcess(checkArgs(s, 'testing'), undefined, { HOME: fakeHome });
    expect(hidden.json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
    cfg.providers.p.expose = [join(fakeHome, 'bin')];
    writeFileSync(s.config, JSON.stringify(cfg));
    const covered = await runInProcess(checkArgs(s, 'testing'), undefined, { HOME: fakeHome });
    expect(covered.json.reason).not.toBe('config-malformed');
  });

  // Value: protects=fixing expose after a failed repo-mode call dispatches again, while diff-mode call ids keep their v0.75.0 inputs; fails_when=callId ignores repo-mode settings; why_new=cycle-1 finding (adversarial); seam=none
  test('a repo-mode call id covers access and expose, while a diff-mode call id keeps its v0.75.0 inputs', () => {
    const base = { argv: ['/bin/x'], timeout_s: 30, model: 'm' };
    const legacy = createHash('sha256').update(JSON.stringify(['p', base.argv, base.model, 'alpha'])).digest('hex');
    expect(callId('p', base, 'alpha')).toBe(legacy);
    expect(callId('p', { ...base, access: 'diff' }, 'alpha')).toBe(legacy);
    const repo = { ...base, access: 'repo' as const, expose: ['/a', '/b'] };
    expect(callId('p', repo, 'alpha')).not.toBe(legacy);
    expect(callId('p', { ...repo, expose: ['/a', '/c'] }, 'alpha')).not.toBe(callId('p', repo, 'alpha'));
    expect(callId('p', { ...repo, expose: [] }, 'alpha')).not.toBe(callId('p', repo, 'alpha'));
  });

  // Value: protects=a parent expose layer mounts before a listed path inside it, and /var (privileged daemons' sockets) is hidden; fails_when=mount order follows list order or /var stays visible; why_new=review findings (red team, adversarial); seam=none
  test('sandboxArgs mounts a parent expose layer before any listed path inside it, and hides /var with /var/tmp and /var/run restored', () => {
    const args = (expose: Parameters<typeof sandboxArgs>[0]['expose']) => sandboxArgs({ home: '/h', hidden: [], resolvDir: null, expose, copy: '/tmp/c/repo' });
    const nested = args([{ kind: 'file', path: '/h/.codex/config.toml', staged: '/tmp/c/staged/0' }, { kind: 'dir', path: '/h/.codex' }]);
    expect(nested.indexOf('/h/.codex')).toBeLessThan(nested.indexOf('/h/.codex/config.toml'));
    expect(nested.join(' ')).not.toMatch(/--bind \/h\/\.codex \/h\/\.codex/);
    expect(args([]).join(' ')).toContain('--tmpfs /var --tmpfs /var/tmp --symlink ../run /var/run');
  });

  // Value: protects=repo mode hides the main checkout and every linked worktree, not only the reviewed one; fails_when=worktree paths are dropped from the hidden list; why_new=cycle-1 finding (security, adversarial); seam=none
  test('parseWorktreeList returns the main checkout and every linked worktree from git porcelain output', () => {
    const { repo } = repository();
    const linked = join(fresh('linked'), 'wt');
    expect(git(repo, 'worktree', 'add', '-q', '--detach', linked).status).toBe(0);
    const paths = parseWorktreeList(git(repo, 'worktree', 'list', '--porcelain', '-z').stdout).map((path) => realpathSync(path));
    expect(paths).toEqual([realpathSync(repo), realpathSync(linked)]);
    expect(parseWorktreeList('')).toEqual([]);
  });

  // Value: protects=a symlinked command needs every hidden form exposed, since bwrap mounts entries at their written paths; fails_when=one covered form passes; why_new=cycle-2 finding (security, adversarial); seam=none
  test('a symlinked argv[0] refuses with config-malformed unless every hidden form lies inside a listed path', async () => {
    const fakeHome = fresh('home-argv-link');
    put(join(fakeHome, 'share', 'tool'), '#!/bin/sh\n');
    chmodSync(join(fakeHome, 'share', 'tool'), 0o755);
    mkdirSync(join(fakeHome, 'bin'), { recursive: true });
    symlinkSync(join('..', 'share', 'tool'), join(fakeHome, 'bin', 'tool'));
    const s = setup('nested', { p: { mode: 'clean', access: 'repo' } }, { testing: 'p' });
    const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
    cfg.providers.p.argv = [join(fakeHome, 'bin', 'tool')];
    cfg.providers.p.expose = [join(fakeHome, 'bin')];
    writeFileSync(s.config, JSON.stringify(cfg));
    expect((await runInProcess(checkArgs(s, 'testing'), undefined, { HOME: fakeHome })).json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
    cfg.providers.p.expose = [join(fakeHome, 'bin'), join(fakeHome, 'share')];
    writeFileSync(s.config, JSON.stringify(cfg));
    expect((await runInProcess(checkArgs(s, 'testing'), undefined, { HOME: fakeHome })).json.reason).not.toBe('config-malformed');
  });

  // Value: protects=every link hop of argv[0] must be visible, and a symlinked ancestor of HOME does not refuse a visible command; fails_when=only the written and fully resolved forms are compared; why_new=cycle-3 findings (security, adversarial); seam=none
  test('argv[0] coverage follows each link hop and resolves symlinked ancestors before comparing', async () => {
    const h = fresh('home-hops');
    put(join(h, 'share', 'tool'), '#!/bin/sh\n');
    chmodSync(join(h, 'share', 'tool'), 0o755);
    mkdirSync(join(h, 'bin'), { recursive: true });
    symlinkSync(join(h, 'share', 'tool'), join(h, 'bin', 'tool'));
    const outerDir = fresh('outer-bin');
    symlinkSync(join(h, 'bin', 'tool'), join(outerDir, 'tool'));
    const s = setup('nested', { p: { mode: 'clean', access: 'repo' } }, { testing: 'p' });
    const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
    cfg.providers.p.argv = [join(outerDir, 'tool')];
    cfg.providers.p.expose = [outerDir, join(h, 'share')];
    writeFileSync(s.config, JSON.stringify(cfg));
    // The middle hop (h/bin/tool) is hidden and no entry contains it.
    expect((await runInProcess(checkArgs(s, 'testing'), undefined, { HOME: h })).json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
    // HOME written through a symlinked ancestor: the command is visible through its entry, so check does not refuse it.
    const base = fresh('symhome-argv');
    mkdirSync(join(base, 'var', 'home', 'kb', '.tool', 'bin'), { recursive: true });
    symlinkSync(join('var', 'home'), join(base, 'home'));
    const home = join(base, 'home', 'kb');
    put(join(home, '.tool', 'bin', 'run'), '#!/bin/sh\n');
    chmodSync(join(home, '.tool', 'bin', 'run'), 0o755);
    cfg.providers.p.argv = [join(home, '.tool', 'bin', 'run')];
    cfg.providers.p.expose = [join(home, '.tool')];
    writeFileSync(s.config, JSON.stringify(cfg));
    expect((await runInProcess(checkArgs(s, 'testing'), undefined, { HOME: home })).json.reason).not.toBe('config-malformed');
  });

  // Value: protects=an entry inside XDG_RUNTIME_DIR is refused, since the runtime dir's tmpfs would cover it at run time; fails_when=inside entries pass check; why_new=cycle-3 findings (security, adversarial); seam=none
  test('an expose entry inside XDG_RUNTIME_DIR refuses with config-malformed', async () => {
    const xdg = fresh('xdg-inside');
    mkdirSync(join(xdg, 'provider'), { recursive: true });
    const s = setup('nested', { p: { mode: 'clean', access: 'repo', expose: [join(xdg, 'provider')] } }, { testing: 'p' });
    const r = await runInProcess(checkArgs(s, 'testing'), undefined, { XDG_RUNTIME_DIR: xdg });
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
  });

  // Value: protects=XDG_RUNTIME_DIR (session bus, agents) cannot be re-bound through another spelling; fails_when=the runtime dir is not a hidden root; why_new=cycle-2 finding (security, adversarial); seam=none
  test('an expose entry that resolves to XDG_RUNTIME_DIR or above refuses with config-malformed', async () => {
    const xdg = fresh('xdg');
    const link = join(fresh('xdg-alias'), 'runtime');
    symlinkSync(xdg, link);
    const s = setup('nested', { p: { mode: 'clean', access: 'repo', expose: [link] } }, { testing: 'p' });
    const r = await runInProcess(checkArgs(s, 'testing'), undefined, { XDG_RUNTIME_DIR: xdg });
    expect(r.json).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
  });

  // Value: protects=a TMPDIR outside /tmp is hidden like /tmp, so sibling parts' staged copies stay private; fails_when=the runner's temporary directory is not mounted over; why_new=cycle-2 finding (security, adversarial); seam=none
  test('sandboxArgs puts a tmpfs over the private directories before any expose mount', () => {
    const args = sandboxArgs({ home: '/h', privateDirs: ['/scratch/tmp', '/home/someone'], hidden: [], resolvDir: null, expose: [{ kind: 'dir', path: '/scratch/tmp/x' }], copy: '/scratch/tmp/c/repo' });
    const joined = args.join(' ');
    expect(joined).toContain('--tmpfs /scratch/tmp');
    expect(joined).toContain('--tmpfs /home/someone');
    expect(args.indexOf('/scratch/tmp')).toBeLessThan(args.indexOf('--overlay-src'));
  });

  // Value: protects=no listed path shows the live repository or the calls directory, while the runner's own files may be exposed (writes are discarded); fails_when=the repository is not a guarded root; why_new=review findings (security, Codex); seam=none
  test('an expose entry at or inside the reviewed repository or the calls directory refuses with config-malformed at run', async () => {
    const s = setup('nested', { p: { mode: 'clean', access: 'repo', expose: [FAKE] } }, { testing: 'p' });
    const withExpose = (entry: string) => {
      const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
      cfg.providers.p.expose = [FAKE, ...RUNTIME_EXPOSE, entry];
      writeFileSync(s.config, JSON.stringify(cfg));
    };
    mkdirSync(join(s.repo, 'sub'), { recursive: true });
    for (const entry of [s.repo, join(s.repo, 'sub'), s.calls]) {
      withExpose(entry);
      const r = await runInProcess(runArgs(s, 'testing'));
      expect(r.json, entry).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
      // The refusal's detail names the provider, the entry and the rule it breaks.
      expect(r.stderr, entry).toContain(`provider p expose entry ${JSON.stringify(entry)} is at or inside the reviewed repository or the calls directory`);
    }
    // Exposing the runner's own configuration is allowed: nothing written to it persists.
    withExpose(dirname(s.config));
    expect((await runInProcess(checkArgs(s, 'testing'))).json.reason).not.toBe('config-malformed');
  });

  // Value: protects=an expose entry above the reviewed repository and the calls directory runs, and the later tmpfs mounts still hide both; fails_when=setup refuses an entry above a hidden repository path, or the hide mounts come before the expose layers; why_new=continuation cycle-3 finding (adversarial, testing); seam=none
  test.if(probe)('an expose entry above the reviewed repository runs, and the repository and the calls directory stay hidden', async () => {
    const s = setup('nested', { 'repo-prov': { mode: 'repo-probe', access: 'repo', expose: [FAKE] } }, { adversarial: 'repo-prov' });
    const exposeDir = fresh('expose-above');
    put(join(exposeDir, 'info.txt'), 'HOST-SKILL\n');
    writeFileSync(join(s.state, 'expose-dir.txt'), exposeDir);
    writeFileSync(join(s.state, 'calls-dir.txt'), s.calls);
    // The scratch root holds the repository, the calls directory, the state dir and exposeDir.
    const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
    cfg.providers['repo-prov'].expose = [FAKE, ...RUNTIME_EXPOSE, dirname(s.repo)];
    writeFileSync(s.config, JSON.stringify(cfg));
    const r = await runInProcess([...runArgs(s, 'adversarial'), '--adversarial', adversarialPath(s)]);
    expect(r.status).toBe(0);
    expect(row(r.json, 'adversarial')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    const report = reportOf(s, r.json, 'adversarial');
    expect(report.head).toBe(s.candidate);
    expect(report.outside).toBe('REPO-ONLY-MARKER\n');
    expect(report.exposedBefore).toBe('HOST-SKILL\n');
    expect(report.realRepoEntries.filter((e: string) => e !== '.git')).toEqual([]);
    expect(report.callsEntries).toEqual([]);
    expect(readFileSync(join(exposeDir, 'info.txt'), 'utf8')).toBe('HOST-SKILL\n');
    expect(existsSync(join(s.repo, 'clone-only.txt'))).toBe(false);
  });

  // Value: protects=no symlink that vanishes with a hidden root is trusted (bwrap mounts and execs the written spelling), while a symlink inside a listed directory survives; fails_when=symlinked ancestors pass, or a working link inside an exposed dir is refused; why_new=review findings (Codex, adversarial, testing); seam=none
  test('a path with a symlink below the deepest hidden root around it refuses, and a symlink inside an exposed directory is allowed', async () => {
    const h = fresh('home-symlink');
    put(join(h, 'real', 'bin', 'tool'), '#!/bin/sh\n');
    chmodSync(join(h, 'real', 'bin', 'tool'), 0o755);
    symlinkSync(join(h, 'real'), join(h, 'link'));
    put(join(h, 'rt', 'installs', '22.1.0', 'bin', 'tool'), '#!/bin/sh\n');
    chmodSync(join(h, 'rt', 'installs', '22.1.0', 'bin', 'tool'), 0o755);
    symlinkSync('22.1.0', join(h, 'rt', 'installs', 'latest'));
    const s = setup('nested', { p: { mode: 'clean', access: 'repo' } }, { testing: 'p' });
    const verdict = async (expose: string[], argv0: string) => {
      const cfg = JSON.parse(readFileSync(s.config, 'utf8'));
      cfg.providers.p = { ...cfg.providers.p, argv: [argv0, ...cfg.providers.p.argv.slice(1)], expose: [...expose, ...RUNTIME_EXPOSE] };
      writeFileSync(s.config, JSON.stringify(cfg));
      return (await runInProcess(checkArgs(s, 'testing'), undefined, { HOME: h })).json.reason;
    };
    // A listed entry, or argv[0] alone, written through h/link (a symlink below HOME, which the HOME tmpfs drops).
    expect(await verdict([join(h, 'link', 'bin')], process.execPath)).toBe('config-malformed');
    expect(await verdict([join(h, 'real', 'bin')], join(h, 'link', 'bin', 'tool'))).toBe('config-malformed');
    expect(await verdict([join(h, 'link', 'bin')], join(h, 'real', 'bin', 'tool'))).toBe('config-malformed');
    // Positive controls: the real spelling, and a version alias inside an exposed directory (the overlay keeps the link).
    expect(await verdict([join(h, 'real', 'bin')], join(h, 'real', 'bin', 'tool'))).not.toBe('config-malformed');
    expect(await verdict([join(h, 'rt')], join(h, 'rt', 'installs', 'latest', 'bin', 'tool'))).not.toBe('config-malformed');
  });

  // Value: protects=procfs, devices, the shared /var/tmp and the account's runtime dir cannot be re-bound, with or without XDG_RUNTIME_DIR; fails_when=those roots are missing from the guard; why_new=continuation cycle-1 finding (adversarial); seam=none
  test('an entry at /proc, /dev, /sys, /var/tmp or the account runtime dir refuses with config-malformed even without XDG_RUNTIME_DIR', async () => {
    const s = setup('nested', { p: { mode: 'clean', access: 'repo', expose: [FAKE] } }, { testing: 'p' });
    for (const entry of ['/proc', '/dev', '/sys', '/var/tmp', `/run/user/${process.getuid?.() ?? 0}`]) {
      const cfg = JSON.parse(readFileSync(s.config, 'utf8')); cfg.providers.p.expose = [FAKE, ...RUNTIME_EXPOSE, entry]; writeFileSync(s.config, JSON.stringify(cfg));
      expect((await runInProcess(checkArgs(s, 'testing'), undefined, { XDG_RUNTIME_DIR: undefined })).json, entry).toEqual({ v: 1, status: 'refused', reason: 'config-malformed' });
    }
  });

  // Value: protects=sandboxed code cannot read or change keys in the account's kernel keyrings; fails_when=no seccomp filter blocks keyctl; why_new=continuation cycle-1 finding (Codex reproduced); seam=python3 ctypes syscall
  test.if(probe && existsSync('/usr/bin/python3'))('repo mode refuses kernel keyring system calls inside the sandbox', () => {
    const s = setup('nested', { k: { mode: 'keyring', access: 'repo', expose: [FAKE] } }, { testing: 'k' });
    const r = cli(runArgs(s, 'testing'));
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    expect(reportOf(s, r.json, 'testing').keyring).toBe('-1 1');
  });

  test('sandboxArgs skips the HOME tmpfs when HOME is empty (a HOME that does not exist has nothing to hide)', () => {
    const args = sandboxArgs({ home: '', hidden: [], resolvDir: null, expose: [], copy: '/tmp/c/repo' });
    for (let i = 0; i < args.length - 1; i++) if (args[i] === '--tmpfs') expect(args[i + 1]).not.toBe('');
  });

  // Value: protects=an earlier part's deadline and output handling while a later repo-mode part prepares its copy; fails_when=repository setup blocks the event loop; why_new=cycle-1 finding (Codex reproduced); seam=PATH git shim
  test.if(probe)('a slow repo-mode setup never makes an earlier diff-mode part that finished in time read as a timeout', async () => {
    const shim = fresh('git-shim');
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    put(join(shim, 'git'), `#!/bin/sh\ncase " $* " in *" clone "*|*" fetch "*) sleep 4 ;; esac\nexec ${realGit} "$@"\n`);
    chmodSync(join(shim, 'git'), 0o755);
    const s = setup('nested', { quick: { mode: 'clean', timeout_s: 2 }, slow: { mode: 'clean', access: 'repo', expose: [FAKE] } }, { testing: 'quick', adversarial: 'slow' });
    const r = await runInProcess([...runArgs(s, 'testing,adversarial'), '--adversarial', adversarialPath(s)], undefined, { PATH: `${shim}:${process.env.PATH}` });
    expect(row(r.json, 'testing')).toMatchObject({ outcome: 'credited', fallback_reason: null });
    expect(row(r.json, 'adversarial')).toMatchObject({ outcome: 'credited', fallback_reason: null });
  }, 30_000);
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
    expect([...PART_KEYS]).toEqual([
      'part', 'provider', 'model', 'call_id', 'replay', 'dispatched', 'dispatched_at', 'returned_at', 'wall_ms',
      'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'parse', 'verdict', 'outcome', 'fallback_reason', 'findings',
    ]);
    expect(RECEIPT_KEYS).toEqual({
      part: 'part', provider: 'provider', model: 'model', outcome: 'outcome', reason: 'fallback_reason', wall_ms: 'wall_ms',
      input_tokens: 'input_tokens', output_tokens: 'output_tokens', cache_read_input_tokens: 'cache_read_input_tokens',
      cache_creation_input_tokens: 'cache_creation_input_tokens', findings: 'findings', call: 'call_id',
    });
    expect([...FALLBACK_REASONS]).toEqual(['unresolved-claim', 'timeout', 'failed', 'refused', 'needs-context', 'uncredited', 'unparsed-finding', 'worktree-changed']);
    for (const source of Object.values(RECEIPT_KEYS)) expect(PART_KEYS).toContain(source);
    expect(Object.keys(RECEIPT_KEYS)).toEqual(['part', 'provider', 'model', 'outcome', 'reason', 'wall_ms', 'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'findings', 'call']);
    const s = setup('nested', { p: { mode: 'clean' } }, { testing: 'p' });
    const chk = cli(checkArgs(s, 'testing'));
    expect(Object.keys(chk.json)).toEqual(['v', 'status', 'config_sha256', 'parts']);
    expect(Object.keys(chk.json.parts[0])).toEqual(['part', 'provider', 'model']);
    const run = cli(runArgs(s, 'testing'));
    expect(Object.keys(run.json)).toEqual(['v', 'status', 'config_sha256', 'parts']);
    expect(Object.keys(row(run.json, 'testing'))).toEqual([...PART_KEYS]);
    const docs = readFileSync(join(REPO, 'docs', 'delegated-review.md'), 'utf8').replace(/\s+/g, ' ');
    expect(docs).toContain(PART_KEYS.join(' '));
    for (const reason of [...FALLBACK_REASONS, ...REFUSAL_REASONS]) expect(docs, reason).toContain(`\`${reason}\``);
  });
});

describe('documentation', () => {
  test('the example configurations validate and name only placeholder labels, paths and models', () => {
    const docs = readFileSync(join(REPO, 'docs', 'delegated-review.md'), 'utf8');
    const blocks = [...docs.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const example of blocks) {
      const checked = validateConfig(example);
      expect(checked.ok).toBe(true);
      if (!checked.ok) continue;
      expect(Object.keys(checked.config.providers).every((label) => /^provider-[a-z]$/.test(label))).toBe(true);
      for (const provider of Object.values(checked.config.providers)) {
        expect(provider.argv[0]).toMatch(/^\/path\/to\//);
        expect(provider.model).toMatch(/^model-[a-z]$/);
        for (const entry of provider.expose ?? []) {
          expect(entry).toMatch(/^\/path\/to\//);
        }
      }
    }
    const first = validateConfig(blocks[0]!);
    expect(first.ok).toBe(true);
    if (first.ok) expect(Object.keys(first.config.parts).sort()).toEqual([...PARTS].sort());
    const second = validateConfig(blocks[1]!);
    expect(second.ok).toBe(true);
    if (second.ok) {
      const attackerMapped = ATTACKER_PARTS.some((part) => {
        const label = second.config.parts[part];
        return label !== undefined && second.config.providers[label]?.access === 'repo';
      });
      expect(attackerMapped).toBe(true);
    }
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

  test('the delegate-repo-access acceptance record names pending RR1, release-note input and non-claims', () => {
    const record = readFileSync(join(REPO, 'docs', 'acceptance', 'delegate-repo-access.md'), 'utf8');
    expect(record).toContain('| `RR1` | pending |');
    expect(record).toContain('_release: minor');
    expect(record).toContain('User-facing change:');
    expect(record).toContain('Upgrade risk:');
    expect(record).toContain('No real run backs it yet');
    expect(record).toContain('297f50c7e1d46aab1404f5f2e8a9584af76ad6b2');
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
