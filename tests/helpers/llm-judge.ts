/**
 * llm-judge.ts — call Claude as a rubric scorer over arbitrary prose.
 *
 * Used by `tests/skill-llm-eval.test.ts` (gated on EVALS=1) to score
 * captured-prose fixtures on three axes (clarity, completeness,
 * actionability), each 1–5. The helper is small on purpose — every
 * branch maps to a unit test in `llm-judge.test.ts`.
 *
 * Hardening (locked during the Track 4C eng-review, all from codex catches):
 *   1. `maxRetries: 0` on the Anthropic client — the SDK's built-in
 *      exponential retry would compound with our explicit 1× 429 retry
 *      and silently inflate per-test cost + wall-clock.
 *   2. One explicit 429 retry with a 1s pause. Anything else throws.
 *   3. `stop_reason !== 'end_turn'` is rejected before the regex extract —
 *      max-tokens cutoff or refusal would otherwise feed truncated JSON
 *      into the parser and produce a confusing validator failure.
 *   4. `isJudgeScore` is a strict predicate: rejects NaN, Infinity,
 *      decimals, 0, 6, null, wrong types, and empty `reasoning`. The
 *      rubric is integers 1–5; anything else is malformed output.
 *   5. Validator is baked into `callJudge`'s signature (D11) — every
 *      caller must pass one. There is no default, because there is no
 *      "default-correct" shape for arbitrary judge tasks.
 *   6. `temperature: 0` + pinned model is the cheapest reproducibility
 *      we can buy; Anthropic does not guarantee determinism at temp 0,
 *      so the messaging frames it as "low variance," not "deterministic."
 */

import Anthropic, { RateLimitError } from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-5';

const JUDGE_AXES = ['clarity', 'completeness', 'actionability'] as const;
type JudgeAxis = (typeof JUDGE_AXES)[number];

export type JudgeScore = {
  [K in JudgeAxis]: number;
} & {
  reasoning: string;
};

/**
 * Strict predicate: every axis is an integer in [1, 5], reasoning is a
 * non-empty string. Rejects NaN, Infinity, decimals, 0, 6, null, missing
 * keys, wrong types, and whitespace-only reasoning. The rubric promises
 * integers 1–5 — anything else is malformed output, surface it loudly
 * rather than coercing.
 */
export function isJudgeScore(raw: unknown): raw is JudgeScore {
  if (raw === null || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  for (const k of JUDGE_AXES) {
    const v = obj[k];
    if (typeof v !== 'number') return false;
    if (!Number.isInteger(v)) return false;
    if (v < 1 || v > 5) return false;
  }
  if (typeof obj.reasoning !== 'string') return false;
  if (obj.reasoning.trim() === '') return false;
  return true;
}

export type JudgeUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type CallJudgeResult<T> = {
  data: T;
  usage: JudgeUsage;
};

export type CallJudgeOptions = {
  /**
   * Inject a client for tests. When omitted, constructs one with the
   * SDK defaults except `maxRetries: 0` (we own the retry policy).
   */
  client?: Anthropic;
  /** Override the pinned model — only useful for tests. */
  model?: string;
};

/**
 * Send `prompt` to Claude, expect a single JSON object in the response,
 * validate it with the supplied predicate, and return the typed result
 * + token usage.
 *
 * The validator is required because every caller has its own shape.
 * `callJudge<JudgeScore>(prompt, isJudgeScore)` is the canonical use
 * for the rubric scoring in `skill-llm-eval.test.ts`.
 *
 * Throws on:
 *   - rate-limit after 1 explicit retry
 *   - any other API error (passed through)
 *   - `stop_reason !== 'end_turn'` (model didn't finish naturally)
 *   - no JSON object in the response
 *   - JSON.parse failure on the extracted match
 *   - validator rejects the parsed object
 */
export async function callJudge<T>(
  prompt: string,
  validator: (raw: unknown) => raw is T,
  options: CallJudgeOptions = {},
): Promise<CallJudgeResult<T>> {
  const client = options.client ?? new Anthropic({ maxRetries: 0 });
  const model = options.model ?? MODEL;

  const response = await callOnceWith429Retry(client, model, prompt);

  if (response.stop_reason !== 'end_turn') {
    throw new Error(
      `judge response stop_reason was '${response.stop_reason}', expected 'end_turn' — ` +
      `truncation or refusal will produce malformed JSON`,
    );
  }

  const text = extractText(response.content);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`judge response did not contain a JSON object:\n${text}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(
      `judge response JSON.parse failed: ${(e as Error).message}\nraw match: ${match[0]}`,
    );
  }

  if (!validator(parsed)) {
    throw new Error(
      `judge response failed validator:\n${JSON.stringify(parsed, null, 2)}`,
    );
  }

  return {
    data: parsed,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

async function callOnceWith429Retry(
  client: Anthropic,
  model: string,
  prompt: string,
) {
  const params = {
    model,
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: 'user' as const, content: prompt }],
  };
  try {
    return await client.messages.create(params);
  } catch (e) {
    if (e instanceof RateLimitError) {
      await new Promise(r => setTimeout(r, 1000));
      return await client.messages.create(params);
    }
    throw e;
  }
}

function extractText(blocks: ReadonlyArray<{ type: string }>): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');
}
