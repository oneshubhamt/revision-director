from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json
from backup_fixture_codec import baseline_backup_path, decode_file
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
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
)
BASELINE_BACKUP = baseline_backup_path()
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
# phase-time runtime advances Date.now() by minutes in milliseconds to exercise phase timing.
# Keep cross-tab ownership out of this synthetic clock domain; active retrieval persistence separately
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


def displayed_timer_seconds(frame) -> int:
    minutes, seconds = frame.locator("#review-timer").inner_text().strip().split(":", 1)
    return int(minutes) * 60 + int(seconds)


def wait_until(frame, predicate, timeout=6000):
    shared_wait_until(
        frame,
        predicate,
        timeout=timeout,
        interval=80,
        message="Timed out waiting for persisted browser state",
    )


def boot_frame(page):
    frame = create_persistent_frame(
        page,
        HTML,
        name="revision-app",
        element_id="app",
        width=1365,
        height=950,
    )
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
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        context = browser.new_context(viewport={"width": 1365, "height": 950}, accept_downloads=True)
        page = context.new_page()
        errors = capture_browser_errors(page)
        accept_dialogs(page)
        page.set_content("<body><script>window.__RD_B1_QA_STATE__={local:{},databases:{}}</script></body>")
        seed_baseline_state(page)
        frame = boot_frame(page)

        frame.locator('[data-pane="today"]').click()
        frame.locator("#pane-today").wait_for(state="visible")
        frame.locator('[data-action="review-one"][data-id="obligation_ms320pr9_uo4n9u1lsoe33"]').click()
        frame.locator('[data-action="toggle-pause"]').wait_for(state="visible")
        check(frame.locator('[data-action="toggle-pause"]').count() == 1, "Pause control is missing")
        initial = displayed_timer_seconds(frame)
        check(0 <= initial <= 1, f"Unexpected initial timer value: {initial}s")

        frame.evaluate("__RD_TEST_CLOCK__.advance(10000)")
        wait_until(frame, lambda: displayed_timer_seconds(frame) >= 10)
        check(displayed_timer_seconds(frame) >= 10, "Active time did not accumulate")

        frame.locator('[data-action="toggle-pause"]').click()
        wait_until(frame, lambda: frame.locator("#review-time-state").evaluate("e=>e.classList.contains('paused')"))
        check(frame.locator("#review-time-state").evaluate("e=>e.classList.contains('paused')"), "Pause state is not visible")
        paused_timer = displayed_timer_seconds(frame)

        frame.evaluate("__RD_TEST_CLOCK__.advance(30000); window.dispatchEvent(new Event('focus'))")
        wait_until(frame, lambda: active_session(page)["timeRuntime"]["state"] == "paused")
        check(displayed_timer_seconds(frame) == paused_timer, "Paused interval was counted")

        frame.locator('[data-action="toggle-pause"]').click()
        wait_until(frame, lambda: not frame.locator("#review-time-state").evaluate("e=>e.classList.contains('paused')"))
        frame.evaluate("__RD_TEST_CLOCK__.advance(5000); window.dispatchEvent(new Event('focus'))")
        wait_until(frame, lambda: len(active_session(page)["timeRuntime"]["pauseHistory"]) == 1)
        session = active_session(page)
        check(session["timeRuntime"]["pauseHistory"][0]["durationMs"] == 30000, "Persisted pause duration is wrong")

        # Backward wall-clock movement is rebased rather than subtracted.
        # Use the lifecycle-return path to reconcile and persist clock events.
        before_back = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(-10000); window.dispatchEvent(new Event('focus'))")
        wait_until(frame, lambda: active_session(page)["timeRuntime"]["backwardClockCount"] >= 1)
        frame.evaluate("__RD_TEST_CLOCK__.advance(20000); window.dispatchEvent(new Event('focus'))")
        wait_until(frame, lambda: active_session(page)["elapsedMs"] >= before_back)
        session = active_session(page)
        check(session["timeRuntime"]["backwardClockCount"] >= 1, "Backward-clock event was not persisted")
        check(session["elapsedMs"] >= before_back, "Backward clock reduced active time")

        # Focus classification counts the gap in the current phase.
        timer_before_focus = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(130001); window.dispatchEvent(new Event('focus'))")
        frame.locator("#gap-overlay").wait_for(state="visible")
        wait_until(frame, lambda: active_session(page)["timeRuntime"]["state"] == "gap-pending")
        check(frame.locator("#gap-overlay").is_visible(), "120-second inactive gap was not detected")
        pending = active_session(page)["timeRuntime"]
        check(pending["pendingGap"]["gapMs"] > 120000, "Pending gap was not durably saved")
        frame.locator('[data-gap-action="focus"]').click()
        frame.locator("#gap-overlay").wait_for(state="hidden")
        wait_until(frame, lambda: active_session(page)["elapsedMs"] >= timer_before_focus + 130000)
        session = active_session(page)
        check(session["elapsedMs"] >= timer_before_focus + 130000, "Focus classification did not add active time")

        # Break classification excludes the gap and records a pause.
        before_break = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(130001); window.dispatchEvent(new Event('focus'))")
        frame.locator("#gap-overlay").wait_for(state="visible")
        frame.locator('[data-gap-action="break"]').click()
        frame.locator("#gap-overlay").wait_for(state="hidden")
        wait_until(frame, lambda: any(item["reason"] == "inactive-gap-break" for item in active_session(page)["timeRuntime"]["pauseHistory"]))
        session = active_session(page)
        check(session["elapsedMs"] == before_break, "Break classification added active time")
        check(any(item["reason"] == "inactive-gap-break" for item in session["timeRuntime"]["pauseHistory"]), "Break classification is absent from pause history")

        # Split classification adds only the verified focus portion.
        before_split = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(180000); window.dispatchEvent(new Event('focus'))")
        frame.locator("#gap-overlay").wait_for(state="visible")
        frame.locator('[data-gap-action="split"]').click()
        frame.locator("#gap-focus-minutes").wait_for(state="visible")
        frame.locator("#gap-focus-minutes").fill("1")
        frame.locator('[data-gap-action="apply-split"]').click()
        frame.locator("#gap-overlay").wait_for(state="hidden")
        wait_until(frame, lambda: active_session(page)["elapsedMs"] == before_split + 60000)
        session = active_session(page)
        check(session["elapsedMs"] == before_split + 60000, "Split classification did not use the verified focus portion")

        # Ignore excludes the interval and makes the eventual duration sample ineligible.
        before_ignore = session["elapsedMs"]
        frame.evaluate("__RD_TEST_CLOCK__.advance(180000); window.dispatchEvent(new Event('focus'))")
        frame.locator("#gap-overlay").wait_for(state="visible")
        frame.locator('[data-gap-action="ignore"]').click()
        frame.locator("#gap-overlay").wait_for(state="hidden")
        wait_until(frame, lambda: active_session(page)["timeRuntime"]["gapHistory"][-1]["classification"] == "ignore")
        session = active_session(page)
        check(session["elapsedMs"] == before_ignore, "Ignored gap was counted")
        check(session["timeRuntime"]["gapHistory"][-1]["classification"] == "ignore", "Ignore classification was not persisted")

        # Complete the known question/application workflow.
        frame.locator("#attempt-text").fill("Reasoned answers and uncertain options.")
        if frame.locator("#attempt-completed").count():
            frame.locator("#attempt-completed").check()
        frame.locator('[data-action="reveal"]').click()
        frame.locator('[data-review-phase="compare"]').wait_for(state="visible")
        check(frame.locator('[data-review-phase="compare"]').is_visible(), "Source reveal did not enter compare phase")
        frame.locator("#questions-attempted").fill("10")
        frame.locator("#questions-correct").fill("8")
        frame.locator("#questions-partial").fill("1")
        for index in range(frame.locator("[data-checkpoint]").count()):
            item = frame.locator("[data-checkpoint]").nth(index)
            if not item.is_checked():
                item.check()
        before_evidence = len(state_all(page, "evidenceEvents"))
        frame.locator('[data-action="rate"][data-rating="3"]').click()
        wait_until(frame, lambda: len(state_all(page, "evidenceEvents")) == before_evidence + 1)

        frame.locator('[data-pane="settings"]').click()
        frame.locator("#pane-settings").wait_for(state="visible")
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
    print(f"PASS {checks} phase-time runtime browser timing checks")


if __name__ == "__main__":
    main()
