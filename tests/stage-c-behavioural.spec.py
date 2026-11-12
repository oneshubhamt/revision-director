from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import os, runpy, shutil
from backup_fixture_codec import canonical_fixture_copy
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
base=runpy.run_path(str(ROOT/'tests/browser-qa.spec.py'),run_name='rd_stage_c_behavior_base')
restore_selected_backup=base['restore_selected_backup']
CLOCK=r'''<script>(()=>{let current=Date.now();Date.now=()=>current;window.__RD_STAGE_C_CLOCK__={advance(ms){current+=Number(ms)||0;return current;}};})();</script>'''
HTML=(ROOT/'index.html').read_text().replace('<head>','<head>'+base['INDEXEDDB_SHIM']+CLOCK,1)
BASELINE=ROOT/'tests/fixtures/browser-baseline.rdbackup'
CHECKS=0

def check(v,msg):
 global CHECKS; CHECKS+=1
 if not v:raise AssertionError(msg)

def wait(page,ms=250):page.wait_for_timeout(ms)

def main():
 executable=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or '/usr/bin/chromium'
 with sync_playwright() as pw, TemporaryDirectory() as td:
  fixture=canonical_fixture_copy(BASELINE,Path(td)/'browser-baseline-current.rdbackup')
  browser=pw.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1365,'height':950})
  page.set_default_timeout(7000)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:errors.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
  page.on('dialog',lambda d:d.accept())
  page.set_content(HTML,wait_until='load');wait(page,1300)
  page.locator('[data-pane="settings"]').click();wait(page)
  restore_selected_backup(page, fixture)
  check('restored' in page.locator('#toast').inner_text().lower(),'Fixture restore failed')

  # ARIA tab registry and keyboard activation.
  check(page.locator('[role=tablist]').count()==1,'Tablist missing')
  check(page.locator('[role=tab]').count()==6,'Expected six tabs')
  check(page.locator('[role=tabpanel]').count()==6,'Expected six tabpanels')
  today=page.locator('[data-pane=today]');today.focus();today.press('ArrowRight');wait(page)
  check(page.locator('[data-pane=review]').get_attribute('aria-selected')=='true','ArrowRight failed')
  page.locator('[data-pane=review]').press('End');wait(page)
  check(page.locator('[data-pane=settings]').get_attribute('aria-selected')=='true','End failed')
  page.locator('[data-pane=settings]').press('Home');wait(page)
  check(today.get_attribute('aria-selected')=='true','Home failed')
  check(page.locator('[role=tab][tabindex="0"]').count()==1,'Roving tabindex invalid')

  # Delegation and render stability.
  for _ in range(30):
   for pane in ('today','review','library','study','history','settings'):
    page.evaluate("p=>document.querySelector(`[data-pane=\"${p}\"]`).click()",pane)
  wait(page,900)
  before=page.locator('[data-profile-editor]').count()
  page.locator('#new-profile-name').fill('Stage C single delegated action')
  page.locator('#new-profile-date').fill('2029-01-01')
  page.locator('[data-action=add-profile]').click();wait(page,500)
  check(page.locator('[data-profile-editor]').count()==before+1,'Delegated action duplicated or failed')

  # Dirty render preserves focus and selection.
  page.locator('[data-pane=library]').click();wait(page)
  search=page.locator('#library-search');search.fill('Drainage');search.evaluate('e=>e.setSelectionRange(2,6)');wait(page,400)
  check(page.evaluate('document.activeElement?.id')=='library-search','Dirty render lost focus')
  check(search.evaluate('e=>[e.selectionStart,e.selectionEnd]')==[2,6],'Dirty render lost selection')

  # Native dialog focus and return.
  page.locator('#quick-add-unit').focus();page.locator('#quick-add-unit').click();wait(page)
  check(page.evaluate("document.activeElement?.getAttribute('name')")=='profileId','Dialog initial focus wrong')
  page.keyboard.press('Escape');wait(page,400)
  check(page.evaluate('document.activeElement?.id')=='quick-add-unit','Dialog return focus failed')

  # Reduced motion.
  page.emulate_media(reduced_motion='reduce')
  motion=page.locator('.btn').first.evaluate("e=>({transition:getComputedStyle(e).transitionDuration,animation:getComputedStyle(e).animationDuration})")
  check(motion['transition'] in ('0s','1e-05s','0.00001s'),'Reduced-motion transition remains active')
  check(motion['animation'] in ('0s','1e-05s','0.00001s'),'Reduced-motion animation remains active')
  page.emulate_media(reduced_motion='no-preference')

  # Enter a review and exercise the inactive-gap overlay repeatedly.
  page.locator('[data-pane=today]').click();wait(page)
  page.locator('[data-action=review-one]').first.click();wait(page,400)
  for cycle in range(12):
   pause=page.locator('[data-action=toggle-pause]');pause.focus()
   page.evaluate('__RD_STAGE_C_CLOCK__.advance(130001)')
   page.evaluate("window.dispatchEvent(new Event('focus'))");wait(page,1350)
   overlay=page.locator('#gap-overlay')
   check(overlay.is_visible(),f'Gap overlay missing on cycle {cycle+1}')
   check(page.locator('.app-shell').evaluate('e=>e.inert'),f'Background not inert on cycle {cycle+1}')
   check(page.evaluate("document.activeElement?.getAttribute('data-gap-action')")=='focus',f'Initial overlay focus wrong on cycle {cycle+1}')
   if cycle==0:
    page.keyboard.press('Shift+Tab')
    check(page.evaluate("document.activeElement?.getAttribute('data-gap-action')")=='ignore','Shift+Tab did not wrap')
    page.keyboard.press('Tab')
    check(page.evaluate("document.activeElement?.getAttribute('data-gap-action')")=='focus','Tab did not wrap')
   page.locator('[data-gap-action=break]').click();wait(page,500)
   check(not overlay.is_visible(),f'Gap overlay did not close on cycle {cycle+1}')
   check(not page.locator('.app-shell').evaluate('e=>e.inert'),f'Background remained inert on cycle {cycle+1}')
   check(page.evaluate("document.activeElement?.getAttribute('data-action')")=='toggle-pause',f'Return focus failed on cycle {cycle+1}')

  check(not errors,f'Browser errors: {errors}')
  page.close();browser.close()
 print(f'PASS {CHECKS} Stage C behavioural and repeated-focus checks')

if __name__=='__main__':main()
