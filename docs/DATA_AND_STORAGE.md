# Data, persistence and recovery

## Clean-slate schema contract

Revision Director intentionally contains no historical schema migration or shape-repair path. Compatibility is determined by the durable schema contracts, **not by the application release string**.

Current identities are:

- application release: `va7.1-pass-f1` (provenance only);
- IndexedDB database: `revision-director`;
- database layout: version `3`;
- durable document schema: version `1`;
- backup payload: `revision-director-backup`, schema version `2`;
- backup archive: version `2`.

A newer or older Revision Director release may open the database and restore a backup when these schema identities remain compatible. The persisted application-version field is release provenance; a compatible release attempts to refresh it after opening, but a failed provenance-only refresh does not block access to otherwise compatible data. Backup application-version fields record export provenance. Neither release string is a compatibility gate.

If an IndexedDB layout or durable document/backup schema is unsupported, the application rejects it without transforming or deleting it. Do not clear site data to resolve a schema mismatch: use a compatible build to export a verified backup before any deliberate schema transition.

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

The database creation path creates stores only for a fresh database (`oldVersion === 0`). Existing databases open normally when their IndexedDB layout version and metadata database identity match the current schema. An attempted unsupported layout upgrade is aborted before schema mutation; a database created by a newer layout also fails closed. Both cases direct the user toward a compatible-build backup path rather than destructive clearing.

Metadata and settings are initialization records, not reconstruction hints. A fresh database creates both inside the same `oldVersion === 0` versionchange transaction that creates the object stores. Once database creation completes, either record being absent is treated as corruption: startup fails closed without synthesizing replacements or mutating surviving records.

Write durability is selective rather than global. Ordinary single-store writes—including active-retrieval autosaves—use the browser's default IndexedDB durability. Atomic multi-store domain commits request `durability: "strict"`: profile/settings lifecycle commits, unit/obligation structural commits, obligation/chunk commits, guarded review/evidence commits, FSRS settings-plus-projection rebases and backup restore. If an older IndexedDB implementation rejects the transaction-options argument with `TypeError`, the repository retries the same transaction with ordinary `readwrite`; other transaction failures are not swallowed. This keeps high-value semantic commits durability-biased without imposing strict-flush cost on rapidly changing operational state.

## Durable documents

Every top-level durable document carries `schemaVersion: 1`. Core documents include exam profiles, knowledge nodes and units, study events, revision obligations, evidence events, chunks, daily plans, settings, metadata and the active retrieval session.

Document schema versioning and IndexedDB layout versioning are separate invariants.

## Canonical storage boundary

Durable data follows:

```text
capture → sanitise → validate → canonicalise → transact → derive → render
```

Canonicalizers reject non-finite values, invalid ranges, malformed timing state, invalid workflow combinations, inconsistent scheduler provenance and unknown current-document fields. Fixed-shape nested runtime and Daily Plan records are also closed to unexpected fields. Required current-schema fields must be present; numeric fields are not string-coerced; over-limit recovery state is rejected rather than silently truncated, deduplicated or clamped. Canonicalization may normalize valid values, but it does not synthesize missing fields or repair older shapes.

Cross-document invariants are also canonical. If one or more exam profiles are active, `settings.activeProfileId` must identify an active profile. If no profile is active, it must be the empty string. Profile lifecycle changes that can alter this invariant commit the profile and settings together in one IndexedDB transaction. Startup validates the invariant and fails closed rather than silently repairing it.

## Active retrieval recovery

`ActiveRetrievalSession.v1` stores unfinished operational work under the fixed `current` identity. It includes queue/target state, workflow draft, diagram strokes and phase-time state.

Recovery uses two current-format copies:

- the complete IndexedDB active-session record;
- a bounded local emergency envelope.

Writes are serialized; normal edits are debounced; lifecycle events force recovery snapshots. Reconciliation chooses the newest valid current-format copy. Completion uses guarded commit transitions and tombstones so duplicate evidence commits cannot emerge from recovery.

Only active operational state is duplicated locally. Historical evidence, scheduler history and plans remain IndexedDB-owned.

## FSRS durable state

Memory review truth is append-only Evidence Events, including every closed-book corrective verification linked to memory, whether it fails or succeeds. Source-assisted repair is not memory evidence. The obligation's current FSRS card is a verified materialized projection. Host difficulty classification is derived from the canonical review history; the card lapse counter is not used as a fallback history source.

Settings persist the canonical scheduling policy, persistent-difficulty host policy, stock/staged/active personalization state and the last explicit scheduler rebase. Configuration fingerprints cover the complete FSRS scheduling policy and weight provenance; the host difficulty policy is intentionally outside that fingerprint because it does not rewrite the FSRS schedule. Policy changes, activation and deactivation replace settings plus reviewed memory projections transactionally; historical Evidence Events are never rewritten.

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

Reading performs bounded decompression, manifest/chunk/checksum verification, reconstruction and then domain-level relational validation. Manifest, counts, chunk and completion records have closed current shapes, and SHA-256 fields are exactly 64 hexadecimal characters.

A backup may contain zero or one stable active retrieval. Committing/completed active-session states are not valid backup payloads.

## Atomic state snapshots

Backup export and startup initialization read durable stores through one multi-store readonly IndexedDB transaction. This prevents a concurrent atomic write from producing a torn mixture of pre-commit and post-commit learning records. Startup deliberately does not canonicalize the active-retrieval record in this snapshot: active-session reconciliation remains owned by the recovery subsystem, which can repair a damaged IndexedDB copy from the bounded emergency copy. Backup export still validates any active-retrieval record strictly.

## Destructive restore

Restore is deliberately ceremonial. The verified restore controller is the only application restore path:

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
