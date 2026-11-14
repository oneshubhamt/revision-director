from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json, re, sys
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import ROOT, capture_browser_errors, launch_chromium, load_browser_qa, open_rendered_pane, wait_for_app_ready, wait_for_backup_import_result, wait_for_toast_outcome, wait_until
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

def ensure_settings(page) -> None:
    open_rendered_pane(page, 'settings')


def wait_restore_mutable(page) -> None:
    wait_until(
        page,
        lambda: page.evaluate("document.documentElement.dataset.reviewOwnership") == "primary"
        and page.locator('#import-backup').is_enabled(),
        timeout=5000,
        interval=40,
        message='Restore surface did not settle into mutable primary state',
    )


def open_restore_preview(page, path: Path) -> None:
    wait_restore_mutable(page)
    page.evaluate("document.querySelector('#toast').textContent=''")
    page.locator('#import-backup').set_input_files([])
    page.locator('#import-backup').set_input_files(str(path))
    result=wait_for_backup_import_result(page, timeout=8000)
    check(bool(result['preview']), f"Verified backup did not open restore preview · result={result!r}")


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
    wait_for_toast_outcome(
        page,
        expect_error=False,
        timeout=8000,
        message='Confirmed restore did not report successful canonical hydration',
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
        check(bool(release_schema['schemaError']),'Schema mismatch did not fail closed')
        check('clear site data' not in release_schema['schemaError'].lower(),'Schema rejection still recommends destructive site-data clearing')
        check(release_schema['schemaMetadataPreserved'],'Schema rejection rewrote incompatible metadata')
        check(release_schema['recoveredCapacity']==release_schema['currentCapacity'],'Compatible reopen after schema rejection changed settings')

        ensure_settings(page)

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
        wait_for_toast_outcome(page, expect_error=False, timeout=5000, message='Export did not report successful completion')

        # Inspection is non-mutating, cancellable, and the same file can be selected again.
        before=page.locator('#sb-units').inner_text()
        open_restore_preview(page, FIXTURE)
        check(page.locator('#restore-dialog').is_visible(),'Import selection did not open preview')
        check(page.locator('#sb-units').inner_text()==before,'Inspection mutated local records')
        check(page.locator('#restore-preview .restore-summary .restore-stat').count() >= 6,'Inspection metadata is incomplete')
        proof=page.locator('#restore-preview .restore-proof').first.inner_text()
        check(bool(re.search(r'\b[0-9a-f]{64}\b', proof, re.IGNORECASE)),'Inspection metadata omitted the archive checksum')
        check(page.locator('#restore-final-button').is_disabled(),'Restore enabled before safety steps')
        check(page.evaluate("document.activeElement?.getAttribute('data-action')")=='create-restore-safety','Restore preview did not focus the first safety action')
        page.get_by_role('button',name='CANCEL',exact=True).click(); page.locator('#restore-dialog').wait_for(state='hidden')
        check(not page.locator('#restore-dialog').is_visible(),'Cancel did not close restore preview')
        check(page.locator('#sb-units').inner_text()==before,'Cancel mutated data')
        open_restore_preview(page, FIXTURE)
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
        ensure_settings(page)
        open_restore_preview(page, FIXTURE)
        active_safety=safety_download(page,tmp)
        active_safety_payload=decode_file(active_safety)
        check(active_safety_payload['activeRetrieval'] is not None,'Current-state safety copy omitted unfinished retrieval')
        draft_values=active_safety_payload['activeRetrieval']['draft']['values']
        check('Stage D safety copy live draft' in draft_values.values(),'Safety copy lost live typed work')
        confirm_restore(page)
        check(page.evaluate('(k)=>localStorage.getItem(k)',RECOVERY_KEY) is None,'Discard-only candidate left local emergency recovery behind')

        # The saved active-session backup requires explicit restore/discard treatment.
        ensure_settings(page)
        open_restore_preview(page, active_safety)
        check(page.locator('input[name="restore-active-treatment"]').count()==2,'Active-session treatment choices are missing')
        active_restore_safety=safety_download(page,tmp)
        confirm_restore(page,treatment='restore')
        check(page.locator('#pane-review').is_visible(),'Restored active retrieval did not hydrate Review')
        check(page.locator('#attempt-text').input_value()=='Stage D safety copy live draft','Restored active draft text changed')

        # Reimport the same active backup and explicitly discard its session.
        ensure_settings(page)
        open_restore_preview(page, active_safety)
        discard_safety=safety_download(page,tmp)
        confirm_restore(page,treatment='discard')
        check(page.evaluate('(k)=>localStorage.getItem(k)',RECOVERY_KEY) is None,'Discard treatment retained emergency active session')

        # Corrupt current relational state after inspection: the controller must provide a forensic rescue, not deadlock.
        ensure_settings(page)
        open_restore_preview(page, FIXTURE)
        page.evaluate("""async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('revision-director',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});await new Promise((res,rej)=>{const tx=db.transaction(['profiles'],'readwrite');tx.objectStore('profiles').put({schemaVersion:1,id:'corrupt-profile'});tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});}""")
        rescue=safety_download(page,tmp)
        check(rescue.suffix=='.rdrescue','Corrupted state did not create .rdrescue')
        rescue_obj=json.loads(rescue.read_text())
        check(rescue_obj['format']=='revision-director-forensic-rescue' and rescue_obj['importable'] is False,'Forensic rescue identity is wrong')
        check('rawStores' in rescue_obj and 'emergencyRecovery' in rescue_obj and 'diagnostics' in rescue_obj,'Forensic rescue omitted required evidence')
        check(page.locator('#restore-safety-result .bad').count()==1 and page.locator('#restore-safety-result .bad').is_visible(),'Forensic rescue did not expose a visible non-importable warning state')
        confirm_restore(page)
        check(page.locator('#sb-units').inner_text()=='2','Forensic-gated restore did not recover known-good backup')

        # Hostile content cannot enter the normal restore ceremony even when renamed to an accepted .rdbackup.
        ensure_settings(page)
        wait_restore_mutable(page)
        rescue_probe=tmp/'forensic-rescue-disguised.rdbackup'
        rescue_probe.write_bytes(rescue.read_bytes())
        page.evaluate("document.querySelector('#toast').textContent=''")
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(rescue_probe))
        rescue_result=wait_for_backup_import_result(page, timeout=5000)
        check(not rescue_result['preview'] and bool(rescue_result['message']) and rescue_result['error'],
              f"Forensic rescue disguised as .rdbackup was not rejected · result={rescue_result!r}")
        raw=tmp/'raw-disguised.rdbackup';raw.write_text(json.dumps({'format':'revision-director-backup'}))
        page.evaluate("document.querySelector('#toast').textContent=''")
        page.locator('#import-backup').set_input_files([]); page.locator('#import-backup').set_input_files(str(raw))
        raw_result=wait_for_backup_import_result(page, timeout=5000)
        check(not raw_result['preview'] and bool(raw_result['message']) and raw_result['error'],
              f"Raw JSON disguised as .rdbackup was not rejected · result={raw_result!r}")

        check(not errors,f'Browser errors: {errors}')
        browser.close()
    print(f'PASS {checks} Stage D data-safety browser checks')

if __name__=='__main__': main()
