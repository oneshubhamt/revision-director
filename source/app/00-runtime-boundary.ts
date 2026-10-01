(() => {
  "use strict";

  /* Revision Director VA7.1 Pass E1 extension runtime.
   * One sealed TypeScript monolith with private domain, policy, persistence,
   * application and UI layers. Only the frozen, capability-versioned RevisionDirector API is public.
   */

  /* ========================================================================== 
     EXACT ts-fsrs 5.4.1 UMD CONTRACT
     ========================================================================== */

  interface FsrsCardRuntime {
    due: Date;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    learning_steps: number;
    reps: number;
    lapses: number;
    state: number;
    last_review?: Date;
  }

  interface FsrsReviewLogRuntime {
    rating: number;
    state: number;
    due: Date;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    last_elapsed_days: number;
    scheduled_days: number;
    learning_steps: number;
    review: Date;
  }

  interface FsrsRecordRuntime {
    card: FsrsCardRuntime;
    log: FsrsReviewLogRuntime;
  }

  interface FsrsSchedulerRuntime {
    repeat(card: FsrsCardRuntime, now: Date): Record<number, FsrsRecordRuntime>;
    next(card: FsrsCardRuntime, now: Date, grade: number): FsrsRecordRuntime;
    get_retrievability(card: FsrsCardRuntime, now?: Date, format?: false): number;
  }

  interface FsrsUmdRuntime {
    Rating: Readonly<{ Again: number; Hard: number; Good: number; Easy: number }>;
    State: Readonly<Record<string | number, string | number>>;
    createEmptyCard(now?: Date): FsrsCardRuntime;
    fsrs(parameters?: Record<string, unknown>): FsrsSchedulerRuntime;
    generatorParameters?(parameters?: Record<string, unknown>): Record<string, unknown>;
  }

  const FSRS = (window as Window & { FSRS?: FsrsUmdRuntime }).FSRS;
  // The vendored UMD bundle necessarily creates a temporary global. Capture its
  // frozen API reference, then remove the public property so the app retains a
  // sealed runtime surface apart from the RevisionDirector capability API.
  try { delete (window as Window & { FSRS?: FsrsUmdRuntime }).FSRS; } catch { /* non-fatal */ }

  /* ========================================================================== 
     DOMAIN MODEL
     ========================================================================== */
