from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import ROOT, accept_dialogs, capture_browser_errors, launch_chromium, load_browser_qa, wait_for_app_ready, wait_until
sys.path.insert(0,str(ROOT/'tests'))
base=load_browser_qa('revision_director_backup_restore_controller')
HTML=(ROOT/'index.html').read_text().replace('<head>','<head>'+base.INDEXEDDB_SHIM,1)
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
    page.locator('#restore-final-button').click()
    wait_until(page, lambda: not page.locator('#restore-dialog').is_visible() and 'restored' in page.locator('#toast').inner_text().lower(), timeout=8000, interval=40, message='Restore did not complete')

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
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        before=page.locator('#sb-units').inner_text()
        page.locator('#import-backup').set_input_files(str(FIXTURE)); page.locator('#restore-dialog').wait_for(state='visible')
        check(page.locator('#restore-preview').get_by_text('No application data has been changed').count()==1,'Non-mutating inspection message missing')
        check(page.locator('#sb-units').inner_text()==before,'Inspection mutated application state')
        check('Archive checksum:' in page.locator('#restore-preview').inner_text(),'Restore preview lacks checksum')
        restore_selected(page,tmp,'discard')
        check(page.locator('#sb-units').inner_text()=='2','Verified restore did not replace records')
        check('verified backup restored' in page.locator('#toast').inner_text().lower(),'Restore success not reported')
        # One-click local export remains simple.
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        with page.expect_download() as info:
            page.locator('[data-action="export-backup"]').click()
        exported=tmp/info.value.suggested_filename;info.value.save_as(str(exported))
        check(exported.suffix=='.rdbackup' and exported.stat().st_size>0,'One-click export failed')
        # Start an unfinished retrieval and export it.
        page.locator('[data-pane="today"]').click(); page.locator('#pane-today').wait_for(state='visible')
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
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
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
        page.locator('[data-pane="settings"]').click(); page.locator('#pane-settings').wait_for(state='visible')
        page.evaluate("document.querySelector('#toast').textContent=''")
        page.locator('#import-backup').set_input_files(str(tampered))
        wait_until(page, lambda: page.locator('#import-backup').evaluate('e=>e.value') == '', timeout=5000, interval=40, message='Tampered backup import handler did not finish')
        msg=page.locator('#toast').inner_text().strip()
        check(bool(msg) and page.locator('#toast').evaluate("e=>e.classList.contains('error')") and not page.locator('#restore-dialog').is_visible(),
              f'Tampered backup did not fail through the rejection UI contract · toast={msg!r}')
        check(not errors,f'Browser errors: {errors}')
        browser.close()
    print(f'PASS {checks} Pass D2 browser restore-controller checks')

if __name__=='__main__': main()
