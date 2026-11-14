from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import ROOT, accept_dialogs, capture_browser_errors, launch_chromium, load_browser_qa, wait_for_app_ready, wait_for_backup_import_result, wait_for_toast_outcome, wait_until
base=load_browser_qa('revision_director_backup_codec')
INDEXEDDB_SHIM=base.INDEXEDDB_SHIM
HTML=(ROOT/'index.html').read_text().replace('<head>','<head>'+INDEXEDDB_SHIM,1)
FIXTURE = baseline_backup_path()
RAW=ROOT/'tests/fixtures/browser-baseline.json'
checks=0

def check(value,message):
    global checks; checks+=1
    if not value: raise AssertionError(message)

def complete_restore(page,tmp):
    with page.expect_download() as di: page.locator('[data-action="create-restore-safety"]').click()
    out=tmp/di.value.suggested_filename; di.value.save_as(str(out))
    page.locator('#restore-safety-saved').check(); page.locator('#restore-replace-confirm').check()
    if page.locator('input[name="restore-active-treatment"]').count(): page.locator('input[name="restore-active-treatment"][value="discard"]').check()
    page.evaluate("document.querySelector('#toast').textContent=''")
    page.locator('#restore-final-button').click()
    page.locator('#restore-dialog').wait_for(state='hidden', timeout=8000)
    wait_for_toast_outcome(page, expect_error=False, timeout=8000, message='Restore did not report successful completion')

def main():
    global checks
    with sync_playwright() as pw:
        browser=launch_chromium(pw)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=capture_browser_errors(page)
        accept_dialogs(page)
        page.set_content(HTML,wait_until='load'); wait_for_app_ready(page)
        check(not page.locator('#fatal-error').is_visible(),'Fatal startup error')
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        check('.rdbackup' in (page.locator('#import-backup').get_attribute('accept') or ''),'Backup picker does not advertise .rdbackup')
        with TemporaryDirectory() as tmpdir:
            tmp=Path(tmpdir)
            page.locator('#import-backup').set_input_files(str(FIXTURE)); page.locator('#restore-dialog').wait_for(state='visible')
            check(page.locator('#restore-dialog').is_visible(),'Verified archive did not inspect')
            complete_restore(page,tmp)
            check(page.locator('#sb-units').inner_text()!='0','Restored archive did not populate units')
            page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
            with page.expect_download() as download_info: page.locator('[data-action="export-backup"]').click()
            download=download_info.value; exported=tmp/download.suggested_filename; download.save_as(str(exported))
            check(exported.suffix=='.rdbackup','Export extension is not .rdbackup')
            data=exported.read_bytes(); check(len(data)>0,'Exported backup is empty')
            check(data[:2]==b'\x1f\x8b' or data.startswith(b'{"kind":"manifest"'),'Compression detection signature is missing')
            page.locator('#import-backup').set_input_files(str(exported)); page.locator('#restore-dialog').wait_for(state='visible')
            check(page.locator('#restore-dialog').is_visible(),'Exported archive did not round-trip inspect')
            page.get_by_role('button', name='CANCEL', exact=True).click(); page.locator('#restore-dialog').wait_for(state='hidden')
            lines=FIXTURE.read_text().strip().splitlines(); parsed=[json.loads(x) for x in lines]
            first_chunk=next(x for x in parsed if x.get('kind')=='chunk'); first_chunk['items'][0]['name']='Tampered name'
            tampered=tmp/'tampered.rdbackup'; tampered.write_text('\n'.join(json.dumps(x,separators=(',',':')) for x in parsed)+'\n')
            page.evaluate("document.querySelector('#toast').textContent=''")
            page.locator('#import-backup').set_input_files(str(tampered))
            tampered_result=wait_for_backup_import_result(page, timeout=5000)
            check(bool(tampered_result['message']) and tampered_result['error'] and not tampered_result['preview'],
                  f"Tampered archive did not fail through the rejection UI contract · result={tampered_result!r}")
            page.evaluate("document.querySelector('#toast').textContent=''")
            page.locator('#import-backup').set_input_files(str(RAW))
            raw_result=wait_for_backup_import_result(page, timeout=5000)
            check(bool(raw_result['message']) and raw_result['error'] and not raw_result['preview'],
                  f"Raw JSON did not fail through the rejection UI contract · result={raw_result!r}")
        check(not errors,f'Browser errors: {errors}')
        browser.close()
    print(f'PASS {checks} Pass D1 browser codec checks')

if __name__=='__main__': main()
