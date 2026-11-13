  /* ==========================================================================
     ACTIVE RETRIEVAL WORKSPACE · REVIEW UI + DURABLE SESSION STATE MACHINE
     ========================================================================== */

  interface ActiveRetrievalWorkspaceHost {
    requireMutable(reason: string): boolean;
    openPane(pane: "today" | "review"): Promise<void>;
    renderIdleReview(): Promise<void>;
    invalidateAfterCommit(): Promise<void>;
    toast(message: string, error?: boolean): void;
  }

  class ActiveRetrievalWorkspace {
    private activeReviewIds: string[] = [];
    private activeReviewIndex = 0;
    private reviewPhase: ReviewPhase = "attempt";
    private phaseTime: PhaseTimeRuntime | undefined;
    private attemptElapsedMs = 0;
    private reviewDrafts = new Map<string, ReviewDraftSnapshot>();
    private diagramStrokes: DiagramStroke[] = [];
    private activeDiagramStroke: DiagramStroke | null = null;
    private timerHandle = 0;
    private reviewPreviews: SchedulePreview[] = [];
    private activeSessionRevision = 0;
    private commitInFlight = false;

    constructor(
      private readonly service: RevisionService,
      private readonly activePersistence: ActiveRetrievalPersistence,
      private readonly ownership: ReviewOwnershipCoordinator,
      private readonly reviewContent: HTMLDivElement,
      private readonly gapMeta: HTMLDivElement,
      private readonly gapSplit: HTMLDivElement,
      private readonly gapFocusMinutes: HTMLInputElement,
      private readonly gapFocus: OverlayFocusManager,
      private readonly host: ActiveRetrievalWorkspaceHost,
    ) {}

    stopForOwnershipLoss(): void {
      this.stopTimer();
      this.hideGapOverlay();
    }

    forceSaveForLifecycle(source: TimeRuntimeSource): void {
      if (!this.ownership.canMutate()) return;
      this.reconcilePhaseTime(source);
      this.forceActiveRetrievalSave();
    }

    async handleAction(element: HTMLElement): Promise<boolean> {
      const action = element.dataset["action"];
      if (![
        "start-due", "review-one", "review-chunk", "review-unit", "reveal", "begin-verification",
        "check-verification", "diagram-clear", "diagram-undo", "complete-chunk", "rate", "end-session", "toggle-pause",
      ].includes(action ?? "")) return false;
      if (!this.host.requireMutable("change Revision Director data")) return true;

      if (action === "start-due") await this.startDueSession();
      else if (action === "review-one") await this.startObligationSession(element.dataset["id"] ?? "");
      else if (action === "review-chunk") await this.startReviewSession([`chunk:${element.dataset["id"] ?? ""}`]);
      else if (action === "review-unit") await this.startUnitSession(element.dataset["id"] ?? "");
      else if (action === "reveal") {
        const obligationId = this.activeReviewIds[this.activeReviewIndex];
        assert(obligationId, "Review obligation is missing.");
        const obligation = await this.service.obligation(obligationId);
        this.validateAttemptBeforeCompare(obligation);
        assert(this.phaseTime && this.phaseTime.status() === "running", "Resume the retrieval before opening the source.");
        this.phaseTime.reconcile(Date.now(), "snapshot");
        assert(!this.phaseTime.hasPendingGap(), "Classify the inactive gap before opening the source.");
        this.attemptElapsedMs = Math.max(this.attemptElapsedMs, this.closedBookAttemptMs());
        this.phaseTime.transition("compare", "source-reveal", true);
        this.reviewPhase = "compare";
        this.applyReviewPhase();
        this.forceActiveRetrievalSave();
        this.syncComparisonAttempt(obligation);
        this.updateDerivedWorkflowDisplays(obligation);
        this.updateEvidenceSuggestion(obligation);
      } else if (action === "begin-verification") {
        assert((this.reviewContent.querySelector<HTMLTextAreaElement>("#relearn-repair-action")?.value.trim().length ?? 0) >= 3, "Record the repair action.");
        assert(this.reviewContent.querySelector<HTMLInputElement>("#relearn-repair-completed")?.checked, "Complete the repair before verification.");
        assert(this.activeReviewIds[this.activeReviewIndex], "Review obligation is missing.");
        assert(this.phaseTime && this.phaseTime.status() === "running", "Resume the retrieval before beginning verification.");
        this.phaseTime.transition("relearn-verify", "begin-verification", false);
        this.reviewPhase = "relearn-verify";
        this.applyReviewPhase();
        this.forceActiveRetrievalSave();
      } else if (action === "check-verification") {
        assert((this.reviewContent.querySelector<HTMLTextAreaElement>("#relearn-verification-text")?.value.trim().length ?? 0) >= 3, "Complete the closed-book verification.");
        assert(this.reviewContent.querySelector<HTMLInputElement>("#relearn-source-closed")?.checked, "Confirm that the source remained closed during verification.");
        const obligationId = this.activeReviewIds[this.activeReviewIndex];
        assert(obligationId, "Review obligation is missing.");
        const obligation = await this.service.obligation(obligationId);
        assert(this.phaseTime && this.phaseTime.status() === "running", "Resume the retrieval before checking verification.");
        this.phaseTime.reconcile(Date.now(), "snapshot");
        assert(!this.phaseTime.hasPendingGap(), "Classify the inactive gap before checking verification.");
        this.attemptElapsedMs = Math.max(this.attemptElapsedMs, this.closedBookAttemptMs());
        this.phaseTime.transition("compare", "verification-reveal", true);
        this.reviewPhase = "compare";
        this.applyReviewPhase();
        this.forceActiveRetrievalSave();
        this.syncComparisonAttempt(obligation);
        this.updateEvidenceSuggestion(obligation);
      } else if (action === "diagram-clear") {
        this.diagramStrokes = [];
        this.redrawDiagram();
        this.scheduleActiveRetrievalSave();
      } else if (action === "diagram-undo") {
        this.diagramStrokes.pop();
        this.redrawDiagram();
        this.scheduleActiveRetrievalSave();
      } else if (action === "complete-chunk") await this.completeActiveChunk();
      else if (action === "rate") await this.commitRating(validateRating(Number(element.dataset["rating"])));
      else if (action === "end-session") {
        await this.endReviewSession();
        await this.host.openPane("today");
      } else this.togglePause();
      return true;
    }

    private activeReviewTarget(index = this.activeReviewIndex): string {
      const target = this.activeReviewIds[index];
      assert(target, "Review target is missing.");
      return target;
    }

    async updateInputs(target: EventTarget | null): Promise<void> {
      if (!(target instanceof HTMLElement) || !this.reviewContent.contains(target)) return;
      this.scheduleActiveRetrievalSave();
      const obligationId = this.activeReviewIds[this.activeReviewIndex];
      if (!obligationId || obligationId.startsWith("chunk:")) return;
      let obligation: RevisionObligation;
      try { obligation = await this.service.obligation(obligationId); } catch { return; }
      if (target.matches("[data-evidence-input]")) this.updateEvidenceSuggestion(obligation);
      if (target.matches("#answer-text,#questions-attempted,#questions-correct,#questions-partial")) this.updateDerivedWorkflowDisplays(obligation);
    }

    async flushForOwnershipRelease(): Promise<void> {
      if (this.commitInFlight) throw new Error("A review commit is still in progress.");
      if (this.phaseTime) this.reconcilePhaseTime("snapshot");
      const session = this.buildActiveRetrievalSession();
      if (session) {
        this.activePersistence.forceEmergency(session);
        await this.activePersistence.flush(session);
      }
    }

    resetLocalState(): void {
      this.stopTimer();
      this.activeReviewIds = [];
      this.activeReviewIndex = 0;
      this.reviewPhase = "attempt";
      this.reviewDrafts.clear();
      this.diagramStrokes = [];
      this.activeDiagramStroke = null;
      this.phaseTime = undefined;
      this.attemptElapsedMs = 0;
      this.activeSessionRevision = 0;
      this.commitInFlight = false;
      this.hideGapOverlay();
    }

    private phaseLabel(phase: ReviewPhase): string {
      return phase === "attempt" ? "Attempt" : phase === "compare" ? "Compare / correct" : phase === "relearn-repair" ? "Repair" : "Closed-book verification";
    }

    private activeElapsedMs(): number { return this.phaseTime?.activeMs() ?? 0; }

    private closedBookAttemptMs(): number {
      if (!this.phaseTime) return this.attemptElapsedMs;
      return this.reviewPhase === "relearn-repair" || this.reviewPhase === "relearn-verify" || this.phaseTime.currentPhase() === "relearn-verify"
        ? this.phaseTime.phaseActiveMs("relearn-verify")
        : this.phaseTime.phaseActiveMs("attempt");
    }

    private timingSummary(): TimingEvidenceSummary {
      assert(this.phaseTime, "Phase-time runtime is unavailable.");
      this.reconcilePhaseTime("snapshot");
      assert(this.phaseTime.status() === "running", "Resume the retrieval before completing it.");
      assert(!this.phaseTime.hasPendingGap(), "Classify the inactive gap before completing this retrieval.");
      return this.phaseTime.summary();
    }

    private reconcilePhaseTime(source: TimeRuntimeSource): void {
      if (!this.phaseTime || !this.ownership.canMutate()) return;
      const result = this.phaseTime.reconcile(Date.now(), source);
      if (result.gapOpened) this.showGapOverlay();
      this.updateTimerDisplay();
    }

    reconcileAndPersist(source: TimeRuntimeSource): void {
      if (!this.phaseTime || this.commitInFlight) return;
      const before = this.phaseTime.hasPendingGap();
      this.reconcilePhaseTime(source);
      if (!before || this.phaseTime.hasPendingGap()) this.forceActiveRetrievalSave();
    }

    private updateTimerDisplay(): void {
      const timer = this.reviewContent.querySelector<HTMLElement>("#review-timer");
      if (timer) timer.textContent = formatDuration(this.activeElapsedMs());
      const state = this.reviewContent.querySelector<HTMLElement>("#review-time-state");
      if (state) {
        const status = this.phaseTime?.status() ?? "running";
        state.textContent = `${this.phaseLabel(this.reviewPhase)} · ${status === "paused" ? "Paused" : status === "gap-pending" ? "Classify gap" : "Active"}`;
        state.classList.toggle("paused", status !== "running");
      }
      const button = this.reviewContent.querySelector<HTMLButtonElement>('[data-action="toggle-pause"]');
      if (button && this.phaseTime) { button.textContent = this.phaseTime.isPaused() ? "RESUME" : "PAUSE"; button.disabled = this.phaseTime.hasPendingGap(); }
    }

    private reviewTimerMarkup(): string {
      const status = this.phaseTime?.status() ?? "running";
      return `<div class="review-controls"><div class="review-time-cluster"><div class="review-timer" id="review-timer">${formatDuration(this.activeElapsedMs())}</div><span class="review-time-state ${status !== "running" ? "paused" : ""}" id="review-time-state">${escapeHtml(this.phaseLabel(this.reviewPhase))} · ${status === "paused" ? "Paused" : status === "gap-pending" ? "Classify gap" : "Active"}</span></div><button class="mini-btn" data-action="toggle-pause" ${status === "gap-pending" ? "disabled" : ""}>${status === "paused" ? "RESUME" : "PAUSE"}</button></div>`;
    }

    private showGapOverlay(): void {
      const gap = this.phaseTime?.pendingGap();
      if (!gap) return;
      this.gapMeta.textContent = `${formatDuration(gap.gapMs)} · ${this.phaseLabel(gap.phase)} · ${gap.source}`;
      this.gapFocusMinutes.value = String(roundTo(gap.gapMs / 60_000, 1));
      this.gapSplit.hidden = true;
      this.gapFocus.show('[data-gap-action="focus"]', '[data-action="toggle-pause"]');
    }

    private hideGapOverlay(): void { this.gapSplit.hidden = true; this.gapFocus.hide(); }

    async handleGapAction(action: string): Promise<void> {
      if (!this.host.requireMutable("classify an interruption")) return;
      if (!this.phaseTime?.hasPendingGap()) { this.hideGapOverlay(); return; }
      if (action === "split") { this.gapSplit.hidden = false; this.gapFocus.focus("#gap-focus-minutes"); return; }
      const classification = action === "apply-split" ? "split" : literalChoice(action, INACTIVE_GAP_CLASSIFICATIONS, "Inactive-gap action");
      const focusMs = classification === "split" ? Math.max(0, Number(this.gapFocusMinutes.value) || 0) * 60_000 : 0;
      const record = this.phaseTime.resolveGap(classification, focusMs);
      this.hideGapOverlay();
      this.updateTimerDisplay();
      this.forceActiveRetrievalSave();
      this.host.toast(classification === "ignore" ? "Gap ignored. This duration will not train adaptive estimates." : `Gap classified as ${classification}.`);
      if (record.classification === "ignore") this.scheduleActiveRetrievalSave();
    }

    private togglePause(): void {
      assert(this.host.requireMutable("pause or resume retrieval"), "This tab is read-only.");
      assert(this.phaseTime, "No active retrieval timer is available.");
      if (this.phaseTime.isPaused()) this.phaseTime.resume();
      else this.phaseTime.pause();
      this.updateTimerDisplay();
      this.forceActiveRetrievalSave();
    }

    private emptyReviewDraft(phase: ReviewPhase = "attempt"): ReviewDraftSnapshot {
      return { phase, values: {}, checked: {}, diagramStrokes: [], attemptElapsedMs: 0 };
    }

    private snapshotCurrentDraft(): ReviewDraftSnapshot {
      const targetId = this.activeReviewIds[this.activeReviewIndex];
      if (!targetId || !this.reviewContent.querySelector(".review-card")) return this.emptyReviewDraft(this.reviewPhase);
      const values: Record<string, string> = {};
      const checked: Record<string, boolean> = {};
      this.reviewContent.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[id],textarea[id],select[id]").forEach((element) => {
        if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) checked[element.id] = element.checked;
        else values[element.id] = element.value;
      });
      const draft = canonicalReviewDraftSnapshot({ phase: this.reviewPhase, values, checked, diagramStrokes: clone(this.diagramStrokes), attemptElapsedMs: Math.max(this.attemptElapsedMs, this.closedBookAttemptMs()) });
      this.reviewDrafts.set(targetId, draft);
      return draft;
    }

    private buildActiveRetrievalSession(status: ActiveRetrievalStatus = "active", commitToken?: string): ActiveRetrievalSession | undefined {
      const activeTargetId = this.activeReviewIds[this.activeReviewIndex];
      if (!activeTargetId || this.activeReviewIds.length === 0) return undefined;
      if (!this.phaseTime) this.phaseTime = PhaseTimeRuntime.create(this.reviewPhase, false);
      this.reconcilePhaseTime("snapshot");
      const elapsedMs = this.phaseTime.activeMs();
      const revision = this.activeSessionRevision + 1;
      const session: ActiveRetrievalSession = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: ACTIVE_RETRIEVAL_ID,
        revision,
        status,
        queueTargetIds: [...this.activeReviewIds],
        activeIndex: this.activeReviewIndex,
        activeTargetId,
        phase: this.reviewPhase,
        draft: this.snapshotCurrentDraft(),
        timeRuntime: this.phaseTime.snapshot(),
        elapsedMs,
        startedAt: this.phaseTime.snapshot().sessionStartedAt,
        updatedAt: nowIso(),
        ...(commitToken ? { commitToken } : {}),
      };
      this.activeSessionRevision = revision;
      return canonicalActiveRetrievalSession(session);
    }

    private async initialPhaseForTarget(targetId: string): Promise<ReviewPhase> {
      if (targetId.startsWith("chunk:")) return "attempt";
      try { return (await this.service.obligation(targetId)).workflow.kind === "relearning" ? "relearn-repair" : "attempt"; }
      catch { return "attempt"; }
    }

    private async initialSourceVisibleForTarget(targetId: string, phase: ReviewPhase): Promise<boolean> {
      if (targetId.startsWith("chunk:")) return true;
      if (phase === "relearn-repair") return true;
      return false;
    }

    private async postCommitSession(commitToken: string): Promise<ActiveRetrievalSession> {
      const nextIndex = this.activeReviewIndex + 1;
      const nextTarget = this.activeReviewIds[nextIndex];
      const revision = this.activeSessionRevision + 1;
      if (!nextTarget) {
        const runtime = PhaseTimeRuntime.create("attempt", false);
        return canonicalActiveRetrievalSession({ schemaVersion: DOCUMENT_SCHEMA_VERSION, id: ACTIVE_RETRIEVAL_ID, revision, status: "completed", queueTargetIds: [...this.activeReviewIds], activeIndex: this.activeReviewIds.length, activeTargetId: "", phase: "attempt", draft: this.emptyReviewDraft(), timeRuntime: runtime.snapshot(), elapsedMs: 0, startedAt: runtime.snapshot().sessionStartedAt, updatedAt: nowIso(), commitToken });
      }
      const phase = await this.initialPhaseForTarget(nextTarget);
      const runtime = PhaseTimeRuntime.create(phase, await this.initialSourceVisibleForTarget(nextTarget, phase));
      return canonicalActiveRetrievalSession({ schemaVersion: DOCUMENT_SCHEMA_VERSION, id: ACTIVE_RETRIEVAL_ID, revision, status: "active", queueTargetIds: [...this.activeReviewIds], activeIndex: nextIndex, activeTargetId: nextTarget, phase, draft: this.emptyReviewDraft(phase), timeRuntime: runtime.snapshot(), elapsedMs: 0, startedAt: runtime.snapshot().sessionStartedAt, updatedAt: nowIso() });
    }

    private scheduleActiveRetrievalSave(): void {
      if (this.commitInFlight || !this.ownership.canMutate()) return;
      const session = this.buildActiveRetrievalSession();
      if (session) this.activePersistence.schedule(session);
    }

    private forceActiveRetrievalSave(): void {
      if (this.commitInFlight || !this.ownership.canMutate()) return;
      const session = this.buildActiveRetrievalSession();
      if (!session) return;
      this.activePersistence.forceEmergency(session);
      void this.activePersistence.flush(session).catch(() => undefined);
    }

    async recoverUnfinishedSession(askBeforeResume = true): Promise<void> {
      const loaded = await this.activePersistence.load();
      const recovered = loaded.session;
      if (!recovered) return;
      let valid = true;
      try {
        if (recovered.activeTargetId.startsWith("chunk:")) await this.service.chunk(recovered.activeTargetId.slice(6));
        else await this.service.obligation(recovered.activeTargetId);
      } catch { valid = false; }
      if (!valid) { await this.activePersistence.clear(); return; }
      if (askBeforeResume && !window.confirm("An unfinished retrieval session was found. Resume it?")) { await this.activePersistence.clear(); return; }
      this.activeReviewIds = [...recovered.queueTargetIds];
      this.activeReviewIndex = recovered.activeIndex;
      this.reviewPhase = recovered.phase;
      this.reviewDrafts.clear();
      this.reviewDrafts.set(recovered.activeTargetId, clone(recovered.draft));
      this.diagramStrokes = clone(recovered.draft.diagramStrokes);
      this.attemptElapsedMs = recovered.draft.attemptElapsedMs;
      this.phaseTime = new PhaseTimeRuntime(recovered.timeRuntime);
      this.phaseTime.reconcile(Date.now(), "recovery");
      this.activeSessionRevision = recovered.revision;
      this.commitInFlight = false;
      if (recovered.status === "committing") {
        const resumed = this.buildActiveRetrievalSession("active");
        if (resumed) await this.activePersistence.flush(resumed);
      }
      await this.host.openPane("review");
      if (this.phaseTime.hasPendingGap()) this.showGapOverlay();
      this.host.toast(askBeforeResume ? "Unfinished retrieval session recovered." : "Canonical retrieval state hydrated after ownership transfer.");
    }

    private async renderChunkReview(chunkId: string): Promise<void> {
      const chunk = await this.service.chunk(chunkId);
      const obligation = await this.service.obligation(chunk.obligationId);
      const unit = await this.service.unit(obligation.unitId);
      const path = await this.service.hierarchyPath(unit.topicNodeId);
      const profile = await this.service.profile(unit.profileId);
      const progress = `${this.activeReviewIndex + 1} / ${this.activeReviewIds.length}`;
      this.reviewContent.innerHTML = `<div class="review-shell">
        <div class="review-topline"><button class="mini-btn" data-action="end-session">END SESSION</button><div class="review-top-meta"><span class="chip">${progress}</span><span class="chip workflow-chip">Split execution</span></div></div>
        <article class="review-card chunk-review-card">
          <div class="breadcrumb">${escapeHtml(profile.name)} · ${escapeHtml(path.subject)} › ${escapeHtml(path.section)} › ${escapeHtml(path.topic)}</div>
          <div class="review-badges"><span class="chip capacity-exception">chunk ${chunk.ordinal}/${chunk.total}</span><span class="chip">${chunk.expectedMinutes}m planned</span></div>
          <h1>${escapeHtml(chunk.label)}</h1>
          <div class="review-protocol"><strong>Scope for this session</strong><p>${escapeHtml(chunk.scope)}</p></div>
          <div class="policy-box"><strong>Scheduling safeguard:</strong> completing this chunk records execution only. The parent obligation is not rescheduled until all chunks are complete and you perform the final synthesis retrieval.</div>
          <section class="workflow-panel"><div class="workflow-head"><div><span>FOCUSED CHUNK</span><h2>Work through this bounded scope</h2></div><p>Use the parent protocol within this scope. Stop when the chunk is meaningfully complete.</p></div>
            <div class="source-panel"><strong>Parent protocol</strong><p>${escapeHtml(obligation.protocol)}</p><strong>Source</strong><p>${escapeHtml(unit.source || unit.scope)}</p></div>
            <label>Session note<textarea id="chunk-note" rows="5" placeholder="Optional: record the stopping point, unresolved issue or handoff to the next chunk."></textarea></label>
            <button class="btn primary wide-action" data-action="complete-chunk">COMPLETE CHUNK</button>
          </section>
          ${this.reviewTimerMarkup()}
        </article>
      </div>`;
      this.restoreReviewDraft(`chunk:${chunkId}`);
      this.startTimer();
    }

    async render(): Promise<void> {
      if (this.activeReviewIds.length === 0 || this.activeReviewIndex >= this.activeReviewIds.length) {
        this.stopTimer();
        await this.host.renderIdleReview();
        return;
      }

      const obligationId = this.activeReviewTarget();
      if (obligationId.startsWith("chunk:")) {
        await this.renderChunkReview(obligationId.slice(6));
        return;
      }
      let obligation: RevisionObligation;
      let unit: KnowledgeUnit;
      try {
        obligation = await this.service.obligation(obligationId);
        unit = await this.service.unit(obligation.unitId);
      } catch {
        this.activeReviewIndex += 1;
        await this.render();
        return;
      }
      validateWorkflowSpec(obligation.workflow, obligation.type);
      const existingDraft = this.reviewDrafts.get(obligationId);
      if (existingDraft) this.reviewPhase = existingDraft.phase;
      else this.reviewPhase = obligation.workflow.kind === "relearning" ? "relearn-repair" : "attempt";
      const path = await this.service.hierarchyPath(unit.topicNodeId);
      const profile = await this.service.profile(unit.profileId);
      this.reviewPreviews = await this.service.preview(obligation.id);
      const memoryReviews = obligation.type === "memory-recall"
        ? await this.service.memoryReviewHistory(obligation.id)
        : [];
      const progress = `${this.activeReviewIndex + 1} / ${this.activeReviewIds.length}`;
      const checkpoints = obligation.workflow.checkpoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      const sourcePanel = `<div class="source-panel"><strong>Source and scope</strong><p>${escapeHtml(unit.source || "No source recorded.")}</p><p>${escapeHtml(unit.scope)}</p><strong>Success criteria</strong><p>${escapeHtml(obligation.successCriteria)}</p><strong>Observable checkpoints</strong><ol class="checkpoint-reference">${checkpoints}</ol></div>`;
      const triggeringEvidence = obligation.type === "relearn" ? await this.service.triggeringEvidence(obligation.id) : undefined;
      const triggerPanel = obligation.type === "relearn" ? this.relearningTriggerPanel(triggeringEvidence) : "";
      this.reviewContent.innerHTML = `<div class="review-shell">
        <div class="review-topline"><button class="mini-btn" data-action="end-session">END SESSION</button><div class="review-top-meta"><span class="chip">${progress}</span><span class="chip workflow-chip">${escapeHtml(workflowLabel(obligation.workflow.kind))}</span></div></div>
        <article class="review-card">
          <div class="breadcrumb">${escapeHtml(profile.name)} · ${escapeHtml(path.subject)} › ${escapeHtml(path.section)} › ${escapeHtml(path.topic)}</div>
          <div class="review-badges"><span class="chip ${obligationChip(obligation.type)}">${escapeHtml(obligationLabel(obligation.type))}</span><span class="chip">${escapeHtml(responseMediumLabel(obligation.workflow.responseMedium))}</span></div>
          <h1>${escapeHtml(unit.title)}</h1>
          <div class="review-protocol"><strong>Retrieval task</strong><p>${escapeHtml(obligation.workflow.prompt)}</p></div>

          <section data-review-phase="attempt">${this.workflowAttemptPanel(obligation)}</section>

          <section data-review-phase="relearn-repair" hidden>
            ${triggerPanel}
            ${sourcePanel}
            <div class="workflow-panel relearn-panel"><div class="workflow-head"><div><span>STAGE 1</span><h2>Diagnose and repair</h2></div><p>Use the source deliberately. Do not rate the original failure again.</p></div>
              <label>Primary failure diagnosis<select id="relearn-diagnosis">${[...ERROR_TYPES].map((type) => `<option value="${type}">${escapeHtml(errorLabel(type))}</option>`).join("")}</select></label>
              <label>Repair action<textarea id="relearn-repair-action" rows="5" placeholder="What was misunderstood, and what did you do to repair it?"></textarea></label>
              <label class="check-option strong-check"><input id="relearn-repair-completed" type="checkbox">I completed the repair using the source.</label>
              <button class="btn primary wide-action" data-action="begin-verification">BEGIN CLOSED-BOOK VERIFICATION</button>
            </div>
          </section>

          <section data-review-phase="relearn-verify" hidden>
            <div class="workflow-panel"><div class="workflow-head"><div><span>STAGE 2</span><h2>Verify with the source closed</h2></div><p>Close the source physically before responding.</p></div>
              <div class="prompt-callout">${escapeHtml(obligation.workflow.prompt)}</div>
              <label>Closed-book verification<textarea id="relearn-verification-text" rows="8" placeholder="Explain the corrected concept or complete the required retrieval."></textarea></label>
              <label class="check-option strong-check"><input id="relearn-source-closed" type="checkbox">The source remained closed during verification.</label>
              <button class="btn primary wide-action" data-action="check-verification">CHECK VERIFICATION</button>
            </div>
          </section>

          <section data-review-phase="compare" hidden>
            <div class="comparison-grid">${this.attemptComparisonPanel(obligation)}${sourcePanel}</div>
            ${this.workflowAssessmentPanel(obligation, memoryReviews)}
          </section>

          ${this.reviewTimerMarkup()}
        </article>
      </div>`;
      this.restoreReviewDraft(obligationId);
      this.applyReviewPhase();
      this.initializeDiagramCanvas(obligation);
      this.startTimer();
      if (this.reviewPhase === "compare") {
        this.syncComparisonAttempt(obligation);
        this.updateEvidenceSuggestion(obligation);
      }
    }

    private attemptComparisonPanel(obligation: RevisionObligation): string {
      const spec = obligation.workflow;
      let content = "";
      if (spec.kind === "recall" || spec.kind === "reconstruction") {
        content = spec.responseMedium === "in-app"
          ? `<pre id="comparison-attempt-text" class="comparison-text"></pre>`
          : `<p class="external-attempt-note">Attempt completed in the ${escapeHtml(responseMediumLabel(spec.responseMedium).toLowerCase())}. Keep it visible while checking the source.</p>`;
      } else if (spec.kind === "questions") {
        content = `<div class="question-set-banner compact"><span>QUESTION SET</span><strong>${escapeHtml(spec.questionSetRef ?? "External question set")}</strong></div><pre id="comparison-attempt-text" class="comparison-text"></pre>`;
      } else if (spec.kind === "diagram") {
        content = spec.diagramSurface === "canvas"
          ? `<canvas id="comparison-diagram-canvas" class="diagram-canvas comparison-diagram" aria-label="Original diagram attempt"></canvas>`
          : `<p class="external-attempt-note">Keep the paper diagram beside the reference and compare labels, spatial form and process direction.</p>`;
      } else if (spec.kind === "answer-writing") {
        content = spec.responseMedium === "in-app"
          ? `<pre id="comparison-attempt-text" class="comparison-text answer-comparison"></pre>`
          : `<p class="external-attempt-note">Keep the written answer beside the rubric. The app records attempt time automatically.</p>`;
      } else {
        content = `<pre id="comparison-attempt-text" class="comparison-text"></pre>`;
      }
      return `<section class="attempt-comparison-panel"><div class="comparison-panel-head"><span>ORIGINAL ATTEMPT</span><strong>Compare without rewriting history</strong></div>${content}</section>`;
    }

    private relearningTriggerPanel(event?: EvidenceEvent): string {
      if (!event) return `<section class="trigger-evidence missing"><strong>Triggering failure unavailable</strong><p>The original failed evidence could not be found. Continue only after identifying the weakness manually.</p></section>`;
      const errors = event.evidence.errorTypes.length ? event.evidence.errorTypes.map((type) => errorLabel(type)).join(" · ") : "No error type recorded";
      const attempt = this.workflowAttemptExcerpt(event.workflowResult);
      return `<section class="trigger-evidence"><div class="comparison-panel-head"><span>WHY THIS RELEARNING EXISTS</span><strong>${escapeHtml(ratingName(event.confirmedRating))} · ${formatDateTime(event.reviewedAt)}</strong></div><div class="trigger-metrics"><span>Completeness ${event.evidence.completeness}/4</span><span>Independence ${event.evidence.independence}/4</span><span>Application ${event.evidence.application}/4</span></div><p><strong>Errors:</strong> ${escapeHtml(errors)}</p>${event.evidence.correctionNote ? `<p><strong>Correction recorded:</strong> ${escapeHtml(event.evidence.correctionNote)}</p>` : ""}${attempt ? `<details><summary>Show the failed attempt</summary><pre class="comparison-text">${escapeHtml(attempt)}</pre></details>` : ""}</section>`;
    }

    private workflowAttemptExcerpt(result: WorkflowResult): string {
      if (result.kind === "recall" || result.kind === "reconstruction") return result.attemptText;
      if (result.kind === "questions") return [result.questionSetRef, result.attemptNotes, result.errorSummary].filter(Boolean).join("\n\n");
      if (result.kind === "diagram") return result.notes;
      if (result.kind === "answer-writing") return result.answerText;
      return result.verificationText;
    }

    private syncComparisonAttempt(obligation: RevisionObligation): void {
      const spec = obligation.workflow;
      const target = this.reviewContent.querySelector<HTMLElement>("#comparison-attempt-text");
      if (target) {
        let value = "";
        if (spec.kind === "answer-writing") value = this.reviewContent.querySelector<HTMLTextAreaElement>("#answer-text")?.value.trim() ?? "";
        else if (spec.kind === "relearning") value = this.reviewContent.querySelector<HTMLTextAreaElement>("#relearn-verification-text")?.value.trim() ?? "";
        else value = this.reviewContent.querySelector<HTMLTextAreaElement>("#attempt-text")?.value.trim() ?? "";
        target.textContent = value || "No in-app text was recorded; compare the external attempt directly.";
      }
      if (spec.kind === "diagram" && spec.diagramSurface === "canvas") {
        const canvas = this.reviewContent.querySelector<HTMLCanvasElement>("#comparison-diagram-canvas");
        if (canvas) { this.resizeDiagramCanvas(canvas); this.redrawDiagram(canvas); }
      }
      this.updateDerivedWorkflowDisplays(obligation);
    }

    private workflowAttemptPanel(obligation: RevisionObligation): string {
      const spec = obligation.workflow;
      const mediumCompletion = spec.responseMedium === "in-app" ? "" : `<label class="check-option strong-check"><input id="attempt-completed" type="checkbox">I completed the attempt ${spec.responseMedium === "oral" ? "aloud" : "outside the app"} before checking.</label>`;
      if (spec.kind === "recall") {
        return `<div class="workflow-panel"><div class="workflow-head"><div><span>RECALL</span><h2>Retrieve before recognition</h2></div><p>Generate the answer; do not merely judge familiarity.</p></div>${spec.responseMedium === "in-app" ? `<label>Closed-book recall<textarea id="attempt-text" rows="10" placeholder="Write the recalled structure, facts or explanation here."></textarea></label>` : mediumCompletion}<button class="btn primary wide-action" data-action="reveal">OPEN SOURCE & ASSESS</button></div>`;
      }
      if (spec.kind === "reconstruction") {
        return `<div class="workflow-panel"><div class="workflow-head"><div><span>RECONSTRUCTION · ${escapeHtml(spec.reconstructionShape ?? "outline")}</span><h2>Rebuild the structure</h2></div><p>Relations, sequence and organisation matter—not only isolated facts.</p></div>${spec.responseMedium === "in-app" ? `<label>Reconstruction workspace<textarea id="attempt-text" rows="12" placeholder="Rebuild the ${escapeHtml(spec.reconstructionShape ?? "structure")} from memory."></textarea></label>` : mediumCompletion}<button class="btn primary wide-action" data-action="reveal">OPEN SOURCE & ASSESS</button></div>`;
      }
      if (spec.kind === "questions") {
        return `<div class="workflow-panel"><div class="workflow-head"><div><span>APPLICATION · TARGET ${spec.targetCount ?? 1}</span><h2>Attempt questions before checking</h2></div><p>Use questions that require discrimination or transfer where possible.</p></div><div class="question-set-banner"><span>QUESTION SET</span><strong>${escapeHtml(spec.questionSetRef ?? "External question set")}</strong></div><label>Working / answer notes<textarea id="attempt-text" rows="9" placeholder="Optional reasoning, uncertain options or answer summaries."></textarea></label><label class="check-option strong-check"><input id="attempt-completed" type="checkbox">I attempted the questions before checking answers.</label><button class="btn primary wide-action" data-action="reveal">CHECK ANSWERS & ASSESS</button></div>`;
      }
      if (spec.kind === "diagram") {
        const workspace = spec.diagramSurface === "canvas" ? `<div class="diagram-tools"><button class="mini-btn" data-action="diagram-undo">UNDO STROKE</button><button class="mini-btn" data-action="diagram-clear">CLEAR</button></div><canvas id="diagram-canvas" class="diagram-canvas" aria-label="Diagram drawing canvas"></canvas>` : `<label class="check-option strong-check"><input id="attempt-completed" type="checkbox">I completed the diagram on paper before checking.</label>`;
        return `<div class="workflow-panel"><div class="workflow-head"><div><span>DIAGRAM PRACTICE</span><h2>Draw from memory</h2></div><p>Include structure, spatial relationships, labels and process direction where relevant.</p></div>${workspace}<button class="btn primary wide-action" data-action="reveal">OPEN REFERENCE & ASSESS</button></div>`;
      }
      if (spec.kind === "answer-writing") {
        const meta = `<div class="attempt-constraints"><span>${escapeHtml(spec.answerMode === "outline" ? "Answer skeleton" : "Full answer")}</span><span>${spec.timeLimitMinutes ?? obligation.expectedMinutes} minutes</span><span>${spec.wordLimit ?? 150} words</span></div>`;
        return `<div class="workflow-panel"><div class="workflow-head"><div><span>ANSWER WRITING</span><h2>Perform under exam constraints</h2></div><p>Address the command and demand, not merely the topic.</p></div>${meta}${spec.responseMedium === "in-app" ? `<label>Answer workspace<textarea id="answer-text" rows="16" placeholder="Write the answer or skeleton here."></textarea></label><div class="live-count"><span>Words</span><strong id="answer-live-count">0</strong></div>` : mediumCompletion}<button class="btn primary wide-action" data-action="reveal">OPEN SOURCE / RUBRIC & ASSESS</button></div>`;
      }
      return "";
    }

    private workflowAssessmentPanel(obligation: RevisionObligation, memoryReviews: readonly MemoryReviewObservation[] = []): string {
      const spec = obligation.workflow;
      const checkpoints = this.checkpointAssessment(spec.checkpoints);
      let specific = "";
      if (spec.kind === "recall") {
        specific = `${checkpoints}${this.cueLevelField()}<div class="attempt-preserved"><strong>Your attempt remains above or in your external workspace.</strong></div>`;
      } else if (spec.kind === "reconstruction") {
        specific = `${checkpoints}<div class="evidence-grid">${this.rubric("Structural accuracy", "structural-accuracy", "Was the overall organisation correct?")}${this.rubric("Relationship accuracy", "relationship-accuracy", "Were links, order and causation correct?")}</div>${this.cueLevelField()}`;
      } else if (spec.kind === "questions") {
        const target = spec.targetCount ?? 1;
        specific = `<div class="question-results"><label>Target<input id="questions-target" type="number" value="${target}" readonly></label><label>Attempted<input id="questions-attempted" data-evidence-input type="number" min="1" max="500" value="${target}"></label><label>Correct<input id="questions-correct" data-evidence-input type="number" min="0" max="500" value="0"></label><label>Partially correct<input id="questions-partial" data-evidence-input type="number" min="0" max="500" value="0"></label><label>Incorrect<output id="questions-incorrect-output">${target}</output></label><label>Novel / transfer questions<input id="questions-novel" data-evidence-input type="number" min="0" max="500" value="0"></label></div><label>Per-question error summary<textarea id="questions-error-summary" data-evidence-input rows="4" placeholder="Optional: Q3—confused mechanism; Q7—missed qualifier; Q9—guessed correctly..."></textarea></label>${this.cueLevelField()}`;
      } else if (spec.kind === "diagram") {
        specific = `${checkpoints}<label class="check-option strong-check"><input id="diagram-attempt-completed" data-evidence-input type="checkbox" checked>I completed a diagram before seeing the reference.</label><div class="evidence-grid">${this.rubric("Labels", "diagram-labels", "Correct, complete and placed appropriately")}${this.rubric("Spatial form", "diagram-spatial", "Shape and relationships match the concept")}${this.rubric("Process / direction", "diagram-process", "Arrows, stages or sequence are accurate")}</div>${this.cueLevelField()}<label>Diagram notes<textarea id="diagram-notes" data-evidence-input rows="3" placeholder="What was missing or distorted?"></textarea></label>`;
      } else if (spec.kind === "answer-writing") {
        specific = `<div class="evidence-grid answer-rubrics">${this.rubric("Demand addressed", "answer-demand", "Directly answers the command and exact demand")}${this.rubric("Structure", "answer-structure-score", "Coherent introduction, body and conclusion")}${this.rubric("Content accuracy", "answer-content", "Accurate, relevant and sufficiently deep")}${this.rubric("Examples / evidence", "answer-examples", "Uses examples, data, diagrams or authorities appropriately")}${this.rubric("Conclusion", "answer-conclusion", "Closes the argument rather than stopping abruptly")}</div><div class="answer-metrics"><label>Word count<input id="answer-word-count" data-evidence-input type="number" min="0" max="10000" value="0"></label><div class="auto-time-metric"><span>Automatic attempt timing</span><strong id="answer-attempt-time">—</strong><small id="answer-time-status">Measured when the source was opened.</small></div></div>${this.cueLevelField()}`;
      } else {
        specific = `${checkpoints}<label class="check-option strong-check"><input id="relearn-assessment-source-closed" data-evidence-input type="checkbox" checked>Verification was completed with the source closed.</label>`;
      }
      const ratingGuidance = obligation.type === "memory-recall"
        ? `<div class="policy-box"><strong>FSRS rating:</strong> Again = failed recall; Hard = partial or cued recall; Good = complete independent recall; choose Easy only when recall was unusually effortless.</div>`
        : "";
      const difficultyGuidance = obligation.type === "memory-recall"
        ? (() => {
            const assessment = memoryDifficultyAssessment(obligation, this.service.getSettings().memoryDifficultyPolicy, memoryReviews);
            if (assessment.level === "normal") return "";
            const label = assessment.level === "persistent-difficulty" ? "Persistent difficulty" : assessment.level === "remediation" ? "Remediation" : "Early learning difficulty";
            const burden = assessment.level === "learning-difficulty"
              ? `${assessment.earlyLearningFailures} failed learning recalls`
              : `${assessment.establishedLapses} established recall failures`;
            return `<div class="policy-box"><strong>${label}:</strong> ${burden} · ${escapeHtml(assessment.recommendedActions.map(memoryDifficultyActionLabel).join(" · "))}.</div>`;
          })()
        : "";
      return `<section class="evidence-panel"><div class="workflow-head"><div><span>COMPARE & RECORD</span><h2>${escapeHtml(workflowLabel(spec.kind))} evidence</h2></div><p>The app converts modality-specific results into a common evidence record.</p></div>${specific}${this.commonEvidenceFields()}${difficultyGuidance}<div class="suggested-rating"><span>Evidence-based suggestion</span><strong id="suggested-rating">Complete the assessment</strong></div>${ratingGuidance}<div class="rating-grid">${this.reviewPreviews.map((preview) => `<button class="rating-btn ${ratingName(preview.rating).toLowerCase()}" data-action="rate" data-rating="${preview.rating}"><strong>${ratingName(preview.rating)}</strong><span>${escapeHtml(preview.label)}</span></button>`).join("")}</div><div class="policy-box"><strong>Policy:</strong> ${escapeHtml(obligation.policyState.engine)}. The workflow produces evidence; the policy determines the next obligation date.</div></section>`;
    }

    private checkpointAssessment(checkpoints: string[]): string {
      return `<fieldset class="checkpoint-assessment"><legend>Checkpoints retrieved correctly</legend><div class="checkpoint-list">${checkpoints.map((item, index) => `<label class="check-option"><input id="checkpoint-${index}" data-checkpoint data-evidence-input type="checkbox">${escapeHtml(item)}</label>`).join("")}</div></fieldset>`;
    }

    private cueLevelField(): string {
      return `<label>Cueing used<select id="cue-level" data-evidence-input><option value="none">None</option><option value="minor">Minor cue</option><option value="major">Major cue</option><option value="source">Source consulted during attempt</option></select></label>`;
    }

    private commonEvidenceFields(): string {
      const errors: ErrorType[] = ["factual-omission", "conceptual-misunderstanding", "confusion-interference", "application-failure", "answer-structure", "diagram-reconstruction", "slow-retrieval"];
      return `<div class="evidence-form"><label class="wide">Correction note<textarea id="correction-note" data-evidence-input rows="3" placeholder="What must be repaired before the next review?"></textarea></label><fieldset class="wide"><legend>Error types</legend><div class="check-grid">${errors.map((type) => `<label class="check-option"><input id="error-${type}" data-error-type data-evidence-input type="checkbox" value="${type}">${escapeHtml(errorLabel(type))}</label>`).join("")}</div></fieldset></div>`;
    }

    private rubric(title: string, id: string, help: string): string {
      return `<div class="rubric"><label><span>${escapeHtml(title)}</span><output id="${id}-output">2 / 4</output></label><input id="${id}" data-rubric data-evidence-input type="range" min="0" max="4" step="1" value="2"><p class="helper">${escapeHtml(help)}</p></div>`;
    }

    private applyReviewPhase(): void {
      this.reviewContent.querySelectorAll<HTMLElement>("[data-review-phase]").forEach((section) => { section.hidden = section.dataset["reviewPhase"] !== this.reviewPhase; });
    }

    private validateAttemptBeforeCompare(obligation: RevisionObligation): void {
      const spec = obligation.workflow;
      if (spec.kind === "diagram") {
        const completed = this.reviewContent.querySelector<HTMLInputElement>("#attempt-completed")?.checked ?? this.diagramStrokes.length > 0;
        assert(completed, "Complete the diagram before opening the reference.");
        return;
      }
      if (spec.kind === "questions") {
        assert(this.reviewContent.querySelector<HTMLInputElement>("#attempt-completed")?.checked, "Confirm that the questions were attempted before checking.");
        return;
      }
      if (spec.responseMedium === "in-app") {
        const id = spec.kind === "answer-writing" ? "#answer-text" : "#attempt-text";
        assert((this.reviewContent.querySelector<HTMLTextAreaElement>(id)?.value.trim().length ?? 0) >= 3, "Complete a genuine retrieval attempt before checking.");
      } else {
        assert(this.reviewContent.querySelector<HTMLInputElement>("#attempt-completed")?.checked, "Confirm that the external or oral attempt was completed.");
      }
    }

    private collectWorkflowResult(obligation: RevisionObligation): WorkflowResult {
      const spec = obligation.workflow;
      const text = (selector: string) => this.reviewContent.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value.trim() ?? "";
      const number = (selector: string, fallback = 0) => Number(this.reviewContent.querySelector<HTMLInputElement>(selector)?.value ?? fallback);
      const checked = (selector: string) => this.reviewContent.querySelector<HTMLInputElement>(selector)?.checked ?? false;
      const checkpoints = [...this.reviewContent.querySelectorAll<HTMLInputElement>("[data-checkpoint]")];
      const checkpointTotal = Math.max(1, spec.checkpoints.length);
      const checkpointsMet = checkpoints.filter((input) => input.checked).length;
      const cueLevel = literalChoice(this.reviewContent.querySelector<HTMLSelectElement>("#cue-level")?.value ?? "none", CUE_LEVELS, "Cue level");
      let result: WorkflowResult;
      if (spec.kind === "recall") {
        result = { kind: "recall", responseMedium: spec.responseMedium, attemptText: text("#attempt-text"), checkpointTotal, checkpointsMet, cueLevel };
      } else if (spec.kind === "reconstruction") {
        result = { kind: "reconstruction", responseMedium: spec.responseMedium, attemptText: text("#attempt-text"), shape: spec.reconstructionShape ?? "outline", checkpointTotal, checkpointsMet, structuralAccuracy: literalChoice(number("#structural-accuracy", 2), RUBRIC_SCORES, "Structural accuracy"), relationshipAccuracy: literalChoice(number("#relationship-accuracy", 2), RUBRIC_SCORES, "Relationship accuracy"), cueLevel };
      } else if (spec.kind === "questions") {
        const attempted = number("#questions-attempted", spec.targetCount ?? 1);
        const correct = number("#questions-correct");
        const partial = number("#questions-partial");
        result = { kind: "questions", targetCount: spec.targetCount ?? 1, attempted, correct, partial, incorrect: attempted - correct - partial, novelCount: number("#questions-novel"), cueLevel, questionSetRef: spec.questionSetRef ?? "External question set", attemptNotes: text("#attempt-text"), errorSummary: text("#questions-error-summary") };
      } else if (spec.kind === "diagram") {
        result = { kind: "diagram", surface: spec.diagramSurface ?? "canvas", checkpointTotal, checkpointsMet, labelAccuracy: literalChoice(number("#diagram-labels", 2), RUBRIC_SCORES, "Diagram label accuracy"), spatialAccuracy: literalChoice(number("#diagram-spatial", 2), RUBRIC_SCORES, "Diagram spatial accuracy"), processAccuracy: literalChoice(number("#diagram-process", 2), RUBRIC_SCORES, "Diagram process accuracy"), cueLevel, attemptCompleted: checked("#diagram-attempt-completed"), notes: text("#diagram-notes") };
      } else if (spec.kind === "answer-writing") {
        const timeLimitMinutes = spec.timeLimitMinutes ?? obligation.expectedMinutes;
        const attemptElapsedMs = Math.max(this.attemptElapsedMs, this.closedBookAttemptMs());
        result = { kind: "answer-writing", mode: spec.answerMode ?? "full-answer", responseMedium: spec.responseMedium, answerText: text("#answer-text"), demandAddressed: literalChoice(number("#answer-demand", 2), RUBRIC_SCORES, "Answer demand score"), structure: literalChoice(number("#answer-structure-score", 2), RUBRIC_SCORES, "Answer structure score"), contentAccuracy: literalChoice(number("#answer-content", 2), RUBRIC_SCORES, "Answer content score"), examplesEvidence: literalChoice(number("#answer-examples", 2), RUBRIC_SCORES, "Answer examples score"), conclusion: literalChoice(number("#answer-conclusion", 2), RUBRIC_SCORES, "Answer conclusion score"), completedWithinTime: attemptElapsedMs <= timeLimitMinutes * 60_000, attemptElapsedMs, timeLimitMinutes, wordCount: number("#answer-word-count"), wordLimit: spec.wordLimit ?? 150, cueLevel };
      } else {
        result = { kind: "relearning", diagnosis: literalChoice(this.reviewContent.querySelector<HTMLSelectElement>("#relearn-diagnosis")?.value ?? "conceptual-misunderstanding", ERROR_TYPE_VALUES, "Relearning diagnosis"), repairAction: text("#relearn-repair-action"), verificationText: text("#relearn-verification-text"), checkpointTotal, checkpointsMet, sourceClosedForVerification: checked("#relearn-source-closed") && checked("#relearn-assessment-source-closed"), repairCompleted: checked("#relearn-repair-completed") };
      }
      validateWorkflowResult(result, spec.kind);
      return result;
    }

    private collectEvidence(rating: Rating, obligation: RevisionObligation): EvidenceDraft {
      assert(this.reviewPhase === "compare", "Complete the retrieval and comparison before rating.");
      const workflowResult = this.collectWorkflowResult(obligation);
      const errors = [...this.reviewContent.querySelectorAll<HTMLInputElement>("[data-error-type]:checked")].map((input) => literalChoice(input.value, ERROR_TYPE_VALUES, "Error type"));
      const correctionNote = this.reviewContent.querySelector<HTMLTextAreaElement>("#correction-note")?.value.trim() ?? "";
      const normalized = workflowEvidence(workflowResult, errors, correctionNote);
      const timing = this.timingSummary();
      return { ...normalized, workflowResult, elapsedMs: timing.totalActiveMs, timing, confirmedRating: rating };
    }

    private updateEvidenceSuggestion(obligation: RevisionObligation): void {
      this.updateDerivedWorkflowDisplays(obligation);
      for (const input of this.reviewContent.querySelectorAll<HTMLInputElement>("[data-rubric]")) {
        const output = this.reviewContent.querySelector<HTMLOutputElement>(`#${input.id}-output`);
        if (output) output.textContent = `${input.value} / 4`;
      }
      const target = this.reviewContent.querySelector<HTMLElement>("#suggested-rating");
      if (!target) return;
      try {
        const result = this.collectWorkflowResult(obligation);
        const errors = [...this.reviewContent.querySelectorAll<HTMLInputElement>("[data-error-type]:checked")].map((input) => literalChoice(input.value, ERROR_TYPE_VALUES, "Error type"));
        const evidence = workflowEvidence(result, errors, this.reviewContent.querySelector<HTMLTextAreaElement>("#correction-note")?.value ?? "");
        const suggested = suggestRating(obligation.type, evidence);
        target.textContent = `${ratingName(suggested)} · score ${roundTo(objectiveScore(obligation.type, evidence), 1)}/4`;
      } catch (error) {
        target.textContent = error instanceof Error ? error.message : "Complete the assessment";
      }
    }

    private updateDerivedWorkflowDisplays(obligation: RevisionObligation): void {
      if (obligation.workflow.kind === "questions") {
        const attempted = Number(this.reviewContent.querySelector<HTMLInputElement>("#questions-attempted")?.value ?? 0);
        const correct = Number(this.reviewContent.querySelector<HTMLInputElement>("#questions-correct")?.value ?? 0);
        const partial = Number(this.reviewContent.querySelector<HTMLInputElement>("#questions-partial")?.value ?? 0);
        const output = this.reviewContent.querySelector<HTMLOutputElement>("#questions-incorrect-output");
        if (output) output.textContent = String(Math.max(0, attempted - correct - partial));
      }
      if (obligation.workflow.kind === "answer-writing") {
        const text = this.reviewContent.querySelector<HTMLTextAreaElement>("#answer-text")?.value.trim() ?? "";
        const count = text ? text.split(/\s+/).filter(Boolean).length : 0;
        const live = this.reviewContent.querySelector<HTMLElement>("#answer-live-count");
        if (live) live.textContent = String(count);
        const field = this.reviewContent.querySelector<HTMLInputElement>("#answer-word-count");
        if (field && obligation.workflow.responseMedium === "in-app") field.value = String(count);
        const elapsed = Math.max(this.attemptElapsedMs, this.closedBookAttemptMs());
        const limit = (obligation.workflow.timeLimitMinutes ?? obligation.expectedMinutes) * 60_000;
        const timing = this.reviewContent.querySelector<HTMLElement>("#answer-attempt-time");
        const status = this.reviewContent.querySelector<HTMLElement>("#answer-time-status");
        if (timing) timing.textContent = formatDuration(elapsed);
        if (status) {
          const within = elapsed <= limit;
          status.textContent = within ? `Within the ${obligation.workflow.timeLimitMinutes ?? obligation.expectedMinutes}-minute limit.` : `Exceeded the ${obligation.workflow.timeLimitMinutes ?? obligation.expectedMinutes}-minute limit.`;
          status.classList.toggle("bad", !within);
        }
      }
    }

    captureDraft(): void {
      const targetId = this.activeReviewIds[this.activeReviewIndex];
      if (!targetId || !this.reviewContent.querySelector(".review-card")) return;
      this.snapshotCurrentDraft();
      this.scheduleActiveRetrievalSave();
    }

    private restoreReviewDraft(obligationId: string): void {
      const snapshot = this.reviewDrafts.get(obligationId);
      if (!snapshot) { this.diagramStrokes = []; this.attemptElapsedMs = 0; return; }
      this.reviewPhase = snapshot.phase;
      for (const [id, value] of Object.entries(snapshot.values)) {
        const element = this.reviewContent.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${CSS.escape(id)}`);
        if (element) element.value = value;
      }
      for (const [id, value] of Object.entries(snapshot.checked)) {
        const element = this.reviewContent.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
        if (element) element.checked = value;
      }
      this.diagramStrokes = clone(snapshot.diagramStrokes);
      this.attemptElapsedMs = snapshot.attemptElapsedMs;
    }

    private resizeDiagramCanvas(canvas: HTMLCanvasElement): void {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(280, canvas.clientWidth || canvas.parentElement?.clientWidth || 280);
      const height = Math.max(300, Math.min(520, Math.round(width * 0.62)));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.height = `${height}px`;
    }

    private initializeDiagramCanvas(obligation: RevisionObligation): void {
      if (obligation.workflow.kind !== "diagram" || obligation.workflow.diagramSurface !== "canvas") return;
      const canvas = this.reviewContent.querySelector<HTMLCanvasElement>("#diagram-canvas");
      if (!canvas) return;
      this.resizeDiagramCanvas(canvas);
      this.redrawDiagram(canvas);
      const point = (event: PointerEvent): DiagramPoint => {
        const rect = canvas.getBoundingClientRect();
        return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
      };
      canvas.addEventListener("pointerdown", (event) => { if (!this.host.requireMutable("draw this diagram")) return; canvas.setPointerCapture(event.pointerId); this.activeDiagramStroke = [point(event)]; this.diagramStrokes.push(this.activeDiagramStroke); this.redrawDiagram(canvas); });
      canvas.addEventListener("pointermove", (event) => { if (!this.ownership.canMutate() || !this.activeDiagramStroke) return; this.activeDiagramStroke.push(point(event)); this.redrawDiagram(canvas); });
      const finish = () => { this.activeDiagramStroke = null; this.scheduleActiveRetrievalSave(); };
      canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish);
    }

    private redrawDiagram(canvas?: HTMLCanvasElement): void {
      const target = canvas ?? this.reviewContent.querySelector<HTMLCanvasElement>("#diagram-canvas");
      if (!target) return;
      const ctx = target.getContext("2d");
      if (!ctx) return;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.fillStyle = "#0b0d13"; ctx.fillRect(0, 0, target.width, target.height);
      ctx.strokeStyle = "#e8ff00"; ctx.lineWidth = 2 * ratio; ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const stroke of this.diagramStrokes) {
        if (stroke.length === 0) continue;
        ctx.beginPath(); ctx.moveTo(stroke[0]!.x * target.width, stroke[0]!.y * target.height);
        for (const point of stroke.slice(1)) ctx.lineTo(point.x * target.width, point.y * target.height);
        ctx.stroke();
      }
    }

    private startTimer(): void {
      this.stopTimer();
      if (!this.ownership.canMutate()) { this.updateTimerDisplay(); return; }
      this.timerHandle = window.setInterval(() => {
        if (!this.phaseTime) return;
        const before = this.phaseTime.hasPendingGap();
        this.reconcilePhaseTime("tick");
        if (!before && this.phaseTime.hasPendingGap()) this.forceActiveRetrievalSave();
      }, 1000);
      this.updateTimerDisplay();
    }

    private stopTimer(): void {
      if (this.timerHandle) window.clearInterval(this.timerHandle);
      this.timerHandle = 0;
    }

    private async startObligationSession(obligationId: string): Promise<void> {
      const obligation = await this.service.obligation(obligationId);
      const chunking = obligation.chunking;
      if (chunking?.status === "chunking") {
        const pending = (await this.service.chunksForObligation(obligation.id)).find((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "pending");
        if (pending) { await this.startReviewSession([`chunk:${pending.id}`]); return; }
      }
      await this.startReviewSession([obligation.id]);
    }

    private async startDueSession(): Promise<void> {
      assert(this.host.requireMutable("start the daily review"), "This tab is read-only.");
      const plan = await this.service.dailyPlan(new Date(), false, true);
      await this.startReviewSession(plan.selected.map((item) => item.chunk ? `chunk:${item.chunk.id}` : item.joined.obligation.id));
    }

    private async startUnitSession(unitId: string): Promise<void> {
      const obligations = (await this.service.obligationsForUnit(unitId)).filter((item) => item.status === "active");
      assert(obligations.length > 0, "This unit has no active revision obligations.");
      const targets: string[] = [];
      for (const obligation of obligations) {
        const chunking = obligation.chunking;
        if (chunking?.status === "chunking") {
          const pending = (await this.service.chunksForObligation(obligation.id)).find((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "pending");
          if (pending) { targets.push(`chunk:${pending.id}`); continue; }
        }
        targets.push(obligation.id);
      }
      await this.startReviewSession(targets);
    }

    private async startReviewSession(ids: string[]): Promise<void> {
      if (!this.host.requireMutable("start a retrieval session")) return;
      this.activeReviewIds = ids.filter(Boolean);
      assert(this.activeReviewIds.length > 0, "There is nothing to review.");
      this.activeReviewIndex = 0;
      const firstTarget = this.activeReviewTarget(0);
      this.reviewPhase = await this.initialPhaseForTarget(firstTarget);
      this.reviewDrafts.clear();
      this.diagramStrokes = [];
      this.phaseTime = PhaseTimeRuntime.create(this.reviewPhase, await this.initialSourceVisibleForTarget(firstTarget, this.reviewPhase));
      this.attemptElapsedMs = 0;
      this.activeSessionRevision = 0;
      this.commitInFlight = false;
      await this.service.markReviewTargetsStarted([firstTarget]);
      const session = this.buildActiveRetrievalSession();
      if (session) await this.activePersistence.flush(session);
      await this.host.openPane("review");
    }

    private async completeActiveChunk(): Promise<void> {
      if (!this.host.requireMutable("complete a retrieval chunk")) return;
      if (this.commitInFlight) return;
      this.commitInFlight = true;
      try {
        const target = this.activeReviewIds[this.activeReviewIndex];
        assert(target && target.startsWith("chunk:"), "Split-session target is missing.");
        const chunkId = target.slice(6);
        assert(this.phaseTime && this.phaseTime.status() === "running", "Resume and classify interruptions before completing this chunk.");
        const timing = this.timingSummary();
        const note = this.reviewContent.querySelector<HTMLTextAreaElement>("#chunk-note")?.value ?? "";
        const commitToken = uid("commit");
        const committing = this.buildActiveRetrievalSession("committing", commitToken);
        assert(committing, "Active retrieval state is missing.");
        const post = await this.postCommitSession(commitToken);
        try {
          await this.activePersistence.flush(committing);
          const guard: ActiveCommitGuard = { sessionId: ACTIVE_RETRIEVAL_ID, expectedRevision: committing.revision, targetId: target, commitToken };
          await this.service.completeChunk(chunkId, timing, note, new Date(), guard, post);
          await this.activePersistence.acceptCommittedTransition(post);
          this.activeSessionRevision = post.revision;
          this.host.toast("Chunk completed. Parent scheduling remains unchanged until final synthesis.");
          this.reviewDrafts.delete(target);
          this.activeReviewIndex += 1;
          this.phaseTime = new PhaseTimeRuntime(post.timeRuntime);
          this.attemptElapsedMs = 0;
          this.diagramStrokes = [];
          if (this.activeReviewIndex >= this.activeReviewIds.length) {
            await this.endReviewSession(false);
            await this.host.openPane("today");
            return;
          }
          this.reviewPhase = post.phase;
          await this.service.markReviewTargetsStarted([this.activeReviewTarget()]);
          await this.host.invalidateAfterCommit();
        } catch (error) {
          const resumed = this.buildActiveRetrievalSession("active");
          if (resumed) await this.activePersistence.flush(resumed).catch(() => undefined);
          throw error;
        }
      } finally {
        this.commitInFlight = false;
      }
    }

    private async endReviewSession(clearPersistence = true): Promise<void> {
      this.stopTimer();
      this.activeReviewIds = [];
      this.activeReviewIndex = 0;
      this.reviewPhase = "attempt";
      this.reviewDrafts.clear();
      this.diagramStrokes = [];
      this.phaseTime = undefined;
      this.hideGapOverlay();
      this.attemptElapsedMs = 0;
      this.activeSessionRevision = 0;
      this.commitInFlight = false;
      if (clearPersistence) await this.activePersistence.clear();
    }

    private async commitRating(rating: Rating): Promise<void> {
      if (!this.host.requireMutable("commit review evidence")) return;
      if (this.commitInFlight) return;
      this.commitInFlight = true;
      this.reviewContent.querySelectorAll<HTMLButtonElement>('[data-action="rate"]').forEach((button) => { button.disabled = true; });
      try {
        const obligationId = this.activeReviewIds[this.activeReviewIndex];
        assert(obligationId, "Review obligation is missing.");
        const obligation = await this.service.obligation(obligationId);
        const evidence = this.collectEvidence(rating, obligation);
        const suggestion = suggestRating(obligation.type, evidence);
        const effectiveRating = obligation.type === "relearn"
          ? correctiveMemoryRating(rating, evidence)
          : rating;
        if (effectiveRating !== rating) {
          const proceed = window.confirm(`Closed-book verification does not support ${ratingName(rating)}. It will be recorded as ${ratingName(effectiveRating)} and corrective work will remain active. Continue?`);
          if (!proceed) return;
        } else if (Math.abs(rating - suggestion) >= 2) {
          const proceed = window.confirm(`Objective evidence suggests ${ratingName(suggestion)}, but you selected ${ratingName(rating)}. Keep your rating?`);
          if (!proceed) return;
        }
        const committedEvidence = effectiveRating === rating ? evidence : { ...evidence, confirmedRating: effectiveRating };
        const commitToken = uid("commit");
        const committing = this.buildActiveRetrievalSession("committing", commitToken);
        assert(committing, "Active retrieval state is missing.");
        const post = await this.postCommitSession(commitToken);
        try {
          await this.activePersistence.flush(committing);
          const guard: ActiveCommitGuard = { sessionId: ACTIVE_RETRIEVAL_ID, expectedRevision: committing.revision, targetId: obligationId, commitToken };
          await this.service.recordEvidence(obligationId, committedEvidence, new Date(), guard, post);
          await this.activePersistence.acceptCommittedTransition(post);
          this.activeSessionRevision = post.revision;
          this.host.toast(`Recorded ${ratingName(effectiveRating)}. Next obligation scheduled.`);
          this.reviewDrafts.delete(obligationId);
          this.activeReviewIndex += 1;
          this.diagramStrokes = [];
          this.phaseTime = new PhaseTimeRuntime(post.timeRuntime);
          this.attemptElapsedMs = 0;
          if (this.activeReviewIndex >= this.activeReviewIds.length) {
            await this.endReviewSession(false);
            await this.host.openPane("today");
            return;
          }
          this.reviewPhase = post.phase;
          await this.service.markReviewTargetsStarted([this.activeReviewTarget()]);
          await this.host.invalidateAfterCommit();
        } catch (error) {
          const resumed = this.buildActiveRetrievalSession("active");
          if (resumed) await this.activePersistence.flush(resumed).catch(() => undefined);
          throw error;
        }
      } finally {
        this.commitInFlight = false;
        this.reviewContent.querySelectorAll<HTMLButtonElement>('[data-action="rate"]').forEach((button) => { button.disabled = false; });
      }
    }

    async flushForBackup(): Promise<void> {
      assert(!this.commitInFlight, "A review Evidence commit is still in progress.");
      if (!this.ownership.canMutate()) return;
      if (this.phaseTime) this.reconcilePhaseTime("snapshot");
      const session = this.buildActiveRetrievalSession();
      if (session) {
        assert(session.status === "active", "A committing retrieval cannot be backed up.");
        this.activePersistence.forceEmergency(session);
        await this.activePersistence.flush(session);
      }
    }

    handleKeyboard(event: KeyboardEvent): void {
      if (!this.ownership.canMutate()) return;
      if (this.activeReviewIds.length === 0) return;
      if (this.activeReviewIds[this.activeReviewIndex]?.startsWith("chunk:")) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.matches("input,textarea,select")) return;
      if (this.reviewPhase === "attempt" && (event.key === " " || event.key === "Enter")) {
        const reveal = this.reviewContent.querySelector<HTMLButtonElement>('[data-action="reveal"]');
        if (!reveal) return;
        event.preventDefault();
        reveal.click();
        return;
      }
      if (this.reviewPhase === "compare" && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        void this.commitRating(validateRating(Number(event.key)));
      }
    }
  }
