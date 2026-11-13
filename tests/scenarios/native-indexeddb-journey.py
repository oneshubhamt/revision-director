from __future__ import annotations

from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))

from helpers.browser_harness import (
    ROOT,
    accept_dialogs,
    capture_browser_errors,
    launch_persistent_chromium,
    wait_until,
)

checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, format, *args):
        pass


@contextmanager
def app_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/index.html"
    finally:
        server.shutdown()
        server.server_close()


def wait_app_ready(page) -> None:
    page.wait_for_function(
        """() => typeof window.RevisionDirector === 'object'
          && document.querySelector('#fatal-error')
          && !document.querySelector('#fatal-error').offsetParent
          && ['primary','secondary','faulted'].includes(document.documentElement.dataset.reviewOwnership)""",
        timeout=10_000,
    )


def native_state(page):
    return page.evaluate(
        """async () => {
          const db=await new Promise((resolve,reject)=>{
            const request=indexedDB.open('revision-director');
            request.onsuccess=()=>resolve(request.result);
            request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
          });
          const read=store=>new Promise((resolve,reject)=>{
            const tx=db.transaction(store,'readonly');
            const request=tx.objectStore(store).getAll();
            request.onsuccess=()=>resolve(request.result);
            request.onerror=()=>reject(request.error||new Error('IndexedDB read failed: '+store));
          });
          const [profiles,nodes,units,obligations,evidenceEvents,activeRetrieval]=await Promise.all([
            read('profiles'),read('nodes'),read('units'),read('obligations'),read('evidenceEvents'),read('activeRetrieval')
          ]);
          db.close();
          return {profiles,nodes,units,obligations,evidenceEvents,activeRetrieval};
        }"""
    )


def select_by_id(records, record_id: str):
    return next(item for item in records if item["id"] == record_id)


def create_profile_and_unit(page):
    page.locator('[data-pane="settings"]').click()
    page.locator("#settings-content").wait_for(state="visible")
    page.locator("#new-profile-name").fill("Native durability exam")
    page.locator("#new-profile-date").fill("2028-01-15")
    page.locator('[data-action="add-profile"]').click()
    page.locator("[data-profile-editor]").wait_for(state="visible")
    check(page.locator("[data-profile-editor]").count() == 1, "Native IndexedDB profile creation failed")

    page.locator("#quick-add-unit").click()
    page.locator("#unit-dialog").wait_for(state="visible")
    form = page.locator("#unit-form")
    due = page.evaluate("new Date(Date.now()-3600000).toISOString().slice(0,16)")
    values = {
        "subject": "Public Administration",
        "section": "Administrative Theory",
        "topic": "Bureaucracy",
        "title": "Native IndexedDB durable unit",
        "scope": "Weberian authority and bureaucracy",
        "source": "Durability fixture notes",
        "expectedMinutes": "20",
        "workflowPrompt": "Reconstruct the framework from memory.",
        "workflowCheckpoints": "Authority\nHierarchy\nRules",
        "protocol": "Reconstruct before comparison.",
        "successCriteria": "Authority; Hierarchy; Rules",
        "firstDueAt": due,
    }
    for name, value in values.items():
        form.locator(f'[name="{name}"]').fill(value)
    form.locator('[name="obligationType"]').select_option("concept-reconstruction")
    form.locator('[name="workflowKind"]').select_option("reconstruction")
    form.locator('button[type="submit"]').click()
    page.locator("#unit-dialog").wait_for(state="hidden")
    page.wait_for_function("() => document.querySelector('#sb-units')?.textContent?.trim() === '1'")
    return native_state(page)


def start_and_persist_attempt(page) -> None:
    page.locator('[data-pane="library"]').click()
    page.locator("#pane-library").wait_for(state="visible")
    row = page.locator(".unit-row").filter(has_text="Native IndexedDB durable unit")
    check(row.count() == 1, "Native durability unit missing from Library")
    row.locator('[data-action="review-unit"]').click()
    page.locator("#attempt-text").wait_for(state="visible")
    page.locator("#attempt-text").fill("Authority, hierarchy and rules recovered from memory.")

    def draft_persisted() -> bool:
        state = native_state(page)
        if not state["activeRetrieval"]:
            return False
        draft = state["activeRetrieval"][0].get("draft", {}).get("values", {})
        return draft.get("attempt-text") == "Authority, hierarchy and rules recovered from memory."

    wait_until(page, draft_persisted, timeout=5_000, interval=50, message="Native IndexedDB draft was not persisted")


def complete_review(page) -> None:
    page.locator('[data-action="reveal"]').click()
    page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    for index in range(page.locator("[data-checkpoint]").count()):
        box = page.locator("[data-checkpoint]").nth(index)
        if not box.is_checked():
            box.check()
    for selector in ("#structural-accuracy", "#relationship-accuracy"):
        if page.locator(selector).count():
            page.locator(selector).evaluate(
                """e => { e.value='4'; e.dispatchEvent(new Event('input',{bubbles:true})); }"""
            )
    page.locator('[data-action="rate"][data-rating="3"]').click()
    wait_until(
        page,
        lambda: len(native_state(page)["evidenceEvents"]) == 1,
        timeout=8_000,
        interval=50,
        message="Native IndexedDB review commit did not persist evidence",
    )


def main() -> None:
    global checks
    with TemporaryDirectory(prefix="revision-director-native-idb-") as profile_dir:
        with app_server() as url:
            with sync_playwright() as playwright:
                context = launch_persistent_chromium(playwright, profile_dir)
                page = context.pages[0] if context.pages else context.new_page()
                errors = capture_browser_errors(page)
                accept_dialogs(page)
                page.goto(url, wait_until="load")
                wait_app_ready(page)
                check(page.evaluate("document.documentElement.dataset.reviewOwnership") == "primary", "First native tab did not become primary")

                created = create_profile_and_unit(page)
                profile = created["profiles"][0]
                unit = created["units"][0]
                obligation = created["obligations"][0]
                check(profile["name"] == "Native durability exam", "Created profile state is wrong")
                check(unit["title"] == "Native IndexedDB durable unit", "Created unit state is wrong")
                check(obligation["unitId"] == unit["id"], "Created obligation does not belong to durable unit")

                page.reload(wait_until="load")
                wait_app_ready(page)
                after_reload = native_state(page)
                check(select_by_id(after_reload["profiles"], profile["id"]) == profile, "Profile changed across native page reload")
                check(select_by_id(after_reload["units"], unit["id"]) == unit, "Unit changed across native page reload")
                check(select_by_id(after_reload["obligations"], obligation["id"]) == obligation, "Obligation changed across native page reload")

                second = context.new_page()
                second_errors = capture_browser_errors(second)
                accept_dialogs(second)
                second.goto(url, wait_until="load")
                wait_app_ready(second)
                check(second.evaluate("document.documentElement.dataset.reviewOwnership") == "secondary", "Second real tab did not enter read-only ownership")
                second_state = native_state(second)
                check(select_by_id(second_state["units"], unit["id"]) == unit, "Second real tab did not read the shared native IndexedDB unit")
                second.close()

                start_and_persist_attempt(page)
                page.reload(wait_until="load")
                wait_app_ready(page)
                page.locator("#attempt-text").wait_for(state="visible")
                check(
                    page.locator("#attempt-text").input_value() == "Authority, hierarchy and rules recovered from memory.",
                    "Unfinished native IndexedDB draft did not recover after reload",
                )

                complete_review(page)
                committed = native_state(page)
                committed_obligation = select_by_id(committed["obligations"], obligation["id"])
                evidence = committed["evidenceEvents"][0]
                check(evidence["obligationId"] == obligation["id"] and evidence["confirmedRating"] == 3, "Committed evidence identity/rating is wrong")
                check(committed_obligation["dueAt"] == evidence["afterDueAt"], "Committed obligation due date diverged from evidence")
                check(not errors and not second_errors, f"Native IndexedDB browser errors: {errors + second_errors}")

                page.evaluate("localStorage.removeItem('revision-director:review-owner:v1')")
                context.close()

            with sync_playwright() as playwright:
                restarted = launch_persistent_chromium(playwright, profile_dir)
                page = restarted.pages[0] if restarted.pages else restarted.new_page()
                restart_errors = capture_browser_errors(page)
                accept_dialogs(page)
                page.goto(url, wait_until="load")
                wait_app_ready(page)
                restored = native_state(page)

                check(select_by_id(restored["profiles"], profile["id"]) == profile, "Profile changed across Chromium restart")
                check(select_by_id(restored["units"], unit["id"]) == unit, "Unit changed across Chromium restart")
                check(select_by_id(restored["obligations"], obligation["id"]) == committed_obligation, "Reviewed obligation changed across Chromium restart")
                check(select_by_id(restored["evidenceEvents"], evidence["id"]) == evidence, "Evidence Event changed across Chromium restart")
                check(restored["activeRetrieval"] == [], "Completed review left an active retrieval record after restart")

                page.locator('[data-pane="history"]').click()
                page.locator("#history-content").wait_for(state="visible")
                check("Native IndexedDB durable unit" in page.locator("#history-content").inner_text(), "Restarted UI did not project persisted evidence history")
                check(not restart_errors, f"Restart browser errors: {restart_errors}")
                restarted.close()

    print(f"PASS {checks} native application IndexedDB reload/restart/two-tab checks")


if __name__ == "__main__":
    main()
