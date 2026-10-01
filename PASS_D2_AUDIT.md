# Revision Director VA7.1 — Pass D2 Audit

## Scope

Pass D2 adds a controller above the certified Pass D1 backup codec. It changes restore orchestration, not the revision domain, scheduler policies, or ordinary local export availability.

## Objective certification

### Verified creation — met

`BackupController.createVerified()` creates the archive, decodes it immediately, and compares archive checksum, state checksum, and document count before returning the download artifact. A retrieval in `committing` state blocks creation.

### Inspection without mutation — met

Selecting a file decodes, verifies, relationally validates, and freezes an in-memory candidate. No IndexedDB store, emergency snapshot, plan, scheduler state, or active retrieval is changed during inspection.

### Restore preview — met

The native restore dialog reports source version, export date, compression, checksum algorithm, archive/state checksums, compressed and expanded sizes, chunk count, total document count, entity counts, compatibility warnings, and unfinished-retrieval presence. It explicitly states that no application data has changed.

### Current-state safety copy — met

A restore cannot proceed before a safety artifact is generated and downloaded.

- Healthy current state produces a self-verified `.rdbackup` containing canonical data and any stable unfinished retrieval.
- Relationally damaged current state produces a bounded `.rdrescue` forensic envelope containing raw IndexedDB stores, the emergency snapshot, diagnostics, and the validation failure. It is marked `importable: false` and is rejected by the normal backup codec.
- A valid `committing` retrieval remains a hard stop and cannot use the forensic route to bypass transaction integrity.

### Explicit restore confirmation — met

Restoration requires:

1. saved-safety-copy acknowledgement;
2. replacement acknowledgement;
3. explicit unfinished-retrieval treatment when present;
4. enabled final restore control;
5. native final confirmation.

Safety proofs are candidate-bound, one-use, expire after 30 minutes, and become invalid if current canonical or forensic state changes.

### Active-session treatment — met

Backup schema version 2 carries zero or one canonical `ActiveRetrievalSession.v1` document. Only `active` sessions are restorable; `committing` and `completed` states are rejected. The user must explicitly restore or discard a source session. Restored drafts hydrate through the existing B1 recovery path without deleting the newly restored IndexedDB session.

## Simplicity and product preservation

- Local export remains one click in Settings.
- Import begins with one file selection.
- Invalid or tampered files are rejected before any restore ceremony.
- The additional steps appear only after a valid backup is inspected and are proportional to destructive replacement risk.
- No Revision Director workflow, evidence rule, scheduler policy, planning mechanism, presentation contract, or accessibility behaviour was supplanted.

## Verdict

All Pass D2 objectives are met. The controller is fail-closed for stale candidates, stale or reused proofs, changed current state, missing acknowledgements, ambiguous session treatment, and active Evidence commits.
