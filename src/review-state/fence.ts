import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateStoredState } from './state.ts';

export const FULL_REVIEW_RECORD_PREFIX = 'FULL_REVIEW_RECORD: ' as const;
export const CYCLE_1_BASELINE_KIND = 'cycle-1-baseline' as const;
export const CYCLE_1_FIX_REVIEW_KIND = 'cycle-1-fix-review' as const;
export const FULL_REVIEW_RECORD_KINDS = [CYCLE_1_BASELINE_KIND, CYCLE_1_FIX_REVIEW_KIND] as const;
export const FULL_REVIEW_RECORD_BOUNDARIES = ['before-fix', 'next-cycle', 'stop'] as const;
export const CYCLE_1_BASELINE_SCHEMA = 'review-and-prep-cycle-1-baseline/v1' as const;
export const CYCLE_1_FIX_REVIEW_SCHEMA = 'review-and-prep-cycle-1-fix-review/v1' as const;
export const FULL_REVIEW_RECORD_SCHEMAS = [CYCLE_1_BASELINE_SCHEMA, CYCLE_1_FIX_REVIEW_SCHEMA] as const;
export const RECORD_MISS_SCHEMA = 'review-and-prep-record-miss/v1' as const;

export type FullReviewRecordResult = {
  message: string;
  exitCode: 0 | 1 | 2 | 3;
};

class FenceExit {
  constructor(
    readonly message: string,
    readonly exitCode: 0 | 1 | 2 | 3,
  ) {}
}

export function fullReviewRecordHelp(): string {
  return `review-state full-review-record — write and check /review-and-prep cycle-1 full-review records

Usage:
  bin/review-state full-review-record WORKSPACE DIR write KIND FILE
  bin/review-state full-review-record WORKSPACE DIR check KIND BOUNDARY

Positional arguments:
  WORKSPACE   Git work tree path for commit-tree checks
  DIR         Invocation evidence directory
  write|check Action to run (write a record from FILE, or check at BOUNDARY)
  KIND        cycle-1-baseline | cycle-1-fix-review
  FILE        Assembled JSON record file (for write)
  BOUNDARY    before-fix | next-cycle | stop (for check)

Files in DIR:
  DIR/KIND.json         Written once (${CYCLE_1_BASELINE_SCHEMA} or ${CYCLE_1_FIX_REVIEW_SCHEMA})
  DIR/KIND.missed.json  Written by a next-cycle check when DIR/KIND.json is absent (${RECORD_MISS_SCHEMA})

Environment:
  REVIEW_STATE_DIR  When set on a cycle-1-baseline write, reads REVIEW_STATE_DIR/review-run-state.json
                    through validateStoredState and requires the cycle-1 local full pass, its completed
                    required voices, and each probe-<id> gate on that pass's candidate commit.

Output (one line on stdout; this line is not a review-state result envelope):
  FULL_REVIEW_RECORD: written <kind>; provenance=<write-point|late>; sha256=<64 hex>
  FULL_REVIEW_RECORD: present <kind>; provenance=<write-point|late>; completed=<true|pending-fix-review|false>
  FULL_REVIEW_RECORD: present <kind>; provenance=<write-point|late>; fix-reviewed=<true|false>
  FULL_REVIEW_RECORD: missing <kind>
  FULL_REVIEW_RECORD: missed <kind> at <boundary|unknown|unreadable>
  FULL_REVIEW_RECORD: unreadable <kind>: <json|field|miss record (code)>
  FULL_REVIEW_RECORD: exists <kind>
  FULL_REVIEW_RECORD: invalid <kind>: <kind|action|boundary|json|field|record write (code)>
  FULL_REVIEW_RECORD: refused <kind>: <reason>

Exit codes: 0 written|present · 1 missing|missed|unreadable · 2 exists · 3 invalid|refused
Docs: skills/review-and-prep.md (### Record cycle 1's full-review baseline), docs/designs/review-run-state.md D8
`;
}

export function runFullReviewRecord(args: readonly string[], env: NodeJS.ProcessEnv): FullReviewRecordResult {
  const [ws, evDir, action, kind, arg] = args;
  const out = (msg: string, code: 0 | 1 | 2 | 3): never => {
    throw new FenceExit(msg, code);
  };
  const hex40 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
  const hex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
  const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');
  const gitTree = (rev: string): string | null => {
    try {
      return execFileSync('git', ['-C', ws!, 'rev-parse', `${rev}^{tree}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      }).trim();
    } catch {
      return null;
    }
  };

  try {
    if (kind !== CYCLE_1_BASELINE_KIND && kind !== CYCLE_1_FIX_REVIEW_KIND) {
      out(`invalid ${String(kind)}: kind`, 3);
    }
    const isBase = kind === CYCLE_1_BASELINE_KIND;
    const schema = isBase ? CYCLE_1_BASELINE_SCHEMA : CYCLE_1_FIX_REVIEW_SCHEMA;
    const recPath = path.join(evDir!, `${kind}.json`);
    const missPath = path.join(evDir!, `${kind}.missed.json`);
    const readMiss = (): { raw: Buffer; data: Record<string, unknown> } | null => {
      if (!fs.existsSync(missPath)) return null;
      try {
        const raw = fs.readFileSync(missPath);
        const data = JSON.parse(raw.toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid miss record');
        return { raw, data: data as Record<string, unknown> };
      } catch {
        return { raw: Buffer.alloc(0), data: { boundary: 'unreadable' } };
      }
    };
    const validate = (r: any, mode: 'write' | 'check'): string | null => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return 'record';
      if (r.schema !== schema) return 'schema';
      if (r.provenance !== 'write-point' && r.provenance !== 'late') return 'provenance';
      if (
        !Array.isArray(r.stages) ||
        r.stages.length === 0 ||
        !r.stages.every((s: any) => s && typeof s.name === 'string' && s.name && typeof s.result === 'string' && s.result)
      ) return 'stages';
      if (
        !Array.isArray(r.probes) ||
        !r.probes.every(
          (p: any) =>
            p &&
            typeof p.id === 'string' &&
            /^[0-9a-f]{12}$/.test(p.id) &&
            typeof p.key === 'string' &&
            p.key &&
            typeof p.outcome === 'string' &&
            /^(passed|reproduced|blocked|inconclusive|not-run)\b/.test(p.outcome) &&
            (!p.outcome.startsWith('reproduced') || (typeof p.fingerprint === 'string' && p.fingerprint)) &&
            (isBase || p.evidence === undefined || (typeof p.evidence === 'string' && p.evidence)),
        )
      ) return 'probes';
      if (isBase) {
        if (r.completed !== 'true' && r.completed !== 'pending-fix-review' && r.completed !== 'false') return 'completed';
        if (r.completed === 'true' && r.probes.some((p: any) => !p.outcome.startsWith('passed'))) return 'completed';
        if (
          r.completed === 'pending-fix-review' &&
          (!r.probes.some((p: any) => p.outcome.startsWith('reproduced')) ||
            r.probes.some((p: any) => !/^(passed|reproduced)\b/.test(p.outcome)))
        ) return 'completed';
        if (!hex40(r.b)) return 'b';
        if (!hex40(r.t)) return 't';
        if (!(hex40(r.snapshot) || (r.snapshot === null && r.completed === 'false'))) return 'snapshot';
        if (typeof r.snapshot_tree_equals_t !== 'boolean') return 'snapshot_tree_equals_t';
        if (
          r.review_read_row !== undefined &&
          r.review_read_row !== null &&
          typeof r.review_read_row !== 'string' &&
          typeof r.review_read_row !== 'object'
        ) return 'review_read_row';
        if (r.completed !== 'true' && (typeof r.cause !== 'string' || !r.cause)) return 'cause';
        if (r.snapshot !== null) {
          const bt = gitTree(r.b);
          const st = gitTree(r.snapshot);
          if (bt !== r.t) return 't';
          if (!st || (st === r.t) !== r.snapshot_tree_equals_t) return 'snapshot_tree_equals_t';
        }
      } else {
        if (!hex40(r.cycle_1_snapshot)) return 'cycle_1_snapshot';
        if (!hex40(r.cycle_2_snapshot)) return 'cycle_2_snapshot';
        if (typeof r.scope !== 'string' || (r.scope !== 'full' && !r.scope.startsWith('delta from '))) return 'scope';
        if (r.fix_reviewed !== 'true' && r.fix_reviewed !== 'false') return 'fix_reviewed';
        if (r.fix_reviewed === 'true' && r.probes.some((p: any) => !/^(passed|reproduced)\b/.test(p.outcome))) return 'fix_reviewed';
        if (r.fix_reviewed !== 'true' && (typeof r.cause !== 'string' || !r.cause)) return 'cause';
      }
      if (mode === 'check' && r.provenance === 'late') {
        if (
          !r.late ||
          typeof r.late !== 'object' ||
          r.late.boundary !== 'next-cycle' ||
          !hex64(r.late.miss_sha256) ||
          !Array.isArray(r.late.sources) ||
          r.late.sources.length === 0 ||
          !r.late.sources.every((s: any) => s && typeof s.path === 'string' && s.path && hex64(s.sha256))
        ) return 'late';
      }
      return null;
    };

    if (action === 'write') {
      let r: any;
      try {
        r = JSON.parse(fs.readFileSync(arg!, 'utf8'));
      } catch {
        out(`invalid ${kind}: json`, 3);
      }
      const bad = validate(r, 'write');
      if (bad) out(`invalid ${kind}: ${bad}`, 3);
      const stateDir = env.REVIEW_STATE_DIR;
      if (isBase && typeof stateDir === 'string' && stateDir.length > 0) {
        const statePath = path.join(stateDir, 'review-run-state.json');
        let rawState: unknown;
        try {
          rawState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        } catch {
          out(`refused ${kind}: write point not reached (run-state unreadable)`, 3);
        }
        const validated = validateStoredState(rawState, statePath);
        if (!validated.ok) {
          out(`refused ${kind}: write point not reached (run-state unreadable)`, 3);
        }
        const st = validated.state;
        const pass = st.passes.find((x) => x.scope === 'local' && x.cycle === 1 && x.coverage === 'full');
        if (!pass) {
          out(`refused ${kind}: write point not reached (cycle-1-pass)`, 3);
        }
        for (const vid of pass.required_voices) {
          const v = pass.voices.find((x) => x.voice_id === vid);
          if (!v || (v.selected_attempt_id === null && v.not_applicable === null && v.attempts.length === 0)) {
            out(`refused ${kind}: write point not reached (${vid})`, 3);
          }
        }
        for (const p of r.probes as Array<{ id: string }>) {
          if (!st.gates.some((g) => g.name === `probe-${p.id}` && g.candidate.commit === pass.candidate.commit)) {
            out(`refused ${kind}: write point not reached (${p.id})`, 3);
          }
        }
      }
      const miss = readMiss();
      if (miss && r.provenance !== 'late') {
        out(`refused ${kind}: missed at ${(miss.data.boundary as string) || 'unknown'}`, 3);
      }
      if (r.provenance === 'late') {
        if (
          !miss ||
          miss.data.schema !== RECORD_MISS_SCHEMA ||
          miss.data.kind !== kind ||
          miss.data.boundary !== 'next-cycle'
        ) {
          out(`refused ${kind}: requires next-cycle miss record`, 3);
        }
        if (!Array.isArray(r.sources) || r.sources.length === 0 || !r.sources.every((s: unknown) => typeof s === 'string' && s)) {
          out(`refused ${kind}: sources required`, 3);
        }
        const snap = isBase ? r.snapshot : r.cycle_2_snapshot;
        if (!hex40(snap)) out(`refused ${kind}: snapshot required`, 3);
        const evRoot = fs.existsSync(evDir!) ? fs.realpathSync(evDir!) : path.resolve(evDir!);
        const sources: Array<{ path: string; sha256: string }> = [];
        for (const src of r.sources as string[]) {
          const abs = path.resolve(evRoot, src);
          const rel = path.relative(evRoot, abs);
          if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
            out(`refused ${kind}: source ${src} outside the evidence directory`, 3);
          }
          if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
            out(`refused ${kind}: source ${src} missing`, 3);
          }
          const real = fs.realpathSync(abs);
          const realRel = path.relative(evRoot, real);
          if (!realRel || realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) {
            out(`refused ${kind}: source ${src} outside the evidence directory`, 3);
          }
          if (real === fs.realpathSync(arg!) || /^cycle-1-(baseline|fix-review)(\.missed)?\.json$/.test(path.basename(real))) {
            out(`refused ${kind}: source ${src} is not review evidence`, 3);
          }
          const buf = fs.readFileSync(real);
          if (!buf.toString('utf8').includes(snap)) {
            out(`refused ${kind}: source ${src} does not name the snapshot`, 3);
          }
          sources.push({ path: src, sha256: sha256(buf) });
        }
        delete r.sources;
        r.late = { boundary: 'next-cycle', miss_sha256: sha256(miss.raw), sources };
      } else if (r.sources !== undefined || r.late !== undefined) {
        out(`invalid ${kind}: provenance`, 3);
      }
      const body = Buffer.from(`${JSON.stringify(r, null, 2)}\n`, 'utf8');
      try {
        fs.writeFileSync(recPath, body, { flag: 'wx' });
      } catch (e: any) {
        if (e && e.code === 'EEXIST') out(`exists ${kind}`, 2);
        out(`invalid ${kind}: record write (${(e && e.code) || 'unknown'})`, 3);
      }
      out(`written ${kind}; provenance=${r.provenance}; sha256=${sha256(body)}`, 0);
    } else if (action === 'check') {
      if (arg !== 'before-fix' && arg !== 'next-cycle' && arg !== 'stop') {
        out(`invalid ${kind}: boundary`, 3);
      }
      if (fs.existsSync(recPath)) {
        let r: any;
        try {
          r = JSON.parse(fs.readFileSync(recPath, 'utf8'));
        } catch {
          out(`unreadable ${kind}: json`, 1);
        }
        const bad = validate(r, 'check');
        if (bad) out(`unreadable ${kind}: ${bad}`, 1);
        const tail = isBase ? `completed=${r.completed}` : `fix-reviewed=${r.fix_reviewed}`;
        out(`present ${kind}; provenance=${r.provenance}; ${tail}`, 0);
      }
      const miss = readMiss();
      if (arg === 'next-cycle') {
        if (!miss) {
          const m = `${JSON.stringify({ schema: RECORD_MISS_SCHEMA, kind, boundary: 'next-cycle', detected_at: new Date().toISOString() }, null, 2)}\n`;
          try {
            fs.writeFileSync(missPath, m, { flag: 'wx' });
          } catch (e: any) {
            if (!e || e.code !== 'EEXIST') {
              out(`unreadable ${kind}: miss record (${(e && e.code) || 'unknown'})`, 1);
            }
          }
        }
        out(`missed ${kind} at ${(miss && (miss.data.boundary as string)) || 'next-cycle'}`, 1);
      }
      if (miss) out(`missed ${kind} at ${(miss.data.boundary as string) || 'unknown'}`, 1);
      out(`missing ${kind}`, 1);
    } else {
      out(`invalid ${kind}: action`, 3);
    }
  } catch (err) {
    if (err instanceof FenceExit) {
      return { message: err.message, exitCode: err.exitCode };
    }
    throw err;
  }
}
