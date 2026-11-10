  const Store = Object.freeze({
    Profiles: "profiles",
    Nodes: "nodes",
    Units: "units",
    StudyEvents: "studyEvents",
    Obligations: "obligations",
    EvidenceEvents: "evidenceEvents",
    Chunks: "chunks",
    DailyPlans: "dailyPlans",
    Settings: "settings",
    Metadata: "metadata",
    ActiveRetrieval: "activeRetrieval",
  } as const);
  type StoreName = typeof Store[keyof typeof Store];

  function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  }

  function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction was aborted."));
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
    });
  }

  class IndexedDbRepository {
    private constructor(private readonly db: IDBDatabase) {}

    static async open(): Promise<IndexedDbRepository> {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        assert(event.oldVersion === 0, "Existing Revision Director database schema is unsupported. Clear site data before opening this build.");
        const db = request.result;
          const profiles = db.createObjectStore(Store.Profiles, { keyPath: "id" });
          profiles.createIndex("status", "status");

          const nodes = db.createObjectStore(Store.Nodes, { keyPath: "id" });
          nodes.createIndex("profileId", "profileId");
          nodes.createIndex("parentId", "parentId");
          nodes.createIndex("pathLookup", ["profileId", "parentId", "kind", "normalizedName"], { unique: true });

          const units = db.createObjectStore(Store.Units, { keyPath: "id" });
          units.createIndex("profileId", "profileId");
          units.createIndex("topicNodeId", "topicNodeId");
          units.createIndex("status", "status");

          const study = db.createObjectStore(Store.StudyEvents, { keyPath: "id" });
          study.createIndex("profileId", "profileId");
          study.createIndex("occurredAt", "occurredAt");

          const obligations = db.createObjectStore(Store.Obligations, { keyPath: "id" });
          obligations.createIndex("unitId", "unitId");
          obligations.createIndex("dueAt", "dueAt");
          obligations.createIndex("status", "status");
          obligations.createIndex("type", "type");

          const evidence = db.createObjectStore(Store.EvidenceEvents, { keyPath: "id" });
          evidence.createIndex("profileId", "profileId");
          evidence.createIndex("unitId", "unitId");
          evidence.createIndex("obligationId", "obligationId");
          evidence.createIndex("reviewedAt", "reviewedAt");

          const chunks = db.createObjectStore(Store.Chunks, { keyPath: "id" });
          chunks.createIndex("obligationId", "obligationId");
          chunks.createIndex("cycleId", "cycleId");
          chunks.createIndex("status", "status");

          const plans = db.createObjectStore(Store.DailyPlans, { keyPath: "id" });
          plans.createIndex("studyDayKey", "studyDayKey", { unique: true });
          plans.createIndex("updatedAt", "updatedAt");

          db.createObjectStore(Store.Settings, { keyPath: "key" });
          db.createObjectStore(Store.Metadata, { keyPath: "key" });
          db.createObjectStore(Store.ActiveRetrieval, { keyPath: "id" });
      };
      const db = await requestResult(request);
      db.onversionchange = () => db.close();
      return new IndexedDbRepository(db);
    }

    async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
      const tx = this.db.transaction(store, "readonly");
      const value = await requestResult(tx.objectStore(store).get(key));
      await transactionDone(tx);
      return value as T | undefined;
    }

    async getAll<T>(store: StoreName): Promise<T[]> {
      const tx = this.db.transaction(store, "readonly");
      const values = await requestResult(tx.objectStore(store).getAll());
      await transactionDone(tx);
      return values as T[];
    }

    async put<T>(store: StoreName, value: T): Promise<void> {
      const tx = this.db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      await transactionDone(tx);
    }

    async putMany<T>(store: StoreName, values: T[]): Promise<void> {
      const tx = this.db.transaction(store, "readwrite");
      const target = tx.objectStore(store);
      for (const value of values) target.put(value);
      await transactionDone(tx);
    }

    async createUnitWithObligation(unit: KnowledgeUnit, obligation: RevisionObligation): Promise<void> {
      const tx = this.db.transaction([Store.Units, Store.Obligations], "readwrite");
      tx.objectStore(Store.Units).add(unit);
      tx.objectStore(Store.Obligations).add(obligation);
      await transactionDone(tx);
    }

    async updateUnitWithObligations(unit: KnowledgeUnit, obligations: RevisionObligation[]): Promise<void> {
      const tx = this.db.transaction([Store.Units, Store.Obligations], "readwrite");
      tx.objectStore(Store.Units).put(unit);
      const target = tx.objectStore(Store.Obligations);
      for (const obligation of obligations) target.put(obligation);
      await transactionDone(tx);
    }

    async delete(store: StoreName, key: IDBValidKey): Promise<void> {
      const tx = this.db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      await transactionDone(tx);
    }


    async findNode(profileId: string, parentId: string | null, kind: KnowledgeNodeKind, name: string): Promise<KnowledgeNode | undefined> {
      const candidates = await this.getByIndex<KnowledgeNode>(Store.Nodes, "profileId", profileId);
      const normalized = normalizeName(name);
      return candidates.find((node) => node.parentId === parentId && node.kind === kind && node.normalizedName === normalized);
    }

    async getByIndex<T>(store: StoreName, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<T[]> {
      const tx = this.db.transaction(store, "readonly");
      const result = await requestResult(tx.objectStore(store).index(indexName).getAll(query));
      await transactionDone(tx);
      return result as T[];
    }

    async putObligationWithChunks(obligation: RevisionObligation, chunks: ObligationChunk[]): Promise<void> {
      const tx = this.db.transaction([Store.Obligations, Store.Chunks], "readwrite");
      tx.objectStore(Store.Obligations).put(obligation);
      const target = tx.objectStore(Store.Chunks);
      for (const chunk of chunks) target.put(chunk);
      await transactionDone(tx);
    }

    async updateChunkWithObligation(
      chunk: ObligationChunk,
      obligation: RevisionObligation,
      dailyPlan?: DailyPlanRecord,
      commitGuard?: ActiveCommitGuard,
      postCommitSession?: ActiveRetrievalSession,
    ): Promise<void> {
      const stores: StoreName[] = [Store.Obligations, Store.Chunks];
      if (dailyPlan) stores.push(Store.DailyPlans);
      if (commitGuard) stores.push(Store.ActiveRetrieval);
      const tx = this.db.transaction(stores, "readwrite");
      const apply = () => {
        tx.objectStore(Store.Obligations).put(obligation);
        tx.objectStore(Store.Chunks).put(chunk);
        if (dailyPlan) tx.objectStore(Store.DailyPlans).put(dailyPlan);
        if (commitGuard && postCommitSession) tx.objectStore(Store.ActiveRetrieval).put(postCommitSession);
      };
      if (commitGuard) {
        const request = tx.objectStore(Store.ActiveRetrieval).get(commitGuard.sessionId);
        request.onsuccess = () => {
          const current = request.result as ActiveRetrievalSession | undefined;
          if (!current || current.status !== "committing" || current.revision !== commitGuard.expectedRevision || current.activeTargetId !== commitGuard.targetId || current.commitToken !== commitGuard.commitToken) { tx.abort(); return; }
          apply();
        };
      } else apply();
      await transactionDone(tx);
    }

    async dailyPlanByStudyDay(studyDayKey: string): Promise<DailyPlanRecord | undefined> {
      const tx = this.db.transaction(Store.DailyPlans, "readonly");
      const value = await requestResult(tx.objectStore(Store.DailyPlans).index("studyDayKey").get(studyDayKey));
      await transactionDone(tx);
      return value as DailyPlanRecord | undefined;
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
      const stores: StoreName[] = [Store.Units, Store.Obligations, Store.EvidenceEvents, Store.Chunks];
      if (dailyPlan) stores.push(Store.DailyPlans);
      if (commitGuard) stores.push(Store.ActiveRetrieval);
      const tx = this.db.transaction(stores, "readwrite");
      const apply = () => {
        const obligationStore = tx.objectStore(Store.Obligations);
        tx.objectStore(Store.Units).put(unit);
        obligationStore.put(obligation);
        tx.objectStore(Store.EvidenceEvents).add(event);
        if (followUp) obligationStore.add(followUp);
        if (relatedObligation) obligationStore.put(relatedObligation);
        const chunkStore = tx.objectStore(Store.Chunks);
        for (const chunk of chunkUpdates) chunkStore.put(chunk);
        if (dailyPlan) tx.objectStore(Store.DailyPlans).put(dailyPlan);
        if (commitGuard && postCommitSession) tx.objectStore(Store.ActiveRetrieval).put(postCommitSession);
      };
      if (commitGuard) {
        const request = tx.objectStore(Store.ActiveRetrieval).get(commitGuard.sessionId);
        request.onsuccess = () => {
          const current = request.result as ActiveRetrievalSession | undefined;
          if (!current || current.status !== "committing" || current.revision !== commitGuard.expectedRevision || current.activeTargetId !== commitGuard.targetId || current.commitToken !== commitGuard.commitToken) { tx.abort(); return; }
          apply();
        };
      } else apply();
      await transactionDone(tx);
    }

    async rawDump(): Promise<Record<StoreName, unknown[]>> {
      const stores = Object.values(Store) as StoreName[];
      const dump = {} as Record<StoreName, unknown[]>;
      for (const store of stores) dump[store] = await this.getAll<unknown>(store);
      return dump;
    }

    async replaceFromBackup(payload: BackupPayload, activeTreatment: BackupActiveSessionTreatment): Promise<void> {
      const stores: StoreName[] = [Store.Profiles, Store.Nodes, Store.Units, Store.StudyEvents, Store.Obligations, Store.EvidenceEvents, Store.Chunks, Store.DailyPlans, Store.Settings, Store.ActiveRetrieval];
      const tx = this.db.transaction(stores, "readwrite");
      for (const store of stores) tx.objectStore(store).clear();
      for (const value of payload.profiles) tx.objectStore(Store.Profiles).put(value);
      for (const value of payload.nodes) tx.objectStore(Store.Nodes).put(value);
      for (const value of payload.units) tx.objectStore(Store.Units).put(value);
      for (const value of payload.studyEvents) tx.objectStore(Store.StudyEvents).put(value);
      for (const value of payload.obligations) tx.objectStore(Store.Obligations).put(value);
      for (const value of payload.evidenceEvents) tx.objectStore(Store.EvidenceEvents).put(value);
      for (const value of payload.chunks) tx.objectStore(Store.Chunks).put(value);
      for (const value of payload.dailyPlans) tx.objectStore(Store.DailyPlans).put(value);
      tx.objectStore(Store.Settings).put(payload.settings);
      if (activeTreatment === "restore" && payload.activeRetrieval) tx.objectStore(Store.ActiveRetrieval).put(payload.activeRetrieval);
      await transactionDone(tx);
    }
  }

  /* ========================================================================== 
     APPLICATION SERVICES
     ========================================================================== */

