# QA Pass A — Baseline, Classification, and Coverage Audit

**Repository:** oneshubhamt/revision-director  
**Audited branch:** working  
**Production/test baseline:** 83e73be4cfbd7917e295693520bab1639c5aa1ff  
**Audit date:** 2026-11-13  
**Scope:** diagnostic only; no existing test assertions, application code, build configuration, or default QA gates changed.

## Measurement provenance and methodology

Sources: the exact working-branch Git tree and test implementations; successful CI runs [43420650868](https://github.com/oneshubhamt/revision-director/actions/runs/43420650868) and [43418996347](https://github.com/oneshubhamt/revision-director/actions/runs/43418996347); and successful dedicated profiling run [43425295743](https://github.com/oneshubhamt/revision-director/actions/runs/43425295743).

The one-off profiler executed the **existing** npm QA commands, separately and sequentially, on Ubuntu 24.04 with the repository-pinned Node toolchain, Python 3.13, installed Playwright and runner Chromium. It sampled the command's descendant Linux process tree every 50 ms. Wall time uses a monotonic clock. A Chromium launch means a distinct observed browser root process; samples may miss brief child processes. Memory values are the **peak sum of descendant VmRSS**, which double-counts shared pages, NOT peak unique physical RAM (PSS), and should be compared using the same method in Pass E. Counts of observed process IDs are lower bounds, not exact kernel execve counts. The profiler includes npm/launcher overhead absent from some previous CI log-derived intervals.

### File footprint at untouched baseline

| Category | Files/bytes |
|---|---:|
| All tests, helpers and fixtures | **62 files; 617,328 bytes (602.9 KiB)** |
| Root JavaScript QA files | 179,895 B |
| Root Python QA files | 139,424 B |
| JavaScript scenarios | 117,424 B |
| Python scenarios | 128,933 B |
| Shared helpers | 19,366 B |
| Fixtures | 32,286 B |
| Compiled dist/app.js | 617,117 B |
| Generated index.html | 886,418 B |

Test footprint / compiled JavaScript ratio: 1.00034 by bytes. The ratio is descriptive, not itself a QA quality metric. The four largest test files are build-integrity.spec.py (62,227 B), kernel-policy.spec.js (60,882 B), fsrs-integration.spec.js (43,995 B), and browser-qa.spec.py (30,515 B), together 197,619 B (~32.0% of test footprint). The profiler is a new auxiliary tool, **not included in the untouched-baseline totals**.

### Reproduced wall-clock and resource baseline

| Stage | Profiler wall time | Peak summed descendant RSS | Peak single-process RSS | Observed PIDs (minimum) | Observed Chromium launches | QA `==>` commands |
|---|---:|---:|---:|---:|---:|---:|
| Core | 16.463 s | 269.58 MiB | 186.32 MiB | 39 | 0 | 33 |
| Native optimizer | 0.360 s | 262.01 MiB | 69.24 MiB | 8 | 0 | 1 |
| Durability | 33.550 s | 1,386.04 MiB | 245.16 MiB | 14 | 1 | 1 |
| Browser | 240.411 s | 1,577.80 MiB | 366.84 MiB | 287 | 20 | 24 |

Total measured wall clock for the four stages, sequentially: **290.784 s**. No stage failed. The sampled peak concurrency was 6, 7, 14 and 16 descendant processes respectively. 'Observed PIDs' counts unique descendant PIDs sampled while the command ran; it is not an exact subprocess-exec count.

Independent CI log intervals, before this audit, establish variation: core **27.14 / 28.98 s**, browser **256.95 / 246.13 s** across two successful runs. Browser timings exclude the separate durability step. Profiler run was faster in core but broadly consistent in browser. Avoid promising a precise speedup from one run.

Major measured time consumers in the November 13 CI:
- Core: fsrs-scheduling-experiments.spec.js ~17.31 s; fsrs-scale-benchmark.spec.js ~4.16 s. Together ~79% of that run's ~27.14 s core span.
- Browser: browser-qa.spec.py ~47.84 s, ui-behaviour.py ~33.03 s, data-safety.py ~20.03 s, planning-large-dataset.py ~19.48 s, hostile-recovery.py ~16.91 s, responsive-layout.py ~16.11 s. Separate phase-time durability gate ~26.32 s.

**Orchestration findings:** `tests/qa.py` calls the build, then both build-integrity.spec.py and source-ownership.spec.py independently call the build again: three builds inside core. CI has further builds in separate browser and sync jobs. Four Node scenario wrappers spawn their scenario files in fresh Node processes; Python wrappers spawn fresh Python interpreters, and most browser scenarios launch separate Chromium instances. `qa:browser` runs the browser optimizer twice (probe, then full), while `qa:full` adds a separate durability scenario. `browser-qa.spec.py` has 48 literal wait_for_timeout call sites with 14,370 ms of one-pass literal wait arguments; actual duration depends on call frequency. Avoid attributing the full browser time to those sleeps alone.

## Assertion taxonomy (multiple labels possible)

**B — Behavioural:** externally observable domain or user effect, state transition, persisted result, input/output or accessibility action. Examples: a successful corrective verification reactivates original memory; restoring an active retrieval recovers its text; a second tab cannot mutate state. **Retain.**

**M — Mathematical/property:** numeric invariants, deterministic identity, conservation, replay parity, capacity bounds and scale. The 138,674 dynamically counted checks in planning-persistence-validation.js come primarily from **five substantive bounded split invariants** evaluated exhaustively across capacity/duration pairs; high assertion counts here do not mean low-value tests. **Retain; improve independent oracles where needed.**

**E — Boundary/adversarial:** invalid schema, corrupt hashes, race, interruption, stale revision, rejected transaction, hostile input, time discontinuity. **Retain as P0/P1 safety tests.**

**A — Architectural/contract:** build reproducibility, source manifest integrity, strict type checking, bundled/offline asset contract, public API immutability, dependency identity. **Retain the true constraints; express them once.**

**T — Textual/implementation-coupled:** token/substring checks for function names, exact private method signatures, source line fragments, phrasing, or CSS comments, not backed by observable functionality. **Replace with B/M/E/A checks; remove once replacement exists.**

**R — Redundant:** duplicate sources of truth, repeated checks of the same invariant, repeated build/bootstrap, duplicate browser probe and full optimizer, copy-pasted shims. This is a **cross-cutting flag**, not proof an assertion is useless. **Consolidate without deleting unique edge cases.**

### Quantified high-risk hotspots

- **build-integrity.spec.py:** 262 named checks (plus helper declaration). The file mixes essential build/offline/asset verification with extensive literal source-text searches, exact private-expression checks, function-count checks, and presentation wording checks. Primary A/T/R. High-priority **refactor**.
- **source-ownership.spec.py:** 46 named checks (plus helper declaration). It repeats the exact manifest/runtime assembly and independently hardcodes every TypeScript file. Primary A/T/R. High-priority **merge architectural facts with build contract**, using manifest as source of truth.
- **kernel-policy.spec.js:** 129 direct check call sites (plus helper declaration), alongside legitimate FSRS/validation math; includes several .includes(...) assertions against generated HTML and literal guidance. B/M/E with a smaller T portion. **Retain domain calculations; replace nonessential text assertions with DOM/state assertions**.
- **reliability-closure.js:** real transactional durability behaviour tests, followed by literal source-expression and call-count assertions. E/B + T. **Retain failure injection, refactor literal source checks**.
- **browser-qa.spec.py** and **helpers/persistent_browser.py:** separate substantial IndexedDB mock implementations / bootstrap strategies. B/E/R. **Canonicalize one mock and favour true browser persistence for a critical smoke**.
- **Responsive/accessibility browser tests:** good functional checks for focus, overflow, keyboard operation. Some exact label/toast wording can be downgraded from gate unless itself an accessibility contract. B, with some T/R.

The numbers above are **source-level named check sites**, not a global count of semantically distinct assertions. Loops can evaluate a single site thousands of times. A claim that every literal check is redundant would be unjustified.

## Feature-to-test coverage matrix

Coverage labels: **Covered** = demonstrably exercised in current tests; **Partial** = mock or narrower route; **Gap** = a material behaviour not independently verified. Existing file names are relative to tests/.

| Feature / boundary | Primary existing evidence | Coverage | Priority / next action |
|---|---|---|---|
| Build, offline/self-contained artifact, source manifest | build-integrity.spec.py; source-ownership.spec.py; html-sanity.spec.py | Covered, redundant | A/T: consolidate single authoritative contract |
| Strict domain/schema, hostile document input | kernel-policy.spec.js; scenarios/production-contracts-storage.js; scenarios/data-safety.py | Covered | Retain E; eliminate token-only surrogates |
| FSRS scheduling, replay and deterministic history | fsrs-integration.spec.js; fsrs-programme-closure.spec.js; fsrs-contract-parity.spec.js | Covered | Retain M/E; avoid duplicate policy test cases |
| Corrective relearning, suspension, reactivation and profile rebase | fsrs-programme-closure.spec.js; fsrs-programme-closure-browser.spec.py; fsrs-integration.spec.js | Covered | Retain B/E; explicit exact-once checks |
| Optimizer holdout/validation, native and WASM | fsrs-optimizer-core.spec.js; fsrs-optimizer-policy.spec.js; fsrs-browser-optimizer.spec.py; native smoke/parity tools | Covered | Fast probe in normal tier; full training/parity in deep tier as appropriate |
| Planner capacity, splitting, duration learning and history | planning.spec.js; scenarios/adaptive-planning.js; scenarios/planning-persistence-validation.js; scenarios/planning-large-dataset.py | Covered / partial | Preserve exhaustive conservation; add a **small independent optimality oracle** for packing |
| 4,608-review FSRS scale/determinism and 1,000-unit browser case | fsrs-scale-benchmark.spec.js; scenarios/planning-large-dataset.py | Covered | Retain as scale tier; measure envelopes rather than pinning runtime |
| Phase time, pause, gaps, backward clock, reliability | scenarios/phase-time-runtime.js and .py | Covered | Retain E/M; separate deterministic clock tests from browser presentation |
| Active session crash recovery and exactly-once evidence | scenarios/active-retrieval-persistence.js; persistent-active-retrieval.py; hostile-recovery.py | Covered with mocks | Retain critical E; add native persistence validation |
| Actual application IndexedDB state across reload/browser restart | indexeddb-durability.py checks native transaction **durability hint**, but most app journeys replace IndexedDB with mocks | **Gap** | P0 native-DB restart/reopen journey, real app state and backup |
| Cross-tab lease/read-only/takeover | scenarios/ownership-storage-health.js and .py | Partial: simulated storage/broadcast | P0/P1 add small native multi-context sanity, preserve hostile mocks |
| Backup archive checksums, malformed input, safe restore | scenarios/backup-codec.js and .py; backup-restore-controller.js and .py; data-safety.py | Covered with mocked storage + browser paths | Retain corruption, non-mutating preview, rollback and semantic round-trip |
| Public API and plugin permission/isolation | scenarios/public-plugin-runtime.js and .py; extensions-and-public-api.spec.js | Covered | Retain B/E, reduce wrapper layers |
| Keyboard, ARIA, focus management and overlays | browser-qa.spec.py; scenarios/ui-runtime-accessibility.*; scenarios/ui-behaviour.py | Covered for Chromium | Retain; replace incidental literal text checks |
| Responsive 14 viewport classes and restore dialog accessibility | scenarios/responsive-layout.py; restore-dialog-accessibility.py | Covered for Chromium | Retain representative width boundaries; preserve critical overflow guard |
| Real Firefox/WebKit, touch and screen-reader device behaviour | Current CI only exercises Chromium | **Gap / manual boundary** | Add limited cross-engine smoke if supported; retain explicit device QA for screen reader/touch |

## Retain / refactor / remove decision register

### RETAIN (high-impact regression detectors)

1. FSRS upstream parity, historical replay, corrective lifecycle, holdout gate and personalized-profile replacement semantics.
2. Evidence immutability, guard mismatch, concurrent completion, restore transaction failure and exactly-once commit checks.
3. Capacity/split conservation (including existing exhaustive bounded cases), deterministic planner order, version history and time accounting.
4. Backup corruption/checksum, safely rejected imports, recovery of active sessions and cross-tab read-only ownership.
5. Actual keyboard/focus/ARIA/overflow behaviour and meaningful large dataset exercises.

### REFACTOR in Passes B–D

1. Merge duplicated build/ownership assertions; rely on an authoritative manifest and functional build artifact checks.
2. Replace literal source method names, source expression snippets, exact call-count assertions and noncontractual text strings with executable contract tests.
3. Avoid 3 builds inside core and repeated builds across jobs when generated artifacts can be shared or verified.
4. Run fresh Node/Python processes only where isolation is necessary; centralize common fixtures, browser launch, and IndexedDB test shim.
5. Replace fixed browser sleeps with state-based waits or controlled clocks where possible; preserve genuine debounce/timing assertions.
6. Split deterministic FSRS property tests from long experimental policy sweeps, native smoke and full WASM training.
7. Keep responsive coverage meaningful without recreating complete app state for every dimension; preserve true per-viewport defect detection.

### REMOVE ONLY AFTER COVERAGE-PRESERVING REPLACEMENT

- Assertions requiring an exact private function/method name or stringified source line (unless a documented published API).
- Exact counts of implementation call sites, private class placement, CSS comment marker or UI prose that can change without altering a user-facing contract.
- Duplicate manually maintained source-file inventories that contradict the canonical manifest.
- Duplicate optimizer probe within a tier that already executes the strictly stronger full test, *after* retaining fast-only targeted use of probe.
- Duplicated mock/shim definitions and obsolete wrapper/phase-era test entrypoints whose sole purpose is orchestration rather than isolation.
- Repeated smoke checks of the same behaviour only when a stronger test exercises that very boundary and diagnostics remain clear.

**No behavioural test or assertion is removed in Pass A.** The decisions above are a deletion/refactor plan, not evidence that anything is currently safe to delete.

## Required missing coverage before concluding optimization

**P0:** a real application IndexedDB create/edit/commit → close context/restart → reopen → verify exact state and immutable evidence, including failure interruption; native persistent state must be tested independently of the custom IndexedDB shim.

**P0:** small-capacity planner optimality independently cross-checked against a brute-force/oracle implementation of the documented objective and tie-breaking rules; maintain the existing exhaustive split-conservation checks.

**P1:** native two-tab ownership/visibility smoke for genuine browser storage coordination; keep mock fault injection for deterministic races.

**P1:** mutation sensitivity against a small set of consequential changes (e.g. disabling transaction guard, allowing duplicate evidence, skewing capacity comparison, skipping archive integrity), verifying that *the appropriate* test fails.

**P1/manual:** Firefox/WebKit browser smoke, mobile touch and screen-reader routes as device/tooling allows. Neither Chromium nor mock IndexedDB alone establishes cross-browser or physical power-loss durability.

## Pass B and closure acceptance criteria

- Build/ownership invariants have one source of truth, and no intentional source-level hard-coded assumptions survive without documented justification.
- Test run never writes release checksums simply to verify them; builds are controlled once per necessary artifact lifecycle.
- Every removed source-text assertion is mapped either to a stronger behavioural/architectural guard or to an explicitly obsolete requirement.
- Re-run exactly the same profiler in Pass E, same runner/toolchain and commands; compare median/p95 over repeated runs if practicable. Do not treat one run's RSS/seconds as definitive.
- Report CI stages separately, so parallel runner setup and sequential full-suite wall time are not conflated.
- Count *unique meaningful contracts* and mutation detection, not raw assertions evaluated inside exhaustive loops.
- Critical P0 routes must remain green before any merge/release.

**Pass A conclusion:** the suite has strong domain/safety content but unnecessary static implementation coupling, repeated execution costs and under-verified real-browser persistence. The highest expected execution gains come from reducing Chromium/process churn, separating deep FSRS experiments, and eliminating repeated builds—not maximizing lines deleted. No existing QA gate or production logic was changed during this pass.
