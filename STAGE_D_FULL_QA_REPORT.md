# Revision Director VA7.1 — Stage D Full Application QA

## Verdict

The corrected Stage D build passed full application regression after the
stage-level data-safety certification. No Revision Director domain feature,
workflow, scheduler policy, evidence invariant, recovery mechanism,
ownership rule, presentation contract or planning behaviour was supplanted.

## Logic, contracts and hostile validation

- 139/139 kernel, workflow, policy and backup checks.
- 24/24 capacity-planning scenarios.
- 26/26 adaptive-planning checks.
- 138,674/138,674 property, persistence and hostile-validation assertions.
- 20/20 production-contract and storage-facade checks.
- 25/25 B1 durable-active-retrieval checks.
- 35/35 B2 phase-time runtime checks.
- 40/40 B3 ownership and storage-health checks.
- 24/24 C1 presentation-kernel checks.
- 44/44 C2 UI-runtime and accessibility checks.
- 19/19 D1 codec checks.
- 16/16 D2 controller checks.
- 21/21 Stage D closure controller checks.

## Build, source and static integrity

- strict TypeScript build passed;
- one sealed runtime IIFE retained;
- 33/33 source-ownership checks;
- 148/148 build-integrity checks;
- 38/38 static HTML checks.

## Recovery, ownership and data-safety browser QA

- 23/23 B1 persistent recovery checks.
- 27/27 B2 timing and interruption checks.
- 26/26 B3 multi-document ownership checks.
- 23/23 hostile recovery and transactional rollback checks.
- 48/48 C1 presentation/responsive checks.
- 37/37 C2 accessibility/UI-runtime checks.
- 12/12 D1 browser archive checks.
- 21/21 D2 browser restore-controller checks.
- 54/54 Stage D destructive-path and usability checks.
- 156/156 Stage D restore-dialog responsive/accessibility checks.

## Complete workflow and stress QA

All seven canonical Chromium scenarios passed in isolated fresh-browser runs:

1. clean production startup and basic operations;
2. export, restore and hostile-backup rejection;
3. all retrieval workflows;
4. keyboard accessibility;
5. validated Study Director bridge;
6. chunking, weekly balance and daily-plan history;
7. plan execution-state persistence.

Additional results:

- 3/3 capacity-reflow, hostile-import and 1,000-unit Chromium scenarios;
- 161/161 supplemental responsive, escaping, accessible-name and rerender checks;
- 394/394 Stage C responsive checks across fourteen viewport classes;
- 90/90 Stage C behavioural and repeated-focus checks.

The combined seven-workflow and Stage C behavioural runners can exceed the
execution environment's cumulative browser-process ceiling. Their constituent
assertions were therefore executed in isolated fresh browser processes. No
coverage was removed.

## Preservation verdict

No regression was found in:

- all six obligation types;
- all six retrieval workflows;
- exact FSRS memory scheduling;
- all five non-memory policy families;
- Study Events and append-only Evidence Events;
- active-session durability and duplicate-commit prevention;
- phase-aware timing and unreliable-time exclusion;
- multi-tab ownership and takeover;
- duration learning, weekly balance and interleaving;
- capacity planning, chunking and final synthesis;
- daily-plan versions and execution outcomes;
- Study Director bridge validation;
- the immutable `revision-current` presentation profile;
- compact, tablet and desktop layouts.

## Manual visual inspection

The restore ceremony was inspected at 320×568 and 1440×1000. The design remains
consistent with Revision Director's established language. Phone content scrolls
vertically inside the modal without horizontal clipping, while desktop preview,
warning, safety and confirmation sections remain clearly separated.

The screenshots used for manual inspection are not included in the lean
milestone package.

## Remaining real-device work

- native browser restart during active retrieval or restore;
- operating-system sleep and wake;
- genuine storage pressure and browser eviction;
- real download cancellation/denial;
- screen-reader testing on Windows, macOS, Android and iOS;
- Safari and Firefox native-dialog behaviour;
- physical touch ergonomics and safe-area values.
