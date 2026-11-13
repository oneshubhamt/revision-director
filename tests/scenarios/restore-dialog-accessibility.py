from __future__ import annotations
from pathlib import Path
import os, runpy, shutil, sys
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from helpers.browser_harness import ROOT, chromium_executable
sys.path.insert(0,str(ROOT/'tests'))
base=runpy.run_path(str(ROOT/'tests/browser-qa.spec.py'),run_name='rd_stage_d_restore_ui_base')
HTML=(ROOT/'index.html').read_text().replace('<head>','<head>'+base['INDEXEDDB_SHIM'],1)
FIXTURE=ROOT/'tests/fixtures/browser-baseline.rdbackup'
checks=0

def check(v,m):
    global checks;checks+=1
    if not v:raise AssertionError(m)

def main():
    global checks
    exe=chromium_executable()
    viewports=[(320,568),(390,844),(620,760),(820,1180),(821,900),(1440,1000)]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=exe if exe else None,args=['--no-sandbox','--disable-dev-shm-usage'])
        for width,height in viewports:
            page=browser.new_page(viewport={'width':width,'height':height})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
            page.on('dialog',lambda d:d.accept())
            page.set_content(HTML,wait_until='load');page.wait_for_timeout(1200)
            page.locator('[data-pane="settings"]').click();page.wait_for_timeout(180)
            page.locator('#import-backup').set_input_files(str(FIXTURE))
            dialog=page.locator('#restore-dialog')
            dialog.wait_for(state='visible',timeout=8000)
            check(dialog.is_visible(),f'Restore dialog missing at {width}x{height}')
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
            page.keyboard.press('Escape');page.wait_for_timeout(180)
            check(not dialog.is_visible(),f'Escape did not cancel restore at {width}x{height}')
            # File input is reset, so reselecting the same file must reopen the preview.
            page.locator('#import-backup').set_input_files(str(FIXTURE))
            dialog.wait_for(state='visible',timeout=8000)
            check(dialog.is_visible(),f'Same-file reselection failed at {width}x{height}')
            page.get_by_role('button',name='CANCEL',exact=True).click();page.wait_for_timeout(120)
            check(not errors,f'Browser errors at {width}x{height}: {errors}')
            page.close()
        browser.close()
    print(f'PASS {checks} Stage D restore UI responsive/accessibility checks')

if __name__=='__main__':main()
