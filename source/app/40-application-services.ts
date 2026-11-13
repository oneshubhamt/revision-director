  class RevisionService {
    private settings = defaultSettings();
    private readonly router: SchedulerPolicyRouter;
    private memoryReviewAnalysis: {
      evidenceKey: string;
      reviewIndex: MemoryReviewObservationIndex;
    } | undefined;

    constructor(private readonly repo: RevisionData) {
      this.router = new SchedulerPolicyRouter(
        () => this.settings.fsrsScheduling.policy,
        () => activeFsrsOptimizerProfile(this.settings),
      );
    }

    private evidenceAnalysisKey(evidenceEvents: readonly EvidenceEvent[]): string {
      if (evidenceEvents.length === 0) return "0";
      const newest = evidenceEvents[0]!;
      const oldest = evidenceEvents.at(-1)!;
      return [evidenceEvents.length, newest.id, newest.reviewedAt, oldest.id, oldest.reviewedAt].join("|");
    }

    private memoryReviewIndexFor(evidenceEvents: readonly EvidenceEvent[]): MemoryReviewObservationIndex {
      const evidenceKey = this.evidenceAnalysisKey(evidenceEvents);
      if (this.memoryReviewAnalysis?.evidenceKey === evidenceKey) return this.memoryReviewAnalysis.reviewIndex;
      const reviewIndex = memoryReviewObservationIndex(evidenceEvents);
      this.memoryReviewAnalysis = { evidenceKey, reviewIndex };
      return reviewIndex;
    }

    private invalidateMemoryReviewAnalysis(): void {
      this.memoryReviewAnalysis = undefined;
    }

    async initialize(): Promise<void> {
      this.invalidateMemoryReviewAnalysis();
      const state = await this.repo.backupState("ignore");
      this.settings = clone(state.settings);
      assertActiveProfileSelection(state.profiles, this.settings);
      await this.verifyMemoryProjectionIntegrity(state.obligations, state.evidenceEvents, this.settings);
    }

    private async verifyMemoryProjectionIntegrity(
      obligations: readonly RevisionObligation[],
      evidenceEvents: readonly EvidenceEvent[],
      settings: AppSettings,
    ): Promise<void> {
      await verifyMemoryDatasetIntegrityWithIndex(
        obligations,
        this.memoryReviewIndexFor(evidenceEvents),
        settings.fsrsScheduling.policy,
        activeFsrsOptimizerProfile(settings),
        fsrsPersonalizationProfileCatalog(settings),
      );
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
      assert(Number.isInteger(next.dailyCapacityMinutes) && next.dailyCapacityMinutes >= 5 && next.dailyCapacityMinutes <= 600, "Daily capacity is invalid.");
      assert(Number.isInteger(next.studyDayBoundaryHour) && next.studyDayBoundaryHour >= 0 && next.studyDayBoundaryHour <= 12, "Study-day boundary is invalid.");
      const canonical = canonicalAppSettings(next);
      assertActiveProfileSelection(await this.profiles(), canonical);
      assert(
        JSON.stringify(effectiveFsrsPersonalization(canonical)) === JSON.stringify(effectiveFsrsPersonalization(this.settings)),
        "Use the explicit FSRS personalization controls to stage, activate, deactivate or remove an optimizer profile.",
      );
      assert(
        JSON.stringify(canonical.fsrsScheduling.lastRebase ?? null) === JSON.stringify(this.settings.fsrsScheduling.lastRebase ?? null),
        "FSRS scheduler rebase metadata is service-owned.",
      );
      const difficultyChanged =
        JSON.stringify(canonical.memoryDifficultyPolicy) !== JSON.stringify(this.settings.memoryDifficultyPolicy);
      if (!fsrsSchedulingPoliciesEqual(canonical.fsrsScheduling.policy, this.settings.fsrsScheduling.policy)) {
        await this.rebaseMemoryScheduler(canonical, activeFsrsOptimizerProfile(canonical), "scheduler-policy-change");
        return;
      }
      await prepareFsrsScheduler(canonical.fsrsScheduling.policy, activeFsrsOptimizerProfile(canonical));
      if (difficultyChanged) {
        const [obligations, units, evidenceEvents] = await Promise.all([this.obligations(), this.units(), this.evidenceEvents()]);
        const released = this.releaseStalePersistentDifficultyHolds(
          obligations,
          units,
          canonical.memoryDifficultyPolicy,
          this.memoryReviewIndexFor(evidenceEvents),
          nowIso(),
        );
        await this.repo.replaceSettingsAndObligations(canonical, released);
        this.settings = canonical;
        return;
      }
      await this.repo.put(Store.Settings, canonical);
      this.settings = canonical;
    }

    private releaseStalePersistentDifficultyHolds(
      obligations: readonly RevisionObligation[],
      units: readonly KnowledgeUnit[],
      policy: MemoryDifficultyPolicy,
      reviewIndex: MemoryReviewObservationIndex,
      at: ISODateTime,
    ): RevisionObligation[] {
      const unitById = new Map(units.map((unit) => [unit.id, unit]));
      const released: RevisionObligation[] = [];
      for (const current of obligations) {
        if (current.type !== "memory-recall" || current.status !== "suspended" || current.suspensionReason !== "persistent-difficulty") continue;
        if (memoryDifficultyAssessment(current, policy, reviewIndex.get(current.id) ?? []).automaticHoldEligible) continue;
        const unit = unitById.get(current.unitId);
        assert(unit, "Persistent-difficulty memory references a missing knowledge unit.");
        const obligation = clone(current);
        if (unit.status === "active") {
          obligation.status = "active";
          delete obligation.suspensionReason;
        } else if (unit.status === "suspended") {
          obligation.status = "suspended";
          obligation.suspensionReason = "unit";
        } else {
          obligation.status = "archived";
          delete obligation.suspensionReason;
        }
        obligation.updatedAt = at;
        released.push(obligation);
      }
      return released;
    }

    async optimizerEvidenceSummary(): Promise<FsrsOptimizerEvidenceSummary> {
      return fsrsOptimizerEvidenceSummary(await this.evidenceEvents());
    }

    async optimizerEvidenceCsv(): Promise<string> {
      return fsrsOptimizerCsv(await this.evidenceEvents());
    }

    async optimizerEvidenceSnapshot(): Promise<FsrsOptimizerEvidenceSnapshot> {
      return fsrsOptimizerEvidenceSnapshot(await this.evidenceEvents());
    }

    private async assertOptimizerProfileMatchesCurrentEvidence(profile: FsrsOptimizerProfile): Promise<void> {
      const snapshot = await this.optimizerEvidenceSnapshot();
      assert(snapshot.summary.reviews > 0, "No memory-review evidence is available for FSRS personalization.");
      assert(
        profile.sourceSha256 === snapshot.sourceSha256,
        "FSRS optimizer profile was trained on different or stale review evidence. Re-optimize or import a profile generated from the current canonical evidence export.",
      );
    }

    private async replayProfilesBeforeDiscardingCurrent(
      personalization: FsrsPersonalizationSettings,
    ): Promise<FsrsOptimizerProfile[]> {
      const current = personalization.profile;
      if (!current) return personalization.replayProfiles.map((profile) => clone(profile));
      const fingerprint = fsrsWeightsFingerprint(current.weights);
      const referenced = (await this.evidenceEvents()).some((event) => {
        const configs = [event.schedulerConfig, event.correctiveMemoryTransition?.schedulerConfig];
        return configs.some((config) =>
          config?.weightsSource === "optimizer-profile"
          && config.weightsFingerprint === fingerprint
          && config.optimizerProfileSourceSha256 === current.sourceSha256
        );
      });
      return referenced
        ? appendFsrsReplayProfile(personalization.replayProfiles, current)
        : personalization.replayProfiles.map((profile) => clone(profile));
    }

    async stageFsrsOptimizerProfile(input: unknown): Promise<FsrsOptimizerProfile> {
      const personalization = effectiveFsrsPersonalization(this.settings);
      assert(!personalization.active, "Return to stock FSRS-7 before staging a different optimizer profile.");
      const profile = validateFsrsOptimizerProfile(input);
      await this.assertOptimizerProfileMatchesCurrentEvidence(profile);
      await prepareFsrsScheduler(this.settings.fsrsScheduling.policy, profile);
      const replayProfiles = await this.replayProfilesBeforeDiscardingCurrent(personalization);
      const next = canonicalAppSettings({
        ...this.settings,
        fsrsPersonalization: { profile, active: false, replayProfiles },
      });
      await this.repo.put(Store.Settings, next);
      this.settings = next;
      return clone(profile);
    }

    async clearFsrsOptimizerProfile(): Promise<void> {
      const personalization = effectiveFsrsPersonalization(this.settings);
      assert(!personalization.active, "Return to stock FSRS-7 before removing the optimizer profile.");
      const replayProfiles = await this.replayProfilesBeforeDiscardingCurrent(personalization);
      const next = canonicalAppSettings({
        ...this.settings,
        fsrsPersonalization: { profile: null, active: false, replayProfiles },
      });
      await this.repo.put(Store.Settings, next);
      this.settings = next;
    }

    async activateFsrsOptimizerProfile(): Promise<void> {
      const personalization = effectiveFsrsPersonalization(this.settings);
      assert(!personalization.active && personalization.profile, "No staged FSRS optimizer profile is available for activation.");
      await this.assertOptimizerProfileMatchesCurrentEvidence(personalization.profile);
      const next = canonicalAppSettings({
        ...this.settings,
        fsrsPersonalization: { ...personalization, active: true },
      });
      await this.rebaseMemoryScheduler(next, personalization.profile, "activate-profile");
    }

    async deactivateFsrsOptimizerProfile(): Promise<void> {
      const personalization = effectiveFsrsPersonalization(this.settings);
      assert(personalization.active && personalization.profile, "Personalized FSRS-7 is not active.");
      const next = canonicalAppSettings({
        ...this.settings,
        fsrsPersonalization: { ...personalization, active: false },
      });
      await this.rebaseMemoryScheduler(next, null, "deactivate-profile");
    }

    async replaceActiveFsrsOptimizerProfile(input: unknown): Promise<FsrsOptimizerProfile> {
      const personalization = effectiveFsrsPersonalization(this.settings);
      assert(personalization.active && personalization.profile, "Personalized FSRS-7 is not active.");
      const candidate = validateFsrsOptimizerProfile(input);
      await this.assertOptimizerProfileMatchesCurrentEvidence(candidate);
      const incumbent = candidate.evaluation.holdout.incumbent;
      assert(incumbent, "Replacement FSRS optimizer profile lacks an incumbent holdout comparison.");
      assert(
        incumbent.sourceSha256 === personalization.profile.sourceSha256
          && incumbent.weightsFingerprint === fsrsWeightsFingerprint(personalization.profile.weights),
        "Replacement FSRS optimizer profile was not evaluated against the currently active personalized weights.",
      );
      const replayProfiles = await this.replayProfilesBeforeDiscardingCurrent(personalization);
      const next = canonicalAppSettings({
        ...this.settings,
        fsrsPersonalization: { profile: candidate, active: true, replayProfiles },
      });
      await this.rebaseMemoryScheduler(next, candidate, "replace-profile");
      return clone(candidate);
    }

    private async rebaseMemoryScheduler(
      requestedSettings: AppSettings,
      profile: FsrsOptimizerProfile | null,
      reason: FsrsSchedulerRebase["reason"],
    ): Promise<void> {
      assert(!(await this.currentActiveRetrieval()), "Finish or end the active retrieval session before changing FSRS scheduler parameters.");
      const settings = canonicalAppSettings(requestedSettings);
      const currentProfile = activeFsrsOptimizerProfile(this.settings);
      const currentConfiguration = fsrsConfigSnapshot(this.settings.fsrsScheduling.policy, currentProfile);
      await prepareFsrsScheduler(settings.fsrsScheduling.policy, profile);
      const [obligations, evidenceEvents, units] = await Promise.all([this.obligations(), this.evidenceEvents(), this.units()]);
      const reviewIndex = this.memoryReviewIndexFor(evidenceEvents);
      await verifyMemoryDatasetIntegrityWithIndex(
        obligations,
        reviewIndex,
        this.settings.fsrsScheduling.policy,
        currentProfile,
        fsrsPersonalizationProfileCatalog(this.settings),
      );
      const scheduler = revisionSchedulerPort(settings.fsrsScheduling.policy, profile);
      const at = nowIso();
      let rescheduledObligations = 0;
      const updatedMemory = obligations.filter((obligation) => obligation.type === "memory-recall").map((obligation) => {
        const projection = obligation.policyState.fsrsCard;
        assert(projection, "Memory obligation has no FSRS materialized projection.");
        const reviews = reviewIndex.get(obligation.id) ?? [];
        if (reviews.length === 0) return clone(obligation);
        const card = scheduler.reschedule(reviews[0]!.beforeCard, reviews);
        rescheduledObligations += 1;
        return {
          ...clone(obligation),
          dueAt: card.dueAt,
          updatedAt: at,
          policyState: {
            ...clone(obligation.policyState),
            stage: card.state,
            lastIntervalDays: card.scheduledDays,
            fsrsCard: card,
          },
        };
      });
      assert(currentConfiguration.fingerprint !== scheduler.configuration.fingerprint, "FSRS scheduler rebase must change scheduler identity.");
      const released = this.releaseStalePersistentDifficultyHolds(
        updatedMemory,
        units,
        settings.memoryDifficultyPolicy,
        reviewIndex,
        at,
      );
      if (released.length > 0) {
        const releasedById = new Map(released.map((obligation) => [obligation.id, obligation]));
        for (let index = 0; index < updatedMemory.length; index += 1) {
          const replacement = releasedById.get(updatedMemory[index]!.id);
          if (replacement) updatedMemory[index] = replacement;
        }
      }
      const personalization = effectiveFsrsPersonalization(settings);
      const finalized = canonicalAppSettings({
        ...settings,
        fsrsScheduling: {
          policy: canonicalFsrsSchedulingPolicy(settings.fsrsScheduling.policy),
          lastRebase: {
            at,
            reason,
            fromConfigFingerprint: currentConfiguration.fingerprint,
            toConfigFingerprint: scheduler.configuration.fingerprint,
            rescheduledObligations,
          },
        },
        fsrsPersonalization: {
          ...personalization,
          active: Boolean(profile),
        },
      });
      validateMemoryDatasetProjectionChain(updatedMemory, reviewIndex);
      await verifyMemoryDatasetIntegrityWithIndex(
        updatedMemory,
        reviewIndex,
        finalized.fsrsScheduling.policy,
        activeFsrsOptimizerProfile(finalized),
        fsrsPersonalizationProfileCatalog(finalized),
      );
      await this.repo.replaceSettingsAndObligations(finalized, updatedMemory);
      this.settings = finalized;
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
      const existingProfiles = await this.profiles();
      assertActiveProfileSelection(existingProfiles, this.settings);
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
      const nextSettings = existingProfiles.some((candidate) => candidate.status === "active")
        ? this.settings
        : canonicalAppSettings({ ...this.settings, activeProfileId: profile.id });
      await this.repo.putProfileAndSettings(profile, nextSettings);
      this.settings = clone(nextSettings);
      return profile;
    }

    async updateProfile(id: string, name: string, examDate: string, status: "active" | "suspended"): Promise<ExamProfile> {
      const existingProfiles = await this.profiles();
      assertActiveProfileSelection(existingProfiles, this.settings);
      const profile = existingProfiles.find((candidate) => candidate.id === id);
      assert(profile, "Exam profile not found.");
      assert(name.trim().length >= 2, "Enter an exam-profile name.");
      if (examDate) validateCalendarDate(examDate);
      assert(status === "active" || status === "suspended", "Exam profile status is invalid.");
      profile.name = name.trim();
      profile.examDate = examDate;
      profile.status = status;
      profile.updatedAt = nowIso();

      const nextProfiles = existingProfiles.map((candidate) => candidate.id === profile.id ? profile : candidate);
      const active = nextProfiles.filter((candidate) => candidate.status === "active");
      let activeProfileId = this.settings.activeProfileId;
      if (active.length === 0) activeProfileId = "";
      else if (!active.some((candidate) => candidate.id === activeProfileId)) {
        const replacement = active[0];
        assert(replacement, "Active profile selection could not be resolved.");
        activeProfileId = replacement.id;
      }
      const nextSettings = canonicalAppSettings({ ...this.settings, activeProfileId });
      assertActiveProfileSelection(nextProfiles, nextSettings);
      await this.repo.putProfileAndSettings(profile, nextSettings);
      this.settings = clone(nextSettings);
      return profile;
    }

    async nodes(): Promise<KnowledgeNode[]> {
      return this.repo.getAll(Store.Nodes);
    }

    async ensureNode(profileId: string, parentId: string | null, kind: KnowledgeNodeKind, name: string): Promise<KnowledgeNode> {
      assert(name.trim().length > 0, `Enter a ${kind} name.`);
      assert(parentId !== null || kind === "subject", "Only subject nodes may exist at the hierarchy root.");
      const normalizedName = normalizeName(name);
      const existing = await this.repo.findNode(profileId, parentId, kind, normalizedName);
      if (existing) return existing;
      const time = nowIso();
      const node: KnowledgeNode = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: parentId === null ? await rootKnowledgeNodeId(profileId, normalizedName) : uid(kind),
        profileId,
        parentId,
        kind,
        name: name.trim().replace(/\s+/g, " "),
        normalizedName,
        createdAt: time,
        updatedAt: time,
      };
      try {
        await this.repo.add(Store.Nodes, node);
        return node;
      } catch (error) {
        const concurrent = await this.repo.findNode(profileId, parentId, kind, normalizedName);
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
      assert(draft.obligationType !== "relearn", "A new knowledge unit cannot begin with a system-owned relearning obligation.");
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

    async createObligation(draft: ObligationDraft): Promise<RevisionObligation> {
      const unit = await this.unit(draft.unitId);
      assert(unit.status === "active", "Activate the knowledge unit before adding a revision obligation.");
      assert(draft.type !== "relearn", "Relearning obligations are created only by failed retrievals that record their exact origin.");
      const obligation = this.buildObligation(draft);
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
        const byCreated = a.obligation.createdAt.localeCompare(b.obligation.createdAt);
        if (byCreated !== 0) return byCreated;
        return a.obligation.id.localeCompare(b.obligation.id);
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
        const chunking = obligation.chunking;
        if (chunking?.status === "chunking") {
          const pending = chunks.filter((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "pending").sort((a, b) => a.ordinal - b.ordinal);
          if (pending[0]) nextChunk.set(obligation.id, pending[0]);
          else if (chunking.completedChunks >= chunking.totalChunks) {
            chunking.status = "synthesis-ready";
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
        const latest = latestPlanVersion(record);
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
      const latest = latestPlanVersion(record);
      const nextItems = latest.items.map((item) => clone(item));
      let changed = false;
      for (const item of items) {
        const index = nextItems.findIndex((entry) => entry.key === item.key);
        if (index < 0) {
          nextItems.push(clone(item));
          changed = true;
          continue;
        }
        const existing = nextItems[index];
        assert(existing, "Existing daily-plan item is missing.");
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
      const memoryReviews = this.memoryReviewIndexFor(evidence);
      const planHistory = await this.dailyPlanHistory();
      const balance = weeklySubjectBalanceScores(joined, planHistory, planningReference, this.settings.studyDayBoundaryHour);
      const pendingChunks = persist
        ? await this.ensureAutomaticChunking(joined, this.settings.dailyCapacityMinutes, planningReference)
        : await this.existingPendingChunks(joined);
      const candidates = joined
        .map((item) => buildPlanningCandidate(
          item,
          evidence,
          this.settings,
          planningReference,
          balance.get(subjectBalanceKey(item.profile.id, item.subject)) ?? 0.5,
          pendingChunks.get(item.obligation.id),
          memoryReviews,
        ))
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

    async memoryReviewHistory(obligationId: string): Promise<MemoryReviewObservation[]> {
      const obligation = await this.obligation(obligationId);
      assert(obligation.type === "memory-recall", "Memory-review history is only available for memory obligations.");
      const evidence = await this.evidenceEvents();
      return (this.memoryReviewIndexFor(evidence).get(obligationId) ?? []).map((review) => clone(review));
    }

    async preview(obligationId: string, now = new Date()): Promise<SchedulePreview[]> {
      const obligation = await this.obligation(obligationId);
      const policy = this.router.get(obligation.type);
      if (obligation.type !== "memory-recall") return policy.preview(obligation, now);
      const evidence = await this.evidenceEvents();
      const memoryReviews = this.memoryReviewIndexFor(evidence).get(obligation.id) ?? [];
      return policy.preview(obligation, now, { memoryReviews });
    }

    async recordEvidence(obligationId: string, draft: EvidenceDraft, reviewedAt = new Date(), commitGuard?: ActiveCommitGuard, postCommitSession?: ActiveRetrievalSession): Promise<EvidenceEvent> {
      const prepared = prepareEvidenceDraft(draft);
      const obligation = await this.obligation(obligationId);
      const rating = evidenceRatingDecision(obligation, prepared);
      const unit = await this.unit(obligation.unitId);
      const priorEvidence = await this.evidenceEvents();
      const chunks = obligation.chunking ? await this.chunksForObligation(obligation.id) : [];
      const synthesis = synthesisDurationContext(obligation, chunks);
      const durationObservation = durationObservationFor(
        obligation,
        priorEvidence,
        prepared.draft.elapsedMs + synthesis.cycleChunkMs,
        prepared.timing.durationReliable && synthesis.durationReliable,
      );
      const memoryReviewIndex = this.memoryReviewIndexFor(priorEvidence);
      const priorMemoryReviews = obligation.type === "memory-recall"
        ? memoryReviewIndex.get(obligation.id) ?? []
        : [];
      const policy = this.router.get(obligation.type);
      const completion = obligation.type === "memory-recall"
        ? policy.complete(obligation, rating.confirmedRating, prepared.draft, reviewedAt, { memoryReviews: priorMemoryReviews })
        : policy.complete(obligation, rating.confirmedRating, prepared.draft, reviewedAt);
      const reviewedAtIso = reviewedAt.toISOString();

      const primary = applyPrimaryEvidenceTransition({
        obligation,
        unit,
        prepared,
        rating,
        completion,
        durationObservation,
        priorMemoryReviews,
        memoryDifficultyPolicy: this.settings.memoryDifficultyPolicy,
        reviewedAt: reviewedAtIso,
      });
      const synthesisArchive = archiveSynthesisCycle(primary.obligation, chunks, reviewedAtIso);
      let committedObligation = synthesisArchive.obligation;

      let followUp: RevisionObligation | undefined;
      if (completion.followUpType === "relearn" && committedObligation.type !== "relearn") {
        const existing = (await this.obligationsForUnit(primary.unit.id)).find((item) =>
          item.type === "relearn" && item.status === "active" && item.returnObligationId === committedObligation.id
        );
        if (!existing) {
          const dueAt = correctiveRelearnDueAt(await this.profile(primary.unit.profileId), reviewedAt);
          const followUpId = uid("obligation");
          followUp = createRelearningFollowUp({
            obligation: committedObligation,
            unit: primary.unit,
            dueAt,
            followUpId,
            policyState: this.router.get("relearn").createInitialState(dueAt, followUpId),
            reviewedAt: reviewedAtIso,
            ...(primary.memoryDifficulty ? { memoryDifficulty: primary.memoryDifficulty } : {}),
          });
        }
      }

      let relatedObligation: RevisionObligation | undefined;
      let correctiveMemoryTransition: CorrectiveMemoryTransition | undefined;
      if (committedObligation.type === "relearn" && committedObligation.returnObligationId) {
        const original = await this.repo.get(Store.Obligations, committedObligation.returnObligationId);
        assert(original, "Relearning return target is missing.");
        const priorOriginalReviews = original.type === "memory-recall"
          ? memoryReviewIndex.get(original.id) ?? []
          : [];
        const memoryVerification = original.type === "memory-recall"
          ? this.router.get("memory-recall").complete(
              original,
              rating.confirmedRating,
              prepared.draft,
              reviewedAt,
              { memoryReviews: priorOriginalReviews },
            )
          : undefined;
        const corrective = applyCorrectiveRelearningTransition({
          relearningObligation: committedObligation,
          original,
          rating: rating.confirmedRating,
          reviewedAt: reviewedAtIso,
          memoryDifficultyPolicy: this.settings.memoryDifficultyPolicy,
          priorOriginalReviews,
          ...(memoryVerification ? { memoryVerification } : {}),
        });
        committedObligation = corrective.relearningObligation;
        relatedObligation = corrective.relatedObligation;
        correctiveMemoryTransition = corrective.correctiveMemoryTransition;
      }

      const event = buildEvidenceEvent({
        transition: primary,
        obligation: committedObligation,
        eventId: commitGuard ? `evidence_${commitGuard.commitToken}` : uid("evidence"),
        createdAt: nowIso(),
        ...(followUp ? { followUp } : {}),
        ...(correctiveMemoryTransition ? { correctiveMemoryTransition } : {}),
      });
      const dailyPlan = await this.completedPlanRecord(
        committedObligation.id,
        undefined,
        roundTo(prepared.timing.totalActiveMs / 60_000, 1),
        reviewedAt,
        event.id,
      );
      await this.repo.recordReview(
        primary.unit,
        committedObligation,
        event,
        followUp,
        relatedObligation,
        synthesisArchive.chunkUpdates,
        dailyPlan,
        commitGuard,
        postCommitSession,
      );
      this.invalidateMemoryReviewAnalysis();
      return event;
    }

    async resumePersistentDifficulty(obligationId: string): Promise<void> {
      const obligation = await this.obligation(obligationId);
      assert(obligation.type === "memory-recall", "Only memory recall can be resumed from persistent-difficulty hold.");
      assert(obligation.status === "suspended" && obligation.suspensionReason === "persistent-difficulty", "Memory obligation is not held for persistent difficulty.");
      const unit = await this.unit(obligation.unitId);
      assert(unit.status === "active", "Reactivate the knowledge unit before resuming this memory obligation.");
      const unresolvedRepair = (await this.obligationsForUnit(unit.id)).some((item) =>
        item.type === "relearn" &&
        (item.status === "active" || item.status === "suspended") &&
        item.returnObligationId === obligation.id
      );
      assert(!unresolvedRepair, "Complete the unresolved relearning repair before resuming this memory obligation.");
      obligation.status = "active";
      delete obligation.suspensionReason;
      obligation.updatedAt = nowIso();
      await this.repo.put(Store.Obligations, obligation);
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
      assert(new Set(draft.linkedUnitIds).size === draft.linkedUnitIds.length, "Study Event links cannot contain duplicates.");
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
        linkedUnitIds: [...draft.linkedUnitIds],
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
      return (await this.evidenceEvents()).find((event) => event.followUpObligationId === obligation.id);
    }

    async currentActiveRetrieval(): Promise<ActiveRetrievalSession | null> {
      return await this.repo.get(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID) ?? null;
    }

    async exportBackup(): Promise<BackupPayload> {
      const state = await this.repo.backupState();
      return {
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: nowIso(),
        appVersion: APP_VERSION,
        ...state,
      };
    }

    async createBackupArchive(preferCompression = true): Promise<BackupArchiveArtifact> {
      const payload = validateBackupPayload(await this.exportBackup());
      await verifyMemoryDatasetIntegrity(
        payload.obligations,
        payload.evidenceEvents,
        payload.settings.fsrsScheduling.policy,
        activeFsrsOptimizerProfile(payload.settings),
        fsrsPersonalizationProfileCatalog(payload.settings),
      );
      return BackupCodec.create(payload, preferCompression);
    }

    async inspectBackupArchive(bytes: Uint8Array): Promise<BackupInspectionMetadata> {
      return (await BackupCodec.decode(bytes, (input) => validateBackupPayload(input))).inspection;
    }

    async decodeBackupArchive(bytes: Uint8Array): Promise<DecodedBackupArchive> {
      return BackupCodec.decode(bytes, (input) => validateBackupPayload(input));
    }

    async restoreBackupPayload(payload: BackupPayload, activeTreatment: BackupActiveSessionTreatment): Promise<void> {
      const validated = validateBackupPayload(payload);
      await verifyMemoryDatasetIntegrity(
        validated.obligations,
        validated.evidenceEvents,
        validated.settings.fsrsScheduling.policy,
        activeFsrsOptimizerProfile(validated.settings),
        fsrsPersonalizationProfileCatalog(validated.settings),
      );
      await this.repo.replaceFromBackup(validated, activeTreatment);
      this.settings = clone(validated.settings);
      this.invalidateMemoryReviewAnalysis();
    }

    async rawStateForRescue(): Promise<Record<string, unknown[]>> {
      return this.repo.rawDump();
    }



  }
