from __future__ import annotations
from pathlib import Path
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import ROOT, accept_dialogs, capture_browser_errors, launch_chromium, wait_for_app_ready
from helpers.browser_fixture import HTML
sys.path.insert(0,str(ROOT/'tests'))
FIXTURE = baseline_backup_path()
checks=0

def check(v,m):
    global checks;checks+=1
    if not v:raise AssertionError(m)

def main():
    global checks
    viewports=[(320,568),(390,844),(620,760),(820,1180),(821,900),(1440,1000)]
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        for width,height in viewports:
            page=browser.new_page(viewport={'width':width,'height':height})
            errors=capture_browser_errors(page)
            accept_dialogs(page)
            page.set_content(HTML,wait_until='load');wait_for_app_ready(page)
            page.locator('[data-pane="settings"]').click();page.locator('#pane-settings').wait_for(state='visible')
            page.locator('#import-backup').set_input_files(str(FIXTURE))
            dialog=page.locator('#restore-dialog')
            dialog.wait_for(state='visible',timeout=8000)
            box=dialog.bounding_box();check(box is not None,f'Dialog has no geometry at {width}x{height}')
            check(box['x']>=-1 and box['x']+box['width']<=width+1,f'Dialog overflows horizontally at {width}x{height}')
            check(box['y']>=-1 and box['y']+box['height']<=height+1,f'Dialog overflows vertically at {width}x{height}')
            check(not dialog.evaluate('e=>e.scrollWidth>e.clientWidth+1'),f'Dialog has horizontal scroll at {width}x{height}')
            # Browser-native dialog overflow must keep the full ceremony reachable on short screens.
            check(dialog.evaluate('e=>e.scrollHeight<=e.clientHeight+1 || getComputedStyle(e).overflowY!=="visible"'),f'Dialog cannot scroll vertically at {width}x{height}')
            check(page.evaluate("document.activeElement?.getAttribute('data-action')")=='create-restore-safety',f'Initial dialog focus wrong at {width}x{height}')
            controls=dialog.locator('button:not([disabled]),input:not([disabled])')
            for i in range(controls.count()):
                control=controls.nth(i)
                if not control.is_visible():continue
                typ=control.get_attribute('type') or ''
                rect=control.bounding_box()
                if rect is None:continue
                minimum=20 if typ in ('checkbox','radio') else 44
                check(rect['height']>=minimum-0.5,f'Control below {minimum}px at {width}x{height}: {typ}')
            for _ in range(12):
                page.keyboard.press('Tab')
                check(page.evaluate('e=>e.contains(document.activeElement)',dialog.element_handle()),f'Focus escaped restore dialog at {width}x{height}')
            page.keyboard.press('Escape');dialog.wait_for(state='hidden')
            # File input is reset, so reselecting the same file must reopen the preview.
            page.locator('#import-backup').set_input_files(str(FIXTURE))
            dialog.wait_for(state='visible',timeout=8000)
            page.get_by_role('button',name='CANCEL',exact=True).click();dialog.wait_for(state='hidden')
            check(not errors,f'Browser errors at {width}x{height}: {errors}')
            page.close()
        browser.close()
    print(f'PASS {checks} restore accessibility restore UI responsive/accessibility checks')

if __name__=='__main__':main()
