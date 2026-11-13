from __future__ import annotations
from pathlib import Path
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import ROOT, launch_chromium, load_browser_qa, open_html_page
base = load_browser_qa("revision_director_ui_runtime_accessibility")
INDEXEDDB_SHIM = base.INDEXEDDB_SHIM
BASELINE_BACKUP = baseline_backup_path()
restore_selected_backup = base.restore_selected_backup
CLOCK_SHIM = r"""
<script>
(() => {
  let current = Date.now();
  Date.now = () => current;
  window.__RD_TEST_CLOCK__ = { advance(ms){ current += Number(ms)||0; return current; } };
})();
</script>
"""
HTML = (ROOT / "index.html").read_text().replace("<head>", "<head>" + INDEXEDDB_SHIM + CLOCK_SHIM, 1)
checks = 0

def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)

def wait(page, ms=220): page.wait_for_timeout(ms)

def launch_page(browser, viewport={"width": 1440, "height": 1000}):
    page, errors = open_html_page(browser, HTML, viewport=viewport, settle_ms=1200)
    check(not page.locator("#fatal-error").is_visible(), "Fatal startup error")
    return page, errors

def restore_baseline(page):
    page.locator('[data-pane="settings"]').click(); wait(page)
    restore_selected_backup(page, BASELINE_BACKUP)
    check("restored" in page.locator("#toast").inner_text().lower(), "Baseline restore failed")

def main():
    global checks
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        page, errors = launch_page(browser)
        page.set_default_timeout(5000)
        restore_baseline(page)

        # ARIA registry and keyboard navigation.
        tabs = page.locator('[role="tab"]')
        check(tabs.count() == 6, "Expected six ARIA tabs")
        check(page.locator('[role="tablist"]').count() == 1, "ARIA tablist missing")
        check(page.locator('[role="tabpanel"]').count() == 6, "Expected six tabpanels")
        today = page.locator('[data-pane="today"]')
        today.focus(); today.press("ArrowRight"); wait(page)
        check(page.locator('[data-pane="review"]').get_attribute("aria-selected") == "true", "ArrowRight did not activate Review")
        check(page.locator("#pane-review").is_visible(), "Review panel was not shown")
        page.locator('[data-pane="review"]').press("End"); wait(page)
        check(page.locator('[data-pane="settings"]').get_attribute("aria-selected") == "true", "End did not activate Settings")
        page.locator('[data-pane="settings"]').press("Home"); wait(page)
        check(today.get_attribute("aria-selected") == "true" and today.get_attribute("tabindex") == "0", "Home did not restore Today and roving tabindex")
        check(page.locator('[role="tab"][tabindex="0"]').count() == 1, "Roving tabindex has multiple active tabs")

        # Delegated event handling must not duplicate after repeated renders.
        for _ in range(12):
            page.locator('[data-pane="library"]').click(); page.locator('[data-pane="settings"]').click()
        wait(page, 600)
        before = page.locator("[data-profile-editor]").count()
        page.locator("#new-profile-name").fill("Delegation QA")
        page.locator("#new-profile-date").fill("2029-01-01")
        page.locator('[data-action="add-profile"]').click(); wait(page, 500)
        check(page.locator("[data-profile-editor]").count() == before + 1, "Delegated click fired more or less than once")

        # Dialog focus capture and restoration.
        page.locator("#quick-add-unit").focus(); page.locator("#quick-add-unit").click(); wait(page)
        check(page.locator("#unit-dialog").get_attribute("open") is not None, "Unit dialog did not open")
        check(page.evaluate("document.activeElement?.getAttribute('name')") == "profileId", "Dialog initial focus is incorrect")
        page.keyboard.press("Escape"); wait(page, 350)
        check(page.evaluate("document.activeElement?.id") == "quick-add-unit", "Dialog focus was not restored")

        # Dirty-state invalidation must preserve focused search and selection.
        page.locator('[data-pane="library"]').click(); wait(page)
        search = page.locator("#library-search")
        search.fill("Drainage")
        search.evaluate("e=>e.setSelectionRange(2,6)")
        wait(page, 320)
        check(page.evaluate("document.activeElement?.id") == "library-search", "Render invalidation lost search focus")
        selection = search.evaluate("e=>[e.selectionStart,e.selectionEnd]")
        check(selection == [2,6], f"Render invalidation lost text selection: {selection}")
        check(page.locator(".unit-row").count() >= 1, "Debounced library projection did not render")

        # 44-pixel visible interaction targets, including file input.
        target_failures = page.evaluate("""() => [...document.querySelectorAll('button,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,summary,.file-btn')]
          .filter(e => { const s=getComputedStyle(e); return !e.closest('[hidden]') && s.display!=='none' && s.visibility!=='hidden' && e.getBoundingClientRect().width>0; })
          .filter(e => e.getBoundingClientRect().height < 43.5)
          .map(e => `${e.tagName}#${e.id}.${e.className}:${e.getBoundingClientRect().height}`)""")
        check(not target_failures, f"Sub-44px targets: {target_failures[:5]}")
        page.locator('[data-pane="settings"]').click(); wait(page)
        check(page.locator("#import-backup").bounding_box()["height"] >= 44, "Backup file input is below 44px")

        # Reduced motion contract.
        page.emulate_media(reduced_motion="reduce")
        duration = page.locator(".btn").first.evaluate("e=>getComputedStyle(e).transitionDuration")
        check(duration in ("1e-05s", "0.00001s", "0s"), f"Reduced-motion transition remains active: {duration}")

        # Compact layout reserves content above fixed navigation and avoids overflow.
        for width, height in ((820,700),(700,700),(390,844),(320,568)):
            page.set_viewport_size({"width":width,"height":height}); wait(page, 180)
            geometry = page.evaluate("""() => { const m=document.querySelector('.main').getBoundingClientRect(); const n=document.querySelector('.sidebar').getBoundingClientRect(); return {mainBottom:m.bottom,navTop:n.top,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}; }""")
            check(geometry["mainBottom"] <= geometry["navTop"] + 1, f"Main overlaps compact nav at {width}x{height}: {geometry}")
            check(not geometry["overflow"], f"Horizontal overflow at {width}x{height}")

        # Overlay focus containment and semantic return target.
        page.set_viewport_size({"width":1365,"height":950}); page.emulate_media(reduced_motion="no-preference")
        page.locator('[data-pane="today"]').click(); wait(page)
        page.locator('[data-action="review-one"]').first.click(); wait(page, 350)
        pause = page.locator('[data-action="toggle-pause"]'); pause.focus()
        page.evaluate("__RD_TEST_CLOCK__.advance(130001)")
        page.evaluate("window.dispatchEvent(new Event('focus'))"); wait(page, 1300)
        overlay = page.locator("#gap-overlay")
        check(overlay.is_visible(), "Inactive-gap overlay did not open")
        check(page.locator(".app-shell").evaluate("e=>e.inert"), "Application background was not inert")
        active = page.evaluate("({tag:document.activeElement?.tagName,id:document.activeElement?.id,action:document.activeElement?.getAttribute('data-gap-action'),html:document.activeElement?.outerHTML?.slice(0,160)})")
        check(active.get("action") == "focus", f"Overlay initial focus is incorrect: {active}")
        page.keyboard.press("Shift+Tab")
        check(page.evaluate("document.activeElement?.getAttribute('data-gap-action')") == "ignore", "Shift+Tab did not wrap to final overlay control")
        page.keyboard.press("Tab")
        check(page.evaluate("document.activeElement?.getAttribute('data-gap-action')") == "focus", "Tab did not wrap to first overlay control")
        page.locator('[data-gap-action="break"]').click(); wait(page, 450)
        check(not overlay.is_visible(), "Overlay did not close after classification")
        check(not page.locator(".app-shell").evaluate("e=>e.inert"), "Application remained inert")
        check(page.evaluate("document.activeElement?.getAttribute('data-action')") == "toggle-pause", "Overlay focus did not return to pause control")

        check(not errors, f"Browser errors: {errors}")
        page.close(); browser.close()
    print(f"PASS {checks} Pass C2 browser accessibility and UI-runtime checks")

if __name__ == "__main__": main()
