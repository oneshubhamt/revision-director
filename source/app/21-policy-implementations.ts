  class FsrsMemoryPolicy implements SchedulerPolicy {
    readonly id = `memory/ts-fsrs@${FSRS_PACKAGE_VERSION}`;
    readonly type: ObligationType = "memory-recall";

    constructor(private readonly desiredRetention: () => number) {}

    private config(): FsrsConfigSnapshot {
      return {
        requestRetention: this.desiredRetention(),
        enableFuzz: false,
        enableShortTerm: false,
        learningSteps: [],
        relearningSteps: [],
      };
    }

    private scheduler(config = this.config()): FsrsSchedulerRuntime {
      const api = runtimeFsrs();
      const raw = {
        request_retention: config.requestRetention,
        enable_fuzz: config.enableFuzz,
        enable_short_term: config.enableShortTerm,
        learning_steps: config.learningSteps,
        relearning_steps: config.relearningSteps,
      };
      const params = typeof api.generatorParameters === "function" ? api.generatorParameters(raw) : raw;
      return api.fsrs(params);
    }

    createInitialState(firstDueAt: ISODateTime): PolicyState {
      const card = runtimeFsrs().createEmptyCard(new Date(firstDueAt));
      card.due = new Date(firstDueAt);
      return {
        engine: "ts-fsrs",
        version: FSRS_PACKAGE_VERSION,
        stage: 0,
        successStreak: 0,
        failureCount: 0,
        lastIntervalDays: 0,
        fsrsCard: serializeFsrsCard(card),
      };
    }

    preview(obligation: RevisionObligation, now: Date): SchedulePreview[] {
      const card = obligation.policyState.fsrsCard;
      assert(card, "Memory obligation has no FSRS card state.");
      const previews = this.scheduler(this.config()).repeat(hydrateFsrsCard(card), now);
      return ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Rating[]).map((rating) => {
        const record = previews[rating];
        assert(record, `ts-fsrs did not return preview for rating ${rating}.`);
        const dueAt = record.card.due.toISOString();
        return { rating, dueAt, intervalDays: daysBetween(record.card.due, now), label: intervalLabel(dueAt, now) };
      });
    }

    complete(obligation: RevisionObligation, rating: Rating, evidence: ObjectiveEvidence, now: Date): PolicyCompletion {
      const card = obligation.policyState.fsrsCard;
      assert(card, "Memory obligation has no FSRS card state.");
      const api = runtimeFsrs();
      const schedulerConfig = this.config();
      const grade = rating === Rating.Again ? api.Rating.Again : rating === Rating.Hard ? api.Rating.Hard : rating === Rating.Good ? api.Rating.Good : api.Rating.Easy;
      const result = this.scheduler(schedulerConfig).next(hydrateFsrsCard(card), now, grade);
      const next = serializeFsrsCard(result.card);
      const state: PolicyState = {
        engine: "ts-fsrs",
        version: FSRS_PACKAGE_VERSION,
        stage: result.card.state,
        successStreak: rating >= Rating.Good ? obligation.policyState.successStreak + 1 : 0,
        failureCount: obligation.policyState.failureCount + (rating === Rating.Again ? 1 : 0),
        lastIntervalDays: result.card.scheduled_days,
        fsrsCard: next,
      };
      const log: Record<string, unknown> = {
        rating: result.log.rating,
        state: result.log.state,
        dueAt: result.log.due.toISOString(),
        stability: result.log.stability,
        difficulty: result.log.difficulty,
        elapsedDays: result.log.elapsed_days,
        lastElapsedDays: result.log.last_elapsed_days,
        scheduledDays: result.log.scheduled_days,
        learningSteps: result.log.learning_steps,
        reviewedAt: result.log.review.toISOString(),
      };
      const completion: PolicyCompletion = {
        dueAt: next.dueAt,
        policyState: state,
        policyId: this.id,
        reviewLog: log,
        schedulerConfig,
      };
      if (rating === Rating.Again && objectiveScore(obligation.type, evidence) < 1.5) completion.followUpType = "relearn";
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

    constructor(desiredRetention: () => number) {
      const all: SchedulerPolicy[] = [
        new FsrsMemoryPolicy(desiredRetention),
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

