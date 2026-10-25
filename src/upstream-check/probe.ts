/**
 * Child-process probe for `bin/upstream-check`. It imports the installed
 * upstream helper modules (running their top-level code, as the adapter does)
 * and runs the classifier golden table, so a hung or noisy module can only
 * cost the parent its deadline. The parent frames this process's stdout:
 * `<nonce> begin <what>` before each import or the golden run, and one
 * `<nonce> result <json>` line at the end. Everything else is drained.
 */
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recover, type Classifier } from '../outside-review/recovery.ts';

export interface GoldenCase {
  id: string;
  gate: 'review' | 'structured';
  text: string;
  verdict: 'clean' | 'findings';
  credited: boolean;
}

const ADVISORY = '[P2] advisory: rename the helper for clarity.';
const RECOMMENDATION = 'Recommendation: merge because only advisory findings remain.';

/**
 * Advisory findings never block by themselves; the reviewer's own last
 * `Verdict: not ready` line does (upstream db87940e, 1.91.198.0 or later).
 * Each case names the gate the adapter dispatches it through and runs through
 * `recover`, so credit is the adapter's credit.
 */
export const GOLDEN_CASES: readonly GoldenCase[] = [
  { id: 'review-advisory', gate: 'review', text: `${ADVISORY}\n${RECOMMENDATION}`, verdict: 'clean', credited: true },
  { id: 'review-not-ready', gate: 'review', text: `${ADVISORY}\n${RECOMMENDATION}\nVerdict: not ready`, verdict: 'findings', credited: true },
  { id: 'structured-advisory', gate: 'structured', text: ADVISORY, verdict: 'clean', credited: true },
  { id: 'structured-not-ready', gate: 'structured', text: `${ADVISORY}\nVerdict: not ready`, verdict: 'findings', credited: true },
];

export interface ExportResult { module: string; name: string; status: 'ok' | 'drift'; reason: string }
export interface ClassifierResult { id: string; verdict: string; credited: boolean; error?: string }
export interface ProbeResult { exports: ExportResult[]; classifier: ClassifierResult[] }

/** Error class name only; upstream messages are never reported. */
const errorClass = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z0-9_$.]{1,64}$/.test(name) ? name : 'Error';
};

export async function probe(root: string, helpers: readonly { module: string; name: string }[], nonce: string, write: (line: string) => void) {
  const result: ProbeResult = { exports: [], classifier: [] };
  const loaded: Record<string, unknown> = {};
  for (const { module, name } of helpers) {
    const path = join(root, 'lib', `${module}.ts`);
    write(`${nonce} begin ${path}`);
    try {
      const imported = await import(pathToFileURL(path).href);
      loaded[name] = imported[name];
      result.exports.push(typeof imported[name] === 'function'
        ? { module: path, name, status: 'ok', reason: 'function' }
        : { module: path, name, status: 'drift', reason: `export is ${imported[name] === undefined ? 'missing' : typeof imported[name]}, not a function` });
    } catch (error) {
      result.exports.push({ module: path, name, status: 'drift', reason: `import failed (${errorClass(error)})` });
    }
  }
  write(`${nonce} begin classifier`);
  const classify = loaded.classifyOutsideReview;
  for (const golden of GOLDEN_CASES) {
    if (typeof classify !== 'function') {
      result.classifier.push({ id: golden.id, verdict: 'none', credited: false, error: 'classifyOutsideReview unavailable' });
      continue;
    }
    try {
      const checked = recover(golden.text, golden.gate, 0, '', classify as Classifier);
      result.classifier.push({ id: golden.id, verdict: String(checked.classification.verdict), credited: checked.credited });
    } catch (error) {
      result.classifier.push({ id: golden.id, verdict: 'none', credited: false, error: `threw ${errorClass(error)}` });
    }
  }
  write(`${nonce} result ${JSON.stringify(result)}`);
}

if (import.meta.main) {
  const [nonce, root, helpersJson] = process.argv.slice(2) as [string, string, string];
  await probe(resolve(root), JSON.parse(helpersJson), nonce, (line) => process.stdout.write(`${line}\n`));
  // Flush the result frame before exiting: an import may have left handles open.
  await new Promise<void>((done) => process.stdout.write('', () => done()));
  process.exit(0);
}
