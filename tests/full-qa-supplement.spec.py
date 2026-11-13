from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright
from helpers.browser_harness import load_browser_qa, launch_chromium

ROOT = Path(__file__).resolve().parents[1]
MAIN_QA = load_browser_qa("revision_director_browser_qa_supplement")

CHECKS = 0


def check(value: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not value:
        raise AssertionError(message)


def open_page(browser: Browser) -> tuple[Page, list[str]]:
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.set_default_timeout(8_000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on(
        "console",
        lambda message: errors.append(f"{message.type}: {message.text}")
        if message.type in ("error", "warning")
        else None,
    )
    page.on("dialog", lambda dialog: dialog.accept())
    page.set_content(MAIN_QA.HTML, wait_until="load")
    page.wait_for_timeout(1_300)
    check(not page.locator("#fatal-error").is_visible(), "Fatal startup error")
    return page, errors


def restore_fixture(page: Page) -> None:
    page.locator('[data-pane="settings"]').click()
    page.wait_for_timeout(80)
    MAIN_QA.restore_selected_backup(page, MAIN_QA.BASELINE_BACKUP)
    check("restored" in page.locator("#toast").inner_text().lower(), "Fixture import failed")


def verify_responsive_surfaces(page: Page) -> None:
    viewports = [
        (320, 568),
        (360, 640),
        (390, 844),
        (460, 800),
        (560, 800),
        (700, 900),
        (820, 900),
        (1024, 900),
        (1440, 1000),
        (1920, 1080),
    ]
    panes = ("today", "review", "library", "study", "history", "settings")

    for width, height in viewports:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(70)
        expected_sidebar_actions = "none" if width <= 820 else "grid"
        actual_sidebar_actions = page.locator(".sidebar-actions").evaluate(
            "element => getComputedStyle(element).display"
        )
        check(
            actual_sidebar_actions == expected_sidebar_actions,
            f"Sidebar action visibility is wrong at {width}px",
        )

        for pane in panes:
            page.evaluate(
                "pane => document.querySelector(`[data-pane=\"${pane}\"]`).click()",
                pane,
            )
            page.wait_for_timeout(35)
            check(
                page.evaluate(
                    "document.documentElement.scrollWidth <= "
                    "document.documentElement.clientWidth + 1"
                ),
                f"Horizontal overflow in {pane} at {width}x{height}",
            )
            check(page.locator(f"#pane-{pane}").is_visible(), f"Pane is hidden: {pane}")


def verify_long_render_stability(page: Page) -> None:
    page.set_viewport_size({"width": 1280, "height": 900})
    page.evaluate(
        """() => {
          const panes = ['today', 'review', 'library', 'study', 'history', 'settings'];
          for (let cycle = 0; cycle < 30; cycle += 1) {
            for (const pane of panes) {
              document.querySelector(`[data-pane="${pane}"]`).click();
            }
          }
        }"""
    )
    page.wait_for_timeout(1_000)

    before = page.locator("[data-profile-editor]").count()
    page.locator("#new-profile-name").fill("Single action")
    page.locator("#new-profile-date").fill("2029-01-01")
    page.locator('[data-action="add-profile"]').click()
    page.wait_for_timeout(350)
    check(
        page.locator("[data-profile-editor]").count() == before + 1,
        "Repeated renders caused a duplicate action",
    )


def verify_stored_content_escaping(page: Page) -> None:
    page.locator("#quick-add-unit").click()
    page.wait_for_timeout(80)
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
    page.wait_for_timeout(450)

    page.locator('[data-pane="library"]').click()
    page.wait_for_timeout(100)
    library = page.locator("#library-content")
    check(library.locator("script,iframe,svg,img").count() == 0, "Stored markup became active")
    check(
        '<svg onload=alert(1)>Visible title' in library.inner_text(),
        "Escaped content was not preserved as visible text",
    )


def verify_keyboard_and_names(page: Page) -> None:
    page.locator("#quick-add-unit").click()
    page.wait_for_timeout(80)
    page.keyboard.press("Escape")
    page.wait_for_timeout(60)
    check(not page.locator("#unit-dialog").evaluate("element => element.open"), "Escape did not close dialog")

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
        check(page.title() == "Revision Director · VA7.1 Pass E1", "Release title mismatch")
        restore_fixture(page)
        verify_responsive_surfaces(page)
        verify_long_render_stability(page)
        verify_stored_content_escaping(page)
        verify_keyboard_and_names(page)

        page.set_viewport_size({"width": 390, "height": 844})
        page.locator('[data-pane="today"]').click()
        page.wait_for_timeout(100)
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
