  /* ==========================================================================
     BACKUP PAYLOAD VALIDATION · PURE CANONICAL RELATIONAL CONTRACT
     ========================================================================== */

  function validateBackupPayload(input: unknown): BackupPayload {
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
    const nodePathKeys = new Set<string>();
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
      const pathKey = [node.profileId, node.parentId ?? "<root>", node.kind, node.normalizedName].join("\u0000");
      assert(!nodePathKeys.has(pathKey), "Knowledge hierarchy contains duplicate semantic paths.");
      nodePathKeys.add(pathKey);
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
      assert(event.beforePolicyState.engine === POLICY_ENGINE_BY_OBLIGATION[event.obligationType] && event.afterPolicyState.engine === POLICY_ENGINE_BY_OBLIGATION[event.obligationType], "Evidence policy states do not match the obligation type.");
      if (event.followUpObligationId) assert(obligationMap.has(event.followUpObligationId), "Evidence event references a missing follow-up obligation.");
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
          assert(Number.isFinite(outcome.actualMinutes) && (outcome.actualMinutes ?? 0) > 0 && (outcome.actualMinutes ?? 0) <= 10_080 && Boolean(outcome.completedAt), "Completed daily-plan outcomes require a valid duration and completion time.");
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
    assert(settings.key === "app", "Backup settings key is invalid.");
    assertActiveProfileSelection(profiles, settings);
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
