/**
 * One error type for collect, exec, and store. cli.ts catches GateError;
 * anything else becomes internal_error.
 */

export const DOC_ERRORS = 'docs/merge-gate.md#errors';
export const DOC_REASONS = 'docs/merge-gate.md#reasons';

export class GateError extends Error {
  readonly code: string;
  readonly fix: string;
  readonly doc: string;

  constructor(code: string, message: string, fix: string, doc = DOC_ERRORS) {
    super(message);
    this.name = 'GateError';
    this.code = code;
    this.fix = fix;
    this.doc = doc;
  }
}

export function isGateError(err: unknown): err is GateError {
  return err instanceof GateError;
}
