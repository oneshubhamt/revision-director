
  /* Revision Director VA7.1 Pass E1 extension runtime.
   * Maintained as independently compilable TypeScript source parts sharing one
   * script namespace. The build seals their emitted JavaScript inside one IIFE.
   * Only the frozen, capability-versioned RevisionDirector API is public.
   */

  /* ==========================================================================
     EXACT ts-fsrs 6.0.0 / FSRS-7 CONTRACT
     ========================================================================== */

  type FsrsModelVersion = "FSRS-7";
  type FsrsRuntimeScheduleStatus = "new" | "learning" | "review" | "suspended";
  type StoredFsrsScheduleStatus = Exclude<FsrsRuntimeScheduleStatus, "suspended">;

  interface FsrsMemoryStateRuntime {
    stability: number;
    stabilityFast: number;
    difficulty: number;
  }

  interface FsrsCardRuntime extends FsrsMemoryStateRuntime {
    cardId: string;
    dueAt: Date;
    lastReviewAt: Date | null;
    scheduledDays: number;
    learningStep: number;
    reps: number;
    lapses: number;
    state: number;
    scheduleStatus: FsrsRuntimeScheduleStatus;
  }

  interface FsrsReviewLogRuntime extends FsrsMemoryStateRuntime {
    rating: number;
    state: number;
    dueAt: Date;
    lastReviewAt: Date | null;
    reviewTime: Date;
    scheduledDays: number;
    learningStep: number;
    scheduleStatus?: FsrsRuntimeScheduleStatus;
  }

  interface FsrsRecordRuntime {
    card: FsrsCardRuntime;
    revlog: FsrsReviewLogRuntime;
  }

  interface FsrsPreviewRuntime extends FsrsRecordRuntime {
    grade: number;
  }

  interface FsrsHistoryReviewRuntime {
    rating: number;
    reviewTime: Date;
  }

  interface FsrsSchedulerDefinitionRuntime {
    readonly model: unknown;
    readonly chrono: unknown;
  }

  interface FsrsSchedulerFactoryRuntime {
    use(...middlewares: unknown[]): FsrsSchedulerFactoryRuntime;
    create(input: { config: Record<string, unknown> }): FsrsSchedulerRuntime;
  }

  interface FsrsSchedulerRuntime {
    readonly definition: FsrsSchedulerDefinitionRuntime;
    readonly model: {
      forgettingCurve(state: FsrsMemoryStateRuntime, elapsedDays: number): number;
    };
    readonly chrono: {
      difference(from: Date, to: Date): number;
      compare?(left: Date, right: Date): number;
    };
    newCard(input: { now?: Date; cardId?: string }): FsrsCardRuntime;
    preview(input: { card: FsrsCardRuntime; now: Date }): Iterable<FsrsPreviewRuntime>;
    review(input: { card: FsrsCardRuntime; now: Date; grade: number }): FsrsRecordRuntime;
    forward(input: {
      history: readonly FsrsHistoryReviewRuntime[];
      initialCard?: FsrsCardRuntime;
    }): FsrsRecordRuntime[];
  }

  interface FsrsDefaultSchedulerOptions {
    version: FsrsModelVersion;
    desiredRetention: number;
    enableShortTerm: true;
    learningSteps: readonly string[];
    relearningSteps: readonly string[];
    graduatingInterval: number;
    allowModelOverride: true;
    enableFuzz: false;
    maximumInterval: number;
    clearStatsOnForget: false;
    weights?: readonly number[];
  }

  interface FsrsUmdRuntime {
    Rating: Readonly<{ Again: number; Hard: number; Good: number; Easy: number }>;
    State: Readonly<{ New: number; Learning: number; Review: number; Relearning: number }>;
    DefaultScheduler(options: FsrsDefaultSchedulerOptions): Promise<FsrsSchedulerRuntime>;
    defineScheduler(definition: FsrsSchedulerDefinitionRuntime): FsrsSchedulerFactoryRuntime;
    schedulerCostAdrMiddleware: unknown;
    schedulerFuzzingMiddleware: unknown;
    schedulerStatsMiddleware: unknown;
    schedulerScheduledDaysMiddleware: unknown;
    schedulerLearningStepsMiddleware: unknown;
    schedulerMaximumIntervalMiddleware: unknown;
    schedulerMonotonicIntervalMiddleware: unknown;
  }

  const FSRS = (window as Window & { FSRS?: FsrsUmdRuntime }).FSRS;
  // The vendored UMD bundle creates a temporary global. Capture the runtime
  // reference, then remove that public property so RevisionDirector remains the
  // only application capability exposed on window.
  try { delete (window as Window & { FSRS?: FsrsUmdRuntime }).FSRS; } catch { /* non-fatal */ }

  /* ==========================================================================
     DOMAIN MODEL
     ========================================================================== */
