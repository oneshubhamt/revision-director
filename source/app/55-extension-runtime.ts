  /* ========================================================================== 
     PASS E1 · PUBLIC CAPABILITY API AND OPTIONAL PLUGIN RUNTIME
     ========================================================================== */

  interface StudyDirectorStudyPayload {
    profileId?: string;
    occurredAt?: string;
    activityMode?: ActivityMode;
    area: string;
    task: string;
    measure: string;
    source?: string;
    durationMinutes: number;
    understanding?: 1 | 2 | 3 | 4;
    notes?: string;
  }

  interface RevisionCandidatePayload {
    profileId?: string;
    subject: string;
    section: string;
    topic: string;
    title: string;
    scope: string;
    source?: string;
    obligationType?: ObligationType;
    expectedMinutes?: number;
    protocol: string;
    successCriteria: string;
    firstDueAt?: string;
  }

  interface PublicProfileSummary {
    readonly id: string;
    readonly name: string;
    readonly examDate: string;
    readonly status: "active" | "suspended" | "archived";
  }

  interface PublicDueSummary {
    readonly dueCount: number;
    readonly estimatedMinutes: number;
    readonly byType: Readonly<Record<string, number>>;
  }

  interface RevisionDirectorPluginDefinition {
    readonly name: string;
    readonly version?: string;
    readonly requires?: Readonly<Record<string, number>>;
    setup(api: RevisionDirectorPublicApi): boolean | void | Promise<boolean | void>;
  }

  type PluginRegistrationState = "registering" | "registered" | "inactive" | "incompatible" | "failed";
  type PluginFileState = "loading" | "loaded" | "inactive" | "failed" | "rejected";

  interface PluginRegistrationStatus {
    readonly name: string;
    readonly version: string;
    readonly state: PluginRegistrationState;
    readonly attempts: number;
    readonly detail: string;
    readonly updatedAt: ISODateTime;
  }

  interface PluginFileStatus {
    readonly id: string;
    readonly name: string;
    readonly size: number;
    readonly state: PluginFileState;
    readonly detail: string;
    readonly updatedAt: ISODateTime;
  }

  interface PluginRuntimeStatus {
    readonly registered: readonly PluginRegistrationStatus[];
    readonly localFiles: readonly PluginFileStatus[];
  }

  interface RevisionDirectorPublicApi {
    readonly version: string;
    readonly apiVersion: number;
    readonly capabilities: Readonly<Record<string, number>>;
    readonly data: Readonly<{ contract: Readonly<Record<string, unknown>> }>;
    readonly records: Readonly<{
      getDueSummary(): Promise<PublicDueSummary>;
      listProfiles(): Promise<readonly PublicProfileSummary[]>;
    }>;
    readonly intake: Readonly<{
      importStudyEvent(payload: StudyDirectorStudyPayload): Promise<Readonly<{ id: string }>>;
      createRevisionCandidate(payload: RevisionCandidatePayload): Promise<Readonly<{ unitId: string }>>;
    }>;
    readonly runtime: Readonly<{
      ownership(): Readonly<ReviewOwnershipSnapshot>;
      storageHealth(): Readonly<StorageHealthSnapshot>;
    }>;
    readonly plugins: Readonly<{
      status(): PluginRuntimeStatus;
      loadLocalFiles(files: readonly File[]): Promise<readonly PluginFileStatus[]>;
    }>;
    registerPlugin(plugin: RevisionDirectorPluginDefinition): Promise<boolean>;
  }

  const REVISION_DIRECTOR_PUBLIC_API_VERSION = 1;
  const REVISION_DIRECTOR_READY_EVENT = "revisiondirector:ready";
  const REVISION_DIRECTOR_PLUGIN_STATUS_EVENT = "revisiondirector:plugins-changed";
  const LOCAL_PLUGIN_MAX_FILES = 5;
  const LOCAL_PLUGIN_MAX_BYTES = 1 * 1024 * 1024;
  const PLUGIN_MAX_REGISTRATION_ATTEMPTS = 2;

  const REVISION_DIRECTOR_CAPABILITIES: Readonly<Record<string, number>> = Object.freeze({
    publicApi: 1,
    pluginApi: 1,
    localPluginFiles: 1,
    pluginStatus: 1,
    dueSummary: 1,
    profileSummary: 1,
    studyEventIntake: 1,
    revisionCandidateIntake: 1,
    ownershipState: 1,
    storageHealth: 1,
    presentationEngine: 1,
    backupCodec: 1,
    backupController: 1,
  });

  const REVISION_DIRECTOR_PUBLIC_DATA_CONTRACT: Readonly<Record<string, unknown>> = Object.freeze({
    application: "revision-director",
    applicationVersion: APP_VERSION,
    database: Object.freeze({ name: DB_NAME, version: DB_VERSION }),
    documents: Object.freeze({ schemaVersion: DOCUMENT_SCHEMA_VERSION }),
    backup: Object.freeze({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      archiveFormat: BACKUP_ARCHIVE_FORMAT,
      archiveVersion: BACKUP_ARCHIVE_VERSION,
    }),
    presentation: Object.freeze({
      manifestVersion: PRESENTATION_KERNEL.manifest.version,
      defaultId: PRESENTATION_KERNEL.manifest.defaults.presentation,
    }),
  });

  function publicPluginText(value: unknown, maximum: number): string {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function publicPluginRequirements(value: unknown): Readonly<Record<string, number>> {
    if (value === undefined) return Object.freeze({});
    assert(typeof value === "object" && value !== null && !Array.isArray(value), "Plugin capability requirements must be an object.");
    const out: Record<string, number> = Object.create(null);
    for (const [rawKey, rawMinimum] of Object.entries(requireRecord(value, "Plugin capability requirements"))) {
      const key = publicPluginText(rawKey, 64);
      assert(/^[a-z][a-zA-Z0-9]*$/.test(key), "Plugin capability names are invalid.");
      const minimum = Number(rawMinimum);
      assert(Number.isInteger(minimum) && minimum >= 0 && minimum <= 100, `Plugin capability requirement is invalid: ${key}.`);
      out[key] = minimum;
    }
    return Object.freeze(out);
  }

  class ExtensionRuntime {
    private readonly registrations = new Map<string, PluginRegistrationStatus>();
    private readonly localFiles = new Map<string, PluginFileStatus>();
    private publicApiValue: RevisionDirectorPublicApi | undefined;
    private registrationRevision = 0;

    constructor(
      private readonly service: RevisionService,
      private readonly ownership: ReviewOwnershipCoordinator,
    ) {}

    installPublicApi(): RevisionDirectorPublicApi {
      assert(!this.publicApiValue, "Revision Director public API is already installed.");
      const records = Object.freeze({
        getDueSummary: () => this.getDueSummary(),
        listProfiles: () => this.listProfiles(),
      });
      const intake = Object.freeze({
        importStudyEvent: (payload: StudyDirectorStudyPayload) => this.importStudyEvent(payload),
        createRevisionCandidate: (payload: RevisionCandidatePayload) => this.createRevisionCandidate(payload),
      });
      const runtime = Object.freeze({
        ownership: () => Object.freeze(clone(this.ownership.snapshot())),
        storageHealth: () => Object.freeze(clone(this.service.storageHealth())),
      });
      const plugins = Object.freeze({
        status: () => this.status(),
        loadLocalFiles: (files: readonly File[]) => this.loadLocalFiles(files),
      });
      const api: RevisionDirectorPublicApi = Object.freeze({
        version: APP_VERSION,
        apiVersion: REVISION_DIRECTOR_PUBLIC_API_VERSION,
        capabilities: REVISION_DIRECTOR_CAPABILITIES,
        data: Object.freeze({ contract: REVISION_DIRECTOR_PUBLIC_DATA_CONTRACT }),
        records,
        intake,
        runtime,
        plugins,
        registerPlugin: (plugin: RevisionDirectorPluginDefinition) => this.register(plugin),
      });
      this.publicApiValue = api;
      Object.defineProperty(window, "RevisionDirector", {
        value: api,
        configurable: false,
        enumerable: false,
        writable: false,
      });
      return api;
    }

    announceReady(): void {
      assert(this.publicApiValue, "Revision Director public API is not installed.");
      window.dispatchEvent(new CustomEvent(REVISION_DIRECTOR_READY_EVENT, {
        detail: Object.freeze({
          version: APP_VERSION,
          apiVersion: REVISION_DIRECTOR_PUBLIC_API_VERSION,
          capabilities: REVISION_DIRECTOR_CAPABILITIES,
        }),
      }));
    }

    status(): PluginRuntimeStatus {
      return Object.freeze({
        registered: Object.freeze([...this.registrations.values()].map((entry) => Object.freeze(clone(entry))).sort((a, b) => a.name.localeCompare(b.name))),
        localFiles: Object.freeze([...this.localFiles.values()].map((entry) => Object.freeze(clone(entry))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
      });
    }

    async register(input: unknown): Promise<boolean> {
      if (!isRecord(input) || typeof input["setup"] !== "function") return false;
      const setup = input["setup"];
      const name = publicPluginText(input["name"], 80);
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(name)) return false;
      const version = publicPluginText(input["version"], 40);
      const previous = this.registrations.get(name);
      if (previous?.state === "registered") return true;
      if (previous?.state === "incompatible") return false;
      const attempts = previous?.attempts ?? 0;
      if (attempts >= PLUGIN_MAX_REGISTRATION_ATTEMPTS) return false;
      const nextAttempt = attempts + 1;
      let requirements: Readonly<Record<string, number>>;
      try { requirements = publicPluginRequirements(input["requires"]); }
      catch (error) {
        this.setRegistration({ name, version, state: "failed", attempts: nextAttempt, detail: publicPluginText(error instanceof Error ? error.message : error, 240), updatedAt: nowIso() });
        return false;
      }
      const unmet = Object.entries(requirements).filter(([capability, minimum]) => Number(REVISION_DIRECTOR_CAPABILITIES[capability] ?? 0) < minimum);
      if (unmet.length) {
        this.setRegistration({
          name,
          version,
          state: "incompatible",
          attempts: nextAttempt,
          detail: `Missing capabilities: ${unmet.map(([key, minimum]) => `${key}>=${minimum}`).join(", ")}`.slice(0, 240),
          updatedAt: nowIso(),
        });
        return false;
      }
      this.registrationRevision += 1;
      this.setRegistration({ name, version, state: "registering", attempts: nextAttempt, detail: "", updatedAt: nowIso() });
      try {
        const result = await setup(this.requirePublicApi());
        const active = result !== false;
        this.setRegistration({ name, version, state: active ? "registered" : "inactive", attempts: nextAttempt, detail: active ? "" : "Plugin setup returned inactive.", updatedAt: nowIso() });
        return active;
      } catch (error) {
        this.setRegistration({ name, version, state: "failed", attempts: nextAttempt, detail: publicPluginText(error instanceof Error ? error.message : error, 240), updatedAt: nowIso() });
        return false;
      }
    }

    async loadLocalFiles(files: readonly File[]): Promise<readonly PluginFileStatus[]> {
      assert(this.ownership.canMutate(), "Revision Director is read-only in this tab. Take control before loading a plugin.");
      assert(Array.isArray(files), "Select one or more local JavaScript plugin files.");
      assert(files.length >= 1 && files.length <= LOCAL_PLUGIN_MAX_FILES, `Select between 1 and ${LOCAL_PLUGIN_MAX_FILES} plugin files.`);
      const results: PluginFileStatus[] = [];
      for (const file of files) results.push(await this.loadLocalFile(file));
      return Object.freeze(results.map((entry) => Object.freeze(clone(entry))));
    }

    private requirePublicApi(): RevisionDirectorPublicApi {
      assert(this.publicApiValue, "Revision Director public API is unavailable.");
      return this.publicApiValue;
    }

    private setRegistration(status: PluginRegistrationStatus): void {
      this.registrations.set(status.name, Object.freeze({ ...status }));
      this.signalStatusChanged();
    }

    private setFile(status: PluginFileStatus): PluginFileStatus {
      const frozen = Object.freeze({ ...status });
      this.localFiles.set(status.id, frozen);
      this.signalStatusChanged();
      return frozen;
    }

    private signalStatusChanged(): void {
      window.dispatchEvent(new CustomEvent(REVISION_DIRECTOR_PLUGIN_STATUS_EVENT, { detail: this.status() }));
    }

    private async loadLocalFile(file: File): Promise<PluginFileStatus> {
      const name = publicPluginText(file?.name, 160);
      const id = `${name}:${Number(file?.size) || 0}:${Number(file?.lastModified) || 0}`;
      const prior = this.localFiles.get(id);
      if (prior && ["loaded", "inactive", "loading"].includes(prior.state)) return prior;
      const reject = (detail: string): PluginFileStatus => this.setFile({ id, name: name || "unnamed.js", size: Number(file?.size) || 0, state: "rejected", detail, updatedAt: nowIso() });
      if (!(file instanceof File)) return reject("The selected item is not a local file.");
      if (!/\.js$/i.test(name)) return reject("Plugin files must use the .js extension.");
      if (!file.size || file.size > LOCAL_PLUGIN_MAX_BYTES) return reject(`Plugin files must be between 1 byte and ${LOCAL_PLUGIN_MAX_BYTES} bytes.`);
      this.setFile({ id, name, size: file.size, state: "loading", detail: "", updatedAt: nowIso() });
      const registrationsBefore = this.registrationRevision;
      const url = URL.createObjectURL(file);
      let executionError = "";
      const captureError = (event: ErrorEvent): void => {
        if (event.filename === url || String(event.filename || "").startsWith("blob:")) {
          executionError = publicPluginText(event.error instanceof Error ? event.error.message : event.message, 240) || "Plugin execution failed.";
          event.preventDefault();
        }
      };
      window.addEventListener("error", captureError);
      try {
        await new Promise<void>((resolve, rejectPromise) => {
          const script = document.createElement("script");
          const timeout = window.setTimeout(() => {
            script.remove();
            rejectPromise(new Error("Plugin loading timed out."));
          }, 5_000);
          script.src = url;
          script.async = false;
          script.dataset["revisionDirectorPluginFile"] = name;
          script.onload = () => { window.clearTimeout(timeout); script.remove(); resolve(); };
          script.onerror = () => { window.clearTimeout(timeout); script.remove(); rejectPromise(new Error(executionError || "Plugin file could not be evaluated.")); };
          document.head.appendChild(script);
        });
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        if (executionError) throw new Error(executionError);
        const registered = this.registrationRevision > registrationsBefore;
        return this.setFile({
          id,
          name,
          size: file.size,
          state: registered ? "loaded" : "inactive",
          detail: registered ? "Plugin file evaluated and registration was received." : "Plugin file evaluated but did not register a plugin.",
          updatedAt: nowIso(),
        });
      } catch (error) {
        return this.setFile({ id, name, size: file.size, state: "failed", detail: publicPluginText(error instanceof Error ? error.message : error, 240), updatedAt: nowIso() });
      } finally {
        window.removeEventListener("error", captureError);
        URL.revokeObjectURL(url);
      }
    }

    private async getDueSummary(): Promise<PublicDueSummary> {
      const due = await this.service.dueQueue();
      const byType: Record<string, number> = Object.create(null);
      for (const item of due) byType[item.obligation.type] = (byType[item.obligation.type] ?? 0) + 1;
      return Object.freeze({
        dueCount: due.length,
        estimatedMinutes: due.reduce((sum, item) => sum + item.obligation.expectedMinutes, 0),
        byType: Object.freeze({ ...byType }),
      });
    }

    private async listProfiles(): Promise<readonly PublicProfileSummary[]> {
      return Object.freeze((await this.service.profiles()).map((profile) => Object.freeze({
        id: profile.id,
        name: profile.name,
        examDate: profile.examDate,
        status: profile.status,
      })));
    }

    private async importStudyEvent(input: unknown): Promise<Readonly<{ id: string }>> {
      assert(this.ownership.canMutate(), "Revision Director is read-only in this tab. Take control before importing study data.");
      const payload = requireRecord(input, "Study payload");
      const area = payload["area"], task = payload["task"], measure = payload["measure"];
      assert(typeof area === "string" && typeof task === "string" && typeof measure === "string", "Study payload requires area, task and measure.");
      const durationMinutes = payload["durationMinutes"];
      assert(typeof durationMinutes === "number" && Number.isFinite(durationMinutes), "Study payload requires durationMinutes.");
      const activityMode = payload["activityMode"] === undefined ? "learn" : literalChoice(payload["activityMode"], ACTIVITY_MODES, "Study payload activityMode");
      const understanding = payload["understanding"] === undefined ? 3 : literalChoice(payload["understanding"], UNDERSTANDING_LEVELS, "Study payload understanding");
      const occurredAtValue = payload["occurredAt"];
      assert(occurredAtValue === undefined || typeof occurredAtValue === "string", "Study payload occurredAt is invalid.");
      const occurredAt = occurredAtValue ? parseDate(occurredAtValue).toISOString() : nowIso();
      const profiles = await this.service.profiles();
      const requestedProfileId = payload["profileId"];
      assert(requestedProfileId === undefined || typeof requestedProfileId === "string", "Study payload profileId is invalid.");
      const profileId = requestedProfileId || this.service.getSettings().activeProfileId || profiles[0]?.id;
      assert(profileId, "No exam profile exists.");
      const optionalText = (key: string): string => {
        const value = payload[key];
        assert(value === undefined || typeof value === "string", `Study payload ${key} is invalid.`);
        return value ?? "";
      };
      const event = await this.service.logStudyEvent({
        profileId,
        occurredAt,
        activityMode,
        area,
        task,
        measure,
        source: optionalText("source"),
        durationMinutes,
        understanding,
        linkedUnitIds: [],
        notes: optionalText("notes"),
        origin: "study-director",
      });
      return Object.freeze({ id: event.id });
    }

    private async createRevisionCandidate(input: unknown): Promise<Readonly<{ unitId: string }>> {
      assert(this.ownership.canMutate(), "Revision Director is read-only in this tab. Take control before creating revision candidates.");
      const payload = requireRecord(input, "Revision candidate");
      const requiredText = (key: string): string => {
        const value = payload[key];
        assert(typeof value === "string" && value.trim().length > 0, `Revision candidate ${key} is required.`);
        return value;
      };
      const subject = requiredText("subject");
      const section = requiredText("section");
      const topic = requiredText("topic");
      const title = requiredText("title");
      const scope = requiredText("scope");
      const protocol = requiredText("protocol");
      const successCriteria = requiredText("successCriteria");
      const requestedProfileId = payload["profileId"];
      assert(requestedProfileId === undefined || typeof requestedProfileId === "string", "Revision candidate profileId is invalid.");
      const profiles = await this.service.profiles();
      const profileId = requestedProfileId || this.service.getSettings().activeProfileId || profiles[0]?.id;
      assert(profileId, "No exam profile exists.");
      const obligationType = payload["obligationType"] === undefined ? "memory-recall" : literalChoice(payload["obligationType"], OBLIGATION_TYPES, "Revision candidate obligation type");
      const expectedMinutesValue = payload["expectedMinutes"];
      assert(expectedMinutesValue === undefined || (typeof expectedMinutesValue === "number" && Number.isFinite(expectedMinutesValue)), "Revision candidate expectedMinutes is invalid.");
      const sourceValue = payload["source"];
      assert(sourceValue === undefined || typeof sourceValue === "string", "Revision candidate source is invalid.");
      const firstDueAtValue = payload["firstDueAt"];
      assert(firstDueAtValue === undefined || typeof firstDueAtValue === "string", "Revision candidate firstDueAt is invalid.");
      const unit = await this.service.createUnit({
        profileId,
        subject,
        section,
        topic,
        title,
        scope,
        source: sourceValue ?? "",
        importance: 3,
        obligationType,
        expectedMinutes: expectedMinutesValue ?? 15,
        protocol,
        successCriteria,
        firstDueAt: firstDueAtValue ? parseDate(firstDueAtValue).toISOString() : addDays(new Date(), 1).toISOString(),
        freshnessDays: 30,
        workflow: defaultWorkflowSpec(obligationType, protocol, successCriteria),
      });
      await this.service.ensureDailyPlan(new Date());
      return Object.freeze({ unitId: unit.id });
    }
  }

