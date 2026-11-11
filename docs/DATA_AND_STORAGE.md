# Data, persistence and recovery

## Clean-slate contract

Revision Director currently assumes **zero historical production data**. It intentionally contains no schema migration, version adaptation or backward-compatibility path.

Current identities are strict:

- application: `va7.1-pass-f1`;
- IndexedDB database: `revision-director`;
- database layout: version `3`;
- durable document schema: version `1`;
- backup payload: `revision-director-backup`, schema version `2`;
- backup archive: current archive contract only.

If an existing database or backup belongs to another application/schema identity, it is rejected. Development cutovers should clear site data or regenerate current-format fixtures; production code must not infer or transform old shapes.

## IndexedDB

The current database contains:

- `profiles`;
- `nodes`;
- `units`;
- `studyEvents`;
- `obligations`;
- `evidenceEvents`;
- `chunks`;
- `dailyPlans`;
- `settings`;
- `metadata`;
- `activeRetrieval`.

The database creation path accepts only a fresh database (`oldVersion === 0`). Metadata must match the current database and application identity.

## Durable documents

Every top-level durable document carries `schemaVersion: 1`. Core documents include exam profiles, knowledge nodes and units, study events, revision obligations, evidence events, chunks, daily plans, settings, metadata and the active retrieval session.

Document schema versioning and IndexedDB layout versioning are separate invariants.

## Canonical storage boundary

Durable data follows:

```text
capture → sanitise → validate → canonicalise → transact → derive → render
```

Canonicalizers reject non-finite values, invalid ranges, impossible relations, malformed timing state, invalid workflow combinations and inconsistent scheduler provenance. Required current-schema fields must be present; canonicalization may normalize valid values, but it does not synthesize missing fields or repair older shapes.

## Active retrieval recovery

`ActiveRetrievalSession.v1` stores unfinished operational work under the fixed `current` identity. It includes queue/target state, workflow draft, diagram strokes and phase-time state.

Recovery uses two current-format copies:

- the complete IndexedDB active-session record;
- a bounded local emergency envelope.

Writes are serialized; normal edits are debounced; lifecycle events force recovery snapshots. Reconciliation chooses the newest valid current-format copy. Completion uses guarded commit transitions and tombstones so duplicate evidence commits cannot emerge from recovery.

Only active operational state is duplicated locally. Historical evidence, scheduler history and plans remain IndexedDB-owned.

## FSRS durable state

Memory review truth is append-only Evidence Events, including successful returns from corrective relearning. The obligation's current FSRS card is a verified materialized projection.

Settings persist stock/staged/active personalization state and the last explicit scheduler rebase. Configuration and weight fingerprints preserve transition provenance. Activation, deactivation and retention changes replace settings plus reviewed memory projections transactionally; historical Evidence Events are never rewritten.

Backup and restore carry the same current-format state. Restore verifies the referenced scheduler and every reviewed memory projection before replacement. Scheduling policy and optimizer-gate details are documented in `SCHEDULING_AND_PLANNING.md`.

## Storage health

The storage facade reports persistence capability and quota pressure. Persistence is requested only through the explicit user action. Quota status is warning from 75% and critical from 90%.

## Backup archive

The backup codec owns external representation and verification, not domain validity. The pipeline is:

```text
canonical payload
→ bounded entity chunks
→ per-chunk SHA-256 hashes
→ manifest + SHA-256 completion proof
→ optional gzip
```

Reading performs bounded decompression, manifest/chunk/checksum verification, reconstruction and then domain-level relational validation.

A backup may contain zero or one stable active retrieval. Committing/completed active-session states are not valid backup payloads.

## Destructive restore

Restore is deliberately ceremonial:

1. inspect candidate without mutation;
2. validate and preview it;
3. create and self-verify a current-state safety backup;
4. require acknowledgement that the safety copy was saved;
5. choose restore/discard treatment for any unfinished source retrieval;
6. confirm replacement;
7. revalidate the candidate and safety proof;
8. replace canonical state transactionally;
9. hydrate the current application state.

Safety proofs are candidate-bound, one-use and expire after 30 minutes. Any current-state change invalidates the proof.

If current local state is too damaged to produce a valid safety backup, the controller may export a bounded non-importable `.rdrescue` forensic envelope before a known-good replacement. A rescue is not a backup and cannot be restored into the application.

## Non-durable coordination state

The cross-tab ownership lease and plugin runtime state are not learning documents and are excluded from backups. Ownership state coordinates mutation; plugin state exists only for the browser session.
