REVISION DIRECTOR VA7.1 — PASS E1 PUBLIC CAPABILITY + PLUGIN RUNTIME

DEPLOYMENT
Open or deploy only:
  index.html

The deployable remains self-contained:
- embedded CSS;
- compiled strict TypeScript application logic;
- exact embedded ts-fsrs@6.0.0 UMD runtime with FSRS-7 as the only memory model;
- fractional-day dual-trace FSRS-7 memory state, including `stabilityFast`;
- one-day learning and relearning steps keep long-form revision away from seconds/minutes-scale flashcard intervals while `allowModelOverride` preserves longer FSRS-7 model intervals;
- `Again` creates the app's corrective-relearning workflow; successful closed-book repair advances the original memory obligation through FSRS-7 rather than a fixed interval;
- when relearning advances a returned memory obligation, the same immutable evidence event records the exact before/after FSRS-7 transition and scheduler provenance, so no scheduler state changes invisibly;
- a known exam date adds a planner-only final-memory checkpoint in the last three days when an FSRS due date would otherwise fall after the exam; this never rewrites FSRS card state and is suppressed after a review inside that final window;
- current schemas are strict: unsupported database, backup or FSRS shapes are rejected rather than transformed;
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
