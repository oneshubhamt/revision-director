(() => {
  "use strict";
  const root = document.documentElement;
  const fallback = "revision-current";
  const apply = (profile) => {
    const selected = profile && typeof profile === "object" ? profile : null;
    root.dataset.presentation = selected?.id || fallback;
    root.dataset.typography = selected?.typography || "revision";
    root.dataset.shape = selected?.shape || "tactical";
    root.dataset.material = selected?.material || "solid";
    root.dataset.depth = selected?.depth || "layered";
    root.dataset.density = selected?.density || "standard";
    root.dataset.responsive = selected?.responsive || "adaptive";
    root.dataset.motion = selected?.motion || "precise";
    root.dataset.charts = selected?.charts || "analytical";
  };
  try {
    const node = document.getElementById("revision-director-presentation-manifest");
    const manifest = node ? JSON.parse(node.textContent || "") : null;
    const profiles = manifest && typeof manifest.profiles === "object" ? manifest.profiles : {};
    const defaultId = String(manifest?.defaults?.presentation || fallback);
    let preferred = defaultId;
    try {
      const stored = localStorage.getItem(String(manifest?.storageKey || "revisionDirector.presentation.v1"));
      if (stored && /^[a-z][a-z0-9-]{0,40}$/.test(stored)) preferred = stored;
    } catch {
      preferred = defaultId;
    }
    apply(profiles[preferred] || profiles[defaultId]);
  } catch {
    apply(null);
  }
})();
