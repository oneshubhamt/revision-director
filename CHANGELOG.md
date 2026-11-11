# Changelog

This file records durable product/architecture changes. Detailed implementation-pass chronology is intentionally left to Git history.

## 2026-11-11 — FSRS-7 personalization boundary

- Added a current-format FSRS-7 optimizer profile contract with exact 34-weight validation and scheduler/weight provenance.
- Added chronological optimizer evidence export covering direct memory reviews and returned-memory transitions.
- Added a pinned external Node optimizer using a final-sixth held-out stock-vs-personalized gate, full-evidence final retraining and upstream time-series evaluation.
- Made profile import staging-only; activation, deactivation and retention changes explicitly reproject reviewed memory obligations from immutable Evidence Events.
- Added atomic settings-plus-memory-projection replacement so scheduler identity cannot change independently of current card state.
- Kept optimizer computation and WASM out of the browser runtime; browser optimization remains a later optional capability.

## 2026-11-11 — FSRS-7 replay-truth scheduler boundary

- Introduced an application-owned revision scheduler port so domain policy no longer operates directly on the TS-FSRS runtime.
- Made append-only Evidence Events the canonical memory-review history, including returns from corrective relearning.
- Retained the persisted FSRS card as a fast materialized projection, with replay verification before preview, review and retrievability.
- Added the TS-FSRS v6 Reschedule contract over the pinned scheduler forward APIs, preserving full-history memory replay without altering historical due dates.
- Fingerprinted every FSRS configuration snapshot and validated fingerprints on historical evidence and restore.
- Added startup, backup/restore and regression integrity checks for projection-chain continuity and independently replayed FSRS-7 memory.

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
- Compile all nineteen maintained TypeScript files directly as the real TypeScript project.
- Verify the emitted JavaScript file set against the ownership manifest before deterministic assembly.
- Moved the single strict IIFE boundary into the build so individual source parts are syntactically complete while the deployed runtime remains sealed.
- Kept manifest-order runtime assembly, offline deployment and the single self-contained `index.html`.

## 2026-11-11 — Clean-slate contract hardening

- Removed residual field-level compatibility synthesis from timing evidence and split-session completion.
- Made required current active-retrieval and settings fields fail closed instead of defaulting missing values.
- Standardized backup integrity on SHA-256 only, using Web Crypto when available and the existing pure-JavaScript SHA-256 implementation otherwise.
- Updated current-format tests and backup fixtures to match the strict contracts.

## 2026-11-11 — Clean-slate FSRS-7 baseline

- Made FSRS-7 the only memory scheduling model.
- Removed FSRS-6 fallback, history replay, data migration and backward-compatibility logic.
- Added strict current-format database, metadata and backup identity checks.
- Adopted FSRS-7 dual-trace memory with fractional elapsed time and one-day learning/relearning middleware for long-form revision.
- Aligned memory rating suggestions with FSRS recall semantics.
- Routed failed recall through corrective relearning and returned successful repair to FSRS-7 scheduling.
- Preserved FSRS ownership of memory due dates across planning and chunk synthesis.
- Upgraded the development toolchain to Node.js 26.13.0 and TypeScript 7.0.2.
- Corrected TypeScript 7 ArrayBuffer boundaries for WebCrypto/Blob APIs.
- Replaced old-format browser fixtures with current clean-slate test data and reran full regression QA.

## Current architecture

- Manifest-owned TypeScript source compiled into one sealed offline runtime.
- Canonical IndexedDB storage with durable active-retrieval recovery.
- Phase-aware timing and interruption classification.
- Single-owner cross-tab review coordination.
- Capacity-aware daily planning, adaptive duration learning, interleaving and chunk synthesis.
- Manifest-first verified backup archives with explicit destructive-restore safety ceremony.
- Build-validated presentation contract and responsive/accessibility runtime.
- Frozen public capability API and bounded local plugin runtime.
