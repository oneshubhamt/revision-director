# Pass A2 targeted QA

## Contract and storage tests

- 20/20 Pass A2 production-contract and storage-facade checks.
- Canonical write/read behaviour verified.
- Unsupported document versions rejected.
- Empty production backup accepted.
- Legacy backup rejected.
- Diagnostics deduplication and bounds verified.
- Storage-operation failure propagation and health reporting verified.

## Build and static integrity

- Strict TypeScript build passed.
- 26/26 source-ownership checks passed.
- 105/105 build-integrity checks passed.
- 29/29 static HTML checks passed.
- `node --check` passed for the compiled runtime.

## Protected-domain regression

- 139/139 kernel, workflow, policy and backup checks passed.
- 24/24 Pass C planning scenarios passed.
- 26/26 Pass D adaptive-planning checks passed.
- 138,674/138,674 Pass D property, persistence and hostile-validation assertions
  passed.

## Browser regression

- 7/7 principal Chromium scenarios passed, including:
  - clean empty startup and first-profile creation;
  - Knowledge Unit and Study Event creation;
  - production backup export/replacement and hostile import rejection;
  - all six retrieval workflows;
  - keyboard review controls;
  - public bridge validation;
  - chunk execution and plan history;
  - execution-state persistence.
- 3/3 de novo Chromium scenarios passed:
  - capacity reflow;
  - hostile planning import;
  - 1,000-unit import and rendering limits.

## QA boundary

This was targeted Pass A2 QA. A separate comprehensive full-application and pixel
certification remains deferred until several passes or a substantial cumulative
change, as planned.
