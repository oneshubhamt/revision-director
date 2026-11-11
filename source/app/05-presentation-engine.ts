
  /* ========================================================================== 
     PRESENTATION MANIFEST AND KERNEL
     ========================================================================== */

  type PresentationAxis = "typography" | "shape" | "material" | "depth" | "density" | "responsive" | "motion" | "charts";

  interface PresentationProfileDefinition {
    id: string;
    label: string;
    contractVersion: number;
    typography: string;
    shape: string;
    material: string;
    depth: string;
    density: string;
    responsive: string;
    motion: string;
    charts: string;
    immutable: boolean;
  }

  interface PresentationTokenContract {
    contractVersion: number;
    namespace: string;
    public: Record<string, readonly string[]>;
  }

  interface PresentationManifest {
    format: "revision-director.presentation-manifest";
    version: 1;
    storageKey: string;
    defaults: Readonly<{ presentation: string }>;
    profiles: Readonly<Record<string, PresentationProfileDefinition>>;
    breakpoints: Readonly<Record<string, number>>;
    tokens: PresentationTokenContract;
    invariants: Readonly<{
      defaultProfileImmutable: true;
      exactPixelReference: string;
      domOrder: "application-owned";
      focusOrder: "application-owned";
      semanticStateMeaning: Readonly<Record<string, string>>;
    }>;
  }

  interface PresentationKernelApi {
    readonly format: "revision-director.presentation-kernel";
    readonly version: 1;
    readonly manifest: PresentationManifest;
    activePresentationId(): string;
    listPresentations(): readonly PresentationProfileDefinition[];
    normalizePresentationId(value: unknown): string;
    readStoredPresentation(): string;
    restoreStoredPresentation(): string;
    registerPresentation(value: unknown): boolean;
    switchPresentation(value: unknown, options?: { persist?: boolean }): string;
    validatePublicTokens(): boolean;
  }

  const EMBEDDED_PRESENTATION_MANIFEST: unknown = /*__RD_PRESENTATION_MANIFEST__*/;
  const PRESENTATION_KERNEL_SYMBOL = Symbol.for("revisionDirector.presentationKernel.v1");
  const PRESENTATION_ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;
  const PRESENTATION_AXES: readonly PresentationAxis[] = Object.freeze([
    "typography", "shape", "material", "depth", "density", "responsive", "motion", "charts",
  ]);

  function presentationRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  function presentationId(value: unknown): string {
    const candidate = String(value ?? "").trim().toLowerCase();
    return PRESENTATION_ID_PATTERN.test(candidate) ? candidate : "";
  }

  function freezePresentationValue<T>(value: T): T {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value as Record<string, unknown>)) freezePresentationValue(nested);
    return Object.freeze(value);
  }

  function parsePresentationProfile(value: unknown, requiredContractVersion: number): PresentationProfileDefinition | null {
    const source = presentationRecord(value);
    if (!source || Number(source.contractVersion) !== requiredContractVersion) return null;
    const id = presentationId(source.id);
    const label = String(source.label ?? id).trim().slice(0, 60);
    if (!id || !label) return null;
    const profile: PresentationProfileDefinition = {
      id,
      label,
      contractVersion: requiredContractVersion,
      typography: "",
      shape: "",
      material: "",
      depth: "",
      density: "",
      responsive: "",
      motion: "",
      charts: "",
      immutable: source.immutable === true,
    };
    for (const axis of PRESENTATION_AXES) {
      const clean = presentationId(source[axis]);
      if (!clean) return null;
      profile[axis] = clean;
    }
    return freezePresentationValue(profile);
  }

  function parsePresentationManifest(): PresentationManifest {
    let raw: unknown = EMBEDDED_PRESENTATION_MANIFEST;
    if (typeof document !== "undefined" && typeof document.getElementById === "function" && typeof HTMLScriptElement !== "undefined") {
      const node = document.getElementById("revision-director-presentation-manifest");
      if (!(node instanceof HTMLScriptElement)) throw new Error("Revision Director presentation manifest is missing.");
      try {
        const embedded = JSON.parse(node.textContent ?? "");
        if (JSON.stringify(embedded) !== JSON.stringify(EMBEDDED_PRESENTATION_MANIFEST)) throw new Error("Presentation manifest parity mismatch.");
        raw = embedded;
      } catch (error) {
        throw new Error(`Revision Director presentation manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const source = presentationRecord(raw);
    const defaults = presentationRecord(source?.defaults);
    const profilesSource = presentationRecord(source?.profiles);
    const tokensSource = presentationRecord(source?.tokens);
    const publicSource = presentationRecord(tokensSource?.public);
    const breakpointsSource = presentationRecord(source?.breakpoints);
    const invariantsSource = presentationRecord(source?.invariants);
    const stateMeanings = presentationRecord(invariantsSource?.semanticStateMeaning);
    if (source?.format !== "revision-director.presentation-manifest" || source.version !== 1 || !defaults || !profilesSource || !tokensSource || !publicSource || !breakpointsSource || !invariantsSource || !stateMeanings) {
      throw new Error("Revision Director presentation manifest is incompatible.");
    }
    const contractVersion = Number(tokensSource.contractVersion);
    const defaultId = presentationId(defaults.presentation);
    const storageKey = String(source.storageKey ?? "").trim();
    const namespace = String(tokensSource.namespace ?? "").trim();
    if (!Number.isInteger(contractVersion) || contractVersion < 1 || !defaultId || !storageKey || namespace !== "--rd-") {
      throw new Error("Revision Director presentation manifest contract is invalid.");
    }
    const profiles: Record<string, PresentationProfileDefinition> = {};
    for (const [key, candidate] of Object.entries(profilesSource)) {
      const profile = parsePresentationProfile(candidate, contractVersion);
      if (!profile || profile.id !== key) throw new Error(`Presentation profile is invalid: ${key}`);
      profiles[key] = profile;
    }
    const defaultProfile = profiles[defaultId];
    if (!defaultProfile || !defaultProfile.immutable) throw new Error("The default Revision Director presentation must be immutable.");

    const publicTokens: Record<string, readonly string[]> = {};
    const tokenSet = new Set<string>();
    for (const [group, candidate] of Object.entries(publicSource)) {
      if (!Array.isArray(candidate) || !candidate.length) throw new Error(`Presentation token group is invalid: ${group}`);
      const tokens = candidate.map((token) => String(token));
      for (const token of tokens) {
        if (!token.startsWith(namespace) || tokenSet.has(token)) throw new Error(`Presentation token is invalid or duplicated: ${token}`);
        tokenSet.add(token);
      }
      publicTokens[group] = Object.freeze(tokens);
    }
    const breakpoints: Record<string, number> = {};
    for (const [name, candidate] of Object.entries(breakpointsSource)) {
      const value = Number(candidate);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`Presentation breakpoint is invalid: ${name}`);
      breakpoints[name] = value;
    }
    const semanticStateMeaning: Record<string, string> = {};
    for (const [state, meaning] of Object.entries(stateMeanings)) semanticStateMeaning[state] = String(meaning);
    if (invariantsSource.defaultProfileImmutable !== true || invariantsSource.exactPixelReference !== defaultId || invariantsSource.domOrder !== "application-owned" || invariantsSource.focusOrder !== "application-owned") {
      throw new Error("Revision Director presentation invariants are invalid.");
    }
    return freezePresentationValue({
      format: "revision-director.presentation-manifest",
      version: 1,
      storageKey,
      defaults: { presentation: defaultId },
      profiles,
      breakpoints,
      tokens: {
        contractVersion,
        namespace,
        public: publicTokens,
      },
      invariants: {
        defaultProfileImmutable: true,
        exactPixelReference: defaultId,
        domOrder: "application-owned",
        focusOrder: "application-owned",
        semanticStateMeaning,
      },
    });
  }

  function installPresentationKernel(): PresentationKernelApi {
    const host = window as unknown as Record<PropertyKey, unknown>;
    const existing = host[PRESENTATION_KERNEL_SYMBOL];
    if (existing) return existing as PresentationKernelApi;

    const manifest = parsePresentationManifest();
    const registry = new Map<string, PresentationProfileDefinition>(Object.entries(manifest.profiles));
    const root = typeof document === "undefined" || !document.documentElement ? null : document.documentElement;
    let preferredPresentationId = manifest.defaults.presentation;
    let activePresentationId = manifest.defaults.presentation;

    const safeRead = (): string => {
      try {
        const stored = localStorage.getItem(manifest.storageKey);
        const clean = presentationId(stored);
        preferredPresentationId = clean || manifest.defaults.presentation;
      } catch {
        preferredPresentationId = manifest.defaults.presentation;
      }
      return registry.has(preferredPresentationId) ? preferredPresentationId : manifest.defaults.presentation;
    };

    const apply = (value: unknown): string => {
      const candidate = presentationId(value);
      const clean = candidate && registry.has(candidate) ? candidate : manifest.defaults.presentation;
      const profile = registry.get(clean) ?? manifest.profiles[manifest.defaults.presentation];
      if (!profile) throw new Error("Revision Director default presentation is unavailable.");
      activePresentationId = profile.id;
      if (root) {
        root.dataset.presentation = profile.id;
        for (const axis of PRESENTATION_AXES) root.dataset[axis] = profile[axis];
      }
      return profile.id;
    };

    const sameProfile = (left: PresentationProfileDefinition, right: PresentationProfileDefinition): boolean => (
      left.id === right.id && left.label === right.label && left.contractVersion === right.contractVersion && left.immutable === right.immutable
      && PRESENTATION_AXES.every((axis) => left[axis] === right[axis])
    );

    const api: PresentationKernelApi = freezePresentationValue({
      format: "revision-director.presentation-kernel",
      version: 1,
      manifest,
      activePresentationId: () => activePresentationId,
      listPresentations: () => Object.freeze([...registry.values()]),
      normalizePresentationId: (value: unknown) => {
        const clean = presentationId(value);
        return clean && registry.has(clean) ? clean : manifest.defaults.presentation;
      },
      readStoredPresentation: safeRead,
      restoreStoredPresentation: () => apply(safeRead()),
      registerPresentation: (value: unknown) => {
        const profile = parsePresentationProfile(value, manifest.tokens.contractVersion);
        if (!profile) return false;
        const current = registry.get(profile.id);
        if (current) return sameProfile(current, profile);
        registry.set(profile.id, profile);
        if (profile.id === preferredPresentationId) apply(profile.id);
        return true;
      },
      switchPresentation: (value: unknown, options: { persist?: boolean } = {}) => {
        const clean = presentationId(value);
        preferredPresentationId = clean || manifest.defaults.presentation;
        const applied = apply(preferredPresentationId);
        if (options.persist) {
          try { localStorage.setItem(manifest.storageKey, preferredPresentationId); } catch { /* presentation persistence is best-effort */ }
        }
        return applied;
      },
      validatePublicTokens: () => {
        if (!root || typeof getComputedStyle === "undefined") return true;
        const styles = getComputedStyle(root);
        for (const tokens of Object.values(manifest.tokens.public)) {
          for (const token of tokens) if (!styles.getPropertyValue(token).trim()) return false;
        }
        return true;
      },
    });
    Object.defineProperty(host, PRESENTATION_KERNEL_SYMBOL, {
      value: api,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    api.restoreStoredPresentation();
    return api;
  }

  const PRESENTATION_KERNEL = installPresentationKernel();
