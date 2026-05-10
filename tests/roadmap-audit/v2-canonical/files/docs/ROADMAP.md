# Roadmap

## Shipped

#### Group 1: Bootstrap ✓ Shipped (v0.1.0)
- Track 1A — _shipped (v0.1.0)_

#### Group 2: First feature ✓ Shipped (v0.2.0)
- Track 2A — _shipped (v0.2.0)_

## In Progress

#### Group 3: Multi-account
##### Track 3A: Per-account sync ✓ Shipped (v0.4.0)
##### Track 3B: Selection coherence
_2 tasks . ~M . medium risk . SelectionState.swift, TriageCoordinator.swift_
_touches: src/SelectionState.swift, src/TriageCoordinator.swift_

- **Preserve selection on sync** -- guard post-sync flow. _src/SelectionState.swift, ~30 lines._ (S)
- **Cross-account thread collision** -- carry account id. _src/TriageCoordinator.swift, ~40 lines._ (M)

## Current Plan

#### Group 4: Outbox UI
##### Track 4A: View
_2 tasks . ~M . medium risk . OutboxView.swift, OutboxViewModel.swift_
_touches: src/Views/OutboxView.swift, src/ViewModels/OutboxViewModel.swift_

- **Outbox view** -- list failed items. _src/Views/OutboxView.swift, ~150 lines._ (M)
- **Outbox view-model** -- bind state. _src/ViewModels/OutboxViewModel.swift, ~80 lines._ (S)

##### Track 4B: Reliability
_1 task . ~M . medium risk . OutboxQueue.swift_
_touches: src/Sync/OutboxQueue.swift_

- **Make undo outbox-linked** -- check outbox state before reversing. _src/Sync/OutboxQueue.swift, ~60 lines._ (M)

#### Group 5: Delivery
_Depends on: Group 4_

##### Track 5A: Confirmation
_1 task . ~M . medium risk . DeliveryTracker.swift_
_touches: src/Services/DeliveryTracker.swift_

- **Post-send confirmation** -- poll Sent folder. _src/Services/DeliveryTracker.swift, ~120 lines._ (M)

## Future

- **Cross-device account sync** — sync account configurations via iCloud KVS.
- **Investigate Graph rate-limit handling** — current backoff is global; should be per-account.
