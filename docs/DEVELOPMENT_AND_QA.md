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

Generated/intermediate paths:

- `build/generated/revision-director.combined.ts` — ephemeral;
- `build/generated-js/` — ephemeral compiler output;
- `dist/app.js` — generated deployable runtime;
- `index.html` — generated self-contained application.

Never hand-edit `dist/app.js` or `index.html`.

## Test philosophy

Tests are organized by behaviour and safety boundary even where historical filenames still contain pass/stage labels. New documentation and new test structure should not reproduce implementation-pass sprawl.

The permanent suite covers:

- source/build ownership and generated-artifact integrity;
- domain and hostile validation;
- FSRS-7 scheduling and rating semantics;
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

## Current automated baseline

On 11 November 2026 the clean-slate FSRS-7 branch passed the complete temporary CI gate using the exact pinned Node/npm/TypeScript toolchain. The gate included:

- strict TypeScript 7 build;
- JavaScript parse validation;
- build integrity, HTML sanity and source-ownership checks;
- all non-browser JavaScript regressions;
- the Pass B2 durability gate;
- the complete Python/Chromium regression matrix.

The temporary branch-only workflow used to establish this baseline is not part of the product architecture and should be removed after the final tree is certified.

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

`CHECKSUMS.sha256` is the repository integrity manifest for tracked release-critical files. Any tracked file covered by the manifest must be refreshed after modification. The manifest does not hash itself.
