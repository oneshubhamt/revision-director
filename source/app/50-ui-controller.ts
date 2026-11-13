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
    private ownershipSnapshot: ReviewOwnershipSnapshot;
    private planSnapshot: DailyRevisionPlan | undefined;

    private readonly todayContent = requiredElement("#today-content", HTMLDivElement);
    private readonly reviewContent = requiredElement("#review-content", HTMLDivElement);
    private readonly libraryContent = requiredElement("#library-content", HTMLDivElement);
    private readonly studyContent = requiredElement("#study-content", HTMLDivElement);
    private readonly historyContent = requiredElement("#history-content", HTMLDivElement);
    private readonly toastElement = requiredElement("#toast", HTMLDivElement);
    private readonly gapOverlay = requiredElement("#gap-overlay", HTMLDivElement);
    private readonly gapMeta = requiredElement("#gap-meta", HTMLDivElement);
    private readonly gapSplit = requiredElement("#gap-split", HTMLDivElement);
    private readonly gapFocusMinutes = requiredElement("#gap-focus-minutes", HTMLInputElement);
    private readonly unitDialog = requiredElement("#unit-dialog", HTMLDialogElement);
    private readonly studyDialog = requiredElement("#study-dialog", HTMLDialogElement);
    private readonly obligationDialog = requiredElement("#obligation-dialog", HTMLDialogElement);
    private readonly restoreDialog = requiredElement("#restore-dialog", HTMLDialogElement);
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
    private readonly activeRetrieval: ActiveRetrievalWorkspace;
    private readonly settingsWorkspace: SettingsWorkspace;

    constructor(
      private readonly service: RevisionService,
      activePersistence: ActiveRetrievalPersistence,
      private readonly ownership: ReviewOwnershipCoordinator,
      backupController: BackupController,
      extensions: ExtensionRuntime,
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
      this.activeRetrieval = new ActiveRetrievalWorkspace(
        this.service,
        activePersistence,
        this.ownership,
        this.reviewContent,
        this.gapMeta,
        this.gapSplit,
        this.gapFocusMinutes,
        this.gapFocus,
        {
          requireMutable: (reason) => this.requireMutable(reason),
          openPane: (pane) => this.openPane(pane),
          renderIdleReview: () => this.renderIdleReview(),
          invalidateAfterCommit: () => this.ensurePlanningAndRender("review", "library", "history"),
          toast: (message, error) => this.toast(message, error),
        },
      );
      this.settingsWorkspace = new SettingsWorkspace(
        this.service,
        this.ownership,
        backupController,
        extensions,
        requiredElement("#settings-content", HTMLDivElement),
        this.restoreDialog,
        requiredElement("#restore-preview", HTMLDivElement),
        this.dialogFocus,
        {
          requireMutable: (reason) => this.requireMutable(reason),
          ensurePlanningAndRender: (...domains) => this.ensurePlanningAndRender(...domains),
          invalidate: (...domains) => this.renderCoordinator.invalidateAndWait(...domains),
          applyReadOnlyState: () => this.applyReadOnlyState(),
          pageHead: (kicker, title, subtitle) => this.pageHead(kicker, title, subtitle),
          toast: (message, error) => this.toast(message, error),
          hydrateCanonicalState: (reason) => this.hydrateCanonicalState(reason),
          flushActiveRetrievalForBackup: () => this.activeRetrieval.flushForBackup(),
          resetActiveRetrievalAfterRestore: (session) => this.activeRetrieval.resetEmergencyAfterRestore(session),
        },
      );
      this.registerRenderDomains();
    }

    async start(): Promise<void> {
      this.bindStaticEvents();
      this.tabRegistry.initialize(this.currentPane);
      this.startClock();
      await this.renderAll();
      await this.ownership.start({
        flush: () => this.activeRetrieval.flushForOwnershipRelease(),
        hydrate: (reason) => this.hydrateCanonicalState(reason),
        changed: (snapshot) => this.handleOwnershipChanged(snapshot),
      });
      this.handleOwnershipChanged(this.ownership.snapshot());
    }


    private registerRenderDomains(): void {
      this.renderCoordinator.register("plan", () => this.refreshPlanSnapshot());
      this.renderCoordinator.register("today", () => this.renderToday());
      this.renderCoordinator.register("review", () => this.activeRetrieval.render());
      this.renderCoordinator.register("library", () => this.renderLibrary());
      this.renderCoordinator.register("study", () => this.renderStudy());
      this.renderCoordinator.register("history", () => this.renderHistory());
      this.renderCoordinator.register("settings", () => this.settingsWorkspace.render());
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
          this.activeRetrieval.forceSaveForLifecycle("visibility");
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
        await this.activeRetrieval.handleGapAction(gapAction);
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
      else await this.settingsWorkspace.submit(event);
    }


    private async handleDelegatedInput(event: Event): Promise<void> {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id === "library-search") {
        this.libraryFilter = target.value;
        this.renderCoordinator.invalidateDebounced("library-search", 160, "library", "ownership");
        return;
      }
      await this.activeRetrieval.updateInputs(target);
    }

    private async handleDelegatedChange(event: Event): Promise<void> {
      if (await this.settingsWorkspace.handleChange(event)) return;
      const target = event.target;
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
      await this.activeRetrieval.updateInputs(target);
    }

    private handleDelegatedKeydown(event: KeyboardEvent): void {
      if (this.gapFocus.handleKeydown(event)) return;
      if (this.tabRegistry.handleKeydown(event)) return;
      if (event.target === this.gapFocusMinutes && event.key === "Enter") {
        event.preventDefault();
        void this.activeRetrieval.handleGapAction("apply-split");
        return;
      }
      if (this.currentPane === "review") this.activeRetrieval.handleKeyboard(event);
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
        this.activeRetrieval.stopForOwnershipLoss();
        this.settingsWorkspace.handleOwnershipLoss();
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
      this.renderCoordinator.invalidate("ownership", "storage");
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
      if (this.ownership.canMutate()) this.activeRetrieval.reconcileAndPersist(source);
      await this.renderCoordinator.invalidateAndWait("storage", "ownership");
    }

    private async handlePageExit(): Promise<void> {
      this.settingsWorkspace.handlePageExit();
      this.activeRetrieval.forceSaveForLifecycle("snapshot");
      await this.ownership.releaseForExit();
    }


    private async hydrateCanonicalState(reason: ReviewOwnershipHydrationReason): Promise<void> {
      this.activeRetrieval.resetLocalState();
      await this.service.initialize();
      this.planSnapshot = await this.service.ensureDailyPlan(new Date());
      await this.renderAll(false);
      await this.activeRetrieval.recoverUnfinishedSession(reason === "startup");
      await this.renderCoordinator.invalidateAndWait("storage", "ownership");
    }


    private startClock(): void {
      const clock = requiredElement("#clock", HTMLDivElement);
      const update = () => { clock.textContent = new Date().toLocaleTimeString("en-IN", { hour12: false }); };
      update();
      window.setInterval(update, 1000);
    }

    private async openPane(pane: PaneId): Promise<void> {
      if (this.currentPane === "review" && pane !== "review") this.activeRetrieval.captureDraft();
      this.currentPane = pane;
      this.tabRegistry.activate(pane);
      await this.renderPane(pane);
    }

    private async renderAll(refreshPlan = true): Promise<void> {
      const domains: RenderDomain[] = [
        "today", "review", "library", "study", "history", "settings", "sidebar", "ownership", "storage",
      ];
      if (refreshPlan) domains.unshift("plan");
      await this.renderCoordinator.invalidateAndWait(...domains);
    }

    private async renderPane(pane: PaneId): Promise<void> {
      const domains: RenderDomain[] = [pane, "sidebar", "ownership", "storage"];
      if (pane === "today" || pane === "review" || !this.planSnapshot) domains.unshift("plan");
      await this.renderCoordinator.invalidateAndWait(...domains);
    }

    private async refreshPlanSnapshot(): Promise<void> {
      this.planSnapshot = await this.service.calculateDailyPlan(new Date());
    }

    private currentPlanSnapshot(): DailyRevisionPlan {
      assert(this.planSnapshot, "Daily plan snapshot is unavailable.");
      return this.planSnapshot;
    }

    private async renderAfterPlanningMutation(...extraDomains: RenderDomain[]): Promise<void> {
      const domains = new Set<RenderDomain>(["sidebar", ...extraDomains]);
      if (this.currentPane === "today" || this.currentPane === "review") domains.add(this.currentPane);
      await this.renderCoordinator.invalidateAndWait(...domains);
    }

    private async ensurePlanningAndRender(...extraDomains: RenderDomain[]): Promise<void> {
      this.planSnapshot = await this.service.ensureDailyPlan(new Date());
      await this.renderAfterPlanningMutation(...extraDomains);
    }

    private async regeneratePlanningAndRender(...extraDomains: RenderDomain[]): Promise<void> {
      this.planSnapshot = await this.service.regenerateDailyPlan(new Date());
      await this.renderAfterPlanningMutation(...extraDomains);
    }

    private async renderSidebar(): Promise<void> {
      const plan = this.currentPlanSnapshot();
      const units = (await this.service.units()).filter((unit) => unit.status === "active");
      requiredElement("#sb-due", HTMLElement).textContent = String(plan.selected.length);
      requiredElement("#sb-units", HTMLElement).textContent = String(units.length);
      requiredElement("#sb-load", HTMLElement).textContent = `${plan.plannedMinutes}m`;
    }

    private pageHead(eyebrow: string, title: string, description: string, actions = ""): string {
      return `<header class="page-head"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="actions">${actions}</div></header>`;
    }

    private async renderToday(): Promise<void> {
      const plan = this.currentPlanSnapshot();
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
        <div class="row-actions"><button class="mini-btn" data-action="${item.chunk ? "review-chunk" : "review-one"}" data-id="${escapeHtml(item.chunk?.id ?? joined.obligation.id)}">${item.chunk ? "WORK CHUNK" : actionLabel}</button></div>
      </article>`;
    }


    private emptyState(title: string, message: string): string {
      return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
    }

    private async renderLibrary(): Promise<void> {
      const settings = this.service.getSettings();
      const [profiles, allUnits, nodes, obligations, evidenceEvents] = await Promise.all([
        this.service.profiles(),
        this.service.units(),
        this.service.nodes(),
        this.service.obligations(),
        this.service.evidenceEvents(),
      ]);
      const units = allUnits.filter((unit) => unit.status !== "archived");
      const memoryReviews = memoryReviewObservationIndex(evidenceEvents);
      const nodeMap = new Map(nodes.map((node) => [node.id, node]));
      const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
      const obligationsByUnit = new Map<string, RevisionObligation[]>();
      for (const obligation of obligations) {
        const list = obligationsByUnit.get(obligation.unitId);
        if (list) list.push(obligation);
        else obligationsByUnit.set(obligation.unitId, [obligation]);
      }
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
            const allUnitObligations = obligationsByUnit.get(unit.id) ?? [];
            const unitObligations = allUnitObligations.filter((obligation) => obligation.status === "active");
            const memoryObligations = allUnitObligations.filter((obligation) => obligation.type === "memory-recall" && obligation.status !== "archived");
            const difficultyPanels = memoryObligations.map((obligation) => {
              const assessment = memoryDifficultyAssessment(
                obligation,
                settings.memoryDifficultyPolicy,
                memoryReviews.get(obligation.id) ?? [],
              );
              if (assessment.level === "normal") return "";
              const label = assessment.level === "persistent-difficulty"
                ? "Persistent difficulty"
                : assessment.level === "remediation"
                  ? "Remediation"
                  : "Early learning difficulty";
              const burden = assessment.level === "learning-difficulty"
                ? `${assessment.earlyLearningFailures} failed learning recalls`
                : `${assessment.establishedLapses} established recall failures`;
              const actions = assessment.recommendedActions.map(memoryDifficultyActionLabel).join(" · ");
              return `<div class="policy-box"><strong>${label} · ${burden}.</strong> ${escapeHtml(actions)}.</div>`;
            }).join("");
            const heldMemory = memoryObligations.filter((obligation) => obligation.status === "suspended" && obligation.suspensionReason === "persistent-difficulty");
            return `<article class="unit-row"><div><div class="breadcrumb">${escapeHtml(profileMap.get(unit.profileId)?.name ?? "Exam")} · ${escapeHtml(subject?.name ?? "")} › ${escapeHtml(section?.name ?? "")} › ${escapeHtml(topic?.name ?? "")}</div><div class="row-title">${escapeHtml(unit.title)}</div><p>${escapeHtml(unit.scope)}</p><div class="row-meta">${unitObligations.map((obligation) => `<span class="chip ${obligationChip(obligation.type)}">${escapeHtml(obligationLabel(obligation.type))}</span><span class="chip workflow-chip">${escapeHtml(workflowLabel(obligation.workflow.kind))}</span>`).join("")}<span>${unit.evidenceCount} evidence events</span><span>${unit.lapseCount} failures</span></div>${difficultyPanels}</div><div class="row-actions"><button class="mini-btn" data-action="review-unit" data-id="${escapeHtml(unit.id)}">REVIEW</button><button class="mini-btn" data-action="add-obligation" data-id="${escapeHtml(unit.id)}">ADD OBLIGATION</button>${heldMemory.map((obligation) => `<button class="mini-btn" data-action="resume-persistent-difficulty" data-id="${escapeHtml(obligation.id)}">RESUME MEMORY</button>`).join("")}<button class="mini-btn" data-action="toggle-unit" data-id="${escapeHtml(unit.id)}" data-status="${unit.status === "active" ? "suspended" : "active"}">${unit.status === "active" ? "SUSPEND" : "ACTIVATE"}</button></div></article>`;
          }).join("")}</div>` : this.emptyState("No matching knowledge", "Create a unit or change the search filter.")}</div>
        </div>`;
    }

    private async renderStudy(): Promise<void> {
      const [events, profiles] = await Promise.all([
        this.service.studyEvents(),
        this.service.profiles(),
      ]);
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
            ${events.length ? `<div class="record-list">${events.slice(0, 30).map((event) => `<article class="record-row"><div><div class="breadcrumb">${escapeHtml(profileMap.get(event.profileId)?.name ?? "Exam")} · ${formatDateTime(event.occurredAt)}</div><div class="row-title">${escapeHtml(event.area)} · ${escapeHtml(event.task)}</div><div class="row-meta"><span class="chip">${escapeHtml(event.activityMode)}</span><span>${escapeHtml(event.measure)}</span><span>${event.durationMinutes}m</span><span>Understanding ${event.understanding}/4</span><span>${event.linkedUnitIds.length} linked units</span></div>${event.notes ? `<p>${escapeHtml(event.notes)}</p>` : ""}</div><div class="row-actions"><button class="mini-btn" data-action="derive-unit" data-id="${escapeHtml(event.id)}">CREATE UNIT</button></div></article>`).join("")}</div>` : this.emptyState("No study events", "Log what you studied, practised or tested.")}
          </section>
          <aside class="panel info-card"><h3>Why this exists</h3><p>A timer records effort. A Study Event records the academic meaning of that effort.</p><ul><li>It anchors revision to actual learning.</li><li>It distinguishes learning, review, practice and testing.</li><li>It allows later AI or rule-based diagnosis without bloating every Plan row.</li><li>It does not itself prove retention.</li></ul></aside>
        </div>`;
    }

    private async renderHistory(): Promise<void> {
      const [evidence, study, units, profiles, plans] = await Promise.all([
        this.service.evidenceEvents(),
        this.service.studyEvents(),
        this.service.units(),
        this.service.profiles(),
        this.service.dailyPlanHistory(),
      ]);
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



    private async renderIdleReview(): Promise<void> {
      const plan = this.currentPlanSnapshot();
      this.reviewContent.innerHTML = `
        ${this.pageHead("ACTIVE RETRIEVAL", "Review", "Each workflow requires an attempt, comparison, modality-specific evidence and a confirmed outcome.")}
        ${plan.selected.length ? `<div class="queue-list planner-list">${plan.selected.map((item, index) => this.plannerRow(item, index + 1, "selected")).join("")}</div>` : this.emptyState("No active review session", "Start the daily plan from Today or select a unit from the Library.")}`;
    }

    private async handleAction(element: HTMLElement): Promise<void> {
      const action = element.dataset["action"];
      try {
        if (await this.activeRetrieval.handleAction(element)) return;
        if (await this.settingsWorkspace.handleAction(element)) return;
        if (!this.requireMutable("change Revision Director data")) return;
        if (action === "add-unit") await this.openUnitDialog();
        else if (action === "log-study") await this.openStudyDialog();
        else if (action === "regenerate-plan") { await this.regeneratePlanningAndRender("history"); this.toast("Daily plan regenerated and previous version preserved."); }
        else if (action === "add-obligation") await this.openObligationDialog(element.dataset["id"] ?? "");
        else if (action === "resume-persistent-difficulty") {
          await this.service.resumePersistentDifficulty(element.dataset["id"] ?? "");
          await this.ensurePlanningAndRender("library");
          this.toast("Memory obligation returned to the normal queue.");
        } else if (action === "toggle-unit") {
          await this.service.updateUnitStatus(element.dataset["id"] ?? "", literalChoice(element.dataset["status"], ENTITY_STATUSES, "Unit status"));
          await this.ensurePlanningAndRender("library");
          this.toast("Knowledge-unit status updated.");
        } else if (action === "derive-unit") await this.deriveUnitFromStudy(element.dataset["id"] ?? "");
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Action failed.", true);
      }
    }


    private async openUnitDialog(prefill?: Partial<UnitDraft>): Promise<void> {
      const profiles = (await this.service.profiles()).filter((profile) => profile.status === "active");
      assert(profiles.length > 0, "Create an active exam profile in Settings before adding a knowledge unit.");
      const profileSelect = formSelect(this.unitForm, "profileId");
      profileSelect.innerHTML = profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join("");
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
        await this.ensurePlanningAndRender("library");
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
      profileSelect.innerHTML = profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join("");
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
      linked.innerHTML = units.map((unit) => `<option value="${escapeHtml(unit.id)}" ${prefill?.linkedUnitIds?.includes(unit.id) ? "selected" : ""}>${escapeHtml(unit.title)}</option>`).join("");
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
        await this.renderCoordinator.invalidateAndWait("study", "history");
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
        await this.ensurePlanningAndRender("library");
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

