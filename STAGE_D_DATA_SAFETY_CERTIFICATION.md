# Revision Director VA7.1 — Stage D Data-Safety Certification

## Certified baseline

Certification was performed on the physically retained, checksum-verified
`Revision_Director_VA7_1_Pass_D2_Backup_Controller` package. The maintained
source was rebuilt before testing. No legacy migration or compatibility path is
present or required.

## Verdict

Stage D is closed and certified after codec, controller, destructive-restore,
active-session, forensic-recovery, responsive and accessibility testing.

Local backup remains understandable from the learner's perspective:

- export is one visible action and immediately downloads a verified `.rdbackup`;
- import begins with one file selection;
- invalid or tampered files are rejected before any destructive ceremony;
- a valid file opens a non-mutating inspection preview;
- destructive replacement then requires preservation of the current state,
  saved-copy acknowledgement, replacement acknowledgement, explicit active-
  session treatment where relevant, and final confirmation.

The extra steps occur only on restore, where data loss risk justifies them.

## Defects found and corrected during certification

### 1. Restore acknowledgement labels overflowed at 320 px

The global input width rule also applied to checkbox and radio inputs inside
flex-based restore labels. At 320×568 this created horizontal dialog scrolling.

Correction:

- restore checkbox and radio inputs now use `width:auto`;
- the complete restore ceremony remains horizontally bounded at all certified
  viewports.

### 2. Native restore-dialog focus could briefly reach the document body

Browser-native modal tabbing could pass through the document body between the
last and first focusable restore controls.

Correction:

- `NativeDialogFocusManager` now explicitly traps Tab and Shift+Tab;
- focus wraps between the first and last enabled dialog controls;
- dialog initial focus and post-close focus restoration remain unchanged.

## Codec certification

The Stage D codec provides:

- versioned manifest-first `.rdbackup` archives;
- bounded NDJSON chunks;
- gzip representation detection;
- bounded streaming decompression;
- SHA-256 integrity with an offline verifier;
- deterministic FNV-1a 64-bit creation fallback where Web Crypto is unavailable;
- per-chunk hashes and a final completion checksum;
- compressed, expanded, line, document, chunk and entity-count limits;
- verified inspection metadata;
- full relational validation before a candidate is accepted.

Raw JSON, `.rdrescue`, corrupted, tampered, unsupported and relationally invalid
files cannot enter the normal restore ceremony.

## Controller certification

The Stage D controller verifies:

- immediate self-audit of every created backup;
- defensive byte and payload ownership;
- inspection without mutation;
- cancellation and same-file reselection;
- replacement of stale candidates and proofs;
- candidate-bound, expiring, one-use safety proofs;
- changed-state rejection;
- complete transaction blocking during an Evidence commit;
- explicit restore/discard treatment for an unfinished retrieval;
- active-draft restoration through the B1 recovery system;
- active-draft inclusion in the current-state safety copy.

## Corrupted-current-state recovery

Healthy state produces an importable, self-verified `.rdbackup` safety copy.

If current relational state cannot be validated, the controller produces a
bounded, non-importable `.rdrescue` containing:

- raw IndexedDB stores;
- emergency active-retrieval state;
- bounded diagnostics;
- the validation failure.

The rescue proof is invalidated by changes to raw stores, emergency recovery or
diagnostics. A valid `committing` retrieval remains a hard stop and cannot use
the forensic route to bypass Evidence transaction integrity.

## Stage D-specific results

- 19/19 Pass D1 codec checks.
- 12/12 Pass D1 browser archive checks.
- 16/16 Pass D2 controller checks.
- 21/21 Pass D2 browser restore-controller checks.
- 21/21 Stage D closure controller checks.
- 54/54 Stage D destructive-path and usability browser checks.
- 156/156 Stage D restore-dialog responsive and accessibility checks.

The restore-dialog matrix covers 320×568, 390×844, 620×760, 820×1180,
821×900 and 1440×1000, including horizontal and vertical containment,
scrollability, visible target sizes, focus containment, Escape cancellation and
same-file reselection.

## Remaining target-device boundary

Automated testing cannot fully replace:

- genuine browser download-denial settings;
- physical storage exhaustion and eviction;
- browser-process termination during a download;
- Safari and Firefox native-dialog differences;
- physical screen-reader and touch-device use.

These are target-device certification items, not known application failures.
