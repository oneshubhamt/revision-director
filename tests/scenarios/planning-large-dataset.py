from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import time
from backup_fixture_codec import decode_file, encode_payload
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from helpers.browser_harness import (
    ROOT,
    launch_chromium,
    load_browser_qa,
    open_html_page,
    wait_for_layout,
    wait_until as shared_wait_until,
)
# Reuse the exact deterministic IndexedDB-compatible HTML fixture from the main browser suite.
main_qa = load_browser_qa("revision_director_planning_large_dataset")
HTML = main_qa.HTML

def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)

def open_page(browser, viewport=None):
    page, errors = open_html_page(
        browser,
        HTML,
        viewport=viewport or {'width':1365,'height':950},
        include_warnings=True,
    )
    check(not page.locator('#fatal-error').is_visible(), 'Fatal startup')
    page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
    main_qa.restore_selected_backup(page, main_qa.BASELINE_BACKUP)
    check('restored' in page.locator('#toast').inner_text().lower(), 'Baseline fixture restore failed')
    return page, errors


def ensure_pane(page, pane: str) -> None:
    tab=page.locator(f'[data-pane="{pane}"]')
    if tab.get_attribute('aria-selected') != 'true':
        tab.click()
    page.locator(f'#pane-{pane}').wait_for(state='visible')

def set_capacity(page, value: int) -> None:
    ensure_pane(page, 'settings')
    form=page.locator('#settings-form')
    form.locator('[name="dailyCapacityMinutes"]').fill(str(value))
    page.evaluate("document.querySelector('#toast').textContent=''")
    form.locator('button[type="submit"]').click()
    shared_wait_until(
        page,
        lambda: 'settings saved' in page.locator('#toast').inner_text().lower()
        and page.locator('#settings-form [name="dailyCapacityMinutes"]').input_value() == str(value),
        timeout=8000,
        interval=80,
        message='Timed out waiting for capacity setting persistence',
    )
    check('settings saved' in page.locator('#toast').inner_text().lower(), 'Capacity setting did not persist')
    check(page.locator('#settings-form [name="dailyCapacityMinutes"]').input_value() == str(value), 'Capacity setting rerendered with a stale value')

def add_oversized(page) -> None:
    page.locator('#quick-add-unit').click(); page.locator('#unit-dialog').wait_for(state='visible')
    form=page.locator('#unit-form')
    due=page.evaluate("new Date(Date.now()-3600000).toISOString().slice(0,16)")
    values={
      'subject':'Geology','section':'Geomorphology','topic':'Drainage','title':'Capacity reflow obligation',
      'scope':'Pages 1-12','source':'Notes pages 1-12','expectedMinutes':'90',
      'workflowPrompt':'Reconstruct the complete framework','workflowCheckpoints':'Alpha\nBeta',
      'protocol':'Reconstruct all sections and complete a final synthesis','successCriteria':'Alpha; Beta','firstDueAt':due,
    }
    for name,value in values.items(): form.locator(f'[name="{name}"]').fill(value)
    form.locator('[name="obligationType"]').select_option('concept-reconstruction')
    form.locator('[name="workflowKind"]').select_option('reconstruction')
    form.locator('button[type="submit"]').click(); page.locator('#unit-dialog').wait_for(state='hidden')

def export_payload(page, folder: str, name: str):
    ensure_pane(page, 'settings')
    with page.expect_download() as info: page.locator('[data-action="export-backup"]').click()
    path=str(Path(folder)/name); info.value.save_as(path)
    return decode_file(Path(path))

def scenario_capacity_reflow(browser):
    page, errors=open_page(browser)
    set_capacity(page,60); add_oversized(page)
    page.locator('[data-pane="today"]').click(); page.locator('#pane-today').wait_for(state='visible')
    row=page.locator('.planner-row').filter(has_text='Capacity reflow obligation').first
    check(row.locator('[data-action="review-chunk"]').count()==1,'Initial oversized work was not split')
    with TemporaryDirectory() as tmp:
        p60=export_payload(page,tmp,'60.rdbackup')
        ob=next(item for item in p60['obligations'] if item['unitId']==next(u['id'] for u in p60['units'] if u['title']=='Capacity reflow obligation'))
        check(ob['chunking']['capacityMinutes']==60,'Initial chunk cycle capacity missing')
        set_capacity(page,30); page.locator('[data-pane="today"]').click(); page.locator('#pane-today').wait_for(state='visible')
        shared_wait_until(
            page,
            lambda: page.evaluate("""id=>new Promise((resolve,reject)=>{const r=indexedDB.open('revision-director');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const q=r.result.transaction('obligations','readonly').objectStore('obligations').get(id);q.onerror=()=>reject(q.error);q.onsuccess=()=>resolve(q.result?.chunking?.capacityMinutes===30);};})""", ob['id']),
            timeout=8000,
            interval=50,
            message='Timed out waiting for 30-minute chunk reflow',
        )
        p30=export_payload(page,tmp,'30.rdbackup')
        ob30=next(item for item in p30['obligations'] if item['id']==ob['id'])
        check(ob30['chunking']['capacityMinutes']==30,'Untouched split did not reflow to reduced capacity')
        active=[c for c in p30['chunks'] if c['obligationId']==ob['id'] and c['cycleId']==ob30['chunking']['cycleId'] and c['status']!='archived']
        check(active and max(c['expectedMinutes'] for c in active)<=30,'Reflowed chunks exceed reduced capacity')
        check(all(c['status']=='archived' for c in p30['chunks'] if c['obligationId']==ob['id'] and c['cycleId']!=ob30['chunking']['cycleId']),'Prior untouched cycle was not archived')
        set_capacity(page,120); page.locator('[data-pane="today"]').click(); page.locator('#pane-today').wait_for(state='visible')
        shared_wait_until(
            page,
            lambda: page.evaluate("""id=>new Promise((resolve,reject)=>{const r=indexedDB.open('revision-director');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const q=r.result.transaction('obligations','readonly').objectStore('obligations').get(id);q.onerror=()=>reject(q.error);q.onsuccess=()=>resolve(Boolean(q.result) && !q.result.chunking);};})""", ob['id']),
            timeout=8000,
            interval=50,
            message='Timed out waiting for split-cycle dissolution',
        )
        row=page.locator('.planner-row').filter(has_text='Capacity reflow obligation').first
        check(row.locator('[data-action="review-one"]').count()==1 and row.locator('[data-action="review-chunk"]').count()==0,'Split cycle did not dissolve when parent fit capacity')
        p120=export_payload(page,tmp,'120.rdbackup')
        ob120=next(item for item in p120['obligations'] if item['id']==ob['id'])
        check('chunking' not in ob120,'Parent retained stale chunking after capacity increase')
        today=next(plan for plan in p120['dailyPlans'] if plan['studyDayKey']==page.evaluate("new Date(Date.now()-((new Date()).getHours()<4?86400000:0)).toISOString().slice(0,10)"))
        capacities=[v['capacityMinutes'] for v in today['versions']]
        check(60 in capacities and 30 in capacities and 120 in capacities,'Capacity changes were not preserved in daily-plan versions')
    check(not errors,f'Capacity-reflow browser errors: {errors}')
    page.close()

def scenario_hostile_planning_import(browser):
    page, errors=open_page(browser)
    with TemporaryDirectory() as tmp:
        valid=export_payload(page,tmp,'valid.rdbackup')
        check(valid['dailyPlans'],'Expected persisted daily plan')
        hostile=json.loads(json.dumps(valid)); hostile['dailyPlans'][0]['studyDayKey']='2026-02-31'
        hp=Path(tmp)/'hostile.rdbackup'; hp.write_bytes(encode_payload(hostile))
        page.locator('[data-pane="settings"]').click()
        page.evaluate("document.querySelector('#toast').textContent=''")
        page.locator('#import-backup').set_input_files(str(hp))
        shared_wait_until(
            page,
            lambda: 'invalid' in page.locator('#toast').inner_text().lower()
            or page.locator('#restore-dialog').is_visible(),
            timeout=8000,
            interval=80,
            message='Timed out waiting for hostile planning import result',
        )
        toast=page.locator('#toast').inner_text().lower()
        check('invalid' in toast and not page.locator('#restore-dialog').is_visible(),
              'Impossible planning date was accepted through UI import')
    check(not errors,f'Hostile-import errors: {errors}')
    page.close()

def large_backup(count: int):
    now='2026-07-25T06:00:00.000Z'
    profile={'schemaVersion':1,'id':'p','name':'Large Exam','examDate':'2027-12-01','status':'active','createdAt':now,'updatedAt':now}
    nodes=[{'schemaVersion':1,'id':'s','profileId':'p','parentId':None,'kind':'subject','name':'Large Subject','normalizedName':'large subject','createdAt':now,'updatedAt':now},{'schemaVersion':1,'id':'c','profileId':'p','parentId':'s','kind':'section','name':'Section','normalizedName':'section','createdAt':now,'updatedAt':now},{'schemaVersion':1,'id':'t','profileId':'p','parentId':'c','kind':'topic','name':'Topic','normalizedName':'topic','createdAt':now,'updatedAt':now}]
    units=[]; obligations=[]
    policy={'engine':'mastery','version':'concept-mastery/v1','stage':0,'successStreak':0,'failureCount':0,'lastIntervalDays':0}
    workflow={'kind':'reconstruction','prompt':'Reconstruct the topic','checkpoints':['Alpha','Beta'],'responseMedium':'in-app','reconstructionShape':'outline'}
    for i in range(count):
        uid=f'u{i}'; oid=f'o{i}'
        units.append({'schemaVersion':1,'id':uid,'profileId':'p','topicNodeId':'t','title':f'Unit {i:04d}','scope':'Scope','source':'Source','importance':1+(i%3),'status':'active','createdAt':now,'updatedAt':now,'evidenceCount':0,'lapseCount':0})
        obligations.append({'schemaVersion':1,'id':oid,'unitId':uid,'type':'concept-reconstruction','status':'active','dueAt':now,'expectedMinutes':10+(i%20),'baselineMinutes':10+(i%20),'durationSampleCount':0,'protocol':'Reconstruct properly','successCriteria':'Alpha; Beta','workflow':workflow,'freshnessDays':30,'priority':0,'policyState':policy,'createdAt':now,'updatedAt':now})
    current_app_version=json.loads((ROOT/'tests/fixtures/browser-baseline.json').read_text())['appVersion']
    return {'format':'revision-director-backup','schemaVersion':2,'exportedAt':now,'appVersion':current_app_version,'profiles':[profile],'nodes':nodes,'units':units,'studyEvents':[],'obligations':obligations,'evidenceEvents':[],'chunks':[],'dailyPlans':[],'activeRetrieval':None,'settings':{'schemaVersion':1,'key':'app','activeProfileId':'p','fsrsScheduling':{'policy':{'kind':'fixed-retention','desiredRetention':.9}},'memoryDifficultyPolicy':{'remediationLapses':2,'persistentDifficultyLapses':4,'automaticHold':{'enabled':False,'lapseThreshold':8}},'dailyCapacityMinutes':120,'studyDayBoundaryHour':4,'fsrsPersonalization':{'profile':None,'active':False}}}

def scenario_large_dataset(browser):
    page, errors=open_page(browser,{'width':1440,'height':1000})
    with TemporaryDirectory() as tmp:
        payload=large_backup(1000); p=Path(tmp)/'large.rdbackup'; p.write_bytes(encode_payload(payload))
        start=time.monotonic(); page.locator('[data-pane="settings"]').click(); main_qa.restore_selected_backup(page, p)
        shared_wait_until(
            page,
            lambda: page.locator('#sb-units').inner_text().strip() == '1000',
            timeout=20000,
            interval=100,
            message='Timed out waiting for large syllabus render',
        )
        elapsed=time.monotonic()-start
        check(page.locator('#sb-units').inner_text().strip()=='1000','Large syllabus import did not complete')
        check(elapsed<20,f'Large syllabus import/render took too long: {elapsed:.1f}s')
        page.locator('[data-pane="today"]').click(); page.locator('#pane-today').wait_for(state='visible')
        check(page.locator('#today-content .deferred-list .planner-row').count() <= 20, 'Deferred backlog display exceeded its intentional 20-row cap')
        check(page.locator('#today-content .planner-row').count() <= 40, 'Today rendered an unexpectedly large actionable surface')
        page.locator('[data-pane="library"]').click(); page.locator('#pane-library').wait_for(state='visible')
        shared_wait_until(page, lambda: page.locator('#library-content .unit-row').count()==1000, timeout=10000, interval=50, message='Large library did not finish rendering')
        check(page.locator('#library-content .unit-row').count()==1000,'Large library lost records')
        page.set_viewport_size({'width':390,'height':844}); wait_for_layout(page)
        check(not page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth'),'Large dataset caused mobile horizontal overflow')
    check(not errors,f'Large-dataset errors: {errors}')
    page.close()

def main():
    with sync_playwright() as playwright:
        browser=launch_chromium(playwright)
        scenario_capacity_reflow(browser)
        scenario_hostile_planning_import(browser)
        scenario_large_dataset(browser)
        browser.close()
    print('PASS 3 Pass D de novo Chromium scenarios')

if __name__=='__main__': main()
