# Test fixture

Negative control for the docs/-absent finding. CLAUDE.md at root is not
a gate signal. This repo has no docs/ directory and no project doc at
root, and it must stay silent. The positive case is a repo-local
bin/roadmap-audit file, covered by docs-dir-absent-with-audit.
