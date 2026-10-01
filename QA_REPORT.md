# Revision Director QA report

> **Stage C closure:** The presentation and UI foundation has passed separate
> exact-pixel, responsive and behavioural certification. See
> `STAGE_C_CERTIFICATION_REPORT.md`.

> **Pass B3 note:** One-owner cross-tab mutation, safe takeover/hydration, lifecycle release and storage persistence/quota reporting are implemented and targeted-QA certified. See `PASS_B3_TARGETED_QA.md`.

> **Pass B2 note:** Phase-aware active timing, pause history, source-reveal
> boundaries, backward-clock rebasing and 120-second interruption classification
> are implemented and targeted-QA certified. See `PASS_B2_TARGETED_QA.md`.

# Revision Director VA7.1 — De novo Pass D and baseline regression QA

> **Pass B1 note:** Durable active retrieval, emergency recovery and guarded
> commit continuation were added after the A2 full certification. Their objective
> audit and targeted regression results are recorded in `PASS_B1_AUDIT.md` and
> `PASS_B1_TARGETED_QA.md`.
>
> **Pass A1 note:** This document records the last comprehensive VA7.1
> application QA. Pass A1 changed only source ownership and retained byte-identical
> runtime output. Its targeted certification is in `PASS_A1_TARGETED_QA.md`.


## Verdict

Pass D is functionally complete and the VA7.1 build is the recommended stable
prototype after Pass A–D. No unresolved regression was found in the testable
Pass A–C workflows inherited from VA6.2.

## Baseline

The comparison baseline was the released
`Revision_Director_VA6_2_Pass_ABC_QA.zip`, not a mutable working directory.
Its checksums, strict compilation and complete supplied suites were rerun:

- 133 kernel/workflow/policy/backup checks;
- 24 Pass C planning scenarios;
- 77 build-integrity checks;
- 29 static HTML checks;
- 5 Chromium browser workflows.

All passed.

## Released VA7 package integrity

The released VA7 ZIP passed its own checksum manifest. A separate previously
unpacked working directory had been modified after packaging and was not used
as the QA source. VA7.1 was rebuilt from the checksum-clean ZIP.

## Defects discovered beyond the original VA7 suites

1. Daily-plan versions could miss capacity and queue-order changes.
2. Manual execution of previously deferred work could fail to preserve a proper
   amendment.
3. Weekly subject balance could merge identically named subjects across exams.
4. The weekly window was not robust around the 4 a.m. study-day boundary.
5. Untouched split cycles did not reflow when daily capacity changed.
6. New Pass D backup records had insufficient relational and range validation.
7. Some runtime helpers and variables were unused.

All were corrected and given regression coverage.

## Current VA7.1 automated verification

- Strict TypeScript compilation.
- Strict compilation with unused locals/parameters enabled.
- 139 kernel, workflow, scheduling-policy and hostile-backup checks.
- 24 Pass C planner scenarios.
- 26 original Pass D adaptive-planning checks.
- 138,674 de novo property, persistence and hostile-validation checks.
- 91 architecture and monolithic-build checks.
- 29 static HTML checks.
- 7 principal Chromium end-to-end scenarios.
- 3 additional Chromium scenarios:
  - 60→30→120 minute capacity reflow and persisted versions;
  - impossible-date planning backup rejection;
  - import/render/mobile-overflow test with 1,000 Knowledge Units.
- Exact embedded `ts-fsrs@5.4.1` checksum verification.
- No network-loaded scripts or assets.
- No dynamic-code execution through `eval`, `new Function` or `document.write`.
- One intentional frozen public bridge; internal classes and repositories remain
  sealed inside the outer IIFE.

## Browser coverage performed

The actual interface was exercised for:

- all six retrieval workflows;
- source reveal and comparison;
- evidence commit and relearning creation;
- daily queue creation and capacity changes;
- split-chunk completion and final synthesis protection;
- plan version and execution-state persistence through backup export;
- hostile backup rejection;
- reset and restore;
- desktop and 390-pixel mobile overflow;
- 1,000-unit library and planner rendering.

## Remaining production QA

The execution environment blocks navigation to local HTTP and file test origins,
so Chromium tests use a deterministic IndexedDB-compatible browser layer.
Consequently, these still require target-device testing:

- native IndexedDB persistence across reload, browser restart and storage
  pressure;
- Chrome, Safari and Firefox matrix;
- Android, iPhone and iPad touch behaviour;
- screen-reader semantics, focus order and full contrast audit;
- long-running sessions, device sleep/wake and interruption classification;
- substantially larger multi-year histories;
- Study Director bridge integration once implemented.


## Stage B full closure

See `STAGE_B_FULL_QA_REPORT.md`. Full regression and hostile recovery passed after correcting passive persistence startup, takeover-race acquisition and heartbeat verification.

## Stage D closure

Stage D data-safety certification and subsequent full application QA are
recorded in `STAGE_D_DATA_SAFETY_CERTIFICATION.md` and
`STAGE_D_FULL_QA_REPORT.md`. Two certification defects were corrected: compact
restore-label overflow and native-dialog focus wrap. All affected and inherited
suites pass on the corrected build.
