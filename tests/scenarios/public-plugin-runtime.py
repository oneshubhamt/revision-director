from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from helpers.browser_harness import (
    ROOT,
    capture_browser_errors,
    launch_chromium,
    wait_for_toast_outcome,
    wait_until as shared_wait_until,
)
from helpers.simulated_storage import create_simulated_frame, reset_simulated_storage, simulated_storage_html
from helpers.browser_fixture import open_page as open_fixture_page
HTML = simulated_storage_html()
checks = 0

def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)

def wait_until(frame, predicate, timeout=10000):
    shared_wait_until(frame, predicate, timeout=timeout, interval=60)

def wait_local_file_settled(frame, name: str, state: str) -> None:
    wait_until(frame, lambda: frame.evaluate(
        "(expected) => RevisionDirector.plugins.status().localFiles.some(x=>x.name===expected.name&&x.state===expected.state)",
        {"name": name, "state": state},
    ))
    # loadPluginFiles records runtime status before its final Settings re-render. Waiting
    # for the filename in the rendered card prevents the next file selection from racing
    # an input element that is about to be replaced.
    wait_until(frame, lambda: name in frame.locator("#settings-content").inner_text())

def boot_frame(page):
    frame = create_simulated_frame(page, HTML, name="app", width=1440, height=1000)
    wait_until(frame, lambda: frame.locator("#fatal-error").count() == 1 and frame.evaluate("typeof window.RevisionDirector === 'object'"))
    wait_until(frame, lambda: frame.evaluate("document.documentElement.dataset.reviewOwnership") in ["primary","secondary","faulted"])
    check(not frame.locator("#fatal-error").is_visible(), "Fatal startup error")
    return frame

def exercise_intake_and_profile_summary(browser) -> None:
    page, errors = open_fixture_page(browser, baseline=True)
    check(page.evaluate("RevisionDirector.version") == "va7.1-pass-f1", "Public API version mismatch")
    invalid = [
        {"area":"A","task":"T","measure":"M","durationMinutes":10,"activityMode":"evil"},
        {"area":"A","task":"T","measure":"M","durationMinutes":10,"understanding":99},
        {"area":"A","task":"T","measure":"M","durationMinutes":10,"occurredAt":"not-a-date"},
    ]
    for payload in invalid:
        result = page.evaluate('async p=>{try{await RevisionDirector.intake.importStudyEvent(p);return "accepted"}catch(e){return String(e.message||e)}}', payload)
        check(result != "accepted", f"Invalid bridge payload accepted: {payload}")
    result = page.evaluate('async()=>RevisionDirector.intake.importStudyEvent({area:"Geology",task:"Bridge event",measure:"1 topic",durationMinutes:25,activityMode:"review",understanding:3})')
    check(bool(result.get("id")), "Valid bridge Study Event failed")
    page.locator('[data-pane="settings"]').click(); page.locator("#pane-settings").wait_for(state="visible")
    profile_ids = page.locator("[data-profile-editor]").evaluate_all(
        "rows => rows.map(row => row.getAttribute('data-profile-editor')).filter(Boolean)"
    )
    check(len(profile_ids) == 2, f"Unexpected bridge profile set: {profile_ids}")
    for profile_id in profile_ids:
        row = page.locator(f'[data-profile-editor="{profile_id}"]')
        check(row.count() == 1, f"Profile editor is missing durable identity: {profile_id}")
        row.locator("[data-profile-status]").select_option("suspended")
        page.evaluate("document.querySelector('#toast').textContent=''")
        row.locator('[data-action="save-profile"]').click()
        wait_for_toast_outcome(
            page,
            expect_error=False,
            timeout=8_000,
            message=f"Profile suspension did not report successful completion: {profile_id}",
        )
        profiles_after_save = page.evaluate("async()=>await RevisionDirector.records.listProfiles()")
        check(
            next((profile["status"] for profile in profiles_after_save if profile["id"] == profile_id), None) == "suspended",
            f"Successful profile save did not persist suspension: {profile_id} · {profiles_after_save}",
        )
    profiles = page.evaluate("async()=>await RevisionDirector.records.listProfiles()")
    check(all(profile["status"] == "suspended" for profile in profiles), f"Public profile summary did not preserve both suspensions: {profiles}")
    shared_wait_until(page, lambda: page.evaluate("async()=> (await RevisionDirector.records.getDueSummary()).dueCount") == 0, timeout=5000, interval=40, message="Paused profiles remained due")
    summary = page.evaluate("RevisionDirector.records.getDueSummary()")
    check(summary["dueCount"] == 0, f"Paused profiles remained in bridge due summary: {summary}")
    check(not errors, f"Browser errors: {errors}")
    page.close()


def main() -> None:
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        context = browser.new_context(viewport={"width": 1600, "height": 1100})
        page = context.new_page()
        errors = capture_browser_errors(page)
        page.set_content("<body></body>")
        reset_simulated_storage(page)
        frame=boot_frame(page)

        check(frame.evaluate("RevisionDirector.version") == "va7.1-pass-f1", "Public API version wrong")
        check(frame.evaluate("RevisionDirector.apiVersion") == 1, "Public API contract version wrong")
        check(frame.evaluate("typeof RevisionDirectorBridge") == "undefined", "Legacy bridge remains public")
        check(frame.evaluate("Object.isFrozen(RevisionDirector) && Object.isFrozen(RevisionDirector.records) && Object.isFrozen(RevisionDirector.intake) && Object.isFrozen(RevisionDirector.plugins)"), "Public API is not frozen")
        check(frame.evaluate("JSON.stringify(Object.keys(RevisionDirector).sort())") == '["apiVersion","capabilities","data","intake","plugins","records","registerPlugin","runtime","version"]', "Public API exposes unexpected operations")
        check(frame.evaluate("!('repository' in RevisionDirector) && !('scheduler' in RevisionDirector) && !('evidence' in RevisionDirector) && !('backup' in RevisionDirector) && !('ui' in RevisionDirector)"), "Sensitive internals are public")
        check(frame.evaluate("RevisionDirector.capabilities.pluginApi===1 && RevisionDirector.capabilities.localPluginFiles===1"), "Plugin capabilities unavailable")

        good = frame.evaluate("""async () => {
          return await RevisionDirector.registerPlugin({name:'Browser Good',version:'1.0',requires:{pluginApi:1},setup(api){window.__RD_GOOD_API__=api.version;return true;}});
        }""")
        check(good is True and frame.evaluate("window.__RD_GOOD_API__") == "va7.1-pass-f1", "Compatible browser plugin failed")
        incompatible = frame.evaluate("""async () => await RevisionDirector.registerPlugin({name:'Browser Future',requires:{pluginApi:2},setup(){return true;}})""")
        check(incompatible is False, "Incompatible browser plugin registered")
        failed = frame.evaluate("""async () => await RevisionDirector.registerPlugin({name:'Browser Failed',setup(){throw new Error('browser isolated failure')}})""")
        check(failed is False, "Throwing browser plugin reported active")
        check(frame.evaluate("RevisionDirector.plugins.status().registered.some(x=>x.name==='Browser Failed'&&x.state==='failed')"), "Failed browser plugin status missing")
        check(frame.evaluate("RevisionDirector.runtime.storageHealth().level") == "healthy", "Plugin failure polluted storage-health state")
        check(frame.locator('[data-pane="today"]').is_visible(), "Plugin failure broke the application")

        frame.locator('[data-pane="settings"]').click()
        wait_until(frame, lambda: frame.locator("#load-plugin-files").count() == 1)
        check("Trusted JavaScript only" in frame.locator("#settings-content").inner_text(), "Trusted-plugin warning missing")

        with TemporaryDirectory() as tmpdir:
            tmp=Path(tmpdir)
            good_file=tmp/"rd-local-good.js"
            good_file.write_text("void RevisionDirector.registerPlugin({name:'Local Good',version:'1.2',requires:{dueSummary:1},async setup(api){window.__RD_LOCAL_SUMMARY__=await api.records.getDueSummary();return true;}});")
            frame.locator("#load-plugin-files").set_input_files(str(good_file))
            wait_until(frame, lambda: frame.evaluate("RevisionDirector.plugins.status().registered.some(x=>x.name==='Local Good'&&x.state==='registered')"))
            wait_local_file_settled(frame, "rd-local-good.js", "loaded")
            check(frame.evaluate("window.__RD_LOCAL_SUMMARY__.dueCount") == 0, "Local plugin did not receive canonical API")
            wait_until(frame, lambda: "Local Good" in frame.locator("#settings-content").inner_text()); check(True, "Local plugin status rendered")

            inactive_file=tmp/"rd-local-inactive.js"
            inactive_file.write_text("window.__RD_INACTIVE_FILE__=true;")
            frame.locator("#load-plugin-files").set_input_files(str(inactive_file))
            wait_local_file_settled(frame, "rd-local-inactive.js", "inactive")
            check(frame.evaluate("window.__RD_INACTIVE_FILE__===true"), "Inactive local file did not evaluate")

            fail_file=tmp/"rd-local-fail.js"
            fail_file.write_text("throw new Error('local plugin boom');")
            frame.locator("#load-plugin-files").set_input_files(str(fail_file))
            wait_local_file_settled(frame, "rd-local-fail.js", "failed")
            check(frame.locator("#fatal-error").is_hidden(), "Failed local plugin caused fatal startup state")

            wrong_file=tmp/"not-a-plugin.txt"
            wrong_file.write_text("nothing")
            frame.locator("#load-plugin-files").set_input_files(str(wrong_file))
            wait_local_file_settled(frame, "not-a-plugin.txt", "rejected")

            large_file=tmp/"too-large.js"
            large_file.write_bytes(b"/" + b"*" + b"x"*(1024*1024) + b"*" + b"/")
            frame.locator("#load-plugin-files").set_input_files(str(large_file))
            wait_local_file_settled(frame, "too-large.js", "rejected")

        statuses=frame.evaluate("RevisionDirector.plugins.status()")
        check(any(x["name"]=="rd-local-good.js" and x["state"]=="loaded" for x in statuses["localFiles"]), "Loaded local-file status missing")
        check(any(x["name"]=="rd-local-fail.js" and x["state"]=="failed" for x in statuses["localFiles"]), "Failed local-file status missing")
        check(any(x["name"]=="not-a-plugin.txt" and x["state"]=="rejected" for x in statuses["localFiles"]), "Rejected extension status missing")
        check(any(x["name"]=="too-large.js" and x["state"]=="rejected" for x in statuses["localFiles"]), "Oversize plugin status missing")
        check(frame.locator('[data-pane="library"]').is_enabled(), "Application navigation broke after plugin failures")
        # Plugin execution errors are consumed by the loader and recorded as plugin status/diagnostics.
        check(not errors, f"Uncontained browser errors: {errors}")
        context.close(); exercise_intake_and_profile_summary(browser); browser.close()
    print(f"PASS {checks} public API and plugin browser checks")

if __name__ == "__main__":
    main()
