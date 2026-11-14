from __future__ import annotations

from playwright.sync_api import Page, sync_playwright
from scenario_timing import timed
from helpers.browser_harness import launch_chromium, wait_for_layout, wait_until
from helpers.browser_fixture import BASELINE_BACKUP, open_page, restore_selected_backup

CHECKS = 0


def check(value: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not value:
        raise AssertionError(message)


def restore_fixture(page: Page) -> None:
    page.locator('[data-pane="settings"]').click()
    page.locator("#pane-settings").wait_for(state="visible")
    restore_selected_backup(page, BASELINE_BACKUP)


def verify_stored_content_escaping(page: Page) -> None:
    page.locator("#quick-add-unit").click()
    page.locator("#unit-dialog").wait_for(state="visible")
    form = page.locator("#unit-form")
    values = {
        "subject": '<img src=x onerror=alert(1)>',
        "section": "<b>Section</b>",
        "topic": "<script>bad()</script>",
        "title": '<svg onload=alert(1)>Visible title',
        "scope": "<iframe srcdoc=x>",
        "source": '<a href=x>source</a>',
        "protocol": "<em>protocol</em>",
        "successCriteria": "<strong>criteria</strong>",
        "workflowPrompt": "<img src=x> prompt",
        "workflowCheckpoints": "<b>A</b>\n<script>B</script>",
        "firstDueAt": "2026-07-25T08:00",
    }
    for name, value in values.items():
        form.locator(f'[name="{name}"]').fill(value)
    form.locator('button[type="submit"]').click()
    page.locator("#unit-dialog").wait_for(state="hidden")

    page.locator('[data-pane="library"]').click()
    page.locator("#pane-library").wait_for(state="visible")
    library = page.locator("#library-content")
    wait_until(
        page,
        lambda: '<svg onload=alert(1)>Visible title' in library.inner_text(),
        timeout=5_000,
        interval=40,
        message="Escaped stored content did not reach the rendered Library",
    )
    check(library.locator("script,iframe,svg,img").count() == 0, "Stored markup became active")
    check(
        '<svg onload=alert(1)>Visible title' in library.inner_text(),
        "Escaped content was not preserved as visible text",
    )


def verify_accessible_names_after_injection(page: Page) -> None:
    # Keep the independent stored-content/XSS surface witness. Keyboard dialog
    # focus and dismissal belong to ui-behaviour.py, not this security journey.
    for index in range(page.locator("button").count()):
        button = page.locator("button").nth(index)
        if not button.is_visible():
            continue
        name = button.get_attribute("aria-label") or button.inner_text().strip() or button.get_attribute("title")
        check(bool(name), f"Visible button {index} lacks an accessible name")


def main() -> None:
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        page, errors = open_page(browser)
        check(not page.locator("#fatal-error").is_visible(), "Fatal startup error")
        restore_fixture(page)
        timed('security.stored-escaping', verify_stored_content_escaping, page)
        timed('security.post-injection-a11y', verify_accessible_names_after_injection, page)

        page.set_viewport_size({"width": 390, "height": 844})
        page.locator('[data-pane="today"]').click()
        page.locator("#pane-today").wait_for(state="visible")
        wait_for_layout(page)
        check(
            page.locator(".sidebar-actions").evaluate("element => getComputedStyle(element).display") == "none",
            "Mobile sidebar actions reappeared after later rendering",
        )
        check(not errors, f"Browser errors: {errors}")
        page.close()
        browser.close()

    print(f"PASS {CHECKS} full-QA supplemental browser checks")


if __name__ == "__main__":
    main()
