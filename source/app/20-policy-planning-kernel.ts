  interface SchedulerPolicy {
    readonly id: string;
    readonly type: ObligationType;
    createInitialState(firstDueAt: ISODateTime): PolicyState;
    preview(obligation: RevisionObligation, now: Date): SchedulePreview[];
    complete(obligation: RevisionObligation, rating: Rating, evidence: ObjectiveEvidence, now: Date): PolicyCompletion;
  }

  function serializeFsrsCard(card: FsrsCardRuntime): StoredFsrsCard {
    const stored: StoredFsrsCard = {
      dueAt: card.due.toISOString(),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      learningSteps: card.learning_steps,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
    };
    if (card.last_review) stored.lastReviewAt = card.last_review.toISOString();
    return stored;
  }

  function hydrateFsrsCard(card: StoredFsrsCard): FsrsCardRuntime {
    const hydrated: FsrsCardRuntime = {
      due: new Date(card.dueAt),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsedDays,
      scheduled_days: card.scheduledDays,
      learning_steps: card.learningSteps,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
    };
    if (card.lastReviewAt) hydrated.last_review = new Date(card.lastReviewAt);
    return hydrated;
  }

  const PLANNER_WEIGHTS = Object.freeze({
    dueRisk: 0.30,
    examImportance: 0.20,
    weakness: 0.18,
    reviewDuration: 0.07,
    examinationProximity: 0.15,
    weeklyBalance: 0.10,
  });

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
    const ratingWeakness: Record<Rating, number> = {
      [Rating.Again]: 1,
      [Rating.Hard]: 0.68,
      [Rating.Good]: 0.26,
      [Rating.Easy]: 0,
    };
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

  function interleaveSelected(items: PlannedQueueItem[]): PlannedQueueItem[] {
    const remaining = [...items].sort((a, b) => b.score - a.score);
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
        return aPenalty - bPenalty || b.score - a.score;
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

  function fsrsRetrievability(obligation: RevisionObligation, reference: Date, desiredRetention: number): number | undefined {
    if (obligation.type !== "memory-recall" || !obligation.policyState.fsrsCard) return undefined;
    if (obligation.policyState.fsrsCard.reps === 0 || !obligation.policyState.fsrsCard.lastReviewAt) return undefined;
    const api = runtimeFsrs();
    const raw = {
      request_retention: desiredRetention,
      enable_fuzz: false,
      enable_short_term: false,
      learning_steps: [],
      relearning_steps: [],
    };
    const parameters = typeof api.generatorParameters === "function" ? api.generatorParameters(raw) : raw;
    const retrievability = api.fsrs(parameters).get_retrievability(hydrateFsrsCard(obligation.policyState.fsrsCard), reference, false);
    return clamp(Number(retrievability), 0, 1);
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

  function buildPlanningCandidate(item: JoinedObligation, evidenceEvents: EvidenceEvent[], settings: AppSettings, reference: Date, weeklyBalance = 0.5, chunk?: ObligationChunk): PlannedQueueItem | undefined {
    if (item.profile.status !== "active") return undefined;
    const dayStart = studyDayStart(reference, settings.studyDayBoundaryHour);
    const dayEnd = studyDayEnd(reference, settings.studyDayBoundaryHour);
    const daysToExam = daysToExamination(item.profile, reference);
    if (examDateTime(item.profile) && daysToExam < 0) return undefined;
    const lookaheadDays = planningLookaheadDays(daysToExam);
    const dueAt = new Date(item.obligation.dueAt);
    if (dueAt.getTime() > dayEnd.getTime() + lookaheadDays * DAY_MS) return undefined;
    const temporalRisk = temporalDueRisk(dueAt, dayStart, dayEnd, lookaheadDays);
    const retrievability = fsrsRetrievability(item.obligation, reference, settings.desiredRetention);
    const memoryRisk = retrievability === undefined ? 0 : clamp((settings.desiredRetention - retrievability) / Math.max(settings.desiredRetention - 0.5, 0.1), 0, 1);
    const dueRisk = retrievability === undefined ? temporalRisk : Math.max(temporalRisk, memoryRisk);
    const factors: PlanningFactors = {
      dueRisk,
      examImportance: examImportanceScore(item.unit.importance),
      weakness: obligationWeaknessScore(item, evidenceEvents),
      reviewDuration: reviewDurationScore(chunk?.expectedMinutes ?? (item.obligation.chunking?.status === "synthesis-ready" ? item.obligation.chunking.synthesisMinutes : item.obligation.expectedMinutes), settings.dailyCapacityMinutes),
      examinationProximity: examinationProximityScore(daysToExam),
      weeklyBalance,
    };
    const dueState: PlannedQueueItem["dueState"] = dueAt.getTime() < dayStart.getTime() ? "overdue" : dueAt.getTime() < dayEnd.getTime() ? "due" : "brought-forward";
    const daysFromDue = (reference.getTime() - dueAt.getTime()) / DAY_MS;
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
        ...planningReasons(item, factors, dueState, daysFromDue, daysToExam),
        ...(weeklyBalance >= 0.7 ? ["subject underrepresented this week"] : []),
      ].slice(0, 6),
      executionMinutes: chunk?.expectedMinutes ?? (item.obligation.chunking?.status === "synthesis-ready" ? item.obligation.chunking.synthesisMinutes : item.obligation.expectedMinutes),
      ...(chunk ? { chunk } : {}),
    };
  }

  function choosePlanItems(candidates: PlannedQueueItem[], capacityMinutes: number): { selected: PlannedQueueItem[]; requiredOverrun: PlannedQueueItem[]; mustSplit: PlannedQueueItem[]; deferred: PlannedQueueItem[] } {
    const ordered = [...candidates].sort((a, b) => b.score - a.score || a.joined.obligation.dueAt.localeCompare(b.joined.obligation.dueAt) || a.joined.obligation.expectedMinutes - b.joined.obligation.expectedMinutes);
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

