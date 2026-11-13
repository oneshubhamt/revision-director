# QA Pass B — Consolidation and QA-Debt Removal

**Repository:** oneshubhamt/revision-director  
**Branch:** working  
**Pass A baseline:** 4894005d1cbb0189a787f9afbebedc187da57d3a  
**Date:** 2026-11-13

## Objectives

Pass B used `docs/QA_PASS_A_BASELINE.md` as the deletion/refactor guardrail. Its scope was deliberately structural: consolidate build/architecture checks, eliminate implementation-coupled assertions, make normal checksum verification read-only, remove wrapper-only suite entrypoints, and eliminate the duplicated binary browser fixture without weakening behavioural coverage.

## Result

The permanent QA topology now has one suite-membership registry: `tests/qa.py`.

`qa:core` performs exactly one authoritative build and then verifies the resulting graph. Neither `tests/build-integrity.spec.py` nor any other core test invokes the compiler. The standalone `test:build` command is explicit: build once, then verify.

Normal QA executes:

```
build/build.py
build/checksums.py --check
node --check dist/app.js
authoritative build/HTML checks
behavioural Node scenarios
```

The working-branch generated-artifact job is the only ordinary CI path that intentionally uses `build/checksums.py --write`. It is separated from the read-only core gate and marks its own generated synchronization commit to prevent recursion.

## Static architecture consolidation

Before Pass B:

- `build-integrity.spec.py`: 62,227 bytes; 262 named checks; included its own build; mixed true build invariants with private method names, exact source expressions, UI phrases, CSS markers, call counts and historical implementation structure.
- `source-ownership.spec.py`: 9,179 bytes; 46 checks; duplicated manifest facts and manually maintained the complete TypeScript filename/private-symbol inventory.

After Pass B:

- `build-integrity.spec.py`: about 6 KiB; **23 authoritative checks**.
- `source-ownership.spec.py`: removed.
- Manifest membership is checked algorithmically against the actual `source/app/*.ts` set rather than against a second hard-coded filename list.
- The build contract checks source-manifest validity/order, strict TypeScript graph, generated-artifact parity, sealed runtime boundary, vendored ts-fsrs identity/checksum, optimizer dependency/lock parity, and release checksum coverage.
- Private method names, implementation-expression counts and incidental source/UI phrasing are not architecture gates.

A deliberate test failure during this pass validated the classification: a static substring check incorrectly declared the standalone build to contain optimizer assets because the application source legitimately contained an optimizer capability-marker string. That phrase assertion was removed instead of being replaced by another text heuristic; the self-contained build remains protected by structural artifact checks and browser/runtime coverage.

## Behavioural tests preserved

No production code was changed. High-value FSRS replay/lifecycle tests, planner invariants, backup corruption/restore tests, storage and active-retrieval recovery, ownership/takeover, accessibility, responsive layout, large-data tests and optimizer tests remain in the canonical plans.

Two smaller source-coupled pockets were removed:

- `reliability-closure.js` retains executable IndexedDB durability/fallback, deterministic lookup and fail-closed relation behaviour, but no longer searches generated application source for exact transaction expressions or implementation counts.
- `kernel-policy.spec.js` no longer inspects generated workflow HTML for strings already covered by real Chromium workflow journeys.

The runtime-harness ownership check now guards the architectural boundary—no direct VM or vendored-runtime bypass—without enforcing a minimum adoption count or exact helper names.

## Suite topology and fixtures

Removed wrapper-only entrypoints:

- four Python browser group wrappers;
- four JavaScript scenario group wrappers;
- `tests/helpers/suite-runner.js`.

Their underlying scenario processes remain separately executed, preserving isolation and diagnostics. Group membership/order is declared once in `tests/qa.py`.

The duplicate `tests/fixtures/browser-baseline.rdbackup` was removed. `tests/fixtures/browser-baseline.json` is now the single canonical fixture source. `baseline_backup_path()` deterministically creates the archive in a temporary cache using the existing fixture codec, and every browser scenario that needs the archive uses that generated artifact.

## Checksum scope

`CHECKSUMS.sha256` was reduced from **125 to 58 entries**. It now protects the release-critical source/build/generated/vendor/runtime graph and legal/runtime assets rather than QA implementation files, workflow YAML, README/changelog and internal documentation.

This is intentional: changing a test or document no longer requires mutating the release checksum merely to make QA pass. `build-integrity.spec.py` verifies that the required release graph remains covered.

## Footprint

| Metric | Pass A | Pass B | Change |
|---|---:|---:|---:|
| Test files | 62 | 51 | -11 |
| Tests/helpers/fixtures | 617,328 B | 531,239 B | **-86,089 B (-13.9%)** |
| build-integrity | 62,227 B | ~5,974 B | ~-90% |
| source-ownership | 9,179 B | removed | -100% |
| Binary baseline backup fixture | 14,822 B | generated | removed |
| Checksum entries | 125 | 58 | -67 |

The reduction was not achieved by deleting mathematical/behavioural coverage; most deleted bytes were static implementation assertions, wrappers, duplicate architecture inventory and a derived fixture.

## Reproducible Pass B profile

The retained `tools/qa-baseline.py` was run in GitHub Actions using the same method as Pass A. Run: 43433481772.

| Stage | Pass A wall | Pass B wall | Pass A observed PIDs | Pass B observed PIDs | QA subcommands A→B |
|---|---:|---:|---:|---:|---:|
| Core | 16.463 s | 28.588 s | 39 | **27** | 33→**28** |
| Native optimizer | 0.360 s | 0.398 s | 8 | 7 | 1→1 |
| Durability | 33.550 s | 58.041 s | 14 | 14 | 1→1 |
| Browser | 240.411 s | 262.515 s | 287 | **281** | 24→**20** |

Browser launches remained 20 in the main browser suite and 1 in the durability gate. That is expected: Pass B removed wrapper processes but intentionally retained scenario-level browser isolation. Browser/process reuse and fixed-wait reduction are Pass D concerns.

The wall-clock sample is **not evidence of a regression or speed improvement**. GitHub-hosted runner performance varied materially between Pass A and Pass B; the structural counters are the reliable Pass B result. Historical ordinary CI core spans also vary substantially. Runtime optimization should be judged with repeated measurements when Pass D changes execution strategy.

Peak summed-RSS measurements were broadly similar (Pass B: core 268.58 MiB, durability 1,376.56 MiB, browser 1,549.44 MiB). These are sampled sums of descendant RSS and double-count shared pages; they are comparison aids, not physical-memory claims.

## Objective verification

Pass B objectives are met:

1. **One build per `qa:core` invocation:** confirmed by source and successful CI logs; build-integrity performs no compilation.
2. **Authoritative architecture tests:** 23 contract checks replace the previous duplicated 262 + 46 static checks.
3. **No checksum mutation in normal QA:** `qa:core` uses `--check`; only explicit generated-artifact maintenance uses `--write`.
4. **Redundant method-name/phrase/count tests materially removed:** especially from build integrity/source ownership/reliability closure and duplicated UI HTML checks.
5. **Scenario wrappers rationalized:** suite membership has one owner while substantive scenario isolation remains.
6. **Duplicate fixture removed:** one JSON source deterministically derives the browser backup artifact.
7. **Behavioural coverage retained:** canonical core/optimizer/durability/browser profile completed successfully.

The Pass A P0 gaps—native application IndexedDB restart persistence and an independent small-instance planner optimality oracle—remain intentionally open for Pass C/D. Pass B did not hide or substitute for those coverage improvements.

## Conclusion

Pass B substantially reduces QA debt and maintenance coupling without pretending that fewer lines alone equal better testing. The suite is now easier to refactor safely: architecture gates protect real boundaries, while product behaviour is owned by executable domain/browser tests. Runtime remains dominated by deep FSRS experiments and isolated Chromium scenarios, which should be addressed in later passes rather than conflated with this consolidation pass.
