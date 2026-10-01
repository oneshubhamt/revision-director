# Pass B3 objective audit — Cross-tab ownership and lifecycle closure

## Verdict

All five Pass B3 objectives are implemented. The pass closes Stage B's browser-session reliability scope without changing Revision Director's domain model, retrieval workflows, scheduler policies, evidence semantics or design language.

## 1. One mutable review owner — met

`ReviewOwnershipCoordinator` owns a versioned, verified local lease with:

- an opaque tab identity and claim identity;
- a 4-second heartbeat;
- a 15-second stale threshold;
- write-then-read verification before mutation is enabled;
- fail-closed behaviour when local storage cannot safely hold the lease;
- lease revalidation on every mutation check.

UI forms, review actions, canvas interaction, backup import, settings changes and mutating public-bridge operations all require current verified ownership.

## 2. Read-only secondary tabs — met

A secondary document may:

- navigate all panes;
- search the Library;
- inspect records and plans;
- close dialogs;
- export a backup;
- request an explicit takeover.

It may not create, edit, restore, rate, pause, classify, draw, plan, chunk or otherwise mutate application data. Read-only plan rendering avoids automatic chunk and daily-plan writes.

## 3. Takeover and canonical hydration — met

Takeover uses a conservative BroadcastChannel handshake:

1. the requesting tab asks the active owner to release;
2. the owner refuses handoff while an evidence commit is in flight;
3. the owner snapshots and durably flushes the active retrieval;
4. the owner releases its verified lease;
5. the requester writes and verifies its own claim;
6. IndexedDB and emergency copies are reconciled;
7. the complete canonical review state is hydrated;
8. mutation is enabled only after lease revalidation.

No force-steal occurs while a valid owner remains active. An expired lease can be reclaimed, but canonical hydration still precedes mutation.

## 4. Page visibility and exit handling — met

- Hidden visibility reconciles phase time, forces the emergency snapshot, starts a durable flush and renews the lease.
- Focus, visible visibility and pageshow re-evaluate ownership, refresh storage capability and reconcile active time only after ownership is valid.
- Pagehide and beforeunload force the current emergency snapshot and release ownership.
- A remaining document can safely reacquire and hydrate after release.
- Timers and interruption overlays stop immediately when a tab loses mutation rights.

## 5. Storage persistence and quota reporting — met

The storage-health contract now distinguishes:

- persistent storage granted;
- persistence available but not yet requested;
- persistence denied;
- persistence API unsupported.

Passive lifecycle checks never request persistence. The Settings action explicitly requests it. Quota state is reported as:

- healthy below 75%;
- warning at 75% or above;
- critical at 90% or above.

Warnings are shown in both Settings and a bounded application-level banner. Inspection failures are recorded through the existing bounded diagnostics journal.

## Preservation audit

Pass B3 preserves:

- all six obligation types;
- all six retrieval workflows;
- exact `ts-fsrs@5.4.1` memory scheduling;
- all five non-memory policy families;
- Study Events and append-only Evidence Events;
- adaptive duration learning and interruption reliability;
- capacity planning, balance, interleaving and chunk synthesis;
- daily-plan versions and execution outcomes;
- B1 durable recovery and duplicate-commit protection;
- B2 phase-aware timing and gap classification;
- the validated Study Director bridge;
- Revision Director's current presentation language.

## Deliberate boundary

This pass establishes browser-document ownership, not cloud or multi-device locking. Real operating-system sleep, native browser restart, tab eviction and storage-pressure behaviour remain target-device certification work. PWA, cloud sync and presentation-engine work remain outside Stage B.

## Full-QA closure amendments

The Stage B closure audit found and corrected three B3 boundary issues:

- startup storage inspection now remains passive until the explicit Settings request;
- takeover acquisition no longer force-overwrites a third tab that acquires during handoff;
- heartbeat messages are accepted only when they match the verified lease.

The corrected B3 runtime passed the full matrix documented in `STAGE_B_FULL_QA_REPORT.md`.
