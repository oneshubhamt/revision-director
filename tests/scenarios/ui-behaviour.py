from __future__ import annotations
from pathlib import Path
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import ROOT, accept_dialogs, capture_browser_errors, launch_chromium, load_browser_qa, wait_for_app_ready, wait_until
base=load_browser_qa("revision_director_ui_behaviour")
restore_selected_backup=base.restore_selected_backup
CLOCK=r'''<script>(()=>{let current=Date.now();Date.now=()=>current;window.__RD_STAGE_C_CLOCK__={advance(ms){current+=Number(ms)||0;return current;}};})();</script>'''
HTML=(ROOT/'index.html').read_text().replace('<head>','<head>'+base.INDEXEDDB_SHIM+CLOCK,1)
BASELINE = baseline_backup_path()
CHECKS=0

def check(v,msg):
 global CHECKS; CHECKS+=1
 if not v:raise AssertionError(msg)

def main():
 with sync_playwright() as pw:
  browser=launch_chromium(pw)
  page=browser.new_page(viewport={'width':1365,'height':950})
  page.set_default_timeout(7000)
  errors=capture_browser_errors(page, include_warnings=True)
  accept_dialogs(page)
  page.set_content(HTML,wait_until='load'); wait_for_app_ready(page)
  page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
  restore_selected_backup(page, BASELINE)
  check('restored' in page.locator('#toast').inner_text().lower(),'Fixture restore failed')

  # ARIA tab registry and keyboard activation.
  check(page.locator('[role=tablist]').count()==1,'Tablist missing')
  check(page.locator('[role=tab]').count()==6,'Expected six tabs')
  check(page.locator('[role=tabpanel]').count()==6,'Expected six tabpanels')
  today=page.locator('[data-pane=today]');today.focus();today.press('ArrowRight')
  wait_until(page, lambda: page.locator('[data-pane=review]').get_attribute('aria-selected')=='true', timeout=3000, interval=30, message='ArrowRight failed')
  check(page.locator('[data-pane=review]').get_attribute('aria-selected')=='true','ArrowRight failed')
  page.locator('[data-pane=review]').press('End')
  wait_until(page, lambda: page.locator('[data-pane=settings]').get_attribute('aria-selected')=='true', timeout=3000, interval=30, message='End failed')
  check(page.locator('[data-pane=settings]').get_attribute('aria-selected')=='true','End failed')
  page.locator('[data-pane=settings]').press('Home')
  wait_until(page, lambda: today.get_attribute('aria-selected')=='true', timeout=3000, interval=30, message='Home failed')
  check(today.get_attribute('aria-selected')=='true','Home failed')
  check(page.locator('[role=tab][tabindex="0"]').count()==1,'Roving tabindex invalid')

  # Delegation and render stability.
  for _ in range(30):
   for pane in ('today','review','library','study','history','settings'):
    page.evaluate("p=>document.querySelector(`[data-pane=\"${p}\"]`).click()",pane)
  page.locator('#pane-settings').wait_for(state='visible')
  before_profiles=page.evaluate("async()=>await RevisionDirector.records.listProfiles()")
  before_ids={profile['id'] for profile in before_profiles}
  page.locator('#new-profile-name').fill('Stage C single delegated action')
  page.locator('#new-profile-date').fill('2029-01-01')
  page.evaluate("document.querySelector('#toast').textContent=''")
  page.locator('[data-action=add-profile]').click()
  wait_until(
   page,
   lambda: len(page.evaluate("async()=>await RevisionDirector.records.listProfiles()"))==len(before_profiles)+1,
   timeout=5000,
   interval=40,
   message='Delegated add-profile action did not create exactly one record',
  )
  after_profiles=page.evaluate("async()=>await RevisionDirector.records.listProfiles()")
  added=[profile for profile in after_profiles if profile['id'] not in before_ids]
  check(len(added)==1 and added[0]['name']=='Stage C single delegated action','Delegated action duplicated or created the wrong profile')

  # Dirty render preserves focus and selection.
  page.locator('[data-pane=library]').click(); page.locator('#pane-library').wait_for(state='visible')
  search=page.locator('#library-search');search.fill('Drainage');search.evaluate('e=>e.setSelectionRange(2,6)')
  wait_until(page, lambda: page.locator('.unit-row').count()==1 and page.evaluate('document.activeElement?.id')=='library-search', timeout=5000, interval=40, message='Filtered library did not settle')
  check(page.evaluate('document.activeElement?.id')=='library-search','Dirty render lost focus')
  check(search.evaluate('e=>[e.selectionStart,e.selectionEnd]')==[2,6],'Dirty render lost selection')

  # Native dialog focus and return.
  page.locator('#quick-add-unit').focus();page.locator('#quick-add-unit').click(); page.locator('#unit-dialog').wait_for(state='visible')
  check(page.evaluate("document.activeElement?.getAttribute('name')")=='profileId','Dialog initial focus wrong')
  page.keyboard.press('Escape'); page.locator('#unit-dialog').wait_for(state='hidden')
  wait_until(page, lambda: page.evaluate('document.activeElement?.id')=='quick-add-unit', timeout=3000, interval=30, message='Dialog return focus failed')
  check(page.evaluate('document.activeElement?.id')=='quick-add-unit','Dialog return focus failed')

  # Reduced motion.
  page.emulate_media(reduced_motion='reduce')
  motion=page.locator('.btn').first.evaluate("e=>({transition:getComputedStyle(e).transitionDuration,animation:getComputedStyle(e).animationDuration})")
  check(motion['transition'] in ('0s','1e-05s','0.00001s'),'Reduced-motion transition remains active')
  check(motion['animation'] in ('0s','1e-05s','0.00001s'),'Reduced-motion animation remains active')
  page.emulate_media(reduced_motion='no-preference')

  # Enter a review and exercise the inactive-gap overlay repeatedly.
  page.locator('[data-pane=today]').click(); page.locator('#pane-today').wait_for(state='visible')
  page.locator('[data-action=review-one]').first.click(); page.locator('[data-action=toggle-pause]').wait_for(state='visible')
  for cycle in range(12):
   pause=page.locator('[data-action=toggle-pause]');pause.focus()
   page.evaluate('__RD_STAGE_C_CLOCK__.advance(130001)')
   page.evaluate("window.dispatchEvent(new Event('focus'))")
   overlay=page.locator('#gap-overlay'); overlay.wait_for(state='visible', timeout=5000)
   check(overlay.is_visible(),f'Gap overlay missing on cycle {cycle+1}')
   check(page.locator('.app-shell').evaluate('e=>e.inert'),f'Background not inert on cycle {cycle+1}')
   check(page.evaluate("document.activeElement?.getAttribute('data-gap-action')")=='focus',f'Initial overlay focus wrong on cycle {cycle+1}')
   if cycle==0:
    page.keyboard.press('Shift+Tab')
    check(page.evaluate("document.activeElement?.getAttribute('data-gap-action')")=='ignore','Shift+Tab did not wrap')
    page.keyboard.press('Tab')
    check(page.evaluate("document.activeElement?.getAttribute('data-gap-action')")=='focus','Tab did not wrap')
   page.locator('[data-gap-action=break]').click(); overlay.wait_for(state='hidden', timeout=5000)
   check(not overlay.is_visible(),f'Gap overlay did not close on cycle {cycle+1}')
   wait_until(
    page,
    lambda: not page.locator('.app-shell').evaluate('e=>e.inert')
    and page.evaluate("document.activeElement?.getAttribute('data-action')")=='toggle-pause',
    timeout=3000,
   )
   check(not page.locator('.app-shell').evaluate('e=>e.inert'),f'Background remained inert on cycle {cycle+1}')
   check(page.evaluate("document.activeElement?.getAttribute('data-action')")=='toggle-pause',f'Return focus failed on cycle {cycle+1}')

  check(not errors,f'Browser errors: {errors}')
  page.close();browser.close()
 print(f'PASS {CHECKS} Stage C behavioural and repeated-focus checks')

if __name__=='__main__':main()
