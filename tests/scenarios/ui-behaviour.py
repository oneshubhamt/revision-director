from __future__ import annotations
from pathlib import Path
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import ROOT, accept_dialogs, capture_browser_errors, launch_chromium, open_rendered_pane, wait_for_app_ready, wait_for_layout, wait_until
from helpers.browser_fixture import open_page as open_fixture_page, restore_selected_backup
from helpers.simulated_storage import simulated_storage_html
CLOCK=r'''<script>(()=>{let current=Date.now();Date.now=()=>current;window.__RD_UI_BEHAVIOUR_CLOCK__={advance(ms){current+=Number(ms)||0;return current;}};})();</script>'''
HTML=simulated_storage_html(CLOCK)
BASELINE = baseline_backup_path()
CHECKS=0

def check(v,msg):
 global CHECKS; CHECKS+=1
 if not v:raise AssertionError(msg)

def exercise_shell_crud(browser) -> None:
    page, errors = open_fixture_page(browser)
    check(page.locator("#sb-units").inner_text() == "0", "Clean production database should start empty")
    check(page.evaluate("async()=> (await RevisionDirector.records.listProfiles()).length") == 0, "Clean production database exposed preloaded profiles")
    for pane in ("review", "library", "study", "history", "settings", "today"):
        page.locator(f'[data-pane="{pane}"]') .click()
        page.locator(f"#pane-{pane}").wait_for(state="visible")
        check(page.locator(f"#pane-{pane}").evaluate('e=>e.classList.contains("on")'), f"Pane did not open: {pane}")

    page.locator('[data-pane="settings"]').click()
    page.locator("#settings-content").wait_for(state="visible")
    storage = page.evaluate("RevisionDirector.runtime.storageHealth()")
    check(storage["indexedDbAvailable"], "Storage-health contract did not report IndexedDB availability")
    check(page.locator('[data-action="refresh-storage"]').count() == 1, "Storage-health refresh control is missing")
    check(page.locator('#settings-form [name="memorySchedulingPolicy"]').input_value() == "fixed-retention", "Clean installations must default to measured fixed-retention scheduling")
    page.locator("#new-profile-name").fill("IFoS Production Test")
    page.locator("#new-profile-date").fill("2027-11-01")
    page.locator('[data-action="add-profile"]').click()
    page.wait_for_function("() => document.querySelectorAll('[data-profile-editor]').length === 1")
    check(page.locator("[data-profile-editor]").count() == 1, "First production exam profile was not created")

    page.locator("#quick-add-unit").click()
    page.locator("#unit-dialog").wait_for(state="visible")
    form = page.locator("#unit-form")
    values = {
        "subject": "Public Administration", "section": "Administrative Thinkers", "topic": "Max Weber",
        "title": "Weberian bureaucracy core features", "scope": "Authority, hierarchy, rules, merit and impersonality.",
        "source": "Optional notes pages 10-15", "protocol": "Recall six features and two criticisms without notes.",
        "successCriteria": "Six features\nTwo criticisms", "workflowPrompt": "State the features and criticisms from memory.",
        "workflowCheckpoints": "Authority\nHierarchy\nRules\nMerit\nImpersonality\nCriticisms",
        "firstDueAt": "2026-07-25T08:00",
    }
    for name, value in values.items():
        form.locator(f'[name="{name}"]') .fill(value)
    form.locator('button[type="submit"]').click()
    wait_until(page, lambda: page.locator("#sb-units").inner_text().strip() == "1",
               timeout=5000, interval=40, message="Unit creation did not reach the sidebar")
    check(page.locator("#sb-units").inner_text() == "1", "Knowledge Unit creation failed")

    page.locator("#quick-log-study").click()
    study = page.locator("#study-form")
    study.locator('[name="area"]').fill("Public Administration")
    study.locator('[name="task"]').fill("Weber")
    study.locator('[name="measure"]').fill("Pages 10-15")
    study.locator('[name="durationMinutes"]').fill("45")
    study.locator('button[type="submit"]').click()
    page.locator("#study-dialog").wait_for(state="hidden")
    page.locator('[data-pane="study"]').click()
    wait_until(page, lambda: "Weber" in page.locator("#study-content").inner_text(), timeout=5000, interval=40, message="Study Event not displayed")

    page.set_viewport_size({"width": 390, "height": 844})
    wait_for_layout(page)
    check(not page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), "Horizontal mobile overflow")
    for pane in ("today", "review", "library", "study", "history", "settings"):
        check(page.locator(f'[data-pane="{pane}"]') .is_visible(), f"Mobile navigation hidden: {pane}")
    check(not errors, f"Shell/CRUD browser errors: {errors}")
    page.close()


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

  # ARIA tab registry and keyboard activation.
  tab_contract=page.evaluate("""() => {
    const tabs=[...document.querySelectorAll('[role=tab][data-pane]')];
    const panels=[...document.querySelectorAll('[role=tabpanel]')];
    const keys=tabs.map(tab=>tab.dataset.pane);
    const controlled=tabs.every(tab=>tab.getAttribute('aria-controls') && document.getElementById(tab.getAttribute('aria-controls')));
    return {tablists:document.querySelectorAll('[role=tablist]').length,tabs:tabs.length,panels:panels.length,uniqueKeys:new Set(keys).size,controlled};
  }""")
  check(tab_contract['tablists']==1,'Tablist missing')
  check(tab_contract['tabs']>0 and tab_contract['tabs']==tab_contract['panels'],'ARIA tabs and tabpanels are not one-to-one')
  check(tab_contract['uniqueKeys']==tab_contract['tabs'] and tab_contract['controlled'],'ARIA tab registry has duplicate or unresolved controls')
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

  # Delegated action remains exactly-once after ordinary pane navigation.
  open_rendered_pane(page, "settings")
  page.locator('#new-profile-name').wait_for(state='visible')
  before_profiles=page.evaluate("async()=>await RevisionDirector.records.listProfiles()")
  before_ids={profile['id'] for profile in before_profiles}
  page.locator('#new-profile-name').fill('Delegated action profile')
  page.locator('#new-profile-date').fill('2029-01-01')
  wait_until(
   page,
   lambda: page.locator('#new-profile-name').input_value()=='Delegated action profile'
   and page.locator('#new-profile-date').input_value()=='2029-01-01'
   and page.locator('[data-action=add-profile]').is_enabled()
   and page.evaluate("document.documentElement.dataset.reviewOwnership")=='primary',
   timeout=5000, interval=40,
   message='Profile creation controls were not ready for the primary owner',
  )
  page.evaluate("document.querySelector('#toast').textContent=''")
  page.locator('[data-action=add-profile]').click()
  try:
   wait_until(
    page,
    lambda: len(page.evaluate("async()=>await RevisionDirector.records.listProfiles()"))==len(before_profiles)+1,
    timeout=8000, interval=40,
    message='Delegated add-profile action did not create exactly one record',
   )
  except AssertionError as error:
   observed=page.evaluate("""async()=>({
     profiles:(await RevisionDirector.records.listProfiles()).map(p=>({id:p.id,name:p.name})),
     ownership:document.documentElement.dataset.reviewOwnership,
     name:document.querySelector('#new-profile-name')?.value,
     date:document.querySelector('#new-profile-date')?.value,
     toast:document.querySelector('#toast')?.textContent
   })""")
   raise AssertionError(f"Profile creation did not converge after a ready click: {observed}, errors={errors}") from error
  after_profiles=page.evaluate("async()=>await RevisionDirector.records.listProfiles()")
  added=[profile for profile in after_profiles if profile['id'] not in before_ids]
  check(len(added)==1 and added[0]['name']=='Delegated action profile','Delegated action duplicated or created the wrong profile')

  # Dirty render preserves focus and selection.
  page.locator('[data-pane=library]').click(); page.locator('#pane-library').wait_for(state='visible')
  search=page.locator('#library-search')
  search.evaluate("e=>e.setAttribute('data-qa-before-library-render','1')")
  search.fill('Drainage');search.evaluate('e=>e.setSelectionRange(2,6)')
  wait_until(
   page,
   lambda: page.locator('#library-search[data-qa-before-library-render="1"]').count()==0,
   timeout=5000,
   interval=40,
   message='Debounced library render did not replace the search control',
  )
  search=page.locator('#library-search')
  wait_until(page, lambda: page.locator('.unit-row').count()==1, timeout=3000, interval=40, message='Filtered library did not settle')
  wait_until(
   page,
   lambda: page.evaluate('document.activeElement?.id')=='library-search'
   and search.evaluate('e=>[e.selectionStart,e.selectionEnd]')==[2,6],
   timeout=3000,
   interval=40,
   message='Dirty library render did not restore focus and selection',
  )
  check(page.evaluate('document.activeElement?.id')=='library-search','Dirty render lost focus')
  check(search.evaluate('e=>[e.selectionStart,e.selectionEnd]')==[2,6],'Dirty render lost selection')

  # Native dialog focus and return.
  page.locator('#quick-add-unit').focus();page.locator('#quick-add-unit').click(); page.locator('#unit-dialog').wait_for(state='visible')
  wait_until(
   page,
   lambda: page.evaluate("document.activeElement?.getAttribute('name')")=='profileId',
   timeout=3000,
   interval=30,
   message='Dialog did not establish initial focus',
  )
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
   page.evaluate('__RD_UI_BEHAVIOUR_CLOCK__.advance(130001)')
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
  page.close(); exercise_shell_crud(browser); browser.close()
 print(f'PASS {CHECKS} UI behaviour and repeated-focus checks')

if __name__=='__main__':main()
