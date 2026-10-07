/**
 * product-spec.ts — recognize /project-spec's canonical product spec.
 *
 * The spec always lives at docs/SPEC.md and carries the template's
 * `## Authority` section. A docs/SPEC.md without that section (for example a
 * project's existing API spec) is an ordinary document, so the layout checks
 * keep their normal TODO and doc-type heuristics for it.
 */

export const CANONICAL_SPEC = 'docs/SPEC.md';

const AUTHORITY_HEADING_RE = /^## Authority[ \t]*$/m;

export function isProductSpec(rel: string, content: string): boolean {
  return rel === CANONICAL_SPEC && AUTHORITY_HEADING_RE.test(content);
}
