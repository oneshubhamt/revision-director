from __future__ import annotations
from pathlib import Path
import os, runpy, shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
base=runpy.run_path(str(ROOT/'tests/browser-qa.spec.py'),run_name='rd_stage_c_responsive_base')
HTML=(ROOT/'index.html').read_text().replace('<head>','<head>'+base['INDEXEDDB_SHIM'],1)
restore_selected_backup=base['restore_selected_backup']
BASELINE=ROOT/'tests/fixtures/browser-baseline.rdbackup'
CHECKS=0

def check(v,msg):
 global CHECKS; CHECKS+=1
 if not v: raise AssertionError(msg)

def main():
 executable=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or '/usr/bin/chromium'
 viewports=[(320,568),(360,640),(375,667),(390,844),(412,915),(460,800),(560,800),(700,700),(820,900),(821,900),(1024,768),(1280,800),(1440,1000),(1920,1080)]
 panes=('today','review','library','study','history','settings')
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1440,'height':1000})
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:errors.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
  page.on('dialog',lambda d:d.accept())
  page.set_content(HTML,wait_until='load'); page.wait_for_timeout(1300)
  page.locator('[data-pane="settings"]').click(); page.wait_for_timeout(150)
  restore_selected_backup(page, BASELINE)
  check('restored' in page.locator('#toast').inner_text().lower(),'Fixture restore failed')
  for width,height in viewports:
   page.set_viewport_size({'width':width,'height':height}); page.wait_for_timeout(200)
   compact=width<=820
   shell=page.evaluate("""() => {const s=document.querySelector('.sidebar'),m=document.querySelector('.main'),a=document.querySelector('.sidebar-actions');const sr=s.getBoundingClientRect(),mr=m.getBoundingClientRect();return {sidebarPosition:getComputedStyle(s).position,actions:getComputedStyle(a).display,mainBottom:mr.bottom,navTop:sr.top,mainOverflow:getComputedStyle(m).overflowY,docOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};}""")
   check(shell['actions']==('none' if compact else 'grid'),f'Sidebar actions wrong at {width}x{height}: {shell}')
   check(not shell['docOverflow'],f'Document horizontal overflow at {width}x{height}')
   if compact:
    check(shell['mainBottom']<=shell['navTop']+1,f'Main overlaps fixed navigation at {width}x{height}: {shell}')
    check(shell['mainOverflow'] in ('auto','scroll'),f'Compact main is not independently scrollable at {width}x{height}: {shell}')
   else:
    check(shell['sidebarPosition'] in ('fixed','absolute'),f'Desktop sidebar positioning changed at {width}x{height}: {shell}')
   for pane in panes:
    page.evaluate("p=>document.querySelector(`[data-pane=\"${p}\"]`).click()",pane); page.wait_for_timeout(100)
    state=page.evaluate("""pane=>{const panel=document.querySelector(`#pane-${pane}`);const selected=[...document.querySelectorAll('[role=tab][aria-selected=true]')];const visiblePanels=[...document.querySelectorAll('[role=tabpanel]')].filter(e=>!e.hidden&&getComputedStyle(e).display!=='none');const bad=[...document.querySelectorAll('button,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,summary,.file-btn')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return !e.closest('[hidden]')&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.height<43.5}).map(e=>`${e.tagName}#${e.id}.${e.className}:${e.getBoundingClientRect().height}`);return {panel:!!panel&&!panel.hidden&&getComputedStyle(panel).display!=='none',selected:selected.length,visiblePanels:visiblePanels.length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,bad};}""",pane)
    check(state['panel'],f'Pane hidden: {pane} at {width}x{height}')
    check(state['selected']==1 and state['visiblePanels']==1,f'ARIA visibility state invalid: {pane} at {width}x{height}: {state}')
    check(not state['overflow'],f'Horizontal overflow: {pane} at {width}x{height}')
    check(not state['bad'],f'Sub-44px targets: {pane} at {width}x{height}: {state["bad"][:5]}')
  html=(ROOT/'index.html').read_text(); css=(ROOT/'source/revision-director.va7.css').read_text()
  check('viewport-fit=cover' in html,'viewport-fit=cover missing')
  for token in ('safe-area-inset-top','safe-area-inset-right','safe-area-inset-bottom','safe-area-inset-left'):
   check(token in css,f'Safe-area contract missing: {token}')
  check(not errors,f'Browser errors: {errors}')
  page.close(); browser.close()
 print(f'PASS {CHECKS} Stage C responsive checks across {len(viewports)} viewport classes and {len(panes)} panes')

if __name__=='__main__':main()
