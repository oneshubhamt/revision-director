  /* ==========================================================================
     SETTINGS WORKSPACE · SYSTEM SETTINGS, PERSONALIZATION, PLUGINS & BACKUP UI
     ========================================================================== */

  const SETTINGS_WORKSPACE_ACTIONS = new Set<string>([
    "add-profile",
    "save-profile",
    "refresh-storage",
    "export-fsrs-evidence",
    "optimize-fsrs-locally",
    "cancel-fsrs-optimization",
    "activate-fsrs-profile",
    "deactivate-fsrs-profile",
    "clear-fsrs-profile",
    "export-backup",
    "create-restore-safety",
    "perform-restore",
    "cancel-restore",
  ]);

  interface SettingsWorkspaceHost {
    requireMutable(reason: string): boolean;
    ensurePlanningAndRender(...extraDomains: RenderDomain[]): Promise<void>;
    invalidate(...domains: RenderDomain[]): Promise<void>;
    applyReadOnlyState(): void;
    pageHead(kicker: string, title: string, subtitle: string): string;
    toast(message: string, error?: boolean): void;
    hydrateCanonicalState(reason: ReviewOwnershipHydrationReason): Promise<void>;
    flushActiveRetrievalForBackup(): Promise<void>;
    resetActiveRetrievalAfterRestore(session: ActiveRetrievalSession | null): void;
  }

  class SettingsWorkspace {
    private restoreCandidateId = "";
    private restoreSafetyProofId = "";
    private fsrsOptimizerRun: BrowserFsrsOptimizerRun | undefined;
    private fsrsOptimizerProgress: BrowserFsrsOptimizerProgress | undefined;

    constructor(
      private readonly service: RevisionService,
      private readonly ownership: ReviewOwnershipCoordinator,
      private readonly backupController: BackupController,
      private readonly extensions: ExtensionRuntime,
      private readonly settingsContent: HTMLDivElement,
      private readonly restoreDialog: HTMLDialogElement,
      private readonly restorePreview: HTMLDivElement,
      private readonly dialogFocus: NativeDialogFocusManager,
      private readonly host: SettingsWorkspaceHost,
    ) {}

    handleOwnershipLoss(): void {
      this.fsrsOptimizerRun?.cancel();
    }

    handlePageExit(): void {
      this.handleOwnershipLoss();
    }

    async handleAction(element: HTMLElement): Promise<boolean> {
      const action = element.dataset["action"];
      if (!action || !SETTINGS_WORKSPACE_ACTIONS.has(action)) return false;

      const nonMutating = action === "export-backup" || action === "export-fsrs-evidence";
      if (!nonMutating && !this.host.requireMutable("change Revision Director data")) return true;

      if (action === "add-profile") await this.addProfileFromSettings();
      else if (action === "save-profile") await this.saveProfileFromSettings(element.dataset["id"] ?? "");
      else if (action === "refresh-storage") {
        await this.service.refreshStorageHealth(true);
        await this.host.invalidate("settings", "storage", "ownership");
        this.host.toast("Storage capability refreshed.");
      } else if (action === "export-fsrs-evidence") await this.exportFsrsOptimizerEvidence();
      else if (action === "optimize-fsrs-locally") await this.optimizeFsrsLocally();
      else if (action === "cancel-fsrs-optimization") this.fsrsOptimizerRun?.cancel();
      else if (action === "activate-fsrs-profile") {
        await this.service.activateFsrsOptimizerProfile();
        await this.host.ensurePlanningAndRender("settings");
        this.host.toast("Personalized FSRS-7 activated and memory schedules reprojected.");
      } else if (action === "deactivate-fsrs-profile") {
        await this.service.deactivateFsrsOptimizerProfile();
        await this.host.ensurePlanningAndRender("settings");
        this.host.toast("Returned to stock FSRS-7 and memory schedules reprojected.");
      } else if (action === "clear-fsrs-profile") {
        await this.service.clearFsrsOptimizerProfile();
        await this.host.invalidate("settings");
        this.host.toast("Staged FSRS optimizer profile removed.");
      } else if (action === "export-backup") await this.exportBackup();
      else if (action === "create-restore-safety") await this.createRestoreSafetyCopy();
      else if (action === "perform-restore") await this.performRestore();
      else if (action === "cancel-restore") this.cancelRestorePreview();
      return true;
    }

    async handleChange(event: Event): Promise<boolean> {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.id === "import-backup") {
        await this.importBackup(event);
        return true;
      }
      if (target instanceof HTMLInputElement && target.id === "import-fsrs-profile") {
        await this.importFsrsOptimizerProfile(target);
        return true;
      }
      if (target instanceof HTMLInputElement && target.id === "load-plugin-files") {
        await this.loadPluginFiles(target);
        return true;
      }
      if (target instanceof HTMLInputElement && (target.id === "restore-safety-saved" || target.id === "restore-replace-confirm" || target.name === "restore-active-treatment")) {
        if (target.id === "restore-safety-saved" && target.checked && this.restoreSafetyProofId) {
          this.backupController.acknowledgeSafetyCopy(this.restoreSafetyProofId);
        }
        this.updateRestoreActionState();
        return true;
      }
      return false;
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
      summary: FsrsOptimizerEvidenceSummary,
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
      const canOptimize = optimizer.available && !running && summary.reviews > 0;
      const holdoutDiagnostics = profile
        ? fsrsHoldoutDiagnostics(profile.evaluation.holdout.stock, profile.evaluation.holdout.personalized)
        : undefined;
      const incumbent = profile?.evaluation.holdout.incumbent;
      const incumbentDiagnostics = incumbent && profile
        ? fsrsHoldoutDiagnostics(incumbent.metrics, profile.evaluation.holdout.personalized)
        : undefined;
      const profileDetail = profile && holdoutDiagnostics
        ? `<div class="dependency-status"><span>Profile</span><strong>${escapeHtml(profile.sourceSha256.slice(0, 12))}…</strong></div>
           <div class="dependency-status"><span>Held-out log loss · stock</span><strong>${roundTo(profile.evaluation.holdout.stock.logLoss, 4)} → ${roundTo(profile.evaluation.holdout.personalized.logLoss, 4)} · ${roundTo(holdoutDiagnostics.logLossImprovement.relative * 100, 2)}% better</strong></div>
           ${incumbentDiagnostics && incumbent ? `<div class="dependency-status"><span>Held-out log loss · prior profile</span><strong>${roundTo(incumbent.metrics.logLoss, 4)} → ${roundTo(profile.evaluation.holdout.personalized.logLoss, 4)} · ${roundTo(incumbentDiagnostics.logLossImprovement.relative * 100, 2)}% better</strong></div>` : ""}
           <div class="dependency-status"><span>Calibration · RMSE bins</span><strong>${roundTo(profile.evaluation.holdout.stock.rmseBins, 4)} → ${roundTo(profile.evaluation.holdout.personalized.rmseBins, 4)} · ${holdoutDiagnostics.calibration.status}</strong></div>
           <div class="dependency-status"><span>Time-series CV</span><strong>LL ${roundTo(profile.evaluation.crossValidation.logLoss, 4)} · RMSE ${roundTo(profile.evaluation.crossValidation.rmseBins, 4)}</strong></div>`
        : `<p class="helper">No validated personalized profile is staged. Stock FSRS-7 remains authoritative.</p>`;
      const profileActions = running
        ? ""
        : personalization.active
          ? `<button class="mini-btn" type="button" data-action="deactivate-fsrs-profile">RETURN TO STOCK + REPROJECT</button>`
          : profile
            ? `<button class="mini-btn" type="button" data-action="activate-fsrs-profile">ACTIVATE + REPROJECT</button><button class="mini-btn" type="button" data-action="clear-fsrs-profile">REMOVE STAGED PROFILE</button>`
            : "";
      const localAction = running
        ? `<button class="mini-btn" type="button" data-action="cancel-fsrs-optimization">CANCEL OPTIMIZATION</button>`
        : `<button class="mini-btn" type="button" data-action="optimize-fsrs-locally" ${canOptimize ? "" : "disabled"}>${personalization.active ? "RE-OPTIMIZE + SWITCH IF BETTER" : profile ? "RE-OPTIMIZE LOCALLY" : "OPTIMIZE LOCALLY"}</button>`;
      return `<section class="panel settings-card wide" id="fsrs-personalization-card"><h3>FSRS-7 personalization</h3>
        <div class="dependency-status"><span>Weights</span><strong class="${statusClass}">${status}</strong></div>
        <div class="dependency-status"><span>Optimizer evidence</span><strong>${summary.reviews} reviews · ${summary.cards} cards · ${summary.reliableDurations} timed · ${summary.unavailableDurations} untimed</strong></div>
        <div class="dependency-status"><span>Local optimizer</span><strong class="${optimizer.available ? "ok" : ""}">${optimizer.available ? "AVAILABLE" : "HOSTED BUILD REQUIRED"}</strong></div>
        <div class="optimizer-progress" data-fsrs-optimizer-progress ${running ? "" : "hidden"}><div><span data-fsrs-optimizer-progress-label>${escapeHtml(progressText)}</span></div><progress data-fsrs-optimizer-progress-bar max="${progressMax}" value="${progressValue}"></progress></div>
        ${profileDetail}
        <div class="settings-actions">${localAction}<button class="mini-btn" type="button" data-action="export-fsrs-evidence">EXPORT OPTIMIZER EVIDENCE</button><label class="mini-btn file-btn ${running ? "disabled" : ""}">IMPORT VALIDATED PROFILE<input id="import-fsrs-profile" type="file" accept=".json,application/json" ${running ? "disabled" : ""}></label>${profileActions}</div>
        <p class="helper">${escapeHtml(progressText)} Local optimization uses a dedicated Worker and the pinned FSRS-7 WASM binding; review evidence does not leave the browser. Optimizer duration is closed-book recall/verification time only; unreliable timing remains in recall history with unavailable cost rather than full-session time. The exact gate remains 64 historical training items, 64 later holdout items and 16 distinct holdout cards after conversion. From stock, a successful run is <strong>staged only</strong>. While personalized weights are active, optimization evaluates the candidate against both stock and the active profile on the same holdout; only a candidate that clears both gates replaces the active profile, using one atomic scheduler rebase.</p>
      </section>`;
    }

    private async refreshFsrsPersonalizationCard(): Promise<void> {
      const card = this.settingsContent.querySelector<HTMLElement>("#fsrs-personalization-card");
      if (!card) return;
      const summary = await this.service.optimizerEvidenceSummary();
      card.outerHTML = this.fsrsPersonalizationCard(this.service.getSettings(), summary);
      this.host.applyReadOnlyState();
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
    async render(): Promise<void> {
      const settings = this.service.getSettings();
      const [profiles, optimizerEvidence] = await Promise.all([
        this.service.profiles(),
        this.service.optimizerEvidenceSummary(),
      ]);
      const planningReference = studyDayStart(new Date(), settings.studyDayBoundaryHour);
      const schedulingPolicy = settings.fsrsScheduling.policy;
      const fixedRetentionValue = schedulingPolicy.kind === "fixed-retention" ? schedulingPolicy.desiredRetention : 0.9;
      const fsrsOk = fsrsRuntimeAvailable();
      const storage = this.service.storageHealth();
      const storageUsage = storage.usageRatio === undefined ? "Usage estimate unavailable" : `${roundTo(storage.usageRatio * 100, 1)}% of browser quota used`;
      const persistenceLabel = storage.persistence === "granted" ? "Persistent storage granted" : storage.persistence === "available" ? "Persistent storage not guaranteed" : storage.persistence === "denied" ? "Persistent storage denied" : "Persistence API unavailable";
      // Refreshes can finish after someone begins typing. Keep the transient
      // new-profile draft until it is explicitly committed, without persisting it.
      const draftName = this.settingsContent.querySelector<HTMLInputElement>("#new-profile-name")?.value ?? "";
      const draftDate = this.settingsContent.querySelector<HTMLInputElement>("#new-profile-date")?.value ?? "";
      this.settingsContent.innerHTML = `
        ${this.host.pageHead("SYSTEM CONTROL", "Settings", "Revision Director remains deterministic and local-first; AI can later advise without owning the record.")}
        <form id="settings-form" class="settings-grid">
          <section class="panel settings-card"><h3>Planning</h3><label>Default exam profile for new records<select name="activeProfileId" ${profiles.length ? "" : "disabled"}>${profiles.length ? profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === settings.activeProfileId ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join("") : '<option value="">Create an exam profile first</option>'}</select></label><label>Daily revision capacity<input name="dailyCapacityMinutes" type="number" min="5" max="600" value="${settings.dailyCapacityMinutes}"></label><label>Study-day boundary hour<input name="studyDayBoundaryHour" type="number" min="0" max="12" value="${settings.studyDayBoundaryHour}"></label></section>
          <section class="panel settings-card"><h3>Memory scheduling</h3><label>Scheduling policy<select name="memorySchedulingPolicy"><option value="fixed-retention" ${schedulingPolicy.kind === "fixed-retention" ? "selected" : ""}>Fixed retention · 90% default</option><option value="cost-adr" ${schedulingPolicy.kind === "cost-adr" ? "selected" : ""}>Adaptive workload · Cost-ADR · optional preset</option></select></label><label>Fixed-retention target · fixed mode only<input name="desiredRetention" type="number" min="0.75" max="0.97" step="0.01" value="${fixedRetentionValue}"></label><div class="dependency-status"><span>Active policy</span><strong>${schedulingPolicy.kind === "cost-adr" ? `Cost-ADR · cost weight ${FSRS_COST_ADR_PRESET_GOAL_COST_WEIGHT}` : `Fixed · ${roundTo(schedulingPolicy.desiredRetention * 100, 0)}%`}</strong></div><div class="dependency-status"><span>Exact scheduler</span><strong class="${fsrsOk ? "ok" : "bad"}">${fsrsOk ? "ts-fsrs 6.0.0 embedded" : "Unavailable"}</strong></div><p class="helper">The outcome-sensitive FSRS-R2 benchmark selected fixed 90% for new installations. Cost-ADR remains available only as the bounded 1024 preset for explicit comparison; arbitrary Cost-ADR tuning remains unavailable. Existing saved policy choices are preserved until you change them. Switching policy performs an atomic FSRS replay/rebase.</p></section>
          <section class="panel settings-card"><h3>Persistent difficulty</h3><label>Escalate to remediation after established recall failures<input name="difficultyRemediationLapses" type="number" min="2" max="99" value="${settings.memoryDifficultyPolicy.remediationLapses}"></label><label>Persistent difficulty after established recall failures<input name="difficultyPersistentLapses" type="number" min="3" max="100" value="${settings.memoryDifficultyPolicy.persistentDifficultyLapses}"></label><label class="check-option strong-check"><input name="difficultyAutomaticHold" type="checkbox" ${settings.memoryDifficultyPolicy.automaticHold.enabled ? "checked" : ""}>Hold persistent-difficulty memory out of the normal queue after successful remediation</label><label>Automatic-hold failure threshold<input name="difficultyAutomaticHoldLapses" type="number" min="${settings.memoryDifficultyPolicy.persistentDifficultyLapses + 1}" max="1000" value="${settings.memoryDifficultyPolicy.automaticHold.lapseThreshold}"></label><p class="helper">Difficulty is derived from canonical memory history: failures before the first successful retrieval are early-learning failures; only later Again outcomes count as established recall failures. The raw FSRS lapse counter remains scheduler state but does not independently decide host remediation or queue holds.</p></section>
          ${this.fsrsPersonalizationCard(settings, optimizerEvidence)}
          <section class="panel settings-card"><h3>Add exam profile</h3><label>Name<input id="new-profile-name" value="${escapeHtml(draftName)}" placeholder="IFoS 2027, USMLE Step 1..."></label><label>Exam date<input id="new-profile-date" type="date" value="${escapeHtml(draftDate)}"></label><button class="btn" type="button" data-action="add-profile">ADD PROFILE</button></section>
          <section class="panel settings-card"><h3>Backup and recovery</h3><button class="btn" type="button" data-action="export-backup">EXPORT BACKUP</button><label class="btn file-btn">IMPORT BACKUP<input id="import-backup" type="file" accept=".rdbackup,application/x-revision-director-backup,application/gzip,application/octet-stream"></label><p class="helper">Export remains one click. Import verifies and previews the file first, then requires a current-state safety copy and explicit restore confirmation.</p></section>
          ${this.pluginSettingsCard()}
          <section class="panel settings-card"><h3>Storage health</h3><div class="dependency-status"><span>IndexedDB</span><strong class="${storage.indexedDbAvailable ? "ok" : "bad"}">${storage.indexedDbAvailable ? "Available" : "Unavailable"}</strong></div><div class="dependency-status"><span>Persistence</span><strong class="${storage.persistence === "granted" ? "ok" : ""}">${escapeHtml(persistenceLabel)}</strong></div><p class="helper">${escapeHtml(storageUsage)} · ${storage.diagnosticCount} bounded diagnostic record${storage.diagnosticCount === 1 ? "" : "s"}.</p><button class="mini-btn" type="button" data-action="refresh-storage">REFRESH STORAGE STATUS</button></section>
          <section class="panel settings-card wide"><h3>Exam horizons</h3><p class="helper">Proximity affects cross-exam priority and how far the planner may bring an obligation forward. Profiles whose examination date has passed are automatically excluded until the date is updated for a new cycle.</p><div class="profile-planner-list">${profiles.filter((profile) => profile.status !== "archived").map((profile) => { const passed = Boolean(examDateTime(profile)) && daysToExamination(profile, planningReference) < 0; return `<div class="profile-planner-row" data-profile-editor="${escapeHtml(profile.id)}"><label>Profile<input data-profile-name value="${escapeHtml(profile.name)}"></label><label>Examination date<input data-profile-date type="date" value="${escapeHtml(profile.examDate)}"></label><label>Planning status<select data-profile-status><option value="active" ${profile.status === "active" ? "selected" : ""}>Active</option><option value="suspended" ${profile.status === "suspended" ? "selected" : ""}>Paused</option></select><small>${passed ? "Exam passed — excluded automatically" : profile.status === "suspended" ? "Paused manually" : "Included in planning"}</small></label><button class="mini-btn" type="button" data-action="save-profile" data-id="${escapeHtml(profile.id)}">SAVE</button></div>`; }).join("")}</div></section>
          <section class="panel settings-card wide"><h3>Policy router</h3><div class="engine-list"><div><dt>Memory recall</dt><dd>ts-fsrs 6.0.0 · FSRS-7</dd></div><div><dt>Concept reconstruction</dt><dd>Mastery policy v1</dd></div><div><dt>Application practice</dt><dd>Application policy v1</dd></div><div><dt>Performance practice</dt><dd>Performance policy v1</dd></div><div><dt>Relearn</dt><dd>Relearning policy v1</dd></div><div><dt>Freshness review</dt><dd>Freshness horizon policy v1</dd></div></div></section>
          <section class="panel settings-card wide"><h3>Retrieval workflows</h3><div class="engine-list"><div><dt>Recall</dt><dd>Closed-book response + checkpoints + cueing</dd></div><div><dt>Reconstruction</dt><dd>Structure + relationships + checkpoints</dd></div><div><dt>Questions / application</dt><dd>Attempted, correct, partial, novel and cueing</dd></div><div><dt>Diagram practice</dt><dd>Canvas or paper + labels, form and process</dd></div><div><dt>Answer writing</dt><dd>Demand, structure, content, evidence and time</dd></div><div><dt>Relearning</dt><dd>Diagnose → repair → closed-book verification</dd></div></div></section>
          <button class="btn primary settings-save" type="submit">SAVE SETTINGS</button>
        </form>`;
      this.host.applyReadOnlyState();
    }


    async submit(event: SubmitEvent): Promise<void> {
      if (!this.host.requireMutable("save settings")) return;
      event.preventDefault();
      try {
        const form = event.target;
        assert(form instanceof HTMLFormElement && form.getAttribute("id") === "settings-form", "Settings form is unavailable.");
        const data = new FormData(form);
        const current = this.service.getSettings();
        const schedulingKind = formText(data, "memorySchedulingPolicy");
        assert(schedulingKind === "fixed-retention" || schedulingKind === "cost-adr", "Memory scheduling policy is invalid.");
        const schedulingPolicy: FsrsSchedulingPolicy = schedulingKind === "cost-adr"
          ? costAdrPresetSchedulingPolicy()
          : { kind: "fixed-retention", desiredRetention: formNumber(data, "desiredRetention") };
        await this.service.saveSettings({
          ...current,
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          key: "app",
          activeProfileId: formText(data, "activeProfileId"),
          fsrsScheduling: {
            ...current.fsrsScheduling,
            policy: schedulingPolicy,
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
        await this.host.ensurePlanningAndRender("settings", "library");
        this.host.toast("Settings saved.");
      } catch (error) {
        this.host.toast(error instanceof Error ? error.message : "Could not save settings.", true);
      }
    }

    private async saveProfileFromSettings(profileId: string): Promise<void> {
      if (!this.host.requireMutable("update an exam profile")) return;
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
      await this.host.ensurePlanningAndRender("settings", "library", "study", "history");
      this.host.toast("Exam horizon updated; today’s plan recalculated.");
    }

    private async addProfileFromSettings(): Promise<void> {
      if (!this.host.requireMutable("create an exam profile")) return;
      const name = this.settingsContent.querySelector<HTMLInputElement>("#new-profile-name")?.value ?? "";
      const date = this.settingsContent.querySelector<HTMLInputElement>("#new-profile-date")?.value ?? "";
      await this.service.createProfile(name, date);
      // Clear only the submitted draft. Do not erase new text entered while
      // the asynchronous write was completing.
      const nameField = this.settingsContent.querySelector<HTMLInputElement>("#new-profile-name");
      const dateField = this.settingsContent.querySelector<HTMLInputElement>("#new-profile-date");
      if (nameField?.value === name) nameField.value = "";
      if (dateField?.value === date) dateField.value = "";
      await this.host.invalidate("settings");
      this.host.toast("Exam profile created.");
    }


    private async loadPluginFiles(input: HTMLInputElement): Promise<void> {
      if (!this.host.requireMutable("load a plugin")) { input.value = ""; return; }
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      try {
        const results = await this.extensions.loadLocalFiles(files);
        const registered = results.filter((entry) => entry.state === "loaded").length;
        const failed = results.filter((entry) => entry.state === "failed" || entry.state === "rejected").length;
        this.host.toast(`${registered} plugin file${registered === 1 ? "" : "s"} loaded${failed ? ` · ${failed} failed or rejected` : ""}.`, failed > 0 && registered === 0);
      } catch (error) {
        this.host.toast(error instanceof Error ? error.message : "Plugin loading failed.", true);
      } finally {
        input.value = "";
        await this.host.invalidate("settings", "ownership");
      }
    }

    private async optimizeFsrsLocally(): Promise<void> {
      assert(this.host.requireMutable("optimize personalized FSRS-7 weights"), "This tab is read-only.");
      assert(!this.fsrsOptimizerRun, "FSRS optimization is already running.");
      const personalization = effectiveFsrsPersonalization(this.service.getSettings());
      const incumbentProfile = personalization.active ? personalization.profile : null;
      const availability = browserFsrsOptimizerAvailability();
      assert(availability.available, availability.reason);

      const snapshot = await this.service.optimizerEvidenceSnapshot();
      assert(snapshot.summary.reviews > 0, "No memory-review evidence is available for optimization.");

      this.fsrsOptimizerProgress = { stage: "Preparing local evidence", current: 0, total: 0 };
      const run = startBrowserFsrsOptimizer(snapshot.csv, {
        incumbentProfile,
        onProgress: (progress) => this.updateFsrsOptimizerProgress(progress),
      });
      this.fsrsOptimizerRun = run;
      await this.refreshFsrsPersonalizationCard();

      try {
        const profile = await run.promise;
        assert(this.host.requireMutable("publish the locally optimized FSRS-7 profile"), "Review control changed before optimizer publication.");
        if (incumbentProfile) {
          const activated = await this.service.replaceActiveFsrsOptimizerProfile(profile);
          await this.host.ensurePlanningAndRender();
          this.host.toast(`FSRS-7 candidate beat stock and the active profile on the same holdout · ${activated.evidenceItems} optimizer items. Active weights switched with one atomic rebase.`);
        } else {
          const staged = await this.service.stageFsrsOptimizerProfile(profile);
          this.host.toast(`Local FSRS-7 optimization passed the stock holdout gate · ${staged.evidenceItems} optimizer items. Profile staged; activation remains explicit.`);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          if (this.ownership.canMutate()) this.host.toast("FSRS optimization cancelled.");
        } else if (error instanceof FsrsOptimizerRejectedError) {
          this.host.toast(`Personalized FSRS-7 candidate was rejected · ${error.reasons.join("; ")}`, true);
        } else {
          this.host.toast(error instanceof Error ? error.message : "Local FSRS optimization failed.", true);
        }
      } finally {
        if (this.fsrsOptimizerRun === run) this.fsrsOptimizerRun = undefined;
        this.fsrsOptimizerProgress = undefined;
        await this.refreshFsrsPersonalizationCard();
      }
    }

    private async exportFsrsOptimizerEvidence(): Promise<void> {
      const snapshot = await this.service.optimizerEvidenceSnapshot();
      assert(snapshot.summary.reviews > 0, "No memory-review evidence is available for optimizer export.");
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(`revision-director-fsrs-evidence-${date}.csv`, snapshot.csv, "text/csv;charset=utf-8");
      this.host.toast(`FSRS optimizer evidence exported · ${snapshot.summary.reviews} reviews across ${snapshot.summary.cards} cards · ${snapshot.summary.reliableDurations} reliable retrieval durations.`);
    }

    private async importFsrsOptimizerProfile(input: HTMLInputElement): Promise<void> {
      if (!this.host.requireMutable("stage an FSRS optimizer profile")) { input.value = ""; return; }
      const file = input.files?.[0];
      if (!file) return;
      try {
        assert(file.size <= 64 * 1024, "FSRS optimizer profile exceeds the 64 KiB limit.");
        const parsed: unknown = JSON.parse(await file.text());
        const personalization = effectiveFsrsPersonalization(this.service.getSettings());
        if (personalization.active) {
          const profile = await this.service.replaceActiveFsrsOptimizerProfile(parsed);
          await this.host.ensurePlanningAndRender();
          await this.refreshFsrsPersonalizationCard();
          this.host.toast(`Validated FSRS-7 replacement activated · ${profile.evidenceItems} optimizer items. Active weights switched with one atomic rebase.`);
        } else {
          const profile = await this.service.stageFsrsOptimizerProfile(parsed);
          await this.refreshFsrsPersonalizationCard();
          this.host.toast(`Validated FSRS-7 profile staged · ${profile.evidenceItems} optimizer items. Activation remains explicit.`);
        }
      } catch (error) {
        this.host.toast(error instanceof Error ? error.message : "FSRS optimizer profile import failed.", true);
      } finally {
        input.value = "";
      }
    }
    private async exportBackup(): Promise<void> {
      await this.host.flushActiveRetrievalForBackup();
      const archive = await this.backupController.createVerified(true);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(`revision-director-backup-${date}.rdbackup`, archive.bytes, BACKUP_ARCHIVE_MIME);
      this.host.toast(`Verified backup exported · ${archive.inspection.totalDocuments} documents · ${formatFileSize(archive.inspection.compressedBytes)}.`);
    }

    private async importBackup(event: Event): Promise<void> {
      if (!this.host.requireMutable("restore a backup")) return;
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
        this.host.toast(error instanceof Error ? error.message : "Backup inspection failed.", true);
      } finally {
        input.value = "";
      }
    }

    private renderRestorePreview(candidate: InspectedBackupCandidate): void {
      const inspection = candidate.inspection;
      const active = candidate.payload.activeRetrieval;
      const warnings = inspection.warnings.length ? `<div class="restore-step restore-warning"><h3>Verification notes</h3>${inspection.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>` : "";
      const activeSection = active ? `<section class="restore-step"><h3>Unfinished retrieval in backup</h3><p>${escapeHtml(active.activeTargetId)} · ${escapeHtml(reviewPhaseLabel(active.phase))} · revision ${active.revision}</p><div class="restore-session-options"><label class="restore-check"><input type="radio" name="restore-active-treatment" value="restore">Restore this unfinished retrieval after replacement</label><label class="restore-check"><input type="radio" name="restore-active-treatment" value="discard">Discard it and restore records only</label></div></section>` : `<section class="restore-step"><h3>Active retrieval</h3><p>This backup contains no unfinished retrieval session.</p></section>`;
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
      this.host.applyReadOnlyState();
    }

    private async createRestoreSafetyCopy(): Promise<void> {
      assert(this.restoreCandidateId, "No inspected backup is available.");
      await this.host.flushActiveRetrievalForBackup();
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
      assert(this.host.requireMutable("restore a backup"), "This tab is read-only.");
      assert(this.restoreCandidateId && this.restoreSafetyProofId, "Complete the safety-copy step before restoring.");
      const candidate = this.backupController.candidate(this.restoreCandidateId);
      const treatment = candidate.payload.activeRetrieval
        ? literalChoice(this.restorePreview.querySelector<HTMLInputElement>('input[name="restore-active-treatment"]:checked')?.value, BACKUP_ACTIVE_SESSION_TREATMENTS, "Active retrieval restore treatment")
        : "discard";
      const proceed = window.confirm("Final confirmation: replace all current Revision Director records with this verified backup?");
      if (!proceed) return;
      const result = await this.backupController.restore(this.restoreCandidateId, this.restoreSafetyProofId, treatment);
      this.host.resetActiveRetrievalAfterRestore(result.restoredActiveRetrieval);
      this.restoreCandidateId = "";
      this.restoreSafetyProofId = "";
      this.dialogFocus.close(this.restoreDialog);
      await this.host.hydrateCanonicalState("takeover");
      this.host.toast(result.restoredActiveRetrieval ? "Verified backup restored with its unfinished retrieval." : "Verified backup restored.");
    }

    private cancelRestorePreview(): void {
      this.backupController.cancel(this.restoreCandidateId || undefined);
      this.restoreCandidateId = "";
      this.restoreSafetyProofId = "";
      if (this.restoreDialog.open) this.dialogFocus.close(this.restoreDialog);
    }
  }
