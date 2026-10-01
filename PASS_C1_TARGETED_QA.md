# Revision Director VA7.1 — Pass C1 targeted QA

## Build and static certification

- strict TypeScript compilation: passed;
- clean self-contained HTML build: passed;
- Node syntax validation: passed;
- 30 source-ownership checks: passed;
- 128 build-integrity checks: passed;
- 32 static HTML checks: passed;
- 24 presentation-kernel contract checks: passed.

## Presentation-specific browser certification

- 48 pre-paint, kernel, semantic-token and exact-pixel checks: passed;
- corrupt stored presentation falls back safely: passed;
- default profile and manifest deep-freezing: passed;
- immutable default replacement rejection: passed;
- public token computed-value validation: passed;
- semantic-to-primitive alias parity: passed;
- named-global leakage check: passed;
- 12 Stage B reference screenshots: zero changed pixels.

Pixel references cover Today, Review, Library, Study Log, History and Settings at
1440 × 1000 and 390 × 844.

## Protected application regression

- 139 kernel, workflow, policy and backup checks: passed;
- 24 planning scenarios: passed;
- 26 adaptive-planning checks: passed;
- 138,674 property, persistence and hostile-validation assertions: passed;
- 20 production-contract and storage-facade checks: passed;
- 25 B1 durable-active-retrieval checks: passed;
- 23 B1 browser recovery checks: passed;
- 35 B2 phase-time checks: passed;
- 27 B2 browser timing checks: passed;
- 40 B3 ownership and storage-health checks: passed;
- 26 B3 multi-document checks: passed;
- 23 hostile recovery browser checks: passed;
- seven canonical Chromium workflows: passed individually;
- three hostile and large-data Chromium scenarios: passed;
- 161 responsive, accessibility and rerender checks: passed.

## Harness hardening

The B2 browser harness now emits a focus lifecycle signal after its artificial
30-second wall-clock jump while manually paused. This deterministically renews the
15-second ownership lease before resume, matching the lifecycle contract already
used for larger simulated gaps. Application behaviour was not relaxed.

## Deferred

Optional presentation packs, presentation-selection UI, accessibility/navigation
closure and render/event infrastructure remain outside C1. Those belong to later
Stage C work. Native device and operating-system recovery certification remains as
recorded in the Stage B closure report.
