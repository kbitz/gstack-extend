/**
 * skill-llm-eval.test.ts — LLM-as-judge over captured skill prose.
 *
 * Gated on `EVALS=1` exactly (not truthy) so the default `bun run test`
 * never spends Anthropic dollars. Each fixture in
 * `tests/fixtures/skill-prose-corpus/` is scored on three axes (clarity,
 * completeness, actionability), 1–5 each, by `callJudge`.
 *
 * Calibration v1:
 *   - positive fixtures: every axis must be >= 3
 *   - negative-control fixtures: at least one axis must be <= 2
 *
 * The negative control catches the failure mode where the judge rewards
 * plausible-sounding prose over substantive content. If shallow output
 * scores >=3 on every axis, either the rubric is too loose or the judge
 * has drifted — surface as a test failure rather than silently passing.
 *
 * Cost: ~$0.05–0.15 per `EVALS=1` run on Claude Sonnet 4.5. Sequential
 * test.each (not Promise.all) so per-fixture failures retain bun:test's
 * usual granularity. Per-test timeout is 60s — bun:test's 5s default
 * would interrupt mid-call.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { callJudge, isJudgeScore, type JudgeScore } from './helpers/llm-judge.ts';

const CORPUS_DIR = join(import.meta.dir, 'fixtures', 'skill-prose-corpus');

type FixtureKind = 'positive' | 'negative-control';

type Fixture = {
  name: string;
  kind: FixtureKind;
  source_skill: string;
  input_prompt: string;
  prose: string;
};

function parseFixture(filename: string): Fixture {
  const raw = readFileSync(join(CORPUS_DIR, filename), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`fixture ${filename}: missing or malformed frontmatter`);
  const frontmatter = m[1]!;
  const body = m[2]!.trim();

  const kind = readField(frontmatter, 'kind');
  if (kind !== 'positive' && kind !== 'negative-control') {
    throw new Error(`fixture ${filename}: kind must be 'positive' or 'negative-control', got '${kind}'`);
  }
  return {
    name: filename.replace(/\.md$/, ''),
    kind,
    source_skill: readField(frontmatter, 'source_skill'),
    input_prompt: readField(frontmatter, 'input_prompt'),
    prose: body,
  };
}

/**
 * Read a key from minimal YAML-ish frontmatter. Supports two forms:
 *   key: single-line value
 *   key: |
 *     indented
 *     block
 *     scalar
 * That's all our fixtures use; a real YAML lib would be overkill.
 */
function readField(frontmatter: string, key: string): string {
  const block = new RegExp(`^${key}:\\s*\\|\\s*\\n((?:^[ \\t]+.*\\n?)+)`, 'm').exec(frontmatter);
  if (block) {
    const lines = block[1]!.replace(/\n$/, '').split('\n');
    const indent = lines[0]!.match(/^[ \t]+/)?.[0] ?? '';
    return lines.map(l => l.startsWith(indent) ? l.slice(indent.length) : l).join('\n').trimEnd();
  }
  const single = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontmatter);
  if (single) return single[1]!.trim();
  throw new Error(`frontmatter field '${key}' not found`);
}

function buildJudgePrompt(fixture: Fixture): string {
  return `You are evaluating the quality of a skill output (prose written by an LLM-driven workflow skill).

Skill: ${fixture.source_skill}
User request to the skill:
${fixture.input_prompt}

Skill output to evaluate:
---
${fixture.prose}
---

Score the output on three axes, integers 1–5 only (no decimals, no 0, no 6).

CLARITY:
  1 = vague, hard to parse, ambiguous referents
  3 = readable, mostly clear
  5 = precise, well-structured, every referent unambiguous

COMPLETENESS:
  1 = misses the core ask, large gaps
  3 = covers the main points, some gaps
  5 = thorough, all relevant aspects covered

ACTIONABILITY:
  1 = no concrete actions, generic platitudes
  3 = some concrete steps but missing detail
  5 = specific, executable, names files/commands/decisions

Respond with a single JSON object and nothing else:
{"clarity": <1-5>, "completeness": <1-5>, "actionability": <1-5>, "reasoning": "<concise rationale citing specific evidence from the output>"}`;
}

function logScore(name: string, score: JudgeScore, usage: { input_tokens: number; output_tokens: number }): void {
  console.log(
    `[${name}] tokens in=${usage.input_tokens} out=${usage.output_tokens} | ` +
    `clarity=${score.clarity} completeness=${score.completeness} actionability=${score.actionability}`,
  );
  console.log(`[${name}] reasoning: ${score.reasoning}`);
}

const ALL_FIXTURES = readdirSync(CORPUS_DIR)
  .filter(f => f.endsWith('.md'))
  .sort()
  .map(parseFixture);

const POSITIVE = ALL_FIXTURES.filter(f => f.kind === 'positive');
const NEGATIVE = ALL_FIXTURES.filter(f => f.kind === 'negative-control');

const EVALS_ENABLED = process.env.EVALS === '1';

if (EVALS_ENABLED && (process.env.ANTHROPIC_API_KEY ?? '').trim() === '') {
  throw new Error('EVALS=1 requires ANTHROPIC_API_KEY to be set and non-empty');
}

describe('skill prose corpus eval', () => {
  if (!EVALS_ENABLED) {
    test.skip('skipped — set EVALS=1 to run paid LLM judge', () => {});
    return;
  }

  test.each(POSITIVE)(
    'positive fixture $name scores >=3 on every axis',
    async (fixture) => {
      const result = await callJudge(buildJudgePrompt(fixture), isJudgeScore);
      logScore(fixture.name, result.data, result.usage);
      expect(result.data.clarity).toBeGreaterThanOrEqual(3);
      expect(result.data.completeness).toBeGreaterThanOrEqual(3);
      expect(result.data.actionability).toBeGreaterThanOrEqual(3);
    },
    60_000,
  );

  test.each(NEGATIVE)(
    'negative-control fixture $name scores <=2 on at least one axis',
    async (fixture) => {
      const result = await callJudge(buildJudgePrompt(fixture), isJudgeScore);
      logScore(fixture.name, result.data, result.usage);
      const min = Math.min(result.data.clarity, result.data.completeness, result.data.actionability);
      expect(min).toBeLessThanOrEqual(2);
    },
    60_000,
  );
});
