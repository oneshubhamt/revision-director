# QA Pass C — Behavioural and Mathematical Strengthening

**Repository:** oneshubhamt/revision-director  
**Branch:** working  
**Pass B baseline:** c0641120fdde3134fddff3a5bd3823120608e5be  
**Date:** 2026-11-13

## Result

Pass C strengthens defect detection through deterministic seeded properties, independent reference calculations, state-transition tests and controlled persistence faults. No production application source changed.

### Planner oracle

tests/planner-properties.spec.js independently validates the planner's documented two-stage policy: critical work is optimized first, then normal work uses the remaining capacity. The reference calculation enumerates every subset of each small candidate set; it does not reuse the production dynamic-programming implementation.

Seed 0xC0FFEE generates 320 problems with 1–10 candidates and capacities of 12–90 minutes. Properties cover capacity, complete/non-overlapping disposition partitioning, exact critical and normal objective values, minimum-capacity tie resolution, permutation invariance and non-decreasing attainable critical value as capacity grows.

Explicit boundaries cover empty input, exact capacity, critical-before-normal priority, one-minute oversize, required overrun, lower-priority must-split work, no-fit fallback and deterministic equal-score due ordering.

**Result: 4,808 planner/oracle checks.**

### FSRS upstream reference

tests/fsrs-reference-parity.spec.js creates a separate scheduler directly from the checksum-pinned vendored ts-fsrs 6.0.0 / FSRS-7 runtime. No FSRS equations are reimplemented.

The upstream scheduler configuration is declared independently of the application's option helper. Across 12 deterministic sequences × 18 reviews, the suite compares exact card state, forced replay, rescheduling, all preview due dates/ratings and retrievability using upstream chronology and forgettingCurve.

It also explicitly tests New → Again and successful progression to upstream Review state.

**Result: 1,097 direct upstream FSRS parity checks.**

Host-owned corrective relearning, difficulty escalation, immutable evidence, personalization and historical rebase behavior remain in their application integration suites.

### Persistence transitions and fault injection

tests/scenarios/active-retrieval-persistence.js now tests behavior rather than private source expressions. Seed 0xA11CE supplies 128 recovery-precedence cases. Active, committing and completed states, debounce behavior, local/IndexedDB reconciliation and emergency compaction remain covered.

Controlled failures verify that:
- an IndexedDB write failure rejects the durable write but leaves the synchronous emergency snapshot intact;
- the serialized write chain recovers on the next write;
- an IndexedDB read failure can recover from local emergency state;
- the local winner reconciles back to IndexedDB after storage recovers;
- only the expected diagnostics are emitted.

**Result: 155 persistence checks, versus 26 in Pass B.**

## Consolidation

New stronger coverage replaced rather than accumulated weaker checks:

- duplicate low-level FSRS transition tests removed from programme closure;
- duplicate planner packing assertions removed from planning.spec.js and kernel-policy.spec.js;
- low-level interval/replay/retrievability examples removed where direct upstream parity is stronger;
- eleven scalar optimizer-contract alias assertions consolidated into one canonical projection comparison;
- persistence and ownership source-expression checks removed;
- exact ownership implementation constants removed where behavior is what matters;
- the 59-check tests/scenarios/ui-runtime-accessibility.js source-text suite removed because Chromium already tests keyboard tabs, roving tabindex, focus/selection restoration, event delegation, dialog focus return, 44px targets, reduced motion, compact layout and overlay focus containment.

Reported legacy counts changed as follows: programme closure 33→30; kernel/policy 204→194; planning 40→34; ownership/storage 41→31; static UI source assertions 59→0.

A de-novo scan found no application-source token assertions in ordinary JavaScript behavior tests; only the shared runtime-harness boundary checks retain intentional source inspection.

## Dependency and footprint discipline

No property-testing package or new dependency was added. The deterministic PRNG helper is 908 bytes.

| Metric | Pass A | Pass B | Pass C |
|---|---:|---:|---:|
| Test files | 62 | 51 | 53 |
| Tests/helpers/fixtures | 617,328 B | 531,228 B | **529,833 B** |
| Change vs Pass A | — | -13.9% | **-14.2%** |
| Change vs Pass B | — | — | **-1,395 B (-0.3%)** |

Thus Pass C adds two substantive mathematical/reference suites while ending slightly smaller than Pass B.

## Measured profile

Final profiling run: **43442728790**, using tools/qa-baseline.py.

| Stage | Pass B wall | Pass C wall | Pass B commands | Pass C commands | Pass C observed PIDs |
|---|---:|---:|---:|---:|---:|
| Core | 28.588 s | 23.757 s | 28 | 29 | 27 |
| Native optimizer | 0.398 s | 0.360 s | 1 | 1 | 7 |
| Durability | 58.041 s | 56.142 s | 1 | 1 | 14 |
| Browser | 262.515 s | 245.907 s | 20 | 20 | 280 |

Pass C peak summed RSS was 269.88 MiB core, 261.77 MiB optimizer, 1,365.70 MiB durability and 1,524.73 MiB browser. These are sampled summed-RSS values, not unique physical memory.

The wall times are single hosted-run measurements and are not treated as causal speed gains. Structurally, Pass C adds only one net core subprocess: two high-value suites were added and one static implementation suite removed. Browser orchestration remains intentionally unchanged for the browser/performance pass; the main browser profile still observed 20 Chromium launches.

## Verification and remaining boundary

Ordinary CI run 43442729082 completed successfully across Core / TypeScript 7, native optimizer, generated artifacts and Browser / durability.

Pass C objectives are met: deterministic property testing, an independent planner oracle, direct upstream FSRS mathematical reference, meaningful boundaries and transition states, controlled persistence fault injection, and duplicate/superficial coverage consolidation.

The Pass A native **application** IndexedDB persistence-across-browser-restart gap remains open intentionally. Pass C improves persistence state/fault semantics but does not substitute simulated storage for a real browser restart test.
