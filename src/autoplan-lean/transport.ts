/**
 * Shape checks for an /autoplan-lean result, as an external transport that
 * launches the skill by name consumes it. The rules are at least as strict as
 * common transport parsers so a plan that passes here also passes there:
 *
 * Plan (all before the first unfenced `## Review record`, outside fences):
 *   - an acceptance-criteria heading (or bold label) followed, before the next
 *     heading, by a numbered list starting at `1.` or `1)`;
 *   - a standalone `Tier: routine|standard|novel` line; every Tier line agrees;
 *   - a verify-command line (`Verify command: …` or `Verify: …`);
 *   - exactly one implementation-tasks heading.
 * Then exactly one `## Review record` naming the sidecar's path and SHA-256,
 * which must match the sidecar's bytes, and the last H2 heading must be
 * `## GSTACK REVIEW REPORT`. The plan proper must carry no raw review output.
 *
 * Final message: it ends with a block whose first line starts `Run /implement`
 * (unfenced at column 0, or the first line inside a column-0 fence that closes
 * the message), followed by an `Auto-decisions:` line and either one `- none`
 * bullet or bullets that each carry `[fork]` or `[challenge]`.
 */
import { REPORT_HEADING, REVIEW_RECORD_HEADING, rawOutputMarkers, readSeal, scanLines, sha256, splitPlan } from './plan.ts';

const ACCEPTANCE_HEADING = /^\s*#{1,6}\s+.*acceptance/i;
const ACCEPTANCE_LABEL = /^\s*(?:\*\*|__)[^*_]*acceptance[^*_]*(?:\*\*|__)\s*:?\s*$/i;
const FIRST_ITEM = /^\s*1[.)]\s+\S/;
const MD_HEADING = /^\s*#{1,6}\s/;
const TIER_ANY = /^\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:\*\*|__)?tier(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(routine|standard|novel)\b/i;
const TIER_STANDALONE = /^Tier: (routine|standard|novel)\s*$/;
const VERIFY_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?verify(?:\s+command)?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*\S/i;
const TASKS_HEADING_ANY = /^\s*#{1,6}\s+.*implementation tasks/i;

export type SidecarReader = (path: string) => Uint8Array | undefined;

export function checkPlan(bytes: Uint8Array, readSidecar: SidecarReader): string[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return ['the plan is not valid UTF-8'];
  }
  const problems: string[] = [];
  const lines = scanLines(text);
  const unfenced = lines.map((l, i) => ({ ...l, i })).filter((l) => !l.fenced);
  const recordIdx = unfenced.findIndex((l) => /^##\s+Review record\s*$/i.test(l.text));
  const before = recordIdx < 0 ? unfenced : unfenced.slice(0, recordIdx);

  let acceptance = false;
  for (let k = 0; k < before.length && !acceptance; k++) {
    const t = before[k]!.text;
    if (!(ACCEPTANCE_HEADING.test(t) || ACCEPTANCE_LABEL.test(t))) continue;
    for (let j = k + 1; j < before.length; j++) {
      const u = before[j]!.text;
      if (MD_HEADING.test(u)) break;
      if (FIRST_ITEM.test(u)) { acceptance = true; break; }
    }
  }
  if (!acceptance) problems.push('no numbered acceptance-criteria list (starting at 1) under an acceptance heading before ## Review record');

  const tiers = before.map((l) => TIER_ANY.exec(l.text)?.[1]?.toLowerCase()).filter((t): t is string => !!t);
  if (!before.some((l) => TIER_STANDALONE.test(l.text))) problems.push('no standalone "Tier: routine|standard|novel" line before ## Review record');
  else if (new Set(tiers).size > 1) problems.push(`the Tier lines disagree (${[...new Set(tiers)].join(', ')})`);

  if (!before.some((l) => VERIFY_LINE.test(l.text))) problems.push('no "Verify command:" line before ## Review record');

  const taskHeadings = unfenced.filter((l) => TASKS_HEADING_ANY.test(l.text));
  if (taskHeadings.length !== 1 || (recordIdx >= 0 && unfenced.indexOf(taskHeadings[0]!) > recordIdx)) {
    problems.push(`expected one implementation-tasks heading before ## Review record, found ${taskHeadings.length}`);
  }

  const leaked = rawOutputMarkers(splitPlan(text).proper);
  if (leaked.length) problems.push(`the plan proper contains review output (${leaked.join(', ')})`);

  const records = unfenced.filter((l) => /^##\s+Review record\s*$/i.test(l.text));
  if (records.length !== 1) problems.push(`expected one unfenced ${REVIEW_RECORD_HEADING} section, found ${records.length}`);
  else {
    const seal = readSeal(splitPlan(text).record);
    if (!seal.path || !seal.sha256) problems.push(`${REVIEW_RECORD_HEADING} does not name the sidecar path and SHA-256`);
    else {
      const sidecar = readSidecar(seal.path);
      if (!sidecar) problems.push(`sidecar ${seal.path} is missing or not a regular file`);
      else if (sha256(sidecar) !== seal.sha256) problems.push(`sidecar ${seal.path} does not match the recorded SHA-256`);
      else if (seal.bytes !== undefined && seal.bytes !== sidecar.byteLength) problems.push(`sidecar ${seal.path} does not match the recorded byte count`);
    }
  }

  const h2 = unfenced.filter((l) => /^##\s+\S/.test(l.text) && !/^###/.test(l.text));
  const last = h2[h2.length - 1];
  // The record is itself an H2, so a last-H2 report always follows it.
  if (!last || !/^##\s+GSTACK REVIEW REPORT\s*$/i.test(last.text)) problems.push(`the last ## heading is not ${REPORT_HEADING}`);
  return problems;
}

/** The handoff block at the end of the message, or undefined. */
export function handoffBlock(message: string): string[] | undefined {
  const raw = message.replace(/\s+$/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const RUN = /^Run \/implement(?:\s|$)/;
  let fence: { char: string; length: number; at: number } | undefined;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!;
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = undefined;
      continue;
    }
    const open = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { char: open[2]![0]!, length: open[2]!.length, at: i };
      if (open[1]) continue;
      let j = i + 1;
      while (j < raw.length && !raw[j]!.trim()) j++;
      if (j >= raw.length || !RUN.test(raw[j]!)) continue;
      // The handoff fence must close on the message's last line; an earlier
      // fenced example that quotes the handoff is skipped, not a refusal.
      const last = /^\s*(`{3,}|~{3,})\s*$/.exec(raw[raw.length - 1]!);
      if (raw.length - 1 <= j || !last || last[1]![0] !== fence.char || last[1]!.length < fence.length) continue;
      const inner = raw.slice(j, raw.length - 1);
      if (inner.some((l) => { const c = /^\s*(`{3,}|~{3,})\s*$/.exec(l); return !!c && c[1]![0] === fence!.char && c[1]!.length >= fence!.length; })) continue;
      return inner;
    }
    if (RUN.test(line)) return raw.slice(i);
  }
  return undefined;
}

export function checkMessage(message: string): string[] {
  const block = handoffBlock(message);
  if (!block) return ['the final message does not end with a block whose first line starts "Run /implement"'];
  const label = block.findIndex((l) => /^\s*(?:[-*+]\s+)?(?:\*\*|__)?auto-decisions(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*$/i.test(l));
  if (label < 0) return ['the handoff block has no bare "Auto-decisions:" line after "Run /implement"'];
  const bullets: string[] = [];
  for (const line of block.slice(label + 1)) {
    if (!line.trim()) continue;
    const bullet = /^\s*[-*+]\s+(\S.*?)\s*$/.exec(line);
    if (bullet && !/^\s{2,}/.test(line)) bullets.push(bullet[1]!);
    else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else return [`unexpected line after the Auto-decisions list: ${JSON.stringify(line.slice(0, 80))}`];
  }
  if (!bullets.length) return ['the Auto-decisions list is empty; write "- none" when there were no auto-decisions'];
  const none = bullets.filter((b) => /^none[\s.!]*$/i.test(b));
  if (none.length && bullets.length > 1) return ['"- none" cannot be combined with other Auto-decisions bullets'];
  if (none.length) return [];
  const unmarked = bullets.filter((b) => !/\[(?:fork|challenge)\]/.test(b));
  return unmarked.length ? [`${unmarked.length} Auto-decisions bullet(s) lack a [fork] or [challenge] marker`] : [];
}
