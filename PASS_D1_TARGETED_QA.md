# Pass D1 Targeted QA

## Codec and corruption testing

- 19/19 backup-codec checks.
- 11/11 browser archive checks.
- Compressed and uncompressed round trips.
- Raw JSON rejection.
- Unsupported archive-version rejection.
- Compression metadata mismatch rejection.
- Per-chunk tamper rejection.
- Final-checksum tamper rejection.
- Manifest-count rejection.
- Relationally invalid archive rejection.
- Oversized-document rejection.
- Bounded multi-chunk splitting.
- Pure SHA-256 fallback known-vector verification.

## Protected logic regression

- 139/139 kernel, workflow, policy and backup checks.
- 24/24 planning scenarios.
- 26/26 adaptive-planning checks.
- 138,674/138,674 property, persistence and hostile-validation assertions.
- 20/20 production-contract checks.
- 25/25 B1 runtime checks.
- 35/35 B2 runtime checks.
- 40/40 B3 ownership checks.
- 24/24 C1 presentation checks.
- 44/44 C2 UI-runtime checks.

## Browser regression

- 23/23 B1 recovery checks.
- 27/27 B2 timing checks, including export of unreliable-interruption evidence.
- 26/26 B3 multi-document checks.
- 23/23 hostile recovery and transaction rollback checks.
- 37/37 C2 accessibility checks.
- 7/7 canonical application workflows.
- 3/3 capacity-reflow, hostile-import and 1,000-unit scenarios.
- 161/161 responsive, escaping and rerender checks.

## Build and source integrity

- 32/32 source-ownership checks.
- 143/143 build-integrity checks.
- 36/36 static HTML checks.
- Strict TypeScript build passed.
