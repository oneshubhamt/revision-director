# Architecture

## Deployment model

Revision Director builds to one self-contained `index.html`. The maintained source is split by ownership under `source/`; `source/app/source-manifest.json` is the authoritative ordering contract for the nineteen TypeScript parts.

The build:

1. validates the source-ownership and presentation contracts;
2. gives all nineteen maintained `source/app/*.ts` files directly to the pinned TypeScript 7 compiler as one project;
3. verifies that TypeScript emitted exactly the manifest-owned JavaScript files;
4. assembles those emitted files deterministically in manifest order inside one strict outer IIFE and emits `dist/app.js`;
5. embeds the runtime, CSS and presentation state into `index.html`;
6. removes ephemeral compiler output.

There is no synthetic combined TypeScript source. The maintained files share one compile-time script namespace; the build, rather than any individual source file, owns the runtime IIFE boundary. This lets TypeScript 7 parse and check the real source graph while preserving the single sealed offline runtime.

There is no runtime module loader, framework, CDN or network dependency.

## Runtime boundary

The application executes inside one strict outer IIFE. The vendored FSRS UMD global is captured privately and removed from `window`. The only supported named application surface is the frozen, capability-versioned `window.RevisionDirector` API.

Internal repositories, policy objects, Evidence Event commit machinery, ownership leases, render coordination and DOM internals are not public capabilities.

## Source ownership

The manifest separates the application into these logical layers:

- runtime boundary and FSRS contract;
- presentation kernel;
- domain model and canonical contracts;
- scheduling and planning;
- IndexedDB and storage facade;
- active-retrieval persistence;
- phase-aware timing;
- cross-tab ownership;
- application services;
- backup codec and restore controller;
- extension/public API runtime;
- UI runtime and controller;
- bootstrap.

The manifest, rather than this prose, is authoritative for exact filenames and order.

## Presentation

`source/presentation/revision-director.presentation.json` is the canonical presentation contract. The build validates it and embeds the same state for pre-paint and runtime use.

The built-in `revision-current` profile owns independent typography, shape, material, depth, density, responsive, motion and chart axes. The CSS consumes the semantic `--rd-` token vocabulary directly; there is no legacy primitive-token alias layer. Invalid stored presentation state falls back to the immutable built-in profile.

## Application services and commit integrity

`RevisionService` owns domain use cases. Durable review completion is transaction-bound: evidence, scheduler state, obligation state, plan outcomes and active-session transitions are committed together.

Evidence Events are append-only audit records. Scheduler transitions that affect memory obligations are recorded with before/after state and exact scheduler provenance.

## Active retrieval and timing

Unfinished retrieval is durable operational state rather than historical evidence. The active session records the current target, workflow draft, diagram state and a phase-aware time snapshot.

Timing distinguishes attempt, compare, relearn-repair and relearn-verify phases. Pauses and inactive gaps are not silently treated as study time. Gaps over 120 seconds require Focus, Break, Split or Ignore classification; unreliable timing remains auditable but is excluded from adaptive duration learning.

## Cross-tab ownership

Only one browser document may mutate an active review. A local lease, heartbeat and BroadcastChannel handoff coordinate ownership. Secondary documents remain read-only for mutable review operations. Takeover flushes and reconciles canonical active state before the requester becomes the owner.

Ownership/storage failures are fail-closed rather than guessed.

## Public capability and plugins

`ExtensionRuntime` owns the public capability surface and plugin lifecycle. Plugins negotiate minimum capabilities and are isolated as registered, inactive, incompatible or failed.

Settings may load explicitly selected local JavaScript plugin files. They are trusted executable code, bounded in count and size, session-only and never included in application backups. The capability API narrows supported integration; it is not a sandbox for arbitrary local code.

## Design principles

- Source ownership is explicit.
- Generated artifacts are not hand-maintained.
- Durable writes cross canonical validation boundaries.
- Memory scheduling and application planning remain separate concerns.
- Recovery state is minimal and operational.
- Public capabilities are frozen and narrow.
- Current data contracts are strict; there is no migration path.
