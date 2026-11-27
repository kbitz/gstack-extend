### [review:files=bin/lib/update-channel.sh|tests/update.test.ts] Test gap: Observe stable lookup process cleanup after cancellation and timeout
- **ID:** wi-b8e4f4
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Current interruption evidence checks the result and cache. The tests do not observe whether an isolated transport child survives after closing its output streams.
- **Hypothesis (untested):** Interrupt an owned synthetic lookup that closes its inherited output descriptors. Assert that the transport and watchdog stop, the checker exits with cancellation, and no cache is written.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/update-channel.sh:26`
- **Evidence:** coverage-audit and testing specialist checked the changed contract and adjacent fixture assertions. Review produced no failing run for this gap.
- **Context:** Filed by /review-and-prep for Track 102B at `bcfd3ea` (2026-11-27). Revisit when a Track touches these paths.
- **Effort:** ?
