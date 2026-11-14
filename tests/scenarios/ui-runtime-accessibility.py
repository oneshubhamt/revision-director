from __future__ import annotations

from playwright.sync_api import sync_playwright
from helpers.browser_harness import launch_chromium
from helpers.browser_fixture import open_page, stored_all

checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def exercise_review_keyboard_shortcuts(browser) -> None:
    page, errors = open_page(browser, {"width": 1280, "height": 900}, baseline=True)
    # Dedicated keyboard commands and input accessibility; general ARIA
    # navigation/focus is owned by ui-behaviour.py.
    page.locator('[data-pane="settings"]').click()
    box = page.locator("#import-backup").bounding_box()
    check(box is not None and box["height"] >= 44, "Backup input touch target is below 44px")
    for index in range(page.locator("button").count()):
        button = page.locator("button").nth(index)
        name = button.get_attribute("aria-label") or button.inner_text().strip() or button.get_attribute("title")
        check(bool(name), f"Unnamed button: {index}")
    page.locator('[data-pane="today"]').click()
    question_obligations = [
        item for item in stored_all(page, "obligations")
        if item["status"] == "active" and item.get("workflow", {}).get("kind") == "questions"
    ]
    question_actions = [
        page.locator(f'[data-action="review-one"][data-id="{item["id"]}"]')
        for item in question_obligations
        if page.locator(f'[data-action="review-one"][data-id="{item["id"]}"]').count()
    ]
    check(bool(question_actions), "Application workflow missing from accessibility fixture")
    question_actions[0].click(); page.locator("#attempt-text").wait_for(state="visible")
    page.locator("#attempt-text").fill("Reasoned answers."); page.locator("#attempt-completed").check()
    page.locator(".review-card").click(position={"x": 5, "y": 5}); page.keyboard.press("Space"); page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    check(page.locator('[data-review-phase="compare"]').is_visible(), "Keyboard reveal failed")
    page.locator("#questions-attempted").fill("10"); page.locator("#questions-correct").fill("8"); page.locator("#questions-partial").fill("1")
    page.locator(".review-card").click(position={"x": 5, "y": 5}); page.keyboard.press("3"); page.locator("#pane-today").wait_for(state="visible")
    check(page.locator("#pane-today").evaluate('e=>e.classList.contains("on")'), "Keyboard rating failed")
    check(not errors, f"Browser errors: {errors}")
    page.close()


def main() -> None:
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        exercise_review_keyboard_shortcuts(browser)
        browser.close()
    print(f"PASS {checks} browser review keyboard shortcuts and accessible controls")


if __name__ == "__main__":
    main()
