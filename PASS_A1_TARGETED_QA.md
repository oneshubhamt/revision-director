# Revision Director VA7.1 — Pass A1 Targeted QA

## Scope

Targeted verification of source modularisation and surfaces most likely to be
affected by build-graph changes. This is not the later full-application QA.

## Results

- **25/25** source-ownership and baseline byte-parity checks passed.
- **98/98** build-integrity checks passed.
- **29/29** static HTML checks passed.
- **139/139** kernel, retrieval-workflow, policy and backup checks passed.
- **24/24** Pass C planning scenarios passed.
- **26/26** Pass D adaptive-planning checks passed.
- **7/7** principal Chromium workflow scenarios passed.
- strict TypeScript compilation passed through the integrated build.
- `node --check dist/app.js` passed.

## Targeted surfaces exercised

- ordered source-manifest assembly;
- strict TypeScript compile from the generated composite;
- temporary composite cleanup;
- sealed IIFE boundary;
- absence of runtime modules;
- exact vendor checksum;
- byte parity of compiled JavaScript and deployable HTML;
- all six retrieval workflows;
- scheduling and relearning behaviour;
- daily planning and adaptive-planning kernels;
- browser startup, review, evidence and principal navigation workflows.

## Preservation hashes

- assembled TypeScript:
  `5d9be48a8bc3033cddb00107817c4bcdbad5cf59c7d008774f63d69a0e86156e`
- compiled application:
  `ba67e0e06de494f618b628f21f031e62129aa1603934c389c785137158566f31`
- deployable HTML:
  `e0db522cc5de2573cec17027dc146e8b4912a31aa95449b194ddb6acedec2326`

## Deliberately deferred QA

The 138,674-assertion Pass D property suite and three additional stress-browser
scenarios were not rerun because Pass A1 produces byte-identical runtime output.
They remain part of the certified VA7.1 baseline and will be included again in
the later comprehensive QA after substantial cumulative change.

## Verdict

No application regression was found. Pass A1 is certified.
