/**
 * parallelizable-future.ts — port of check_parallelizable_future (~L3185-3367).
 *
 * Scans the `## Future` section of ROADMAP.md for Tracks with parseable
 * _touches:_ + _Depends on:_ metadata. A Future track is a candidate iff:
 *   1. All deps are in COMPLETE_GROUPS (deps formatted as `Track NA` or
 *      `Group N`; the Track form requires its parent Group to be Complete).
 *   2. Its touches don't overlap any in-flight track's touches.
 *   3. The parallelism budget has headroom.
 *
 * Future-only-bullet items (no `### Track` heading) are ignored — opting
 * in requires full Track form with metadata.
 *
 * Output shape:
 *   STATUS: pass | info | skip
 *   CANDIDATES:                ← always emitted; values when info
 *   FINDINGS: per-candidate or "- (none)"
 *   IN_FLIGHT_COUNT: N
 *   CAP: N
 */

import type { AuditCtx, CheckResult } from '../types.ts';
import { computeInFlight } from '../lib/in-flight.ts';

const FUTURE_RE = /^## Future/i;
const ANY_H2_RE = /^## /;
const TRACK_RE = /^### Track ([0-9]+[A-Z](?:\.[0-9]+)?):/;
const TOUCHES_RE = /^_touches:[ \t\v\f\r]*/i;
const DEPENDS_RE = /^_Depends on:[ \t\v\f\r]*/i;

type FutureTrack = {
  id: string;
  touches: string[];
  depsRaw: string;
  legacy: boolean;
};

function trim(s: string): string {
  return s.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
}

function parseFutureTouches(line: string): string[] {
  const raw = line.replace(TOUCHES_RE, '').replace(/_[ \t\v\f\r]*$/, '');
  return raw
    .split(',')
    .map((s) => trim(s))
    .filter((s) => s !== '');
}

function parseFutureDepsRaw(line: string): string {
  return line.replace(DEPENDS_RE, '').replace(/_[ \t\v\f\r]*$/, '');
}

function evalCandidate(
  ft: FutureTrack,
  completeGroups: Set<string>,
  inFlightTouches: Set<string>,
): { ok: boolean; touchesSorted: string[] } {
  if (ft.legacy || ft.touches.length === 0 || ft.depsRaw === '') {
    return { ok: false, touchesSorted: [] };
  }
  for (const dep of ft.depsRaw.split(',')) {
    const trimmed = trim(dep);
    const cleaned = trimmed.replace(/^(Track|Group)[ \t\v\f\r]+/i, '');
    if (/^[0-9]+[A-Z](?:\.[0-9]+)?$/.test(cleaned)) {
      const grp = cleaned.match(/^([0-9]+)/)![1]!;
      if (!completeGroups.has(grp)) return { ok: false, touchesSorted: [] };
    } else if (/^[0-9]+$/.test(cleaned)) {
      if (!completeGroups.has(cleaned)) return { ok: false, touchesSorted: [] };
    } else {
      return { ok: false, touchesSorted: [] };
    }
  }
  // LC_ALL=C: sort byte-wise via < comparator (ASCII paths).
  const sorted = [...new Set(ft.touches)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const t of sorted) {
    if (inFlightTouches.has(t)) return { ok: false, touchesSorted: sorted };
  }
  return { ok: true, touchesSorted: sorted };
}

export function runCheckParallelizableFuture(ctx: AuditCtx): CheckResult {
  const cap = ctx.parallelismCap;

  if (ctx.paths.roadmap === null) {
    return {
      section: 'PARALLELIZABLE_FUTURE',
      status: 'skip',
      body: ['CANDIDATES:', 'FINDINGS:', '- No ROADMAP.md'],
    };
  }

  const { inFlight } = computeInFlight(ctx.roadmap.value);
  const groupById = new Map(ctx.roadmap.value.groups.map((g) => [g.num, g]));
  const trackById = new Map(ctx.roadmap.value.tracks.map((t) => [t.id, t]));
  const completeGroups = new Set(ctx.roadmap.value.groups.filter((g) => g.isComplete).map((g) => g.num));
  const completeTracks = new Set(ctx.roadmap.value.tracks.filter((t) => t.isComplete).map((t) => t.id));

  let inFlightCount = 0;
  for (const g of inFlight) {
    const info = groupById.get(g);
    if (info === undefined) continue;
    for (const tid of info.trackIds) {
      if (!completeTracks.has(tid)) inFlightCount++;
    }
  }

  if (inFlightCount >= cap) {
    return {
      section: 'PARALLELIZABLE_FUTURE',
      status: 'skip',
      body: [
        'CANDIDATES:',
        'FINDINGS:',
        `- Parallelism budget at capacity (${inFlightCount}/${cap}); no headroom to surface candidates`,
      ],
    };
  }

  // Aggregate in-flight touches (excluding ✓ Complete Tracks).
  const inFlightTouches = new Set<string>();
  for (const g of inFlight) {
    const info = groupById.get(g);
    if (info === undefined) continue;
    for (const tid of info.trackIds) {
      if (completeTracks.has(tid)) continue;
      const t = trackById.get(tid);
      if (t === undefined) continue;
      for (const f of t.touches) inFlightTouches.add(f);
    }
  }

  // Walk ## Future section.
  const lines = ctx.files.roadmap.split('\n');
  const futureTracks: FutureTrack[] = [];
  let inFuture = false;
  let cur: FutureTrack | null = null;
  const flush = () => {
    if (cur !== null) futureTracks.push(cur);
    cur = null;
  };

  for (const line of lines) {
    if (FUTURE_RE.test(line)) {
      inFuture = true;
      continue;
    }
    if (inFuture && ANY_H2_RE.test(line) && !FUTURE_RE.test(line)) {
      flush();
      inFuture = false;
      continue;
    }
    if (!inFuture) continue;
    const tm = line.match(TRACK_RE);
    if (tm !== null) {
      flush();
      cur = { id: tm[1]!, touches: [], depsRaw: '', legacy: true };
      continue;
    }
    if (cur === null) continue;
    if (TOUCHES_RE.test(line)) {
      cur.touches = parseFutureTouches(line);
      cur.legacy = false;
      continue;
    }
    if (DEPENDS_RE.test(line)) {
      cur.depsRaw = parseFutureDepsRaw(line);
      continue;
    }
  }
  flush();

  const candidates: string[] = [];
  const findings: string[] = [];
  for (const ft of futureTracks) {
    const { ok, touchesSorted } = evalCandidate(ft, completeGroups, inFlightTouches);
    if (ok) {
      candidates.push(ft.id);
      findings.push(
        `- ${ft.id}: deps satisfied, touches don't overlap in-flight (${touchesSorted.join(',')}) — eligible for promotion to current Group`,
      );
    }
  }

  const tail = [`IN_FLIGHT_COUNT: ${inFlightCount}`, `CAP: ${cap}`];
  if (candidates.length === 0) {
    return {
      section: 'PARALLELIZABLE_FUTURE',
      status: 'pass',
      body: ['CANDIDATES:', 'FINDINGS:', '- (none)', ...tail],
    };
  }
  return {
    section: 'PARALLELIZABLE_FUTURE',
    status: 'info',
    body: [`CANDIDATES: ${candidates.join(',')}`, 'FINDINGS:', ...findings, '', ...tail],
  };
}
