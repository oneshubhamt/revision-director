from __future__ import annotations
from pathlib import Path
from datetime import date, timedelta
from tempfile import TemporaryDirectory
from backup_fixture_codec import baseline_backup_path, decode_file, encode_payload
from helpers.browser_harness import open_rendered_pane, select_backup_file, wait_for_app_ready, wait_for_layout, wait_for_toast_outcome, wait_until
from helpers.simulated_storage import simulated_state_all, simulated_state_get, simulated_storage_html

ROOT = Path(__file__).resolve().parents[2]
BASE_HTML = (ROOT / "index.html").read_text()
BASELINE_BACKUP = baseline_backup_path()

HTML = simulated_storage_html(base_html=BASE_HTML)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)



def wait_for_text(page, selector: str, expected: str, timeout_seconds: float = 5.0) -> None:
    wait_until(
        page,
        lambda: page.locator(selector).inner_text().strip() == expected,
        timeout=int(timeout_seconds * 1000),
        interval=40,
        message=f"Timed out waiting for {selector}={expected!r}",
    )


def set_range(page, selector: str, value: int) -> None:
    page.locator(selector).evaluate("(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}", value)


def check_all_checkpoints(page) -> None:
    for index in range(page.locator("[data-checkpoint]").count()):
        item = page.locator("[data-checkpoint]").nth(index)
        if not item.is_checked():
            item.check()





def complete_open_restore(
    download_page,
    app_surface,
    *,
    treatment: str = "discard",
) -> dict[str, object]:
    """Complete an already inspected restore; verify the mandatory safety artifact."""
    check(app_surface.locator("#restore-dialog").is_visible(), "Restore preview is not open")
    with TemporaryDirectory() as tmpdir:
        with download_page.expect_download() as info:
            app_surface.locator('[data-action="create-restore-safety"]').click()
        path = Path(tmpdir) / info.value.suggested_filename
        info.value.save_as(str(path))
        suffix = path.suffix
        size = path.stat().st_size
        check(size > 0, "Safety copy was not downloaded")
        check(suffix in (".rdbackup", ".rdrescue"), "Safety copy has an invalid extension")
    if app_surface.locator('input[name="restore-active-treatment"]').count():
        app_surface.locator(
            f'input[name="restore-active-treatment"][value="{treatment}"]'
        ).check()
    app_surface.locator("#restore-safety-saved").check()
    app_surface.locator("#restore-replace-confirm").check()
    final = app_surface.locator("#restore-final-button")
    check(final.is_enabled(), "Final restore is disabled after the required confirmations")
    app_surface.evaluate("document.querySelector('#toast').textContent=''")
    final.click()
    app_surface.locator("#restore-dialog").wait_for(state="hidden", timeout=8_000)
    wait_for_toast_outcome(
        app_surface,
        expect_error=False,
        timeout=8_000,
        message="Restore did not report a successful terminal outcome",
    )
    return {"safetyExtension": suffix, "safetyBytes": size}

def restore_backup_with_safety_copy(
    download_page,
    app_surface,
    fixture_path: str | Path,
    *,
    treatment: str = "discard",
) -> None:
    app_surface.locator("#import-backup").set_input_files([])
    app_surface.locator("#import-backup").set_input_files(str(fixture_path))
    try:
        app_surface.locator("#restore-dialog").wait_for(state="visible", timeout=6_000)
    except Exception as error:
        toast = app_surface.locator("#toast").inner_text() if app_surface.locator("#toast").count() else ""
        fatal = (
            app_surface.locator("#fatal-error").inner_text()
            if app_surface.locator("#fatal-error").count() and app_surface.locator("#fatal-error").is_visible()
            else ""
        )
        raise AssertionError(
            f"Restore preview did not open · toast={toast!r} · fatal={fatal!r}"
        ) from error
    complete_open_restore(download_page, app_surface, treatment=treatment)

def restore_selected_backup(page, backup_path: str | Path, treatment: str = "discard", wait_ms: int = 900, download_page=None) -> None:
    expected_profile_ids = sorted(item["id"] for item in decode_file(Path(backup_path))["profiles"])
    restore_backup_with_safety_copy(download_page or page, page, backup_path, treatment=treatment)
    wait_until(
        page,
        lambda: sorted(profile["id"] for profile in page.evaluate("async()=>await RevisionDirector.records.listProfiles()")) == expected_profile_ids,
        timeout=max(8_000, wait_ms),
        interval=40,
        message="Restore completion did not hydrate the canonical profile set",
    )

def open_page(browser, viewport=None, baseline: bool = False):
    page = browser.new_page(viewport=viewport or {"width": 1440, "height": 1000})
    errors: list[tuple[str, str]] = []
    page.on("console", lambda message: errors.append((message.type, message.text)) if message.type in ("error", "warning") else None)
    page.on("pageerror", lambda error: errors.append(("pageerror", str(error))))
    page.on("dialog", lambda dialog: dialog.accept())
    page.set_content(HTML, wait_until="load")
    wait_for_app_ready(page)
    if baseline:
        page.locator('[data-pane="settings"]').click()
        page.locator("#pane-settings").wait_for(state="visible")
        payload = decode_file(BASELINE_BACKUP)
        test_exam_date = (date.today() + timedelta(days=14)).isoformat()
        for profile in payload["profiles"]:
            profile["examDate"] = test_exam_date
        with TemporaryDirectory() as tmpdir:
            current_fixture = Path(tmpdir) / "browser-baseline-current.rdbackup"
            current_fixture.write_bytes(encode_payload(payload))
            restore_selected_backup(page, current_fixture)
        check(
            sorted(profile["id"] for profile in page.evaluate("async()=>await RevisionDirector.records.listProfiles()"))
            == sorted(profile["id"] for profile in payload["profiles"]),
            "Baseline fixture restore did not hydrate the expected profiles",
        )
    return page, errors


def stored_record(page, store: str, key):
    return simulated_state_get(page, store, key)


def stored_all(page, store: str):
    return simulated_state_all(page, store)

def stored_scheduling_policy(page):
    settings = stored_record(page, "settings", "app")
    return settings.get("fsrsScheduling", {}).get("policy") if settings else None


def active_workflow_kind(page):
    session = stored_record(page, "activeRetrieval", "current")
    if not session or session.get("status") != "active":
        return None
    target = session.get("activeTargetId", "")
    if target.startswith("chunk:"):
        return "chunk"
    obligation = stored_record(page, "obligations", target)
    return obligation.get("workflow", {}).get("kind") if obligation else None


def review_unit(page, title: str) -> None:
    page.locator('[data-pane="library"]').click()
    page.locator("#pane-library").wait_for(state="visible")
    row = page.locator(".unit-row").filter(has_text=title)
    check(row.count() == 1, f"Knowledge Unit not found: {title}")
    row.locator('[data-action="review-unit"]').click()
    page.locator("#review-content").wait_for(state="visible")
    wait_until(
        page,
        lambda: title in page.locator("#review-content").inner_text(),
        timeout=5_000,
        interval=30,
        message=f"Review surface did not render selected unit: {title}",
    )


def rate_good(page) -> None:
    button = page.locator('[data-action="rate"][data-rating="3"]')
    button.click()
    button.wait_for(state="hidden", timeout=5_000)
