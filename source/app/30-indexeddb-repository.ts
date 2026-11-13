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
  interface StoreValueMap {
    [Store.Profiles]: ExamProfile;
    [Store.Nodes]: KnowledgeNode;
    [Store.Units]: KnowledgeUnit;
    [Store.StudyEvents]: StudyEvent;
    [Store.Obligations]: RevisionObligation;
    [Store.EvidenceEvents]: EvidenceEvent;
    [Store.Chunks]: ObligationChunk;
    [Store.DailyPlans]: DailyPlanRecord;
    [Store.Settings]: AppSettings;
    [Store.Metadata]: AppMetadata;
    [Store.ActiveRetrieval]: ActiveRetrievalSession;
  }
  type StoreName = keyof StoreValueMap;
  type StoreValue<S extends StoreName> = StoreValueMap[S];

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

  type RevisionWriteDurability = "default" | "strict";

  function readwriteTransaction(
    db: IDBDatabase,
    stores: StoreName | StoreName[],
    durability: RevisionWriteDurability = "default",
  ): IDBTransaction {
    if (durability === "default") return db.transaction(stores, "readwrite");
    try {
      return db.transaction(stores, "readwrite", { durability: "strict" });
    } catch (error) {
      if (error instanceof TypeError || (isRecord(error) && error["name"] === "TypeError")) {
        return db.transaction(stores, "readwrite");
      }
      throw error;
    }
  }

  async function rootKnowledgeNodeId(profileId: string, normalizedName: string): Promise<string> {
    const digest = await sha256Hex(utf8Bytes(`${profileId}\u0000subject\u0000${normalizedName}`));
    return `subject_${digest.slice(0, 32)}`;
  }

  class IndexedDbRepository {
    private constructor(private readonly db: IDBDatabase) {}

    static async open(): Promise<IndexedDbRepository> {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let upgradeError: Error | undefined;
      request.onupgradeneeded = (event) => {
        if (event.oldVersion !== 0) {
          upgradeError = new Error("Existing Revision Director database schema is unsupported by this build. Existing data was not modified; open it with a compatible build and export a backup before changing schema.");
          request.transaction?.abort();
          return;
        }
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

          const settings = db.createObjectStore(Store.Settings, { keyPath: "key" });
          const metadata = db.createObjectStore(Store.Metadata, { keyPath: "key" });
          db.createObjectStore(Store.ActiveRetrieval, { keyPath: "id" });

          const createdAt = nowIso();
          settings.add(defaultSettings());
          metadata.add({
            schemaVersion: DOCUMENT_SCHEMA_VERSION,
            key: "database",
            databaseName: DB_NAME,
            databaseVersion: DB_VERSION,
            applicationVersion: APP_VERSION,
            createdAt,
            updatedAt: createdAt,
          } satisfies AppMetadata);
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          if (upgradeError) reject(upgradeError);
          else if (request.error?.name === "VersionError") reject(new Error("Existing Revision Director database schema is newer than this build. Existing data was not modified; open it with a compatible build and export a backup before using an older schema."));
          else reject(request.error ?? new Error("IndexedDB open failed."));
        };
      });
      db.onversionchange = () => db.close();
      return new IndexedDbRepository(db);
    }

    async get<S extends StoreName>(store: S, key: IDBValidKey): Promise<StoreValue<S> | undefined> {
      const tx = this.db.transaction(store, "readonly");
      const value = await requestResult(tx.objectStore(store).get(key));
      await transactionDone(tx);
      return value as StoreValue<S> | undefined;
    }

    async getAll<S extends StoreName>(store: S): Promise<StoreValue<S>[]> {
      const tx = this.db.transaction(store, "readonly");
      const values = await requestResult(tx.objectStore(store).getAll());
      await transactionDone(tx);
      return values as StoreValue<S>[];
    }

    async put<S extends StoreName>(store: S, value: StoreValue<S>): Promise<void> {
      const tx = readwriteTransaction(this.db, store);
      tx.objectStore(store).put(value);
      await transactionDone(tx);
    }

    async add<S extends StoreName>(store: S, value: StoreValue<S>): Promise<void> {
      const tx = readwriteTransaction(this.db, store);
      tx.objectStore(store).add(value);
      await transactionDone(tx);
    }

    async putMany<S extends StoreName>(store: S, values: StoreValue<S>[]): Promise<void> {
      const tx = readwriteTransaction(this.db, store);
      const target = tx.objectStore(store);
      for (const value of values) target.put(value);
      await transactionDone(tx);
    }

    async putProfileAndSettings(profile: ExamProfile, settings: AppSettings): Promise<void> {
      const tx = readwriteTransaction(this.db, [Store.Profiles, Store.Settings], "strict");
      tx.objectStore(Store.Profiles).put(profile);
      tx.objectStore(Store.Settings).put(settings);
      await transactionDone(tx);
    }

    async createUnitWithObligation(unit: KnowledgeUnit, obligation: RevisionObligation): Promise<void> {
      const tx = readwriteTransaction(this.db, [Store.Units, Store.Obligations], "strict");
      tx.objectStore(Store.Units).add(unit);
      tx.objectStore(Store.Obligations).add(obligation);
      await transactionDone(tx);
    }

    async updateUnitWithObligations(unit: KnowledgeUnit, obligations: RevisionObligation[]): Promise<void> {
      const tx = readwriteTransaction(this.db, [Store.Units, Store.Obligations], "strict");
      tx.objectStore(Store.Units).put(unit);
      const target = tx.objectStore(Store.Obligations);
      for (const obligation of obligations) target.put(obligation);
      await transactionDone(tx);
    }

    async delete(store: StoreName, key: IDBValidKey): Promise<void> {
      const tx = readwriteTransaction(this.db, store);
      tx.objectStore(store).delete(key);
      await transactionDone(tx);
    }


    async findNode(profileId: string, parentId: string | null, kind: KnowledgeNodeKind, name: string): Promise<KnowledgeNode | undefined> {
      const normalized = normalizeName(name);
      if (parentId !== null) {
        return this.getOneByIndex(Store.Nodes, "pathLookup", [profileId, parentId, kind, normalized]);
      }

      assert(kind === "subject", "Only subject nodes may exist at the hierarchy root.");
      const roots = (await this.getByIndex(Store.Nodes, "profileId", profileId))
        .filter((node) => node.parentId === null && node.kind === kind && node.normalizedName === normalized);
      assert(roots.length <= 1, "Knowledge hierarchy contains duplicate root subjects.");
      return roots[0];
    }

    async getOneByIndex<S extends StoreName>(store: S, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<StoreValue<S> | undefined> {
      const tx = this.db.transaction(store, "readonly");
      const result = await requestResult(tx.objectStore(store).index(indexName).get(query));
      await transactionDone(tx);
      return result as StoreValue<S> | undefined;
    }

    async getByIndex<S extends StoreName>(store: S, indexName: string, query: IDBValidKey | IDBKeyRange): Promise<StoreValue<S>[]> {
      const tx = this.db.transaction(store, "readonly");
      const result = await requestResult(tx.objectStore(store).index(indexName).getAll(query));
      await transactionDone(tx);
      return result as StoreValue<S>[];
    }

    async putObligationWithChunks(obligation: RevisionObligation, chunks: ObligationChunk[]): Promise<void> {
      const tx = readwriteTransaction(this.db, [Store.Obligations, Store.Chunks], "strict");
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
      const tx = readwriteTransaction(this.db, stores, "strict");
      const apply = () => {
        tx.objectStore(Store.Obligations).put(obligation);
        tx.objectStore(Store.Chunks).put(chunk);
        if (dailyPlan) tx.objectStore(Store.DailyPlans).put(dailyPlan);
        if (commitGuard && postCommitSession) tx.objectStore(Store.ActiveRetrieval).put(postCommitSession);
      };
      this.applyWithCommitGuard(tx, commitGuard, apply);
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
      const tx = readwriteTransaction(this.db, stores, "strict");
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
      this.applyWithCommitGuard(tx, commitGuard, apply);
      await transactionDone(tx);
    }

    private applyWithCommitGuard(tx: IDBTransaction, commitGuard: ActiveCommitGuard | undefined, apply: () => void): void {
      if (!commitGuard) {
        apply();
        return;
      }
      const request = tx.objectStore(Store.ActiveRetrieval).get(commitGuard.sessionId);
      request.onsuccess = () => {
        const current = request.result as ActiveRetrievalSession | undefined;
        const matches = Boolean(
          current
          && current.status === "committing"
          && current.revision === commitGuard.expectedRevision
          && current.activeTargetId === commitGuard.targetId
          && current.commitToken === commitGuard.commitToken
        );
        if (!matches) {
          tx.abort();
          return;
        }
        apply();
      };
    }

    async replaceSettingsAndObligations(settings: AppSettings, obligations: RevisionObligation[]): Promise<void> {
      const tx = readwriteTransaction(this.db, [Store.Settings, Store.Obligations], "strict");
      tx.objectStore(Store.Settings).put(settings);
      const obligationStore = tx.objectStore(Store.Obligations);
      for (const obligation of obligations) obligationStore.put(obligation);
      await transactionDone(tx);
    }

    async rawDump(): Promise<Record<StoreName, unknown[]>> {
      const stores = Object.values(Store) as StoreName[];
      const tx = this.db.transaction(stores, "readonly");
      const requests = stores.map((store) => requestResult(tx.objectStore(store).getAll()));
      const values = await Promise.all(requests);
      await transactionDone(tx);
      const dump = {} as Record<StoreName, unknown[]>;
      stores.forEach((store, index) => { dump[store] = values[index] ?? []; });
      return dump;
    }

    async replaceFromBackup(payload: BackupPayload, activeTreatment: BackupActiveSessionTreatment): Promise<void> {
      const stores: StoreName[] = [Store.Profiles, Store.Nodes, Store.Units, Store.StudyEvents, Store.Obligations, Store.EvidenceEvents, Store.Chunks, Store.DailyPlans, Store.Settings, Store.ActiveRetrieval];
      const tx = readwriteTransaction(this.db, stores, "strict");
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

