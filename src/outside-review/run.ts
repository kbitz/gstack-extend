import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hash, prepare, TASKS, type Request } from './prompt';
import { recover, type Classifier } from './recovery';

export interface TransportResult {
  status: string;
  result: string;
  exit_code?: number | null;
  stderr?: string;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
  session_id?: string;
  [key: string]: unknown;
}
export type Send = (prefix: string, task: string) => Promise<TransportResult>;

/** An invocation owns its directory. Exclusive claims survive crashes: unknown
 * completion never licenses another paid call. Saved output is replayed locally. */
export async function run(request: Request, diff: string, directory: string, transportIdentity: string, send: Send, classify: Classifier) {
  const prompt = prepare(request, diff);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const results = [];
  let replayOnly = false;
  for (const phase of prompt.phases) {
    const callId = hash(JSON.stringify([prompt.prefix, TASKS[phase], transportIdentity]));
    const saved = join(directory, `${callId}.json`);
    let response: TransportResult | undefined;
    let replay = false;
    let state_error: string | null = null;
    let operation = 'read-result';
    let dispatchedAt: string | null = null;
    let returnedAt: string | null = null;
    try {
      if (existsSync(saved)) {
        response = JSON.parse(readFileSync(saved, 'utf8'));
        if (!response || typeof response.status !== 'string' || typeof response.result !== 'string') {
          response = undefined;
          throw new Error('Invalid saved result');
        }
        replay = true;
      } else {
        if (replayOnly) {
          operation = 'blocked-by-state-error';
          throw new Error('Only saved results may be read after a state failure');
        }
        // Do not remove the claim on error: the provider might already have billed it.
        operation = 'claim';
        writeFileSync(join(directory, `${callId}.claim`), JSON.stringify({ call_id: callId, phase,
          dispatched_at: new Date().toISOString(), prompt: prompt.record(phase) }), { flag: 'wx', mode: 0o600 });
        operation = 'dispatch';
        dispatchedAt = new Date().toISOString();
        response = await send(prompt.prefix, TASKS[phase]);
        returnedAt = new Date().toISOString();
        operation = 'save-result';
        writeFileSync(saved, JSON.stringify(response), { flag: 'wx', mode: 0o600 });
      }
    } catch {
      state_error = operation;
      replayOnly = true;
    }
    response ??= { status: 'error', result: '' };
    const checked = recover(response.result ?? '', phase === 'challenge' ? 'review' : 'structured',
      response.status === 'completed' ? response.exit_code ?? 0 : response.exit_code || 1, response.stderr ?? '', classify);
    results.push({ phase, call_id: callId, replay, response, state_error, ...checked,
      prompt: prompt.record(phase), dispatched_at: dispatchedAt, returned_at: returnedAt });
    // After a state error, still surface other saved paid results on resume.
    // replayOnly prohibits new claims/sends; existing claims still prevent resends.
  }
  return results;
}

/** Allowlist: never copy prompts, outputs, provider diagnostics or arbitrary keys into voices.jsonl. */
export function measurement(result: Awaited<ReturnType<typeof run>>[number]) {
  const usage = result.response.usage;
  const token = (key: string) => typeof usage?.[key] === 'number' && Number.isFinite(usage[key]) && Number(usage[key]) >= 0 ? usage[key] : null;
  return { call_id: result.call_id, phase: result.phase, replay: result.replay,
    dispatched: result.dispatched_at !== null, state_error: result.state_error,
    parse: result.parse, credited: result.credited, verdict: result.classification.verdict,
    prompt: result.prompt, cache_read_input_tokens: token('cache_read_input_tokens'),
    cache_creation_input_tokens: token('cache_creation_input_tokens'),
    input_tokens: token('input_tokens'), output_tokens: token('output_tokens') };
}
