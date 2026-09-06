// Hardcoded independently of setup so a malformed SKILLS edit fails loudly
// instead of shrinking installer coverage. skill-protocols pins the exact list.
export const EXPECTED_SETUP_SKILLS = [
  'pair-review',
  'roadmap',
  'full-review',
  'review-apparatus',
  'test-plan',
  'gstack-extend-upgrade',
  'gstack-extend-init',
  'review-and-prep',
] as const;
