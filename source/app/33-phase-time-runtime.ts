  function emptyPhaseTotals(): Record<ReviewPhase, number> {
    return { attempt: 0, compare: 0, "relearn-repair": 0, "relearn-verify": 0 };
  }

  function phaseTimeSnapshot(phase: ReviewPhase, sourceVisible = false, now = Date.now()): PhaseTimeRuntimeSnapshot {
    const at = new Date(now).toISOString();
    return {
      currentPhase: phase,
      state: "running",
      sessionStartedAt: at,
      lastTickAt: at,
      activeByPhase: emptyPhaseTotals(),
      pauseHistory: [],
      phaseHistory: [],
      gapHistory: [],
      sourceVisible,
      ...(sourceVisible ? { sourceRevealAt: at } : {}),
      backwardClockCount: 0,
    };
  }

  function timingEvidenceSummary(snapshot: PhaseTimeRuntimeSnapshot, now = Date.now()): TimingEvidenceSummary {
    const canonical = canonicalPhaseTimeRuntimeSnapshot(snapshot);
    const activeByPhase = clone(canonical.activeByPhase);
    const gapHistory = canonical.gapHistory;
    const pauseMs = canonical.pauseHistory.reduce((sum, pause) => sum + pause.durationMs, 0) +
      (canonical.state === "paused" && canonical.pauseStartedAt ? Math.max(0, now - Date.parse(canonical.pauseStartedAt)) : 0);
    const ignoredGapMs = gapHistory.reduce((sum, gap) => sum + gap.ignoredMs, 0);
    const reliabilityFlags: TimingReliabilityFlag[] = [];
    if (ignoredGapMs > 0) reliabilityFlags.push("ignored-gap");
    if (canonical.backwardClockCount > 0) reliabilityFlags.push("backward-clock");
    return {
      totalActiveMs: Object.values(activeByPhase).reduce((sum, value) => sum + value, 0),
      activeByPhase,
      pauseMs,
      pauseCount: canonical.pauseHistory.length + (canonical.state === "paused" ? 1 : 0),
      inactiveGapCount: gapHistory.length + (canonical.pendingGap ? 1 : 0),
      classifiedFocusMs: gapHistory.reduce((sum, gap) => sum + gap.focusMs, 0),
      classifiedBreakMs: gapHistory.reduce((sum, gap) => sum + gap.breakMs, 0),
      ignoredGapMs,
      promptExcludedMs: gapHistory.reduce((sum, gap) => sum + gap.promptMs, 0),
      backwardClockCount: canonical.backwardClockCount,
      ...(canonical.sourceRevealAt ? { sourceRevealAt: canonical.sourceRevealAt } : {}),
      durationReliable: ignoredGapMs === 0 && !canonical.pendingGap,
      reliabilityFlags,
    };
  }

  class PhaseTimeRuntime {
    private state: PhaseTimeRuntimeSnapshot;

    constructor(snapshot: PhaseTimeRuntimeSnapshot) {
      this.state = canonicalPhaseTimeRuntimeSnapshot(snapshot);
    }

    static create(phase: ReviewPhase, sourceVisible = false, now = Date.now()): PhaseTimeRuntime {
      return new PhaseTimeRuntime(phaseTimeSnapshot(phase, sourceVisible, now));
    }

    snapshot(): PhaseTimeRuntimeSnapshot {
      return clone(this.state);
    }

    summary(now = Date.now()): TimingEvidenceSummary {
      return timingEvidenceSummary(this.state, now);
    }

    activeMs(): number {
      return Object.values(this.state.activeByPhase).reduce((sum, value) => sum + value, 0);
    }

    phaseActiveMs(phase: ReviewPhase): number {
      return this.state.activeByPhase[phase];
    }

    currentPhase(): ReviewPhase { return this.state.currentPhase; }
    status(): PhaseTimeState { return this.state.state; }
    isPaused(): boolean { return this.state.state === "paused"; }
    hasPendingGap(): boolean { return Boolean(this.state.pendingGap); }
    pendingGap(): PendingInactiveGap | undefined { return this.state.pendingGap ? clone(this.state.pendingGap) : undefined; }

    private trimHistory(): void {
      if (this.state.pauseHistory.length > TIME_HISTORY_LIMIT) this.state.pauseHistory.splice(0, this.state.pauseHistory.length - TIME_HISTORY_LIMIT);
      if (this.state.phaseHistory.length > TIME_HISTORY_LIMIT) this.state.phaseHistory.splice(0, this.state.phaseHistory.length - TIME_HISTORY_LIMIT);
      if (this.state.gapHistory.length > TIME_HISTORY_LIMIT) this.state.gapHistory.splice(0, this.state.gapHistory.length - TIME_HISTORY_LIMIT);
    }

    private rebaseBackwardClock(now: number, last: number): void {
      const delta = now - last;
      if (this.state.pauseStartedAt) this.state.pauseStartedAt = new Date(Date.parse(this.state.pauseStartedAt) + delta).toISOString();
      if (this.state.pendingGap) {
        this.state.pendingGap.lastReliableAt = new Date(Date.parse(this.state.pendingGap.lastReliableAt) + delta).toISOString();
        this.state.pendingGap.detectedAt = new Date(Date.parse(this.state.pendingGap.detectedAt) + delta).toISOString();
      }
      this.state.backwardClockCount += 1;
      this.state.lastTickAt = new Date(now).toISOString();
    }

    reconcile(now = Date.now(), source: TimeRuntimeSource = "tick"): { gapOpened: boolean; backwardClock: boolean } {
      const last = Date.parse(this.state.lastTickAt);
      if (!Number.isFinite(last)) {
        this.state.lastTickAt = new Date(now).toISOString();
        return { gapOpened: false, backwardClock: false };
      }
      if (now < last) {
        this.rebaseBackwardClock(now, last);
        return { gapOpened: false, backwardClock: true };
      }
      if (this.state.state === "gap-pending") return { gapOpened: false, backwardClock: false };
      const delta = Math.max(0, now - last);
      if (this.state.state === "paused") {
        this.state.lastTickAt = new Date(now).toISOString();
        return { gapOpened: false, backwardClock: false };
      }
      if (delta > INACTIVE_GAP_THRESHOLD_MS) {
        const detectedAt = new Date(now).toISOString();
        this.state.pendingGap = {
          id: uid("gap"),
          phase: this.state.currentPhase,
          source,
          lastReliableAt: this.state.lastTickAt,
          detectedAt,
          gapMs: delta,
        };
        this.state.state = "gap-pending";
        this.state.lastTickAt = detectedAt;
        return { gapOpened: true, backwardClock: false };
      }
      this.state.activeByPhase[this.state.currentPhase] += delta;
      this.state.lastTickAt = new Date(now).toISOString();
      return { gapOpened: false, backwardClock: false };
    }

    pause(now = Date.now()): void {
      this.reconcile(now, "snapshot");
      assert(!this.state.pendingGap, "Classify the inactive gap before pausing.");
      if (this.state.state === "paused") return;
      this.state.state = "paused";
      this.state.pauseStartedAt = new Date(now).toISOString();
      this.state.lastTickAt = new Date(now).toISOString();
    }

    resume(now = Date.now()): void {
      assert(!this.state.pendingGap, "Classify the inactive gap before resuming.");
      if (this.state.state !== "paused") return;
      const startedAt = this.state.pauseStartedAt ?? new Date(now).toISOString();
      const durationMs = Math.max(0, now - Date.parse(startedAt));
      this.state.pauseHistory.push({
        id: uid("pause"), reason: "manual", phase: this.state.currentPhase,
        startedAt, endedAt: new Date(now).toISOString(), durationMs,
      });
      delete this.state.pauseStartedAt;
      this.state.state = "running";
      this.state.lastTickAt = new Date(now).toISOString();
      this.trimHistory();
    }

    transition(to: ReviewPhase, reason: PhaseTransitionRecord["reason"], sourceVisible: boolean, now = Date.now()): void {
      this.reconcile(now, "snapshot");
      assert(this.state.state === "running" && !this.state.pendingGap, "Resume and classify interruptions before changing phase.");
      const from = this.state.currentPhase;
      if (from === to && this.state.sourceVisible === sourceVisible) return;
      if (!this.state.sourceVisible && sourceVisible && !this.state.sourceRevealAt) this.state.sourceRevealAt = new Date(now).toISOString();
      this.state.phaseHistory.push({ from, to, at: new Date(now).toISOString(), sourceVisible, reason });
      this.state.currentPhase = to;
      this.state.sourceVisible = sourceVisible;
      this.state.lastTickAt = new Date(now).toISOString();
      this.trimHistory();
    }

    resolveGap(classification: InactiveGapClassification, focusMs = 0, now = Date.now()): GapClassificationRecord {
      const pending = this.state.pendingGap;
      assert(pending, "There is no inactive gap to classify.");
      const gapMs = Math.max(0, pending.gapMs);
      let focusPart = 0;
      let breakPart = 0;
      let ignoredPart = 0;
      if (classification === "focus") focusPart = gapMs;
      else if (classification === "break") breakPart = gapMs;
      else if (classification === "split") {
        focusPart = Math.min(gapMs, Math.max(0, Math.round(focusMs)));
        breakPart = Math.max(0, gapMs - focusPart);
      } else ignoredPart = gapMs;
      if (focusPart > 0) this.state.activeByPhase[pending.phase] += focusPart;
      const promptMs = Math.max(0, now - Date.parse(pending.detectedAt));
      const resolvedAt = new Date(now).toISOString();
      if (breakPart > 0) {
        const gapEnd = Date.parse(pending.detectedAt);
        this.state.pauseHistory.push({
          id: uid("pause"), reason: "inactive-gap-break", phase: pending.phase,
          startedAt: new Date(Math.max(0, gapEnd - breakPart)).toISOString(), endedAt: pending.detectedAt, durationMs: breakPart,
        });
      }
      if (promptMs > 0) {
        this.state.pauseHistory.push({
          id: uid("pause"), reason: "classification-prompt", phase: pending.phase,
          startedAt: pending.detectedAt, endedAt: resolvedAt, durationMs: promptMs,
        });
      }
      const record: GapClassificationRecord = {
        id: pending.id, phase: pending.phase, source: pending.source,
        detectedAt: pending.detectedAt, resolvedAt, gapMs, classification,
        focusMs: focusPart, breakMs: breakPart, ignoredMs: ignoredPart, promptMs,
      };
      this.state.gapHistory.push(record);
      delete this.state.pendingGap;
      this.state.state = "running";
      this.state.lastTickAt = resolvedAt;
      this.trimHistory();
      return clone(record);
    }
  }
