# Pass D1 Audit — Backup Codec

## Scope

Pass D1 introduces a sealed backup-format codec above Revision Director's canonical `BackupPayload` and below the future restore controller. It does not add D2 restore orchestration, safety-copy ceremony, or active-session policy.

## Objectives

### Versioned manifest — met

The external archive format is `revision-director-backup-archive` version 1. The first NDJSON line records payload identity, schema version, export time, application version, compression, checksum algorithm, chunk contract, declared counts, and chunk count.

### Bounded chunks — met

- 512 KiB target per chunk.
- 100 documents maximum per chunk.
- 1 MiB maximum per document.
- 2 MiB maximum per archive line.
- 50,000 maximum chunks.
- Per-entity count ceilings.

### Compression detection — met

Gzip is detected from magic bytes, not filename or MIME type. Compression metadata must match the physical file. Export uses gzip when supported and an uncompressed archive otherwise.

### Hashes and final checksum — met

Every chunk carries an integrity hash. The final completion proof binds the manifest, ordered chunk hashes, chunk count, and entity counts. SHA-256 is preferred where Web Crypto is available; a pure internal SHA-256 verifier preserves portability when it is not. FNV-1a 64-bit remains the deterministic local-runtime creation fallback.

### Count and size limits — met

Compressed input is capped at 64 MiB and expanded input at 256 MiB. Gzip expansion is read incrementally and cancelled immediately when the expanded limit is crossed.

### Inspection metadata — met

Verified inspection reports format/version, source version/time, compression, checksum algorithm, compressed and expanded sizes, chunk count, total document count, per-entity counts, and compatibility warnings.

### Relational validation — met

Integrity verification is necessary but not sufficient. Decoded entities are reconstructed into the canonical `BackupPayload` and passed through Revision Director's full relational validator before import.

## Additional correction

The backup validator now accepts the documented duration-observation reason `unreliable-interruption`. Such evidence remains excluded from duration learning but is valid historical evidence and must remain exportable.

## Preservation

No change was made to scheduling policies, evidence commitment, active-session recovery, phase timing, ownership, planning, presentation, accessibility, or Study Director bridge semantics.

## Deferred to D2

- Restore controller and preview state.
- Mandatory current-state safety copy.
- Explicit multi-step confirmation.
- Active-session restore/discard decisions.
- Controller-level one-use safety proofs.
