from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json, os, runpy, shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
base=runpy.run_path(str(ROOT/'tests/browser-qa.spec.py'),run_name='rd_d1_base')
INDEXEDDB_SHIM=base['INDEXEDDB_SHIM']
HTML=(ROOT/'index.html').read_text().replace('<head>','<head>'+INDEXEDDB_SHIM,1)
FIXTURE=ROOT/'tests/fixtures/browser-baseline.rdbackup'
RAW=ROOT/'tests/fixtures/browser-baseline.json'
checks=0

def check(value,message):
    global checks; checks+=1
    if not value: raise AssertionError(message)

def wait(page,ms=400): page.wait_for_timeout(ms)

def complete_restore(page,tmp):
    with page.expect_download() as di: page.locator('[data-action="create-restore-safety"]').click()
    out=tmp/di.value.suggested_filename; di.value.save_as(str(out))
    page.locator('#restore-safety-saved').check(); page.locator('#restore-replace-confirm').check()
    if page.locator('input[name="restore-active-treatment"]').count(): page.locator('input[name="restore-active-treatment"][value="discard"]').check()
    page.locator('#restore-final-button').click(); wait(page,1000)

def main():
    global checks
    exe=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=exe if exe else None,args=['--no-sandbox','--disable-dev-shm-usage'])
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.on('console',lambda m: errors.append(m.text) if m.type=='error' else None)
        page.on('dialog',lambda d:d.accept())
        page.set_content(HTML,wait_until='load'); wait(page,1300)
        check(not page.locator('#fatal-error').is_visible(),'Fatal startup error')
        page.locator('[data-pane="settings"]').click(); wait(page)
        check('.rdbackup' in (page.locator('#import-backup').get_attribute('accept') or ''),'Backup picker does not advertise .rdbackup')
        with TemporaryDirectory() as tmpdir:
            tmp=Path(tmpdir)
            page.locator('#import-backup').set_input_files(str(FIXTURE)); wait(page,900)
            check(page.locator('#restore-dialog').is_visible(),'Verified archive did not inspect')
            complete_restore(page,tmp)
            check('verified backup restored' in page.locator('#toast').inner_text().lower(),'Verified archive did not restore')
            check(page.locator('#sb-units').inner_text()!='0','Restored archive did not populate units')
            page.locator('[data-pane="settings"]').click(); wait(page)
            with page.expect_download() as download_info: page.locator('[data-action="export-backup"]').click()
            download=download_info.value; exported=tmp/download.suggested_filename; download.save_as(str(exported))
            check(exported.suffix=='.rdbackup','Export extension is not .rdbackup')
            data=exported.read_bytes(); check(len(data)>0,'Exported backup is empty')
            check(data[:2]==b'\x1f\x8b' or data.startswith(b'{"kind":"manifest"'),'Compression detection signature is missing')
            page.locator('#import-backup').set_input_files(str(exported)); wait(page,900)
            check(page.locator('#restore-dialog').is_visible(),'Exported archive did not round-trip inspect')
            page.get_by_role('button', name='CANCEL', exact=True).click(); wait(page,150)
            lines=FIXTURE.read_text().strip().splitlines(); parsed=[json.loads(x) for x in lines]
            first_chunk=next(x for x in parsed if x.get('kind')=='chunk'); first_chunk['items'][0]['name']='Tampered name'
            tampered=tmp/'tampered.rdbackup'; tampered.write_text('\n'.join(json.dumps(x,separators=(',',':')) for x in parsed)+'\n')
            page.locator('#import-backup').set_input_files(str(tampered)); wait(page,600)
            check('integrity' in page.locator('#toast').inner_text().lower() or 'checksum' in page.locator('#toast').inner_text().lower(),'Tampered archive was not rejected')
            page.locator('#import-backup').set_input_files(str(RAW)); wait(page,500)
            raw_message=page.locator('#toast').inner_text().lower()
            check('supported' in raw_message or 'archive' in raw_message or 'incomplete' in raw_message or 'invalid json lines' in raw_message,'Raw JSON was not rejected')
        check(not errors,f'Browser errors: {errors}')
        browser.close()
    print(f'PASS {checks} Pass D1 browser codec checks')

if __name__=='__main__': main()
