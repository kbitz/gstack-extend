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
 * Final message: it ends with a copyable /implement prompt block whose first
 * line starts `Run /implement <ACTIVE_PLAN>` (unfenced at column 0, or the
 * first line inside a column-0 fence that closes the message), carries the
 * required `/implement` handoff fields (`Workspace`, `Branch`, `Work state`,
 * `Plan`, `Review record`, `Approved scope`, `Spec`, `Test plan`,
 * `Verify command`, `Preserve`), and finishes with an `Auto-decisions:` line
 * followed by either one `- none` bullet or bullets that each carry `[fork]`
 * or `[challenge]`. When the caller supplies the checked plan's binding
 * (`promptBindingForPlan`), the prompt's plan path, plan SHA-256, Tier,
 * sidecar path/SHA-256 and Verify command must also match that plan, so a
 * stale prompt fails instead of handing off the wrong revision.
 *
 * One `Stage handoff: stage-handoff/v1; ...` line (docs/workflow-handoffs.md,
 * "Grammar stage line") may follow the block as the message's last line. It is
 * outside the handoff: `handoffBlock` and `checkMessage` ignore exactly one such
 * line and still refuse any other trailing text, so a transport that stops at
 * the closing fence reads the same block. `checkStageLine` is the separate check
 * that requires it and binds it to the checked plan.
 */
import { REPORT_HEADING, REVIEW_RECORD_HEADING, rawOutputMarkers, readSeal, scanLines, sha256, splitPlan } from './plan.ts';

export const PROMPT_LABELS = [
  'Workspace',
  'Branch',
  'Work state',
  'Plan',
  'Review record',
  'Approved scope',
  'Spec',
  'Test plan',
  'Verify command',
  'Preserve',
] as const;

const ACCEPTANCE_HEADING = /^\s*#{1,6}\s+.*acceptance/i;
const ACCEPTANCE_LABEL = /^\s*(?:\*\*|__)[^*_]*acceptance[^*_]*(?:\*\*|__)\s*:?\s*$/i;
const FIRST_ITEM = /^\s*1[.)]\s+\S/;
const MD_HEADING = /^\s*#{1,6}\s/;
const TIER_ANY = /^\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:\*\*|__)?tier(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(routine|standard|novel)\b/i;
const TIER_STANDALONE = /^Tier: (routine|standard|novel)\s*$/;
const VERIFY_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?verify(?:\s+command)?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*\S/i;
const VERIFY_VALUE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?verify(?:\s+command)?(?:\*\*|__)?\s*:\s*(.+?)\s*$/i;
const PLACEHOLDER_SPAN = /<[^>\n]+>/;

/**
 * Generous label normalization for fail-closed ambiguity scans: structural
 * prefixes, emphasis, backticks, unicode spaces and fullwidth colons must
 * not let a second Tier/Verify/label value hide beside the canonical one.
 */
function looseLabel(line: string): { label: string; value: string } | undefined {
  let rest = line;
  for (let prev = ''; prev !== rest;) {
    prev = rest;
    rest = rest.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '');
  }
  const stripped = rest
    .replace(/[`*_]/g, '')
    .replace(/[\s\u00A0\u2000-\u200B\uFEFF]+/g, ' ')
    .replace(/\uFF1A/g, ':')
    .trim();
  const m = /^([A-Za-z][A-Za-z -]*?):\s*(.*?)\s*$/.exec(stripped);
  if (!m) return undefined;
  return { label: m[1]!.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' '), value: m[2]! };
}

/** Strip one balanced emphasis pair; never eat `__main__`-style value text. */
function verifyValue(raw: string): string {
  let v = raw.trim().replace(/^(?:\*\*|__)\s*/, '');
  for (const m of ['**', '__']) {
    if (v.length > 2 * m.length && v.startsWith(m) && v.endsWith(m)) v = v.slice(m.length, -m.length).trim();
  }
  return v;
}

/** The checked plan's values a bound /implement prompt must quote verbatim. */
export interface PromptBinding {
  planPath: string;
  planSha256: string;
  tier: string;
  sidecarPath: string;
  sidecarSha256: string;
  verifyCommand: string;
}

/**
 * Derive the binding from sealed plan bytes, or undefined when the plan does
 * not carry every value unambiguously. Callers that check a message must
 * fail closed on undefined: format-only checks cannot detect a stale prompt.
 */
export function promptBindingForPlan(bytes: Uint8Array, planPath: string): PromptBinding | undefined {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  const unfenced = scanLines(text).filter((l) => !l.fenced);
  const recordIdx = unfenced.findIndex((l) => /^##\s+Review record\s*$/i.test(l.text));
  const before = recordIdx < 0 ? unfenced : unfenced.slice(0, recordIdx);
  const tiers = [...new Set(before.map((l) => TIER_STANDALONE.exec(l.text)?.[1]).filter((t): t is string => !!t))];
  // Loose Tier/Verify labels in any Markdown dress (headings, quotes,
  // numbering, single emphasis, backticks) count for ambiguity even when
  // checkPlan's own scans do not count that form; no form silently wins.
  const loose = before.map((l, i) => ({ i, parsed: looseLabel(l.text) })).filter((c) => c.parsed);
  const looseTiers = [...new Set(loose.filter((c) => c.parsed!.label === 'tier')
    .map((c) => /^(routine|standard|novel)\b/i.exec(c.parsed!.value)?.[1]?.toLowerCase())
    .filter((t): t is string => !!t))];
  const tier = tiers.length === 1 && looseTiers.every((t) => t === tiers[0]!.toLowerCase()) ? tiers[0] : undefined;
  const candidates = before
    .map((l, i) => { const m = VERIFY_VALUE.exec(l.text); return m ? { i, v: verifyValue(m[1]!) } : undefined; })
    .filter((c): c is { i: number; v: string } => !!c && !!c.v);
  const looseVerifies = [...new Set(loose
    .filter((c) => c.parsed!.label === 'verify' || c.parsed!.label === 'verify command')
    .map((c) => verifyValue(c.parsed!.value)).filter(Boolean))];
  const distinct = [...new Set(candidates.map((c) => c.v))];
  const continued = candidates.some((c) => /^\s+\S/.test(before[c.i + 1]?.text ?? ''));
  const normLoose = (s: string) => s.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
  const verify = distinct.length === 1 && !continued && looseVerifies.every((v) => normLoose(v) === normLoose(distinct[0]!)) ? distinct[0] : undefined;
  const recordText = splitPlan(text).record ?? '';
  const sealLines = (re: RegExp) => (recordText.match(re) ?? []).length;
  if (sealLines(/^\s*-\s*Sidecar:/gm) > 1 || sealLines(/^\s*-\s*SHA-256:/gm) > 1) return undefined;
  const seal = readSeal(splitPlan(text).record);
  if (!tier || !verify || !seal.path || !seal.sha256) return undefined;
  return {
    planPath,
    planSha256: sha256(bytes),
    tier: tier.toLowerCase(),
    sidecarPath: seal.path,
    sidecarSha256: seal.sha256.toLowerCase(),
    verifyCommand: verify,
  };
}
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

/** The stage line's full grammar; every field is required and the line stands alone. */
export const STAGE_LINE = /^Stage handoff: stage-handoff\/v1; stage: (plan|implement|review); next: (implement|review-and-prep|ship-and-land|pair-review|none); status: (done|done-with-concerns|paused|stopped|blocked|needs-context); head: ([0-9a-f]{40}|none); plan-sha256: ([0-9a-f]{64}|none)$/;

/** The handoff block at the end of the message, or undefined. */
export function handoffBlock(message: string, fencedOnly = false): string[] | undefined {
  const raw = message.replace(/\s+$/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  // Exactly one trailing stage line is outside the handoff; anything else after the block still fails below.
  if (STAGE_LINE.test(raw[raw.length - 1] ?? '')) {
    raw.pop();
    while (raw.length && !raw[raw.length - 1]!.trim()) raw.pop();
  }
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
    if (RUN.test(line) && !fencedOnly) return raw.slice(i);
  }
  return undefined;
}

/**
 * The stage line `check --message` requires: exactly one, last, well formed, for this stage and plan.
 * `head` must be the prompt's `Branch` HEAD and `plan-sha256` the checked plan's SHA-256.
 */
export function checkStageLine(message: string, binding?: PromptBinding): string[] {
  const lines = message.replace(/\s+$/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const stageLines = lines.filter((l) => /^\s*Stage handoff:/i.test(l));
  if (stageLines.length > 1) return [`the final message carries ${stageLines.length} stage handoff lines; it must end with exactly one`];
  const m = STAGE_LINE.exec(lines[lines.length - 1] ?? '');
  if (!m) {
    return [stageLines.length
      ? 'the stage handoff line is malformed or not the last line of the message; it must read "Stage handoff: stage-handoff/v1; stage: plan; next: implement; status: done; head: <40-char hex>; plan-sha256: <64-char hex>"'
      : 'the final message does not end with a "Stage handoff: stage-handoff/v1; ..." line after the handoff block'];
  }
  const [, stage, next, status, head, planSha] = m;
  const problems: string[] = [];
  if (stage !== 'plan') problems.push(`the stage handoff line names stage ${stage}; /autoplan-lean prints stage: plan`);
  if (next !== 'implement') problems.push(`the stage handoff line names next ${next}; a handoff prompt goes with next: implement`);
  if (status !== 'done' && status !== 'done-with-concerns') problems.push(`the stage handoff line has status ${status}; a handoff prompt goes with done or done-with-concerns`);
  if (binding && planSha !== binding.planSha256) problems.push('the stage handoff line plan-sha256 does not match the checked plan (stale line; re-seal or update it)');
  const block = handoffBlock(message, true);
  if (!block) {
    problems.push('the stage handoff line must follow a fenced handoff block');
    return problems;
  }
  // The legacy parser may select raw text before this fence. Validate the selected
  // copyable block itself so those outer fields cannot supply its required bindings.
  problems.push(...checkMessage(block.join('\n'), binding));
  const label = block.findIndex((l) => /^\s*(?:[-*+]\s+)?(?:\*\*|__)?auto-decisions(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*$/i.test(l));
  const value = promptFields(block, label).seen.get('Branch')?.trim();
  const branch = value && /^[^;<>]+;\s*target base:\s*[^;<>]+;\s*HEAD:\s*([0-9a-f]{40}|[0-9a-f]{64})\s*$/.exec(value)?.[1];
  if (!branch) problems.push("the stage handoff line cannot bind to the prompt's Branch HEAD");
  else if (head !== branch) problems.push(`the stage handoff line head (${head}) does not match the prompt's Branch HEAD (${branch})`);
  return problems;
}

function promptFields(block: string[], label: number) {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  let currentLabel: string | undefined;
  const consumed = new Set<number>();
  const normalizedLabels = new Map(PROMPT_LABELS.map((k) => [k.toLowerCase(), k]));
  for (const [idx, line] of block.slice(1, label).entries()) {
    const field = /^([A-Z][A-Za-z ]+):(?:\s+(.*?))?\s*$/.exec(line);
    if (field && (PROMPT_LABELS as readonly string[]).includes(field[1]!)) {
      const key = field[1]!;
      if (seen.has(key)) problems.push(`duplicate "${key}:" line in the /implement prompt`);
      else seen.set(key, field[2] ?? '');
      currentLabel = key;
      consumed.add(idx + 1);
      continue;
    }
    const loose = looseLabel(line);
    const exact = loose ? normalizedLabels.get(loose.label) : undefined;
    if (exact) {
      problems.push(`"${loose!.label}:" looks like the "${exact}:" field; use the exact label`);
      currentLabel = undefined;
      consumed.add(idx + 1);
    } else if (/^\s+\S/.test(line) && currentLabel && seen.has(currentLabel)) {
      seen.set(currentLabel, `${seen.get(currentLabel)!} ${line.trim()}`.trim());
      consumed.add(idx + 1);
    } else if (!line.trim()) {
      currentLabel = undefined;
      consumed.add(idx + 1);
    }
  }

  return { seen, consumed, problems };
}

export function checkMessage(message: string, binding?: PromptBinding): string[] {
  const block = handoffBlock(message);
  if (!block) return ['the final message does not end with a block whose first line starts "Run /implement"'];
  const label = block.findIndex((l) => /^\s*(?:[-*+]\s+)?(?:\*\*|__)?auto-decisions(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*$/i.test(l));
  if (label < 0) return ['the handoff block has no bare "Auto-decisions:" line after "Run /implement"'];

  const problems: string[] = [];
  const run = /^Run \/implement(?:\s+(\S.*?))?\s*$/.exec(block[0]!);
  const runPlan = run?.[1];
  if (!runPlan || /^<[^>]+>$/.test(runPlan)) {
    problems.push('the first line of the handoff block must be "Run /implement <ACTIVE_PLAN>" with a concrete plan path');
  } else if (!runPlan.startsWith('/')) {
    problems.push(`the "Run /implement" plan path must be an absolute path, got ${runPlan}`);
  }

  const { seen, consumed, problems: fieldProblems } = promptFields(block, label);
  problems.push(...fieldProblems);

  const missing = PROMPT_LABELS.filter((k) => {
    const v = seen.get(k)?.trim();
    return !v || /^<[^>]+>$/.test(v);
  });
  if (missing.length) {
    problems.push(`the /implement prompt is missing required field(s): ${missing.join(', ')}`);
  }

  const workspace = seen.get('Workspace')?.trim();
  if (workspace && !/^<[^>]+>$/.test(workspace) && (!/^\/(?!\s)/.test(workspace) || /<absolute path/i.test(workspace))) {
    problems.push('Workspace: must name an absolute workspace path');
  }
  const branch = seen.get('Branch')?.trim();
  if (branch && !/^<[^>]+>$/.test(branch) && !/^([^;<>]+);\s*target base:\s*([^;<>]+);\s*HEAD:\s*([0-9a-f]{40}|[0-9a-f]{64})\s*$/.test(branch)) {
    problems.push('Branch: must be "<current branch>; target base: <base ref>; HEAD: <40- or 64-char lowercase hex SHA>"');
  }
  const planField = seen.get('Plan')?.trim();
  let planMatch: RegExpExecArray | undefined;
  if (planField && !/^<[^>]+>$/.test(planField)) {
    planMatch = /^(\S.*?);\s*SHA-256:\s*([0-9a-f]{64});\s*Tier:\s*(routine|standard|novel)\s*$/i.exec(planField) ?? undefined;
    if (!planMatch) problems.push('Plan: must be "<ACTIVE_PLAN>; SHA-256: <64-char hex>; Tier: <routine|standard|novel>"');
    else if (runPlan && !/^<[^>]+>$/.test(runPlan) && planMatch[1] !== runPlan) {
      problems.push(`Plan: path (${planMatch[1]}) does not match "Run /implement ${runPlan}"`);
    }
  }
  const reviewRecord = seen.get('Review record')?.trim();
  let recordMatch: RegExpExecArray | undefined;
  if (reviewRecord && !/^<[^>]+>$/.test(reviewRecord)) {
    recordMatch = /^(\/[^;<>]*\.review-record\.md);\s*SHA-256:\s*([0-9a-f]{64})\s*$/i.exec(reviewRecord) ?? undefined;
    if (!recordMatch) problems.push('Review record: must be "<sidecar .review-record.md path>; SHA-256: <64-char hex>"');
  }

  if (binding) {
    if (runPlan && !/^<[^>]+>$/.test(runPlan) && runPlan !== binding.planPath) {
      problems.push(`the /implement prompt names plan ${runPlan}, which does not match the checked plan ${binding.planPath}`);
    }
    if (planMatch) {
      if (planMatch[2]!.toLowerCase() !== binding.planSha256) {
        problems.push('Plan: SHA-256 does not match the checked plan (stale prompt; re-seal or update it)');
      }
      if (planMatch[3]!.toLowerCase() !== binding.tier) {
        problems.push(`Plan: Tier ${planMatch[3]} does not match the checked plan Tier ${binding.tier}`);
      }
    }
    if (recordMatch) {
      if (recordMatch[1] !== binding.sidecarPath) {
        problems.push(`Review record: path (${recordMatch[1]}) does not match the checked plan sidecar ${binding.sidecarPath}`);
      }
      if (recordMatch[2]!.toLowerCase() !== binding.sidecarSha256) {
        problems.push('Review record: SHA-256 does not match the checked plan sidecar (stale prompt; re-seal or update it)');
      }
    }
    const verifyField = seen.get('Verify command')?.trim();
    if (verifyField && !/^<[^>]+>$/.test(verifyField) && verifyField !== binding.verifyCommand) {
      problems.push(`Verify command: (${verifyField}) does not match the checked plan Verify command (${binding.verifyCommand})`);
    }
  }

  const bullets: string[] = [];
  let unexpected: string | undefined;
  for (const line of block.slice(label + 1)) {
    if (!line.trim()) continue;
    const bullet = /^\s*[-*+]\s+(\S.*?)\s*$/.exec(line);
    if (bullet && !/^\s{2,}/.test(line)) bullets.push(bullet[1]!);
    else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else { unexpected = `unexpected line after the Auto-decisions list: ${JSON.stringify(line.slice(0, 80))}`; break; }
  }
  // Placeholder scan over the whole block (prose, fields, bullets). Code
  // spans are exempt (quoted commands/code may contain angle brackets), as
  // is a Verify command value the binding already proved verbatim.
  const verifyBound = binding !== undefined && seen.get('Verify command')?.trim() === binding.verifyCommand;
  const spans: string[] = [];
  for (const [key, value] of seen) {
    if (verifyBound && key === 'Verify command') continue;
    const span = PLACEHOLDER_SPAN.exec(value.replace(/`[^`]*`/g, ''))?.[0];
    if (span) spans.push(span);
  }
  for (const bullet of bullets) {
    if (PLACEHOLDER_SPAN.test(bullet.replace(/`[^`]*`/g, ''))) {
      problems.push('an Auto-decisions bullet still contains an unfilled <...> placeholder');
      break;
    }
  }
  for (const [idx, line] of block.slice(1, label).entries()) {
    if (consumed.has(idx + 1)) continue;
    const span = PLACEHOLDER_SPAN.exec(line.replace(/`[^`]*`/g, ''))?.[0];
    if (span) spans.push(span);
  }
  const uniqueSpans = [...new Set(spans)];
  if (uniqueSpans.length) {
    problems.push(`the /implement prompt still contains unfilled <...> placeholder(s): ${uniqueSpans[0]}${uniqueSpans.length > 1 ? ` (+${uniqueSpans.length - 1} more)` : ''}`);
  }
  if (unexpected) problems.push(unexpected);
  else if (!bullets.length) problems.push('the Auto-decisions list is empty; write "- none" when there were no auto-decisions');
  else {
    const none = bullets.filter((b) => /^none[\s.!]*$/i.test(b));
    if (none.length && bullets.length > 1) problems.push('"- none" cannot be combined with other Auto-decisions bullets');
    else if (!none.length) {
      const unmarked = bullets.filter((b) => !/\[(?:fork|challenge)\]/.test(b));
      if (unmarked.length) problems.push(`${unmarked.length} Auto-decisions bullet(s) lack a [fork] or [challenge] marker`);
    }
  }
  return problems;
}
