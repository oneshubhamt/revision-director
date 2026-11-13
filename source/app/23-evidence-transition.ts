  /* ==========================================================================
     EVIDENCE TRANSITIONS · PURE DOMAIN STATE PREPARATION
     ========================================================================== */

  interface EvidenceDraftPreparation {
    readonly draft: EvidenceDraft;
    readonly timing: TimingEvidenceSummary;
    readonly requestedRating: Rating;
  }

  interface EvidenceRatingDecision {
    readonly confirmedRating: Rating;
    readonly suggestedRating: Rating;
  }

  interface SynthesisDurationContext {
    readonly cycleChunkMs: number;
    readonly durationReliable: boolean;
  }

  interface PrimaryEvidenceTransition {
    readonly obligation: RevisionObligation;
    readonly unit: KnowledgeUnit;
    readonly draft: EvidenceDraft;
    readonly timing: TimingEvidenceSummary;
    readonly confirmedRating: Rating;
    readonly suggestedRating: Rating;
    readonly completion: PolicyCompletion;
    readonly durationObservation: DurationObservation;
    readonly beforeDueAt: ISODateTime;
    readonly beforePolicyState: PolicyState;
    readonly memoryDifficulty?: MemoryDifficultyAssessment;
    readonly reviewedAt: ISODateTime;
  }

  interface CorrectiveRelearningResult {
    readonly relearningObligation: RevisionObligation;
    readonly relatedObligation?: RevisionObligation;
    readonly correctiveMemoryTransition?: CorrectiveMemoryTransition;
  }

  function prepareEvidenceDraft(draft: EvidenceDraft): EvidenceDraftPreparation {
    const timing = canonicalTimingEvidenceSummary(draft.timing);
    const normalizedDraft: EvidenceDraft = { ...clone(draft), elapsedMs: timing.totalActiveMs, timing };
    validateEvidence(normalizedDraft);
    return Object.freeze({
      draft: normalizedDraft,
      timing,
      requestedRating: validateRating(normalizedDraft.confirmedRating),
    });
  }

  function evidenceRatingDecision(obligation: RevisionObligation, prepared: EvidenceDraftPreparation): EvidenceRatingDecision {
    validateWorkflowSpec(obligation.workflow, obligation.type);
    validateWorkflowResult(prepared.draft.workflowResult, obligation.workflow.kind);
    assert(obligation.status === "active", "This obligation is not active.");
    const confirmedRating = obligation.type === "relearn"
      ? correctiveMemoryRating(prepared.requestedRating, prepared.draft)
      : prepared.requestedRating;
    return Object.freeze({
      confirmedRating,
      suggestedRating: suggestRating(obligation.type, prepared.draft),
    });
  }

  function synthesisDurationContext(obligation: RevisionObligation, chunks: readonly ObligationChunk[]): SynthesisDurationContext {
    const chunking = obligation.chunking;
    if (chunking?.status !== "synthesis-ready") return Object.freeze({ cycleChunkMs: 0, durationReliable: true });
    const completed = chunks.filter((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "completed");
    return Object.freeze({
      cycleChunkMs: completed.reduce((sum, chunk) => sum + (chunk.actualMinutes ?? 0) * 60_000, 0),
      durationReliable: completed.every((chunk) => chunk.timing?.durationReliable !== false),
    });
  }

  function applyPrimaryEvidenceTransition(input: {
    obligation: RevisionObligation;
    unit: KnowledgeUnit;
    prepared: EvidenceDraftPreparation;
    rating: EvidenceRatingDecision;
    completion: PolicyCompletion;
    durationObservation: DurationObservation;
    priorMemoryReviews: readonly MemoryReviewObservation[];
    memoryDifficultyPolicy: MemoryDifficultyPolicy;
    reviewedAt: ISODateTime;
  }): PrimaryEvidenceTransition {
    const obligation = clone(input.obligation);
    const unit = clone(input.unit);
    const beforePolicyState = clone(obligation.policyState);
    const beforeDueAt = obligation.dueAt;

    obligation.dueAt = input.completion.dueAt;
    obligation.policyState = clone(input.completion.policyState);

    let memoryDifficulty: MemoryDifficultyAssessment | undefined;
    if (obligation.type === "memory-recall") {
      const beforeCard = beforePolicyState.fsrsCard;
      const afterCard = input.completion.policyState.fsrsCard;
      const schedulerConfig = input.completion.schedulerConfig;
      assert(beforeCard && afterCard && schedulerConfig, "Memory completion is missing FSRS difficulty evidence.");
      const currentReview: MemoryReviewObservation = {
        evidenceEventId: "pending",
        reviewedAt: input.reviewedAt,
        rating: input.rating.confirmedRating,
        source: "direct-memory",
        beforeCard: clone(beforeCard),
        afterCard: clone(afterCard),
        schedulerConfig: clone(schedulerConfig),
        configFingerprint: schedulerConfig.fingerprint,
      };
      memoryDifficulty = memoryDifficultyAssessment(
        obligation,
        input.memoryDifficultyPolicy,
        [...input.priorMemoryReviews, currentReview],
      );
    }

    obligation.updatedAt = input.reviewedAt;
    obligation.lastCompletedAt = input.reviewedAt;
    if (input.durationObservation.accepted) {
      obligation.expectedMinutes = input.durationObservation.estimateAfter;
      obligation.durationSampleCount = input.durationObservation.exactSamples;
    }
    if (input.completion.followUpType === "relearn" && obligation.type !== "relearn") {
      obligation.status = "suspended";
      obligation.suspensionReason = "relearning";
    }

    unit.latestEvidenceAt = input.reviewedAt;
    unit.latestEvidenceRating = input.rating.confirmedRating;
    unit.evidenceCount += 1;
    if (input.rating.confirmedRating === Rating.Again) unit.lapseCount += 1;
    unit.updatedAt = input.reviewedAt;

    return {
      obligation,
      unit,
      draft: input.prepared.draft,
      timing: input.prepared.timing,
      confirmedRating: input.rating.confirmedRating,
      suggestedRating: input.rating.suggestedRating,
      completion: clone(input.completion),
      durationObservation: clone(input.durationObservation),
      beforeDueAt,
      beforePolicyState,
      ...(memoryDifficulty ? { memoryDifficulty } : {}),
      reviewedAt: input.reviewedAt,
    };
  }

  function archiveSynthesisCycle(
    obligationInput: RevisionObligation,
    chunks: readonly ObligationChunk[],
    reviewedAt: ISODateTime,
  ): { obligation: RevisionObligation; chunkUpdates: ObligationChunk[] } {
    const obligation = clone(obligationInput);
    if (obligation.chunking?.status !== "synthesis-ready") return { obligation, chunkUpdates: [] };
    const cycleId = obligation.chunking.cycleId;
    const chunkUpdates = chunks
      .filter((chunk) => chunk.cycleId === cycleId && chunk.status !== "archived")
      .map((chunk) => ({ ...clone(chunk), status: "archived" as const, updatedAt: reviewedAt }));
    delete obligation.chunking;
    return { obligation, chunkUpdates };
  }

  function createRelearningFollowUp(input: {
    obligation: RevisionObligation;
    unit: KnowledgeUnit;
    dueAt: ISODateTime;
    followUpId: string;
    policyState: PolicyState;
    reviewedAt: ISODateTime;
    memoryDifficulty?: MemoryDifficultyAssessment;
  }): RevisionObligation {
    assert(input.obligation.type !== "relearn", "Relearning cannot create a nested relearning obligation.");
    const remediationPlan = input.memoryDifficulty
      ? memoryDifficultyRemediationPlan(input.memoryDifficulty)
      : { priorityBoost: 2, guidance: "" };
    const escalation = remediationPlan.guidance;
    return {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: input.followUpId,
      unitId: input.unit.id,
      type: "relearn",
      status: "active",
      dueAt: input.dueAt,
      expectedMinutes: Math.max(10, input.obligation.expectedMinutes),
      baselineMinutes: Math.max(10, input.obligation.expectedMinutes),
      durationSampleCount: 0,
      protocol: `${escalation}Relearn the weak foundations, then repeat: ${input.obligation.protocol}`,
      successCriteria: `${escalation}Explain the corrected concept independently before returning to ${obligationLabel(input.obligation.type)}.`,
      workflow: {
        kind: "relearning",
        prompt: `${escalation}Repair the failure, then verify independently: ${input.obligation.workflow.prompt}`,
        checkpoints: [...input.obligation.workflow.checkpoints],
        responseMedium: "in-app",
      },
      freshnessDays: input.obligation.freshnessDays,
      priority: input.obligation.priority + remediationPlan.priorityBoost,
      policyState: clone(input.policyState),
      parentObligationId: input.obligation.id,
      returnObligationId: input.obligation.id,
      createdAt: input.reviewedAt,
      updatedAt: input.reviewedAt,
    };
  }

  function applyCorrectiveRelearningTransition(input: {
    relearningObligation: RevisionObligation;
    original: RevisionObligation;
    rating: Rating;
    reviewedAt: ISODateTime;
    memoryDifficultyPolicy: MemoryDifficultyPolicy;
    priorOriginalReviews: readonly MemoryReviewObservation[];
    memoryVerification?: PolicyCompletion;
  }): CorrectiveRelearningResult {
    const relearningObligation = clone(input.relearningObligation);
    const original = clone(input.original);
    const mastered = input.rating >= Rating.Good;

    if (original.type === "memory-recall") {
      const verification = input.memoryVerification;
      assert(verification?.schedulerConfig && verification.reviewLog, "Corrective memory verification lacks FSRS-7 provenance.");
      const beforeDueAt = original.dueAt;
      const beforePolicyState = clone(original.policyState);
      original.dueAt = verification.dueAt;
      original.policyState = clone(verification.policyState);
      original.lastCompletedAt = input.reviewedAt;

      const beforeCard = beforePolicyState.fsrsCard;
      const afterCard = verification.policyState.fsrsCard;
      assert(beforeCard && afterCard, "Corrective memory verification lacks FSRS-7 card state.");
      const currentVerification: MemoryReviewObservation = {
        evidenceEventId: "pending",
        reviewedAt: input.reviewedAt,
        rating: input.rating,
        source: "relearning-verification",
        beforeCard: clone(beforeCard),
        afterCard: clone(afterCard),
        schedulerConfig: clone(verification.schedulerConfig),
        configFingerprint: verification.schedulerConfig.fingerprint,
      };
      const difficulty = memoryDifficultyAssessment(
        original,
        input.memoryDifficultyPolicy,
        [...input.priorOriginalReviews, currentVerification],
      );

      if (mastered) {
        relearningObligation.status = "completed";
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
        relearningObligation.priority = Math.max(relearningObligation.priority, original.priority + remediation.priorityBoost);
      }
      original.updatedAt = input.reviewedAt;
      const correctiveMemoryTransition: CorrectiveMemoryTransition = {
        obligationId: original.id,
        rating: input.rating,
        beforeDueAt,
        afterDueAt: verification.dueAt,
        beforePolicyState,
        afterPolicyState: clone(verification.policyState),
        policyId: verification.policyId,
        schedulerPackage: "ts-fsrs",
        schedulerVersion: FSRS_PACKAGE_VERSION,
        schedulerModel: FSRS_MODEL,
        schedulerConfig: clone(verification.schedulerConfig),
        reviewLog: clone(verification.reviewLog),
      };
      return { relearningObligation, relatedObligation: original, correctiveMemoryTransition };
    }

    if (!mastered) return { relearningObligation };
    relearningObligation.status = "completed";
    original.dueAt = addDays(new Date(input.reviewedAt), 3).toISOString();
    original.status = "active";
    delete original.suspensionReason;
    original.updatedAt = input.reviewedAt;
    return { relearningObligation, relatedObligation: original };
  }

  function buildEvidenceEvent(input: {
    transition: PrimaryEvidenceTransition;
    obligation: RevisionObligation;
    eventId: string;
    createdAt: ISODateTime;
    followUp?: RevisionObligation;
    correctiveMemoryTransition?: CorrectiveMemoryTransition;
  }): EvidenceEvent {
    const { transition } = input;
    const evidence: ObjectiveEvidence = {
      completeness: transition.draft.completeness,
      independence: transition.draft.independence,
      application: transition.draft.application,
      errorTypes: [...transition.draft.errorTypes],
      correctionNote: transition.draft.correctionNote.trim(),
    };
    if (transition.draft.accuracyPercent !== undefined) evidence.accuracyPercent = transition.draft.accuracyPercent;

    const event: EvidenceEvent = {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      id: input.eventId,
      profileId: transition.unit.profileId,
      unitId: transition.unit.id,
      obligationId: input.obligation.id,
      obligationType: input.obligation.type,
      reviewedAt: transition.reviewedAt,
      elapsedMs: transition.timing.totalActiveMs,
      evidence,
      workflow: input.obligation.workflow.kind,
      workflowResult: clone(transition.draft.workflowResult),
      suggestedRating: transition.suggestedRating,
      confirmedRating: transition.confirmedRating,
      beforeDueAt: transition.beforeDueAt,
      afterDueAt: input.obligation.dueAt,
      beforePolicyState: clone(transition.beforePolicyState),
      afterPolicyState: clone(input.obligation.policyState),
      policyId: transition.completion.policyId,
      durationObservation: clone(transition.durationObservation),
      timing: clone(transition.timing),
      createdAt: input.createdAt,
    };
    if (transition.completion.reviewLog) event.reviewLog = clone(transition.completion.reviewLog);
    if (transition.completion.schedulerConfig) event.schedulerConfig = clone(transition.completion.schedulerConfig);
    if (input.obligation.type === "memory-recall") {
      event.schedulerPackage = "ts-fsrs";
      event.schedulerVersion = FSRS_PACKAGE_VERSION;
      const card = input.obligation.policyState.fsrsCard;
      assert(card?.model === FSRS_MODEL, "Memory evidence cannot be committed without current FSRS-7 state.");
      event.schedulerModel = FSRS_MODEL;
    }
    if (input.followUp) event.followUpObligationId = input.followUp.id;
    if (input.correctiveMemoryTransition) event.correctiveMemoryTransition = clone(input.correctiveMemoryTransition);
    return event;
  }
