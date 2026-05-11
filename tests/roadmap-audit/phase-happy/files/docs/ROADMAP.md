# Roadmap

## Current Plan

## Phase 1: Bun Test Migration

**End-state:** all bash test scripts deleted; bun test is the sole runner.

**Groups:** 1, 2 (sequential).

**Scaffolding contract:**
- Group 1 lands `scaffold/run-bin.ts` (consumed in Group 2).
- Group 1 lands `scaffold/effort.ts` (consumed in Group 2).

---

## Group 1: Toolchain ✓ Complete

### Track 1A: Toolchain setup
_1 task . low risk . [scaffold/run-bin.ts]_
_touches: scaffold/run-bin.ts_

- **Land scaffold helpers** -- introduces run-bin and effort. _scaffold/run-bin.ts._ (S)

## Group 2: Migration

### Track 2A: Wire helpers into checks
_1 task . low risk . [scaffold/effort.ts]_
_touches: scaffold/effort.ts_

- **Wire helpers** -- consumes the Group 1 scaffolding. _scaffold/effort.ts._ (M)

## Unprocessed
