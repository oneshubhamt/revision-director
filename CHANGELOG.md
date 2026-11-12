# Changelog

This file records durable product/architecture changes. Detailed implementation-pass chronology is intentionally left to Git history.

## 2026-11-12 — Outcome-sensitive FSRS scheduling calibration

- Replaced fixed rating-pattern scheduling experiments with deterministic retrievability-dependent outcomes and the complete corrected relearning lifecycle, including failed closed-book verification.
- Stress-tested 1d/23h/18h/12h/no-step/minute-step policies, fixed retention 0.84–0.92, Cost-ADR weights 64–1024 and deterministic fuzzing across 90/365/730-day horizons and three sensitivity scenarios.
- Retained 1d learning/relearning steps: they produced the lowest workload among operational long-form candidates while host-owned canonical history preserves correct early-learning semantics.
- Changed the new-install scheduling default from Cost-ADR 1024 to fixed retention 0.90 after outcome-sensitive simulation removed the earlier fixed-rating advantage.
- Kept Cost-ADR 1024 as a bounded optional preset rather than presenting it as production-optimal.
- Kept fuzz disabled: it did not improve p95 due-day spreading, worsened peak bunching and incurred small memory-metric losses in the selected workload.
- Added permanent benchmark guardrails so future scheduler/runtime changes must re-earn any different production default.

## 2026-11-12 — Corrective memory verification topology

- Made every closed-book verification inside a memory-linked corrective relearning workflow a canonical FSRS-7 observation; source-assisted repair itself remains host-owned pedagogy.
- Removed the accidental requirement for two successful relearning cycles. The first qualifying `Good`/`Easy` verification completes the repair and returns the original memory obligation.
- Persist `Again`/`Hard` corrective outcomes on the original memory card while keeping the repair active and the memory obligation suspended.
- Normalized contradictory unsuccessful corrective outcomes so they cannot enter FSRS as successful memory ratings.
- Reclassified pre-establishment failures from canonical review history, preventing the one-day learning-step adaptation from turning early learning difficulty into false established-memory lapses.
- Extended optimizer evidence, replay validation, persistent-difficulty reconciliation and tests to use the same corrective-verification history.

## 2026-11-12 — Local browser FSRS optimizer

- Added an optional local FSRS-7 optimizer using the pinned single-threaded WASIp1 binding inside a dedicated Worker.
- Preserved the root self-contained `index.html`; optimizer Worker/WASM assets live only in an optional static distribution and are instantiated lazily.
- Added progress reporting, hard cancellation by Worker termination and fail-closed timeout/error handling.
- Unified native and browser optimization behind one optimizer core so chronological conversion, 64/64/16 eligibility, held-out non-regression gating, final retraining and profile construction cannot drift.
- Kept successful local optimization staging-only. Activation remains explicit and uses the existing atomic reprojection path.
- Added native/WASM parity tooling and build-time optimizer-footprint reporting.
- Pinned the WASIp1/emnapi runtime dependency set and copied runtime licence texts into the optional distribution.

## 2026-11-12 — Persistent-difficulty memory management

- Added a host-owned memory-difficulty policy derived from the canonical FSRS Review-state lapse counter rather than a parallel leech counter.
- Kept the existing `Again → relearn → closed-book verification → FSRS return` lifecycle as the recovery foundation.
- Escalated repeated lapses from ordinary relearning to remediation and then persistent difficulty, with source, representation, scope, prerequisite, splitting and deliberate-intervention guidance.
- Added an optional automatic post-remediation hold at a configurable lapse threshold; it is disabled by default and never mutates FSRS `scheduleStatus`.
- Added explicit manual resume for persistently difficult memory while preserving the scheduler due date and card state.
- Strengthened storage/backup validation so Revision Director obligation status is the sole suspension truth and FSRS-owned suspended cards are rejected.
- Fed persistent difficulty into planner weakness/reasoning without rewriting FSRS intervals.

## 2026-11-12 — FSRS scheduler-policy boundary

- Replaced the free-standing retention setting with one canonical discriminated FSRS scheduling-policy object.
- Made scheduler configuration fingerprints include policy kind and every policy-defining parameter, independently of stock or personalized FSRS-7 weights.
- Added the exact ts-fsrs 6.0.0 Cost-ADR policy shape to the application contract while keeping Cost-ADR execution deliberately fail-closed until its dedicated implementation/evaluation pass.
- Moved scheduler-rebase metadata out of personalization state and record prior/target configuration fingerprints instead.
- Routed policy changes and weight activation/deactivation through the same atomic replay-from-immutable-history path; Evidence Events remain append-only.
- Tightened settings parsing to reject obsolete or unexpected fields rather than retaining a second scheduler topology.

## 2026-11-11 — FSRS-7 scheduling architecture and personalization

- Made FSRS-7 the sole memory scheduler, using the pinned `ts-fsrs@6.0.0` dual-trace model with fractional elapsed time and one-day learning/relearning policy for long-form revision.
- Established append-only Evidence Events as canonical memory-review truth; the stored FSRS card is a replay-verified materialized projection rather than an independent history.
- Isolated vendor scheduling behind an application-owned scheduler port and one scheduler-forward replay path; direct recall and successful corrective-relearning returns share the same chronological history.
- Preserved exact scheduler provenance with configuration and weight fingerprints, including explicit verification across retention/profile configuration boundaries.
- Added external FSRS-7 personalization through a strict 34-weight profile contract and chronological evidence export. The pinned native optimizer requires held-out improvement over stock FSRS-7 before final retraining.
- Kept optimizer computation outside the browser runtime. Profile import is staging-only; activation, return to stock and desired-retention changes are explicit atomic scheduler rebases from immutable history.
- Made backup/restore preserve and independently verify stock, staged or active personalization state and current materialized projections.
- Kept FSRS ownership of memory due dates separate from planner urgency, exam horizon, chunking and non-memory policies.
- Added independent realistic-history verification for replay, rebases, backup/restore, returned-memory transitions, corruption rejection and planner consumption.

## 2026-11-11 — Type-safety boundary hardening

- Narrow external browser, plugin, recovery, backup and restore inputs from `unknown` through checked current-format parsers before entering trusted domain logic.
- Bind IndexedDB operations to store-specific value types instead of generic untyped store reads.
- Replace state-bearing non-null assertions with explicit persisted-state and active-review invariants while retaining locally proven algorithmic assertions.
- Make closed domain routing/label/workflow maps exhaustive with `satisfies`, so new union members fail compilation until every required mapping is updated.
- Replace named-form-element casts with runtime-checked typed DOM helpers.
- Retain zero explicit `any`, zero `as any` and zero TypeScript suppression directives in maintained application source.

## 2026-11-11 — TypeScript 7 measured parallelism

- Benchmarked default and 1/2/4/8 checker configurations on the Ubuntu 24.04 CI runner using TypeScript 7.0.2.
- Selected `--checkers 2`: 0.25 s median, 0.27 s p95 and about 95 MiB median maximum RSS across seven measured runs after warm-up.
- Removed the temporary benchmark workflow after recording the result; the permanent build now carries the measured checker count.

## 2026-11-11 — TypeScript 7 compiler and CI hardening

- Enabled return, fallthrough, index-signature, unreachable-code, unused-label, unused-symbol and filename-casing compiler checks on top of the strict TypeScript baseline.
- Added permanent GitHub Actions CI with SHA-pinned current official checkout/setup actions, explicit Ubuntu/Python runtimes and the exact project Node/npm/TypeScript toolchain.
- Isolated repository write permission to the working-branch generated-artifact sync job; core and browser QA remain read-only.

## 2026-11-11 — TypeScript 7 source-graph build

- Removed the synthetic concatenated TypeScript compilation unit.
- Compile the manifest-owned maintained TypeScript files directly as the real TypeScript project.
- Verify the emitted JavaScript file set against the ownership manifest before deterministic assembly.
- Moved the single strict IIFE boundary into the build so individual source parts are syntactically complete while the deployed runtime remains sealed.
- Kept manifest-order runtime assembly, offline deployment and the single self-contained `index.html`.

## 2026-11-11 — Clean-slate contract hardening

- Removed residual field-level compatibility synthesis from timing evidence and split-session completion.
- Made required current active-retrieval and settings fields fail closed instead of defaulting missing values.
- Standardized backup integrity on SHA-256 only, using Web Crypto when available and the existing pure-JavaScript SHA-256 implementation otherwise.
- Updated current-format tests and backup fixtures to match the strict contracts.

## Current architecture

- Manifest-owned TypeScript source compiled into one sealed offline runtime.
- Canonical IndexedDB storage with durable active-retrieval recovery.
- Phase-aware timing and interruption classification.
- Single-owner cross-tab review coordination.
- Capacity-aware daily planning, adaptive duration learning, interleaving and chunk synthesis.
- Manifest-first verified backup archives with explicit destructive-restore safety ceremony.
- Build-validated presentation contract and responsive/accessibility runtime.
- Frozen public capability API and bounded local plugin runtime.
