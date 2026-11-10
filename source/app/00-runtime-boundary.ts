(() => {
  "use strict";

  /* Revision Director VA7.1 Pass E1 extension runtime.
   * One sealed TypeScript monolith with private domain, policy, persistence,
   * application and UI layers. Only the frozen, capability-versioned RevisionDirector API is public.
   */

  /* ==========================================================================
     EXACT ts-fsrs 6.0.0 UMD / FSRS-7 CONTRACT
     ========================================================================== */

  type FsrsModelVersion = "FSRS-6" | "FSRS-7";
  type FsrsScheduleStatus = "new" | "learning" | "review" | "suspended";

  interface FsrsMemoryStateRuntime {
    stability: number;
    difficulty: number;
    stabilityFast?: number;
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
    scheduleStatus: FsrsScheduleStatus;
  }

  interface FsrsReviewLogRuntime extends FsrsMemoryStateRuntime {
    rating: number;
    state: number;
    dueAt: Date;
    lastReviewAt: Date | null;
    reviewTime: Date;
    scheduledDays: number;
    learningStep: number;
    scheduleStatus?: FsrsScheduleStatus;
  }

  interface FsrsRecordRuntime {
    card: FsrsCardRuntime;
    revlog: FsrsReviewLogRuntime;
  }

  interface FsrsPreviewRuntime extends FsrsRecordRuntime {
    grade: number;
  }

  interface FsrsSchedulerRuntime {
    readonly model: {
      forgettingCurve(state: FsrsMemoryStateRuntime, elapsedDays: number): number;
      forward(input: {
        history: readonly { rating: number; deltaT: number }[];
        initialState?: FsrsMemoryStateRuntime | null;
      }): readonly FsrsMemoryStateRuntime[];
    };
    newCard(input: { now?: Date; cardId?: string }): FsrsCardRuntime;
    preview(input: { card: FsrsCardRuntime; now: Date }): Iterable<FsrsPreviewRuntime>;
    review(input: { card: FsrsCardRuntime; now: Date; grade: number }): FsrsRecordRuntime;
  }

  interface FsrsDefaultSchedulerOptions {
    version: FsrsModelVersion;
    desiredRetention: number;
    enableShortTerm: boolean;
    learningSteps: readonly string[];
    relearningSteps: readonly string[];
    allowModelOverride: boolean;
    enableFuzz: boolean;
    maximumInterval: number;
    clearStatsOnForget: boolean;
  }

  interface FsrsUmdRuntime {
    Rating: Readonly<{ Again: number; Hard: number; Good: number; Easy: number }>;
    State: Readonly<{ New: number; Learning: number; Review: number; Relearning: number }>;
    DefaultScheduler(options: FsrsDefaultSchedulerOptions): Promise<FsrsSchedulerRuntime>;
  }

  const FSRS = (window as Window & { FSRS?: FsrsUmdRuntime }).FSRS;
  // The vendored UMD bundle necessarily creates a temporary global. Capture its
  // frozen API reference, then remove the public property so the app retains a
  // sealed runtime surface apart from the RevisionDirector capability API.
  try { delete (window as Window & { FSRS?: FsrsUmdRuntime }).FSRS; } catch { /* non-fatal */ }

  /* ==========================================================================
     DOMAIN MODEL
     ========================================================================== */
