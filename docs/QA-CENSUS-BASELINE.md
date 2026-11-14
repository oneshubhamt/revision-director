# Revision Director QA — Pass A census and measured baseline

**Scope:** diagnostic-only census of `working` source tree at `ede3bd30cb296ca11441585d938e208c9ac5f8a3` (14 Nov 2026 UTC). This report and the opt-in profiler are the only Pass A additions; no production source, tests or CI workflow is modified.

## Source coverage and methods

- GitHub recursive tree was complete (`truncated=false`): **47 tracked test entrypoints** under `tests/` and all 47 are referenced by `tests/qa.py`; no orphaned `*.spec.*` or `tests/scenarios/*.{py,js}` test entrypoints. The 48th executable is the external FSRS optimizer `npm smoke`.
- Inventory: 23 core Node; 2 static Python; 19 standard browser; 1 standalone timing browser; 1 large-data browser; 1 deep Node experiment; 1 external optimizer smoke. Diagnostic mutation probes (six challenges) are listed separately.
- Timing figures are **single-run observed seconds** from timestamped GitHub Actions logs for the same source snapshot. Figures include each child process launch, not CI job setup, dependency installs, warmup or shared-browser startup. A faster/slower machine may differ. Rounded to hundredths. No local repository checkout or local execution was available in the audit environment.
- Primary evidence: [CI run 43552195677](https://github.com/oneshubhamt/revision-director/actions/runs/43552195677), whose core, browser, timing, optimizer and performance jobs passed. Deep experimental and mutation durations came from its **partially successful deep job** before a later re-entrant browser failure. Counts are **not** equivalent to independent correctness coverage.

## Measured stage totals (sum of child runtimes)

| Stage | Entries | Observed seconds | Notes |
|---|---:|---:|---|
| core | 25 | 8.15 | Build/checksum/syntax setup excluded (~0.44 s). |
| optimizer | 1 | 0.20 |  |
| timing | 1 | 16.47 |  |
| browser | 19 | 101.50 | Browser CDP startup excluded. |
| performance | 1 | 24.32 |  |
| deep | 1 | 14.55 | Simulation only; full WASM and probes separate. |

Standalone diagnostics: full browser optimizer variant ~3.46 s; six isolated mutation challenges ~81.28 s (including their clean controls). The core's FSRS scale test ~3.56 s accounts for a substantial share of its ~8.15 s test-child total.

**CI status:** The latest run's overall status was **failure**, because `qa:deep` called the existing `tools/qa-baseline.py` inside the deep path, repeating core/optimizer/timing/browser; that nested browser replay failed at `Weekly-balance factor is not exposed in the planner`. The standalone browser job had passed earlier on that same commit. This is a concrete order/re-execution sensitivity requiring diagnosis, not proof of an inherent product fault. An earlier run also had a browser failure. Do not mark all QA green.

## Ownership / overlap / cost census

`retain` means keep its independent invariant; `merge` or `replace` is a **Pass B–D recommendation only**, not authorization to drop coverage. Cost is observed seconds on the CI runner. A test may exercise multiple behaviors; the table records its primary risk owner.

| Entry | Layer | Primary risk | Invariant | Overlap / evidence independence | Pass recommendation | Seconds |
|---|---|---|---|---|---|---:|
| `tests/build-integrity.spec.py` | core | Release integrity | Ordered TS source, compiled output, vendor pin and checksum graph match | Build/checksums; independent artifact inspection | retain / narrow incidental topology | 0.03 |
| `tests/html-sanity.spec.py` | core | Document integrity | No external resources or duplicate IDs; required accessible structure | UI browser checks; literal release label and counts are brittle | replace incidental text/count assertions | 0.04 |
| `tests/scenarios/public-plugin-runtime.js` | core | Public API safety | Capabilities are frozen, private writes inaccessible, plugin/intake boundaries enforce contracts | public-plugin-runtime.py browser witness | retain core owner | 0.05 |
| `tests/fsrs-contract-parity.spec.js` | core | Optimizer contract drift | Browser and optimizer share canonical FSRS contract | optimizer-core and browser optimizer | retain cheap contract parity | 0.04 |
| `tests/fsrs-reference-parity.spec.js` | core | Scheduling drift | Application schedules match independent upstream FSRS across seeded histories | FSRS integration; genuine reference witness | retain primary oracle | 1.55 |
| `tests/fsrs-integration.spec.js` | core | Scheduler/evidence lifecycle | Replay, profiles, retention policies, rebase and restore preserve outcomes | kernel-policy, programme-closure | partition ownership; retain distinctive paths | 0.46 |
| `tests/fsrs-optimizer-core.spec.js` | core | Optimizer orchestration | Training input, progress, profile and holdout result obey canonical schema | optimizer-policy, native smoke | retain; consolidate shared fixtures | 0.02 |
| `tests/fsrs-optimizer-policy.spec.js` | core | Unsafe personalization | Chronological split, holdout and incumbent-replacement gates reject regressions | optimizer-core, native smoke | retain policy owner | 0.02 |
| `tests/fsrs-programme-closure.spec.js` | core | Memory lifecycle | Again/relearn/corrective verification/rebase remain coherent and lossless | FSRS integration, browser programme journey | retain lifecycle owner | 0.12 |
| `tests/fsrs-scale-benchmark.spec.js` | core | Replay scale/cache | Deterministic indexed history and replay caching; bounded processing time | reference parity, planner properties, performance | keep correctness core; move wall-clock thresholds deep | 3.56 |
| `tests/kernel-policy.spec.js` | core | Core domain policies | Canonical scheduling, workflow, recording and backup policy boundaries hold | FSRS integration, planning, backup | split or table-drive monolithic mixed domain | 0.09 |
| `tests/scenarios/adaptive-planning.js` | core | Adaptive duration/priority | Only reliable samples adjust duration; critical work and chunking respect policy | planning.spec, planner-properties | retain domain edge cases | 0.05 |
| `tests/scenarios/planning-persistence-validation.js` | core | Planner and persistence invariants | Generated cases preserve partition, canonical plan updates and recovery behavior | planning.spec, planner-properties, browser planning | review 138,674 reported checks for independent value | 0.56 |
| `tests/scenarios/backup-codec.js` | core | Backup integrity | Codec round-trip, checksums and tamper rejection preserve canonical data | backup-codec.py browser witness | retain codec owner | 0.07 |
| `tests/scenarios/backup-controller.js` | core | Backup/restore orchestration | Inspection cannot mutate; safety copy and restore/rescue policies enforce gates | data-safety-controller.js, backup-restore-controller.py | merge repeated controller setup | 0.07 |
| `tests/scenarios/data-safety-controller.js` | core | Corruption-safe restore | Verified backup vs forensic rescue paths fail closed | backup-controller.js, data-safety.py | consolidate controller matrix | 0.07 |
| `tests/planning.spec.js` | core | Plan lifecycle | Planner priorities, edits, splitting and lifecycle produce expected state | adaptive-planning, planning-persistence-validation | retain distinct product workflows | 0.06 |
| `tests/planner-properties.spec.js` | core | Suboptimal or unstable planning | 320 seeded cases match exhaustive knapsack oracle and metamorphic invariants | other planning tests; independent small oracle | protect as primary mathematical owner | 0.07 |
| `tests/runtime-harness-ownership.spec.js` | core | Harness boundary drift | Tests use central VM/vendor harness rather than direct setup | No real behavior check; source text search only | replace with AST/import-graph contract | 0.02 |
| `tests/scenarios/production-contracts-storage.js` | core | Canonical model drift | Profiles, nodes, settings and store adapters canonicalize/reject correctly | reliability-closure.js, build contracts | retain behavior; remove pass-version assertions | 0.06 |
| `tests/scenarios/active-retrieval-persistence.js` | core | Draft recovery loss | Revision precedence, bounded emergency snapshots and flush ordering survive faults | persistent-active-retrieval.py, hostile-recovery.py | retain pure recovery owner | 0.80 |
| `tests/scenarios/phase-time-runtime.js` | core | Incorrect active duration | Pause/reconcile/classify/clock reversal maintain accurate active-time accounting | phase-time-runtime.py browser witness | retain fake-clock model | 0.05 |
| `tests/scenarios/ownership-storage-health.js` | core | Unauthorized writes/quota warnings | Lease and storage-state policies preserve single owner and truthful diagnostics | ownership-storage-health.py real browser witness | retain pure policy owner | 0.20 |
| `tests/scenarios/reliability-closure.js` | core | Durability/fail-open bugs | Strict transaction hints, fallback, deterministic lookup and missing data fail safely | indexeddb-durability.py, production-contracts-storage.js | retain failure-path tests; merge duplicate policy data | 0.05 |
| `tests/scenarios/presentation-kernel.js` | core | Presentation registry drift | Immutable built-in profile, preference switching and token APIs are coherent | presentation-kernel.py browser witness; version literals | retain API; remove stale identity checks | 0.04 |
| `tests/scenarios/backup-codec.py` | browser | Browser import tampering | Real UI imports/exports verified archive and rejects tampered/raw input | backup-codec.js, backup-restore-controller.py | retain independent browser codec witness | 2.40 |
| `tests/scenarios/backup-restore-controller.py` | browser | Unsafe restore UI | Preview/safety-copy/confirmation and active-session choice gate writes | data-safety.py, browser-qa.spec.py | merge repeated ceremony setup | 3.38 |
| `tests/scenarios/data-safety.py` | browser | Unsafe data replacement | Release compatibility, corrupt data, rescue and restore failure paths behave safely | backup-restore-controller.py, canonical-topology-browser.spec.py | retain specialized corruption witnesses | 6.68 |
| `tests/scenarios/restore-dialog-accessibility.py` | browser | Inaccessible restore | Restore dialog remains reachable/focus-trapped across responsive sizes | responsive-layout.py, ui-runtime-accessibility.py | keep targeted restore-specific risk | 6.99 |
| `tests/scenarios/public-plugin-runtime.py` | browser | Plugin boundary bypass | Public API registration and imported plugins work in actual browser | public-plugin-runtime.js | retain browser/provider witness | 1.78 |
| `tests/browser-qa.spec.py` | browser | Broken user journey | Eight end-to-end journeys cover startup, planning, study, backup, accessibility | many specialist browser suites; shared fixture host | decompose distinct journeys; eliminate duplicate ceremony | 20.54 |
| `tests/scenarios/persistent-active-retrieval.py` | browser | Recovery loss on reload | Active session survives refresh, emergency copy and interruption | active-retrieval-persistence.js, hostile-recovery.py | retain browser recovery witness (shim-based) | 5.74 |
| `tests/scenarios/ownership-storage-health.py` | browser | Concurrent tab mutation | Only lease owner can mutate; takeover hydrates draft and quota signals | ownership-storage-health.js, native-indexeddb-journey.py | retain independent multi-document witness | 4.50 |
| `tests/scenarios/hostile-recovery.py` | browser | Partially committed evidence | Hostile commit-token race aborts all writes and retry commits once | active-retrieval-persistence.js, persistent-active-retrieval.py | retain fault injection witness | 9.25 |
| `tests/scenarios/indexeddb-durability.py` | browser | Ignored durability policy | Real Chromium reflects strict vs default IndexedDB write modes | reliability-closure.js pure contract | retain native platform witness | 0.90 |
| `tests/scenarios/native-indexeddb-journey.py` | browser | Real persistence breakage | Native IndexedDB survives restart/reload and two-tab coordination | shim-based persistence scenarios | retain critical independent real-store witness | 4.55 |
| `tests/scenarios/presentation-kernel.py` | browser | Wrong rendered presentation | Prepaint/token manifest and corrupt preference fallback remain usable | presentation-kernel.js, responsive-layout.py | retain browser presentation contract | 4.95 |
| `tests/scenarios/ui-runtime-accessibility.py` | browser | Inaccessible navigation | ARIA tabs, keyboard movement, dialogs and delegated actions operate | ui-behaviour.py, full-qa-supplement.spec.py | consolidate shared keyboard journey | 3.92 |
| `tests/scenarios/ui-behaviour.py` | browser | Duplicate actions/lost focus | Repeated navigation does not duplicate clicks or erase focus/selection | ui-runtime-accessibility.py, browser-qa.spec.py | merge overlapping tab/focus checks | 8.10 |
| `tests/scenarios/responsive-layout.py` | browser | Unusable layouts | 14 viewport classes × six panes keep focusable targets and no overflow | restore-dialog-accessibility.py, full-qa-supplement.spec.py | retain systematic matrix; move textual CSS heuristics | 3.82 |
| `tests/canonical-topology-browser.spec.py` | browser | Silent data synthesis | Missing metadata/settings and invalid defaults fail closed without mutating data | data-safety.py, production-contracts-storage.js | retain independent startup corruption witness | 2.42 |
| `tests/fsrs-browser-optimizer.spec.py` | browser | WASM optimizer drift | Hosted browser optimizer executes and returns valid trained/evaluated profile | native smoke, optimizer-core, deep full variant | retain browser-native/WASM witness | 2.67 |
| `tests/fsrs-programme-closure-browser.spec.py` | browser | Corrective memory journey breaks | User can fail, relearn and verify across UI/persistence lifecycle | fsrs-programme-closure.spec.js | retain independent end-to-end witness | 3.77 |
| `tests/full-qa-supplement.spec.py` | browser | Unsafe rendering/accessibility | Escaping, accessible buttons, dialogs and mobile navigation work | browser-qa, ui-runtime-accessibility, responsive-layout | merge targeted unique assertions; remove title literal | 5.14 |
| `tests/scenarios/phase-time-runtime.py` | timing | Lost/misreported active time | Browser focus gaps, pause decisions, phase timing and evidence persist correctly | phase-time-runtime.js | retain browser timing witness; rename misleading gate | 16.47 |
| `tests/scenarios/planning-large-dataset.py` | performance | Slow/incorrect large planner | Capacity reflow and hostile import remain correct under realistic scale | planning.spec; separate scale witness | retain controlled stress tier | 24.32 |
| `tests/fsrs-scheduling-experiments.spec.js` | deep | Unvalidated long-horizon scheduling | Simulated workloads compare learning steps, Cost-ADR, retention and fuzz policies | FSRS reference and performance tests; experimental model | retain as opt-in research/decision evidence | 14.55 |
| `tools/fsrs-optimizer (npm smoke)` | optimizer | Unsafe native training | Native binding training, conversion, metrics and fail-closed CLI work | optimizer policy/core, browser WASM | retain independent native/provider witness | 0.20 |

## Supporting infrastructure (not separate test entrypoints)

| Files | Responsibility / finding |
|---|---|
| `tests/qa.py` | Source of truth for entrypoint order and group membership. Its `deep()` includes mutation probes, a deep experiment, full WASM optimizer, **another `npm ci`**, and `tools/qa-baseline.py`; `full()` runs all prior stages before this. This creates direct repeat execution. |
| `tests/helpers/runtime-harness.js` | Shared VM/vendor harness; injects test API by replacing the `void boot();` marker in generated JS. Reduces duplication but is coupled to emitted source shape. |
| `tests/helpers/browser_harness.py` | Shared browser lifecycle, CDP connection and browser waiting helpers. Its shared CDP process is valuable. |
| `tests/helpers/persistent_browser.py`, `tests/backup_fixture_codec.py`, `tests/fixtures/browser-baseline.json` | Shared browser storage shim and deterministic data fixtures. Preserve distinct shim and native IndexedDB witnesses. |
| `tests/helpers/seeded.js` | Deterministic randomized test support, useful for oracle/metamorphic tests. |
| `tools/qa-mutation-probes.py` | Six mutation challenges; source-string mutation anchors are expected diagnostics, not a production architecture contract. High execution cost and brittle anchors merit deep-only status. |
| `tools/qa-baseline.py` | Existing Linux process/RSS profiler. Re-executes whole QA stages and fails early on stage failure, so it is not a robust per-entry baseline when nested under `qa:deep`. Keep diagnostic-only; do not call recursively. |
| `tools/qa-suite-baseline.py` | **New:** opt-in per-entry profiler that uses current QA manifest and shared Chromium, records each command, exit code, elapsed seconds, commit/host and logs outside the repository. Does not change product or CI. |

## Actionable classification

**Independent witnesses worth keeping:** upstream FSRS reference parity; exhaustive planner oracle; real native IndexedDB/restart; browser ownership handoff; strict IndexedDB durability; hostile transaction fault injection; browser backup round-trip/tamper; native vs WASM optimizer; browser FSRS corrective journey.

**Known overlapping coverage requiring assertion-by-assertion comparison:** backup controller/data safety; browser restore ceremonies; UI tab/focus/accessibility; planning scenario/persistence/property suites; FSRS integration/programme/kernel; presentation kernel and browser presentation. Do not remove one test merely because another targets the same domain.

**Brittle source-shape or incidental checks:** `runtime-harness-ownership.spec.js` scans source strings; `html-sanity.spec.py`, `full-qa-supplement.spec.py`, and multiple Node contracts compare historical release labels; some responsive checks search CSS tokens. Retain genuine security/build/contract checks.

**Performance separation candidates:** core FSRS scale wall-clock thresholds, browser large-dataset stress, deep long-horizon FSRS policy simulations, and mutation diagnostics. Keep their correctness invariants in the cheapest suitable tier.

## Reproduction

Install the locked toolchain and browser dependencies on a supported environment (Node `26.13.0`, npm `11.20.0`, Python `3.13`, Chromium and Python Playwright), then:

```bash
npm ci
python3 -m pip install playwright
npm ci --prefix tools/fsrs-optimizer --no-audit --no-fund
npm run build:hosted
python3 tools/qa-suite-baseline.py --groups core optimizer timing browser performance deep mutations --output /tmp/revision-director-qa-baseline.json
```

Run `--repeat 3` (or more up to 10) to calculate median/p95 and identify variance; preserve the JSON and individual logs outside Git. This profiler runs each entry independently and does **not** recursively call `qa:deep`, `qa:full`, or the old stage profiler. For fast measurements, use `--groups core browser`.

## Pass A exit criteria

- [x] Full inventory of tracked test entrypoints vs canonical runner; zero unlisted test files.
- [x] Explicit primary risk, invariant, execution layer, overlap and disposition recorded for every test.
- [x] Observed per-entry durations from a verifiable CI run, including failures/limits and high-cost paths.
- [x] Reproducible standalone, opt-in profiling procedure producing machine-readable results without changing production behavior.
- [ ] Multi-sample variance, p95, and all-green complete-stage baseline: **not yet measured**. The existing CI deep re-entry failure should be investigated before claiming stable complete-suite success.

**No Pass B–E consolidation has been undertaken.**
