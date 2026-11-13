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

Tests are organized by behaviour and safety boundary even where historical filenames still contain pass/stage labels. New documentation and new test structure should not reproduce implementation-pass sprawl.

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

The core job is read-only and covers:

- strict TypeScript 7 build;
- JavaScript parse validation;
- build integrity, HTML sanity and source-ownership checks;
- all non-browser JavaScript regressions;
- checksum-manifest refresh from the current checkout before integrity checks.

Checksum refresh is implemented once in `build/checksums.py`; CI does not duplicate hashing logic in workflow YAML. The external-optimizer job installs only the isolated native optimizer lockfile and exercises its pinned FSRS-7 boundary. The browser job is read-only and covers the durability gate plus the complete Python/Chromium regression matrix. A separate working-branch-only job has the sole write permission needed to regenerate and commit `dist/app.js`, `index.html` and `CHECKSUMS.sha256` from authoritative source. Main-branch and pull-request runs still fail on a generated-artifact/checksum diff, while working-branch source commits are synchronized by that dedicated writer job.

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

`CHECKSUMS.sha256` is the repository integrity manifest for tracked release-critical files. `python3 build/checksums.py --write` refreshes it; `--check` verifies it without mutation. Any tracked file covered by the manifest must be refreshed after modification. The manifest does not hash itself.
