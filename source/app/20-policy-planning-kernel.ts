  const MEMORY_EARLY_LEARNING_FAILURE_THRESHOLD = 2 as const;

  const MEMORY_DIFFICULTY_ACTION_LABELS = {
    "scope-review": "reconsider the scope",
    "split-scope": "split oversized material",
    "prerequisite-review": "revisit prerequisites",
    "source-revisit": "revisit source material",
    "representation-change": "change retrieval representation",
    "deliberate-intervention": "flag for deliberate intervention",
  } satisfies Record<MemoryDifficultyAction, string>;

  function defaultMemoryDifficultyPolicy(): MemoryDifficultyPolicy {
    return {
      remediationLapses: 2,
      persistentDifficultyLapses: 4,
      automaticHold: { enabled: false, lapseThreshold: 8 },
    };
  }

  function canonicalMemoryDifficultyPolicy(value: unknown): MemoryDifficultyPolicy {
    const record = requireRecord(value, "Memory difficulty policy");
    const allowed = new Set(["remediationLapses", "persistentDifficultyLapses", "automaticHold"]);
    assert(Object.keys(record).every((key) => allowed.has(key)), "Memory difficulty policy contains unexpected fields.");
    const remediationLapses = Number(record["remediationLapses"]);
    const persistentDifficultyLapses = Number(record["persistentDifficultyLapses"]);
    assert(Number.isSafeInteger(remediationLapses) && remediationLapses >= 2 && remediationLapses <= 99, "Memory remediation lapse threshold is invalid.");
    assert(Number.isSafeInteger(persistentDifficultyLapses) && persistentDifficultyLapses > remediationLapses && persistentDifficultyLapses <= 100, "Persistent-difficulty lapse threshold is invalid.");
    const automaticHoldRecord = requireRecord(record["automaticHold"], "Memory automatic-hold policy");
    const holdAllowed = new Set(["enabled", "lapseThreshold"]);
    assert(Object.keys(automaticHoldRecord).every((key) => holdAllowed.has(key)), "Memory automatic-hold policy contains unexpected fields.");
    const enabled = automaticHoldRecord["enabled"];
    const lapseThreshold = Number(automaticHoldRecord["lapseThreshold"]);
    assert(typeof enabled === "boolean", "Memory automatic-hold flag is invalid.");
    assert(Number.isSafeInteger(lapseThreshold) && lapseThreshold > persistentDifficultyLapses && lapseThreshold <= 1000, "Memory automatic-hold lapse threshold must be later than persistent difficulty.");
    return {
      remediationLapses,
      persistentDifficultyLapses,
      automaticHold: { enabled, lapseThreshold },
    };
  }

  function memoryDifficultyActionLabel(action: MemoryDifficultyAction): string {
    return MEMORY_DIFFICULTY_ACTION_LABELS[action];
  }

  function memoryDifficultyAssessment(
    obligation: RevisionObligation,
    policy: MemoryDifficultyPolicy,
    memoryReviews: readonly MemoryReviewObservation[] = [],
  ): MemoryDifficultyAssessment {
    assert(obligation.type === "memory-recall", "Persistent-difficulty assessment is only valid for memory recall.");
    const canonicalPolicy = canonicalMemoryDifficultyPolicy(policy);
    const card = obligation.policyState.fsrsCard;
    assert(card, "Memory obligation has no FSRS card for difficulty assessment.");

    // Revision Director's one-day learning step can move an unsuccessful new card
    // into FSRS Review state before the learner has ever demonstrated successful
    // retrieval. Host difficulty semantics therefore follow canonical review
    // outcomes: failures before the first Good/Easy observation are learning
    // failures; only failures after establishment count as established lapses.
    let established = false;
    let earlyLearningFailures = 0;
    let establishedLapses = 0;
    if (memoryReviews.length === 0) {
      // Integrity/recovery callers may not have history in hand. The materialized
      // FSRS lapse counter remains a conservative fallback in that narrow case.
      establishedLapses = card.lapses;
    } else {
      for (const review of memoryReviews) {
        if (review.rating === Rating.Again) {
          if (established) establishedLapses += 1;
          else earlyLearningFailures += 1;
        } else if (review.rating >= Rating.Good) {
          established = true;
        }
      }
    }
    const level: MemoryDifficultyLevel =
      establishedLapses >= canonicalPolicy.persistentDifficultyLapses ? "persistent-difficulty"
        : establishedLapses >= canonicalPolicy.remediationLapses ? "remediation"
          : !established && earlyLearningFailures >= MEMORY_EARLY_LEARNING_FAILURE_THRESHOLD ? "learning-difficulty"
            : "normal";
    const recommendedActions: MemoryDifficultyAction[] = [];
    if (level === "learning-difficulty" || level === "remediation") {
      recommendedActions.push("source-revisit", "representation-change");
    } else if (level === "persistent-difficulty") {
      recommendedActions.push("scope-review");
      if (obligation.expectedMinutes > 45 || obligation.chunking !== undefined) recommendedActions.push("split-scope");
      recommendedActions.push("prerequisite-review", "source-revisit", "representation-change", "deliberate-intervention");
    }
    return {
      level,
      establishedLapses,
      earlyLearningFailures,
      recommendedActions,
      automaticHoldEligible:
        level === "persistent-difficulty" &&
        canonicalPolicy.automaticHold.enabled &&
        establishedLapses >= canonicalPolicy.automaticHold.lapseThreshold,
    };
  }

  function memoryDifficultyRemediationPlan(
    assessment: MemoryDifficultyAssessment,
  ): { priorityBoost: number; guidance: string } {
    if (assessment.level === "normal") return { priorityBoost: 2, guidance: "" };
    const actions = assessment.recommendedActions.map(memoryDifficultyActionLabel).join("; ");
    if (assessment.level === "learning-difficulty") {
      return {
        priorityBoost: 3,
        guidance: `Early learning difficulty (${assessment.earlyLearningFailures} failed learning recalls): ${actions}. `,
      };
    }
    if (assessment.level === "remediation") {
      return {
        priorityBoost: 3,
        guidance: `Repeated established-memory failure remediation (${assessment.establishedLapses} established recall failures): ${actions}. `,
      };
    }
    return {
      priorityBoost: 4,
      guidance: `Persistent established-memory difficulty (${assessment.establishedLapses} established recall failures): ${actions}. `,
    };
  }

  function memoryDifficultyWeaknessFloor(level: MemoryDifficultyLevel): number {
    return level === "persistent-difficulty" ? 0.9 : level === "remediation" ? 0.72 : level === "learning-difficulty" ? 0.68 : 0;
  }

  interface SchedulerPolicyContext {
    readonly memoryReviews?: readonly MemoryReviewObservation[];
  }

  interface SchedulerPolicy {
    readonly id: string;
    readonly type: ObligationType;
    createInitialState(firstDueAt: ISODateTime, cardId: string): PolicyState;
    preview(obligation: RevisionObligation, now: Date, context?: SchedulerPolicyContext): SchedulePreview[];
    complete(
      obligation: RevisionObligation,
      rating: Rating,
      evidence: ObjectiveEvidence,
      now: Date,
      context?: SchedulerPolicyContext,
    ): PolicyCompletion;
  }

  const PLANNER_WEIGHTS = Object.freeze({
    dueRisk: 0.30,
    examImportance: 0.20,
    weakness: 0.18,
    reviewDuration: 0.07,
    examinationProximity: 0.15,
    weeklyBalance: 0.10,
  } satisfies Record<keyof PlanningFactors, number>);

  function examDateTime(profile: ExamProfile): Date | undefined {
    if (!profile.examDate) return undefined;
    const parsed = new Date(`${profile.examDate}T23:59:59`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  function daysToExamination(profile: ExamProfile, reference: Date): number {
    const exam = examDateTime(profile);
    if (!exam) return 365;
    const examDay = Date.UTC(exam.getFullYear(), exam.getMonth(), exam.getDate());
    const referenceDay = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
    return Math.round((examDay - referenceDay) / DAY_MS);
  }

  function correctiveRelearnDueAt(profile: ExamProfile, reviewedAt: Date): ISODateTime {
    const ordinaryDue = addDays(reviewedAt, 1);
    const exam = examDateTime(profile);
    if (!exam) return ordinaryDue.toISOString();
    return new Date(Math.max(reviewedAt.getTime(), Math.min(ordinaryDue.getTime(), exam.getTime()))).toISOString();
  }

  function examinationProximityScore(daysToExam: number): number {
    if (daysToExam < 0) return 0;
    if (daysToExam <= 14) return 1;
    if (daysToExam <= 30) return 0.86;
    if (daysToExam <= 60) return 0.72;
    if (daysToExam <= 120) return 0.54;
    if (daysToExam <= 240) return 0.34;
    return 0.18;
  }

  function planningLookaheadDays(daysToExam: number): number {
    if (daysToExam < 0) return 0;
    if (daysToExam <= 14) return 3;
    if (daysToExam <= 30) return 2;
    if (daysToExam <= 90) return 1;
    return 0.5;
  }

  function examImportanceScore(importance: KnowledgeUnit["importance"]): number {
    return importance === 3 ? 1 : importance === 2 ? 0.65 : 0.3;
  }

  function reviewDurationScore(expectedMinutes: number, capacityMinutes: number): number {
    const proportion = expectedMinutes / Math.max(expectedMinutes, capacityMinutes);
    return clamp(1 - proportion * 0.45, 0.55, 1);
  }

  function evidenceWeaknessScore(events: EvidenceEvent[], neutral = 0.55): number {
    const recent = [...events]
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
      .slice(0, 5);
    if (recent.length === 0) return neutral;
    const ratingWeakness = {
      [Rating.Again]: 1,
      [Rating.Hard]: 0.68,
      [Rating.Good]: 0.26,
      [Rating.Easy]: 0,
    } satisfies Record<Rating, number>;
    let weightedRating = 0;
    let weightedEvidence = 0;
    let weightedErrors = 0;
    let totalWeight = 0;
    recent.forEach((event, index) => {
      const weight = Math.pow(0.78, index);
      const evidenceMean = (event.evidence.completeness + event.evidence.independence + event.evidence.application) / 12;
      weightedRating += ratingWeakness[event.confirmedRating] * weight;
      weightedEvidence += (1 - evidenceMean) * weight;
      weightedErrors += Math.min(event.evidence.errorTypes.length / 3, 1) * weight;
      totalWeight += weight;
    });
    return clamp(
      (weightedRating / totalWeight) * 0.52 +
      (weightedEvidence / totalWeight) * 0.30 +
      (weightedErrors / totalWeight) * 0.18,
      0, 1,
    );
  }

  function obligationWeaknessScore(item: JoinedObligation, evidenceEvents: EvidenceEvent[]): number {
    const obligationEvidence = evidenceEvents.filter((event) => event.obligationId === item.obligation.id);
    const unitEvidence = evidenceEvents.filter((event) => event.unitId === item.unit.id);
    const unitContext = evidenceWeaknessScore(unitEvidence);
    if (obligationEvidence.length === 0) return unitContext;
    const obligationSignal = evidenceWeaknessScore(obligationEvidence);
    const obligationFailureBurden = clamp(item.obligation.policyState.failureCount / 3, 0, 1);
    const unitLapseContext = clamp(item.unit.lapseCount / 4, 0, 1);
    return clamp(
      obligationSignal * 0.68 +
      unitContext * 0.18 +
      obligationFailureBurden * 0.09 +
      unitLapseContext * 0.05,
      0, 1,
    );
  }

  function durationSample(plannedMinutes: number, elapsedMs: number): { actualMinutes: number; accepted: boolean; reason: DurationObservation["reason"] } {
    const actualMinutes = roundTo(Math.max(0, elapsedMs) / 60_000, 1);
    if (!Number.isFinite(actualMinutes) || actualMinutes <= 0) return { actualMinutes: 0, accepted: false, reason: "invalid" };
    if (actualMinutes < Math.max(1.5, plannedMinutes * 0.3)) return { actualMinutes, accepted: false, reason: "too-short" };
    if (actualMinutes > Math.min(240, plannedMinutes * 2.5 + 10)) return { actualMinutes, accepted: false, reason: "too-long" };
    return { actualMinutes, accepted: true, reason: "accepted" };
  }

  function weightedMedian(samples: Array<{ value: number; weight: number }>): number | undefined {
    if (samples.length === 0) return undefined;
    const ordered = [...samples].sort((a, b) => a.value - b.value);
    const total = ordered.reduce((sum, sample) => sum + sample.weight, 0);
    let cumulative = 0;
    for (const sample of ordered) {
      cumulative += sample.weight;
      if (cumulative >= total / 2) return sample.value;
    }
    return ordered.at(-1)?.value;
  }

  function durationObservationFor(
    obligation: RevisionObligation,
    allEvidence: EvidenceEvent[],
    elapsedMs: number,
    durationReliable = true,
  ): DurationObservation {
    // expectedMinutes is the estimated effort for the complete retrieval cycle. When an
    // oversized cycle is split, its child work plus final synthesis must still add up to
    // this total rather than increasing it merely because the work was divided.
    const estimateBefore = obligation.chunking?.status === "synthesis-ready" ? obligation.chunking.originalMinutes : obligation.expectedMinutes;
    const sample = durationSample(estimateBefore, elapsedMs);
    const acceptedEvents = allEvidence.filter((event) => event.durationObservation?.accepted);
    const exactEvents = acceptedEvents.filter((event) => event.obligationId === obligation.id);
    const unitWorkflowEvents = acceptedEvents.filter((event) => event.unitId === obligation.unitId && event.workflow === obligation.workflow.kind && event.obligationId !== obligation.id);
    const globalWorkflowEvents = acceptedEvents.filter((event) => event.workflow === obligation.workflow.kind && event.unitId !== obligation.unitId);
    if (!durationReliable) {
      return {
        plannedMinutes: estimateBefore,
        actualMinutes: sample.actualMinutes,
        accepted: false,
        reason: "unreliable-interruption",
        estimateBefore,
        estimateAfter: estimateBefore,
        exactSamples: exactEvents.length,
        unitWorkflowSamples: unitWorkflowEvents.length,
        globalWorkflowSamples: globalWorkflowEvents.length,
      };
    }
    if (!sample.accepted) {
      return {
        plannedMinutes: estimateBefore,
        actualMinutes: sample.actualMinutes,
        accepted: false,
        reason: sample.reason,
        estimateBefore,
        estimateAfter: estimateBefore,
        exactSamples: exactEvents.length,
        unitWorkflowSamples: unitWorkflowEvents.length,
        globalWorkflowSamples: globalWorkflowEvents.length,
      };
    }
    const weighted: Array<{ value: number; weight: number }> = [];
    const addRecent = (events: EvidenceEvent[], baseWeight: number, limit: number) => {
      [...events].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)).slice(0, limit).forEach((event, index) => {
        weighted.push({ value: event.durationObservation.actualMinutes, weight: baseWeight * Math.pow(0.82, index) });
      });
    };
    addRecent(exactEvents, 1, 8);
    addRecent(unitWorkflowEvents, 0.55, 6);
    addRecent(globalWorkflowEvents, 0.25, 8);
    weighted.push({ value: sample.actualMinutes, weight: 1.15 });
    const learned = weightedMedian(weighted) ?? estimateBefore;
    const evidenceStrength = clamp((exactEvents.length + 1 + unitWorkflowEvents.length * 0.45 + globalWorkflowEvents.length * 0.18) / 5, 0, 1);
    const blend = 0.8 * evidenceStrength;
    const desired = estimateBefore * (1 - blend) + learned * blend;
    // Limit a single update, not the lifetime estimate. Repeated consistent sessions may
    // therefore move well beyond an inaccurate first estimate without one outlier doing so.
    const estimateAfter = roundTo(clamp(desired, Math.max(5, estimateBefore * 0.67), Math.min(240, estimateBefore * 1.5)), 0);
    return {
      plannedMinutes: estimateBefore,
      actualMinutes: sample.actualMinutes,
      accepted: true,
      reason: sample.reason,
      estimateBefore,
      estimateAfter,
      exactSamples: exactEvents.length + 1,
      unitWorkflowSamples: unitWorkflowEvents.length,
      globalWorkflowSamples: globalWorkflowEvents.length,
    };
  }

  function subjectBalanceKey(profileId: string, subject: string): string {
    return `${profileId}::${normalizeName(subject)}`;
  }

  function weeklySubjectBalanceScores(joined: JoinedObligation[], plans: DailyPlanRecord[], reference: Date, boundaryHour = 4): Map<string, number> {
    const minutes = new Map<string, number>();
    const currentKey = studyDayKey(reference, boundaryHour);
    const cutoffDate = new Date(reference);
    cutoffDate.setDate(cutoffDate.getDate() - 6);
    const cutoffKey = studyDayKey(cutoffDate, boundaryHour);
    for (const plan of plans) {
      if (plan.studyDayKey < cutoffKey || plan.studyDayKey > currentKey) continue;
      const itemMap = new Map<string, DailyPlanItemSnapshot>();
      for (const version of plan.versions) for (const item of version.items) itemMap.set(item.key, item);
      for (const outcome of plan.outcomes) {
        if (outcome.status !== "completed" || !outcome.actualMinutes) continue;
        const item = itemMap.get(outcome.itemKey);
        if (!item) continue;
        const key = subjectBalanceKey(item.profileId, item.subject);
        minutes.set(key, (minutes.get(key) ?? 0) + outcome.actualMinutes);
      }
    }
    const unitWeights = new Map<string, number>();
    const seen = new Set<string>();
    for (const item of joined) {
      const balanceKey = subjectBalanceKey(item.profile.id, item.subject);
      const unitKey = `${balanceKey}|${item.unit.id}`;
      if (seen.has(unitKey)) continue;
      seen.add(unitKey);
      unitWeights.set(balanceKey, (unitWeights.get(balanceKey) ?? 0) + item.unit.importance);
    }
    const totalMinutes = [...minutes.values()].reduce((sum, value) => sum + value, 0);
    const totalWeight = [...unitWeights.values()].reduce((sum, value) => sum + value, 0) || 1;
    const result = new Map<string, number>();
    for (const [key, weight] of unitWeights) {
      if (totalMinutes < 30) { result.set(key, 0.5); continue; }
      const targetShare = weight / totalWeight;
      const actualShare = (minutes.get(key) ?? 0) / totalMinutes;
      result.set(key, clamp(0.5 + (targetShare - actualShare) * 2.2, 0, 1));
    }
    return result;
  }

  function plannedQueueStableKey(item: PlannedQueueItem): string {
    return planItemKey(item.joined.obligation.id, item.chunk?.id);
  }

  function interleaveSelected(items: PlannedQueueItem[]): PlannedQueueItem[] {
    const remaining = [...items].sort((a, b) => b.score - a.score || plannedQueueStableKey(a).localeCompare(plannedQueueStableKey(b)));
    const ordered: PlannedQueueItem[] = [];
    while (remaining.length) {
      const top = remaining[0]!;
      if (top.joined.obligation.type === "relearn" || (top.dueState === "overdue" && top.factors.dueRisk >= 0.9)) {
        ordered.push(top); remaining.shift(); continue;
      }
      const last = ordered.at(-1);
      const eligible = remaining.filter((item) => top.score - item.score <= 8);
      const best = eligible.sort((a, b) => {
        const sameSubject = (left: PlannedQueueItem, right: PlannedQueueItem): boolean => left.joined.profile.id === right.joined.profile.id && normalizeName(left.joined.subject) === normalizeName(right.joined.subject);
        const aPenalty = (last && sameSubject(last, a) ? 2 : 0) + (last?.joined.obligation.workflow?.kind === a.joined.obligation.workflow?.kind ? 1 : 0);
        const bPenalty = (last && sameSubject(last, b) ? 2 : 0) + (last?.joined.obligation.workflow?.kind === b.joined.obligation.workflow?.kind ? 1 : 0);
        return aPenalty - bPenalty || b.score - a.score || plannedQueueStableKey(a).localeCompare(plannedQueueStableKey(b));
      })[0] ?? top;
      ordered.push(best);
      remaining.splice(remaining.indexOf(best), 1);
    }
    return ordered;
  }

  function planItemKey(obligationId: string, chunkId?: string): string {
    return chunkId ? `${obligationId}::${chunkId}` : obligationId;
  }

  function splitRange(start: number, end: number, count: number): Array<[number, number]> {
    const size = end - start + 1;
    const result: Array<[number, number]> = [];
    let cursor = start;
    for (let index = 0; index < count; index += 1) {
      const remaining = size - (cursor - start);
      const slots = count - index;
      const chunkSize = Math.ceil(remaining / slots);
      result.push([cursor, cursor + chunkSize - 1]);
      cursor += chunkSize;
    }
    return result;
  }

  function createAutomaticChunks(item: JoinedObligation, capacityMinutes: number, now = new Date()): { state: ChunkingState; chunks: ObligationChunk[] } {
    const originalMinutes = Math.max(1, Math.round(item.obligation.expectedMinutes));
    const maxChunk = Math.max(5, Math.min(capacityMinutes, Math.max(10, Math.floor(capacityMinutes * 0.75))));
    const synthesisMinutes = Math.max(1, Math.min(capacityMinutes, Math.max(5, Math.round(originalMinutes * 0.25)), Math.max(1, originalMinutes - 2)));
    const chunkWorkMinutes = Math.max(2, originalMinutes - synthesisMinutes);
    const total = clamp(Math.ceil(chunkWorkMinutes / maxChunk), 2, Math.min(60, chunkWorkMinutes));
    const cycleId = uid("cycle");
    const sourceText = `${item.unit.scope} ${item.unit.source} ${item.obligation.protocol}`;
    const pageMatch = sourceText.match(/(?:pages?|pp?\.?|pgs?\.?)\s*(\d+)\s*[–—-]\s*(\d+)/i);
    const questionMatch = sourceText.match(/(\d+)\s*(?:questions?|qs?\b)/i);
    const minuteBase = Math.floor(chunkWorkMinutes / total);
    let minuteRemainder = chunkWorkMinutes % total;
    const time = now.toISOString();
    const pageSpan = pageMatch ? Number(pageMatch[2]) - Number(pageMatch[1]) + 1 : 0;
    const questionSpan = questionMatch ? Number(questionMatch[1]) : 0;
    const ranges = pageMatch && pageSpan >= total ? splitRange(Number(pageMatch[1]), Number(pageMatch[2]), total) : undefined;
    const questionRanges = !ranges && questionMatch && questionSpan >= total ? splitRange(1, questionSpan, total) : undefined;
    const chunks: ObligationChunk[] = Array.from({ length: total }, (_, index) => {
      const minutes = minuteBase + (minuteRemainder-- > 0 ? 1 : 0);
      const scope = ranges ? `Pages ${ranges[index]![0]}–${ranges[index]![1]}` : questionRanges ? `Questions ${questionRanges[index]![0]}–${questionRanges[index]![1]}` : `Part ${index + 1} of ${total}`;
      return {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: uid("chunk"), obligationId: item.obligation.id, cycleId, ordinal: index + 1, total,
        label: `${item.unit.title} · ${scope}`, scope, expectedMinutes: Math.max(1, minutes), status: "pending",
        createdAt: time, updatedAt: time,
      };
    });
    return {
      state: {
        cycleId, status: "chunking", originalMinutes,
        synthesisMinutes, capacityMinutes,
        totalChunks: total, completedChunks: 0, createdAt: time,
      },
      chunks,
    };
  }

  function fsrsRetrievability(
    obligation: RevisionObligation,
    reference: Date,
    schedulingPolicy: FsrsSchedulingPolicy,
    reviews: readonly MemoryReviewObservation[] = [],
    profile: FsrsOptimizerProfile | null = null,
  ): number | undefined {
    if (obligation.type !== "memory-recall" || !obligation.policyState.fsrsCard) return undefined;
    const projection = obligation.policyState.fsrsCard;
    if (projection.reps === 0 || !projection.lastReviewAt) return undefined;
    return revisionSchedulerPort(schedulingPolicy, profile).retrievability(projection, reviews, reference);
  }

  function finalMemoryExamDeadline(item: JoinedObligation): Date | undefined {
    if (item.obligation.type !== "memory-recall") return undefined;
    const exam = examDateTime(item.profile);
    if (!exam) return undefined;
    const card = item.obligation.policyState.fsrsCard;
    assert(card, "Memory obligation has no FSRS-7 state.");
    const finalWindowStart = new Date(exam.getTime() - FINAL_MEMORY_REVIEW_WINDOW_DAYS * DAY_MS);
    if (card.lastReviewAt && new Date(card.lastReviewAt).getTime() >= finalWindowStart.getTime()) return undefined;
    return exam;
  }

  function temporalDueRisk(dueAt: Date, dayStart: Date, dayEnd: Date, lookaheadDays: number): number {
    if (dueAt.getTime() < dayStart.getTime()) {
      const overdueDays = (dayStart.getTime() - dueAt.getTime()) / DAY_MS;
      return clamp(0.78 + 0.22 * (1 - Math.exp(-overdueDays / 7)), 0, 1);
    }
    if (dueAt.getTime() < dayEnd.getTime()) return 0.64;
    const daysAhead = (dueAt.getTime() - dayEnd.getTime()) / DAY_MS;
    if (daysAhead > lookaheadDays) return 0;
    return clamp(0.5 * (1 - daysAhead / Math.max(lookaheadDays, 0.25)), 0.08, 0.5);
  }

  function plannerScore(factors: PlanningFactors, obligation: RevisionObligation): number {
    const weighted =
      factors.dueRisk * PLANNER_WEIGHTS.dueRisk +
      factors.examImportance * PLANNER_WEIGHTS.examImportance +
      factors.weakness * PLANNER_WEIGHTS.weakness +
      factors.reviewDuration * PLANNER_WEIGHTS.reviewDuration +
      factors.examinationProximity * PLANNER_WEIGHTS.examinationProximity +
      factors.weeklyBalance * PLANNER_WEIGHTS.weeklyBalance;
    const explicitPriority = clamp(obligation.priority * 0.025, 0, 0.1);
    const relearnBoost = obligation.type === "relearn" ? 0.08 : 0;
    return roundTo(clamp((weighted + explicitPriority + relearnBoost) * 100, 0, 100), 1);
  }

  function planningReasons(item: JoinedObligation, factors: PlanningFactors, dueState: PlannedQueueItem["dueState"], daysFromDue: number, daysToExam: number): string[] {
    const reasons: string[] = [];
    if (dueState === "overdue") reasons.push(`${Math.max(1, Math.ceil(daysFromDue))}d overdue`);
    else if (dueState === "due") reasons.push("due in this study day");
    else reasons.push("brought forward to use available capacity");
    if (item.obligation.type === "relearn") reasons.push("active relearning repair");
    if (factors.examImportance >= 0.95) reasons.push("core exam knowledge");
    else if (factors.examImportance >= 0.6) reasons.push("important exam knowledge");
    if (factors.weakness >= 0.7) reasons.push("strong weakness signal");
    else if (factors.weakness >= 0.48) reasons.push("limited or fragile evidence");
    if (daysToExam <= 30) reasons.push(`exam in ${Math.max(0, daysToExam)}d`);
    reasons.push(`${item.obligation.expectedMinutes}m estimated`);
    return reasons.slice(0, 5);
  }

  function buildPlanningCandidate(
    item: JoinedObligation,
    evidenceEvents: EvidenceEvent[],
    settings: AppSettings,
    reference: Date,
    weeklyBalance = 0.5,
    chunk?: ObligationChunk,
    memoryReviews?: MemoryReviewObservationIndex,
  ): PlannedQueueItem | undefined {
    if (item.profile.status !== "active") return undefined;
    const dayStart = studyDayStart(reference, settings.studyDayBoundaryHour);
    const dayEnd = studyDayEnd(reference, settings.studyDayBoundaryHour);
    const daysToExam = daysToExamination(item.profile, reference);
    if (examDateTime(item.profile) && daysToExam < 0) return undefined;
    const lookaheadDays = planningLookaheadDays(daysToExam);
    const policyDueAt = new Date(item.obligation.dueAt);
    const memoryExamDeadline = finalMemoryExamDeadline(item);
    const examBoundMemory = Boolean(memoryExamDeadline && policyDueAt.getTime() > memoryExamDeadline.getTime());
    const planningDueAt = examBoundMemory ? memoryExamDeadline! : policyDueAt;
    const synthesisReady = item.obligation.chunking?.status === "synthesis-ready";
    if (!synthesisReady && planningDueAt.getTime() > dayEnd.getTime() + lookaheadDays * DAY_MS) return undefined;
    const temporalRisk = temporalDueRisk(planningDueAt, dayStart, dayEnd, lookaheadDays);
    const memoryHistory = item.obligation.type === "memory-recall"
      ? memoryReviews?.get(item.obligation.id) ?? memoryReviewObservationsFor(item.obligation.id, evidenceEvents)
      : [];
    const retrievability = fsrsRetrievability(
      item.obligation,
      reference,
      settings.fsrsScheduling.policy,
      memoryHistory,
      activeFsrsOptimizerProfile(settings),
    );
    const schedulingPolicy = settings.fsrsScheduling.policy;
    const memoryRisk = retrievability === undefined || schedulingPolicy.kind === "cost-adr"
      ? 0
      : clamp((schedulingPolicy.desiredRetention - retrievability) / Math.max(schedulingPolicy.desiredRetention - 0.5, 0.1), 0, 1);
    // Cost-ADR has a state-dependent retention target. Its dueAt already encodes
    // that adaptive target, so the planner must not invent a second approximation.
    const dueRisk = retrievability === undefined ? temporalRisk : Math.max(temporalRisk, memoryRisk);
    const difficulty = item.obligation.type === "memory-recall"
      ? memoryDifficultyAssessment(item.obligation, settings.memoryDifficultyPolicy, memoryHistory)
      : undefined;
    const factors: PlanningFactors = {
      dueRisk,
      examImportance: examImportanceScore(item.unit.importance),
      weakness: Math.max(obligationWeaknessScore(item, evidenceEvents), memoryDifficultyWeaknessFloor(difficulty?.level ?? "normal")),
      reviewDuration: reviewDurationScore(chunk?.expectedMinutes ?? (item.obligation.chunking?.status === "synthesis-ready" ? item.obligation.chunking.synthesisMinutes : item.obligation.expectedMinutes), settings.dailyCapacityMinutes),
      examinationProximity: examinationProximityScore(daysToExam),
      weeklyBalance,
    };
    const dueState: PlannedQueueItem["dueState"] = planningDueAt.getTime() < dayStart.getTime() ? "overdue" : planningDueAt.getTime() < dayEnd.getTime() ? "due" : "brought-forward";
    const daysFromDue = (reference.getTime() - planningDueAt.getTime()) / DAY_MS;
    return {
      joined: item,
      factors,
      score: plannerScore(factors, item.obligation),
      dueState,
      daysToExam,
      examDateKnown: Boolean(examDateTime(item.profile)),
      daysFromDue,
      ...(retrievability === undefined ? {} : { retrievability }),
      reasons: [
        ...(chunk ? [`split scope: ${chunk.scope}`] : item.obligation.chunking?.status === "synthesis-ready" ? ["final synthesis after split work"] : []),
        ...(examBoundMemory ? ["final memory review before exam"] : []),
        ...(difficulty?.level === "persistent-difficulty"
          ? [`persistent difficulty · ${difficulty.establishedLapses} established recall failures`]
          : difficulty?.level === "remediation"
            ? [`remediation · ${difficulty.establishedLapses} established recall failures`]
            : difficulty?.level === "learning-difficulty"
              ? [`early learning difficulty · ${difficulty.earlyLearningFailures} failed learning recalls`]
              : []),
        ...planningReasons(item, factors, dueState, daysFromDue, daysToExam),
        ...(weeklyBalance >= 0.7 ? ["subject underrepresented this week"] : []),
      ].slice(0, 6),
      executionMinutes: chunk?.expectedMinutes ?? (item.obligation.chunking?.status === "synthesis-ready" ? item.obligation.chunking.synthesisMinutes : item.obligation.expectedMinutes),
      ...(chunk ? { chunk } : {}),
    };
  }

  function choosePlanItems(candidates: PlannedQueueItem[], capacityMinutes: number): { selected: PlannedQueueItem[]; requiredOverrun: PlannedQueueItem[]; mustSplit: PlannedQueueItem[]; deferred: PlannedQueueItem[] } {
    const ordered = [...candidates].sort((a, b) =>
      b.score - a.score
      || a.joined.obligation.dueAt.localeCompare(b.joined.obligation.dueAt)
      || a.joined.obligation.expectedMinutes - b.joined.obligation.expectedMinutes
      || plannedQueueStableKey(a).localeCompare(plannedQueueStableKey(b)));
    if (ordered.length === 0) return { selected: [], requiredOverrun: [], mustSplit: [], deferred: [] };
    const durationOf = (item: PlannedQueueItem): number => Math.max(1, Math.ceil(item.executionMinutes ?? item.joined.obligation.expectedMinutes));
    const solve = (items: PlannedQueueItem[], capacity: number): PlannedQueueItem[] => {
      if (items.length === 0 || capacity <= 0) return [];
      const dp = new Int32Array(capacity + 1);
      dp.fill(-1);
      dp[0] = 0;
      const choices: Uint8Array[] = [];
      for (const item of items) {
        const duration = durationOf(item);
        if (duration > capacity) { choices.push(new Uint8Array(capacity + 1)); continue; }
        const value = Math.max(1, Math.round(item.score * 100));
        const before = new Int32Array(dp);
        const take = new Uint8Array(capacity + 1);
        for (let used = duration; used <= capacity; used += 1) {
          if (before[used - duration]! < 0) continue;
          const candidateValue = before[used - duration]! + value;
          if (candidateValue > dp[used]!) { dp[used] = candidateValue; take[used] = 1; }
        }
        choices.push(take);
      }
      let bestUsed = 0;
      for (let used = 1; used <= capacity; used += 1) if (dp[used]! > dp[bestUsed]!) bestUsed = used;
      const picked: PlannedQueueItem[] = [];
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (!choices[index]![bestUsed]) continue;
        const item = items[index]!;
        picked.push(item);
        bestUsed -= durationOf(item);
      }
      return picked.reverse();
    };

    const critical = ordered.filter((item) => item.joined.obligation.type === "relearn" || (item.dueState === "overdue" && item.factors.dueRisk >= 0.85));
    const oversizedCritical = critical.filter((item) => durationOf(item) > capacityMinutes);
    const highestCritical = critical[0];
    if (highestCritical && durationOf(highestCritical) > capacityMinutes) {
      const selected = [highestCritical];
      const requiredOverrun = [highestCritical];
      const mustSplit = oversizedCritical.filter((item) => item.joined.obligation.id !== highestCritical.joined.obligation.id);
      const excludedIds = new Set([...selected, ...mustSplit].map((item) => item.joined.obligation.id));
      return { selected, requiredOverrun, mustSplit, deferred: ordered.filter((item) => !excludedIds.has(item.joined.obligation.id)) };
    }

    const fitCritical = critical.filter((item) => durationOf(item) <= capacityMinutes);
    const mustSplit = oversizedCritical;
    const normal = ordered.filter((item) => !critical.includes(item));
    let selected = solve(fitCritical, capacityMinutes);
    let used = selected.reduce((sum, item) => sum + item.executionMinutes, 0);
    if (used < capacityMinutes) selected = selected.concat(solve(normal, capacityMinutes - used));
    const requiredOverrun: PlannedQueueItem[] = [];
    if (selected.length === 0 && ordered.length > 0) {
      const firstFit = ordered.find((item) => durationOf(item) <= capacityMinutes && !mustSplit.includes(item));
      if (firstFit) selected = [firstFit];
      else {
        selected = [ordered[0]!];
        requiredOverrun.push(ordered[0]!);
      }
    }
    const excludedIds = new Set([...selected, ...mustSplit].map((item) => item.joined.obligation.id));
    selected = interleaveSelected(selected);
    return { selected, requiredOverrun, mustSplit, deferred: ordered.filter((item) => !excludedIds.has(item.joined.obligation.id)) };
  }

