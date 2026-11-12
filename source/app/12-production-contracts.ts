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
    assert(Array.isArray(value.checkpoints), "Workflow checkpoints must be an array.");
    const workflow = clone(value);
    workflow.prompt = canonicalText(workflow.prompt, "Workflow prompt", 8_000);
    workflow.checkpoints = workflow.checkpoints.map((checkpoint) => canonicalName(checkpoint, "Workflow checkpoint", 500));
    assert(new Set(workflow.checkpoints).size === workflow.checkpoints.length, "Workflow checkpoints cannot contain duplicates.");
    if (workflow.questionSetRef !== undefined) workflow.questionSetRef = canonicalText(workflow.questionSetRef, "Question-set reference", 2_000);
    return workflow;
  }

  function canonicalPolicyState(value: PolicyState): PolicyState {
    assertExactKeys(value, "Policy state", ["engine", "version", "stage", "successStreak", "failureCount", "lastIntervalDays", "fsrsCard"]);
    assert(["ts-fsrs", "mastery", "application", "performance", "relearn", "freshness"].includes(value.engine), "Policy engine is invalid.");
    assert(typeof value.version === "string" && value.version.length > 0 && value.version.length <= 80, "Policy version is invalid.");
    assert(Number.isSafeInteger(value.stage) && value.stage >= 0, "Policy stage is invalid.");
    assert(Number.isSafeInteger(value.successStreak) && value.successStreak >= 0, "Policy success streak is invalid.");
    assert(Number.isSafeInteger(value.failureCount) && value.failureCount >= 0, "Policy failure count is invalid.");
    assert(typeof value.lastIntervalDays === "number" && Number.isFinite(value.lastIntervalDays) && value.lastIntervalDays >= 0 && value.lastIntervalDays <= FSRS_MAXIMUM_INTERVAL_DAYS, "Policy interval is invalid.");
    const state = clone(value);
    if (state.engine === "ts-fsrs") {
      assert(state.version === FSRS_PACKAGE_VERSION && state.fsrsCard, "FSRS policy state is incomplete.");
      assertExactKeys(state.fsrsCard, "FSRS card", ["model", "cardId", "dueAt", "stability", "stabilityFast", "difficulty", "scheduledDays", "learningStep", "reps", "lapses", "state", "scheduleStatus", "lastReviewAt"]);
      validateStoredFsrsCard(state.fsrsCard);
      state.fsrsCard.dueAt = canonicalIso(state.fsrsCard.dueAt, "FSRS due date");
      if (state.fsrsCard.lastReviewAt !== undefined) state.fsrsCard.lastReviewAt = canonicalIso(state.fsrsCard.lastReviewAt, "FSRS last review date");
      else delete state.fsrsCard.lastReviewAt;
      assert(state.stage === state.fsrsCard.state, "FSRS policy stage does not match its card state.");
    } else {
      assert(state.version === "1", "Interval policy state uses an unsupported version.");
      assert(state.fsrsCard === undefined, "Only FSRS policy state may contain an FSRS card.");
      delete state.fsrsCard;
    }
    return state;
  }

  function canonicalExamProfile(value: ExamProfile): ExamProfile {
    assertDocumentSchema(value, "Exam profile");
    assertExactKeys(value, "Exam profile", ["schemaVersion", "id", "name", "examDate", "status", "createdAt", "updatedAt"]);
    if (value.examDate) validateCalendarDate(value.examDate, "Exam date");
    assert(ENTITY_STATUSES.includes(value.status), "Exam profile status is invalid.");
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
    assert(["subject", "section", "topic"].includes(value.kind), "Knowledge-node kind is invalid.");
    const name = canonicalName(value.name, "Knowledge-node name");
    const normalizedName = normalizeName(name);
    assert(value.normalizedName === normalizedName, "Knowledge-node normalized name is not canonical.");
    const parentId = value.parentId === null ? null : canonicalId(value.parentId, "Knowledge-node parent ID");
    assert((value.kind === "subject") === (parentId === null), "Knowledge-node parent shape is invalid.");
    return {
      ...clone(value),
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: canonicalId(value.id, "Knowledge-node ID"),
      profileId: canonicalId(value.profileId, "Knowledge-node profile ID"),
      parentId,
      name,
      normalizedName,
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
    assert(unit.importance === 1 || unit.importance === 2 || unit.importance === 3, "Knowledge-unit importance is invalid.");
    assert(ENTITY_STATUSES.includes(unit.status), "Knowledge-unit status is invalid.");
    assert(Number.isSafeInteger(unit.evidenceCount) && unit.evidenceCount >= 0, "Knowledge-unit evidence count is invalid.");
    assert(Number.isSafeInteger(unit.lapseCount) && unit.lapseCount >= 0 && unit.lapseCount <= unit.evidenceCount, "Knowledge-unit lapse count is invalid.");
    unit.createdAt = canonicalIso(unit.createdAt, "Knowledge-unit creation date");
    unit.updatedAt = canonicalIso(unit.updatedAt, "Knowledge-unit update date");
    if (unit.latestEvidenceAt !== undefined) unit.latestEvidenceAt = canonicalIso(unit.latestEvidenceAt, "Knowledge-unit evidence date");
    else delete unit.latestEvidenceAt;
    if (unit.latestEvidenceRating === undefined) delete unit.latestEvidenceRating;
    else unit.latestEvidenceRating = validateRating(unit.latestEvidenceRating);
    assert((unit.evidenceCount === 0) === (unit.latestEvidenceAt === undefined && unit.latestEvidenceRating === undefined), "Knowledge-unit latest-evidence state is inconsistent.");
    if (unit.evidenceCount > 0) assert(unit.latestEvidenceAt !== undefined && unit.latestEvidenceRating !== undefined, "Knowledge-unit latest evidence is incomplete.");
    return unit;
  }

  function canonicalStudyEvent(value: StudyEvent): StudyEvent {
    assertDocumentSchema(value, "Study event");
    assertExactKeys(value, "Study event", ["schemaVersion", "id", "profileId", "occurredAt", "activityMode", "area", "task", "measure", "source", "durationMinutes", "understanding", "linkedUnitIds", "notes", "origin", "createdAt"]);
    assert(ACTIVITY_MODES.includes(value.activityMode), "Study-event activity mode is invalid.");
    assert(STUDY_ORIGINS.includes(value.origin), "Study-event origin is invalid.");
    assert(typeof value.durationMinutes === "number" && Number.isFinite(value.durationMinutes) && value.durationMinutes >= 1 && value.durationMinutes <= 1440, "Study-event duration is invalid.");
    assert(UNDERSTANDING_LEVELS.includes(value.understanding), "Study-event understanding is invalid.");
    assert(Array.isArray(value.linkedUnitIds), "Study-event unit links must be an array.");
    const linkedUnitIds = value.linkedUnitIds.map((id) => canonicalId(id, "Study-event unit ID"));
    assert(new Set(linkedUnitIds).size === linkedUnitIds.length, "Study-event unit links cannot contain duplicates.");
    const measure = canonicalText(value.measure, "Study-event measure", 4_000);
    assert(measure.length > 0, "Study-event measure is required.");
    return {
      ...clone(value),
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: canonicalId(value.id, "Study-event ID"),
      profileId: canonicalId(value.profileId, "Study-event profile ID"),
      occurredAt: canonicalIso(value.occurredAt, "Study-event occurrence date"),
      area: canonicalName(value.area, "Study-event area", 500),
      task: canonicalName(value.task, "Study-event task", 1_000),
      measure,
      source: canonicalText(value.source, "Study-event source", 4_000),
      linkedUnitIds,
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
    assert(OBLIGATION_TYPES.includes(obligation.type), "Revision-obligation type is invalid.");
    assert(["active", "completed", "suspended", "archived"].includes(obligation.status), "Revision-obligation status is invalid.");
    assert(typeof obligation.expectedMinutes === "number" && Number.isFinite(obligation.expectedMinutes) && obligation.expectedMinutes >= 1 && obligation.expectedMinutes <= 240, "Revision-obligation expected duration is invalid.");
    assert(typeof obligation.baselineMinutes === "number" && Number.isFinite(obligation.baselineMinutes) && obligation.baselineMinutes >= 1 && obligation.baselineMinutes <= 240, "Revision-obligation baseline duration is invalid.");
    assert(Number.isSafeInteger(obligation.durationSampleCount) && obligation.durationSampleCount >= 0, "Revision-obligation duration sample count is invalid.");
    assert(Number.isSafeInteger(obligation.freshnessDays) && obligation.freshnessDays >= 1 && obligation.freshnessDays <= 3650, "Revision-obligation freshness period is invalid.");
    assert(Number.isSafeInteger(obligation.priority) && obligation.priority >= 0 && obligation.priority <= 100_000, "Revision-obligation priority is invalid.");
    obligation.dueAt = canonicalIso(obligation.dueAt, "Revision-obligation due date");
    obligation.protocol = canonicalText(obligation.protocol, "Revision protocol");
    obligation.successCriteria = canonicalText(obligation.successCriteria, "Revision success criteria");
    obligation.workflow = canonicalWorkflowSpec(obligation.workflow);
    validateWorkflowSpec(obligation.workflow, obligation.type);
    obligation.policyState = canonicalPolicyState(obligation.policyState);
    assert(obligation.policyState.engine === POLICY_ENGINE_BY_OBLIGATION[obligation.type], "Revision-obligation policy does not match its type.");
    if (obligation.type === "memory-recall") {
      const card = obligation.policyState.fsrsCard;
      assert(card && card.cardId === obligation.id && card.dueAt === obligation.dueAt, "Memory obligation and FSRS card are not synchronized.");
    }
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
    if (obligation.chunking) {
      assertExactKeys(obligation.chunking, "Chunking state", ["cycleId", "status", "originalMinutes", "synthesisMinutes", "capacityMinutes", "totalChunks", "completedChunks", "createdAt"]);
      obligation.chunking.cycleId = canonicalId(obligation.chunking.cycleId, "Chunk-cycle ID");
      assert(obligation.chunking.status === "chunking" || obligation.chunking.status === "synthesis-ready", "Chunking state is invalid.");
      assert(typeof obligation.chunking.originalMinutes === "number" && Number.isFinite(obligation.chunking.originalMinutes) && obligation.chunking.originalMinutes >= 1 && obligation.chunking.originalMinutes <= 240, "Chunking original duration is invalid.");
      assert(typeof obligation.chunking.synthesisMinutes === "number" && Number.isFinite(obligation.chunking.synthesisMinutes) && obligation.chunking.synthesisMinutes >= 1 && obligation.chunking.synthesisMinutes < obligation.chunking.originalMinutes, "Chunking synthesis duration is invalid.");
      assert(Number.isSafeInteger(obligation.chunking.capacityMinutes) && obligation.chunking.capacityMinutes >= 5 && obligation.chunking.capacityMinutes <= 600, "Chunking capacity is invalid.");
      assert(Number.isSafeInteger(obligation.chunking.totalChunks) && obligation.chunking.totalChunks >= 2, "Chunking total is invalid.");
      assert(Number.isSafeInteger(obligation.chunking.completedChunks) && obligation.chunking.completedChunks >= 0 && obligation.chunking.completedChunks <= obligation.chunking.totalChunks, "Chunking completed count is invalid.");
      assert(obligation.chunking.originalMinutes === obligation.expectedMinutes, "Chunking duration does not match the parent obligation.");
      obligation.chunking.createdAt = canonicalIso(obligation.chunking.createdAt, "Chunk-cycle creation date");
    } else delete obligation.chunking;
    return obligation;
  }

  function canonicalObjectiveEvidence(value: ObjectiveEvidence): ObjectiveEvidence {
    assertExactKeys(value, "Objective evidence", ["completeness", "independence", "application", "accuracyPercent", "errorTypes", "correctionNote"]);
    assert(Array.isArray(value.errorTypes), "Evidence errors must be an array.");
    assert(new Set(value.errorTypes).size === value.errorTypes.length, "Evidence errors cannot contain duplicates.");
    const evidence = clone(value);
    evidence.correctionNote = canonicalText(evidence.correctionNote, "Evidence correction note");
    validateEvidence(evidence);
    return evidence;
  }

  function canonicalWorkflowResult(value: WorkflowResult, expected: RetrievalWorkflow): WorkflowResult {
    const keys: Record<RetrievalWorkflow, readonly string[]> = {
      recall: ["kind", "responseMedium", "attemptText", "checkpointTotal", "checkpointsMet", "cueLevel"],
      reconstruction: ["kind", "responseMedium", "attemptText", "shape", "checkpointTotal", "checkpointsMet", "structuralAccuracy", "relationshipAccuracy", "cueLevel"],
      questions: ["kind", "targetCount", "attempted", "correct", "partial", "incorrect", "novelCount", "cueLevel", "questionSetRef", "attemptNotes", "errorSummary"],
      diagram: ["kind", "surface", "checkpointTotal", "checkpointsMet", "labelAccuracy", "spatialAccuracy", "processAccuracy", "cueLevel", "attemptCompleted", "notes"],
      "answer-writing": ["kind", "mode", "responseMedium", "answerText", "demandAddressed", "structure", "contentAccuracy", "examplesEvidence", "conclusion", "completedWithinTime", "attemptElapsedMs", "timeLimitMinutes", "wordCount", "wordLimit", "cueLevel"],
      relearning: ["kind", "diagnosis", "repairAction", "verificationText", "checkpointTotal", "checkpointsMet", "sourceClosedForVerification", "repairCompleted"],
    };
    assertExactKeys(value, "Workflow result", keys[expected]);
    const result = clone(value);
    validateWorkflowResult(result, expected);
    const boundedText = (raw: unknown, field: string, maximum: number): void => {
      assert(typeof raw === "string" && raw.length <= maximum, `${field} is invalid or too long.`);
    };
    if (result.kind === "recall") {
      boundedText(result.attemptText, "Recall attempt", 20_000);
    } else if (result.kind === "reconstruction") {
      boundedText(result.attemptText, "Reconstruction attempt", 20_000);
    } else if (result.kind === "questions") {
      boundedText(result.questionSetRef, "Question-set reference", 500);
      boundedText(result.attemptNotes, "Question attempt notes", 20_000);
      boundedText(result.errorSummary, "Question error summary", 5_000);
    } else if (result.kind === "diagram") {
      boundedText(result.notes, "Diagram notes", 20_000);
    } else if (result.kind === "answer-writing") {
      boundedText(result.answerText, "Answer-writing response", 50_000);
    } else {
      boundedText(result.repairAction, "Relearning repair action", 20_000);
      boundedText(result.verificationText, "Relearning verification", 20_000);
    }
    return result;
  }

  function canonicalFsrsReviewLog(value: unknown, label: string): FsrsReviewLog {
    const record = requireRecord(value, label);
    assertExactKeys(record, label, ["model", "rating", "state", "dueAt", "lastReviewAt", "reviewTime", "stability", "stabilityFast", "difficulty", "scheduledDays", "learningStep", "scheduleStatus"]);
    assert(record["model"] === FSRS_MODEL, `${label} model is invalid.`);
    const rating = validateRating(record["rating"] as Rating);
    const state = requiredSafeInteger(record["state"], `${label} state`);
    assert(state >= 0 && state <= 3, `${label} state is invalid.`);
    const dueAt = canonicalIso(requiredString(record["dueAt"], `${label} due date`), `${label} due date`);
    const lastReviewRaw = record["lastReviewAt"];
    assert(lastReviewRaw === null || typeof lastReviewRaw === "string", `${label} prior review date is invalid.`);
    const lastReviewAt = lastReviewRaw === null ? null : canonicalIso(lastReviewRaw, `${label} prior review date`);
    const reviewTime = canonicalIso(requiredString(record["reviewTime"], `${label} review date`), `${label} review date`);
    const stability = requiredFiniteNumber(record["stability"], `${label} stability`);
    const stabilityFast = requiredFsrs7StabilityFast(requiredFiniteNumber(record["stabilityFast"], `${label} fast stability`));
    const difficulty = requiredFiniteNumber(record["difficulty"], `${label} difficulty`);
    const scheduledDays = requiredFiniteNumber(record["scheduledDays"], `${label} scheduled days`);
    const learningStep = requiredSafeInteger(record["learningStep"], `${label} learning step`);
    assert(stability >= 0 && difficulty >= 0 && scheduledDays >= 0 && learningStep >= 0, `${label} numeric state is invalid.`);
    const scheduleStatus = record["scheduleStatus"];
    if (scheduleStatus !== undefined) assert(scheduleStatus === "new" || scheduleStatus === "learning" || scheduleStatus === "review", `${label} schedule status is invalid.`);
    return {
      model: FSRS_MODEL,
      rating,
      state,
      dueAt,
      lastReviewAt,
      reviewTime,
      stability,
      stabilityFast,
      difficulty,
      scheduledDays,
      learningStep,
      ...(scheduleStatus !== undefined ? { scheduleStatus } : {}),
    };
  }

  function canonicalDurationObservation(value: DurationObservation): DurationObservation {
    assertExactKeys(value, "Duration observation", ["plannedMinutes", "actualMinutes", "accepted", "reason", "estimateBefore", "estimateAfter", "exactSamples", "unitWorkflowSamples", "globalWorkflowSamples"]);
    assert(typeof value.plannedMinutes === "number" && Number.isFinite(value.plannedMinutes) && value.plannedMinutes >= 1 && value.plannedMinutes <= 240, "Duration planned minutes are invalid.");
    assert(typeof value.actualMinutes === "number" && Number.isFinite(value.actualMinutes) && value.actualMinutes >= 0 && value.actualMinutes <= 10_080, "Duration actual minutes are invalid.");
    assert(typeof value.estimateBefore === "number" && Number.isFinite(value.estimateBefore) && value.estimateBefore >= 1 && value.estimateBefore <= 240, "Duration prior estimate is invalid.");
    assert(typeof value.estimateAfter === "number" && Number.isFinite(value.estimateAfter) && value.estimateAfter >= 1 && value.estimateAfter <= 240, "Duration next estimate is invalid.");
    assert(typeof value.accepted === "boolean", "Duration acceptance is invalid.");
    assert(["accepted", "too-short", "too-long", "invalid", "unreliable-interruption"].includes(value.reason), "Duration reason is invalid.");
    assert(value.accepted === (value.reason === "accepted"), "Duration acceptance and reason disagree.");
    assert(value.plannedMinutes === value.estimateBefore, "Duration planned minutes do not match the prior estimate.");
    if (!value.accepted) assert(value.estimateAfter === value.estimateBefore, "Rejected duration evidence cannot change the estimate.");
    for (const count of [value.exactSamples, value.unitWorkflowSamples, value.globalWorkflowSamples]) {
      assert(Number.isSafeInteger(count) && count >= 0, "Duration sample count is invalid.");
    }
    return clone(value);
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
    assert(OBLIGATION_TYPES.includes(event.obligationType), "Evidence-event obligation type is invalid.");
    assert(RETRIEVAL_WORKFLOWS.includes(event.workflow), "Evidence-event workflow is invalid.");
    event.profileId = canonicalId(event.profileId, "Evidence-event profile ID");
    event.unitId = canonicalId(event.unitId, "Evidence-event unit ID");
    event.obligationId = canonicalId(event.obligationId, "Evidence-event obligation ID");
    event.reviewedAt = canonicalIso(event.reviewedAt, "Evidence-event review date");
    event.beforeDueAt = canonicalIso(event.beforeDueAt, "Evidence-event prior due date");
    event.afterDueAt = canonicalIso(event.afterDueAt, "Evidence-event next due date");
    event.beforePolicyState = canonicalPolicyState(event.beforePolicyState);
    event.afterPolicyState = canonicalPolicyState(event.afterPolicyState);
    const expectedEngine = POLICY_ENGINE_BY_OBLIGATION[event.obligationType];
    assert(event.beforePolicyState.engine === expectedEngine && event.afterPolicyState.engine === expectedEngine, "Evidence policy state does not match its obligation type.");
    event.policyId = canonicalId(event.policyId, "Evidence-event policy ID");
    event.timing = canonicalTimingEvidenceSummary(event.timing);
    assert(typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs) && Math.round(value.elapsedMs) === event.timing.totalActiveMs, "Evidence elapsed time does not match timing evidence.");
    event.elapsedMs = event.timing.totalActiveMs;
    event.evidence = canonicalObjectiveEvidence(event.evidence);
    event.workflowResult = canonicalWorkflowResult(event.workflowResult, event.workflow);
    event.suggestedRating = validateRating(event.suggestedRating);
    event.confirmedRating = validateRating(event.confirmedRating);
    event.durationObservation = canonicalDurationObservation(event.durationObservation);
    if (event.obligationType === "memory-recall") {
      assert(event.schedulerPackage === "ts-fsrs" && event.schedulerVersion === FSRS_PACKAGE_VERSION && event.schedulerModel === FSRS_MODEL, "Memory evidence lacks exact FSRS-7 provenance.");
      assert(event.schedulerConfig !== undefined && event.reviewLog !== undefined, "Memory evidence lacks scheduler configuration or review log.");
      event.schedulerConfig = clone(validateFsrsConfigSnapshot(event.schedulerConfig));
      event.reviewLog = canonicalFsrsReviewLog(event.reviewLog, "Evidence scheduler review log");
      assert(event.reviewLog["rating"] === event.confirmedRating, "Evidence scheduler review rating does not match the confirmed rating.");
      assert(event.reviewLog["reviewTime"] === event.reviewedAt, "Evidence scheduler review time does not match the Evidence Event.");
    } else {
      assert(event.schedulerPackage === undefined && event.schedulerVersion === undefined && event.schedulerModel === undefined && event.schedulerConfig === undefined && event.reviewLog === undefined, "Non-memory evidence cannot contain direct FSRS scheduler provenance.");
      delete event.schedulerPackage;
      delete event.schedulerVersion;
      delete event.schedulerModel;
      delete event.schedulerConfig;
      delete event.reviewLog;
    }
    if (event.followUpObligationId !== undefined) event.followUpObligationId = canonicalId(event.followUpObligationId, "Evidence follow-up obligation ID");
    else delete event.followUpObligationId;
    if (event.correctiveMemoryTransition) {
      assert(event.obligationType === "relearn", "Only relearning evidence may contain a corrective memory transition.");
      const transition = event.correctiveMemoryTransition;
      assertExactKeys(transition, "Corrective memory transition", ["obligationId", "rating", "beforeDueAt", "afterDueAt", "beforePolicyState", "afterPolicyState", "policyId", "schedulerPackage", "schedulerVersion", "schedulerModel", "schedulerConfig", "reviewLog"]);
      transition.obligationId = canonicalId(transition.obligationId, "Corrective memory obligation ID");
      transition.rating = validateRating(transition.rating);
      transition.beforeDueAt = canonicalIso(transition.beforeDueAt, "Corrective memory prior due date");
      transition.afterDueAt = canonicalIso(transition.afterDueAt, "Corrective memory next due date");
      transition.beforePolicyState = canonicalPolicyState(transition.beforePolicyState);
      transition.afterPolicyState = canonicalPolicyState(transition.afterPolicyState);
      transition.policyId = canonicalId(transition.policyId, "Corrective memory policy ID");
      assert(transition.schedulerPackage === "ts-fsrs" && transition.schedulerVersion === FSRS_PACKAGE_VERSION && transition.schedulerModel === FSRS_MODEL, "Corrective memory scheduler provenance is invalid.");
      transition.schedulerConfig = clone(validateFsrsConfigSnapshot(transition.schedulerConfig));
      transition.reviewLog = canonicalFsrsReviewLog(transition.reviewLog, "Corrective memory scheduler review log");
      assert(transition.reviewLog["rating"] === transition.rating, "Corrective memory review rating does not match its scheduler log.");
      assert(transition.reviewLog["reviewTime"] === event.reviewedAt, "Corrective memory review time does not match the Evidence Event.");
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
    assert(Number.isSafeInteger(chunk.ordinal) && Number.isSafeInteger(chunk.total) && chunk.ordinal >= 1 && chunk.ordinal <= chunk.total, "Obligation-chunk order is invalid.");
    assert(typeof chunk.expectedMinutes === "number" && Number.isFinite(chunk.expectedMinutes) && chunk.expectedMinutes >= 1 && chunk.expectedMinutes <= 240, "Obligation-chunk expected duration is invalid.");
    assert(chunk.status === "pending" || chunk.status === "completed" || chunk.status === "archived", "Obligation-chunk status is invalid.");
    chunk.createdAt = canonicalIso(chunk.createdAt, "Obligation-chunk creation date");
    chunk.updatedAt = canonicalIso(chunk.updatedAt, "Obligation-chunk update date");
    if (chunk.completedAt !== undefined) chunk.completedAt = canonicalIso(chunk.completedAt, "Obligation-chunk completion date");
    else delete chunk.completedAt;
    if (chunk.note !== undefined) chunk.note = canonicalText(chunk.note, "Obligation-chunk note");
    else delete chunk.note;
    if (chunk.actualMinutes === undefined) delete chunk.actualMinutes;
    else assert(typeof chunk.actualMinutes === "number" && Number.isFinite(chunk.actualMinutes) && chunk.actualMinutes > 0 && chunk.actualMinutes <= 10_080, "Obligation-chunk actual duration is invalid.");
    if (chunk.status === "completed") assert(chunk.completedAt !== undefined && chunk.actualMinutes !== undefined && chunk.timing !== undefined, "Completed chunk evidence is incomplete.");
    if (chunk.status === "pending") assert(chunk.completedAt === undefined && chunk.actualMinutes === undefined && chunk.timing === undefined, "Pending chunk cannot contain completion evidence.");
    if (chunk.timing !== undefined) chunk.timing = canonicalTimingEvidenceSummary(chunk.timing);
    else delete chunk.timing;
    return chunk;
  }

  function canonicalDailyPlanRecord(value: DailyPlanRecord): DailyPlanRecord {
    assertDocumentSchema(value, "Daily plan");
    assertExactKeys(value, "Daily plan", ["schemaVersion", "id", "studyDayKey", "createdAt", "updatedAt", "plannerVersion", "versions", "outcomes"]);
    validateCalendarDate(value.studyDayKey, "Daily plan study day");
    assert(Array.isArray(value.versions) && value.versions.length > 0, "Daily plan requires at least one version.");
    assert(Array.isArray(value.outcomes), "Daily plan outcomes must be an array.");
    const versions = value.versions.map((version) => {
      assertExactKeys(version, "Daily-plan version", ["version", "generatedAt", "capacityMinutes", "items", "reason"]);
      assert(Number.isSafeInteger(version.version) && version.version >= 1, "Daily-plan version number is invalid.");
      assert(Number.isSafeInteger(version.capacityMinutes) && version.capacityMinutes >= 5 && version.capacityMinutes <= 600, "Daily-plan version capacity is invalid.");
      assert(version.reason === "initial" || version.reason === "manual-regeneration" || version.reason === "data-change" || version.reason === "manual-addition", "Daily-plan version reason is invalid.");
      assert(Array.isArray(version.items), "Daily-plan version items must be an array.");
      const items = version.items.map((item) => {
        assertExactKeys(item, "Daily-plan item", ["key", "obligationId", "chunkId", "profileId", "unitId", "subject", "workflow", "title", "estimatedMinutes", "score", "disposition", "reasons"]);
        assert(RETRIEVAL_WORKFLOWS.includes(item.workflow), "Daily-plan item workflow is invalid.");
        assert(typeof item.estimatedMinutes === "number" && Number.isFinite(item.estimatedMinutes) && item.estimatedMinutes >= 1 && item.estimatedMinutes <= 240, "Daily-plan item duration is invalid.");
        assert(typeof item.score === "number" && Number.isFinite(item.score) && item.score >= 0 && item.score <= 100, "Daily-plan item score is invalid.");
        assert(item.disposition === "selected" || item.disposition === "required-overrun" || item.disposition === "must-split" || item.disposition === "deferred", "Daily-plan item disposition is invalid.");
        assert(Array.isArray(item.reasons), "Daily-plan item reasons must be an array.");
        return {
          key: canonicalId(item.key, "Daily-plan item key"),
          obligationId: canonicalId(item.obligationId, "Daily-plan obligation ID"),
          ...(item.chunkId !== undefined ? { chunkId: canonicalId(item.chunkId, "Daily-plan chunk ID") } : {}),
          profileId: canonicalId(item.profileId, "Daily-plan profile ID"),
          unitId: canonicalId(item.unitId, "Daily-plan unit ID"),
          subject: canonicalName(item.subject, "Daily-plan subject", 500),
          workflow: item.workflow,
          title: canonicalName(item.title, "Daily-plan title", 500),
          estimatedMinutes: item.estimatedMinutes,
          score: item.score,
          disposition: item.disposition,
          reasons: item.reasons.map((reason) => canonicalText(reason, "Daily-plan reason", 500)),
        } satisfies DailyPlanItemSnapshot;
      });
      assert(new Set(items.map((item) => item.key)).size === items.length, "Daily-plan version contains duplicate item keys.");
      return {
        version: version.version,
        generatedAt: canonicalIso(version.generatedAt, "Daily-plan version date"),
        capacityMinutes: version.capacityMinutes,
        items,
        reason: version.reason,
      } satisfies DailyPlanVersion;
    });
    assert(versions.every((version, index) => version.version === index + 1), "Daily-plan versions must be sequential.");
    const outcomes = value.outcomes.map((outcome) => {
      assertExactKeys(outcome, "Daily-plan outcome", ["itemKey", "status", "startedAt", "completedAt", "actualMinutes", "evidenceEventId", "note"]);
      assert(outcome.status === "planned" || outcome.status === "started" || outcome.status === "completed" || outcome.status === "skipped", "Daily-plan outcome status is invalid.");
      if (outcome.actualMinutes !== undefined) assert(typeof outcome.actualMinutes === "number" && Number.isFinite(outcome.actualMinutes) && outcome.actualMinutes > 0 && outcome.actualMinutes <= 10_080, "Daily-plan actual duration is invalid.");
      const canonical: DailyPlanOutcome = {
        itemKey: canonicalId(outcome.itemKey, "Daily-plan outcome key"),
        status: outcome.status,
        ...(outcome.startedAt !== undefined ? { startedAt: canonicalIso(outcome.startedAt, "Daily-plan start date") } : {}),
        ...(outcome.completedAt !== undefined ? { completedAt: canonicalIso(outcome.completedAt, "Daily-plan completion date") } : {}),
        ...(outcome.actualMinutes !== undefined ? { actualMinutes: outcome.actualMinutes } : {}),
        ...(outcome.evidenceEventId !== undefined ? { evidenceEventId: canonicalId(outcome.evidenceEventId, "Daily-plan evidence ID") } : {}),
        ...(outcome.note !== undefined ? { note: canonicalText(outcome.note, "Daily-plan outcome note") } : {}),
      };
      if (canonical.status === "started") assert(canonical.startedAt !== undefined, "Started daily-plan outcome requires a start time.");
      if (canonical.status === "completed") assert(canonical.completedAt !== undefined && canonical.actualMinutes !== undefined, "Completed daily-plan outcome is incomplete.");
      return canonical;
    });
    assert(new Set(outcomes.map((outcome) => outcome.itemKey)).size === outcomes.length, "Daily plan contains duplicate outcome keys.");
    const createdAt = canonicalIso(value.createdAt, "Daily-plan creation date");
    const updatedAt = canonicalIso(value.updatedAt, "Daily-plan update date");
    assert(Date.parse(updatedAt) >= Date.parse(createdAt), "Daily-plan timestamps are inconsistent.");
    return {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: canonicalId(value.id, "Daily-plan ID"),
      studyDayKey: value.studyDayKey,
      createdAt,
      updatedAt,
      plannerVersion: canonicalId(value.plannerVersion, "Daily-plan planner version"),
      versions,
      outcomes,
    };
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
    const reliabilityFlags = [...value.reliabilityFlags];
    assert(new Set(reliabilityFlags).size === reliabilityFlags.length, "Timing reliability flags cannot contain duplicates.");
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
      pauseMs: bounded(value.pauseMs, "Pause time"),
      pauseCount: count(value.pauseCount, "Pause count"),
      inactiveGapCount: count(value.inactiveGapCount, "Inactive-gap count"),
      classifiedFocusMs: bounded(value.classifiedFocusMs, "Classified focus time"),
      classifiedBreakMs: bounded(value.classifiedBreakMs, "Classified break time"),
      ignoredGapMs,
      promptExcludedMs: bounded(value.promptExcludedMs, "Gap prompt time"),
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
    assert(Array.isArray(value.pauseHistory) && value.pauseHistory.length <= TIME_HISTORY_LIMIT, "Pause history is invalid or exceeds its canonical bound.");
    const pauseHistory = value.pauseHistory.map((pause) => {
      assertExactKeys(pause, "Pause record", ["id", "reason", "phase", "startedAt", "endedAt", "durationMs"]);
      assert(["manual", "inactive-gap-break", "classification-prompt"].includes(pause.reason), "Pause reason is invalid.");
      const startedAt = canonicalIso(pause.startedAt, "Pause start date");
      const endedAt = canonicalIso(pause.endedAt, "Pause end date");
      const durationMs = boundedRuntimeMs(pause.durationMs, "Pause duration");
      assert(Date.parse(endedAt) >= Date.parse(startedAt), "Pause end precedes its start.");
      return { id: canonicalId(pause.id, "Pause ID"), reason: pause.reason, phase: canonicalReviewPhase(pause.phase), startedAt, endedAt, durationMs };
    });
    assert(Array.isArray(value.phaseHistory) && value.phaseHistory.length <= TIME_HISTORY_LIMIT, "Phase history is invalid or exceeds its canonical bound.");
    const phaseHistory = value.phaseHistory.map((transition) => {
      assertExactKeys(transition, "Phase transition", ["from", "to", "at", "sourceVisible", "reason"]);
      assert(["source-reveal", "begin-verification", "verification-reveal", "queue-advance"].includes(transition.reason), "Phase transition reason is invalid.");
      assert(typeof transition.sourceVisible === "boolean", "Phase-transition source visibility is invalid.");
      return { from: canonicalReviewPhase(transition.from), to: canonicalReviewPhase(transition.to), at: canonicalIso(transition.at, "Phase transition date"), sourceVisible: transition.sourceVisible, reason: transition.reason };
    });
    assert(Array.isArray(value.gapHistory) && value.gapHistory.length <= TIME_HISTORY_LIMIT, "Inactive-gap history is invalid or exceeds its canonical bound.");
    const gapHistory = value.gapHistory.map((gap) => {
      assertExactKeys(gap, "Inactive-gap record", ["id", "phase", "source", "detectedAt", "resolvedAt", "gapMs", "classification", "focusMs", "breakMs", "ignoredMs", "promptMs"]);
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
      assertExactKeys(value.pendingGap, "Pending inactive gap", ["id", "phase", "source", "lastReliableAt", "detectedAt", "gapMs"]);
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
    const valueEntries = Object.entries(value.values);
    assert(valueEntries.length <= 96, "Review field set exceeds its canonical bound.");
    const values: Record<string, string> = {};
    for (const [rawKey, rawValue] of valueEntries) {
      const key = canonicalId(rawKey, "Review field ID");
      assert(typeof rawValue === "string" && rawValue.length <= 20_000, "Review field value is invalid or too long.");
      values[key] = rawValue;
    }
    const checkedEntries = Object.entries(value.checked);
    assert(checkedEntries.length <= 128, "Review check set exceeds its canonical bound.");
    const checked: Record<string, boolean> = {};
    for (const [rawKey, rawValue] of checkedEntries) {
      const key = canonicalId(rawKey, "Review check ID");
      assert(typeof rawValue === "boolean", "Review check value is invalid.");
      checked[key] = rawValue;
    }
    assert(value.diagramStrokes.length <= 256, "Review diagram exceeds its canonical stroke bound.");
    const diagramStrokes = value.diagramStrokes.map((stroke) => {
      assert(Array.isArray(stroke) && stroke.length <= 2_000, "Diagram stroke is invalid or exceeds its canonical point bound.");
      return stroke.map((point) => {
        assert(point && typeof point === "object" && !Array.isArray(point), "Diagram point is invalid.");
        assertExactKeys(point, "Diagram point", ["x", "y"]);
        assert(typeof point.x === "number" && Number.isFinite(point.x) && point.x >= 0 && point.x <= 1
          && typeof point.y === "number" && Number.isFinite(point.y) && point.y >= 0 && point.y <= 1, "Diagram point is outside the canonical canvas.");
        return { x: roundTo(point.x, 6), y: roundTo(point.y, 6) };
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
    assert(Array.isArray(value.queueTargetIds) && value.queueTargetIds.length <= 500, "Active retrieval queue is invalid or exceeds its canonical bound.");
    const queueTargetIds = value.queueTargetIds.map((id) => canonicalId(id, "Review target ID"));
    assert(new Set(queueTargetIds).size === queueTargetIds.length, "Active retrieval queue cannot contain duplicate targets.");
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
    if (value.status === "active") assert(commitToken === undefined, "An active retrieval cannot retain a commit token.");
    else assert(commitToken !== undefined, "Committing and completed retrieval states require a commit token.");
    const phase = canonicalReviewPhase(value.phase);
    const draft = canonicalReviewDraftSnapshot(value.draft);
    assert(draft.phase === phase, "Active retrieval draft phase differs from its session phase.");
    const timeRuntime = canonicalPhaseTimeRuntimeSnapshot(value.timeRuntime);
    assert(timeRuntime.currentPhase === phase, "Active retrieval phase and timer phase differ.");
    const elapsedMs = Object.values(timeRuntime.activeByPhase).reduce((sum, amount) => sum + amount, 0);
    assert(typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs) && Math.round(value.elapsedMs) === elapsedMs, "Active retrieval elapsed time does not match phase timing.");
    const startedAt = canonicalIso(value.startedAt, "Active retrieval start date");
    const updatedAt = canonicalIso(value.updatedAt, "Active retrieval update date");
    assert(timeRuntime.sessionStartedAt === startedAt, "Active retrieval start date differs from its timing runtime.");
    assert(Date.parse(updatedAt) >= Date.parse(startedAt), "Active retrieval update precedes its start.");
    return {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: ACTIVE_RETRIEVAL_ID,
      revision: value.revision,
      status: value.status,
      queueTargetIds,
      activeIndex: value.activeIndex,
      activeTargetId,
      phase,
      draft,
      timeRuntime,
      elapsedMs,
      startedAt,
      updatedAt,
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
