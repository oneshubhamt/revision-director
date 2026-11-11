  class RevisionService {
    private settings = defaultSettings();
    private readonly router: SchedulerPolicyRouter;

    constructor(private readonly repo: RevisionData) {
      this.router = new SchedulerPolicyRouter(() => this.settings.desiredRetention);
    }

    async initialize(): Promise<void> {
      const stored = await this.repo.get(Store.Settings, "app");
      this.settings = stored ?? defaultSettings();
      await prepareFsrsScheduler(this.settings.desiredRetention);
      if (!stored) await this.repo.put(Store.Settings, this.settings);
      const profiles = await this.profiles();
      const active = profiles.filter((profile) => profile.status === "active");
      if (this.settings.activeProfileId && !active.some((profile) => profile.id === this.settings.activeProfileId)) {
        this.settings.activeProfileId = active[0]?.id ?? "";
        await this.repo.put(Store.Settings, this.settings);
      }
    }

    storageHealth(): StorageHealthSnapshot {
      return this.repo.storageHealth();
    }

    async refreshStorageHealth(requestPersistence = false): Promise<StorageHealthSnapshot> {
      return this.repo.refreshStorageHealth(requestPersistence);
    }

    diagnostics(): DiagnosticRecord[] {
      return this.repo.diagnostics();
    }

    getSettings(): AppSettings {
      return clone(this.settings);
    }

    async saveSettings(next: AppSettings): Promise<void> {
      assert(Number.isFinite(next.desiredRetention) && next.desiredRetention >= 0.75 && next.desiredRetention <= 0.97, "Desired retention must be between 75% and 97%.");
      assert(Number.isInteger(next.dailyCapacityMinutes) && next.dailyCapacityMinutes >= 5 && next.dailyCapacityMinutes <= 600, "Daily capacity is invalid.");
      assert(Number.isInteger(next.studyDayBoundaryHour) && next.studyDayBoundaryHour >= 0 && next.studyDayBoundaryHour <= 12, "Study-day boundary is invalid.");
      const activeProfiles = (await this.profiles()).filter((profile) => profile.status === "active");
      if (activeProfiles.length > 0) {
        const profile = await this.repo.get(Store.Profiles, next.activeProfileId);
        assert(profile?.status === "active", "Default exam profile is invalid.");
      } else assert(next.activeProfileId === "", "Create an active exam profile before selecting a default profile.");
      await prepareFsrsScheduler(next.desiredRetention);
      this.settings = canonicalAppSettings(next);
      await this.repo.put(Store.Settings, this.settings);
    }

    async profiles(): Promise<ExamProfile[]> {
      return (await this.repo.getAll(Store.Profiles)).sort((a, b) => a.name.localeCompare(b.name));
    }

    async profile(id: string): Promise<ExamProfile> {
      const profile = await this.repo.get(Store.Profiles, id);
      assert(profile, "Exam profile not found.");
      return profile;
    }

    async createProfile(name: string, examDate: string): Promise<ExamProfile> {
      assert(name.trim().length >= 2, "Enter an exam-profile name.");
      if (examDate) validateCalendarDate(examDate);
      const time = nowIso();
      const profile: ExamProfile = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: uid("profile"),
        name: name.trim(),
        examDate,
        status: "active",
        createdAt: time,
        updatedAt: time,
      };
      await this.repo.put(Store.Profiles, profile);
      if (!this.settings.activeProfileId) {
        this.settings.activeProfileId = profile.id;
        await this.repo.put(Store.Settings, this.settings);
      }
      return profile;
    }

    async updateProfile(id: string, name: string, examDate: string, status: "active" | "suspended"): Promise<ExamProfile> {
      const profile = await this.profile(id);
      assert(name.trim().length >= 2, "Enter an exam-profile name.");
      if (examDate) validateCalendarDate(examDate);
      assert(status === "active" || status === "suspended", "Exam profile status is invalid.");
      profile.name = name.trim();
      profile.examDate = examDate;
      profile.status = status;
      profile.updatedAt = nowIso();
      await this.repo.put(Store.Profiles, profile);
      if (status !== "active" && this.settings.activeProfileId === profile.id) {
        const replacement = (await this.profiles()).find((candidate) => candidate.status === "active" && candidate.id !== profile.id);
        if (replacement) {
          this.settings.activeProfileId = replacement.id;
          await this.repo.put(Store.Settings, this.settings);
        }
      }
      return profile;
    }

    async nodes(): Promise<KnowledgeNode[]> {
      return this.repo.getAll(Store.Nodes);
    }

    async ensureNode(profileId: string, parentId: string | null, kind: KnowledgeNodeKind, name: string): Promise<KnowledgeNode> {
      assert(name.trim().length > 0, `Enter a ${kind} name.`);
      const existing = await this.repo.findNode(profileId, parentId, kind, name);
      if (existing) return existing;
      const time = nowIso();
      const node: KnowledgeNode = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: uid(kind),
        profileId,
        parentId,
        kind,
        name: name.trim().replace(/\s+/g, " "),
        normalizedName: normalizeName(name),
        createdAt: time,
        updatedAt: time,
      };
      try {
        await this.repo.put(Store.Nodes, node);
        return node;
      } catch (error) {
        const concurrent = await this.repo.findNode(profileId, parentId, kind, name);
        if (concurrent) return concurrent;
        throw error;
      }
    }

    async ensureHierarchy(profileId: string, subjectName: string, sectionName: string, topicName: string): Promise<{ subject: KnowledgeNode; section: KnowledgeNode; topic: KnowledgeNode }> {
      await this.profile(profileId);
      const subject = await this.ensureNode(profileId, null, "subject", subjectName);
      const section = await this.ensureNode(profileId, subject.id, "section", sectionName);
      const topic = await this.ensureNode(profileId, section.id, "topic", topicName);
      return { subject, section, topic };
    }

    async hierarchyPath(topicNodeId: string): Promise<{ subject: string; section: string; topic: string }> {
      const topic = await this.repo.get(Store.Nodes, topicNodeId);
      assert(topic?.kind === "topic", "Topic node not found.");
      const section = topic.parentId ? await this.repo.get(Store.Nodes, topic.parentId) : undefined;
      assert(section?.kind === "section", "Section node not found.");
      const subject = section.parentId ? await this.repo.get(Store.Nodes, section.parentId) : undefined;
      assert(subject?.kind === "subject", "Subject node not found.");
      return { subject: subject.name, section: section.name, topic: topic.name };
    }

    async units(): Promise<KnowledgeUnit[]> {
      return (await this.repo.getAll(Store.Units)).sort((a, b) => a.title.localeCompare(b.title));
    }

    async unit(id: string): Promise<KnowledgeUnit> {
      const unit = await this.repo.get(Store.Units, id);
      assert(unit, "Knowledge unit not found.");
      return unit;
    }

    async createUnit(draft: UnitDraft): Promise<KnowledgeUnit> {
      assert(draft.title.trim().length >= 2, "Enter a knowledge-unit name.");
      assert(draft.scope.trim().length >= 3, "Define the unit scope.");
      assert(draft.protocol.trim().length >= 3, "Define a retrieval protocol.");
      assert(draft.successCriteria.trim().length >= 3, "Define success criteria.");
      const hierarchy = await this.ensureHierarchy(draft.profileId, draft.subject, draft.section, draft.topic);
      const time = nowIso();
      const unit: KnowledgeUnit = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: uid("unit"),
        profileId: draft.profileId,
        topicNodeId: hierarchy.topic.id,
        title: draft.title.trim(),
        scope: draft.scope.trim(),
        source: draft.source.trim(),
        importance: draft.importance,
        status: "active",
        createdAt: time,
        updatedAt: time,
        evidenceCount: 0,
        lapseCount: 0,
      };
      const obligation = this.buildObligation({
        unitId: unit.id,
        type: draft.obligationType,
        expectedMinutes: draft.expectedMinutes,
        protocol: draft.protocol,
        successCriteria: draft.successCriteria,
        dueAt: draft.firstDueAt,
        freshnessDays: draft.freshnessDays,
        workflow: draft.workflow,
      });
      await this.repo.createUnitWithObligation(unit, obligation);
      return unit;
    }

    async updateUnitStatus(id: string, status: EntityStatus): Promise<void> {
      const unit = await this.unit(id);
      unit.status = status;
      unit.updatedAt = nowIso();
      const obligations = await this.obligationsForUnit(id);
      for (const obligation of obligations) {
        if (status === "active" && obligation.status === "suspended" && obligation.suspensionReason === "unit") {
          obligation.status = "active";
          delete obligation.suspensionReason;
        } else if (status === "suspended" && obligation.status === "active") {
          obligation.status = "suspended";
          obligation.suspensionReason = "unit";
        } else if (status === "archived") {
          obligation.status = "archived";
          delete obligation.suspensionReason;
        }
        obligation.updatedAt = nowIso();
      }
      await this.repo.updateUnitWithObligations(unit, obligations);
    }

    async obligations(): Promise<RevisionObligation[]> {
      return this.repo.getAll(Store.Obligations);
    }

    async obligation(id: string): Promise<RevisionObligation> {
      const obligation = await this.repo.get(Store.Obligations, id);
      assert(obligation, "Revision obligation not found.");
      return obligation;
    }

    async obligationsForUnit(unitId: string): Promise<RevisionObligation[]> {
      return (await this.repo.getByIndex(Store.Obligations, "unitId", unitId)).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    }

    private buildObligation(draft: ObligationDraft, relation?: { parentObligationId?: string; returnObligationId?: string }): RevisionObligation {
      assert(draft.expectedMinutes >= 1 && draft.expectedMinutes <= 240, "Expected minutes are invalid.");
      assert(draft.protocol.trim().length >= 3 && draft.successCriteria.trim().length >= 3, "Protocol and success criteria are required.");
      validateWorkflowSpec(draft.workflow, draft.type);
      parseDate(draft.dueAt);
      const policy = this.router.get(draft.type);
      const time = nowIso();
      const id = uid("obligation");
      const obligation: RevisionObligation = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id,
        unitId: draft.unitId,
        type: draft.type,
        status: "active",
        dueAt: draft.dueAt,
        expectedMinutes: draft.expectedMinutes,
        baselineMinutes: draft.expectedMinutes,
        durationSampleCount: 0,
        protocol: draft.protocol.trim(),
        successCriteria: draft.successCriteria.trim(),
        workflow: clone(draft.workflow),
        freshnessDays: clamp(Math.round(draft.freshnessDays), 1, 3650),
        priority: 0,
        policyState: policy.createInitialState(draft.dueAt, id),
        createdAt: time,
        updatedAt: time,
      };
      if (relation?.parentObligationId) obligation.parentObligationId = relation.parentObligationId;
      if (relation?.returnObligationId) obligation.returnObligationId = relation.returnObligationId;
      return obligation;
    }

    async createObligation(draft: ObligationDraft, relation?: { parentObligationId?: string; returnObligationId?: string }): Promise<RevisionObligation> {
      const unit = await this.unit(draft.unitId);
      if (relation?.parentObligationId) {
        const parent = await this.obligation(relation.parentObligationId);
        assert(parent.unitId === unit.id, "Parent obligation belongs to a different knowledge unit.");
      }
      if (relation?.returnObligationId) {
        const target = await this.obligation(relation.returnObligationId);
        assert(target.unitId === unit.id, "Return obligation belongs to a different knowledge unit.");
      }
      const obligation = this.buildObligation(draft, relation);
      await this.repo.put(Store.Obligations, obligation);
      return obligation;
    }

    async joinedObligations(status: ObligationStatus | "all" = "active"): Promise<JoinedObligation[]> {
      const obligations = await this.obligations();
      const units = await this.units();
      const profiles = await this.profiles();
      const nodes = await this.nodes();
      const unitMap = new Map(units.map((unit) => [unit.id, unit]));
      const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
      const nodeMap = new Map(nodes.map((node) => [node.id, node]));
      const joined: JoinedObligation[] = [];
      for (const obligation of obligations) {
        if (status !== "all" && obligation.status !== status) continue;
        const unit = unitMap.get(obligation.unitId);
        if (!unit || unit.status !== "active") continue;
        const profile = profileMap.get(unit.profileId);
        const topicNode = nodeMap.get(unit.topicNodeId);
        const sectionNode = topicNode?.parentId ? nodeMap.get(topicNode.parentId) : undefined;
        const subjectNode = sectionNode?.parentId ? nodeMap.get(sectionNode.parentId) : undefined;
        if (!profile || !topicNode || !sectionNode || !subjectNode) continue;
        joined.push({ obligation, unit, profile, subject: subjectNode.name, section: sectionNode.name, topic: topicNode.name });
      }
      return joined.sort((a, b) => {
        const byDue = a.obligation.dueAt.localeCompare(b.obligation.dueAt);
        if (byDue !== 0) return byDue;
        const byPriority = b.obligation.priority - a.obligation.priority;
        if (byPriority !== 0) return byPriority;
        const byImportance = b.unit.importance - a.unit.importance;
        if (byImportance !== 0) return byImportance;
        return a.obligation.createdAt.localeCompare(b.obligation.createdAt);
      });
    }

    async chunks(): Promise<ObligationChunk[]> {
      return this.repo.getAll(Store.Chunks);
    }

    async chunk(id: string): Promise<ObligationChunk> {
      const chunk = await this.repo.get(Store.Chunks, id);
      assert(chunk, "Split-session chunk not found.");
      return chunk;
    }

    async chunksForObligation(obligationId: string): Promise<ObligationChunk[]> {
      return (await this.repo.getByIndex(Store.Chunks, "obligationId", obligationId))
        .sort((a, b) => a.ordinal - b.ordinal);
    }

    async dailyPlanHistory(): Promise<DailyPlanRecord[]> {
      return (await this.repo.getAll(Store.DailyPlans)).sort((a, b) => b.studyDayKey.localeCompare(a.studyDayKey));
    }

    private async ensureAutomaticChunking(joined: JoinedObligation[], capacityMinutes: number, reference: Date): Promise<Map<string, ObligationChunk>> {
      const allChunks = await this.chunks();
      const byObligation = new Map<string, ObligationChunk[]>();
      for (const chunk of allChunks) {
        const list = byObligation.get(chunk.obligationId) ?? [];
        list.push(chunk); byObligation.set(chunk.obligationId, list);
      }
      const nextChunk = new Map<string, ObligationChunk>();
      const dayEnd = studyDayEnd(reference, this.settings.studyDayBoundaryHour);
      for (const item of joined) {
        if (item.profile.status !== "active") continue;
        const daysToExam = daysToExamination(item.profile, reference);
        if (examDateTime(item.profile) && daysToExam < 0) continue;
        const lookaheadDays = planningLookaheadDays(daysToExam);
        if (new Date(item.obligation.dueAt).getTime() > dayEnd.getTime() + lookaheadDays * DAY_MS) continue;

        const obligation = item.obligation;
        let chunks = byObligation.get(obligation.id) ?? [];
        if (obligation.chunking?.status === "chunking" && obligation.chunking.completedChunks === 0 && obligation.chunking.capacityMinutes !== capacityMinutes) {
          const time = nowIso();
          const priorCycle = obligation.chunking.cycleId;
          const archived = chunks.filter((chunk) => chunk.cycleId === priorCycle && chunk.status !== "archived").map((chunk) => ({ ...chunk, status: "archived" as const, updatedAt: time, note: chunk.note || "Replanned before execution because daily capacity changed." }));
          chunks = chunks.map((chunk) => archived.find((entry) => entry.id === chunk.id) ?? chunk);
          delete obligation.chunking;
          obligation.updatedAt = time;
          if (obligation.expectedMinutes > capacityMinutes) {
            const created = createAutomaticChunks(item, capacityMinutes);
            obligation.chunking = created.state;
            chunks.push(...created.chunks);
            await this.repo.putObligationWithChunks(obligation, [...archived, ...created.chunks]);
          } else {
            await this.repo.putObligationWithChunks(obligation, archived);
          }
          byObligation.set(obligation.id, chunks);
        }
        if (!obligation.chunking && obligation.expectedMinutes > capacityMinutes) {
          const created = createAutomaticChunks(item, capacityMinutes);
          obligation.chunking = created.state;
          obligation.updatedAt = nowIso();
          chunks = [...chunks, ...created.chunks];
          byObligation.set(obligation.id, chunks);
          await this.repo.putObligationWithChunks(obligation, created.chunks);
        }
        if (obligation.chunking?.status === "chunking") {
          const pending = chunks.filter((chunk) => chunk.cycleId === obligation.chunking!.cycleId && chunk.status === "pending").sort((a, b) => a.ordinal - b.ordinal);
          if (pending[0]) nextChunk.set(obligation.id, pending[0]);
          else if (obligation.chunking.completedChunks >= obligation.chunking.totalChunks) {
            obligation.chunking.status = "synthesis-ready";
            obligation.updatedAt = nowIso();
            await this.repo.put(Store.Obligations, obligation);
          }
        }
      }
      return nextChunk;
    }

    private async existingPendingChunks(joined: JoinedObligation[]): Promise<Map<string, ObligationChunk>> {
      const chunks = await this.chunks();
      const result = new Map<string, ObligationChunk>();
      for (const item of joined) {
        const state = item.obligation.chunking;
        if (!state || state.status !== "chunking") continue;
        const pending = chunks
          .filter((chunk) => chunk.obligationId === item.obligation.id && chunk.cycleId === state.cycleId && chunk.status === "pending")
          .sort((a, b) => a.ordinal - b.ordinal)[0];
        if (pending) result.set(item.obligation.id, pending);
      }
      return result;
    }

    async dueQueue(now = new Date()): Promise<JoinedObligation[]> {
      const end = studyDayEnd(now, this.settings.studyDayBoundaryHour).getTime();
      const reference = studyDayStart(now, this.settings.studyDayBoundaryHour);
      return (await this.joinedObligations("active")).filter((item) => {
        if (item.profile.status !== "active") return false;
        if (examDateTime(item.profile) && daysToExamination(item.profile, reference) < 0) return false;
        return new Date(item.obligation.dueAt).getTime() < end;
      });
    }

    private planSnapshot(plan: Omit<DailyRevisionPlan, "planRecordId" | "versionNumber">, reason: DailyPlanVersion["reason"], version: number): DailyPlanVersion {
      const snapshotItems = (items: PlannedQueueItem[], disposition: DailyPlanItemSnapshot["disposition"]): DailyPlanItemSnapshot[] => items.map((item) => ({
        key: planItemKey(item.joined.obligation.id, item.chunk?.id),
        obligationId: item.joined.obligation.id,
        ...(item.chunk ? { chunkId: item.chunk.id } : {}),
        profileId: item.joined.profile.id,
        unitId: item.joined.unit.id,
        subject: item.joined.subject,
        workflow: item.joined.obligation.workflow.kind,
        title: item.chunk?.label ?? item.joined.unit.title,
        estimatedMinutes: item.executionMinutes,
        score: item.score,
        disposition,
        reasons: [...item.reasons],
      }));
      return {
        version,
        generatedAt: plan.generatedAt,
        capacityMinutes: plan.capacityMinutes,
        items: [
          ...snapshotItems(plan.selected.filter((item) => !plan.requiredOverrun.includes(item)), "selected"),
          ...snapshotItems(plan.requiredOverrun, "required-overrun"),
          ...snapshotItems(plan.mustSplit, "must-split"),
          ...snapshotItems(plan.deferred, "deferred"),
        ],
        reason,
      };
    }

    private async persistDailyPlan(plan: Omit<DailyRevisionPlan, "planRecordId" | "versionNumber">, regenerate: boolean): Promise<{ id: string; version: number }> {
      let record = await this.repo.dailyPlanByStudyDay(plan.studyDayKey);
      if (!record) {
        const time = nowIso();
        const initial = this.planSnapshot(plan, "initial", 1);
        record = {
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          id: uid("dayplan"), studyDayKey: plan.studyDayKey, createdAt: time, updatedAt: time,
          plannerVersion: PLANNER_VERSION,
          versions: [initial],
          outcomes: initial.items
            .filter((item) => item.disposition === "selected" || item.disposition === "required-overrun")
            .map((item) => ({ itemKey: item.key, status: "planned" as const })),
        };
        await this.repo.put(Store.DailyPlans, record);
      } else {
        const version = record.versions.length + 1;
        const next = this.planSnapshot(plan, regenerate ? "manual-regeneration" : "data-change", version);
        const latest = record.versions.at(-1)!;
        const signature = (value: DailyPlanVersion) => JSON.stringify({
          capacityMinutes: value.capacityMinutes,
          items: value.items.map((item) => ({
            key: item.key,
            disposition: item.disposition,
            estimatedMinutes: item.estimatedMinutes,
            score: item.score,
            reasons: item.reasons,
          })),
        });
        if (regenerate || signature(next) !== signature(latest)) {
          record.versions.push(next);
          for (const item of next.items.filter((entry) => entry.disposition === "selected" || entry.disposition === "required-overrun")) {
            if (!record.outcomes.some((outcome) => outcome.itemKey === item.key)) record.outcomes.push({ itemKey: item.key, status: "planned" });
          }
          record.updatedAt = nowIso();
          record.plannerVersion = PLANNER_VERSION;
          await this.repo.put(Store.DailyPlans, record);
        }
      }
      return { id: record.id, version: record.versions.at(-1)?.version ?? 1 };
    }

    private async manualPlanItem(obligationId: string, chunkId?: string): Promise<DailyPlanItemSnapshot | undefined> {
      const joined = (await this.joinedObligations()).find((item) => item.obligation.id === obligationId);
      if (!joined) return undefined;
      const chunk = chunkId ? await this.repo.get(Store.Chunks, chunkId) : undefined;
      if (chunkId && !chunk) return undefined;
      return {
        key: planItemKey(obligationId, chunkId),
        obligationId,
        ...(chunkId ? { chunkId } : {}),
        profileId: joined.profile.id,
        unitId: joined.unit.id,
        subject: joined.subject,
        workflow: joined.obligation.workflow.kind,
        title: chunk?.label ?? joined.unit.title,
        estimatedMinutes: chunk?.expectedMinutes ?? (joined.obligation.chunking?.status === "synthesis-ready" ? joined.obligation.chunking.synthesisMinutes : joined.obligation.expectedMinutes),
        score: 0,
        disposition: "selected",
        reasons: ["manually added during execution"],
      };
    }

    private appendManualPlanItems(record: DailyPlanRecord, items: DailyPlanItemSnapshot[], now: Date): void {
      const latest = record.versions.at(-1)!;
      const nextItems = latest.items.map((item) => clone(item));
      let changed = false;
      for (const item of items) {
        const index = nextItems.findIndex((entry) => entry.key === item.key);
        if (index < 0) {
          nextItems.push(clone(item));
          changed = true;
          continue;
        }
        const existing = nextItems[index]!;
        if (existing.disposition !== "selected" && existing.disposition !== "required-overrun") {
          nextItems[index] = clone(item);
          changed = true;
        }
      }
      if (!changed) return;
      record.versions.push({
        version: latest.version + 1,
        generatedAt: now.toISOString(),
        capacityMinutes: latest.capacityMinutes,
        items: nextItems,
        reason: "manual-addition",
      });
      record.plannerVersion = PLANNER_VERSION;
    }

    async markReviewTargetsStarted(targets: string[], now = new Date()): Promise<void> {
      const key = studyDayKey(now, this.settings.studyDayBoundaryHour);
      const record = await this.repo.dailyPlanByStudyDay(key);
      if (!record) return;
      const items: DailyPlanItemSnapshot[] = [];
      for (const target of targets) {
        if (target.startsWith("chunk:")) {
          const chunk = await this.chunk(target.slice(6));
          const item = await this.manualPlanItem(chunk.obligationId, chunk.id);
          if (item) items.push(item);
        } else {
          const item = await this.manualPlanItem(target);
          if (item) items.push(item);
        }
      }
      this.appendManualPlanItems(record, items, now);
      for (const item of items) {
        const existing = record.outcomes.find((outcome) => outcome.itemKey === item.key);
        if (existing) {
          if (existing.status === "planned") { existing.status = "started"; existing.startedAt = now.toISOString(); }
        } else record.outcomes.push({ itemKey: item.key, status: "started", startedAt: now.toISOString() });
      }
      record.updatedAt = now.toISOString();
      await this.repo.put(Store.DailyPlans, record);
    }

    private async completedPlanRecord(obligationId: string, chunkId: string | undefined, actualMinutes: number, completedAt: Date, evidenceEventId?: string): Promise<DailyPlanRecord | undefined> {
      const key = studyDayKey(completedAt, this.settings.studyDayBoundaryHour);
      const record = await this.repo.dailyPlanByStudyDay(key);
      if (!record) return undefined;
      const item = await this.manualPlanItem(obligationId, chunkId);
      if (item) this.appendManualPlanItems(record, [item], completedAt);
      const itemKey = planItemKey(obligationId, chunkId);
      let outcome = record.outcomes.find((entry) => entry.itemKey === itemKey);
      if (!outcome) { outcome = { itemKey, status: "completed" }; record.outcomes.push(outcome); }
      outcome.status = "completed";
      outcome.completedAt = completedAt.toISOString();
      outcome.actualMinutes = roundTo(actualMinutes, 1);
      if (evidenceEventId) outcome.evidenceEventId = evidenceEventId;
      record.updatedAt = completedAt.toISOString();
      return record;
    }

    async completeChunk(chunkId: string, timing: TimingEvidenceSummary, note = "", completedAt = new Date(), commitGuard?: ActiveCommitGuard, postCommitSession?: ActiveRetrievalSession): Promise<ObligationChunk> {
      const chunk = await this.repo.get(Store.Chunks, chunkId);
      assert(chunk && chunk.status === "pending", "This split session is no longer pending.");
      const obligation = await this.obligation(chunk.obligationId);
      assert(obligation.chunking?.cycleId === chunk.cycleId && obligation.chunking.status === "chunking", "Split-session state is inconsistent.");
      const canonicalTiming = canonicalTimingEvidenceSummary(timing);
      const actualMinutes = roundTo(Math.max(1, canonicalTiming.totalActiveMs / 60_000), 1);
      assert(actualMinutes <= 240, "Split-session duration is invalid.");
      chunk.status = "completed"; chunk.completedAt = completedAt.toISOString(); chunk.actualMinutes = actualMinutes; chunk.note = note.trim(); chunk.timing = canonicalTiming; chunk.updatedAt = completedAt.toISOString();
      obligation.chunking.completedChunks += 1;
      if (obligation.chunking.completedChunks >= obligation.chunking.totalChunks) {
        obligation.chunking.status = "synthesis-ready";
      }
      obligation.updatedAt = completedAt.toISOString();
      const dailyPlan = await this.completedPlanRecord(obligation.id, chunk.id, actualMinutes, completedAt);
      await this.repo.updateChunkWithObligation(chunk, obligation, dailyPlan, commitGuard, postCommitSession);
      return chunk;
    }

    async dailyPlan(now = new Date(), regenerate = false, persist = true): Promise<DailyRevisionPlan> {
      assert(!regenerate || persist, "A read-only plan cannot be manually regenerated.");
      const planningReference = studyDayStart(now, this.settings.studyDayBoundaryHour);
      const joined = await this.joinedObligations("active");
      const evidence = await this.evidenceEvents();
      const planHistory = await this.dailyPlanHistory();
      const balance = weeklySubjectBalanceScores(joined, planHistory, planningReference, this.settings.studyDayBoundaryHour);
      const pendingChunks = persist
        ? await this.ensureAutomaticChunking(joined, this.settings.dailyCapacityMinutes, planningReference)
        : await this.existingPendingChunks(joined);
      const candidates = joined
        .map((item) => buildPlanningCandidate(item, evidence, this.settings, planningReference, balance.get(subjectBalanceKey(item.profile.id, item.subject)) ?? 0.5, pendingChunks.get(item.obligation.id)))
        .filter((item): item is PlannedQueueItem => Boolean(item));
      const packed = choosePlanItems(candidates, this.settings.dailyCapacityMinutes);
      const plannedMinutes = packed.selected.reduce((sum, item) => sum + item.executionMinutes, 0);
      const base = {
        generatedAt: now.toISOString(),
        studyDayKey: studyDayKey(now, this.settings.studyDayBoundaryHour),
        capacityMinutes: this.settings.dailyCapacityMinutes,
        candidateMinutes: candidates.reduce((sum, item) => sum + item.executionMinutes, 0),
        plannedMinutes,
        selected: packed.selected,
        requiredOverrun: packed.requiredOverrun,
        mustSplit: packed.mustSplit,
        deferred: packed.deferred,
        overdueCount: packed.selected.filter((item) => item.dueState === "overdue").length,
        dueCount: packed.selected.filter((item) => item.dueState !== "brought-forward").length,
        broughtForwardCount: packed.selected.filter((item) => item.dueState === "brought-forward").length,
      };
      if (!persist) {
        const existing = await this.repo.dailyPlanByStudyDay(base.studyDayKey);
        return { ...base, planRecordId: existing?.id ?? "", versionNumber: existing?.versions.at(-1)?.version ?? 0 };
      }
      const persisted = await this.persistDailyPlan(base, regenerate);
      return { ...base, planRecordId: persisted.id, versionNumber: persisted.version };
    }

    async preview(obligationId: string, now = new Date()): Promise<SchedulePreview[]> {
      const obligation = await this.obligation(obligationId);
      return this.router.get(obligation.type).preview(obligation, now);
    }

    async recordEvidence(obligationId: string, draft: EvidenceDraft, reviewedAt = new Date(), commitGuard?: ActiveCommitGuard, postCommitSession?: ActiveRetrievalSession): Promise<EvidenceEvent> {
      const timing = canonicalTimingEvidenceSummary(draft.timing);
      const normalizedDraft: EvidenceDraft = { ...draft, elapsedMs: timing.totalActiveMs, timing };
      validateEvidence(normalizedDraft);
      const confirmed = validateRating(normalizedDraft.confirmedRating);
      const obligation = await this.obligation(obligationId);
      validateWorkflowSpec(obligation.workflow, obligation.type);
      validateWorkflowResult(normalizedDraft.workflowResult, obligation.workflow.kind);
      assert(obligation.status === "active", "This obligation is not active.");
      const unit = await this.unit(obligation.unitId);
      const priorEvidence = await this.evidenceEvents();
      const cycleChunks = obligation.chunking?.status === "synthesis-ready" ? (await this.chunksForObligation(obligation.id)).filter((chunk) => chunk.cycleId === obligation.chunking!.cycleId && chunk.status === "completed") : [];
      const cycleChunkMs = cycleChunks.reduce((sum, chunk) => sum + (chunk.actualMinutes ?? 0) * 60_000, 0);
      const cycleTimingReliable = cycleChunks.every((chunk) => chunk.timing?.durationReliable !== false);
      const durationObservation = durationObservationFor(obligation, priorEvidence, normalizedDraft.elapsedMs + cycleChunkMs, timing.durationReliable && cycleTimingReliable);
      const beforePolicyState = clone(obligation.policyState);
      const beforeDueAt = obligation.dueAt;
      const suggested = suggestRating(obligation.type, normalizedDraft);
      const completion = this.router.get(obligation.type).complete(obligation, confirmed, normalizedDraft, reviewedAt);

      obligation.dueAt = completion.dueAt;
      obligation.policyState = completion.policyState;
      obligation.updatedAt = reviewedAt.toISOString();
      obligation.lastCompletedAt = reviewedAt.toISOString();
      if (durationObservation.accepted) {
        obligation.expectedMinutes = durationObservation.estimateAfter;
        obligation.durationSampleCount = durationObservation.exactSamples;
      }

      const chunkUpdates: ObligationChunk[] = [];
      if (obligation.chunking?.status === "synthesis-ready") {
        const cycleId = obligation.chunking.cycleId;
        for (const chunk of await this.chunksForObligation(obligation.id)) {
          if (chunk.cycleId !== cycleId || chunk.status === "archived") continue;
          chunk.status = "archived";
          chunk.updatedAt = reviewedAt.toISOString();
          chunkUpdates.push(chunk);
        }
        delete obligation.chunking;
      }

      unit.latestEvidenceAt = reviewedAt.toISOString();
      unit.latestEvidenceRating = confirmed;
      unit.evidenceCount += 1;
      if (confirmed === Rating.Again) unit.lapseCount += 1;
      unit.updatedAt = reviewedAt.toISOString();

      let followUp: RevisionObligation | undefined;
      let relatedObligation: RevisionObligation | undefined;
      let returnedMemoryTransition: ReturnedMemoryTransition | undefined;
      if (completion.followUpType === "relearn" && obligation.type !== "relearn") {
        obligation.status = "suspended";
        obligation.suspensionReason = "relearning";
        const existing = (await this.obligationsForUnit(unit.id)).find((item) => item.type === "relearn" && item.status === "active" && item.returnObligationId === obligation.id);
        if (!existing) {
          const dueAt = addDays(reviewedAt, 1).toISOString();
          const policy = this.router.get("relearn");
          const time = reviewedAt.toISOString();
          const followUpId = uid("obligation");
          followUp = {
            schemaVersion: DOCUMENT_SCHEMA_VERSION,
            id: followUpId,
            unitId: unit.id,
            type: "relearn",
            status: "active",
            dueAt,
            expectedMinutes: Math.max(10, obligation.expectedMinutes),
            baselineMinutes: Math.max(10, obligation.expectedMinutes),
            durationSampleCount: 0,
            protocol: `Relearn the weak foundations, then repeat: ${obligation.protocol}`,
            successCriteria: `Explain the corrected concept independently before returning to ${obligationLabel(obligation.type)}.`,
            workflow: {
              kind: "relearning",
              prompt: `Repair the failure, then verify independently: ${obligation.workflow.prompt}`,
              checkpoints: [...obligation.workflow.checkpoints],
              responseMedium: "in-app",
            },
            freshnessDays: obligation.freshnessDays,
            priority: obligation.priority + 2,
            policyState: policy.createInitialState(dueAt, followUpId),
            parentObligationId: obligation.id,
            returnObligationId: obligation.id,
            createdAt: time,
            updatedAt: time,
          };
        }
      }

      const relearningMastered =
        obligation.type === "relearn" &&
        confirmed >= Rating.Good &&
        objectiveScore(obligation.type, normalizedDraft) >= 2.7 &&
        beforePolicyState.successStreak >= 1;
      if (relearningMastered) {
        obligation.status = "completed";
        if (obligation.returnObligationId) {
          const original = await this.repo.get(Store.Obligations, obligation.returnObligationId);
          if (original) {
            if (original.type === "memory-recall") {
              const returnedBeforeDueAt = original.dueAt;
              const returnedBeforePolicyState = clone(original.policyState);
              const resumed = this.router.get("memory-recall").complete(original, Rating.Good, normalizedDraft, reviewedAt);
              assert(resumed.schedulerConfig && resumed.reviewLog, "Returned memory review lacks FSRS-7 provenance.");
              original.dueAt = resumed.dueAt;
              original.policyState = resumed.policyState;
              original.lastCompletedAt = reviewedAt.toISOString();
              returnedMemoryTransition = {
                obligationId: original.id,
                rating: Rating.Good,
                beforeDueAt: returnedBeforeDueAt,
                afterDueAt: resumed.dueAt,
                beforePolicyState: returnedBeforePolicyState,
                afterPolicyState: clone(resumed.policyState),
                policyId: resumed.policyId,
                schedulerPackage: "ts-fsrs",
                schedulerVersion: FSRS_PACKAGE_VERSION,
                schedulerModel: FSRS_MODEL,
                schedulerConfig: clone(resumed.schedulerConfig),
                reviewLog: clone(resumed.reviewLog),
              };
            } else {
              original.dueAt = addDays(reviewedAt, 3).toISOString();
            }
            original.status = "active";
            delete original.suspensionReason;
            original.updatedAt = reviewedAt.toISOString();
            relatedObligation = original;
          }
        }
      }

      const evidence: ObjectiveEvidence = {
        completeness: normalizedDraft.completeness,
        independence: normalizedDraft.independence,
        application: normalizedDraft.application,
        errorTypes: [...normalizedDraft.errorTypes],
        correctionNote: normalizedDraft.correctionNote.trim(),
      };
      if (normalizedDraft.accuracyPercent !== undefined) evidence.accuracyPercent = normalizedDraft.accuracyPercent;

      const event: EvidenceEvent = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: commitGuard ? `evidence_${commitGuard.commitToken}` : uid("evidence"),
        profileId: unit.profileId,
        unitId: unit.id,
        obligationId: obligation.id,
        obligationType: obligation.type,
        reviewedAt: reviewedAt.toISOString(),
        elapsedMs: timing.totalActiveMs,
        evidence,
        workflow: obligation.workflow.kind,
        workflowResult: clone(normalizedDraft.workflowResult),
        suggestedRating: suggested,
        confirmedRating: confirmed,
        beforeDueAt,
        afterDueAt: obligation.dueAt,
        beforePolicyState,
        afterPolicyState: clone(obligation.policyState),
        policyId: completion.policyId,
        durationObservation,
        timing,
        createdAt: nowIso(),
      };
      if (completion.reviewLog) event.reviewLog = completion.reviewLog;
      if (completion.schedulerConfig) event.schedulerConfig = clone(completion.schedulerConfig);
      if (obligation.type === "memory-recall") {
        event.schedulerPackage = "ts-fsrs";
        event.schedulerVersion = FSRS_PACKAGE_VERSION;
        const card = obligation.policyState.fsrsCard;
        assert(card?.model === FSRS_MODEL, "Memory evidence cannot be committed without current FSRS-7 state.");
        event.schedulerModel = FSRS_MODEL;
      }
      if (followUp) event.followUpObligationId = followUp.id;
      if (returnedMemoryTransition) event.returnedMemoryTransition = returnedMemoryTransition;

      const dailyPlan = await this.completedPlanRecord(obligation.id, undefined, roundTo(timing.totalActiveMs / 60_000, 1), reviewedAt, event.id);
      await this.repo.recordReview(unit, obligation, event, followUp, relatedObligation, chunkUpdates, dailyPlan, commitGuard, postCommitSession);
      return event;
    }

    async studyEvents(): Promise<StudyEvent[]> {
      return (await this.repo.getAll(Store.StudyEvents)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    }

    async logStudyEvent(draft: StudyEventDraft): Promise<StudyEvent> {
      await this.profile(draft.profileId);
      assert(["learn", "review", "practice", "test"].includes(draft.activityMode), "Study activity mode is invalid.");
      assert(draft.origin === "manual" || draft.origin === "study-director", "Study origin is invalid.");
      assert(draft.understanding === 1 || draft.understanding === 2 || draft.understanding === 3 || draft.understanding === 4, "Study understanding is invalid.");
      parseDate(draft.occurredAt);
      assert(draft.area.trim() && draft.task.trim() && draft.measure.trim(), "Area, task and measure are required.");
      assert(Number.isFinite(draft.durationMinutes) && draft.durationMinutes >= 1 && draft.durationMinutes <= 1440, "Duration is invalid.");
      assert(Array.isArray(draft.linkedUnitIds), "Study Event links are invalid.");
      for (const unitId of draft.linkedUnitIds) {
        const unit = await this.unit(unitId);
        assert(unit.profileId === draft.profileId, "Study Event cannot link a knowledge unit from another exam profile.");
      }
      const event: StudyEvent = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: uid("study"),
        profileId: draft.profileId,
        occurredAt: draft.occurredAt,
        activityMode: draft.activityMode,
        area: draft.area.trim(),
        task: draft.task.trim(),
        measure: draft.measure.trim(),
        source: draft.source.trim(),
        durationMinutes: Math.round(draft.durationMinutes),
        understanding: draft.understanding,
        linkedUnitIds: [...new Set(draft.linkedUnitIds)],
        notes: draft.notes.trim(),
        origin: draft.origin,
        createdAt: nowIso(),
      };
      await this.repo.put(Store.StudyEvents, event);
      return event;
    }

    async evidenceEvents(): Promise<EvidenceEvent[]> {
      return (await this.repo.getAll(Store.EvidenceEvents)).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
    }

    async triggeringEvidence(relearningObligationId: string): Promise<EvidenceEvent | undefined> {
      const obligation = await this.obligation(relearningObligationId);
      if (obligation.type !== "relearn") return undefined;
      const events = await this.evidenceEvents();
      return events.find((event) => event.followUpObligationId === obligation.id)
        ?? events.find((event) => event.obligationId === obligation.parentObligationId);
    }

    async currentActiveRetrieval(): Promise<ActiveRetrievalSession | null> {
      return await this.repo.get(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID) ?? null;
    }

    async exportBackup(): Promise<BackupPayload> {
      return {
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: nowIso(),
        appVersion: APP_VERSION,
        profiles: await this.profiles(),
        nodes: await this.nodes(),
        units: await this.units(),
        studyEvents: await this.studyEvents(),
        obligations: await this.obligations(),
        evidenceEvents: await this.evidenceEvents(),
        chunks: await this.chunks(),
        dailyPlans: await this.dailyPlanHistory(),
        settings: this.getSettings(),
        activeRetrieval: await this.repo.get(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID) ?? null,
      };
    }

    async createBackupArchive(preferCompression = true): Promise<BackupArchiveArtifact> {
      const payload = this.validateBackup(await this.exportBackup());
      return BackupCodec.create(payload, preferCompression);
    }

    async inspectBackupArchive(bytes: Uint8Array): Promise<BackupInspectionMetadata> {
      return (await BackupCodec.decode(bytes, (input) => this.validateBackup(input))).inspection;
    }

    async decodeBackupArchive(bytes: Uint8Array): Promise<DecodedBackupArchive> {
      return BackupCodec.decode(bytes, (input) => this.validateBackup(input));
    }

    async restoreBackupPayload(payload: BackupPayload, activeTreatment: BackupActiveSessionTreatment): Promise<void> {
      const validated = this.validateBackup(payload);
      await prepareFsrsScheduler(validated.settings.desiredRetention);
      await this.repo.replaceFromBackup(validated, activeTreatment);
      this.settings = clone(validated.settings);
    }

    async rawStateForRescue(): Promise<Record<string, unknown[]>> {
      return this.repo.rawDump();
    }

    validateBackup(input: unknown): BackupPayload {
      assert(typeof input === "object" && input !== null, "Backup must be an object.");
      const candidate = input as Partial<BackupPayload>;
      assert(candidate.format === BACKUP_FORMAT && candidate.schemaVersion === BACKUP_SCHEMA_VERSION, "This is not a supported Revision Director backup.");
      assert(candidate.appVersion === APP_VERSION, "This backup was not created by the current Revision Director build.");
      assert(Array.isArray(candidate.profiles) && Array.isArray(candidate.nodes) && Array.isArray(candidate.units), "Backup collections are missing.");
      assert(Array.isArray(candidate.studyEvents) && Array.isArray(candidate.obligations) && Array.isArray(candidate.evidenceEvents), "Backup history is missing.");
      assert(Array.isArray(candidate.chunks) && Array.isArray(candidate.dailyPlans), "Backup planning history is missing.");
      assert(typeof candidate.settings === "object" && candidate.settings !== null, "Backup settings are missing.");
      assert(candidate.activeRetrieval === null || typeof candidate.activeRetrieval === "object", "Backup active retrieval is invalid.");

      const uniqueMap = <T extends { id: string }>(values: T[], label: string): Map<string, T> => {
        const map = new Map<string, T>();
        for (const value of values) {
          assert(typeof value.id === "string" && value.id.trim().length > 0, `${label} has an invalid ID.`);
          assert(!map.has(value.id), `${label} contains duplicate IDs.`);
          map.set(value.id, value);
        }
        return map;
      };
      const validDate = (value: unknown, label: string): void => {
        assert(typeof value === "string" && Number.isFinite(new Date(value).getTime()), `${label} has an invalid date.`);
      };
      const validRatingValue = (value: unknown, label: string): void => {
        assert(value === 1 || value === 2 || value === 3 || value === 4, `${label} has an invalid rating.`);
      };
      const profiles = candidate.profiles as ExamProfile[];
      const nodes = candidate.nodes as KnowledgeNode[];
      const units = candidate.units as KnowledgeUnit[];
      const studyEvents = candidate.studyEvents as StudyEvent[];
      const obligations = candidate.obligations as RevisionObligation[];
      const evidenceEvents = candidate.evidenceEvents as EvidenceEvent[];
      const chunks = candidate.chunks as ObligationChunk[];
      const dailyPlans = candidate.dailyPlans as DailyPlanRecord[];
      const settings = candidate.settings as AppSettings;
      const activeRetrieval = candidate.activeRetrieval as ActiveRetrievalSession | null;
      const profileMap = uniqueMap(profiles, "Profiles");
      const nodeMap = uniqueMap(nodes, "Knowledge nodes");
      const unitMap = uniqueMap(units, "Knowledge units");
      const obligationMap = uniqueMap(obligations, "Revision obligations");
      uniqueMap(studyEvents, "Study events");
      const evidenceMap = uniqueMap(evidenceEvents, "Evidence events");
      const chunkMap = uniqueMap(chunks, "Obligation chunks");
      uniqueMap(dailyPlans, "Daily plans");
      const studyDayKeys = new Set<string>();
      for (const profile of profiles) assertDocumentSchema(profile, "Backup exam profile");
      for (const node of nodes) assertDocumentSchema(node, "Backup knowledge node");
      for (const unit of units) assertDocumentSchema(unit, "Backup knowledge unit");
      for (const event of studyEvents) assertDocumentSchema(event, "Backup Study Event");
      for (const obligation of obligations) assertDocumentSchema(obligation, "Backup revision obligation");
      for (const event of evidenceEvents) assertDocumentSchema(event, "Backup Evidence Event");
      for (const chunk of chunks) assertDocumentSchema(chunk, "Backup obligation chunk");
      for (const plan of dailyPlans) assertDocumentSchema(plan, "Backup daily plan");

      for (const profile of profiles) {
        assert(profile.name.trim().length > 0 && ["active", "suspended", "archived"].includes(profile.status), "Profile data is invalid.");
        if (profile.examDate) validateCalendarDate(profile.examDate, "Profile exam date");
        validDate(profile.createdAt, "Profile"); validDate(profile.updatedAt, "Profile");
      }
      for (const node of nodes) {
        const profile = profileMap.get(node.profileId);
        assert(profile, "Knowledge node references a missing profile.");
        assert(node.name.trim().length > 0 && node.normalizedName === normalizeName(node.name), "Knowledge node name is invalid.");
        if (node.kind === "subject") assert(node.parentId === null, "Subject nodes cannot have parents.");
        if (node.kind === "section") {
          const parent = node.parentId ? nodeMap.get(node.parentId) : undefined;
          assert(parent?.kind === "subject" && parent.profileId === node.profileId, "Section must belong to a subject in the same profile.");
        }
        if (node.kind === "topic") {
          const parent = node.parentId ? nodeMap.get(node.parentId) : undefined;
          assert(parent?.kind === "section" && parent.profileId === node.profileId, "Topic must belong to a section in the same profile.");
        }
        validDate(node.createdAt, "Knowledge node"); validDate(node.updatedAt, "Knowledge node");
      }
      for (const unit of units) {
        const topic = nodeMap.get(unit.topicNodeId);
        assert(profileMap.has(unit.profileId) && topic?.kind === "topic" && topic.profileId === unit.profileId, "Knowledge unit references invalid hierarchy data.");
        assert(unit.title.trim().length > 0 && unit.scope.trim().length > 0, "Knowledge unit title or scope is missing.");
        assert(unit.importance === 1 || unit.importance === 2 || unit.importance === 3, "Knowledge unit importance is invalid.");
        assert(Number.isInteger(unit.evidenceCount) && unit.evidenceCount >= 0 && Number.isInteger(unit.lapseCount) && unit.lapseCount >= 0, "Knowledge unit counters are invalid.");
        if (unit.latestEvidenceAt) validDate(unit.latestEvidenceAt, "Knowledge unit evidence");
        if (unit.latestEvidenceRating !== undefined) validRatingValue(unit.latestEvidenceRating, "Knowledge unit");
      }
      for (const event of studyEvents) {
        assert(profileMap.has(event.profileId), "Study event references a missing profile.");
        validDate(event.occurredAt, "Study event"); validDate(event.createdAt, "Study event");
        assert(["learn", "review", "practice", "test"].includes(event.activityMode), "Study event activity is invalid.");
        assert(typeof event.area === "string" && event.area.trim().length > 0 && typeof event.task === "string" && event.task.trim().length > 0 && typeof event.measure === "string" && event.measure.trim().length > 0, "Study event canonical inputs are invalid.");
        assert(Number.isFinite(event.durationMinutes) && event.durationMinutes >= 1 && event.durationMinutes <= 1440, "Study event duration is invalid.");
        assert(event.understanding === 1 || event.understanding === 2 || event.understanding === 3 || event.understanding === 4, "Study event understanding is invalid.");
        assert(Array.isArray(event.linkedUnitIds), "Study event links are invalid.");
        for (const unitId of event.linkedUnitIds) {
          const unit = unitMap.get(unitId);
          assert(unit?.profileId === event.profileId, "Study event links a missing or cross-profile knowledge unit.");
        }
      }
      const engineFor: Record<ObligationType, PolicyState["engine"]> = {
        "memory-recall": "ts-fsrs", "concept-reconstruction": "mastery", "application-practice": "application",
        "performance-practice": "performance", relearn: "relearn", "freshness-review": "freshness",
      };
      for (const obligation of obligations) {
        const unit = unitMap.get(obligation.unitId);
        assert(unit, "Obligation references a missing unit.");
        assert(Object.hasOwn(engineFor, obligation.type), "Obligation type is invalid.");
        assert(["active", "completed", "suspended", "archived"].includes(obligation.status), "Obligation status is invalid.");
        if (obligation.status === "suspended") assert(obligation.suspensionReason === "unit" || obligation.suspensionReason === "relearning", "Suspended obligation lacks a valid reason.");
        else assert(obligation.suspensionReason === undefined, "Only suspended obligations may retain a suspension reason.");
        if (obligation.suspensionReason === "relearning") assert(obligationMap.size > 0, "Relearning suspension is invalid.");
        validDate(obligation.dueAt, "Obligation"); validDate(obligation.createdAt, "Obligation"); validDate(obligation.updatedAt, "Obligation");
        assert(Number.isFinite(obligation.expectedMinutes) && obligation.expectedMinutes >= 1 && obligation.expectedMinutes <= 240, "Obligation duration is invalid.");
        assert(Number.isFinite(obligation.baselineMinutes) && obligation.baselineMinutes >= 1 && obligation.baselineMinutes <= 240, "Obligation baseline duration is invalid.");
        assert(Number.isInteger(obligation.durationSampleCount) && obligation.durationSampleCount >= 0, "Obligation duration sample count is invalid.");
        if (obligation.chunking) {
          assert(obligation.chunking.status === "chunking" || obligation.chunking.status === "synthesis-ready", "Obligation chunking state is invalid.");
          assert(Number.isFinite(obligation.chunking.originalMinutes) && obligation.chunking.originalMinutes >= 1 && obligation.chunking.originalMinutes <= 240, "Obligation chunking original duration is invalid.");
          assert(Number.isFinite(obligation.chunking.synthesisMinutes) && obligation.chunking.synthesisMinutes >= 1 && obligation.chunking.synthesisMinutes < obligation.chunking.originalMinutes, "Obligation chunking synthesis duration is invalid.");
          assert(Number.isInteger(obligation.chunking.capacityMinutes) && obligation.chunking.capacityMinutes >= 5 && obligation.chunking.capacityMinutes <= 600, "Obligation chunking capacity is invalid.");
          assert(obligation.chunking.originalMinutes === obligation.expectedMinutes, "Obligation chunking duration no longer matches its parent estimate.");
          assert(Number.isInteger(obligation.chunking.totalChunks) && obligation.chunking.totalChunks >= 2 && Number.isInteger(obligation.chunking.completedChunks) && obligation.chunking.completedChunks >= 0 && obligation.chunking.completedChunks <= obligation.chunking.totalChunks, "Obligation chunk counts are invalid.");
          validDate(obligation.chunking.createdAt, "Obligation chunking state");
        }
        assert(obligation.protocol.trim().length > 0 && obligation.successCriteria.trim().length > 0, "Obligation protocol is incomplete.");
        validateWorkflowSpec(obligation.workflow, obligation.type);
        assert(obligation.policyState.engine === engineFor[obligation.type], "Obligation policy does not match its type.");
        if (obligation.type === "memory-recall") {
          assert(obligation.policyState.version === FSRS_PACKAGE_VERSION && obligation.policyState.fsrsCard, "Memory obligation has invalid FSRS-7 state.");
          const fsrsCard = obligation.policyState.fsrsCard;
          assert(fsrsCard.model === FSRS_MODEL, "Memory obligation uses an unsupported scheduler model.");
          assert(fsrsCard.cardId === obligation.id, "FSRS card identity does not match its obligation.");
          assert(fsrsCard.scheduleStatus === "new" || fsrsCard.scheduleStatus === "learning" || fsrsCard.scheduleStatus === "review" || fsrsCard.scheduleStatus === "suspended", "FSRS card schedule status is invalid.");
          requiredFsrs7StabilityFast(fsrsCard.stabilityFast);
          validDate(fsrsCard.dueAt, "FSRS card");
          assert(fsrsCard.dueAt === obligation.dueAt, "Memory obligation due date is not synchronized with its FSRS-7 card.");
          if (fsrsCard.lastReviewAt) validDate(fsrsCard.lastReviewAt, "FSRS last review");
        }
        if (obligation.parentObligationId) assert(obligationMap.has(obligation.parentObligationId), "Obligation references a missing parent.");
        if (obligation.returnObligationId) assert(obligationMap.has(obligation.returnObligationId), "Relearning obligation references a missing return obligation.");
        if (obligation.type === "relearn") {
          assert(obligation.returnObligationId && obligation.parentObligationId === obligation.returnObligationId, "Relearning obligation must point to its exact originating obligation.");
          const original = obligation.returnObligationId ? obligationMap.get(obligation.returnObligationId) : undefined;
          assert(original?.unitId === obligation.unitId && original.type !== "relearn", "Relearning return target is invalid.");
        }
      }
      for (const event of evidenceEvents) {
        const unit = unitMap.get(event.unitId);
        const obligation = obligationMap.get(event.obligationId);
        assert(unit && obligation && profileMap.has(event.profileId), "Evidence event references missing records.");
        assert(unit.profileId === event.profileId && obligation.unitId === event.unitId && obligation.type === event.obligationType, "Evidence event relationships are inconsistent.");
        validDate(event.reviewedAt, "Evidence event"); validDate(event.beforeDueAt, "Evidence event"); validDate(event.afterDueAt, "Evidence event");
        assert(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0 && event.elapsedMs <= 7 * DAY_MS, "Evidence duration is invalid.");
        const duration = event.durationObservation;
        assert(duration && typeof duration.accepted === "boolean", "Evidence duration observation is invalid.");
        assert(Number.isFinite(duration.plannedMinutes) && duration.plannedMinutes >= 1 && duration.plannedMinutes <= 240, "Evidence planned duration is invalid.");
        assert(Number.isFinite(duration.actualMinutes) && duration.actualMinutes >= 0 && duration.actualMinutes <= 10_080, "Evidence actual duration is invalid.");
        assert(Number.isFinite(duration.estimateBefore) && duration.estimateBefore >= 1 && duration.estimateBefore <= 240 && Number.isFinite(duration.estimateAfter) && duration.estimateAfter >= 1 && duration.estimateAfter <= 240, "Evidence duration estimate is invalid.");
        assert(duration.plannedMinutes === duration.estimateBefore, "Evidence planned duration does not match its prior estimate.");
        assert(["accepted", "too-short", "too-long", "invalid", "unreliable-interruption"].includes(duration.reason), "Evidence duration reason is invalid.");
        assert(duration.accepted === (duration.reason === "accepted"), "Evidence duration acceptance and reason disagree.");
        if (!duration.accepted) assert(duration.estimateAfter === duration.estimateBefore, "Rejected duration evidence cannot change the estimate.");
        assert(Number.isInteger(duration.exactSamples) && duration.exactSamples >= 0 && Number.isInteger(duration.unitWorkflowSamples) && duration.unitWorkflowSamples >= 0 && Number.isInteger(duration.globalWorkflowSamples) && duration.globalWorkflowSamples >= 0, "Evidence duration sample counts are invalid.");
        validateEvidence(event.evidence);
        assert(event.workflow === obligation.workflow.kind, "Evidence workflow does not match the obligation.");
        validateWorkflowResult(event.workflowResult, event.workflow);
        validRatingValue(event.suggestedRating, "Evidence event"); validRatingValue(event.confirmedRating, "Evidence event");
        assert(event.beforePolicyState.engine === engineFor[event.obligationType] && event.afterPolicyState.engine === engineFor[event.obligationType], "Evidence policy states do not match the obligation type.");
        if (event.followUpObligationId) assert(obligationMap.has(event.followUpObligationId), "Evidence event references a missing follow-up obligation.");
        if (event.obligationType === "memory-recall") {
          assert(event.schedulerPackage === "ts-fsrs" && event.schedulerVersion === FSRS_PACKAGE_VERSION && event.schedulerModel === FSRS_MODEL, "Memory evidence lacks exact FSRS-7 provenance.");
          const config = event.schedulerConfig;
          assert(config, "Memory evidence lacks scheduler configuration.");
          assert(config.model === FSRS_MODEL && config.fractionalDays === true, "Memory evidence model configuration is invalid.");
          assert(Number.isFinite(config.desiredRetention) && config.desiredRetention >= 0.75 && config.desiredRetention <= 0.97, "Memory evidence lacks a valid scheduler retention.");
          assert(config.enableFuzz === false && config.enableShortTerm === true, "Memory evidence scheduler flags are invalid.");
          assert(config.learningSteps.length === 1 && config.learningSteps[0] === "1d" && config.relearningSteps.length === 1 && config.relearningSteps[0] === "1d", "Memory evidence learning-step configuration is invalid.");
          assert(config.graduatingInterval === FSRS_GRADUATING_INTERVAL_DAYS && config.allowModelOverride === true, "Memory evidence interval policy is invalid.");
          assert(config.maximumInterval === FSRS_MAXIMUM_INTERVAL_DAYS && config.clearStatsOnForget === false && config.weightsSource === "ts-fsrs-package-default", "Memory evidence FSRS configuration is incomplete.");
        } else assert(event.schedulerPackage === undefined && event.schedulerVersion === undefined && event.schedulerModel === undefined && event.schedulerConfig === undefined, "Non-memory evidence cannot claim FSRS provenance.");

        const returned = event.returnedMemoryTransition;
        const relearnReturnId = obligation.type === "relearn" ? obligation.returnObligationId : undefined;
        const returnedTarget = relearnReturnId ? obligationMap.get(relearnReturnId) : undefined;
        const shouldReturnMemory =
          obligation.type === "relearn" &&
          returnedTarget?.type === "memory-recall" &&
          event.confirmedRating >= Rating.Good &&
          objectiveScore("relearn", event.evidence) >= 2.7 &&
          event.beforePolicyState.successStreak >= 1;
        assert(Boolean(returned) === shouldReturnMemory, "Returned-memory scheduler transition presence is inconsistent with relearning completion.");
        if (returned) {
          assert(returned.obligationId === returnedTarget!.id, "Returned-memory transition targets the wrong obligation.");
          assert(returned.rating === Rating.Good, "Returned-memory transition must record a Good closed-book repair.");
          validDate(returned.beforeDueAt, "Returned-memory prior due date");
          validDate(returned.afterDueAt, "Returned-memory next due date");
          assert(returned.policyId === `memory/ts-fsrs@${FSRS_PACKAGE_VERSION}/fsrs-7`, "Returned-memory policy provenance is invalid.");
          assert(returned.schedulerPackage === "ts-fsrs" && returned.schedulerVersion === FSRS_PACKAGE_VERSION && returned.schedulerModel === FSRS_MODEL, "Returned-memory scheduler provenance is invalid.");
          assert(returned.schedulerConfig.model === FSRS_MODEL && returned.schedulerConfig.fractionalDays === true && returned.schedulerConfig.enableShortTerm === true, "Returned-memory scheduler configuration is invalid.");
          assert(returned.schedulerConfig.learningSteps[0] === "1d" && returned.schedulerConfig.relearningSteps[0] === "1d" && returned.schedulerConfig.allowModelOverride === true, "Returned-memory interval policy is invalid.");
          for (const state of [returned.beforePolicyState, returned.afterPolicyState]) {
            assert(state.engine === "ts-fsrs" && state.version === FSRS_PACKAGE_VERSION && state.fsrsCard?.model === FSRS_MODEL, "Returned-memory policy state is invalid.");
            assert(state.fsrsCard.cardId === returned.obligationId, "Returned-memory card identity is invalid.");
            requiredFsrs7StabilityFast(state.fsrsCard.stabilityFast);
          }
        }
      }
      const chunksByObligation = new Map<string, ObligationChunk[]>();
      for (const chunk of chunks) {
        const obligation = obligationMap.get(chunk.obligationId);
        assert(obligation, "Chunk references a missing obligation.");
        assert(chunk.status === "pending" || chunk.status === "completed" || chunk.status === "archived", "Chunk status is invalid.");
        assert(typeof chunk.cycleId === "string" && chunk.cycleId.trim().length > 0 && typeof chunk.label === "string" && chunk.label.trim().length > 0 && typeof chunk.scope === "string" && chunk.scope.trim().length > 0, "Chunk identity or scope is invalid.");
        assert(Number.isInteger(chunk.ordinal) && Number.isInteger(chunk.total) && chunk.ordinal >= 1 && chunk.ordinal <= chunk.total, "Chunk order is invalid.");
        assert(Number.isFinite(chunk.expectedMinutes) && chunk.expectedMinutes >= 1 && chunk.expectedMinutes <= 240, "Chunk duration is invalid.");
        validDate(chunk.createdAt, "Chunk"); validDate(chunk.updatedAt, "Chunk");
        if (chunk.completedAt) validDate(chunk.completedAt, "Chunk completion");
        if (chunk.status === "completed") {
          assert(Number.isFinite(chunk.actualMinutes) && (chunk.actualMinutes ?? 0) > 0, "Completed chunk lacks actual duration.");
          assert(chunk.timing !== undefined, "Completed chunk lacks timing evidence.");
          canonicalTimingEvidenceSummary(chunk.timing);
        }
        const list = chunksByObligation.get(chunk.obligationId) ?? [];
        list.push(chunk); chunksByObligation.set(chunk.obligationId, list);
      }
      for (const obligation of obligations) {
        const related = chunksByObligation.get(obligation.id) ?? [];
        if (!obligation.chunking) {
          assert(related.every((chunk) => chunk.status === "archived"), "An obligation without active chunking has unfinished chunk records.");
          continue;
        }
        const active = related.filter((chunk) => chunk.cycleId === obligation.chunking!.cycleId && chunk.status !== "archived");
        assert(active.length === obligation.chunking.totalChunks, "Obligation chunk count does not match its active cycle.");
        assert(new Set(active.map((chunk) => chunk.ordinal)).size === active.length, "Obligation chunk ordinals are duplicated.");
        assert(active.every((chunk) => chunk.total === obligation.chunking!.totalChunks), "Chunk total does not match the obligation cycle.");
        assert(active.every((chunk) => chunk.expectedMinutes <= obligation.chunking!.capacityMinutes), "Active chunks exceed the capacity that created their cycle.");
        assert(active.reduce((sum, chunk) => sum + chunk.expectedMinutes, 0) + obligation.chunking.synthesisMinutes === obligation.chunking.originalMinutes, "Chunk durations do not conserve the parent estimate.");
        const completed = active.filter((chunk) => chunk.status === "completed").length;
        assert(completed === obligation.chunking.completedChunks, "Obligation completed-chunk count does not match its records.");
        if (obligation.chunking.status === "synthesis-ready") assert(completed === active.length, "Synthesis-ready obligations must have all chunks completed.");
        else assert(active.some((chunk) => chunk.status === "pending"), "An active chunking cycle must retain pending work.");
        assert(related.filter((chunk) => chunk.cycleId !== obligation.chunking!.cycleId).every((chunk) => chunk.status === "archived"), "Prior chunk cycles must be archived.");
      }
      for (const plan of dailyPlans) {
        validateCalendarDate(plan.studyDayKey, "Daily plan study day");
        assert(!studyDayKeys.has(plan.studyDayKey), "Daily plans contain duplicate study days.");
        studyDayKeys.add(plan.studyDayKey);
        validDate(plan.createdAt, "Daily plan"); validDate(plan.updatedAt, "Daily plan");
        assert(new Date(plan.updatedAt).getTime() >= new Date(plan.createdAt).getTime(), "Daily plan timestamps are inconsistent.");
        assert(plan.plannerVersion === PLANNER_VERSION, "Daily plan planner version is invalid.");
        assert(Array.isArray(plan.versions) && plan.versions.length >= 1 && Array.isArray(plan.outcomes), "Daily plan history is incomplete.");
        const planKeys = new Set<string>();
        const itemByKey = new Map<string, DailyPlanItemSnapshot>();
        const versionNumbers = new Set<number>();
        for (const version of plan.versions) {
          assert(Number.isInteger(version.version) && version.version >= 1 && Number.isInteger(version.capacityMinutes) && version.capacityMinutes >= 5 && version.capacityMinutes <= 600, "Daily plan version is invalid.");
          assert(version.reason === "initial" || version.reason === "manual-regeneration" || version.reason === "data-change" || version.reason === "manual-addition", "Daily plan version reason is invalid.");
          assert(!versionNumbers.has(version.version), "Daily plan version numbers are duplicated.");
          versionNumbers.add(version.version);
          validDate(version.generatedAt, "Daily plan version");
          assert(Array.isArray(version.items), "Daily plan version items are invalid.");
          const versionKeys = new Set<string>();
          for (const item of version.items) {
            const obligation = obligationMap.get(item.obligationId);
            assert(obligation, "Daily plan item references a missing obligation.");
            const unit = unitMap.get(obligation.unitId);
            assert(unit && item.unitId === unit.id && item.profileId === unit.profileId, "Daily plan item relationships are inconsistent.");
            assert(profileMap.has(item.profileId), "Daily plan item references a missing profile.");
            assert(item.workflow === obligation.workflow.kind, "Daily plan item workflow does not match its obligation.");
            if (item.chunkId) {
              const chunk = chunkMap.get(item.chunkId);
              assert(chunk && chunk.obligationId === obligation.id, "Daily plan item references an unrelated chunk.");
            }
            assert(item.key === planItemKey(item.obligationId, item.chunkId), "Daily plan item key is inconsistent.");
            assert(!versionKeys.has(item.key), "Daily plan version contains duplicate items.");
            versionKeys.add(item.key);
            assert(typeof item.subject === "string" && item.subject.trim().length > 0 && typeof item.title === "string" && item.title.trim().length > 0, "Daily plan item labels are invalid.");
            assert(Number.isFinite(item.estimatedMinutes) && item.estimatedMinutes >= 1 && item.estimatedMinutes <= 240, "Daily plan item duration is invalid.");
            assert(Number.isFinite(item.score) && item.score >= 0 && item.score <= 100, "Daily plan item score is invalid.");
            assert(item.disposition === "selected" || item.disposition === "required-overrun" || item.disposition === "must-split" || item.disposition === "deferred", "Daily plan item disposition is invalid.");
            assert(Array.isArray(item.reasons) && item.reasons.every((reason) => typeof reason === "string" && reason.length <= 500), "Daily plan item reasons are invalid.");
            planKeys.add(item.key);
            itemByKey.set(item.key, item);
          }
        }
        assert([...versionNumbers].sort((a, b) => a - b).every((version, index) => version === index + 1), "Daily plan versions must be sequential.");
        const outcomeKeys = new Set<string>();
        for (const outcome of plan.outcomes) {
          assert(outcome.status === "planned" || outcome.status === "started" || outcome.status === "completed" || outcome.status === "skipped", "Daily plan outcome status is invalid.");
          assert(planKeys.has(outcome.itemKey), "Daily plan outcome references an unknown item.");
          assert(!outcomeKeys.has(outcome.itemKey), "Daily plan contains duplicate outcomes for an item.");
          outcomeKeys.add(outcome.itemKey);
          if (outcome.startedAt) validDate(outcome.startedAt, "Daily plan outcome");
          if (outcome.completedAt) validDate(outcome.completedAt, "Daily plan outcome");
          if (outcome.status === "started") assert(Boolean(outcome.startedAt), "Started daily-plan outcomes require a start time.");
          if (outcome.startedAt && outcome.completedAt) assert(new Date(outcome.completedAt).getTime() >= new Date(outcome.startedAt).getTime(), "Daily-plan outcome timestamps are inconsistent.");
          if (outcome.status === "completed") {
            assert(Number.isFinite(outcome.actualMinutes) && (outcome.actualMinutes ?? 0) > 0 && (outcome.actualMinutes ?? 0) <= 10_080 && Boolean(outcome.completedAt), "Completed daily-plan outcomes require a valid duration and completion time.");
            const item = itemByKey.get(outcome.itemKey)!;
            if (!item.chunkId) {
              const event = outcome.evidenceEventId ? evidenceMap.get(outcome.evidenceEventId) : undefined;
              assert(event?.obligationId === item.obligationId, "Completed parent-plan outcomes require matching retrieval evidence.");
            } else assert(outcome.evidenceEventId === undefined, "Chunk outcomes cannot claim parent retrieval evidence.");
          }
        }
      }
      const evidenceCounts = new Map<string, { total: number; lapses: number }>();
      for (const event of evidenceEvents) {
        const count = evidenceCounts.get(event.unitId) ?? { total: 0, lapses: 0 };
        count.total += 1;
        if (event.confirmedRating === Rating.Again) count.lapses += 1;
        evidenceCounts.set(event.unitId, count);
      }
      for (const unit of units) {
        const count = evidenceCounts.get(unit.id) ?? { total: 0, lapses: 0 };
        assert(unit.evidenceCount === count.total && unit.lapseCount === count.lapses, "Knowledge unit evidence counters do not match its history.");
      }
      for (const obligation of obligations) {
        const acceptedExact = evidenceEvents.filter((event) => event.obligationId === obligation.id && event.durationObservation.accepted).length;
        assert(obligation.durationSampleCount === acceptedExact, "Obligation duration sample count does not match its accepted history.");
      }
      let canonicalActive: ActiveRetrievalSession | null = null;
      if (activeRetrieval) {
        canonicalActive = canonicalActiveRetrievalSession(activeRetrieval);
        assert(canonicalActive.status === "active", "A backup cannot contain a committing or completed retrieval session.");
        assert(canonicalActive.activeIndex < canonicalActive.queueTargetIds.length, "Backup active retrieval index is invalid.");
        assert(canonicalActive.activeTargetId === canonicalActive.queueTargetIds[canonicalActive.activeIndex], "Backup active retrieval target is inconsistent.");
        const validTarget = (targetId: string): boolean => targetId.startsWith("chunk:")
          ? chunkMap.has(targetId.slice(6))
          : obligationMap.has(targetId);
        assert(canonicalActive.queueTargetIds.every(validTarget), "Backup active retrieval references an unknown target.");
      }
      assertDocumentSchema(settings, "Backup settings");
      assert(settings.key === "app" && (profileMap.size === 0 ? settings.activeProfileId === "" : profileMap.has(settings.activeProfileId)), "Backup settings reference an invalid active profile.");
      assert(Number.isFinite(settings.desiredRetention) && settings.desiredRetention >= 0.75 && settings.desiredRetention <= 0.97, "Desired retention is invalid.");
      assert(Number.isFinite(settings.dailyCapacityMinutes) && settings.dailyCapacityMinutes >= 5 && settings.dailyCapacityMinutes <= 600, "Daily revision capacity is invalid.");
      assert(Number.isInteger(settings.studyDayBoundaryHour) && settings.studyDayBoundaryHour >= 0 && settings.studyDayBoundaryHour <= 12, "Study-day boundary is invalid.");
      return {
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: canonicalIso(candidate.exportedAt as ISODateTime, "Backup export date"),
        appVersion: canonicalId(candidate.appVersion as string, "Backup application version"),
        profiles: profiles.map(canonicalExamProfile),
        nodes: nodes.map(canonicalKnowledgeNode),
        units: units.map(canonicalKnowledgeUnit),
        studyEvents: studyEvents.map(canonicalStudyEvent),
        obligations: obligations.map(canonicalRevisionObligation),
        evidenceEvents: evidenceEvents.map(canonicalEvidenceEvent),
        chunks: chunks.map(canonicalObligationChunk),
        dailyPlans: dailyPlans.map(canonicalDailyPlanRecord),
        settings: canonicalAppSettings(settings),
        activeRetrieval: canonicalActive,
      };
    }

    async importBackup(input: unknown): Promise<void> {
      const payload = this.validateBackup(input);
      await this.repo.replaceFromBackup(payload, "discard");
      this.settings = clone(payload.settings);
    }


  }

  /* ========================================================================== 
     USER INTERFACE CONTROLLER
     ========================================================================== */

