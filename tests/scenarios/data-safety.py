from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json, sys
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import ROOT, capture_browser_errors, launch_chromium, load_browser_qa, wait_for_app_ready, wait_until
sys.path.insert(0,str(ROOT/'tests'))
from backup_fixture_codec import decode_file
base=load_browser_qa('revision_director_data_safety')
HOOK="window.__RD_STAGE_D_STORAGE__={RevisionData,RevisionService,Store,APP_VERSION,DB_NAME,DB_VERSION}; void boot();"
HTML=(ROOT/'index.html').read_text().replace('<head>','<head>'+base.INDEXEDDB_SHIM,1).replace('void boot();',HOOK,1)
FIXTURE = baseline_backup_path()
RECOVERY_KEY='revision-director:active-retrieval:v1'
checks=0

def check(v,m):
    global checks; checks+=1
    if not v: raise AssertionError(m)

def safety_download(page,tmp:Path):
    with page.expect_download() as info:
        page.locator('[data-action="create-restore-safety"]').click()
    path=tmp/info.value.suggested_filename
    info.value.save_as(str(path))
    check(path.exists() and path.stat().st_size>0,'Safety artifact was not downloaded')
    return path

def confirm_restore(page, treatment=None, dismiss_first=False):
    if treatment and page.locator('input[name="restore-active-treatment"]').count():
        page.locator(f'input[name="restore-active-treatment"][value="{treatment}"]').check()
    page.locator('#restore-safety-saved').check()
    page.locator('#restore-replace-confirm').check()
    check(page.locator('#restore-final-button').is_enabled(),'Final restore button did not enable')
    if dismiss_first:
        before=page.locator('#sb-units').inner_text()
        page.once('dialog', lambda dialog: dialog.dismiss())
        page.locator('#restore-final-button').click()
        check(page.locator('#restore-dialog').is_visible(),'Cancelled confirmation closed the restore preview')
        check(page.locator('#sb-units').inner_text()==before,'Cancelled final confirmation mutated data')
    page.evaluate("document.querySelector('#toast').textContent=''")
    page.once('dialog', lambda dialog: dialog.accept())
    page.locator('#restore-final-button').click()
    page.locator('#restore-dialog').wait_for(state='hidden')
    wait_until(
        page,
        lambda: 'restored' in page.locator('#toast').inner_text().lower(),
        timeout=8000,
        interval=40,
        message='Confirmed restore did not finish canonical hydration',
    )

def main():
    global checks
    with sync_playwright() as pw, TemporaryDirectory() as td:
        tmp=Path(td)
        browser=launch_chromium(pw)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=capture_browser_errors(page)
        page.set_content(HTML,wait_until='load'); wait_for_app_ready(page)
        check(not page.locator('#fatal-error').is_visible(),'Fatal startup error')
        release_schema = page.evaluate("""async()=>{
          const api=window.__RD_STAGE_D_STORAGE__;
          const openDb=()=>new Promise((resolve,reject)=>{const request=indexedDB.open(api.DB_NAME,api.DB_VERSION);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
          const readMetadata=async db=>await new Promise((resolve,reject)=>{const tx=db.transaction(['metadata'],'readonly');const request=tx.objectStore('metadata').get('database');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
          const writeMetadata=async(db,value)=>await new Promise((resolve,reject)=>{const tx=db.transaction(['metadata'],'readwrite');tx.objectStore('metadata').put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('metadata transaction aborted'))});
          const db=await openDb();
          const initial=await readMetadata(db);
          const prior={...initial,applicationVersion:'va7.0-compatible-release',updatedAt:'2026-01-01T00:00:00.000Z'};
          await writeMetadata(db,prior);
          const reopened=await api.RevisionData.open();
          const reopenedService=new api.RevisionService(reopened);await reopenedService.initialize();
          const refreshed=await reopened.get(api.Store.Metadata,'database');
          const incompatible={...refreshed,databaseVersion:api.DB_VERSION+1};
          await writeMetadata(db,incompatible);
          let schemaError='';try{await api.RevisionData.open()}catch(error){schemaError=error instanceof Error?error.message:String(error)}
          const afterFailure=await readMetadata(db);
          await writeMetadata(db,refreshed);
          const recovered=await api.RevisionData.open();const recoveredService=new api.RevisionService(recovered);await recoveredService.initialize();
          return {current:api.APP_VERSION,appVersion:refreshed.applicationVersion,createdAtPreserved:refreshed.createdAt===initial.createdAt,updatedAtChanged:refreshed.updatedAt!==prior.updatedAt,schemaError,schemaMetadataPreserved:afterFailure.databaseVersion===api.DB_VERSION+1,recoveredCapacity:recoveredService.getSettings().dailyCapacityMinutes,currentCapacity:reopenedService.getSettings().dailyCapacityMinutes};
        }""")
        check(release_schema['appVersion']==release_schema['current'],'Compatible application release was treated as a database incompatibility')
        check(release_schema['createdAtPreserved'],'Compatible release refresh changed database creation identity')
        check(release_schema['updatedAtChanged'],'Compatible release refresh did not update release provenance')
        check('Database metadata does not match this production database' in release_schema['schemaError'],'Schema mismatch did not fail closed')
        check('clear site data' not in release_schema['schemaError'].lower(),'Schema rejection still recommends destructive site-data clearing')
        check(release_schema['schemaMetadataPreserved'],'Schema rejection rewrote incompatible metadata')
        check(release_schema['recoveredCapacity']==release_schema['currentCapacity'],'Compatible reopen after schema rejection changed settings')

        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')

        # Export remains a single visible action and opens no restore ceremony.
        check(page.locator('[data-action="export-backup"]').is_visible(),'Export action is not visible')
        check(page.locator('#restore-dialog').is_hidden(),'Restore dialog is open before import')
        with page.expect_download() as export_info:
            page.locator('[data-action="export-backup"]').click()
        empty_export=tmp/export_info.value.suggested_filename;export_info.value.save_as(str(empty_export))
        check(empty_export.suffix=='.rdbackup','One-click export did not use .rdbackup')
        check(not page.locator('#restore-dialog').is_visible(),'Export unexpectedly opened a restore dialog')
        empty_payload=decode_file(empty_export)
        check(len(empty_payload['units'])==0 and empty_payload['activeRetrieval'] is None,'Clean export payload is wrong')
        check('verified backup exported' in page.locator('#toast').inner_text().lower(),'Export success message is unclear')

        # Inspection is non-mutating, cancellable, and the same file can be selected again.
        before=page.locator('#sb-units').inner_text()
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(FIXTURE)); page.locator('#restore-dialog').wait_for(state='visible')
        check(page.locator('#restore-dialog').is_visible(),'Import selection did not open preview')
        check(page.locator('#sb-units').inner_text()==before,'Inspection mutated local records')
        preview=page.locator('#restore-preview').inner_text()
        check('No application data has been changed' in preview,'Non-mutating inspection statement is missing')
        check('archive checksum:' in preview.lower() and 'knowledge units' in preview.lower(),'Inspection metadata is incomplete')
        check(page.locator('#restore-final-button').is_disabled(),'Restore enabled before safety steps')
        check(page.evaluate("document.activeElement?.getAttribute('data-action')")=='create-restore-safety','Restore preview did not focus the first safety action')
        page.get_by_role('button',name='CANCEL',exact=True).click(); page.locator('#restore-dialog').wait_for(state='hidden')
        check(not page.locator('#restore-dialog').is_visible(),'Cancel did not close restore preview')
        check(page.locator('#sb-units').inner_text()==before,'Cancel mutated data')
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(FIXTURE)); page.locator('#restore-dialog').wait_for(state='visible')
        check(page.locator('#restore-dialog').is_visible(),'Same backup could not be reselected after cancellation')

        safety=safety_download(page,tmp)
        check(safety.suffix=='.rdbackup','Healthy current state did not create .rdbackup safety copy')
        safety_payload=decode_file(safety)
        check(len(safety_payload['units'])==0 and safety_payload['activeRetrieval'] is None,'Safety copy did not preserve current empty state')
        check(page.locator('#restore-safety-saved').is_enabled(),'Saved-copy acknowledgement did not enable')
        confirm_restore(page,dismiss_first=True)
        check(page.locator('#sb-units').inner_text()=='2','Verified restore did not replace local records')

        # A live unfinished retrieval must be included in the current-state safety copy.
        page.locator('[data-pane="today"]').click(); page.locator('#pane-today').wait_for(state='visible')
        page.locator('[data-action="review-one"][data-id="obligation_ms320pr9_uo4n9u1lsoe33"]').click(); page.locator('#attempt-text').wait_for(state='visible')
        attempt=page.locator('#attempt-text')
        check(attempt.count()==1,'Expected text retrieval did not start')
        attempt.fill('Stage D safety copy live draft')
        wait_until(page, lambda: 'Stage D safety copy live draft' in (page.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')") or ''), timeout=5000, interval=40, message='Live draft did not reach emergency recovery')
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(FIXTURE)); page.locator('#restore-dialog').wait_for(state='visible')
        active_safety=safety_download(page,tmp)
        active_safety_payload=decode_file(active_safety)
        check(active_safety_payload['activeRetrieval'] is not None,'Current-state safety copy omitted unfinished retrieval')
        draft_values=active_safety_payload['activeRetrieval']['draft']['values']
        check('Stage D safety copy live draft' in draft_values.values(),'Safety copy lost live typed work')
        confirm_restore(page)
        check(page.evaluate('(k)=>localStorage.getItem(k)',RECOVERY_KEY) is None,'Discard-only candidate left local emergency recovery behind')

        # The saved active-session backup requires explicit restore/discard treatment.
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        wait_until(
            page,
            lambda: page.evaluate("document.documentElement.dataset.reviewOwnership") == "primary"
            and page.locator('#import-backup').is_enabled(),
            timeout=5000,
            interval=40,
            message='Restore surface did not return to mutable primary state',
        )
        page.locator('#import-backup').set_input_files([])
        page.locator('#import-backup').set_input_files(str(active_safety))
        wait_until(
            page,
            lambda: page.locator('#restore-dialog').is_visible()
            or page.locator('#import-backup').evaluate('e=>e.value') == '',
            timeout=8000,
            interval=40,
            message='Active-session backup import handler did not finish',
        )
        if not page.locator('#restore-dialog').is_visible():
            raise AssertionError(
                f"Active-session safety backup was rejected · ownership={page.evaluate('document.documentElement.dataset.reviewOwnership')!r} · "
                f"enabled={page.locator('#import-backup').is_enabled()} · toast={page.locator('#toast').inner_text()!r}"
            )
        check(page.locator('input[name="restore-active-treatment"]').count()==2,'Active-session treatment choices are missing')
        active_restore_safety=safety_download(page,tmp)
        confirm_restore(page,treatment='restore')
        check(page.locator('#pane-review').is_visible(),'Restored active retrieval did not hydrate Review')
        check(page.locator('#attempt-text').input_value()=='Stage D safety copy live draft','Restored active draft text changed')

        # Reimport the same active backup and explicitly discard its session.
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(active_safety)); page.locator('#restore-dialog').wait_for(state='visible')
        discard_safety=safety_download(page,tmp)
        confirm_restore(page,treatment='discard')
        check(page.evaluate('(k)=>localStorage.getItem(k)',RECOVERY_KEY) is None,'Discard treatment retained emergency active session')

        # Corrupt current relational state after inspection: the controller must provide a forensic rescue, not deadlock.
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(FIXTURE)); page.locator('#restore-dialog').wait_for(state='visible')
        page.evaluate("""async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('revision-director',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});await new Promise((res,rej)=>{const tx=db.transaction(['profiles'],'readwrite');tx.objectStore('profiles').put({schemaVersion:1,id:'corrupt-profile'});tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});}""")
        rescue=safety_download(page,tmp)
        check(rescue.suffix=='.rdrescue','Corrupted state did not create .rdrescue')
        rescue_obj=json.loads(rescue.read_text())
        check(rescue_obj['format']=='revision-director-forensic-rescue' and rescue_obj['importable'] is False,'Forensic rescue identity is wrong')
        check('rawStores' in rescue_obj and 'emergencyRecovery' in rescue_obj and 'diagnostics' in rescue_obj,'Forensic rescue omitted required evidence')
        check('cannot be imported automatically' in page.locator('#restore-safety-result').inner_text(),'Forensic warning is not clear')
        confirm_restore(page)
        check(page.locator('#sb-units').inner_text()=='2','Forensic-gated restore did not recover known-good backup')

        # Rescue and raw JSON cannot enter the normal restore ceremony.
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        page.evaluate("document.querySelector('#toast').textContent=''")
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(rescue))
        wait_until(page, lambda: page.locator('#import-backup').evaluate('e=>e.value') == '', timeout=5000, interval=40, message='.rdrescue import handler did not finish')
        check(not page.locator('#restore-dialog').is_visible(),'.rdrescue entered ordinary restore ceremony')
        rescue_message=page.locator('#toast').inner_text().strip()
        check(bool(rescue_message) and page.locator('#toast').evaluate("e=>e.classList.contains('error')"), f'.rdrescue rejection was not reported as an error · toast={rescue_message!r}')
        raw=tmp/'raw.json';raw.write_text(json.dumps({'format':'revision-director-backup'}))
        page.evaluate("document.querySelector('#toast').textContent=''")
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(raw))
        wait_until(page, lambda: page.locator('#import-backup').evaluate('e=>e.value') == '', timeout=5000, interval=40, message='Raw JSON import handler did not finish')
        raw_message=page.locator('#toast').inner_text().strip()
        check(not page.locator('#restore-dialog').is_visible() and bool(raw_message) and page.locator('#toast').evaluate("e=>e.classList.contains('error')"),
              f'Raw JSON did not fail through the rejection UI contract · toast={raw_message!r}')

        check(not errors,f'Browser errors: {errors}')
        browser.close()
    print(f'PASS {checks} Stage D data-safety browser checks')

if __name__=='__main__': main()
