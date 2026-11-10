REVISION DIRECTOR VA7.1 — PASS E1 PUBLIC CAPABILITY + PLUGIN RUNTIME

DEPLOYMENT
Open or deploy only:
  index.html

The deployable remains self-contained:
- embedded CSS;
- compiled strict TypeScript application logic;
- exact embedded ts-fsrs@6.0.0 UMD runtime, with FSRS-7 as the primary memory model;
- model-driven FSRS-7 scheduling uses fractional elapsed time and its intrinsic fast-memory trace; explicit flashcard-style learning/relearning steps remain disabled;
- an `Again` rating is intentionally handled by Revision Director's corrective-relearning policy (next-day repair) rather than exposing FSRS-7's raw seconds-scale failure interval for a long-form revision session;
- legacy FSRS-6 memory is replayed into FSRS-7 only when its complete review chain can be verified; ambiguous legacy state stays on FSRS-6 rather than being guessed;
- embedded presentation manifest and pre-paint bootstrap;
- no CDN, network-loaded asset, framework or runtime module loader.

LOCAL BACKUP EXPERIENCE
- Export remains one click in Settings and downloads a verified .rdbackup.
- Selecting an import file verifies and previews it without changing local data.
- Invalid, tampered, raw-JSON and forensic-rescue files are rejected early.
- Before replacement, Revision Director downloads a safety copy of the current state.
- The user confirms the safety file was saved, confirms replacement, chooses how to treat any unfinished retrieval, and gives final confirmation.
- If current data is damaged, a bounded non-importable .rdrescue forensic file is downloaded first so recovery is not deadlocked.

STAGE D CERTIFICATION
- manifest-first bounded backup codec;
- compressed/uncompressed representation verification;
- chunk hashes and final checksum;
- non-mutating inspection and restore preview;
- candidate-bound, expiring and one-use safety proofs;
- explicit unfinished-retrieval treatment;
- forensic preservation of damaged current state;
- compact restore-dialog and native-dialog focus hardening;
- full application regression after data-safety certification.

REPORTS
See:
  STAGE_D_DATA_SAFETY_CERTIFICATION.md
  STAGE_D_FULL_QA_REPORT.md
  STAGE_D_CLOSURE_AUDIT.md
  PASS_D1_AUDIT.md
  PASS_D2_AUDIT.md

This is a lean working milestone package. Stage C pixel-reference PNGs remain in
the separate Stage C certification ZIP and are intentionally not duplicated.


PASS E1 EXTENSIONS
- frozen window.RevisionDirector capability API;
- validated plugin registration with capability negotiation;
- isolated plugin setup and local-file failures;
- explicit trusted local .js plugin selection in Settings;
- no raw repository, scheduler, Evidence-event or DOM internals exposed.

REPORTS
  PASS_E1_AUDIT.md
  PASS_E1_TARGETED_QA.md


DEVELOPMENT TOOLCHAIN
- Node.js 26.13.0 (pinned by .nvmrc; Node 26 is enforced by package.json).
- npm 11.20.0.
- TypeScript 7.0.2, installed project-locally and locked by package-lock.json.
- Run `npm ci` once, then `npm run build`.
- The build rejects a missing or mismatched TypeScript compiler; it does not use a global `tsc`.
