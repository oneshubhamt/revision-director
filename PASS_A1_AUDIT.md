# Revision Director VA7.1 — Pass A1 Objective Audit

## Pass purpose

Split the maintained TypeScript source by architectural ownership without
changing Revision Director behaviour, data semantics, appearance, deployment or
runtime encapsulation.

## Objective results

### 1. Split maintained source by responsibility — MET

The former 4,557-line maintained TypeScript monolith was replaced by an ordered
source graph:

1. `00-runtime-boundary.ts`
2. `10-domain-model.ts`
3. `11-domain-kernel.ts`
4. `20-policy-planning-kernel.ts`
5. `21-policy-implementations.ts`
6. `30-indexeddb-repository.ts`
7. `40-application-services.ts`
8. `50-ui-controller.ts`
9. `60-public-bridge-bootstrap.ts`

`source/app/source-manifest.json` is the sole ordering contract.

### 2. Preserve one sealed production runtime — MET

The build assembles the ordered sources into a temporary TypeScript composite,
compiles it with the existing strict configuration and removes the temporary
file. The application still executes inside one strict outer IIFE. No runtime
module loader, package manager, namespace or framework was introduced.

### 3. Preserve exact deployable output — MET

The rebuilt artifacts are byte-identical to the certified VA7.1 baseline:

- `dist/app.js` SHA-256:
  `ba67e0e06de494f618b628f21f031e62129aa1603934c389c785137158566f31`
- `index.html` SHA-256:
  `e0db522cc5de2573cec17027dc146e8b4912a31aa95449b194ddb6acedec2326`

This is a stronger preservation result than behavioural similarity: the actual
compiled runtime and deployable HTML did not change.

### 4. Remove test dependence on one physical source file — MET

Build-integrity QA now reconstructs the logical source from the ownership
manifest. A dedicated source-ownership suite verifies ordering, layer ownership,
IIFE preservation, ephemeral generation and baseline byte parity.

### 5. Preserve all Revision Director features and workflows — MET

Because the runtime output is byte-identical, the following remain unchanged:

- six obligation types;
- six retrieval workflows;
- scheduler-policy router and exact `ts-fsrs@5.4.1` integration;
- evidence commits and relearning flow;
- adaptive duration and weekly-balance planning;
- automatic chunking and final synthesis;
- daily-plan versions and outcomes;
- Study Director bridge;
- current visual design and interaction behaviour.

### 6. Keep the pass behaviour-neutral — MET

No domain record, IndexedDB store, public capability, CSS rule, HTML structure,
UI label, application version or database identity was changed.

## QA finding during the pass

The first source-ownership test used an over-broad string check for the word
`import` and incorrectly matched the user-facing phrase “Backup import failed.”
The test was corrected to detect only line-leading ES-module declarations. This
was a QA-harness defect, not an application defect.

## Deferred by design

Pass A1 did not implement:

- production data contracts;
- active-session recovery;
- interruption-safe timing;
- cross-tab ownership;
- presentation profiles;
- delegated events;
- backup hardening;
- plugins or AI exchange.

Those remain subsequent passes.

## Certification

Pass A1 meets all intended objectives and is suitable as the structural baseline
for Pass A2.
