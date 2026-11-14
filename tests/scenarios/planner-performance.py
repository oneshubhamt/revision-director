from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import time
from backup_fixture_codec import decode_file, encode_payload
from playwright.sync_api import sync_playwright
from scenario_timing import timed

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from helpers.browser_harness import (
    ROOT,
    launch_chromium,
    open_html_page,
    open_rendered_pane,
    wait_for_app_ready,
    wait_for_backup_import_result,
    wait_for_layout,
    wait_until as shared_wait_until,
)
from helpers.browser_fixture import BASELINE_BACKUP, HTML, restore_selected_backup, stored_record
PERFORMANCE_HTML = HTML.replace(
    "void boot();",
    "window.__RD_PERF_QA__={RevisionData,Store,boot};",
    1,
)

def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)

def open_page(browser, viewport=None, *, baseline=True):
    page, errors = open_html_page(
        browser,
        HTML,
        viewport=viewport or {'width':1365,'height':950},
        include_warnings=True,
    )
    check(not page.locator('#fatal-error').is_visible(), 'Fatal startup')
    open_rendered_pane(page, 'settings')
    shared_wait_until(
        page,
        lambda: page.evaluate("document.documentElement.dataset.reviewOwnership") == "primary"
        and page.locator('#import-backup').is_enabled(),
        timeout=8000,
        interval=40,
        message='Performance restore surface did not become mutable',
    )
    if baseline:
        restore_selected_backup(page, BASELINE_BACKUP)
    return page, errors


def ensure_pane(page, pane: str) -> None:
    # Settings can already be the active tab while a queued invalidation is
    # replacing its form. Await an actual fresh render before editing it.
    open_rendered_pane(page, pane, force_render=True)

def set_capacity(page, value: int) -> None:
    ensure_pane(page, 'settings')
    form=page.locator('#settings-form')
    form.locator('[name="dailyCapacityMinutes"]').fill(str(value))
    page.evaluate("document.querySelector('#toast').textContent=''")
    form.locator('button[type="submit"]').click()
    shared_wait_until(
        page,
        lambda: (stored_record(page, 'settings', 'app') or {}).get('dailyCapacityMinutes') == value
        and page.locator('#settings-form [name="dailyCapacityMinutes"]').input_value() == str(value),
        timeout=8000,
        interval=80,
        message='Timed out waiting for capacity setting persistence',
    )
    check((stored_record(page, 'settings', 'app') or {}).get('dailyCapacityMinutes') == value, 'Capacity setting did not persist canonically')
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
    shared_wait_until(
        page,
        lambda: row.locator('[data-action="review-chunk"]').count() == 1,
        timeout=8000,
        interval=40,
        message='Initial oversized work was not split',
    )
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
        shared_wait_until(
            page,
            lambda: row.locator('[data-action="review-one"]').count() == 1
            and row.locator('[data-action="review-chunk"]').count() == 0,
            timeout=8000,
            interval=40,
            message='Planner projection did not reflect split-cycle dissolution',
        )
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
        open_rendered_pane(page, 'settings')
        page.evaluate("document.querySelector('#toast').textContent=''")
        page.locator('#import-backup').set_input_files(str(hp))
        result=wait_for_backup_import_result(page, timeout=8000)
        check(bool(result['message']) and result['error'] and not result['preview'],
              f"Impossible planning date did not fail through the rejection UI contract · result={result!r}")
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
    baseline=json.loads((ROOT/'tests/fixtures/browser-baseline.json').read_text())
    settings=json.loads(json.dumps(baseline['settings']))
    settings['activeProfileId']='p'
    settings['dailyCapacityMinutes']=120
    settings['fsrsScheduling']['policy']={'kind':'fixed-retention','desiredRetention':.9}
    return {'format':'revision-director-backup','schemaVersion':2,'exportedAt':now,'appVersion':baseline['appVersion'],'profiles':[profile],'nodes':nodes,'units':units,'studyEvents':[],'obligations':obligations,'evidenceEvents':[],'chunks':[],'dailyPlans':[],'activeRetrieval':None,'settings':settings}

def scenario_large_dataset(browser):
    payload=large_backup(1000)
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[]
    page.on("console", lambda message: errors.append((message.type,message.text)) if message.type in ("error","warning") else None)
    page.on("pageerror", lambda error: errors.append(("pageerror",str(error))))
    page.on("dialog", lambda dialog: dialog.accept())
    page.set_content(PERFORMANCE_HTML, wait_until='load')
    page.evaluate(
        """async payload=>{
          const api=window.__RD_PERF_QA__;
          if(!api) throw new Error('Performance QA boot hook is unavailable');
          const repo=await api.RevisionData.open();
          await repo.putMany(api.Store.Profiles,payload.profiles);
          await repo.putMany(api.Store.Nodes,payload.nodes);
          await repo.putMany(api.Store.Units,payload.units);
          await repo.putMany(api.Store.Obligations,payload.obligations);
          await repo.put(api.Store.Settings,payload.settings);
        }""",
        payload,
    )
    start=time.monotonic()
    page.evaluate("async()=>await window.__RD_PERF_QA__.boot()")
    wait_for_app_ready(page, timeout=25_000)
    shared_wait_until(
        page,
        lambda: page.locator('#sb-units').inner_text().strip() == '1000',
        timeout=25_000,
        interval=100,
        message='Timed out waiting for 1,000-unit planner/render boot',
    )
    elapsed=time.monotonic()-start
    check(page.locator('#sb-units').inner_text().strip()=='1000','Large syllabus boot lost records')
    # Hosted-runner regression envelope for initialization + planning + initial UI
    # projection. Backup codec/restore performance is tested independently.
    check(elapsed<25,f'1,000-unit planner/render boot exceeded 25s regression envelope: {elapsed:.1f}s')
    page.locator('[data-pane="today"]').click(); page.locator('#pane-today').wait_for(state='visible')
    check(page.locator('#today-content .deferred-list .planner-row').count() <= 20, 'Deferred backlog display exceeded its intentional 20-row cap')
    check(page.locator('#today-content .planner-row').count() <= 40, 'Today rendered an unexpectedly large actionable surface')
    page.locator('[data-pane="library"]').click(); page.locator('#pane-library').wait_for(state='visible')
    shared_wait_until(page, lambda: page.locator('#library-content .unit-row').count()==1000, timeout=10000, interval=50, message='Large library did not finish rendering')
    check(page.locator('#library-content .unit-row').count()==1000,'Large library lost records')
    page.set_viewport_size({'width':390,'height':844}); wait_for_layout(page)
    check(not page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth'),'Large dataset caused mobile horizontal overflow')
    check(not errors,f'planner-performance errors: {errors}')
    page.close()

def main():
    with sync_playwright() as playwright:
        browser=launch_chromium(playwright)
        timed('planner.capacity-reflow', scenario_capacity_reflow, browser)
        timed('planner.hostile-import', scenario_hostile_planning_import, browser)
        timed('planner.large-dataset', scenario_large_dataset, browser)
        browser.close()
    print('PASS 3 planner performance de novo Chromium scenarios')

if __name__=='__main__': main()
