  interface ActiveRetrievalLoadResult {
    session?: ActiveRetrievalSession;
    localPresent: boolean;
    indexedDbPresent: boolean;
  }

  function newerActiveRetrieval(a?: ActiveRetrievalSession, b?: ActiveRetrievalSession): ActiveRetrievalSession | undefined {
    if (!a) return b;
    if (!b) return a;
    if (a.revision !== b.revision) return a.revision > b.revision ? a : b;
    return Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b;
  }

  function evenlySampleDiagramPoints(points: DiagramPoint[], maximum: number): DiagramPoint[] {
    if (maximum <= 0) return [];
    if (points.length <= maximum) return clone(points);
    if (maximum === 1) return [clone(points[0]!)];
    const sampled: DiagramPoint[] = [];
    for (let index = 0; index < maximum; index += 1) {
      const sourceIndex = Math.round(index * (points.length - 1) / (maximum - 1));
      sampled.push(clone(points[sourceIndex]!));
    }
    return sampled;
  }

  function compactActiveRetrievalSession(session: ActiveRetrievalSession): ActiveRetrievalSession {
    const canonical = canonicalActiveRetrievalSession(session);
    let remainingText = ACTIVE_RETRIEVAL_RECOVERY_TEXT_CHARS;
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(canonical.draft.values)) {
      if (remainingText <= 0) break;
      const retained = value.slice(0, remainingText);
      values[key] = retained;
      remainingText -= retained.length;
    }
    let remainingPoints = ACTIVE_RETRIEVAL_RECOVERY_POINTS;
    const nonEmptyStrokes = canonical.draft.diagramStrokes.filter((stroke) => stroke.length > 0);
    const diagramStrokes: DiagramStroke[] = [];
    for (let index = 0; index < nonEmptyStrokes.length && remainingPoints > 0; index += 1) {
      const stroke = nonEmptyStrokes[index]!;
      const strokesRemaining = nonEmptyStrokes.length - index;
      const fairShare = Math.max(1, Math.floor(remainingPoints / strokesRemaining));
      const retained = evenlySampleDiagramPoints(stroke, Math.min(stroke.length, fairShare));
      diagramStrokes.push(retained);
      remainingPoints -= retained.length;
    }
    return canonicalActiveRetrievalSession({
      ...canonical,
      draft: { ...canonical.draft, values, diagramStrokes },
    });
  }

  class ActiveRetrievalPersistence {
    private writeChain: Promise<void> = Promise.resolve();
    private debounceHandle = 0;
    private pending: ActiveRetrievalSession | undefined;

    constructor(private readonly data: RevisionData) {}

    private readLocal(): ActiveRetrievalSession | undefined {
      const raw = safeLocalStorageGet(ACTIVE_RETRIEVAL_RECOVERY_KEY);
      if (!raw) return undefined;
      try {
        const parsed: unknown = JSON.parse(raw);
        return canonicalActiveRetrievalEnvelope(parsed).session;
      } catch (error) {
        this.data.recordDiagnostic("active-retrieval.local.invalid", "read emergency recovery", error);
        safeLocalStorageRemove(ACTIVE_RETRIEVAL_RECOVERY_KEY);
        return undefined;
      }
    }

    private writeLocal(session: ActiveRetrievalSession): boolean {
      try {
        const canonical = compactActiveRetrievalSession(session);
        const envelope: ActiveRetrievalRecoveryEnvelope = {
          format: ACTIVE_RETRIEVAL_RECOVERY_FORMAT,
          schemaVersion: 1,
          savedAt: nowIso(),
          session: canonical,
        };
        const encoded = JSON.stringify(envelope);
        assert(encoded.length <= ACTIVE_RETRIEVAL_RECOVERY_MAX_CHARS, "Active retrieval emergency snapshot is too large.");
        const saved = safeLocalStorageSet(ACTIVE_RETRIEVAL_RECOVERY_KEY, encoded);
        if (!saved) this.data.recordDiagnostic("active-retrieval.local.write", "write emergency recovery", new Error("localStorage write failed"));
        return saved;
      } catch (error) {
        this.data.recordDiagnostic("active-retrieval.local.write", "write emergency recovery", error);
        return false;
      }
    }

    schedule(session: ActiveRetrievalSession): void {
      this.pending = canonicalActiveRetrievalSession(session);
      if (this.debounceHandle) window.clearTimeout(this.debounceHandle);
      this.debounceHandle = window.setTimeout(() => {
        this.debounceHandle = 0;
        void this.flush();
      }, ACTIVE_RETRIEVAL_DEBOUNCE_MS);
    }

    forceEmergency(session: ActiveRetrievalSession): void {
      const canonical = canonicalActiveRetrievalSession(session);
      this.pending = canonical;
      this.writeLocal(canonical);
    }

    async flush(session?: ActiveRetrievalSession): Promise<void> {
      if (this.debounceHandle) window.clearTimeout(this.debounceHandle);
      this.debounceHandle = 0;
      const candidate = session ? canonicalActiveRetrievalSession(session) : this.pending;
      if (!candidate) return this.writeChain;
      this.pending = undefined;
      this.writeLocal(candidate);
      this.writeChain = this.writeChain
        .catch((error) => this.data.recordDiagnostic("active-retrieval.previous-write", "serialised active retrieval write", error))
        .then(() => this.data.put(Store.ActiveRetrieval, candidate))
        .catch((error) => {
          this.data.recordDiagnostic("active-retrieval.indexeddb.write", "write active retrieval", error);
          throw error;
        });
      return this.writeChain;
    }

    async load(): Promise<ActiveRetrievalLoadResult> {
      const local = this.readLocal();
      let indexed: ActiveRetrievalSession | undefined;
      try {
        indexed = await this.data.get<ActiveRetrievalSession>(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID);
      } catch (error) {
        this.data.recordDiagnostic("active-retrieval.indexeddb.read", "read active retrieval", error);
      }
      const winner = newerActiveRetrieval(indexed, local);
      if (!winner) return { localPresent: Boolean(local), indexedDbPresent: Boolean(indexed) };
      if (winner.status === "completed") {
        await this.clear();
        return { localPresent: Boolean(local), indexedDbPresent: Boolean(indexed) };
      }
      if (winner === local && (!indexed || newerActiveRetrieval(indexed, local) === local)) {
        try { await this.data.put(Store.ActiveRetrieval, winner); }
        catch (error) { this.data.recordDiagnostic("active-retrieval.reconcile.indexeddb", "reconcile recovery into IndexedDB", error); }
      }
      if (winner === indexed && (!local || newerActiveRetrieval(local, indexed) === indexed)) this.writeLocal(winner);
      return { session: clone(winner), localPresent: Boolean(local), indexedDbPresent: Boolean(indexed) };
    }

    async acceptCommittedTransition(session: ActiveRetrievalSession): Promise<void> {
      const canonical = canonicalActiveRetrievalSession(session);
      this.pending = undefined;
      if (this.debounceHandle) window.clearTimeout(this.debounceHandle);
      this.debounceHandle = 0;
      if (canonical.status === "completed") {
        safeLocalStorageRemove(ACTIVE_RETRIEVAL_RECOVERY_KEY);
        this.writeChain = this.writeChain
          .catch((error) => this.data.recordDiagnostic("active-retrieval.previous-clear", "serialised active retrieval clear", error))
          .then(() => this.data.delete(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID));
        await this.writeChain;
      } else {
        this.writeLocal(canonical);
      }
    }

    resetEmergencyAfterRestore(session: ActiveRetrievalSession | null): void {
      if (this.debounceHandle) window.clearTimeout(this.debounceHandle);
      this.debounceHandle = 0;
      this.pending = undefined;
      safeLocalStorageRemove(ACTIVE_RETRIEVAL_RECOVERY_KEY);
      if (session) this.writeLocal(canonicalActiveRetrievalSession(session));
    }

    async clear(): Promise<void> {
      if (this.debounceHandle) window.clearTimeout(this.debounceHandle);
      this.debounceHandle = 0;
      this.pending = undefined;
      safeLocalStorageRemove(ACTIVE_RETRIEVAL_RECOVERY_KEY);
      this.writeChain = this.writeChain
        .catch((error) => this.data.recordDiagnostic("active-retrieval.previous-clear", "serialised active retrieval clear", error))
        .then(() => this.data.delete(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID))
        .catch((error) => {
          this.data.recordDiagnostic("active-retrieval.indexeddb.clear", "clear active retrieval", error);
          throw error;
        });
      return this.writeChain;
    }
  }
