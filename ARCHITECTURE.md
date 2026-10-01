# Revision Director VA7.1 — Pass E1 architecture

## Deployment model

The maintained source consists of nineteen manifest-ordered TypeScript ownership
files, a canonical presentation manifest, a pre-paint bootstrap, CSS and a semantic
HTML shell. The build embeds the presentation contract into both the document and
the compiled runtime, assembles an ephemeral TypeScript composite, compiles it
strictly, removes the composite and produces one self-contained `index.html`.

There is no framework, CDN, runtime module loader, network-loaded asset or runtime
package manager.

## Source ownership graph

`source/app/source-manifest.json` defines nineteen ordered ownership parts covering:

1. sealed runtime and exact FSRS capture;
2. presentation manifest and kernel;
3. domain entities, validation and production contracts;
4. policy, scheduling and planning;
5. IndexedDB, storage health and diagnostics;
6. active-retrieval persistence, phase time and cross-tab ownership;
7. application services;
8. backup codec and controller;
9. public capability and plugin runtime;
10. delegated UI runtime and controller;
11. bootstrap and IIFE closure.

The deployable remains one strict outer IIFE. `window.RevisionDirector` is the only
named public application surface. It is non-enumerable, non-writable and frozen at
all exposed boundaries. The old `RevisionDirectorBridge` no longer exists.

The public API exposes only:

- application/API versions and capability versions;
- a frozen public data-contract summary;
- due and profile summaries;
- validated Study Event and revision-candidate intake;
- read-only ownership and storage-health summaries;
- plugin registration, status and explicit local-file loading.

It does not expose the repository, raw backup state, scheduler policy objects,
Evidence-event commits, ownership leases, render coordinator or DOM internals.

## Plugin runtime

`ExtensionRuntime` owns capability negotiation and plugin lifecycle state. Plugins
register with a name, optional version, minimum capability map and a setup function.
Registration is limited to two attempts and is classified as `registered`,
`inactive`, `incompatible` or `failed`. A plugin exception is caught at the setup
boundary and cannot abort application startup or rendering.

Settings supports explicit selection of up to five trusted local `.js` files, each
limited to 1 MiB. The file executes from a temporary Blob URL permitted by the CSP,
is not stored, and is unloaded by reloading the page. Syntax/runtime failures are
contained and reported in plugin status. A selected file that evaluates without
registering a plugin is shown as inactive. Secondary tabs cannot load plugin files
or use mutating public intake operations.

Local plugin code is trusted executable JavaScript and therefore runs with the page's
browser privileges. The narrow public API limits supported integration contracts;
it cannot sandbox arbitrary code selected by the user.

## Presentation foundation

`source/presentation/revision-director.presentation.json` is the canonical contract.
The build validates its identity, version and immutable default, embeds it before
CSS for pre-paint use, and injects the same JSON into the typed kernel at compile
time. Runtime startup verifies that both copies are identical.

The built-in `revision-current` profile owns eight independent axes:

```text
typography · shape · material · depth · density · responsive · motion · charts
```

The current CSS primitives remain frozen and are exposed through a versioned
`--rd-` semantic token namespace. This creates a stable future extension surface
without changing any current computed style. Unknown or malformed stored profile
IDs fall back to `revision-current`, and registry entries cannot replace the
immutable default.

## Production database

```text
name: revision-director
layout version: 2
```

Stores:

- profiles;
- nodes;
- units;
- studyEvents;
- obligations;
- evidenceEvents;
- chunks;
- dailyPlans;
- settings;
- metadata;
- activeRetrieval.

No prototype database, sample seeding or migration path is present.

## Storage and recovery boundary

`RevisionData` owns canonical production persistence, metadata verification,
bounded diagnostics, persistent-storage requests, quota estimates and atomic
multi-store operations.

`ActiveRetrievalPersistence` owns unfinished work through:

- one canonical IndexedDB record under `current`;
- one compact local emergency envelope;
- serialised writes and 350 ms ordinary-edit debounce;
- forced lifecycle snapshots;
- revision-first newest-copy arbitration;
- bidirectional reconciliation;
- completed-session tombstones and guarded commit transitions.

Only active operational state is duplicated locally. Historical study, evidence,
scheduler and plan data remain IndexedDB-only.

## Phase-aware time runtime

`PhaseTimeRuntime` is a sealed state machine embedded in the active session. It
owns:

- `attempt`, `compare`, `relearn-repair` and `relearn-verify` active totals;
- running, paused and gap-pending states;
- pause, phase-transition and gap-classification histories;
- source visibility and the first source-reveal boundary;
- the last reliable wall-clock anchor;
- backward-clock detection and rebasing;
- the fixed 120-second inactive-gap threshold.

Normal ticks add time only to the current phase while running. Paused time and
classification-prompt time are excluded. A gap greater than 120 seconds blocks
progress until classified:

- **Focus** counts the whole gap in the phase active at detection;
- **Break** excludes the whole gap and records it as pause history;
- **Split** counts only the learner-confirmed focus portion;
- **Ignore** excludes the whole gap and marks the resulting duration unreliable.

Unresolved gaps block phase transitions and completion. Ignored gaps remain in
Evidence Events but cannot train adaptive duration estimates. A backward clock is
rebased without subtracting active time and is retained as a reliability flag.

## Cross-tab ownership and lifecycle

`ReviewOwnershipCoordinator` enforces one mutation owner through a verified
local lease, a four-second heartbeat and a fifteen-second stale threshold.
Secondary documents remain browse-and-export only. Takeover is a conservative
BroadcastChannel handoff: the owner flushes active work, releases the lease and
the requester reconciles and hydrates canonical state before becoming primary.

Every mutation check revalidates the current claim. Lease or local-storage
failure is fail-closed and recorded through bounded diagnostics. Hidden state
forces recovery snapshots; focus, visible return and pageshow re-evaluate the
lease; pagehide and beforeunload release it.

Storage inspection separates passive capability checks from the explicit user
action that requests persistence. Quota levels are healthy below 75%, warning
from 75% and critical from 90%.

## Canonical boundary

Every durable entity carries its own document schema version. Storage boundaries
follow:

```text
capture → sanitise → validate → canonicalise → transact → derive → render
```

Timing canonicalisation rejects unsupported phases, impossible state combinations,
non-finite counters, invalid chronology, inconsistent gap partitions and pending
gaps that do not exceed the configured threshold.

## Commit integrity

Evidence and chunk completion remain transaction-bound. The guarded transaction
validates the active-session identity, revision, target, status and commit token,
then atomically writes evidence or chunk state, scheduler/plan updates and the
next active target. Timing summaries are part of that same committed record.

## Protected Revision Director architecture

Pass B3 retains:

- six obligation types and six retrieval workflows;
- exact `ts-fsrs@5.4.1` only for memory recall;
- separate deterministic policies for other obligation types;
- append-only Evidence Events;
- adaptive duration learning;
- profile-qualified weekly balance and interleaving;
- capacity-bounded planning and chunk synthesis;
- immutable initial plans and versioned amendments;
- validated Study Director bridge;
- current Revision Director presentation language.


## Pass C2 UI runtime

The maintained source owns UI coordination in `source/app/45-ui-runtime.ts`. Dynamic application actions are delegated through the document boundary; diagram pointer streams remain directly bound. `RenderCoordinator` batches named dirty domains in deterministic order and preserves safe focus/selection state. `AriaTabRegistry`, `NativeDialogFocusManager` and `OverlayFocusManager` own keyboard navigation and focus boundaries. The deployable artifact remains one sealed offline runtime.

## Pass D1 backup codec boundary

`BackupCodec` owns only external backup representation and verification. `RevisionService` still owns canonical payload creation and relational validation, while `RevisionData` owns transactional replacement. The codec therefore cannot bypass domain validation or mutate application state.

The archive pipeline is:

`canonical payload → bounded entity chunks → chunk hashes → manifest and completion proof → optional gzip`

The read pipeline is:

`file limits → gzip-magic detection → bounded expansion → manifest/chunk/checksum verification → entity reconstruction → relational validation`

Restore sequencing remains outside the codec and is reserved for `BackupController` in Pass D2.

## Pass D2 backup-controller boundary

`BackupController` owns destructive restore orchestration above `BackupCodec` and `RevisionService`.

The healthy restore sequence is:

`inspect without mutation → preview → create and self-verify current-state backup → download → acknowledge saved copy → choose active-session treatment → confirm replacement → reverify candidate and current-state proof → transactional replacement → canonical hydration`

A safety proof binds the inspected archive checksum and a stable SHA-256 fingerprint of the current state. It is one-use and expires after 30 minutes. Any intervening state change forces a new safety copy.

If current canonical state is relationally damaged, the controller captures a bounded forensic `.rdrescue` containing raw stores, emergency recovery and diagnostics. The rescue is explicitly non-importable. A committing retrieval is never routed through this fallback.

The codec remains mutation-free; the controller does not redefine relational validity; `RevisionData` remains the sole transactional replacement owner.

## Stage D certified restore boundary

The backup codec remains stateless and owns only archive creation, detection,
bounded decoding, integrity verification, inspection metadata and relational
handoff. `BackupController` owns candidate lifetime, current-state preservation,
safety proofs, active-session treatment and destructive replacement.

The restore UI is a native modal controlled through the shared focus manager.
Stage D closure adds explicit Tab/Shift+Tab containment and compact restore-label
sizing so the safety ceremony remains accessible down to 320 pixels.
