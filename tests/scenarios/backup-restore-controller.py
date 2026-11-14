from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import re
import sys
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path, decode_file, encode_payload
from helpers.browser_harness import ROOT, accept_dialogs, capture_browser_errors, launch_chromium, open_rendered_pane, wait_for_app_ready, wait_for_backup_import_result, wait_for_toast_outcome, wait_until
from helpers.browser_fixture import HTML
sys.path.insert(0,str(ROOT/'tests'))
FIXTURE = baseline_backup_path()
checks=0

def check(v,m):
    global checks; checks+=1
    if not v: raise AssertionError(m)

def restore_selected(page, tmp:Path, treatment:str='discard'):
    check(page.locator('#restore-dialog').is_visible(),'Restore preview did not open')
    with page.expect_download() as info:
        page.locator('[data-action="create-restore-safety"]').click()
    dl=info.value; safety=tmp/dl.suggested_filename; dl.save_as(str(safety))
    check(safety.exists() and safety.stat().st_size>0,'Safety copy was not downloaded')
    check(safety.suffix in ('.rdbackup','.rdrescue'),'Safety copy extension is invalid')
    if page.locator('input[name="restore-active-treatment"]').count():
        page.locator(f'input[name="restore-active-treatment"][value="{treatment}"]').check()
    page.locator('#restore-safety-saved').check()
    page.locator('#restore-replace-confirm').check()
    check(page.locator('#restore-final-button').is_enabled(),'Final restore remained disabled')
    page.evaluate("document.querySelector('#toast').textContent=''")
    page.locator('#restore-final-button').click()
    page.locator('#restore-dialog').wait_for(state='hidden', timeout=8000)
    wait_for_toast_outcome(page, expect_error=False, timeout=8000, message='Restore did not report successful completion')

def main():
    global checks
    with sync_playwright() as pw, TemporaryDirectory() as td:
        tmp=Path(td)
        browser=launch_chromium(pw)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=capture_browser_errors(page)
        accept_dialogs(page)
        page.set_content(HTML,wait_until='load'); wait_for_app_ready(page)
        check(not page.locator('#fatal-error').is_visible(),'Fatal startup error')
        open_rendered_pane(page, 'settings')
        before=page.locator('#sb-units').inner_text()
        page.locator('#import-backup').set_input_files(str(FIXTURE)); page.locator('#restore-dialog').wait_for(state='visible')
        check(page.locator('#sb-units').inner_text()==before,'Inspection mutated application state')
        proof=page.locator('#restore-preview .restore-proof').first.inner_text()
        check(bool(re.search(r'\b[0-9a-f]{64}\b', proof, re.IGNORECASE)),'Restore preview lacks a complete archive checksum')
        restore_selected(page,tmp,'discard')
        check(page.locator('#sb-units').inner_text()=='2','Verified restore did not replace records')
        # One-click local export remains simple.
        open_rendered_pane(page, 'settings')
        with page.expect_download() as info:
            page.locator('[data-action="export-backup"]').click()
        exported=tmp/info.value.suggested_filename;info.value.save_as(str(exported))
        check(exported.suffix=='.rdbackup' and exported.stat().st_size>0,'One-click export failed')
        payload=decode_file(exported)
        check(payload['format']=='revision-director-backup' and payload['schemaVersion']==2,'Exported backup identity is invalid')
        check(all(item.get('schemaVersion')==1 for key in ('profiles','nodes','units','studyEvents','obligations','evidenceEvents','chunks','dailyPlans') for item in payload[key]),'Exported backup contains an unversioned document')
        check(page.locator('[data-action="reset-data"]').count()==0,'Prototype reset remains in production UI')
        # Start an unfinished retrieval and export it.
        open_rendered_pane(page, 'today')
        page.locator('[data-action="start-due"]').click(); page.locator('#review-content').wait_for(state='visible')
        attempt=page.locator('#attempt-text')
        if attempt.count():
            attempt.fill('Durable active retrieval text')
            wait_until(
                page,
                lambda: 'Durable active retrieval text' in (page.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')") or ''),
                timeout=5000,
                interval=40,
                message='Active retrieval draft did not reach recovery storage before export',
            )
        open_rendered_pane(page, 'settings')
        with page.expect_download() as active_info:
            page.locator('[data-action="export-backup"]').click()
        active_file=tmp/active_info.value.suggested_filename;active_info.value.save_as(str(active_file))
        # Reinspect active backup: preview must require explicit treatment.
        page.locator('#import-backup').set_input_files([])
        page.locator('#import-backup').set_input_files(str(active_file))
        try:
            page.locator('#restore-dialog').wait_for(state='visible', timeout=8000)
        except Exception as error:
            raise AssertionError(f"Active-session backup inspection failed · toast={page.locator('#toast').inner_text()!r}") from error
        check(page.locator('input[name="restore-active-treatment"]').count()==2,'Active-session treatment choices missing')
        check(page.locator('#restore-final-button').is_disabled(),'Restore enabled before active-session treatment')
        restore_selected(page,tmp,'restore')
        check(page.locator('#pane-review').is_visible(),'Restored unfinished retrieval did not hydrate Review')
        restored=page.locator('#attempt-text')
        if restored.count(): check(restored.input_value()=='Durable active retrieval text','Restored active draft was lost')
        # Selecting a tampered file must not enter restore ceremony.
        data=bytearray(FIXTURE.read_bytes()); data[-10]^=1
        tampered=tmp/'tampered.rdbackup';tampered.write_bytes(data)
        open_rendered_pane(page, 'settings')
        wait_until(
            page,
            lambda: page.evaluate("document.documentElement.dataset.reviewOwnership") == "primary"
            and page.locator('#import-backup').is_enabled(),
            timeout=5000,
            interval=40,
            message='Restore surface did not return to mutable primary state',
        )
        page.evaluate("document.querySelector('#toast').textContent=''")
        page.locator('#import-backup').set_input_files([])
        page.locator('#import-backup').set_input_files(str(tampered))
        result=wait_for_backup_import_result(page, timeout=5000)
        check(bool(result['message']) and result['error'] and not result['preview'],
              f"Tampered backup did not fail through the rejection UI contract · result={result!r}")
        semantic=tmp/'semantic-invalid.rdbackup'
        semantic.write_bytes(encode_payload({**payload,'settings':{**payload['settings'],'activeProfileId':'missing-profile'}}))
        page.locator('#import-backup').set_input_files([])
        page.locator('#import-backup').set_input_files(str(semantic))
        semantic_result=wait_for_backup_import_result(page, timeout=5000)
        check(bool(semantic_result['message']) and semantic_result['error'] and not semantic_result['preview'],
              f"Semantically invalid backup did not fail closed · result={semantic_result!r}")
        check(not errors,f'Browser errors: {errors}')
        browser.close()
    print(f'PASS {checks} browser backup/restore controller checks')

if __name__=='__main__': main()
