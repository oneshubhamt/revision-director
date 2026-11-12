  interface DurableDocumentKindMap {
    profile: ExamProfile;
    node: KnowledgeNode;
    unit: KnowledgeUnit;
    "study-event": StudyEvent;
    obligation: RevisionObligation;
    "evidence-event": EvidenceEvent;
    chunk: ObligationChunk;
    "daily-plan": DailyPlanRecord;
    settings: AppSettings;
    metadata: AppMetadata;
    "active-retrieval": ActiveRetrievalSession;
  }
  type DurableDocument = DurableDocumentKindMap[keyof DurableDocumentKindMap];
  type DurableDocumentKind = keyof DurableDocumentKindMap;

  function canonicalId(value: string, label: string): string {
    assert(typeof value === "string", `${label} must be a string.`);
    const canonical = value.trim();
    assert(canonical.length > 0 && canonical.length <= 240, `${label} is invalid.`);
    return canonical;
  }

  function canonicalOptionalId(value: string | undefined, label: string): string | undefined {
    return value === undefined ? undefined : canonicalId(value, label);
  }

  function canonicalName(value: string, label: string, maxLength = 240): string {
    assert(typeof value === "string", `${label} must be a string.`);
    const canonical = value.trim().replace(/\s+/g, " ");
    assert(canonical.length > 0 && canonical.length <= maxLength, `${label} is invalid.`);
    return canonical;
  }

  function canonicalText(value: string, label: string, maxLength = 20_000): string {
    assert(typeof value === "string", `${label} must be a string.`);
    const canonical = value.trim();
    assert(canonical.length <= maxLength, `${label} is too long.`);
    return canonical;
  }

  function canonicalIso(value: ISODateTime, label: string): ISODateTime {
    assert(typeof value === "string", `${label} must be a date-time string.`);
    return parseDate(value).toISOString();
  }

  function canonicalOptionalIso(value: ISODateTime | undefined, label: string): ISODateTime | undefined {
    return value === undefined ? undefined : canonicalIso(value, label);
  }

  function assertDocumentSchema(value: { schemaVersion: DocumentSchemaVersion }, label: string): void {
    assert(value.schemaVersion === DOCUMENT_SCHEMA_VERSION, `${label} uses an unsupported document schema.`);
  }

  function assertExactKeys(value: object, label: string, allowedKeys: readonly string[]): void {
    const allowed = new Set(allowedKeys);
    const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
    assert(unexpected.length === 0, `${label} contains unexpected fields: ${unexpected.join(", ")}.`);
  }

  function canonicalWorkflowSpec(value: WorkflowSpec): WorkflowSpec {
    assertExactKeys(value, "Workflow", ["kind", "prompt", "checkpoints", "responseMedium", "targetCount", "questionSetRef", "timeLimitMinutes", "wordLimit", "reconstructionShape", "answerMode", "diagramSurface"]);
    const workflow = clone(value);
    workflow.prompt = canonicalText(workflow.prompt, "Workflow prompt", 8_000);
    workflow.checkpoints = [...new Set(workflow.checkpoints.map((checkpoint) => canonicalName(checkpoint, "Workflow checkpoint", 500)))];
    workflow.responseMedium = workflow.responseMedium;
    if (workflow.questionSetRef !== undefined) workflow.questionSetRef = canonicalText(workflow.questionSetRef, "Question-set reference", 2_000);
    return workflow;
  }

  function canonicalPolicyState(value: PolicyState): PolicyState {
    assertExactKeys(value, "Policy state", ["engine", "version", "stage", "successStreak", "failureCount", "lastIntervalDays", "fsrsCard"]);
    const state = clone(value);
    if (state.fsrsCard) {
      assertExactKeys(state.fsrsCard, "FSRS card", ["model", "cardId", "dueAt", "stability", "stabilityFast", "difficulty", "scheduledDays", "learningStep", "reps", "lapses", "state", "scheduleStatus", "lastReviewAt"]);
      state.fsrsCard.dueAt = canonicalIso(state.fsrsCard.dueAt, "FSRS due date");
      if (state.fsrsCard.lastReviewAt !== undefined) state.fsrsCard.lastReviewAt = canonicalIso(state.fsrsCard.lastReviewAt, "FSRS last review date");
      else delete state.fsrsCard.lastReviewAt;
    }
    return state;
  }

  function canonicalExamProfile(value: ExamProfile): ExamProfile {
    assertDocumentSchema(value, "Exam profile");
    assertExactKeys(value, "Exam profile", ["schemaVersion", "id", "name", "examDate", "status", "createdAt", "updatedAt"]);
    if (value.examDate) validateCalendarDate(value.examDate, "Exam date");
    return {
      ...clone(value),
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: canonicalId(value.id, "Exam profile ID"),
      name: canonicalName(value.name, "Exam profile name"),
      examDate: value.examDate,
      createdAt: canonicalIso(value.createdAt, "Exam profile creation date"),
      updatedAt: canonicalIso(value.updatedAt, "Exam profile update date"),
    };
  }

  function canonicalKnowledgeNode(value: KnowledgeNode): KnowledgeNode {
    assertDocumentSchema(value, "Knowledge node");
    assertExactKeys(value, "Knowledge node", ["schemaVersion", "id", "profileId", "parentId", "kind", "name", "normalizedName", "createdAt", "updatedAt"]);
    const name = canonicalName(value.name, "Knowledge-node name");
    return {
      ...clone(value),
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: canonicalId(value.id, "Knowledge-node ID"),
      profileId: canonicalId(value.profileId, "Knowledge-node profile ID"),
      parentId: value.parentId === null ? null : canonicalId(value.parentId, "Knowledge-node parent ID"),
      name,
      normalizedName: normalizeName(name),
      createdAt: canonicalIso(value.createdAt, "Knowledge-node creation date"),
      updatedAt: canonicalIso(value.updatedAt, "Knowledge-node update date"),
    };
  }

  function canonicalKnowledgeUnit(value: KnowledgeUnit): KnowledgeUnit {
    assertDocumentSchema(value, "Knowledge unit");
    assertExactKeys(value, "Knowledge unit", ["schemaVersion", "id", "profileId", "topicNodeId", "title", "scope", "source", "importance", "status", "createdAt", "updatedAt", "latestEvidenceAt", "latestEvidenceRating", "evidenceCount", "lapseCount"]);
    const unit = clone(value);
    unit.schemaVersion = DOCUMENT_SCHEMA_VERSION;
    unit.id = canonicalId(unit.id, "Knowledge-unit ID");
    unit.profileId = canonicalId(unit.profileId, "Knowledge-unit profile ID");
    unit.topicNodeId = canonicalId(unit.topicNodeId, "Knowledge-unit topic ID");
    unit.title = canonicalName(unit.title, "Knowledge-unit title", 500);
    unit.scope = canonicalText(unit.scope, "Knowledge-unit scope");
    unit.source = canonicalText(unit.source, "Knowledge-unit source", 4_000);
    unit.createdAt = canonicalIso(unit.createdAt, "Knowledge-unit creation date");
    unit.updatedAt = canonicalIso(unit.updatedAt, "Knowledge-unit update date");
    if (unit.latestEvidenceAt !== undefined) unit.latestEvidenceAt = canonicalIso(unit.latestEvidenceAt, "Knowledge-unit evidence date");
    else delete unit.latestEvidenceAt;
    if (unit.latestEvidenceRating === undefined) delete unit.latestEvidenceRating;
    return unit;
  }

  function canonicalStudyEvent(value: StudyEvent): StudyEvent {
    assertDocumentSchema(value, "Study event");
    assertExactKeys(value, "Study event", ["schemaVersion", "id", "profileId", "occurredAt", "activityMode", "area", "task", "measure", "source", "durationMinutes", "understanding", "linkedUnitIds", "notes", "origin", "createdAt"]);
    return {
      ...clone(value),
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: canonicalId(value.id, "Study-event ID"),
      profileId: canonicalId(value.profileId, "Study-event profile ID"),
      occurredAt: canonicalIso(value.occurredAt, "Study-event occurrence date"),
      area: canonicalName(value.area, "Study-event area", 500),
      task: canonicalName(value.task, "Study-event task", 1_000),
      measure: canonicalText(value.measure, "Study-event measure", 4_000),
      source: canonicalText(value.source, "Study-event source", 4_000),
      linkedUnitIds: [...new Set(value.linkedUnitIds.map((id) => canonicalId(id, "Study-event unit ID")))],
      notes: canonicalText(value.notes, "Study-event notes"),
      createdAt: canonicalIso(value.createdAt, "Study-event creation date"),
    };
  }

  function canonicalRevisionObligation(value: RevisionObligation): RevisionObligation {
    assertDocumentSchema(value, "Revision obligation");
    assertExactKeys(value, "Revision obligation", ["schemaVersion", "id", "unitId", "type", "status", "suspensionReason", "dueAt", "expectedMinutes", "baselineMinutes", "durationSampleCount", "chunking", "protocol", "successCriteria", "workflow", "freshnessDays", "priority", "policyState", "parentObligationId", "returnObligationId", "createdAt", "updatedAt", "lastCompletedAt"]);
    const obligation = clone(value);
    obligation.schemaVersion = DOCUMENT_SCHEMA_VERSION;
    obligation.id = canonicalId(obligation.id, "Revision-obligation ID");
    obligation.unitId = canonicalId(obligation.unitId, "Revision-obligation unit ID");
    obligation.dueAt = canonicalIso(obligation.dueAt, "Revision-obligation due date");
    obligation.protocol = canonicalText(obligation.protocol, "Revision protocol");
    obligation.successCriteria = canonicalText(obligation.successCriteria, "Revision success criteria");
    obligation.workflow = canonicalWorkflowSpec(obligation.workflow);
    obligation.policyState = canonicalPolicyState(obligation.policyState);
    if (obligation.parentObligationId !== undefined) obligation.parentObligationId = canonicalId(obligation.parentObligationId, "Parent obligation ID");
    else delete obligation.parentObligationId;
    if (obligation.returnObligationId !== undefined) obligation.returnObligationId = canonicalId(obligation.returnObligationId, "Return obligation ID");
    else delete obligation.returnObligationId;
    obligation.createdAt = canonicalIso(obligation.createdAt, "Revision-obligation creation date");
    obligation.updatedAt = canonicalIso(obligation.updatedAt, "Revision-obligation update date");
    if (obligation.lastCompletedAt !== undefined) obligation.lastCompletedAt = canonicalIso(obligation.lastCompletedAt, "Revision-obligation completion date");
    else delete obligation.lastCompletedAt;
    if (obligation.status === "suspended") {
      assert(obligation.suspensionReason === "unit" || obligation.suspensionReason === "relearning" || obligation.suspensionReason === "persistent-difficulty", "Suspended obligation lacks a valid reason.");
    } else {
      assert(obligation.suspensionReason === undefined, "Only suspended obligations may retain a suspension reason.");
      delete obligation.suspensionReason;
    }
    if (obligation.suspensionReason === "persistent-difficulty") assert(obligation.type === "memory-recall", "Persistent-difficulty hold is only valid for memory recall.");
    if (obligation.chunking) obligation.chunking.createdAt = canonicalIso(obligation.chunking.createdAt, "Chunk-cycle creation date");
    else delete obligation.chunking;
    return obligation;
  }

  function canonicalEvidenceEvent(value: EvidenceEvent): EvidenceEvent {
    assertDocumentSchema(value, "Evidence event");
    const allowed = new Set([
      "schemaVersion", "id", "profileId", "unitId", "obligationId", "obligationType",
      "reviewedAt", "elapsedMs", "evidence", "workflow", "workflowResult",
      "suggestedRating", "confirmedRating", "beforeDueAt", "afterDueAt",
      "beforePolicyState", "afterPolicyState", "policyId", "schedulerPackage",
      "schedulerVersion", "schedulerModel", "schedulerConfig", "reviewLog",
      "durationObservation", "timing", "followUpObligationId",
      "correctiveMemoryTransition", "createdAt",
    ]);
    assert(Object.keys(value).every((key) => allowed.has(key)), "Evidence event contains unexpected fields.");
    const event = clone(value);
    event.schemaVersion = DOCUMENT_SCHEMA_VERSION;
    event.id = canonicalId(event.id, "Evidence-event ID");
    event.profileId = canonicalId(event.profileId, "Evidence-event profile ID");
    event.unitId = canonicalId(event.unitId, "Evidence-event unit ID");
    event.obligationId = canonicalId(event.obligationId, "Evidence-event obligation ID");
    event.reviewedAt = canonicalIso(event.reviewedAt, "Evidence-event review date");
    event.beforeDueAt = canonicalIso(event.beforeDueAt, "Evidence-event prior due date");
    event.afterDueAt = canonicalIso(event.afterDueAt, "Evidence-event next due date");
    event.beforePolicyState = canonicalPolicyState(event.beforePolicyState);
    event.afterPolicyState = canonicalPolicyState(event.afterPolicyState);
    event.policyId = canonicalId(event.policyId, "Evidence-event policy ID");
    event.timing = canonicalTimingEvidenceSummary(event.timing);
    event.elapsedMs = event.timing.totalActiveMs;
    event.evidence.errorTypes = [...new Set(event.evidence.errorTypes)];
    event.evidence.correctionNote = canonicalText(event.evidence.correctionNote, "Evidence correction note");
    if (event.followUpObligationId !== undefined) event.followUpObligationId = canonicalId(event.followUpObligationId, "Evidence follow-up obligation ID");
    else delete event.followUpObligationId;
    if (event.correctiveMemoryTransition) {
      const transition = event.correctiveMemoryTransition;
      transition.obligationId = canonicalId(transition.obligationId, "Corrective memory obligation ID");
      transition.rating = validateRating(transition.rating);
      transition.beforeDueAt = canonicalIso(transition.beforeDueAt, "Corrective memory prior due date");
      transition.afterDueAt = canonicalIso(transition.afterDueAt, "Corrective memory next due date");
      transition.beforePolicyState = canonicalPolicyState(transition.beforePolicyState);
      transition.afterPolicyState = canonicalPolicyState(transition.afterPolicyState);
      transition.policyId = canonicalId(transition.policyId, "Corrective memory policy ID");
    } else delete event.correctiveMemoryTransition;
    event.createdAt = canonicalIso(event.createdAt, "Evidence-event creation date");
    return event;
  }

  function canonicalObligationChunk(value: ObligationChunk): ObligationChunk {
    assertDocumentSchema(value, "Obligation chunk");
    assertExactKeys(value, "Obligation chunk", ["schemaVersion", "id", "obligationId", "cycleId", "ordinal", "total", "label", "scope", "expectedMinutes", "status", "createdAt", "updatedAt", "completedAt", "actualMinutes", "note", "timing"]);
    const chunk = clone(value);
    chunk.schemaVersion = DOCUMENT_SCHEMA_VERSION;
    chunk.id = canonicalId(chunk.id, "Obligation-chunk ID");
    chunk.obligationId = canonicalId(chunk.obligationId, "Obligation-chunk obligation ID");
    chunk.cycleId = canonicalId(chunk.cycleId, "Obligation-chunk cycle ID");
    chunk.label = canonicalName(chunk.label, "Obligation-chunk label", 500);
    chunk.scope = canonicalText(chunk.scope, "Obligation-chunk scope");
    chunk.createdAt = canonicalIso(chunk.createdAt, "Obligation-chunk creation date");
    chunk.updatedAt = canonicalIso(chunk.updatedAt, "Obligation-chunk update date");
    if (chunk.completedAt !== undefined) chunk.completedAt = canonicalIso(chunk.completedAt, "Obligation-chunk completion date");
    else delete chunk.completedAt;
    if (chunk.note !== undefined) chunk.note = canonicalText(chunk.note, "Obligation-chunk note");
    else delete chunk.note;
    if (chunk.actualMinutes === undefined) delete chunk.actualMinutes;
    if (chunk.status === "completed") assert(chunk.timing !== undefined, "Completed chunk timing is required.");
    if (chunk.timing !== undefined) chunk.timing = canonicalTimingEvidenceSummary(chunk.timing);
    else delete chunk.timing;
    return chunk;
  }

  function canonicalDailyPlanRecord(value: DailyPlanRecord): DailyPlanRecord {
    assertDocumentSchema(value, "Daily plan");
    assertExactKeys(value, "Daily plan", ["schemaVersion", "id", "studyDayKey", "createdAt", "updatedAt", "plannerVersion", "versions", "outcomes"]);
    validateCalendarDate(value.studyDayKey, "Daily plan study day");
    const plan = clone(value);
    plan.schemaVersion = DOCUMENT_SCHEMA_VERSION;
    plan.id = canonicalId(plan.id, "Daily-plan ID");
    plan.createdAt = canonicalIso(plan.createdAt, "Daily-plan creation date");
    plan.updatedAt = canonicalIso(plan.updatedAt, "Daily-plan update date");
    plan.plannerVersion = canonicalId(plan.plannerVersion, "Daily-plan planner version");
    plan.versions = plan.versions.map((version) => ({
      ...version,
      generatedAt: canonicalIso(version.generatedAt, "Daily-plan version date"),
      items: version.items.map((item) => ({
        ...item,
        key: canonicalId(item.key, "Daily-plan item key"),
        obligationId: canonicalId(item.obligationId, "Daily-plan obligation ID"),
        ...(item.chunkId !== undefined ? { chunkId: canonicalId(item.chunkId, "Daily-plan chunk ID") } : {}),
        profileId: canonicalId(item.profileId, "Daily-plan profile ID"),
        unitId: canonicalId(item.unitId, "Daily-plan unit ID"),
        subject: canonicalName(item.subject, "Daily-plan subject", 500),
        title: canonicalName(item.title, "Daily-plan title", 500),
        reasons: item.reasons.map((reason) => canonicalText(reason, "Daily-plan reason", 500)),
      })),
    }));
    plan.outcomes = plan.outcomes.map((outcome) => ({
      ...outcome,
      itemKey: canonicalId(outcome.itemKey, "Daily-plan outcome key"),
      ...(outcome.startedAt !== undefined ? { startedAt: canonicalIso(outcome.startedAt, "Daily-plan start date") } : {}),
      ...(outcome.completedAt !== undefined ? { completedAt: canonicalIso(outcome.completedAt, "Daily-plan completion date") } : {}),
      ...(outcome.evidenceEventId !== undefined ? { evidenceEventId: canonicalId(outcome.evidenceEventId, "Daily-plan evidence ID") } : {}),
      ...(outcome.note !== undefined ? { note: canonicalText(outcome.note, "Daily-plan outcome note") } : {}),
    }));
    return plan;
  }

  function canonicalAppSettings(value: AppSettings): AppSettings {
    assertDocumentSchema(value, "Application settings");
    assertExactKeys(value, "Application settings", ["schemaVersion", "key", "activeProfileId", "fsrsScheduling", "memoryDifficultyPolicy", "dailyCapacityMinutes", "studyDayBoundaryHour", "fsrsPersonalization"]);
    assert(value.key === "app", "Application settings key is invalid.");
    assert(typeof value.activeProfileId === "string", "Active profile ID must be a string.");
    const fsrsScheduling = canonicalFsrsSchedulingSettings(value.fsrsScheduling);
    const memoryDifficultyPolicy = canonicalMemoryDifficultyPolicy(value.memoryDifficultyPolicy);
    assert(Number.isInteger(value.dailyCapacityMinutes) && value.dailyCapacityMinutes >= 5 && value.dailyCapacityMinutes <= 600, "Daily capacity is invalid.");
    assert(Number.isInteger(value.studyDayBoundaryHour) && value.studyDayBoundaryHour >= 0 && value.studyDayBoundaryHour <= 12, "Study-day boundary hour is invalid.");
    return {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      key: "app",
      activeProfileId: value.activeProfileId ? canonicalId(value.activeProfileId, "Active profile ID") : "",
      fsrsScheduling,
      memoryDifficultyPolicy,
      dailyCapacityMinutes: value.dailyCapacityMinutes,
      studyDayBoundaryHour: value.studyDayBoundaryHour,
      fsrsPersonalization: canonicalFsrsPersonalizationSettings(value.fsrsPersonalization),
    };
  }

  function canonicalAppMetadata(value: AppMetadata): AppMetadata {
    assertDocumentSchema(value, "Application metadata");
    assertExactKeys(value, "Application metadata", ["schemaVersion", "key", "databaseName", "databaseVersion", "applicationVersion", "createdAt", "updatedAt"]);
    assert(value.key === "database", "Application metadata key is invalid.");
    assert(Number.isInteger(value.databaseVersion) && value.databaseVersion >= 1, "Database metadata version is invalid.");
    return {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      key: "database",
      databaseName: canonicalId(value.databaseName, "Database name"),
      databaseVersion: value.databaseVersion,
      applicationVersion: canonicalId(value.applicationVersion, "Application version"),
      createdAt: canonicalIso(value.createdAt, "Database creation date"),
      updatedAt: canonicalIso(value.updatedAt, "Database update date"),
    };
  }


  function canonicalReviewPhase(value: ReviewPhase, label = "Review phase"): ReviewPhase {
    assert(["attempt", "compare", "relearn-repair", "relearn-verify"].includes(value), `${label} is invalid.`);
    return value;
  }

  function canonicalTimingEvidenceSummary(value: TimingEvidenceSummary): TimingEvidenceSummary {
    assert(value && typeof value === "object", "Timing evidence is required.");
    assertExactKeys(value, "Timing evidence", ["totalActiveMs", "activeByPhase", "pauseMs", "pauseCount", "inactiveGapCount", "classifiedFocusMs", "classifiedBreakMs", "ignoredGapMs", "promptExcludedMs", "backwardClockCount", "sourceRevealAt", "durationReliable", "reliabilityFlags"]);
    assert(value.activeByPhase && typeof value.activeByPhase === "object", "Phase timing breakdown is required.");
    assertExactKeys(value.activeByPhase, "Phase timing breakdown", ["attempt", "compare", "relearn-repair", "relearn-verify"]);
    const phases: ReviewPhase[] = ["attempt", "compare", "relearn-repair", "relearn-verify"];
    const activeByPhase = Object.fromEntries(phases.map((phase) => {
      const raw = value.activeByPhase[phase];
      assert(typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 7 * DAY_MS, "Phase active time is invalid.");
      return [phase, Math.round(raw)];
    })) as Record<ReviewPhase, number>;
    const totalActiveMs = Object.values(activeByPhase).reduce((sum, amount) => sum + amount, 0);
    assert(typeof value.totalActiveMs === "number" && Number.isFinite(value.totalActiveMs) && Math.round(value.totalActiveMs) === totalActiveMs, "Total active time does not match phase timing.");
    const bounded = (raw: unknown, label: string) => {
      assert(typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 30 * DAY_MS, `${label} is invalid.`);
      return Math.round(raw);
    };
    const count = (raw: unknown, label: string) => {
      assert(typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= 100_000, `${label} is invalid.`);
      return raw;
    };
    const ignoredGapMs = bounded(value.ignoredGapMs, "Ignored gap time");
    assert(Array.isArray(value.reliabilityFlags), "Timing reliability flags are required.");
    const reliabilityFlags = [...new Set(value.reliabilityFlags)];
    for (const flag of reliabilityFlags) assert(flag === "ignored-gap" || flag === "backward-clock", "Timing reliability flag is invalid.");
    assert((ignoredGapMs > 0) === reliabilityFlags.includes("ignored-gap"), "Ignored-gap reliability flag is inconsistent.");
    const backwardClockCount = count(value.backwardClockCount, "Backward-clock count");
    assert((backwardClockCount > 0) === reliabilityFlags.includes("backward-clock"), "Backward-clock reliability flag is inconsistent.");
    assert(typeof value.durationReliable === "boolean", "Timing reliability state is required.");
    assert(value.durationReliable === (ignoredGapMs === 0), "Timing reliability state is inconsistent.");
    const durationReliable = value.durationReliable;
    return {
      totalActiveMs,
      activeByPhase,
      pauseMs: bounded(Number(value.pauseMs), "Pause time"),
      pauseCount: count(Number(value.pauseCount), "Pause count"),
      inactiveGapCount: count(Number(value.inactiveGapCount), "Inactive-gap count"),
      classifiedFocusMs: bounded(Number(value.classifiedFocusMs), "Classified focus time"),
      classifiedBreakMs: bounded(Number(value.classifiedBreakMs), "Classified break time"),
      ignoredGapMs,
      promptExcludedMs: bounded(Number(value.promptExcludedMs), "Gap prompt time"),
      backwardClockCount,
      ...(value.sourceRevealAt !== undefined ? { sourceRevealAt: canonicalIso(value.sourceRevealAt, "Source reveal date") } : {}),
      durationReliable,
      reliabilityFlags,
    };
  }

  function canonicalPhaseTimeRuntimeSnapshot(value: PhaseTimeRuntimeSnapshot): PhaseTimeRuntimeSnapshot {
    assert(value && typeof value === "object", "Phase-time runtime is invalid.");
    assertExactKeys(value, "Phase-time runtime", ["currentPhase", "state", "sessionStartedAt", "lastTickAt", "activeByPhase", "pauseStartedAt", "pauseHistory", "phaseHistory", "gapHistory", "pendingGap", "sourceVisible", "sourceRevealAt", "backwardClockCount"]);
    const currentPhase = canonicalReviewPhase(value.currentPhase);
    assert(["running", "paused", "gap-pending"].includes(value.state), "Phase-time state is invalid.");
    assert(value.activeByPhase && typeof value.activeByPhase === "object", "Phase-time breakdown is required.");
    assertExactKeys(value.activeByPhase, "Phase-time breakdown", ["attempt", "compare", "relearn-repair", "relearn-verify"]);
    const phaseTotal = (["attempt", "compare", "relearn-repair", "relearn-verify"] as ReviewPhase[])
      .reduce((sum, phase) => {
        const raw = value.activeByPhase[phase];
        assert(typeof raw === "number", "Phase active time is invalid.");
        return sum + raw;
      }, 0);
    const activeByPhase = canonicalTimingEvidenceSummary({
      totalActiveMs: phaseTotal,
      activeByPhase: value.activeByPhase,
      pauseMs: 0, pauseCount: 0, inactiveGapCount: 0,
      classifiedFocusMs: 0, classifiedBreakMs: 0, ignoredGapMs: 0, promptExcludedMs: 0,
      backwardClockCount: 0, durationReliable: true, reliabilityFlags: [],
    }).activeByPhase;
    const boundedRuntimeMs = (raw: unknown, label: string, maximum = 30 * DAY_MS): number => {
      assert(typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= maximum, `${label} is invalid.`);
      return Math.round(raw);
    };
    assert(Array.isArray(value.pauseHistory), "Pause history is required.");
    const pauseHistory = value.pauseHistory.slice(-TIME_HISTORY_LIMIT).map((pause) => {
      assert(["manual", "inactive-gap-break", "classification-prompt"].includes(pause.reason), "Pause reason is invalid.");
      const startedAt = canonicalIso(pause.startedAt, "Pause start date");
      const endedAt = canonicalIso(pause.endedAt, "Pause end date");
      const durationMs = boundedRuntimeMs(pause.durationMs, "Pause duration");
      assert(Date.parse(endedAt) >= Date.parse(startedAt), "Pause end precedes its start.");
      return { id: canonicalId(pause.id, "Pause ID"), reason: pause.reason, phase: canonicalReviewPhase(pause.phase), startedAt, endedAt, durationMs };
    });
    assert(Array.isArray(value.phaseHistory), "Phase history is required.");
    const phaseHistory = value.phaseHistory.slice(-TIME_HISTORY_LIMIT).map((transition) => {
      assert(["source-reveal", "begin-verification", "verification-reveal", "queue-advance"].includes(transition.reason), "Phase transition reason is invalid.");
      assert(typeof transition.sourceVisible === "boolean", "Phase-transition source visibility is invalid.");
      return { from: canonicalReviewPhase(transition.from), to: canonicalReviewPhase(transition.to), at: canonicalIso(transition.at, "Phase transition date"), sourceVisible: transition.sourceVisible, reason: transition.reason };
    });
    assert(Array.isArray(value.gapHistory), "Inactive-gap history is required.");
    const gapHistory = value.gapHistory.slice(-TIME_HISTORY_LIMIT).map((gap) => {
      assert(["focus", "break", "split", "ignore"].includes(gap.classification), "Inactive-gap classification is invalid.");
      assert(["tick", "visibility", "focus", "pageshow", "recovery", "snapshot"].includes(gap.source), "Inactive-gap source is invalid.");
      const gapMs = boundedRuntimeMs(gap.gapMs, "Inactive-gap duration");
      const focusMs = boundedRuntimeMs(gap.focusMs, "Inactive-gap focus portion", gapMs);
      const breakMs = boundedRuntimeMs(gap.breakMs, "Inactive-gap break portion", gapMs);
      const ignoredMs = boundedRuntimeMs(gap.ignoredMs, "Inactive-gap ignored portion", gapMs);
      assert(focusMs + breakMs + ignoredMs === gapMs, "Inactive-gap parts do not equal the detected gap.");
      const detectedAt = canonicalIso(gap.detectedAt, "Inactive-gap detection date");
      const resolvedAt = canonicalIso(gap.resolvedAt, "Inactive-gap resolution date");
      assert(Date.parse(resolvedAt) >= Date.parse(detectedAt), "Inactive-gap resolution precedes detection.");
      return { id: canonicalId(gap.id, "Inactive-gap ID"), phase: canonicalReviewPhase(gap.phase), source: gap.source, detectedAt, resolvedAt, gapMs, classification: gap.classification, focusMs, breakMs, ignoredMs, promptMs: boundedRuntimeMs(gap.promptMs, "Inactive-gap prompt duration") };
    });
    let pendingGap: PendingInactiveGap | undefined;
    if (value.pendingGap) {
      assert(["tick", "visibility", "focus", "pageshow", "recovery", "snapshot"].includes(value.pendingGap.source), "Pending-gap source is invalid.");
      const lastReliableAt = canonicalIso(value.pendingGap.lastReliableAt, "Pending-gap reliable date");
      const detectedAt = canonicalIso(value.pendingGap.detectedAt, "Pending-gap detection date");
      const gapMs = boundedRuntimeMs(value.pendingGap.gapMs, "Pending-gap duration");
      assert(gapMs > INACTIVE_GAP_THRESHOLD_MS, "Pending gap does not exceed the inactive-gap threshold.");
      assert(Date.parse(detectedAt) >= Date.parse(lastReliableAt), "Pending-gap detection precedes the last reliable time.");
      pendingGap = { id: canonicalId(value.pendingGap.id, "Pending-gap ID"), phase: canonicalReviewPhase(value.pendingGap.phase), source: value.pendingGap.source, lastReliableAt, detectedAt, gapMs };
    }
    assert((value.state === "gap-pending") === Boolean(pendingGap), "Pending-gap state is inconsistent.");
    const pauseStartedAt = value.pauseStartedAt !== undefined ? canonicalIso(value.pauseStartedAt, "Manual pause start date") : undefined;
    assert((value.state === "paused") === Boolean(pauseStartedAt), "Manual pause state is inconsistent.");
    assert(typeof value.sourceVisible === "boolean", "Source visibility state is required.");
    return {
      currentPhase,
      state: value.state,
      sessionStartedAt: canonicalIso(value.sessionStartedAt, "Phase-time session start date"),
      lastTickAt: canonicalIso(value.lastTickAt, "Phase-time last tick date"),
      activeByPhase,
      ...(pauseStartedAt ? { pauseStartedAt } : {}),
      pauseHistory,
      phaseHistory,
      gapHistory,
      ...(pendingGap ? { pendingGap } : {}),
      sourceVisible: value.sourceVisible,
      ...(value.sourceRevealAt !== undefined ? { sourceRevealAt: canonicalIso(value.sourceRevealAt, "Source reveal date") } : {}),
      backwardClockCount: (() => {
        const count = value.backwardClockCount;
        assert(typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 100_000, "Backward-clock count is invalid.");
        return count;
      })(),
    };
  }

  function canonicalReviewDraftSnapshot(value: ReviewDraftSnapshot): ReviewDraftSnapshot {
    assert(value && typeof value === "object", "Review draft is invalid.");
    assertExactKeys(value, "Review draft", ["phase", "values", "checked", "diagramStrokes", "attemptElapsedMs"]);
    canonicalReviewPhase(value.phase);
    assert(value.values && typeof value.values === "object" && !Array.isArray(value.values), "Review field values are required.");
    assert(value.checked && typeof value.checked === "object" && !Array.isArray(value.checked), "Review check state is required.");
    assert(Array.isArray(value.diagramStrokes), "Review diagram strokes are required.");
    const values: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(value.values).slice(0, 96)) {
      const key = canonicalId(rawKey, "Review field ID");
      assert(typeof rawValue === "string", "Review field value is invalid.");
      values[key] = rawValue.slice(0, 20_000);
    }
    const checked: Record<string, boolean> = {};
    for (const [rawKey, rawValue] of Object.entries(value.checked).slice(0, 128)) {
      const key = canonicalId(rawKey, "Review check ID");
      assert(typeof rawValue === "boolean", "Review check value is invalid.");
      checked[key] = rawValue;
    }
    const diagramStrokes = value.diagramStrokes.slice(0, 256).map((stroke) => {
      assert(Array.isArray(stroke), "Diagram stroke is invalid.");
      return stroke.slice(0, 2_000).map((point) => {
        assert(point && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y), "Diagram point is invalid.");
        return { x: roundTo(clamp(point.x, 0, 1), 6), y: roundTo(clamp(point.y, 0, 1), 6) };
      });
    });
    assert(Number.isFinite(value.attemptElapsedMs) && value.attemptElapsedMs >= 0 && value.attemptElapsedMs <= 7 * DAY_MS, "Attempt duration is invalid.");
    return { phase: value.phase, values, checked, diagramStrokes, attemptElapsedMs: Math.round(value.attemptElapsedMs) };
  }

  function canonicalActiveRetrievalSession(value: ActiveRetrievalSession): ActiveRetrievalSession {
    assertDocumentSchema(value, "Active retrieval session");
    assertExactKeys(value, "Active retrieval session", ["schemaVersion", "id", "revision", "status", "queueTargetIds", "activeIndex", "activeTargetId", "phase", "draft", "timeRuntime", "elapsedMs", "startedAt", "updatedAt", "commitToken"]);
    assert(value.id === ACTIVE_RETRIEVAL_ID, "Active retrieval session ID is invalid.");
    assert(["active", "committing", "completed"].includes(value.status), "Active retrieval status is invalid.");
    assert(Number.isSafeInteger(value.revision) && value.revision >= 1, "Active retrieval revision is invalid.");
    assert(Array.isArray(value.queueTargetIds), "Active retrieval queue is required.");
    const queueTargetIds = [...new Set(value.queueTargetIds.slice(0, 500).map((id) => canonicalId(id, "Review target ID")))];
    assert(Number.isInteger(value.activeIndex) && value.activeIndex >= 0 && value.activeIndex <= queueTargetIds.length, "Active retrieval index is invalid.");
    assert(typeof value.activeTargetId === "string", "Active retrieval target ID must be a string.");
    const activeTargetId = value.status === "completed" ? value.activeTargetId : canonicalId(value.activeTargetId, "Active review target ID");
    if (value.status === "completed") {
      assert(value.activeIndex === queueTargetIds.length && activeTargetId === "", "Completed retrieval state is inconsistent.");
    } else {
      assert(queueTargetIds.length > 0 && value.activeIndex < queueTargetIds.length, "Active retrieval queue is invalid.");
      assert(queueTargetIds[value.activeIndex] === activeTargetId, "Active retrieval target does not match its queue.");
    }
    const commitToken = value.commitToken === undefined ? undefined : canonicalId(value.commitToken, "Active retrieval commit token");
    if (value.status === "committing") assert(commitToken, "A committing retrieval requires a commit token.");
    const phase = canonicalReviewPhase(value.phase);
    const timeRuntime = canonicalPhaseTimeRuntimeSnapshot(value.timeRuntime);
    assert(timeRuntime.currentPhase === phase, "Active retrieval phase and timer phase differ.");
    const elapsedMs = Object.values(timeRuntime.activeByPhase).reduce((sum, amount) => sum + amount, 0);
    assert(Number.isFinite(value.elapsedMs) && Math.round(value.elapsedMs) === elapsedMs, "Active retrieval elapsed time does not match phase timing.");
    return {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: ACTIVE_RETRIEVAL_ID,
      revision: value.revision,
      status: value.status,
      queueTargetIds,
      activeIndex: value.activeIndex,
      activeTargetId,
      phase,
      draft: canonicalReviewDraftSnapshot(value.draft),
      timeRuntime,
      elapsedMs,
      startedAt: canonicalIso(value.startedAt, "Active retrieval start date"),
      updatedAt: canonicalIso(value.updatedAt, "Active retrieval update date"),
      ...(commitToken ? { commitToken } : {}),
    };
  }

  function checkedDocumentInput<T extends DurableDocument>(input: unknown, label: string): T {
    return requireRecord(input, label) as unknown as T;
  }

  function canonicalDocument<K extends DurableDocumentKind>(kind: K, input: unknown): DurableDocumentKindMap[K];
  function canonicalDocument(kind: DurableDocumentKind, input: unknown): DurableDocument {
    if (kind === "profile") return canonicalExamProfile(checkedDocumentInput<ExamProfile>(input, "Exam profile"));
    if (kind === "node") return canonicalKnowledgeNode(checkedDocumentInput<KnowledgeNode>(input, "Knowledge node"));
    if (kind === "unit") return canonicalKnowledgeUnit(checkedDocumentInput<KnowledgeUnit>(input, "Knowledge unit"));
    if (kind === "study-event") return canonicalStudyEvent(checkedDocumentInput<StudyEvent>(input, "Study event"));
    if (kind === "obligation") return canonicalRevisionObligation(checkedDocumentInput<RevisionObligation>(input, "Revision obligation"));
    if (kind === "evidence-event") return canonicalEvidenceEvent(checkedDocumentInput<EvidenceEvent>(input, "Evidence event"));
    if (kind === "chunk") return canonicalObligationChunk(checkedDocumentInput<ObligationChunk>(input, "Obligation chunk"));
    if (kind === "daily-plan") return canonicalDailyPlanRecord(checkedDocumentInput<DailyPlanRecord>(input, "Daily plan"));
    if (kind === "settings") return canonicalAppSettings(checkedDocumentInput<AppSettings>(input, "Application settings"));
    if (kind === "active-retrieval") return canonicalActiveRetrievalSession(checkedDocumentInput<ActiveRetrievalSession>(input, "Active retrieval session"));
    return canonicalAppMetadata(checkedDocumentInput<AppMetadata>(input, "Application metadata"));
  }

  function canonicalDocumentArray<K extends DurableDocumentKind>(
    kind: K,
    input: unknown,
    label: string,
  ): DurableDocumentKindMap[K][] {
    return requiredArray(input, label).map((value) => canonicalDocument(kind, value));
  }

  function canonicalActiveRetrievalEnvelope(input: unknown): ActiveRetrievalRecoveryEnvelope {
    const value = requireRecord(input, "Active retrieval recovery envelope");
    assertExactKeys(value, "Active retrieval recovery envelope", ["format", "schemaVersion", "savedAt", "session"]);
    assert(value["format"] === ACTIVE_RETRIEVAL_RECOVERY_FORMAT && value["schemaVersion"] === 1, "Active retrieval recovery envelope is invalid.");
    return {
      format: ACTIVE_RETRIEVAL_RECOVERY_FORMAT,
      schemaVersion: 1,
      savedAt: canonicalIso(requiredString(value["savedAt"], "Recovery save date"), "Recovery save date"),
      session: canonicalDocument("active-retrieval", value["session"]),
    };
  }
