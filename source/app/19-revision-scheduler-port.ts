  /* ==========================================================================
     REVISION SCHEDULER PORT — TS-FSRS 6.0.0 / FSRS-7
     ========================================================================== */

  interface RevisionSchedulerReviewResult {
    card: MemoryMaterializedProjection;
    reviewLog: Record<string, unknown>;
  }

  interface RevisionSchedulerPort {
    readonly configuration: FsrsConfigSnapshot;
    newCard(firstDueAt: ISODateTime, cardId: string): MemoryMaterializedProjection;
    verifyProjection(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
      forceReplay?: boolean,
    ): void;
    preview(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
      now: Date,
    ): SchedulePreview[];
    review(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
      rating: Rating,
      now: Date,
    ): RevisionSchedulerReviewResult;
    retrievability(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
      at: Date,
    ): number | undefined;
    replayVerifiedHistory(
      reviews: readonly MemoryReviewObservation[],
    ): MemoryMaterializedProjection;
    reschedule(
      initialCard: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
    ): MemoryMaterializedProjection;
  }

  interface FsrsRescheduleResultRuntime {
    results: FsrsRecordRuntime[];
    card: FsrsCardRuntime;
  }

  /*
   * Application-local mirror of the public ts-fsrs@6.0.0
   * `ts-fsrs/reschedule` contract. It is intentionally implemented only in
   * terms of the vendored scheduler's public scheduler.forward surface, keeping the upstream UMD bytes checksum-identical and avoiding a
   * second copy of the FSRS runtime.
   *
   * Upstream source basis:
   * open-spaced-repetition/ts-fsrs v6.0.0
   * packages/fsrs/src/reschedule/reschedule.ts
   */
  class Reschedule {
    constructor(private readonly scheduler: FsrsSchedulerRuntime) {}

    private prepareReviews(
      history: readonly FsrsHistoryReviewRuntime[],
      sortHistory: boolean,
    ): FsrsHistoryReviewRuntime[] {
      assert(history.length > 0, "Reschedule requires at least one review.");
      const reviews = history.map((review) => {
        validateRating(review.rating);
        assert(review.reviewTime instanceof Date && Number.isFinite(review.reviewTime.getTime()), "FSRS review time is invalid.");
        return { rating: review.rating, reviewTime: new Date(review.reviewTime) };
      });
      if (sortHistory) {
        const compare = this.scheduler.chrono.compare;
        reviews.sort((left, right) => compare
          ? compare(left.reviewTime, right.reviewTime)
          : left.reviewTime.getTime() - right.reviewTime.getTime());
      }
      for (let index = 1; index < reviews.length; index += 1) {
        const previous = reviews[index - 1]!;
        const current = reviews[index]!;
        const deltaT = this.scheduler.chrono.difference(previous.reviewTime, current.reviewTime);
        assert(Number.isFinite(deltaT) && deltaT >= 0, "FSRS review history must be chronological.");
      }
      return reviews;
    }

    reschedule(
      input: {
        history: readonly FsrsHistoryReviewRuntime[];
        initialCard?: FsrsCardRuntime;
      },
      options: { sortHistory?: boolean } = {},
    ): FsrsRescheduleResultRuntime {
      const history = this.prepareReviews(input.history, options.sortHistory ?? true);
      const results = input.initialCard
        ? this.scheduler.forward({ history, initialCard: input.initialCard })
        : this.scheduler.forward({ history });
      const card = results.at(-1)?.card;
      assert(card, "FSRS reschedule did not produce a card.");
      return { results, card };
    }
  }

  type FsrsConfigIdentity = Omit<FsrsConfigSnapshot, "fingerprint">;

  function fsrsConfigurationFingerprint(config: FsrsConfigIdentity): string {
    const canonical = [
      config.model,
      FSRS_PACKAGE_VERSION,
      fsrsSchedulingPolicyIdentity(config.schedulingPolicy),
      config.fractionalDays ? "fractional" : "whole",
      config.enableFuzz ? "fuzz" : "no-fuzz",
      config.enableShortTerm ? "short-term" : "long-term",
      config.learningSteps.join(","),
      config.relearningSteps.join(","),
      String(config.graduatingInterval),
      config.allowModelOverride ? "model-override" : "no-model-override",
      String(config.maximumInterval),
      config.clearStatsOnForget ? "clear-stats" : "keep-stats",
      config.weightsSource,
      config.weightsFingerprint,
      config.optimizerProfileSourceSha256 ?? "",
    ].join("|");
    return fingerprintText64(canonical);
  }

  function fsrsConfigSnapshot(schedulingPolicy: FsrsSchedulingPolicy, profile: FsrsOptimizerProfile | null = null): FsrsConfigSnapshot {
    const validatedProfile = profile ? validateFsrsOptimizerProfile(profile) : null;
    const policy = canonicalFsrsSchedulingPolicy(schedulingPolicy);
    const identity: FsrsConfigIdentity = {
      model: FSRS_MODEL,
      schedulingPolicy: policy,
      fractionalDays: true,
      enableFuzz: false,
      enableShortTerm: true,
      learningSteps: ["1d"],
      relearningSteps: ["1d"],
      graduatingInterval: FSRS_GRADUATING_INTERVAL_DAYS,
      allowModelOverride: true,
      maximumInterval: FSRS_MAXIMUM_INTERVAL_DAYS,
      clearStatsOnForget: false,
      weightsSource: validatedProfile ? "optimizer-profile" : "ts-fsrs-package-default",
      weightsFingerprint: validatedProfile ? fsrsWeightsFingerprint(validatedProfile.weights) : FSRS7_DEFAULT_WEIGHTS_FINGERPRINT,
      ...(validatedProfile ? { optimizerProfileSourceSha256: validatedProfile.sourceSha256 } : {}),
    };
    return { ...identity, fingerprint: fsrsConfigurationFingerprint(identity) };
  }

  function validateFsrsConfigSnapshot(config: FsrsConfigSnapshot): FsrsConfigSnapshot {
    assertExactKeys(config, "FSRS configuration", ["model", "schedulingPolicy", "fractionalDays", "enableFuzz", "enableShortTerm", "learningSteps", "relearningSteps", "graduatingInterval", "allowModelOverride", "maximumInterval", "clearStatsOnForget", "weightsSource", "weightsFingerprint", "optimizerProfileSourceSha256", "fingerprint"]);
    assert(config.model === FSRS_MODEL, "FSRS configuration model is invalid.");
    const schedulingPolicy = canonicalFsrsSchedulingPolicy(config.schedulingPolicy);
    assert(JSON.stringify(config.schedulingPolicy) === JSON.stringify(schedulingPolicy), "FSRS scheduling policy is not canonical.");
    assert(config.fractionalDays === true, "FSRS-7 requires fractional-day memory semantics.");
    assert(config.enableFuzz === false && config.enableShortTerm === true, "FSRS scheduler flags are invalid.");
    assert(config.learningSteps.length === 1 && config.learningSteps[0] === "1d", "FSRS learning-step policy is invalid.");
    assert(config.relearningSteps.length === 1 && config.relearningSteps[0] === "1d", "FSRS relearning-step policy is invalid.");
    assert(config.graduatingInterval === FSRS_GRADUATING_INTERVAL_DAYS && config.allowModelOverride === true, "FSRS graduation policy is invalid.");
    assert(config.maximumInterval === FSRS_MAXIMUM_INTERVAL_DAYS && config.clearStatsOnForget === false, "FSRS interval/statistics policy is invalid.");
    assert(config.weightsSource === "ts-fsrs-package-default" || config.weightsSource === "optimizer-profile", "FSRS weight source is invalid.");
    assert(/^fnv1a64:[0-9a-f]{16}$/.test(config.weightsFingerprint), "FSRS weights fingerprint is invalid.");
    if (config.weightsSource === "ts-fsrs-package-default") {
      assert(config.weightsFingerprint === FSRS7_DEFAULT_WEIGHTS_FINGERPRINT && config.optimizerProfileSourceSha256 === undefined, "Stock FSRS weight provenance is invalid.");
    } else {
      assert(typeof config.optimizerProfileSourceSha256 === "string" && /^[a-f0-9]{64}$/.test(config.optimizerProfileSourceSha256), "Personalized FSRS profile provenance is invalid.");
    }
    const { fingerprint: _fingerprint, ...identity } = config;
    assert(config.fingerprint === fsrsConfigurationFingerprint(identity), "FSRS configuration fingerprint does not match its settings.");
    return config;
  }

  function requiredFsrs7StabilityFast(value: number): number {
    assert(Number.isFinite(value), "FSRS-7 memory state is missing fast stability.");
    return value;
  }

  function storedFsrsScheduleStatus(value: FsrsRuntimeScheduleStatus): StoredFsrsScheduleStatus {
    assert(value !== "suspended", "Revision Director does not persist FSRS-owned suspension state.");
    return value;
  }

  function validateStoredFsrsCard(card: StoredFsrsCard, expectedCardId?: string): void {
    assert(card.model === FSRS_MODEL, "Memory obligation does not use the current FSRS-7 model.");
    if (expectedCardId !== undefined) assert(card.cardId === expectedCardId, "FSRS card identity does not match its obligation.");
    assert(typeof card.cardId === "string" && card.cardId.length > 0, "FSRS card identity is invalid.");
    assert(Number.isFinite(new Date(card.dueAt).getTime()), "FSRS due date is invalid.");
    if (card.lastReviewAt !== undefined) assert(Number.isFinite(new Date(card.lastReviewAt).getTime()), "FSRS last-review date is invalid.");
    for (const value of [card.stability, requiredFsrs7StabilityFast(card.stabilityFast), card.difficulty, card.scheduledDays]) {
      assert(Number.isFinite(value) && value >= 0, "FSRS card contains an invalid numeric state.");
    }
    assert(Number.isInteger(card.learningStep) && card.learningStep >= 0, "FSRS learning step is invalid.");
    assert(Number.isInteger(card.reps) && card.reps >= 0 && Number.isInteger(card.lapses) && card.lapses >= 0, "FSRS review counters are invalid.");
    assert(Number.isInteger(card.state) && card.state >= 0 && card.state <= 3, "FSRS card state is invalid.");
    assert(card.scheduleStatus === "new" || card.scheduleStatus === "learning" || card.scheduleStatus === "review", "Revision Director does not persist FSRS-owned suspension state.");
  }

  function serializeFsrsCard(card: FsrsCardRuntime): StoredFsrsCard {
    const stored: StoredFsrsCard = {
      model: FSRS_MODEL,
      cardId: card.cardId,
      dueAt: card.dueAt.toISOString(),
      stability: card.stability,
      stabilityFast: requiredFsrs7StabilityFast(card.stabilityFast),
      difficulty: card.difficulty,
      scheduledDays: card.scheduledDays,
      learningStep: card.learningStep,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      scheduleStatus: storedFsrsScheduleStatus(card.scheduleStatus),
    };
    if (card.lastReviewAt) stored.lastReviewAt = card.lastReviewAt.toISOString();
    validateStoredFsrsCard(stored);
    return stored;
  }

  function hydrateFsrsCard(card: StoredFsrsCard, expectedCardId = card.cardId): FsrsCardRuntime {
    validateStoredFsrsCard(card, expectedCardId);
    return {
      cardId: card.cardId,
      dueAt: new Date(card.dueAt),
      lastReviewAt: card.lastReviewAt ? new Date(card.lastReviewAt) : null,
      stability: card.stability,
      stabilityFast: requiredFsrs7StabilityFast(card.stabilityFast),
      difficulty: card.difficulty,
      scheduledDays: card.scheduledDays,
      learningStep: card.learningStep,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      scheduleStatus: card.scheduleStatus,
    };
  }

  function runtimeFsrs(): FsrsUmdRuntime {
    assert(typeof FSRS === "object" && FSRS !== null, "Embedded ts-fsrs 6.0.0 failed to initialize. The deployment file may be damaged.");
    assert(typeof FSRS.DefaultScheduler === "function", "Invalid ts-fsrs v6 scheduler runtime.");
    return FSRS;
  }

  function fsrsRuntimeAvailable(): boolean {
    try { runtimeFsrs(); return true; } catch { return false; }
  }

  function storedFsrsCardsEqual(left: StoredFsrsCard, right: StoredFsrsCard): boolean {
    return left.model === right.model
      && left.cardId === right.cardId
      && left.dueAt === right.dueAt
      && left.lastReviewAt === right.lastReviewAt
      && left.stability === right.stability
      && left.stabilityFast === right.stabilityFast
      && left.difficulty === right.difficulty
      && left.scheduledDays === right.scheduledDays
      && left.learningStep === right.learningStep
      && left.reps === right.reps
      && left.lapses === right.lapses
      && left.state === right.state
      && left.scheduleStatus === right.scheduleStatus;
  }

  function validateMemoryObservationChain(
    cardId: string,
    reviews: readonly MemoryReviewObservation[],
    currentProjection?: StoredFsrsCard,
  ): void {
    let previous: StoredFsrsCard | undefined;
    for (let index = 0; index < reviews.length; index += 1) {
      const review = reviews[index]!;
      assert(review.evidenceEventId.length > 0, "Memory review lacks evidence identity.");
      validateRating(review.rating);
      assert(review.source === "direct-memory" || review.source === "relearning-verification", "Memory review source is invalid.");
      assert(Number.isFinite(new Date(review.reviewedAt).getTime()), "Memory review timestamp is invalid.");
      assert(/^fnv1a64:[0-9a-f]{16}$/.test(review.configFingerprint), "Memory review configuration fingerprint is invalid.");
      const schedulerConfig = validateFsrsConfigSnapshot(review.schedulerConfig);
      assert(review.configFingerprint === schedulerConfig.fingerprint, "Memory review configuration fingerprint does not match its scheduler snapshot.");
      validateStoredFsrsCard(review.beforeCard, cardId);
      validateStoredFsrsCard(review.afterCard, cardId);
      assert(review.afterCard.lastReviewAt === review.reviewedAt, "Memory review timestamp does not match its resulting FSRS card.");
      if (index === 0) {
        assert(review.beforeCard.reps === 0 && review.beforeCard.lastReviewAt === undefined, "FSRS replay history is incomplete from card creation.");
      } else {
        const previousReview = reviews[index - 1]!;
        assert(previous, "FSRS review history is incomplete.");
        if (previousReview.configFingerprint === review.configFingerprint) {
          assert(storedFsrsCardsEqual(previous, review.beforeCard), "FSRS review history does not form a continuous projection chain.");
        } else {
          assert(previous.reps === review.beforeCard.reps
            && previous.lapses === review.beforeCard.lapses
            && previous.lastReviewAt === review.beforeCard.lastReviewAt,
          "FSRS configuration rebase changed immutable review counters or last-review time.");
        }
      }
      previous = review.afterCard;
    }
    if (!currentProjection) return;
    validateStoredFsrsCard(currentProjection, cardId);
    if (reviews.length === 0) {
      assert(currentProjection.reps === 0 && currentProjection.lastReviewAt === undefined, "Reviewed FSRS projection has no canonical review history.");
    }
  }

  type MemoryReviewObservationIndex = ReadonlyMap<string, readonly MemoryReviewObservation[]>;

  function directMemoryReviewObservation(event: EvidenceEvent): MemoryReviewObservation {
    const beforeCard = event.beforePolicyState.fsrsCard;
    const afterCard = event.afterPolicyState.fsrsCard;
    const config = event.schedulerConfig;
    assert(beforeCard && afterCard && config, "Memory evidence is missing FSRS replay provenance.");
    return {
      evidenceEventId: event.id,
      reviewedAt: event.reviewedAt,
      rating: validateRating(event.confirmedRating),
      source: "direct-memory",
      beforeCard: clone(beforeCard),
      afterCard: clone(afterCard),
      schedulerConfig: clone(validateFsrsConfigSnapshot(config)),
      configFingerprint: validateFsrsConfigSnapshot(config).fingerprint,
    };
  }

  function correctiveMemoryReviewObservation(
    event: EvidenceEvent,
    returned: CorrectiveMemoryTransition,
  ): MemoryReviewObservation {
    const beforeCard = returned.beforePolicyState.fsrsCard;
    const afterCard = returned.afterPolicyState.fsrsCard;
    assert(beforeCard && afterCard, "Corrective-memory evidence is missing FSRS replay state.");
    return {
      evidenceEventId: event.id,
      reviewedAt: event.reviewedAt,
      rating: validateRating(returned.rating),
      source: "relearning-verification",
      beforeCard: clone(beforeCard),
      afterCard: clone(afterCard),
      schedulerConfig: clone(validateFsrsConfigSnapshot(returned.schedulerConfig)),
      configFingerprint: validateFsrsConfigSnapshot(returned.schedulerConfig).fingerprint,
    };
  }

  function finalizeMemoryReviewObservations(
    obligationId: string,
    reviews: MemoryReviewObservation[],
  ): MemoryReviewObservation[] {
    reviews.sort((left, right) => {
      const time = left.reviewedAt.localeCompare(right.reviewedAt);
      if (time !== 0) return time;
      if (storedFsrsCardsEqual(left.afterCard, right.beforeCard)) return -1;
      if (storedFsrsCardsEqual(right.afterCard, left.beforeCard)) return 1;
      return left.evidenceEventId.localeCompare(right.evidenceEventId);
    });
    validateMemoryObservationChain(obligationId, reviews);
    return reviews;
  }

  function memoryReviewObservationsFor(
    obligationId: string,
    evidenceEvents: readonly EvidenceEvent[],
  ): MemoryReviewObservation[] {
    const reviews: MemoryReviewObservation[] = [];
    for (const event of evidenceEvents) {
      if (event.obligationId === obligationId && event.obligationType === "memory-recall") {
        reviews.push(directMemoryReviewObservation(event));
      }
      const returned = event.correctiveMemoryTransition;
      if (returned?.obligationId === obligationId) {
        reviews.push(correctiveMemoryReviewObservation(event, returned));
      }
    }
    return finalizeMemoryReviewObservations(obligationId, reviews);
  }

  function memoryReviewObservationIndex(
    evidenceEvents: readonly EvidenceEvent[],
  ): MemoryReviewObservationIndex {
    const mutable = new Map<string, MemoryReviewObservation[]>();
    const append = (obligationId: string, review: MemoryReviewObservation): void => {
      const reviews = mutable.get(obligationId);
      if (reviews) reviews.push(review);
      else mutable.set(obligationId, [review]);
    };
    for (const event of evidenceEvents) {
      if (event.obligationType === "memory-recall") {
        append(event.obligationId, directMemoryReviewObservation(event));
      }
      const returned = event.correctiveMemoryTransition;
      if (returned) append(returned.obligationId, correctiveMemoryReviewObservation(event, returned));
    }
    const index = new Map<string, readonly MemoryReviewObservation[]>();
    for (const [obligationId, reviews] of mutable) {
      index.set(obligationId, finalizeMemoryReviewObservations(obligationId, reviews));
    }
    return index;
  }

  function memoryProjectionVerificationFingerprint(
    currentProjection: MemoryMaterializedProjection,
    reviews: readonly MemoryReviewObservation[],
  ): string {
    return fingerprintText64(JSON.stringify({
      projection: currentProjection,
      reviews: reviews.map((review) => ({
        evidenceEventId: review.evidenceEventId,
        reviewedAt: review.reviewedAt,
        rating: review.rating,
        source: review.source,
        configFingerprint: review.configFingerprint,
        beforeCard: review.beforeCard,
        afterCard: review.afterCard,
      })),
    }));
  }

  class TsFsrsSchedulerPort implements RevisionSchedulerPort {
    readonly configuration: FsrsConfigSnapshot;
    private readonly history: Reschedule;
    private readonly verifiedProjectionFingerprints = new Map<string, {
      fingerprint: string;
      projection: MemoryMaterializedProjection;
      reviews: readonly MemoryReviewObservation[];
    }>();

    constructor(
      private readonly scheduler: FsrsSchedulerRuntime,
      configuration: FsrsConfigSnapshot,
    ) {
      this.configuration = clone(validateFsrsConfigSnapshot(configuration));
      this.history = new Reschedule(scheduler);
    }

    private replayCards(
      initialCard: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
    ): FsrsRescheduleResultRuntime {
      assert(reviews.length > 0, "FSRS replay requires review history.");
      return this.history.reschedule({
        initialCard: hydrateFsrsCard(initialCard),
        history: reviews.map((review) => ({
          rating: review.rating,
          reviewTime: new Date(review.reviewedAt),
        })),
      }, { sortHistory: false });
    }

    private grade(rating: Rating): number {
      const api = runtimeFsrs();
      if (rating === Rating.Again) return api.Rating.Again;
      if (rating === Rating.Hard) return api.Rating.Hard;
      if (rating === Rating.Good) return api.Rating.Good;
      return api.Rating.Easy;
    }

    newCard(firstDueAt: ISODateTime, cardId: string): MemoryMaterializedProjection {
      const now = new Date(firstDueAt);
      assert(Number.isFinite(now.getTime()), "FSRS initial due date is invalid.");
      return serializeFsrsCard(this.scheduler.newCard({ now, cardId }));
    }

    private materializeValidated(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
    ): MemoryMaterializedProjection {
      if (reviews.length === 0) return clone(currentProjection);
      const result = this.replayCards(reviews[0]!.beforeCard, reviews);
      assert(result.results.length === reviews.length, "FSRS reschedule produced an incomplete projection sequence.");
      for (let index = 0; index < reviews.length; index += 1) {
        const review = reviews[index]!;
        if (review.configFingerprint === this.configuration.fingerprint) {
          const expectedBefore = index === 0
            ? reviews[0]!.beforeCard
            : serializeFsrsCard(result.results[index - 1]!.card);
          assert(storedFsrsCardsEqual(review.beforeCard, expectedBefore),
            "FSRS replayed before-state diverges from immutable evidence recorded under the active scheduler configuration.");
          assert(storedFsrsCardsEqual(review.afterCard, serializeFsrsCard(result.results[index]!.card)),
            "FSRS replay diverges from immutable evidence recorded under the active scheduler configuration.");
        }
      }
      return serializeFsrsCard(result.card);
    }

    verifyProjection(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
      forceReplay = false,
    ): void {
      const cached = this.verifiedProjectionFingerprints.get(currentProjection.cardId);
      if (!forceReplay && cached?.reviews === reviews && storedFsrsCardsEqual(cached.projection, currentProjection)) return;
      validateMemoryObservationChain(currentProjection.cardId, reviews, currentProjection);
      const fingerprint = memoryProjectionVerificationFingerprint(currentProjection, reviews);
      if (!forceReplay && cached?.fingerprint === fingerprint) {
        this.verifiedProjectionFingerprints.set(currentProjection.cardId, {
          fingerprint,
          projection: clone(currentProjection),
          reviews,
        });
        return;
      }
      const materialized = this.materializeValidated(currentProjection, reviews);
      assert(storedFsrsCardsEqual(currentProjection, materialized), "Stored FSRS materialized projection failed replay integrity.");
      this.verifiedProjectionFingerprints.set(currentProjection.cardId, {
        fingerprint,
        projection: clone(currentProjection),
        reviews,
      });
    }

    preview(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
      now: Date,
    ): SchedulePreview[] {
      this.verifyProjection(currentProjection, reviews);
      const previews: SchedulePreview[] = [];
      for (const candidate of this.scheduler.preview({
        card: hydrateFsrsCard(currentProjection),
        now,
      })) {
        const rating = validateRating(candidate.grade);
        const dueAt = candidate.card.dueAt.toISOString();
        previews.push({
          rating,
          dueAt,
          intervalDays: daysBetween(candidate.card.dueAt, now),
          label: intervalLabel(dueAt, now),
        });
      }
      return previews.sort((left, right) => left.rating - right.rating);
    }

    review(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
      rating: Rating,
      now: Date,
    ): RevisionSchedulerReviewResult {
      this.verifyProjection(currentProjection, reviews);
      const result = this.scheduler.review({
        card: hydrateFsrsCard(currentProjection),
        now,
        grade: this.grade(rating),
      });
      const next = serializeFsrsCard(result.card);
      const reviewLog: Record<string, unknown> = {
        model: FSRS_MODEL,
        rating: result.revlog.rating,
        state: result.revlog.state,
        dueAt: result.revlog.dueAt.toISOString(),
        lastReviewAt: result.revlog.lastReviewAt?.toISOString() ?? null,
        reviewTime: result.revlog.reviewTime.toISOString(),
        stability: result.revlog.stability,
        stabilityFast: requiredFsrs7StabilityFast(result.revlog.stabilityFast),
        difficulty: result.revlog.difficulty,
        scheduledDays: result.revlog.scheduledDays,
        learningStep: result.revlog.learningStep,
      };
      if (result.revlog.scheduleStatus !== undefined) reviewLog["scheduleStatus"] = result.revlog.scheduleStatus;
      return { card: next, reviewLog };
    }

    retrievability(
      currentProjection: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
      at: Date,
    ): number | undefined {
      this.verifyProjection(currentProjection, reviews);
      if (reviews.length === 0 || currentProjection.reps === 0) return undefined;
      const lastReview = new Date(reviews.at(-1)!.reviewedAt);
      const elapsedDays = Math.max(0, this.scheduler.chrono.difference(lastReview, at));
      const retrievability = this.scheduler.model.forgettingCurve({
        stability: currentProjection.stability,
        stabilityFast: requiredFsrs7StabilityFast(currentProjection.stabilityFast),
        difficulty: currentProjection.difficulty,
      }, elapsedDays);
      return clamp(Number(retrievability), 0, 1);
    }

    replayVerifiedHistory(
      reviews: readonly MemoryReviewObservation[],
    ): MemoryMaterializedProjection {
      assert(reviews.length > 0, "FSRS verified replay requires review history.");
      validateMemoryObservationChain(reviews[0]!.beforeCard.cardId, reviews);
      return this.materializeValidated(reviews[0]!.beforeCard, reviews);
    }

    reschedule(
      initialCard: MemoryMaterializedProjection,
      reviews: readonly MemoryReviewObservation[],
    ): MemoryMaterializedProjection {
      assert(reviews.length > 0, "FSRS reschedule requires review history.");
      validateMemoryObservationChain(initialCard.cardId, reviews);
      validateStoredFsrsCard(initialCard, initialCard.cardId);
      assert(storedFsrsCardsEqual(initialCard, reviews[0]!.beforeCard), "FSRS reschedule initial card does not match canonical history.");
      const result = this.replayCards(initialCard, reviews);
      const projection = serializeFsrsCard(result.card);
      this.verifiedProjectionFingerprints.set(projection.cardId, {
        fingerprint: memoryProjectionVerificationFingerprint(projection, reviews),
        projection: clone(projection),
        reviews,
      });
      return projection;
    }
  }

  const FSRS_SCHEDULER_CACHE = new Map<string, RevisionSchedulerPort>();

  function fsrsBaseSchedulerOptions(
    desiredRetention: number,
    weights?: readonly number[],
  ): FsrsDefaultSchedulerOptions {
    return {
      version: FSRS_MODEL,
      desiredRetention,
      enableShortTerm: true,
      learningSteps: FSRS_LEARNING_STEPS,
      relearningSteps: FSRS_RELEARNING_STEPS,
      graduatingInterval: FSRS_GRADUATING_INTERVAL_DAYS,
      allowModelOverride: true,
      enableFuzz: false,
      maximumInterval: FSRS_MAXIMUM_INTERVAL_DAYS,
      clearStatsOnForget: false,
      ...(weights ? { weights: [...weights] } : {}),
    };
  }

  async function createCostAdrFsrsScheduler(
    runtime: FsrsUmdRuntime,
    policy: Extract<FsrsSchedulingPolicy, { kind: "cost-adr" }>,
    profile: FsrsOptimizerProfile | null,
  ): Promise<FsrsSchedulerRuntime> {
    const weights = profile ? [...profile.weights] : [...FSRS7_DEFAULT_WEIGHTS];
    const reference = await runtime.DefaultScheduler(fsrsBaseSchedulerOptions(0.9, weights));
    assert(typeof runtime.defineScheduler === "function", "Embedded ts-fsrs runtime does not expose scheduler composition.");
    return runtime.defineScheduler(reference.definition)
      .use(
        runtime.schedulerCostAdrMiddleware,
        runtime.schedulerFuzzingMiddleware,
        runtime.schedulerStatsMiddleware,
        runtime.schedulerScheduledDaysMiddleware,
        runtime.schedulerLearningStepsMiddleware,
        runtime.schedulerMaximumIntervalMiddleware,
        runtime.schedulerMonotonicIntervalMiddleware,
      )
      .create({
        config: {
          weights: [...weights],
          fractionalDays: true,
          costAdrPolicy: clone(policy.costAdrPolicy),
          goalCostWeight: policy.goalCostWeight,
          enableFuzz: false,
          clearStatsOnForget: false,
          enableShortTerm: true,
          learningSteps: [...FSRS_LEARNING_STEPS],
          relearningSteps: [...FSRS_RELEARNING_STEPS],
          graduatingInterval: FSRS_GRADUATING_INTERVAL_DAYS,
          allowModelOverride: true,
          maximumInterval: FSRS_MAXIMUM_INTERVAL_DAYS,
        },
      });
  }

  async function prepareFsrsScheduler(schedulingPolicy: FsrsSchedulingPolicy, profile: FsrsOptimizerProfile | null = null): Promise<void> {
    const policy = canonicalFsrsSchedulingPolicy(schedulingPolicy);
    const validatedProfile = profile ? validateFsrsOptimizerProfile(profile) : null;
    const configuration = fsrsConfigSnapshot(policy, validatedProfile);
    if (FSRS_SCHEDULER_CACHE.has(configuration.fingerprint)) return;
    const runtime = runtimeFsrs();
    const scheduler = policy.kind === "fixed-retention"
      ? await runtime.DefaultScheduler(fsrsBaseSchedulerOptions(
          fixedRetentionForPolicy(policy),
          validatedProfile?.weights,
        ))
      : await createCostAdrFsrsScheduler(runtime, policy, validatedProfile);
    const port = new TsFsrsSchedulerPort(scheduler, configuration);
    const probe = port.newCard("2000-01-01T00:00:00.000Z", "revision-director-fsrs7-probe");
    requiredFsrs7StabilityFast(probe.stabilityFast);
    FSRS_SCHEDULER_CACHE.set(configuration.fingerprint, port);
  }

  function revisionSchedulerPort(schedulingPolicy: FsrsSchedulingPolicy, profile: FsrsOptimizerProfile | null = null): RevisionSchedulerPort {
    const configuration = fsrsConfigSnapshot(canonicalFsrsSchedulingPolicy(schedulingPolicy), profile ? validateFsrsOptimizerProfile(profile) : null);
    const scheduler = FSRS_SCHEDULER_CACHE.get(configuration.fingerprint);
    assert(scheduler, "FSRS-7 scheduler has not been initialized for the current scheduling policy.");
    return scheduler;
  }

  function validateMemoryDatasetProjectionChain(
    obligations: readonly RevisionObligation[],
    reviewIndex: MemoryReviewObservationIndex,
  ): void {
    for (const obligation of obligations) {
      if (obligation.type !== "memory-recall") continue;
      const projection = obligation.policyState.fsrsCard;
      assert(projection, "Memory obligation has no FSRS materialized projection.");
      validateMemoryObservationChain(obligation.id, reviewIndex.get(obligation.id) ?? [], projection);
    }
  }

  function profileForHistoricalFsrsConfiguration(
    config: FsrsConfigSnapshot,
    profileCatalog: readonly FsrsOptimizerProfile[],
  ): FsrsOptimizerProfile | null {
    const validated = validateFsrsConfigSnapshot(config);
    if (validated.weightsSource === "ts-fsrs-package-default") return null;
    const sourceSha256 = validated.optimizerProfileSourceSha256;
    assert(sourceSha256, "Historical personalized FSRS configuration lacks profile provenance.");
    const matches = profileCatalog.filter((profile) =>
      profile.sourceSha256 === sourceSha256
      && fsrsWeightsFingerprint(profile.weights) === validated.weightsFingerprint
    );
    assert(matches.length === 1, "Historical personalized FSRS configuration cannot resolve its exact optimizer profile.");
    return matches[0]!;
  }

  function historicalFsrsConfigurations(
    reviewGroups: Iterable<readonly MemoryReviewObservation[]>,
  ): ReadonlyMap<string, FsrsConfigSnapshot> {
    const configurations = new Map<string, FsrsConfigSnapshot>();
    for (const reviews of reviewGroups) {
      for (const review of reviews) {
        const config = validateFsrsConfigSnapshot(review.schedulerConfig);
        const existing = configurations.get(config.fingerprint);
        if (existing) {
          assert(JSON.stringify(existing) === JSON.stringify(config), "A single FSRS configuration fingerprint maps to conflicting scheduler snapshots.");
        } else {
          configurations.set(config.fingerprint, clone(config));
        }
      }
    }
    return configurations;
  }

  async function prepareMemoryDatasetReplaySchedulers(
    reviewIndex: MemoryReviewObservationIndex,
    profileCatalog: readonly FsrsOptimizerProfile[],
  ): Promise<void> {
    const configurations = historicalFsrsConfigurations(reviewIndex.values());
    for (const config of configurations.values()) {
      const historicalProfile = profileForHistoricalFsrsConfiguration(config, profileCatalog);
      await prepareFsrsScheduler(config.schedulingPolicy, historicalProfile);
      const prepared = revisionSchedulerPort(config.schedulingPolicy, historicalProfile);
      assert(prepared.configuration.fingerprint === config.fingerprint, "Historical FSRS configuration cannot be reconstructed exactly.");
    }
  }

  function verifyHistoricalMemorySchedulerConfigurations(
    reviews: readonly MemoryReviewObservation[],
    profileCatalog: readonly FsrsOptimizerProfile[],
    currentConfigFingerprint?: string,
  ): void {
    if (reviews.length === 0) return;
    const configurations = historicalFsrsConfigurations([reviews]);
    for (const config of configurations.values()) {
      if (config.fingerprint === currentConfigFingerprint) continue;
      const historicalProfile = profileForHistoricalFsrsConfiguration(config, profileCatalog);
      const historicalScheduler = revisionSchedulerPort(config.schedulingPolicy, historicalProfile);
      assert(historicalScheduler.configuration.fingerprint === config.fingerprint, "Historical FSRS configuration cannot be reconstructed exactly.");
      historicalScheduler.replayVerifiedHistory(reviews);
    }
  }

  async function verifyMemoryDatasetIntegrityWithIndex(
    obligations: readonly RevisionObligation[],
    reviewIndex: MemoryReviewObservationIndex,
    schedulingPolicy: FsrsSchedulingPolicy,
    profile: FsrsOptimizerProfile | null = null,
    profileCatalog: readonly FsrsOptimizerProfile[] = profile ? [profile] : [],
  ): Promise<void> {
    await prepareFsrsScheduler(schedulingPolicy, profile);
    await prepareMemoryDatasetReplaySchedulers(reviewIndex, profileCatalog);
    const scheduler = revisionSchedulerPort(schedulingPolicy, profile);
    for (const obligation of obligations) {
      if (obligation.type !== "memory-recall") continue;
      const projection = obligation.policyState.fsrsCard;
      assert(projection, "Memory obligation has no FSRS materialized projection.");
      const reviews = reviewIndex.get(obligation.id) ?? [];
      verifyHistoricalMemorySchedulerConfigurations(reviews, profileCatalog, scheduler.configuration.fingerprint);
      scheduler.verifyProjection(projection, reviews, true);
    }
  }

  async function verifyMemoryDatasetIntegrity(
    obligations: readonly RevisionObligation[],
    evidenceEvents: readonly EvidenceEvent[],
    schedulingPolicy: FsrsSchedulingPolicy,
    profile: FsrsOptimizerProfile | null = null,
    profileCatalog: readonly FsrsOptimizerProfile[] = profile ? [profile] : [],
  ): Promise<MemoryReviewObservationIndex> {
    const reviewIndex = memoryReviewObservationIndex(evidenceEvents);
    await verifyMemoryDatasetIntegrityWithIndex(obligations, reviewIndex, schedulingPolicy, profile, profileCatalog);
    return reviewIndex;
  }

