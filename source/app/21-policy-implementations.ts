  class FsrsMemoryPolicy implements SchedulerPolicy {
    readonly id = `memory/ts-fsrs@${FSRS_PACKAGE_VERSION}/fsrs-7`;
    readonly type: ObligationType = "memory-recall";

    constructor(
      private readonly schedulingPolicy: () => FsrsSchedulingPolicy,
      private readonly optimizerProfile: () => FsrsOptimizerProfile | null = () => null,
    ) {}

    private scheduler(): RevisionSchedulerPort {
      return revisionSchedulerPort(this.schedulingPolicy(), this.optimizerProfile());
    }

    private reviews(context?: SchedulerPolicyContext): readonly MemoryReviewObservation[] {
      return context?.memoryReviews ?? [];
    }

    createInitialState(firstDueAt: ISODateTime, cardId: string): PolicyState {
      const card = this.scheduler().newCard(firstDueAt, cardId);
      return {
        engine: "ts-fsrs",
        version: FSRS_PACKAGE_VERSION,
        stage: card.state,
        successStreak: 0,
        failureCount: 0,
        lastIntervalDays: 0,
        fsrsCard: card,
      };
    }

    preview(obligation: RevisionObligation, now: Date, context?: SchedulerPolicyContext): SchedulePreview[] {
      const card = obligation.policyState.fsrsCard;
      assert(card, "Memory obligation has no FSRS-7 card state.");
      return this.scheduler().preview(card, this.reviews(context), now);
    }

    complete(
      obligation: RevisionObligation,
      rating: Rating,
      _evidence: ObjectiveEvidence,
      now: Date,
      context?: SchedulerPolicyContext,
    ): PolicyCompletion {
      const card = obligation.policyState.fsrsCard;
      assert(card, "Memory obligation has no FSRS-7 card state.");
      const scheduler = this.scheduler();
      const result = scheduler.review(card, this.reviews(context), rating, now);
      const next = result.card;
      const state: PolicyState = {
        engine: "ts-fsrs",
        version: FSRS_PACKAGE_VERSION,
        stage: next.state,
        successStreak: rating >= Rating.Good ? obligation.policyState.successStreak + 1 : 0,
        failureCount: obligation.policyState.failureCount + (rating === Rating.Again ? 1 : 0),
        lastIntervalDays: next.scheduledDays,
        fsrsCard: next,
      };
      const completion: PolicyCompletion = {
        dueAt: next.dueAt,
        policyState: state,
        policyId: this.id,
        reviewLog: result.reviewLog,
        schedulerConfig: clone(scheduler.configuration),
      };
      if (rating === Rating.Again) completion.followUpType = "relearn";
      return completion;
    }
  }

  abstract class IntervalPolicy implements SchedulerPolicy {
    abstract readonly id: string;
    abstract readonly type: ObligationType;
    protected abstract intervals(state: PolicyState, rating: Rating, obligation: RevisionObligation): number;

    createInitialState(_firstDueAt: ISODateTime): PolicyState {
      return {
        engine: this.engine(),
        version: "1",
        stage: 0,
        successStreak: 0,
        failureCount: 0,
        lastIntervalDays: 0,
      };
    }

    protected abstract engine(): PolicyState["engine"];

    preview(obligation: RevisionObligation, now: Date): SchedulePreview[] {
      return ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Rating[]).map((rating) => {
        const intervalDays = this.intervals(obligation.policyState, rating, obligation);
        const dueAt = addDays(now, intervalDays).toISOString();
        return { rating, dueAt, intervalDays, label: intervalLabel(dueAt, now) };
      });
    }

    complete(obligation: RevisionObligation, rating: Rating, evidence: ObjectiveEvidence, now: Date): PolicyCompletion {
      const intervalDays = this.intervals(obligation.policyState, rating, obligation);
      const successful = rating >= Rating.Good && objectiveScore(obligation.type, evidence) >= 2.6;
      const policyState: PolicyState = {
        engine: this.engine(),
        version: "1",
        stage: successful ? obligation.policyState.stage + 1 : Math.max(0, obligation.policyState.stage - 1),
        successStreak: successful ? obligation.policyState.successStreak + 1 : 0,
        failureCount: obligation.policyState.failureCount + (rating === Rating.Again ? 1 : 0),
        lastIntervalDays: intervalDays,
      };
      const completion: PolicyCompletion = {
        dueAt: addDays(now, intervalDays).toISOString(),
        policyState,
        policyId: this.id,
      };
      if (rating === Rating.Again || objectiveScore(obligation.type, evidence) < 1.35) completion.followUpType = "relearn";
      return completion;
    }
  }

  class MasteryPolicy extends IntervalPolicy {
    readonly id = "concept-mastery/v1";
    readonly type: ObligationType = "concept-reconstruction";
    protected engine(): PolicyState["engine"] { return "mastery"; }
    protected intervals(state: PolicyState, rating: Rating): number {
      if (rating === Rating.Again) return 1;
      if (rating === Rating.Hard) return Math.max(2, Math.round(Math.max(3, state.lastIntervalDays) * 0.65));
      const good = [3, 7, 14, 30, 60, 120, 210, 365];
      const easy = [7, 14, 30, 60, 120, 210, 365, 540];
      return (rating === Rating.Good ? good : easy)[Math.min(state.stage, 7)]!;
    }
  }

  class ApplicationPolicy extends IntervalPolicy {
    readonly id = "application-practice/v1";
    readonly type: ObligationType = "application-practice";
    protected engine(): PolicyState["engine"] { return "application"; }
    protected intervals(state: PolicyState, rating: Rating): number {
      if (rating === Rating.Again) return 1;
      if (rating === Rating.Hard) return 3;
      const good = [5, 10, 21, 45, 90, 180, 300];
      const easy = [10, 21, 45, 90, 180, 300, 450];
      return (rating === Rating.Good ? good : easy)[Math.min(state.stage, 6)]!;
    }
  }

  class PerformancePolicy extends IntervalPolicy {
    readonly id = "performance-practice/v1";
    readonly type: ObligationType = "performance-practice";
    protected engine(): PolicyState["engine"] { return "performance"; }
    protected intervals(state: PolicyState, rating: Rating): number {
      if (rating === Rating.Again) return 3;
      if (rating === Rating.Hard) return 7;
      const good = [10, 21, 35, 60, 90, 120];
      const easy = [21, 35, 60, 90, 120, 180];
      return (rating === Rating.Good ? good : easy)[Math.min(state.stage, 5)]!;
    }
  }

  class RelearnPolicy extends IntervalPolicy {
    readonly id = "relearn/v1";
    readonly type: ObligationType = "relearn";
    protected engine(): PolicyState["engine"] { return "relearn"; }
    protected intervals(state: PolicyState, rating: Rating): number {
      if (rating === Rating.Again) return 1;
      if (rating === Rating.Hard) return 2;
      if (rating === Rating.Good) return state.successStreak >= 1 ? 5 : 3;
      return state.successStreak >= 1 ? 7 : 4;
    }
  }

  class FreshnessPolicy extends IntervalPolicy {
    readonly id = "freshness-review/v1";
    readonly type: ObligationType = "freshness-review";
    protected engine(): PolicyState["engine"] { return "freshness"; }
    protected intervals(_state: PolicyState, rating: Rating, obligation: RevisionObligation): number {
      if (rating === Rating.Again) return 1;
      if (rating === Rating.Hard) return Math.max(3, Math.round(obligation.freshnessDays * 0.35));
      if (rating === Rating.Good) return obligation.freshnessDays;
      return Math.max(obligation.freshnessDays, Math.round(obligation.freshnessDays * 1.5));
    }
  }

  class SchedulerPolicyRouter {
    private readonly policies = new Map<ObligationType, SchedulerPolicy>();

    constructor(
      schedulingPolicy: () => FsrsSchedulingPolicy,
      optimizerProfile: () => FsrsOptimizerProfile | null = () => null,
    ) {
      const all: SchedulerPolicy[] = [
        new FsrsMemoryPolicy(schedulingPolicy, optimizerProfile),
        new MasteryPolicy(),
        new ApplicationPolicy(),
        new PerformancePolicy(),
        new RelearnPolicy(),
        new FreshnessPolicy(),
      ];
      for (const policy of all) this.policies.set(policy.type, policy);
    }

    get(type: ObligationType): SchedulerPolicy {
      const policy = this.policies.get(type);
      assert(policy, `No scheduler policy registered for ${type}.`);
      return policy;
    }
  }

  /* ========================================================================== 
     INDEXEDDB REPOSITORY — SCHEMA V1
     ========================================================================== */

