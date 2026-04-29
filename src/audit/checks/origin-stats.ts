/**
 * origin-stats.ts — port of check_origin_stats (~L3381-3454).
 *
 * Counts source-tagged Unprocessed items in TODOS.md that carry a
 * numeric `group=N` key. Emits a per-group tally so the closure
 * dashboard can show "Group N has K open-origin items."
 *
 * Heading-only: matches `### [tag] Title` entries inside `## Unprocessed`,
 * outside fenced code blocks. Uses parseSourceTag (lib/source-tag.ts);
 * non-numeric group values (e.g. `pre-test`) are excluded.
 *
 * Output:
 *   STATUS: info | skip
 *   TOTAL_OPEN_ORIGIN: N
 *   BY_GROUP: 1=2,2=3   (kv, comma-sep, sorted by group num)
 *
 * Trailing-space parity: empty BY_GROUP emits `BY_GROUP: ` (with space)
 * because bash `echo "BY_GROUP: $by_group_csv"` always renders the space.
 */

import { extractTagFromHeading, parseSourceTag } from '../lib/source-tag.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckOriginStats(ctx: AuditCtx): CheckResult {
  if (ctx.paths.todos === null) {
    return {
      section: 'ORIGIN_STATS',
      status: 'skip',
      body: ['TOTAL_OPEN_ORIGIN: 0', 'BY_GROUP:'],
    };
  }

  let inFence = false;
  let inSection = false;
  let total = 0;
  const byGroup = new Map<string, number>();

  for (const line of ctx.files.todos.split('\n')) {
    if (/^[ \t]*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^## Unprocessed/.test(line)) {
      inSection = true;
      continue;
    }
    if (!inFence && inSection && /^## /.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection || inFence) continue;
    if (!/^### /.test(line)) continue;

    const tag = extractTagFromHeading(line);
    if (tag === '') continue;
    const r = parseSourceTag(tag);
    if (!r.ok) continue;
    const groupVal = r.value.pairs.group;
    if (groupVal === undefined || !/^[0-9]+$/.test(groupVal)) continue;

    total++;
    byGroup.set(groupVal, (byGroup.get(groupVal) ?? 0) + 1);
  }

  const sortedKeys = [...byGroup.keys()].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const csv = sortedKeys.map((k) => `${k}=${byGroup.get(k)}`).join(',');

  return {
    section: 'ORIGIN_STATS',
    status: 'info',
    body: [`TOTAL_OPEN_ORIGIN: ${total}`, `BY_GROUP: ${csv}`],
  };
}
