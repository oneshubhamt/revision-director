# FSRS-7 clean-slate scheduling

- Removed all FSRS backward-compatibility, history-replay and dual-model code.
- FSRS-7 is now the only memory model and malformed/non-current FSRS state is rejected.
- Uses the modern `DefaultScheduler` API with fractional-day dual-trace state and exact scheduler provenance.
- Uses one-day learning/relearning middleware, one-day graduation, model override enabled, fuzz disabled and package-default FSRS-7 weights.
- `Again` creates corrective relearning; successful closed-book repair updates the original memory obligation through FSRS-7 rather than a fixed three-day rule.
- Removed IndexedDB schema-upgrade behavior, metadata auto-rewriting and cross-build backup tolerance; current formats are strict.
- Updated regression coverage around current FSRS-7 behavior rather than historical data shapes.

---

# Revision Director VA7.1 — Stage C certification

## Certification

- Established 26 authoritative desktop, tablet, phone, retrieval and dialog renders.
- Verified zero changed pixels after a deterministic rebuild.
- Certified all six panes across fourteen viewport classes, including the 820/821-pixel breakpoint.
- Certified repeated inactive-gap focus containment and semantic pause-control restoration across twelve cycles.
- Reran all Stage B recovery, ownership, hostile-state, workflow, large-data and accessibility regressions.
- Closed Stage C as the approved baseline for Stage D.

---

# Pass C2 — UI Runtime and Accessibility

- Added delegated click, submit, input, change and keyboard routing.
- Added deterministic dirty-domain render coordination.
- Added complete ARIA tab and keyboard navigation contracts.
- Enforced 44-pixel visible targets, reduced motion and safe-area protection.
- Added native-dialog and inactive-gap overlay focus management.
- Fixed delegated Settings submission and form-ID shadowing.
- Preserved Revision Director workflows, scheduling, recovery and presentation identity.

# Revision Director VA7.1 — Pass C1 presentation engine

## Presentation foundation

- Added a canonical build-validated presentation manifest.
- Added a typed, frozen presentation kernel under a non-enumerable Symbol key.
- Registered the current Revision Director visual design as immutable
  `revision-current` default and fallback.
- Added independent typography, shape, material, depth, density, responsive,
  motion and chart profile axes.
- Added a versioned public `--rd-` semantic token contract mapped to the frozen
  current visual primitives.
- Added pre-paint restoration before CSS and application startup.
- Added safe fallback for unavailable storage and invalid stored profile IDs.

## Preservation and QA

- Preserved exact Stage B pixels across all six panes at desktop and phone widths.
- Preserved every workflow, scheduler, recovery, ownership and persistence test.
- Added permanent kernel, pre-paint and pixel-reference regression suites.

---

# Revision Director VA7.1 — Pass B3 cross-tab ownership and lifecycle closure

## Ownership and handoff

- Added one verified mutable review owner across browser documents.
- Added read-only secondary tabs that retain navigation, search and export.
- Added a local lease, heartbeat, stale-owner recovery and fail-closed storage behaviour.
- Added conservative BroadcastChannel takeover with durable flush-before-release.
- Added canonical hydration before a new owner may mutate.
- Protected mutating public-bridge operations with the same ownership contract.

## Lifecycle and storage capacity

- Added visibility, focus, pageshow, pagehide and beforeunload closure.
- Added passive storage-health refreshes that do not request persistence.
- Added an explicit Settings persistence request.
- Added visible warning and critical quota reporting at 75% and 90%.
- Added dedicated multi-document, takeover, quota and lifecycle QA.

---

# Revision Director VA7.1 — Pass B2 phase-aware time runtime

## Reliable timing evidence

- Added a sealed `PhaseTimeRuntime` with verified active accumulation by phase.
- Added durable manual pause/resume history and prompt-exclusion records.
- Added explicit attempt, compare, relearn-repair and relearn-verification timing.
- Added source-reveal and verification-reveal boundaries to active sessions and
  Evidence Events.
- Added backward-clock detection with safe open-anchor rebasing.
- Added inactive-gap detection above the fixed 120-second threshold.
- Added Focus, Break, Split and Ignore classification with persisted audit records.
- Added interruption reliability flags and retained all classifications in evidence.
- Excluded ignored or unresolved interruption time from adaptive duration learning.

## Recovery integration

- Extended `ActiveRetrievalSession.v1` with the complete phase-time snapshot.
- Persisted pending gap prompts, pause state, phase history and reliable phase totals
  through the B1 IndexedDB and emergency-snapshot path.
- Preserved full-session and chunk commit atomicity while recording timing evidence.

## Validation and preservation

- Added hostile validation for impossible timing state, non-finite counters,
  invalid chronology and sub-threshold pending gaps.
- Preserved all Revision Director workflows, policies, planning, evidence,
  chunking, bridge and presentation behaviour.

---

# Revision Director VA7.1 — Pass B1 durable active retrieval

## Session reliability

- Added the `activeRetrieval` IndexedDB store and `ActiveRetrievalSession.v1`.
- Added a bounded local emergency recovery envelope with text compaction and
  even diagram downsampling while retaining the full IndexedDB session.
- Added serialised active-session writes and 350 ms edit debouncing.
- Added forced recovery saves on hidden visibility, page exit and unload.
- Added newest-valid-copy arbitration and bidirectional reconciliation.
- Added explicit unfinished-session recovery for text, workflow fields, check
  state, diagrams, phase, queue position and elapsed state.

## Commit integrity

- Added immediate UI duplicate-submit locking.
- Added unique commit tokens and deterministic Evidence Event identities.
- Added transaction-time active-session revision, target, status and token guards.
- Persisted the next active queue target atomically with evidence, scheduler and
  daily-plan changes.
- Cleared completed or manually ended recovery state from both storage layers.

## Preservation

- Scheduling, planning, workflow, evidence, bridge and presentation behaviour
  remain unchanged.
- Timing classification is intentionally deferred to Pass B2.

---

# Revision Director VA7.1 — Pass A2 full QA certification

## Corrections

- Corrected a compact-layout CSS cascade that allowed desktop sidebar actions to
  overlay content above the fixed mobile navigation.
- Aligned the document title and source headers with the Pass A2 runtime identity.
- Added a permanent 161-check supplemental browser suite covering ten viewport
  classes, all primary panes, rerender stability, stored-content escaping and
  compact sidebar-action visibility.

## Certification

- Re-ran the complete source, build, contract, kernel, planning, property, browser
  and large-data suites.
- Certified Pass A2 as the production-foundation baseline for Stage B.

---

# Revision Director VA7.1 — Pass A2 production contracts and storage facade

## Production foundation

- Established the clean `revision-director` IndexedDB database at layout version 1.
- Added a metadata store that verifies database and application identity.
- Added independent schema version 1 contracts to every durable document.
- Added canonical entity normalisers and a common storage-boundary dispatcher.
- Split raw IndexedDB mechanics into `IndexedDbRepository` and application-wide
  persistence ownership into `RevisionData`.
- Added bounded, deduplicated diagnostics and browser storage-health reporting.
- Added persistent-storage requests and quota warning/critical thresholds where
  browser capabilities are available.
- Replaced the prototype backup identity with `revision-director-backup` v1.

## Production-path cleanup

- Removed automatic sample seeding.
- Removed prototype reset UI and reset service operations.
- Removed the prototype seeding flag from settings.
- First launch now presents an empty, valid setup state.
- No prototype database or backup migration layer was introduced.

## Preservation

- All six workflows, six policy families, Study Events, Evidence Events, adaptive
  planning, chunk synthesis, daily-plan history and the frozen Study Director
  bridge remain operational.
- Rich browser regression scenarios now load an explicit versioned fixture rather
  than relying on production seeding.

---

# Revision Director VA7.1 — Pass A1 source ownership

## Structural change

- Replaced the maintained TypeScript monolith with nine manifest-ordered source
  ownership files.
- Added integrated source assembly and strict compilation to `build/build.py`.
- Kept the generated composite ephemeral.
- Updated build-integrity QA to consume the source manifest.
- Added dedicated source-ownership and baseline byte-parity verification.

## Preservation

- Compiled `dist/app.js` is byte-identical to the VA7.1 baseline.
- Deployable `index.html` is byte-identical to the VA7.1 baseline.
- No domain, workflow, persistence, UI, CSS, bridge or runtime behaviour changed.

---

# Revision Director VA7.1 — Pass D QA hardening

## Pass D capabilities retained

- Adaptive duration estimates from completed retrieval cycles.
- Weekly subject balance and score-bounded interleaving.
- Capacity-bounded automatic splitting with final synthesis.
- Persisted daily-plan versions and execution outcomes.

## Defects found during de novo QA and corrected

### Daily-plan history

- Plan signatures now preserve capacity and ordered item snapshots rather than
  comparing an order-insensitive item set.
- Material disposition, estimated-duration and rationale changes create a new
  version.
- Manual execution of an already-known deferred or must-split item now creates
  an explicit `manual-addition` amendment instead of silently reusing the old
  disposition.
- Required-overrun work remains de-duplicated.
- Starting a queue still marks only the current target as started.

### Weekly balance and interleaving

- Weekly exposure keys now include exam profile as well as normalized subject,
  preventing cross-exam collisions such as two separate “Medicine” subjects.
- The window now uses exactly seven configured study-day keys.
- Pre-dawn calculations now respect the configured 4 a.m. boundary.
- Same-subject interleaving penalties apply only within the same exam profile.

### Automatic splitting

- `ChunkingState` now records the capacity that produced the cycle.
- An untouched cycle is archived and rebuilt when capacity changes.
- An untouched cycle dissolves when increased capacity makes splitting
  unnecessary.
- Already-started cycles remain stable to preserve completed scope and audit
  history.

### Backup and domain validation

- Added stronger validation of duration observations and accepted-sample counts.
- Added chunk duration conservation, capacity, identity and cycle checks.
- Added strict calendar-day, unique-study-day, version, disposition, outcome,
  relation and evidence-link checks for persisted daily plans.
- Completed parent outcomes must reference matching Evidence Events.

### Code quality and scale

- Removed unused runtime helpers and variables.
- Strict TypeScript compilation also passes with unused-code checks enabled.
- Added exhaustive split tests across the supported capacity/duration domain.
- Added hostile planning-import, capacity-reflow and 1,000-unit browser tests.


## Stage B full-QA closure

- Corrected startup storage inspection so persistence is requested only through the explicit Settings action.
- Prevented a takeover requester from force-overwriting an intervening third-tab owner.
- Verified BroadcastChannel heartbeats against the canonical lease.
- Added permanent hostile recovery and transactional rollback browser QA.
- Certified all Stage B, domain, planning, large-data, accessibility and responsive regressions.

## VA7.1 Pass D1 — Backup Codec

- Added `revision-director-backup-archive` v1 as a manifest-first bounded NDJSON archive.
- Added gzip detection, bounded streaming decompression, per-chunk hashes and final completion checksum.
- Added SHA-256 with an offline pure verifier and FNV-1a 64-bit creation fallback.
- Added verified inspection metadata and strict count, line, document, chunk, compressed-size and expanded-size limits.
- Routed decoded archives through the existing full relational validator.
- Changed the production local file extension to `.rdbackup`; raw whole-database JSON is no longer accepted by the UI.
- Aligned backup validation with B2's `unreliable-interruption` duration evidence.

## VA7.1 Pass D2 — Backup Controller

- Added verified backup creation with immediate codec self-audit.
- Added non-mutating file inspection and a native restore-preview dialog.
- Added mandatory current-state safety-copy download before replacement.
- Added candidate-bound, one-use, 30-minute safety proofs with changed-state detection.
- Added explicit saved-copy acknowledgement, replacement acknowledgement and final confirmation.
- Advanced the canonical backup payload and external archive to version 2 to carry zero or one stable unfinished retrieval.
- Added explicit restore/discard treatment for a source active retrieval.
- Added bounded, non-importable `.rdrescue` forensic preservation when damaged current state cannot produce a verified safety backup.
- Preserved one-click local export and early rejection of invalid/tampered files.

## Stage D data-safety and full-QA closure

- Certified the complete D1/D2 backup path from one-click export through verified destructive restore.
- Added permanent Stage D controller, destructive-path and restore-dialog certification suites.
- Fixed compact restore checkbox/radio overflow at 320-pixel widths.
- Added explicit Tab and Shift+Tab containment to native modal dialogs.
- Certified safety copies containing unfinished retrieval drafts.
- Certified explicit restore and discard treatment for backup active sessions.
- Certified corrupted-current-state `.rdrescue` creation and known-good restore recovery.
- Reran the complete logic, hostile, recovery, ownership, workflow, large-data, responsive and accessibility matrix.


## VA7.1 Pass E1 — Public Capability and Plugin Runtime

- Replaced `RevisionDirectorBridge` with frozen `window.RevisionDirector` API v1.
- Added versioned capabilities and a minimal canonical integration surface.
- Added validated plugin registration, capability negotiation and two-attempt limits.
- Isolated incompatible, inactive, setup-failure and local-file-failure states.
- Added explicit trusted local `.js` loading from Settings with five-file and 1 MiB limits.
- Added session-only plugin and file status; plugins are never stored or included in backups.
- Preserved ownership checks for all public mutations and local plugin loading.
- Kept repository, raw backup, Evidence commit, scheduler, lease and DOM internals private.
