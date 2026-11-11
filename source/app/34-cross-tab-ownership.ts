  type ReviewOwnershipState = "secondary" | "acquiring" | "hydrating" | "primary" | "releasing" | "faulted";
  type ReviewOwnershipHydrationReason = "startup" | "takeover" | "reacquire";

  interface ReviewOwnershipLease {
    version: 1;
    tabId: string;
    claimId: string;
    expiresAt: number;
    updatedAt: ISODateTime;
  }

  interface ReviewOwnershipSnapshot {
    state: ReviewOwnershipState;
    tabId: string;
    canMutate: boolean;
    revision: number;
    ownerTabId?: string;
    ownerExpiresAt?: number;
    lastError?: string;
  }

  interface ReviewOwnershipCallbacks {
    flush(): Promise<void>;
    hydrate(reason: ReviewOwnershipHydrationReason): Promise<void>;
    changed(snapshot: ReviewOwnershipSnapshot): void;
  }

  interface ReviewOwnershipMessage {
    type: "heartbeat" | "release" | "takeover-request" | "takeover-ready";
    tabId: string;
    requestId?: string;
    expiresAt?: number;
  }

  class ReviewOwnershipCoordinator {
    private readonly tabId = uid("tab");
    private state: ReviewOwnershipState = "secondary";
    private revision = 0;
    private claimId = "";
    private lastError = "";
    private callbacks: ReviewOwnershipCallbacks | undefined;
    private heartbeatHandle = 0;
    private channel: BroadcastChannel | undefined;
    private started = false;
    private takeoverPending: { requestId: string; resolve(value: boolean): void } | undefined;

    constructor(private readonly data: RevisionData) {}

    snapshot(): ReviewOwnershipSnapshot {
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

    canMutate(): boolean {
      const lease = this.readLease();
      return Boolean(this.state === "primary" && lease && lease.tabId === this.tabId && lease.claimId === this.claimId && lease.expiresAt > Date.now());
    }

    async start(callbacks: ReviewOwnershipCallbacks): Promise<void> {
      if (this.started) return;
      this.started = true;
      this.callbacks = callbacks;
      this.installChannel();
      window.addEventListener("storage", (event) => {
        if (event.key === REVIEW_OWNER_STORAGE_KEY && !this.takeoverPending) void this.evaluate("reacquire");
      });
      this.heartbeatHandle = window.setInterval(() => {
        if (this.takeoverPending) return;
        if (this.state === "primary" || this.state === "hydrating") this.renew();
        else void this.evaluate("reacquire");
      }, REVIEW_OWNER_HEARTBEAT_MS);
      await this.evaluate("startup");
    }

    async takeControl(): Promise<boolean> {
      const lease = this.readLease();
      if (this.otherOwnerActive(lease)) {
        const requestId = uid("takeover");
        const ready = new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (value: boolean) => { if (settled) return; settled = true; resolve(value); };
          const timer = window.setTimeout(() => finish(false), REVIEW_OWNER_TAKEOVER_WAIT_MS);
          this.takeoverPending = { requestId, resolve: (value) => { window.clearTimeout(timer); finish(value); } };
        });
        this.post({ type: "takeover-request", tabId: this.tabId, requestId });
        const released = await ready;
        this.takeoverPending = undefined;
        if (!released && this.otherOwnerActive()) return false;
      }
      this.takeoverPending = undefined;
      return this.acquire("takeover", false);
    }

    async evaluate(reason: ReviewOwnershipHydrationReason = "reacquire"): Promise<boolean> {
      if (this.takeoverPending || this.state === "acquiring" || this.state === "hydrating" || this.state === "releasing") return false;
      const lease = this.readLease();
      if (this.otherOwnerActive(lease)) {
        this.claimId = "";
        this.transition("secondary");
        return false;
      }
      if (lease && lease.tabId !== this.tabId && lease.expiresAt <= Date.now()) safeLocalStorageRemove(REVIEW_OWNER_STORAGE_KEY);
      if (lease?.tabId === this.tabId && lease.expiresAt > Date.now()) {
        this.claimId = lease.claimId;
        if (this.state !== "primary") return this.acquire(reason, true);
        this.renew();
        return true;
      }
      return this.acquire(reason, false);
    }

    noteVisibilityHidden(): void {
      if (this.state === "primary" || this.state === "hydrating") this.renew();
    }

    async releaseForExit(): Promise<void> {
      if (this.state !== "primary" && this.state !== "hydrating") return;
      this.transition("releasing");
      this.releaseLease();
      this.transition("secondary");
    }

    dispose(): void {
      if (this.heartbeatHandle) window.clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = 0;
      try { this.channel?.close(); } catch { /* non-fatal */ }
      this.channel = undefined;
      this.releaseLease();
      this.transition("secondary");
    }

    private transition(next: ReviewOwnershipState, error = ""): void {
      if (this.state !== next) this.revision += 1;
      this.state = next;
      this.lastError = error;
      document.documentElement.dataset["reviewOwnership"] = next;
      this.callbacks?.changed(this.snapshot());
    }

    private readLease(): ReviewOwnershipLease | undefined {
      const raw = safeLocalStorageGet(REVIEW_OWNER_STORAGE_KEY);
      if (!raw) return undefined;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return undefined;
        if (parsed["version"] !== 1 || typeof parsed["tabId"] !== "string" || typeof parsed["claimId"] !== "string" || !Number.isFinite(parsed["expiresAt"]) || typeof parsed["updatedAt"] !== "string") return undefined;
        return { version: 1, tabId: parsed["tabId"], claimId: parsed["claimId"], expiresAt: Number(parsed["expiresAt"]), updatedAt: parsed["updatedAt"] };
      } catch { return undefined; }
    }

    private otherOwnerActive(lease = this.readLease(), now = Date.now()): boolean {
      return Boolean(lease && lease.tabId !== this.tabId && lease.expiresAt > now);
    }

    private writeLease(claimId: string): boolean {
      const now = Date.now();
      const lease: ReviewOwnershipLease = { version: 1, tabId: this.tabId, claimId, expiresAt: now + REVIEW_OWNER_STALE_MS, updatedAt: new Date(now).toISOString() };
      if (!safeLocalStorageSet(REVIEW_OWNER_STORAGE_KEY, JSON.stringify(lease))) return false;
      const verified = this.readLease();
      return Boolean(verified && verified.tabId === this.tabId && verified.claimId === claimId && verified.expiresAt > now);
    }

    private async acquire(reason: ReviewOwnershipHydrationReason, force: boolean): Promise<boolean> {
      const existing = this.readLease();
      if (!force && this.otherOwnerActive(existing)) { this.transition("secondary"); return false; }
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
        if (!verified || verified.tabId !== this.tabId || verified.claimId !== this.claimId || verified.expiresAt <= Date.now()) throw new Error("Review ownership changed during canonical hydration.");
        this.transition("primary");
        this.post({ type: "heartbeat", tabId: this.tabId, expiresAt: verified.expiresAt });
        return true;
      } catch (error) {
        this.data.recordDiagnostic("ownership.hydrate", "hydrate canonical review state", error);
        this.releaseLease();
        this.claimId = "";
        this.transition("faulted", error instanceof Error ? error.message : String(error));
        return false;
      }
    }

    private renew(): void {
      if (!this.claimId || (this.state !== "primary" && this.state !== "hydrating")) return;
      if (!this.writeLease(this.claimId)) {
        const error = new Error("Review ownership heartbeat could not be verified.");
        this.data.recordDiagnostic("ownership.heartbeat", "renew review ownership", error);
        this.claimId = "";
        this.transition("faulted", error.message);
        return;
      }
      const lease = this.readLease();
      if (lease) this.post({ type: "heartbeat", tabId: this.tabId, expiresAt: lease.expiresAt });
    }

    private releaseLease(): void {
      const lease = this.readLease();
      if (lease?.tabId === this.tabId) {
        safeLocalStorageRemove(REVIEW_OWNER_STORAGE_KEY);
        this.post({ type: "release", tabId: this.tabId });
      }
      this.claimId = "";
    }

    private async releaseForTakeover(requestId: string): Promise<void> {
      if (this.state !== "primary") return;
      this.transition("releasing");
      try { await this.callbacks?.flush(); }
      catch (error) {
        this.data.recordDiagnostic("ownership.release-flush", "flush before ownership handoff", error);
        this.transition("primary", error instanceof Error ? error.message : String(error));
        return;
      }
      this.releaseLease();
      this.transition("secondary");
      this.post({ type: "takeover-ready", tabId: this.tabId, requestId });
    }

    private post(message: ReviewOwnershipMessage): void {
      try { this.channel?.postMessage(message); }
      catch (error) { this.data.recordDiagnostic("ownership.channel-post", "post ownership message", error); }
    }

    private installChannel(): void {
      if (!("BroadcastChannel" in window)) return;
      try {
        this.channel = new BroadcastChannel(REVIEW_OWNER_CHANNEL);
        this.channel.onmessage = (event: MessageEvent<unknown>) => {
          if (!isRecord(event.data)) return;
          const type = event.data["type"];
          const tabId = event.data["tabId"];
          if (!literalChoiceOrUndefined(type, ["heartbeat", "release", "takeover-request", "takeover-ready"] as const) || typeof tabId !== "string" || tabId === this.tabId) return;
          const requestId = event.data["requestId"];
          const expiresAt = event.data["expiresAt"];
          if (requestId !== undefined && typeof requestId !== "string") return;
          if (expiresAt !== undefined && !Number.isFinite(expiresAt)) return;
          const message: ReviewOwnershipMessage = {
            type,
            tabId,
            ...(requestId !== undefined ? { requestId } : {}),
            ...(expiresAt !== undefined ? { expiresAt: Number(expiresAt) } : {}),
          };
          if (message.type === "takeover-request" && message.requestId) { void this.releaseForTakeover(message.requestId); return; }
          if (message.type === "takeover-ready" && message.requestId && this.takeoverPending?.requestId === message.requestId) { this.takeoverPending.resolve(true); return; }
          if (message.type === "heartbeat" && Number(message.expiresAt) > Date.now()) {
            const lease = this.readLease();
            if (lease && lease.tabId === message.tabId && lease.expiresAt > Date.now() && this.state !== "releasing") this.transition("secondary");
            return;
          }
          if (message.type === "release" && !this.takeoverPending) void this.evaluate("reacquire");
        };
      } catch (error) {
        this.data.recordDiagnostic("ownership.channel-install", "install ownership channel", error);
      }
    }
  }
