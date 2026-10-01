# Revision Director VA7.1 — Pass B3 data model

## Durable document contracts

Every durable top-level document carries `schemaVersion: 1`. Current documents:

- `ExamProfile.v1`;
- `KnowledgeNode.v1`;
- `KnowledgeUnit.v1`;
- `StudyEvent.v1`;
- `RevisionObligation.v1`;
- `EvidenceEvent.v1`;
- `ObligationChunk.v1`;
- `DailyPlanRecord.v1`;
- `AppSettings.v1`;
- `AppMetadata.v1`;
- `ActiveRetrievalSession.v1`.

Database-layout versioning remains independent from document schema versioning.

## ActiveRetrievalSession.v1

The fixed record `current` contains unfinished operational state:

- monotonic revision and active/committing/completed status;
- ordered targets, active index and active target;
- workflow phase and bounded draft state;
- diagram strokes;
- `PhaseTimeRuntimeSnapshot`;
- verified active elapsed time derived from phase totals;
- session timestamps and optional commit token.

The compact emergency envelope uses the same canonical contract but may bound text
and evenly downsample diagram points. IndexedDB retains the complete session.

## PhaseTimeRuntimeSnapshot

```text
currentPhase
state: running | paused | gap-pending
sessionStartedAt
lastTickAt
activeByPhase
pauseStartedAt?
pauseHistory[]
phaseHistory[]
gapHistory[]
pendingGap?
sourceVisible
sourceRevealAt?
backwardClockCount
```

`activeByPhase` owns independent totals for:

- attempt;
- compare;
- relearn-repair;
- relearn-verify.

Pause history distinguishes manual pause, classified inactive break and time spent
answering the interruption prompt. Phase history records source reveal,
verification start and verification reveal. Gap history records the detected gap,
classification, focus/break/ignored partition and excluded prompt time.

## TimingEvidenceSummary

Evidence Events and completed chunks retain:

- total verified active time;
- phase-specific active totals;
- pause duration and count;
- inactive-gap count;
- classified focus and break time;
- ignored time;
- excluded prompt time;
- backward-clock count;
- source-reveal boundary;
- duration-reliability decision and flags.

An ignored or unresolved gap makes duration evidence ineligible for adaptive
learning. The evidence remains append-only and auditable.

## DurationObservation

Every Evidence Event retains the duration-learning decision. Pass B2 adds the
rejection reason:

```text
unreliable-interruption
```

This preserves the actual review and timing record while leaving the learned
estimate unchanged.

## ObligationChunk

A chunk remains an execution unit rather than an independent schedulable memory.
A completed chunk may retain its own timing summary. Parent scheduling advances
only after final synthesis evidence, and parent duration learning requires reliable
cycle timing.

## Browser ownership lease

The cross-tab ownership lease is operational coordination state, not a durable
revision document. It is stored under `revision-director:review-owner:v1` in
local storage and contains only version, tab identity, claim identity, expiry and
update time. It is excluded from backups and learning history.

The lease does not replace `ActiveRetrievalSession.v1`. Handoff always flushes
and reconciles the active session through IndexedDB and the compact emergency
envelope before the new owner can mutate.

## Backup payload and archive version 2

The canonical backup payload remains `revision-director-backup` and now has `schemaVersion: 2`. The external `revision-director-backup-archive` also has version 2.

The payload contains the existing durable entity collections, settings, and:

```text
activeRetrieval: ActiveRetrievalSession.v1 | null
```

Only a canonical session with `status: active` is valid in a backup. `committing` and `completed` sessions are rejected. On restore the user explicitly chooses `restore` or `discard`; no active session is silently adopted.

The archive manifest declares `activeRetrieval` count as zero or one and carries a `stateChecksum` in addition to the archive completion checksum.

## Restore safety state

Inspected candidates and safety proofs are ephemeral controller state, not durable learning records. A proof records candidate identity, source archive checksum, safety-copy kind, current-state fingerprint, creation/expiry timestamps, acknowledgement and consumed status.

The forensic rescue envelope is not a backup document:

```text
format: revision-director-forensic-rescue
version: 1
importable: false
rawStores
emergencyRecovery
diagnostics
reason
```

It exists only to preserve damaged local state before a known-good restore.


## Pass E1 extension state

Plugin registration and local-file status are bounded, session-only runtime state.
They are not durable documents, are not written to IndexedDB or localStorage, and
are not included in `.rdbackup` or `.rdrescue` artifacts. Public plugin intake uses
the existing canonical Study Event and Knowledge Unit/Obligation contracts; no new
database store or migration was introduced.
