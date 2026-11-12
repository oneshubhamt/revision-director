  /* ==========================================================================
     FSRS-7 BROWSER OPTIMIZER — OPTIONAL LOCAL WORKER/WASM BOUNDARY
     ========================================================================== */

  interface BrowserFsrsOptimizerAvailability {
    readonly available: boolean;
    readonly reason: string;
  }

  interface BrowserFsrsOptimizerProgress {
    readonly stage: string;
    readonly current: number;
    readonly total: number;
  }

  interface BrowserFsrsOptimizerRun {
    readonly promise: Promise<FsrsOptimizerProfile>;
    cancel(): void;
  }

  interface BrowserFsrsOptimizerOptions {
    readonly timeoutMs?: number;
    readonly onProgress?: (progress: BrowserFsrsOptimizerProgress) => void;
  }

  class FsrsOptimizerRejectedError extends Error {
    readonly reasons: readonly string[];

    constructor(reasons: readonly string[]) {
      super(reasons.join("; "));
      this.name = "FsrsOptimizerRejectedError";
      this.reasons = [...reasons];
    }
  }

  const FSRS_BROWSER_OPTIMIZER_CAPABILITY = "wasm32-wasip1-0.6.1" as const;

  function browserFsrsOptimizerAvailability(): BrowserFsrsOptimizerAvailability {
    if (typeof document === "undefined" || typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      return { available: false, reason: "Browser Worker/WebAssembly support is unavailable." };
    }
    if (location.protocol === "file:") {
      return { available: false, reason: "Use the optional optimizer-enabled static distribution over localhost or HTTPS for in-app optimization." };
    }
    const marker = document.querySelector<HTMLMetaElement>('meta[name="revision-director-browser-optimizer"]')?.content;
    if (marker !== FSRS_BROWSER_OPTIMIZER_CAPABILITY) {
      return { available: false, reason: "This build does not include the local FSRS optimizer Worker/WASM assets." };
    }
    if (!globalThis.crypto?.subtle) {
      return { available: false, reason: "Web Crypto is unavailable; serve the optimizer build from a secure context or localhost." };
    }
    return { available: true, reason: "FSRS-7 WebAssembly optimizer available locally in a dedicated Worker." };
  }

  function startBrowserFsrsOptimizer(
    csv: string,
    options: BrowserFsrsOptimizerOptions = {},
  ): BrowserFsrsOptimizerRun {
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
    let rejectPromise: (reason?: unknown) => void = () => undefined;
    let timer: number | undefined;

    const cleanup = () => {
      worker.terminate();
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    };

    if (timeoutMs > 0) {
      timer = window.setTimeout(
        () => rejectOnce(new Error("FSRS optimization timed out.")),
        timeoutMs,
      );
    }

    const promise = new Promise<FsrsOptimizerProfile>((resolve, reject) => {
      rejectPromise = reject;
      worker.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (!isRecord(event.data)) return;
        const message = event.data;
        if (message["requestId"] !== requestId || typeof message["type"] !== "string") return;

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
            ? message["reasons"].filter((reason): reason is string => typeof reason === "string")
            : [];
          rejectOnce(new FsrsOptimizerRejectedError(
            reasons.length > 0 ? reasons : ["Personalized FSRS-7 did not clear the chronological activation gate."],
          ));
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
            if (settled) return;
            settled = true;
            cleanup();
            resolve(profile);
          } catch (error) {
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
