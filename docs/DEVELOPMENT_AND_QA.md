# Development and QA

## Toolchain

The repository pins:

- Node.js 26.13.0 via `.nvmrc`;
- npm 11.20.0 via `packageManager`;
- TypeScript 7.0.2 as a project-local dev dependency.

Use:

```sh
npm ci
npm run build
```

The build rejects a missing or mismatched local TypeScript compiler. A global `tsc` is not used.

## Source and generated artifacts

Authoritative application source lives under `source/`. The TypeScript ownership order is defined by `source/app/source-manifest.json`.

TypeScript compiles the real manifest-owned `source/app/*.ts` files directly. The files share a script namespace for type checking; no synthetic combined TypeScript file is created. The emitted JavaScript fragments are verified against the manifest, assembled in manifest order, and wrapped once in the build-owned strict IIFE.

Generated/intermediate paths:

- `build/generated-js/` — ephemeral per-source compiler output;
- `dist/app.js` — generated sealed deployable runtime;
- `index.html` — generated self-contained application.

Never hand-edit `dist/app.js` or `index.html`.

## Test philosophy

Tests are organized by behaviour and safety boundary. `tests/qa.py` is the single suite-membership registry; substantive scenario bodies live under `tests/scenarios/`, while thin wrapper-only entrypoints are intentionally absent. Static architecture tests protect published build boundaries rather than private method names or source phrasing.

The permanent suite covers:

- source/build ownership and generated-artifact integrity;
- domain and hostile validation;
- FSRS-7 scheduling-policy identity, replay, personalization profile, rating semantics and persistent-difficulty lifecycle;
- planning, duration learning, splitting and plan history;
- active-session persistence and duplicate-commit protection;
- phase timing and interruption classification;
- cross-tab ownership and takeover;
- backup codec corruption/limit checks;
- destructive restore safety;
- plugin/public API contracts;
- responsive/accessibility behaviour;
- large-data and browser workflows.

## Canonical QA commands

After `npm ci`, use the same entrypoints locally and in CI:

```sh
npm run qa:core
npm run qa:optimizer
npm run qa:browser:durability
npm run qa:browser
npm run qa:browser:performance
npm run qa:deep
npm run qa:full
```

`qa:core` performs exactly one authoritative build, verifies `CHECKSUMS.sha256` read-only, checks the build/architecture contract and HTML structure, and runs the fast non-browser JavaScript regressions. `qa:optimizer` exercises the isolated native optimizer runtime. `qa:browser:durability` is the focused phase-time/durability gate. `qa:browser` runs the ordinary browser matrix against one parent-owned Chromium process, with isolated Playwright contexts for each scenario and only the fast browser/WASM optimizer probe. `qa:browser:performance` keeps the 1,000-unit large-data journey in its own Chromium process so process state and remote-CDP transport cannot distort the measurement. `qa:deep` owns the long FSRS-R2 scheduling experiment and full browser/WASM optimizer training. `qa:full` runs every tier. Browser commands require Playwright and Chromium; local hosted-optimizer runs require `npm ci --prefix tools/fsrs-optimizer` and `npm run build:hosted` if the hosted distribution is not already present.

The Python browser suite shares launch, error-capture, readiness, condition-wait, layout and module-loading primitives from `tests/helpers/browser_harness.py`; scenario ordering belongs only to `tests/qa.py`. Ordinary browser scenarios connect over CDP to one Chromium process but receive fresh incognito contexts so cookies, IndexedDB, localStorage and ownership state remain isolated. Tests whose subject is process persistence or performance deliberately opt out: the native IndexedDB journey launches a persistent profile, closes Chromium and relaunches a new process with the same profile, while the large-data performance tier uses its own local Chromium. The reusable mock IndexedDB shim, host-state access, iframe bootstrapping and safety-copy restore ceremony remain in `tests/helpers/persistent_browser.py`.

Fixed wall-clock sleeps are not the normal synchronization primitive. Browser tests should wait for the state that makes the assertion meaningful: visible/hidden UI state, a specific rendered record, IndexedDB persistence, ownership state, evidence publication, or a controlled-clock transition. Real elapsed waits are retained only where elapsed browser time itself is under test, such as timer/durability behavior.

## Required QA discipline

For a material change:

1. audit the affected source and contracts;
2. define explicit objectives;
3. implement the smallest coherent change;
4. run targeted checks for directly affected surfaces;
5. re-audit the objectives;
6. run broader regression when the change crosses subsystem boundaries;
7. run the full suite after substantial cumulative changes.

Generated output must be rebuilt from source before release/merge.

The permanent Node regression matrix includes a multi-year FSRS scale/determinism benchmark. Its fixture spans 96 memory cards with 48 reviews each (4,608 review events, about 5.8 years per card), verifies order-independent evidence normalization, forces one independent replay per reviewed card, then proves repeated retrievability reuses replay verification by instrumenting the single reschedule primitive. It also checks deterministic materialization and planner tie resolution. Timing assertions are intentionally generous regression envelopes rather than microbenchmark claims.

Mathematical and stateful regression tests use deterministic seeded cases where broad input coverage is valuable. Planner selection is checked against an independent exhaustive subset oracle on hundreds of small seeded problems; the oracle models the documented critical-first planning policy but does not reuse the production dynamic-programming implementation. It also checks capacity, disposition partitioning, permutation invariance and monotonic attainable critical value as capacity increases.

FSRS scheduling mathematics are not reimplemented in application tests. `tests/fsrs-reference-parity.spec.js` creates an independent scheduler directly from the checksum-pinned upstream ts-fsrs 6.0.0 runtime and compares Revision Director card transitions, replay, previews and retrievability against that reference across deterministic review sequences. Host-owned corrective-relearning, difficulty, persistence and personalization semantics remain separate application-level tests.

Active-retrieval persistence tests use controlled storage read/write failures as well as deterministic recovery-state precedence cases. They verify that emergency local recovery survives an IndexedDB write failure, subsequent serialized writes recover, a local snapshot remains usable during an IndexedDB read failure, reconciliation resumes afterward, and expected diagnostics are emitted without relying on source-expression scans.

The matrix also includes the permanent FSRS-R2 scheduling experiment, which invokes the vendored ts-fsrs runtime directly rather than duplicating its mathematics. It uses deterministic retrievability-dependent outcomes across three sensitivity scenarios, 90/365/730-day horizons and the actual corrective lifecycle, including failed closed-book verification and repeated host corrective work. It sweeps long-form learning-step alternatives, fixed retention 0.84–0.92, Cost-ADR weights 64–1024 and fuzz on/off. The experiment asserts the measured production decision: `1d` learning/relearning, fixed retention 0.90 as the new-install default, and fuzz disabled. The bounded Cost-ADR 1024 path remains regression-tested as an optional scheduler implementation rather than being treated as the default.

## FSRS optimizer runtimes

Personalized training remains isolated under `tools/fsrs-optimizer/`. The native reference runtime pins `@open-spaced-repetition/binding@0.6.1`; the hosted browser path pins `@open-spaced-repetition/binding-wasm32-wasip1@0.6.1` and the emnapi runtime versions required by that release.

```sh
cd tools/fsrs-optimizer
npm ci
npm run optimize -- path/to/revision-director-fsrs-evidence.csv profile.json
# When replacing active personalized weights:
npm run optimize -- path/to/revision-director-fsrs-evidence.csv candidate.json --incumbent-profile=active-profile.json
npm run parity
```

The ordinary self-contained build remains:

```sh
npm ci
npm run build
```

For the normal hosted distribution:

```sh
npm ci
npm ci --prefix tools/fsrs-optimizer
npm run build:hosted
```

Serve `Revision_Director_Hosted/` over localhost or HTTPS. It includes the local optimizer Worker/WASM by default while still loading them only on demand. The root `index.html` remains the lean single-file portable fallback and contains no optimizer assets. The hosted build writes `optimizer-footprint.json` with the exact HTML, Worker and WASM byte counts.

Native and browser runtimes use one `optimizer-core.mjs` for conversion, chronological split, stock/incumbent held-out gates, final retraining and profile construction. `parity.mjs` independently compares native and WASM conversion, trained weights and evaluation metrics. Browser cancellation is hard cancellation by Worker termination; progress is reported from the binding callback. `tests/fsrs-browser-optimizer.spec.py` provides a fast hosted browser/WASM probe and an optional full optimization mode. In CI the probe self-prepares the hosted distribution from the pinned optimizer lockfile when it is absent so the generic Chromium matrix actually exercises the Worker/WASM boundary. Application regressions additionally verify retrieval-phase-only optimizer duration, unreliable-duration handling, SHA-256 source-snapshot binding, stale-profile rejection, candidate-vs-incumbent provenance, one-transaction personalized→personalized replacement, practical holdout-improvement/calibration gates, early-learning versus established-lapse semantics, exam-bounded corrective relearning and transactional settings behavior. Exact optimizer eligibility and rebase semantics are documented once in `SCHEDULING_AND_PLANNING.md`.

## TypeScript 7 checker parallelism

A temporary benchmark on the Ubuntu 24.04 GitHub runner compared the TypeScript 7.0.2 project checker with default parallelism and explicit `--checkers 1`, `2`, `4` and `8`. Each configuration received one warm-up and seven measured runs.

The two-checker configuration was selected because it matched the fastest median (0.25 s), had the best measured p95 among the tied-fast configurations (0.27 s), and used less memory than the default (about 95 MiB versus about 100 MiB median maximum RSS). The authoritative build therefore invokes TypeScript with `--checkers 2`. This is a measured small-project choice, not a general claim that two workers is universally optimal.

## Continuous integration

The permanent GitHub Actions workflow uses an explicit Ubuntu 24.04 runner, the pinned project Node/npm/TypeScript toolchain, Python 3.13 and full-sha-pinned official GitHub actions.

The core job is read-only and invokes `npm run qa:core`, covering one strict TypeScript 7 build, JavaScript parse validation, authoritative build/architecture checks, HTML sanity, read-only checksum verification and every non-browser JavaScript regression.

`build/checksums.py --check` is the normal QA path. `--write` is reserved for the working-branch generated-artifact synchronization job or deliberate release-manifest maintenance; tests and prose are not checksum targets. The external-optimizer job installs only the isolated native optimizer lockfile and invokes `npm run qa:optimizer`. The browser job is read-only and invokes the same `qa:browser:durability` and `qa:browser` commands used locally. A separate working-branch-only writer can regenerate and commit `dist/app.js`, `index.html` and `CHECKSUMS.sha256` from authoritative source. It runs independently of read-only core QA and tags its synchronization commit so it does not recurse. Main-branch and pull-request QA remain read-only and require committed generated artifacts.

## Browser/device boundary

Automated Chromium coverage is extensive, but some behaviour still warrants target-device verification when release quality matters:

- native IndexedDB persistence across browser restart, eviction and storage pressure;
- Safari and Firefox behaviour;
- Android/iPhone/iPad touch behaviour;
- screen-reader traversal and device-level accessibility;
- long-running sleep/wake and interruption behaviour;
- substantially larger multi-year histories.

These are QA boundaries, not reasons to add compatibility or migration code.

## Checksums

`CHECKSUMS.sha256` covers release-critical source, build inputs, generated artifacts, vendored/runtime assets and optimizer tooling. QA code, workflow YAML, internal documentation, README and changelog prose are deliberately outside this release manifest; legal notices remain covered. `python3 build/checksums.py --check` is the ordinary verification command; `--write` is an explicit maintenance operation. The manifest does not hash itself.
