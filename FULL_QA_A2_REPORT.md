# Revision Director VA7.1 Pass A2 — full QA certification

## Certification scope

This certification was performed before Stage B. It covered the complete Pass A2
package rather than only the storage-facade changes:

- source ownership and reproducible build;
- strict compiled runtime and offline packaging;
- production document contracts and storage facade;
- scheduler, retrieval-workflow and planning kernels;
- persistence and hostile-input properties;
- all principal browser workflows;
- capacity reflow, hostile planning restore and 1,000-unit behaviour;
- responsive rendering across desktop, tablet and compact widths;
- keyboard operation, accessible names and modal dismissal;
- long rerender/navigation stability;
- stored-content escaping;
- release identity and mobile navigation layout.

No Stage B functionality was introduced.

## Defect found and corrected

### Mobile sidebar actions overlaid application content

The desktop `.sidebar-actions` display declaration occurred after the compact
`@media (max-width: 820px)` hide rule. The later declaration won the cascade,
causing **Add Knowledge Unit** and **Log Study Event** to appear above the fixed
mobile navigation and obscure Today content.

Correction:

- moved the desktop `display:grid` declaration into the earlier base rule;
- allowed the existing compact hide rule to remain authoritative;
- added responsive regression coverage at 320, 360, 390, 460, 560, 700, 820,
  1024, 1440 and 1920 pixel widths;
- verified all six panes at every width;
- verified that desktop sidebar actions remain visible and compact sidebar
  actions remain hidden after repeated rerendering.

### Stale release identity

The runtime version and database metadata were already Pass A2, but the document
title and source headers still referred to “Pass D QA.” They now consistently
identify **VA7.1 Pass A2**. No data contract or application behaviour changed.

## Automated results

### Source, build and static integrity

- 26/26 source-ownership checks passed.
- 105/105 build-integrity checks passed.
- 29/29 static HTML checks passed.
- Strict TypeScript compilation passed.
- `node --check` passed for the compiled runtime.
- The generated composite remained ephemeral.
- The deployable remained one self-contained HTML file with no network runtime
  dependency.

### Production contracts and domain regression

- 20/20 Pass A2 production-contract and storage-facade checks passed.
- 139/139 kernel, workflow, policy and backup checks passed.
- 24/24 Pass C planning scenarios passed.
- 26/26 Pass D adaptive-planning checks passed.
- 138,674/138,674 property, persistence and hostile-validation assertions passed.

### Canonical Chromium workflows

All seven principal scenarios passed independently:

1. empty production startup, first profile, Knowledge Unit and Study Event;
2. production backup export, replacement restore and hostile import rejection;
3. all six retrieval workflows and relearning follow-up;
4. keyboard review operation and control labelling;
5. public Study Director bridge validation;
6. adaptive planning, chunk execution and plan history;
7. planned/started execution-state persistence.

### Stress scenarios

All three de novo stress scenarios passed:

1. capacity reflow and preservation of started chunk cycles;
2. hostile planning-import rejection;
3. 1,000-unit import, bounded Today rendering and compact-width behaviour.

### Supplemental full-QA browser coverage

- 161/161 supplemental checks passed.
- Ten viewport classes were tested from 320×568 through 1920×1080.
- Every primary pane was checked at every viewport.
- No horizontal document overflow was found.
- The mobile sidebar action regression remained fixed after repeated rendering.
- Thirty complete navigation cycles did not produce duplicate action execution.
- Stored HTML-like content remained inert and visibly escaped.
- Escape closed native dialogs.
- Every visible button retained an accessible name.
- No browser console warning, console error or page error occurred.

## Manual visual inspection

Desktop and compact Today surfaces were inspected after the correction.

Confirmed:

- Revision Director’s existing design language and hierarchy remain intact;
- desktop sidebar actions remain in their original location;
- compact navigation remains fixed at the bottom;
- compact sidebar actions no longer cover planning text or queue content;
- queue cards, metrics, labels and deferred work remain readable at narrow widths;
- the correction introduces no desktop visual change.

This is an A2 visual and responsive certification. A separate pixel-parity suite
will still be appropriate when the presentation engine is introduced in Stage C.

## Native-browser persistence boundary

The execution environment blocks Chromium navigation to `file:`, localhost and
routed test origins. Therefore it cannot provide a normal-origin automated test
of the browser’s native IndexedDB across a full browser restart.

Persistence was instead covered by:

- the repository and storage-facade suites;
- deterministic IndexedDB-compatible browser scenarios;
- atomic-operation and hostile-state property tests;
- backup round-trip and replacement tests;
- 138,674 persistence/validation assertions.

This is a QA-environment limitation, not a detected application failure. Native
active-session restart and recovery will receive dedicated real-device testing in
Stage B, where those mechanisms are introduced.

## Known deferred work — not A2 defects

The following remain intentionally deferred according to the approved programme:

- durable active retrieval and emergency recovery;
- phase-aware active-time and inactive-gap classification;
- cross-tab ownership and lifecycle closure;
- presentation profiles and accessibility runtime expansion;
- integrity-chunked backup codec/controller;
- capability-based plugins, Study Director bridge expansion and AI packets.

## Certification verdict

**Pass A2 is certified as the production-foundation baseline for Stage B.**

The only full-QA defect found was corrected and protected by a permanent browser
regression test. No Revision Director domain feature, workflow, policy, planning
behaviour, visual identity or integration contract regressed.
