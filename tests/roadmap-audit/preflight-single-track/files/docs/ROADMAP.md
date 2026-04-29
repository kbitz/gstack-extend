# Roadmap

## Group 1: Solo with preflight

**Pre-flight** (shared-infra; serial, one-at-a-time):
- **[1]** Setup helper — adds the foo helper. `[src/foo.py], ~10 lines.` (S)

### Track 1A: Do the thing
_1 task . low risk . [src/bar.py]_
_touches: src/bar.py_

- **Implement bar** -- adds the bar helper. _src/bar.py._ (S)

## Group 2: Multi-track with preflight

**Pre-flight** (shared-infra; serial, one-at-a-time):
- **[1]** Shared helper — extracted util. `[src/util.py], ~20 lines.` (S)

### Track 2A: First parallel
_1 task . low risk . [src/a.py]_
_touches: src/a.py_

- **Implement a** -- adds a. _src/a.py._ (S)

### Track 2B: Second parallel
_1 task . low risk . [src/b.py]_
_touches: src/b.py_

- **Implement b** -- adds b. _src/b.py._ (S)

## Unprocessed
