# Revision Director VA7.1 — Stage C Pixel, Responsive and Behavioural Certification

## Baseline

Certification was performed on the physically retained and checksum-verified
`Revision_Director_VA7_1_Pass_C2_UI_Runtime_Accessibility` package rebuilt from
the certified Pass C1 baseline.

## Verdict

Stage C is closed and certified. The `revision-current` design language remains
intact, the intentional 44-pixel and compact-safe-area changes are stable, and
no regression was found in application behaviour, recovery, ownership,
scheduling or evidence integrity.

No additional application defect was discovered during this stage-level gate.
The C2 defects already recorded in `PASS_C2_AUDIT.md` remain fixed.

## Exact-pixel certification

A permanent authoritative reference set was created for 26 deterministic
renders:

- all six panes at 1440×1000 desktop;
- all six panes at 820×900 tablet;
- all six panes at 390×844 phone;
- retrieval attempt and comparison at desktop and phone sizes;
- Knowledge Unit dialog at desktop and phone sizes;
- inactive-gap overlay at desktop and phone sizes.

After a fresh deterministic build, every image reproduced with:

- identical dimensions;
- verified reference checksum;
- zero changed pixels.

Results:

- 28/28 reference-inventory and checksum checks;
- 135/135 grouped exact-pixel assertions;
- 26/26 renders with zero pixel drift.

The reference set and permanent harness are stored under
`tests/fixtures/stage-c-reference/` and `tests/stage-c-pixel.spec.py`.

## Responsive certification

Fourteen viewport classes were tested:

- 320×568;
- 360×640;
- 375×667;
- 390×844;
- 412×915;
- 460×800;
- 560×800;
- 700×700;
- 820×900;
- 821×900;
- 1024×768;
- 1280×800;
- 1440×1000;
- 1920×1080.

All six panes were exercised at every viewport. Coverage included:

- the exact 820/821-pixel navigation breakpoint;
- compact main-region separation from fixed navigation;
- independent compact scrolling;
- horizontal-overflow detection;
- one selected ARIA tab and one visible tabpanel;
- 44-pixel visible-control targets, including the backup file picker;
- safe-area and `viewport-fit=cover` contracts;
- desktop sidebar and compact bottom-navigation modes.

Result: 394/394 responsive assertions passed.

## Behavioural certification

The dedicated behavioural gate verified:

- delegated action uniqueness after repeated renders;
- deterministic render coordination;
- dirty-search focus and selection preservation;
- complete ARIA tab keyboard navigation;
- native-dialog initial and return focus;
- reduced-motion suppression;
- inactive-gap focus containment;
- semantic return to the retrieval pause control;
- inert background restoration;
- twelve consecutive interruption-overlay cycles.

Result: 90/90 behavioural and repeated-focus assertions passed.

## Full inherited regression

### Logic, contracts and build

- 44/44 Pass C2 structural/runtime checks;
- 24/24 Pass C1 presentation-kernel checks;
- 139/139 kernel, workflow, policy and backup checks;
- 24/24 planning scenarios;
- 26/26 adaptive-planning checks;
- 138,674/138,674 property, persistence and hostile-validation assertions;
- 20/20 production-storage checks;
- 25/25 B1 runtime checks;
- 35/35 B2 timing-runtime checks;
- 40/40 B3 ownership/storage checks;
- 31/31 source-ownership checks;
- 136/136 build-integrity checks;
- 36/36 static HTML checks.

### Browser regression

- 37/37 Pass C2 accessibility/UI-runtime checks;
- 48/48 Pass C1 presentation/responsive checks;
- 23/23 B1 persistent recovery checks;
- 27/27 B2 timing checks;
- 26/26 B3 multi-document ownership checks;
- 23/23 hostile recovery and transactional rollback checks;
- 7/7 canonical Chromium workflows;
- 3/3 capacity-reflow, hostile-import and 1,000-unit scenarios;
- 161/161 supplemental responsive, escaping, accessible-name and rerender checks.

## Manual visual inspection

Desktop, tablet and phone references were inspected directly. Revision
Director retains its typography, palette, information hierarchy, tactical
character and workflow clarity. Compact content is clipped by and scrolls
within the main region above the fixed navigation rather than being obscured by
it.

## Remaining target-device certification

The automated environment does not replace testing on physical devices for:

- native screen-reader operation;
- physical touch ergonomics;
- genuine notched-device safe-area values;
- Safari and Firefox rendering differences;
- operating-system sleep, browser restart, tab eviction and storage pressure.

These are target-device items, not unresolved automated failures.
