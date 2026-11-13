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
    PERSISTENT_BROWSER_SHIM,
    create_persistent_frame,
    host_state_all as state_all,
    host_state_get as state_get,
    restore_backup_with_safety_copy,
)
FIXTURE = baseline_backup_path()
checks = 0

INTEGRITY_HOOK = "window.__RD_B1_INTEGRITY__={RevisionData,RevisionService,Store}; void boot();"
HTML = BASE_HTML.replace("<head>", "<head>" + PERSISTENT_BROWSER_SHIM, 1).replace("void boot();", INTEGRITY_HOOK, 1)


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def wait_until(frame, predicate, timeout=8000):
    shared_wait_until(
        frame,
        predicate,
        timeout=timeout,
        interval=80,
        message="Timed out waiting for condition",
    )


def idb_get(frame, store: str, key: str):
    return frame.evaluate("""async ([store,key]) => await new Promise((resolve,reject) => {
      const open=indexedDB.open('revision-director',2);
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const tx=open.result.transaction(store,'readonly');
        const request=tx.objectStore(store).get(key);
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>resolve(request.result || null);
      };
    })""", [store,key])


def idb_all(frame, store: str):
    return frame.evaluate("""async (store) => await new Promise((resolve,reject) => {
      const open=indexedDB.open('revision-director',2);
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const tx=open.result.transaction(store,'readonly');
        const request=tx.objectStore(store).getAll();
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>resolve(request.result || []);
      };
    })""", store)



def boot_frame(page):
    frame = create_persistent_frame(
        page,
        HTML,
        name="revision-app",
        element_id="app",
        width=1280,
        height=900,
    )
    wait_until(frame, lambda: frame.locator("html").get_attribute("data-review-ownership") == "primary")
    check(not frame.locator("#fatal-error").is_visible(), "Fatal startup error")
    return frame



def main() -> None:
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        context = browser.new_context(viewport={"width": 1320, "height": 940}, accept_downloads=True)
        page = context.new_page()
        browser_errors = capture_browser_errors(page)
        accept_dialogs(page)
        page.set_content("<body><script>window.__RD_B1_QA_STATE__={local:{},databases:{}}</script></body>")

        frame = boot_frame(page)

        # Concurrent hierarchy creation must converge on one root primary key and
        # one child pathLookup entry rather than creating duplicate nodes.
        concurrency = frame.evaluate("""async () => {
          const api=window.__RD_B1_INTEGRITY__;
          const data=await api.RevisionData.open();
          const service=new api.RevisionService(data);
          await service.initialize();
          const profile=await service.createProfile('Concurrency exam','2030-01-01');
          const subjects=await Promise.all(Array.from({length:12},()=>service.ensureNode(profile.id,null,'subject','Public Administration')));
          const subject=subjects[0];
          const sections=await Promise.all(Array.from({length:12},()=>service.ensureNode(profile.id,subject.id,'section','Administrative Theory')));
          const nodes=await service.nodes();
          return {
            subjectIds:[...new Set(subjects.map(node=>node.id))],
            sectionIds:[...new Set(sections.map(node=>node.id))],
            rootCount:nodes.filter(node=>node.profileId===profile.id && node.parentId===null && node.kind==='subject' && node.normalizedName==='public administration').length,
            sectionCount:nodes.filter(node=>node.profileId===profile.id && node.parentId===subject.id && node.kind==='section' && node.normalizedName==='administrative theory').length,
          };
        }""")
        check(len(concurrency["subjectIds"]) == 1 and concurrency["subjectIds"][0].startswith("subject_"), "Concurrent root creation did not converge on the deterministic root identity")
        check(concurrency["rootCount"] == 1, "Concurrent root creation persisted duplicate subject nodes")
        check(len(concurrency["sectionIds"]) == 1 and concurrency["sectionCount"] == 1, "Concurrent child creation bypassed the unique pathLookup index")

        page.evaluate("document.querySelector('#app').remove()")
        page.evaluate("window.__RD_B1_QA_STATE__={local:{},databases:{}}")
        frame = boot_frame(page)
        frame.locator('[data-pane="settings"]').click()
        restore_backup_with_safety_copy(page, frame, FIXTURE)
        check("restored" in frame.locator("#toast").inner_text().lower(), "Fixture import failed")

        frame.locator('[data-pane="library"]').click()
        row = frame.locator(".unit-row").filter(has_text="Staphylococcus aureus — recognition and clinical reasoning")
        check(row.count() == 1, "Target unit missing")
        row.locator('[data-action="review-unit"]').click()
        wait_until(frame, lambda: frame.locator("#attempt-text").count() == 1)
        check(frame.locator("#attempt-text").count() == 1, "Recall workflow did not start")
        frame.locator("#attempt-text").fill("Recovered closed-book answer")
        wait_until(
            frame,
            lambda: (state_get(page, "activeRetrieval", "current") or {}).get("draft", {}).get("values", {}).get("attempt-text") == "Recovered closed-book answer",
            timeout=5000,
        )

        active = state_get(page, "activeRetrieval", "current")
        check(active and active["status"] == "active", "Active session was not saved in IndexedDB")
        check(active["draft"]["values"].get("attempt-text") == "Recovered closed-book answer", "IndexedDB draft text is wrong")
        envelope = json.loads(frame.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')"))
        check(envelope["session"]["activeTargetId"] == active["activeTargetId"], "Emergency snapshot target differs from IndexedDB")
        check(envelope["session"]["draft"]["values"].get("attempt-text") == "Recovered closed-book answer", "Emergency snapshot did not preserve the typed attempt")

        frame.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator("#attempt-text").count() == 1)
        check(frame.locator("#attempt-text").input_value() == "Recovered closed-book answer", "Unfinished session did not recover after document reconstruction")
        check(frame.locator("#pane-review").evaluate("e=>e.classList.contains('on')"), "Recovered session did not open Review")

        page.evaluate("document.querySelector('#app').remove()")
        page.evaluate("""() => {
          const key='revision-director:active-retrieval:v1';
          const host=window.__RD_B1_QA_STATE__;
          const envelope=JSON.parse(host.local[key]);
          envelope.session.revision += 7;
          envelope.session.updatedAt = new Date(Date.now()+60000).toISOString();
          envelope.savedAt = envelope.session.updatedAt;
          envelope.session.draft.values['attempt-text']='Local emergency copy won';
          host.local[key]=JSON.stringify(envelope);
        }""")
        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator("#attempt-text").count() == 1)
        check(frame.locator("#attempt-text").input_value() == "Local emergency copy won", "Newest local copy did not win recovery arbitration")
        reconciled = state_get(page, "activeRetrieval", "current")
        check(reconciled["draft"]["values"].get("attempt-text") == "Local emergency copy won", "Newest local copy was not reconciled into IndexedDB")

        frame.locator("#attempt-text").fill("Forced lifecycle snapshot")
        frame.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
        forced = json.loads(frame.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')"))
        check(forced["session"]["draft"]["values"].get("attempt-text") == "Forced lifecycle snapshot", "pagehide did not force the emergency snapshot")
        frame.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow'))")
        wait_until(frame, lambda: frame.locator("html").get_attribute("data-review-ownership") == "primary")

        before = len(state_all(page, "evidenceEvents"))
        if frame.locator("#attempt-completed").count() and not frame.locator("#attempt-completed").is_checked():
            frame.locator("#attempt-completed").check()
        frame.locator('[data-action="reveal"]').click()
        wait_until(frame, lambda: frame.locator('[data-review-phase="compare"]').evaluate("e=>!e.hidden"))
        for index in range(frame.locator("[data-checkpoint]").count()):
            box = frame.locator("[data-checkpoint]").nth(index)
            if not box.is_checked():
                box.check()
        for index in range(frame.locator("[data-rubric]").count()):
            frame.locator("[data-rubric]").nth(index).evaluate("e=>{e.value='4';e.dispatchEvent(new Event('input',{bubbles:true}))}")
        if frame.locator("#questions-attempted").count():
            target = int(frame.locator("#questions-target").input_value())
            frame.locator("#questions-attempted").fill(str(target))
            frame.locator("#questions-correct").fill(str(target))
            frame.locator("#questions-partial").fill("0")
            frame.locator("#questions-novel").fill(str(min(target, 3)))
        if frame.locator("#diagram-attempt-completed").count() and not frame.locator("#diagram-attempt-completed").is_checked():
            frame.locator("#diagram-attempt-completed").check()
        if frame.locator("#relearn-assessment-source-closed").count() and not frame.locator("#relearn-assessment-source-closed").is_checked():
            frame.locator("#relearn-assessment-source-closed").check()
        frame.evaluate("""() => {
          const button=document.querySelector('[data-action="rate"][data-rating="3"]');
          button.click(); button.click();
        }""")
        try:
            wait_until(frame, lambda: len(state_all(page, "evidenceEvents")) == before + 1)
        except Exception:
            print("toast", frame.locator("#toast").inner_text(), flush=True)
            print("active", state_get(page, "activeRetrieval", "current"), flush=True)
            print("evidence", state_all(page, "evidenceEvents"), flush=True)
            print("errors", browser_errors, flush=True)
            print("buttons", frame.locator('[data-action="rate"]').count(), [frame.locator('[data-action="rate"]').nth(i).is_disabled() for i in range(frame.locator('[data-action="rate"]').count())], flush=True)
            raise
        after = state_all(page, "evidenceEvents")
        check(len(after) == before + 1, "Double rating created duplicate evidence")
        check(len({event["id"] for event in after}) == len(after), "Evidence identifiers are not unique")
        next_active = state_get(page, "activeRetrieval", "current")
        check(next_active and next_active["status"] == "active" and next_active["activeIndex"] == 1, "Atomic commit did not persist the next queue target")

        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator(".review-card").count() == 1)
        check("2 / 2" in frame.locator("#review-content").inner_text(), "Next queue target did not recover after committed transition")
        frame.locator('[data-action="end-session"]').click()
        wait_until(
            frame,
            lambda: frame.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')") is None
            and state_get(page, "activeRetrieval", "current") is None,
            timeout=5000,
        )
        check(frame.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')") is None, "Manual end did not clear emergency recovery")
        check(state_get(page, "activeRetrieval", "current") is None, "Manual end did not clear IndexedDB active session")
        check(not browser_errors, f"Browser errors: {browser_errors}")

        context.close()
        browser.close()
    print(f"PASS {checks} Pass B1 persistent-browser recovery checks")


if __name__ == "__main__":
    main()
