  type BackupArchiveCompression = "none" | "gzip";
  type BackupArchiveHashAlgorithm = "sha256";
  type BackupArchiveEntityType = "profiles" | "nodes" | "units" | "studyEvents" | "obligations" | "evidenceEvents" | "chunks" | "dailyPlans" | "settings" | "activeRetrieval";

  interface BackupArchiveCounts {
    profiles: number;
    nodes: number;
    units: number;
    studyEvents: number;
    obligations: number;
    evidenceEvents: number;
    chunks: number;
    dailyPlans: number;
    settings: number;
    activeRetrieval: number;
  }

  interface BackupArchiveManifest {
    kind: "manifest";
    format: "revision-director-backup-archive";
    version: 2;
    exportedAt: ISODateTime;
    appVersion: string;
    payloadFormat: typeof BACKUP_FORMAT;
    payloadSchemaVersion: typeof BACKUP_SCHEMA_VERSION;
    compression: BackupArchiveCompression;
    hashAlgorithm: BackupArchiveHashAlgorithm;
    chunkTargetBytes: number;
    chunkMaxItems: number;
    chunkCount: number;
    counts: BackupArchiveCounts;
    stateChecksum: string;
  }

  interface BackupArchiveChunk {
    kind: "chunk";
    sequence: number;
    entityType: BackupArchiveEntityType;
    count: number;
    items: unknown[];
    checksum: string;
  }

  interface BackupArchiveCompletion {
    kind: "complete";
    chunkCount: number;
    counts: BackupArchiveCounts;
    chunkHashes: string[];
    checksum: string;
  }

  interface BackupInspectionMetadata {
    verified: true;
    format: BackupArchiveManifest["format"];
    version: 2;
    exportedAt: ISODateTime;
    appVersion: string;
    payloadFormat: typeof BACKUP_FORMAT;
    payloadSchemaVersion: typeof BACKUP_SCHEMA_VERSION;
    compression: BackupArchiveCompression;
    hashAlgorithm: BackupArchiveHashAlgorithm;
    compressedBytes: number;
    expandedBytes: number;
    chunkCount: number;
    totalDocuments: number;
    counts: BackupArchiveCounts;
    warnings: string[];
    archiveChecksum: string;
    stateChecksum: string;
    activeRetrievalStatus: ActiveRetrievalStatus | "none";
  }

  interface BackupArchiveArtifact {
    bytes: Uint8Array;
    inspection: BackupInspectionMetadata;
  }

  interface DecodedBackupArchive {
    payload: BackupPayload;
    inspection: BackupInspectionMetadata;
  }

  const BACKUP_ARCHIVE_FORMAT = "revision-director-backup-archive" as const;
  const BACKUP_ARCHIVE_VERSION = 2 as const;
  const BACKUP_ARCHIVE_MIME = "application/x-revision-director-backup";
  const BACKUP_ARCHIVE_MAX_FILE_BYTES = 64 * 1024 * 1024;
  const BACKUP_ARCHIVE_MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
  const BACKUP_ARCHIVE_MAX_LINE_BYTES = 2 * 1024 * 1024;
  const BACKUP_ARCHIVE_MAX_DOCUMENT_BYTES = 1024 * 1024;
  const BACKUP_ARCHIVE_CHUNK_TARGET_BYTES = 512 * 1024;
  const BACKUP_ARCHIVE_CHUNK_MAX_ITEMS = 100;
  const BACKUP_ARCHIVE_MAX_CHUNKS = 50_000;
  const BACKUP_ARCHIVE_COUNT_LIMITS: Readonly<BackupArchiveCounts> = Object.freeze({
    profiles: 2_000,
    nodes: 250_000,
    units: 125_000,
    studyEvents: 1_000_000,
    obligations: 250_000,
    evidenceEvents: 2_000_000,
    chunks: 1_000_000,
    dailyPlans: 100_000,
    settings: 1,
    activeRetrieval: 1,
  });
  const BACKUP_ENTITY_ORDER: readonly BackupArchiveEntityType[] = Object.freeze([
    "profiles", "nodes", "units", "studyEvents", "obligations", "evidenceEvents", "chunks", "dailyPlans", "settings", "activeRetrieval",
  ]);

  class BackupCodec {
    private static encode(value: string): Uint8Array {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
      const bytes: number[] = [];
      for (const symbol of value) {
        const point = symbol.codePointAt(0)!;
        if (point <= 0x7f) bytes.push(point);
        else if (point <= 0x7ff) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
        else if (point <= 0xffff) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
        else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      }
      return new Uint8Array(bytes);
    }

    static async create(payload: BackupPayload, preferCompression = true): Promise<BackupArchiveArtifact> {
      const collections = this.payloadCollections(payload);
      const counts = this.countCollections(collections);
      this.assertCountsWithinLimits(counts);
      const hashAlgorithm: BackupArchiveHashAlgorithm = "sha256";
      const compression: BackupArchiveCompression = preferCompression && typeof CompressionStream !== "undefined" ? "gzip" : "none";
      const chunkBodies: Omit<BackupArchiveChunk, "checksum">[] = [];
      for (const entityType of BACKUP_ENTITY_ORDER) {
        const items = collections[entityType];
        let group: unknown[] = [];
        let groupBytes = 0;
        const flush = (): void => {
          if (!group.length) return;
          chunkBodies.push({ kind: "chunk", sequence: chunkBodies.length, entityType, count: group.length, items: group });
          group = [];
          groupBytes = 0;
        };
        for (const item of items) {
          const itemBytes = this.encode(JSON.stringify(item)).byteLength;
          assert(itemBytes <= BACKUP_ARCHIVE_MAX_DOCUMENT_BYTES, `${entityType} contains a document larger than the backup limit.`);
          if (group.length && (group.length >= BACKUP_ARCHIVE_CHUNK_MAX_ITEMS || groupBytes + itemBytes > BACKUP_ARCHIVE_CHUNK_TARGET_BYTES)) flush();
          group.push(item);
          groupBytes += itemBytes;
        }
        flush();
      }
      assert(chunkBodies.length <= BACKUP_ARCHIVE_MAX_CHUNKS, "Backup contains too many chunks.");
      const chunks: BackupArchiveChunk[] = [];
      const chunkHashes: string[] = [];
      for (const body of chunkBodies) {
        const checksum = await this.hashJson(body, hashAlgorithm);
        chunks.push({ ...body, checksum });
        chunkHashes.push(checksum);
      }
      const stateChecksum = await this.stateFingerprint(payload, hashAlgorithm);
      const manifest: BackupArchiveManifest = {
        kind: "manifest",
        format: BACKUP_ARCHIVE_FORMAT,
        version: BACKUP_ARCHIVE_VERSION,
        exportedAt: payload.exportedAt,
        appVersion: payload.appVersion,
        payloadFormat: BACKUP_FORMAT,
        payloadSchemaVersion: BACKUP_SCHEMA_VERSION,
        compression,
        hashAlgorithm,
        chunkTargetBytes: BACKUP_ARCHIVE_CHUNK_TARGET_BYTES,
        chunkMaxItems: BACKUP_ARCHIVE_CHUNK_MAX_ITEMS,
        chunkCount: chunks.length,
        counts,
        stateChecksum,
      };
      const completionBody = { kind: "complete" as const, chunkCount: chunks.length, counts, chunkHashes };
      const completion: BackupArchiveCompletion = { ...completionBody, checksum: await this.hashJson({ manifest, ...completionBody }, hashAlgorithm) };
      const lines = [manifest, ...chunks, completion].map((line) => JSON.stringify(line));
      for (const line of lines) assert(this.encode(line).byteLength <= BACKUP_ARCHIVE_MAX_LINE_BYTES, "Backup contains an oversized archive line.");
      const expanded = this.encode(`${lines.join("\n")}\n`);
      assert(expanded.byteLength <= BACKUP_ARCHIVE_MAX_EXPANDED_BYTES, "Backup exceeds the expanded-size limit.");
      const bytes = compression === "gzip" ? await this.compress(expanded) : expanded;
      assert(bytes.byteLength <= BACKUP_ARCHIVE_MAX_FILE_BYTES, "Backup exceeds the file-size limit.");
      const inspection = this.inspection(manifest, completion.checksum, payload.activeRetrieval?.status ?? "none", bytes.byteLength, expanded.byteLength, []);
      return { bytes, inspection };
    }

    static async decode(bytes: Uint8Array, validate: (input: unknown) => BackupPayload): Promise<DecodedBackupArchive> {
      assert(bytes.byteLength > 0, "Backup file is empty.");
      assert(bytes.byteLength <= BACKUP_ARCHIVE_MAX_FILE_BYTES, "Backup exceeds the file-size limit.");
      const detectedCompression: BackupArchiveCompression = bytes[0] === 0x1f && bytes[1] === 0x8b ? "gzip" : "none";
      const expanded = detectedCompression === "gzip" ? await this.decompressBounded(bytes) : bytes;
      assert(expanded.byteLength <= BACKUP_ARCHIVE_MAX_EXPANDED_BYTES, "Backup exceeds the expanded-size limit.");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(expanded); }
      catch { throw new Error("Backup is not valid UTF-8."); }
      const rawLines = text.split("\n");
      if (rawLines.at(-1) === "") rawLines.pop();
      assert(rawLines.length >= 2, "Backup archive is incomplete.");
      const parsed: unknown[] = [];
      for (const raw of rawLines) {
        assert(this.encode(raw).byteLength <= BACKUP_ARCHIVE_MAX_LINE_BYTES, "Backup contains an oversized archive line.");
        try { parsed.push(JSON.parse(raw)); }
        catch { throw new Error("Backup contains invalid JSON lines."); }
      }
      const manifest = this.parseManifest(parsed[0]);
      assert(manifest.compression === detectedCompression, "Backup compression metadata does not match the file.");
      assert(manifest.chunkCount <= BACKUP_ARCHIVE_MAX_CHUNKS, "Backup contains too many chunks.");
      this.assertCountsWithinLimits(manifest.counts);
      assert(parsed.length === manifest.chunkCount + 2, "Backup chunk count does not match its manifest.");
      const completion = this.parseCompletion(parsed.at(-1));
      const collections = this.emptyCollections();
      const actualCounts = this.zeroCounts();
      const chunkHashes: string[] = [];
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        const chunk = this.parseChunk(parsed[index + 1]);
        assert(chunk.sequence === index, "Backup chunks are out of order.");
        assert(chunk.count === chunk.items.length, "Backup chunk item count is inconsistent.");
        assert(chunk.count > 0 && chunk.count <= BACKUP_ARCHIVE_CHUNK_MAX_ITEMS, "Backup chunk size is invalid.");
        const body = { kind: chunk.kind, sequence: chunk.sequence, entityType: chunk.entityType, count: chunk.count, items: chunk.items };
        const expected = await this.hashJson(body, manifest.hashAlgorithm);
        assert(chunk.checksum === expected, `Backup chunk ${index} failed integrity verification.`);
        for (const item of chunk.items) {
          assert(this.encode(JSON.stringify(item)).byteLength <= BACKUP_ARCHIVE_MAX_DOCUMENT_BYTES, `${chunk.entityType} contains a document larger than the backup limit.`);
          collections[chunk.entityType].push(item);
        }
        actualCounts[chunk.entityType] += chunk.count;
        assert(actualCounts[chunk.entityType] <= BACKUP_ARCHIVE_COUNT_LIMITS[chunk.entityType], `${chunk.entityType} exceeds its record-count limit.`);
        chunkHashes.push(chunk.checksum);
      }
      assert(this.sameCounts(actualCounts, manifest.counts), "Backup entity counts do not match its manifest.");
      assert(completion.chunkCount === manifest.chunkCount && this.sameCounts(completion.counts, manifest.counts), "Backup completion counts are inconsistent.");
      assert(completion.chunkHashes.length === chunkHashes.length && completion.chunkHashes.every((value, index) => value === chunkHashes[index]), "Backup completion proof does not match its chunks.");
      const completionBody = { kind: "complete" as const, chunkCount: completion.chunkCount, counts: completion.counts, chunkHashes: completion.chunkHashes };
      const expectedCompletion = await this.hashJson({ manifest, ...completionBody }, manifest.hashAlgorithm);
      assert(completion.checksum === expectedCompletion, "Backup final checksum failed verification.");
      assert(collections.settings.length === 1, "Backup must contain exactly one settings document.");
      const candidate: BackupPayload = {
        format: manifest.payloadFormat,
        schemaVersion: manifest.payloadSchemaVersion,
        exportedAt: manifest.exportedAt,
        appVersion: manifest.appVersion,
        profiles: collections.profiles as ExamProfile[],
        nodes: collections.nodes as KnowledgeNode[],
        units: collections.units as KnowledgeUnit[],
        studyEvents: collections.studyEvents as StudyEvent[],
        obligations: collections.obligations as RevisionObligation[],
        evidenceEvents: collections.evidenceEvents as EvidenceEvent[],
        chunks: collections.chunks as ObligationChunk[],
        dailyPlans: collections.dailyPlans as DailyPlanRecord[],
        settings: collections.settings[0] as AppSettings,
        activeRetrieval: (collections.activeRetrieval[0] as ActiveRetrievalSession | undefined) ?? null,
      };
      const payload = validate(candidate);
      const warnings: string[] = [];
      const stateChecksum = await this.stateFingerprint(payload, manifest.hashAlgorithm);
      assert(stateChecksum === manifest.stateChecksum, "Backup state checksum failed verification.");
      return { payload, inspection: this.inspection(manifest, completion.checksum, payload.activeRetrieval?.status ?? "none", bytes.byteLength, expanded.byteLength, warnings) };
    }

    private static payloadCollections(payload: BackupPayload): Record<BackupArchiveEntityType, unknown[]> {
      return {
        profiles: payload.profiles,
        nodes: payload.nodes,
        units: payload.units,
        studyEvents: payload.studyEvents,
        obligations: payload.obligations,
        evidenceEvents: payload.evidenceEvents,
        chunks: payload.chunks,
        dailyPlans: payload.dailyPlans,
        settings: [payload.settings],
        activeRetrieval: payload.activeRetrieval ? [payload.activeRetrieval] : [],
      };
    }

    private static emptyCollections(): Record<BackupArchiveEntityType, unknown[]> {
      return { profiles: [], nodes: [], units: [], studyEvents: [], obligations: [], evidenceEvents: [], chunks: [], dailyPlans: [], settings: [], activeRetrieval: [] };
    }

    private static zeroCounts(): BackupArchiveCounts {
      return { profiles: 0, nodes: 0, units: 0, studyEvents: 0, obligations: 0, evidenceEvents: 0, chunks: 0, dailyPlans: 0, settings: 0, activeRetrieval: 0 };
    }

    private static countCollections(collections: Record<BackupArchiveEntityType, unknown[]>): BackupArchiveCounts {
      const counts = this.zeroCounts();
      for (const key of BACKUP_ENTITY_ORDER) counts[key] = collections[key].length;
      return counts;
    }

    private static assertCountsWithinLimits(counts: BackupArchiveCounts): void {
      for (const key of BACKUP_ENTITY_ORDER) {
        assert(Number.isInteger(counts[key]) && counts[key] >= 0 && counts[key] <= BACKUP_ARCHIVE_COUNT_LIMITS[key], `${key} exceeds its record-count limit.`);
      }
      assert(counts.settings === 1, "Backup must contain exactly one settings document.");
      assert(counts.activeRetrieval === 0 || counts.activeRetrieval === 1, "Backup may contain at most one active retrieval session.");
    }

    private static sameCounts(left: BackupArchiveCounts, right: BackupArchiveCounts): boolean {
      return BACKUP_ENTITY_ORDER.every((key) => left[key] === right[key]);
    }

    private static parseManifest(input: unknown): BackupArchiveManifest {
      assert(typeof input === "object" && input !== null, "Backup manifest is missing.");
      const value = input as Partial<BackupArchiveManifest>;
      assert(value.kind === "manifest" && value.format === BACKUP_ARCHIVE_FORMAT && value.version === BACKUP_ARCHIVE_VERSION, "This is not a supported Revision Director backup archive.");
      assert(value.appVersion === APP_VERSION, "This backup archive was not created by the current Revision Director build.");
      assert(value.payloadFormat === BACKUP_FORMAT && value.payloadSchemaVersion === BACKUP_SCHEMA_VERSION, "Backup payload version is unsupported.");
      assert(value.compression === "none" || value.compression === "gzip", "Backup compression metadata is invalid.");
      assert(value.hashAlgorithm === "sha256", "Backup hash algorithm is unsupported.");
      assert(value.chunkTargetBytes === BACKUP_ARCHIVE_CHUNK_TARGET_BYTES && value.chunkMaxItems === BACKUP_ARCHIVE_CHUNK_MAX_ITEMS, "Backup chunk contract is unsupported.");
      assert(Number.isInteger(value.chunkCount) && (value.chunkCount ?? -1) >= 0, "Backup manifest chunk count is invalid.");
      assert(typeof value.counts === "object" && value.counts !== null, "Backup manifest counts are missing.");
      assert(typeof value.stateChecksum === "string" && /^[0-9a-f]{16,64}$/.test(value.stateChecksum), "Backup state checksum is invalid.");
      return {
        kind: "manifest", format: BACKUP_ARCHIVE_FORMAT, version: BACKUP_ARCHIVE_VERSION,
        exportedAt: canonicalIso(value.exportedAt as ISODateTime, "Backup export date"),
        appVersion: canonicalId(value.appVersion as string, "Backup application version"),
        payloadFormat: BACKUP_FORMAT, payloadSchemaVersion: BACKUP_SCHEMA_VERSION,
        compression: value.compression, hashAlgorithm: value.hashAlgorithm,
        chunkTargetBytes: BACKUP_ARCHIVE_CHUNK_TARGET_BYTES, chunkMaxItems: BACKUP_ARCHIVE_CHUNK_MAX_ITEMS,
        chunkCount: value.chunkCount!, counts: this.parseCounts(value.counts), stateChecksum: value.stateChecksum,
      };
    }

    private static parseCounts(input: unknown): BackupArchiveCounts {
      assert(typeof input === "object" && input !== null, "Backup counts are invalid.");
      const value = input as Partial<BackupArchiveCounts>;
      const counts = this.zeroCounts();
      for (const key of BACKUP_ENTITY_ORDER) {
        const count = value[key];
        assert(Number.isInteger(count) && (count ?? -1) >= 0, `Backup ${key} count is invalid.`);
        counts[key] = count!;
      }
      return counts;
    }

    private static parseChunk(input: unknown): BackupArchiveChunk {
      assert(typeof input === "object" && input !== null, "Backup chunk is invalid.");
      const value = input as Partial<BackupArchiveChunk>;
      assert(value.kind === "chunk" && Number.isInteger(value.sequence) && (value.sequence ?? -1) >= 0, "Backup chunk sequence is invalid.");
      assert(typeof value.entityType === "string" && BACKUP_ENTITY_ORDER.includes(value.entityType as BackupArchiveEntityType), "Backup chunk entity type is invalid.");
      assert(Number.isInteger(value.count) && Array.isArray(value.items), "Backup chunk contents are invalid.");
      assert(typeof value.checksum === "string" && /^[0-9a-f]{16,64}$/.test(value.checksum), "Backup chunk checksum is invalid.");
      return { kind: "chunk", sequence: value.sequence!, entityType: value.entityType as BackupArchiveEntityType, count: value.count!, items: value.items, checksum: value.checksum };
    }

    private static parseCompletion(input: unknown): BackupArchiveCompletion {
      assert(typeof input === "object" && input !== null, "Backup completion proof is missing.");
      const value = input as Partial<BackupArchiveCompletion>;
      assert(value.kind === "complete" && Number.isInteger(value.chunkCount) && (value.chunkCount ?? -1) >= 0, "Backup completion proof is invalid.");
      assert(Array.isArray(value.chunkHashes) && value.chunkHashes.every((hash) => typeof hash === "string" && /^[0-9a-f]{16,64}$/.test(hash)), "Backup completion hashes are invalid.");
      assert(typeof value.checksum === "string" && /^[0-9a-f]{16,64}$/.test(value.checksum), "Backup final checksum is invalid.");
      return { kind: "complete", chunkCount: value.chunkCount!, counts: this.parseCounts(value.counts), chunkHashes: value.chunkHashes, checksum: value.checksum };
    }

    private static inspection(manifest: BackupArchiveManifest, archiveChecksum: string, activeRetrievalStatus: ActiveRetrievalStatus | "none", compressedBytes: number, expandedBytes: number, warnings: string[]): BackupInspectionMetadata {
      return {
        verified: true, format: manifest.format, version: manifest.version, exportedAt: manifest.exportedAt, appVersion: manifest.appVersion,
        payloadFormat: manifest.payloadFormat, payloadSchemaVersion: manifest.payloadSchemaVersion,
        compression: manifest.compression, hashAlgorithm: manifest.hashAlgorithm,
        compressedBytes, expandedBytes, chunkCount: manifest.chunkCount,
        totalDocuments: BACKUP_ENTITY_ORDER.reduce((sum, key) => sum + manifest.counts[key], 0),
        counts: clone(manifest.counts), warnings: [...warnings], archiveChecksum, stateChecksum: manifest.stateChecksum, activeRetrievalStatus,
      };
    }

    static async stateFingerprint(payload: BackupPayload, algorithm: BackupArchiveHashAlgorithm = "sha256"): Promise<string> {
      const stable = {
        format: payload.format,
        schemaVersion: payload.schemaVersion,
        profiles: payload.profiles,
        nodes: payload.nodes,
        units: payload.units,
        studyEvents: payload.studyEvents,
        obligations: payload.obligations,
        evidenceEvents: payload.evidenceEvents,
        chunks: payload.chunks,
        dailyPlans: payload.dailyPlans,
        settings: payload.settings,
        activeRetrieval: payload.activeRetrieval,
      };
      return this.hashJson(stable, algorithm);
    }

    static async opaqueFingerprint(value: unknown): Promise<string> {
      return this.hashJson(value, "sha256");
    }

    private static async hashJson(value: unknown, algorithm: BackupArchiveHashAlgorithm): Promise<string> {
      return this.hashBytes(this.encode(JSON.stringify(value)), algorithm);
    }

    private static async hashBytes(bytes: Uint8Array, _algorithm: BackupArchiveHashAlgorithm): Promise<string> {
      if (globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes));
        return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
      }
      return this.sha256Fallback(bytes);
    }


    private static sha256Fallback(input: Uint8Array): string {
      const constants = new Uint32Array([
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
      ]);
      const bitLength = BigInt(input.byteLength) * 8n;
      const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
      const bytes = new Uint8Array(paddedLength);
      bytes.set(input);
      bytes[input.byteLength] = 0x80;
      for (let index = 0; index < 8; index += 1) bytes[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
      const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
      const words = new Uint32Array(64);
      const rotate = (value: number, amount: number): number => (value >>> amount) | (value << (32 - amount));
      for (let offset = 0; offset < bytes.length; offset += 64) {
        for (let index = 0; index < 16; index += 1) {
          const base = offset + index * 4;
          words[index] = ((bytes[base]! << 24) | (bytes[base + 1]! << 16) | (bytes[base + 2]! << 8) | bytes[base + 3]!) >>> 0;
        }
        for (let index = 16; index < 64; index += 1) {
          const x = words[index - 15]!, y = words[index - 2]!;
          const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
          const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
          words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
        }
        let a=state[0]!, b=state[1]!, c=state[2]!, d=state[3]!, e=state[4]!, f=state[5]!, g=state[6]!, h=state[7]!;
        for (let index = 0; index < 64; index += 1) {
          const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
          const choice = (e & f) ^ (~e & g);
          const temp1 = (h + sum1 + choice + constants[index]! + words[index]!) >>> 0;
          const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
          const majority = (a & b) ^ (a & c) ^ (b & c);
          const temp2 = (sum0 + majority) >>> 0;
          h=g; g=f; f=e; e=(d + temp1) >>> 0; d=c; c=b; b=a; a=(temp1 + temp2) >>> 0;
        }
        state[0]=(state[0]!+a)>>>0; state[1]=(state[1]!+b)>>>0; state[2]=(state[2]!+c)>>>0; state[3]=(state[3]!+d)>>>0;
        state[4]=(state[4]!+e)>>>0; state[5]=(state[5]!+f)>>>0; state[6]=(state[6]!+g)>>>0; state[7]=(state[7]!+h)>>>0;
      }
      return [...state].map((value) => value.toString(16).padStart(8, "0")).join("");
    }

    private static async compress(bytes: Uint8Array): Promise<Uint8Array> {
      const stream = new Blob([ownedArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
      return this.readStreamBounded(stream, BACKUP_ARCHIVE_MAX_FILE_BYTES, "Backup exceeds the file-size limit.");
    }

    private static async decompressBounded(bytes: Uint8Array): Promise<Uint8Array> {
      assert(typeof DecompressionStream !== "undefined", "This browser cannot decompress gzip backups.");
      const stream = new Blob([ownedArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
      return this.readStreamBounded(stream, BACKUP_ARCHIVE_MAX_EXPANDED_BYTES, "Backup exceeds the expanded-size limit.");
    }

    private static async readStreamBounded(stream: ReadableStream<Uint8Array>, limit: number, message: string): Promise<Uint8Array> {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (!next.value) continue;
          total += next.value.byteLength;
          if (total > limit) { await reader.cancel(message); throw new Error(message); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return result;
    }
  }

  /* ========================================================================== 
     UI RUNTIME & ACCESSIBILITY
     ========================================================================== */
