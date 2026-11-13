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
      const state = await this.repo.backupState();
      const validated = this.validateBackup({
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: nowIso(),
        appVersion: APP_VERSION,
        ...state,
        activeRetrieval: null,
      });
      this.settings = clone(validated.settings);
      await this.verifyMemoryProjectionIntegrity(validated.obligations, validated.evidenceEvents, validated.settings);
    }

    private assertActiveProfileSelection(profiles: readonly ExamProfile[], settings: AppSettings): void {
      const active = profiles.filter((profile) => profile.status === "active");
      if (active.length === 0) {
        assert(settings.activeProfileId === "", "Default exam profile must be empty when no active exam profile exists.");
        return;
      }
      assert(active.some((profile) => profile.id === settings.activeProfileId), "Default exam profile must reference an active exam profile.");
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
      this.assertActiveProfileSelection(await this.profiles(), canonical);
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
      const studyDayBoundaryChanged = canonical.studyDayBoundaryHour !== this.settings.studyDayBoundaryHour;
      if (difficultyChanged || studyDayBoundaryChanged) {
        assert(!(await this.currentActiveRetrieval()), "Finish or end the active retrieval session before changing review-affecting settings.");
      }
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
      this.assertActiveProfileSelection(existingProfiles, this.settings);
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
      assert(!(await this.currentActiveRetrieval()), "Finish or end the active retrieval session before changing an exam profile.");
      const existingProfiles = await this.profiles();
      this.assertActiveProfileSelection(existingProfiles, this.settings);
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
      this.assertActiveProfileSelection(nextProfiles, nextSettings);
      await this.repo.putProfileAndSettings(profile, nextSettings);
      this.settings = clone(nextSettings);
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
      assert(!(await this.currentActiveRetrieval()), "Finish or end the active retrieval session before changing knowledge-unit status.");
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

    private buildObligation(draft: ObligationDraft): RevisionObligation {
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
      return obligation;
    }

    async createObligation(draft: ObligationDraft): Promise<RevisionObligation> {
      const unit = await this.unit(draft.unitId);
      assert(unit.status === "active", "Activate the knowledge unit before adding a revision obligation.");
      assert(draft.type !== "relearn", "Relearning obligations are created only by a failed retrieval that records their exact origin.");
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
        assert(unit, "Revision obligation references a missing knowledge unit.");
        if (unit.status !== "active") continue;
        const profile = profileMap.get(unit.profileId);
        assert(profile, "Knowledge unit references a missing exam profile.");
        const topicNode = nodeMap.get(unit.topicNodeId);
        assert(topicNode?.kind === "topic" && topicNode.profileId === unit.profileId, "Knowledge unit references an invalid topic node.");
        const sectionNode = topicNode.parentId ? nodeMap.get(topicNode.parentId) : undefined;
        assert(sectionNode?.kind === "section" && sectionNode.profileId === unit.profileId, "Topic node references an invalid section node.");
        const subjectNode = sectionNode.parentId ? nodeMap.get(sectionNode.parentId) : undefined;
        assert(subjectNode?.kind === "subject" && subjectNode.profileId === unit.profileId && subjectNode.parentId === null, "Section node references an invalid subject node.");
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
      assert(obligation.status === "active", "This split-session obligation is no longer active.");
      const unit = await this.unit(obligation.unitId);
      assert(unit.status === "active", "This split-session knowledge unit is no longer active.");
      const profile = await this.profile(unit.profileId);
      assert(profile.status === "active", "This split-session exam profile is no longer active.");
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
      const timing = canonicalTimingEvidenceSummary(draft.timing);
      const normalizedDraft: EvidenceDraft = { ...draft, elapsedMs: timing.totalActiveMs, timing };
      validateEvidence(normalizedDraft);
      const requestedRating = validateRating(normalizedDraft.confirmedRating);
      const obligation = await this.obligation(obligationId);
      const confirmed = obligation.type === "relearn"
        ? correctiveMemoryRating(requestedRating, normalizedDraft)
        : requestedRating;
      validateWorkflowSpec(obligation.workflow, obligation.type);
      validateWorkflowResult(normalizedDraft.workflowResult, obligation.workflow.kind);
      assert(obligation.status === "active", "This obligation is not active.");
      const unit = await this.unit(obligation.unitId);
      assert(unit.status === "active", "This knowledge unit is no longer active.");
      const profile = await this.profile(unit.profileId);
      assert(profile.status === "active", "This exam profile is no longer active.");
      const priorEvidence = await this.evidenceEvents();
      const chunking = obligation.chunking;
      const cycleChunks = chunking?.status === "synthesis-ready" ? (await this.chunksForObligation(obligation.id)).filter((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "completed") : [];
      const cycleChunkMs = cycleChunks.reduce((sum, chunk) => sum + (chunk.actualMinutes ?? 0) * 60_000, 0);
      const cycleTimingReliable = cycleChunks.every((chunk) => chunk.timing?.durationReliable !== false);
      const durationObservation = durationObservationFor(obligation, priorEvidence, normalizedDraft.elapsedMs + cycleChunkMs, timing.durationReliable && cycleTimingReliable);
      const beforePolicyState = clone(obligation.policyState);
      const beforeDueAt = obligation.dueAt;
      const suggested = suggestRating(obligation.type, normalizedDraft);
      const policy = this.router.get(obligation.type);
      const memoryReviewIndex = this.memoryReviewIndexFor(priorEvidence);
      const priorMemoryReviews = obligation.type === "memory-recall"
        ? memoryReviewIndex.get(obligation.id) ?? []
        : [];
      const completion = obligation.type === "memory-recall"
        ? policy.complete(obligation, confirmed, normalizedDraft, reviewedAt, {
            memoryReviews: priorMemoryReviews,
          })
        : policy.complete(obligation, confirmed, normalizedDraft, reviewedAt);

      obligation.dueAt = completion.dueAt;
      obligation.policyState = completion.policyState;
      const memoryDifficulty = obligation.type === "memory-recall"
        ? (() => {
            const beforeCard = beforePolicyState.fsrsCard;
            const afterCard = completion.policyState.fsrsCard;
            const schedulerConfig = completion.schedulerConfig;
            assert(beforeCard && afterCard && schedulerConfig, "Memory completion is missing FSRS difficulty evidence.");
            const currentReview: MemoryReviewObservation = {
              evidenceEventId: "pending",
              reviewedAt: reviewedAt.toISOString(),
              rating: confirmed,
              source: "direct-memory",
              beforeCard: clone(beforeCard),
              afterCard: clone(afterCard),
              schedulerConfig: clone(schedulerConfig),
              configFingerprint: schedulerConfig.fingerprint,
            };
            return memoryDifficultyAssessment(
              obligation,
              this.settings.memoryDifficultyPolicy,
              [...priorMemoryReviews, currentReview],
            );
          })()
        : undefined;
      obligation.updatedAt = reviewedAt.toISOString();
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

      unit.evidenceCount += 1;
      if (confirmed === Rating.Again) unit.lapseCount += 1;
      unit.updatedAt = reviewedAt.toISOString();

      let followUp: RevisionObligation | undefined;
      let relatedObligation: RevisionObligation | undefined;
      let correctiveMemoryTransition: CorrectiveMemoryTransition | undefined;
      if (completion.followUpType === "relearn" && obligation.type !== "relearn") {
        obligation.status = "suspended";
        obligation.suspensionReason = "relearning";
        const existing = (await this.obligationsForUnit(unit.id)).find((item) => item.type === "relearn" && item.status === "active" && item.returnObligationId === obligation.id);
        if (!existing) {
          const dueAt = correctiveRelearnDueAt(profile, reviewedAt);
          const policy = this.router.get("relearn");
          const time = reviewedAt.toISOString();
          const followUpId = uid("obligation");
          const remediationPlan = memoryDifficulty
            ? memoryDifficultyRemediationPlan(memoryDifficulty)
            : { priorityBoost: 2, guidance: "" };
          const escalation = remediationPlan.guidance;
          const priorityBoost = remediationPlan.priorityBoost;
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
            protocol: `${escalation}Relearn the weak foundations, then repeat: ${obligation.protocol}`,
            successCriteria: `${escalation}Explain the corrected concept independently before returning to ${obligationLabel(obligation.type)}.`,
            workflow: {
              kind: "relearning",
              prompt: `${escalation}Repair the failure, then verify independently: ${obligation.workflow.prompt}`,
              checkpoints: [...obligation.workflow.checkpoints],
              responseMedium: "in-app",
            },
            freshnessDays: obligation.freshnessDays,
            priority: obligation.priority + priorityBoost,
            policyState: policy.createInitialState(dueAt, followUpId),
            parentObligationId: obligation.id,
            returnObligationId: obligation.id,
            createdAt: time,
            updatedAt: time,
          };
        }
      }

      const verificationRating = confirmed;
      const relearningMastered =
        obligation.type === "relearn" &&
        verificationRating >= Rating.Good;
      if (obligation.type === "relearn" && obligation.returnObligationId) {
        const original = await this.repo.get(Store.Obligations, obligation.returnObligationId);
        assert(original, "Relearning return target is missing.");
        if (original.type === "memory-recall") {
          const verificationBeforeDueAt = original.dueAt;
          const verificationBeforePolicyState = clone(original.policyState);
          const priorOriginalReviews = memoryReviewIndex.get(original.id) ?? [];
          const verification = this.router.get("memory-recall").complete(
            original,
            verificationRating,
            normalizedDraft,
            reviewedAt,
            { memoryReviews: priorOriginalReviews },
          );
          assert(verification.schedulerConfig && verification.reviewLog, "Corrective memory verification lacks FSRS-7 provenance.");
          original.dueAt = verification.dueAt;
          original.policyState = verification.policyState;
          correctiveMemoryTransition = {
            obligationId: original.id,
            rating: verificationRating,
            beforeDueAt: verificationBeforeDueAt,
            afterDueAt: verification.dueAt,
            beforePolicyState: verificationBeforePolicyState,
            afterPolicyState: clone(verification.policyState),
            policyId: verification.policyId,
            schedulerPackage: "ts-fsrs",
            schedulerVersion: FSRS_PACKAGE_VERSION,
            schedulerModel: FSRS_MODEL,
            schedulerConfig: clone(verification.schedulerConfig),
            reviewLog: clone(verification.reviewLog),
          };
          const beforeCard = verificationBeforePolicyState.fsrsCard;
          const afterCard = verification.policyState.fsrsCard;
          assert(beforeCard && afterCard, "Corrective memory verification lacks FSRS-7 card state.");
          const currentVerification: MemoryReviewObservation = {
            evidenceEventId: "pending",
            reviewedAt: reviewedAt.toISOString(),
            rating: verificationRating,
            source: "relearning-verification",
            beforeCard: clone(beforeCard),
            afterCard: clone(afterCard),
            schedulerConfig: clone(verification.schedulerConfig),
            configFingerprint: verification.schedulerConfig.fingerprint,
          };
          const difficulty = memoryDifficultyAssessment(
            original,
            this.settings.memoryDifficultyPolicy,
            [...priorOriginalReviews, currentVerification],
          );
          if (relearningMastered) {
            obligation.status = "completed";
            if (difficulty.automaticHoldEligible) {
              original.status = "suspended";
              original.suspensionReason = "persistent-difficulty";
            } else {
              original.status = "active";
              delete original.suspensionReason;
            }
          } else {
            original.status = "suspended";
            original.suspensionReason = "relearning";
            const remediation = memoryDifficultyRemediationPlan(difficulty);
            obligation.priority = Math.max(obligation.priority, original.priority + remediation.priorityBoost);
          }
          original.updatedAt = reviewedAt.toISOString();
          relatedObligation = original;
        } else if (relearningMastered) {
          obligation.status = "completed";
          original.dueAt = addDays(reviewedAt, 3).toISOString();
          original.status = "active";
          delete original.suspensionReason;
          original.updatedAt = reviewedAt.toISOString();
          relatedObligation = original;
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
      if (correctiveMemoryTransition) event.correctiveMemoryTransition = correctiveMemoryTransition;

      const dailyPlan = await this.completedPlanRecord(obligation.id, undefined, roundTo(timing.totalActiveMs / 60_000, 1), reviewedAt, event.id);
      await this.repo.recordReview(unit, obligation, event, followUp, relatedObligation, chunkUpdates, dailyPlan, commitGuard, postCommitSession);
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
      const payload = this.validateBackup(await this.exportBackup());
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
      return (await BackupCodec.decode(bytes, (input) => this.validateBackup(input))).inspection;
    }

    async decodeBackupArchive(bytes: Uint8Array): Promise<DecodedBackupArchive> {
      return BackupCodec.decode(bytes, (input) => this.validateBackup(input));
    }

    async restoreBackupPayload(payload: BackupPayload, activeTreatment: BackupActiveSessionTreatment): Promise<void> {
      const validated = this.validateBackup(payload);
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

    validateBackup(input: unknown): BackupPayload {
      const candidate = requireRecord(input, "Backup");
      assertExactKeys(candidate, "Backup", ["format", "schemaVersion", "exportedAt", "appVersion", "profiles", "nodes", "units", "studyEvents", "obligations", "evidenceEvents", "chunks", "dailyPlans", "settings", "activeRetrieval"]);
      assert(candidate["format"] === BACKUP_FORMAT && candidate["schemaVersion"] === BACKUP_SCHEMA_VERSION, "This is not a supported Revision Director backup.");
      const appVersion = canonicalId(requiredString(candidate["appVersion"], "Backup application version"), "Backup application version");

      const profiles = canonicalDocumentArray("profile", candidate["profiles"], "Backup profiles");
      const nodes = canonicalDocumentArray("node", candidate["nodes"], "Backup knowledge nodes");
      const units = canonicalDocumentArray("unit", candidate["units"], "Backup knowledge units");
      const studyEvents = canonicalDocumentArray("study-event", candidate["studyEvents"], "Backup study events");
      const obligations = canonicalDocumentArray("obligation", candidate["obligations"], "Backup obligations");
      const evidenceEvents = canonicalDocumentArray("evidence-event", candidate["evidenceEvents"], "Backup evidence events");
      const chunks = canonicalDocumentArray("chunk", candidate["chunks"], "Backup chunks");
      const dailyPlans = canonicalDocumentArray("daily-plan", candidate["dailyPlans"], "Backup daily plans");
      const settings = canonicalDocument("settings", candidate["settings"]);
      const activeInput = candidate["activeRetrieval"];
      assert(activeInput === null || isRecord(activeInput), "Backup active retrieval is invalid.");
      const activeRetrieval = activeInput === null ? null : canonicalDocument("active-retrieval", activeInput);

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
      for (const obligation of obligations) {
        const unit = unitMap.get(obligation.unitId);
        assert(unit, "Obligation references a missing unit.");
        assert(Object.hasOwn(POLICY_ENGINE_BY_OBLIGATION, obligation.type), "Obligation type is invalid.");
        assert(["active", "completed", "suspended", "archived"].includes(obligation.status), "Obligation status is invalid.");
        if (obligation.status === "suspended") assert(obligation.suspensionReason === "unit" || obligation.suspensionReason === "relearning" || obligation.suspensionReason === "persistent-difficulty", "Suspended obligation lacks a valid reason.");
        else assert(obligation.suspensionReason === undefined, "Only suspended obligations may retain a suspension reason.");
        if (obligation.suspensionReason === "relearning") {
          assert([...obligationMap.values()].some((item) =>
            item.type === "relearn" &&
            (item.status === "active" || item.status === "suspended") &&
            item.returnObligationId === obligation.id
          ), "Relearning suspension lacks its unresolved repair obligation.");
        }
        if (obligation.suspensionReason === "persistent-difficulty") assert(obligation.type === "memory-recall", "Persistent-difficulty hold is only valid for memory recall.");
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
        assert(obligation.policyState.engine === POLICY_ENGINE_BY_OBLIGATION[obligation.type], "Obligation policy does not match its type.");
        if (obligation.type === "memory-recall") {
          assert(obligation.policyState.version === FSRS_PACKAGE_VERSION && obligation.policyState.fsrsCard, "Memory obligation has invalid FSRS-7 state.");
          const fsrsCard = obligation.policyState.fsrsCard;
          validateStoredFsrsCard(fsrsCard, obligation.id);
          assert(fsrsCard.dueAt === obligation.dueAt, "Memory obligation due date is not synchronized with its FSRS-7 card.");
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
        assert(event.beforePolicyState.engine === POLICY_ENGINE_BY_OBLIGATION[event.obligationType] && event.afterPolicyState.engine === POLICY_ENGINE_BY_OBLIGATION[event.obligationType], "Evidence policy states do not match the obligation type.");
        if (event.followUpObligationId) assert(obligationMap.has(event.followUpObligationId), "Evidence event references a missing follow-up obligation.");
        if (event.obligationType !== "memory-recall") {
          const policy = this.router.get(event.obligationType);
          const transitionInput = {
            ...obligation,
            dueAt: event.beforeDueAt,
            policyState: clone(event.beforePolicyState),
          };
          const expected = policy.complete(transitionInput, event.confirmedRating, event.evidence, new Date(event.reviewedAt));
          assert(expected.policyId === event.policyId, "Evidence policy ID does not match the current policy implementation.");
          assert(expected.dueAt === event.afterDueAt, "Evidence next due date does not match the current policy transition.");
          const expectedState = expected.policyState;
          const actualState = event.afterPolicyState;
          assert(
            expectedState.engine === actualState.engine &&
            expectedState.version === actualState.version &&
            expectedState.stage === actualState.stage &&
            expectedState.successStreak === actualState.successStreak &&
            expectedState.failureCount === actualState.failureCount &&
            expectedState.lastIntervalDays === actualState.lastIntervalDays &&
            expectedState.fsrsCard === undefined &&
            actualState.fsrsCard === undefined,
            "Evidence after-policy state does not match the current policy transition.",
          );
        }
        if (event.obligationType === "memory-recall") {
          assert(event.schedulerPackage === "ts-fsrs" && event.schedulerVersion === FSRS_PACKAGE_VERSION && event.schedulerModel === FSRS_MODEL, "Memory evidence lacks exact FSRS-7 provenance.");
          const config = event.schedulerConfig;
          assert(config, "Memory evidence lacks scheduler configuration.");
          validateFsrsConfigSnapshot(config);
        } else assert(event.schedulerPackage === undefined && event.schedulerVersion === undefined && event.schedulerModel === undefined && event.schedulerConfig === undefined, "Non-memory evidence cannot claim FSRS provenance.");

        const corrective = event.correctiveMemoryTransition;
        const relearnReturnId = obligation.type === "relearn" ? obligation.returnObligationId : undefined;
        const correctiveTarget = relearnReturnId ? obligationMap.get(relearnReturnId) : undefined;
        const shouldRecordMemoryVerification =
          obligation.type === "relearn" &&
          correctiveTarget?.type === "memory-recall";
        assert(Boolean(corrective) === shouldRecordMemoryVerification, "Corrective-memory scheduler transition presence is inconsistent with a closed-book memory verification.");
        if (corrective) {
          assert(correctiveTarget?.type === "memory-recall", "Corrective-memory transition lacks a valid memory target.");
          assert(corrective.obligationId === correctiveTarget.id, "Corrective-memory transition targets the wrong obligation.");
          assert(corrective.rating === correctiveMemoryRating(event.confirmedRating, event.evidence), "Corrective-memory transition rating does not match the closed-book verification outcome.");
          validDate(corrective.beforeDueAt, "Corrective-memory prior due date");
          validDate(corrective.afterDueAt, "Corrective-memory next due date");
          assert(corrective.policyId === `memory/ts-fsrs@${FSRS_PACKAGE_VERSION}/fsrs-7`, "Corrective-memory policy provenance is invalid.");
          assert(corrective.schedulerPackage === "ts-fsrs" && corrective.schedulerVersion === FSRS_PACKAGE_VERSION && corrective.schedulerModel === FSRS_MODEL, "Corrective-memory scheduler provenance is invalid.");
          validateFsrsConfigSnapshot(corrective.schedulerConfig);
          for (const state of [corrective.beforePolicyState, corrective.afterPolicyState]) {
            assert(state.engine === "ts-fsrs" && state.version === FSRS_PACKAGE_VERSION && state.fsrsCard?.model === FSRS_MODEL, "Corrective-memory policy state is invalid.");
            assert(state.fsrsCard.cardId === corrective.obligationId, "Corrective-memory card identity is invalid.");
            requiredFsrs7StabilityFast(state.fsrsCard.stabilityFast);
          }
        }
      }
      const canonicalMemoryReviews = memoryReviewObservationIndex(evidenceEvents);
      validateMemoryDatasetProjectionChain(obligations, canonicalMemoryReviews);

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
        const chunking = obligation.chunking;
        if (!chunking) {
          assert(related.every((chunk) => chunk.status === "archived"), "An obligation without active chunking has unfinished chunk records.");
          continue;
        }
        const active = related.filter((chunk) => chunk.cycleId === chunking.cycleId && chunk.status !== "archived");
        assert(active.length === chunking.totalChunks, "Obligation chunk count does not match its active cycle.");
        assert(new Set(active.map((chunk) => chunk.ordinal)).size === active.length, "Obligation chunk ordinals are duplicated.");
        assert(active.every((chunk) => chunk.total === chunking.totalChunks), "Chunk total does not match the obligation cycle.");
        assert(active.every((chunk) => chunk.expectedMinutes <= chunking.capacityMinutes), "Active chunks exceed the capacity that created their cycle.");
        assert(active.reduce((sum, chunk) => sum + chunk.expectedMinutes, 0) + chunking.synthesisMinutes === chunking.originalMinutes, "Chunk durations do not conserve the parent estimate.");
        const completed = active.filter((chunk) => chunk.status === "completed").length;
        assert(completed === chunking.completedChunks, "Obligation completed-chunk count does not match its records.");
        if (chunking.status === "synthesis-ready") assert(completed === active.length, "Synthesis-ready obligations must have all chunks completed.");
        else assert(active.some((chunk) => chunk.status === "pending"), "An active chunking cycle must retain pending work.");
        assert(related.filter((chunk) => chunk.cycleId !== chunking.cycleId).every((chunk) => chunk.status === "archived"), "Prior chunk cycles must be archived.");
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
            assert(Number.isFinite(outcome.actualMinutes) && (outcome.actualMinutes ?? -1) >= 0 && (outcome.actualMinutes ?? -1) <= 10_080 && Boolean(outcome.completedAt), "Completed daily-plan outcomes require a valid rounded duration and completion time.");
            const item = itemByKey.get(outcome.itemKey);
            assert(item, "Completed daily-plan outcome references an unknown item.");
            if (!item.chunkId) {
              const event = outcome.evidenceEventId ? evidenceMap.get(outcome.evidenceEventId) : undefined;
              assert(event?.obligationId === item.obligationId, "Completed parent-plan outcomes require matching retrieval evidence.");
            } else assert(outcome.evidenceEventId === undefined, "Chunk outcomes cannot claim parent retrieval evidence.");
          }
        }
      }
      const evidenceCounts = new Map<string, { total: number; lapses: number }>();
      const evidenceByObligation = new Map<string, EvidenceEvent[]>();
      for (const event of evidenceEvents) {
        const count = evidenceCounts.get(event.unitId) ?? { total: 0, lapses: 0 };
        count.total += 1;
        if (event.confirmedRating === Rating.Again) count.lapses += 1;
        evidenceCounts.set(event.unitId, count);
        const obligationEvents = evidenceByObligation.get(event.obligationId) ?? [];
        obligationEvents.push(event);
        evidenceByObligation.set(event.obligationId, obligationEvents);
      }
      for (const unit of units) {
        const count = evidenceCounts.get(unit.id) ?? { total: 0, lapses: 0 };
        assert(unit.evidenceCount === count.total && unit.lapseCount === count.lapses, "Knowledge unit evidence counters do not match its history.");
      }
      const intervalStateEqual = (left: PolicyState, right: PolicyState): boolean =>
        left.engine === right.engine &&
        left.version === right.version &&
        left.stage === right.stage &&
        left.successStreak === right.successStreak &&
        left.failureCount === right.failureCount &&
        left.lastIntervalDays === right.lastIntervalDays &&
        left.fsrsCard === undefined &&
        right.fsrsCard === undefined;

      for (const obligation of obligations) {
        const obligationEvents = [...(evidenceByObligation.get(obligation.id) ?? [])];

        if (obligation.type !== "memory-recall") {
          const policy = this.router.get(obligation.type);
          let state = policy.createInitialState(obligation.dueAt, obligation.id);
          const remaining = new Set(obligationEvents);
          let priorDueAt: ISODateTime | undefined;
          while (remaining.size > 0) {
            const candidates = [...remaining].filter((event) =>
              intervalStateEqual(event.beforePolicyState, state) &&
              (priorDueAt === undefined || event.beforeDueAt === priorDueAt)
            );
            assert(candidates.length === 1, "Non-memory Evidence Event history is disconnected or forked.");
            const event = candidates[0]!;
            state = event.afterPolicyState;
            priorDueAt = event.afterDueAt;
            remaining.delete(event);
          }
          assert(intervalStateEqual(obligation.policyState, state), "Non-memory obligation policy state does not match its Evidence Event history.");
          if (priorDueAt !== undefined) assert(obligation.dueAt === priorDueAt, "Non-memory obligation due date does not match its Evidence Event history.");
        }

        const acceptedBySample = new Map<number, EvidenceEvent>();
        for (const event of obligationEvents) {
          const observation = event.durationObservation;
          if (!observation.accepted) continue;
          assert(observation.exactSamples >= 1, "Accepted duration evidence has an invalid exact-sample sequence.");
          assert(!acceptedBySample.has(observation.exactSamples), "Accepted duration evidence contains a duplicate exact-sample sequence.");
          acceptedBySample.set(observation.exactSamples, event);
        }
        assert(obligation.durationSampleCount === acceptedBySample.size, "Obligation duration sample count does not match its accepted history.");

        let estimate = obligation.baselineMinutes;
        for (let sample = 1; sample <= obligation.durationSampleCount; sample += 1) {
          const event = acceptedBySample.get(sample);
          assert(event, "Accepted duration evidence sequence is incomplete.");
          assert(event.durationObservation.estimateBefore === estimate, "Accepted duration evidence does not continue the prior estimate.");
          estimate = event.durationObservation.estimateAfter;
        }
        assert(obligation.expectedMinutes === estimate, "Obligation duration estimate does not match its accepted evidence history.");

        for (const event of obligationEvents) {
          const observation = event.durationObservation;
          if (observation.accepted) continue;
          assert(observation.exactSamples >= 0 && observation.exactSamples <= obligation.durationSampleCount, "Rejected duration evidence has an invalid exact-sample sequence.");
          const priorEstimate = observation.exactSamples === 0
            ? obligation.baselineMinutes
            : acceptedBySample.get(observation.exactSamples)?.durationObservation.estimateAfter;
          assert(priorEstimate !== undefined && observation.estimateBefore === priorEstimate && observation.estimateAfter === priorEstimate, "Rejected duration evidence does not preserve the contemporaneous estimate.");
        }
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
      assert(settings.key === "app", "Backup settings key is invalid.");
      this.assertActiveProfileSelection(profiles, settings);
      canonicalFsrsSchedulingSettings(settings.fsrsScheduling);
      const memoryDifficultyPolicy = canonicalMemoryDifficultyPolicy(settings.memoryDifficultyPolicy);
      for (const obligation of obligations) {
        if (obligation.suspensionReason !== "persistent-difficulty") continue;
        assert(memoryDifficultyAssessment(obligation, memoryDifficultyPolicy, canonicalMemoryReviews.get(obligation.id) ?? []).automaticHoldEligible, "Persistent-difficulty hold is not justified by the active automatic-hold policy.");
      }
      assert(Number.isFinite(settings.dailyCapacityMinutes) && settings.dailyCapacityMinutes >= 5 && settings.dailyCapacityMinutes <= 600, "Daily revision capacity is invalid.");
      assert(Number.isInteger(settings.studyDayBoundaryHour) && settings.studyDayBoundaryHour >= 0 && settings.studyDayBoundaryHour <= 12, "Study-day boundary is invalid.");
      return {
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: canonicalIso(requiredString(candidate["exportedAt"], "Backup export date"), "Backup export date"),
        appVersion,
        profiles,
        nodes,
        units,
        studyEvents,
        obligations,
        evidenceEvents,
        chunks,
        dailyPlans,
        settings,
        activeRetrieval: canonicalActive,
      };
    }

  }

  /* ========================================================================== 
     USER INTERFACE CONTROLLER
     ========================================================================== */

