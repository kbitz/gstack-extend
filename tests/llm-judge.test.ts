import { describe, expect, test } from 'bun:test';
import Anthropic, { RateLimitError } from '@anthropic-ai/sdk';
import { callJudge, isJudgeScore, type JudgeScore } from './helpers/llm-judge.ts';

// ─── Fake client ────────────────────────────────────────────────────────

type CreateImpl = (params: unknown) => Promise<unknown> | unknown;

function fakeClient(impl: CreateImpl): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async (p: unknown) => {
        call += 1;
        return impl({ params: p, call });
      },
    },
  } as unknown as Anthropic;
}

function makeResponse(
  text: string,
  overrides: Partial<{ stop_reason: string; input_tokens: number; output_tokens: number }> = {},
) {
  return {
    stop_reason: overrides.stop_reason ?? 'end_turn',
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: overrides.input_tokens ?? 12,
      output_tokens: overrides.output_tokens ?? 34,
    },
  };
}

const VALID_JSON = '{"clarity":4,"completeness":3,"actionability":5,"reasoning":"clear and specific"}';

// ─── callJudge branches ─────────────────────────────────────────────────

describe('callJudge', () => {
  test('happy path returns parsed data + usage', async () => {
    const client = fakeClient(() => makeResponse(VALID_JSON));
    const result = await callJudge('eval this', isJudgeScore, { client });
    expect(result.data).toEqual({
      clarity: 4,
      completeness: 3,
      actionability: 5,
      reasoning: 'clear and specific',
    });
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 34 });
  });

  test('rejects stop_reason !== "end_turn" before regex extract', async () => {
    const client = fakeClient(() => makeResponse(VALID_JSON, { stop_reason: 'max_tokens' }));
    await expect(callJudge('p', isJudgeScore, { client })).rejects.toThrow(/stop_reason was 'max_tokens'/);
  });

  test('throws when response contains no JSON object', async () => {
    const client = fakeClient(() => makeResponse('Sorry, I cannot evaluate that.'));
    await expect(callJudge('p', isJudgeScore, { client })).rejects.toThrow(/did not contain a JSON object/);
  });

  test('throws on JSON.parse failure with the raw match in the message', async () => {
    const client = fakeClient(() => makeResponse('here you go: { not, valid: json }'));
    await expect(callJudge('p', isJudgeScore, { client })).rejects.toThrow(/JSON\.parse failed/);
  });

  test('throws when validator rejects parsed object', async () => {
    const client = fakeClient(() => makeResponse('{"clarity":7,"completeness":3,"actionability":2,"reasoning":"x"}'));
    await expect(callJudge('p', isJudgeScore, { client })).rejects.toThrow(/failed validator/);
  });

  test('retries once on 429 then succeeds', async () => {
    const client = fakeClient(({ call }) => {
      if ((call as number) === 1) {
        throw new RateLimitError(429, undefined, 'rate_limited', new Headers(), 'rate_limit_error');
      }
      return makeResponse(VALID_JSON);
    });
    const result = await callJudge('p', isJudgeScore, { client });
    expect(result.data.clarity).toBe(4);
  });

  test('non-429 errors are re-thrown without retry', async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      throw new Error('boom');
    });
    await expect(callJudge('p', isJudgeScore, { client })).rejects.toThrow(/boom/);
    expect(calls).toBe(1);
  });
});

// ─── isJudgeScore predicate ─────────────────────────────────────────────

describe('isJudgeScore', () => {
  const valid: JudgeScore = { clarity: 3, completeness: 4, actionability: 5, reasoning: 'ok' };

  test('accepts integers 1–5 with non-empty reasoning', () => {
    expect(isJudgeScore(valid)).toBe(true);
    expect(isJudgeScore({ ...valid, clarity: 1 })).toBe(true);
    expect(isJudgeScore({ ...valid, clarity: 5 })).toBe(true);
  });

  test('rejects out-of-range integers (0, 6)', () => {
    expect(isJudgeScore({ ...valid, clarity: 0 })).toBe(false);
    expect(isJudgeScore({ ...valid, clarity: 6 })).toBe(false);
  });

  test('rejects decimals, NaN, Infinity', () => {
    expect(isJudgeScore({ ...valid, clarity: 3.5 })).toBe(false);
    expect(isJudgeScore({ ...valid, clarity: Number.NaN })).toBe(false);
    expect(isJudgeScore({ ...valid, clarity: Number.POSITIVE_INFINITY })).toBe(false);
  });

  test('rejects wrong types and missing axes', () => {
    expect(isJudgeScore({ ...valid, clarity: '3' })).toBe(false);
    expect(isJudgeScore({ ...valid, clarity: null })).toBe(false);
    const { completeness: _omit, ...missing } = valid;
    expect(isJudgeScore(missing)).toBe(false);
  });

  test('rejects empty / whitespace-only reasoning', () => {
    expect(isJudgeScore({ ...valid, reasoning: '' })).toBe(false);
    expect(isJudgeScore({ ...valid, reasoning: '   \n\t ' })).toBe(false);
    expect(isJudgeScore({ ...valid, reasoning: 42 })).toBe(false);
  });

  test('rejects null and non-objects', () => {
    expect(isJudgeScore(null)).toBe(false);
    expect(isJudgeScore(undefined)).toBe(false);
    expect(isJudgeScore('not an object')).toBe(false);
    expect(isJudgeScore(42)).toBe(false);
  });
});
