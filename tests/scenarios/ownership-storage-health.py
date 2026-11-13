from __future__ import annotations
from pathlib import Path
import importlib.util
import json
import shutil
import time
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from helpers.browser_harness import ROOT, chromium_executable
FIXTURE = ROOT / "tests/fixtures/browser-baseline.rdbackup"
BASE_HTML = (ROOT / "index.html").read_text()
spec = importlib.util.spec_from_file_location("pass_b1_browser", TESTS / "scenarios/persistent-active-retrieval.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(module)
PERSISTENT_BROWSER_SHIM = module.PERSISTENT_BROWSER_SHIM

B3_SHARED_SHIM = r"""
<script>
(() => {
  const HOST = parent.__RD_B1_QA_STATE__;
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
HTML = BASE_HTML.replace("<head>", "<head>" + PERSISTENT_BROWSER_SHIM + B3_SHARED_SHIM, 1)
checks = 0

def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)

def wait_until(frame, predicate, timeout=10000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if predicate():
            return
        frame.wait_for_timeout(60)
    raise AssertionError("Timed out waiting for condition")

def boot_frame(page, name: str):
    page.evaluate("""name => {
      const old=document.querySelector('#'+name); if(old) old.remove();
      const frame=document.createElement('iframe'); frame.id=name; frame.name=name;
      frame.style.width='1220px'; frame.style.height='860px'; document.body.appendChild(frame);
    }""", name)
    frame = page.frame(name=name)
    if frame is None:
        raise AssertionError(f"Frame {name} was not created")
    frame.set_content(HTML, wait_until="load")
    wait_until(frame, lambda: frame.evaluate("document.documentElement.dataset.reviewOwnership") in ["primary", "secondary", "faulted"])
    check(not frame.locator("#fatal-error").is_visible(), f"Fatal startup error in {name}")
    return frame

def state_all(page, store: str):
    return page.evaluate("""store => {
      const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
      return (raw?.stores?.[store]?.records ?? []).map(([,value]) => structuredClone(value));
    }""", store)


def restore_fixture_d2(page, frame, fixture) -> None:
    module.restore_fixture_d2(page, frame, fixture)

def main() -> None:
    chromium = chromium_executable()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=chromium if chromium else None)
        context = browser.new_context(viewport={"width": 2600, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("dialog", lambda dialog: dialog.accept())
        page.set_content("<body style='display:flex;gap:12px;margin:0'><script>window.__RD_B1_QA_STATE__={local:{},databases:{},channels:{},storage:{persisted:false,persistResult:false,usage:1000,quota:50000000,persistCalls:0}}</script></body>")

        first = boot_frame(page, "first")
        check(first.evaluate("document.documentElement.dataset.reviewOwnership") == "primary", "First document did not own review mutation")
        check(first.locator("#ownership-banner").is_hidden(), "Primary owner showed read-only banner")
        check(page.evaluate("window.__RD_B1_QA_STATE__.storage.persistCalls") == 0, "Startup implicitly requested persistent storage")
        first.locator('[data-pane="settings"]').click()
        wait_until(first, lambda: "available" in first.locator("#settings-content").inner_text().lower())
        check("available" in first.locator("#settings-content").inner_text().lower(), "Passive startup storage state was not reported")

        restore_fixture_d2(page, first, FIXTURE)
        wait_until(first, lambda: "restored" in first.locator("#toast").inner_text().lower())
        first.locator('[data-pane="library"]').click()
        row = first.locator(".unit-row").filter(has_text="Staphylococcus aureus — recognition and clinical reasoning")
        row.locator('[data-action="review-unit"]').click()
        wait_until(first, lambda: first.locator("#attempt-text").count() == 1)
        first.locator("#attempt-text").fill("Canonical answer before handoff")
        first.wait_for_timeout(600)

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
        plugin_error = second.evaluate("""async () => { try { await window.RevisionDirector.plugins.loadLocalFiles([new File(['x'],'secondary.js',{type:'text/javascript'})]); return ''; } catch(error) { return String(error.message || error); } }""")
        check("read-only" in plugin_error.lower(), "Public plugin loader bypassed ownership")
        bridge_error = second.evaluate("""async () => { try { await window.RevisionDirector.intake.importStudyEvent({}); return ''; } catch(error) { return String(error.message || error); } }""")
        check("read-only" in bridge_error.lower(), "Public capability mutation bypassed ownership")

        second.locator("#take-review-control").click()
        wait_until(second, lambda: second.evaluate("document.documentElement.dataset.reviewOwnership") == "primary", timeout=12000)
        wait_until(first, lambda: first.evaluate("document.documentElement.dataset.reviewOwnership") == "secondary", timeout=12000)
        check(second.locator("#ownership-banner").is_hidden(), "New owner retained read-only banner")
        check(first.locator("#ownership-banner").is_visible(), "Previous owner did not become read-only")
        wait_until(second, lambda: second.locator("#attempt-text").count() == 1)
        check(second.locator("#attempt-text").input_value() == "Canonical answer before handoff", "Takeover did not hydrate the flushed active draft")
        check(first.locator("#attempt-text").is_disabled(), "Previous owner's review controls remained mutable")
        lease = json.loads(page.evaluate("window.__RD_B1_QA_STATE__.local['revision-director:review-owner:v1']"))
        check(lease["tabId"] == second.evaluate("JSON.parse(localStorage.getItem('revision-director:review-owner:v1')).tabId"), "Canonical lease does not belong to the new owner")

        # A lifecycle exit releases ownership and the remaining document safely reacquires after release broadcast.
        second.locator("#attempt-text").fill("Draft preserved across exit handoff")
        second.wait_for_timeout(500)
        second.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
        wait_until(first, lambda: first.evaluate("document.documentElement.dataset.reviewOwnership") == "primary", timeout=12000)
        wait_until(first, lambda: first.locator("#attempt-text").count() == 1, timeout=12000)
        check(first.locator("#attempt-text").input_value() == "Draft preserved across exit handoff", "Exit/reacquire hydration lost the latest draft")
        check(second.evaluate("document.documentElement.dataset.reviewOwnership") == "secondary", "Exiting owner retained ownership")

        # Storage persistence and quota reporting.
        page.evaluate("window.__RD_B1_QA_STATE__.storage={persisted:false,persistResult:false,usage:80,quota:100,persistCalls:0}")
        first.evaluate("window.dispatchEvent(new Event('focus'))")
        wait_until(first, lambda: first.locator("#storage-capacity-banner").is_visible())
        check("80%" in first.locator("#storage-capacity-banner").inner_text(), "Quota warning does not report usage")
        check("available" in first.locator("#storage-capacity-banner").inner_text().lower(), "Passive lifecycle check requested persistence or reported the wrong state")
        first.locator('[data-pane="settings"]').click()
        first.locator('[data-action="refresh-storage"]').click()
        wait_until(first, lambda: page.evaluate("window.__RD_B1_QA_STATE__.storage.persistCalls") == 1)
        wait_until(first, lambda: "denied" in first.locator("#settings-content").inner_text().lower())
        check("denied" in first.locator("#settings-content").inner_text().lower(), "Explicit persistence denial was not shown")

        page.evaluate("window.__RD_B1_QA_STATE__.storage.usage=95; window.__RD_B1_QA_STATE__.storage.persisted=true")
        first.locator('[data-action="refresh-storage"]').click()
        wait_until(first, lambda: "critical" in first.locator("#storage-capacity-banner").inner_text().lower())
        check("95%" in first.locator("#storage-capacity-banner").inner_text(), "Critical quota usage was not reported")

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
    print(f"PASS {checks} Pass B3 multi-document ownership checks")

if __name__ == "__main__":
    main()
