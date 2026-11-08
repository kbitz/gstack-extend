#!/usr/bin/env bash
#
# full-suite.sh — one-command full run for a fresh checkout: install the locked
# dependencies, then run every test. Execute it directly; a caller that runs
# commands without a shell needs no wrapper. Extra arguments go to
# `bun run test` unchanged (see CLAUDE.md's Testing section for what they do).
set -euo pipefail
# A relative call makes the cd operand below relative, and an exported CDPATH
# would then redirect it away from this checkout.
unset CDPATH
cd "$(dirname "$0")/.."
bun install --frozen-lockfile
export EVALS_ALL=1
exec bun run test "$@"
