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
