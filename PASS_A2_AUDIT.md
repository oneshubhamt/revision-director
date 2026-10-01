# Pass A2 objective audit

## Scope

Pass A2 was limited to production data contracts and the application-wide storage
boundary. No migration or compatibility layer was required or added.

## Objective 1 — Establish the production database

**Met.**

- Database identity is `revision-director`.
- IndexedDB layout version is 1.
- Ten stores are created, including a dedicated metadata store.
- Startup creates or verifies `AppMetadata` before ordinary operation.
- Prior prototype database names are not opened or migrated.

## Objective 2 — Introduce document schema versions

**Met.**

All ten durable document types carry `schemaVersion: 1`. Database layout version,
document versions and backup version are independent contracts. Unsupported
versions are rejected.

## Objective 3 — Implement canonical normalisers

**Met.**

Entity-specific canonical normalisers cover profiles, nodes, units, Study Events,
obligations, Evidence Events, chunks, daily plans, settings and metadata.
`RevisionData` applies them at reads, writes and atomic persistence boundaries;
backup validation returns a canonical payload before replacement.

## Objective 4 — Add diagnostics and storage-health contracts

**Met.**

- `AppDiagnostics` deduplicates repeated failures and bounds count and size.
- `StorageHealthSnapshot` reports IndexedDB availability, persistence state,
  quota usage, health level, diagnostic count and recent error state.
- Storage failures are recorded and remain visible rather than being silently
  treated as successful persistence.
- Browser storage APIs are capability-checked.

## Objective 5 — Remove prototype/reset terminology and seeding

**Met.**

- Automatic sample seeding is absent from the production path.
- The prototype reset action and service operation are absent.
- `seededSamples` is absent from the settings contract.
- Production first launch is a valid empty state.
- QA sample content is isolated in an explicit versioned test fixture.

## Preservation assessment

Protected Revision Director capabilities were retained:

- hierarchy and Knowledge Units;
- Study Events and append-only Evidence Events;
- six obligation types and six workflows;
- exact FSRS memory policy and five deterministic non-memory policies;
- duration learning, weekly balance and capacity planning;
- automatic chunking and final synthesis;
- daily-plan versions and execution outcomes;
- validated frozen Study Director bridge;
- current presentation and interaction model.

## Result

Pass A2 objectives are complete. No known pass-specific defect remains after the
targeted QA recorded in `PASS_A2_TARGETED_QA.md`.
