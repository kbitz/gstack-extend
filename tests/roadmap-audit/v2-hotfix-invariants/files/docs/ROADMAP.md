# Roadmap

## Shipped

#### Group 1: Auth ✓ Shipped (v0.5.0)
- Track 1A — _shipped (v0.5.0)_

## Current Plan

### Group 2: Hotfix: Crash on login (multi-track — invalid)
_Depends on: Group 1_

#### Track 2A: First fix
_1 task . high risk . [src/login.swift]_
_touches: src/login.swift_

- **Fix crash** -- guard the nil. _src/login.swift, ~10 lines._ (S)

#### Track 2B: Second fix
_1 task . high risk . [src/session.swift]_
_touches: src/session.swift_

- **Reset session** -- clean state. _src/session.swift, ~10 lines._ (S)

### Group 3: Hotfix: Bad dep (depends on non-shipped Group)
_Depends on: Group 2_

#### Track 3A: Patch
_1 task . high risk . [src/foo.swift]_
_touches: src/foo.swift_

- **Patch** -- fix it. _src/foo.swift, ~5 lines._ (S)

## Future
