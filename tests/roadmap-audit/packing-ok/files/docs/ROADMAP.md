# Roadmap

## In Progress

_(none)_

## Current Plan

#### Group 1: Mixed lanes
_Depends on: none_

##### Track 1A: One
_1 task . ~S . low risk . [a.ts]_
_touches: src/a.ts_
_out: 1B, 2A_
_produces: a.ts helper_

- **Write helper** -- . _src/a.ts, ~20 lines._ (S)

##### Track 1B: Two
_1 task . ~S . low risk . [b.ts]_
_touches: src/b.ts_
_out: 1A, 2A_
_produces: b.ts helper_

- **Write other** -- . _src/b.ts, ~20 lines._ (S)

#### Group 2: After
_Depends on: Group 1_

##### Track 2A: Consumer
_1 task . ~S . low risk . [c.ts]_
_touches: src/c.ts_
_read-first: 1A, 1B_
_produces: c.ts uses both helpers_

- **Consume** -- . _src/c.ts, ~20 lines._ (S)

## Future

## Shipped

History: docs/roadmap-shipped.md
