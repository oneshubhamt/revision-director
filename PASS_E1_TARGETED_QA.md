# Revision Director VA7.1 — Pass E1 Targeted QA

## E1-specific

- 33/33 public capability and plugin-runtime checks.
- 25/25 browser plugin-runtime checks.
- Compatible, incompatible, inactive, failed, duplicate and attempt-capped registration.
- Immutable/non-writable public API and defensive output snapshots.
- Explicit local plugin success, no-registration, execution failure, bad extension and oversize rejection.
- Failure containment without fatal state, console/page errors or storage-health pollution.
- Secondary-tab denial for public mutation and local plugin loading.

## Preservation regression

- 139/139 kernel, workflow, policy and backup checks.
- 24/24 planning scenarios.
- 26/26 adaptive-planning checks.
- 138,674/138,674 hostile/property assertions.
- B1 25/25 runtime and 23/23 browser recovery.
- B2 35/35 runtime and 27/27 browser timing.
- B3 40/40 runtime and 28/28 browser ownership.
- C1 24/24 presentation; C2 44/44 structural and 37/37 browser accessibility.
- D1 19/19 codec and 12/12 browser archive.
- D2 16/16 controller and 21/21 browser restore.
- Stage D 21/21 controller, 54/54 destructive-path and 156/156 restore UI.
- Seven canonical Chromium workflows passed independently.
- 3/3 large-data/hostile scenarios and 161/161 supplemental UI checks.
- 394/394 responsive checks across fourteen viewport classes.
- 34/34 source-ownership, 152/152 build-integrity and 38/38 static HTML checks.

The historical combined Stage C behavioural runner exceeded the environment's single-command ceiling; its affected focus, keyboard and responsive surfaces were covered by C2 browser QA, the 394-check responsive suite and the 161-check supplemental suite.
