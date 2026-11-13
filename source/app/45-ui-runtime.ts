  /* ========================================================================== 
     PASS C2 · UI RUNTIME, RENDER COORDINATION AND ACCESSIBILITY
     ========================================================================== */

  interface ElementConstructor<T extends Element> {
    new(): T;
  }

  function formText(data: FormData, name: string, fallback = ""): string {
    const value = data.get(name);
    if (value === null) return fallback;
    assert(typeof value === "string", `${name} must be text.`);
    return value;
  }

  function formNumber(data: FormData, name: string): number {
    const value = Number(formText(data, name));
    assert(Number.isFinite(value), `${name} must be a finite number.`);
    return value;
  }

  function requiredNamedFormControl<T extends Element>(
    form: HTMLFormElement,
    name: string,
    constructor: ElementConstructor<T>,
  ): T {
    const control = form.elements.namedItem(name);
    assert(control instanceof constructor, `Missing or invalid form control: ${name}.`);
    return control;
  }

  function formInput(form: HTMLFormElement, name: string): HTMLInputElement {
    return requiredNamedFormControl(form, name, HTMLInputElement);
  }

  function formSelect(form: HTMLFormElement, name: string): HTMLSelectElement {
    return requiredNamedFormControl(form, name, HTMLSelectElement);
  }

  function formTextarea(form: HTMLFormElement, name: string): HTMLTextAreaElement {
    return requiredNamedFormControl(form, name, HTMLTextAreaElement);
  }

  function escapeHtml(value: unknown): string {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  type PaneId = "today" | "review" | "library" | "study" | "history" | "settings";
  type RenderDomain = PaneId | "plan" | "sidebar" | "ownership" | "storage";
  type RenderCallback = () => void | Promise<void>;

  const RENDER_DOMAIN_ORDER: readonly RenderDomain[] = Object.freeze([
    "plan", "today", "review", "library", "study", "history", "settings", "sidebar", "ownership", "storage",
  ]);

  interface DocumentFocusSnapshot {
    readonly element: HTMLElement | null;
    readonly selector: string;
    readonly selectionStart: number | null;
    readonly selectionEnd: number | null;
    readonly selectionDirection: "forward" | "backward" | "none" | null;
  }

  function attributeSelectorValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function focusSelector(element: HTMLElement): string {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const pane = element.dataset["pane"];
    if (pane) return `[data-pane="${attributeSelectorValue(pane)}"]`;
    const focusKey = element.dataset["focusKey"];
    if (focusKey) return `[data-focus-key="${attributeSelectorValue(focusKey)}"]`;
    const action = element.dataset["action"];
    if (action) {
      const id = element.dataset["id"];
      const rating = element.dataset["rating"];
      return `[data-action="${attributeSelectorValue(action)}"]${id ? `[data-id="${attributeSelectorValue(id)}"]` : ""}${rating ? `[data-rating="${attributeSelectorValue(rating)}"]` : ""}`;
    }
    const name = element.getAttribute("name");
    const form = element.closest<HTMLFormElement>("form[id]");
    if (name && form?.id) return `#${CSS.escape(form.id)} [name="${attributeSelectorValue(name)}"]`;
    return "";
  }

  function captureDocumentFocus(preferredSelector = ""): DocumentFocusSnapshot {
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

  function restoreDocumentFocus(snapshot: DocumentFocusSnapshot | undefined, fallbackSelector = ""): void {
    if (!snapshot) return;
    const existing = snapshot.element?.isConnected ? snapshot.element : null;
    const selector = snapshot.selector || fallbackSelector;
    const target = existing ?? (selector ? document.querySelector<HTMLElement>(selector) : null) ?? (fallbackSelector ? document.querySelector<HTMLElement>(fallbackSelector) : null);
    if (!target || target.hidden || target.closest("[hidden]") || (target instanceof HTMLButtonElement && target.disabled)) return;
    target.focus({ preventScroll: true });
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
      try {
        target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection ?? undefined);
      } catch {
        // Some input types do not support text selection.
      }
    }
  }

  class RenderCoordinator {
    private readonly callbacks = new Map<RenderDomain, RenderCallback>();
    private readonly dirty = new Set<RenderDomain>();
    private readonly debounceHandles = new Map<string, number>();
    private animationHandle = 0;
    private activeFlush: Promise<void> | null = null;

    constructor(
      private readonly beforeFlush: () => DocumentFocusSnapshot | undefined,
      private readonly afterFlush: (snapshot: DocumentFocusSnapshot | undefined) => void,
    ) {}

    register(domain: RenderDomain, callback: RenderCallback): void {
      assert(!this.callbacks.has(domain), `Render domain already registered: ${domain}`);
      this.callbacks.set(domain, callback);
    }

    invalidate(...domains: readonly RenderDomain[]): void {
      for (const domain of domains) {
        assert(this.callbacks.has(domain), `Render domain is not registered: ${domain}`);
        this.dirty.add(domain);
      }
      this.schedule();
    }

    invalidateDebounced(key: string, delayMs: number, ...domains: readonly RenderDomain[]): void {
      const existing = this.debounceHandles.get(key);
      if (existing) window.clearTimeout(existing);
      const handle = window.setTimeout(() => {
        this.debounceHandles.delete(key);
        this.invalidate(...domains);
      }, delayMs);
      this.debounceHandles.set(key, handle);
    }

    async invalidateAndWait(...domains: readonly RenderDomain[]): Promise<void> {
      for (const domain of domains) {
        assert(this.callbacks.has(domain), `Render domain is not registered: ${domain}`);
        this.dirty.add(domain);
      }
      await this.flush();
    }

    async flush(): Promise<void> {
      if (this.animationHandle) {
        window.cancelAnimationFrame(this.animationHandle);
        this.animationHandle = 0;
      }
      if (this.activeFlush) {
        await this.activeFlush;
        if (this.dirty.size) await this.flush();
        return;
      }
      const run = this.drain();
      this.activeFlush = run;
      try {
        await run;
      } finally {
        this.activeFlush = null;
      }
      if (this.dirty.size) await this.flush();
    }

    private schedule(): void {
      if (this.animationHandle || this.activeFlush) return;
      this.animationHandle = window.requestAnimationFrame(() => {
        this.animationHandle = 0;
        void this.flush();
      });
    }

    private async drain(): Promise<void> {
      const focus = this.beforeFlush();
      try {
        while (this.dirty.size) {
          const batch = RENDER_DOMAIN_ORDER.filter((domain) => this.dirty.delete(domain));
          for (const domain of batch) await this.callbacks.get(domain)?.();
        }
      } finally {
        this.afterFlush(focus);
      }
    }
  }

  interface TabRegistryEntry {
    readonly pane: PaneId;
    readonly tab: HTMLButtonElement;
    readonly panel: HTMLElement;
  }

  class AriaTabRegistry {
    private readonly entries: readonly TabRegistryEntry[];

    constructor(
      private readonly tablist: HTMLElement,
      panes: readonly PaneId[],
      private readonly onActivate: (pane: PaneId) => void | Promise<void>,
    ) {
      this.entries = Object.freeze(panes.map((pane) => {
        const tab = requiredElement(`[data-pane="${pane}"]`, HTMLButtonElement);
        const panel = requiredElement(`#pane-${pane}`, HTMLElement);
        return Object.freeze({ pane, tab, panel });
      }));
    }

    initialize(activePane: PaneId): void {
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

    activate(pane: PaneId, focusTab = false, notify = false): void {
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
      if (focusTab) active.tab.focus({ preventScroll: true });
      if (notify) void this.onActivate(pane);
    }

    handleKeydown(event: KeyboardEvent): boolean {
      const tab = (event.target as Element | null)?.closest<HTMLButtonElement>("[role=tab][data-pane]");
      if (!tab || !this.tablist.contains(tab)) return false;
      const index = this.entries.findIndex((entry) => entry.tab === tab);
      if (index < 0) return false;
      let next = index;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % this.entries.length;
      else if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index - 1 + this.entries.length) % this.entries.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = this.entries.length - 1;
      else return false;
      event.preventDefault();
      const entry = this.entries[next];
      if (entry) this.activate(entry.pane, true, true);
      return true;
    }
  }

  function focusableElements(root: HTMLElement): HTMLElement[] {
    const selector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled]):not([type=hidden])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    return [...root.querySelectorAll<HTMLElement>(selector)].filter((element) => {
      if (element.hidden || element.closest("[hidden]") || element.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  class NativeDialogFocusManager {
    private readonly returnTargets = new WeakMap<HTMLDialogElement, DocumentFocusSnapshot>();

    constructor(dialogs: readonly HTMLDialogElement[]) {
      for (const dialog of dialogs) {
        dialog.addEventListener("keydown", (event) => {
          if (event.key !== "Tab" || !dialog.open) return;
          const focusable = focusableElements(dialog);
          if (!focusable.length) {
            event.preventDefault();
            dialog.focus({ preventScroll: true });
            return;
          }
          const first = focusable[0]!;
          const last = focusable[focusable.length - 1]!;
          const active = document.activeElement;
          if (event.shiftKey && (active === first || !dialog.contains(active))) {
            event.preventDefault();
            last.focus({ preventScroll: true });
          } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
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

    open(dialog: HTMLDialogElement, preferredSelector = ""): void {
      this.returnTargets.set(dialog, captureDocumentFocus());
      dialog.showModal();
      window.requestAnimationFrame(() => {
        const target = preferredSelector ? dialog.querySelector<HTMLElement>(preferredSelector) : null;
        (target ?? focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
      });
    }

    close(dialog: HTMLDialogElement): void {
      if (dialog.open) dialog.close();
    }
  }

  class OverlayFocusManager {
    private returnTarget: DocumentFocusSnapshot | undefined;
    private returnSelector = "";
    private preferredSelector = "";

    constructor(
      private readonly overlay: HTMLElement,
      private readonly backgroundRoots: readonly HTMLElement[],
    ) {}

    isOpen(): boolean { return !this.overlay.hidden; }

    show(preferredSelector: string, returnSelector = ""): void {
      this.preferredSelector = preferredSelector;
      if (!this.isOpen()) {
        this.returnTarget = captureDocumentFocus(returnSelector);
        this.returnSelector = returnSelector;
      }
      for (const root of this.backgroundRoots) root.inert = true;
      this.overlay.hidden = false;
      const focusPreferred = (): void => {
        if (!this.isOpen()) return;
        const preferred = this.overlay.querySelector<HTMLElement>(preferredSelector);
        (preferred ?? focusableElements(this.overlay)[0] ?? this.overlay).focus({ preventScroll: true });
      };
      focusPreferred();
      window.requestAnimationFrame(focusPreferred);
    }

    hide(): void {
      if (!this.isOpen()) return;
      this.overlay.hidden = true;
      for (const root of this.backgroundRoots) root.inert = false;
      const snapshot = this.returnTarget;
      const fallback = this.returnSelector;
      this.returnTarget = undefined;
      this.returnSelector = "";
      this.preferredSelector = "";
      window.requestAnimationFrame(() => restoreDocumentFocus(snapshot, fallback));
    }

    focus(preferredSelector: string): void {
      this.preferredSelector = preferredSelector;
      const preferred = this.overlay.querySelector<HTMLElement>(preferredSelector);
      (preferred ?? focusableElements(this.overlay)[0] ?? this.overlay).focus({ preventScroll: true });
    }

    ensureFocus(): void {
      if (!this.isOpen() || this.overlay.contains(document.activeElement)) return;
      this.focus(this.preferredSelector);
    }

    handleKeydown(event: KeyboardEvent): boolean {
      if (!this.isOpen()) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        return true;
      }
      if (event.key !== "Tab") return false;
      const controls = focusableElements(this.overlay);
      if (!controls.length) {
        event.preventDefault();
        this.overlay.focus({ preventScroll: true });
        return true;
      }
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !this.overlay.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !this.overlay.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
      return true;
    }
  }
