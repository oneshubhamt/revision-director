# QA Pass E — Measurement and deep-gate closure

**Repository:** oneshubhamt/revision-director  
**Branch:** working  
**Measurement source:** 6e1125e628c8afd57877d358de21d6e3d4a316c0  
**Date:** 2026-11-14

## Decision

Pass E confirms the QA tiers should be monotonic and non-recursive:

- **core** owns cheap deterministic contracts, mathematical/reference models and failure-path logic;
- **browser/durability** owns real rendered, persistence and platform journeys;
- **performance** owns large-data stress;
- **deep** owns only expensive unique product/provider verification: long-horizon FSRS policy experiments, the full-scale FSRS regression envelope, and full browser/WASM optimizer training.

Measurement/profiling and mutation testing are evidence about the QA system, not product QA tiers. They are removed after this closure rather than maintained as parallel permanent subsystems.

Dependency installation is also setup, not verification. `tests/qa.py` now requires the isolated optimizer binding and fails clearly when it is absent; CI installs it explicitly in jobs that need it.

## Pass-E evidence

The temporary per-entry profiler ran three repetitions on the measurement source. It was intentionally diagnostic and exposed browser timing/order sensitivity, so its failed browser repetitions are **not** treated as a release result. The canonical CI on the same source (run 43566945414) passed core, optimizer, deep, browser/durability and browser-performance jobs.

| Layer | Three measured totals (s) | Median (s) | Observation |
|---|---:|---:|---|
| core | 5.148 / 4.555 / 4.535 | 4.555 | Core scale correctness is now small; heavy timing envelope moved to deep. |
| optimizer | 0.157 / 0.668 / 0.158 | 0.158 | Provider smoke remains cheap. |
| browser timing | 15.552 / 3.619 / 3.467 | 3.619 | First-run variance is material; do not use one sample as a performance claim. |
| browser matrix | 75.724 / 66.827 / 68.076 | 68.076 | Repeated isolated profiling surfaced focus/action synchronization flakes; canonical CI remained green. |
| browser performance | 5.783 / 5.704 / 5.736 | 5.736 | Stable large-data stress witness. |
| profiler deep subset | 11.732 / 11.547 / 11.552 | 11.552 | Profiler omitted the later explicit `--performance` scale invocation; canonical runner is authoritative. |
| mutation audit | 31.278 / 30.997 / 31.137 | 31.137 | All six deliberate mutations were detected in all three runs. |

The canonical deep run on the same source gives the ownership-relevant decomposition: mutation challenges consumed about **46.8 s**, the scheduling experiment about **10.8 s**, the full-scale FSRS envelope about **2.6 s**, hosted preparation about **0.1 s**, and full browser/WASM optimization about **1.3 s**. The hidden optimizer install added about **0.35 s**. Removing one-shot mutation evidence and moving installation to setup therefore removes roughly three quarters of the recurring deep test body without dropping a substantive deep product invariant.

## Course corrections from Pass A through E

1. **Measure ownership, not assertion volume.** High assertion counts in bounded mathematical/property loops were valuable; source-shape checks and duplicate orchestration were the real debt.
2. **Text is not categorically bad.** User-facing safety/accessibility text may itself be a contract. Incidental prose must not proxy for persistence, scheduling or workflow state.
3. **Synchronization is a boundary contract.** Several phrase assertions had accidentally acted as waits. Their replacements must synchronize on durable state plus rendered/terminal state, not merely delete the phrase check.
4. **Performance belongs to an explicit tier.** FSRS scale/determinism correctness stays cheap in core; full-scale timing envelopes run in deep.
5. **A CI dependency is not a filesystem dependency.** Jobs do not share `node_modules`; browser/deep jobs must install the isolated optimizer binding explicitly rather than letting QA install it implicitly.
6. **Mutation testing is validation evidence, not a permanent subsystem here.** The probes proved that consequential planner, recovery, checksum, transaction-guard, duplicate-evidence and release-integrity defects are caught. Their brittle source anchors and ~31 s median diagnostic cost do not justify permanent execution or maintenance.
7. **Profilers are disposable instruments.** The profiling tools coupled to runner topology and even lagged a newly added deep invocation. Their results belong in this closure record; the tools themselves do not.
8. **Canonical CI remains the release gate.** Repeated profiling is useful for variance and flake discovery, but it must not redefine correctness or recursively execute QA inside QA.

## Permanent deep contract after closure

`qa:deep` contains exactly three unique witnesses:

1. long-horizon FSRS scheduling/policy experiments;
2. 4,608-review full-scale replay/cache regression envelopes;
3. full browser/WASM FSRS optimizer training/evaluation.

It performs no mutation audit, no profiling, no recursive QA call and no dependency installation.
