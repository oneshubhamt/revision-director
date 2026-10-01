# Revision Director VA7.1 — Pass E1 Audit

## Scope

Pass E1 replaces the narrow Study Director bridge with a capability-versioned public
API and adds an optional plugin runtime without changing the revision domain, durable
data model, scheduling policies, backup format or core UI workflows.

## Objective audit

### Frozen capability API — met

`window.RevisionDirector` is non-enumerable, non-configurable, non-writable and
frozen at each exposed object boundary. The legacy `RevisionDirectorBridge` is absent.

### Plugin registration — met

Plugins declare a name, version, requirements and setup function. Capability versions
are checked before setup. Duplicate registered plugins are idempotent; incompatible
plugins do not retry; failed or inactive plugins are bounded to two attempts.

### Failure isolation — met

Setup exceptions and local script failures are caught and represented in plugin
status. They do not enter application storage diagnostics, alter storage-health state,
produce fatal startup state or prevent ordinary navigation and workflows.

### Optional local files — met

Settings accepts explicit trusted `.js` selection only. A selection is limited to five
files and 1 MiB per file. Files run from temporary Blob URLs, are not persisted, and
are removed by page reload. Invalid extension, empty, oversized, syntax/runtime-failed
and non-registering files receive separate status.

### Minimum canonical operations — met

The API exposes only version/capability metadata, a frozen contract summary, profile
and due summaries, validated Study Event and revision-candidate intake, read-only
ownership/storage summaries, and plugin lifecycle operations. Repository, scheduler,
Evidence commit, backup restore, ownership lease, rendering and DOM internals remain
private.

### Revision Director preservation — met

All six workflows and obligation types, Stage B recovery/timing/ownership, Stage C
presentation/accessibility, Stage D backup safety, planning, chunking and Evidence
atomicity remain unchanged.

## Verdict

All Pass E1 objectives are met. The capability surface is suitable as the foundation
for the Study Director bridge and later optional AI exchange without making core
application internals public.
