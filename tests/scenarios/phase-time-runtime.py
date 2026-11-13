from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json
from backup_fixture_codec import decode_file
import os
import runpy
import shutil
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from helpers.browser_harness import ROOT, chromium_executable
b1 = runpy.run_path(str(TESTS / "scenarios/persistent-active-retrieval.py"), run_name="rd_b1_base")
BASELINE_BACKUP = ROOT / "tests/fixtures/browser-baseline.rdbackup"
PERSISTENT_BROWSER_SHIM = b1["PERSISTENT_BROWSER_SHIM"]
CLOCK_SHIM = r"""
<script>
(() => {
  let current = Date.now();
  Date.now = () => current;
  window.__RD_TEST_CLOCK__ = {
    now: () => current,
    advance: (ms) => { current += Number(ms) || 0; return current; },
    set: (ms) => { current = Number(ms); return current; },
  };
})();
</script>
"""
BASE_HTML = (ROOT / "index.html").read_text()
# Pass B2 advances Date.now() by minutes in milliseconds to exercise phase timing.
# Keep cross-tab ownership out of this synthetic clock domain; Pass B1 separately
# exercises the production 15-second ownership lease.
TIMING_TEST_HTML = BASE_HTML.replace(
    "const REVIEW_OWNER_STALE_MS = 15_000;",
    "const REVIEW_OWNER_STALE_MS = 315_360_000_000;",
    1,
)
HTML = TIMING_TEST_HTML.replace("<head>", "<head>" + PERSISTENT_BROWSER_SHIM + CLOCK_SHIM, 1)
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def wait(frame, ms=1150):
    frame.wait_for_timeout(ms)


def wait_until(frame, predicate, timeout=6000):
    import time
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except Exception:
            pass
        frame.wait_for_timeout(80)
    raise AssertionError("Timed out waiting for persisted browser state")


def state_get(page, store: str, key: str):
    return page.evaluate("""([store,key]) => {
      const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
      const records=raw?.stores?.[store]?.records ?? [];
      const found=records.find(([encoded]) => encoded === JSON.stringify(key));
      return found ? structuredClone(found[1]) : null;
    }""", [store, key])



def boot_frame(page):
    page.evaluate("""() => {
      const old=document.querySelector('#app'); if(old) old.remove();
      const frame=document.createElement('iframe'); frame.id='app'; frame.name='revision-app';
      frame.style.width='1365px'; frame.style.height='950px'; document.body.appendChild(frame);
    }""")
    frame = page.frame(name="revision-app")
    if frame is None:
        raise AssertionError("QA app frame was not created")
    frame.set_content(HTML, wait_until="load")
    wait_until(
        frame,
        lambda: frame.evaluate("typeof RevisionDirector === 'object'") and frame.locator("#import-backup").is_enabled(),
        timeout=10000,
    )
    check(not frame.locator("#fatal-error").is_visible(), "Fatal startup error")
    return frame


def active_session(page):
    session = state_get(page, "activeRetrieval", "current")
    if not session:
        raise AssertionError("Active retrieval session is missing")
    return session



def seed_baseline_state(page) -> None:
    payload = decode_file(BASELINE_BACKUP)
    specs = {
        "profiles": ("id", {"status": {"keyPath": "status", "unique": False}}),
        "nodes": ("id", {
            "profileId": {"keyPath": "profileId", "unique": False},
            "parentId": {"keyPath": "parentId", "unique": False},
            "pathLookup": {"keyPath": ["profileId", "parentId", "kind", "normalizedName"], "unique": True},
        }),
        "units": ("id", {
            "profileId": {"keyPath": "profileId", "unique": False},
            "topicNodeId": {"keyPath": "topicNodeId", "unique": False},
            "status": {"keyPath": "status", "unique": False},
        }),
        "studyEvents": ("id", {
            "profileId": {"keyPath": "profileId", "unique": False},
            "occurredAt": {"keyPath": "occurredAt", "unique": False},
        }),
        "obligations": ("id", {
            "unitId": {"keyPath": "unitId", "unique": False},
            "dueAt": {"keyPath": "dueAt", "unique": False},
            "status": {"keyPath": "status", "unique": False},
            "type": {"keyPath": "type", "unique": False},
        }),
        "evidenceEvents": ("id", {
            "profileId": {"keyPath": "profileId", "unique": False},
            "unitId": {"keyPath": "unitId", "unique": False},
            "obligationId": {"keyPath": "obligationId", "unique": False},
            "reviewedAt": {"keyPath": "reviewedAt", "unique": False},
        }),
        "chunks": ("id", {
            "obligationId": {"keyPath": "obligationId", "unique": False},
            "cycleId": {"keyPath": "cycleId", "unique": False},
            "status": {"keyPath": "status", "unique": False},
        }),
        "dailyPlans": ("id", {
            "studyDayKey": {"keyPath": "studyDayKey", "unique": True},
            "updatedAt": {"keyPath": "updatedAt", "unique": False},
        }),
        "settings": ("key", {}),
        "metadata": ("key", {}),
        "activeRetrieval": ("id", {}),
    }
    collections = {
        "profiles": payload["profiles"],
        "nodes": payload["nodes"],
        "units": payload["units"],
        "studyEvents": payload["studyEvents"],
        "obligations": payload["obligations"],
        "evidenceEvents": payload["evidenceEvents"],
        "chunks": payload["chunks"],
        "dailyPlans": payload["dailyPlans"],
        "settings": [payload["settings"]],
        "metadata": [{
            "schemaVersion": 1,
            "key": "database",
            "databaseName": "revision-director",
            "databaseVersion": 3,
            "applicationVersion": payload["appVersion"],
            "createdAt": payload["exportedAt"],
            "updatedAt": payload["exportedAt"],
        }],
        "activeRetrieval": [payload["activeRetrieval"]] if payload.get("activeRetrieval") else [],
    }
    stores = {}
    for name, (key_path, indices) in specs.items():
        records = [
            [json.dumps(item[key_path], separators=(",", ":")), item]
            for item in collections[name]
        ]
        stores[name] = {"keyPath": key_path, "indices": indices, "records": records}
    raw_db = {"version": 3, "stores": stores}
    page.evaluate(
        "(raw)=>{ window.__RD_B1_QA_STATE__={local:{},databases:{'revision-director':raw}}; }",
        raw_db,
    )

def main() -> None:
    global checks
    chromium = os.environ.get("CHROMIUM_EXECUTABLE") or chromium_executable()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=chromium if chromium else None, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 1365, "height": 950}, accept_downloads=True)
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("dialog", lambda dialog: dialog.accept())
        page.set_content("<body><script>window.__RD_B1_QA_STATE__={local:{},databases:{}}</script></body>")
        seed_baseline_state(page)
        frame = boot_frame(page)

        frame.locator('[data-pane="today"]').click(); wait(frame, 200)
        frame.locator('[data-action="review-one"][data-id="obligation_ms320pr9_uo4n9u1lsoe33"]').click(); wait(frame, 300)
        check(frame.locator('[data-action="toggle-pause"]').count() == 1, "Pause control is missing")
        initial = frame.locator("#review-timer").inner_text()
        check(initial in ("0:00", "0:01"), f"Unexpected initial timer: {initial}")

        frame.evaluate("__RD_TEST_CLOCK__.advance(10000)"); wait(frame)
        check(frame.locator("#review-timer").inner_text().startswith("0:1"), "Active time did not accumulate")
        frame.locator('[data-action="toggle-pause"]').click(); wait(frame, 180)
        check("PAUSED" in frame.locator("#review-time-state").inner_text().upper(), "Pause state is not visible")
        paused_timer = frame.locator("#review-timer").inner_text()
        frame.evaluate("__RD_TEST_CLOCK__.advance(30000)"); frame.evaluate("window.dispatchEvent(new Event(\'focus\'))"); wait(frame)
        check(frame.locator("#review-timer").inner_text() == paused_timer, "Paused interval was counted")
        frame.locator('[data-action="toggle-pause"]').click(); wait(frame, 450)
        frame.evaluate("__RD_TEST_CLOCK__.advance(5000)"); wait(frame)
        session = active_session(page)
        check(len(session["timeRuntime"]["pauseHistory"]) == 1, "Manual pause history was not persisted")
        check(session["timeRuntime"]["pauseHistory"][0]["durationMs"] == 30000, "Persisted pause duration is wrong")

        # Backward wall-clock movement is rebased rather than subtracted.
        # Use the real lifecycle-return path to reconcile and persist the clock event;
        # pause/resume is a user control, not a persistence flush mechanism.
        before_back = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(-10000); window.dispatchEvent(new Event('focus'))"); wait(frame, 220)
        frame.evaluate("__RD_TEST_CLOCK__.advance(20000); window.dispatchEvent(new Event('focus'))"); wait(frame, 220)
        session = active_session(page)
        check(session["timeRuntime"]["backwardClockCount"] >= 1, "Backward-clock event was not persisted")
        check(session["elapsedMs"] >= before_back, "Backward clock reduced active time")

        # Focus classification counts the gap in the current phase.
        timer_before_focus = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(130001)"); frame.evaluate("window.dispatchEvent(new Event('focus'))"); wait(frame)
        check(frame.locator("#gap-overlay").is_visible(), "120-second inactive gap was not detected")
        wait_until(frame, lambda: active_session(page)["timeRuntime"]["state"] == "gap-pending")
        pending = active_session(page)["timeRuntime"]
        check(pending["pendingGap"]["gapMs"] > 120000, "Pending gap was not durably saved")
        frame.locator('[data-gap-action="focus"]').click(); wait(frame, 220)
        session = active_session(page)
        check(session["elapsedMs"] >= timer_before_focus + 130000, "Focus classification did not add active time")

        # Break classification excludes the gap and records a pause.
        before_break = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(130001)"); frame.evaluate("window.dispatchEvent(new Event('focus'))"); wait(frame)
        frame.locator('[data-gap-action="break"]').click(); wait(frame, 220)
        session = active_session(page)
        check(session["elapsedMs"] == before_break, "Break classification added active time")
        check(any(item["reason"] == "inactive-gap-break" for item in session["timeRuntime"]["pauseHistory"]), "Break classification is absent from pause history")

        # Split classification adds only the verified focus portion.
        before_split = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(180000)"); frame.evaluate("window.dispatchEvent(new Event('focus'))"); wait(frame)
        frame.locator('[data-gap-action="split"]').click(); wait(frame, 80)
        frame.locator("#gap-focus-minutes").fill("1")
        frame.locator('[data-gap-action="apply-split"]').click(); wait(frame, 220)
        session = active_session(page)
        check(session["elapsedMs"] == before_split + 60000, "Split classification did not use the verified focus portion")

        # Ignore excludes the interval and makes the eventual duration sample ineligible.
        before_ignore = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(180000)"); frame.evaluate("window.dispatchEvent(new Event('focus'))"); wait(frame)
        frame.locator('[data-gap-action="ignore"]').click(); wait(frame, 220)
        session = active_session(page)
        check(session["elapsedMs"] == before_ignore, "Ignored gap was counted")
        check(session["timeRuntime"]["gapHistory"][-1]["classification"] == "ignore", "Ignore classification was not persisted")

        # Complete the known question/application workflow.
        frame.locator("#attempt-text").fill("Reasoned answers and uncertain options.")
        if frame.locator("#attempt-completed").count(): frame.locator("#attempt-completed").check()
        frame.locator('[data-action="reveal"]').click(); wait(frame, 220)
        check(frame.locator('[data-review-phase="compare"]').is_visible(), "Source reveal did not enter compare phase")
        frame.locator("#questions-attempted").fill("10")
        frame.locator("#questions-correct").fill("8")
        frame.locator("#questions-partial").fill("1")
        for index in range(frame.locator("[data-checkpoint]").count()):
            item = frame.locator("[data-checkpoint]").nth(index)
            if not item.is_checked(): item.check()
        frame.locator('[data-action="rate"][data-rating="3"]').click(); wait(frame, 600)

        frame.locator('[data-pane="settings"]').click(); wait(frame, 180)
        with TemporaryDirectory() as tmp:
            target = Path(tmp) / "b2.rdbackup"
            with page.expect_download() as download_info:
                frame.locator('[data-action="export-backup"]').click()
            download_info.value.save_as(str(target))
            payload = decode_file(target)
        event = sorted(payload["evidenceEvents"], key=lambda item: item["createdAt"])[-1]
        check(event["timing"]["ignoredGapMs"] >= 180000, "Timing reliability evidence was not retained")
        check(event["timing"]["durationReliable"] is False, "Ignored gap did not mark evidence timing unreliable")
        check("ignored-gap" in event["timing"]["reliabilityFlags"], "Ignored-gap reliability flag is missing")
        check(event["durationObservation"]["accepted"] is False and event["durationObservation"]["reason"] == "unreliable-interruption", "Uncertain time trained the duration estimator")
        check(event["timing"].get("sourceRevealAt"), "Source-reveal boundary is missing from evidence")
        check(event["timing"]["activeByPhase"]["attempt"] > 0 and event["timing"]["activeByPhase"]["compare"] >= 0, "Phase-specific active time is missing")
        check(not errors, f"Browser errors: {errors}")
        context.close(); browser.close()
    print(f"PASS {checks} Pass B2 browser timing checks")


if __name__ == "__main__":
    main()
