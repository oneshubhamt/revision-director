# Changelog

This file records durable product/architecture changes. Detailed implementation-pass chronology is intentionally left to Git history.

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
