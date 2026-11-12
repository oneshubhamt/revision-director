(() => {
  "use strict";
  /* Revision Director VA7.1 Pass E1 extension runtime.
   * Maintained as independently compilable TypeScript source parts sharing one
   * script namespace. The build seals their emitted JavaScript inside one IIFE.
   * Only the frozen, capability-versioned RevisionDirector API is public.
   */
  const FSRS = window.FSRS;
  // The vendored UMD bundle creates a temporary global. Capture the runtime
  // reference, then remove that public property so RevisionDirector remains the
  // only application capability exposed on window.
  try {
      delete window.FSRS;
  }
  catch { /* non-fatal */ }
  /* ==========================================================================
     DOMAIN MODEL
     ========================================================================== */

  /* ==========================================================================
     PRESENTATION MANIFEST AND KERNEL
     ========================================================================== */
  const EMBEDDED_PRESENTATION_MANIFEST = {"format":"revision-director.presentation-manifest","version":1,"storageKey":"revisionDirector.presentation.v1","defaults":{"presentation":"revision-current"},"profiles":{"revision-current":{"id":"revision-current","label":"Revision Director","contractVersion":1,"typography":"revision","shape":"tactical","material":"solid","depth":"layered","density":"standard","responsive":"adaptive","motion":"precise","charts":"analytical","immutable":true}},"breakpoints":{"wide":1100,"reviewCompact":1000,"analyticsCompact":960,"navigationCompact":820,"timerStack":720,"phone":620,"narrow":560,"smallPhone":460},"tokens":{"contractVersion":1,"namespace":"--rd-","public":{"foundation":["--rd-color-canvas","--rd-color-surface-1","--rd-color-surface-2","--rd-color-surface-3","--rd-color-border-soft","--rd-color-border-mid","--rd-color-border-accent","--rd-color-progress-track","--rd-color-accent-primary","--rd-color-accent-secondary","--rd-color-information","--rd-color-text-primary","--rd-color-text-secondary","--rd-color-text-muted","--rd-color-danger","--rd-color-warning","--rd-color-success"],"typography":["--rd-font-mono","--rd-font-condensed","--rd-font-body","--rd-font-display"],"surfaces":["--rd-surface-neutral","--rd-surface-accent-soft","--rd-surface-danger-soft","--rd-surface-information-soft","--rd-shadow-floating"],"geometry":["--rd-radius-default","--rd-layout-sidebar-width","--rd-touch-target-minimum","--rd-safe-area-top","--rd-safe-area-right","--rd-safe-area-bottom","--rd-safe-area-left"],"motion":["--rd-motion-fast","--rd-motion-standard"],"charts":["--rd-chart-primary","--rd-chart-secondary","--rd-chart-information","--rd-chart-danger","--rd-chart-warning","--rd-chart-success"]}},"invariants":{"defaultProfileImmutable":true,"exactPixelReference":"revision-current","domOrder":"application-owned","focusOrder":"application-owned","semanticStateMeaning":{"primary":"accent","information":"information","success":"success","warning":"warning","danger":"danger"}}};
  const PRESENTATION_KERNEL_SYMBOL = Symbol.for("revisionDirector.presentationKernel.v1");
  const PRESENTATION_ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;
  const PRESENTATION_AXES = Object.freeze([
      "typography", "shape", "material", "depth", "density", "responsive", "motion", "charts",
  ]);
  function presentationRecord(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  }
  function presentationId(value) {
      const candidate = String(value ?? "").trim().toLowerCase();
      return PRESENTATION_ID_PATTERN.test(candidate) ? candidate : "";
  }
  function freezePresentationValue(value) {
      if (typeof value !== "object" || value === null || Object.isFrozen(value))
          return value;
      for (const nested of Object.values(value))
          freezePresentationValue(nested);
      return Object.freeze(value);
  }
  function parsePresentationProfile(value, requiredContractVersion) {
      const source = presentationRecord(value);
      if (!source || Number(source["contractVersion"]) !== requiredContractVersion)
          return null;
      const id = presentationId(source["id"]);
      const label = String(source["label"] ?? id).trim().slice(0, 60);
      if (!id || !label)
          return null;
      const profile = {
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
          immutable: source["immutable"] === true,
      };
      for (const axis of PRESENTATION_AXES) {
          const clean = presentationId(source[axis]);
          if (!clean)
              return null;
          profile[axis] = clean;
      }
      return freezePresentationValue(profile);
  }
  function parsePresentationManifest() {
      let raw = EMBEDDED_PRESENTATION_MANIFEST;
      if (typeof document !== "undefined" && typeof document.getElementById === "function" && typeof HTMLScriptElement !== "undefined") {
          const node = document.getElementById("revision-director-presentation-manifest");
          if (!(node instanceof HTMLScriptElement))
              throw new Error("Revision Director presentation manifest is missing.");
          try {
              const embedded = JSON.parse(node.textContent ?? "");
              if (JSON.stringify(embedded) !== JSON.stringify(EMBEDDED_PRESENTATION_MANIFEST))
                  throw new Error("Presentation manifest parity mismatch.");
              raw = embedded;
          }
          catch (error) {
              throw new Error(`Revision Director presentation manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
          }
      }
      const source = presentationRecord(raw);
      const defaults = presentationRecord(source?.["defaults"]);
      const profilesSource = presentationRecord(source?.["profiles"]);
      const tokensSource = presentationRecord(source?.["tokens"]);
      const publicSource = presentationRecord(tokensSource?.["public"]);
      const breakpointsSource = presentationRecord(source?.["breakpoints"]);
      const invariantsSource = presentationRecord(source?.["invariants"]);
      const stateMeanings = presentationRecord(invariantsSource?.["semanticStateMeaning"]);
      if (source?.["format"] !== "revision-director.presentation-manifest" || source["version"] !== 1 || !defaults || !profilesSource || !tokensSource || !publicSource || !breakpointsSource || !invariantsSource || !stateMeanings) {
          throw new Error("Revision Director presentation manifest is incompatible.");
      }
      const contractVersion = Number(tokensSource["contractVersion"]);
      const defaultId = presentationId(defaults["presentation"]);
      const storageKey = String(source["storageKey"] ?? "").trim();
      const namespace = String(tokensSource["namespace"] ?? "").trim();
      if (!Number.isInteger(contractVersion) || contractVersion < 1 || !defaultId || !storageKey || namespace !== "--rd-") {
          throw new Error("Revision Director presentation manifest contract is invalid.");
      }
      const profiles = {};
      for (const [key, candidate] of Object.entries(profilesSource)) {
          const profile = parsePresentationProfile(candidate, contractVersion);
          if (!profile || profile.id !== key)
              throw new Error(`Presentation profile is invalid: ${key}`);
          profiles[key] = profile;
      }
      const defaultProfile = profiles[defaultId];
      if (!defaultProfile || !defaultProfile.immutable)
          throw new Error("The default Revision Director presentation must be immutable.");
      const publicTokens = {};
      const tokenSet = new Set();
      for (const [group, candidate] of Object.entries(publicSource)) {
          if (!Array.isArray(candidate) || !candidate.length)
              throw new Error(`Presentation token group is invalid: ${group}`);
          const tokens = candidate.map((token) => String(token));
          for (const token of tokens) {
              if (!token.startsWith(namespace) || tokenSet.has(token))
                  throw new Error(`Presentation token is invalid or duplicated: ${token}`);
              tokenSet.add(token);
          }
          publicTokens[group] = Object.freeze(tokens);
      }
      const breakpoints = {};
      for (const [name, candidate] of Object.entries(breakpointsSource)) {
          const value = Number(candidate);
          if (!Number.isFinite(value) || value <= 0)
              throw new Error(`Presentation breakpoint is invalid: ${name}`);
          breakpoints[name] = value;
      }
      const semanticStateMeaning = {};
      for (const [state, meaning] of Object.entries(stateMeanings))
          semanticStateMeaning[state] = String(meaning);
      if (invariantsSource["defaultProfileImmutable"] !== true || invariantsSource["exactPixelReference"] !== defaultId || invariantsSource["domOrder"] !== "application-owned" || invariantsSource["focusOrder"] !== "application-owned") {
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
  function installPresentationKernel() {
      const host = window;
      const existing = host[PRESENTATION_KERNEL_SYMBOL];
      if (existing)
          return existing;
      const manifest = parsePresentationManifest();
      const registry = new Map(Object.entries(manifest.profiles));
      const root = typeof document === "undefined" || !document.documentElement ? null : document.documentElement;
      let preferredPresentationId = manifest.defaults["presentation"];
      let activePresentationId = manifest.defaults["presentation"];
      const safeRead = () => {
          try {
              const stored = localStorage.getItem(manifest.storageKey);
              const clean = presentationId(stored);
              preferredPresentationId = clean || manifest.defaults["presentation"];
          }
          catch {
              preferredPresentationId = manifest.defaults["presentation"];
          }
          return registry.has(preferredPresentationId) ? preferredPresentationId : manifest.defaults["presentation"];
      };
      const apply = (value) => {
          const candidate = presentationId(value);
          const clean = candidate && registry.has(candidate) ? candidate : manifest.defaults["presentation"];
          const profile = registry.get(clean) ?? manifest.profiles[manifest.defaults["presentation"]];
          if (!profile)
              throw new Error("Revision Director default presentation is unavailable.");
          activePresentationId = profile.id;
          if (root) {
              root.dataset["presentation"] = profile.id;
              for (const axis of PRESENTATION_AXES)
                  root.dataset[axis] = profile[axis];
          }
          return profile.id;
      };
      const sameProfile = (left, right) => (left.id === right.id && left.label === right.label && left.contractVersion === right.contractVersion && left.immutable === right.immutable
          && PRESENTATION_AXES.every((axis) => left[axis] === right[axis]));
      const api = freezePresentationValue({
          format: "revision-director.presentation-kernel",
          version: 1,
          manifest,
          activePresentationId: () => activePresentationId,
          listPresentations: () => Object.freeze([...registry.values()]),
          normalizePresentationId: (value) => {
              const clean = presentationId(value);
              return clean && registry.has(clean) ? clean : manifest.defaults["presentation"];
          },
          readStoredPresentation: safeRead,
          restoreStoredPresentation: () => apply(safeRead()),
          registerPresentation: (value) => {
              const profile = parsePresentationProfile(value, manifest.tokens.contractVersion);
              if (!profile)
                  return false;
              const current = registry.get(profile.id);
              if (current)
                  return sameProfile(current, profile);
              registry.set(profile.id, profile);
              if (profile.id === preferredPresentationId)
                  apply(profile.id);
              return true;
          },
          switchPresentation: (value, options = {}) => {
              const clean = presentationId(value);
              preferredPresentationId = clean || manifest.defaults["presentation"];
              const applied = apply(preferredPresentationId);
              if (options.persist) {
                  try {
                      localStorage.setItem(manifest.storageKey, preferredPresentationId);
                  }
                  catch { /* presentation persistence is best-effort */ }
              }
              return applied;
          },
          validatePublicTokens: () => {
              if (!root || typeof getComputedStyle === "undefined")
                  return true;
              const styles = getComputedStyle(root);
              for (const tokens of Object.values(manifest.tokens.public)) {
                  for (const token of tokens)
                      if (!styles.getPropertyValue(token).trim())
                          return false;
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

  const Rating = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 });
  /* ==========================================================================
     UTILITIES & INVARIANTS
     ========================================================================== */

  const APP_VERSION = "va7.1-pass-f1";
  const DB_NAME = "revision-director";
  const DB_VERSION = 3;
  const DOCUMENT_SCHEMA_VERSION = 1;
  const BACKUP_FORMAT = "revision-director-backup";
  const BACKUP_SCHEMA_VERSION = 2;
  const DIAGNOSTICS_STORAGE_KEY = "revision-director:diagnostics:v1";
  const ACTIVE_RETRIEVAL_ID = "current";
  const ACTIVE_RETRIEVAL_RECOVERY_KEY = "revision-director:active-retrieval:v1";
  const ACTIVE_RETRIEVAL_RECOVERY_FORMAT = "revision-director-active-retrieval";
  const ACTIVE_RETRIEVAL_DEBOUNCE_MS = 350;
  const ACTIVE_RETRIEVAL_RECOVERY_MAX_CHARS = 900_000;
  const ACTIVE_RETRIEVAL_RECOVERY_TEXT_CHARS = 160_000;
  const ACTIVE_RETRIEVAL_RECOVERY_POINTS = 12_000;
  const INACTIVE_GAP_THRESHOLD_MS = 120_000;
  const REVIEW_OWNER_STORAGE_KEY = "revision-director:review-owner:v1";
  const REVIEW_OWNER_CHANNEL = "revision-director-review-owner";
  const REVIEW_OWNER_HEARTBEAT_MS = 4_000;
  const REVIEW_OWNER_STALE_MS = 15_000;
  const REVIEW_OWNER_TAKEOVER_WAIT_MS = 1_800;
  const TIME_HISTORY_LIMIT = 200;
  const PLANNER_VERSION = "pass-d-2";
  const FSRS_PACKAGE_VERSION = "6.0.0";
  const FSRS_MODEL = "FSRS-7";
  const FSRS_LEARNING_STEPS = ["1d"];
  const FSRS_RELEARNING_STEPS = ["1d"];
  const FSRS_GRADUATING_INTERVAL_DAYS = 1;
  const FSRS_MAXIMUM_INTERVAL_DAYS = 36_500;
  const FINAL_MEMORY_REVIEW_WINDOW_DAYS = 3;
  const DAY_MS = 86_400_000;
  function assert(condition, message) {
      if (!condition)
          throw new Error(message);
  }
  function isRecord(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function requireRecord(value, label) {
      assert(isRecord(value), `${label} must be an object.`);
      return value;
  }
  function literalChoice(value, allowed, label) {
      assert(allowed.some((candidate) => candidate === value), `${label} is invalid.`);
      return value;
  }
  function literalChoiceOrUndefined(value, allowed) {
      return allowed.some((candidate) => candidate === value) ? value : undefined;
  }
  function requiredString(value, label) {
      assert(typeof value === "string", `${label} must be a string.`);
      return value;
  }
  function requiredArray(value, label) {
      assert(Array.isArray(value), `${label} must be an array.`);
      return value;
  }
  function formText(data, name, fallback = "") {
      const value = data.get(name);
      if (value === null)
          return fallback;
      assert(typeof value === "string", `${name} must be text.`);
      return value;
  }
  function formNumber(data, name) {
      const value = Number(formText(data, name));
      assert(Number.isFinite(value), `${name} must be a finite number.`);
      return value;
  }
  function requiredNamedFormControl(form, name, constructor) {
      const control = form.elements.namedItem(name);
      assert(control instanceof constructor, `Missing or invalid form control: ${name}.`);
      return control;
  }
  function formInput(form, name) {
      return requiredNamedFormControl(form, name, HTMLInputElement);
  }
  function formSelect(form, name) {
      return requiredNamedFormControl(form, name, HTMLSelectElement);
  }
  function formTextarea(form, name) {
      return requiredNamedFormControl(form, name, HTMLTextAreaElement);
  }
  const ENTITY_STATUSES = ["active", "suspended", "archived"];
  const ACTIVITY_MODES = ["learn", "review", "practice", "test"];
  const STUDY_ORIGINS = ["manual", "study-director"];
  const OBLIGATION_TYPES = ["memory-recall", "concept-reconstruction", "application-practice", "performance-practice", "relearn", "freshness-review"];
  const RETRIEVAL_WORKFLOWS = ["recall", "reconstruction", "questions", "diagram", "answer-writing", "relearning"];
  const RESPONSE_MEDIA = ["in-app", "paper", "oral"];
  const CUE_LEVELS = ["none", "minor", "major", "source"];
  const RECONSTRUCTION_SHAPES = ["outline", "table", "flow", "concept-map", "sequence"];
  const ANSWER_MODES = ["outline", "full-answer"];
  const DIAGRAM_SURFACES = ["canvas", "paper"];
  const ERROR_TYPE_VALUES = ["factual-omission", "conceptual-misunderstanding", "confusion-interference", "application-failure", "answer-structure", "diagram-reconstruction", "slow-retrieval"];
  const INACTIVE_GAP_CLASSIFICATIONS = ["focus", "break", "split", "ignore"];
  const BACKUP_ACTIVE_SESSION_TREATMENTS = ["restore", "discard"];
  const RUBRIC_SCORES = [0, 1, 2, 3, 4];
  const IMPORTANCE_LEVELS = [1, 2, 3];
  const UNDERSTANDING_LEVELS = [1, 2, 3, 4];
  const RATING_LABELS = {
      [Rating.Again]: "Again",
      [Rating.Hard]: "Hard",
      [Rating.Good]: "Good",
      [Rating.Easy]: "Easy",
  };
  const OBLIGATION_LABELS = {
      "memory-recall": "Memory recall",
      "concept-reconstruction": "Concept reconstruction",
      "application-practice": "Application practice",
      "performance-practice": "Performance practice",
      relearn: "Relearn",
      "freshness-review": "Freshness review",
  };
  const OBLIGATION_CHIPS = {
      "memory-recall": "memory",
      "concept-reconstruction": "concept",
      "application-practice": "application",
      "performance-practice": "performance",
      relearn: "relearn",
      "freshness-review": "freshness",
  };
  const WORKFLOW_LABELS = {
      recall: "Recall",
      reconstruction: "Reconstruction",
      questions: "Questions / application",
      diagram: "Diagram practice",
      "answer-writing": "Answer writing",
      relearning: "Relearning",
  };
  const RESPONSE_MEDIUM_LABELS = {
      "in-app": "In-app workspace",
      paper: "Paper / external workspace",
      oral: "Oral recall",
  };
  const CUE_LEVEL_SCORES = {
      none: 4,
      minor: 3,
      major: 1,
      source: 0,
  };
  const WORKFLOWS_BY_OBLIGATION = {
      "memory-recall": ["recall"],
      "concept-reconstruction": ["reconstruction", "diagram"],
      "application-practice": ["questions"],
      "performance-practice": ["answer-writing", "diagram", "questions"],
      relearn: ["relearning"],
      "freshness-review": ["recall", "reconstruction"],
  };
  const ERROR_LABELS = {
      "factual-omission": "Factual omission",
      "conceptual-misunderstanding": "Conceptual misunderstanding",
      "confusion-interference": "Confusion / interference",
      "application-failure": "Application failure",
      "answer-structure": "Answer structure",
      "diagram-reconstruction": "Diagram reconstruction",
      "slow-retrieval": "Slow retrieval",
  };
  const POLICY_ENGINE_BY_OBLIGATION = {
      "memory-recall": "ts-fsrs",
      "concept-reconstruction": "mastery",
      "application-practice": "application",
      "performance-practice": "performance",
      relearn: "relearn",
      "freshness-review": "freshness",
  };
  function nowIso() {
      return new Date().toISOString();
  }
  function uid(prefix) {
      const random = crypto.getRandomValues(new Uint32Array(2));
      return `${prefix}_${Date.now().toString(36)}_${random[0].toString(36)}${random[1].toString(36)}`;
  }
  function clone(value) {
      return structuredClone(value);
  }
  function ownedArrayBuffer(bytes) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
  }
  function utf8Bytes(value) {
      if (typeof TextEncoder !== "undefined")
          return new TextEncoder().encode(value);
      const bytes = [];
      for (const symbol of value) {
          const point = symbol.codePointAt(0);
          if (point <= 0x7f)
              bytes.push(point);
          else if (point <= 0x7ff)
              bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
          else if (point <= 0xffff)
              bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
          else
              bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      }
      return new Uint8Array(bytes);
  }
  function sha256FallbackHex(input) {
      const constants = new Uint32Array([
          0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
          0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
          0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
          0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
          0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
          0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
          0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
          0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
      ]);
      const bitLength = BigInt(input.byteLength) * 8n;
      const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
      const bytes = new Uint8Array(paddedLength);
      bytes.set(input);
      bytes[input.byteLength] = 0x80;
      for (let index = 0; index < 8; index += 1)
          bytes[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
      const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
      const words = new Uint32Array(64);
      const rotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
      for (let offset = 0; offset < bytes.length; offset += 64) {
          for (let index = 0; index < 16; index += 1) {
              const base = offset + index * 4;
              words[index] = ((bytes[base] << 24) | (bytes[base + 1] << 16) | (bytes[base + 2] << 8) | bytes[base + 3]) >>> 0;
          }
          for (let index = 16; index < 64; index += 1) {
              const x = words[index - 15], y = words[index - 2];
              const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
              const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
              words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
          }
          let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
          for (let index = 0; index < 64; index += 1) {
              const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
              const choice = (e & f) ^ (~e & g);
              const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
              const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
              const majority = (a & b) ^ (a & c) ^ (b & c);
              const temp2 = (sum0 + majority) >>> 0;
              h = g;
              g = f;
              f = e;
              e = (d + temp1) >>> 0;
              d = c;
              c = b;
              b = a;
              a = (temp1 + temp2) >>> 0;
          }
          state[0] = (state[0] + a) >>> 0;
          state[1] = (state[1] + b) >>> 0;
          state[2] = (state[2] + c) >>> 0;
          state[3] = (state[3] + d) >>> 0;
          state[4] = (state[4] + e) >>> 0;
          state[5] = (state[5] + f) >>> 0;
          state[6] = (state[6] + g) >>> 0;
          state[7] = (state[7] + h) >>> 0;
      }
      return [...state].map((value) => value.toString(16).padStart(8, "0")).join("");
  }
  async function sha256Hex(bytes) {
      if (globalThis.crypto?.subtle) {
          const digest = await globalThis.crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes));
          return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
      }
      return sha256FallbackHex(bytes);
  }
  function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
  }
  function roundTo(value, decimals) {
      const factor = 10 ** decimals;
      return Math.round(value * factor) / factor;
  }
  function normalizeName(value) {
      return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
  }
  function escapeHtml(value) {
      return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
  }
  function parseDate(value) {
      const date = new Date(value);
      assert(Number.isFinite(date.getTime()), "Invalid date-time value.");
      return date;
  }
  function validateCalendarDate(value, label = "Exam date") {
      assert(/^\d{4}-\d{2}-\d{2}$/.test(value), `${label} is invalid.`);
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      assert(date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day, `${label} is invalid.`);
  }
  function toLocalInput(value) {
      const date = new Date(value);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
      return local.toISOString().slice(0, 16);
  }
  function localInputToIso(value) {
      const date = new Date(value);
      assert(Number.isFinite(date.getTime()), "Enter a valid date and time.");
      return date.toISOString();
  }
  function formatDateTime(value, withTime = true) {
      const date = value instanceof Date ? value : new Date(value);
      const options = withTime
          ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
          : { day: "2-digit", month: "short", year: "numeric" };
      return new Intl.DateTimeFormat("en-IN", options).format(date);
  }
  function formatDuration(ms) {
      const minutes = Math.floor(Math.max(0, ms) / 60_000);
      const seconds = Math.floor(Math.max(0, ms) / 1000) % 60;
      if (minutes >= 60)
          return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
      return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  function ratingName(rating) {
      return RATING_LABELS[rating];
  }
  function obligationLabel(type) {
      return OBLIGATION_LABELS[type];
  }
  function obligationChip(type) {
      return OBLIGATION_CHIPS[type];
  }
  function workflowLabel(kind) {
      return WORKFLOW_LABELS[kind];
  }
  function responseMediumLabel(value) {
      return RESPONSE_MEDIUM_LABELS[value];
  }
  function cueLevelScore(value) {
      return CUE_LEVEL_SCORES[value];
  }
  function compatibleWorkflows(type) {
      return WORKFLOWS_BY_OBLIGATION[type];
  }
  function defaultWorkflowForType(type) {
      return WORKFLOWS_BY_OBLIGATION[type][0];
  }
  function defaultWorkflowSpec(type, protocol, successCriteria) {
      const kind = defaultWorkflowForType(type);
      const common = {
          kind,
          prompt: protocol.trim() || "Attempt the required retrieval before consulting the source.",
          checkpoints: successCriteria.split(/\n|;/).map((item) => item.trim()).filter(Boolean).slice(0, 12),
          responseMedium: kind === "diagram" || kind === "answer-writing" ? "paper" : "in-app",
      };
      if (common.checkpoints.length === 0)
          common.checkpoints = [successCriteria.trim() || "Complete the stated success criteria."];
      if (kind === "reconstruction")
          common.reconstructionShape = "outline";
      if (kind === "questions") {
          common.targetCount = 10;
          common.questionSetRef = "External question set";
      }
      if (kind === "diagram")
          common.diagramSurface = "canvas";
      if (kind === "answer-writing") {
          common.answerMode = "full-answer";
          common.timeLimitMinutes = 10;
          common.wordLimit = 150;
      }
      return common;
  }
  function validateWorkflowSpec(spec, type) {
      assert(RETRIEVAL_WORKFLOWS.includes(spec.kind), "Retrieval workflow is invalid.");
      assert(spec.prompt.trim().length >= 3, "Retrieval workflow prompt is required.");
      assert(Array.isArray(spec.checkpoints) && spec.checkpoints.length >= 1 && spec.checkpoints.length <= 20, "Add between 1 and 20 observable checkpoints.");
      assert(spec.checkpoints.every((item) => typeof item === "string" && item.trim().length >= 2 && item.trim().length <= 300), "Workflow checkpoints are invalid.");
      assert(spec.responseMedium === "in-app" || spec.responseMedium === "paper" || spec.responseMedium === "oral", "Response medium is invalid.");
      if (spec.targetCount !== undefined)
          assert(Number.isInteger(spec.targetCount) && spec.targetCount >= 1 && spec.targetCount <= 500, "Target count is invalid.");
      if (spec.questionSetRef !== undefined)
          assert(spec.questionSetRef.trim().length >= 2 && spec.questionSetRef.trim().length <= 500, "Question-set reference is invalid.");
      if (spec.timeLimitMinutes !== undefined)
          assert(Number.isFinite(spec.timeLimitMinutes) && spec.timeLimitMinutes >= 1 && spec.timeLimitMinutes <= 240, "Workflow time limit is invalid.");
      if (spec.wordLimit !== undefined)
          assert(Number.isInteger(spec.wordLimit) && spec.wordLimit >= 20 && spec.wordLimit <= 5000, "Word limit is invalid.");
      if (spec.kind === "reconstruction")
          assert(["outline", "table", "flow", "concept-map", "sequence"].includes(spec.reconstructionShape ?? ""), "Reconstruction form is required.");
      if (spec.kind === "questions") {
          assert(spec.targetCount !== undefined, "Question workflow requires a target count.");
          assert((spec.questionSetRef?.trim().length ?? 0) >= 2, "Question workflow requires a question-set reference.");
      }
      if (spec.kind === "diagram")
          assert(spec.diagramSurface === "canvas" || spec.diagramSurface === "paper", "Diagram surface is required.");
      if (spec.kind === "answer-writing") {
          assert(spec.answerMode === "outline" || spec.answerMode === "full-answer", "Answer-writing mode is required.");
          assert(spec.timeLimitMinutes !== undefined, "Answer writing requires a time limit.");
          assert(spec.wordLimit !== undefined, "Answer writing requires a word limit.");
      }
      assert(compatibleWorkflows(type).includes(spec.kind), `${workflowLabel(spec.kind)} is not appropriate for ${obligationLabel(type)}.`);
  }
  function workflowSpecFromForm(form, type) {
      const data = new FormData(form);
      const kind = literalChoice(formText(data, "workflowKind", defaultWorkflowForType(type)), RETRIEVAL_WORKFLOWS, "Retrieval workflow");
      const spec = {
          kind,
          prompt: formText(data, "workflowPrompt").trim(),
          checkpoints: formText(data, "workflowCheckpoints").split(/\n/).map((item) => item.trim()).filter(Boolean),
          responseMedium: literalChoice(formText(data, "responseMedium", "in-app"), RESPONSE_MEDIA, "Response medium"),
      };
      if (kind === "questions") {
          spec.targetCount = formNumber(data, "targetCount");
          spec.questionSetRef = formText(data, "questionSetRef").trim();
      }
      if (kind === "reconstruction")
          spec.reconstructionShape = literalChoice(formText(data, "reconstructionShape", "outline"), RECONSTRUCTION_SHAPES, "Reconstruction shape");
      if (kind === "diagram")
          spec.diagramSurface = literalChoice(formText(data, "diagramSurface", "canvas"), DIAGRAM_SURFACES, "Diagram surface");
      if (kind === "answer-writing") {
          spec.answerMode = literalChoice(formText(data, "answerMode", "full-answer"), ANSWER_MODES, "Answer mode");
          spec.timeLimitMinutes = formNumber(data, "timeLimitMinutes");
          spec.wordLimit = formNumber(data, "wordLimit");
      }
      validateWorkflowSpec(spec, type);
      return spec;
  }
  function populateWorkflowOptions(form, type, selected) {
      const select = formSelect(form, "workflowKind");
      const allowed = compatibleWorkflows(type);
      select.innerHTML = allowed.map((kind) => `<option value="${kind}">${escapeHtml(workflowLabel(kind))}</option>`).join("");
      select.value = selected && allowed.includes(selected) ? selected : allowed[0];
  }
  function populateWorkflowForm(form, spec, type) {
      populateWorkflowOptions(form, type, spec.kind);
      formSelect(form, "workflowKind").value = spec.kind;
      formSelect(form, "responseMedium").value = spec.responseMedium;
      formTextarea(form, "workflowPrompt").value = spec.prompt;
      formTextarea(form, "workflowCheckpoints").value = spec.checkpoints.join("\n");
      formInput(form, "targetCount").value = String(spec.targetCount ?? 10);
      formInput(form, "questionSetRef").value = spec.questionSetRef ?? "External question set";
      formSelect(form, "reconstructionShape").value = spec.reconstructionShape ?? "outline";
      formSelect(form, "diagramSurface").value = spec.diagramSurface ?? "canvas";
      formSelect(form, "answerMode").value = spec.answerMode ?? "full-answer";
      formInput(form, "timeLimitMinutes").value = String(spec.timeLimitMinutes ?? 10);
      formInput(form, "wordLimit").value = String(spec.wordLimit ?? 150);
      updateWorkflowFields(form);
  }
  function updateWorkflowFields(form) {
      const kind = literalChoice(formSelect(form, "workflowKind").value, RETRIEVAL_WORKFLOWS, "Retrieval workflow");
      form.querySelectorAll("[data-workflow-field]").forEach((field) => {
          field.hidden = field.dataset["workflowField"] !== kind;
      });
  }
  function applyDefaultWorkflowToForm(form, type) {
      const protocol = formTextarea(form, "protocol").value;
      const success = formTextarea(form, "successCriteria").value;
      populateWorkflowForm(form, defaultWorkflowSpec(type, protocol, success), type);
  }
  function checkpointScore(met, total) {
      if (total <= 0)
          return 0;
      return clamp(Math.round((met / total) * 4), 0, 4);
  }
  function meanRubric(values) {
      return clamp(Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)), 0, 4);
  }
  function workflowEvidence(result, errorTypes, correctionNote) {
      let evidence;
      if (result.kind === "recall") {
          evidence = {
              completeness: checkpointScore(result.checkpointsMet, result.checkpointTotal),
              independence: cueLevelScore(result.cueLevel),
              application: 2,
              errorTypes,
              correctionNote,
          };
      }
      else if (result.kind === "reconstruction") {
          evidence = {
              completeness: checkpointScore(result.checkpointsMet, result.checkpointTotal),
              independence: cueLevelScore(result.cueLevel),
              application: meanRubric([result.structuralAccuracy, result.relationshipAccuracy]),
              errorTypes,
              correctionNote,
          };
      }
      else if (result.kind === "questions") {
          const weightedCorrect = result.correct + result.partial * 0.5;
          const accuracy = result.attempted > 0 ? (weightedCorrect / result.attempted) * 100 : 0;
          evidence = {
              completeness: checkpointScore(result.attempted, result.targetCount),
              independence: cueLevelScore(result.cueLevel),
              application: clamp(Math.round(accuracy / 25), 0, 4),
              accuracyPercent: roundTo(accuracy, 1),
              errorTypes,
              correctionNote,
          };
      }
      else if (result.kind === "diagram") {
          evidence = {
              completeness: checkpointScore(result.checkpointsMet, result.checkpointTotal),
              independence: cueLevelScore(result.cueLevel),
              application: meanRubric([result.labelAccuracy, result.spatialAccuracy, result.processAccuracy]),
              errorTypes,
              correctionNote,
          };
      }
      else if (result.kind === "answer-writing") {
          let completion = meanRubric([result.demandAddressed, result.structure, result.conclusion]);
          const wordRatio = result.wordLimit > 0 ? result.wordCount / result.wordLimit : 1;
          if (!result.completedWithinTime)
              completion = clamp(completion - 1, 0, 4);
          if (wordRatio < 0.6 || wordRatio > 1.35)
              completion = clamp(completion - 1, 0, 4);
          evidence = {
              completeness: completion,
              independence: cueLevelScore(result.cueLevel),
              application: meanRubric([result.contentAccuracy, result.examplesEvidence, result.demandAddressed]),
              errorTypes,
              correctionNote,
          };
      }
      else {
          evidence = {
              completeness: checkpointScore(result.checkpointsMet, result.checkpointTotal),
              independence: result.sourceClosedForVerification ? 4 : 1,
              application: result.repairCompleted ? 3 : 1,
              errorTypes,
              correctionNote,
          };
      }
      return evidence;
  }
  function validateWorkflowResult(result, expected) {
      assert(result.kind === expected, "Workflow result does not match the obligation workflow.");
      const integer = (value, min, max, label) => assert(Number.isInteger(value) && value >= min && value <= max, `${label} is invalid.`);
      const rubric = (value, label) => integer(value, 0, 4, label);
      if ("cueLevel" in result)
          assert(CUE_LEVELS.includes(result.cueLevel), "Cue level is invalid.");
      if ("responseMedium" in result)
          assert(RESPONSE_MEDIA.includes(result.responseMedium), "Response medium is invalid.");
      if (result.kind === "recall") {
          integer(result.checkpointTotal, 1, 20, "Recall checkpoint total");
          integer(result.checkpointsMet, 0, result.checkpointTotal, "Recall checkpoints met");
      }
      else if (result.kind === "reconstruction") {
          integer(result.checkpointTotal, 1, 20, "Reconstruction checkpoint total");
          integer(result.checkpointsMet, 0, result.checkpointTotal, "Reconstruction checkpoints met");
          rubric(result.structuralAccuracy, "Structural accuracy");
          rubric(result.relationshipAccuracy, "Relationship accuracy");
      }
      else if (result.kind === "questions") {
          integer(result.targetCount, 1, 500, "Question target");
          integer(result.attempted, 1, 500, "Questions attempted");
          integer(result.correct, 0, result.attempted, "Correct answers");
          integer(result.partial, 0, result.attempted, "Partially correct answers");
          integer(result.incorrect, 0, result.attempted, "Incorrect answers");
          assert(result.correct + result.partial + result.incorrect === result.attempted, "Question outcomes must equal questions attempted.");
          integer(result.novelCount, 0, result.attempted, "Novel questions");
          assert(result.questionSetRef.trim().length >= 2 && result.questionSetRef.trim().length <= 500, "Question-set reference is invalid.");
          assert(result.errorSummary.length <= 5000, "Question error summary is too long.");
      }
      else if (result.kind === "diagram") {
          integer(result.checkpointTotal, 1, 20, "Diagram checkpoint total");
          integer(result.checkpointsMet, 0, result.checkpointTotal, "Diagram checkpoints met");
          rubric(result.labelAccuracy, "Label accuracy");
          rubric(result.spatialAccuracy, "Spatial accuracy");
          rubric(result.processAccuracy, "Process accuracy");
          assert(result.attemptCompleted, "Complete the diagram attempt before rating it.");
      }
      else if (result.kind === "answer-writing") {
          for (const [value, label] of [[result.demandAddressed, "Demand"], [result.structure, "Structure"], [result.contentAccuracy, "Content"], [result.examplesEvidence, "Examples"], [result.conclusion, "Conclusion"]])
              rubric(value, label);
          assert(Number.isFinite(result.attemptElapsedMs) && result.attemptElapsedMs >= 0 && result.attemptElapsedMs <= 86_400_000, "Answer-writing attempt time is invalid.");
          integer(result.timeLimitMinutes, 1, 240, "Answer-writing time limit");
          integer(result.wordCount, 0, 10000, "Word count");
          integer(result.wordLimit, 20, 5000, "Word limit");
      }
      else {
          integer(result.checkpointTotal, 1, 20, "Verification checkpoint total");
          integer(result.checkpointsMet, 0, result.checkpointTotal, "Verification checkpoints met");
          assert(ERROR_TYPES.has(result.diagnosis), "Relearning diagnosis is invalid.");
          assert(result.repairAction.trim().length >= 3, "Record the repair action.");
          assert(result.verificationText.trim().length >= 3, "Complete a closed-book verification.");
          assert(result.repairCompleted, "Finish the repair step before verification.");
          assert(result.sourceClosedForVerification, "Complete relearning verification with the source closed.");
      }
  }
  function errorLabel(type) {
      return ERROR_LABELS[type];
  }
  function addDays(from, days) {
      return new Date(from.getTime() + days * DAY_MS);
  }
  function daysBetween(later, earlier) {
      return Math.max(0, (later.getTime() - earlier.getTime()) / DAY_MS);
  }
  function intervalLabel(dueAt, now = new Date()) {
      const diff = new Date(dueAt).getTime() - now.getTime();
      if (diff < 90 * 60_000)
          return `${Math.max(1, Math.round(diff / 60_000))}m`;
      if (diff < DAY_MS)
          return `${Math.max(1, Math.round(diff / 3_600_000))}h`;
      const days = Math.max(1, Math.round(diff / DAY_MS));
      if (days < 30)
          return `${days}d`;
      if (days < 365)
          return `${Math.round(days / 30)}mo`;
      return `${roundTo(days / 365, 1)}y`;
  }
  function studyDayStart(now, boundaryHour) {
      const start = new Date(now);
      start.setHours(boundaryHour, 0, 0, 0);
      if (now.getTime() < start.getTime())
          start.setDate(start.getDate() - 1);
      return start;
  }
  function studyDayEnd(now, boundaryHour) {
      const end = studyDayStart(now, boundaryHour);
      end.setDate(end.getDate() + 1);
      return end;
  }
  function latestPlanVersion(record) {
      const latest = record.versions.at(-1);
      assert(latest, "Daily plan has no versions.");
      return latest;
  }
  function studyDayKey(now, boundaryHour) {
      const start = studyDayStart(now, boundaryHour);
      const year = start.getFullYear();
      const month = String(start.getMonth() + 1).padStart(2, "0");
      const day = String(start.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
  }
  function defaultSettings() {
      return {
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          key: "app",
          activeProfileId: "",
          fsrsScheduling: defaultFsrsSchedulingSettings(),
          memoryDifficultyPolicy: defaultMemoryDifficultyPolicy(),
          dailyCapacityMinutes: 60,
          studyDayBoundaryHour: 4,
          fsrsPersonalization: defaultFsrsPersonalizationSettings(),
      };
  }
  function validateRating(value) {
      assert(value === 1 || value === 2 || value === 3 || value === 4, "Invalid rating.");
      return value;
  }
  const ERROR_TYPES = new Set(ERROR_TYPE_VALUES);
  function objectiveScore(type, evidence) {
      const accuracyScore = evidence.accuracyPercent === undefined ? null : clamp(evidence.accuracyPercent / 25, 0, 4);
      let score;
      if (type === "memory-recall") {
          score = evidence.completeness * 0.5 + evidence.independence * 0.4 + evidence.application * 0.1;
      }
      else if (type === "concept-reconstruction") {
          score = evidence.completeness * 0.4 + evidence.independence * 0.35 + evidence.application * 0.25;
      }
      else if (type === "application-practice" || type === "performance-practice") {
          score = evidence.completeness * 0.2 + evidence.independence * 0.25 + evidence.application * 0.3;
          if (accuracyScore !== null)
              score += accuracyScore * 0.25;
          else
              score += evidence.application * 0.25;
      }
      else {
          score = evidence.completeness * 0.4 + evidence.independence * 0.4 + evidence.application * 0.2;
      }
      const penalty = Math.min(1.2, evidence.errorTypes.length * 0.18);
      return clamp(score - penalty, 0, 4);
  }
  function suggestRating(type, evidence) {
      if (type === "memory-recall") {
          // FSRS ratings describe recall quality, not a generic rubric percentile.
          // Objective evidence can identify failure, partial/cued recall and solid recall;
          // "Easy" remains a user judgement for unusually effortless retrieval.
          if (evidence.completeness <= 1 || evidence.independence <= 1)
              return Rating.Again;
          if (evidence.completeness < 4 || evidence.independence < 4 || evidence.errorTypes.length > 0)
              return Rating.Hard;
          return Rating.Good;
      }
      const score = objectiveScore(type, evidence);
      if (score < 1.45)
          return Rating.Again;
      if (score < 2.45)
          return Rating.Hard;
      if (score < 3.45)
          return Rating.Good;
      return Rating.Easy;
  }
  function validateEvidence(evidence) {
      for (const value of [evidence.completeness, evidence.independence, evidence.application]) {
          assert(Number.isInteger(value) && value >= 0 && value <= 4, "Evidence rubric values must be from 0 to 4.");
      }
      if (evidence.accuracyPercent !== undefined) {
          assert(Number.isFinite(evidence.accuracyPercent) && evidence.accuracyPercent >= 0 && evidence.accuracyPercent <= 100, "Accuracy must be between 0 and 100.");
      }
      assert(Array.isArray(evidence.errorTypes), "Evidence errors must be an array.");
      assert(new Set(evidence.errorTypes).size === evidence.errorTypes.length, "Evidence errors cannot contain duplicates.");
      for (const errorType of evidence.errorTypes)
          assert(ERROR_TYPES.has(errorType), "Evidence contains an invalid error type.");
      assert(typeof evidence.correctionNote === "string", "Evidence correction note is invalid.");
  }
  /* ==========================================================================
     SCHEDULER-POLICY ROUTER
     ========================================================================== */

  function canonicalId(value, label) {
      assert(typeof value === "string", `${label} must be a string.`);
      const canonical = value.trim();
      assert(canonical.length > 0 && canonical.length <= 240, `${label} is invalid.`);
      return canonical;
  }
  function canonicalOptionalId(value, label) {
      return value === undefined ? undefined : canonicalId(value, label);
  }
  function canonicalName(value, label, maxLength = 240) {
      assert(typeof value === "string", `${label} must be a string.`);
      const canonical = value.trim().replace(/\s+/g, " ");
      assert(canonical.length > 0 && canonical.length <= maxLength, `${label} is invalid.`);
      return canonical;
  }
  function canonicalText(value, label, maxLength = 20_000) {
      assert(typeof value === "string", `${label} must be a string.`);
      const canonical = value.trim();
      assert(canonical.length <= maxLength, `${label} is too long.`);
      return canonical;
  }
  function canonicalIso(value, label) {
      assert(typeof value === "string", `${label} must be a date-time string.`);
      return parseDate(value).toISOString();
  }
  function canonicalOptionalIso(value, label) {
      return value === undefined ? undefined : canonicalIso(value, label);
  }
  function assertDocumentSchema(value, label) {
      assert(value.schemaVersion === DOCUMENT_SCHEMA_VERSION, `${label} uses an unsupported document schema.`);
  }
  function canonicalWorkflowSpec(value) {
      const workflow = clone(value);
      workflow.prompt = canonicalText(workflow.prompt, "Workflow prompt", 8_000);
      workflow.checkpoints = [...new Set(workflow.checkpoints.map((checkpoint) => canonicalName(checkpoint, "Workflow checkpoint", 500)))];
      workflow.responseMedium = workflow.responseMedium;
      if (workflow.questionSetRef !== undefined)
          workflow.questionSetRef = canonicalText(workflow.questionSetRef, "Question-set reference", 2_000);
      return workflow;
  }
  function canonicalPolicyState(value) {
      const state = clone(value);
      if (state.fsrsCard) {
          state.fsrsCard.dueAt = canonicalIso(state.fsrsCard.dueAt, "FSRS due date");
          if (state.fsrsCard.lastReviewAt !== undefined)
              state.fsrsCard.lastReviewAt = canonicalIso(state.fsrsCard.lastReviewAt, "FSRS last review date");
          else
              delete state.fsrsCard.lastReviewAt;
      }
      return state;
  }
  function canonicalExamProfile(value) {
      assertDocumentSchema(value, "Exam profile");
      if (value.examDate)
          validateCalendarDate(value.examDate, "Exam date");
      return {
          ...clone(value),
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          id: canonicalId(value.id, "Exam profile ID"),
          name: canonicalName(value.name, "Exam profile name"),
          examDate: value.examDate,
          createdAt: canonicalIso(value.createdAt, "Exam profile creation date"),
          updatedAt: canonicalIso(value.updatedAt, "Exam profile update date"),
      };
  }
  function canonicalKnowledgeNode(value) {
      assertDocumentSchema(value, "Knowledge node");
      const name = canonicalName(value.name, "Knowledge-node name");
      return {
          ...clone(value),
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          id: canonicalId(value.id, "Knowledge-node ID"),
          profileId: canonicalId(value.profileId, "Knowledge-node profile ID"),
          parentId: value.parentId === null ? null : canonicalId(value.parentId, "Knowledge-node parent ID"),
          name,
          normalizedName: normalizeName(name),
          createdAt: canonicalIso(value.createdAt, "Knowledge-node creation date"),
          updatedAt: canonicalIso(value.updatedAt, "Knowledge-node update date"),
      };
  }
  function canonicalKnowledgeUnit(value) {
      assertDocumentSchema(value, "Knowledge unit");
      const unit = clone(value);
      unit.schemaVersion = DOCUMENT_SCHEMA_VERSION;
      unit.id = canonicalId(unit.id, "Knowledge-unit ID");
      unit.profileId = canonicalId(unit.profileId, "Knowledge-unit profile ID");
      unit.topicNodeId = canonicalId(unit.topicNodeId, "Knowledge-unit topic ID");
      unit.title = canonicalName(unit.title, "Knowledge-unit title", 500);
      unit.scope = canonicalText(unit.scope, "Knowledge-unit scope");
      unit.source = canonicalText(unit.source, "Knowledge-unit source", 4_000);
      unit.createdAt = canonicalIso(unit.createdAt, "Knowledge-unit creation date");
      unit.updatedAt = canonicalIso(unit.updatedAt, "Knowledge-unit update date");
      if (unit.latestEvidenceAt !== undefined)
          unit.latestEvidenceAt = canonicalIso(unit.latestEvidenceAt, "Knowledge-unit evidence date");
      else
          delete unit.latestEvidenceAt;
      if (unit.latestEvidenceRating === undefined)
          delete unit.latestEvidenceRating;
      return unit;
  }
  function canonicalStudyEvent(value) {
      assertDocumentSchema(value, "Study event");
      return {
          ...clone(value),
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          id: canonicalId(value.id, "Study-event ID"),
          profileId: canonicalId(value.profileId, "Study-event profile ID"),
          occurredAt: canonicalIso(value.occurredAt, "Study-event occurrence date"),
          area: canonicalName(value.area, "Study-event area", 500),
          task: canonicalName(value.task, "Study-event task", 1_000),
          measure: canonicalText(value.measure, "Study-event measure", 4_000),
          source: canonicalText(value.source, "Study-event source", 4_000),
          linkedUnitIds: [...new Set(value.linkedUnitIds.map((id) => canonicalId(id, "Study-event unit ID")))],
          notes: canonicalText(value.notes, "Study-event notes"),
          createdAt: canonicalIso(value.createdAt, "Study-event creation date"),
      };
  }
  function canonicalRevisionObligation(value) {
      assertDocumentSchema(value, "Revision obligation");
      const obligation = clone(value);
      obligation.schemaVersion = DOCUMENT_SCHEMA_VERSION;
      obligation.id = canonicalId(obligation.id, "Revision-obligation ID");
      obligation.unitId = canonicalId(obligation.unitId, "Revision-obligation unit ID");
      obligation.dueAt = canonicalIso(obligation.dueAt, "Revision-obligation due date");
      obligation.protocol = canonicalText(obligation.protocol, "Revision protocol");
      obligation.successCriteria = canonicalText(obligation.successCriteria, "Revision success criteria");
      obligation.workflow = canonicalWorkflowSpec(obligation.workflow);
      obligation.policyState = canonicalPolicyState(obligation.policyState);
      if (obligation.parentObligationId !== undefined)
          obligation.parentObligationId = canonicalId(obligation.parentObligationId, "Parent obligation ID");
      else
          delete obligation.parentObligationId;
      if (obligation.returnObligationId !== undefined)
          obligation.returnObligationId = canonicalId(obligation.returnObligationId, "Return obligation ID");
      else
          delete obligation.returnObligationId;
      obligation.createdAt = canonicalIso(obligation.createdAt, "Revision-obligation creation date");
      obligation.updatedAt = canonicalIso(obligation.updatedAt, "Revision-obligation update date");
      if (obligation.lastCompletedAt !== undefined)
          obligation.lastCompletedAt = canonicalIso(obligation.lastCompletedAt, "Revision-obligation completion date");
      else
          delete obligation.lastCompletedAt;
      if (obligation.status === "suspended") {
          assert(obligation.suspensionReason === "unit" || obligation.suspensionReason === "relearning" || obligation.suspensionReason === "persistent-difficulty", "Suspended obligation lacks a valid reason.");
      }
      else {
          assert(obligation.suspensionReason === undefined, "Only suspended obligations may retain a suspension reason.");
          delete obligation.suspensionReason;
      }
      if (obligation.suspensionReason === "persistent-difficulty")
          assert(obligation.type === "memory-recall", "Persistent-difficulty hold is only valid for memory recall.");
      if (obligation.chunking)
          obligation.chunking.createdAt = canonicalIso(obligation.chunking.createdAt, "Chunk-cycle creation date");
      else
          delete obligation.chunking;
      return obligation;
  }
  function canonicalEvidenceEvent(value) {
      assertDocumentSchema(value, "Evidence event");
      const event = clone(value);
      event.schemaVersion = DOCUMENT_SCHEMA_VERSION;
      event.id = canonicalId(event.id, "Evidence-event ID");
      event.profileId = canonicalId(event.profileId, "Evidence-event profile ID");
      event.unitId = canonicalId(event.unitId, "Evidence-event unit ID");
      event.obligationId = canonicalId(event.obligationId, "Evidence-event obligation ID");
      event.reviewedAt = canonicalIso(event.reviewedAt, "Evidence-event review date");
      event.beforeDueAt = canonicalIso(event.beforeDueAt, "Evidence-event prior due date");
      event.afterDueAt = canonicalIso(event.afterDueAt, "Evidence-event next due date");
      event.beforePolicyState = canonicalPolicyState(event.beforePolicyState);
      event.afterPolicyState = canonicalPolicyState(event.afterPolicyState);
      event.policyId = canonicalId(event.policyId, "Evidence-event policy ID");
      event.timing = canonicalTimingEvidenceSummary(event.timing);
      event.elapsedMs = event.timing.totalActiveMs;
      event.evidence.errorTypes = [...new Set(event.evidence.errorTypes)];
      event.evidence.correctionNote = canonicalText(event.evidence.correctionNote, "Evidence correction note");
      if (event.followUpObligationId !== undefined)
          event.followUpObligationId = canonicalId(event.followUpObligationId, "Evidence follow-up obligation ID");
      else
          delete event.followUpObligationId;
      if (event.returnedMemoryTransition) {
          const transition = event.returnedMemoryTransition;
          transition.obligationId = canonicalId(transition.obligationId, "Returned memory obligation ID");
          transition.beforeDueAt = canonicalIso(transition.beforeDueAt, "Returned memory prior due date");
          transition.afterDueAt = canonicalIso(transition.afterDueAt, "Returned memory next due date");
          transition.beforePolicyState = canonicalPolicyState(transition.beforePolicyState);
          transition.afterPolicyState = canonicalPolicyState(transition.afterPolicyState);
          transition.policyId = canonicalId(transition.policyId, "Returned memory policy ID");
      }
      else
          delete event.returnedMemoryTransition;
      event.createdAt = canonicalIso(event.createdAt, "Evidence-event creation date");
      return event;
  }
  function canonicalObligationChunk(value) {
      assertDocumentSchema(value, "Obligation chunk");
      const chunk = clone(value);
      chunk.schemaVersion = DOCUMENT_SCHEMA_VERSION;
      chunk.id = canonicalId(chunk.id, "Obligation-chunk ID");
      chunk.obligationId = canonicalId(chunk.obligationId, "Obligation-chunk obligation ID");
      chunk.cycleId = canonicalId(chunk.cycleId, "Obligation-chunk cycle ID");
      chunk.label = canonicalName(chunk.label, "Obligation-chunk label", 500);
      chunk.scope = canonicalText(chunk.scope, "Obligation-chunk scope");
      chunk.createdAt = canonicalIso(chunk.createdAt, "Obligation-chunk creation date");
      chunk.updatedAt = canonicalIso(chunk.updatedAt, "Obligation-chunk update date");
      if (chunk.completedAt !== undefined)
          chunk.completedAt = canonicalIso(chunk.completedAt, "Obligation-chunk completion date");
      else
          delete chunk.completedAt;
      if (chunk.note !== undefined)
          chunk.note = canonicalText(chunk.note, "Obligation-chunk note");
      else
          delete chunk.note;
      if (chunk.actualMinutes === undefined)
          delete chunk.actualMinutes;
      if (chunk.status === "completed")
          assert(chunk.timing !== undefined, "Completed chunk timing is required.");
      if (chunk.timing !== undefined)
          chunk.timing = canonicalTimingEvidenceSummary(chunk.timing);
      else
          delete chunk.timing;
      return chunk;
  }
  function canonicalDailyPlanRecord(value) {
      assertDocumentSchema(value, "Daily plan");
      validateCalendarDate(value.studyDayKey, "Daily plan study day");
      const plan = clone(value);
      plan.schemaVersion = DOCUMENT_SCHEMA_VERSION;
      plan.id = canonicalId(plan.id, "Daily-plan ID");
      plan.createdAt = canonicalIso(plan.createdAt, "Daily-plan creation date");
      plan.updatedAt = canonicalIso(plan.updatedAt, "Daily-plan update date");
      plan.plannerVersion = canonicalId(plan.plannerVersion, "Daily-plan planner version");
      plan.versions = plan.versions.map((version) => ({
          ...version,
          generatedAt: canonicalIso(version.generatedAt, "Daily-plan version date"),
          items: version.items.map((item) => ({
              ...item,
              key: canonicalId(item.key, "Daily-plan item key"),
              obligationId: canonicalId(item.obligationId, "Daily-plan obligation ID"),
              ...(item.chunkId !== undefined ? { chunkId: canonicalId(item.chunkId, "Daily-plan chunk ID") } : {}),
              profileId: canonicalId(item.profileId, "Daily-plan profile ID"),
              unitId: canonicalId(item.unitId, "Daily-plan unit ID"),
              subject: canonicalName(item.subject, "Daily-plan subject", 500),
              title: canonicalName(item.title, "Daily-plan title", 500),
              reasons: item.reasons.map((reason) => canonicalText(reason, "Daily-plan reason", 500)),
          })),
      }));
      plan.outcomes = plan.outcomes.map((outcome) => ({
          ...outcome,
          itemKey: canonicalId(outcome.itemKey, "Daily-plan outcome key"),
          ...(outcome.startedAt !== undefined ? { startedAt: canonicalIso(outcome.startedAt, "Daily-plan start date") } : {}),
          ...(outcome.completedAt !== undefined ? { completedAt: canonicalIso(outcome.completedAt, "Daily-plan completion date") } : {}),
          ...(outcome.evidenceEventId !== undefined ? { evidenceEventId: canonicalId(outcome.evidenceEventId, "Daily-plan evidence ID") } : {}),
          ...(outcome.note !== undefined ? { note: canonicalText(outcome.note, "Daily-plan outcome note") } : {}),
      }));
      return plan;
  }
  function canonicalAppSettings(value) {
      assertDocumentSchema(value, "Application settings");
      const allowed = new Set(["schemaVersion", "key", "activeProfileId", "fsrsScheduling", "memoryDifficultyPolicy", "dailyCapacityMinutes", "studyDayBoundaryHour", "fsrsPersonalization"]);
      assert(Object.keys(value).every((key) => allowed.has(key)), "Application settings contain unexpected fields.");
      assert(value.key === "app", "Application settings key is invalid.");
      assert(typeof value.activeProfileId === "string", "Active profile ID must be a string.");
      const fsrsScheduling = canonicalFsrsSchedulingSettings(value.fsrsScheduling);
      const memoryDifficultyPolicy = canonicalMemoryDifficultyPolicy(value.memoryDifficultyPolicy);
      assert(Number.isInteger(value.dailyCapacityMinutes) && value.dailyCapacityMinutes >= 5 && value.dailyCapacityMinutes <= 600, "Daily capacity is invalid.");
      assert(Number.isInteger(value.studyDayBoundaryHour) && value.studyDayBoundaryHour >= 0 && value.studyDayBoundaryHour <= 12, "Study-day boundary hour is invalid.");
      return {
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          key: "app",
          activeProfileId: value.activeProfileId ? canonicalId(value.activeProfileId, "Active profile ID") : "",
          fsrsScheduling,
          memoryDifficultyPolicy,
          dailyCapacityMinutes: value.dailyCapacityMinutes,
          studyDayBoundaryHour: value.studyDayBoundaryHour,
          fsrsPersonalization: canonicalFsrsPersonalizationSettings(value.fsrsPersonalization),
      };
  }
  function canonicalAppMetadata(value) {
      assertDocumentSchema(value, "Application metadata");
      return {
          ...clone(value),
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          key: "database",
          databaseName: canonicalId(value.databaseName, "Database name"),
          applicationVersion: canonicalId(value.applicationVersion, "Application version"),
          createdAt: canonicalIso(value.createdAt, "Database creation date"),
          updatedAt: canonicalIso(value.updatedAt, "Database update date"),
      };
  }
  function canonicalReviewPhase(value, label = "Review phase") {
      assert(["attempt", "compare", "relearn-repair", "relearn-verify"].includes(value), `${label} is invalid.`);
      return value;
  }
  function canonicalTimingEvidenceSummary(value) {
      assert(value && typeof value === "object", "Timing evidence is required.");
      assert(value.activeByPhase && typeof value.activeByPhase === "object", "Phase timing breakdown is required.");
      const phases = ["attempt", "compare", "relearn-repair", "relearn-verify"];
      const activeByPhase = Object.fromEntries(phases.map((phase) => {
          const raw = Number(value.activeByPhase[phase]);
          assert(Number.isFinite(raw) && raw >= 0 && raw <= 7 * DAY_MS, "Phase active time is invalid.");
          return [phase, Math.round(raw)];
      }));
      const totalActiveMs = Object.values(activeByPhase).reduce((sum, amount) => sum + amount, 0);
      assert(Number.isFinite(value.totalActiveMs) && Math.round(value.totalActiveMs) === totalActiveMs, "Total active time does not match phase timing.");
      const bounded = (raw, label) => {
          assert(Number.isFinite(raw) && raw >= 0 && raw <= 30 * DAY_MS, `${label} is invalid.`);
          return Math.round(raw);
      };
      const count = (raw, label) => {
          assert(Number.isSafeInteger(raw) && raw >= 0 && raw <= 100_000, `${label} is invalid.`);
          return raw;
      };
      const ignoredGapMs = bounded(Number(value.ignoredGapMs), "Ignored gap time");
      assert(Array.isArray(value.reliabilityFlags), "Timing reliability flags are required.");
      const reliabilityFlags = [...new Set(value.reliabilityFlags)];
      for (const flag of reliabilityFlags)
          assert(flag === "ignored-gap" || flag === "backward-clock", "Timing reliability flag is invalid.");
      assert((ignoredGapMs > 0) === reliabilityFlags.includes("ignored-gap"), "Ignored-gap reliability flag is inconsistent.");
      const backwardClockCount = count(Number(value.backwardClockCount), "Backward-clock count");
      assert((backwardClockCount > 0) === reliabilityFlags.includes("backward-clock"), "Backward-clock reliability flag is inconsistent.");
      assert(typeof value.durationReliable === "boolean", "Timing reliability state is required.");
      assert(value.durationReliable === (ignoredGapMs === 0), "Timing reliability state is inconsistent.");
      const durationReliable = value.durationReliable;
      return {
          totalActiveMs,
          activeByPhase,
          pauseMs: bounded(Number(value.pauseMs), "Pause time"),
          pauseCount: count(Number(value.pauseCount), "Pause count"),
          inactiveGapCount: count(Number(value.inactiveGapCount), "Inactive-gap count"),
          classifiedFocusMs: bounded(Number(value.classifiedFocusMs), "Classified focus time"),
          classifiedBreakMs: bounded(Number(value.classifiedBreakMs), "Classified break time"),
          ignoredGapMs,
          promptExcludedMs: bounded(Number(value.promptExcludedMs), "Gap prompt time"),
          backwardClockCount,
          ...(value.sourceRevealAt !== undefined ? { sourceRevealAt: canonicalIso(value.sourceRevealAt, "Source reveal date") } : {}),
          durationReliable,
          reliabilityFlags,
      };
  }
  function canonicalPhaseTimeRuntimeSnapshot(value) {
      assert(value && typeof value === "object", "Phase-time runtime is invalid.");
      const currentPhase = canonicalReviewPhase(value.currentPhase);
      assert(["running", "paused", "gap-pending"].includes(value.state), "Phase-time state is invalid.");
      assert(value.activeByPhase && typeof value.activeByPhase === "object", "Phase-time breakdown is required.");
      const phaseTotal = ["attempt", "compare", "relearn-repair", "relearn-verify"]
          .reduce((sum, phase) => sum + Number(value.activeByPhase[phase]), 0);
      const activeByPhase = canonicalTimingEvidenceSummary({
          totalActiveMs: phaseTotal,
          activeByPhase: value.activeByPhase,
          pauseMs: 0, pauseCount: 0, inactiveGapCount: 0,
          classifiedFocusMs: 0, classifiedBreakMs: 0, ignoredGapMs: 0, promptExcludedMs: 0,
          backwardClockCount: 0, durationReliable: true, reliabilityFlags: [],
      }).activeByPhase;
      const boundedRuntimeMs = (raw, label, maximum = 30 * DAY_MS) => {
          const value = Number(raw);
          assert(Number.isFinite(value) && value >= 0 && value <= maximum, `${label} is invalid.`);
          return Math.round(value);
      };
      assert(Array.isArray(value.pauseHistory), "Pause history is required.");
      const pauseHistory = value.pauseHistory.slice(-TIME_HISTORY_LIMIT).map((pause) => {
          assert(["manual", "inactive-gap-break", "classification-prompt"].includes(pause.reason), "Pause reason is invalid.");
          const startedAt = canonicalIso(pause.startedAt, "Pause start date");
          const endedAt = canonicalIso(pause.endedAt, "Pause end date");
          const durationMs = boundedRuntimeMs(pause.durationMs, "Pause duration");
          assert(Date.parse(endedAt) >= Date.parse(startedAt), "Pause end precedes its start.");
          return { id: canonicalId(pause.id, "Pause ID"), reason: pause.reason, phase: canonicalReviewPhase(pause.phase), startedAt, endedAt, durationMs };
      });
      assert(Array.isArray(value.phaseHistory), "Phase history is required.");
      const phaseHistory = value.phaseHistory.slice(-TIME_HISTORY_LIMIT).map((transition) => {
          assert(["source-reveal", "begin-verification", "verification-reveal", "queue-advance"].includes(transition.reason), "Phase transition reason is invalid.");
          assert(typeof transition.sourceVisible === "boolean", "Phase-transition source visibility is invalid.");
          return { from: canonicalReviewPhase(transition.from), to: canonicalReviewPhase(transition.to), at: canonicalIso(transition.at, "Phase transition date"), sourceVisible: transition.sourceVisible, reason: transition.reason };
      });
      assert(Array.isArray(value.gapHistory), "Inactive-gap history is required.");
      const gapHistory = value.gapHistory.slice(-TIME_HISTORY_LIMIT).map((gap) => {
          assert(["focus", "break", "split", "ignore"].includes(gap.classification), "Inactive-gap classification is invalid.");
          assert(["tick", "visibility", "focus", "pageshow", "recovery", "snapshot"].includes(gap.source), "Inactive-gap source is invalid.");
          const gapMs = boundedRuntimeMs(gap.gapMs, "Inactive-gap duration");
          const focusMs = boundedRuntimeMs(gap.focusMs, "Inactive-gap focus portion", gapMs);
          const breakMs = boundedRuntimeMs(gap.breakMs, "Inactive-gap break portion", gapMs);
          const ignoredMs = boundedRuntimeMs(gap.ignoredMs, "Inactive-gap ignored portion", gapMs);
          assert(focusMs + breakMs + ignoredMs === gapMs, "Inactive-gap parts do not equal the detected gap.");
          const detectedAt = canonicalIso(gap.detectedAt, "Inactive-gap detection date");
          const resolvedAt = canonicalIso(gap.resolvedAt, "Inactive-gap resolution date");
          assert(Date.parse(resolvedAt) >= Date.parse(detectedAt), "Inactive-gap resolution precedes detection.");
          return { id: canonicalId(gap.id, "Inactive-gap ID"), phase: canonicalReviewPhase(gap.phase), source: gap.source, detectedAt, resolvedAt, gapMs, classification: gap.classification, focusMs, breakMs, ignoredMs, promptMs: boundedRuntimeMs(gap.promptMs, "Inactive-gap prompt duration") };
      });
      let pendingGap;
      if (value.pendingGap) {
          assert(["tick", "visibility", "focus", "pageshow", "recovery", "snapshot"].includes(value.pendingGap.source), "Pending-gap source is invalid.");
          const lastReliableAt = canonicalIso(value.pendingGap.lastReliableAt, "Pending-gap reliable date");
          const detectedAt = canonicalIso(value.pendingGap.detectedAt, "Pending-gap detection date");
          const gapMs = boundedRuntimeMs(value.pendingGap.gapMs, "Pending-gap duration");
          assert(gapMs > INACTIVE_GAP_THRESHOLD_MS, "Pending gap does not exceed the inactive-gap threshold.");
          assert(Date.parse(detectedAt) >= Date.parse(lastReliableAt), "Pending-gap detection precedes the last reliable time.");
          pendingGap = { id: canonicalId(value.pendingGap.id, "Pending-gap ID"), phase: canonicalReviewPhase(value.pendingGap.phase), source: value.pendingGap.source, lastReliableAt, detectedAt, gapMs };
      }
      assert((value.state === "gap-pending") === Boolean(pendingGap), "Pending-gap state is inconsistent.");
      const pauseStartedAt = value.pauseStartedAt !== undefined ? canonicalIso(value.pauseStartedAt, "Manual pause start date") : undefined;
      assert((value.state === "paused") === Boolean(pauseStartedAt), "Manual pause state is inconsistent.");
      assert(typeof value.sourceVisible === "boolean", "Source visibility state is required.");
      return {
          currentPhase,
          state: value.state,
          sessionStartedAt: canonicalIso(value.sessionStartedAt, "Phase-time session start date"),
          lastTickAt: canonicalIso(value.lastTickAt, "Phase-time last tick date"),
          activeByPhase,
          ...(pauseStartedAt ? { pauseStartedAt } : {}),
          pauseHistory,
          phaseHistory,
          gapHistory,
          ...(pendingGap ? { pendingGap } : {}),
          sourceVisible: value.sourceVisible,
          ...(value.sourceRevealAt !== undefined ? { sourceRevealAt: canonicalIso(value.sourceRevealAt, "Source reveal date") } : {}),
          backwardClockCount: (() => {
              const count = Number(value.backwardClockCount);
              assert(Number.isSafeInteger(count) && count >= 0 && count <= 100_000, "Backward-clock count is invalid.");
              return count;
          })(),
      };
  }
  function canonicalReviewDraftSnapshot(value) {
      assert(value && typeof value === "object", "Review draft is invalid.");
      canonicalReviewPhase(value.phase);
      assert(value.values && typeof value.values === "object" && !Array.isArray(value.values), "Review field values are required.");
      assert(value.checked && typeof value.checked === "object" && !Array.isArray(value.checked), "Review check state is required.");
      assert(Array.isArray(value.diagramStrokes), "Review diagram strokes are required.");
      const values = {};
      for (const [rawKey, rawValue] of Object.entries(value.values).slice(0, 96)) {
          const key = canonicalId(rawKey, "Review field ID");
          assert(typeof rawValue === "string", "Review field value is invalid.");
          values[key] = rawValue.slice(0, 20_000);
      }
      const checked = {};
      for (const [rawKey, rawValue] of Object.entries(value.checked).slice(0, 128)) {
          const key = canonicalId(rawKey, "Review check ID");
          assert(typeof rawValue === "boolean", "Review check value is invalid.");
          checked[key] = rawValue;
      }
      const diagramStrokes = value.diagramStrokes.slice(0, 256).map((stroke) => {
          assert(Array.isArray(stroke), "Diagram stroke is invalid.");
          return stroke.slice(0, 2_000).map((point) => {
              assert(point && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y), "Diagram point is invalid.");
              return { x: roundTo(clamp(point.x, 0, 1), 6), y: roundTo(clamp(point.y, 0, 1), 6) };
          });
      });
      assert(Number.isFinite(value.attemptElapsedMs) && value.attemptElapsedMs >= 0 && value.attemptElapsedMs <= 7 * DAY_MS, "Attempt duration is invalid.");
      return { phase: value.phase, values, checked, diagramStrokes, attemptElapsedMs: Math.round(value.attemptElapsedMs) };
  }
  function canonicalActiveRetrievalSession(value) {
      assertDocumentSchema(value, "Active retrieval session");
      assert(value.id === ACTIVE_RETRIEVAL_ID, "Active retrieval session ID is invalid.");
      assert(["active", "committing", "completed"].includes(value.status), "Active retrieval status is invalid.");
      assert(Number.isSafeInteger(value.revision) && value.revision >= 1, "Active retrieval revision is invalid.");
      assert(Array.isArray(value.queueTargetIds), "Active retrieval queue is required.");
      const queueTargetIds = [...new Set(value.queueTargetIds.slice(0, 500).map((id) => canonicalId(id, "Review target ID")))];
      assert(Number.isInteger(value.activeIndex) && value.activeIndex >= 0 && value.activeIndex <= queueTargetIds.length, "Active retrieval index is invalid.");
      assert(typeof value.activeTargetId === "string", "Active retrieval target ID must be a string.");
      const activeTargetId = value.status === "completed" ? value.activeTargetId : canonicalId(value.activeTargetId, "Active review target ID");
      if (value.status === "completed") {
          assert(value.activeIndex === queueTargetIds.length && activeTargetId === "", "Completed retrieval state is inconsistent.");
      }
      else {
          assert(queueTargetIds.length > 0 && value.activeIndex < queueTargetIds.length, "Active retrieval queue is invalid.");
          assert(queueTargetIds[value.activeIndex] === activeTargetId, "Active retrieval target does not match its queue.");
      }
      const commitToken = value.commitToken === undefined ? undefined : canonicalId(value.commitToken, "Active retrieval commit token");
      if (value.status === "committing")
          assert(commitToken, "A committing retrieval requires a commit token.");
      const phase = canonicalReviewPhase(value.phase);
      const timeRuntime = canonicalPhaseTimeRuntimeSnapshot(value.timeRuntime);
      assert(timeRuntime.currentPhase === phase, "Active retrieval phase and timer phase differ.");
      const elapsedMs = Object.values(timeRuntime.activeByPhase).reduce((sum, amount) => sum + amount, 0);
      assert(Number.isFinite(value.elapsedMs) && Math.round(value.elapsedMs) === elapsedMs, "Active retrieval elapsed time does not match phase timing.");
      return {
          schemaVersion: DOCUMENT_SCHEMA_VERSION,
          id: ACTIVE_RETRIEVAL_ID,
          revision: value.revision,
          status: value.status,
          queueTargetIds,
          activeIndex: value.activeIndex,
          activeTargetId,
          phase,
          draft: canonicalReviewDraftSnapshot(value.draft),
          timeRuntime,
          elapsedMs,
          startedAt: canonicalIso(value.startedAt, "Active retrieval start date"),
          updatedAt: canonicalIso(value.updatedAt, "Active retrieval update date"),
          ...(commitToken ? { commitToken } : {}),
      };
  }
  function checkedDocumentInput(input, label) {
      return requireRecord(input, label);
  }
  function canonicalDocument(kind, input) {
      if (kind === "profile")
          return canonicalExamProfile(checkedDocumentInput(input, "Exam profile"));
      if (kind === "node")
          return canonicalKnowledgeNode(checkedDocumentInput(input, "Knowledge node"));
      if (kind === "unit")
          return canonicalKnowledgeUnit(checkedDocumentInput(input, "Knowledge unit"));
      if (kind === "study-event")
          return canonicalStudyEvent(checkedDocumentInput(input, "Study event"));
      if (kind === "obligation")
          return canonicalRevisionObligation(checkedDocumentInput(input, "Revision obligation"));
      if (kind === "evidence-event")
          return canonicalEvidenceEvent(checkedDocumentInput(input, "Evidence event"));
      if (kind === "chunk")
          return canonicalObligationChunk(checkedDocumentInput(input, "Obligation chunk"));
      if (kind === "daily-plan")
          return canonicalDailyPlanRecord(checkedDocumentInput(input, "Daily plan"));
      if (kind === "settings")
          return canonicalAppSettings(checkedDocumentInput(input, "Application settings"));
      if (kind === "active-retrieval")
          return canonicalActiveRetrievalSession(checkedDocumentInput(input, "Active retrieval session"));
      return canonicalAppMetadata(checkedDocumentInput(input, "Application metadata"));
  }
  function canonicalDocumentArray(kind, input, label) {
      return requiredArray(input, label).map((value) => canonicalDocument(kind, value));
  }
  function canonicalActiveRetrievalEnvelope(input) {
      const value = requireRecord(input, "Active retrieval recovery envelope");
      assert(value["format"] === ACTIVE_RETRIEVAL_RECOVERY_FORMAT && value["schemaVersion"] === 1, "Active retrieval recovery envelope is invalid.");
      return {
          format: ACTIVE_RETRIEVAL_RECOVERY_FORMAT,
          schemaVersion: 1,
          savedAt: canonicalIso(requiredString(value["savedAt"], "Recovery save date"), "Recovery save date"),
          session: canonicalDocument("active-retrieval", value["session"]),
      };
  }

  /* ==========================================================================
     FSRS-7 PERSONALIZATION CONTRACT — EXTERNAL OPTIMIZER BOUNDARY
     ========================================================================== */
  const FSRS_OPTIMIZER_PROFILE_SCHEMA = "revision-director-fsrs-profile/v1";
  const FSRS_OPTIMIZER_BINDING_VERSION = "0.6.1";
  const FSRS_OPTIMIZER_HOLDOUT_STRATEGY = "final-sixth";
  const FSRS_OPTIMIZER_MIN_TRAIN_ITEMS = 64;
  const FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS = 64;
  const FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS = 16;
  const FSRS_OPTIMIZER_MIN_ABSOLUTE_LOG_LOSS_IMPROVEMENT = 0.001;
  const FSRS_OPTIMIZER_MIN_RELATIVE_LOG_LOSS_IMPROVEMENT = 0.005;
  const FSRS_OPTIMIZER_CALIBRATION_EPSILON = 1e-9;
  const FSRS_OPTIMIZER_CHRONOLOGY = "elapsed-24h";
  const FSRS_OPTIMIZER_FIXED_UTC_OFFSET_MINUTES = 0;
  const FSRS_OPTIMIZER_ROLLOVER_HOUR = 0;
  // Pinned ts-fsrs@6.0.0 FSRS-7 defaults and parameter bounds. Keep these
  // synchronized with vendor/ts-fsrs-6.0.0; profile activation also passes the
  // weights through DefaultScheduler, providing a second vendor-level check.
  const FSRS7_DEFAULT_WEIGHTS = Object.freeze([
      0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0,
      1.3826, 0.7024, 0.5999, 0.8146, 0.6398, 1, 1.3207, 0.6707, 3.8668,
      0.4416, 0.0934, 1.8631, 0.6162, 1.0869, 0.1567, 0.0801, 0.2421,
      0.9464, 0.1433, 0.7145, 0, 0.5667, 0.3734, 0.5333, 0.3048,
  ]);
  const FSRS7_PARAMETER_BOUNDS = Object.freeze([
      [0.0001, 50], [0.0001, 100], [0.0001, 100], [0.0001, 100], [1, 10],
      [0.001, 4], [0.1, 4], [0, 4], [0, 1.2], [0.3, 3], [0.01, 1.5],
      [0.1, 1], [0, 3.5], [0, 1], [1, 7], [0, 4], [0, 2], [0.5, 6],
      [0.001, 1.5], [0.001, 1], [0, 5], [0, 1], [1, 7], [0.01, 0.25],
      [0.01, 0.95], [0.2, 0.85], [0.5, 0.99], [0.01, 1], [0.1, 1],
      [0, 0.9], [0.1, 1.1], [0, 1], [0, 0.6], [0, 0.6],
  ]);
  function fingerprintText64(value) {
      let hash = 0xcbf29ce484222325n;
      for (let index = 0; index < value.length; index += 1) {
          hash ^= BigInt(value.charCodeAt(index));
          hash = BigInt.asUintN(64, hash * 0x100000001b3n);
      }
      return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
  }
  function validateFsrs7Weights(value) {
      assert(Array.isArray(value) && value.length === 34, "FSRS-7 optimizer profile must contain exactly 34 weights.");
      const weights = value.map((item) => {
          assert(typeof item === "number" && Number.isFinite(item), "FSRS-7 optimizer weights must be finite numbers.");
          return item;
      });
      for (let index = 0; index < weights.length; index += 1) {
          const [minimum, maximum] = FSRS7_PARAMETER_BOUNDS[index];
          const monotonicMinimum = index > 0 && index < 4
              ? Math.max(minimum, weights[index - 1])
              : index === 26
                  ? Math.max(minimum, weights[25])
                  : minimum;
          assert(weights[index] >= monotonicMinimum && weights[index] <= maximum, `FSRS-7 optimizer weight ${index} is outside the ts-fsrs 6.0.0 model bounds.`);
      }
      return weights;
  }
  function fsrsWeightsFingerprint(weights) {
      return fingerprintText64(validateFsrs7Weights([...weights]).map((value) => Number(value).toString()).join(","));
  }
  const FSRS7_DEFAULT_WEIGHTS_FINGERPRINT = fsrsWeightsFingerprint(FSRS7_DEFAULT_WEIGHTS);
  function optimizerMetrics(value, label) {
      const record = requireRecord(value, `FSRS optimizer ${label} metrics`);
      const logLoss = Number(record["logLoss"]);
      const rmseBins = Number(record["rmseBins"]);
      assert(Number.isFinite(logLoss) && logLoss >= 0 && Number.isFinite(rmseBins) && rmseBins >= 0, `FSRS optimizer ${label} metrics are invalid.`);
      return { logLoss, rmseBins };
  }
  function fsrsHoldoutDiagnostics(stock, personalized) {
      const absolute = stock.logLoss - personalized.logLoss;
      const relative = stock.logLoss > 0 ? absolute / stock.logLoss : 0;
      const required = Math.max(FSRS_OPTIMIZER_MIN_ABSOLUTE_LOG_LOSS_IMPROVEMENT, stock.logLoss * FSRS_OPTIMIZER_MIN_RELATIVE_LOG_LOSS_IMPROVEMENT);
      const delta = personalized.rmseBins - stock.rmseBins;
      const relativeDelta = stock.rmseBins > 0 ? delta / stock.rmseBins : delta === 0 ? 0 : Number.POSITIVE_INFINITY;
      const status = delta < -FSRS_OPTIMIZER_CALIBRATION_EPSILON ? "improved"
          : Math.abs(delta) <= FSRS_OPTIMIZER_CALIBRATION_EPSILON ? "unchanged"
              : "regressed";
      return {
          logLossImprovement: { absolute, relative, required },
          calibration: { metric: "rmse-bins", delta, relativeDelta, status },
      };
  }
  function validateFsrsOptimizerProfile(value) {
      const profile = requireRecord(value, "FSRS optimizer profile");
      const allowed = new Set(["schema", "model", "bindingVersion", "trainedAt", "sourceSha256", "evidenceItems", "weights", "evaluation", "training"]);
      assert(Object.keys(profile).every((key) => allowed.has(key)), "FSRS optimizer profile contains unexpected fields.");
      assert(profile["schema"] === FSRS_OPTIMIZER_PROFILE_SCHEMA && profile["model"] === FSRS_MODEL, "FSRS optimizer profile schema/model is invalid.");
      assert(profile["bindingVersion"] === FSRS_OPTIMIZER_BINDING_VERSION, "FSRS optimizer binding version is unsupported.");
      const trainedAt = canonicalIso(requiredString(profile["trainedAt"], "FSRS optimizer training date"), "FSRS optimizer training date");
      const sourceSha256 = requiredString(profile["sourceSha256"], "FSRS optimizer source checksum");
      assert(/^[a-f0-9]{64}$/.test(sourceSha256), "FSRS optimizer source checksum is invalid.");
      const evidenceItems = Number(profile["evidenceItems"]);
      assert(Number.isSafeInteger(evidenceItems) && evidenceItems > 0, "FSRS optimizer evidence item count is invalid.");
      const weights = validateFsrs7Weights(profile["weights"]);
      const evaluation = requireRecord(profile["evaluation"], "FSRS optimizer evaluation");
      const crossValidation = optimizerMetrics(evaluation["crossValidation"], "cross-validation");
      const holdout = requireRecord(evaluation["holdout"], "FSRS optimizer holdout");
      assert(holdout["strategy"] === FSRS_OPTIMIZER_HOLDOUT_STRATEGY && holdout["gate"] === "passed", "FSRS optimizer holdout strategy/gate is invalid.");
      const trainItems = Number(holdout["trainItems"]);
      const holdoutItems = Number(holdout["holdoutItems"]);
      const holdoutCards = Number(holdout["holdoutCards"]);
      assert(Number.isSafeInteger(trainItems) && trainItems >= FSRS_OPTIMIZER_MIN_TRAIN_ITEMS, "FSRS optimizer training prefix is too small.");
      assert(Number.isSafeInteger(holdoutItems) && holdoutItems >= FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS, "FSRS optimizer holdout is too small.");
      assert(Number.isSafeInteger(holdoutCards) && holdoutCards >= FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS && holdoutCards <= holdoutItems, "FSRS optimizer holdout-card count is invalid.");
      assert(trainItems + holdoutItems === evidenceItems, "FSRS optimizer holdout counts do not match evidence items.");
      assert(holdout["minimumTrainItems"] === FSRS_OPTIMIZER_MIN_TRAIN_ITEMS
          && holdout["minimumHoldoutItems"] === FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS
          && holdout["minimumHoldoutCards"] === FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS, "FSRS optimizer activation thresholds are invalid.");
      const stock = optimizerMetrics(holdout["stock"], "stock holdout");
      const personalized = optimizerMetrics(holdout["personalized"], "personalized holdout");
      const diagnostics = fsrsHoldoutDiagnostics(stock, personalized);
      assert(diagnostics.logLossImprovement.absolute + Number.EPSILON >= diagnostics.logLossImprovement.required, "Personalized FSRS-7 profile did not achieve the minimum practical held-out log-loss improvement over stock FSRS-7.");
      assert(diagnostics.calibration.status !== "regressed", "Personalized FSRS-7 profile regressed held-out RMSE-bins calibration versus stock FSRS-7.");
      const training = requireRecord(profile["training"], "FSRS optimizer training metadata");
      assert(training["enableShortTerm"] === true && training["enableSchedPenalties"] === true && training["numRelearningSteps"] === 1, "FSRS optimizer training flags are invalid.");
      assert(training["chronology"] === FSRS_OPTIMIZER_CHRONOLOGY
          && training["converterFixedUtcOffsetMinutes"] === FSRS_OPTIMIZER_FIXED_UTC_OFFSET_MINUTES
          && training["converterRolloverHour"] === FSRS_OPTIMIZER_ROLLOVER_HOUR, "FSRS optimizer chronology metadata is invalid.");
      assert(Array.isArray(training["runtimeLearningSteps"]) && training["runtimeLearningSteps"].length === 1 && training["runtimeLearningSteps"][0] === "1d"
          && Array.isArray(training["runtimeRelearningSteps"]) && training["runtimeRelearningSteps"].length === 1 && training["runtimeRelearningSteps"][0] === "1d", "FSRS optimizer runtime step metadata is invalid.");
      assert(training["validationCandidateTrainedItems"] === trainItems && training["finalRetrainedOnAllEvidence"] === true, "FSRS optimizer final-training metadata is invalid.");
      return {
          schema: FSRS_OPTIMIZER_PROFILE_SCHEMA,
          model: FSRS_MODEL,
          bindingVersion: FSRS_OPTIMIZER_BINDING_VERSION,
          trainedAt,
          sourceSha256,
          evidenceItems,
          weights,
          evaluation: {
              crossValidation,
              holdout: {
                  strategy: FSRS_OPTIMIZER_HOLDOUT_STRATEGY,
                  trainItems,
                  holdoutItems,
                  holdoutCards,
                  minimumTrainItems: FSRS_OPTIMIZER_MIN_TRAIN_ITEMS,
                  minimumHoldoutItems: FSRS_OPTIMIZER_MIN_HOLDOUT_ITEMS,
                  minimumHoldoutCards: FSRS_OPTIMIZER_MIN_HOLDOUT_CARDS,
                  stock,
                  personalized,
                  gate: "passed",
              },
          },
          training: {
              enableShortTerm: true,
              enableSchedPenalties: true,
              numRelearningSteps: 1,
              chronology: FSRS_OPTIMIZER_CHRONOLOGY,
              converterFixedUtcOffsetMinutes: FSRS_OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,
              converterRolloverHour: FSRS_OPTIMIZER_ROLLOVER_HOUR,
              runtimeLearningSteps: ["1d"],
              runtimeRelearningSteps: ["1d"],
              validationCandidateTrainedItems: trainItems,
              finalRetrainedOnAllEvidence: true,
          },
      };
  }
  function canonicalFsrsCostAdrPolicy(value) {
      const record = requireRecord(value, "FSRS Cost-ADR policy");
      const allowed = new Set(["coefficients", "costWeightMin", "costWeightMax", "retentionMin", "retentionMax", "bounds"]);
      assert(Object.keys(record).every((key) => allowed.has(key)), "FSRS Cost-ADR policy contains unexpected fields.");
      const coefficientsRaw = record["coefficients"];
      assert(Array.isArray(coefficientsRaw) && coefficientsRaw.length === 15, "FSRS Cost-ADR policy must contain exactly 15 coefficients.");
      const coefficients = coefficientsRaw.map((value) => {
          const coefficient = Number(value);
          assert(Number.isFinite(coefficient) && coefficient >= -64 && coefficient <= 64, "FSRS Cost-ADR coefficient is invalid.");
          return coefficient;
      });
      const costWeightMin = Number(record["costWeightMin"]);
      const costWeightMax = Number(record["costWeightMax"]);
      const retentionMin = Number(record["retentionMin"]);
      const retentionMax = Number(record["retentionMax"]);
      assert(Number.isFinite(costWeightMin) && Number.isFinite(costWeightMax) && costWeightMin >= 0 && costWeightMax > costWeightMin
          && Math.log1p(costWeightMax) > Math.log1p(costWeightMin), "FSRS Cost-ADR cost-weight bounds are invalid.");
      assert(Number.isFinite(retentionMin) && Number.isFinite(retentionMax) && retentionMin > 0 && retentionMax > retentionMin && retentionMax < 1, "FSRS Cost-ADR retention bounds are invalid.");
      const boundsRecord = requireRecord(record["bounds"], "FSRS Cost-ADR state bounds");
      const boundsAllowed = new Set(["sMin", "sMax", "dMin", "dMax"]);
      assert(Object.keys(boundsRecord).every((key) => boundsAllowed.has(key)), "FSRS Cost-ADR state bounds contain unexpected fields.");
      const bounds = {
          sMin: Number(boundsRecord["sMin"]),
          sMax: Number(boundsRecord["sMax"]),
          dMin: Number(boundsRecord["dMin"]),
          dMax: Number(boundsRecord["dMax"]),
      };
      assert(Number.isFinite(bounds.sMin) && Number.isFinite(bounds.sMax) && bounds.sMin > 0 && bounds.sMax > bounds.sMin
          && Math.log(bounds.sMax) > Math.log(bounds.sMin), "FSRS Cost-ADR stability bounds are invalid.");
      assert(Number.isFinite(bounds.dMin) && Number.isFinite(bounds.dMax) && bounds.dMax > bounds.dMin
          && Number.isFinite(bounds.dMax - bounds.dMin), "FSRS Cost-ADR difficulty bounds are invalid.");
      return { coefficients, costWeightMin, costWeightMax, retentionMin, retentionMax, bounds };
  }
  function canonicalFsrsSchedulingPolicy(value) {
      const record = requireRecord(value, "FSRS scheduling policy");
      const kind = record["kind"];
      if (kind === "fixed-retention") {
          const allowed = new Set(["kind", "desiredRetention"]);
          assert(Object.keys(record).every((key) => allowed.has(key)), "Fixed-retention scheduling policy contains unexpected fields.");
          const desiredRetention = Number(record["desiredRetention"]);
          assert(Number.isFinite(desiredRetention) && desiredRetention >= 0.75 && desiredRetention <= 0.97, "Desired retention must be between 75% and 97%.");
          return { kind, desiredRetention };
      }
      if (kind === "cost-adr") {
          const allowed = new Set(["kind", "goalCostWeight", "costAdrPolicy"]);
          assert(Object.keys(record).every((key) => allowed.has(key)), "Cost-ADR scheduling policy contains unexpected fields.");
          const goalCostWeight = Number(record["goalCostWeight"]);
          assert(Number.isFinite(goalCostWeight) && goalCostWeight >= 0 && goalCostWeight <= 1024, "FSRS Cost-ADR goal cost weight is invalid.");
          return { kind, goalCostWeight, costAdrPolicy: canonicalFsrsCostAdrPolicy(record["costAdrPolicy"]) };
      }
      assert(false, "FSRS scheduling policy kind is invalid.");
  }
  function fsrsSchedulingPolicyIdentity(value) {
      const policy = canonicalFsrsSchedulingPolicy(value);
      if (policy.kind === "fixed-retention") {
          return ["fixed-retention", policy.desiredRetention.toFixed(6)].join("|");
      }
      const cost = policy.costAdrPolicy;
      return [
          "cost-adr",
          policy.goalCostWeight.toString(),
          ...cost.coefficients.map((coefficient) => coefficient.toString()),
          cost.costWeightMin.toString(),
          cost.costWeightMax.toString(),
          cost.retentionMin.toString(),
          cost.retentionMax.toString(),
          cost.bounds.sMin.toString(),
          cost.bounds.sMax.toString(),
          cost.bounds.dMin.toString(),
          cost.bounds.dMax.toString(),
      ].join("|");
  }
  function fsrsSchedulingPoliciesEqual(left, right) {
      return fsrsSchedulingPolicyIdentity(left) === fsrsSchedulingPolicyIdentity(right);
  }
  function fixedRetentionForPolicy(value) {
      const policy = canonicalFsrsSchedulingPolicy(value);
      assert(policy.kind === "fixed-retention", "Cost-ADR scheduling is defined but not enabled in this build.");
      return policy.desiredRetention;
  }
  function defaultFsrsSchedulingSettings() {
      return { policy: { kind: "fixed-retention", desiredRetention: 0.9 } };
  }
  function canonicalFsrsSchedulingSettings(value) {
      const record = requireRecord(value, "FSRS scheduling settings");
      const allowed = new Set(["policy", "lastRebase"]);
      assert(Object.keys(record).every((key) => allowed.has(key)), "FSRS scheduling settings contain unexpected fields.");
      const policy = canonicalFsrsSchedulingPolicy(record["policy"]);
      let lastRebase;
      if (record["lastRebase"] !== undefined) {
          const rebase = requireRecord(record["lastRebase"], "FSRS scheduler rebase");
          const rebaseAllowed = new Set(["at", "reason", "fromConfigFingerprint", "toConfigFingerprint", "rescheduledObligations"]);
          assert(Object.keys(rebase).every((key) => rebaseAllowed.has(key)), "FSRS scheduler rebase contains unexpected fields.");
          const reason = rebase["reason"];
          assert(reason === "scheduler-policy-change" || reason === "activate-profile" || reason === "deactivate-profile", "FSRS scheduler rebase reason is invalid.");
          const fromConfigFingerprint = requiredString(rebase["fromConfigFingerprint"], "FSRS prior configuration fingerprint");
          const toConfigFingerprint = requiredString(rebase["toConfigFingerprint"], "FSRS target configuration fingerprint");
          assert(/^fnv1a64:[0-9a-f]{16}$/.test(fromConfigFingerprint) && /^fnv1a64:[0-9a-f]{16}$/.test(toConfigFingerprint), "FSRS scheduler rebase fingerprint is invalid.");
          assert(fromConfigFingerprint !== toConfigFingerprint, "FSRS scheduler rebase must change scheduler identity.");
          const rescheduledObligations = Number(rebase["rescheduledObligations"]);
          assert(Number.isSafeInteger(rescheduledObligations) && rescheduledObligations >= 0, "FSRS scheduler rebase count is invalid.");
          lastRebase = {
              at: canonicalIso(requiredString(rebase["at"], "FSRS scheduler rebase date"), "FSRS scheduler rebase date"),
              reason,
              fromConfigFingerprint,
              toConfigFingerprint,
              rescheduledObligations,
          };
      }
      return { policy, ...(lastRebase ? { lastRebase } : {}) };
  }
  function defaultFsrsPersonalizationSettings() {
      return { profile: null, active: false };
  }
  function canonicalFsrsPersonalizationSettings(value) {
      const record = requireRecord(value, "FSRS personalization settings");
      const allowed = new Set(["profile", "active"]);
      assert(Object.keys(record).every((key) => allowed.has(key)), "FSRS personalization settings contain unexpected fields.");
      const profile = record["profile"] === null ? null : validateFsrsOptimizerProfile(record["profile"]);
      const active = record["active"];
      assert(typeof active === "boolean", "FSRS personalization active flag is invalid.");
      assert(!active || profile !== null, "Active FSRS personalization requires an optimizer profile.");
      return { profile, active };
  }
  function effectiveFsrsPersonalization(settings) {
      return canonicalFsrsPersonalizationSettings(settings.fsrsPersonalization);
  }
  function activeFsrsOptimizerProfile(settings) {
      const personalization = effectiveFsrsPersonalization(settings);
      return personalization.active ? personalization.profile : null;
  }
  function fsrsOptimizerReviewDuration(event, source) {
      const timing = canonicalTimingEvidenceSummary(event.timing);
      const durationPhase = source === "direct-memory" ? "attempt" : "relearn-verify";
      const phaseMs = timing.activeByPhase[durationPhase];
      const durationReliable = timing.durationReliable && timing.reliabilityFlags.length === 0;
      return {
          durationMs: durationReliable ? Math.round(phaseMs) : 0,
          durationReliable,
          durationPhase,
      };
  }
  function fsrsOptimizerEvidenceRows(events) {
      const rows = [];
      for (const event of events) {
          if (event.obligationType === "memory-recall") {
              const before = event.beforePolicyState.fsrsCard;
              assert(before, "Memory optimizer evidence is missing its before-card projection.");
              rows.push({
                  reviewTimeMs: new Date(event.reviewedAt).getTime(),
                  cardId: event.obligationId,
                  rating: validateRating(event.confirmedRating),
                  ...fsrsOptimizerReviewDuration(event, "direct-memory"),
                  state: before.state,
                  evidenceEventId: event.id,
                  source: "direct-memory",
              });
          }
          const returned = event.returnedMemoryTransition;
          if (returned) {
              const before = returned.beforePolicyState.fsrsCard;
              assert(before, "Returned-memory optimizer evidence is missing its before-card projection.");
              rows.push({
                  reviewTimeMs: new Date(event.reviewedAt).getTime(),
                  cardId: returned.obligationId,
                  rating: Rating.Good,
                  ...fsrsOptimizerReviewDuration(event, "relearning-return"),
                  state: before.state,
                  evidenceEventId: event.id,
                  source: "relearning-return",
              });
          }
      }
      rows.sort((left, right) => left.reviewTimeMs - right.reviewTimeMs
          || left.cardId.localeCompare(right.cardId)
          || left.evidenceEventId.localeCompare(right.evidenceEventId)
          || left.source.localeCompare(right.source));
      let previous = Number.NEGATIVE_INFINITY;
      for (const row of rows) {
          assert(Number.isFinite(row.reviewTimeMs) && row.reviewTimeMs >= previous, "FSRS optimizer evidence is not chronological.");
          assert(Number.isInteger(row.durationMs) && row.durationMs >= 0, "FSRS optimizer evidence contains an invalid retrieval duration.");
          assert(Number.isInteger(row.state) && row.state >= 0 && row.state <= 3, "FSRS optimizer evidence contains an invalid review state.");
          previous = row.reviewTimeMs;
      }
      return rows;
  }
  function optimizerCsvCell(value) {
      return `"${value.replaceAll('"', '""')}"`;
  }
  function fsrsOptimizerEvidenceDataset(events) {
      const rows = fsrsOptimizerEvidenceRows(events);
      const lines = ["review_time,card_id,review_rating,review_duration,review_state"];
      for (const row of rows) {
          lines.push([row.reviewTimeMs, optimizerCsvCell(row.cardId), row.rating, row.durationMs, row.state].join(","));
      }
      const summary = {
          cards: new Set(rows.map((row) => row.cardId)).size,
          reviews: rows.length,
          reliableDurations: rows.filter((row) => row.durationReliable).length,
          unavailableDurations: rows.filter((row) => !row.durationReliable).length,
      };
      return { rows, csv: lines.join("\n") + "\n", summary };
  }
  function fsrsOptimizerCsv(events) {
      return fsrsOptimizerEvidenceDataset(events).csv;
  }
  function fsrsOptimizerEvidenceSummary(events) {
      return fsrsOptimizerEvidenceDataset(events).summary;
  }
  async function fsrsOptimizerEvidenceSnapshot(events) {
      const dataset = fsrsOptimizerEvidenceDataset(events);
      return {
          ...dataset,
          sourceSha256: await sha256Hex(utf8Bytes(dataset.csv)),
      };
  }

  /* ==========================================================================
     FSRS-7 BROWSER OPTIMIZER — OPTIONAL LOCAL WORKER/WASM BOUNDARY
     ========================================================================== */
  class FsrsOptimizerRejectedError extends Error {
      reasons;
      constructor(reasons) {
          super(reasons.join("; "));
          this.name = "FsrsOptimizerRejectedError";
          this.reasons = [...reasons];
      }
  }
  const FSRS_BROWSER_OPTIMIZER_CAPABILITY = "wasm32-wasip1-0.6.1";
  function browserFsrsOptimizerAvailability() {
      if (typeof document === "undefined" || typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
          return { available: false, reason: "Browser Worker/WebAssembly support is unavailable." };
      }
      if (location.protocol === "file:") {
          return { available: false, reason: "Use the optional optimizer-enabled static distribution over localhost or HTTPS for in-app optimization." };
      }
      const marker = document.querySelector('meta[name="revision-director-browser-optimizer"]')?.content;
      if (marker !== FSRS_BROWSER_OPTIMIZER_CAPABILITY) {
          return { available: false, reason: "This build does not include the local FSRS optimizer Worker/WASM assets." };
      }
      if (!globalThis.crypto?.subtle) {
          return { available: false, reason: "Web Crypto is unavailable; serve the optimizer build from a secure context or localhost." };
      }
      return { available: true, reason: "FSRS-7 WebAssembly optimizer available locally in a dedicated Worker." };
  }
  function startBrowserFsrsOptimizer(csv, options = {}) {
      const availability = browserFsrsOptimizerAvailability();
      assert(availability.available, availability.reason);
      assert(csv.trim().length > 0, "Optimizer evidence is empty.");
      const requestId = typeof globalThis.crypto.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `fsrs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const worker = new Worker(new URL("./fsrs-optimizer.worker.js", document.baseURI), {
          type: "module",
          name: "revision-director-fsrs-optimizer",
      });
      const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
      let settled = false;
      let rejectPromise = () => undefined;
      let timer;
      const cleanup = () => {
          worker.terminate();
          if (timer !== undefined)
              window.clearTimeout(timer);
      };
      const rejectOnce = (error) => {
          if (settled)
              return;
          settled = true;
          cleanup();
          rejectPromise(error);
      };
      if (timeoutMs > 0) {
          timer = window.setTimeout(() => rejectOnce(new Error("FSRS optimization timed out.")), timeoutMs);
      }
      const promise = new Promise((resolve, reject) => {
          rejectPromise = reject;
          worker.addEventListener("message", (event) => {
              if (!isRecord(event.data))
                  return;
              const message = event.data;
              if (message["requestId"] !== requestId || typeof message["type"] !== "string")
                  return;
              if (message["type"] === "progress") {
                  const stage = message["stage"];
                  const current = message["current"];
                  const total = message["total"];
                  if (typeof stage === "string" && typeof current === "number" && Number.isFinite(current) && current >= 0
                      && typeof total === "number" && Number.isFinite(total) && total >= 0) {
                      options.onProgress?.({ stage, current, total });
                  }
                  return;
              }
              if (message["type"] === "rejected") {
                  const reasons = Array.isArray(message["reasons"])
                      ? message["reasons"].filter((reason) => typeof reason === "string")
                      : [];
                  rejectOnce(new FsrsOptimizerRejectedError(reasons.length > 0 ? reasons : ["Personalized FSRS-7 did not clear the chronological activation gate."]));
                  return;
              }
              if (message["type"] === "error") {
                  rejectOnce(new Error(typeof message["message"] === "string"
                      ? message["message"]
                      : "FSRS optimizer Worker failed."));
                  return;
              }
              if (message["type"] === "result") {
                  try {
                      const profile = validateFsrsOptimizerProfile(message["profile"]);
                      if (settled)
                          return;
                      settled = true;
                      cleanup();
                      resolve(profile);
                  }
                  catch (error) {
                      rejectOnce(error);
                  }
              }
          });
          worker.addEventListener("error", (event) => {
              rejectOnce(new Error(event.message || "FSRS optimizer Worker crashed."));
          });
          worker.postMessage({ type: "optimize", requestId, csv });
      });
      return {
          promise,
          cancel() {
              rejectOnce(new DOMException("FSRS optimization cancelled.", "AbortError"));
          },
      };
  }

  /* ==========================================================================
     REVISION SCHEDULER PORT — TS-FSRS 6.0.0 / FSRS-7
     ========================================================================== */
  /*
   * Application-local mirror of the public ts-fsrs@6.0.0
   * `ts-fsrs/reschedule` contract. It is intentionally implemented only in
   * terms of the vendored scheduler's public scheduler.forward surface, keeping the upstream UMD bytes checksum-identical and avoiding a
   * second copy of the FSRS runtime.
   *
   * Upstream source basis:
   * open-spaced-repetition/ts-fsrs v6.0.0
   * packages/fsrs/src/reschedule/reschedule.ts
   */
  class Reschedule {
      scheduler;
      constructor(scheduler) {
          this.scheduler = scheduler;
      }
      prepareReviews(history, sortHistory) {
          assert(history.length > 0, "Reschedule requires at least one review.");
          const reviews = history.map((review) => {
              validateRating(review.rating);
              assert(review.reviewTime instanceof Date && Number.isFinite(review.reviewTime.getTime()), "FSRS review time is invalid.");
              return { rating: review.rating, reviewTime: new Date(review.reviewTime) };
          });
          if (sortHistory) {
              const compare = this.scheduler.chrono.compare;
              reviews.sort((left, right) => compare
                  ? compare(left.reviewTime, right.reviewTime)
                  : left.reviewTime.getTime() - right.reviewTime.getTime());
          }
          for (let index = 1; index < reviews.length; index += 1) {
              const previous = reviews[index - 1];
              const current = reviews[index];
              const deltaT = this.scheduler.chrono.difference(previous.reviewTime, current.reviewTime);
              assert(Number.isFinite(deltaT) && deltaT >= 0, "FSRS review history must be chronological.");
          }
          return reviews;
      }
      reschedule(input, options = {}) {
          const history = this.prepareReviews(input.history, options.sortHistory ?? true);
          const results = input.initialCard
              ? this.scheduler.forward({ history, initialCard: input.initialCard })
              : this.scheduler.forward({ history });
          const card = results.at(-1)?.card;
          assert(card, "FSRS reschedule did not produce a card.");
          return { results, card };
      }
  }
  function fsrsConfigurationFingerprint(config) {
      const canonical = [
          config.model,
          FSRS_PACKAGE_VERSION,
          fsrsSchedulingPolicyIdentity(config.schedulingPolicy),
          config.fractionalDays ? "fractional" : "whole",
          config.enableFuzz ? "fuzz" : "no-fuzz",
          config.enableShortTerm ? "short-term" : "long-term",
          config.learningSteps.join(","),
          config.relearningSteps.join(","),
          String(config.graduatingInterval),
          config.allowModelOverride ? "model-override" : "no-model-override",
          String(config.maximumInterval),
          config.clearStatsOnForget ? "clear-stats" : "keep-stats",
          config.weightsSource,
          config.weightsFingerprint,
          config.optimizerProfileSourceSha256 ?? "",
      ].join("|");
      return fingerprintText64(canonical);
  }
  function fsrsConfigSnapshot(schedulingPolicy, profile = null) {
      const validatedProfile = profile ? validateFsrsOptimizerProfile(profile) : null;
      const policy = canonicalFsrsSchedulingPolicy(schedulingPolicy);
      const identity = {
          model: FSRS_MODEL,
          schedulingPolicy: policy,
          fractionalDays: true,
          enableFuzz: false,
          enableShortTerm: true,
          learningSteps: ["1d"],
          relearningSteps: ["1d"],
          graduatingInterval: FSRS_GRADUATING_INTERVAL_DAYS,
          allowModelOverride: true,
          maximumInterval: FSRS_MAXIMUM_INTERVAL_DAYS,
          clearStatsOnForget: false,
          weightsSource: validatedProfile ? "optimizer-profile" : "ts-fsrs-package-default",
          weightsFingerprint: validatedProfile ? fsrsWeightsFingerprint(validatedProfile.weights) : FSRS7_DEFAULT_WEIGHTS_FINGERPRINT,
          ...(validatedProfile ? { optimizerProfileSourceSha256: validatedProfile.sourceSha256 } : {}),
      };
      return { ...identity, fingerprint: fsrsConfigurationFingerprint(identity) };
  }
  function validateFsrsConfigSnapshot(config) {
      assert(config.model === FSRS_MODEL, "FSRS configuration model is invalid.");
      const schedulingPolicy = canonicalFsrsSchedulingPolicy(config.schedulingPolicy);
      assert(JSON.stringify(config.schedulingPolicy) === JSON.stringify(schedulingPolicy), "FSRS scheduling policy is not canonical.");
      assert(config.fractionalDays === true, "FSRS-7 requires fractional-day memory semantics.");
      assert(config.enableFuzz === false && config.enableShortTerm === true, "FSRS scheduler flags are invalid.");
      assert(config.learningSteps.length === 1 && config.learningSteps[0] === "1d", "FSRS learning-step policy is invalid.");
      assert(config.relearningSteps.length === 1 && config.relearningSteps[0] === "1d", "FSRS relearning-step policy is invalid.");
      assert(config.graduatingInterval === FSRS_GRADUATING_INTERVAL_DAYS && config.allowModelOverride === true, "FSRS graduation policy is invalid.");
      assert(config.maximumInterval === FSRS_MAXIMUM_INTERVAL_DAYS && config.clearStatsOnForget === false, "FSRS interval/statistics policy is invalid.");
      assert(config.weightsSource === "ts-fsrs-package-default" || config.weightsSource === "optimizer-profile", "FSRS weight source is invalid.");
      assert(/^fnv1a64:[0-9a-f]{16}$/.test(config.weightsFingerprint), "FSRS weights fingerprint is invalid.");
      if (config.weightsSource === "ts-fsrs-package-default") {
          assert(config.weightsFingerprint === FSRS7_DEFAULT_WEIGHTS_FINGERPRINT && config.optimizerProfileSourceSha256 === undefined, "Stock FSRS weight provenance is invalid.");
      }
      else {
          assert(typeof config.optimizerProfileSourceSha256 === "string" && /^[a-f0-9]{64}$/.test(config.optimizerProfileSourceSha256), "Personalized FSRS profile provenance is invalid.");
      }
      const { fingerprint: _fingerprint, ...identity } = config;
      assert(config.fingerprint === fsrsConfigurationFingerprint(identity), "FSRS configuration fingerprint does not match its settings.");
      return config;
  }
  function requiredFsrs7StabilityFast(value) {
      assert(Number.isFinite(value), "FSRS-7 memory state is missing fast stability.");
      return value;
  }
  function storedFsrsScheduleStatus(value) {
      assert(value !== "suspended", "Revision Director does not persist FSRS-owned suspension state.");
      return value;
  }
  function validateStoredFsrsCard(card, expectedCardId) {
      assert(card.model === FSRS_MODEL, "Memory obligation does not use the current FSRS-7 model.");
      if (expectedCardId !== undefined)
          assert(card.cardId === expectedCardId, "FSRS card identity does not match its obligation.");
      assert(typeof card.cardId === "string" && card.cardId.length > 0, "FSRS card identity is invalid.");
      assert(Number.isFinite(new Date(card.dueAt).getTime()), "FSRS due date is invalid.");
      if (card.lastReviewAt !== undefined)
          assert(Number.isFinite(new Date(card.lastReviewAt).getTime()), "FSRS last-review date is invalid.");
      for (const value of [card.stability, requiredFsrs7StabilityFast(card.stabilityFast), card.difficulty, card.scheduledDays]) {
          assert(Number.isFinite(value) && value >= 0, "FSRS card contains an invalid numeric state.");
      }
      assert(Number.isInteger(card.learningStep) && card.learningStep >= 0, "FSRS learning step is invalid.");
      assert(Number.isInteger(card.reps) && card.reps >= 0 && Number.isInteger(card.lapses) && card.lapses >= 0, "FSRS review counters are invalid.");
      assert(Number.isInteger(card.state) && card.state >= 0 && card.state <= 3, "FSRS card state is invalid.");
      assert(card.scheduleStatus === "new" || card.scheduleStatus === "learning" || card.scheduleStatus === "review", "Revision Director does not persist FSRS-owned suspension state.");
  }
  function serializeFsrsCard(card) {
      const stored = {
          model: FSRS_MODEL,
          cardId: card.cardId,
          dueAt: card.dueAt.toISOString(),
          stability: card.stability,
          stabilityFast: requiredFsrs7StabilityFast(card.stabilityFast),
          difficulty: card.difficulty,
          scheduledDays: card.scheduledDays,
          learningStep: card.learningStep,
          reps: card.reps,
          lapses: card.lapses,
          state: card.state,
          scheduleStatus: storedFsrsScheduleStatus(card.scheduleStatus),
      };
      if (card.lastReviewAt)
          stored.lastReviewAt = card.lastReviewAt.toISOString();
      validateStoredFsrsCard(stored);
      return stored;
  }
  function hydrateFsrsCard(card, expectedCardId = card.cardId) {
      validateStoredFsrsCard(card, expectedCardId);
      return {
          cardId: card.cardId,
          dueAt: new Date(card.dueAt),
          lastReviewAt: card.lastReviewAt ? new Date(card.lastReviewAt) : null,
          stability: card.stability,
          stabilityFast: requiredFsrs7StabilityFast(card.stabilityFast),
          difficulty: card.difficulty,
          scheduledDays: card.scheduledDays,
          learningStep: card.learningStep,
          reps: card.reps,
          lapses: card.lapses,
          state: card.state,
          scheduleStatus: card.scheduleStatus,
      };
  }
  function runtimeFsrs() {
      assert(typeof FSRS === "object" && FSRS !== null, "Embedded ts-fsrs 6.0.0 failed to initialize. The deployment file may be damaged.");
      assert(typeof FSRS.DefaultScheduler === "function", "Invalid ts-fsrs v6 scheduler runtime.");
      return FSRS;
  }
  function fsrsRuntimeAvailable() {
      try {
          runtimeFsrs();
          return true;
      }
      catch {
          return false;
      }
  }
  function storedFsrsCardsEqual(left, right) {
      return left.model === right.model
          && left.cardId === right.cardId
          && left.dueAt === right.dueAt
          && left.lastReviewAt === right.lastReviewAt
          && left.stability === right.stability
          && left.stabilityFast === right.stabilityFast
          && left.difficulty === right.difficulty
          && left.scheduledDays === right.scheduledDays
          && left.learningStep === right.learningStep
          && left.reps === right.reps
          && left.lapses === right.lapses
          && left.state === right.state
          && left.scheduleStatus === right.scheduleStatus;
  }
  function validateMemoryObservationChain(cardId, reviews, currentProjection) {
      let previous;
      for (let index = 0; index < reviews.length; index += 1) {
          const review = reviews[index];
          assert(review.evidenceEventId.length > 0, "Memory review lacks evidence identity.");
          validateRating(review.rating);
          assert(review.source === "direct-memory" || review.source === "relearning-return", "Memory review source is invalid.");
          assert(Number.isFinite(new Date(review.reviewedAt).getTime()), "Memory review timestamp is invalid.");
          assert(/^fnv1a64:[0-9a-f]{16}$/.test(review.configFingerprint), "Memory review configuration fingerprint is invalid.");
          validateStoredFsrsCard(review.beforeCard, cardId);
          validateStoredFsrsCard(review.afterCard, cardId);
          assert(review.afterCard.lastReviewAt === review.reviewedAt, "Memory review timestamp does not match its resulting FSRS card.");
          if (index === 0) {
              assert(review.beforeCard.reps === 0 && review.beforeCard.lastReviewAt === undefined, "FSRS replay history is incomplete from card creation.");
          }
          else {
              const previousReview = reviews[index - 1];
              assert(previous, "FSRS review history is incomplete.");
              if (previousReview.configFingerprint === review.configFingerprint) {
                  assert(storedFsrsCardsEqual(previous, review.beforeCard), "FSRS review history does not form a continuous projection chain.");
              }
              else {
                  assert(previous.reps === review.beforeCard.reps
                      && previous.lapses === review.beforeCard.lapses
                      && previous.lastReviewAt === review.beforeCard.lastReviewAt, "FSRS configuration rebase changed immutable review counters or last-review time.");
              }
          }
          previous = review.afterCard;
      }
      if (!currentProjection)
          return;
      validateStoredFsrsCard(currentProjection, cardId);
      if (reviews.length === 0) {
          assert(currentProjection.reps === 0 && currentProjection.lastReviewAt === undefined, "Reviewed FSRS projection has no canonical review history.");
      }
  }
  function directMemoryReviewObservation(event) {
      const beforeCard = event.beforePolicyState.fsrsCard;
      const afterCard = event.afterPolicyState.fsrsCard;
      const config = event.schedulerConfig;
      assert(beforeCard && afterCard && config, "Memory evidence is missing FSRS replay provenance.");
      return {
          evidenceEventId: event.id,
          reviewedAt: event.reviewedAt,
          rating: validateRating(event.confirmedRating),
          source: "direct-memory",
          beforeCard: clone(beforeCard),
          afterCard: clone(afterCard),
          configFingerprint: validateFsrsConfigSnapshot(config).fingerprint,
      };
  }
  function returnedMemoryReviewObservation(event, returned) {
      const beforeCard = returned.beforePolicyState.fsrsCard;
      const afterCard = returned.afterPolicyState.fsrsCard;
      assert(beforeCard && afterCard, "Returned-memory evidence is missing FSRS replay state.");
      return {
          evidenceEventId: event.id,
          reviewedAt: event.reviewedAt,
          rating: validateRating(returned.rating),
          source: "relearning-return",
          beforeCard: clone(beforeCard),
          afterCard: clone(afterCard),
          configFingerprint: validateFsrsConfigSnapshot(returned.schedulerConfig).fingerprint,
      };
  }
  function finalizeMemoryReviewObservations(obligationId, reviews) {
      reviews.sort((left, right) => {
          const time = left.reviewedAt.localeCompare(right.reviewedAt);
          if (time !== 0)
              return time;
          if (storedFsrsCardsEqual(left.afterCard, right.beforeCard))
              return -1;
          if (storedFsrsCardsEqual(right.afterCard, left.beforeCard))
              return 1;
          return left.evidenceEventId.localeCompare(right.evidenceEventId);
      });
      validateMemoryObservationChain(obligationId, reviews);
      return reviews;
  }
  function memoryReviewObservationsFor(obligationId, evidenceEvents) {
      const reviews = [];
      for (const event of evidenceEvents) {
          if (event.obligationId === obligationId && event.obligationType === "memory-recall") {
              reviews.push(directMemoryReviewObservation(event));
          }
          const returned = event.returnedMemoryTransition;
          if (returned?.obligationId === obligationId) {
              reviews.push(returnedMemoryReviewObservation(event, returned));
          }
      }
      return finalizeMemoryReviewObservations(obligationId, reviews);
  }
  function memoryReviewObservationIndex(evidenceEvents) {
      const mutable = new Map();
      const append = (obligationId, review) => {
          const reviews = mutable.get(obligationId);
          if (reviews)
              reviews.push(review);
          else
              mutable.set(obligationId, [review]);
      };
      for (const event of evidenceEvents) {
          if (event.obligationType === "memory-recall") {
              append(event.obligationId, directMemoryReviewObservation(event));
          }
          const returned = event.returnedMemoryTransition;
          if (returned)
              append(returned.obligationId, returnedMemoryReviewObservation(event, returned));
      }
      const index = new Map();
      for (const [obligationId, reviews] of mutable) {
          index.set(obligationId, finalizeMemoryReviewObservations(obligationId, reviews));
      }
      return index;
  }
  function memoryProjectionVerificationFingerprint(currentProjection, reviews) {
      return fingerprintText64(JSON.stringify({
          projection: currentProjection,
          reviews: reviews.map((review) => ({
              evidenceEventId: review.evidenceEventId,
              reviewedAt: review.reviewedAt,
              rating: review.rating,
              source: review.source,
              configFingerprint: review.configFingerprint,
              beforeCard: review.beforeCard,
              afterCard: review.afterCard,
          })),
      }));
  }
  class TsFsrsSchedulerPort {
      scheduler;
      configuration;
      history;
      verifiedProjectionFingerprints = new Map();
      constructor(scheduler, configuration) {
          this.scheduler = scheduler;
          this.configuration = clone(validateFsrsConfigSnapshot(configuration));
          this.history = new Reschedule(scheduler);
      }
      replayCards(initialCard, reviews) {
          assert(reviews.length > 0, "FSRS replay requires review history.");
          return this.history.reschedule({
              initialCard: hydrateFsrsCard(initialCard),
              history: reviews.map((review) => ({
                  rating: review.rating,
                  reviewTime: new Date(review.reviewedAt),
              })),
          }, { sortHistory: false });
      }
      grade(rating) {
          const api = runtimeFsrs();
          if (rating === Rating.Again)
              return api.Rating.Again;
          if (rating === Rating.Hard)
              return api.Rating.Hard;
          if (rating === Rating.Good)
              return api.Rating.Good;
          return api.Rating.Easy;
      }
      newCard(firstDueAt, cardId) {
          const now = new Date(firstDueAt);
          assert(Number.isFinite(now.getTime()), "FSRS initial due date is invalid.");
          return serializeFsrsCard(this.scheduler.newCard({ now, cardId }));
      }
      materializeValidated(currentProjection, reviews) {
          if (reviews.length === 0)
              return clone(currentProjection);
          const result = this.replayCards(reviews[0].beforeCard, reviews);
          assert(result.results.length === reviews.length, "FSRS reschedule produced an incomplete projection sequence.");
          for (let index = 0; index < reviews.length; index += 1) {
              const review = reviews[index];
              if (review.configFingerprint === this.configuration.fingerprint) {
                  const expectedBefore = index === 0
                      ? reviews[0].beforeCard
                      : serializeFsrsCard(result.results[index - 1].card);
                  assert(storedFsrsCardsEqual(review.beforeCard, expectedBefore), "FSRS replayed before-state diverges from immutable evidence recorded under the active scheduler configuration.");
                  assert(storedFsrsCardsEqual(review.afterCard, serializeFsrsCard(result.results[index].card)), "FSRS replay diverges from immutable evidence recorded under the active scheduler configuration.");
              }
          }
          return serializeFsrsCard(result.card);
      }
      verifyProjection(currentProjection, reviews, forceReplay = false) {
          validateMemoryObservationChain(currentProjection.cardId, reviews, currentProjection);
          const fingerprint = memoryProjectionVerificationFingerprint(currentProjection, reviews);
          if (!forceReplay && this.verifiedProjectionFingerprints.get(currentProjection.cardId) === fingerprint)
              return;
          const materialized = this.materializeValidated(currentProjection, reviews);
          assert(storedFsrsCardsEqual(currentProjection, materialized), "Stored FSRS materialized projection failed replay integrity.");
          this.verifiedProjectionFingerprints.set(currentProjection.cardId, fingerprint);
      }
      preview(currentProjection, reviews, now) {
          this.verifyProjection(currentProjection, reviews);
          const previews = [];
          for (const candidate of this.scheduler.preview({
              card: hydrateFsrsCard(currentProjection),
              now,
          })) {
              const rating = validateRating(candidate.grade);
              const dueAt = candidate.card.dueAt.toISOString();
              previews.push({
                  rating,
                  dueAt,
                  intervalDays: daysBetween(candidate.card.dueAt, now),
                  label: intervalLabel(dueAt, now),
              });
          }
          return previews.sort((left, right) => left.rating - right.rating);
      }
      review(currentProjection, reviews, rating, now) {
          this.verifyProjection(currentProjection, reviews);
          const result = this.scheduler.review({
              card: hydrateFsrsCard(currentProjection),
              now,
              grade: this.grade(rating),
          });
          const next = serializeFsrsCard(result.card);
          const reviewLog = {
              model: FSRS_MODEL,
              rating: result.revlog.rating,
              state: result.revlog.state,
              dueAt: result.revlog.dueAt.toISOString(),
              lastReviewAt: result.revlog.lastReviewAt?.toISOString() ?? null,
              reviewTime: result.revlog.reviewTime.toISOString(),
              stability: result.revlog.stability,
              stabilityFast: requiredFsrs7StabilityFast(result.revlog.stabilityFast),
              difficulty: result.revlog.difficulty,
              scheduledDays: result.revlog.scheduledDays,
              learningStep: result.revlog.learningStep,
          };
          if (result.revlog.scheduleStatus !== undefined)
              reviewLog["scheduleStatus"] = result.revlog.scheduleStatus;
          return { card: next, reviewLog };
      }
      retrievability(currentProjection, reviews, at) {
          this.verifyProjection(currentProjection, reviews);
          if (reviews.length === 0 || currentProjection.reps === 0)
              return undefined;
          const lastReview = new Date(reviews.at(-1).reviewedAt);
          const elapsedDays = Math.max(0, this.scheduler.chrono.difference(lastReview, at));
          const retrievability = this.scheduler.model.forgettingCurve({
              stability: currentProjection.stability,
              stabilityFast: requiredFsrs7StabilityFast(currentProjection.stabilityFast),
              difficulty: currentProjection.difficulty,
          }, elapsedDays);
          return clamp(Number(retrievability), 0, 1);
      }
      reschedule(initialCard, reviews) {
          assert(reviews.length > 0, "FSRS reschedule requires review history.");
          validateMemoryObservationChain(initialCard.cardId, reviews);
          validateStoredFsrsCard(initialCard, initialCard.cardId);
          assert(storedFsrsCardsEqual(initialCard, reviews[0].beforeCard), "FSRS reschedule initial card does not match canonical history.");
          const result = this.replayCards(initialCard, reviews);
          const projection = serializeFsrsCard(result.card);
          this.verifiedProjectionFingerprints.set(projection.cardId, memoryProjectionVerificationFingerprint(projection, reviews));
          return projection;
      }
  }
  const FSRS_SCHEDULER_CACHE = new Map();
  async function prepareFsrsScheduler(schedulingPolicy, profile = null) {
      const policy = canonicalFsrsSchedulingPolicy(schedulingPolicy);
      const desiredRetention = fixedRetentionForPolicy(policy);
      const validatedProfile = profile ? validateFsrsOptimizerProfile(profile) : null;
      const configuration = fsrsConfigSnapshot(policy, validatedProfile);
      if (FSRS_SCHEDULER_CACHE.has(configuration.fingerprint))
          return;
      const scheduler = await runtimeFsrs().DefaultScheduler({
          version: FSRS_MODEL,
          desiredRetention,
          enableShortTerm: true,
          learningSteps: FSRS_LEARNING_STEPS,
          relearningSteps: FSRS_RELEARNING_STEPS,
          graduatingInterval: FSRS_GRADUATING_INTERVAL_DAYS,
          allowModelOverride: true,
          enableFuzz: false,
          maximumInterval: FSRS_MAXIMUM_INTERVAL_DAYS,
          clearStatsOnForget: false,
          ...(validatedProfile ? { weights: validatedProfile.weights } : {}),
      });
      const port = new TsFsrsSchedulerPort(scheduler, configuration);
      const probe = port.newCard("2000-01-01T00:00:00.000Z", "revision-director-fsrs7-probe");
      requiredFsrs7StabilityFast(probe.stabilityFast);
      FSRS_SCHEDULER_CACHE.set(configuration.fingerprint, port);
  }
  function revisionSchedulerPort(schedulingPolicy, profile = null) {
      const configuration = fsrsConfigSnapshot(canonicalFsrsSchedulingPolicy(schedulingPolicy), profile ? validateFsrsOptimizerProfile(profile) : null);
      const scheduler = FSRS_SCHEDULER_CACHE.get(configuration.fingerprint);
      assert(scheduler, "FSRS-7 scheduler has not been initialized for the current retention setting.");
      return scheduler;
  }
  function validateMemoryDatasetProjectionChain(obligations, reviewIndex) {
      for (const obligation of obligations) {
          if (obligation.type !== "memory-recall")
              continue;
          const projection = obligation.policyState.fsrsCard;
          assert(projection, "Memory obligation has no FSRS materialized projection.");
          validateMemoryObservationChain(obligation.id, reviewIndex.get(obligation.id) ?? [], projection);
      }
  }
  function verifyMemoryDatasetIntegrityWithIndex(obligations, reviewIndex, schedulingPolicy, profile = null) {
      const scheduler = revisionSchedulerPort(schedulingPolicy, profile);
      for (const obligation of obligations) {
          if (obligation.type !== "memory-recall")
              continue;
          const projection = obligation.policyState.fsrsCard;
          assert(projection, "Memory obligation has no FSRS materialized projection.");
          scheduler.verifyProjection(projection, reviewIndex.get(obligation.id) ?? [], true);
      }
  }
  function verifyMemoryDatasetIntegrity(obligations, evidenceEvents, schedulingPolicy, profile = null) {
      const reviewIndex = memoryReviewObservationIndex(evidenceEvents);
      verifyMemoryDatasetIntegrityWithIndex(obligations, reviewIndex, schedulingPolicy, profile);
      return reviewIndex;
  }

  const MEMORY_EARLY_LEARNING_FAILURE_THRESHOLD = 2;
  const MEMORY_DIFFICULTY_ACTION_LABELS = {
      "scope-review": "reconsider the scope",
      "split-scope": "split oversized material",
      "prerequisite-review": "revisit prerequisites",
      "source-revisit": "revisit source material",
      "representation-change": "change retrieval representation",
      "deliberate-intervention": "flag for deliberate intervention",
  };
  function defaultMemoryDifficultyPolicy() {
      return {
          remediationLapses: 2,
          persistentDifficultyLapses: 4,
          automaticHold: { enabled: false, lapseThreshold: 8 },
      };
  }
  function canonicalMemoryDifficultyPolicy(value) {
      const record = requireRecord(value, "Memory difficulty policy");
      const allowed = new Set(["remediationLapses", "persistentDifficultyLapses", "automaticHold"]);
      assert(Object.keys(record).every((key) => allowed.has(key)), "Memory difficulty policy contains unexpected fields.");
      const remediationLapses = Number(record["remediationLapses"]);
      const persistentDifficultyLapses = Number(record["persistentDifficultyLapses"]);
      assert(Number.isSafeInteger(remediationLapses) && remediationLapses >= 2 && remediationLapses <= 99, "Memory remediation lapse threshold is invalid.");
      assert(Number.isSafeInteger(persistentDifficultyLapses) && persistentDifficultyLapses > remediationLapses && persistentDifficultyLapses <= 100, "Persistent-difficulty lapse threshold is invalid.");
      const automaticHoldRecord = requireRecord(record["automaticHold"], "Memory automatic-hold policy");
      const holdAllowed = new Set(["enabled", "lapseThreshold"]);
      assert(Object.keys(automaticHoldRecord).every((key) => holdAllowed.has(key)), "Memory automatic-hold policy contains unexpected fields.");
      const enabled = automaticHoldRecord["enabled"];
      const lapseThreshold = Number(automaticHoldRecord["lapseThreshold"]);
      assert(typeof enabled === "boolean", "Memory automatic-hold flag is invalid.");
      assert(Number.isSafeInteger(lapseThreshold) && lapseThreshold > persistentDifficultyLapses && lapseThreshold <= 1000, "Memory automatic-hold lapse threshold must be later than persistent difficulty.");
      return {
          remediationLapses,
          persistentDifficultyLapses,
          automaticHold: { enabled, lapseThreshold },
      };
  }
  function memoryDifficultyActionLabel(action) {
      return MEMORY_DIFFICULTY_ACTION_LABELS[action];
  }
  function memoryDifficultyAssessment(obligation, policy, memoryReviews = []) {
      assert(obligation.type === "memory-recall", "Persistent-difficulty assessment is only valid for memory recall.");
      const canonicalPolicy = canonicalMemoryDifficultyPolicy(policy);
      const card = obligation.policyState.fsrsCard;
      assert(card, "Memory obligation has no FSRS card for difficulty assessment.");
      const establishedLapses = card.lapses;
      const earlyLearningFailures = memoryReviews.filter((review) => review.rating === Rating.Again && (review.beforeCard.state === 0 || review.beforeCard.state === 1)).length;
      const stillLearning = card.state === 0 || card.state === 1;
      const level = establishedLapses >= canonicalPolicy.persistentDifficultyLapses ? "persistent-difficulty"
          : establishedLapses >= canonicalPolicy.remediationLapses ? "remediation"
              : stillLearning && earlyLearningFailures >= MEMORY_EARLY_LEARNING_FAILURE_THRESHOLD ? "learning-difficulty"
                  : "normal";
      const recommendedActions = [];
      if (level === "learning-difficulty" || level === "remediation") {
          recommendedActions.push("source-revisit", "representation-change");
      }
      else if (level === "persistent-difficulty") {
          recommendedActions.push("scope-review");
          if (obligation.expectedMinutes > 45 || obligation.chunking !== undefined)
              recommendedActions.push("split-scope");
          recommendedActions.push("prerequisite-review", "source-revisit", "representation-change", "deliberate-intervention");
      }
      return {
          level,
          establishedLapses,
          earlyLearningFailures,
          recommendedActions,
          automaticHoldEligible: level === "persistent-difficulty" &&
              canonicalPolicy.automaticHold.enabled &&
              establishedLapses >= canonicalPolicy.automaticHold.lapseThreshold,
      };
  }
  function memoryDifficultyRemediationPlan(assessment) {
      if (assessment.level === "normal")
          return { priorityBoost: 2, guidance: "" };
      const actions = assessment.recommendedActions.map(memoryDifficultyActionLabel).join("; ");
      if (assessment.level === "learning-difficulty") {
          return {
              priorityBoost: 3,
              guidance: `Early learning difficulty (${assessment.earlyLearningFailures} failed learning recalls): ${actions}. `,
          };
      }
      if (assessment.level === "remediation") {
          return {
              priorityBoost: 3,
              guidance: `Repeated established-memory lapse remediation (${assessment.establishedLapses} FSRS lapses): ${actions}. `,
          };
      }
      return {
          priorityBoost: 4,
          guidance: `Persistent established-memory difficulty (${assessment.establishedLapses} FSRS lapses): ${actions}. `,
      };
  }
  function memoryDifficultyWeaknessFloor(level) {
      return level === "persistent-difficulty" ? 0.9 : level === "remediation" ? 0.72 : level === "learning-difficulty" ? 0.68 : 0;
  }
  const PLANNER_WEIGHTS = Object.freeze({
      dueRisk: 0.30,
      examImportance: 0.20,
      weakness: 0.18,
      reviewDuration: 0.07,
      examinationProximity: 0.15,
      weeklyBalance: 0.10,
  });
  function examDateTime(profile) {
      if (!profile.examDate)
          return undefined;
      const parsed = new Date(`${profile.examDate}T23:59:59`);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  function daysToExamination(profile, reference) {
      const exam = examDateTime(profile);
      if (!exam)
          return 365;
      const examDay = Date.UTC(exam.getFullYear(), exam.getMonth(), exam.getDate());
      const referenceDay = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
      return Math.round((examDay - referenceDay) / DAY_MS);
  }
  function correctiveRelearnDueAt(profile, reviewedAt) {
      const ordinaryDue = addDays(reviewedAt, 1);
      const exam = examDateTime(profile);
      if (!exam)
          return ordinaryDue.toISOString();
      return new Date(Math.max(reviewedAt.getTime(), Math.min(ordinaryDue.getTime(), exam.getTime()))).toISOString();
  }
  function examinationProximityScore(daysToExam) {
      if (daysToExam < 0)
          return 0;
      if (daysToExam <= 14)
          return 1;
      if (daysToExam <= 30)
          return 0.86;
      if (daysToExam <= 60)
          return 0.72;
      if (daysToExam <= 120)
          return 0.54;
      if (daysToExam <= 240)
          return 0.34;
      return 0.18;
  }
  function planningLookaheadDays(daysToExam) {
      if (daysToExam < 0)
          return 0;
      if (daysToExam <= 14)
          return 3;
      if (daysToExam <= 30)
          return 2;
      if (daysToExam <= 90)
          return 1;
      return 0.5;
  }
  function examImportanceScore(importance) {
      return importance === 3 ? 1 : importance === 2 ? 0.65 : 0.3;
  }
  function reviewDurationScore(expectedMinutes, capacityMinutes) {
      const proportion = expectedMinutes / Math.max(expectedMinutes, capacityMinutes);
      return clamp(1 - proportion * 0.45, 0.55, 1);
  }
  function evidenceWeaknessScore(events, neutral = 0.55) {
      const recent = [...events]
          .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
          .slice(0, 5);
      if (recent.length === 0)
          return neutral;
      const ratingWeakness = {
          [Rating.Again]: 1,
          [Rating.Hard]: 0.68,
          [Rating.Good]: 0.26,
          [Rating.Easy]: 0,
      };
      let weightedRating = 0;
      let weightedEvidence = 0;
      let weightedErrors = 0;
      let totalWeight = 0;
      recent.forEach((event, index) => {
          const weight = Math.pow(0.78, index);
          const evidenceMean = (event.evidence.completeness + event.evidence.independence + event.evidence.application) / 12;
          weightedRating += ratingWeakness[event.confirmedRating] * weight;
          weightedEvidence += (1 - evidenceMean) * weight;
          weightedErrors += Math.min(event.evidence.errorTypes.length / 3, 1) * weight;
          totalWeight += weight;
      });
      return clamp((weightedRating / totalWeight) * 0.52 +
          (weightedEvidence / totalWeight) * 0.30 +
          (weightedErrors / totalWeight) * 0.18, 0, 1);
  }
  function obligationWeaknessScore(item, evidenceEvents) {
      const obligationEvidence = evidenceEvents.filter((event) => event.obligationId === item.obligation.id);
      const unitEvidence = evidenceEvents.filter((event) => event.unitId === item.unit.id);
      const unitContext = evidenceWeaknessScore(unitEvidence);
      if (obligationEvidence.length === 0)
          return unitContext;
      const obligationSignal = evidenceWeaknessScore(obligationEvidence);
      const obligationFailureBurden = clamp(item.obligation.policyState.failureCount / 3, 0, 1);
      const unitLapseContext = clamp(item.unit.lapseCount / 4, 0, 1);
      return clamp(obligationSignal * 0.68 +
          unitContext * 0.18 +
          obligationFailureBurden * 0.09 +
          unitLapseContext * 0.05, 0, 1);
  }
  function durationSample(plannedMinutes, elapsedMs) {
      const actualMinutes = roundTo(Math.max(0, elapsedMs) / 60_000, 1);
      if (!Number.isFinite(actualMinutes) || actualMinutes <= 0)
          return { actualMinutes: 0, accepted: false, reason: "invalid" };
      if (actualMinutes < Math.max(1.5, plannedMinutes * 0.3))
          return { actualMinutes, accepted: false, reason: "too-short" };
      if (actualMinutes > Math.min(240, plannedMinutes * 2.5 + 10))
          return { actualMinutes, accepted: false, reason: "too-long" };
      return { actualMinutes, accepted: true, reason: "accepted" };
  }
  function weightedMedian(samples) {
      if (samples.length === 0)
          return undefined;
      const ordered = [...samples].sort((a, b) => a.value - b.value);
      const total = ordered.reduce((sum, sample) => sum + sample.weight, 0);
      let cumulative = 0;
      for (const sample of ordered) {
          cumulative += sample.weight;
          if (cumulative >= total / 2)
              return sample.value;
      }
      return ordered.at(-1)?.value;
  }
  function durationObservationFor(obligation, allEvidence, elapsedMs, durationReliable = true) {
      // expectedMinutes is the estimated effort for the complete retrieval cycle. When an
      // oversized cycle is split, its child work plus final synthesis must still add up to
      // this total rather than increasing it merely because the work was divided.
      const estimateBefore = obligation.chunking?.status === "synthesis-ready" ? obligation.chunking.originalMinutes : obligation.expectedMinutes;
      const sample = durationSample(estimateBefore, elapsedMs);
      const acceptedEvents = allEvidence.filter((event) => event.durationObservation?.accepted);
      const exactEvents = acceptedEvents.filter((event) => event.obligationId === obligation.id);
      const unitWorkflowEvents = acceptedEvents.filter((event) => event.unitId === obligation.unitId && event.workflow === obligation.workflow.kind && event.obligationId !== obligation.id);
      const globalWorkflowEvents = acceptedEvents.filter((event) => event.workflow === obligation.workflow.kind && event.unitId !== obligation.unitId);
      if (!durationReliable) {
          return {
              plannedMinutes: estimateBefore,
              actualMinutes: sample.actualMinutes,
              accepted: false,
              reason: "unreliable-interruption",
              estimateBefore,
              estimateAfter: estimateBefore,
              exactSamples: exactEvents.length,
              unitWorkflowSamples: unitWorkflowEvents.length,
              globalWorkflowSamples: globalWorkflowEvents.length,
          };
      }
      if (!sample.accepted) {
          return {
              plannedMinutes: estimateBefore,
              actualMinutes: sample.actualMinutes,
              accepted: false,
              reason: sample.reason,
              estimateBefore,
              estimateAfter: estimateBefore,
              exactSamples: exactEvents.length,
              unitWorkflowSamples: unitWorkflowEvents.length,
              globalWorkflowSamples: globalWorkflowEvents.length,
          };
      }
      const weighted = [];
      const addRecent = (events, baseWeight, limit) => {
          [...events].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)).slice(0, limit).forEach((event, index) => {
              weighted.push({ value: event.durationObservation.actualMinutes, weight: baseWeight * Math.pow(0.82, index) });
          });
      };
      addRecent(exactEvents, 1, 8);
      addRecent(unitWorkflowEvents, 0.55, 6);
      addRecent(globalWorkflowEvents, 0.25, 8);
      weighted.push({ value: sample.actualMinutes, weight: 1.15 });
      const learned = weightedMedian(weighted) ?? estimateBefore;
      const evidenceStrength = clamp((exactEvents.length + 1 + unitWorkflowEvents.length * 0.45 + globalWorkflowEvents.length * 0.18) / 5, 0, 1);
      const blend = 0.8 * evidenceStrength;
      const desired = estimateBefore * (1 - blend) + learned * blend;
      // Limit a single update, not the lifetime estimate. Repeated consistent sessions may
      // therefore move well beyond an inaccurate first estimate without one outlier doing so.
      const estimateAfter = roundTo(clamp(desired, Math.max(5, estimateBefore * 0.67), Math.min(240, estimateBefore * 1.5)), 0);
      return {
          plannedMinutes: estimateBefore,
          actualMinutes: sample.actualMinutes,
          accepted: true,
          reason: sample.reason,
          estimateBefore,
          estimateAfter,
          exactSamples: exactEvents.length + 1,
          unitWorkflowSamples: unitWorkflowEvents.length,
          globalWorkflowSamples: globalWorkflowEvents.length,
      };
  }
  function subjectBalanceKey(profileId, subject) {
      return `${profileId}::${normalizeName(subject)}`;
  }
  function weeklySubjectBalanceScores(joined, plans, reference, boundaryHour = 4) {
      const minutes = new Map();
      const currentKey = studyDayKey(reference, boundaryHour);
      const cutoffDate = new Date(reference);
      cutoffDate.setDate(cutoffDate.getDate() - 6);
      const cutoffKey = studyDayKey(cutoffDate, boundaryHour);
      for (const plan of plans) {
          if (plan.studyDayKey < cutoffKey || plan.studyDayKey > currentKey)
              continue;
          const itemMap = new Map();
          for (const version of plan.versions)
              for (const item of version.items)
                  itemMap.set(item.key, item);
          for (const outcome of plan.outcomes) {
              if (outcome.status !== "completed" || !outcome.actualMinutes)
                  continue;
              const item = itemMap.get(outcome.itemKey);
              if (!item)
                  continue;
              const key = subjectBalanceKey(item.profileId, item.subject);
              minutes.set(key, (minutes.get(key) ?? 0) + outcome.actualMinutes);
          }
      }
      const unitWeights = new Map();
      const seen = new Set();
      for (const item of joined) {
          const balanceKey = subjectBalanceKey(item.profile.id, item.subject);
          const unitKey = `${balanceKey}|${item.unit.id}`;
          if (seen.has(unitKey))
              continue;
          seen.add(unitKey);
          unitWeights.set(balanceKey, (unitWeights.get(balanceKey) ?? 0) + item.unit.importance);
      }
      const totalMinutes = [...minutes.values()].reduce((sum, value) => sum + value, 0);
      const totalWeight = [...unitWeights.values()].reduce((sum, value) => sum + value, 0) || 1;
      const result = new Map();
      for (const [key, weight] of unitWeights) {
          if (totalMinutes < 30) {
              result.set(key, 0.5);
              continue;
          }
          const targetShare = weight / totalWeight;
          const actualShare = (minutes.get(key) ?? 0) / totalMinutes;
          result.set(key, clamp(0.5 + (targetShare - actualShare) * 2.2, 0, 1));
      }
      return result;
  }
  function plannedQueueStableKey(item) {
      return planItemKey(item.joined.obligation.id, item.chunk?.id);
  }
  function interleaveSelected(items) {
      const remaining = [...items].sort((a, b) => b.score - a.score || plannedQueueStableKey(a).localeCompare(plannedQueueStableKey(b)));
      const ordered = [];
      while (remaining.length) {
          const top = remaining[0];
          if (top.joined.obligation.type === "relearn" || (top.dueState === "overdue" && top.factors.dueRisk >= 0.9)) {
              ordered.push(top);
              remaining.shift();
              continue;
          }
          const last = ordered.at(-1);
          const eligible = remaining.filter((item) => top.score - item.score <= 8);
          const best = eligible.sort((a, b) => {
              const sameSubject = (left, right) => left.joined.profile.id === right.joined.profile.id && normalizeName(left.joined.subject) === normalizeName(right.joined.subject);
              const aPenalty = (last && sameSubject(last, a) ? 2 : 0) + (last?.joined.obligation.workflow?.kind === a.joined.obligation.workflow?.kind ? 1 : 0);
              const bPenalty = (last && sameSubject(last, b) ? 2 : 0) + (last?.joined.obligation.workflow?.kind === b.joined.obligation.workflow?.kind ? 1 : 0);
              return aPenalty - bPenalty || b.score - a.score || plannedQueueStableKey(a).localeCompare(plannedQueueStableKey(b));
          })[0] ?? top;
          ordered.push(best);
          remaining.splice(remaining.indexOf(best), 1);
      }
      return ordered;
  }
  function planItemKey(obligationId, chunkId) {
      return chunkId ? `${obligationId}::${chunkId}` : obligationId;
  }
  function splitRange(start, end, count) {
      const size = end - start + 1;
      const result = [];
      let cursor = start;
      for (let index = 0; index < count; index += 1) {
          const remaining = size - (cursor - start);
          const slots = count - index;
          const chunkSize = Math.ceil(remaining / slots);
          result.push([cursor, cursor + chunkSize - 1]);
          cursor += chunkSize;
      }
      return result;
  }
  function createAutomaticChunks(item, capacityMinutes, now = new Date()) {
      const originalMinutes = Math.max(1, Math.round(item.obligation.expectedMinutes));
      const maxChunk = Math.max(5, Math.min(capacityMinutes, Math.max(10, Math.floor(capacityMinutes * 0.75))));
      const synthesisMinutes = Math.max(1, Math.min(capacityMinutes, Math.max(5, Math.round(originalMinutes * 0.25)), Math.max(1, originalMinutes - 2)));
      const chunkWorkMinutes = Math.max(2, originalMinutes - synthesisMinutes);
      const total = clamp(Math.ceil(chunkWorkMinutes / maxChunk), 2, Math.min(60, chunkWorkMinutes));
      const cycleId = uid("cycle");
      const sourceText = `${item.unit.scope} ${item.unit.source} ${item.obligation.protocol}`;
      const pageMatch = sourceText.match(/(?:pages?|pp?\.?|pgs?\.?)\s*(\d+)\s*[–—-]\s*(\d+)/i);
      const questionMatch = sourceText.match(/(\d+)\s*(?:questions?|qs?\b)/i);
      const minuteBase = Math.floor(chunkWorkMinutes / total);
      let minuteRemainder = chunkWorkMinutes % total;
      const time = now.toISOString();
      const pageSpan = pageMatch ? Number(pageMatch[2]) - Number(pageMatch[1]) + 1 : 0;
      const questionSpan = questionMatch ? Number(questionMatch[1]) : 0;
      const ranges = pageMatch && pageSpan >= total ? splitRange(Number(pageMatch[1]), Number(pageMatch[2]), total) : undefined;
      const questionRanges = !ranges && questionMatch && questionSpan >= total ? splitRange(1, questionSpan, total) : undefined;
      const chunks = Array.from({ length: total }, (_, index) => {
          const minutes = minuteBase + (minuteRemainder-- > 0 ? 1 : 0);
          const scope = ranges ? `Pages ${ranges[index][0]}–${ranges[index][1]}` : questionRanges ? `Questions ${questionRanges[index][0]}–${questionRanges[index][1]}` : `Part ${index + 1} of ${total}`;
          return {
              schemaVersion: DOCUMENT_SCHEMA_VERSION,
              id: uid("chunk"), obligationId: item.obligation.id, cycleId, ordinal: index + 1, total,
              label: `${item.unit.title} · ${scope}`, scope, expectedMinutes: Math.max(1, minutes), status: "pending",
              createdAt: time, updatedAt: time,
          };
      });
      return {
          state: {
              cycleId, status: "chunking", originalMinutes,
              synthesisMinutes, capacityMinutes,
              totalChunks: total, completedChunks: 0, createdAt: time,
          },
          chunks,
      };
  }
  function fsrsRetrievability(obligation, reference, schedulingPolicy, reviews = [], profile = null) {
      if (obligation.type !== "memory-recall" || !obligation.policyState.fsrsCard)
          return undefined;
      const projection = obligation.policyState.fsrsCard;
      if (projection.reps === 0 || !projection.lastReviewAt)
          return undefined;
      return revisionSchedulerPort(schedulingPolicy, profile).retrievability(projection, reviews, reference);
  }
  function finalMemoryExamDeadline(item) {
      if (item.obligation.type !== "memory-recall")
          return undefined;
      const exam = examDateTime(item.profile);
      if (!exam)
          return undefined;
      const card = item.obligation.policyState.fsrsCard;
      assert(card, "Memory obligation has no FSRS-7 state.");
      const finalWindowStart = new Date(exam.getTime() - FINAL_MEMORY_REVIEW_WINDOW_DAYS * DAY_MS);
      if (card.lastReviewAt && new Date(card.lastReviewAt).getTime() >= finalWindowStart.getTime())
          return undefined;
      return exam;
  }
  function temporalDueRisk(dueAt, dayStart, dayEnd, lookaheadDays) {
      if (dueAt.getTime() < dayStart.getTime()) {
          const overdueDays = (dayStart.getTime() - dueAt.getTime()) / DAY_MS;
          return clamp(0.78 + 0.22 * (1 - Math.exp(-overdueDays / 7)), 0, 1);
      }
      if (dueAt.getTime() < dayEnd.getTime())
          return 0.64;
      const daysAhead = (dueAt.getTime() - dayEnd.getTime()) / DAY_MS;
      if (daysAhead > lookaheadDays)
          return 0;
      return clamp(0.5 * (1 - daysAhead / Math.max(lookaheadDays, 0.25)), 0.08, 0.5);
  }
  function plannerScore(factors, obligation) {
      const weighted = factors.dueRisk * PLANNER_WEIGHTS.dueRisk +
          factors.examImportance * PLANNER_WEIGHTS.examImportance +
          factors.weakness * PLANNER_WEIGHTS.weakness +
          factors.reviewDuration * PLANNER_WEIGHTS.reviewDuration +
          factors.examinationProximity * PLANNER_WEIGHTS.examinationProximity +
          factors.weeklyBalance * PLANNER_WEIGHTS.weeklyBalance;
      const explicitPriority = clamp(obligation.priority * 0.025, 0, 0.1);
      const relearnBoost = obligation.type === "relearn" ? 0.08 : 0;
      return roundTo(clamp((weighted + explicitPriority + relearnBoost) * 100, 0, 100), 1);
  }
  function planningReasons(item, factors, dueState, daysFromDue, daysToExam) {
      const reasons = [];
      if (dueState === "overdue")
          reasons.push(`${Math.max(1, Math.ceil(daysFromDue))}d overdue`);
      else if (dueState === "due")
          reasons.push("due in this study day");
      else
          reasons.push("brought forward to use available capacity");
      if (item.obligation.type === "relearn")
          reasons.push("active relearning repair");
      if (factors.examImportance >= 0.95)
          reasons.push("core exam knowledge");
      else if (factors.examImportance >= 0.6)
          reasons.push("important exam knowledge");
      if (factors.weakness >= 0.7)
          reasons.push("strong weakness signal");
      else if (factors.weakness >= 0.48)
          reasons.push("limited or fragile evidence");
      if (daysToExam <= 30)
          reasons.push(`exam in ${Math.max(0, daysToExam)}d`);
      reasons.push(`${item.obligation.expectedMinutes}m estimated`);
      return reasons.slice(0, 5);
  }
  function buildPlanningCandidate(item, evidenceEvents, settings, reference, weeklyBalance = 0.5, chunk, memoryReviews) {
      if (item.profile.status !== "active")
          return undefined;
      const dayStart = studyDayStart(reference, settings.studyDayBoundaryHour);
      const dayEnd = studyDayEnd(reference, settings.studyDayBoundaryHour);
      const daysToExam = daysToExamination(item.profile, reference);
      if (examDateTime(item.profile) && daysToExam < 0)
          return undefined;
      const lookaheadDays = planningLookaheadDays(daysToExam);
      const policyDueAt = new Date(item.obligation.dueAt);
      const memoryExamDeadline = finalMemoryExamDeadline(item);
      const examBoundMemory = Boolean(memoryExamDeadline && policyDueAt.getTime() > memoryExamDeadline.getTime());
      const planningDueAt = examBoundMemory ? memoryExamDeadline : policyDueAt;
      const synthesisReady = item.obligation.chunking?.status === "synthesis-ready";
      if (!synthesisReady && planningDueAt.getTime() > dayEnd.getTime() + lookaheadDays * DAY_MS)
          return undefined;
      const temporalRisk = temporalDueRisk(planningDueAt, dayStart, dayEnd, lookaheadDays);
      const memoryHistory = item.obligation.type === "memory-recall"
          ? memoryReviews?.get(item.obligation.id) ?? memoryReviewObservationsFor(item.obligation.id, evidenceEvents)
          : [];
      const retrievability = fsrsRetrievability(item.obligation, reference, settings.fsrsScheduling.policy, memoryHistory, activeFsrsOptimizerProfile(settings));
      const desiredRetention = fixedRetentionForPolicy(settings.fsrsScheduling.policy);
      const memoryRisk = retrievability === undefined ? 0 : clamp((desiredRetention - retrievability) / Math.max(desiredRetention - 0.5, 0.1), 0, 1);
      const dueRisk = retrievability === undefined ? temporalRisk : Math.max(temporalRisk, memoryRisk);
      const difficulty = item.obligation.type === "memory-recall"
          ? memoryDifficultyAssessment(item.obligation, settings.memoryDifficultyPolicy, memoryHistory)
          : undefined;
      const factors = {
          dueRisk,
          examImportance: examImportanceScore(item.unit.importance),
          weakness: Math.max(obligationWeaknessScore(item, evidenceEvents), memoryDifficultyWeaknessFloor(difficulty?.level ?? "normal")),
          reviewDuration: reviewDurationScore(chunk?.expectedMinutes ?? (item.obligation.chunking?.status === "synthesis-ready" ? item.obligation.chunking.synthesisMinutes : item.obligation.expectedMinutes), settings.dailyCapacityMinutes),
          examinationProximity: examinationProximityScore(daysToExam),
          weeklyBalance,
      };
      const dueState = planningDueAt.getTime() < dayStart.getTime() ? "overdue" : planningDueAt.getTime() < dayEnd.getTime() ? "due" : "brought-forward";
      const daysFromDue = (reference.getTime() - planningDueAt.getTime()) / DAY_MS;
      return {
          joined: item,
          factors,
          score: plannerScore(factors, item.obligation),
          dueState,
          daysToExam,
          examDateKnown: Boolean(examDateTime(item.profile)),
          daysFromDue,
          ...(retrievability === undefined ? {} : { retrievability }),
          reasons: [
              ...(chunk ? [`split scope: ${chunk.scope}`] : item.obligation.chunking?.status === "synthesis-ready" ? ["final synthesis after split work"] : []),
              ...(examBoundMemory ? ["final memory review before exam"] : []),
              ...(difficulty?.level === "persistent-difficulty"
                  ? [`persistent difficulty · ${difficulty.establishedLapses} established FSRS lapses`]
                  : difficulty?.level === "remediation"
                      ? [`remediation · ${difficulty.establishedLapses} established FSRS lapses`]
                      : difficulty?.level === "learning-difficulty"
                          ? [`early learning difficulty · ${difficulty.earlyLearningFailures} failed learning recalls`]
                          : []),
              ...planningReasons(item, factors, dueState, daysFromDue, daysToExam),
              ...(weeklyBalance >= 0.7 ? ["subject underrepresented this week"] : []),
          ].slice(0, 6),
          executionMinutes: chunk?.expectedMinutes ?? (item.obligation.chunking?.status === "synthesis-ready" ? item.obligation.chunking.synthesisMinutes : item.obligation.expectedMinutes),
          ...(chunk ? { chunk } : {}),
      };
  }
  function choosePlanItems(candidates, capacityMinutes) {
      const ordered = [...candidates].sort((a, b) => b.score - a.score
          || a.joined.obligation.dueAt.localeCompare(b.joined.obligation.dueAt)
          || a.joined.obligation.expectedMinutes - b.joined.obligation.expectedMinutes
          || plannedQueueStableKey(a).localeCompare(plannedQueueStableKey(b)));
      if (ordered.length === 0)
          return { selected: [], requiredOverrun: [], mustSplit: [], deferred: [] };
      const durationOf = (item) => Math.max(1, Math.ceil(item.executionMinutes ?? item.joined.obligation.expectedMinutes));
      const solve = (items, capacity) => {
          if (items.length === 0 || capacity <= 0)
              return [];
          const dp = new Int32Array(capacity + 1);
          dp.fill(-1);
          dp[0] = 0;
          const choices = [];
          for (const item of items) {
              const duration = durationOf(item);
              if (duration > capacity) {
                  choices.push(new Uint8Array(capacity + 1));
                  continue;
              }
              const value = Math.max(1, Math.round(item.score * 100));
              const before = new Int32Array(dp);
              const take = new Uint8Array(capacity + 1);
              for (let used = duration; used <= capacity; used += 1) {
                  if (before[used - duration] < 0)
                      continue;
                  const candidateValue = before[used - duration] + value;
                  if (candidateValue > dp[used]) {
                      dp[used] = candidateValue;
                      take[used] = 1;
                  }
              }
              choices.push(take);
          }
          let bestUsed = 0;
          for (let used = 1; used <= capacity; used += 1)
              if (dp[used] > dp[bestUsed])
                  bestUsed = used;
          const picked = [];
          for (let index = items.length - 1; index >= 0; index -= 1) {
              if (!choices[index][bestUsed])
                  continue;
              const item = items[index];
              picked.push(item);
              bestUsed -= durationOf(item);
          }
          return picked.reverse();
      };
      const critical = ordered.filter((item) => item.joined.obligation.type === "relearn" || (item.dueState === "overdue" && item.factors.dueRisk >= 0.85));
      const oversizedCritical = critical.filter((item) => durationOf(item) > capacityMinutes);
      const highestCritical = critical[0];
      if (highestCritical && durationOf(highestCritical) > capacityMinutes) {
          const selected = [highestCritical];
          const requiredOverrun = [highestCritical];
          const mustSplit = oversizedCritical.filter((item) => item.joined.obligation.id !== highestCritical.joined.obligation.id);
          const excludedIds = new Set([...selected, ...mustSplit].map((item) => item.joined.obligation.id));
          return { selected, requiredOverrun, mustSplit, deferred: ordered.filter((item) => !excludedIds.has(item.joined.obligation.id)) };
      }
      const fitCritical = critical.filter((item) => durationOf(item) <= capacityMinutes);
      const mustSplit = oversizedCritical;
      const normal = ordered.filter((item) => !critical.includes(item));
      let selected = solve(fitCritical, capacityMinutes);
      let used = selected.reduce((sum, item) => sum + item.executionMinutes, 0);
      if (used < capacityMinutes)
          selected = selected.concat(solve(normal, capacityMinutes - used));
      const requiredOverrun = [];
      if (selected.length === 0 && ordered.length > 0) {
          const firstFit = ordered.find((item) => durationOf(item) <= capacityMinutes && !mustSplit.includes(item));
          if (firstFit)
              selected = [firstFit];
          else {
              selected = [ordered[0]];
              requiredOverrun.push(ordered[0]);
          }
      }
      const excludedIds = new Set([...selected, ...mustSplit].map((item) => item.joined.obligation.id));
      selected = interleaveSelected(selected);
      return { selected, requiredOverrun, mustSplit, deferred: ordered.filter((item) => !excludedIds.has(item.joined.obligation.id)) };
  }

  class FsrsMemoryPolicy {
      schedulingPolicy;
      optimizerProfile;
      id = `memory/ts-fsrs@${FSRS_PACKAGE_VERSION}/fsrs-7`;
      type = "memory-recall";
      constructor(schedulingPolicy, optimizerProfile = () => null) {
          this.schedulingPolicy = schedulingPolicy;
          this.optimizerProfile = optimizerProfile;
      }
      scheduler() {
          return revisionSchedulerPort(this.schedulingPolicy(), this.optimizerProfile());
      }
      reviews(context) {
          return context?.memoryReviews ?? [];
      }
      createInitialState(firstDueAt, cardId) {
          const card = this.scheduler().newCard(firstDueAt, cardId);
          return {
              engine: "ts-fsrs",
              version: FSRS_PACKAGE_VERSION,
              stage: card.state,
              successStreak: 0,
              failureCount: 0,
              lastIntervalDays: 0,
              fsrsCard: card,
          };
      }
      preview(obligation, now, context) {
          const card = obligation.policyState.fsrsCard;
          assert(card, "Memory obligation has no FSRS-7 card state.");
          return this.scheduler().preview(card, this.reviews(context), now);
      }
      complete(obligation, rating, _evidence, now, context) {
          const card = obligation.policyState.fsrsCard;
          assert(card, "Memory obligation has no FSRS-7 card state.");
          const scheduler = this.scheduler();
          const result = scheduler.review(card, this.reviews(context), rating, now);
          const next = result.card;
          const state = {
              engine: "ts-fsrs",
              version: FSRS_PACKAGE_VERSION,
              stage: next.state,
              successStreak: rating >= Rating.Good ? obligation.policyState.successStreak + 1 : 0,
              failureCount: obligation.policyState.failureCount + (rating === Rating.Again ? 1 : 0),
              lastIntervalDays: next.scheduledDays,
              fsrsCard: next,
          };
          const completion = {
              dueAt: next.dueAt,
              policyState: state,
              policyId: this.id,
              reviewLog: result.reviewLog,
              schedulerConfig: clone(scheduler.configuration),
          };
          if (rating === Rating.Again)
              completion.followUpType = "relearn";
          return completion;
      }
  }
  class IntervalPolicy {
      createInitialState(_firstDueAt) {
          return {
              engine: this.engine(),
              version: "1",
              stage: 0,
              successStreak: 0,
              failureCount: 0,
              lastIntervalDays: 0,
          };
      }
      preview(obligation, now) {
          return [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((rating) => {
              const intervalDays = this.intervals(obligation.policyState, rating, obligation);
              const dueAt = addDays(now, intervalDays).toISOString();
              return { rating, dueAt, intervalDays, label: intervalLabel(dueAt, now) };
          });
      }
      complete(obligation, rating, evidence, now) {
          const intervalDays = this.intervals(obligation.policyState, rating, obligation);
          const successful = rating >= Rating.Good && objectiveScore(obligation.type, evidence) >= 2.6;
          const policyState = {
              engine: this.engine(),
              version: "1",
              stage: successful ? obligation.policyState.stage + 1 : Math.max(0, obligation.policyState.stage - 1),
              successStreak: successful ? obligation.policyState.successStreak + 1 : 0,
              failureCount: obligation.policyState.failureCount + (rating === Rating.Again ? 1 : 0),
              lastIntervalDays: intervalDays,
          };
          const completion = {
              dueAt: addDays(now, intervalDays).toISOString(),
              policyState,
              policyId: this.id,
          };
          if (rating === Rating.Again || objectiveScore(obligation.type, evidence) < 1.35)
              completion.followUpType = "relearn";
          return completion;
      }
  }
  class MasteryPolicy extends IntervalPolicy {
      id = "concept-mastery/v1";
      type = "concept-reconstruction";
      engine() { return "mastery"; }
      intervals(state, rating) {
          if (rating === Rating.Again)
              return 1;
          if (rating === Rating.Hard)
              return Math.max(2, Math.round(Math.max(3, state.lastIntervalDays) * 0.65));
          const good = [3, 7, 14, 30, 60, 120, 210, 365];
          const easy = [7, 14, 30, 60, 120, 210, 365, 540];
          return (rating === Rating.Good ? good : easy)[Math.min(state.stage, 7)];
      }
  }
  class ApplicationPolicy extends IntervalPolicy {
      id = "application-practice/v1";
      type = "application-practice";
      engine() { return "application"; }
      intervals(state, rating) {
          if (rating === Rating.Again)
              return 1;
          if (rating === Rating.Hard)
              return 3;
          const good = [5, 10, 21, 45, 90, 180, 300];
          const easy = [10, 21, 45, 90, 180, 300, 450];
          return (rating === Rating.Good ? good : easy)[Math.min(state.stage, 6)];
      }
  }
  class PerformancePolicy extends IntervalPolicy {
      id = "performance-practice/v1";
      type = "performance-practice";
      engine() { return "performance"; }
      intervals(state, rating) {
          if (rating === Rating.Again)
              return 3;
          if (rating === Rating.Hard)
              return 7;
          const good = [10, 21, 35, 60, 90, 120];
          const easy = [21, 35, 60, 90, 120, 180];
          return (rating === Rating.Good ? good : easy)[Math.min(state.stage, 5)];
      }
  }
  class RelearnPolicy extends IntervalPolicy {
      id = "relearn/v1";
      type = "relearn";
      engine() { return "relearn"; }
      intervals(state, rating) {
          if (rating === Rating.Again)
              return 1;
          if (rating === Rating.Hard)
              return 2;
          if (rating === Rating.Good)
              return state.successStreak >= 1 ? 5 : 3;
          return state.successStreak >= 1 ? 7 : 4;
      }
  }
  class FreshnessPolicy extends IntervalPolicy {
      id = "freshness-review/v1";
      type = "freshness-review";
      engine() { return "freshness"; }
      intervals(_state, rating, obligation) {
          if (rating === Rating.Again)
              return 1;
          if (rating === Rating.Hard)
              return Math.max(3, Math.round(obligation.freshnessDays * 0.35));
          if (rating === Rating.Good)
              return obligation.freshnessDays;
          return Math.max(obligation.freshnessDays, Math.round(obligation.freshnessDays * 1.5));
      }
  }
  class SchedulerPolicyRouter {
      policies = new Map();
      constructor(schedulingPolicy, optimizerProfile = () => null) {
          const all = [
              new FsrsMemoryPolicy(schedulingPolicy, optimizerProfile),
              new MasteryPolicy(),
              new ApplicationPolicy(),
              new PerformancePolicy(),
              new RelearnPolicy(),
              new FreshnessPolicy(),
          ];
          for (const policy of all)
              this.policies.set(policy.type, policy);
      }
      get(type) {
          const policy = this.policies.get(type);
          assert(policy, `No scheduler policy registered for ${type}.`);
          return policy;
      }
  }
  /* ==========================================================================
     INDEXEDDB REPOSITORY — SCHEMA V1
     ========================================================================== */

  const Store = Object.freeze({
      Profiles: "profiles",
      Nodes: "nodes",
      Units: "units",
      StudyEvents: "studyEvents",
      Obligations: "obligations",
      EvidenceEvents: "evidenceEvents",
      Chunks: "chunks",
      DailyPlans: "dailyPlans",
      Settings: "settings",
      Metadata: "metadata",
      ActiveRetrieval: "activeRetrieval",
  });
  function requestResult(request) {
      return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
      });
  }
  function transactionDone(tx) {
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction was aborted."));
          tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
      });
  }
  class IndexedDbRepository {
      db;
      constructor(db) {
          this.db = db;
      }
      static async open() {
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          let upgradeError;
          request.onupgradeneeded = (event) => {
              if (event.oldVersion !== 0) {
                  upgradeError = new Error("Existing Revision Director database schema is unsupported by this build. Existing data was not modified; open it with a compatible build and export a backup before changing schema.");
                  request.transaction?.abort();
                  return;
              }
              const db = request.result;
              const profiles = db.createObjectStore(Store.Profiles, { keyPath: "id" });
              profiles.createIndex("status", "status");
              const nodes = db.createObjectStore(Store.Nodes, { keyPath: "id" });
              nodes.createIndex("profileId", "profileId");
              nodes.createIndex("parentId", "parentId");
              nodes.createIndex("pathLookup", ["profileId", "parentId", "kind", "normalizedName"], { unique: true });
              const units = db.createObjectStore(Store.Units, { keyPath: "id" });
              units.createIndex("profileId", "profileId");
              units.createIndex("topicNodeId", "topicNodeId");
              units.createIndex("status", "status");
              const study = db.createObjectStore(Store.StudyEvents, { keyPath: "id" });
              study.createIndex("profileId", "profileId");
              study.createIndex("occurredAt", "occurredAt");
              const obligations = db.createObjectStore(Store.Obligations, { keyPath: "id" });
              obligations.createIndex("unitId", "unitId");
              obligations.createIndex("dueAt", "dueAt");
              obligations.createIndex("status", "status");
              obligations.createIndex("type", "type");
              const evidence = db.createObjectStore(Store.EvidenceEvents, { keyPath: "id" });
              evidence.createIndex("profileId", "profileId");
              evidence.createIndex("unitId", "unitId");
              evidence.createIndex("obligationId", "obligationId");
              evidence.createIndex("reviewedAt", "reviewedAt");
              const chunks = db.createObjectStore(Store.Chunks, { keyPath: "id" });
              chunks.createIndex("obligationId", "obligationId");
              chunks.createIndex("cycleId", "cycleId");
              chunks.createIndex("status", "status");
              const plans = db.createObjectStore(Store.DailyPlans, { keyPath: "id" });
              plans.createIndex("studyDayKey", "studyDayKey", { unique: true });
              plans.createIndex("updatedAt", "updatedAt");
              db.createObjectStore(Store.Settings, { keyPath: "key" });
              db.createObjectStore(Store.Metadata, { keyPath: "key" });
              db.createObjectStore(Store.ActiveRetrieval, { keyPath: "id" });
          };
          const db = await new Promise((resolve, reject) => {
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => {
                  if (upgradeError)
                      reject(upgradeError);
                  else if (request.error?.name === "VersionError")
                      reject(new Error("Existing Revision Director database schema is newer than this build. Existing data was not modified; open it with a compatible build and export a backup before using an older schema."));
                  else
                      reject(request.error ?? new Error("IndexedDB open failed."));
              };
          });
          db.onversionchange = () => db.close();
          return new IndexedDbRepository(db);
      }
      async get(store, key) {
          const tx = this.db.transaction(store, "readonly");
          const value = await requestResult(tx.objectStore(store).get(key));
          await transactionDone(tx);
          return value;
      }
      async getAll(store) {
          const tx = this.db.transaction(store, "readonly");
          const values = await requestResult(tx.objectStore(store).getAll());
          await transactionDone(tx);
          return values;
      }
      async put(store, value) {
          const tx = this.db.transaction(store, "readwrite");
          tx.objectStore(store).put(value);
          await transactionDone(tx);
      }
      async putMany(store, values) {
          const tx = this.db.transaction(store, "readwrite");
          const target = tx.objectStore(store);
          for (const value of values)
              target.put(value);
          await transactionDone(tx);
      }
      async createUnitWithObligation(unit, obligation) {
          const tx = this.db.transaction([Store.Units, Store.Obligations], "readwrite");
          tx.objectStore(Store.Units).add(unit);
          tx.objectStore(Store.Obligations).add(obligation);
          await transactionDone(tx);
      }
      async updateUnitWithObligations(unit, obligations) {
          const tx = this.db.transaction([Store.Units, Store.Obligations], "readwrite");
          tx.objectStore(Store.Units).put(unit);
          const target = tx.objectStore(Store.Obligations);
          for (const obligation of obligations)
              target.put(obligation);
          await transactionDone(tx);
      }
      async delete(store, key) {
          const tx = this.db.transaction(store, "readwrite");
          tx.objectStore(store).delete(key);
          await transactionDone(tx);
      }
      async findNode(profileId, parentId, kind, name) {
          const candidates = await this.getByIndex(Store.Nodes, "profileId", profileId);
          const normalized = normalizeName(name);
          return candidates.find((node) => node.parentId === parentId && node.kind === kind && node.normalizedName === normalized);
      }
      async getByIndex(store, indexName, query) {
          const tx = this.db.transaction(store, "readonly");
          const result = await requestResult(tx.objectStore(store).index(indexName).getAll(query));
          await transactionDone(tx);
          return result;
      }
      async putObligationWithChunks(obligation, chunks) {
          const tx = this.db.transaction([Store.Obligations, Store.Chunks], "readwrite");
          tx.objectStore(Store.Obligations).put(obligation);
          const target = tx.objectStore(Store.Chunks);
          for (const chunk of chunks)
              target.put(chunk);
          await transactionDone(tx);
      }
      async updateChunkWithObligation(chunk, obligation, dailyPlan, commitGuard, postCommitSession) {
          const stores = [Store.Obligations, Store.Chunks];
          if (dailyPlan)
              stores.push(Store.DailyPlans);
          if (commitGuard)
              stores.push(Store.ActiveRetrieval);
          const tx = this.db.transaction(stores, "readwrite");
          const apply = () => {
              tx.objectStore(Store.Obligations).put(obligation);
              tx.objectStore(Store.Chunks).put(chunk);
              if (dailyPlan)
                  tx.objectStore(Store.DailyPlans).put(dailyPlan);
              if (commitGuard && postCommitSession)
                  tx.objectStore(Store.ActiveRetrieval).put(postCommitSession);
          };
          if (commitGuard) {
              const request = tx.objectStore(Store.ActiveRetrieval).get(commitGuard.sessionId);
              request.onsuccess = () => {
                  const current = request.result;
                  if (!current || current.status !== "committing" || current.revision !== commitGuard.expectedRevision || current.activeTargetId !== commitGuard.targetId || current.commitToken !== commitGuard.commitToken) {
                      tx.abort();
                      return;
                  }
                  apply();
              };
          }
          else
              apply();
          await transactionDone(tx);
      }
      async dailyPlanByStudyDay(studyDayKey) {
          const tx = this.db.transaction(Store.DailyPlans, "readonly");
          const value = await requestResult(tx.objectStore(Store.DailyPlans).index("studyDayKey").get(studyDayKey));
          await transactionDone(tx);
          return value;
      }
      async recordReview(unit, obligation, event, followUp, relatedObligation, chunkUpdates = [], dailyPlan, commitGuard, postCommitSession) {
          const stores = [Store.Units, Store.Obligations, Store.EvidenceEvents, Store.Chunks];
          if (dailyPlan)
              stores.push(Store.DailyPlans);
          if (commitGuard)
              stores.push(Store.ActiveRetrieval);
          const tx = this.db.transaction(stores, "readwrite");
          const apply = () => {
              const obligationStore = tx.objectStore(Store.Obligations);
              tx.objectStore(Store.Units).put(unit);
              obligationStore.put(obligation);
              tx.objectStore(Store.EvidenceEvents).add(event);
              if (followUp)
                  obligationStore.add(followUp);
              if (relatedObligation)
                  obligationStore.put(relatedObligation);
              const chunkStore = tx.objectStore(Store.Chunks);
              for (const chunk of chunkUpdates)
                  chunkStore.put(chunk);
              if (dailyPlan)
                  tx.objectStore(Store.DailyPlans).put(dailyPlan);
              if (commitGuard && postCommitSession)
                  tx.objectStore(Store.ActiveRetrieval).put(postCommitSession);
          };
          if (commitGuard) {
              const request = tx.objectStore(Store.ActiveRetrieval).get(commitGuard.sessionId);
              request.onsuccess = () => {
                  const current = request.result;
                  if (!current || current.status !== "committing" || current.revision !== commitGuard.expectedRevision || current.activeTargetId !== commitGuard.targetId || current.commitToken !== commitGuard.commitToken) {
                      tx.abort();
                      return;
                  }
                  apply();
              };
          }
          else
              apply();
          await transactionDone(tx);
      }
      async replaceSettingsAndObligations(settings, obligations) {
          const tx = this.db.transaction([Store.Settings, Store.Obligations], "readwrite");
          tx.objectStore(Store.Settings).put(settings);
          const obligationStore = tx.objectStore(Store.Obligations);
          for (const obligation of obligations)
              obligationStore.put(obligation);
          await transactionDone(tx);
      }
      async rawDump() {
          const stores = Object.values(Store);
          const dump = {};
          for (const store of stores)
              dump[store] = await this.getAll(store);
          return dump;
      }
      async replaceFromBackup(payload, activeTreatment) {
          const stores = [Store.Profiles, Store.Nodes, Store.Units, Store.StudyEvents, Store.Obligations, Store.EvidenceEvents, Store.Chunks, Store.DailyPlans, Store.Settings, Store.ActiveRetrieval];
          const tx = this.db.transaction(stores, "readwrite");
          for (const store of stores)
              tx.objectStore(store).clear();
          for (const value of payload.profiles)
              tx.objectStore(Store.Profiles).put(value);
          for (const value of payload.nodes)
              tx.objectStore(Store.Nodes).put(value);
          for (const value of payload.units)
              tx.objectStore(Store.Units).put(value);
          for (const value of payload.studyEvents)
              tx.objectStore(Store.StudyEvents).put(value);
          for (const value of payload.obligations)
              tx.objectStore(Store.Obligations).put(value);
          for (const value of payload.evidenceEvents)
              tx.objectStore(Store.EvidenceEvents).put(value);
          for (const value of payload.chunks)
              tx.objectStore(Store.Chunks).put(value);
          for (const value of payload.dailyPlans)
              tx.objectStore(Store.DailyPlans).put(value);
          tx.objectStore(Store.Settings).put(payload.settings);
          if (activeTreatment === "restore" && payload.activeRetrieval)
              tx.objectStore(Store.ActiveRetrieval).put(payload.activeRetrieval);
          await transactionDone(tx);
      }
  }
  /* ==========================================================================
     APPLICATION SERVICES
     ========================================================================== */

  function safeLocalStorageGet(key) {
      try {
          return window.localStorage.getItem(key);
      }
      catch {
          return null;
      }
  }
  function safeLocalStorageSet(key, value) {
      try {
          window.localStorage.setItem(key, value);
          return true;
      }
      catch {
          return false;
      }
  }
  function safeLocalStorageRemove(key) {
      try {
          window.localStorage.removeItem(key);
          return true;
      }
      catch {
          return false;
      }
  }
  class AppDiagnostics {
      records;
      constructor() {
          this.records = this.read();
      }
      list() {
          return clone(this.records).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
      }
      record(code, operation, error) {
          const message = error instanceof Error ? error.message : String(error);
          const now = nowIso();
          const existing = this.records.find((entry) => entry.code === code && entry.operation === operation && entry.message === message);
          if (existing) {
              existing.lastAt = now;
              existing.count += 1;
          }
          else {
              this.records.push({ id: uid("diag"), code, message: message.slice(0, 1_000), operation, firstAt: now, lastAt: now, count: 1 });
          }
          this.records.sort((a, b) => a.lastAt.localeCompare(b.lastAt));
          while (this.records.length > 50)
              this.records.shift();
          while (JSON.stringify(this.records).length > 32_000 && this.records.length > 1)
              this.records.shift();
          safeLocalStorageSet(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(this.records));
      }
      read() {
          const raw = safeLocalStorageGet(DIAGNOSTICS_STORAGE_KEY);
          if (!raw)
              return [];
          try {
              const parsed = JSON.parse(raw);
              if (!Array.isArray(parsed))
                  return [];
              return parsed.filter((entry) => {
                  if (!isRecord(entry))
                      return false;
                  const count = entry["count"];
                  return typeof entry["id"] === "string"
                      && typeof entry["code"] === "string"
                      && typeof entry["message"] === "string"
                      && typeof entry["operation"] === "string"
                      && typeof entry["firstAt"] === "string"
                      && typeof entry["lastAt"] === "string"
                      && typeof count === "number"
                      && Number.isInteger(count)
                      && count >= 1;
              }).slice(-50);
          }
          catch {
              return [];
          }
      }
  }
  function documentKindForStore(store) {
      if (store === Store.Profiles)
          return "profile";
      if (store === Store.Nodes)
          return "node";
      if (store === Store.Units)
          return "unit";
      if (store === Store.StudyEvents)
          return "study-event";
      if (store === Store.Obligations)
          return "obligation";
      if (store === Store.EvidenceEvents)
          return "evidence-event";
      if (store === Store.Chunks)
          return "chunk";
      if (store === Store.DailyPlans)
          return "daily-plan";
      if (store === Store.Settings)
          return "settings";
      if (store === Store.ActiveRetrieval)
          return "active-retrieval";
      return "metadata";
  }
  class RevisionData {
      repository;
      diagnosticsJournal;
      health;
      constructor(repository, diagnosticsJournal) {
          this.repository = repository;
          this.diagnosticsJournal = diagnosticsJournal;
          this.health = {
              checkedAt: nowIso(),
              level: "healthy",
              indexedDbAvailable: true,
              persistence: "unsupported",
              diagnosticCount: diagnosticsJournal.list().length,
          };
      }
      static async open() {
          const diagnostics = new AppDiagnostics();
          let repository;
          try {
              repository = await IndexedDbRepository.open();
          }
          catch (error) {
              diagnostics.record("storage.indexeddb.open", "open database", error);
              throw error;
          }
          const data = new RevisionData(repository, diagnostics);
          await data.ensureMetadata();
          await data.refreshStorageHealth(false);
          return data;
      }
      storageHealth() {
          return clone(this.health);
      }
      diagnostics() {
          return this.diagnosticsJournal.list();
      }
      recordDiagnostic(code, operation, error) {
          this.diagnosticsJournal.record(code, operation, error);
          this.health = { ...this.health, checkedAt: nowIso(), level: this.health.level === "critical" ? "critical" : "warning", diagnosticCount: this.diagnosticsJournal.list().length, lastError: error instanceof Error ? error.message : String(error) };
      }
      async refreshStorageHealth(requestPersistence = false) {
          const storage = navigator.storage;
          let persistence = "unsupported";
          let usageBytes;
          let quotaBytes;
          let lastError;
          if (storage) {
              try {
                  if (typeof storage.persisted === "function") {
                      const alreadyPersisted = await storage.persisted();
                      if (alreadyPersisted)
                          persistence = "granted";
                      else if (requestPersistence && typeof storage.persist === "function")
                          persistence = (await storage.persist()) ? "granted" : "denied";
                      else
                          persistence = typeof storage.persist === "function" ? "available" : "unsupported";
                  }
                  if (typeof storage.estimate === "function") {
                      const estimate = await storage.estimate();
                      usageBytes = estimate.usage;
                      quotaBytes = estimate.quota;
                  }
              }
              catch (error) {
                  lastError = error instanceof Error ? error.message : String(error);
                  this.diagnosticsJournal.record("storage.health.inspect", "inspect browser storage", error);
              }
          }
          const usageRatio = usageBytes !== undefined && quotaBytes ? usageBytes / quotaBytes : undefined;
          const diagnosticCount = this.diagnosticsJournal.list().length;
          const level = usageRatio !== undefined && usageRatio >= 0.9
              ? "critical"
              : usageRatio !== undefined && usageRatio >= 0.75 || persistence === "denied" || Boolean(lastError) || diagnosticCount > 0
                  ? "warning"
                  : "healthy";
          this.health = {
              checkedAt: nowIso(),
              level,
              indexedDbAvailable: true,
              persistence,
              ...(usageBytes !== undefined ? { usageBytes } : {}),
              ...(quotaBytes !== undefined ? { quotaBytes } : {}),
              ...(usageRatio !== undefined ? { usageRatio } : {}),
              diagnosticCount,
              ...(lastError ? { lastError } : {}),
          };
          return this.storageHealth();
      }
      async ensureMetadata() {
          const existing = await this.repository.get(Store.Metadata, "database");
          if (existing) {
              const canonical = canonicalAppMetadata(existing);
              assert(canonical.databaseName === DB_NAME && canonical.databaseVersion === DB_VERSION, "Database metadata does not match this production database.");
              if (canonical.applicationVersion !== APP_VERSION) {
                  try {
                      await this.repository.put(Store.Metadata, canonicalAppMetadata({
                          ...canonical,
                          applicationVersion: APP_VERSION,
                          updatedAt: nowIso(),
                      }));
                  }
                  catch (error) {
                      this.diagnosticsJournal.record("storage.metadata.release-refresh", "refresh database release provenance", error);
                  }
              }
              return;
          }
          const time = nowIso();
          const metadata = {
              schemaVersion: DOCUMENT_SCHEMA_VERSION,
              key: "database",
              databaseName: DB_NAME,
              databaseVersion: DB_VERSION,
              applicationVersion: APP_VERSION,
              createdAt: time,
              updatedAt: time,
          };
          await this.repository.put(Store.Metadata, canonicalAppMetadata(metadata));
      }
      async operation(name, action) {
          try {
              return await action();
          }
          catch (error) {
              this.diagnosticsJournal.record(`storage.${name}`, name, error);
              this.health = { ...this.health, checkedAt: nowIso(), level: this.health.level === "critical" ? "critical" : "warning", diagnosticCount: this.diagnosticsJournal.list().length, lastError: error instanceof Error ? error.message : String(error) };
              throw error;
          }
      }
      normalize(store, value) {
          return canonicalDocument(documentKindForStore(store), value);
      }
      async get(store, key) {
          return this.operation(`get.${store}`, async () => {
              const value = await this.repository.get(store, key);
              return value === undefined ? undefined : this.normalize(store, value);
          });
      }
      async getAll(store) {
          return this.operation(`getAll.${store}`, async () => (await this.repository.getAll(store)).map((value) => this.normalize(store, value)));
      }
      async put(store, value) {
          await this.operation(`put.${store}`, () => this.repository.put(store, this.normalize(store, value)));
      }
      async putMany(store, values) {
          await this.operation(`putMany.${store}`, () => this.repository.putMany(store, values.map((value) => this.normalize(store, value))));
      }
      async createUnitWithObligation(unit, obligation) {
          await this.operation("createUnitWithObligation", () => this.repository.createUnitWithObligation(canonicalKnowledgeUnit(unit), canonicalRevisionObligation(obligation)));
      }
      async updateUnitWithObligations(unit, obligations) {
          await this.operation("updateUnitWithObligations", () => this.repository.updateUnitWithObligations(canonicalKnowledgeUnit(unit), obligations.map(canonicalRevisionObligation)));
      }
      async delete(store, key) {
          await this.operation(`delete.${store}`, () => this.repository.delete(store, key));
      }
      async findNode(profileId, parentId, kind, name) {
          const candidates = await this.getByIndex(Store.Nodes, "profileId", profileId);
          const normalized = normalizeName(name);
          return candidates.find((node) => node.parentId === parentId && node.kind === kind && node.normalizedName === normalized);
      }
      async getByIndex(store, indexName, query) {
          return this.operation(`index.${store}.${indexName}`, async () => (await this.repository.getByIndex(store, indexName, query)).map((value) => this.normalize(store, value)));
      }
      async putObligationWithChunks(obligation, chunks) {
          await this.operation("putObligationWithChunks", () => this.repository.putObligationWithChunks(canonicalRevisionObligation(obligation), chunks.map(canonicalObligationChunk)));
      }
      async updateChunkWithObligation(chunk, obligation, dailyPlan, commitGuard, postCommitSession) {
          await this.operation("updateChunkWithObligation", () => this.repository.updateChunkWithObligation(canonicalObligationChunk(chunk), canonicalRevisionObligation(obligation), dailyPlan ? canonicalDailyPlanRecord(dailyPlan) : undefined, commitGuard, postCommitSession ? canonicalActiveRetrievalSession(postCommitSession) : undefined));
      }
      async dailyPlanByStudyDay(studyDayKey) {
          return this.operation("dailyPlanByStudyDay", async () => {
              const value = await this.repository.dailyPlanByStudyDay(studyDayKey);
              return value ? canonicalDailyPlanRecord(value) : undefined;
          });
      }
      async recordReview(unit, obligation, event, followUp, relatedObligation, chunkUpdates = [], dailyPlan, commitGuard, postCommitSession) {
          await this.operation("recordReview", () => this.repository.recordReview(canonicalKnowledgeUnit(unit), canonicalRevisionObligation(obligation), canonicalEvidenceEvent(event), followUp ? canonicalRevisionObligation(followUp) : undefined, relatedObligation ? canonicalRevisionObligation(relatedObligation) : undefined, chunkUpdates.map(canonicalObligationChunk), dailyPlan ? canonicalDailyPlanRecord(dailyPlan) : undefined, commitGuard, postCommitSession ? canonicalActiveRetrievalSession(postCommitSession) : undefined));
      }
      async replaceSettingsAndObligations(settings, obligations) {
          await this.operation("replaceSettingsAndObligations", () => this.repository.replaceSettingsAndObligations(canonicalAppSettings(settings), obligations.map(canonicalRevisionObligation)));
      }
      async rawDump() {
          return this.operation("rawDump", () => this.repository.rawDump());
      }
      async replaceFromBackup(payload, activeTreatment) {
          const canonical = {
              ...payload,
              profiles: payload.profiles.map(canonicalExamProfile),
              nodes: payload.nodes.map(canonicalKnowledgeNode),
              units: payload.units.map(canonicalKnowledgeUnit),
              studyEvents: payload.studyEvents.map(canonicalStudyEvent),
              obligations: payload.obligations.map(canonicalRevisionObligation),
              evidenceEvents: payload.evidenceEvents.map(canonicalEvidenceEvent),
              chunks: payload.chunks.map(canonicalObligationChunk),
              dailyPlans: payload.dailyPlans.map(canonicalDailyPlanRecord),
              settings: canonicalAppSettings(payload.settings),
              activeRetrieval: payload.activeRetrieval ? canonicalActiveRetrievalSession(payload.activeRetrieval) : null,
          };
          await this.operation("replaceFromBackup", () => this.repository.replaceFromBackup(canonical, activeTreatment));
      }
  }

  function newerActiveRetrieval(a, b) {
      if (!a)
          return b;
      if (!b)
          return a;
      if (a.revision !== b.revision)
          return a.revision > b.revision ? a : b;
      return Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b;
  }
  function evenlySampleDiagramPoints(points, maximum) {
      if (maximum <= 0)
          return [];
      if (points.length <= maximum)
          return clone(points);
      if (maximum === 1)
          return [clone(points[0])];
      const sampled = [];
      for (let index = 0; index < maximum; index += 1) {
          const sourceIndex = Math.round(index * (points.length - 1) / (maximum - 1));
          sampled.push(clone(points[sourceIndex]));
      }
      return sampled;
  }
  function compactActiveRetrievalSession(session) {
      const canonical = canonicalActiveRetrievalSession(session);
      let remainingText = ACTIVE_RETRIEVAL_RECOVERY_TEXT_CHARS;
      const values = {};
      for (const [key, value] of Object.entries(canonical.draft.values)) {
          if (remainingText <= 0)
              break;
          const retained = value.slice(0, remainingText);
          values[key] = retained;
          remainingText -= retained.length;
      }
      let remainingPoints = ACTIVE_RETRIEVAL_RECOVERY_POINTS;
      const nonEmptyStrokes = canonical.draft.diagramStrokes.filter((stroke) => stroke.length > 0);
      const diagramStrokes = [];
      for (let index = 0; index < nonEmptyStrokes.length && remainingPoints > 0; index += 1) {
          const stroke = nonEmptyStrokes[index];
          const strokesRemaining = nonEmptyStrokes.length - index;
          const fairShare = Math.max(1, Math.floor(remainingPoints / strokesRemaining));
          const retained = evenlySampleDiagramPoints(stroke, Math.min(stroke.length, fairShare));
          diagramStrokes.push(retained);
          remainingPoints -= retained.length;
      }
      return canonicalActiveRetrievalSession({
          ...canonical,
          draft: { ...canonical.draft, values, diagramStrokes },
      });
  }
  class ActiveRetrievalPersistence {
      data;
      writeChain = Promise.resolve();
      debounceHandle = 0;
      pending;
      constructor(data) {
          this.data = data;
      }
      readLocal() {
          const raw = safeLocalStorageGet(ACTIVE_RETRIEVAL_RECOVERY_KEY);
          if (!raw)
              return undefined;
          try {
              const parsed = JSON.parse(raw);
              return canonicalActiveRetrievalEnvelope(parsed).session;
          }
          catch (error) {
              this.data.recordDiagnostic("active-retrieval.local.invalid", "read emergency recovery", error);
              safeLocalStorageRemove(ACTIVE_RETRIEVAL_RECOVERY_KEY);
              return undefined;
          }
      }
      writeLocal(session) {
          try {
              const canonical = compactActiveRetrievalSession(session);
              const envelope = {
                  format: ACTIVE_RETRIEVAL_RECOVERY_FORMAT,
                  schemaVersion: 1,
                  savedAt: nowIso(),
                  session: canonical,
              };
              const encoded = JSON.stringify(envelope);
              assert(encoded.length <= ACTIVE_RETRIEVAL_RECOVERY_MAX_CHARS, "Active retrieval emergency snapshot is too large.");
              const saved = safeLocalStorageSet(ACTIVE_RETRIEVAL_RECOVERY_KEY, encoded);
              if (!saved)
                  this.data.recordDiagnostic("active-retrieval.local.write", "write emergency recovery", new Error("localStorage write failed"));
              return saved;
          }
          catch (error) {
              this.data.recordDiagnostic("active-retrieval.local.write", "write emergency recovery", error);
              return false;
          }
      }
      schedule(session) {
          this.pending = canonicalActiveRetrievalSession(session);
          if (this.debounceHandle)
              window.clearTimeout(this.debounceHandle);
          this.debounceHandle = window.setTimeout(() => {
              this.debounceHandle = 0;
              void this.flush();
          }, ACTIVE_RETRIEVAL_DEBOUNCE_MS);
      }
      forceEmergency(session) {
          const canonical = canonicalActiveRetrievalSession(session);
          this.pending = canonical;
          this.writeLocal(canonical);
      }
      async flush(session) {
          if (this.debounceHandle)
              window.clearTimeout(this.debounceHandle);
          this.debounceHandle = 0;
          const candidate = session ? canonicalActiveRetrievalSession(session) : this.pending;
          if (!candidate)
              return this.writeChain;
          this.pending = undefined;
          this.writeLocal(candidate);
          this.writeChain = this.writeChain
              .catch((error) => this.data.recordDiagnostic("active-retrieval.previous-write", "serialised active retrieval write", error))
              .then(() => this.data.put(Store.ActiveRetrieval, candidate))
              .catch((error) => {
              this.data.recordDiagnostic("active-retrieval.indexeddb.write", "write active retrieval", error);
              throw error;
          });
          return this.writeChain;
      }
      async load() {
          const local = this.readLocal();
          let indexed;
          try {
              indexed = await this.data.get(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID);
          }
          catch (error) {
              this.data.recordDiagnostic("active-retrieval.indexeddb.read", "read active retrieval", error);
          }
          const winner = newerActiveRetrieval(indexed, local);
          if (!winner)
              return { localPresent: Boolean(local), indexedDbPresent: Boolean(indexed) };
          if (winner.status === "completed") {
              await this.clear();
              return { localPresent: Boolean(local), indexedDbPresent: Boolean(indexed) };
          }
          if (winner === local && (!indexed || newerActiveRetrieval(indexed, local) === local)) {
              try {
                  await this.data.put(Store.ActiveRetrieval, winner);
              }
              catch (error) {
                  this.data.recordDiagnostic("active-retrieval.reconcile.indexeddb", "reconcile recovery into IndexedDB", error);
              }
          }
          if (winner === indexed && (!local || newerActiveRetrieval(local, indexed) === indexed))
              this.writeLocal(winner);
          return { session: clone(winner), localPresent: Boolean(local), indexedDbPresent: Boolean(indexed) };
      }
      async acceptCommittedTransition(session) {
          const canonical = canonicalActiveRetrievalSession(session);
          this.pending = undefined;
          if (this.debounceHandle)
              window.clearTimeout(this.debounceHandle);
          this.debounceHandle = 0;
          if (canonical.status === "completed") {
              safeLocalStorageRemove(ACTIVE_RETRIEVAL_RECOVERY_KEY);
              this.writeChain = this.writeChain
                  .catch((error) => this.data.recordDiagnostic("active-retrieval.previous-clear", "serialised active retrieval clear", error))
                  .then(() => this.data.delete(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID));
              await this.writeChain;
          }
          else {
              this.writeLocal(canonical);
          }
      }
      resetEmergencyAfterRestore(session) {
          if (this.debounceHandle)
              window.clearTimeout(this.debounceHandle);
          this.debounceHandle = 0;
          this.pending = undefined;
          safeLocalStorageRemove(ACTIVE_RETRIEVAL_RECOVERY_KEY);
          if (session)
              this.writeLocal(canonicalActiveRetrievalSession(session));
      }
      async clear() {
          if (this.debounceHandle)
              window.clearTimeout(this.debounceHandle);
          this.debounceHandle = 0;
          this.pending = undefined;
          safeLocalStorageRemove(ACTIVE_RETRIEVAL_RECOVERY_KEY);
          this.writeChain = this.writeChain
              .catch((error) => this.data.recordDiagnostic("active-retrieval.previous-clear", "serialised active retrieval clear", error))
              .then(() => this.data.delete(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID))
              .catch((error) => {
              this.data.recordDiagnostic("active-retrieval.indexeddb.clear", "clear active retrieval", error);
              throw error;
          });
          return this.writeChain;
      }
  }

  function emptyPhaseTotals() {
      return { attempt: 0, compare: 0, "relearn-repair": 0, "relearn-verify": 0 };
  }
  function phaseTimeSnapshot(phase, sourceVisible = false, now = Date.now()) {
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
  function timingEvidenceSummary(snapshot, now = Date.now()) {
      const canonical = canonicalPhaseTimeRuntimeSnapshot(snapshot);
      const activeByPhase = clone(canonical.activeByPhase);
      const gapHistory = canonical.gapHistory;
      const pauseMs = canonical.pauseHistory.reduce((sum, pause) => sum + pause.durationMs, 0) +
          (canonical.state === "paused" && canonical.pauseStartedAt ? Math.max(0, now - Date.parse(canonical.pauseStartedAt)) : 0);
      const ignoredGapMs = gapHistory.reduce((sum, gap) => sum + gap.ignoredMs, 0);
      const reliabilityFlags = [];
      if (ignoredGapMs > 0)
          reliabilityFlags.push("ignored-gap");
      if (canonical.backwardClockCount > 0)
          reliabilityFlags.push("backward-clock");
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
      state;
      constructor(snapshot) {
          this.state = canonicalPhaseTimeRuntimeSnapshot(snapshot);
      }
      static create(phase, sourceVisible = false, now = Date.now()) {
          return new PhaseTimeRuntime(phaseTimeSnapshot(phase, sourceVisible, now));
      }
      snapshot() {
          return clone(this.state);
      }
      summary(now = Date.now()) {
          return timingEvidenceSummary(this.state, now);
      }
      activeMs() {
          return Object.values(this.state.activeByPhase).reduce((sum, value) => sum + value, 0);
      }
      phaseActiveMs(phase) {
          return this.state.activeByPhase[phase];
      }
      currentPhase() { return this.state.currentPhase; }
      status() { return this.state.state; }
      isPaused() { return this.state.state === "paused"; }
      hasPendingGap() { return Boolean(this.state.pendingGap); }
      pendingGap() { return this.state.pendingGap ? clone(this.state.pendingGap) : undefined; }
      trimHistory() {
          if (this.state.pauseHistory.length > TIME_HISTORY_LIMIT)
              this.state.pauseHistory.splice(0, this.state.pauseHistory.length - TIME_HISTORY_LIMIT);
          if (this.state.phaseHistory.length > TIME_HISTORY_LIMIT)
              this.state.phaseHistory.splice(0, this.state.phaseHistory.length - TIME_HISTORY_LIMIT);
          if (this.state.gapHistory.length > TIME_HISTORY_LIMIT)
              this.state.gapHistory.splice(0, this.state.gapHistory.length - TIME_HISTORY_LIMIT);
      }
      rebaseBackwardClock(now, last) {
          const delta = now - last;
          if (this.state.pauseStartedAt)
              this.state.pauseStartedAt = new Date(Date.parse(this.state.pauseStartedAt) + delta).toISOString();
          if (this.state.pendingGap) {
              this.state.pendingGap.lastReliableAt = new Date(Date.parse(this.state.pendingGap.lastReliableAt) + delta).toISOString();
              this.state.pendingGap.detectedAt = new Date(Date.parse(this.state.pendingGap.detectedAt) + delta).toISOString();
          }
          this.state.backwardClockCount += 1;
          this.state.lastTickAt = new Date(now).toISOString();
      }
      reconcile(now = Date.now(), source = "tick") {
          const last = Date.parse(this.state.lastTickAt);
          if (!Number.isFinite(last)) {
              this.state.lastTickAt = new Date(now).toISOString();
              return { gapOpened: false, backwardClock: false };
          }
          if (now < last) {
              this.rebaseBackwardClock(now, last);
              return { gapOpened: false, backwardClock: true };
          }
          if (this.state.state === "gap-pending")
              return { gapOpened: false, backwardClock: false };
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
      pause(now = Date.now()) {
          this.reconcile(now, "snapshot");
          assert(!this.state.pendingGap, "Classify the inactive gap before pausing.");
          if (this.state.state === "paused")
              return;
          this.state.state = "paused";
          this.state.pauseStartedAt = new Date(now).toISOString();
          this.state.lastTickAt = new Date(now).toISOString();
      }
      resume(now = Date.now()) {
          assert(!this.state.pendingGap, "Classify the inactive gap before resuming.");
          if (this.state.state !== "paused")
              return;
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
      transition(to, reason, sourceVisible, now = Date.now()) {
          this.reconcile(now, "snapshot");
          assert(this.state.state === "running" && !this.state.pendingGap, "Resume and classify interruptions before changing phase.");
          const from = this.state.currentPhase;
          if (from === to && this.state.sourceVisible === sourceVisible)
              return;
          if (!this.state.sourceVisible && sourceVisible && !this.state.sourceRevealAt)
              this.state.sourceRevealAt = new Date(now).toISOString();
          this.state.phaseHistory.push({ from, to, at: new Date(now).toISOString(), sourceVisible, reason });
          this.state.currentPhase = to;
          this.state.sourceVisible = sourceVisible;
          this.state.lastTickAt = new Date(now).toISOString();
          this.trimHistory();
      }
      resolveGap(classification, focusMs = 0, now = Date.now()) {
          const pending = this.state.pendingGap;
          assert(pending, "There is no inactive gap to classify.");
          const gapMs = Math.max(0, pending.gapMs);
          let focusPart = 0;
          let breakPart = 0;
          let ignoredPart = 0;
          if (classification === "focus")
              focusPart = gapMs;
          else if (classification === "break")
              breakPart = gapMs;
          else if (classification === "split") {
              focusPart = Math.min(gapMs, Math.max(0, Math.round(focusMs)));
              breakPart = Math.max(0, gapMs - focusPart);
          }
          else
              ignoredPart = gapMs;
          if (focusPart > 0)
              this.state.activeByPhase[pending.phase] += focusPart;
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
          const record = {
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

  class ReviewOwnershipCoordinator {
      data;
      tabId = uid("tab");
      state = "secondary";
      revision = 0;
      claimId = "";
      lastError = "";
      callbacks;
      heartbeatHandle = 0;
      channel;
      started = false;
      takeoverPending;
      constructor(data) {
          this.data = data;
      }
      snapshot() {
          const lease = this.readLease();
          return {
              state: this.state,
              tabId: this.tabId,
              canMutate: this.canMutate(),
              revision: this.revision,
              ...(lease?.tabId ? { ownerTabId: lease.tabId, ownerExpiresAt: lease.expiresAt } : {}),
              ...(this.lastError ? { lastError: this.lastError } : {}),
          };
      }
      canMutate() {
          const lease = this.readLease();
          return Boolean(this.state === "primary" && lease && lease.tabId === this.tabId && lease.claimId === this.claimId && lease.expiresAt > Date.now());
      }
      async start(callbacks) {
          if (this.started)
              return;
          this.started = true;
          this.callbacks = callbacks;
          this.installChannel();
          window.addEventListener("storage", (event) => {
              if (event.key === REVIEW_OWNER_STORAGE_KEY && !this.takeoverPending)
                  void this.evaluate("reacquire");
          });
          this.heartbeatHandle = window.setInterval(() => {
              if (this.takeoverPending)
                  return;
              if (this.state === "primary" || this.state === "hydrating")
                  this.renew();
              else
                  void this.evaluate("reacquire");
          }, REVIEW_OWNER_HEARTBEAT_MS);
          await this.evaluate("startup");
      }
      async takeControl() {
          const lease = this.readLease();
          if (this.otherOwnerActive(lease)) {
              const requestId = uid("takeover");
              const ready = new Promise((resolve) => {
                  let settled = false;
                  const finish = (value) => { if (settled)
                      return; settled = true; resolve(value); };
                  const timer = window.setTimeout(() => finish(false), REVIEW_OWNER_TAKEOVER_WAIT_MS);
                  this.takeoverPending = { requestId, resolve: (value) => { window.clearTimeout(timer); finish(value); } };
              });
              this.post({ type: "takeover-request", tabId: this.tabId, requestId });
              const released = await ready;
              this.takeoverPending = undefined;
              if (!released && this.otherOwnerActive())
                  return false;
          }
          this.takeoverPending = undefined;
          return this.acquire("takeover", false);
      }
      async evaluate(reason = "reacquire") {
          if (this.takeoverPending || this.state === "acquiring" || this.state === "hydrating" || this.state === "releasing")
              return false;
          const lease = this.readLease();
          if (this.otherOwnerActive(lease)) {
              this.claimId = "";
              this.transition("secondary");
              return false;
          }
          if (lease && lease.tabId !== this.tabId && lease.expiresAt <= Date.now())
              safeLocalStorageRemove(REVIEW_OWNER_STORAGE_KEY);
          if (lease?.tabId === this.tabId && lease.expiresAt > Date.now()) {
              this.claimId = lease.claimId;
              if (this.state !== "primary")
                  return this.acquire(reason, true);
              this.renew();
              return true;
          }
          return this.acquire(reason, false);
      }
      noteVisibilityHidden() {
          if (this.state === "primary" || this.state === "hydrating")
              this.renew();
      }
      async releaseForExit() {
          if (this.state !== "primary" && this.state !== "hydrating")
              return;
          this.transition("releasing");
          this.releaseLease();
          this.transition("secondary");
      }
      dispose() {
          if (this.heartbeatHandle)
              window.clearInterval(this.heartbeatHandle);
          this.heartbeatHandle = 0;
          try {
              this.channel?.close();
          }
          catch { /* non-fatal */ }
          this.channel = undefined;
          this.releaseLease();
          this.transition("secondary");
      }
      transition(next, error = "") {
          if (this.state !== next)
              this.revision += 1;
          this.state = next;
          this.lastError = error;
          document.documentElement.dataset["reviewOwnership"] = next;
          this.callbacks?.changed(this.snapshot());
      }
      readLease() {
          const raw = safeLocalStorageGet(REVIEW_OWNER_STORAGE_KEY);
          if (!raw)
              return undefined;
          try {
              const parsed = JSON.parse(raw);
              if (!isRecord(parsed))
                  return undefined;
              if (parsed["version"] !== 1 || typeof parsed["tabId"] !== "string" || typeof parsed["claimId"] !== "string" || !Number.isFinite(parsed["expiresAt"]) || typeof parsed["updatedAt"] !== "string")
                  return undefined;
              return { version: 1, tabId: parsed["tabId"], claimId: parsed["claimId"], expiresAt: Number(parsed["expiresAt"]), updatedAt: parsed["updatedAt"] };
          }
          catch {
              return undefined;
          }
      }
      otherOwnerActive(lease = this.readLease(), now = Date.now()) {
          return Boolean(lease && lease.tabId !== this.tabId && lease.expiresAt > now);
      }
      writeLease(claimId) {
          const now = Date.now();
          const lease = { version: 1, tabId: this.tabId, claimId, expiresAt: now + REVIEW_OWNER_STALE_MS, updatedAt: new Date(now).toISOString() };
          if (!safeLocalStorageSet(REVIEW_OWNER_STORAGE_KEY, JSON.stringify(lease)))
              return false;
          const verified = this.readLease();
          return Boolean(verified && verified.tabId === this.tabId && verified.claimId === claimId && verified.expiresAt > now);
      }
      async acquire(reason, force) {
          const existing = this.readLease();
          if (!force && this.otherOwnerActive(existing)) {
              this.transition("secondary");
              return false;
          }
          this.transition("acquiring");
          const claimId = uid("claim");
          if (!this.writeLease(claimId)) {
              const error = new Error("Review ownership lease could not be stored and verified.");
              this.data.recordDiagnostic("ownership.lease-write", "acquire review ownership", error);
              this.claimId = "";
              this.transition("faulted", error.message);
              return false;
          }
          this.claimId = claimId;
          this.transition("hydrating");
          try {
              await this.callbacks?.hydrate(reason);
              const verified = this.readLease();
              if (!verified || verified.tabId !== this.tabId || verified.claimId !== this.claimId || verified.expiresAt <= Date.now())
                  throw new Error("Review ownership changed during canonical hydration.");
              this.transition("primary");
              this.post({ type: "heartbeat", tabId: this.tabId, expiresAt: verified.expiresAt });
              return true;
          }
          catch (error) {
              this.data.recordDiagnostic("ownership.hydrate", "hydrate canonical review state", error);
              this.releaseLease();
              this.claimId = "";
              this.transition("faulted", error instanceof Error ? error.message : String(error));
              return false;
          }
      }
      renew() {
          if (!this.claimId || (this.state !== "primary" && this.state !== "hydrating"))
              return;
          if (!this.writeLease(this.claimId)) {
              const error = new Error("Review ownership heartbeat could not be verified.");
              this.data.recordDiagnostic("ownership.heartbeat", "renew review ownership", error);
              this.claimId = "";
              this.transition("faulted", error.message);
              return;
          }
          const lease = this.readLease();
          if (lease)
              this.post({ type: "heartbeat", tabId: this.tabId, expiresAt: lease.expiresAt });
      }
      releaseLease() {
          const lease = this.readLease();
          if (lease?.tabId === this.tabId) {
              safeLocalStorageRemove(REVIEW_OWNER_STORAGE_KEY);
              this.post({ type: "release", tabId: this.tabId });
          }
          this.claimId = "";
      }
      async releaseForTakeover(requestId) {
          if (this.state !== "primary")
              return;
          this.transition("releasing");
          try {
              await this.callbacks?.flush();
          }
          catch (error) {
              this.data.recordDiagnostic("ownership.release-flush", "flush before ownership handoff", error);
              this.transition("primary", error instanceof Error ? error.message : String(error));
              return;
          }
          this.releaseLease();
          this.transition("secondary");
          this.post({ type: "takeover-ready", tabId: this.tabId, requestId });
      }
      post(message) {
          try {
              this.channel?.postMessage(message);
          }
          catch (error) {
              this.data.recordDiagnostic("ownership.channel-post", "post ownership message", error);
          }
      }
      installChannel() {
          if (!("BroadcastChannel" in window))
              return;
          try {
              this.channel = new BroadcastChannel(REVIEW_OWNER_CHANNEL);
              this.channel.onmessage = (event) => {
                  if (!isRecord(event.data))
                      return;
                  const type = literalChoiceOrUndefined(event.data["type"], ["heartbeat", "release", "takeover-request", "takeover-ready"]);
                  const tabId = event.data["tabId"];
                  if (!type || typeof tabId !== "string" || tabId === this.tabId)
                      return;
                  const requestId = event.data["requestId"];
                  const expiresAt = event.data["expiresAt"];
                  if (requestId !== undefined && typeof requestId !== "string")
                      return;
                  if (expiresAt !== undefined && !Number.isFinite(expiresAt))
                      return;
                  const message = {
                      type,
                      tabId,
                      ...(requestId !== undefined ? { requestId } : {}),
                      ...(expiresAt !== undefined ? { expiresAt: Number(expiresAt) } : {}),
                  };
                  if (message.type === "takeover-request" && message.requestId) {
                      void this.releaseForTakeover(message.requestId);
                      return;
                  }
                  if (message.type === "takeover-ready" && message.requestId && this.takeoverPending?.requestId === message.requestId) {
                      this.takeoverPending.resolve(true);
                      return;
                  }
                  if (message.type === "heartbeat" && Number(message.expiresAt) > Date.now()) {
                      const lease = this.readLease();
                      if (lease && lease.tabId === message.tabId && lease.expiresAt > Date.now() && this.state !== "releasing")
                          this.transition("secondary");
                      return;
                  }
                  if (message.type === "release" && !this.takeoverPending)
                      void this.evaluate("reacquire");
              };
          }
          catch (error) {
              this.data.recordDiagnostic("ownership.channel-install", "install ownership channel", error);
          }
      }
  }

  class RevisionService {
      repo;
      settings = defaultSettings();
      router;
      memoryReviewAnalysis;
      constructor(repo) {
          this.repo = repo;
          this.router = new SchedulerPolicyRouter(() => this.settings.fsrsScheduling.policy, () => activeFsrsOptimizerProfile(this.settings));
      }
      evidenceAnalysisKey(evidenceEvents) {
          if (evidenceEvents.length === 0)
              return "0";
          const newest = evidenceEvents[0];
          const oldest = evidenceEvents.at(-1);
          return [evidenceEvents.length, newest.id, newest.reviewedAt, oldest.id, oldest.reviewedAt].join("|");
      }
      memoryReviewIndexFor(evidenceEvents) {
          const evidenceKey = this.evidenceAnalysisKey(evidenceEvents);
          if (this.memoryReviewAnalysis?.evidenceKey === evidenceKey)
              return this.memoryReviewAnalysis.reviewIndex;
          const reviewIndex = memoryReviewObservationIndex(evidenceEvents);
          this.memoryReviewAnalysis = { evidenceKey, reviewIndex };
          return reviewIndex;
      }
      invalidateMemoryReviewAnalysis() {
          this.memoryReviewAnalysis = undefined;
      }
      async initialize() {
          this.invalidateMemoryReviewAnalysis();
          const stored = await this.repo.get(Store.Settings, "app");
          this.settings = stored ? canonicalAppSettings(stored) : defaultSettings();
          await prepareFsrsScheduler(this.settings.fsrsScheduling.policy, activeFsrsOptimizerProfile(this.settings));
          if (!stored)
              await this.repo.put(Store.Settings, this.settings);
          const profiles = await this.profiles();
          const active = profiles.filter((profile) => profile.status === "active");
          if (this.settings.activeProfileId && !active.some((profile) => profile.id === this.settings.activeProfileId)) {
              const repaired = canonicalAppSettings({
                  ...this.settings,
                  activeProfileId: active[0]?.id ?? "",
              });
              await this.repo.put(Store.Settings, repaired);
              this.settings = repaired;
          }
          await this.verifyMemoryProjectionIntegrity();
      }
      async verifyMemoryProjectionIntegrity() {
          const [obligations, evidenceEvents] = await Promise.all([
              this.repo.getAll(Store.Obligations),
              this.evidenceEvents(),
          ]);
          verifyMemoryDatasetIntegrityWithIndex(obligations, this.memoryReviewIndexFor(evidenceEvents), this.settings.fsrsScheduling.policy, activeFsrsOptimizerProfile(this.settings));
      }
      storageHealth() {
          return this.repo.storageHealth();
      }
      async refreshStorageHealth(requestPersistence = false) {
          return this.repo.refreshStorageHealth(requestPersistence);
      }
      diagnostics() {
          return this.repo.diagnostics();
      }
      getSettings() {
          return clone(this.settings);
      }
      async saveSettings(next) {
          assert(Number.isInteger(next.dailyCapacityMinutes) && next.dailyCapacityMinutes >= 5 && next.dailyCapacityMinutes <= 600, "Daily capacity is invalid.");
          assert(Number.isInteger(next.studyDayBoundaryHour) && next.studyDayBoundaryHour >= 0 && next.studyDayBoundaryHour <= 12, "Study-day boundary is invalid.");
          const activeProfiles = (await this.profiles()).filter((profile) => profile.status === "active");
          if (activeProfiles.length > 0) {
              const profile = await this.repo.get(Store.Profiles, next.activeProfileId);
              assert(profile?.status === "active", "Default exam profile is invalid.");
          }
          else
              assert(next.activeProfileId === "", "Create an active exam profile before selecting a default profile.");
          const canonical = canonicalAppSettings(next);
          assert(JSON.stringify(effectiveFsrsPersonalization(canonical)) === JSON.stringify(effectiveFsrsPersonalization(this.settings)), "Use the explicit FSRS personalization controls to stage, activate, deactivate or remove an optimizer profile.");
          assert(JSON.stringify(canonical.fsrsScheduling.lastRebase ?? null) === JSON.stringify(this.settings.fsrsScheduling.lastRebase ?? null), "FSRS scheduler rebase metadata is service-owned.");
          const difficultyChanged = JSON.stringify(canonical.memoryDifficultyPolicy) !== JSON.stringify(this.settings.memoryDifficultyPolicy);
          if (!fsrsSchedulingPoliciesEqual(canonical.fsrsScheduling.policy, this.settings.fsrsScheduling.policy)) {
              await this.rebaseMemoryScheduler(canonical, activeFsrsOptimizerProfile(canonical), "scheduler-policy-change");
              return;
          }
          await prepareFsrsScheduler(canonical.fsrsScheduling.policy, activeFsrsOptimizerProfile(canonical));
          if (difficultyChanged) {
              const [obligations, units] = await Promise.all([this.obligations(), this.units()]);
              const released = this.releaseStalePersistentDifficultyHolds(obligations, units, canonical.memoryDifficultyPolicy, nowIso());
              await this.repo.replaceSettingsAndObligations(canonical, released);
              this.settings = canonical;
              return;
          }
          await this.repo.put(Store.Settings, canonical);
          this.settings = canonical;
      }
      releaseStalePersistentDifficultyHolds(obligations, units, policy, at) {
          const unitById = new Map(units.map((unit) => [unit.id, unit]));
          const released = [];
          for (const current of obligations) {
              if (current.type !== "memory-recall" || current.status !== "suspended" || current.suspensionReason !== "persistent-difficulty")
                  continue;
              if (memoryDifficultyAssessment(current, policy).automaticHoldEligible)
                  continue;
              const unit = unitById.get(current.unitId);
              assert(unit, "Persistent-difficulty memory references a missing knowledge unit.");
              const obligation = clone(current);
              if (unit.status === "active") {
                  obligation.status = "active";
                  delete obligation.suspensionReason;
              }
              else if (unit.status === "suspended") {
                  obligation.status = "suspended";
                  obligation.suspensionReason = "unit";
              }
              else {
                  obligation.status = "archived";
                  delete obligation.suspensionReason;
              }
              obligation.updatedAt = at;
              released.push(obligation);
          }
          return released;
      }
      async optimizerEvidenceSummary() {
          return fsrsOptimizerEvidenceSummary(await this.evidenceEvents());
      }
      async optimizerEvidenceCsv() {
          return fsrsOptimizerCsv(await this.evidenceEvents());
      }
      async optimizerEvidenceSnapshot() {
          return fsrsOptimizerEvidenceSnapshot(await this.evidenceEvents());
      }
      async assertOptimizerProfileMatchesCurrentEvidence(profile) {
          const snapshot = await this.optimizerEvidenceSnapshot();
          assert(snapshot.summary.reviews > 0, "No memory-review evidence is available for FSRS personalization.");
          assert(profile.sourceSha256 === snapshot.sourceSha256, "FSRS optimizer profile was trained on different or stale review evidence. Re-optimize or import a profile generated from the current canonical evidence export.");
      }
      async stageFsrsOptimizerProfile(input) {
          const personalization = effectiveFsrsPersonalization(this.settings);
          assert(!personalization.active, "Return to stock FSRS-7 before staging a different optimizer profile.");
          const profile = validateFsrsOptimizerProfile(input);
          await this.assertOptimizerProfileMatchesCurrentEvidence(profile);
          await prepareFsrsScheduler(this.settings.fsrsScheduling.policy, profile);
          const next = canonicalAppSettings({
              ...this.settings,
              fsrsPersonalization: { ...personalization, profile, active: false },
          });
          await this.repo.put(Store.Settings, next);
          this.settings = next;
          return clone(profile);
      }
      async clearFsrsOptimizerProfile() {
          const personalization = effectiveFsrsPersonalization(this.settings);
          assert(!personalization.active, "Return to stock FSRS-7 before removing the optimizer profile.");
          const next = canonicalAppSettings({
              ...this.settings,
              fsrsPersonalization: { profile: null, active: false },
          });
          await this.repo.put(Store.Settings, next);
          this.settings = next;
      }
      async activateFsrsOptimizerProfile() {
          const personalization = effectiveFsrsPersonalization(this.settings);
          assert(!personalization.active && personalization.profile, "No staged FSRS optimizer profile is available for activation.");
          await this.assertOptimizerProfileMatchesCurrentEvidence(personalization.profile);
          const next = canonicalAppSettings({
              ...this.settings,
              fsrsPersonalization: { ...personalization, active: true },
          });
          await this.rebaseMemoryScheduler(next, personalization.profile, "activate-profile");
      }
      async deactivateFsrsOptimizerProfile() {
          const personalization = effectiveFsrsPersonalization(this.settings);
          assert(personalization.active && personalization.profile, "Personalized FSRS-7 is not active.");
          const next = canonicalAppSettings({
              ...this.settings,
              fsrsPersonalization: { ...personalization, active: false },
          });
          await this.rebaseMemoryScheduler(next, null, "deactivate-profile");
      }
      async rebaseMemoryScheduler(requestedSettings, profile, reason) {
          assert(!(await this.currentActiveRetrieval()), "Finish or end the active retrieval session before changing FSRS scheduler parameters.");
          const settings = canonicalAppSettings(requestedSettings);
          const currentProfile = activeFsrsOptimizerProfile(this.settings);
          const currentConfiguration = fsrsConfigSnapshot(this.settings.fsrsScheduling.policy, currentProfile);
          await prepareFsrsScheduler(settings.fsrsScheduling.policy, profile);
          const [obligations, evidenceEvents, units] = await Promise.all([this.obligations(), this.evidenceEvents(), this.units()]);
          const reviewIndex = this.memoryReviewIndexFor(evidenceEvents);
          verifyMemoryDatasetIntegrityWithIndex(obligations, reviewIndex, this.settings.fsrsScheduling.policy, currentProfile);
          const scheduler = revisionSchedulerPort(settings.fsrsScheduling.policy, profile);
          const at = nowIso();
          let rescheduledObligations = 0;
          const updatedMemory = obligations.filter((obligation) => obligation.type === "memory-recall").map((obligation) => {
              const projection = obligation.policyState.fsrsCard;
              assert(projection, "Memory obligation has no FSRS materialized projection.");
              const reviews = reviewIndex.get(obligation.id) ?? [];
              if (reviews.length === 0)
                  return clone(obligation);
              const card = scheduler.reschedule(reviews[0].beforeCard, reviews);
              rescheduledObligations += 1;
              return {
                  ...clone(obligation),
                  dueAt: card.dueAt,
                  updatedAt: at,
                  policyState: {
                      ...clone(obligation.policyState),
                      stage: card.state,
                      lastIntervalDays: card.scheduledDays,
                      fsrsCard: card,
                  },
              };
          });
          assert(currentConfiguration.fingerprint !== scheduler.configuration.fingerprint, "FSRS scheduler rebase must change scheduler identity.");
          const released = this.releaseStalePersistentDifficultyHolds(updatedMemory, units, settings.memoryDifficultyPolicy, at);
          if (released.length > 0) {
              const releasedById = new Map(released.map((obligation) => [obligation.id, obligation]));
              for (let index = 0; index < updatedMemory.length; index += 1) {
                  const replacement = releasedById.get(updatedMemory[index].id);
                  if (replacement)
                      updatedMemory[index] = replacement;
              }
          }
          const personalization = effectiveFsrsPersonalization(settings);
          const finalized = canonicalAppSettings({
              ...settings,
              fsrsScheduling: {
                  policy: canonicalFsrsSchedulingPolicy(settings.fsrsScheduling.policy),
                  lastRebase: {
                      at,
                      reason,
                      fromConfigFingerprint: currentConfiguration.fingerprint,
                      toConfigFingerprint: scheduler.configuration.fingerprint,
                      rescheduledObligations,
                  },
              },
              fsrsPersonalization: {
                  ...personalization,
                  active: Boolean(profile),
              },
          });
          validateMemoryDatasetProjectionChain(updatedMemory, reviewIndex);
          await this.repo.replaceSettingsAndObligations(finalized, updatedMemory);
          this.settings = finalized;
      }
      async profiles() {
          return (await this.repo.getAll(Store.Profiles)).sort((a, b) => a.name.localeCompare(b.name));
      }
      async profile(id) {
          const profile = await this.repo.get(Store.Profiles, id);
          assert(profile, "Exam profile not found.");
          return profile;
      }
      async createProfile(name, examDate) {
          assert(name.trim().length >= 2, "Enter an exam-profile name.");
          if (examDate)
              validateCalendarDate(examDate);
          const time = nowIso();
          const profile = {
              schemaVersion: DOCUMENT_SCHEMA_VERSION,
              id: uid("profile"),
              name: name.trim(),
              examDate,
              status: "active",
              createdAt: time,
              updatedAt: time,
          };
          await this.repo.put(Store.Profiles, profile);
          if (!this.settings.activeProfileId) {
              this.settings.activeProfileId = profile.id;
              await this.repo.put(Store.Settings, this.settings);
          }
          return profile;
      }
      async updateProfile(id, name, examDate, status) {
          const profile = await this.profile(id);
          assert(name.trim().length >= 2, "Enter an exam-profile name.");
          if (examDate)
              validateCalendarDate(examDate);
          assert(status === "active" || status === "suspended", "Exam profile status is invalid.");
          profile.name = name.trim();
          profile.examDate = examDate;
          profile.status = status;
          profile.updatedAt = nowIso();
          await this.repo.put(Store.Profiles, profile);
          if (status !== "active" && this.settings.activeProfileId === profile.id) {
              const replacement = (await this.profiles()).find((candidate) => candidate.status === "active" && candidate.id !== profile.id);
              if (replacement) {
                  this.settings.activeProfileId = replacement.id;
                  await this.repo.put(Store.Settings, this.settings);
              }
          }
          return profile;
      }
      async nodes() {
          return this.repo.getAll(Store.Nodes);
      }
      async ensureNode(profileId, parentId, kind, name) {
          assert(name.trim().length > 0, `Enter a ${kind} name.`);
          const existing = await this.repo.findNode(profileId, parentId, kind, name);
          if (existing)
              return existing;
          const time = nowIso();
          const node = {
              schemaVersion: DOCUMENT_SCHEMA_VERSION,
              id: uid(kind),
              profileId,
              parentId,
              kind,
              name: name.trim().replace(/\s+/g, " "),
              normalizedName: normalizeName(name),
              createdAt: time,
              updatedAt: time,
          };
          try {
              await this.repo.put(Store.Nodes, node);
              return node;
          }
          catch (error) {
              const concurrent = await this.repo.findNode(profileId, parentId, kind, name);
              if (concurrent)
                  return concurrent;
              throw error;
          }
      }
      async ensureHierarchy(profileId, subjectName, sectionName, topicName) {
          await this.profile(profileId);
          const subject = await this.ensureNode(profileId, null, "subject", subjectName);
          const section = await this.ensureNode(profileId, subject.id, "section", sectionName);
          const topic = await this.ensureNode(profileId, section.id, "topic", topicName);
          return { subject, section, topic };
      }
      async hierarchyPath(topicNodeId) {
          const topic = await this.repo.get(Store.Nodes, topicNodeId);
          assert(topic?.kind === "topic", "Topic node not found.");
          const section = topic.parentId ? await this.repo.get(Store.Nodes, topic.parentId) : undefined;
          assert(section?.kind === "section", "Section node not found.");
          const subject = section.parentId ? await this.repo.get(Store.Nodes, section.parentId) : undefined;
          assert(subject?.kind === "subject", "Subject node not found.");
          return { subject: subject.name, section: section.name, topic: topic.name };
      }
      async units() {
          return (await this.repo.getAll(Store.Units)).sort((a, b) => a.title.localeCompare(b.title));
      }
      async unit(id) {
          const unit = await this.repo.get(Store.Units, id);
          assert(unit, "Knowledge unit not found.");
          return unit;
      }
      async createUnit(draft) {
          assert(draft.title.trim().length >= 2, "Enter a knowledge-unit name.");
          assert(draft.scope.trim().length >= 3, "Define the unit scope.");
          assert(draft.protocol.trim().length >= 3, "Define a retrieval protocol.");
          assert(draft.successCriteria.trim().length >= 3, "Define success criteria.");
          const hierarchy = await this.ensureHierarchy(draft.profileId, draft.subject, draft.section, draft.topic);
          const time = nowIso();
          const unit = {
              schemaVersion: DOCUMENT_SCHEMA_VERSION,
              id: uid("unit"),
              profileId: draft.profileId,
              topicNodeId: hierarchy.topic.id,
              title: draft.title.trim(),
              scope: draft.scope.trim(),
              source: draft.source.trim(),
              importance: draft.importance,
              status: "active",
              createdAt: time,
              updatedAt: time,
              evidenceCount: 0,
              lapseCount: 0,
          };
          const obligation = this.buildObligation({
              unitId: unit.id,
              type: draft.obligationType,
              expectedMinutes: draft.expectedMinutes,
              protocol: draft.protocol,
              successCriteria: draft.successCriteria,
              dueAt: draft.firstDueAt,
              freshnessDays: draft.freshnessDays,
              workflow: draft.workflow,
          });
          await this.repo.createUnitWithObligation(unit, obligation);
          return unit;
      }
      async updateUnitStatus(id, status) {
          const unit = await this.unit(id);
          unit.status = status;
          unit.updatedAt = nowIso();
          const obligations = await this.obligationsForUnit(id);
          for (const obligation of obligations) {
              if (status === "active" && obligation.status === "suspended" && obligation.suspensionReason === "unit") {
                  obligation.status = "active";
                  delete obligation.suspensionReason;
              }
              else if (status === "suspended" && obligation.status === "active") {
                  obligation.status = "suspended";
                  obligation.suspensionReason = "unit";
              }
              else if (status === "archived") {
                  obligation.status = "archived";
                  delete obligation.suspensionReason;
              }
              obligation.updatedAt = nowIso();
          }
          await this.repo.updateUnitWithObligations(unit, obligations);
      }
      async obligations() {
          return this.repo.getAll(Store.Obligations);
      }
      async obligation(id) {
          const obligation = await this.repo.get(Store.Obligations, id);
          assert(obligation, "Revision obligation not found.");
          return obligation;
      }
      async obligationsForUnit(unitId) {
          return (await this.repo.getByIndex(Store.Obligations, "unitId", unitId)).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      }
      buildObligation(draft, relation) {
          assert(draft.expectedMinutes >= 1 && draft.expectedMinutes <= 240, "Expected minutes are invalid.");
          assert(draft.protocol.trim().length >= 3 && draft.successCriteria.trim().length >= 3, "Protocol and success criteria are required.");
          validateWorkflowSpec(draft.workflow, draft.type);
          parseDate(draft.dueAt);
          const policy = this.router.get(draft.type);
          const time = nowIso();
          const id = uid("obligation");
          const obligation = {
              schemaVersion: DOCUMENT_SCHEMA_VERSION,
              id,
              unitId: draft.unitId,
              type: draft.type,
              status: "active",
              dueAt: draft.dueAt,
              expectedMinutes: draft.expectedMinutes,
              baselineMinutes: draft.expectedMinutes,
              durationSampleCount: 0,
              protocol: draft.protocol.trim(),
              successCriteria: draft.successCriteria.trim(),
              workflow: clone(draft.workflow),
              freshnessDays: clamp(Math.round(draft.freshnessDays), 1, 3650),
              priority: 0,
              policyState: policy.createInitialState(draft.dueAt, id),
              createdAt: time,
              updatedAt: time,
          };
          if (relation?.parentObligationId)
              obligation.parentObligationId = relation.parentObligationId;
          if (relation?.returnObligationId)
              obligation.returnObligationId = relation.returnObligationId;
          return obligation;
      }
      async createObligation(draft, relation) {
          const unit = await this.unit(draft.unitId);
          if (relation?.parentObligationId) {
              const parent = await this.obligation(relation.parentObligationId);
              assert(parent.unitId === unit.id, "Parent obligation belongs to a different knowledge unit.");
          }
          if (relation?.returnObligationId) {
              const target = await this.obligation(relation.returnObligationId);
              assert(target.unitId === unit.id, "Return obligation belongs to a different knowledge unit.");
          }
          const obligation = this.buildObligation(draft, relation);
          await this.repo.put(Store.Obligations, obligation);
          return obligation;
      }
      async joinedObligations(status = "active") {
          const obligations = await this.obligations();
          const units = await this.units();
          const profiles = await this.profiles();
          const nodes = await this.nodes();
          const unitMap = new Map(units.map((unit) => [unit.id, unit]));
          const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
          const nodeMap = new Map(nodes.map((node) => [node.id, node]));
          const joined = [];
          for (const obligation of obligations) {
              if (status !== "all" && obligation.status !== status)
                  continue;
              const unit = unitMap.get(obligation.unitId);
              if (!unit || unit.status !== "active")
                  continue;
              const profile = profileMap.get(unit.profileId);
              const topicNode = nodeMap.get(unit.topicNodeId);
              const sectionNode = topicNode?.parentId ? nodeMap.get(topicNode.parentId) : undefined;
              const subjectNode = sectionNode?.parentId ? nodeMap.get(sectionNode.parentId) : undefined;
              if (!profile || !topicNode || !sectionNode || !subjectNode)
                  continue;
              joined.push({ obligation, unit, profile, subject: subjectNode.name, section: sectionNode.name, topic: topicNode.name });
          }
          return joined.sort((a, b) => {
              const byDue = a.obligation.dueAt.localeCompare(b.obligation.dueAt);
              if (byDue !== 0)
                  return byDue;
              const byPriority = b.obligation.priority - a.obligation.priority;
              if (byPriority !== 0)
                  return byPriority;
              const byImportance = b.unit.importance - a.unit.importance;
              if (byImportance !== 0)
                  return byImportance;
              const byCreated = a.obligation.createdAt.localeCompare(b.obligation.createdAt);
              if (byCreated !== 0)
                  return byCreated;
              return a.obligation.id.localeCompare(b.obligation.id);
          });
      }
      async chunks() {
          return this.repo.getAll(Store.Chunks);
      }
      async chunk(id) {
          const chunk = await this.repo.get(Store.Chunks, id);
          assert(chunk, "Split-session chunk not found.");
          return chunk;
      }
      async chunksForObligation(obligationId) {
          return (await this.repo.getByIndex(Store.Chunks, "obligationId", obligationId))
              .sort((a, b) => a.ordinal - b.ordinal);
      }
      async dailyPlanHistory() {
          return (await this.repo.getAll(Store.DailyPlans)).sort((a, b) => b.studyDayKey.localeCompare(a.studyDayKey));
      }
      async ensureAutomaticChunking(joined, capacityMinutes, reference) {
          const allChunks = await this.chunks();
          const byObligation = new Map();
          for (const chunk of allChunks) {
              const list = byObligation.get(chunk.obligationId) ?? [];
              list.push(chunk);
              byObligation.set(chunk.obligationId, list);
          }
          const nextChunk = new Map();
          const dayEnd = studyDayEnd(reference, this.settings.studyDayBoundaryHour);
          for (const item of joined) {
              if (item.profile.status !== "active")
                  continue;
              const daysToExam = daysToExamination(item.profile, reference);
              if (examDateTime(item.profile) && daysToExam < 0)
                  continue;
              const lookaheadDays = planningLookaheadDays(daysToExam);
              if (new Date(item.obligation.dueAt).getTime() > dayEnd.getTime() + lookaheadDays * DAY_MS)
                  continue;
              const obligation = item.obligation;
              let chunks = byObligation.get(obligation.id) ?? [];
              if (obligation.chunking?.status === "chunking" && obligation.chunking.completedChunks === 0 && obligation.chunking.capacityMinutes !== capacityMinutes) {
                  const time = nowIso();
                  const priorCycle = obligation.chunking.cycleId;
                  const archived = chunks.filter((chunk) => chunk.cycleId === priorCycle && chunk.status !== "archived").map((chunk) => ({ ...chunk, status: "archived", updatedAt: time, note: chunk.note || "Replanned before execution because daily capacity changed." }));
                  chunks = chunks.map((chunk) => archived.find((entry) => entry.id === chunk.id) ?? chunk);
                  delete obligation.chunking;
                  obligation.updatedAt = time;
                  if (obligation.expectedMinutes > capacityMinutes) {
                      const created = createAutomaticChunks(item, capacityMinutes);
                      obligation.chunking = created.state;
                      chunks.push(...created.chunks);
                      await this.repo.putObligationWithChunks(obligation, [...archived, ...created.chunks]);
                  }
                  else {
                      await this.repo.putObligationWithChunks(obligation, archived);
                  }
                  byObligation.set(obligation.id, chunks);
              }
              if (!obligation.chunking && obligation.expectedMinutes > capacityMinutes) {
                  const created = createAutomaticChunks(item, capacityMinutes);
                  obligation.chunking = created.state;
                  obligation.updatedAt = nowIso();
                  chunks = [...chunks, ...created.chunks];
                  byObligation.set(obligation.id, chunks);
                  await this.repo.putObligationWithChunks(obligation, created.chunks);
              }
              const chunking = obligation.chunking;
              if (chunking?.status === "chunking") {
                  const pending = chunks.filter((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "pending").sort((a, b) => a.ordinal - b.ordinal);
                  if (pending[0])
                      nextChunk.set(obligation.id, pending[0]);
                  else if (chunking.completedChunks >= chunking.totalChunks) {
                      chunking.status = "synthesis-ready";
                      obligation.updatedAt = nowIso();
                      await this.repo.put(Store.Obligations, obligation);
                  }
              }
          }
          return nextChunk;
      }
      async existingPendingChunks(joined) {
          const chunks = await this.chunks();
          const result = new Map();
          for (const item of joined) {
              const state = item.obligation.chunking;
              if (!state || state.status !== "chunking")
                  continue;
              const pending = chunks
                  .filter((chunk) => chunk.obligationId === item.obligation.id && chunk.cycleId === state.cycleId && chunk.status === "pending")
                  .sort((a, b) => a.ordinal - b.ordinal)[0];
              if (pending)
                  result.set(item.obligation.id, pending);
          }
          return result;
      }
      async dueQueue(now = new Date()) {
          const end = studyDayEnd(now, this.settings.studyDayBoundaryHour).getTime();
          const reference = studyDayStart(now, this.settings.studyDayBoundaryHour);
          return (await this.joinedObligations("active")).filter((item) => {
              if (item.profile.status !== "active")
                  return false;
              if (examDateTime(item.profile) && daysToExamination(item.profile, reference) < 0)
                  return false;
              return new Date(item.obligation.dueAt).getTime() < end;
          });
      }
      planSnapshot(plan, reason, version) {
          const snapshotItems = (items, disposition) => items.map((item) => ({
              key: planItemKey(item.joined.obligation.id, item.chunk?.id),
              obligationId: item.joined.obligation.id,
              ...(item.chunk ? { chunkId: item.chunk.id } : {}),
              profileId: item.joined.profile.id,
              unitId: item.joined.unit.id,
              subject: item.joined.subject,
              workflow: item.joined.obligation.workflow.kind,
              title: item.chunk?.label ?? item.joined.unit.title,
              estimatedMinutes: item.executionMinutes,
              score: item.score,
              disposition,
              reasons: [...item.reasons],
          }));
          return {
              version,
              generatedAt: plan.generatedAt,
              capacityMinutes: plan.capacityMinutes,
              items: [
                  ...snapshotItems(plan.selected.filter((item) => !plan.requiredOverrun.includes(item)), "selected"),
                  ...snapshotItems(plan.requiredOverrun, "required-overrun"),
                  ...snapshotItems(plan.mustSplit, "must-split"),
                  ...snapshotItems(plan.deferred, "deferred"),
              ],
              reason,
          };
      }
      async persistDailyPlan(plan, regenerate) {
          let record = await this.repo.dailyPlanByStudyDay(plan.studyDayKey);
          if (!record) {
              const time = nowIso();
              const initial = this.planSnapshot(plan, "initial", 1);
              record = {
                  schemaVersion: DOCUMENT_SCHEMA_VERSION,
                  id: uid("dayplan"), studyDayKey: plan.studyDayKey, createdAt: time, updatedAt: time,
                  plannerVersion: PLANNER_VERSION,
                  versions: [initial],
                  outcomes: initial.items
                      .filter((item) => item.disposition === "selected" || item.disposition === "required-overrun")
                      .map((item) => ({ itemKey: item.key, status: "planned" })),
              };
              await this.repo.put(Store.DailyPlans, record);
          }
          else {
              const version = record.versions.length + 1;
              const next = this.planSnapshot(plan, regenerate ? "manual-regeneration" : "data-change", version);
              const latest = latestPlanVersion(record);
              const signature = (value) => JSON.stringify({
                  capacityMinutes: value.capacityMinutes,
                  items: value.items.map((item) => ({
                      key: item.key,
                      disposition: item.disposition,
                      estimatedMinutes: item.estimatedMinutes,
                      score: item.score,
                      reasons: item.reasons,
                  })),
              });
              if (regenerate || signature(next) !== signature(latest)) {
                  record.versions.push(next);
                  for (const item of next.items.filter((entry) => entry.disposition === "selected" || entry.disposition === "required-overrun")) {
                      if (!record.outcomes.some((outcome) => outcome.itemKey === item.key))
                          record.outcomes.push({ itemKey: item.key, status: "planned" });
                  }
                  record.updatedAt = nowIso();
                  record.plannerVersion = PLANNER_VERSION;
                  await this.repo.put(Store.DailyPlans, record);
              }
          }
          return { id: record.id, version: record.versions.at(-1)?.version ?? 1 };
      }
      async manualPlanItem(obligationId, chunkId) {
          const joined = (await this.joinedObligations()).find((item) => item.obligation.id === obligationId);
          if (!joined)
              return undefined;
          const chunk = chunkId ? await this.repo.get(Store.Chunks, chunkId) : undefined;
          if (chunkId && !chunk)
              return undefined;
          return {
              key: planItemKey(obligationId, chunkId),
              obligationId,
              ...(chunkId ? { chunkId } : {}),
              profileId: joined.profile.id,
              unitId: joined.unit.id,
              subject: joined.subject,
              workflow: joined.obligation.workflow.kind,
              title: chunk?.label ?? joined.unit.title,
              estimatedMinutes: chunk?.expectedMinutes ?? (joined.obligation.chunking?.status === "synthesis-ready" ? joined.obligation.chunking.synthesisMinutes : joined.obligation.expectedMinutes),
              score: 0,
              disposition: "selected",
              reasons: ["manually added during execution"],
          };
      }
      appendManualPlanItems(record, items, now) {
          const latest = latestPlanVersion(record);
          const nextItems = latest.items.map((item) => clone(item));
          let changed = false;
          for (const item of items) {
              const index = nextItems.findIndex((entry) => entry.key === item.key);
              if (index < 0) {
                  nextItems.push(clone(item));
                  changed = true;
                  continue;
              }
              const existing = nextItems[index];
              assert(existing, "Existing daily-plan item is missing.");
              if (existing.disposition !== "selected" && existing.disposition !== "required-overrun") {
                  nextItems[index] = clone(item);
                  changed = true;
              }
          }
          if (!changed)
              return;
          record.versions.push({
              version: latest.version + 1,
              generatedAt: now.toISOString(),
              capacityMinutes: latest.capacityMinutes,
              items: nextItems,
              reason: "manual-addition",
          });
          record.plannerVersion = PLANNER_VERSION;
      }
      async markReviewTargetsStarted(targets, now = new Date()) {
          const key = studyDayKey(now, this.settings.studyDayBoundaryHour);
          const record = await this.repo.dailyPlanByStudyDay(key);
          if (!record)
              return;
          const items = [];
          for (const target of targets) {
              if (target.startsWith("chunk:")) {
                  const chunk = await this.chunk(target.slice(6));
                  const item = await this.manualPlanItem(chunk.obligationId, chunk.id);
                  if (item)
                      items.push(item);
              }
              else {
                  const item = await this.manualPlanItem(target);
                  if (item)
                      items.push(item);
              }
          }
          this.appendManualPlanItems(record, items, now);
          for (const item of items) {
              const existing = record.outcomes.find((outcome) => outcome.itemKey === item.key);
              if (existing) {
                  if (existing.status === "planned") {
                      existing.status = "started";
                      existing.startedAt = now.toISOString();
                  }
              }
              else
                  record.outcomes.push({ itemKey: item.key, status: "started", startedAt: now.toISOString() });
          }
          record.updatedAt = now.toISOString();
          await this.repo.put(Store.DailyPlans, record);
      }
      async completedPlanRecord(obligationId, chunkId, actualMinutes, completedAt, evidenceEventId) {
          const key = studyDayKey(completedAt, this.settings.studyDayBoundaryHour);
          const record = await this.repo.dailyPlanByStudyDay(key);
          if (!record)
              return undefined;
          const item = await this.manualPlanItem(obligationId, chunkId);
          if (item)
              this.appendManualPlanItems(record, [item], completedAt);
          const itemKey = planItemKey(obligationId, chunkId);
          let outcome = record.outcomes.find((entry) => entry.itemKey === itemKey);
          if (!outcome) {
              outcome = { itemKey, status: "completed" };
              record.outcomes.push(outcome);
          }
          outcome.status = "completed";
          outcome.completedAt = completedAt.toISOString();
          outcome.actualMinutes = roundTo(actualMinutes, 1);
          if (evidenceEventId)
              outcome.evidenceEventId = evidenceEventId;
          record.updatedAt = completedAt.toISOString();
          return record;
      }
      async completeChunk(chunkId, timing, note = "", completedAt = new Date(), commitGuard, postCommitSession) {
          const chunk = await this.repo.get(Store.Chunks, chunkId);
          assert(chunk && chunk.status === "pending", "This split session is no longer pending.");
          const obligation = await this.obligation(chunk.obligationId);
          assert(obligation.chunking?.cycleId === chunk.cycleId && obligation.chunking.status === "chunking", "Split-session state is inconsistent.");
          const canonicalTiming = canonicalTimingEvidenceSummary(timing);
          const actualMinutes = roundTo(Math.max(1, canonicalTiming.totalActiveMs / 60_000), 1);
          assert(actualMinutes <= 240, "Split-session duration is invalid.");
          chunk.status = "completed";
          chunk.completedAt = completedAt.toISOString();
          chunk.actualMinutes = actualMinutes;
          chunk.note = note.trim();
          chunk.timing = canonicalTiming;
          chunk.updatedAt = completedAt.toISOString();
          obligation.chunking.completedChunks += 1;
          if (obligation.chunking.completedChunks >= obligation.chunking.totalChunks) {
              obligation.chunking.status = "synthesis-ready";
          }
          obligation.updatedAt = completedAt.toISOString();
          const dailyPlan = await this.completedPlanRecord(obligation.id, chunk.id, actualMinutes, completedAt);
          await this.repo.updateChunkWithObligation(chunk, obligation, dailyPlan, commitGuard, postCommitSession);
          return chunk;
      }
      async dailyPlan(now = new Date(), regenerate = false, persist = true) {
          assert(!regenerate || persist, "A read-only plan cannot be manually regenerated.");
          const planningReference = studyDayStart(now, this.settings.studyDayBoundaryHour);
          const joined = await this.joinedObligations("active");
          const evidence = await this.evidenceEvents();
          const memoryReviews = this.memoryReviewIndexFor(evidence);
          const planHistory = await this.dailyPlanHistory();
          const balance = weeklySubjectBalanceScores(joined, planHistory, planningReference, this.settings.studyDayBoundaryHour);
          const pendingChunks = persist
              ? await this.ensureAutomaticChunking(joined, this.settings.dailyCapacityMinutes, planningReference)
              : await this.existingPendingChunks(joined);
          const candidates = joined
              .map((item) => buildPlanningCandidate(item, evidence, this.settings, planningReference, balance.get(subjectBalanceKey(item.profile.id, item.subject)) ?? 0.5, pendingChunks.get(item.obligation.id), memoryReviews))
              .filter((item) => Boolean(item));
          const packed = choosePlanItems(candidates, this.settings.dailyCapacityMinutes);
          const plannedMinutes = packed.selected.reduce((sum, item) => sum + item.executionMinutes, 0);
          const base = {
              generatedAt: now.toISOString(),
              studyDayKey: studyDayKey(now, this.settings.studyDayBoundaryHour),
              capacityMinutes: this.settings.dailyCapacityMinutes,
              candidateMinutes: candidates.reduce((sum, item) => sum + item.executionMinutes, 0),
              plannedMinutes,
              selected: packed.selected,
              requiredOverrun: packed.requiredOverrun,
              mustSplit: packed.mustSplit,
              deferred: packed.deferred,
              overdueCount: packed.selected.filter((item) => item.dueState === "overdue").length,
              dueCount: packed.selected.filter((item) => item.dueState !== "brought-forward").length,
              broughtForwardCount: packed.selected.filter((item) => item.dueState === "brought-forward").length,
          };
          if (!persist) {
              const existing = await this.repo.dailyPlanByStudyDay(base.studyDayKey);
              return { ...base, planRecordId: existing?.id ?? "", versionNumber: existing?.versions.at(-1)?.version ?? 0 };
          }
          const persisted = await this.persistDailyPlan(base, regenerate);
          return { ...base, planRecordId: persisted.id, versionNumber: persisted.version };
      }
      async preview(obligationId, now = new Date()) {
          const obligation = await this.obligation(obligationId);
          const policy = this.router.get(obligation.type);
          if (obligation.type !== "memory-recall")
              return policy.preview(obligation, now);
          const evidence = await this.evidenceEvents();
          const memoryReviews = this.memoryReviewIndexFor(evidence).get(obligation.id) ?? [];
          return policy.preview(obligation, now, { memoryReviews });
      }
      async recordEvidence(obligationId, draft, reviewedAt = new Date(), commitGuard, postCommitSession) {
          const timing = canonicalTimingEvidenceSummary(draft.timing);
          const normalizedDraft = { ...draft, elapsedMs: timing.totalActiveMs, timing };
          validateEvidence(normalizedDraft);
          const confirmed = validateRating(normalizedDraft.confirmedRating);
          const obligation = await this.obligation(obligationId);
          validateWorkflowSpec(obligation.workflow, obligation.type);
          validateWorkflowResult(normalizedDraft.workflowResult, obligation.workflow.kind);
          assert(obligation.status === "active", "This obligation is not active.");
          const unit = await this.unit(obligation.unitId);
          const priorEvidence = await this.evidenceEvents();
          const chunking = obligation.chunking;
          const cycleChunks = chunking?.status === "synthesis-ready" ? (await this.chunksForObligation(obligation.id)).filter((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "completed") : [];
          const cycleChunkMs = cycleChunks.reduce((sum, chunk) => sum + (chunk.actualMinutes ?? 0) * 60_000, 0);
          const cycleTimingReliable = cycleChunks.every((chunk) => chunk.timing?.durationReliable !== false);
          const durationObservation = durationObservationFor(obligation, priorEvidence, normalizedDraft.elapsedMs + cycleChunkMs, timing.durationReliable && cycleTimingReliable);
          const beforePolicyState = clone(obligation.policyState);
          const beforeDueAt = obligation.dueAt;
          const suggested = suggestRating(obligation.type, normalizedDraft);
          const policy = this.router.get(obligation.type);
          const memoryReviewIndex = this.memoryReviewIndexFor(priorEvidence);
          const priorMemoryReviews = obligation.type === "memory-recall"
              ? memoryReviewIndex.get(obligation.id) ?? []
              : [];
          const completion = obligation.type === "memory-recall"
              ? policy.complete(obligation, confirmed, normalizedDraft, reviewedAt, {
                  memoryReviews: priorMemoryReviews,
              })
              : policy.complete(obligation, confirmed, normalizedDraft, reviewedAt);
          obligation.dueAt = completion.dueAt;
          obligation.policyState = completion.policyState;
          const memoryDifficulty = obligation.type === "memory-recall"
              ? (() => {
                  const beforeCard = beforePolicyState.fsrsCard;
                  const afterCard = completion.policyState.fsrsCard;
                  const schedulerConfig = completion.schedulerConfig;
                  assert(beforeCard && afterCard && schedulerConfig, "Memory completion is missing FSRS difficulty evidence.");
                  const currentReview = {
                      evidenceEventId: "pending",
                      reviewedAt: reviewedAt.toISOString(),
                      rating: confirmed,
                      source: "direct-memory",
                      beforeCard: clone(beforeCard),
                      afterCard: clone(afterCard),
                      configFingerprint: schedulerConfig.fingerprint,
                  };
                  return memoryDifficultyAssessment(obligation, this.settings.memoryDifficultyPolicy, [...priorMemoryReviews, currentReview]);
              })()
              : undefined;
          obligation.updatedAt = reviewedAt.toISOString();
          obligation.lastCompletedAt = reviewedAt.toISOString();
          if (durationObservation.accepted) {
              obligation.expectedMinutes = durationObservation.estimateAfter;
              obligation.durationSampleCount = durationObservation.exactSamples;
          }
          const chunkUpdates = [];
          if (obligation.chunking?.status === "synthesis-ready") {
              const cycleId = obligation.chunking.cycleId;
              for (const chunk of await this.chunksForObligation(obligation.id)) {
                  if (chunk.cycleId !== cycleId || chunk.status === "archived")
                      continue;
                  chunk.status = "archived";
                  chunk.updatedAt = reviewedAt.toISOString();
                  chunkUpdates.push(chunk);
              }
              delete obligation.chunking;
          }
          unit.latestEvidenceAt = reviewedAt.toISOString();
          unit.latestEvidenceRating = confirmed;
          unit.evidenceCount += 1;
          if (confirmed === Rating.Again)
              unit.lapseCount += 1;
          unit.updatedAt = reviewedAt.toISOString();
          let followUp;
          let relatedObligation;
          let returnedMemoryTransition;
          if (completion.followUpType === "relearn" && obligation.type !== "relearn") {
              obligation.status = "suspended";
              obligation.suspensionReason = "relearning";
              const existing = (await this.obligationsForUnit(unit.id)).find((item) => item.type === "relearn" && item.status === "active" && item.returnObligationId === obligation.id);
              if (!existing) {
                  const dueAt = correctiveRelearnDueAt(await this.profile(unit.profileId), reviewedAt);
                  const policy = this.router.get("relearn");
                  const time = reviewedAt.toISOString();
                  const followUpId = uid("obligation");
                  const remediationPlan = memoryDifficulty
                      ? memoryDifficultyRemediationPlan(memoryDifficulty)
                      : { priorityBoost: 2, guidance: "" };
                  const escalation = remediationPlan.guidance;
                  const priorityBoost = remediationPlan.priorityBoost;
                  followUp = {
                      schemaVersion: DOCUMENT_SCHEMA_VERSION,
                      id: followUpId,
                      unitId: unit.id,
                      type: "relearn",
                      status: "active",
                      dueAt,
                      expectedMinutes: Math.max(10, obligation.expectedMinutes),
                      baselineMinutes: Math.max(10, obligation.expectedMinutes),
                      durationSampleCount: 0,
                      protocol: `${escalation}Relearn the weak foundations, then repeat: ${obligation.protocol}`,
                      successCriteria: `${escalation}Explain the corrected concept independently before returning to ${obligationLabel(obligation.type)}.`,
                      workflow: {
                          kind: "relearning",
                          prompt: `${escalation}Repair the failure, then verify independently: ${obligation.workflow.prompt}`,
                          checkpoints: [...obligation.workflow.checkpoints],
                          responseMedium: "in-app",
                      },
                      freshnessDays: obligation.freshnessDays,
                      priority: obligation.priority + priorityBoost,
                      policyState: policy.createInitialState(dueAt, followUpId),
                      parentObligationId: obligation.id,
                      returnObligationId: obligation.id,
                      createdAt: time,
                      updatedAt: time,
                  };
              }
          }
          const relearningMastered = obligation.type === "relearn" &&
              confirmed >= Rating.Good &&
              objectiveScore(obligation.type, normalizedDraft) >= 2.7 &&
              beforePolicyState.successStreak >= 1;
          if (relearningMastered) {
              obligation.status = "completed";
              if (obligation.returnObligationId) {
                  const original = await this.repo.get(Store.Obligations, obligation.returnObligationId);
                  if (original) {
                      if (original.type === "memory-recall") {
                          const returnedBeforeDueAt = original.dueAt;
                          const returnedBeforePolicyState = clone(original.policyState);
                          const resumed = this.router.get("memory-recall").complete(original, Rating.Good, normalizedDraft, reviewedAt, { memoryReviews: memoryReviewIndex.get(original.id) ?? [] });
                          assert(resumed.schedulerConfig && resumed.reviewLog, "Returned memory review lacks FSRS-7 provenance.");
                          original.dueAt = resumed.dueAt;
                          original.policyState = resumed.policyState;
                          original.lastCompletedAt = reviewedAt.toISOString();
                          returnedMemoryTransition = {
                              obligationId: original.id,
                              rating: Rating.Good,
                              beforeDueAt: returnedBeforeDueAt,
                              afterDueAt: resumed.dueAt,
                              beforePolicyState: returnedBeforePolicyState,
                              afterPolicyState: clone(resumed.policyState),
                              policyId: resumed.policyId,
                              schedulerPackage: "ts-fsrs",
                              schedulerVersion: FSRS_PACKAGE_VERSION,
                              schedulerModel: FSRS_MODEL,
                              schedulerConfig: clone(resumed.schedulerConfig),
                              reviewLog: clone(resumed.reviewLog),
                          };
                      }
                      else {
                          original.dueAt = addDays(reviewedAt, 3).toISOString();
                      }
                      if (original.type === "memory-recall" && memoryDifficultyAssessment(original, this.settings.memoryDifficultyPolicy).automaticHoldEligible) {
                          original.status = "suspended";
                          original.suspensionReason = "persistent-difficulty";
                      }
                      else {
                          original.status = "active";
                          delete original.suspensionReason;
                      }
                      original.updatedAt = reviewedAt.toISOString();
                      relatedObligation = original;
                  }
              }
          }
          const evidence = {
              completeness: normalizedDraft.completeness,
              independence: normalizedDraft.independence,
              application: normalizedDraft.application,
              errorTypes: [...normalizedDraft.errorTypes],
              correctionNote: normalizedDraft.correctionNote.trim(),
          };
          if (normalizedDraft.accuracyPercent !== undefined)
              evidence.accuracyPercent = normalizedDraft.accuracyPercent;
          const event = {
              schemaVersion: DOCUMENT_SCHEMA_VERSION,
              id: commitGuard ? `evidence_${commitGuard.commitToken}` : uid("evidence"),
              profileId: unit.profileId,
              unitId: unit.id,
              obligationId: obligation.id,
              obligationType: obligation.type,
              reviewedAt: reviewedAt.toISOString(),
              elapsedMs: timing.totalActiveMs,
              evidence,
              workflow: obligation.workflow.kind,
              workflowResult: clone(normalizedDraft.workflowResult),
              suggestedRating: suggested,
              confirmedRating: confirmed,
              beforeDueAt,
              afterDueAt: obligation.dueAt,
              beforePolicyState,
              afterPolicyState: clone(obligation.policyState),
              policyId: completion.policyId,
              durationObservation,
              timing,
              createdAt: nowIso(),
          };
          if (completion.reviewLog)
              event.reviewLog = completion.reviewLog;
          if (completion.schedulerConfig)
              event.schedulerConfig = clone(completion.schedulerConfig);
          if (obligation.type === "memory-recall") {
              event.schedulerPackage = "ts-fsrs";
              event.schedulerVersion = FSRS_PACKAGE_VERSION;
              const card = obligation.policyState.fsrsCard;
              assert(card?.model === FSRS_MODEL, "Memory evidence cannot be committed without current FSRS-7 state.");
              event.schedulerModel = FSRS_MODEL;
          }
          if (followUp)
              event.followUpObligationId = followUp.id;
          if (returnedMemoryTransition)
              event.returnedMemoryTransition = returnedMemoryTransition;
          const dailyPlan = await this.completedPlanRecord(obligation.id, undefined, roundTo(timing.totalActiveMs / 60_000, 1), reviewedAt, event.id);
          await this.repo.recordReview(unit, obligation, event, followUp, relatedObligation, chunkUpdates, dailyPlan, commitGuard, postCommitSession);
          this.invalidateMemoryReviewAnalysis();
          return event;
      }
      async resumePersistentDifficulty(obligationId) {
          const obligation = await this.obligation(obligationId);
          assert(obligation.type === "memory-recall", "Only memory recall can be resumed from persistent-difficulty hold.");
          assert(obligation.status === "suspended" && obligation.suspensionReason === "persistent-difficulty", "Memory obligation is not held for persistent difficulty.");
          const unit = await this.unit(obligation.unitId);
          assert(unit.status === "active", "Reactivate the knowledge unit before resuming this memory obligation.");
          const unresolvedRepair = (await this.obligationsForUnit(unit.id)).some((item) => item.type === "relearn" &&
              (item.status === "active" || item.status === "suspended") &&
              item.returnObligationId === obligation.id);
          assert(!unresolvedRepair, "Complete the unresolved relearning repair before resuming this memory obligation.");
          obligation.status = "active";
          delete obligation.suspensionReason;
          obligation.updatedAt = nowIso();
          await this.repo.put(Store.Obligations, obligation);
      }
      async studyEvents() {
          return (await this.repo.getAll(Store.StudyEvents)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      }
      async logStudyEvent(draft) {
          await this.profile(draft.profileId);
          assert(["learn", "review", "practice", "test"].includes(draft.activityMode), "Study activity mode is invalid.");
          assert(draft.origin === "manual" || draft.origin === "study-director", "Study origin is invalid.");
          assert(draft.understanding === 1 || draft.understanding === 2 || draft.understanding === 3 || draft.understanding === 4, "Study understanding is invalid.");
          parseDate(draft.occurredAt);
          assert(draft.area.trim() && draft.task.trim() && draft.measure.trim(), "Area, task and measure are required.");
          assert(Number.isFinite(draft.durationMinutes) && draft.durationMinutes >= 1 && draft.durationMinutes <= 1440, "Duration is invalid.");
          assert(Array.isArray(draft.linkedUnitIds), "Study Event links are invalid.");
          for (const unitId of draft.linkedUnitIds) {
              const unit = await this.unit(unitId);
              assert(unit.profileId === draft.profileId, "Study Event cannot link a knowledge unit from another exam profile.");
          }
          const event = {
              schemaVersion: DOCUMENT_SCHEMA_VERSION,
              id: uid("study"),
              profileId: draft.profileId,
              occurredAt: draft.occurredAt,
              activityMode: draft.activityMode,
              area: draft.area.trim(),
              task: draft.task.trim(),
              measure: draft.measure.trim(),
              source: draft.source.trim(),
              durationMinutes: Math.round(draft.durationMinutes),
              understanding: draft.understanding,
              linkedUnitIds: [...new Set(draft.linkedUnitIds)],
              notes: draft.notes.trim(),
              origin: draft.origin,
              createdAt: nowIso(),
          };
          await this.repo.put(Store.StudyEvents, event);
          return event;
      }
      async evidenceEvents() {
          return (await this.repo.getAll(Store.EvidenceEvents)).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
      }
      async triggeringEvidence(relearningObligationId) {
          const obligation = await this.obligation(relearningObligationId);
          if (obligation.type !== "relearn")
              return undefined;
          const events = await this.evidenceEvents();
          return events.find((event) => event.followUpObligationId === obligation.id)
              ?? events.find((event) => event.obligationId === obligation.parentObligationId);
      }
      async currentActiveRetrieval() {
          return await this.repo.get(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID) ?? null;
      }
      async exportBackup() {
          return {
              format: BACKUP_FORMAT,
              schemaVersion: BACKUP_SCHEMA_VERSION,
              exportedAt: nowIso(),
              appVersion: APP_VERSION,
              profiles: await this.profiles(),
              nodes: await this.nodes(),
              units: await this.units(),
              studyEvents: await this.studyEvents(),
              obligations: await this.obligations(),
              evidenceEvents: await this.evidenceEvents(),
              chunks: await this.chunks(),
              dailyPlans: await this.dailyPlanHistory(),
              settings: this.getSettings(),
              activeRetrieval: await this.repo.get(Store.ActiveRetrieval, ACTIVE_RETRIEVAL_ID) ?? null,
          };
      }
      async createBackupArchive(preferCompression = true) {
          const payload = this.validateBackup(await this.exportBackup());
          verifyMemoryDatasetIntegrity(payload.obligations, payload.evidenceEvents, payload.settings.fsrsScheduling.policy, activeFsrsOptimizerProfile(payload.settings));
          return BackupCodec.create(payload, preferCompression);
      }
      async inspectBackupArchive(bytes) {
          return (await BackupCodec.decode(bytes, (input) => this.validateBackup(input))).inspection;
      }
      async decodeBackupArchive(bytes) {
          return BackupCodec.decode(bytes, (input) => this.validateBackup(input));
      }
      async restoreBackupPayload(payload, activeTreatment) {
          const validated = this.validateBackup(payload);
          await prepareFsrsScheduler(validated.settings.fsrsScheduling.policy, activeFsrsOptimizerProfile(validated.settings));
          verifyMemoryDatasetIntegrity(validated.obligations, validated.evidenceEvents, validated.settings.fsrsScheduling.policy, activeFsrsOptimizerProfile(validated.settings));
          await this.repo.replaceFromBackup(validated, activeTreatment);
          this.settings = clone(validated.settings);
          this.invalidateMemoryReviewAnalysis();
      }
      async rawStateForRescue() {
          return this.repo.rawDump();
      }
      validateBackup(input) {
          const candidate = requireRecord(input, "Backup");
          assert(candidate["format"] === BACKUP_FORMAT && candidate["schemaVersion"] === BACKUP_SCHEMA_VERSION, "This is not a supported Revision Director backup.");
          const appVersion = canonicalId(requiredString(candidate["appVersion"], "Backup application version"), "Backup application version");
          const profiles = canonicalDocumentArray("profile", candidate["profiles"], "Backup profiles");
          const nodes = canonicalDocumentArray("node", candidate["nodes"], "Backup knowledge nodes");
          const units = canonicalDocumentArray("unit", candidate["units"], "Backup knowledge units");
          const studyEvents = canonicalDocumentArray("study-event", candidate["studyEvents"], "Backup study events");
          const obligations = canonicalDocumentArray("obligation", candidate["obligations"], "Backup obligations");
          const evidenceEvents = canonicalDocumentArray("evidence-event", candidate["evidenceEvents"], "Backup evidence events");
          const chunks = canonicalDocumentArray("chunk", candidate["chunks"], "Backup chunks");
          const dailyPlans = canonicalDocumentArray("daily-plan", candidate["dailyPlans"], "Backup daily plans");
          const settings = canonicalDocument("settings", candidate["settings"]);
          const activeInput = candidate["activeRetrieval"];
          assert(activeInput === null || isRecord(activeInput), "Backup active retrieval is invalid.");
          const activeRetrieval = activeInput === null ? null : canonicalDocument("active-retrieval", activeInput);
          const uniqueMap = (values, label) => {
              const map = new Map();
              for (const value of values) {
                  assert(typeof value.id === "string" && value.id.trim().length > 0, `${label} has an invalid ID.`);
                  assert(!map.has(value.id), `${label} contains duplicate IDs.`);
                  map.set(value.id, value);
              }
              return map;
          };
          const validDate = (value, label) => {
              assert(typeof value === "string" && Number.isFinite(new Date(value).getTime()), `${label} has an invalid date.`);
          };
          const validRatingValue = (value, label) => {
              assert(value === 1 || value === 2 || value === 3 || value === 4, `${label} has an invalid rating.`);
          };
          const profileMap = uniqueMap(profiles, "Profiles");
          const nodeMap = uniqueMap(nodes, "Knowledge nodes");
          const unitMap = uniqueMap(units, "Knowledge units");
          const obligationMap = uniqueMap(obligations, "Revision obligations");
          uniqueMap(studyEvents, "Study events");
          const evidenceMap = uniqueMap(evidenceEvents, "Evidence events");
          const chunkMap = uniqueMap(chunks, "Obligation chunks");
          uniqueMap(dailyPlans, "Daily plans");
          const studyDayKeys = new Set();
          for (const profile of profiles)
              assertDocumentSchema(profile, "Backup exam profile");
          for (const node of nodes)
              assertDocumentSchema(node, "Backup knowledge node");
          for (const unit of units)
              assertDocumentSchema(unit, "Backup knowledge unit");
          for (const event of studyEvents)
              assertDocumentSchema(event, "Backup Study Event");
          for (const obligation of obligations)
              assertDocumentSchema(obligation, "Backup revision obligation");
          for (const event of evidenceEvents)
              assertDocumentSchema(event, "Backup Evidence Event");
          for (const chunk of chunks)
              assertDocumentSchema(chunk, "Backup obligation chunk");
          for (const plan of dailyPlans)
              assertDocumentSchema(plan, "Backup daily plan");
          for (const profile of profiles) {
              assert(profile.name.trim().length > 0 && ["active", "suspended", "archived"].includes(profile.status), "Profile data is invalid.");
              if (profile.examDate)
                  validateCalendarDate(profile.examDate, "Profile exam date");
              validDate(profile.createdAt, "Profile");
              validDate(profile.updatedAt, "Profile");
          }
          for (const node of nodes) {
              const profile = profileMap.get(node.profileId);
              assert(profile, "Knowledge node references a missing profile.");
              assert(node.name.trim().length > 0 && node.normalizedName === normalizeName(node.name), "Knowledge node name is invalid.");
              if (node.kind === "subject")
                  assert(node.parentId === null, "Subject nodes cannot have parents.");
              if (node.kind === "section") {
                  const parent = node.parentId ? nodeMap.get(node.parentId) : undefined;
                  assert(parent?.kind === "subject" && parent.profileId === node.profileId, "Section must belong to a subject in the same profile.");
              }
              if (node.kind === "topic") {
                  const parent = node.parentId ? nodeMap.get(node.parentId) : undefined;
                  assert(parent?.kind === "section" && parent.profileId === node.profileId, "Topic must belong to a section in the same profile.");
              }
              validDate(node.createdAt, "Knowledge node");
              validDate(node.updatedAt, "Knowledge node");
          }
          for (const unit of units) {
              const topic = nodeMap.get(unit.topicNodeId);
              assert(profileMap.has(unit.profileId) && topic?.kind === "topic" && topic.profileId === unit.profileId, "Knowledge unit references invalid hierarchy data.");
              assert(unit.title.trim().length > 0 && unit.scope.trim().length > 0, "Knowledge unit title or scope is missing.");
              assert(unit.importance === 1 || unit.importance === 2 || unit.importance === 3, "Knowledge unit importance is invalid.");
              assert(Number.isInteger(unit.evidenceCount) && unit.evidenceCount >= 0 && Number.isInteger(unit.lapseCount) && unit.lapseCount >= 0, "Knowledge unit counters are invalid.");
              if (unit.latestEvidenceAt)
                  validDate(unit.latestEvidenceAt, "Knowledge unit evidence");
              if (unit.latestEvidenceRating !== undefined)
                  validRatingValue(unit.latestEvidenceRating, "Knowledge unit");
          }
          for (const event of studyEvents) {
              assert(profileMap.has(event.profileId), "Study event references a missing profile.");
              validDate(event.occurredAt, "Study event");
              validDate(event.createdAt, "Study event");
              assert(["learn", "review", "practice", "test"].includes(event.activityMode), "Study event activity is invalid.");
              assert(typeof event.area === "string" && event.area.trim().length > 0 && typeof event.task === "string" && event.task.trim().length > 0 && typeof event.measure === "string" && event.measure.trim().length > 0, "Study event canonical inputs are invalid.");
              assert(Number.isFinite(event.durationMinutes) && event.durationMinutes >= 1 && event.durationMinutes <= 1440, "Study event duration is invalid.");
              assert(event.understanding === 1 || event.understanding === 2 || event.understanding === 3 || event.understanding === 4, "Study event understanding is invalid.");
              assert(Array.isArray(event.linkedUnitIds), "Study event links are invalid.");
              for (const unitId of event.linkedUnitIds) {
                  const unit = unitMap.get(unitId);
                  assert(unit?.profileId === event.profileId, "Study event links a missing or cross-profile knowledge unit.");
              }
          }
          for (const obligation of obligations) {
              const unit = unitMap.get(obligation.unitId);
              assert(unit, "Obligation references a missing unit.");
              assert(Object.hasOwn(POLICY_ENGINE_BY_OBLIGATION, obligation.type), "Obligation type is invalid.");
              assert(["active", "completed", "suspended", "archived"].includes(obligation.status), "Obligation status is invalid.");
              if (obligation.status === "suspended")
                  assert(obligation.suspensionReason === "unit" || obligation.suspensionReason === "relearning" || obligation.suspensionReason === "persistent-difficulty", "Suspended obligation lacks a valid reason.");
              else
                  assert(obligation.suspensionReason === undefined, "Only suspended obligations may retain a suspension reason.");
              if (obligation.suspensionReason === "relearning") {
                  assert([...obligationMap.values()].some((item) => item.type === "relearn" &&
                      (item.status === "active" || item.status === "suspended") &&
                      item.returnObligationId === obligation.id), "Relearning suspension lacks its unresolved repair obligation.");
              }
              if (obligation.suspensionReason === "persistent-difficulty")
                  assert(obligation.type === "memory-recall", "Persistent-difficulty hold is only valid for memory recall.");
              validDate(obligation.dueAt, "Obligation");
              validDate(obligation.createdAt, "Obligation");
              validDate(obligation.updatedAt, "Obligation");
              assert(Number.isFinite(obligation.expectedMinutes) && obligation.expectedMinutes >= 1 && obligation.expectedMinutes <= 240, "Obligation duration is invalid.");
              assert(Number.isFinite(obligation.baselineMinutes) && obligation.baselineMinutes >= 1 && obligation.baselineMinutes <= 240, "Obligation baseline duration is invalid.");
              assert(Number.isInteger(obligation.durationSampleCount) && obligation.durationSampleCount >= 0, "Obligation duration sample count is invalid.");
              if (obligation.chunking) {
                  assert(obligation.chunking.status === "chunking" || obligation.chunking.status === "synthesis-ready", "Obligation chunking state is invalid.");
                  assert(Number.isFinite(obligation.chunking.originalMinutes) && obligation.chunking.originalMinutes >= 1 && obligation.chunking.originalMinutes <= 240, "Obligation chunking original duration is invalid.");
                  assert(Number.isFinite(obligation.chunking.synthesisMinutes) && obligation.chunking.synthesisMinutes >= 1 && obligation.chunking.synthesisMinutes < obligation.chunking.originalMinutes, "Obligation chunking synthesis duration is invalid.");
                  assert(Number.isInteger(obligation.chunking.capacityMinutes) && obligation.chunking.capacityMinutes >= 5 && obligation.chunking.capacityMinutes <= 600, "Obligation chunking capacity is invalid.");
                  assert(obligation.chunking.originalMinutes === obligation.expectedMinutes, "Obligation chunking duration no longer matches its parent estimate.");
                  assert(Number.isInteger(obligation.chunking.totalChunks) && obligation.chunking.totalChunks >= 2 && Number.isInteger(obligation.chunking.completedChunks) && obligation.chunking.completedChunks >= 0 && obligation.chunking.completedChunks <= obligation.chunking.totalChunks, "Obligation chunk counts are invalid.");
                  validDate(obligation.chunking.createdAt, "Obligation chunking state");
              }
              assert(obligation.protocol.trim().length > 0 && obligation.successCriteria.trim().length > 0, "Obligation protocol is incomplete.");
              validateWorkflowSpec(obligation.workflow, obligation.type);
              assert(obligation.policyState.engine === POLICY_ENGINE_BY_OBLIGATION[obligation.type], "Obligation policy does not match its type.");
              if (obligation.type === "memory-recall") {
                  assert(obligation.policyState.version === FSRS_PACKAGE_VERSION && obligation.policyState.fsrsCard, "Memory obligation has invalid FSRS-7 state.");
                  const fsrsCard = obligation.policyState.fsrsCard;
                  assert(fsrsCard.model === FSRS_MODEL, "Memory obligation uses an unsupported scheduler model.");
                  assert(fsrsCard.cardId === obligation.id, "FSRS card identity does not match its obligation.");
                  assert(fsrsCard.scheduleStatus === "new" || fsrsCard.scheduleStatus === "learning" || fsrsCard.scheduleStatus === "review" || fsrsCard.scheduleStatus === "suspended", "FSRS card schedule status is invalid.");
                  requiredFsrs7StabilityFast(fsrsCard.stabilityFast);
                  validDate(fsrsCard.dueAt, "FSRS card");
                  assert(fsrsCard.dueAt === obligation.dueAt, "Memory obligation due date is not synchronized with its FSRS-7 card.");
                  if (fsrsCard.lastReviewAt)
                      validDate(fsrsCard.lastReviewAt, "FSRS last review");
              }
              if (obligation.parentObligationId)
                  assert(obligationMap.has(obligation.parentObligationId), "Obligation references a missing parent.");
              if (obligation.returnObligationId)
                  assert(obligationMap.has(obligation.returnObligationId), "Relearning obligation references a missing return obligation.");
              if (obligation.type === "relearn") {
                  assert(obligation.returnObligationId && obligation.parentObligationId === obligation.returnObligationId, "Relearning obligation must point to its exact originating obligation.");
                  const original = obligation.returnObligationId ? obligationMap.get(obligation.returnObligationId) : undefined;
                  assert(original?.unitId === obligation.unitId && original.type !== "relearn", "Relearning return target is invalid.");
              }
          }
          for (const event of evidenceEvents) {
              const unit = unitMap.get(event.unitId);
              const obligation = obligationMap.get(event.obligationId);
              assert(unit && obligation && profileMap.has(event.profileId), "Evidence event references missing records.");
              assert(unit.profileId === event.profileId && obligation.unitId === event.unitId && obligation.type === event.obligationType, "Evidence event relationships are inconsistent.");
              validDate(event.reviewedAt, "Evidence event");
              validDate(event.beforeDueAt, "Evidence event");
              validDate(event.afterDueAt, "Evidence event");
              assert(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0 && event.elapsedMs <= 7 * DAY_MS, "Evidence duration is invalid.");
              const duration = event.durationObservation;
              assert(duration && typeof duration.accepted === "boolean", "Evidence duration observation is invalid.");
              assert(Number.isFinite(duration.plannedMinutes) && duration.plannedMinutes >= 1 && duration.plannedMinutes <= 240, "Evidence planned duration is invalid.");
              assert(Number.isFinite(duration.actualMinutes) && duration.actualMinutes >= 0 && duration.actualMinutes <= 10_080, "Evidence actual duration is invalid.");
              assert(Number.isFinite(duration.estimateBefore) && duration.estimateBefore >= 1 && duration.estimateBefore <= 240 && Number.isFinite(duration.estimateAfter) && duration.estimateAfter >= 1 && duration.estimateAfter <= 240, "Evidence duration estimate is invalid.");
              assert(duration.plannedMinutes === duration.estimateBefore, "Evidence planned duration does not match its prior estimate.");
              assert(["accepted", "too-short", "too-long", "invalid", "unreliable-interruption"].includes(duration.reason), "Evidence duration reason is invalid.");
              assert(duration.accepted === (duration.reason === "accepted"), "Evidence duration acceptance and reason disagree.");
              if (!duration.accepted)
                  assert(duration.estimateAfter === duration.estimateBefore, "Rejected duration evidence cannot change the estimate.");
              assert(Number.isInteger(duration.exactSamples) && duration.exactSamples >= 0 && Number.isInteger(duration.unitWorkflowSamples) && duration.unitWorkflowSamples >= 0 && Number.isInteger(duration.globalWorkflowSamples) && duration.globalWorkflowSamples >= 0, "Evidence duration sample counts are invalid.");
              validateEvidence(event.evidence);
              assert(event.workflow === obligation.workflow.kind, "Evidence workflow does not match the obligation.");
              validateWorkflowResult(event.workflowResult, event.workflow);
              validRatingValue(event.suggestedRating, "Evidence event");
              validRatingValue(event.confirmedRating, "Evidence event");
              assert(event.beforePolicyState.engine === POLICY_ENGINE_BY_OBLIGATION[event.obligationType] && event.afterPolicyState.engine === POLICY_ENGINE_BY_OBLIGATION[event.obligationType], "Evidence policy states do not match the obligation type.");
              if (event.followUpObligationId)
                  assert(obligationMap.has(event.followUpObligationId), "Evidence event references a missing follow-up obligation.");
              if (event.obligationType === "memory-recall") {
                  assert(event.schedulerPackage === "ts-fsrs" && event.schedulerVersion === FSRS_PACKAGE_VERSION && event.schedulerModel === FSRS_MODEL, "Memory evidence lacks exact FSRS-7 provenance.");
                  const config = event.schedulerConfig;
                  assert(config, "Memory evidence lacks scheduler configuration.");
                  validateFsrsConfigSnapshot(config);
              }
              else
                  assert(event.schedulerPackage === undefined && event.schedulerVersion === undefined && event.schedulerModel === undefined && event.schedulerConfig === undefined, "Non-memory evidence cannot claim FSRS provenance.");
              const returned = event.returnedMemoryTransition;
              const relearnReturnId = obligation.type === "relearn" ? obligation.returnObligationId : undefined;
              const returnedTarget = relearnReturnId ? obligationMap.get(relearnReturnId) : undefined;
              const shouldReturnMemory = obligation.type === "relearn" &&
                  returnedTarget?.type === "memory-recall" &&
                  event.confirmedRating >= Rating.Good &&
                  objectiveScore("relearn", event.evidence) >= 2.7 &&
                  event.beforePolicyState.successStreak >= 1;
              assert(Boolean(returned) === shouldReturnMemory, "Returned-memory scheduler transition presence is inconsistent with relearning completion.");
              if (returned) {
                  assert(returnedTarget?.type === "memory-recall", "Returned-memory transition lacks a valid memory target.");
                  assert(returned.obligationId === returnedTarget.id, "Returned-memory transition targets the wrong obligation.");
                  assert(returned.rating === Rating.Good, "Returned-memory transition must record a Good closed-book repair.");
                  validDate(returned.beforeDueAt, "Returned-memory prior due date");
                  validDate(returned.afterDueAt, "Returned-memory next due date");
                  assert(returned.policyId === `memory/ts-fsrs@${FSRS_PACKAGE_VERSION}/fsrs-7`, "Returned-memory policy provenance is invalid.");
                  assert(returned.schedulerPackage === "ts-fsrs" && returned.schedulerVersion === FSRS_PACKAGE_VERSION && returned.schedulerModel === FSRS_MODEL, "Returned-memory scheduler provenance is invalid.");
                  validateFsrsConfigSnapshot(returned.schedulerConfig);
                  for (const state of [returned.beforePolicyState, returned.afterPolicyState]) {
                      assert(state.engine === "ts-fsrs" && state.version === FSRS_PACKAGE_VERSION && state.fsrsCard?.model === FSRS_MODEL, "Returned-memory policy state is invalid.");
                      assert(state.fsrsCard.cardId === returned.obligationId, "Returned-memory card identity is invalid.");
                      requiredFsrs7StabilityFast(state.fsrsCard.stabilityFast);
                  }
              }
          }
          validateMemoryDatasetProjectionChain(obligations, memoryReviewObservationIndex(evidenceEvents));
          const chunksByObligation = new Map();
          for (const chunk of chunks) {
              const obligation = obligationMap.get(chunk.obligationId);
              assert(obligation, "Chunk references a missing obligation.");
              assert(chunk.status === "pending" || chunk.status === "completed" || chunk.status === "archived", "Chunk status is invalid.");
              assert(typeof chunk.cycleId === "string" && chunk.cycleId.trim().length > 0 && typeof chunk.label === "string" && chunk.label.trim().length > 0 && typeof chunk.scope === "string" && chunk.scope.trim().length > 0, "Chunk identity or scope is invalid.");
              assert(Number.isInteger(chunk.ordinal) && Number.isInteger(chunk.total) && chunk.ordinal >= 1 && chunk.ordinal <= chunk.total, "Chunk order is invalid.");
              assert(Number.isFinite(chunk.expectedMinutes) && chunk.expectedMinutes >= 1 && chunk.expectedMinutes <= 240, "Chunk duration is invalid.");
              validDate(chunk.createdAt, "Chunk");
              validDate(chunk.updatedAt, "Chunk");
              if (chunk.completedAt)
                  validDate(chunk.completedAt, "Chunk completion");
              if (chunk.status === "completed") {
                  assert(Number.isFinite(chunk.actualMinutes) && (chunk.actualMinutes ?? 0) > 0, "Completed chunk lacks actual duration.");
                  assert(chunk.timing !== undefined, "Completed chunk lacks timing evidence.");
                  canonicalTimingEvidenceSummary(chunk.timing);
              }
              const list = chunksByObligation.get(chunk.obligationId) ?? [];
              list.push(chunk);
              chunksByObligation.set(chunk.obligationId, list);
          }
          for (const obligation of obligations) {
              const related = chunksByObligation.get(obligation.id) ?? [];
              const chunking = obligation.chunking;
              if (!chunking) {
                  assert(related.every((chunk) => chunk.status === "archived"), "An obligation without active chunking has unfinished chunk records.");
                  continue;
              }
              const active = related.filter((chunk) => chunk.cycleId === chunking.cycleId && chunk.status !== "archived");
              assert(active.length === chunking.totalChunks, "Obligation chunk count does not match its active cycle.");
              assert(new Set(active.map((chunk) => chunk.ordinal)).size === active.length, "Obligation chunk ordinals are duplicated.");
              assert(active.every((chunk) => chunk.total === chunking.totalChunks), "Chunk total does not match the obligation cycle.");
              assert(active.every((chunk) => chunk.expectedMinutes <= chunking.capacityMinutes), "Active chunks exceed the capacity that created their cycle.");
              assert(active.reduce((sum, chunk) => sum + chunk.expectedMinutes, 0) + chunking.synthesisMinutes === chunking.originalMinutes, "Chunk durations do not conserve the parent estimate.");
              const completed = active.filter((chunk) => chunk.status === "completed").length;
              assert(completed === chunking.completedChunks, "Obligation completed-chunk count does not match its records.");
              if (chunking.status === "synthesis-ready")
                  assert(completed === active.length, "Synthesis-ready obligations must have all chunks completed.");
              else
                  assert(active.some((chunk) => chunk.status === "pending"), "An active chunking cycle must retain pending work.");
              assert(related.filter((chunk) => chunk.cycleId !== chunking.cycleId).every((chunk) => chunk.status === "archived"), "Prior chunk cycles must be archived.");
          }
          for (const plan of dailyPlans) {
              validateCalendarDate(plan.studyDayKey, "Daily plan study day");
              assert(!studyDayKeys.has(plan.studyDayKey), "Daily plans contain duplicate study days.");
              studyDayKeys.add(plan.studyDayKey);
              validDate(plan.createdAt, "Daily plan");
              validDate(plan.updatedAt, "Daily plan");
              assert(new Date(plan.updatedAt).getTime() >= new Date(plan.createdAt).getTime(), "Daily plan timestamps are inconsistent.");
              assert(plan.plannerVersion === PLANNER_VERSION, "Daily plan planner version is invalid.");
              assert(Array.isArray(plan.versions) && plan.versions.length >= 1 && Array.isArray(plan.outcomes), "Daily plan history is incomplete.");
              const planKeys = new Set();
              const itemByKey = new Map();
              const versionNumbers = new Set();
              for (const version of plan.versions) {
                  assert(Number.isInteger(version.version) && version.version >= 1 && Number.isInteger(version.capacityMinutes) && version.capacityMinutes >= 5 && version.capacityMinutes <= 600, "Daily plan version is invalid.");
                  assert(version.reason === "initial" || version.reason === "manual-regeneration" || version.reason === "data-change" || version.reason === "manual-addition", "Daily plan version reason is invalid.");
                  assert(!versionNumbers.has(version.version), "Daily plan version numbers are duplicated.");
                  versionNumbers.add(version.version);
                  validDate(version.generatedAt, "Daily plan version");
                  assert(Array.isArray(version.items), "Daily plan version items are invalid.");
                  const versionKeys = new Set();
                  for (const item of version.items) {
                      const obligation = obligationMap.get(item.obligationId);
                      assert(obligation, "Daily plan item references a missing obligation.");
                      const unit = unitMap.get(obligation.unitId);
                      assert(unit && item.unitId === unit.id && item.profileId === unit.profileId, "Daily plan item relationships are inconsistent.");
                      assert(profileMap.has(item.profileId), "Daily plan item references a missing profile.");
                      assert(item.workflow === obligation.workflow.kind, "Daily plan item workflow does not match its obligation.");
                      if (item.chunkId) {
                          const chunk = chunkMap.get(item.chunkId);
                          assert(chunk && chunk.obligationId === obligation.id, "Daily plan item references an unrelated chunk.");
                      }
                      assert(item.key === planItemKey(item.obligationId, item.chunkId), "Daily plan item key is inconsistent.");
                      assert(!versionKeys.has(item.key), "Daily plan version contains duplicate items.");
                      versionKeys.add(item.key);
                      assert(typeof item.subject === "string" && item.subject.trim().length > 0 && typeof item.title === "string" && item.title.trim().length > 0, "Daily plan item labels are invalid.");
                      assert(Number.isFinite(item.estimatedMinutes) && item.estimatedMinutes >= 1 && item.estimatedMinutes <= 240, "Daily plan item duration is invalid.");
                      assert(Number.isFinite(item.score) && item.score >= 0 && item.score <= 100, "Daily plan item score is invalid.");
                      assert(item.disposition === "selected" || item.disposition === "required-overrun" || item.disposition === "must-split" || item.disposition === "deferred", "Daily plan item disposition is invalid.");
                      assert(Array.isArray(item.reasons) && item.reasons.every((reason) => typeof reason === "string" && reason.length <= 500), "Daily plan item reasons are invalid.");
                      planKeys.add(item.key);
                      itemByKey.set(item.key, item);
                  }
              }
              assert([...versionNumbers].sort((a, b) => a - b).every((version, index) => version === index + 1), "Daily plan versions must be sequential.");
              const outcomeKeys = new Set();
              for (const outcome of plan.outcomes) {
                  assert(outcome.status === "planned" || outcome.status === "started" || outcome.status === "completed" || outcome.status === "skipped", "Daily plan outcome status is invalid.");
                  assert(planKeys.has(outcome.itemKey), "Daily plan outcome references an unknown item.");
                  assert(!outcomeKeys.has(outcome.itemKey), "Daily plan contains duplicate outcomes for an item.");
                  outcomeKeys.add(outcome.itemKey);
                  if (outcome.startedAt)
                      validDate(outcome.startedAt, "Daily plan outcome");
                  if (outcome.completedAt)
                      validDate(outcome.completedAt, "Daily plan outcome");
                  if (outcome.status === "started")
                      assert(Boolean(outcome.startedAt), "Started daily-plan outcomes require a start time.");
                  if (outcome.startedAt && outcome.completedAt)
                      assert(new Date(outcome.completedAt).getTime() >= new Date(outcome.startedAt).getTime(), "Daily-plan outcome timestamps are inconsistent.");
                  if (outcome.status === "completed") {
                      assert(Number.isFinite(outcome.actualMinutes) && (outcome.actualMinutes ?? 0) > 0 && (outcome.actualMinutes ?? 0) <= 10_080 && Boolean(outcome.completedAt), "Completed daily-plan outcomes require a valid duration and completion time.");
                      const item = itemByKey.get(outcome.itemKey);
                      assert(item, "Completed daily-plan outcome references an unknown item.");
                      if (!item.chunkId) {
                          const event = outcome.evidenceEventId ? evidenceMap.get(outcome.evidenceEventId) : undefined;
                          assert(event?.obligationId === item.obligationId, "Completed parent-plan outcomes require matching retrieval evidence.");
                      }
                      else
                          assert(outcome.evidenceEventId === undefined, "Chunk outcomes cannot claim parent retrieval evidence.");
                  }
              }
          }
          const evidenceCounts = new Map();
          for (const event of evidenceEvents) {
              const count = evidenceCounts.get(event.unitId) ?? { total: 0, lapses: 0 };
              count.total += 1;
              if (event.confirmedRating === Rating.Again)
                  count.lapses += 1;
              evidenceCounts.set(event.unitId, count);
          }
          for (const unit of units) {
              const count = evidenceCounts.get(unit.id) ?? { total: 0, lapses: 0 };
              assert(unit.evidenceCount === count.total && unit.lapseCount === count.lapses, "Knowledge unit evidence counters do not match its history.");
          }
          for (const obligation of obligations) {
              const acceptedExact = evidenceEvents.filter((event) => event.obligationId === obligation.id && event.durationObservation.accepted).length;
              assert(obligation.durationSampleCount === acceptedExact, "Obligation duration sample count does not match its accepted history.");
          }
          let canonicalActive = null;
          if (activeRetrieval) {
              canonicalActive = canonicalActiveRetrievalSession(activeRetrieval);
              assert(canonicalActive.status === "active", "A backup cannot contain a committing or completed retrieval session.");
              assert(canonicalActive.activeIndex < canonicalActive.queueTargetIds.length, "Backup active retrieval index is invalid.");
              assert(canonicalActive.activeTargetId === canonicalActive.queueTargetIds[canonicalActive.activeIndex], "Backup active retrieval target is inconsistent.");
              const validTarget = (targetId) => targetId.startsWith("chunk:")
                  ? chunkMap.has(targetId.slice(6))
                  : obligationMap.has(targetId);
              assert(canonicalActive.queueTargetIds.every(validTarget), "Backup active retrieval references an unknown target.");
          }
          assertDocumentSchema(settings, "Backup settings");
          assert(settings.key === "app" && (profileMap.size === 0 ? settings.activeProfileId === "" : profileMap.has(settings.activeProfileId)), "Backup settings reference an invalid active profile.");
          canonicalFsrsSchedulingSettings(settings.fsrsScheduling);
          const memoryDifficultyPolicy = canonicalMemoryDifficultyPolicy(settings.memoryDifficultyPolicy);
          for (const obligation of obligations) {
              if (obligation.suspensionReason !== "persistent-difficulty")
                  continue;
              assert(memoryDifficultyAssessment(obligation, memoryDifficultyPolicy).automaticHoldEligible, "Persistent-difficulty hold is not justified by the active automatic-hold policy.");
          }
          assert(Number.isFinite(settings.dailyCapacityMinutes) && settings.dailyCapacityMinutes >= 5 && settings.dailyCapacityMinutes <= 600, "Daily revision capacity is invalid.");
          assert(Number.isInteger(settings.studyDayBoundaryHour) && settings.studyDayBoundaryHour >= 0 && settings.studyDayBoundaryHour <= 12, "Study-day boundary is invalid.");
          return {
              format: BACKUP_FORMAT,
              schemaVersion: BACKUP_SCHEMA_VERSION,
              exportedAt: canonicalIso(requiredString(candidate["exportedAt"], "Backup export date"), "Backup export date"),
              appVersion,
              profiles,
              nodes,
              units,
              studyEvents,
              obligations,
              evidenceEvents,
              chunks,
              dailyPlans,
              settings,
              activeRetrieval: canonicalActive,
          };
      }
      async importBackup(input) {
          const payload = this.validateBackup(input);
          await this.repo.replaceFromBackup(payload, "discard");
          this.settings = clone(payload.settings);
          this.invalidateMemoryReviewAnalysis();
      }
  }
  /* ==========================================================================
     USER INTERFACE CONTROLLER
     ========================================================================== */

  const BACKUP_ARCHIVE_FORMAT = "revision-director-backup-archive";
  const BACKUP_ARCHIVE_VERSION = 2;
  const BACKUP_ARCHIVE_MIME = "application/x-revision-director-backup";
  const BACKUP_ARCHIVE_MAX_FILE_BYTES = 64 * 1024 * 1024;
  const BACKUP_ARCHIVE_MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
  const BACKUP_ARCHIVE_MAX_LINE_BYTES = 2 * 1024 * 1024;
  const BACKUP_ARCHIVE_MAX_DOCUMENT_BYTES = 1024 * 1024;
  const BACKUP_ARCHIVE_CHUNK_TARGET_BYTES = 512 * 1024;
  const BACKUP_ARCHIVE_CHUNK_MAX_ITEMS = 100;
  const BACKUP_ARCHIVE_MAX_CHUNKS = 50_000;
  const BACKUP_ARCHIVE_COUNT_LIMITS = Object.freeze({
      profiles: 2_000,
      nodes: 250_000,
      units: 125_000,
      studyEvents: 1_000_000,
      obligations: 250_000,
      evidenceEvents: 2_000_000,
      chunks: 1_000_000,
      dailyPlans: 100_000,
      settings: 1,
      activeRetrieval: 1,
  });
  const BACKUP_ENTITY_ORDER = Object.freeze([
      "profiles", "nodes", "units", "studyEvents", "obligations", "evidenceEvents", "chunks", "dailyPlans", "settings", "activeRetrieval",
  ]);
  class BackupCodec {
      static encode(value) {
          return utf8Bytes(value);
      }
      static async create(payload, preferCompression = true) {
          const collections = this.payloadCollections(payload);
          const counts = this.countCollections(collections);
          this.assertCountsWithinLimits(counts);
          const hashAlgorithm = "sha256";
          const compression = preferCompression && typeof CompressionStream !== "undefined" ? "gzip" : "none";
          const chunkBodies = [];
          for (const entityType of BACKUP_ENTITY_ORDER) {
              const items = collections[entityType];
              let group = [];
              let groupBytes = 0;
              const flush = () => {
                  if (!group.length)
                      return;
                  chunkBodies.push({ kind: "chunk", sequence: chunkBodies.length, entityType, count: group.length, items: group });
                  group = [];
                  groupBytes = 0;
              };
              for (const item of items) {
                  const itemBytes = this.encode(JSON.stringify(item)).byteLength;
                  assert(itemBytes <= BACKUP_ARCHIVE_MAX_DOCUMENT_BYTES, `${entityType} contains a document larger than the backup limit.`);
                  if (group.length && (group.length >= BACKUP_ARCHIVE_CHUNK_MAX_ITEMS || groupBytes + itemBytes > BACKUP_ARCHIVE_CHUNK_TARGET_BYTES))
                      flush();
                  group.push(item);
                  groupBytes += itemBytes;
              }
              flush();
          }
          assert(chunkBodies.length <= BACKUP_ARCHIVE_MAX_CHUNKS, "Backup contains too many chunks.");
          const chunks = [];
          const chunkHashes = [];
          for (const body of chunkBodies) {
              const checksum = await this.hashJson(body, hashAlgorithm);
              chunks.push({ ...body, checksum });
              chunkHashes.push(checksum);
          }
          const stateChecksum = await this.stateFingerprint(payload, hashAlgorithm);
          const manifest = {
              kind: "manifest",
              format: BACKUP_ARCHIVE_FORMAT,
              version: BACKUP_ARCHIVE_VERSION,
              exportedAt: payload.exportedAt,
              appVersion: payload.appVersion,
              payloadFormat: BACKUP_FORMAT,
              payloadSchemaVersion: BACKUP_SCHEMA_VERSION,
              compression,
              hashAlgorithm,
              chunkTargetBytes: BACKUP_ARCHIVE_CHUNK_TARGET_BYTES,
              chunkMaxItems: BACKUP_ARCHIVE_CHUNK_MAX_ITEMS,
              chunkCount: chunks.length,
              counts,
              stateChecksum,
          };
          const completionBody = { kind: "complete", chunkCount: chunks.length, counts, chunkHashes };
          const completion = { ...completionBody, checksum: await this.hashJson({ manifest, ...completionBody }, hashAlgorithm) };
          const lines = [manifest, ...chunks, completion].map((line) => JSON.stringify(line));
          for (const line of lines)
              assert(this.encode(line).byteLength <= BACKUP_ARCHIVE_MAX_LINE_BYTES, "Backup contains an oversized archive line.");
          const expanded = this.encode(`${lines.join("\n")}\n`);
          assert(expanded.byteLength <= BACKUP_ARCHIVE_MAX_EXPANDED_BYTES, "Backup exceeds the expanded-size limit.");
          const bytes = compression === "gzip" ? await this.compress(expanded) : expanded;
          assert(bytes.byteLength <= BACKUP_ARCHIVE_MAX_FILE_BYTES, "Backup exceeds the file-size limit.");
          const inspection = this.inspection(manifest, completion.checksum, payload.activeRetrieval?.status ?? "none", bytes.byteLength, expanded.byteLength, []);
          return { bytes, inspection };
      }
      static async decode(bytes, validate) {
          assert(bytes.byteLength > 0, "Backup file is empty.");
          assert(bytes.byteLength <= BACKUP_ARCHIVE_MAX_FILE_BYTES, "Backup exceeds the file-size limit.");
          const detectedCompression = bytes[0] === 0x1f && bytes[1] === 0x8b ? "gzip" : "none";
          const expanded = detectedCompression === "gzip" ? await this.decompressBounded(bytes) : bytes;
          assert(expanded.byteLength <= BACKUP_ARCHIVE_MAX_EXPANDED_BYTES, "Backup exceeds the expanded-size limit.");
          let text;
          try {
              text = new TextDecoder("utf-8", { fatal: true }).decode(expanded);
          }
          catch {
              throw new Error("Backup is not valid UTF-8.");
          }
          const rawLines = text.split("\n");
          if (rawLines.at(-1) === "")
              rawLines.pop();
          assert(rawLines.length >= 2, "Backup archive is incomplete.");
          const parsed = [];
          for (const raw of rawLines) {
              assert(this.encode(raw).byteLength <= BACKUP_ARCHIVE_MAX_LINE_BYTES, "Backup contains an oversized archive line.");
              try {
                  parsed.push(JSON.parse(raw));
              }
              catch {
                  throw new Error("Backup contains invalid JSON lines.");
              }
          }
          const manifest = this.parseManifest(parsed[0]);
          assert(manifest.compression === detectedCompression, "Backup compression metadata does not match the file.");
          assert(manifest.chunkCount <= BACKUP_ARCHIVE_MAX_CHUNKS, "Backup contains too many chunks.");
          this.assertCountsWithinLimits(manifest.counts);
          assert(parsed.length === manifest.chunkCount + 2, "Backup chunk count does not match its manifest.");
          const completion = this.parseCompletion(parsed.at(-1));
          const collections = this.emptyCollections();
          const actualCounts = this.zeroCounts();
          const chunkHashes = [];
          for (let index = 0; index < manifest.chunkCount; index += 1) {
              const chunk = this.parseChunk(parsed[index + 1]);
              assert(chunk.sequence === index, "Backup chunks are out of order.");
              assert(chunk.count === chunk.items.length, "Backup chunk item count is inconsistent.");
              assert(chunk.count > 0 && chunk.count <= BACKUP_ARCHIVE_CHUNK_MAX_ITEMS, "Backup chunk size is invalid.");
              const body = { kind: chunk.kind, sequence: chunk.sequence, entityType: chunk.entityType, count: chunk.count, items: chunk.items };
              const expected = await this.hashJson(body, manifest.hashAlgorithm);
              assert(chunk.checksum === expected, `Backup chunk ${index} failed integrity verification.`);
              for (const item of chunk.items) {
                  assert(this.encode(JSON.stringify(item)).byteLength <= BACKUP_ARCHIVE_MAX_DOCUMENT_BYTES, `${chunk.entityType} contains a document larger than the backup limit.`);
                  collections[chunk.entityType].push(item);
              }
              actualCounts[chunk.entityType] += chunk.count;
              assert(actualCounts[chunk.entityType] <= BACKUP_ARCHIVE_COUNT_LIMITS[chunk.entityType], `${chunk.entityType} exceeds its record-count limit.`);
              chunkHashes.push(chunk.checksum);
          }
          assert(this.sameCounts(actualCounts, manifest.counts), "Backup entity counts do not match its manifest.");
          assert(completion.chunkCount === manifest.chunkCount && this.sameCounts(completion.counts, manifest.counts), "Backup completion counts are inconsistent.");
          assert(completion.chunkHashes.length === chunkHashes.length && completion.chunkHashes.every((value, index) => value === chunkHashes[index]), "Backup completion proof does not match its chunks.");
          const completionBody = { kind: "complete", chunkCount: completion.chunkCount, counts: completion.counts, chunkHashes: completion.chunkHashes };
          const expectedCompletion = await this.hashJson({ manifest, ...completionBody }, manifest.hashAlgorithm);
          assert(completion.checksum === expectedCompletion, "Backup final checksum failed verification.");
          assert(collections.settings.length === 1, "Backup must contain exactly one settings document.");
          const candidate = {
              format: manifest.payloadFormat,
              schemaVersion: manifest.payloadSchemaVersion,
              exportedAt: manifest.exportedAt,
              appVersion: manifest.appVersion,
              profiles: collections.profiles,
              nodes: collections.nodes,
              units: collections.units,
              studyEvents: collections.studyEvents,
              obligations: collections.obligations,
              evidenceEvents: collections.evidenceEvents,
              chunks: collections.chunks,
              dailyPlans: collections.dailyPlans,
              settings: collections.settings[0],
              activeRetrieval: collections.activeRetrieval[0] ?? null,
          };
          const payload = validate(candidate);
          const warnings = [];
          const stateChecksum = await this.stateFingerprint(payload, manifest.hashAlgorithm);
          assert(stateChecksum === manifest.stateChecksum, "Backup state checksum failed verification.");
          return { payload, inspection: this.inspection(manifest, completion.checksum, payload.activeRetrieval?.status ?? "none", bytes.byteLength, expanded.byteLength, warnings) };
      }
      static payloadCollections(payload) {
          return {
              profiles: payload.profiles,
              nodes: payload.nodes,
              units: payload.units,
              studyEvents: payload.studyEvents,
              obligations: payload.obligations,
              evidenceEvents: payload.evidenceEvents,
              chunks: payload.chunks,
              dailyPlans: payload.dailyPlans,
              settings: [payload.settings],
              activeRetrieval: payload.activeRetrieval ? [payload.activeRetrieval] : [],
          };
      }
      static emptyCollections() {
          return { profiles: [], nodes: [], units: [], studyEvents: [], obligations: [], evidenceEvents: [], chunks: [], dailyPlans: [], settings: [], activeRetrieval: [] };
      }
      static zeroCounts() {
          return { profiles: 0, nodes: 0, units: 0, studyEvents: 0, obligations: 0, evidenceEvents: 0, chunks: 0, dailyPlans: 0, settings: 0, activeRetrieval: 0 };
      }
      static countCollections(collections) {
          const counts = this.zeroCounts();
          for (const key of BACKUP_ENTITY_ORDER)
              counts[key] = collections[key].length;
          return counts;
      }
      static assertCountsWithinLimits(counts) {
          for (const key of BACKUP_ENTITY_ORDER) {
              assert(Number.isInteger(counts[key]) && counts[key] >= 0 && counts[key] <= BACKUP_ARCHIVE_COUNT_LIMITS[key], `${key} exceeds its record-count limit.`);
          }
          assert(counts.settings === 1, "Backup must contain exactly one settings document.");
          assert(counts.activeRetrieval === 0 || counts.activeRetrieval === 1, "Backup may contain at most one active retrieval session.");
      }
      static sameCounts(left, right) {
          return BACKUP_ENTITY_ORDER.every((key) => left[key] === right[key]);
      }
      static parseManifest(input) {
          const value = requireRecord(input, "Backup manifest");
          assert(value["kind"] === "manifest" && value["format"] === BACKUP_ARCHIVE_FORMAT && value["version"] === BACKUP_ARCHIVE_VERSION, "This is not a supported Revision Director backup archive.");
          const appVersion = canonicalId(requiredString(value["appVersion"], "Backup application version"), "Backup application version");
          assert(value["payloadFormat"] === BACKUP_FORMAT && value["payloadSchemaVersion"] === BACKUP_SCHEMA_VERSION, "Backup payload version is unsupported.");
          const compression = literalChoice(value["compression"], ["none", "gzip"], "Backup compression metadata");
          const hashAlgorithm = literalChoice(value["hashAlgorithm"], ["sha256"], "Backup hash algorithm");
          assert(value["chunkTargetBytes"] === BACKUP_ARCHIVE_CHUNK_TARGET_BYTES && value["chunkMaxItems"] === BACKUP_ARCHIVE_CHUNK_MAX_ITEMS, "Backup chunk contract is unsupported.");
          const chunkCount = value["chunkCount"];
          assert(typeof chunkCount === "number" && Number.isInteger(chunkCount) && chunkCount >= 0, "Backup manifest chunk count is invalid.");
          const stateChecksum = value["stateChecksum"];
          assert(typeof stateChecksum === "string" && /^[0-9a-f]{16,64}$/.test(stateChecksum), "Backup state checksum is invalid.");
          return {
              kind: "manifest",
              format: BACKUP_ARCHIVE_FORMAT,
              version: BACKUP_ARCHIVE_VERSION,
              exportedAt: canonicalIso(requiredString(value["exportedAt"], "Backup export date"), "Backup export date"),
              appVersion,
              payloadFormat: BACKUP_FORMAT,
              payloadSchemaVersion: BACKUP_SCHEMA_VERSION,
              compression,
              hashAlgorithm,
              chunkTargetBytes: BACKUP_ARCHIVE_CHUNK_TARGET_BYTES,
              chunkMaxItems: BACKUP_ARCHIVE_CHUNK_MAX_ITEMS,
              chunkCount,
              counts: this.parseCounts(value["counts"]),
              stateChecksum,
          };
      }
      static parseCounts(input) {
          const value = requireRecord(input, "Backup counts");
          const counts = this.zeroCounts();
          for (const key of BACKUP_ENTITY_ORDER) {
              const count = value[key];
              assert(typeof count === "number" && Number.isInteger(count) && count >= 0, `Backup ${key} count is invalid.`);
              counts[key] = count;
          }
          return counts;
      }
      static parseChunk(input) {
          const value = requireRecord(input, "Backup chunk");
          const sequence = value["sequence"];
          assert(value["kind"] === "chunk" && typeof sequence === "number" && Number.isInteger(sequence) && sequence >= 0, "Backup chunk sequence is invalid.");
          const entityType = literalChoice(value["entityType"], BACKUP_ENTITY_ORDER, "Backup chunk entity type");
          const count = value["count"];
          const items = value["items"];
          assert(typeof count === "number" && Number.isInteger(count) && Array.isArray(items), "Backup chunk contents are invalid.");
          const checksum = value["checksum"];
          assert(typeof checksum === "string" && /^[0-9a-f]{16,64}$/.test(checksum), "Backup chunk checksum is invalid.");
          return { kind: "chunk", sequence, entityType, count, items, checksum };
      }
      static parseCompletion(input) {
          const value = requireRecord(input, "Backup completion proof");
          const chunkCount = value["chunkCount"];
          assert(value["kind"] === "complete" && typeof chunkCount === "number" && Number.isInteger(chunkCount) && chunkCount >= 0, "Backup completion proof is invalid.");
          const chunkHashes = value["chunkHashes"];
          assert(Array.isArray(chunkHashes) && chunkHashes.every((hash) => typeof hash === "string" && /^[0-9a-f]{16,64}$/.test(hash)), "Backup completion hashes are invalid.");
          const checksum = value["checksum"];
          assert(typeof checksum === "string" && /^[0-9a-f]{16,64}$/.test(checksum), "Backup final checksum is invalid.");
          return { kind: "complete", chunkCount, counts: this.parseCounts(value["counts"]), chunkHashes, checksum };
      }
      static inspection(manifest, archiveChecksum, activeRetrievalStatus, compressedBytes, expandedBytes, warnings) {
          return {
              verified: true, format: manifest.format, version: manifest.version, exportedAt: manifest.exportedAt, appVersion: manifest.appVersion,
              payloadFormat: manifest.payloadFormat, payloadSchemaVersion: manifest.payloadSchemaVersion,
              compression: manifest.compression, hashAlgorithm: manifest.hashAlgorithm,
              compressedBytes, expandedBytes, chunkCount: manifest.chunkCount,
              totalDocuments: BACKUP_ENTITY_ORDER.reduce((sum, key) => sum + manifest.counts[key], 0),
              counts: clone(manifest.counts), warnings: [...warnings], archiveChecksum, stateChecksum: manifest.stateChecksum, activeRetrievalStatus,
          };
      }
      static async stateFingerprint(payload, algorithm = "sha256") {
          const stable = {
              format: payload.format,
              schemaVersion: payload.schemaVersion,
              profiles: payload.profiles,
              nodes: payload.nodes,
              units: payload.units,
              studyEvents: payload.studyEvents,
              obligations: payload.obligations,
              evidenceEvents: payload.evidenceEvents,
              chunks: payload.chunks,
              dailyPlans: payload.dailyPlans,
              settings: payload.settings,
              activeRetrieval: payload.activeRetrieval,
          };
          return this.hashJson(stable, algorithm);
      }
      static async opaqueFingerprint(value) {
          return this.hashJson(value, "sha256");
      }
      static async hashJson(value, algorithm) {
          return this.hashBytes(this.encode(JSON.stringify(value)), algorithm);
      }
      static async hashBytes(bytes, _algorithm) {
          return sha256Hex(bytes);
      }
      static async compress(bytes) {
          const stream = new Blob([ownedArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
          return this.readStreamBounded(stream, BACKUP_ARCHIVE_MAX_FILE_BYTES, "Backup exceeds the file-size limit.");
      }
      static async decompressBounded(bytes) {
          assert(typeof DecompressionStream !== "undefined", "This browser cannot decompress gzip backups.");
          const stream = new Blob([ownedArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
          return this.readStreamBounded(stream, BACKUP_ARCHIVE_MAX_EXPANDED_BYTES, "Backup exceeds the expanded-size limit.");
      }
      static async readStreamBounded(stream, limit, message) {
          const reader = stream.getReader();
          const chunks = [];
          let total = 0;
          try {
              while (true) {
                  const next = await reader.read();
                  if (next.done)
                      break;
                  if (!next.value)
                      continue;
                  total += next.value.byteLength;
                  if (total > limit) {
                      await reader.cancel(message);
                      throw new Error(message);
                  }
                  chunks.push(next.value);
              }
          }
          finally {
              reader.releaseLock();
          }
          const result = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
              result.set(chunk, offset);
              offset += chunk.byteLength;
          }
          return result;
      }
  }
  /* ==========================================================================
     UI RUNTIME & ACCESSIBILITY
     ========================================================================== */

  const BACKUP_SAFETY_PROOF_TTL_MS = 30 * 60_000;
  const BACKUP_RESCUE_MAX_BYTES = 64 * 1024 * 1024;
  const BACKUP_RESCUE_MIME = "application/x-revision-director-rescue";
  class BackupController {
      service;
      candidates = new Map();
      proofs = new Map();
      constructor(service) {
          this.service = service;
      }
      async createVerified(preferCompression = true) {
          const active = await this.service.currentActiveRetrieval();
          assert(active?.status !== "committing", "Finish or recover the Evidence commit before creating a backup.");
          const artifact = await this.service.createBackupArchive(preferCompression);
          const decoded = await this.service.decodeBackupArchive(artifact.bytes);
          assert(decoded.inspection.archiveChecksum === artifact.inspection.archiveChecksum, "Created backup failed archive self-verification.");
          assert(decoded.inspection.stateChecksum === artifact.inspection.stateChecksum, "Created backup failed state self-verification.");
          assert(decoded.inspection.totalDocuments === artifact.inspection.totalDocuments, "Created backup document count changed during verification.");
          return { bytes: artifact.bytes.slice(), inspection: clone(artifact.inspection) };
      }
      async inspect(bytes) {
          const stableBytes = bytes.slice();
          const decoded = await this.service.decodeBackupArchive(stableBytes);
          assert(decoded.payload.activeRetrieval?.status !== "committing", "A backup containing a committing retrieval cannot be restored.");
          const candidate = {
              id: uid("backup_candidate"),
              inspectedAt: nowIso(),
              bytes: stableBytes,
              payload: clone(decoded.payload),
              inspection: clone(decoded.inspection),
          };
          this.candidates.clear();
          this.proofs.clear();
          this.candidates.set(candidate.id, candidate);
          return this.publicCandidate(candidate);
      }
      candidate(id) {
          const candidate = this.candidates.get(id);
          assert(candidate, "The inspected backup is no longer available. Select the file again.");
          return this.publicCandidate(candidate);
      }
      async createSafetyCopy(candidateId) {
          const candidate = this.requireCandidate(candidateId);
          const currentActive = await this.service.currentActiveRetrieval();
          assert(currentActive?.status !== "committing", "A retrieval Evidence commit is in progress. Finish recovery before restoring data.");
          const createdAt = nowIso();
          const expiresAt = new Date(Date.now() + BACKUP_SAFETY_PROOF_TTL_MS).toISOString();
          let artifact;
          let fingerprint;
          try {
              const verified = await this.createVerified(true);
              const verifiedPayload = (await this.service.decodeBackupArchive(verified.bytes)).payload;
              fingerprint = await BackupCodec.stateFingerprint(verifiedPayload, "sha256");
              artifact = {
                  proofId: "",
                  kind: "verified-backup",
                  filename: `revision-director-safety-${createdAt.slice(0, 10)}.rdbackup`,
                  mimeType: BACKUP_ARCHIVE_MIME,
                  bytes: verified.bytes,
                  createdAt,
                  expiresAt,
                  acknowledged: false,
              };
          }
          catch (error) {
              const rescue = await this.createForensicRescue(error);
              fingerprint = rescue.fingerprint;
              artifact = {
                  proofId: "",
                  kind: "forensic-rescue",
                  filename: `revision-director-forensic-rescue-${createdAt.slice(0, 10)}.rdrescue`,
                  mimeType: BACKUP_RESCUE_MIME,
                  bytes: rescue.bytes,
                  createdAt,
                  expiresAt,
                  acknowledged: false,
                  warning: "The current database could not produce a verified backup. This forensic rescue preserves raw local state but cannot be imported automatically.",
              };
          }
          const proofId = uid("safety_proof");
          artifact.proofId = proofId;
          const proof = {
              id: proofId,
              candidateId: candidate.id,
              candidateArchiveChecksum: candidate.inspection.archiveChecksum,
              kind: artifact.kind,
              currentStateFingerprint: fingerprint,
              createdAt,
              expiresAt,
              acknowledged: false,
              consumed: false,
              artifact: { ...artifact, bytes: artifact.bytes.slice() },
          };
          this.proofs.clear();
          this.proofs.set(proofId, proof);
          return this.publicArtifact(proof.artifact);
      }
      acknowledgeSafetyCopy(proofId) {
          const proof = this.requireProof(proofId);
          assert(!proof.consumed, "This safety copy has already been used.");
          assert(Date.now() <= new Date(proof.expiresAt).getTime(), "The safety-copy proof expired. Create a new safety copy.");
          proof.acknowledged = true;
          proof.artifact.acknowledged = true;
          return this.publicArtifact(proof.artifact);
      }
      async restore(candidateId, proofId, treatment) {
          const candidate = this.requireCandidate(candidateId);
          const proof = this.requireProof(proofId);
          assert(!proof.consumed, "This safety-copy proof has already been used.");
          assert(proof.acknowledged, "Confirm that the current-state safety copy was saved.");
          assert(Date.now() <= new Date(proof.expiresAt).getTime(), "The safety-copy proof expired. Create a new safety copy.");
          assert(proof.candidateId === candidate.id && proof.candidateArchiveChecksum === candidate.inspection.archiveChecksum, "The safety copy does not belong to this inspected backup.");
          const currentActive = await this.service.currentActiveRetrieval();
          assert(currentActive?.status !== "committing", "A retrieval Evidence commit is in progress. Restore is blocked.");
          await this.verifyCurrentStateStillMatches(proof);
          const decoded = await this.service.decodeBackupArchive(candidate.bytes);
          assert(decoded.inspection.archiveChecksum === candidate.inspection.archiveChecksum, "The inspected backup changed before restoration.");
          if (decoded.payload.activeRetrieval)
              assert(treatment === "restore" || treatment === "discard", "Choose how to treat the unfinished retrieval.");
          else
              assert(treatment === "discard", "This backup has no unfinished retrieval to restore.");
          await this.service.restoreBackupPayload(decoded.payload, treatment);
          proof.consumed = true;
          this.candidates.delete(candidate.id);
          return {
              inspection: clone(decoded.inspection),
              restoredActiveRetrieval: treatment === "restore" ? clone(decoded.payload.activeRetrieval) : null,
          };
      }
      cancel(candidateId) {
          if (candidateId)
              this.candidates.delete(candidateId);
          else
              this.candidates.clear();
          this.proofs.clear();
      }
      async verifyCurrentStateStillMatches(proof) {
          if (proof.kind === "verified-backup") {
              const payload = this.service.validateBackup(await this.service.exportBackup());
              const current = await BackupCodec.stateFingerprint(payload, "sha256");
              assert(current === proof.currentStateFingerprint, "Current application data changed after the safety copy was created. Create a new safety copy.");
              return;
          }
          const raw = await this.captureForensicState("verify safety proof");
          const current = await BackupCodec.opaqueFingerprint(raw.fingerprintSource);
          assert(current === proof.currentStateFingerprint, "Current raw application state changed after the forensic rescue was created. Create a new rescue copy.");
      }
      async createForensicRescue(error) {
          const captured = await this.captureForensicState(error instanceof Error ? error.message : String(error));
          const envelope = {
              format: "revision-director-forensic-rescue",
              version: 1,
              createdAt: nowIso(),
              appVersion: APP_VERSION,
              importable: false,
              reason: captured.reason,
              rawStores: captured.rawStores,
              emergencyRecovery: captured.emergencyRecovery,
              diagnostics: captured.diagnostics,
          };
          const bytes = new TextEncoder().encode(JSON.stringify(envelope, null, 2));
          assert(bytes.byteLength <= BACKUP_RESCUE_MAX_BYTES, "The forensic rescue exceeds the safety size limit.");
          return { bytes, fingerprint: await BackupCodec.opaqueFingerprint(captured.fingerprintSource) };
      }
      async captureForensicState(reason) {
          const rawStores = await this.service.rawStateForRescue();
          let emergencyRecovery = null;
          try {
              emergencyRecovery = localStorage.getItem(ACTIVE_RETRIEVAL_RECOVERY_KEY);
          }
          catch {
              emergencyRecovery = null;
          }
          const diagnostics = this.service.diagnostics();
          return {
              reason,
              rawStores,
              emergencyRecovery,
              diagnostics,
              fingerprintSource: { rawStores, emergencyRecovery, diagnostics },
          };
      }
      requireCandidate(id) {
          const candidate = this.candidates.get(id);
          assert(candidate, "The inspected backup is no longer available. Select it again.");
          return candidate;
      }
      requireProof(id) {
          const proof = this.proofs.get(id);
          assert(proof, "The safety-copy proof is unavailable. Create the safety copy again.");
          return proof;
      }
      publicCandidate(candidate) {
          return {
              id: candidate.id,
              inspectedAt: candidate.inspectedAt,
              bytes: candidate.bytes.slice(),
              payload: clone(candidate.payload),
              inspection: clone(candidate.inspection),
          };
      }
      publicArtifact(artifact) {
          return { ...artifact, bytes: artifact.bytes.slice() };
      }
  }

  /* ==========================================================================
     PASS E1 · PUBLIC CAPABILITY API AND OPTIONAL PLUGIN RUNTIME
     ========================================================================== */
  const REVISION_DIRECTOR_PUBLIC_API_VERSION = 1;
  const REVISION_DIRECTOR_READY_EVENT = "revisiondirector:ready";
  const REVISION_DIRECTOR_PLUGIN_STATUS_EVENT = "revisiondirector:plugins-changed";
  const LOCAL_PLUGIN_MAX_FILES = 5;
  const LOCAL_PLUGIN_MAX_BYTES = 1 * 1024 * 1024;
  const PLUGIN_MAX_REGISTRATION_ATTEMPTS = 2;
  const REVISION_DIRECTOR_CAPABILITIES = Object.freeze({
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
  const REVISION_DIRECTOR_PUBLIC_DATA_CONTRACT = Object.freeze({
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
  function publicPluginText(value, maximum) {
      return String(value ?? "").trim().slice(0, maximum);
  }
  function publicPluginRequirements(value) {
      if (value === undefined)
          return Object.freeze({});
      assert(typeof value === "object" && value !== null && !Array.isArray(value), "Plugin capability requirements must be an object.");
      const out = Object.create(null);
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
      service;
      ownership;
      registrations = new Map();
      localFiles = new Map();
      publicApiValue;
      registrationRevision = 0;
      constructor(service, ownership) {
          this.service = service;
          this.ownership = ownership;
      }
      installPublicApi() {
          assert(!this.publicApiValue, "Revision Director public API is already installed.");
          const records = Object.freeze({
              getDueSummary: () => this.getDueSummary(),
              listProfiles: () => this.listProfiles(),
          });
          const intake = Object.freeze({
              importStudyEvent: (payload) => this.importStudyEvent(payload),
              createRevisionCandidate: (payload) => this.createRevisionCandidate(payload),
          });
          const runtime = Object.freeze({
              ownership: () => Object.freeze(clone(this.ownership.snapshot())),
              storageHealth: () => Object.freeze(clone(this.service.storageHealth())),
          });
          const plugins = Object.freeze({
              status: () => this.status(),
              loadLocalFiles: (files) => this.loadLocalFiles(files),
          });
          const api = Object.freeze({
              version: APP_VERSION,
              apiVersion: REVISION_DIRECTOR_PUBLIC_API_VERSION,
              capabilities: REVISION_DIRECTOR_CAPABILITIES,
              data: Object.freeze({ contract: REVISION_DIRECTOR_PUBLIC_DATA_CONTRACT }),
              records,
              intake,
              runtime,
              plugins,
              registerPlugin: (plugin) => this.register(plugin),
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
      announceReady() {
          assert(this.publicApiValue, "Revision Director public API is not installed.");
          window.dispatchEvent(new CustomEvent(REVISION_DIRECTOR_READY_EVENT, {
              detail: Object.freeze({
                  version: APP_VERSION,
                  apiVersion: REVISION_DIRECTOR_PUBLIC_API_VERSION,
                  capabilities: REVISION_DIRECTOR_CAPABILITIES,
              }),
          }));
      }
      status() {
          return Object.freeze({
              registered: Object.freeze([...this.registrations.values()].map((entry) => Object.freeze(clone(entry))).sort((a, b) => a.name.localeCompare(b.name))),
              localFiles: Object.freeze([...this.localFiles.values()].map((entry) => Object.freeze(clone(entry))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
          });
      }
      async register(input) {
          if (!isRecord(input) || typeof input["setup"] !== "function")
              return false;
          const setup = input["setup"];
          const name = publicPluginText(input["name"], 80);
          if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(name))
              return false;
          const version = publicPluginText(input["version"], 40);
          const previous = this.registrations.get(name);
          if (previous?.state === "registered")
              return true;
          if (previous?.state === "incompatible")
              return false;
          const attempts = previous?.attempts ?? 0;
          if (attempts >= PLUGIN_MAX_REGISTRATION_ATTEMPTS)
              return false;
          const nextAttempt = attempts + 1;
          let requirements;
          try {
              requirements = publicPluginRequirements(input["requires"]);
          }
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
          }
          catch (error) {
              this.setRegistration({ name, version, state: "failed", attempts: nextAttempt, detail: publicPluginText(error instanceof Error ? error.message : error, 240), updatedAt: nowIso() });
              return false;
          }
      }
      async loadLocalFiles(files) {
          assert(this.ownership.canMutate(), "Revision Director is read-only in this tab. Take control before loading a plugin.");
          assert(Array.isArray(files), "Select one or more local JavaScript plugin files.");
          assert(files.length >= 1 && files.length <= LOCAL_PLUGIN_MAX_FILES, `Select between 1 and ${LOCAL_PLUGIN_MAX_FILES} plugin files.`);
          const results = [];
          for (const file of files)
              results.push(await this.loadLocalFile(file));
          return Object.freeze(results.map((entry) => Object.freeze(clone(entry))));
      }
      requirePublicApi() {
          assert(this.publicApiValue, "Revision Director public API is unavailable.");
          return this.publicApiValue;
      }
      setRegistration(status) {
          this.registrations.set(status.name, Object.freeze({ ...status }));
          this.signalStatusChanged();
      }
      setFile(status) {
          const frozen = Object.freeze({ ...status });
          this.localFiles.set(status.id, frozen);
          this.signalStatusChanged();
          return frozen;
      }
      signalStatusChanged() {
          window.dispatchEvent(new CustomEvent(REVISION_DIRECTOR_PLUGIN_STATUS_EVENT, { detail: this.status() }));
      }
      async loadLocalFile(file) {
          const name = publicPluginText(file?.name, 160);
          const id = `${name}:${Number(file?.size) || 0}:${Number(file?.lastModified) || 0}`;
          const prior = this.localFiles.get(id);
          if (prior && ["loaded", "inactive", "loading"].includes(prior.state))
              return prior;
          const reject = (detail) => this.setFile({ id, name: name || "unnamed.js", size: Number(file?.size) || 0, state: "rejected", detail, updatedAt: nowIso() });
          if (!(file instanceof File))
              return reject("The selected item is not a local file.");
          if (!/\.js$/i.test(name))
              return reject("Plugin files must use the .js extension.");
          if (!file.size || file.size > LOCAL_PLUGIN_MAX_BYTES)
              return reject(`Plugin files must be between 1 byte and ${LOCAL_PLUGIN_MAX_BYTES} bytes.`);
          this.setFile({ id, name, size: file.size, state: "loading", detail: "", updatedAt: nowIso() });
          const registrationsBefore = this.registrationRevision;
          const url = URL.createObjectURL(file);
          let executionError = "";
          const captureError = (event) => {
              if (event.filename === url || String(event.filename || "").startsWith("blob:")) {
                  executionError = publicPluginText(event.error instanceof Error ? event.error.message : event.message, 240) || "Plugin execution failed.";
                  event.preventDefault();
              }
          };
          window.addEventListener("error", captureError);
          try {
              await new Promise((resolve, rejectPromise) => {
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
              if (executionError)
                  throw new Error(executionError);
              const registered = this.registrationRevision > registrationsBefore;
              return this.setFile({
                  id,
                  name,
                  size: file.size,
                  state: registered ? "loaded" : "inactive",
                  detail: registered ? "Plugin file evaluated and registration was received." : "Plugin file evaluated but did not register a plugin.",
                  updatedAt: nowIso(),
              });
          }
          catch (error) {
              return this.setFile({ id, name, size: file.size, state: "failed", detail: publicPluginText(error instanceof Error ? error.message : error, 240), updatedAt: nowIso() });
          }
          finally {
              window.removeEventListener("error", captureError);
              URL.revokeObjectURL(url);
          }
      }
      async getDueSummary() {
          const due = await this.service.dueQueue();
          const byType = Object.create(null);
          for (const item of due)
              byType[item.obligation.type] = (byType[item.obligation.type] ?? 0) + 1;
          return Object.freeze({
              dueCount: due.length,
              estimatedMinutes: due.reduce((sum, item) => sum + item.obligation.expectedMinutes, 0),
              byType: Object.freeze({ ...byType }),
          });
      }
      async listProfiles() {
          return Object.freeze((await this.service.profiles()).map((profile) => Object.freeze({
              id: profile.id,
              name: profile.name,
              examDate: profile.examDate,
              status: profile.status,
          })));
      }
      async importStudyEvent(input) {
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
          const optionalText = (key) => {
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
      async createRevisionCandidate(input) {
          assert(this.ownership.canMutate(), "Revision Director is read-only in this tab. Take control before creating revision candidates.");
          const payload = requireRecord(input, "Revision candidate");
          const requiredText = (key) => {
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
          return Object.freeze({ unitId: unit.id });
      }
  }

  /* ==========================================================================
     PASS C2 · UI RUNTIME, RENDER COORDINATION AND ACCESSIBILITY
     ========================================================================== */
  const RENDER_DOMAIN_ORDER = Object.freeze([
      "today", "review", "library", "study", "history", "settings", "sidebar", "ownership", "storage",
  ]);
  function attributeSelectorValue(value) {
      return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }
  function focusSelector(element) {
      if (element.id)
          return `#${CSS.escape(element.id)}`;
      const pane = element.dataset["pane"];
      if (pane)
          return `[data-pane="${attributeSelectorValue(pane)}"]`;
      const focusKey = element.dataset["focusKey"];
      if (focusKey)
          return `[data-focus-key="${attributeSelectorValue(focusKey)}"]`;
      const action = element.dataset["action"];
      if (action) {
          const id = element.dataset["id"];
          const rating = element.dataset["rating"];
          return `[data-action="${attributeSelectorValue(action)}"]${id ? `[data-id="${attributeSelectorValue(id)}"]` : ""}${rating ? `[data-rating="${attributeSelectorValue(rating)}"]` : ""}`;
      }
      const name = element.getAttribute("name");
      const form = element.closest("form[id]");
      if (name && form?.id)
          return `#${CSS.escape(form.id)} [name="${attributeSelectorValue(name)}"]`;
      return "";
  }
  function captureDocumentFocus(preferredSelector = "") {
      const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
      const textControl = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
      return Object.freeze({
          element: active,
          selector: preferredSelector || (active ? focusSelector(active) : ""),
          selectionStart: textControl?.selectionStart ?? null,
          selectionEnd: textControl?.selectionEnd ?? null,
          selectionDirection: textControl?.selectionDirection ?? null,
      });
  }
  function restoreDocumentFocus(snapshot, fallbackSelector = "") {
      if (!snapshot)
          return;
      const existing = snapshot.element?.isConnected ? snapshot.element : null;
      const selector = snapshot.selector || fallbackSelector;
      const target = existing ?? (selector ? document.querySelector(selector) : null) ?? (fallbackSelector ? document.querySelector(fallbackSelector) : null);
      if (!target || target.hidden || target.closest("[hidden]") || (target instanceof HTMLButtonElement && target.disabled))
          return;
      target.focus({ preventScroll: true });
      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
          try {
              target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection ?? undefined);
          }
          catch {
              // Some input types do not support text selection.
          }
      }
  }
  class RenderCoordinator {
      beforeFlush;
      afterFlush;
      callbacks = new Map();
      dirty = new Set();
      debounceHandles = new Map();
      animationHandle = 0;
      activeFlush = null;
      constructor(beforeFlush, afterFlush) {
          this.beforeFlush = beforeFlush;
          this.afterFlush = afterFlush;
      }
      register(domain, callback) {
          assert(!this.callbacks.has(domain), `Render domain already registered: ${domain}`);
          this.callbacks.set(domain, callback);
      }
      invalidate(...domains) {
          for (const domain of domains) {
              assert(this.callbacks.has(domain), `Render domain is not registered: ${domain}`);
              this.dirty.add(domain);
          }
          this.schedule();
      }
      invalidateDebounced(key, delayMs, ...domains) {
          const existing = this.debounceHandles.get(key);
          if (existing)
              window.clearTimeout(existing);
          const handle = window.setTimeout(() => {
              this.debounceHandles.delete(key);
              this.invalidate(...domains);
          }, delayMs);
          this.debounceHandles.set(key, handle);
      }
      async invalidateAndWait(...domains) {
          for (const domain of domains) {
              assert(this.callbacks.has(domain), `Render domain is not registered: ${domain}`);
              this.dirty.add(domain);
          }
          await this.flush();
      }
      async flush() {
          if (this.animationHandle) {
              window.cancelAnimationFrame(this.animationHandle);
              this.animationHandle = 0;
          }
          if (this.activeFlush) {
              await this.activeFlush;
              if (this.dirty.size)
                  await this.flush();
              return;
          }
          const run = this.drain();
          this.activeFlush = run;
          try {
              await run;
          }
          finally {
              this.activeFlush = null;
          }
          if (this.dirty.size)
              await this.flush();
      }
      schedule() {
          if (this.animationHandle || this.activeFlush)
              return;
          this.animationHandle = window.requestAnimationFrame(() => {
              this.animationHandle = 0;
              void this.flush();
          });
      }
      async drain() {
          const focus = this.beforeFlush();
          try {
              while (this.dirty.size) {
                  const batch = RENDER_DOMAIN_ORDER.filter((domain) => this.dirty.delete(domain));
                  for (const domain of batch)
                      await this.callbacks.get(domain)?.();
              }
          }
          finally {
              this.afterFlush(focus);
          }
      }
  }
  class AriaTabRegistry {
      tablist;
      onActivate;
      entries;
      constructor(tablist, panes, onActivate) {
          this.tablist = tablist;
          this.onActivate = onActivate;
          this.entries = Object.freeze(panes.map((pane) => {
              const tab = requiredElement(`[data-pane="${pane}"]`, HTMLButtonElement);
              const panel = requiredElement(`#pane-${pane}`, HTMLElement);
              return Object.freeze({ pane, tab, panel });
          }));
      }
      initialize(activePane) {
          this.tablist.setAttribute("role", "tablist");
          this.tablist.setAttribute("aria-label", this.tablist.getAttribute("aria-label") || "Primary navigation");
          for (const entry of this.entries) {
              const tabId = `primary-tab-${entry.pane}`;
              entry.tab.type = "button";
              entry.tab.id = tabId;
              entry.tab.setAttribute("role", "tab");
              entry.tab.setAttribute("aria-controls", entry.panel.id);
              entry.panel.setAttribute("role", "tabpanel");
              entry.panel.setAttribute("aria-labelledby", tabId);
          }
          this.activate(activePane, false, false);
      }
      activate(pane, focusTab = false, notify = false) {
          const active = this.entries.find((entry) => entry.pane === pane);
          assert(active, `Unknown pane: ${pane}`);
          for (const entry of this.entries) {
              const selected = entry === active;
              entry.tab.classList.toggle("on", selected);
              entry.tab.setAttribute("aria-selected", String(selected));
              entry.tab.tabIndex = selected ? 0 : -1;
              entry.panel.classList.toggle("on", selected);
              entry.panel.hidden = !selected;
          }
          if (focusTab)
              active.tab.focus({ preventScroll: true });
          if (notify)
              void this.onActivate(pane);
      }
      handleKeydown(event) {
          const tab = event.target?.closest("[role=tab][data-pane]");
          if (!tab || !this.tablist.contains(tab))
              return false;
          const index = this.entries.findIndex((entry) => entry.tab === tab);
          if (index < 0)
              return false;
          let next = index;
          if (["ArrowRight", "ArrowDown"].includes(event.key))
              next = (index + 1) % this.entries.length;
          else if (["ArrowLeft", "ArrowUp"].includes(event.key))
              next = (index - 1 + this.entries.length) % this.entries.length;
          else if (event.key === "Home")
              next = 0;
          else if (event.key === "End")
              next = this.entries.length - 1;
          else
              return false;
          event.preventDefault();
          const entry = this.entries[next];
          if (entry)
              this.activate(entry.pane, true, true);
          return true;
      }
  }
  function focusableElements(root) {
      const selector = [
          "button:not([disabled])",
          "a[href]",
          "input:not([disabled]):not([type=hidden])",
          "select:not([disabled])",
          "textarea:not([disabled])",
          "[tabindex]:not([tabindex='-1'])",
      ].join(",");
      return [...root.querySelectorAll(selector)].filter((element) => {
          if (element.hidden || element.closest("[hidden]") || element.getAttribute("aria-hidden") === "true")
              return false;
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
      });
  }
  class NativeDialogFocusManager {
      returnTargets = new WeakMap();
      constructor(dialogs) {
          for (const dialog of dialogs) {
              dialog.addEventListener("keydown", (event) => {
                  if (event.key !== "Tab" || !dialog.open)
                      return;
                  const focusable = focusableElements(dialog);
                  if (!focusable.length) {
                      event.preventDefault();
                      dialog.focus({ preventScroll: true });
                      return;
                  }
                  const first = focusable[0];
                  const last = focusable[focusable.length - 1];
                  const active = document.activeElement;
                  if (event.shiftKey && (active === first || !dialog.contains(active))) {
                      event.preventDefault();
                      last.focus({ preventScroll: true });
                  }
                  else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                      event.preventDefault();
                      first.focus({ preventScroll: true });
                  }
              });
              dialog.addEventListener("close", () => {
                  const snapshot = this.returnTargets.get(dialog);
                  this.returnTargets.delete(dialog);
                  window.requestAnimationFrame(() => restoreDocumentFocus(snapshot));
              });
          }
      }
      open(dialog, preferredSelector = "") {
          this.returnTargets.set(dialog, captureDocumentFocus());
          dialog.showModal();
          window.requestAnimationFrame(() => {
              const target = preferredSelector ? dialog.querySelector(preferredSelector) : null;
              (target ?? focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
          });
      }
      close(dialog) {
          if (dialog.open)
              dialog.close();
      }
  }
  class OverlayFocusManager {
      overlay;
      backgroundRoots;
      returnTarget;
      returnSelector = "";
      preferredSelector = "";
      constructor(overlay, backgroundRoots) {
          this.overlay = overlay;
          this.backgroundRoots = backgroundRoots;
      }
      isOpen() { return !this.overlay.hidden; }
      show(preferredSelector, returnSelector = "") {
          this.preferredSelector = preferredSelector;
          if (!this.isOpen()) {
              this.returnTarget = captureDocumentFocus(returnSelector);
              this.returnSelector = returnSelector;
          }
          for (const root of this.backgroundRoots)
              root.inert = true;
          this.overlay.hidden = false;
          const focusPreferred = () => {
              if (!this.isOpen())
                  return;
              const preferred = this.overlay.querySelector(preferredSelector);
              (preferred ?? focusableElements(this.overlay)[0] ?? this.overlay).focus({ preventScroll: true });
          };
          focusPreferred();
          window.requestAnimationFrame(focusPreferred);
      }
      hide() {
          if (!this.isOpen())
              return;
          this.overlay.hidden = true;
          for (const root of this.backgroundRoots)
              root.inert = false;
          const snapshot = this.returnTarget;
          const fallback = this.returnSelector;
          this.returnTarget = undefined;
          this.returnSelector = "";
          this.preferredSelector = "";
          window.requestAnimationFrame(() => restoreDocumentFocus(snapshot, fallback));
      }
      focus(preferredSelector) {
          this.preferredSelector = preferredSelector;
          const preferred = this.overlay.querySelector(preferredSelector);
          (preferred ?? focusableElements(this.overlay)[0] ?? this.overlay).focus({ preventScroll: true });
      }
      ensureFocus() {
          if (!this.isOpen() || this.overlay.contains(document.activeElement))
              return;
          this.focus(this.preferredSelector);
      }
      handleKeydown(event) {
          if (!this.isOpen())
              return false;
          if (event.key === "Escape") {
              event.preventDefault();
              return true;
          }
          if (event.key !== "Tab")
              return false;
          const controls = focusableElements(this.overlay);
          if (!controls.length) {
              event.preventDefault();
              this.overlay.focus({ preventScroll: true });
              return true;
          }
          const first = controls[0];
          const last = controls[controls.length - 1];
          const active = document.activeElement;
          if (event.shiftKey && (active === first || !this.overlay.contains(active))) {
              event.preventDefault();
              last.focus({ preventScroll: true });
          }
          else if (!event.shiftKey && (active === last || !this.overlay.contains(active))) {
              event.preventDefault();
              first.focus({ preventScroll: true });
          }
          return true;
      }
  }

  function requiredElement(selector, constructor) {
      const element = document.querySelector(selector);
      assert(element instanceof constructor, `Missing or invalid required element: ${selector}`);
      return element;
  }
  function downloadBlob(filename, content, type) {
      const part = content instanceof Uint8Array ? ownedArrayBuffer(content) : content;
      const blob = new Blob([part], { type });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function formatFileSize(bytes) {
      if (bytes < 1024)
          return `${bytes} B`;
      if (bytes < 1024 * 1024)
          return `${roundTo(bytes / 1024, 1)} KiB`;
      return `${roundTo(bytes / (1024 * 1024), 1)} MiB`;
  }
  class UIController {
      service;
      activePersistence;
      ownership;
      backupController;
      extensions;
      currentPane = "today";
      historyTab = "evidence";
      libraryFilter = "";
      activeReviewIds = [];
      activeReviewIndex = 0;
      reviewPhase = "attempt";
      phaseTime;
      attemptElapsedMs = 0;
      reviewDrafts = new Map();
      diagramStrokes = [];
      activeDiagramStroke = null;
      timerHandle = 0;
      reviewPreviews = [];
      activeSessionRevision = 0;
      commitInFlight = false;
      ownershipSnapshot;
      restoreCandidateId = "";
      restoreSafetyProofId = "";
      fsrsOptimizerRun;
      fsrsOptimizerProgress;
      todayContent = requiredElement("#today-content", HTMLDivElement);
      reviewContent = requiredElement("#review-content", HTMLDivElement);
      libraryContent = requiredElement("#library-content", HTMLDivElement);
      studyContent = requiredElement("#study-content", HTMLDivElement);
      historyContent = requiredElement("#history-content", HTMLDivElement);
      settingsContent = requiredElement("#settings-content", HTMLDivElement);
      toastElement = requiredElement("#toast", HTMLDivElement);
      gapOverlay = requiredElement("#gap-overlay", HTMLDivElement);
      gapMeta = requiredElement("#gap-meta", HTMLDivElement);
      gapSplit = requiredElement("#gap-split", HTMLDivElement);
      gapFocusMinutes = requiredElement("#gap-focus-minutes", HTMLInputElement);
      unitDialog = requiredElement("#unit-dialog", HTMLDialogElement);
      studyDialog = requiredElement("#study-dialog", HTMLDialogElement);
      obligationDialog = requiredElement("#obligation-dialog", HTMLDialogElement);
      restoreDialog = requiredElement("#restore-dialog", HTMLDialogElement);
      restorePreview = requiredElement("#restore-preview", HTMLDivElement);
      unitForm = requiredElement("#unit-form", HTMLFormElement);
      studyForm = requiredElement("#study-form", HTMLFormElement);
      obligationForm = requiredElement("#obligation-form", HTMLFormElement);
      ownershipBanner = requiredElement("#ownership-banner", HTMLDivElement);
      ownershipTitle = requiredElement("#ownership-title", HTMLElement);
      ownershipMessage = requiredElement("#ownership-message", HTMLElement);
      takeControlButton = requiredElement("#take-review-control", HTMLButtonElement);
      storageCapacityBanner = requiredElement("#storage-capacity-banner", HTMLDivElement);
      appShell = requiredElement(".app-shell", HTMLElement);
      primaryNav = requiredElement(".nav", HTMLElement);
      renderCoordinator;
      tabRegistry;
      dialogFocus;
      gapFocus;
      constructor(service, activePersistence, ownership, backupController, extensions) {
          this.service = service;
          this.activePersistence = activePersistence;
          this.ownership = ownership;
          this.backupController = backupController;
          this.extensions = extensions;
          this.ownershipSnapshot = ownership.snapshot();
          this.renderCoordinator = new RenderCoordinator(() => captureDocumentFocus(), (snapshot) => {
              this.applyReadOnlyState();
              if (this.gapFocus.isOpen())
                  this.gapFocus.ensureFocus();
              else if (!document.querySelector("dialog[open]"))
                  restoreDocumentFocus(snapshot);
          });
          this.tabRegistry = new AriaTabRegistry(this.primaryNav, ["today", "review", "library", "study", "history", "settings"], (pane) => this.openPane(pane));
          this.dialogFocus = new NativeDialogFocusManager([this.unitDialog, this.studyDialog, this.obligationDialog, this.restoreDialog]);
          this.gapFocus = new OverlayFocusManager(this.gapOverlay, [this.appShell, this.ownershipBanner, this.storageCapacityBanner]);
          this.registerRenderDomains();
      }
      async start() {
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
      activeReviewTarget(index = this.activeReviewIndex) {
          const target = this.activeReviewIds[index];
          assert(target, "Review target is missing.");
          return target;
      }
      registerRenderDomains() {
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
      bindStaticEvents() {
          document.addEventListener("click", (event) => void this.handleDelegatedClick(event));
          document.addEventListener("submit", (event) => void this.handleDelegatedSubmit(event));
          document.addEventListener("input", (event) => void this.handleDelegatedInput(event));
          document.addEventListener("change", (event) => void this.handleDelegatedChange(event));
          document.addEventListener("keydown", (event) => this.handleDelegatedKeydown(event));
          document.addEventListener("visibilitychange", () => {
              if (document.visibilityState === "hidden") {
                  if (this.ownership.canMutate()) {
                      this.reconcilePhaseTime("visibility");
                      this.forceActiveRetrievalSave();
                  }
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
              if (this.currentPane === "settings")
                  this.renderCoordinator.invalidate("settings", "ownership");
          });
      }
      async handleDelegatedClick(event) {
          const target = event.target instanceof Element ? event.target.closest("button,[data-action],[data-pane],[data-filter],[data-history-tab],[data-close-dialog],[data-gap-action]") : null;
          if (!target || (target instanceof HTMLButtonElement && target.disabled))
              return;
          const pane = literalChoiceOrUndefined(target.dataset["pane"], ["today", "review", "library", "study", "history", "settings"]);
          if (pane) {
              await this.openPane(pane);
              return;
          }
          if (target.id === "quick-add-unit") {
              if (this.requireMutable("add a knowledge unit"))
                  await this.openUnitDialog();
              return;
          }
          if (target.id === "quick-log-study") {
              if (this.requireMutable("log a Study Event"))
                  await this.openStudyDialog();
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
          if (target.dataset["action"])
              await this.handleAction(target);
      }
      async handleDelegatedSubmit(event) {
          const form = event.target;
          if (!(form instanceof HTMLFormElement))
              return;
          const formId = form.getAttribute("id") ?? "";
          if (!["unit-form", "study-form", "obligation-form", "settings-form"].includes(formId))
              return;
          event.preventDefault();
          if (formId === "unit-form")
              await this.submitUnit(event);
          else if (formId === "study-form")
              await this.submitStudy(event);
          else if (formId === "obligation-form")
              await this.submitObligation(event);
          else
              await this.submitSettings(event);
      }
      async updateActiveReviewInputs(target) {
          if (!(target instanceof HTMLElement) || !this.reviewContent.contains(target))
              return;
          this.scheduleActiveRetrievalSave();
          const obligationId = this.activeReviewIds[this.activeReviewIndex];
          if (!obligationId || obligationId.startsWith("chunk:"))
              return;
          let obligation;
          try {
              obligation = await this.service.obligation(obligationId);
          }
          catch {
              return;
          }
          if (target.matches("[data-evidence-input]"))
              this.updateEvidenceSuggestion(obligation);
          if (target.matches("#answer-text,#questions-attempted,#questions-correct,#questions-partial"))
              this.updateDerivedWorkflowDisplays(obligation);
      }
      async handleDelegatedInput(event) {
          const target = event.target;
          if (target instanceof HTMLInputElement && target.id === "library-search") {
              this.libraryFilter = target.value;
              this.renderCoordinator.invalidateDebounced("library-search", 160, "library", "ownership");
              return;
          }
          await this.updateActiveReviewInputs(target);
      }
      async handleDelegatedChange(event) {
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
              if (target.id === "restore-safety-saved" && target.checked && this.restoreSafetyProofId)
                  this.backupController.acknowledgeSafetyCopy(this.restoreSafetyProofId);
              this.updateRestoreActionState();
              return;
          }
          if (target instanceof HTMLSelectElement) {
              const form = target.closest("#unit-form,#obligation-form");
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
                      if (selected === "reconstruction")
                          spec.reconstructionShape = "outline";
                      if (selected === "questions") {
                          spec.targetCount = 10;
                          spec.questionSetRef = "External question set";
                      }
                      if (selected === "diagram")
                          spec.diagramSurface = "canvas";
                      if (selected === "answer-writing") {
                          spec.answerMode = "full-answer";
                          spec.timeLimitMinutes = 10;
                          spec.wordLimit = 150;
                      }
                      populateWorkflowForm(form, spec, type);
                      return;
                  }
              }
          }
          await this.updateActiveReviewInputs(target);
      }
      handleDelegatedKeydown(event) {
          if (this.gapFocus.handleKeydown(event))
              return;
          if (this.tabRegistry.handleKeydown(event))
              return;
          if (event.target === this.gapFocusMinutes && event.key === "Enter") {
              event.preventDefault();
              void this.handleGapAction("apply-split");
              return;
          }
          this.handleKeyboard(event);
      }
      requireMutable(reason) {
          if (this.ownership.canMutate())
              return true;
          this.handleOwnershipChanged(this.ownership.snapshot());
          this.toast(this.ownershipSnapshot.state === "faulted"
              ? `Review control is unavailable because the ownership lease failed. Browser storage must recover before you can ${reason}.`
              : `This tab is read-only. Take control here to ${reason}.`, true);
          return false;
      }
      async takeControl() {
          this.takeControlButton.disabled = true;
          try {
              const acquired = await this.ownership.takeControl();
              if (!acquired)
                  this.toast("Review control could not be acquired.", true);
          }
          finally {
              this.takeControlButton.disabled = false;
          }
      }
      handleOwnershipChanged(snapshot) {
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
          if (!wasPrimary && snapshot.canMutate)
              void this.renderAll();
          else
              this.renderCoordinator.invalidate("ownership", "storage");
      }
      applyReadOnlyState() {
          const primary = this.ownership.canMutate();
          const controls = document.querySelectorAll("input,textarea,select,button");
          controls.forEach((control) => {
              const action = control instanceof HTMLElement ? control.dataset["action"] : undefined;
              const safe = control === this.takeControlButton
                  || control.matches("[data-pane],[data-history-tab],[data-close-dialog]")
                  || action === "export-backup"
                  || action === "cancel-restore"
                  || control.id === "library-search";
              if (!primary && !safe) {
                  if (!control.disabled)
                      control.dataset["ownershipDisabled"] = "1";
                  control.disabled = true;
              }
              else if (primary && control.dataset["ownershipDisabled"] === "1") {
                  control.disabled = false;
                  delete control.dataset["ownershipDisabled"];
              }
          });
          const canvas = this.reviewContent.querySelector("#diagram-canvas");
          if (canvas) {
              canvas.style.pointerEvents = primary ? "auto" : "none";
              canvas.setAttribute("aria-disabled", String(!primary));
          }
      }
      renderStorageCapacity() {
          const storage = this.service.storageHealth();
          if (storage.level === "healthy") {
              this.storageCapacityBanner.hidden = true;
              this.storageCapacityBanner.textContent = "";
              return;
          }
          const ratio = storage.usageRatio === undefined ? "" : ` Storage usage is ${Math.round(storage.usageRatio * 100)}%.`;
          const persistence = storage.persistence === "granted" ? "" : ` Persistent storage: ${storage.persistence}.`;
          this.storageCapacityBanner.textContent = `${storage.level === "critical" ? "Storage capacity is critical." : "Storage needs attention."}${ratio}${persistence}${storage.lastError ? ` ${storage.lastError}` : ""}`;
          this.storageCapacityBanner.hidden = false;
      }
      async handleLifecycleReturn(source) {
          await this.ownership.evaluate("reacquire");
          await this.service.refreshStorageHealth(false).catch(() => this.service.storageHealth());
          if (this.ownership.canMutate())
              this.reconcileAndPersistPhaseTime(source);
          await this.renderCoordinator.invalidateAndWait("storage", "ownership");
      }
      async handlePageExit() {
          this.fsrsOptimizerRun?.cancel();
          if (this.ownership.canMutate()) {
              this.reconcilePhaseTime("snapshot");
              this.forceActiveRetrievalSave();
          }
          await this.ownership.releaseForExit();
      }
      async flushForOwnershipRelease() {
          if (this.commitInFlight)
              throw new Error("A review commit is still in progress.");
          if (this.phaseTime)
              this.reconcilePhaseTime("snapshot");
          const session = this.buildActiveRetrievalSession();
          if (session) {
              this.activePersistence.forceEmergency(session);
              await this.activePersistence.flush(session);
          }
      }
      resetLocalReviewState() {
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
      async hydrateCanonicalState(reason) {
          this.resetLocalReviewState();
          await this.service.initialize();
          await this.renderAll();
          await this.recoverUnfinishedSession(reason === "startup");
          await this.renderCoordinator.invalidateAndWait("storage", "ownership");
      }
      phaseLabel(phase) {
          return phase === "attempt" ? "Attempt" : phase === "compare" ? "Compare / correct" : phase === "relearn-repair" ? "Repair" : "Closed-book verification";
      }
      activeElapsedMs() { return this.phaseTime?.activeMs() ?? 0; }
      closedBookAttemptMs() {
          if (!this.phaseTime)
              return this.attemptElapsedMs;
          return this.reviewPhase === "relearn-repair" || this.reviewPhase === "relearn-verify" || this.phaseTime.currentPhase() === "relearn-verify"
              ? this.phaseTime.phaseActiveMs("relearn-verify")
              : this.phaseTime.phaseActiveMs("attempt");
      }
      timingSummary() {
          assert(this.phaseTime, "Phase-time runtime is unavailable.");
          this.reconcilePhaseTime("snapshot");
          assert(this.phaseTime.status() === "running", "Resume the retrieval before completing it.");
          assert(!this.phaseTime.hasPendingGap(), "Classify the inactive gap before completing this retrieval.");
          return this.phaseTime.summary();
      }
      reconcilePhaseTime(source) {
          if (!this.phaseTime || !this.ownership.canMutate())
              return;
          const result = this.phaseTime.reconcile(Date.now(), source);
          if (result.gapOpened)
              this.showGapOverlay();
          this.updateTimerDisplay();
      }
      reconcileAndPersistPhaseTime(source) {
          if (!this.phaseTime || this.commitInFlight)
              return;
          const before = this.phaseTime.hasPendingGap();
          this.reconcilePhaseTime(source);
          if (!before || this.phaseTime.hasPendingGap())
              this.forceActiveRetrievalSave();
      }
      updateTimerDisplay() {
          const timer = this.reviewContent.querySelector("#review-timer");
          if (timer)
              timer.textContent = formatDuration(this.activeElapsedMs());
          const state = this.reviewContent.querySelector("#review-time-state");
          if (state) {
              const status = this.phaseTime?.status() ?? "running";
              state.textContent = `${this.phaseLabel(this.reviewPhase)} · ${status === "paused" ? "Paused" : status === "gap-pending" ? "Classify gap" : "Active"}`;
              state.classList.toggle("paused", status !== "running");
          }
          const button = this.reviewContent.querySelector('[data-action="toggle-pause"]');
          if (button && this.phaseTime) {
              button.textContent = this.phaseTime.isPaused() ? "RESUME" : "PAUSE";
              button.disabled = this.phaseTime.hasPendingGap();
          }
      }
      reviewTimerMarkup() {
          const status = this.phaseTime?.status() ?? "running";
          return `<div class="review-controls"><div class="review-time-cluster"><div class="review-timer" id="review-timer">${formatDuration(this.activeElapsedMs())}</div><span class="review-time-state ${status !== "running" ? "paused" : ""}" id="review-time-state">${escapeHtml(this.phaseLabel(this.reviewPhase))} · ${status === "paused" ? "Paused" : status === "gap-pending" ? "Classify gap" : "Active"}</span></div><button class="mini-btn" data-action="toggle-pause" ${status === "gap-pending" ? "disabled" : ""}>${status === "paused" ? "RESUME" : "PAUSE"}</button></div>`;
      }
      showGapOverlay() {
          const gap = this.phaseTime?.pendingGap();
          if (!gap)
              return;
          this.gapMeta.textContent = `${formatDuration(gap.gapMs)} · ${this.phaseLabel(gap.phase)} · ${gap.source}`;
          this.gapFocusMinutes.value = String(roundTo(gap.gapMs / 60_000, 1));
          this.gapSplit.hidden = true;
          this.gapFocus.show('[data-gap-action="focus"]', '[data-action="toggle-pause"]');
      }
      hideGapOverlay() { this.gapSplit.hidden = true; this.gapFocus.hide(); }
      async handleGapAction(action) {
          if (!this.requireMutable("classify an interruption"))
              return;
          if (!this.phaseTime?.hasPendingGap()) {
              this.hideGapOverlay();
              return;
          }
          if (action === "split") {
              this.gapSplit.hidden = false;
              this.gapFocus.focus("#gap-focus-minutes");
              return;
          }
          const classification = action === "apply-split" ? "split" : literalChoice(action, INACTIVE_GAP_CLASSIFICATIONS, "Inactive-gap action");
          const focusMs = classification === "split" ? Math.max(0, Number(this.gapFocusMinutes.value) || 0) * 60_000 : 0;
          const record = this.phaseTime.resolveGap(classification, focusMs);
          this.hideGapOverlay();
          this.updateTimerDisplay();
          this.forceActiveRetrievalSave();
          this.toast(classification === "ignore" ? "Gap ignored. This duration will not train adaptive estimates." : `Gap classified as ${classification}.`);
          if (record.classification === "ignore")
              this.scheduleActiveRetrievalSave();
      }
      togglePause() {
          assert(this.requireMutable("pause or resume retrieval"), "This tab is read-only.");
          assert(this.phaseTime, "No active retrieval timer is available.");
          if (this.phaseTime.isPaused())
              this.phaseTime.resume();
          else
              this.phaseTime.pause();
          this.updateTimerDisplay();
          this.forceActiveRetrievalSave();
      }
      emptyReviewDraft(phase = "attempt") {
          return { phase, values: {}, checked: {}, diagramStrokes: [], attemptElapsedMs: 0 };
      }
      snapshotCurrentDraft() {
          const targetId = this.activeReviewIds[this.activeReviewIndex];
          if (!targetId || !this.reviewContent.querySelector(".review-card"))
              return this.emptyReviewDraft(this.reviewPhase);
          const values = {};
          const checked = {};
          this.reviewContent.querySelectorAll("input[id],textarea[id],select[id]").forEach((element) => {
              if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio"))
                  checked[element.id] = element.checked;
              else
                  values[element.id] = element.value;
          });
          const draft = canonicalReviewDraftSnapshot({ phase: this.reviewPhase, values, checked, diagramStrokes: clone(this.diagramStrokes), attemptElapsedMs: Math.max(this.attemptElapsedMs, this.closedBookAttemptMs()) });
          this.reviewDrafts.set(targetId, draft);
          return draft;
      }
      buildActiveRetrievalSession(status = "active", commitToken) {
          const activeTargetId = this.activeReviewIds[this.activeReviewIndex];
          if (!activeTargetId || this.activeReviewIds.length === 0)
              return undefined;
          if (!this.phaseTime)
              this.phaseTime = PhaseTimeRuntime.create(this.reviewPhase, false);
          this.reconcilePhaseTime("snapshot");
          const elapsedMs = this.phaseTime.activeMs();
          const revision = this.activeSessionRevision + 1;
          const session = {
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
      async initialPhaseForTarget(targetId) {
          if (targetId.startsWith("chunk:"))
              return "attempt";
          try {
              return (await this.service.obligation(targetId)).workflow.kind === "relearning" ? "relearn-repair" : "attempt";
          }
          catch {
              return "attempt";
          }
      }
      async initialSourceVisibleForTarget(targetId, phase) {
          if (targetId.startsWith("chunk:"))
              return true;
          if (phase === "relearn-repair")
              return true;
          return false;
      }
      async postCommitSession(commitToken) {
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
      scheduleActiveRetrievalSave() {
          if (this.commitInFlight || !this.ownership.canMutate())
              return;
          const session = this.buildActiveRetrievalSession();
          if (session)
              this.activePersistence.schedule(session);
      }
      forceActiveRetrievalSave() {
          if (this.commitInFlight || !this.ownership.canMutate())
              return;
          const session = this.buildActiveRetrievalSession();
          if (!session)
              return;
          this.activePersistence.forceEmergency(session);
          void this.activePersistence.flush(session).catch(() => undefined);
      }
      async recoverUnfinishedSession(askBeforeResume = true) {
          const loaded = await this.activePersistence.load();
          const recovered = loaded.session;
          if (!recovered)
              return;
          let valid = true;
          try {
              if (recovered.activeTargetId.startsWith("chunk:"))
                  await this.service.chunk(recovered.activeTargetId.slice(6));
              else
                  await this.service.obligation(recovered.activeTargetId);
          }
          catch {
              valid = false;
          }
          if (!valid) {
              await this.activePersistence.clear();
              return;
          }
          if (askBeforeResume && !window.confirm("An unfinished retrieval session was found. Resume it?")) {
              await this.activePersistence.clear();
              return;
          }
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
              if (resumed)
                  await this.activePersistence.flush(resumed);
          }
          await this.openPane("review");
          if (this.phaseTime.hasPendingGap())
              this.showGapOverlay();
          this.toast(askBeforeResume ? "Unfinished retrieval session recovered." : "Canonical retrieval state hydrated after ownership transfer.");
      }
      startClock() {
          const clock = requiredElement("#clock", HTMLDivElement);
          const update = () => { clock.textContent = new Date().toLocaleTimeString("en-IN", { hour12: false }); };
          update();
          window.setInterval(update, 1000);
      }
      async openPane(pane) {
          if (this.currentPane === "review" && pane !== "review")
              this.captureReviewDraft();
          this.currentPane = pane;
          this.tabRegistry.activate(pane);
          await this.renderPane(pane);
      }
      async renderAll() {
          await this.renderCoordinator.invalidateAndWait("today", "review", "library", "study", "history", "settings", "sidebar", "ownership", "storage");
      }
      async renderPane(pane) {
          await this.renderCoordinator.invalidateAndWait(pane, "sidebar", "ownership", "storage");
      }
      async renderSidebar() {
          const plan = await this.service.dailyPlan(new Date(), false, this.ownership.canMutate());
          const units = (await this.service.units()).filter((unit) => unit.status === "active");
          requiredElement("#sb-due", HTMLElement).textContent = String(plan.selected.length);
          requiredElement("#sb-units", HTMLElement).textContent = String(units.length);
          requiredElement("#sb-load", HTMLElement).textContent = `${plan.plannedMinutes}m`;
      }
      pageHead(eyebrow, title, description, actions = "") {
          return `<header class="page-head"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="actions">${actions}</div></header>`;
      }
      async renderToday() {
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
      factorMeter(label, value) {
          const percent = Math.round(clamp(value, 0, 1) * 100);
          return `<div class="factor-meter"><span>${escapeHtml(label)}</span><div class="factor-track"><i style="width:${percent}%"></i></div><strong>${percent}</strong></div>`;
      }
      plannerRow(item, order, disposition) {
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
      emptyState(title, message) {
          return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
      }
      async renderLibrary() {
          const settings = this.service.getSettings();
          const profiles = await this.service.profiles();
          const units = (await this.service.units()).filter((unit) => unit.status !== "archived");
          const nodes = await this.service.nodes();
          const obligations = await this.service.obligations();
          const evidenceEvents = await this.service.evidenceEvents();
          const memoryReviews = memoryReviewObservationIndex(evidenceEvents);
          const nodeMap = new Map(nodes.map((node) => [node.id, node]));
          const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
          const filtered = units.filter((unit) => {
              if (!this.libraryFilter)
                  return true;
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
                  const assessment = memoryDifficultyAssessment(obligation, settings.memoryDifficultyPolicy, memoryReviews.get(obligation.id) ?? []);
                  if (assessment.level === "normal")
                      return "";
                  const label = assessment.level === "persistent-difficulty"
                      ? "Persistent difficulty"
                      : assessment.level === "remediation"
                          ? "Remediation"
                          : "Early learning difficulty";
                  const burden = assessment.level === "learning-difficulty"
                      ? `${assessment.earlyLearningFailures} failed learning recalls`
                      : `${assessment.establishedLapses} established FSRS lapses`;
                  const actions = assessment.recommendedActions.map(memoryDifficultyActionLabel).join(" · ");
                  return `<div class="policy-box"><strong>${label} · ${burden}.</strong> ${escapeHtml(actions)}.</div>`;
              }).join("");
              const heldMemory = memoryObligations.filter((obligation) => obligation.status === "suspended" && obligation.suspensionReason === "persistent-difficulty");
              return `<article class="unit-row"><div><div class="breadcrumb">${escapeHtml(profileMap.get(unit.profileId)?.name ?? "Exam")} · ${escapeHtml(subject?.name ?? "")} › ${escapeHtml(section?.name ?? "")} › ${escapeHtml(topic?.name ?? "")}</div><div class="row-title">${escapeHtml(unit.title)}</div><p>${escapeHtml(unit.scope)}</p><div class="row-meta">${unitObligations.map((obligation) => `<span class="chip ${obligationChip(obligation.type)}">${escapeHtml(obligationLabel(obligation.type))}</span><span class="chip workflow-chip">${escapeHtml(workflowLabel(obligation.workflow.kind))}</span>`).join("")}<span>${unit.evidenceCount} evidence events</span><span>${unit.lapseCount} failures</span></div>${difficultyPanels}</div><div class="row-actions"><button class="mini-btn" data-action="review-unit" data-id="${unit.id}">REVIEW</button><button class="mini-btn" data-action="add-obligation" data-id="${unit.id}">ADD OBLIGATION</button>${heldMemory.map((obligation) => `<button class="mini-btn" data-action="resume-persistent-difficulty" data-id="${obligation.id}">RESUME MEMORY</button>`).join("")}<button class="mini-btn" data-action="toggle-unit" data-id="${unit.id}" data-status="${unit.status === "active" ? "suspended" : "active"}">${unit.status === "active" ? "SUSPEND" : "ACTIVATE"}</button></div></article>`;
          }).join("")}</div>` : this.emptyState("No matching knowledge", "Create a unit or change the search filter.")}</div>
          </div>`;
      }
      async renderStudy() {
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
      async renderHistory() {
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
      pluginSettingsCard() {
          const status = this.extensions.status();
          const pluginRows = status.registered.length
              ? status.registered.map((entry) => `<div class="dependency-status"><span>${escapeHtml(entry.name)}${entry.version ? ` · ${escapeHtml(entry.version)}` : ""}</span><strong class="${entry.state === "registered" ? "ok" : entry.state === "failed" || entry.state === "incompatible" ? "bad" : ""}">${escapeHtml(entry.state)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ""}</div>`).join("")
              : `<p class="helper">No plugins are registered in this session.</p>`;
          const fileRows = status.localFiles.length
              ? `<div class="plugin-file-list">${status.localFiles.slice(0, 8).map((entry) => `<div class="dependency-status"><span>${escapeHtml(entry.name)} · ${escapeHtml(formatFileSize(entry.size))}</span><strong class="${entry.state === "loaded" ? "ok" : entry.state === "failed" || entry.state === "rejected" ? "bad" : ""}">${escapeHtml(entry.state)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ""}</div>`).join("")}</div>`
              : "";
          return `<section class="panel settings-card"><h3>Optional plugins</h3><label class="btn file-btn">LOAD LOCAL PLUGIN<input id="load-plugin-files" type="file" accept=".js,text/javascript,application/javascript" multiple></label><p class="helper">Trusted JavaScript only. A local plugin runs with this page’s privileges, is not stored by Revision Director, and is removed by reloading the page.</p>${pluginRows}${fileRows}</section>`;
      }
      fsrsPersonalizationCard(settings, summary) {
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
          const holdoutDiagnostics = profile
              ? fsrsHoldoutDiagnostics(profile.evaluation.holdout.stock, profile.evaluation.holdout.personalized)
              : undefined;
          const profileDetail = profile && holdoutDiagnostics
              ? `<div class="dependency-status"><span>Profile</span><strong>${escapeHtml(profile.sourceSha256.slice(0, 12))}…</strong></div>
             <div class="dependency-status"><span>Held-out log loss</span><strong>${roundTo(profile.evaluation.holdout.stock.logLoss, 4)} → ${roundTo(profile.evaluation.holdout.personalized.logLoss, 4)} · ${roundTo(holdoutDiagnostics.logLossImprovement.relative * 100, 2)}% better</strong></div>
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
          const localAction = personalization.active
              ? `<button class="mini-btn" type="button" disabled>RETURN TO STOCK BEFORE RE-OPTIMIZING</button>`
              : running
                  ? `<button class="mini-btn" type="button" data-action="cancel-fsrs-optimization">CANCEL OPTIMIZATION</button>`
                  : `<button class="mini-btn" type="button" data-action="optimize-fsrs-locally" ${canOptimize ? "" : "disabled"}>${profile ? "RE-OPTIMIZE LOCALLY" : "OPTIMIZE LOCALLY"}</button>`;
          return `<section class="panel settings-card wide" id="fsrs-personalization-card"><h3>FSRS-7 personalization</h3>
          <div class="dependency-status"><span>Weights</span><strong class="${statusClass}">${status}</strong></div>
          <div class="dependency-status"><span>Optimizer evidence</span><strong>${summary.reviews} reviews · ${summary.cards} cards · ${summary.reliableDurations} timed · ${summary.unavailableDurations} untimed</strong></div>
          <div class="dependency-status"><span>Local optimizer</span><strong class="${optimizer.available ? "ok" : ""}">${optimizer.available ? "AVAILABLE" : "OPTIONAL BUILD REQUIRED"}</strong></div>
          <div class="optimizer-progress" data-fsrs-optimizer-progress ${running ? "" : "hidden"}><div><span data-fsrs-optimizer-progress-label>${escapeHtml(progressText)}</span></div><progress data-fsrs-optimizer-progress-bar max="${progressMax}" value="${progressValue}"></progress></div>
          ${profileDetail}
          <div class="settings-actions">${localAction}<button class="mini-btn" type="button" data-action="export-fsrs-evidence">EXPORT OPTIMIZER EVIDENCE</button><label class="mini-btn file-btn ${running ? "disabled" : ""}">IMPORT VALIDATED PROFILE<input id="import-fsrs-profile" type="file" accept=".json,application/json" ${running ? "disabled" : ""}></label>${profileActions}</div>
          <p class="helper">${escapeHtml(progressText)} Local optimization uses a dedicated Worker and the pinned FSRS-7 WASM binding; review evidence does not leave the browser. Optimizer duration is closed-book recall/verification time only; unreliable timing remains in recall history with unavailable cost rather than full-session time. The exact gate remains 64 historical training items, 64 later holdout items and 16 distinct holdout cards after conversion. A successful run is <strong>staged only</strong>; activation and atomic reprojection remain explicit.</p>
        </section>`;
      }
      async refreshFsrsPersonalizationCard() {
          const card = this.settingsContent.querySelector("#fsrs-personalization-card");
          if (!card)
              return;
          const summary = await this.service.optimizerEvidenceSummary();
          card.outerHTML = this.fsrsPersonalizationCard(this.service.getSettings(), summary);
          this.applyReadOnlyState();
      }
      updateFsrsOptimizerProgress(progress) {
          this.fsrsOptimizerProgress = progress;
          const region = this.settingsContent.querySelector("[data-fsrs-optimizer-progress]");
          const label = this.settingsContent.querySelector("[data-fsrs-optimizer-progress-label]");
          const bar = this.settingsContent.querySelector("[data-fsrs-optimizer-progress-bar]");
          if (region)
              region.hidden = false;
          if (label)
              label.textContent = `${progress.stage} · ${progress.total > 0 ? `${progress.current}/${progress.total}` : "working"}`;
          if (bar) {
              bar.max = progress.total > 0 ? progress.total : 1;
              bar.value = progress.total > 0 ? Math.max(0, Math.min(progress.total, progress.current)) : 0;
          }
      }
      async renderSettings() {
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
      async renderChunkReview(chunkId) {
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
      async renderReview() {
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
          let obligation;
          let unit;
          try {
              obligation = await this.service.obligation(obligationId);
              unit = await this.service.unit(obligation.unitId);
          }
          catch {
              this.activeReviewIndex += 1;
              await this.renderReview();
              return;
          }
          validateWorkflowSpec(obligation.workflow, obligation.type);
          const existingDraft = this.reviewDrafts.get(obligationId);
          if (existingDraft)
              this.reviewPhase = existingDraft.phase;
          else
              this.reviewPhase = obligation.workflow.kind === "relearning" ? "relearn-repair" : "attempt";
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
      attemptComparisonPanel(obligation) {
          const spec = obligation.workflow;
          let content = "";
          if (spec.kind === "recall" || spec.kind === "reconstruction") {
              content = spec.responseMedium === "in-app"
                  ? `<pre id="comparison-attempt-text" class="comparison-text"></pre>`
                  : `<p class="external-attempt-note">Attempt completed in the ${escapeHtml(responseMediumLabel(spec.responseMedium).toLowerCase())}. Keep it visible while checking the source.</p>`;
          }
          else if (spec.kind === "questions") {
              content = `<div class="question-set-banner compact"><span>QUESTION SET</span><strong>${escapeHtml(spec.questionSetRef ?? "External question set")}</strong></div><pre id="comparison-attempt-text" class="comparison-text"></pre>`;
          }
          else if (spec.kind === "diagram") {
              content = spec.diagramSurface === "canvas"
                  ? `<canvas id="comparison-diagram-canvas" class="diagram-canvas comparison-diagram" aria-label="Original diagram attempt"></canvas>`
                  : `<p class="external-attempt-note">Keep the paper diagram beside the reference and compare labels, spatial form and process direction.</p>`;
          }
          else if (spec.kind === "answer-writing") {
              content = spec.responseMedium === "in-app"
                  ? `<pre id="comparison-attempt-text" class="comparison-text answer-comparison"></pre>`
                  : `<p class="external-attempt-note">Keep the written answer beside the rubric. The app records attempt time automatically.</p>`;
          }
          else {
              content = `<pre id="comparison-attempt-text" class="comparison-text"></pre>`;
          }
          return `<section class="attempt-comparison-panel"><div class="comparison-panel-head"><span>ORIGINAL ATTEMPT</span><strong>Compare without rewriting history</strong></div>${content}</section>`;
      }
      relearningTriggerPanel(event) {
          if (!event)
              return `<section class="trigger-evidence missing"><strong>Triggering failure unavailable</strong><p>The original failed evidence could not be found. Continue only after identifying the weakness manually.</p></section>`;
          const errors = event.evidence.errorTypes.length ? event.evidence.errorTypes.map((type) => errorLabel(type)).join(" · ") : "No error type recorded";
          const attempt = this.workflowAttemptExcerpt(event.workflowResult);
          return `<section class="trigger-evidence"><div class="comparison-panel-head"><span>WHY THIS RELEARNING EXISTS</span><strong>${escapeHtml(ratingName(event.confirmedRating))} · ${formatDateTime(event.reviewedAt)}</strong></div><div class="trigger-metrics"><span>Completeness ${event.evidence.completeness}/4</span><span>Independence ${event.evidence.independence}/4</span><span>Application ${event.evidence.application}/4</span></div><p><strong>Errors:</strong> ${escapeHtml(errors)}</p>${event.evidence.correctionNote ? `<p><strong>Correction recorded:</strong> ${escapeHtml(event.evidence.correctionNote)}</p>` : ""}${attempt ? `<details><summary>Show the failed attempt</summary><pre class="comparison-text">${escapeHtml(attempt)}</pre></details>` : ""}</section>`;
      }
      workflowAttemptExcerpt(result) {
          if (result.kind === "recall" || result.kind === "reconstruction")
              return result.attemptText;
          if (result.kind === "questions")
              return [result.questionSetRef, result.attemptNotes, result.errorSummary].filter(Boolean).join("\n\n");
          if (result.kind === "diagram")
              return result.notes;
          if (result.kind === "answer-writing")
              return result.answerText;
          return result.verificationText;
      }
      syncComparisonAttempt(obligation) {
          const spec = obligation.workflow;
          const target = this.reviewContent.querySelector("#comparison-attempt-text");
          if (target) {
              let value = "";
              if (spec.kind === "answer-writing")
                  value = this.reviewContent.querySelector("#answer-text")?.value.trim() ?? "";
              else if (spec.kind === "relearning")
                  value = this.reviewContent.querySelector("#relearn-verification-text")?.value.trim() ?? "";
              else
                  value = this.reviewContent.querySelector("#attempt-text")?.value.trim() ?? "";
              target.textContent = value || "No in-app text was recorded; compare the external attempt directly.";
          }
          if (spec.kind === "diagram" && spec.diagramSurface === "canvas") {
              const canvas = this.reviewContent.querySelector("#comparison-diagram-canvas");
              if (canvas) {
                  this.resizeDiagramCanvas(canvas);
                  this.redrawDiagram(canvas);
              }
          }
          this.updateDerivedWorkflowDisplays(obligation);
      }
      workflowAttemptPanel(obligation) {
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
      workflowAssessmentPanel(obligation) {
          const spec = obligation.workflow;
          const checkpoints = this.checkpointAssessment(spec.checkpoints);
          let specific = "";
          if (spec.kind === "recall") {
              specific = `${checkpoints}${this.cueLevelField()}<div class="attempt-preserved"><strong>Your attempt remains above or in your external workspace.</strong></div>`;
          }
          else if (spec.kind === "reconstruction") {
              specific = `${checkpoints}<div class="evidence-grid">${this.rubric("Structural accuracy", "structural-accuracy", "Was the overall organisation correct?")}${this.rubric("Relationship accuracy", "relationship-accuracy", "Were links, order and causation correct?")}</div>${this.cueLevelField()}`;
          }
          else if (spec.kind === "questions") {
              const target = spec.targetCount ?? 1;
              specific = `<div class="question-results"><label>Target<input id="questions-target" type="number" value="${target}" readonly></label><label>Attempted<input id="questions-attempted" data-evidence-input type="number" min="1" max="500" value="${target}"></label><label>Correct<input id="questions-correct" data-evidence-input type="number" min="0" max="500" value="0"></label><label>Partially correct<input id="questions-partial" data-evidence-input type="number" min="0" max="500" value="0"></label><label>Incorrect<output id="questions-incorrect-output">${target}</output></label><label>Novel / transfer questions<input id="questions-novel" data-evidence-input type="number" min="0" max="500" value="0"></label></div><label>Per-question error summary<textarea id="questions-error-summary" data-evidence-input rows="4" placeholder="Optional: Q3—confused mechanism; Q7—missed qualifier; Q9—guessed correctly..."></textarea></label>${this.cueLevelField()}`;
          }
          else if (spec.kind === "diagram") {
              specific = `${checkpoints}<label class="check-option strong-check"><input id="diagram-attempt-completed" data-evidence-input type="checkbox" checked>I completed a diagram before seeing the reference.</label><div class="evidence-grid">${this.rubric("Labels", "diagram-labels", "Correct, complete and placed appropriately")}${this.rubric("Spatial form", "diagram-spatial", "Shape and relationships match the concept")}${this.rubric("Process / direction", "diagram-process", "Arrows, stages or sequence are accurate")}</div>${this.cueLevelField()}<label>Diagram notes<textarea id="diagram-notes" data-evidence-input rows="3" placeholder="What was missing or distorted?"></textarea></label>`;
          }
          else if (spec.kind === "answer-writing") {
              specific = `<div class="evidence-grid answer-rubrics">${this.rubric("Demand addressed", "answer-demand", "Directly answers the command and exact demand")}${this.rubric("Structure", "answer-structure-score", "Coherent introduction, body and conclusion")}${this.rubric("Content accuracy", "answer-content", "Accurate, relevant and sufficiently deep")}${this.rubric("Examples / evidence", "answer-examples", "Uses examples, data, diagrams or authorities appropriately")}${this.rubric("Conclusion", "answer-conclusion", "Closes the argument rather than stopping abruptly")}</div><div class="answer-metrics"><label>Word count<input id="answer-word-count" data-evidence-input type="number" min="0" max="10000" value="0"></label><div class="auto-time-metric"><span>Automatic attempt timing</span><strong id="answer-attempt-time">—</strong><small id="answer-time-status">Measured when the source was opened.</small></div></div>${this.cueLevelField()}`;
          }
          else {
              specific = `${checkpoints}<label class="check-option strong-check"><input id="relearn-assessment-source-closed" data-evidence-input type="checkbox" checked>Verification was completed with the source closed.</label>`;
          }
          const ratingGuidance = obligation.type === "memory-recall"
              ? `<div class="policy-box"><strong>FSRS rating:</strong> Again = failed recall; Hard = partial or cued recall; Good = complete independent recall; choose Easy only when recall was unusually effortless.</div>`
              : "";
          const difficultyGuidance = obligation.type === "memory-recall"
              ? (() => {
                  const assessment = memoryDifficultyAssessment(obligation, this.service.getSettings().memoryDifficultyPolicy);
                  if (assessment.level === "normal")
                      return "";
                  const label = assessment.level === "persistent-difficulty" ? "Persistent difficulty" : assessment.level === "remediation" ? "Remediation" : "Early learning difficulty";
                  const burden = assessment.level === "learning-difficulty"
                      ? `${assessment.earlyLearningFailures} failed learning recalls`
                      : `${assessment.establishedLapses} established FSRS lapses`;
                  return `<div class="policy-box"><strong>${label}:</strong> ${burden} · ${escapeHtml(assessment.recommendedActions.map(memoryDifficultyActionLabel).join(" · "))}.</div>`;
              })()
              : "";
          return `<section class="evidence-panel"><div class="workflow-head"><div><span>COMPARE & RECORD</span><h2>${escapeHtml(workflowLabel(spec.kind))} evidence</h2></div><p>The app converts modality-specific results into a common evidence record.</p></div>${specific}${this.commonEvidenceFields()}${difficultyGuidance}<div class="suggested-rating"><span>Evidence-based suggestion</span><strong id="suggested-rating">Complete the assessment</strong></div>${ratingGuidance}<div class="rating-grid">${this.reviewPreviews.map((preview) => `<button class="rating-btn ${ratingName(preview.rating).toLowerCase()}" data-action="rate" data-rating="${preview.rating}"><strong>${ratingName(preview.rating)}</strong><span>${escapeHtml(preview.label)}</span></button>`).join("")}</div><div class="policy-box"><strong>Policy:</strong> ${escapeHtml(obligation.policyState.engine)}. The workflow produces evidence; the policy determines the next obligation date.</div></section>`;
      }
      checkpointAssessment(checkpoints) {
          return `<fieldset class="checkpoint-assessment"><legend>Checkpoints retrieved correctly</legend><div class="checkpoint-list">${checkpoints.map((item, index) => `<label class="check-option"><input id="checkpoint-${index}" data-checkpoint data-evidence-input type="checkbox">${escapeHtml(item)}</label>`).join("")}</div></fieldset>`;
      }
      cueLevelField() {
          return `<label>Cueing used<select id="cue-level" data-evidence-input><option value="none">None</option><option value="minor">Minor cue</option><option value="major">Major cue</option><option value="source">Source consulted during attempt</option></select></label>`;
      }
      commonEvidenceFields() {
          const errors = ["factual-omission", "conceptual-misunderstanding", "confusion-interference", "application-failure", "answer-structure", "diagram-reconstruction", "slow-retrieval"];
          return `<div class="evidence-form"><label class="wide">Correction note<textarea id="correction-note" data-evidence-input rows="3" placeholder="What must be repaired before the next review?"></textarea></label><fieldset class="wide"><legend>Error types</legend><div class="check-grid">${errors.map((type) => `<label class="check-option"><input id="error-${type}" data-error-type data-evidence-input type="checkbox" value="${type}">${escapeHtml(errorLabel(type))}</label>`).join("")}</div></fieldset></div>`;
      }
      rubric(title, id, help) {
          return `<div class="rubric"><label><span>${escapeHtml(title)}</span><output id="${id}-output">2 / 4</output></label><input id="${id}" data-rubric data-evidence-input type="range" min="0" max="4" step="1" value="2"><p class="helper">${escapeHtml(help)}</p></div>`;
      }
      applyReviewPhase() {
          this.reviewContent.querySelectorAll("[data-review-phase]").forEach((section) => { section.hidden = section.dataset["reviewPhase"] !== this.reviewPhase; });
      }
      validateAttemptBeforeCompare(obligation) {
          const spec = obligation.workflow;
          if (spec.kind === "diagram") {
              const completed = this.reviewContent.querySelector("#attempt-completed")?.checked ?? this.diagramStrokes.length > 0;
              assert(completed, "Complete the diagram before opening the reference.");
              return;
          }
          if (spec.kind === "questions") {
              assert(this.reviewContent.querySelector("#attempt-completed")?.checked, "Confirm that the questions were attempted before checking.");
              return;
          }
          if (spec.responseMedium === "in-app") {
              const id = spec.kind === "answer-writing" ? "#answer-text" : "#attempt-text";
              assert((this.reviewContent.querySelector(id)?.value.trim().length ?? 0) >= 3, "Complete a genuine retrieval attempt before checking.");
          }
          else {
              assert(this.reviewContent.querySelector("#attempt-completed")?.checked, "Confirm that the external or oral attempt was completed.");
          }
      }
      collectWorkflowResult(obligation) {
          const spec = obligation.workflow;
          const text = (selector) => this.reviewContent.querySelector(selector)?.value.trim() ?? "";
          const number = (selector, fallback = 0) => Number(this.reviewContent.querySelector(selector)?.value ?? fallback);
          const checked = (selector) => this.reviewContent.querySelector(selector)?.checked ?? false;
          const checkpoints = [...this.reviewContent.querySelectorAll("[data-checkpoint]")];
          const checkpointTotal = Math.max(1, spec.checkpoints.length);
          const checkpointsMet = checkpoints.filter((input) => input.checked).length;
          const cueLevel = literalChoice(this.reviewContent.querySelector("#cue-level")?.value ?? "none", CUE_LEVELS, "Cue level");
          let result;
          if (spec.kind === "recall") {
              result = { kind: "recall", responseMedium: spec.responseMedium, attemptText: text("#attempt-text"), checkpointTotal, checkpointsMet, cueLevel };
          }
          else if (spec.kind === "reconstruction") {
              result = { kind: "reconstruction", responseMedium: spec.responseMedium, attemptText: text("#attempt-text"), shape: spec.reconstructionShape ?? "outline", checkpointTotal, checkpointsMet, structuralAccuracy: literalChoice(number("#structural-accuracy", 2), RUBRIC_SCORES, "Structural accuracy"), relationshipAccuracy: literalChoice(number("#relationship-accuracy", 2), RUBRIC_SCORES, "Relationship accuracy"), cueLevel };
          }
          else if (spec.kind === "questions") {
              const attempted = number("#questions-attempted", spec.targetCount ?? 1);
              const correct = number("#questions-correct");
              const partial = number("#questions-partial");
              result = { kind: "questions", targetCount: spec.targetCount ?? 1, attempted, correct, partial, incorrect: attempted - correct - partial, novelCount: number("#questions-novel"), cueLevel, questionSetRef: spec.questionSetRef ?? "External question set", attemptNotes: text("#attempt-text"), errorSummary: text("#questions-error-summary") };
          }
          else if (spec.kind === "diagram") {
              result = { kind: "diagram", surface: spec.diagramSurface ?? "canvas", checkpointTotal, checkpointsMet, labelAccuracy: literalChoice(number("#diagram-labels", 2), RUBRIC_SCORES, "Diagram label accuracy"), spatialAccuracy: literalChoice(number("#diagram-spatial", 2), RUBRIC_SCORES, "Diagram spatial accuracy"), processAccuracy: literalChoice(number("#diagram-process", 2), RUBRIC_SCORES, "Diagram process accuracy"), cueLevel, attemptCompleted: checked("#diagram-attempt-completed"), notes: text("#diagram-notes") };
          }
          else if (spec.kind === "answer-writing") {
              const timeLimitMinutes = spec.timeLimitMinutes ?? obligation.expectedMinutes;
              const attemptElapsedMs = Math.max(this.attemptElapsedMs, this.closedBookAttemptMs());
              result = { kind: "answer-writing", mode: spec.answerMode ?? "full-answer", responseMedium: spec.responseMedium, answerText: text("#answer-text"), demandAddressed: literalChoice(number("#answer-demand", 2), RUBRIC_SCORES, "Answer demand score"), structure: literalChoice(number("#answer-structure-score", 2), RUBRIC_SCORES, "Answer structure score"), contentAccuracy: literalChoice(number("#answer-content", 2), RUBRIC_SCORES, "Answer content score"), examplesEvidence: literalChoice(number("#answer-examples", 2), RUBRIC_SCORES, "Answer examples score"), conclusion: literalChoice(number("#answer-conclusion", 2), RUBRIC_SCORES, "Answer conclusion score"), completedWithinTime: attemptElapsedMs <= timeLimitMinutes * 60_000, attemptElapsedMs, timeLimitMinutes, wordCount: number("#answer-word-count"), wordLimit: spec.wordLimit ?? 150, cueLevel };
          }
          else {
              result = { kind: "relearning", diagnosis: literalChoice(this.reviewContent.querySelector("#relearn-diagnosis")?.value ?? "conceptual-misunderstanding", ERROR_TYPE_VALUES, "Relearning diagnosis"), repairAction: text("#relearn-repair-action"), verificationText: text("#relearn-verification-text"), checkpointTotal, checkpointsMet, sourceClosedForVerification: checked("#relearn-source-closed") && checked("#relearn-assessment-source-closed"), repairCompleted: checked("#relearn-repair-completed") };
          }
          validateWorkflowResult(result, spec.kind);
          return result;
      }
      collectEvidence(rating, obligation) {
          assert(this.reviewPhase === "compare", "Complete the retrieval and comparison before rating.");
          const workflowResult = this.collectWorkflowResult(obligation);
          const errors = [...this.reviewContent.querySelectorAll("[data-error-type]:checked")].map((input) => literalChoice(input.value, ERROR_TYPE_VALUES, "Error type"));
          const correctionNote = this.reviewContent.querySelector("#correction-note")?.value.trim() ?? "";
          const normalized = workflowEvidence(workflowResult, errors, correctionNote);
          const timing = this.timingSummary();
          return { ...normalized, workflowResult, elapsedMs: timing.totalActiveMs, timing, confirmedRating: rating };
      }
      updateEvidenceSuggestion(obligation) {
          this.updateDerivedWorkflowDisplays(obligation);
          for (const input of this.reviewContent.querySelectorAll("[data-rubric]")) {
              const output = this.reviewContent.querySelector(`#${input.id}-output`);
              if (output)
                  output.textContent = `${input.value} / 4`;
          }
          const target = this.reviewContent.querySelector("#suggested-rating");
          if (!target)
              return;
          try {
              const result = this.collectWorkflowResult(obligation);
              const errors = [...this.reviewContent.querySelectorAll("[data-error-type]:checked")].map((input) => literalChoice(input.value, ERROR_TYPE_VALUES, "Error type"));
              const evidence = workflowEvidence(result, errors, this.reviewContent.querySelector("#correction-note")?.value ?? "");
              const suggested = suggestRating(obligation.type, evidence);
              target.textContent = `${ratingName(suggested)} · score ${roundTo(objectiveScore(obligation.type, evidence), 1)}/4`;
          }
          catch (error) {
              target.textContent = error instanceof Error ? error.message : "Complete the assessment";
          }
      }
      updateDerivedWorkflowDisplays(obligation) {
          if (obligation.workflow.kind === "questions") {
              const attempted = Number(this.reviewContent.querySelector("#questions-attempted")?.value ?? 0);
              const correct = Number(this.reviewContent.querySelector("#questions-correct")?.value ?? 0);
              const partial = Number(this.reviewContent.querySelector("#questions-partial")?.value ?? 0);
              const output = this.reviewContent.querySelector("#questions-incorrect-output");
              if (output)
                  output.textContent = String(Math.max(0, attempted - correct - partial));
          }
          if (obligation.workflow.kind === "answer-writing") {
              const text = this.reviewContent.querySelector("#answer-text")?.value.trim() ?? "";
              const count = text ? text.split(/\s+/).filter(Boolean).length : 0;
              const live = this.reviewContent.querySelector("#answer-live-count");
              if (live)
                  live.textContent = String(count);
              const field = this.reviewContent.querySelector("#answer-word-count");
              if (field && obligation.workflow.responseMedium === "in-app")
                  field.value = String(count);
              const elapsed = Math.max(this.attemptElapsedMs, this.closedBookAttemptMs());
              const limit = (obligation.workflow.timeLimitMinutes ?? obligation.expectedMinutes) * 60_000;
              const timing = this.reviewContent.querySelector("#answer-attempt-time");
              const status = this.reviewContent.querySelector("#answer-time-status");
              if (timing)
                  timing.textContent = formatDuration(elapsed);
              if (status) {
                  const within = elapsed <= limit;
                  status.textContent = within ? `Within the ${obligation.workflow.timeLimitMinutes ?? obligation.expectedMinutes}-minute limit.` : `Exceeded the ${obligation.workflow.timeLimitMinutes ?? obligation.expectedMinutes}-minute limit.`;
                  status.classList.toggle("bad", !within);
              }
          }
      }
      captureReviewDraft() {
          const targetId = this.activeReviewIds[this.activeReviewIndex];
          if (!targetId || !this.reviewContent.querySelector(".review-card"))
              return;
          this.snapshotCurrentDraft();
          this.scheduleActiveRetrievalSave();
      }
      restoreReviewDraft(obligationId) {
          const snapshot = this.reviewDrafts.get(obligationId);
          if (!snapshot) {
              this.diagramStrokes = [];
              this.attemptElapsedMs = 0;
              return;
          }
          this.reviewPhase = snapshot.phase;
          for (const [id, value] of Object.entries(snapshot.values)) {
              const element = this.reviewContent.querySelector(`#${CSS.escape(id)}`);
              if (element)
                  element.value = value;
          }
          for (const [id, value] of Object.entries(snapshot.checked)) {
              const element = this.reviewContent.querySelector(`#${CSS.escape(id)}`);
              if (element)
                  element.checked = value;
          }
          this.diagramStrokes = clone(snapshot.diagramStrokes);
          this.attemptElapsedMs = snapshot.attemptElapsedMs;
      }
      resizeDiagramCanvas(canvas) {
          const ratio = Math.max(1, window.devicePixelRatio || 1);
          const width = Math.max(280, canvas.clientWidth || canvas.parentElement?.clientWidth || 280);
          const height = Math.max(300, Math.min(520, Math.round(width * 0.62)));
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          canvas.style.height = `${height}px`;
      }
      initializeDiagramCanvas(obligation) {
          if (obligation.workflow.kind !== "diagram" || obligation.workflow.diagramSurface !== "canvas")
              return;
          const canvas = this.reviewContent.querySelector("#diagram-canvas");
          if (!canvas)
              return;
          this.resizeDiagramCanvas(canvas);
          this.redrawDiagram(canvas);
          const point = (event) => {
              const rect = canvas.getBoundingClientRect();
              return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
          };
          canvas.addEventListener("pointerdown", (event) => { if (!this.requireMutable("draw this diagram"))
              return; canvas.setPointerCapture(event.pointerId); this.activeDiagramStroke = [point(event)]; this.diagramStrokes.push(this.activeDiagramStroke); this.redrawDiagram(canvas); });
          canvas.addEventListener("pointermove", (event) => { if (!this.ownership.canMutate() || !this.activeDiagramStroke)
              return; this.activeDiagramStroke.push(point(event)); this.redrawDiagram(canvas); });
          const finish = () => { this.activeDiagramStroke = null; this.scheduleActiveRetrievalSave(); };
          canvas.addEventListener("pointerup", finish);
          canvas.addEventListener("pointercancel", finish);
      }
      redrawDiagram(canvas) {
          const target = canvas ?? this.reviewContent.querySelector("#diagram-canvas");
          if (!target)
              return;
          const ctx = target.getContext("2d");
          if (!ctx)
              return;
          const ratio = Math.max(1, window.devicePixelRatio || 1);
          ctx.clearRect(0, 0, target.width, target.height);
          ctx.fillStyle = "#0b0d13";
          ctx.fillRect(0, 0, target.width, target.height);
          ctx.strokeStyle = "#e8ff00";
          ctx.lineWidth = 2 * ratio;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          for (const stroke of this.diagramStrokes) {
              if (stroke.length === 0)
                  continue;
              ctx.beginPath();
              ctx.moveTo(stroke[0].x * target.width, stroke[0].y * target.height);
              for (const point of stroke.slice(1))
                  ctx.lineTo(point.x * target.width, point.y * target.height);
              ctx.stroke();
          }
      }
      startTimer() {
          this.stopTimer();
          if (!this.ownership.canMutate()) {
              this.updateTimerDisplay();
              return;
          }
          this.timerHandle = window.setInterval(() => {
              if (!this.phaseTime)
                  return;
              const before = this.phaseTime.hasPendingGap();
              this.reconcilePhaseTime("tick");
              if (!before && this.phaseTime.hasPendingGap())
                  this.forceActiveRetrievalSave();
          }, 1000);
          this.updateTimerDisplay();
      }
      stopTimer() {
          if (this.timerHandle)
              window.clearInterval(this.timerHandle);
          this.timerHandle = 0;
      }
      async handleAction(element) {
          const action = element.dataset["action"];
          try {
              const nonMutating = action === "export-backup" || action === "export-fsrs-evidence";
              if (!nonMutating && !this.requireMutable("change Revision Director data"))
                  return;
              if (action === "add-unit")
                  await this.openUnitDialog();
              else if (action === "log-study")
                  await this.openStudyDialog();
              else if (action === "start-due")
                  await this.startDueSession();
              else if (action === "review-one")
                  await this.startObligationSession(element.dataset["id"] ?? "");
              else if (action === "review-chunk")
                  await this.startReviewSession([`chunk:${element.dataset["id"] ?? ""}`]);
              else if (action === "regenerate-plan") {
                  await this.service.dailyPlan(new Date(), true);
                  await this.renderAll();
                  this.toast("Daily plan regenerated and previous version preserved.");
              }
              else if (action === "review-unit")
                  await this.startUnitSession(element.dataset["id"] ?? "");
              else if (action === "add-obligation")
                  await this.openObligationDialog(element.dataset["id"] ?? "");
              else if (action === "resume-persistent-difficulty") {
                  await this.service.resumePersistentDifficulty(element.dataset["id"] ?? "");
                  await this.renderAll();
                  this.toast("Memory obligation returned to the normal queue.");
              }
              else if (action === "toggle-unit") {
                  await this.service.updateUnitStatus(element.dataset["id"] ?? "", literalChoice(element.dataset["status"], ENTITY_STATUSES, "Unit status"));
                  await this.renderAll();
                  this.toast("Knowledge-unit status updated.");
              }
              else if (action === "derive-unit")
                  await this.deriveUnitFromStudy(element.dataset["id"] ?? "");
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
              }
              else if (action === "begin-verification") {
                  assert((this.reviewContent.querySelector("#relearn-repair-action")?.value.trim().length ?? 0) >= 3, "Record the repair action.");
                  assert(this.reviewContent.querySelector("#relearn-repair-completed")?.checked, "Complete the repair before verification.");
                  const obligationId = this.activeReviewIds[this.activeReviewIndex];
                  assert(obligationId, "Review obligation is missing.");
                  assert(this.phaseTime && this.phaseTime.status() === "running", "Resume the retrieval before beginning verification.");
                  this.phaseTime.transition("relearn-verify", "begin-verification", false);
                  this.reviewPhase = "relearn-verify";
                  this.applyReviewPhase();
                  this.forceActiveRetrievalSave();
              }
              else if (action === "check-verification") {
                  assert((this.reviewContent.querySelector("#relearn-verification-text")?.value.trim().length ?? 0) >= 3, "Complete the closed-book verification.");
                  assert(this.reviewContent.querySelector("#relearn-source-closed")?.checked, "Confirm that the source remained closed during verification.");
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
              }
              else if (action === "diagram-clear") {
                  this.diagramStrokes = [];
                  this.redrawDiagram();
                  this.scheduleActiveRetrievalSave();
              }
              else if (action === "diagram-undo") {
                  this.diagramStrokes.pop();
                  this.redrawDiagram();
                  this.scheduleActiveRetrievalSave();
              }
              else if (action === "complete-chunk")
                  await this.completeActiveChunk();
              else if (action === "rate")
                  await this.commitRating(validateRating(Number(element.dataset["rating"])));
              else if (action === "end-session") {
                  await this.endReviewSession();
                  await this.openPane("today");
              }
              else if (action === "add-profile")
                  await this.addProfileFromSettings();
              else if (action === "save-profile")
                  await this.saveProfileFromSettings(element.dataset["id"] ?? "");
              else if (action === "toggle-pause")
                  this.togglePause();
              else if (action === "refresh-storage") {
                  await this.service.refreshStorageHealth(true);
                  await this.renderCoordinator.invalidateAndWait("settings", "storage", "ownership");
                  this.toast("Storage capability refreshed.");
              }
              else if (action === "export-fsrs-evidence")
                  await this.exportFsrsOptimizerEvidence();
              else if (action === "optimize-fsrs-locally")
                  await this.optimizeFsrsLocally();
              else if (action === "cancel-fsrs-optimization")
                  this.fsrsOptimizerRun?.cancel();
              else if (action === "activate-fsrs-profile") {
                  await this.service.activateFsrsOptimizerProfile();
                  await this.renderAll();
                  this.toast("Personalized FSRS-7 activated and memory schedules reprojected.");
              }
              else if (action === "deactivate-fsrs-profile") {
                  await this.service.deactivateFsrsOptimizerProfile();
                  await this.renderAll();
                  this.toast("Returned to stock FSRS-7 and memory schedules reprojected.");
              }
              else if (action === "clear-fsrs-profile") {
                  await this.service.clearFsrsOptimizerProfile();
                  await this.renderAll();
                  this.toast("Staged FSRS optimizer profile removed.");
              }
              else if (action === "export-backup")
                  await this.exportBackup();
              else if (action === "create-restore-safety")
                  await this.createRestoreSafetyCopy();
              else if (action === "perform-restore")
                  await this.performRestore();
              else if (action === "cancel-restore")
                  this.cancelRestorePreview();
          }
          catch (error) {
              this.toast(error instanceof Error ? error.message : "Action failed.", true);
          }
      }
      async startObligationSession(obligationId) {
          const obligation = await this.service.obligation(obligationId);
          const chunking = obligation.chunking;
          if (chunking?.status === "chunking") {
              const pending = (await this.service.chunksForObligation(obligation.id)).find((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "pending");
              if (pending) {
                  await this.startReviewSession([`chunk:${pending.id}`]);
                  return;
              }
          }
          await this.startReviewSession([obligation.id]);
      }
      async startDueSession() {
          assert(this.requireMutable("start the daily review"), "This tab is read-only.");
          const plan = await this.service.dailyPlan(new Date(), false, true);
          await this.startReviewSession(plan.selected.map((item) => item.chunk ? `chunk:${item.chunk.id}` : item.joined.obligation.id));
      }
      async startUnitSession(unitId) {
          const obligations = (await this.service.obligationsForUnit(unitId)).filter((item) => item.status === "active");
          assert(obligations.length > 0, "This unit has no active revision obligations.");
          const targets = [];
          for (const obligation of obligations) {
              const chunking = obligation.chunking;
              if (chunking?.status === "chunking") {
                  const pending = (await this.service.chunksForObligation(obligation.id)).find((chunk) => chunk.cycleId === chunking.cycleId && chunk.status === "pending");
                  if (pending) {
                      targets.push(`chunk:${pending.id}`);
                      continue;
                  }
              }
              targets.push(obligation.id);
          }
          await this.startReviewSession(targets);
      }
      async startReviewSession(ids) {
          if (!this.requireMutable("start a retrieval session"))
              return;
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
          if (session)
              await this.activePersistence.flush(session);
          await this.openPane("review");
      }
      async completeActiveChunk() {
          if (!this.requireMutable("complete a retrieval chunk"))
              return;
          if (this.commitInFlight)
              return;
          this.commitInFlight = true;
          try {
              const target = this.activeReviewIds[this.activeReviewIndex];
              assert(target && target.startsWith("chunk:"), "Split-session target is missing.");
              const chunkId = target.slice(6);
              assert(this.phaseTime && this.phaseTime.status() === "running", "Resume and classify interruptions before completing this chunk.");
              const timing = this.timingSummary();
              const note = this.reviewContent.querySelector("#chunk-note")?.value ?? "";
              const commitToken = uid("commit");
              const committing = this.buildActiveRetrievalSession("committing", commitToken);
              assert(committing, "Active retrieval state is missing.");
              const post = await this.postCommitSession(commitToken);
              try {
                  await this.activePersistence.flush(committing);
                  const guard = { sessionId: ACTIVE_RETRIEVAL_ID, expectedRevision: committing.revision, targetId: target, commitToken };
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
              }
              catch (error) {
                  const resumed = this.buildActiveRetrievalSession("active");
                  if (resumed)
                      await this.activePersistence.flush(resumed).catch(() => undefined);
                  throw error;
              }
          }
          finally {
              this.commitInFlight = false;
          }
      }
      async endReviewSession(clearPersistence = true) {
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
          if (clearPersistence)
              await this.activePersistence.clear();
      }
      async commitRating(rating) {
          if (!this.requireMutable("commit review evidence"))
              return;
          if (this.commitInFlight)
              return;
          this.commitInFlight = true;
          this.reviewContent.querySelectorAll('[data-action="rate"]').forEach((button) => { button.disabled = true; });
          try {
              const obligationId = this.activeReviewIds[this.activeReviewIndex];
              assert(obligationId, "Review obligation is missing.");
              const obligation = await this.service.obligation(obligationId);
              const evidence = this.collectEvidence(rating, obligation);
              const suggestion = suggestRating(obligation.type, evidence);
              if (Math.abs(rating - suggestion) >= 2) {
                  const proceed = window.confirm(`Objective evidence suggests ${ratingName(suggestion)}, but you selected ${ratingName(rating)}. Keep your rating?`);
                  if (!proceed)
                      return;
              }
              const commitToken = uid("commit");
              const committing = this.buildActiveRetrievalSession("committing", commitToken);
              assert(committing, "Active retrieval state is missing.");
              const post = await this.postCommitSession(commitToken);
              try {
                  await this.activePersistence.flush(committing);
                  const guard = { sessionId: ACTIVE_RETRIEVAL_ID, expectedRevision: committing.revision, targetId: obligationId, commitToken };
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
              }
              catch (error) {
                  const resumed = this.buildActiveRetrievalSession("active");
                  if (resumed)
                      await this.activePersistence.flush(resumed).catch(() => undefined);
                  throw error;
              }
          }
          finally {
              this.commitInFlight = false;
              this.reviewContent.querySelectorAll('[data-action="rate"]').forEach((button) => { button.disabled = false; });
          }
      }
      async openUnitDialog(prefill) {
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
      async submitUnit(event) {
          if (!this.requireMutable("save a knowledge unit"))
              return;
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
          }
          catch (error) {
              this.toast(error instanceof Error ? error.message : "Could not save the unit.", true);
          }
      }
      async openStudyDialog(prefill) {
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
      async submitStudy(event) {
          if (!this.requireMutable("save a Study Event"))
              return;
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
          }
          catch (error) {
              this.toast(error instanceof Error ? error.message : "Could not save the Study Event.", true);
          }
      }
      async openObligationDialog(unitId) {
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
      async submitObligation(event) {
          if (!this.requireMutable("save a revision obligation"))
              return;
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
          }
          catch (error) {
              this.toast(error instanceof Error ? error.message : "Could not add the obligation.", true);
          }
      }
      async deriveUnitFromStudy(eventId) {
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
              workflow: defaultWorkflowSpec(event.activityMode === "test" || event.activityMode === "practice" ? "application-practice" : "memory-recall", "Attempt retrieval without opening the source.", "State the required material accurately and independently."),
          });
      }
      async submitSettings(event) {
          if (!this.requireMutable("save settings"))
              return;
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
          }
          catch (error) {
              this.toast(error instanceof Error ? error.message : "Could not save settings.", true);
          }
      }
      async saveProfileFromSettings(profileId) {
          if (!this.requireMutable("update an exam profile"))
              return;
          const editor = this.settingsContent.querySelector(`[data-profile-editor="${CSS.escape(profileId)}"]`);
          assert(editor, "Exam profile editor is unavailable.");
          const nameInput = editor.querySelector("[data-profile-name]");
          const dateInput = editor.querySelector("[data-profile-date]");
          const statusInput = editor.querySelector("[data-profile-status]");
          assert(nameInput && dateInput && statusInput, "Exam profile inputs are unavailable.");
          const name = nameInput.value;
          const examDate = dateInput.value;
          const status = statusInput.value === "suspended" ? "suspended" : "active";
          await this.service.updateProfile(profileId, name, examDate, status);
          await this.renderAll();
          this.toast("Exam horizon updated; today’s plan recalculated.");
      }
      async addProfileFromSettings() {
          if (!this.requireMutable("create an exam profile"))
              return;
          const name = this.settingsContent.querySelector("#new-profile-name")?.value ?? "";
          const date = this.settingsContent.querySelector("#new-profile-date")?.value ?? "";
          await this.service.createProfile(name, date);
          await this.renderAll();
          this.toast("Exam profile created.");
      }
      async flushCurrentRetrievalForBackup() {
          assert(!this.commitInFlight, "A review Evidence commit is still in progress.");
          if (!this.ownership.canMutate())
              return;
          if (this.phaseTime)
              this.reconcilePhaseTime("snapshot");
          const session = this.buildActiveRetrievalSession();
          if (session) {
              assert(session.status === "active", "A committing retrieval cannot be backed up.");
              this.activePersistence.forceEmergency(session);
              await this.activePersistence.flush(session);
          }
      }
      async loadPluginFiles(input) {
          if (!this.requireMutable("load a plugin")) {
              input.value = "";
              return;
          }
          const files = [...(input.files ?? [])];
          if (!files.length)
              return;
          try {
              const results = await this.extensions.loadLocalFiles(files);
              const registered = results.filter((entry) => entry.state === "loaded").length;
              const failed = results.filter((entry) => entry.state === "failed" || entry.state === "rejected").length;
              this.toast(`${registered} plugin file${registered === 1 ? "" : "s"} loaded${failed ? ` · ${failed} failed or rejected` : ""}.`, failed > 0 && registered === 0);
          }
          catch (error) {
              this.toast(error instanceof Error ? error.message : "Plugin loading failed.", true);
          }
          finally {
              input.value = "";
              await this.renderCoordinator.invalidateAndWait("settings", "ownership");
          }
      }
      async optimizeFsrsLocally() {
          assert(this.requireMutable("optimize and stage personalized FSRS-7 weights"), "This tab is read-only.");
          assert(!this.fsrsOptimizerRun, "FSRS optimization is already running.");
          const personalization = effectiveFsrsPersonalization(this.service.getSettings());
          assert(!personalization.active, "Return to stock FSRS-7 before optimizing a replacement profile.");
          const availability = browserFsrsOptimizerAvailability();
          assert(availability.available, availability.reason);
          const snapshot = await this.service.optimizerEvidenceSnapshot();
          assert(snapshot.summary.reviews > 0, "No memory-review evidence is available for optimization.");
          this.fsrsOptimizerProgress = { stage: "Preparing local evidence", current: 0, total: 0 };
          const run = startBrowserFsrsOptimizer(snapshot.csv, {
              onProgress: (progress) => this.updateFsrsOptimizerProgress(progress),
          });
          this.fsrsOptimizerRun = run;
          await this.refreshFsrsPersonalizationCard();
          try {
              const profile = await run.promise;
              assert(this.requireMutable("stage the locally optimized FSRS-7 profile"), "Review control changed before optimizer staging.");
              const staged = await this.service.stageFsrsOptimizerProfile(profile);
              this.toast(`Local FSRS-7 optimization passed the holdout gate · ${staged.evidenceItems} optimizer items. Profile staged; activation remains explicit.`);
          }
          catch (error) {
              if (error instanceof DOMException && error.name === "AbortError") {
                  if (this.ownership.canMutate())
                      this.toast("FSRS optimization cancelled.");
              }
              else if (error instanceof FsrsOptimizerRejectedError) {
                  this.toast(`Personalized FSRS-7 was not staged · ${error.reasons.join("; ")}`, true);
              }
              else {
                  this.toast(error instanceof Error ? error.message : "Local FSRS optimization failed.", true);
              }
          }
          finally {
              if (this.fsrsOptimizerRun === run)
                  this.fsrsOptimizerRun = undefined;
              this.fsrsOptimizerProgress = undefined;
              await this.refreshFsrsPersonalizationCard();
          }
      }
      async exportFsrsOptimizerEvidence() {
          const snapshot = await this.service.optimizerEvidenceSnapshot();
          assert(snapshot.summary.reviews > 0, "No memory-review evidence is available for optimizer export.");
          const date = new Date().toISOString().slice(0, 10);
          downloadBlob(`revision-director-fsrs-evidence-${date}.csv`, snapshot.csv, "text/csv;charset=utf-8");
          this.toast(`FSRS optimizer evidence exported · ${snapshot.summary.reviews} reviews across ${snapshot.summary.cards} cards · ${snapshot.summary.reliableDurations} reliable retrieval durations.`);
      }
      async importFsrsOptimizerProfile(input) {
          if (!this.requireMutable("stage an FSRS optimizer profile")) {
              input.value = "";
              return;
          }
          const file = input.files?.[0];
          if (!file)
              return;
          try {
              assert(file.size <= 64 * 1024, "FSRS optimizer profile exceeds the 64 KiB limit.");
              const parsed = JSON.parse(await file.text());
              const profile = await this.service.stageFsrsOptimizerProfile(parsed);
              await this.renderAll();
              this.toast(`Validated FSRS-7 profile staged · ${profile.evidenceItems} optimizer items. Activation remains explicit.`);
          }
          catch (error) {
              this.toast(error instanceof Error ? error.message : "FSRS optimizer profile import failed.", true);
          }
          finally {
              input.value = "";
          }
      }
      async exportBackup() {
          await this.flushCurrentRetrievalForBackup();
          const archive = await this.backupController.createVerified(true);
          const date = new Date().toISOString().slice(0, 10);
          downloadBlob(`revision-director-backup-${date}.rdbackup`, archive.bytes, BACKUP_ARCHIVE_MIME);
          this.toast(`Verified backup exported · ${archive.inspection.totalDocuments} documents · ${formatFileSize(archive.inspection.compressedBytes)}.`);
      }
      async importBackup(event) {
          if (!this.requireMutable("restore a backup"))
              return;
          const target = event.target;
          assert(target instanceof HTMLInputElement, "Backup file input is unavailable.");
          const input = target;
          const file = input.files?.[0];
          if (!file)
              return;
          try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const candidate = await this.backupController.inspect(bytes);
              this.restoreCandidateId = candidate.id;
              this.restoreSafetyProofId = "";
              this.renderRestorePreview(candidate);
              this.dialogFocus.open(this.restoreDialog, '[data-action="create-restore-safety"]');
          }
          catch (error) {
              this.toast(error instanceof Error ? error.message : "Backup inspection failed.", true);
          }
          finally {
              input.value = "";
          }
      }
      renderRestorePreview(candidate) {
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
      async createRestoreSafetyCopy() {
          assert(this.restoreCandidateId, "No inspected backup is available.");
          await this.flushCurrentRetrievalForBackup();
          const artifact = await this.backupController.createSafetyCopy(this.restoreCandidateId);
          this.restoreSafetyProofId = artifact.proofId;
          downloadBlob(artifact.filename, artifact.bytes, artifact.mimeType);
          const result = this.restorePreview.querySelector("#restore-safety-result");
          if (result)
              result.innerHTML = `<p class="${artifact.kind === "forensic-rescue" ? "bad" : "ok"}">${artifact.kind === "verified-backup" ? "Verified safety backup downloaded." : "Forensic rescue downloaded. It preserves raw state but cannot be imported automatically."}</p>${artifact.warning ? `<p>${escapeHtml(artifact.warning)}</p>` : ""}<p class="restore-proof">Proof expires ${escapeHtml(formatDateTime(artifact.expiresAt))}.</p>`;
          const saved = this.restorePreview.querySelector("#restore-safety-saved");
          if (saved) {
              saved.disabled = false;
              saved.checked = false;
              saved.focus();
          }
          this.updateRestoreActionState();
      }
      updateRestoreActionState() {
          const candidate = this.restoreCandidateId ? this.backupController.candidate(this.restoreCandidateId) : undefined;
          const safetySaved = this.restorePreview.querySelector("#restore-safety-saved")?.checked ?? false;
          const replacementConfirmed = this.restorePreview.querySelector("#restore-replace-confirm")?.checked ?? false;
          const treatmentSelected = !candidate?.payload.activeRetrieval || Boolean(this.restorePreview.querySelector('input[name="restore-active-treatment"]:checked'));
          const button = this.restorePreview.querySelector("#restore-final-button");
          if (button)
              button.disabled = !(this.restoreSafetyProofId && safetySaved && replacementConfirmed && treatmentSelected && this.ownership.canMutate());
      }
      async performRestore() {
          assert(this.requireMutable("restore a backup"), "This tab is read-only.");
          assert(this.restoreCandidateId && this.restoreSafetyProofId, "Complete the safety-copy step before restoring.");
          const candidate = this.backupController.candidate(this.restoreCandidateId);
          const treatment = candidate.payload.activeRetrieval
              ? literalChoice(this.restorePreview.querySelector('input[name="restore-active-treatment"]:checked')?.value, BACKUP_ACTIVE_SESSION_TREATMENTS, "Active retrieval restore treatment")
              : "discard";
          const proceed = window.confirm("Final confirmation: replace all current Revision Director records with this verified backup?");
          if (!proceed)
              return;
          const result = await this.backupController.restore(this.restoreCandidateId, this.restoreSafetyProofId, treatment);
          this.activePersistence.resetEmergencyAfterRestore(result.restoredActiveRetrieval);
          this.restoreCandidateId = "";
          this.restoreSafetyProofId = "";
          this.dialogFocus.close(this.restoreDialog);
          await this.hydrateCanonicalState("takeover");
          this.toast(result.restoredActiveRetrieval ? "Verified backup restored with its unfinished retrieval." : "Verified backup restored.");
      }
      cancelRestorePreview() {
          this.backupController.cancel(this.restoreCandidateId || undefined);
          this.restoreCandidateId = "";
          this.restoreSafetyProofId = "";
          if (this.restoreDialog.open)
              this.dialogFocus.close(this.restoreDialog);
      }
      handleKeyboard(event) {
          if (!this.ownership.canMutate())
              return;
          if (this.currentPane !== "review" || this.activeReviewIds.length === 0)
              return;
          if (this.activeReviewIds[this.activeReviewIndex]?.startsWith("chunk:"))
              return;
          const target = event.target instanceof HTMLElement ? event.target : null;
          if (target?.matches("input,textarea,select"))
              return;
          if (this.reviewPhase === "attempt" && (event.key === " " || event.key === "Enter")) {
              const reveal = this.reviewContent.querySelector('[data-action="reveal"]');
              if (!reveal)
                  return;
              event.preventDefault();
              reveal.click();
              return;
          }
          if (this.reviewPhase === "compare" && ["1", "2", "3", "4"].includes(event.key)) {
              event.preventDefault();
              void this.commitRating(validateRating(Number(event.key)));
          }
      }
      toast(message, error = false) {
          this.toastElement.textContent = message;
          this.toastElement.classList.toggle("error", error);
          this.toastElement.classList.add("show");
          window.setTimeout(() => this.toastElement.classList.remove("show"), 3000);
      }
  }
  /* ==========================================================================
     VALIDATED STUDY DIRECTOR BRIDGE
     ========================================================================== */

  /* ==========================================================================
     BOOTSTRAP
     ========================================================================== */
  async function boot() {
      try {
          runtimeFsrs();
          if (!PRESENTATION_KERNEL.validatePublicTokens())
              throw new Error("Revision Director presentation tokens are unavailable.");
          const data = await RevisionData.open();
          const service = new RevisionService(data);
          await service.initialize();
          const activePersistence = new ActiveRetrievalPersistence(data);
          const ownership = new ReviewOwnershipCoordinator(data);
          const backupController = new BackupController(service);
          const extensions = new ExtensionRuntime(service, ownership);
          extensions.installPublicApi();
          const ui = new UIController(service, activePersistence, ownership, backupController, extensions);
          await ui.start();
          extensions.announceReady();
      }
      catch (error) {
          const fatal = requiredElement("#fatal-error", HTMLDivElement);
          fatal.hidden = false;
          fatal.textContent = `Revision Director could not start: ${error instanceof Error ? error.message : String(error)}`;
          console.error(error);
      }
  }
  void boot();
})();
