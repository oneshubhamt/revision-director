  function safeLocalStorageGet(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }

  function safeLocalStorageSet(key: string, value: string): boolean {
    try { window.localStorage.setItem(key, value); return true; } catch { return false; }
  }

  function safeLocalStorageRemove(key: string): boolean {
    try { window.localStorage.removeItem(key); return true; } catch { return false; }
  }

  class AppDiagnostics {
    private records: DiagnosticRecord[];

    constructor() {
      this.records = this.read();
    }

    list(): DiagnosticRecord[] {
      return clone(this.records).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    }

    record(code: string, operation: string, error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      const now = nowIso();
      const existing = this.records.find((entry) => entry.code === code && entry.operation === operation && entry.message === message);
      if (existing) {
        existing.lastAt = now;
        existing.count += 1;
      } else {
        this.records.push({ id: uid("diag"), code, message: message.slice(0, 1_000), operation, firstAt: now, lastAt: now, count: 1 });
      }
      this.records.sort((a, b) => a.lastAt.localeCompare(b.lastAt));
      while (this.records.length > 50) this.records.shift();
      while (JSON.stringify(this.records).length > 32_000 && this.records.length > 1) this.records.shift();
      safeLocalStorageSet(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(this.records));
    }

    private read(): DiagnosticRecord[] {
      const raw = safeLocalStorageGet(DIAGNOSTICS_STORAGE_KEY);
      if (!raw) return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is DiagnosticRecord => {
          if (!isRecord(entry)) return false;
          const count = entry["count"];
          return typeof entry["id"] === "string"
            && typeof entry["code"] === "string"
            && typeof entry["message"] === "string"
            && typeof entry["operation"] === "string"
            && typeof entry["firstAt"] === "string"
            && typeof entry["lastAt"] === "string"
            && typeof count === "number"
            && Number.isInteger(count)
            && count >= 1;
        }).slice(-50);
      } catch {
        return [];
      }
    }
  }

  function documentKindForStore(store: StoreName): DurableDocumentKind {
    if (store === Store.Profiles) return "profile";
    if (store === Store.Nodes) return "node";
    if (store === Store.Units) return "unit";
    if (store === Store.StudyEvents) return "study-event";
    if (store === Store.Obligations) return "obligation";
    if (store === Store.EvidenceEvents) return "evidence-event";
    if (store === Store.Chunks) return "chunk";
    if (store === Store.DailyPlans) return "daily-plan";
    if (store === Store.Settings) return "settings";
    if (store === Store.ActiveRetrieval) return "active-retrieval";
    return "metadata";
  }

  class RevisionData {
    private health: StorageHealthSnapshot;

    private constructor(
      private readonly repository: IndexedDbRepository,
      private readonly diagnosticsJournal: AppDiagnostics,
    ) {
      this.health = {
        checkedAt: nowIso(),
        level: "healthy",
        indexedDbAvailable: true,
        persistence: "unsupported",
        diagnosticCount: diagnosticsJournal.list().length,
      };
    }

    static async open(): Promise<RevisionData> {
      const diagnostics = new AppDiagnostics();
      let repository: IndexedDbRepository;
      try {
        repository = await IndexedDbRepository.open();
      } catch (error) {
        diagnostics.record("storage.indexeddb.open", "open database", error);
        throw error;
      }
      const data = new RevisionData(repository, diagnostics);
      await data.ensureMetadata();
      await data.refreshStorageHealth(false);
      return data;
    }

    storageHealth(): StorageHealthSnapshot {
      return clone(this.health);
    }

    diagnostics(): DiagnosticRecord[] {
      return this.diagnosticsJournal.list();
    }

    recordDiagnostic(code: string, operation: string, error: unknown): void {
      this.diagnosticsJournal.record(code, operation, error);
      this.health = { ...this.health, checkedAt: nowIso(), level: this.health.level === "critical" ? "critical" : "warning", diagnosticCount: this.diagnosticsJournal.list().length, lastError: error instanceof Error ? error.message : String(error) };
    }

    async refreshStorageHealth(requestPersistence = false): Promise<StorageHealthSnapshot> {
      const storage = navigator.storage;
      let persistence: StoragePersistenceState = "unsupported";
      let usageBytes: number | undefined;
      let quotaBytes: number | undefined;
      let lastError: string | undefined;
      if (storage) {
        try {
          if (typeof storage.persisted === "function") {
            const alreadyPersisted = await storage.persisted();
            if (alreadyPersisted) persistence = "granted";
            else if (requestPersistence && typeof storage.persist === "function") persistence = (await storage.persist()) ? "granted" : "denied";
            else persistence = typeof storage.persist === "function" ? "available" : "unsupported";
          }
          if (typeof storage.estimate === "function") {
            const estimate = await storage.estimate();
            usageBytes = estimate.usage;
            quotaBytes = estimate.quota;
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          this.diagnosticsJournal.record("storage.health.inspect", "inspect browser storage", error);
        }
      }
      const usageRatio = usageBytes !== undefined && quotaBytes ? usageBytes / quotaBytes : undefined;
      const diagnosticCount = this.diagnosticsJournal.list().length;
      const level: StorageHealthLevel = usageRatio !== undefined && usageRatio >= 0.9
        ? "critical"
        : usageRatio !== undefined && usageRatio >= 0.75 || persistence === "denied" || Boolean(lastError) || diagnosticCount > 0
          ? "warning"
          : "healthy";
      this.health = {
        checkedAt: nowIso(),
        level,
        indexedDbAvailable: true,
        persistence,
        ...(usageBytes !== undefined ? { usageBytes } : {}),
        ...(quotaBytes !== undefined ? { quotaBytes } : {}),
        ...(usageRatio !== undefined ? { usageRatio } : {}),
        diagnosticCount,
        ...(lastError ? { lastError } : {}),
      };
      return this.storageHealth();
    }

    private async ensureMetadata(): Promise<void> {
      const existing = await this.repository.get<AppMetadata>(Store.Metadata, "database");
      if (existing) {
        const canonical = canonicalAppMetadata(existing);
        assert(canonical.databaseName === DB_NAME && canonical.databaseVersion === DB_VERSION, "Database metadata does not match this production database.");
        assert(canonical.applicationVersion === APP_VERSION, "Database metadata belongs to a different Revision Director build. Clear site data before opening this build.");
        return;
      }
      const time = nowIso();
      const metadata: AppMetadata = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        key: "database",
        databaseName: DB_NAME,
        databaseVersion: DB_VERSION,
        applicationVersion: APP_VERSION,
        createdAt: time,
        updatedAt: time,
      };
      await this.repository.put(Store.Metadata, canonicalAppMetadata(metadata));
    }

    private async operation<T>(name: string, action: () => Promise<T>): Promise<T> {
      try {
        return await action();
      } catch (error) {
        this.diagnosticsJournal.record(`storage.${name}`, name, error);
        this.health = { ...this.health, checkedAt: nowIso(), level: this.health.level === "critical" ? "critical" : "warning", diagnosticCount: this.diagnosticsJournal.list().length, lastError: error instanceof Error ? error.message : String(error) };
        throw error;
      }
    }

    private normalize<T>(store: StoreName, value: T): T {
      return canonicalDocument(documentKindForStore(store), value as DurableDocument) as T;
    }

    async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
      return this.operation(`get.${store}`, async () => {
        const value = await this.repository.get<T>(store, key);
        return value === undefined ? undefined : this.normalize(store, value);
      });
    }

    async getAll<T>(store: StoreName): Promise<T[]> {
      return this.operation(`getAll.${store}`, async () => (await this.repository.getAll<T>(store)).map((value) => this.normalize(store, value)));
    }

    async put<T>(store: StoreName, value: T): Promise<void> {
      await this.operation(`put.${store}`, () => this.repository.put(store, this.normalize(store, value)));
    }

    async putMany<T>(store: StoreName, values: T[]): Promise<void> {
      await this.operation(`putMany.${store}`, () => this.repository.putMany(store, values.map((value) => this.normalize(store, value))));
    }

    async createUnitWithObligation(unit: KnowledgeUnit, obligation: RevisionObligation): Promise<void> {
      await this.operation("createUnitWithObligation", () => this.repository.createUnitWithObligation(canonicalKnowledgeUnit(unit), canonicalRevisionObligation(obligation)));
    }

    async updateUnitWithObligations(unit: KnowledgeUnit, obligations: RevisionObligation[]): Promise<void> {
      await this.operation("updateUnitWithObligations", () => this.repository.updateUnitWithObligations(canonicalKnowledgeUnit(unit), obligations.map(canonicalRevisionObligation)));
    }

    async delete(store: StoreName, key: IDBValidKey): Promise<void> {
      await this.operation(`delete.${store}`, () => this.repository.delete(store, key));
    }

    async findNode(profileId: string, parentId: string | null, kind: KnowledgeNodeKind, name: string): Promise<KnowledgeNode | undefined> {
      const candidates = await this.getByIndex<KnowledgeNode>(Store.Nodes, "profileId", profileId);
      const normalized = normalizeName(name);
      return candidates.find((node) => node.parentId === parentId && node.kind === kind && node.normalizedName === normalized);
    }

    async getByIndex<T>(store: StoreName, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<T[]> {
      return this.operation(`index.${store}.${indexName}`, async () => (await this.repository.getByIndex<T>(store, indexName, query)).map((value) => this.normalize(store, value)));
    }

    async putObligationWithChunks(obligation: RevisionObligation, chunks: ObligationChunk[]): Promise<void> {
      await this.operation("putObligationWithChunks", () => this.repository.putObligationWithChunks(canonicalRevisionObligation(obligation), chunks.map(canonicalObligationChunk)));
    }

    async updateChunkWithObligation(
      chunk: ObligationChunk,
      obligation: RevisionObligation,
      dailyPlan?: DailyPlanRecord,
      commitGuard?: ActiveCommitGuard,
      postCommitSession?: ActiveRetrievalSession,
    ): Promise<void> {
      await this.operation("updateChunkWithObligation", () => this.repository.updateChunkWithObligation(
        canonicalObligationChunk(chunk),
        canonicalRevisionObligation(obligation),
        dailyPlan ? canonicalDailyPlanRecord(dailyPlan) : undefined,
        commitGuard,
        postCommitSession ? canonicalActiveRetrievalSession(postCommitSession) : undefined,
      ));
    }

    async dailyPlanByStudyDay(studyDayKey: string): Promise<DailyPlanRecord | undefined> {
      return this.operation("dailyPlanByStudyDay", async () => {
        const value = await this.repository.dailyPlanByStudyDay(studyDayKey);
        return value ? canonicalDailyPlanRecord(value) : undefined;
      });
    }

    async recordReview(
      unit: KnowledgeUnit,
      obligation: RevisionObligation,
      event: EvidenceEvent,
      followUp?: RevisionObligation,
      relatedObligation?: RevisionObligation,
      chunkUpdates: ObligationChunk[] = [],
      dailyPlan?: DailyPlanRecord,
      commitGuard?: ActiveCommitGuard,
      postCommitSession?: ActiveRetrievalSession,
    ): Promise<void> {
      await this.operation("recordReview", () => this.repository.recordReview(
        canonicalKnowledgeUnit(unit),
        canonicalRevisionObligation(obligation),
        canonicalEvidenceEvent(event),
        followUp ? canonicalRevisionObligation(followUp) : undefined,
        relatedObligation ? canonicalRevisionObligation(relatedObligation) : undefined,
        chunkUpdates.map(canonicalObligationChunk),
        dailyPlan ? canonicalDailyPlanRecord(dailyPlan) : undefined,
        commitGuard,
        postCommitSession ? canonicalActiveRetrievalSession(postCommitSession) : undefined,
      ));
    }

    async rawDump(): Promise<Record<string, unknown[]>> {
      return this.operation("rawDump", () => this.repository.rawDump());
    }

    async replaceFromBackup(payload: BackupPayload, activeTreatment: BackupActiveSessionTreatment): Promise<void> {
      const canonical: BackupPayload = {
        ...payload,
        profiles: payload.profiles.map(canonicalExamProfile),
        nodes: payload.nodes.map(canonicalKnowledgeNode),
        units: payload.units.map(canonicalKnowledgeUnit),
        studyEvents: payload.studyEvents.map(canonicalStudyEvent),
        obligations: payload.obligations.map(canonicalRevisionObligation),
        evidenceEvents: payload.evidenceEvents.map(canonicalEvidenceEvent),
        chunks: payload.chunks.map(canonicalObligationChunk),
        dailyPlans: payload.dailyPlans.map(canonicalDailyPlanRecord),
        settings: canonicalAppSettings(payload.settings),
        activeRetrieval: payload.activeRetrieval ? canonicalActiveRetrievalSession(payload.activeRetrieval) : null,
      };
      await this.operation("replaceFromBackup", () => this.repository.replaceFromBackup(canonical, activeTreatment));
    }
  }
