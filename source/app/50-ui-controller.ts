  function requiredElement<T extends HTMLElement>(
    selector: string,
    constructor: ElementConstructor<T>,
  ): T {
    const element = document.querySelector(selector);
    assert(element instanceof constructor, `Missing or invalid required element: ${selector}`);
    return element;
  }

  function downloadBlob(filename: string, content: BlobPart | Uint8Array, type: string): void {
    const part: BlobPart = content instanceof Uint8Array ? ownedArrayBuffer(content) : content;
    const blob = new Blob([part], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${roundTo(bytes / 1024, 1)} KiB`;
    return `${roundTo(bytes / (1024 * 1024), 1)} MiB`;
  }

  class UIController {
    private currentPane: PaneId = "today";
    private historyTab: "evidence" | "study" = "evidence";
    private libraryFilter = "";
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
    private ownershipSnapshot: ReviewOwnershipSnapshot;
    private restoreCandidateId = "";
    private restoreSafetyProofId = "";
    private fsrsOptimizerRun: BrowserFsrsOptimizerRun | undefined;
    private fsrsOptimizerProgress: BrowserFsrsOptimizerProgress | undefined;

    private readonly todayContent = requiredElement("#today-content", HTMLDivElement);
    private readonly reviewContent = requiredElement("#review-content", HTMLDivElement);
    private readonly libraryContent = requiredElement("#library-content", HTMLDivElement);
    private readonly studyContent = requiredElement("#study-content", HTMLDivElement);
    private readonly historyContent = requiredElement("#history-content", HTMLDivElement);
    private readonly settingsContent = requiredElement("#settings-content", HTMLDivElement);
    private readonly toastElement = requiredElement("#toast", HTMLDivElement);
    private readonly gapOverlay = requiredElement("#gap-overlay", HTMLDivElement);
    private readonly gapMeta = requiredElement("#gap-meta", HTMLDivElement);
    private readonly gapSplit = requiredElement("#gap-split", HTMLDivElement);
    private readonly gapFocusMinutes = requiredElement("#gap-focus-minutes", HTMLInputElement);
    private readonly unitDialog = requiredElement("#unit-dialog", HTMLDialogElement);
    private readonly studyDialog = requiredElement("#study-dialog", HTMLDialogElement);
    private readonly obligationDialog = requiredElement("#obligation-dialog", HTMLDialogElement);
    private readonly restoreDialog = requiredElement("#restore-dialog", HTMLDialogElement);
    private readonly restorePreview = requiredElement("#restore-preview", HTMLDivElement);
    private readonly unitForm = requiredElement("#unit-form", HTMLFormElement);
    private readonly studyForm = requiredElement("#study-form", HTMLFormElement);
    private readonly obligationForm = requiredElement("#obligation-form", HTMLFormElement);
    private readonly ownershipBanner = requiredElement("#ownership-banner", HTMLDivElement);
    private readonly ownershipTitle = requiredElement("#ownership-title", HTMLElement);
    private readonly ownershipMessage = requiredElement("#ownership-message", HTMLElement);
    private readonly takeControlButton = requiredElement("#take-review-control", HTMLButtonElement);
    private readonly storageCapacityBanner = requiredElement("#storage-capacity-banner", HTMLDivElement);
    private readonly appShell = requiredElement(".app-shell", HTMLElement);
    private readonly primaryNav = requiredElement(".nav", HTMLElement);
    private readonly renderCoordinator: RenderCoordinator;
    private readonly tabRegistry: AriaTabRegistry;
    private readonly dialogFocus: NativeDialogFocusManager;
    private readonly gapFocus: OverlayFocusManager;

    constructor(
      private readonly service: RevisionService,
      private readonly activePersistence: ActiveRetrievalPersistence,
      private readonly ownership: ReviewOwnershipCoordinator,
      private readonly backupController: BackupController,
      private readonly extensions: ExtensionRuntime,
    ) {
      this.ownershipSnapshot = ownership.snapshot();
      this.renderCoordinator = new RenderCoordinator(
        () => captureDocumentFocus(),
        (snapshot) => {
          this.applyReadOnlyState();
          if (this.gapFocus.isOpen()) this.gapFocus.ensureFocus();
          else if (!document.querySelector("dialog[open]")) restoreDocumentFocus(snapshot);
        },
      );
      this.tabRegistry = new AriaTabRegistry(
        this.primaryNav,
        ["today", "review", "library", "study", "history", "settings"],
        (pane) => this.openPane(pane),
      );
      this.dialogFocus = new NativeDialogFocusManager([this.unitDialog, this.studyDialog, this.obligationDialog, this.restoreDialog]);
      this.gapFocus = new OverlayFocusManager(this.gapOverlay, [this.appShell, this.ownershipBanner, this.storageCapacityBanner]);
      this.registerRenderDomains();
    }

    async start(): Promise<void> {
      this.bindStaticEvents();
      this.tabRegistry.initialize(this.currentPane);
      this.startClock();
      await this.renderAll();
      await this.ownership.start({
        flush: () => this.flushForOwnershipRelease(),
        hydrate: (reason) => this.hydrateCanonicalState(reason),
        changed: (snapshot) => this.handleOwnershipChanged(snapshot),
      });
      this.handleOwnershipChanged(this.ownership.snapshot());
    }

    private activeReviewTarget(index = this.activeReviewIndex): string {
      const target = this.activeReviewIds[index];
      assert(target, "Review target is missing.");
      return target;
    }

    private registerRenderDomains(): void {
      this.renderCoordinator.register("today", () => this.renderToday());
      this.renderCoordinator.register("review", () => this.renderReview());
      this.renderCoordinator.register("library", () => this.renderLibrary());
      this.renderCoordinator.register("study", () => this.renderStudy());
      this.renderCoordinator.register("history", () => this.renderHistory());
      this.renderCoordinator.register("settings", () => this.renderSettings());
      this.renderCoordinator.register("sidebar", () => this.renderSidebar());
      this.renderCoordinator.register("ownership", () => this.applyReadOnlyState());
      this.renderCoordinator.register("storage", () => this.renderStorageCapacity());
    }

    private bindStaticEvents(): void {
      document.addEventListener("click", (event) => void this.handleDelegatedClick(event));
      document.addEventListener("submit", (event) => void this.handleDelegatedSubmit(event));
      document.addEventListener("input", (event) => void this.handleDelegatedInput(event));
      document.addEventListener("change", (event) => void this.handleDelegatedChange(event));
      document.addEventListener("keydown", (event) => this.handleDelegatedKeydown(event));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          if (this.ownership.canMutate()) { this.reconcilePhaseTime("visibility"); this.forceActiveRetrievalSave(); }
          this.ownership.noteVisibilityHidden();
          return;
        }
        void this.handleLifecycleReturn("visibility");
      });
      window.addEventListener("focus", () => void this.handleLifecycleReturn("focus"));
      window.addEventListener("pageshow", () => void this.handleLifecycleReturn("pageshow"));
      window.addEventListener("pagehide", () => void this.handlePageExit());
      window.addEventListener("beforeunload", () => void this.handlePageExit());
      window.addEventListener(REVISION_DIRECTOR_PLUGIN_STATUS_EVENT, () => {
        if (this.currentPane === "settings") this.renderCoordinator.invalidate("settings", "ownership");
      });
    }

    private async handleDelegatedClick(event: MouseEvent): Promise<void> {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button,[data-action],[data-pane],[data-filter],[data-history-tab],[data-close-dialog],[data-gap-action]") : null;
      if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
      const pane = literalChoiceOrUndefined(target.dataset["pane"], ["today", "review", "library", "study", "history", "settings"] as const);
      if (pane) {
        await this.openPane(pane);
        return;
      }
      if (target.id === "quick-add-unit") {
        if (this.requireMutable("add a knowledge unit")) await this.openUnitDialog();
        return;
      }
      if (target.id === "quick-log-study") {
        if (this.requireMutable("log a Study Event")) await this.openStudyDialog();
        return;
      }
      if (target.id === "take-review-control") {
        await this.takeControl();
        return;
      }
      const closeId = target.dataset["closeDialog"];
      if (closeId) {
        this.dialogFocus.close(requiredElement(`#${closeId}`, HTMLDialogElement));
        return;
      }
      const gapAction = target.dataset["gapAction"];
      if (gapAction) {
        await this.handleGapAction(gapAction);
        return;
      }
      if (target.hasAttribute("data-filter")) {
        this.libraryFilter = target.dataset["filter"] ?? "";
        await this.renderCoordinator.invalidateAndWait("library", "ownership");
        return;
      }
      const historyTab = target.dataset["historyTab"];
      if (historyTab === "evidence" || historyTab === "study") {
        this.historyTab = historyTab;
        await this.renderCoordinator.invalidateAndWait("history", "ownership");
        return;
      }
      if (target.dataset["action"]) await this.handleAction(target);
    }

    private async handleDelegatedSubmit(event: SubmitEvent): Promise<void> {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const formId = form.getAttribute("id") ?? "";
      if (!["unit-form", "study-form", "obligation-form", "settings-form"].includes(formId)) return;
      event.preventDefault();
      if (formId === "unit-form") await this.submitUnit(event);
      else if (formId === "study-form") await this.submitStudy(event);
      else if (formId === "obligation-form") await this.submitObligation(event);
      else await this.submitSettings(event);
    }

    private async updateActiveReviewInputs(target: EventTarget | null): Promise<void> {
      if (!(target instanceof HTMLElement) || !this.reviewContent.contains(target)) return;
      this.scheduleActiveRetrievalSave();
      const obligationId = this.activeReviewIds[this.activeReviewIndex];
      if (!obligationId || obligationId.startsWith("chunk:")) return;
      let obligation: RevisionObligation;
      try { obligation = await this.service.obligation(obligationId); } catch { return; }
      if (target.matches("[data-evidence-input]")) this.updateEvidenceSuggestion(obligation);
      if (target.matches("#answer-text,#questions-attempted,#questions-correct,#questions-partial")) this.updateDerivedWorkflowDisplays(obligation);
    }

    private async handleDelegatedInput(event: Event): Promise<void> {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id === "library-search") {
        this.libraryFilter = target.value;
        this.renderCoordinator.invalidateDebounced("library-search", 160, "library", "ownership");
        return;
      }
      await this.updateActiveReviewInputs(target);
    }

    private async handleDelegatedChange(event: Event): Promise<void> {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id === "import-backup") {
        await this.importBackup(event);
        return;
      }
      if (target instanceof HTMLInputElement && target.id === "import-fsrs-profile") {
        await this.importFsrsOptimizerProfile(target);
        return;
      }
      if (target instanceof HTMLInputElement && target.id === "load-plugin-files") {
        await this.loadPluginFiles(target);
        return;
      }
      if (target instanceof HTMLInputElement && (target.id === "restore-safety-saved" || target.id === "restore-replace-confirm" || target.name === "restore-active-treatment")) {
        if (target.id === "restore-safety-saved" && target.checked && this.restoreSafetyProofId) this.backupController.acknowledgeSafetyCopy(this.restoreSafetyProofId);
        this.updateRestoreActionState();
        return;
      }
      if (target instanceof HTMLSelectElement) {
        const form = target.closest<HTMLFormElement>("#unit-form,#obligation-form");
        if (form) {
          const typeName = form.getAttribute("id") === "unit-form" ? "obligationType" : "type";
          const typeSelect = formSelect(form, typeName);
          if (target === typeSelect) {
            applyDefaultWorkflowToForm(form, literalChoice(typeSelect.value, OBLIGATION_TYPES, "Obligation type"));
            return;
          }
          if (target === formSelect(form, "workflowKind")) {
            const type = literalChoice(typeSelect.value, OBLIGATION_TYPES, "Obligation type");
            const protocol = formTextarea(form, "protocol").value;
            const success = formTextarea(form, "successCriteria").value;
            const selected = literalChoice(target.value, RETRIEVAL_WORKFLOWS, "Retrieval workflow");
            const spec = defaultWorkflowSpec(type, protocol, success);
            spec.kind = selected;
            spec.responseMedium = selected === "answer-writing" ? "paper" : "in-app";
            if (selected === "reconstruction") spec.reconstructionShape = "outline";
            if (selected === "questions") { spec.targetCount = 10; spec.questionSetRef = "External question set"; }
            if (selected === "diagram") spec.diagramSurface = "canvas";
            if (selected === "answer-writing") { spec.answerMode = "full-answer"; spec.timeLimitMinutes = 10; spec.wordLimit = 150; }
            populateWorkflowForm(form, spec, type);
            return;
          }
        }
      }
      await this.updateActiveReviewInputs(target);
    }

    private handleDelegatedKeydown(event: KeyboardEvent): void {
      if (this.gapFocus.handleKeydown(event)) return;
      if (this.tabRegistry.handleKeydown(event)) return;
      if (event.target === this.gapFocusMinutes && event.key === "Enter") {
        event.preventDefault();
        void this.handleGapAction("apply-split");
        return;
      }
      this.handleKeyboard(event);
    }

    private requireMutable(reason: string): boolean {
      if (this.ownership.canMutate()) return true;
      this.handleOwnershipChanged(this.ownership.snapshot());
      this.toast(this.ownershipSnapshot.state === "faulted"
        ? `Review control is unavailable because the ownership lease failed. Browser storage must recover before you can ${reason}.`
        : `This tab is read-only. Take control here to ${reason}.`, true);
      return false;
    }

    private async takeControl(): Promise<void> {
      this.takeControlButton.disabled = true;
      try {
        const acquired = await this.ownership.takeControl();
        if (!acquired) this.toast("Review control could not be acquired.", true);
      } finally {
        this.takeControlButton.disabled = false;
      }
    }

    private handleOwnershipChanged(snapshot: ReviewOwnershipSnapshot): void {
      const wasPrimary = this.ownershipSnapshot.canMutate;
      this.ownershipSnapshot = snapshot;
      if (wasPrimary && !snapshot.canMutate) {
        this.stopTimer();
        this.hideGapOverlay();
        this.fsrsOptimizerRun?.cancel();
      }
      const primary = snapshot.canMutate;
      this.ownershipBanner.hidden = primary;
      this.ownershipBanner.classList.toggle("faulted", snapshot.state === "faulted");
      this.takeControlButton.hidden = snapshot.state === "hydrating" || snapshot.state === "acquiring" || snapshot.state === "releasing";
      this.ownershipTitle.textContent = snapshot.state === "faulted" ? "Review control unavailable" : snapshot.state === "hydrating" ? "Reloading canonical state" : snapshot.state === "acquiring" || snapshot.state === "releasing" ? "Review control changing" : "Read-only tab";
      this.ownershipMessage.textContent = snapshot.state === "faulted"
        ? snapshot.lastError ?? "The ownership lease could not be safely stored. Browsing and export remain available."
        : snapshot.state === "hydrating"
          ? "The latest IndexedDB and emergency copies are being reconciled before mutation is enabled."
          : snapshot.state === "acquiring" || snapshot.state === "releasing"
            ? "A safe flush and ownership handoff is in progress."
            : "Another tab owns all Revision Director mutations. You may browse and export here.";
      if (!wasPrimary && snapshot.canMutate) void this.renderAll();
      else this.renderCoordinator.invalidate("ownership", "storage");
    }

    private applyReadOnlyState(): void {
      const primary = this.ownership.canMutate();
      const controls = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input,textarea,select,button");
      controls.forEach((control) => {
        const action = control instanceof HTMLElement ? control.dataset["action"] : undefined;
        const safe = control === this.takeControlButton
          || control.matches("[data-pane],[data-history-tab],[data-close-dialog]")
          || action === "export-backup"
          || action === "cancel-restore"
          || control.id === "library-search";
        if (!primary && !safe) {
          if (!control.disabled) control.dataset["ownershipDisabled"] = "1";
          control.disabled = true;
        } else if (primary && control.dataset["ownershipDisabled"] === "1") {
          control.disabled = false;
          delete control.dataset["ownershipDisabled"];
        }
      });
      const canvas = this.reviewContent.querySelector<HTMLCanvasElement>("#diagram-canvas");
      if (canvas) { canvas.style.pointerEvents = primary ? "auto" : "none"; canvas.setAttribute("aria-disabled", String(!primary)); }
    }

    private renderStorageCapacity(): void {
      const storage = this.service.storageHealth();
      if (storage.level === "healthy") { this.storageCapacityBanner.hidden = true; this.storageCapacityBanner.textContent = ""; return; }
      const ratio = storage.usageRatio === undefined ? "" : ` Storage usage is ${Math.round(storage.usageRatio * 100)}%.`;
      const persistence = storage.persistence === "granted" ? "" : ` Persistent storage: ${storage.persistence}.`;
      this.storageCapacityBanner.textContent = `${storage.level === "critical" ? "Storage capacity is critical." : "Storage needs attention."}${ratio}${persistence}${storage.lastError ? ` ${storage.lastError}` : ""}`;
      this.storageCapacityBanner.hidden = false;
    }

    private async handleLifecycleReturn(source: "visibility" | "focus" | "pageshow"): Promise<void> {
      await this.ownership.evaluate("reacquire");
      await this.service.refreshStorageHealth(false).catch(() => this.service.storageHealth());
      if (this.ownership.canMutate()) this.reconcileAndPersistPhaseTime(source);
      await this.renderCoordinator.invalidateAndWait("storage", "ownership");
    }

    private async handlePageExit(): Promise<void> {
      this.fsrsOptimizerRun?.cancel();
      if (this.ownership.canMutate()) {
        this.reconcilePhaseTime("snapshot");
        this.forceActiveRetrievalSave();
      }
      await this.ownership.releaseForExit();
    }

    private async flushForOwnershipRelease(): Promise<void> {
      if (this.commitInFlight) throw new Error("A review commit is still in progress.");
      if (this.phaseTime) this.reconcilePhaseTime("snapshot");
      const session = this.buildActiveRetrievalSession();
      if (session) {
        this.activePersistence.forceEmergency(session);
        await this.activePersistence.flush(session);
      }
    }

    private resetLocalReviewState(): void {
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

    private async hydrateCanonicalState(reason: ReviewOwnershipHydrationReason): Promise<void> {
      this.resetLocalReviewState();
      await this.service.initialize();
      await this.renderAll();
      await this.recoverUnfinishedSession(reason === "startup");
      await this.renderCoordinator.invalidateAndWait("storage", "ownership");
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

    private reconcileAndPersistPhaseTime(source: TimeRuntimeSource): void {
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

    private async handleGapAction(action: string): Promise<void> {
      if (!this.requireMutable("classify an interruption")) return;
      if (!this.phaseTime?.hasPendingGap()) { this.hideGapOverlay(); return; }
      if (action === "split") { this.gapSplit.hidden = false; this.gapFocus.focus("#gap-focus-minutes"); return; }
      const classification = action === "apply-split" ? "split" : literalChoice(action, INACTIVE_GAP_CLASSIFICATIONS, "Inactive-gap action");
      const focusMs = classification === "split" ? Math.max(0, Number(this.gapFocusMinutes.value) || 0) * 60_000 : 0;
      const record = this.phaseTime.resolveGap(classification, focusMs);
      this.hideGapOverlay();
      this.updateTimerDisplay();
      this.forceActiveRetrievalSave();
      this.toast(classification === "ignore" ? "Gap ignored. This duration will not train adaptive estimates." : `Gap classified as ${classification}.`);
      if (record.classification === "ignore") this.scheduleActiveRetrievalSave();
    }

    private togglePause(): void {
      assert(this.requireMutable("pause or resume retrieval"), "This tab is read-only.");
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

    private async recoverUnfinishedSession(askBeforeResume = true): Promise<void> {
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
      await this.openPane("review");
      if (this.phaseTime.hasPendingGap()) this.showGapOverlay();
      this.toast(askBeforeResume ? "Unfinished retrieval session recovered." : "Canonical retrieval state hydrated after ownership transfer.");
    }

    private startClock(): void {
      const clock = requiredElement("#clock", HTMLDivElement);
      const update = () => { clock.textContent = new Date().toLocaleTimeString("en-IN", { hour12: false }); };
      update();
      window.setInterval(update, 1000);
    }

    private async openPane(pane: PaneId): Promise<void> {
      if (this.currentPane === "review" && pane !== "review") this.captureReviewDraft();
      this.currentPane = pane;
      this.tabRegistry.activate(pane);
      await this.renderPane(pane);
    }

    private async renderAll(): Promise<void> {
      await this.renderCoordinator.invalidateAndWait(
        "today", "review", "library", "study", "history", "settings", "sidebar", "ownership", "storage",
      );
    }

    private async renderPane(pane: PaneId): Promise<void> {
      await this.renderCoordinator.invalidateAndWait(pane, "sidebar", "ownership", "storage");
    }

    private async renderSidebar(): Promise<void> {
      const plan = await this.service.dailyPlan(new Date(), false, this.ownership.canMutate());
      const units = (await this.service.units()).filter((unit) => unit.status === "active");
      requiredElement("#sb-due", HTMLElement).textContent = String(plan.selected.length);
      requiredElement("#sb-units", HTMLElement).textContent = String(units.length);
      requiredElement("#sb-load", HTMLElement).textContent = `${plan.plannedMinutes}m`;
    }

    private pageHead(eyebrow: string, title: string, description: string, actions = ""): string {
      return `<header class="page-head"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="actions">${actions}</div></header>`;
    }

    private async renderToday(): Promise<void> {
      const plan = await this.service.dailyPlan(new Date(), false, this.ownership.canMutate());
      const capacityDifference = plan.capacityMinutes - plan.plannedMinutes;
      const capacityStatus = capacityDifference >= 0 ? `${capacityDifference}m reserve` : `${Math.abs(capacityDifference)}m necessary overrun`;
      const deferredMinutes = plan.deferred.reduce((sum, item) => sum + item.executionMinutes, 0);
      const exceptionCount = plan.requiredOverrun.length + plan.mustSplit.length;
      const requiredOverrunIds = new Set(plan.requiredOverrun.map((item) => item.joined.obligation.id));

      this.todayContent.innerHTML = `
        ${this.pageHead("REVISION PLANNING", "Today", "A capacity-bounded daily plan selected from current memory and exam evidence.", `<button class="btn" data-action="log-study">LOG STUDY</button><button class="btn" data-action="regenerate-plan">REGENERATE PLAN</button><button class="btn primary" data-action="start-due" ${plan.selected.length ? "" : "disabled"}>START DAILY PLAN</button>`)}
        <div class="summary-grid">
          <div class="metric"><span>Planned obligations</span><strong>${plan.selected.length}</strong><small>${plan.overdueCount} overdue · ${plan.broughtForwardCount} brought forward</small></div>
          <div class="metric"><span>Planned load</span><strong>${plan.plannedMinutes}m</strong><small>${escapeHtml(capacityStatus)}</small></div>
          <div class="metric"><span>Deferred today</span><strong>${plan.deferred.length}</strong><small>${deferredMinutes}m outside capacity</small></div>
          <div class="metric"><span>Capacity exceptions</span><strong>${exceptionCount}</strong><small>${plan.requiredOverrun.length} required overrun · ${plan.mustSplit.length} must split</small></div>
        </div>
        <div class="policy-box planner-principle"><strong>Planning model:</strong> each candidate receives a transparent score from due risk, exam importance, obligation-specific weakness, learned duration, examination proximity, weekly subject balance and the ${plan.capacityMinutes}m daily limit. Exams that have passed are automatically excluded. Relearning and severe overdue risk receive narrow safety boosts. Scheduling engines still decide <em>when work becomes eligible</em>; the planner decides <em>what fits today</em>.</div>
        <section class="section-block">
          <div class="section-head"><h2>Daily revision queue</h2><span class="section-note">Study day ${escapeHtml(plan.studyDayKey)} · persisted plan version ${plan.versionNumber} · highest-value feasible set within capacity.</span></div>
          ${plan.selected.length ? `<div class="queue-list planner-list">${plan.selected.map((item, index) => this.plannerRow(item, index + 1, requiredOverrunIds.has(item.joined.obligation.id) ? "required-overrun" : "selected")).join("")}</div>` : this.emptyState("No revision planned", "No active obligation is due or close enough to bring forward within the planning horizon.")}
        </section>
        ${plan.mustSplit.length ? `<section class="section-block"><div class="section-head"><h2>Critical work requiring split</h2><span class="section-note">These obligations are too long for the daily capacity. They remain explicit and should be redesigned as smaller complete sessions or reviewed manually.</span></div><div class="queue-list planner-list split-list">${plan.mustSplit.map((item, index) => this.plannerRow(item, index + 1, "must-split")).join("")}</div></section>` : ""}
        <section class="section-block">
          <div class="section-head"><h2>Deferred by capacity</h2><span class="section-note">Visible rather than silently lost; review any item manually when circumstances change.</span></div>
          ${plan.deferred.length ? `<div class="queue-list planner-list deferred-list">${plan.deferred.slice(0, 20).map((item, index) => this.plannerRow(item, index + 1, "deferred")).join("")}</div>` : this.emptyState("Nothing deferred", "All eligible revision obligations fit within today’s capacity.")}
        </section>`;
    }

    private factorMeter(label: string, value: number): string {
      const percent = Math.round(clamp(value, 0, 1) * 100);
      return `<div class="factor-meter"><span>${escapeHtml(label)}</span><div class="factor-track"><i style="width:${percent}%"></i></div><strong>${percent}</strong></div>`;
    }

    private plannerRow(item: PlannedQueueItem, order: number, disposition: "selected" | "required-overrun" | "must-split" | "deferred"): string {
      const joined = item.joined;
      const selected = disposition === "selected" || disposition === "required-overrun";
      const stateLabel = item.dueState === "brought-forward" ? "brought forward" : item.dueState;
      const retrieval = item.retrievability === undefined ? "" : `<span>Memory availability ${Math.round(item.retrievability * 100)}%</span>`;
      const exceptionChip = disposition === "required-overrun" ? `<span class="chip capacity-exception">required overrun</span>` : disposition === "must-split" ? `<span class="chip capacity-exception">must split</span>` : "";
      const actionLabel = disposition === "selected" ? "REVIEW" : disposition === "required-overrun" ? "REVIEW OVERRUN" : disposition === "must-split" ? "REVIEW ANYWAY" : "REVIEW ANYWAY";
      return `<article class="queue-row planner-row ${escapeHtml(disposition)}">
        <div class="planner-order">${selected ? String(order).padStart(2, "0") : "—"}</div>
        <div class="planner-main">
          <div class="breadcrumb">${escapeHtml(joined.profile.name)} · ${escapeHtml(joined.subject)} › ${escapeHtml(joined.section)} › ${escapeHtml(joined.topic)}</div>
          <div class="row-title">${escapeHtml(item.chunk?.label ?? joined.unit.title)}</div>
          <div class="row-meta"><span class="chip ${obligationChip(joined.obligation.type)}">${escapeHtml(obligationLabel(joined.obligation.type))}</span><span class="chip workflow-chip">${escapeHtml(workflowLabel(joined.obligation.workflow.kind))}</span><span class="chip ${item.dueState === "brought-forward" ? "upcoming" : item.dueState}">${escapeHtml(stateLabel)}</span>${exceptionChip}<span>${item.executionMinutes}m planned</span>${joined.obligation.durationSampleCount ? `<span>${joined.obligation.durationSampleCount} duration samples</span>` : ""}<span>${item.examDateKnown ? `Exam in ${item.daysToExam}d` : "Exam date not set"}</span>${retrieval}</div>
          <div class="planner-reasons">${item.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>
          <details class="planner-details"><summary>Why score ${item.score}</summary><div class="factor-grid">${this.factorMeter("Due risk", item.factors.dueRisk)}${this.factorMeter("Exam importance", item.factors.examImportance)}${this.factorMeter("Weakness", item.factors.weakness)}${this.factorMeter("Duration fit", item.factors.reviewDuration)}${this.factorMeter("Exam proximity", item.factors.examinationProximity)}${this.factorMeter("Weekly balance", item.factors.weeklyBalance)}</div></details>
        </div>
        <div class="row-actions"><button class="mini-btn" data-action="${item.chunk ? "review-chunk" : "review-one"}" data-id="${item.chunk?.id ?? joined.obligation.id}">${item.chunk ? "WORK CHUNK" : actionLabel}</button></div>
      </article>`;
    }



    private emptyState(title: string, message: string): string {
      return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
    }

    private async renderLibrary(): Promise<void> {
      const settings = this.service.getSettings();
      const profiles = await this.service.profiles();
      const units = (await this.service.units()).filter((unit) => unit.status !== "archived");
      const nodes = await this.service.nodes();
      const obligations = await this.service.obligations();
      const nodeMap = new Map(nodes.map((node) => [node.id, node]));
      const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
      const filtered = units.filter((unit) => {
        if (!this.libraryFilter) return true;
        const topic = nodeMap.get(unit.topicNodeId);
        const section = topic?.parentId ? nodeMap.get(topic.parentId) : undefined;
        const subject = section?.parentId ? nodeMap.get(section.parentId) : undefined;
        return [unit.title, unit.scope, topic?.name, section?.name, subject?.name].some((value) => normalizeName(value ?? "").includes(normalizeName(this.libraryFilter)));
      });

      const subjects = nodes.filter((node) => node.kind === "subject").sort((a, b) => a.name.localeCompare(b.name));
      this.libraryContent.innerHTML = `
        ${this.pageHead("KNOWLEDGE RECORD", "Library", "A durable hierarchy of what must remain available for examination performance.", `<button class="btn primary" data-action="add-unit">ADD UNIT</button>`)}
        <div class="filter-bar"><input id="library-search" value="${escapeHtml(this.libraryFilter)}" placeholder="Search unit or hierarchy..."></div>
        <div class="library-grid">
          <aside class="panel hierarchy-panel"><div class="tree-label">Exam hierarchy</div><button class="tree-item ${this.libraryFilter ? "" : "on"}" data-filter="">All knowledge</button>${subjects.map((subject) => `<button class="tree-item" data-filter="${escapeHtml(subject.name)}">${escapeHtml(profileMap.get(subject.profileId)?.name ?? "Exam")} · ${escapeHtml(subject.name)}</button>`).join("")}</aside>
          <div>${filtered.length ? `<div class="unit-list">${filtered.map((unit) => {
            const topic = nodeMap.get(unit.topicNodeId);
            const section = topic?.parentId ? nodeMap.get(topic.parentId) : undefined;
            const subject = section?.parentId ? nodeMap.get(section.parentId) : undefined;
            const unitObligations = obligations.filter((obligation) => obligation.unitId === unit.id && obligation.status === "active");
            const memoryObligations = obligations.filter((obligation) => obligation.unitId === unit.id && obligation.type === "memory-recall" && obligation.status !== "archived");
            const difficultyPanels = memoryObligations.map((obligation) => {
              const assessment = memoryDifficultyAssessment(obligation, settings.memoryDifficultyPolicy);
              if (assessment.level === "normal") return "";
              const label = assessment.level === "persistent-difficulty" ? "Persistent difficulty" : "Remediation";
              const actions = assessment.recommendedActions.map(memoryDifficultyActionLabel).join(" · ");
              return `<div class="policy-box"><strong>${label} · ${assessment.fsrsLapses} FSRS lapses.</strong> ${escapeHtml(actions)}.</div>`;
            }).join("");
            const heldMemory = memoryObligations.filter((obligation) => obligation.status === "suspended" && obligation.suspensionReason === "persistent-difficulty");
            return `<article class="unit-row"><div><div class="breadcrumb">${escapeHtml(profileMap.get(unit.profileId)?.name ?? "Exam")} · ${escapeHtml(subject?.name ?? "")} › ${escapeHtml(section?.name ?? "")} › ${escapeHtml(topic?.name ?? "")}</div><div class="row-title">${escapeHtml(unit.title)}</div><p>${escapeHtml(unit.scope)}</p><div class="row-meta">${unitObligations.map((obligation) => `<span class="chip ${obligationChip(obligation.type)}">${escapeHtml(obligationLabel(obligation.type))}</span><span class="chip workflow-chip">${escapeHtml(workflowLabel(obligation.workflow.kind))}</span>`).join("")}<span>${unit.evidenceCount} evidence events</span><span>${unit.lapseCount} failures</span></div>${difficultyPanels}</div><div class="row-actions"><button class="mini-btn" data-action="review-unit" data-id="${unit.id}">REVIEW</button><button class="mini-btn" data-action="add-obligation" data-id="${unit.id}">ADD OBLIGATION</button>${heldMemory.map((obligation) => `<button class="mini-btn" data-action="resume-persistent-difficulty" data-id="${obligation.id}">RESUME MEMORY</button>`).join("")}<button class="mini-btn" data-action="toggle-unit" data-id="${unit.id}" data-status="${unit.status === "active" ? "suspended" : "active"}">${unit.status === "active" ? "SUSPEND" : "ACTIVATE"}</button></div></article>`;
          }).join("")}</div>` : this.emptyState("No matching knowledge", "Create a unit or change the search filter.")}</div>
        </div>`;
    }

    private async renderStudy(): Promise<void> {
      const events = await this.service.studyEvents();
      const profiles = await this.service.profiles();
      const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
      const recentMinutes = events.filter((event) => new Date(event.occurredAt).getTime() > Date.now() - 7 * DAY_MS).reduce((sum, event) => sum + event.durationMinutes, 0);
      const linkedCount = events.filter((event) => event.linkedUnitIds.length > 0).length;
      this.studyContent.innerHTML = `
        ${this.pageHead("ORIGINAL LEARNING", "Study Log", "Study Events preserve what was learned, practised or tested before it becomes a revision obligation.", `<button class="btn primary" data-action="log-study">LOG STUDY EVENT</button>`)}
        <div class="summary-grid">
          <div class="metric"><span>Study events</span><strong>${events.length}</strong><small>Immutable learning records</small></div>
          <div class="metric"><span>Last seven days</span><strong>${recentMinutes}m</strong><small>Recorded study time</small></div>
          <div class="metric"><span>Linked events</span><strong>${linkedCount}</strong><small>Connected to knowledge units</small></div>
          <div class="metric"><span>Unlinked events</span><strong>${events.length - linkedCount}</strong><small>Candidates for later revision</small></div>
        </div>
        <div class="study-grid">
          <section>
            <div class="section-head"><h2>Recent study events</h2><span class="section-note">Area · Task · Measure remain canonical Study Director inputs.</span></div>
            ${events.length ? `<div class="record-list">${events.slice(0, 30).map((event) => `<article class="record-row"><div><div class="breadcrumb">${escapeHtml(profileMap.get(event.profileId)?.name ?? "Exam")} · ${formatDateTime(event.occurredAt)}</div><div class="row-title">${escapeHtml(event.area)} · ${escapeHtml(event.task)}</div><div class="row-meta"><span class="chip">${escapeHtml(event.activityMode)}</span><span>${escapeHtml(event.measure)}</span><span>${event.durationMinutes}m</span><span>Understanding ${event.understanding}/4</span><span>${event.linkedUnitIds.length} linked units</span></div>${event.notes ? `<p>${escapeHtml(event.notes)}</p>` : ""}</div><div class="row-actions"><button class="mini-btn" data-action="derive-unit" data-id="${event.id}">CREATE UNIT</button></div></article>`).join("")}</div>` : this.emptyState("No study events", "Log what you studied, practised or tested.")}
          </section>
          <aside class="panel info-card"><h3>Why this exists</h3><p>A timer records effort. A Study Event records the academic meaning of that effort.</p><ul><li>It anchors revision to actual learning.</li><li>It distinguishes learning, review, practice and testing.</li><li>It allows later AI or rule-based diagnosis without bloating every Plan row.</li><li>It does not itself prove retention.</li></ul></aside>
        </div>`;
    }

    private async renderHistory(): Promise<void> {
      const evidence = await this.service.evidenceEvents();
      const study = await this.service.studyEvents();
      const units = await this.service.units();
      const profiles = await this.service.profiles();
      const plans = await this.service.dailyPlanHistory();
      const unitMap = new Map(units.map((unit) => [unit.id, unit]));
      const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
      const content = this.historyTab === "evidence"
        ? (evidence.length ? `<div class="record-list">${evidence.slice(0, 80).map((event) => {
          const unit = unitMap.get(event.unitId);
          const accuracy = event.evidence.accuracyPercent === undefined ? "" : `<span>Accuracy ${roundTo(event.evidence.accuracyPercent, 0)}%</span>`;
          return `<article class="record-row"><div><div class="breadcrumb">${escapeHtml(profileMap.get(event.profileId)?.name ?? "Exam")} · ${formatDateTime(event.reviewedAt)}</div><div class="row-title">${escapeHtml(unit?.title ?? "Deleted unit")}</div><div class="row-meta"><span class="chip ${obligationChip(event.obligationType)}">${escapeHtml(obligationLabel(event.obligationType))}</span><span class="chip workflow-chip">${escapeHtml(workflowLabel(event.workflow))}</span><span>${ratingName(event.confirmedRating)}</span><span>Suggested ${ratingName(event.suggestedRating)}</span>${accuracy}<span>${formatDuration(event.elapsedMs)}</span><span>Estimate ${event.durationObservation.estimateBefore}→${event.durationObservation.estimateAfter}m</span><span>${event.durationObservation.accepted ? "duration learned" : `duration ignored: ${escapeHtml(event.durationObservation.reason)}`}</span><span>${escapeHtml(event.policyId)}</span></div><p>Evidence: completeness ${event.evidence.completeness}/4 · independence ${event.evidence.independence}/4 · application ${event.evidence.application}/4. Next: ${formatDateTime(event.afterDueAt)}.</p>${event.evidence.correctionNote ? `<p>Correction: ${escapeHtml(event.evidence.correctionNote)}</p>` : ""}</div></article>`;
        }).join("")}</div>` : this.emptyState("No retrieval evidence", "Complete a review to create evidence."))
        : (study.length ? `<div class="record-list">${study.slice(0, 80).map((event) => `<article class="record-row"><div><div class="breadcrumb">${escapeHtml(profileMap.get(event.profileId)?.name ?? "Exam")} · ${formatDateTime(event.occurredAt)}</div><div class="row-title">${escapeHtml(event.area)} · ${escapeHtml(event.task)}</div><div class="row-meta"><span class="chip">${escapeHtml(event.activityMode)}</span><span>${escapeHtml(event.measure)}</span><span>${event.durationMinutes}m</span><span>${escapeHtml(event.origin)}</span></div></div></article>`).join("")}</div>` : this.emptyState("No study history", "Log a Study Event first."));
      const planHistory = plans.length ? `<section class="section-block"><div class="section-head"><h2>Persisted daily plans</h2><span class="section-note">Original recommendation, regenerations and actual outcomes remain separate.</span></div><div class="record-list">${plans.slice(0, 14).map((plan) => { const latest = latestPlanVersion(plan); const completed = plan.outcomes.filter((outcome) => outcome.status === "completed"); const actual = completed.reduce((sum, outcome) => sum + (outcome.actualMinutes ?? 0), 0); const selected = latest.items.filter((item) => item.disposition === "selected" || item.disposition === "required-overrun"); return `<article class="record-row"><div><div class="breadcrumb">Study day ${escapeHtml(plan.studyDayKey)} · plan v${latest.version} · ${escapeHtml(plan.plannerVersion)}</div><div class="row-title">${selected.length} planned · ${completed.length} completed</div><div class="row-meta"><span>${latest.capacityMinutes}m capacity</span><span>${selected.reduce((sum, item) => sum + item.estimatedMinutes, 0)}m estimated</span><span>${roundTo(actual, 1)}m actual</span><span>${plan.versions.length} version${plan.versions.length === 1 ? "" : "s"}</span></div></div></article>`; }).join("")}</div></section>` : "";
      this.historyContent.innerHTML = `
        ${this.pageHead("AUDIT TRAIL", "History", "Study records, retrieval evidence and daily-plan history remain separate but linked.")}
        <div class="tab-bar"><button class="tab-btn ${this.historyTab === "evidence" ? "on" : ""}" data-history-tab="evidence">EVIDENCE EVENTS</button><button class="tab-btn ${this.historyTab === "study" ? "on" : ""}" data-history-tab="study">STUDY EVENTS</button></div>
        ${content}${planHistory}`;
    }

    private pluginSettingsCard(): string {
      const status = this.extensions.status();
      const pluginRows = status.registered.length
        ? status.registered.map((entry) => `<div class="dependency-status"><span>${escapeHtml(entry.name)}${entry.version ? ` · ${escapeHtml(entry.version)}` : ""}</span><strong class="${entry.state === "registered" ? "ok" : entry.state === "failed" || entry.state === "incompatible" ? "bad" : ""}">${escapeHtml(entry.state)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ""}</div>`).join("")
        : `<p class="helper">No plugins are registered in this session.</p>`;
      const fileRows = status.localFiles.length
        ? `<div class="plugin-file-list">${status.localFiles.slice(0, 8).map((entry) => `<div class="dependency-status"><span>${escapeHtml(entry.name)} · ${escapeHtml(formatFileSize(entry.size))}</span><strong class="${entry.state === "loaded" ? "ok" : entry.state === "failed" || entry.state === "rejected" ? "bad" : ""}">${escapeHtml(entry.state)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ""}</div>`).join("")}</div>`
        : "";
      return `<section class="panel settings-card"><h3>Optional plugins</h3><label class="btn file-btn">LOAD LOCAL PLUGIN<input id="load-plugin-files" type="file" accept=".js,text/javascript,application/javascript" multiple></label><p class="helper">Trusted JavaScript only. A local plugin runs with this page’s privileges, is not stored by Revision Director, and is removed by reloading the page.</p>${pluginRows}${fileRows}</section>`;
    }

    private fsrsPersonalizationCard(
      settings: AppSettings,
      summary: { cards: number; reviews: number },
    ): string {
      const personalization = effectiveFsrsPersonalization(settings);
      const profile = personalization.profile;
      const status = personalization.active ? "ACTIVE" : profile ? "STAGED" : "STOCK";
      const statusClass = personalization.active ? "ok" : "";
      const optimizer = browserFsrsOptimizerAvailability();
      const running = this.fsrsOptimizerRun !== undefined;
      const progress = this.fsrsOptimizerProgress;
      const progressText = progress
        ? `${progress.stage} · ${progress.total > 0 ? `${progress.current}/${progress.total}` : "working"}`
        : running ? "Preparing local optimizer…" : optimizer.reason;
      const progressValue = progress && progress.total > 0
        ? Math.max(0, Math.min(progress.total, progress.current))
        : 0;
      const progressMax = progress && progress.total > 0 ? progress.total : 1;
      const canOptimize = optimizer.available && !personalization.active && !running && summary.reviews > 0;
      const profileDetail = profile
        ? `<div class="dependency-status"><span>Profile</span><strong>${escapeHtml(profile.sourceSha256.slice(0, 12))}…</strong></div>
           <div class="dependency-status"><span>Held-out log loss</span><strong>${roundTo(profile.evaluation.holdout.stock.logLoss, 4)} → ${roundTo(profile.evaluation.holdout.personalized.logLoss, 4)}</strong></div>
           <div class="dependency-status"><span>Held-out RMSE bins</span><strong>${roundTo(profile.evaluation.holdout.stock.rmseBins, 4)} → ${roundTo(profile.evaluation.holdout.personalized.rmseBins, 4)}</strong></div>
           <div class="dependency-status"><span>Time-series CV</span><strong>LL ${roundTo(profile.evaluation.crossValidation.logLoss, 4)} · RMSE ${roundTo(profile.evaluation.crossValidation.rmseBins, 4)}</strong></div>`
        : `<p class="helper">No validated personalized profile is staged. Stock FSRS-7 remains authoritative.</p>`;
      const profileActions = running
        ? ""
        : personalization.active
          ? `<button class="mini-btn" type="button" data-action="deactivate-fsrs-profile">RETURN TO STOCK + REPROJECT</button>`
          : profile
            ? `<button class="mini-btn" type="button" data-action="activate-fsrs-profile">ACTIVATE + REPROJECT</button><button class="mini-btn" type="button" data-action="clear-fsrs-profile">REMOVE STAGED PROFILE</button>`
            : "";
      const localAction = personalization.active
        ? `<button class="mini-btn" type="button" disabled>RETURN TO STOCK BEFORE RE-OPTIMIZING</button>`
        : running
          ? `<button class="mini-btn" type="button" data-action="cancel-fsrs-optimization">CANCEL OPTIMIZATION</button>`
          : `<button class="mini-btn" type="button" data-action="optimize-fsrs-locally" ${canOptimize ? "" : "disabled"}>${profile ? "RE-OPTIMIZE LOCALLY" : "OPTIMIZE LOCALLY"}</button>`;
      return `<section class="panel settings-card wide" id="fsrs-personalization-card"><h3>FSRS-7 personalization</h3>
        <div class="dependency-status"><span>Weights</span><strong class="${statusClass}">${status}</strong></div>
        <div class="dependency-status"><span>Optimizer evidence</span><strong>${summary.reviews} reviews · ${summary.cards} cards</strong></div>
        <div class="dependency-status"><span>Local optimizer</span><strong class="${optimizer.available ? "ok" : ""}">${optimizer.available ? "AVAILABLE" : "OPTIONAL BUILD REQUIRED"}</strong></div>
        <div class="optimizer-progress" data-fsrs-optimizer-progress ${running ? "" : "hidden"}><div><span data-fsrs-optimizer-progress-label>${escapeHtml(progressText)}</span></div><progress data-fsrs-optimizer-progress-bar max="${progressMax}" value="${progressValue}"></progress></div>
        ${profileDetail}
        <div class="settings-actions">${localAction}<button class="mini-btn" type="button" data-action="export-fsrs-evidence">EXPORT OPTIMIZER EVIDENCE</button><label class="mini-btn file-btn ${running ? "disabled" : ""}">IMPORT VALIDATED PROFILE<input id="import-fsrs-profile" type="file" accept=".json,application/json" ${running ? "disabled" : ""}></label>${profileActions}</div>
        <p class="helper">${escapeHtml(progressText)} Local optimization uses a dedicated Worker and the pinned FSRS-7 WASM binding; review evidence does not leave the browser. The exact gate remains 64 historical training items, 64 later holdout items and 16 distinct holdout cards after conversion. A successful run is <strong>staged only</strong>; activation and atomic reprojection remain explicit.</p>
      </section>`;
    }

    private async refreshFsrsPersonalizationCard(): Promise<void> {
      const card = this.settingsContent.querySelector<HTMLElement>("#fsrs-personalization-card");
      if (!card) return;
      const summary = await this.service.optimizerEvidenceSummary();
      card.outerHTML = this.fsrsPersonalizationCard(this.service.getSettings(), summary);
      this.applyReadOnlyState();
    }

    private updateFsrsOptimizerProgress(progress: BrowserFsrsOptimizerProgress): void {
      this.fsrsOptimizerProgress = progress;
      const region = this.settingsContent.querySelector<HTMLElement>("[data-fsrs-optimizer-progress]");
      const label = this.settingsContent.querySelector<HTMLElement>("[data-fsrs-optimizer-progress-label]");
      const bar = this.settingsContent.querySelector<HTMLProgressElement>("[data-fsrs-optimizer-progress-bar]");
      if (region) region.hidden = false;
      if (label) label.textContent = `${progress.stage} · ${progress.total > 0 ? `${progress.current}/${progress.total}` : "working"}`;
      if (bar) {
        bar.max = progress.total > 0 ? progress.total : 1;
        bar.value = progress.total > 0 ? Math.max(0, Math.min(progress.total, progress.current)) : 0;
      }
    }
    private async renderSettings(): Promise<void> {
      const settings = this.service.getSettings();
      const [profiles, optimizerEvidence] = await Promise.all([
        this.service.profiles(),
        this.service.optimizerEvidenceSummary(),
      ]);
      const planningReference = studyDayStart(new Date(), settings.studyDayBoundaryHour);
      const fsrsOk = fsrsRuntimeAvailable();
      const storage = this.service.storageHealth();
      const storageUsage = storage.usageRatio === undefined ? "Usage estimate unavailable" : `${roundTo(storage.usageRatio * 100, 1)}% of browser quota used`;
      const persistenceLabel = storage.persistence === "granted" ? "Persistent storage granted" : storage.persistence === "available" ? "Persistent storage not guaranteed" : storage.persistence === "denied" ? "Persistent storage denied" : "Persistence API unavailable";
      this.settingsContent.innerHTML = `
        ${this.pageHead("SYSTEM CONTROL", "Settings", "Revision Director remains deterministic and local-first; AI can later advise without owning the record.")}
        <form id="settings-form" class="settings-grid">
          <section class="panel settings-card"><h3>Planning</h3><label>Default exam profile for new records<select name="activeProfileId" ${profiles.length ? "" : "disabled"}>${profiles.length ? profiles.map((profile) => `<option value="${profile.id}" ${profile.id === settings.activeProfileId ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join("") : '<option value="">Create an exam profile first</option>'}</select></label><label>Daily revision capacity<input name="dailyCapacityMinutes" type="number" min="5" max="600" value="${settings.dailyCapacityMinutes}"></label><label>Study-day boundary hour<input name="studyDayBoundaryHour" type="number" min="0" max="12" value="${settings.studyDayBoundaryHour}"></label></section>
          <section class="panel settings-card"><h3>Memory scheduling</h3><div class="dependency-status"><span>Policy</span><strong>Fixed retention</strong></div><label>Desired retention<input name="desiredRetention" type="number" min="0.75" max="0.97" step="0.01" value="${fixedRetentionForPolicy(settings.fsrsScheduling.policy)}"></label><div class="dependency-status"><span>Exact scheduler</span><strong class="${fsrsOk ? "ok" : "bad"}">${fsrsOk ? "ts-fsrs 6.0.0 embedded" : "Unavailable"}</strong></div><p class="helper">FSRS is routed only to memory-recall obligations. Scheduling policy and personalized weights are independent configuration axes; Cost-ADR is reserved by the scheduler contract but is not enabled in this build.</p></section>
          <section class="panel settings-card"><h3>Persistent difficulty</h3><label>Escalate to remediation after FSRS lapses<input name="difficultyRemediationLapses" type="number" min="2" max="99" value="${settings.memoryDifficultyPolicy.remediationLapses}"></label><label>Persistent difficulty after FSRS lapses<input name="difficultyPersistentLapses" type="number" min="3" max="100" value="${settings.memoryDifficultyPolicy.persistentDifficultyLapses}"></label><label class="check-option strong-check"><input name="difficultyAutomaticHold" type="checkbox" ${settings.memoryDifficultyPolicy.automaticHold.enabled ? "checked" : ""}>Hold persistent-difficulty memory out of the normal queue after successful remediation</label><label>Automatic-hold lapse threshold<input name="difficultyAutomaticHoldLapses" type="number" min="${settings.memoryDifficultyPolicy.persistentDifficultyLapses + 1}" max="1000" value="${settings.memoryDifficultyPolicy.automaticHold.lapseThreshold}"></label><p class="helper">The signal is the FSRS lapse counter: Again from Review state. Early failures still use ordinary relearning; repeated lapses escalate the remediation itself. Revision Director owns any queue hold; the FSRS card is never marked suspended.</p></section>
          ${this.fsrsPersonalizationCard(settings, optimizerEvidence)}
          <section class="panel settings-card"><h3>Add exam profile</h3><label>Name<input id="new-profile-name" placeholder="IFoS 2027, USMLE Step 1..."></label><label>Exam date<input id="new-profile-date" type="date"></label><button class="btn" type="button" data-action="add-profile">ADD PROFILE</button></section>
          <section class="panel settings-card"><h3>Backup and recovery</h3><button class="btn" type="button" data-action="export-backup">EXPORT BACKUP</button><label class="btn file-btn">IMPORT BACKUP<input id="import-backup" type="file" accept=".rdbackup,application/x-revision-director-backup,application/gzip,application/octet-stream"></label><p class="helper">Export remains one click. Import verifies and previews the file first, then requires a current-state safety copy and explicit restore confirmation.</p></section>
          ${this.pluginSettingsCard()}
          <section class="panel settings-card"><h3>Storage health</h3><div class="dependency-status"><span>IndexedDB</span><strong class="${storage.indexedDbAvailable ? "ok" : "bad"}">${storage.indexedDbAvailable ? "Available" : "Unavailable"}</strong></div><div class="dependency-status"><span>Persistence</span><strong class="${storage.persistence === "granted" ? "ok" : ""}">${escapeHtml(persistenceLabel)}</strong></div><p class="helper">${escapeHtml(storageUsage)} · ${storage.diagnosticCount} bounded diagnostic record${storage.diagnosticCount === 1 ? "" : "s"}.</p><button class="mini-btn" type="button" data-action="refresh-storage">REFRESH STORAGE STATUS</button></section>
          <section class="panel settings-card wide"><h3>Exam horizons</h3><p class="helper">Proximity affects cross-exam priority and how far the planner may bring an obligation forward. Profiles whose examination date has passed are automatically excluded until the date is updated for a new cycle.</p><div class="profile-planner-list">${profiles.filter((profile) => profile.status !== "archived").map((profile) => { const passed = Boolean(examDateTime(profile)) && daysToExamination(profile, planningReference) < 0; return `<div class="profile-planner-row" data-profile-editor="${profile.id}"><label>Profile<input data-profile-name value="${escapeHtml(profile.name)}"></label><label>Examination date<input data-profile-date type="date" value="${escapeHtml(profile.examDate)}"></label><label>Planning status<select data-profile-status><option value="active" ${profile.status === "active" ? "selected" : ""}>Active</option><option value="suspended" ${profile.status === "suspended" ? "selected" : ""}>Paused</option></select><small>${passed ? "Exam passed — excluded automatically" : profile.status === "suspended" ? "Paused manually" : "Included in planning"}</small></label><button class="mini-btn" type="button" data-action="save-profile" data-id="${profile.id}">SAVE</button></div>`; }).join("")}</div></section>
          <section class="panel settings-card wide"><h3>Policy router</h3><div class="engine-list"><div><dt>Memory recall</dt><dd>ts-fsrs 6.0.0 · FSRS-7</dd></div><div><dt>Concept reconstruction</dt><dd>Mastery policy v1</dd></div><div><dt>Application practice</dt><dd>Application policy v1</dd></div><div><dt>Performance practice</dt><dd>Performance policy v1</dd></div><div><dt>Relearn</dt><dd>Relearning policy v1</dd></div><div><dt>Freshness review</dt><dd>Freshness horizon policy v1</dd></div></div></section>
          <section class="panel settings-card wide"><h3>Retrieval workflows</h3><div class="engine-list"><div><dt>Recall</dt><dd>Closed-book response + checkpoints + cueing</dd></div><div><dt>Reconstruction</dt><dd>Structure + relationships + checkpoints</dd></div><div><dt>Questions / application</dt><dd>Attempted, correct, partial, novel and cueing</dd></div><div><dt>Diagram practice</dt><dd>Canvas or paper + labels, form and process</dd></div><div><dt>Answer writing</dt><dd>Demand, structure, content, evidence and time</dd></div><div><dt>Relearning</dt><dd>Diagnose → repair → closed-book verification</dd></div></div></section>
          <button class="btn primary settings-save" type="submit">SAVE SETTINGS</button>
        </form>`;
      this.applyReadOnlyState();
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

    private async renderReview(): Promise<void> {
      if (this.activeReviewIds.length === 0 || this.activeReviewIndex >= this.activeReviewIds.length) {
        this.stopTimer();
        const plan = await this.service.dailyPlan(new Date(), false, this.ownership.canMutate());
        this.reviewContent.innerHTML = `
          ${this.pageHead("ACTIVE RETRIEVAL", "Review", "Each workflow requires an attempt, comparison, modality-specific evidence and a confirmed outcome.")}
          ${plan.selected.length ? `<div class="queue-list planner-list">${plan.selected.map((item, index) => this.plannerRow(item, index + 1, "selected")).join("")}</div>` : this.emptyState("No active review session", "Start the daily plan from Today or select a unit from the Library.")}`;
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
        await this.renderReview();
        return;
      }
      validateWorkflowSpec(obligation.workflow, obligation.type);
      const existingDraft = this.reviewDrafts.get(obligationId);
      if (existingDraft) this.reviewPhase = existingDraft.phase;
      else this.reviewPhase = obligation.workflow.kind === "relearning" ? "relearn-repair" : "attempt";
      const path = await this.service.hierarchyPath(unit.topicNodeId);
      const profile = await this.service.profile(unit.profileId);
      this.reviewPreviews = await this.service.preview(obligation.id);
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
            ${this.workflowAssessmentPanel(obligation)}
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

    private workflowAssessmentPanel(obligation: RevisionObligation): string {
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
            const assessment = memoryDifficultyAssessment(obligation, this.service.getSettings().memoryDifficultyPolicy);
            if (assessment.level === "normal") return "";
            const label = assessment.level === "persistent-difficulty" ? "Persistent difficulty" : "Remediation";
            return `<div class="policy-box"><strong>${label}:</strong> ${assessment.fsrsLapses} FSRS lapses · ${escapeHtml(assessment.recommendedActions.map(memoryDifficultyActionLabel).join(" · "))}.</div>`;
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

    private captureReviewDraft(): void {
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
      canvas.addEventListener("pointerdown", (event) => { if (!this.requireMutable("draw this diagram")) return; canvas.setPointerCapture(event.pointerId); this.activeDiagramStroke = [point(event)]; this.diagramStrokes.push(this.activeDiagramStroke); this.redrawDiagram(canvas); });
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

    private async handleAction(element: HTMLElement): Promise<void> {
      const action = element.dataset["action"];
      try {
        const nonMutating = action === "export-backup" || action === "export-fsrs-evidence";
        if (!nonMutating && !this.requireMutable("change Revision Director data")) return;
        if (action === "add-unit") await this.openUnitDialog();
        else if (action === "log-study") await this.openStudyDialog();
        else if (action === "start-due") await this.startDueSession();
        else if (action === "review-one") await this.startObligationSession(element.dataset["id"] ?? "");
        else if (action === "review-chunk") await this.startReviewSession([`chunk:${element.dataset["id"] ?? ""}`]);
        else if (action === "regenerate-plan") { await this.service.dailyPlan(new Date(), true); await this.renderAll(); this.toast("Daily plan regenerated and previous version preserved."); }
        else if (action === "review-unit") await this.startUnitSession(element.dataset["id"] ?? "");
        else if (action === "add-obligation") await this.openObligationDialog(element.dataset["id"] ?? "");
        else if (action === "resume-persistent-difficulty") {
          await this.service.resumePersistentDifficulty(element.dataset["id"] ?? "");
          await this.renderAll();
          this.toast("Memory obligation returned to the normal queue.");
        } else if (action === "toggle-unit") {
          await this.service.updateUnitStatus(element.dataset["id"] ?? "", literalChoice(element.dataset["status"], ENTITY_STATUSES, "Unit status"));
          await this.renderAll();
          this.toast("Knowledge-unit status updated.");
        } else if (action === "derive-unit") await this.deriveUnitFromStudy(element.dataset["id"] ?? "");
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
          const obligationId = this.activeReviewIds[this.activeReviewIndex];
          assert(obligationId, "Review obligation is missing.");
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
          this.diagramStrokes = []; this.redrawDiagram(); this.scheduleActiveRetrievalSave();
        } else if (action === "diagram-undo") {
          this.diagramStrokes.pop(); this.redrawDiagram(); this.scheduleActiveRetrievalSave();
        } else if (action === "complete-chunk") await this.completeActiveChunk();
        else if (action === "rate") await this.commitRating(validateRating(Number(element.dataset["rating"])));
        else if (action === "end-session") {
          await this.endReviewSession();
          await this.openPane("today");
        } else if (action === "add-profile") await this.addProfileFromSettings();
        else if (action === "save-profile") await this.saveProfileFromSettings(element.dataset["id"] ?? "");
        else if (action === "toggle-pause") this.togglePause();
        else if (action === "refresh-storage") { await this.service.refreshStorageHealth(true); await this.renderCoordinator.invalidateAndWait("settings", "storage", "ownership"); this.toast("Storage capability refreshed."); }
        else if (action === "export-fsrs-evidence") await this.exportFsrsOptimizerEvidence();
        else if (action === "optimize-fsrs-locally") await this.optimizeFsrsLocally();
        else if (action === "cancel-fsrs-optimization") this.fsrsOptimizerRun?.cancel();
        else if (action === "activate-fsrs-profile") { await this.service.activateFsrsOptimizerProfile(); await this.renderAll(); this.toast("Personalized FSRS-7 activated and memory schedules reprojected."); }
        else if (action === "deactivate-fsrs-profile") { await this.service.deactivateFsrsOptimizerProfile(); await this.renderAll(); this.toast("Returned to stock FSRS-7 and memory schedules reprojected."); }
        else if (action === "clear-fsrs-profile") { await this.service.clearFsrsOptimizerProfile(); await this.renderAll(); this.toast("Staged FSRS optimizer profile removed."); }
        else if (action === "export-backup") await this.exportBackup();
        else if (action === "create-restore-safety") await this.createRestoreSafetyCopy();
        else if (action === "perform-restore") await this.performRestore();
        else if (action === "cancel-restore") this.cancelRestorePreview();
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Action failed.", true);
      }
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
      assert(this.requireMutable("start the daily review"), "This tab is read-only.");
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
      if (!this.requireMutable("start a retrieval session")) return;
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
      await this.openPane("review");
    }

    private async completeActiveChunk(): Promise<void> {
      if (!this.requireMutable("complete a retrieval chunk")) return;
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
          this.toast("Chunk completed. Parent scheduling remains unchanged until final synthesis.");
          this.reviewDrafts.delete(target);
          this.activeReviewIndex += 1;
          this.phaseTime = new PhaseTimeRuntime(post.timeRuntime);
          this.attemptElapsedMs = 0;
          this.diagramStrokes = [];
          if (this.activeReviewIndex >= this.activeReviewIds.length) {
            await this.endReviewSession(false);
            await this.openPane("today");
            return;
          }
          this.reviewPhase = post.phase;
          await this.service.markReviewTargetsStarted([this.activeReviewTarget()]);
          await this.renderCoordinator.invalidateAndWait("review", "sidebar", "ownership", "storage");
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
      if (!this.requireMutable("commit review evidence")) return;
      if (this.commitInFlight) return;
      this.commitInFlight = true;
      this.reviewContent.querySelectorAll<HTMLButtonElement>('[data-action="rate"]').forEach((button) => { button.disabled = true; });
      try {
        const obligationId = this.activeReviewIds[this.activeReviewIndex];
        assert(obligationId, "Review obligation is missing.");
        const obligation = await this.service.obligation(obligationId);
        const evidence = this.collectEvidence(rating, obligation);
        const suggestion = suggestRating(obligation.type, evidence);
        if (Math.abs(rating - suggestion) >= 2) {
          const proceed = window.confirm(`Objective evidence suggests ${ratingName(suggestion)}, but you selected ${ratingName(rating)}. Keep your rating?`);
          if (!proceed) return;
        }
        const commitToken = uid("commit");
        const committing = this.buildActiveRetrievalSession("committing", commitToken);
        assert(committing, "Active retrieval state is missing.");
        const post = await this.postCommitSession(commitToken);
        try {
          await this.activePersistence.flush(committing);
          const guard: ActiveCommitGuard = { sessionId: ACTIVE_RETRIEVAL_ID, expectedRevision: committing.revision, targetId: obligationId, commitToken };
          await this.service.recordEvidence(obligationId, evidence, new Date(), guard, post);
          await this.activePersistence.acceptCommittedTransition(post);
          this.activeSessionRevision = post.revision;
          this.toast(`Recorded ${ratingName(rating)}. Next obligation scheduled.`);
          this.reviewDrafts.delete(obligationId);
          this.activeReviewIndex += 1;
          this.diagramStrokes = [];
          this.phaseTime = new PhaseTimeRuntime(post.timeRuntime);
          this.attemptElapsedMs = 0;
          if (this.activeReviewIndex >= this.activeReviewIds.length) {
            await this.endReviewSession(false);
            await this.openPane("today");
            return;
          }
          this.reviewPhase = post.phase;
          await this.service.markReviewTargetsStarted([this.activeReviewTarget()]);
          await this.renderCoordinator.invalidateAndWait("review", "sidebar", "ownership", "storage");
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

    private async openUnitDialog(prefill?: Partial<UnitDraft>): Promise<void> {
      const profiles = (await this.service.profiles()).filter((profile) => profile.status === "active");
      assert(profiles.length > 0, "Create an active exam profile in Settings before adding a knowledge unit.");
      const profileSelect = formSelect(this.unitForm, "profileId");
      profileSelect.innerHTML = profiles.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.name)}</option>`).join("");
      const settings = this.service.getSettings();
      profileSelect.value = prefill?.profileId ?? settings.activeProfileId ?? profiles[0]?.id ?? "";
      formInput(this.unitForm, "subject").value = prefill?.subject ?? "";
      formInput(this.unitForm, "section").value = prefill?.section ?? "";
      formInput(this.unitForm, "topic").value = prefill?.topic ?? "";
      formInput(this.unitForm, "title").value = prefill?.title ?? "";
      formTextarea(this.unitForm, "scope").value = prefill?.scope ?? "";
      formInput(this.unitForm, "source").value = prefill?.source ?? "";
      formSelect(this.unitForm, "importance").value = String(prefill?.importance ?? 3);
      formSelect(this.unitForm, "obligationType").value = prefill?.obligationType ?? "memory-recall";
      formInput(this.unitForm, "expectedMinutes").value = String(prefill?.expectedMinutes ?? 15);
      formTextarea(this.unitForm, "protocol").value = prefill?.protocol ?? "";
      formTextarea(this.unitForm, "successCriteria").value = prefill?.successCriteria ?? "";
      formInput(this.unitForm, "firstDueAt").value = toLocalInput(prefill?.firstDueAt ?? addDays(new Date(), 1).toISOString());
      formInput(this.unitForm, "freshnessDays").value = String(prefill?.freshnessDays ?? 30);
      const unitType = prefill?.obligationType ?? "memory-recall";
      populateWorkflowForm(this.unitForm, prefill?.workflow ?? defaultWorkflowSpec(unitType, prefill?.protocol ?? "", prefill?.successCriteria ?? ""), unitType);
      this.dialogFocus.open(this.unitDialog, '[name="profileId"]');
    }

    private async submitUnit(event: SubmitEvent): Promise<void> {
      if (!this.requireMutable("save a knowledge unit")) return;
      event.preventDefault();
      try {
        const data = new FormData(this.unitForm);
        const obligationType = literalChoice(formText(data, "obligationType"), OBLIGATION_TYPES, "Obligation type");
        const workflow = workflowSpecFromForm(this.unitForm, obligationType);
        await this.service.createUnit({
          profileId: formText(data, "profileId"),
          subject: formText(data, "subject"),
          section: formText(data, "section"),
          topic: formText(data, "topic"),
          title: formText(data, "title"),
          scope: formText(data, "scope"),
          source: formText(data, "source"),
          importance: literalChoice(formNumber(data, "importance"), IMPORTANCE_LEVELS, "Importance"),
          obligationType,
          expectedMinutes: formNumber(data, "expectedMinutes"),
          protocol: formText(data, "protocol"),
          successCriteria: formText(data, "successCriteria"),
          firstDueAt: localInputToIso(formText(data, "firstDueAt")),
          freshnessDays: formNumber(data, "freshnessDays"),
          workflow,
        });
        this.dialogFocus.close(this.unitDialog);
        await this.renderAll();
        this.toast("Knowledge unit and initial obligation created.");
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Could not save the unit.", true);
      }
    }

    private async openStudyDialog(prefill?: Partial<StudyEventDraft>): Promise<void> {
      const profiles = (await this.service.profiles()).filter((profile) => profile.status === "active");
      assert(profiles.length > 0, "Create an active exam profile in Settings before logging study.");
      const units = (await this.service.units()).filter((unit) => unit.status === "active");
      const profileSelect = formSelect(this.studyForm, "profileId");
      profileSelect.innerHTML = profiles.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.name)}</option>`).join("");
      profileSelect.value = prefill?.profileId ?? this.service.getSettings().activeProfileId ?? profiles[0]?.id ?? "";
      formInput(this.studyForm, "occurredAt").value = toLocalInput(prefill?.occurredAt ?? nowIso());
      formSelect(this.studyForm, "activityMode").value = prefill?.activityMode ?? "learn";
      formInput(this.studyForm, "area").value = prefill?.area ?? "";
      formInput(this.studyForm, "task").value = prefill?.task ?? "";
      formInput(this.studyForm, "measure").value = prefill?.measure ?? "";
      formInput(this.studyForm, "source").value = prefill?.source ?? "";
      formInput(this.studyForm, "durationMinutes").value = String(prefill?.durationMinutes ?? 45);
      formSelect(this.studyForm, "understanding").value = String(prefill?.understanding ?? 3);
      formSelect(this.studyForm, "origin").value = prefill?.origin ?? "manual";
      formTextarea(this.studyForm, "notes").value = prefill?.notes ?? "";
      const linked = formSelect(this.studyForm, "linkedUnitIds");
      linked.innerHTML = units.map((unit) => `<option value="${unit.id}" ${prefill?.linkedUnitIds?.includes(unit.id) ? "selected" : ""}>${escapeHtml(unit.title)}</option>`).join("");
      this.dialogFocus.open(this.studyDialog, '[name="profileId"]');
    }

    private async submitStudy(event: SubmitEvent): Promise<void> {
      if (!this.requireMutable("save a Study Event")) return;
      event.preventDefault();
      try {
        const data = new FormData(this.studyForm);
        const linked = [...(formSelect(this.studyForm, "linkedUnitIds")).selectedOptions].map((option) => option.value);
        await this.service.logStudyEvent({
          profileId: formText(data, "profileId"),
          occurredAt: localInputToIso(formText(data, "occurredAt")),
          activityMode: literalChoice(formText(data, "activityMode"), ACTIVITY_MODES, "Study activity mode"),
          area: formText(data, "area"),
          task: formText(data, "task"),
          measure: formText(data, "measure"),
          source: formText(data, "source"),
          durationMinutes: formNumber(data, "durationMinutes"),
          understanding: literalChoice(formNumber(data, "understanding"), UNDERSTANDING_LEVELS, "Understanding"),
          linkedUnitIds: linked,
          notes: formText(data, "notes"),
          origin: literalChoice(formText(data, "origin"), STUDY_ORIGINS, "Study origin"),
        });
        this.dialogFocus.close(this.studyDialog);
        await this.renderAll();
        this.toast("Study Event recorded.");
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Could not save the Study Event.", true);
      }
    }

    private async openObligationDialog(unitId: string): Promise<void> {
      const unit = await this.service.unit(unitId);
      formInput(this.obligationForm, "unitId").value = unit.id;
      formSelect(this.obligationForm, "type").value = "application-practice";
      formInput(this.obligationForm, "expectedMinutes").value = "20";
      formTextarea(this.obligationForm, "protocol").value = "";
      formTextarea(this.obligationForm, "successCriteria").value = "";
      formInput(this.obligationForm, "dueAt").value = toLocalInput(addDays(new Date(), 1).toISOString());
      formInput(this.obligationForm, "freshnessDays").value = "30";
      populateWorkflowForm(this.obligationForm, defaultWorkflowSpec("application-practice", "", ""), "application-practice");
      this.dialogFocus.open(this.obligationDialog, '[name="type"]');
    }

    private async submitObligation(event: SubmitEvent): Promise<void> {
      if (!this.requireMutable("save a revision obligation")) return;
      event.preventDefault();
      try {
        const data = new FormData(this.obligationForm);
        const type = literalChoice(formText(data, "type"), OBLIGATION_TYPES, "Obligation type");
        const workflow = workflowSpecFromForm(this.obligationForm, type);
        await this.service.createObligation({
          unitId: formText(data, "unitId"),
          type,
          expectedMinutes: formNumber(data, "expectedMinutes"),
          protocol: formText(data, "protocol"),
          successCriteria: formText(data, "successCriteria"),
          dueAt: localInputToIso(formText(data, "dueAt")),
          freshnessDays: formNumber(data, "freshnessDays"),
          workflow,
        });
        this.dialogFocus.close(this.obligationDialog);
        await this.renderAll();
        this.toast("Revision obligation added.");
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Could not add the obligation.", true);
      }
    }

    private async deriveUnitFromStudy(eventId: string): Promise<void> {
      const event = (await this.service.studyEvents()).find((item) => item.id === eventId);
      assert(event, "Study Event not found.");
      await this.openUnitDialog({
        profileId: event.profileId,
        subject: event.area,
        section: "",
        topic: event.task,
        title: event.task,
        scope: event.measure,
        source: event.source,
        importance: 3,
        obligationType: event.activityMode === "test" || event.activityMode === "practice" ? "application-practice" : "memory-recall",
        expectedMinutes: Math.max(10, Math.min(60, Math.round(event.durationMinutes / 3))),
        protocol: "Attempt retrieval without opening the source.",
        successCriteria: "State the required material accurately and independently.",
        firstDueAt: addDays(new Date(event.occurredAt), 1).toISOString(),
        freshnessDays: 30,
        workflow: defaultWorkflowSpec(
          event.activityMode === "test" || event.activityMode === "practice" ? "application-practice" : "memory-recall",
          "Attempt retrieval without opening the source.",
          "State the required material accurately and independently."
        ),
      });
    }

    private async submitSettings(event: SubmitEvent): Promise<void> {
      if (!this.requireMutable("save settings")) return;
      event.preventDefault();
      try {
        const form = event.target;
        assert(form instanceof HTMLFormElement && form.getAttribute("id") === "settings-form", "Settings form is unavailable.");
        const data = new FormData(form);
        const current = this.service.getSettings();
        await this.service.saveSettings({
          ...current,
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          key: "app",
          activeProfileId: formText(data, "activeProfileId"),
          fsrsScheduling: {
            ...current.fsrsScheduling,
            policy: { kind: "fixed-retention", desiredRetention: formNumber(data, "desiredRetention") },
          },
          memoryDifficultyPolicy: {
            remediationLapses: formNumber(data, "difficultyRemediationLapses"),
            persistentDifficultyLapses: formNumber(data, "difficultyPersistentLapses"),
            automaticHold: {
              enabled: data.has("difficultyAutomaticHold"),
              lapseThreshold: formNumber(data, "difficultyAutomaticHoldLapses"),
            },
          },
          dailyCapacityMinutes: formNumber(data, "dailyCapacityMinutes"),
          studyDayBoundaryHour: formNumber(data, "studyDayBoundaryHour"),
        });
        await this.renderAll();
        this.toast("Settings saved.");
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Could not save settings.", true);
      }
    }

    private async saveProfileFromSettings(profileId: string): Promise<void> {
      if (!this.requireMutable("update an exam profile")) return;
      const editor = this.settingsContent.querySelector<HTMLElement>(`[data-profile-editor="${CSS.escape(profileId)}"]`);
      assert(editor, "Exam profile editor is unavailable.");
      const nameInput = editor.querySelector<HTMLInputElement>("[data-profile-name]");
      const dateInput = editor.querySelector<HTMLInputElement>("[data-profile-date]");
      const statusInput = editor.querySelector<HTMLSelectElement>("[data-profile-status]");
      assert(nameInput && dateInput && statusInput, "Exam profile inputs are unavailable.");
      const name = nameInput.value;
      const examDate = dateInput.value;
      const status = statusInput.value === "suspended" ? "suspended" : "active";
      await this.service.updateProfile(profileId, name, examDate, status);
      await this.renderAll();
      this.toast("Exam horizon updated; today’s plan recalculated.");
    }

    private async addProfileFromSettings(): Promise<void> {
      if (!this.requireMutable("create an exam profile")) return;
      const name = this.settingsContent.querySelector<HTMLInputElement>("#new-profile-name")?.value ?? "";
      const date = this.settingsContent.querySelector<HTMLInputElement>("#new-profile-date")?.value ?? "";
      await this.service.createProfile(name, date);
      await this.renderAll();
      this.toast("Exam profile created.");
    }

    private async flushCurrentRetrievalForBackup(): Promise<void> {
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

    private async loadPluginFiles(input: HTMLInputElement): Promise<void> {
      if (!this.requireMutable("load a plugin")) { input.value = ""; return; }
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      try {
        const results = await this.extensions.loadLocalFiles(files);
        const registered = results.filter((entry) => entry.state === "loaded").length;
        const failed = results.filter((entry) => entry.state === "failed" || entry.state === "rejected").length;
        this.toast(`${registered} plugin file${registered === 1 ? "" : "s"} loaded${failed ? ` · ${failed} failed or rejected` : ""}.`, failed > 0 && registered === 0);
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Plugin loading failed.", true);
      } finally {
        input.value = "";
        await this.renderCoordinator.invalidateAndWait("settings", "ownership");
      }
    }

    private async optimizeFsrsLocally(): Promise<void> {
      assert(this.requireMutable("optimize and stage personalized FSRS-7 weights"), "This tab is read-only.");
      assert(!this.fsrsOptimizerRun, "FSRS optimization is already running.");
      const personalization = effectiveFsrsPersonalization(this.service.getSettings());
      assert(!personalization.active, "Return to stock FSRS-7 before optimizing a replacement profile.");
      const availability = browserFsrsOptimizerAvailability();
      assert(availability.available, availability.reason);

      const [csv, summary] = await Promise.all([
        this.service.optimizerEvidenceCsv(),
        this.service.optimizerEvidenceSummary(),
      ]);
      assert(summary.reviews > 0, "No memory-review evidence is available for optimization.");

      this.fsrsOptimizerProgress = { stage: "Preparing local evidence", current: 0, total: 0 };
      const run = startBrowserFsrsOptimizer(csv, {
        onProgress: (progress) => this.updateFsrsOptimizerProgress(progress),
      });
      this.fsrsOptimizerRun = run;
      await this.refreshFsrsPersonalizationCard();

      try {
        const profile = await run.promise;
        assert(this.requireMutable("stage the locally optimized FSRS-7 profile"), "Review control changed before optimizer staging.");
        const staged = await this.service.stageFsrsOptimizerProfile(profile);
        this.toast(`Local FSRS-7 optimization passed the holdout gate · ${staged.evidenceItems} optimizer items. Profile staged; activation remains explicit.`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          if (this.ownership.canMutate()) this.toast("FSRS optimization cancelled.");
        } else if (error instanceof FsrsOptimizerRejectedError) {
          this.toast(`Personalized FSRS-7 was not staged · ${error.reasons.join("; ")}`, true);
        } else {
          this.toast(error instanceof Error ? error.message : "Local FSRS optimization failed.", true);
        }
      } finally {
        if (this.fsrsOptimizerRun === run) this.fsrsOptimizerRun = undefined;
        this.fsrsOptimizerProgress = undefined;
        await this.refreshFsrsPersonalizationCard();
      }
    }

    private async exportFsrsOptimizerEvidence(): Promise<void> {
      const [csv, summary] = await Promise.all([
        this.service.optimizerEvidenceCsv(),
        this.service.optimizerEvidenceSummary(),
      ]);
      assert(summary.reviews > 0, "No memory-review evidence is available for optimizer export.");
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(`revision-director-fsrs-evidence-${date}.csv`, csv, "text/csv;charset=utf-8");
      this.toast(`FSRS optimizer evidence exported · ${summary.reviews} reviews across ${summary.cards} cards.`);
    }

    private async importFsrsOptimizerProfile(input: HTMLInputElement): Promise<void> {
      if (!this.requireMutable("stage an FSRS optimizer profile")) { input.value = ""; return; }
      const file = input.files?.[0];
      if (!file) return;
      try {
        assert(file.size <= 64 * 1024, "FSRS optimizer profile exceeds the 64 KiB limit.");
        const parsed: unknown = JSON.parse(await file.text());
        const profile = await this.service.stageFsrsOptimizerProfile(parsed);
        await this.renderAll();
        this.toast(`Validated FSRS-7 profile staged · ${profile.evidenceItems} optimizer items. Activation remains explicit.`);
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "FSRS optimizer profile import failed.", true);
      } finally {
        input.value = "";
      }
    }
    private async exportBackup(): Promise<void> {
      await this.flushCurrentRetrievalForBackup();
      const archive = await this.backupController.createVerified(true);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(`revision-director-backup-${date}.rdbackup`, archive.bytes, BACKUP_ARCHIVE_MIME);
      this.toast(`Verified backup exported · ${archive.inspection.totalDocuments} documents · ${formatFileSize(archive.inspection.compressedBytes)}.`);
    }

    private async importBackup(event: Event): Promise<void> {
      if (!this.requireMutable("restore a backup")) return;
      const target = event.target;
      assert(target instanceof HTMLInputElement, "Backup file input is unavailable.");
      const input = target;
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const candidate = await this.backupController.inspect(bytes);
        this.restoreCandidateId = candidate.id;
        this.restoreSafetyProofId = "";
        this.renderRestorePreview(candidate);
        this.dialogFocus.open(this.restoreDialog, '[data-action="create-restore-safety"]');
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Backup inspection failed.", true);
      } finally {
        input.value = "";
      }
    }

    private renderRestorePreview(candidate: InspectedBackupCandidate): void {
      const inspection = candidate.inspection;
      const active = candidate.payload.activeRetrieval;
      const warnings = inspection.warnings.length ? `<div class="restore-step restore-warning"><h3>Verification notes</h3>${inspection.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>` : "";
      const activeSection = active ? `<section class="restore-step"><h3>Unfinished retrieval in backup</h3><p>${escapeHtml(active.activeTargetId)} · ${escapeHtml(this.phaseLabel(active.phase))} · revision ${active.revision}</p><div class="restore-session-options"><label class="restore-check"><input type="radio" name="restore-active-treatment" value="restore">Restore this unfinished retrieval after replacement</label><label class="restore-check"><input type="radio" name="restore-active-treatment" value="discard">Discard it and restore records only</label></div></section>` : `<section class="restore-step"><h3>Active retrieval</h3><p>This backup contains no unfinished retrieval session.</p></section>`;
      this.restorePreview.innerHTML = `
        <section class="restore-step"><h3>Verified restore preview</h3><p>The file has been decoded, integrity-checked and relationally validated. No application data has been changed.</p><div class="restore-summary">
          <div class="restore-stat"><span>Created</span><strong>${escapeHtml(formatDateTime(inspection.exportedAt))}</strong></div>
          <div class="restore-stat"><span>Knowledge units</span><strong>${inspection.counts.units}</strong></div>
          <div class="restore-stat"><span>Evidence events</span><strong>${inspection.counts.evidenceEvents}</strong></div>
          <div class="restore-stat"><span>Total documents</span><strong>${inspection.totalDocuments}</strong></div>
          <div class="restore-stat"><span>Archive</span><strong>${escapeHtml(inspection.compression.toUpperCase())} · ${escapeHtml(formatFileSize(inspection.compressedBytes))}</strong></div>
          <div class="restore-stat"><span>Verification</span><strong>${escapeHtml(inspection.hashAlgorithm.toUpperCase())}</strong></div>
        </div><p class="restore-proof">Archive checksum: ${escapeHtml(inspection.archiveChecksum)}</p></section>
        ${warnings}${activeSection}
        <section class="restore-step" id="restore-safety-step"><h3>Preserve the current state first</h3><p>Download a verified current-state backup before replacement. If the current database is damaged, Revision Director will create a non-importable forensic rescue instead.</p><button class="btn primary" type="button" data-action="create-restore-safety">DOWNLOAD CURRENT SAFETY COPY</button><div id="restore-safety-result"></div><label class="restore-check"><input id="restore-safety-saved" type="checkbox" disabled>I have saved the downloaded current-state safety copy</label></section>
        <section class="restore-step restore-warning"><h3>Explicit replacement confirmation</h3><label class="restore-check"><input id="restore-replace-confirm" type="checkbox">I understand that all current Revision Director records will be replaced by this verified backup.</label></section>
        <div class="restore-dialog-actions"><button class="btn" type="button" data-action="cancel-restore">CANCEL</button><button class="btn primary" id="restore-final-button" type="button" data-action="perform-restore" disabled>RESTORE VERIFIED BACKUP</button></div>`;
      this.applyReadOnlyState();
    }

    private async createRestoreSafetyCopy(): Promise<void> {
      assert(this.restoreCandidateId, "No inspected backup is available.");
      await this.flushCurrentRetrievalForBackup();
      const artifact = await this.backupController.createSafetyCopy(this.restoreCandidateId);
      this.restoreSafetyProofId = artifact.proofId;
      downloadBlob(artifact.filename, artifact.bytes, artifact.mimeType);
      const result = this.restorePreview.querySelector<HTMLElement>("#restore-safety-result");
      if (result) result.innerHTML = `<p class="${artifact.kind === "forensic-rescue" ? "bad" : "ok"}">${artifact.kind === "verified-backup" ? "Verified safety backup downloaded." : "Forensic rescue downloaded. It preserves raw state but cannot be imported automatically."}</p>${artifact.warning ? `<p>${escapeHtml(artifact.warning)}</p>` : ""}<p class="restore-proof">Proof expires ${escapeHtml(formatDateTime(artifact.expiresAt))}.</p>`;
      const saved = this.restorePreview.querySelector<HTMLInputElement>("#restore-safety-saved");
      if (saved) { saved.disabled = false; saved.checked = false; saved.focus(); }
      this.updateRestoreActionState();
    }

    private updateRestoreActionState(): void {
      const candidate = this.restoreCandidateId ? this.backupController.candidate(this.restoreCandidateId) : undefined;
      const safetySaved = this.restorePreview.querySelector<HTMLInputElement>("#restore-safety-saved")?.checked ?? false;
      const replacementConfirmed = this.restorePreview.querySelector<HTMLInputElement>("#restore-replace-confirm")?.checked ?? false;
      const treatmentSelected = !candidate?.payload.activeRetrieval || Boolean(this.restorePreview.querySelector<HTMLInputElement>('input[name="restore-active-treatment"]:checked'));
      const button = this.restorePreview.querySelector<HTMLButtonElement>("#restore-final-button");
      if (button) button.disabled = !(this.restoreSafetyProofId && safetySaved && replacementConfirmed && treatmentSelected && this.ownership.canMutate());
    }

    private async performRestore(): Promise<void> {
      assert(this.requireMutable("restore a backup"), "This tab is read-only.");
      assert(this.restoreCandidateId && this.restoreSafetyProofId, "Complete the safety-copy step before restoring.");
      const candidate = this.backupController.candidate(this.restoreCandidateId);
      const treatment = candidate.payload.activeRetrieval
        ? literalChoice(this.restorePreview.querySelector<HTMLInputElement>('input[name="restore-active-treatment"]:checked')?.value, BACKUP_ACTIVE_SESSION_TREATMENTS, "Active retrieval restore treatment")
        : "discard";
      const proceed = window.confirm("Final confirmation: replace all current Revision Director records with this verified backup?");
      if (!proceed) return;
      const result = await this.backupController.restore(this.restoreCandidateId, this.restoreSafetyProofId, treatment);
      this.activePersistence.resetEmergencyAfterRestore(result.restoredActiveRetrieval);
      this.restoreCandidateId = "";
      this.restoreSafetyProofId = "";
      this.dialogFocus.close(this.restoreDialog);
      await this.hydrateCanonicalState("takeover");
      this.toast(result.restoredActiveRetrieval ? "Verified backup restored with its unfinished retrieval." : "Verified backup restored.");
    }

    private cancelRestorePreview(): void {
      this.backupController.cancel(this.restoreCandidateId || undefined);
      this.restoreCandidateId = "";
      this.restoreSafetyProofId = "";
      if (this.restoreDialog.open) this.dialogFocus.close(this.restoreDialog);
    }



    private handleKeyboard(event: KeyboardEvent): void {
      if (!this.ownership.canMutate()) return;
      if (this.currentPane !== "review" || this.activeReviewIds.length === 0) return;
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

    private toast(message: string, error = false): void {
      this.toastElement.textContent = message;
      this.toastElement.classList.toggle("error", error);
      this.toastElement.classList.add("show");
      window.setTimeout(() => this.toastElement.classList.remove("show"), 3000);
    }
  }

  /* ========================================================================== 
     VALIDATED STUDY DIRECTOR BRIDGE
     ========================================================================== */

