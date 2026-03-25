# TODOS

## P1 — After validation

### Persistent daemon graduation (Approach A)
Replace stateless Bun adapter with persistent Bun/TS daemon. Maintains Peekaboo
connections, caches ref maps, manages session state natively. Target: <500ms
see-act-see cycles.
- **Why:** Process spawn overhead (6 spawns per cycle) is the latency bottleneck.
  Session state (crash monitoring, action logs) is duct-taped with session files.
- **Effort:** M (human: ~2 weeks / CC: ~2-3 hours)
- **Depends on:** Core adapter validated + 20-step reliability proof passed
- **Context:** Design doc Approach A. The stateless adapter (Approach C) is
  intentional tech debt — graduate when latency exceeds 1000ms or session state
  management becomes a bottleneck.

### PID-aware liveness monitoring
Upgrade crash detection from .ips file polling to PID-based liveness. Catches hangs,
deadlocks, failed launches — not just clean crashes with diagnostic reports.
- **Why:** Polling DiagnosticReports for .ips files only catches clean crashes.
  Hangs, deadlocks, and stale reports are more common failure modes.
- **Effort:** S (human: ~2 days / CC: ~15 min)
- **Depends on:** Core skill working

### Browse-contract compatibility layer
Thin compatibility layer so /qa-native and /design-review-native can reuse gstack's
existing skill layering (/browse as transport, /qa as workflow).
- **Why:** gstack separates /browse (transport) from /qa and /design-review (workflow).
  If /browse-native exposes a compatible interface, existing workflow skills can be
  adapted rather than rebuilt from scratch.
- **Effort:** M (human: ~1 week / CC: ~1 hour)
- **Depends on:** Core skill validated + daemon graduation

### /qa-native skill (full QA loop)
Autonomous QA skill: explore app, find visual + interaction bugs, fix code, rebuild,
re-verify. The native equivalent of gstack's /qa.
- **Why:** This is the 10x version. /browse-native is the foundation; /qa-native
  is the autonomous loop that makes Claude a QA engineer for native apps.
- **Effort:** M (human: ~2 weeks / CC: ~2-3 hours)
- **Depends on:** Core adapter + daemon graduation + all expansions validated

## P2 — Phase 2

### Contrast ratio + VoiceOver order analysis
Extend accessibility report with pixel-level contrast analysis (screenshot sampling)
and VoiceOver navigation order verification (VoiceOver API).
- **Why:** Important accessibility metrics not available from the AX tree alone.
  Apple requires these for App Store review.
- **Effort:** M (human: ~1 week / CC: ~30 min)
- **Depends on:** Core accessibility report (labels + roles) working
