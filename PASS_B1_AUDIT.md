# Revision Director VA7.1 — Pass B1 objective audit

## Verdict

**Pass B1 is complete.** Revision Director now preserves an unfinished retrieval
session across ordinary rerenders, document reconstruction and browser lifecycle
risk points without changing the revision domain, scheduling policies or workflow
semantics.

The pass deliberately does **not** introduce sleep/wake classification, pause
history or phase-aware active-time learning. Those remain Pass B2 responsibilities.

## 1. Active-session IndexedDB store — met

- Database layout version advanced to `2`.
- Dedicated `activeRetrieval` store uses the fixed key `current`.
- `ActiveRetrievalSession.v1` is canonicalised through the common production
  storage boundary.
- Active retrieval is operational state, separate from Knowledge Units,
  obligations, Evidence Events and daily-plan history.

## 2. Compact emergency snapshot — met

- A bounded local recovery envelope is stored at
  `revision-director:active-retrieval:v1`.
- It contains only the active queue/session state required to reconstruct the
  unfinished retrieval: target identities, phase, form values, check states,
  diagram strokes and elapsed state.
- It does not duplicate the production database or historical evidence.
- The encoded envelope is capped at 900,000 characters. Emergency text is
  bounded independently and diagram points are evenly downsampled across all
  strokes when necessary. The full canonical session remains in IndexedDB.

## 3. Serialised writes — met

- `ActiveRetrievalPersistence` owns one promise-based write chain.
- A failed prior write is diagnosed before a later write proceeds.
- Clear and committed-transition operations are ordered against pending writes.
- UI and service layers do not write the active-session store directly.

## 4. Debounced ordinary saves — met

- Input and change activity schedule a canonical snapshot after 350 ms.
- Repeated edits replace the pending snapshot rather than generating one write per
  keystroke.
- The final queued snapshot is persisted to both the emergency envelope and
  IndexedDB.

## 5. Forced lifecycle saves — met

The UI forces a synchronous emergency snapshot and starts a durable flush on:

- hidden `visibilitychange`;
- `pagehide`;
- `beforeunload`.

The synchronous local copy is the last-resort path when a browser does not allow
an asynchronous IndexedDB transaction to finish during exit.

## 6. Newest-valid-copy reconciliation — met

- Both local and IndexedDB copies pass canonical validation before use.
- Invalid local recovery data is diagnosed and removed.
- Revision number is authoritative; `updatedAt` breaks equal-revision ties.
- A newer local copy is reconciled into IndexedDB.
- A newer IndexedDB copy refreshes the emergency envelope.
- A completed transition is treated as a tombstone and cleared rather than
  offered as unfinished work.

## 7. Unfinished-session recovery — met

Recovery restores:

- the full queue and current queue index;
- the active obligation or execution chunk;
- attempt, comparison or relearning phase;
- typed responses and workflow fields;
- checkbox and rubric state;
- diagram strokes;
- attempt and session elapsed state.

The current target is validated against canonical application data before the
user is offered recovery. Declining recovery clears both copies. A recovered
`committing` state is conservatively returned to active state unless the atomic
commit already advanced IndexedDB to the newer post-commit session.

## 8. Duplicate-commit protection — met

Protection is layered:

1. an immediate UI `commitInFlight` lock;
2. temporary rating-button disablement;
3. a unique commit token;
4. deterministic Evidence Event identity derived from that token;
5. transaction-time validation of session ID, status, revision, target and token;
6. atomic persistence of evidence/scheduler changes and the post-commit active
   target in the same IndexedDB transaction.

A repeated or stale commit cannot satisfy the guard after the first transaction
advances the active-session record.

## Preservation audit

The pass did not alter:

- the six obligation types;
- the six retrieval workflows;
- exact `ts-fsrs@5.4.1` use for memory recall;
- the five non-memory scheduling-policy families;
- append-only Evidence Events;
- Study Events;
- adaptive planning, duration estimates, balance or interleaving;
- chunk execution and final parent synthesis;
- daily-plan versioning and outcomes;
- the Study Director bridge;
- Revision Director's presentation or information architecture.

## Deliberate boundaries

- Timing remains wall-clock based in B1. Reliable active-time accounting belongs
  to Pass B2.
- Cross-tab ownership belongs to Pass B3.
- Active sessions are cleared before backup replacement and are not yet included
  in the ordinary backup format. Backup-controller treatment will be designed in
  the later data-safety stage.
- Real-device browser restart, operating-system eviction and storage-pressure
  behaviour remain target-device certification items.
