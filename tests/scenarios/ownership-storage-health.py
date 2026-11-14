from __future__ import annotations
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import (
    ROOT,
    accept_dialogs,
    capture_browser_errors,
    launch_chromium,
    wait_until as shared_wait_until,
)
from helpers.persistent_browser import (
    BASE_HTML,
    create_simulated_frame,
    reset_simulated_storage,
    simulated_state_all as state_all,
    simulated_state_get as state_get,
    simulated_storage_html,
)
from helpers.browser_fixture import restore_backup_with_safety_copy
FIXTURE = baseline_backup_path()

OWNERSHIP_SHARED_SHIM = r"""
<script>
(() => {
  const HOST = parent.__RD_SIMULATED_STORAGE_STATE__;
  if (!HOST.channels) HOST.channels = {};
  if (!HOST.storage) HOST.storage = { persisted: true, persistResult: true, usage: 1000, quota: 50000000, persistCalls: 0 };
  class SharedBroadcastChannel {
    constructor(name) {
      this.name=String(name); this.onmessage=null; this.closed=false;
      (HOST.channels[this.name] ||= []).push(this);
    }
    postMessage(data) {
      for (const peer of HOST.channels[this.name] || []) {
        if (peer === this || peer.closed) continue;
        const payload=structuredClone(data);
        setTimeout(() => peer.onmessage && peer.onmessage({data:payload}), 0);
      }
    }
    close() { this.closed=true; HOST.channels[this.name]=(HOST.channels[this.name] || []).filter(peer => peer !== this); }
  }
  Object.defineProperty(window,'BroadcastChannel',{configurable:true,value:SharedBroadcastChannel});
  Object.defineProperty(navigator,'storage',{configurable:true,value:{
    persisted: async () => Boolean(HOST.storage.persisted),
    persist: async () => { HOST.storage.persistCalls += 1; if (HOST.storage.persistError) throw new Error(HOST.storage.persistError); return Boolean(HOST.storage.persistResult); },
    estimate: async () => ({usage:Number(HOST.storage.usage),quota:Number(HOST.storage.quota)}),
  }});
})();
</script>
"""
HTML = simulated_storage_html(OWNERSHIP_SHARED_SHIM, base_html=BASE_HTML)
checks = 0

def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)

def wait_until(frame, predicate, timeout=10000):
    shared_wait_until(frame, predicate, timeout=timeout, interval=60)

def boot_frame(page, name: str):
    frame = create_simulated_frame(page, HTML, name=name, width=1220, height=860)
    wait_until(frame, lambda: frame.evaluate("document.documentElement.dataset.reviewOwnership") in ["primary", "secondary", "faulted"])
    check(not frame.locator("#fatal-error").is_visible(), f"Fatal startup error in {name}")
    return frame

def main() -> None:
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        context = browser.new_context(viewport={"width": 2600, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        errors = capture_browser_errors(page)
        accept_dialogs(page)
        page.set_content("<body style='display:flex;gap:12px;margin:0'></body>")
        reset_simulated_storage(page, {
            "local": {},
            "databases": {},
            "channels": {},
            "storage": {"persisted": False, "persistResult": False, "usage": 1000, "quota": 50_000_000, "persistCalls": 0},
        })

        first = boot_frame(page, "first")
        check(first.evaluate("document.documentElement.dataset.reviewOwnership") == "primary", "First document did not own review mutation")
        check(first.locator("#ownership-banner").is_hidden(), "Primary owner showed read-only banner")
        check(page.evaluate("window.__RD_SIMULATED_STORAGE_STATE__.storage.persistCalls") == 0, "Startup implicitly requested persistent storage")
        first.locator('[data-pane="settings"]').click()
        wait_until(first, lambda: first.evaluate("RevisionDirector.runtime.storageHealth().indexedDbAvailable"))
        startup_storage = first.evaluate("RevisionDirector.runtime.storageHealth()")
        check(startup_storage["indexedDbAvailable"] and startup_storage["persistence"] == "available", f"Passive startup storage state is wrong: {startup_storage}")

        restore_backup_with_safety_copy(page, first, FIXTURE)
        first.locator('[data-pane="library"]').click()
        row = first.locator(".unit-row").filter(has_text="Staphylococcus aureus — recognition and clinical reasoning")
        row.locator('[data-action="review-unit"]').click()
        wait_until(first, lambda: first.locator("#attempt-text").count() == 1)
        first.locator("#attempt-text").fill("Canonical answer before handoff")
        wait_until(
            first,
            lambda: (state_get(page, "activeRetrieval", "current") or {}).get("draft", {}).get("values", {}).get("attempt-text") == "Canonical answer before handoff",
        )

        second = boot_frame(page, "second")
        check(second.evaluate("document.documentElement.dataset.reviewOwnership") == "secondary", "Second document was not read-only")
        check(second.locator("#ownership-banner").is_visible(), "Secondary ownership banner is hidden")
        check(second.locator("#quick-add-unit").is_disabled(), "Secondary tab can mutate through quick add")
        second.locator('[data-pane="settings"]').click()
        wait_until(second, lambda: second.locator("#pane-settings").is_visible())
        wait_until(second, lambda: second.locator("#import-backup").is_disabled())
        check(second.locator('[data-action="export-backup"]').is_enabled(), "Secondary tab cannot export a backup")
        check(second.locator("#import-backup").is_disabled(), "Secondary tab can import and replace records")
        check(second.locator("#load-plugin-files").is_disabled(), "Secondary tab can load local plugin files")
        local_files_before = len(second.evaluate("RevisionDirector.plugins.status().localFiles"))
        plugin_rejected = second.evaluate("""async () => { try { await window.RevisionDirector.plugins.loadLocalFiles([new File(['x'],'secondary.js',{type:'text/javascript'})]); return false; } catch { return true; } }""")
        check(plugin_rejected and len(second.evaluate("RevisionDirector.plugins.status().localFiles")) == local_files_before, "Public plugin loader bypassed ownership")
        study_before = len(state_all(page, "studyEvents"))
        bridge_rejected = second.evaluate("""async () => { try { await window.RevisionDirector.intake.importStudyEvent({area:'blocked',task:'blocked',measure:'blocked',durationMinutes:10,activityMode:'review'}); return false; } catch { return true; } }""")
        check(bridge_rejected and len(state_all(page, "studyEvents")) == study_before, "Public capability mutation bypassed ownership")

        second.locator("#take-review-control").click()
        wait_until(second, lambda: second.evaluate("document.documentElement.dataset.reviewOwnership") == "primary", timeout=12000)
        wait_until(first, lambda: first.evaluate("document.documentElement.dataset.reviewOwnership") == "secondary", timeout=12000)
        check(second.locator("#ownership-banner").is_hidden(), "New owner retained read-only banner")
        check(first.locator("#ownership-banner").is_visible(), "Previous owner did not become read-only")
        wait_until(second, lambda: second.locator("#attempt-text").count() == 1)
        check(second.locator("#attempt-text").input_value() == "Canonical answer before handoff", "Takeover did not hydrate the flushed active draft")
        check(first.locator("#attempt-text").is_disabled(), "Previous owner's review controls remained mutable")
        lease = json.loads(page.evaluate("window.__RD_SIMULATED_STORAGE_STATE__.local['revision-director:review-owner:v1']"))
        check(lease["tabId"] == second.evaluate("JSON.parse(localStorage.getItem('revision-director:review-owner:v1')).tabId"), "Canonical lease does not belong to the new owner")

        # A lifecycle exit releases ownership and the remaining document safely reacquires after release broadcast.
        second.locator("#attempt-text").fill("Draft preserved across exit handoff")
        wait_until(
            second,
            lambda: (state_get(page, "activeRetrieval", "current") or {}).get("draft", {}).get("values", {}).get("attempt-text") == "Draft preserved across exit handoff",
        )
        second.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
        wait_until(first, lambda: first.evaluate("document.documentElement.dataset.reviewOwnership") == "primary", timeout=12000)
        wait_until(first, lambda: first.locator("#attempt-text").count() == 1, timeout=12000)
        check(first.locator("#attempt-text").input_value() == "Draft preserved across exit handoff", "Exit/reacquire hydration lost the latest draft")
        check(second.evaluate("document.documentElement.dataset.reviewOwnership") == "secondary", "Exiting owner retained ownership")

        # Storage persistence and quota reporting.
        page.evaluate("window.__RD_SIMULATED_STORAGE_STATE__.storage={persisted:false,persistResult:false,usage:80,quota:100,persistCalls:0}")
        first.evaluate("window.dispatchEvent(new Event('focus'))")
        wait_until(first, lambda: first.locator("#storage-capacity-banner").is_visible())
        wait_until(first, lambda: abs((first.evaluate("RevisionDirector.runtime.storageHealth().usageRatio") or 0) - 0.8) < 1e-9)
        warning_storage = first.evaluate("RevisionDirector.runtime.storageHealth()")
        check(warning_storage["level"] == "warning" and warning_storage["persistence"] == "available", f"Passive quota refresh produced the wrong storage state: {warning_storage}")
        first.locator('[data-pane="settings"]').click()
        first.locator('[data-action="refresh-storage"]').click()
        wait_until(first, lambda: page.evaluate("window.__RD_SIMULATED_STORAGE_STATE__.storage.persistCalls") == 1)
        wait_until(first, lambda: first.evaluate("RevisionDirector.runtime.storageHealth().persistence") == "denied")
        denied_storage = first.evaluate("RevisionDirector.runtime.storageHealth()")
        check(denied_storage["persistence"] == "denied" and denied_storage["level"] == "warning", f"Explicit persistence denial was not represented canonically: {denied_storage}")

        page.evaluate("window.__RD_SIMULATED_STORAGE_STATE__.storage.usage=95; window.__RD_SIMULATED_STORAGE_STATE__.storage.persisted=true")
        first.locator('[data-action="refresh-storage"]').click()
        wait_until(first, lambda: first.evaluate("RevisionDirector.runtime.storageHealth().level") == "critical")
        critical_storage = first.evaluate("RevisionDirector.runtime.storageHealth()")
        check(abs(critical_storage["usageRatio"] - 0.95) < 1e-9 and critical_storage["persistence"] == "granted", f"Critical quota state is wrong: {critical_storage}")
        check(first.locator("#storage-capacity-banner").is_visible(), "Critical quota state did not expose the capacity warning surface")

        # Only the current owner can commit; the old document remains blocked.
        before = len(state_all(page, "evidenceEvents"))
        first.locator('[data-pane="review"]').click()
        if first.locator("#attempt-completed").count() and not first.locator("#attempt-completed").is_checked():
            first.locator("#attempt-completed").check()
        first.locator('[data-action="reveal"]').click()
        wait_until(first, lambda: first.locator('[data-review-phase="compare"]').count() and not first.locator('[data-review-phase="compare"]').is_hidden())
        for index in range(first.locator("[data-checkpoint]").count()):
            box = first.locator("[data-checkpoint]").nth(index)
            if not box.is_checked(): box.check()
        for index in range(first.locator("[data-rubric]").count()):
            first.locator("[data-rubric]").nth(index).evaluate("e=>{e.value='4';e.dispatchEvent(new Event('input',{bubbles:true}))}")
        first.locator('[data-action="rate"][data-rating="3"]').click()
        wait_until(first, lambda: len(state_all(page, "evidenceEvents")) == before + 1)
        check(len(state_all(page, "evidenceEvents")) == before + 1, "Owner commit did not create exactly one Evidence Event")
        check(second.locator("#quick-add-unit").is_disabled(), "Released secondary document became mutable without ownership")
        check(not errors, f"Browser errors: {errors}")

        context.close(); browser.close()
    print(f"PASS {checks} ownership/storage health multi-document ownership checks")

if __name__ == "__main__":
    main()
