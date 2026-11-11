# Revision Director documentation

The documentation is organized by enduring system concern rather than implementation pass.

| Document | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Runtime boundaries, source ownership, presentation, public API, plugins and major subsystems. |
| [Data and storage](DATA_AND_STORAGE.md) | Durable entities, IndexedDB, active-session recovery, backups, restore safety and clean-slate data policy. |
| [Scheduling and planning](SCHEDULING_AND_PLANNING.md) | FSRS-7, rating semantics, relearning, non-memory policies, planner signals, duration learning and chunking. |
| [Development and QA](DEVELOPMENT_AND_QA.md) | Toolchain, build pipeline, generated artifacts, test strategy, QA baseline and remaining device-level checks. |

Repository-level operational material remains at the root: `README.md`, `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`, `AGENTS.md` and `CLAUDE.md`.

## Documentation rule

These are **current-state specifications**. Do not create a new audit/report document for each implementation pass. Update the relevant durable document, the tests and the changelog when behaviour materially changes. Detailed implementation chronology belongs in Git history.
