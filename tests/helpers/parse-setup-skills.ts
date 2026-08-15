/**
 * parse-setup-skills.ts — regex parse of setup's SKILLS=( … ) array.
 *
 * Grammar (document actual behavior; this is not a bash parser):
 *   - `SKILLS=(` must be followed by a newline; the body ends at a line
 *     whose only token is `)`.
 *   - One unquoted name per line.
 *   - `#` comments (full-line or trailing) and blank lines are ignored.
 *   - A line with multiple tokens is returned as one invalid name
 *     (whitespace is not a splitter).
 *
 * Used by audit-compliance (install inventory) and skill-protocols
 * (cohort algebra). Protocol / preamble / conductor membership is NOT
 * derived from this list — those are explicit arrays in the tests.
 */

export function parseSetupSkills(setupText: string): string[] {
  const m = /^SKILLS=\(\s*\n([\s\S]*?)\n\s*\)\s*$/m.exec(setupText);
  if (!m) throw new Error('SKILLS=( ... ) array not found in setup');
  return (m[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
}
