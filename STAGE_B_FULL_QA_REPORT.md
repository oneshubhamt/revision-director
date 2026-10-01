# Revision Director VA7.1 — Stage B Full Regression and Hostile Recovery QA

## Certification verdict

Stage B is certified after full regression, hostile recovery, ownership-race and evidence-integrity testing.

The certified runtime remains `va7.1-pass-b3`; this report closes Stage B without introducing a new product-feature pass.

## Defects found and corrected

### 1. Startup persistence request was not passive

`RevisionData.open()` called `refreshStorageHealth()` with a persistence-requesting default. On browsers where storage was not already persistent, startup could call `navigator.storage.persist()` without the learner explicitly choosing the Settings action.

Correction:

- startup now calls `refreshStorageHealth(false)`;
- the storage-health method defaults to passive inspection;
- only the explicit Settings action calls `refreshStorageHealth(true)`.

### 2. Takeover requester could force-overwrite an intervening owner

After an old owner released its lease, another secondary tab could acquire it before the original takeover requester resumed. The requester then used a forced acquisition path and could overwrite that third tab.

Correction:

- takeover completion now uses normal verified acquisition;
- an intervening live lease is respected;
- exactly one canonical owner remains after a three-tab handoff race.

### 3. Heartbeat messages were not checked against the canonical lease

A stale or forged BroadcastChannel heartbeat could temporarily demote the real owner even when localStorage still identified that tab as canonical owner.

Correction:

- heartbeat messages affect ownership state only when their tab identity matches the currently verified lease.

## Hostile recovery coverage

The permanent `tests/stage-b-hostile-recovery.spec.py` suite verifies:

- malformed emergency JSON is rejected and diagnosed;
- valid IndexedDB state repairs a corrupt emergency copy;
- valid emergency state survives and repairs a corrupt IndexedDB active document;
- a recovered target deleted from the domain database is rejected and both recovery copies are cleared;
- a stale `committing` snapshot returns to a safe retryable `active` state;
- retry after a committing-state crash creates exactly one Evidence Event;
- a hostile commit-token change before the atomic transaction aborts all Evidence and scheduler mutation;
- transaction abort leaves the obligation byte-for-byte unchanged;
- the active session is restored for retry after the aborted transaction;
- the subsequent valid retry commits exactly once;
- a newer completed tombstone suppresses and clears older unfinished recovery state.

## Evidence and scheduler integrity audit

The review commit transaction continues to atomically own:

- Knowledge Unit evidence counters;
- Revision Obligation policy state and due date;
- Evidence Event insertion;
- relearning follow-up or return-obligation changes;
- chunk state where applicable;
- daily-plan outcome changes;
- post-commit active-session transition.

The transaction proceeds only when the durable active-session guard matches:

- session identity;
- expected session revision;
- active target;
- committing status;
- commit token.

A mismatch aborts before any domain mutation. Evidence IDs remain deterministic from the commit token, providing a second idempotency boundary.

## Full regression results

### Stage B suites

- 25/25 B1 durable-active-retrieval checks.
- 23/23 B1 persistent-browser recovery checks.
- 35/35 B2 phase-time runtime checks.
- 27/27 B2 browser timing checks.
- 40/40 B3 ownership and storage-health checks.
- 26/26 B3 multi-document browser checks.
- 23/23 Stage B hostile recovery browser checks.

### Domain, planning and hostile validation

- 139/139 kernel, workflow, policy and backup checks.
- 24/24 capacity-planning scenarios.
- 26/26 adaptive-planning checks.
- 138,674/138,674 property, persistence and hostile-validation assertions.
- 20/20 production-contract and storage-facade checks.

### Build and packaging

- 29/29 source-ownership checks.
- 120/120 build-integrity checks.
- 29/29 static HTML checks.
- strict TypeScript compilation and one-IIFE build passed.

### Full browser regression

- 7/7 principal Chromium workflows.
- 3/3 hostile and large-data Chromium scenarios.
- 161/161 responsive, accessibility and rerender checks.

## Preservation verdict

No regression was found in:

- all six obligation types;
- all six retrieval workflows;
- exact FSRS memory scheduling;
- all five non-memory policy families;
- Study Events and append-only Evidence Events;
- duration learning and unreliable-time exclusion;
- weekly balance, interleaving and capacity planning;
- automatic chunking and final synthesis;
- daily-plan versions and execution outcomes;
- Study Director bridge validation;
- Revision Director's established visual language.

## Remaining target-device boundary

Automated browser shims cannot fully reproduce:

- genuine operating-system sleep and wake;
- native browser process termination and restart;
- tab eviction under device memory pressure;
- real IndexedDB quota exhaustion or browser storage eviction;
- mobile browser lifecycle differences.

These remain target-device certification items, not known application defects.

## Final status

Stage B is closed and suitable as the baseline for Stage C.
