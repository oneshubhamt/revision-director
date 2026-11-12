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
      return utf8Bytes(value);
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
      const candidate = {
        format: manifest.payloadFormat,
        schemaVersion: manifest.payloadSchemaVersion,
        exportedAt: manifest.exportedAt,
        appVersion: manifest.appVersion,
        profiles: collections.profiles,
        nodes: collections.nodes,
        units: collections.units,
        studyEvents: collections.studyEvents,
        obligations: collections.obligations,
        evidenceEvents: collections.evidenceEvents,
        chunks: collections.chunks,
        dailyPlans: collections.dailyPlans,
        settings: collections.settings[0],
        activeRetrieval: collections.activeRetrieval[0] ?? null,
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
      const value = requireRecord(input, "Backup manifest");
      assertExactKeys(value, "Backup manifest", ["kind", "format", "version", "exportedAt", "appVersion", "payloadFormat", "payloadSchemaVersion", "compression", "hashAlgorithm", "chunkTargetBytes", "chunkMaxItems", "chunkCount", "counts", "stateChecksum"]);
      assert(value["kind"] === "manifest" && value["format"] === BACKUP_ARCHIVE_FORMAT && value["version"] === BACKUP_ARCHIVE_VERSION, "This is not a supported Revision Director backup archive.");
      const appVersion = canonicalId(requiredString(value["appVersion"], "Backup application version"), "Backup application version");
      assert(value["payloadFormat"] === BACKUP_FORMAT && value["payloadSchemaVersion"] === BACKUP_SCHEMA_VERSION, "Backup payload version is unsupported.");
      const compression = literalChoice(value["compression"], ["none", "gzip"] as const, "Backup compression metadata");
      const hashAlgorithm = literalChoice(value["hashAlgorithm"], ["sha256"] as const, "Backup hash algorithm");
      assert(value["chunkTargetBytes"] === BACKUP_ARCHIVE_CHUNK_TARGET_BYTES && value["chunkMaxItems"] === BACKUP_ARCHIVE_CHUNK_MAX_ITEMS, "Backup chunk contract is unsupported.");
      const chunkCount = value["chunkCount"];
      assert(typeof chunkCount === "number" && Number.isInteger(chunkCount) && chunkCount >= 0, "Backup manifest chunk count is invalid.");
      const stateChecksum = value["stateChecksum"];
      assert(typeof stateChecksum === "string" && /^[0-9a-f]{64}$/.test(stateChecksum), "Backup state checksum is invalid.");
      return {
        kind: "manifest",
        format: BACKUP_ARCHIVE_FORMAT,
        version: BACKUP_ARCHIVE_VERSION,
        exportedAt: canonicalIso(requiredString(value["exportedAt"], "Backup export date"), "Backup export date"),
        appVersion,
        payloadFormat: BACKUP_FORMAT,
        payloadSchemaVersion: BACKUP_SCHEMA_VERSION,
        compression,
        hashAlgorithm,
        chunkTargetBytes: BACKUP_ARCHIVE_CHUNK_TARGET_BYTES,
        chunkMaxItems: BACKUP_ARCHIVE_CHUNK_MAX_ITEMS,
        chunkCount,
        counts: this.parseCounts(value["counts"]),
        stateChecksum,
      };
    }

    private static parseCounts(input: unknown): BackupArchiveCounts {
      const value = requireRecord(input, "Backup counts");
      assertExactKeys(value, "Backup counts", BACKUP_ENTITY_ORDER);
      const counts = this.zeroCounts();
      for (const key of BACKUP_ENTITY_ORDER) {
        const count = value[key];
        assert(typeof count === "number" && Number.isInteger(count) && count >= 0, `Backup ${key} count is invalid.`);
        counts[key] = count;
      }
      return counts;
    }

    private static parseChunk(input: unknown): BackupArchiveChunk {
      const value = requireRecord(input, "Backup chunk");
      assertExactKeys(value, "Backup chunk", ["kind", "sequence", "entityType", "count", "items", "checksum"]);
      const sequence = value["sequence"];
      assert(value["kind"] === "chunk" && typeof sequence === "number" && Number.isInteger(sequence) && sequence >= 0, "Backup chunk sequence is invalid.");
      const entityType = literalChoice(value["entityType"], BACKUP_ENTITY_ORDER, "Backup chunk entity type");
      const count = value["count"];
      const items = value["items"];
      assert(typeof count === "number" && Number.isInteger(count) && Array.isArray(items), "Backup chunk contents are invalid.");
      const checksum = value["checksum"];
      assert(typeof checksum === "string" && /^[0-9a-f]{64}$/.test(checksum), "Backup chunk checksum is invalid.");
      return { kind: "chunk", sequence, entityType, count, items, checksum };
    }

    private static parseCompletion(input: unknown): BackupArchiveCompletion {
      const value = requireRecord(input, "Backup completion proof");
      assertExactKeys(value, "Backup completion proof", ["kind", "chunkCount", "counts", "chunkHashes", "checksum"]);
      const chunkCount = value["chunkCount"];
      assert(value["kind"] === "complete" && typeof chunkCount === "number" && Number.isInteger(chunkCount) && chunkCount >= 0, "Backup completion proof is invalid.");
      const chunkHashes = value["chunkHashes"];
      assert(Array.isArray(chunkHashes) && chunkHashes.every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)), "Backup completion hashes are invalid.");
      const checksum = value["checksum"];
      assert(typeof checksum === "string" && /^[0-9a-f]{64}$/.test(checksum), "Backup final checksum is invalid.");
      return { kind: "complete", chunkCount, counts: this.parseCounts(value["counts"]), chunkHashes, checksum };
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
      return sha256Hex(bytes);
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
