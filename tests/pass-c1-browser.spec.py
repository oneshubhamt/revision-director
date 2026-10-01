from __future__ import annotations
from pathlib import Path
import importlib.util
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('qa', ROOT/'tests/browser-qa.spec.py')
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('Unable to load browser QA fixture')
QA = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(QA)
TIME_SHIM = r'''<script>(()=>{const RealDate=Date;const fixed=RealDate.parse('2026-07-27T06:30:00.000Z');class FixedDate extends RealDate{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}}Object.defineProperty(window,'Date',{configurable:true,value:FixedDate});})();</script>'''
HTML = (ROOT/'index.html').read_text().replace('<head>', '<head>'+TIME_SHIM+QA.INDEXEDDB_SHIM, 1)
CHECKS = 0

def check(value: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not value:
        raise AssertionError(message)

def open_page(browser, viewport):
    page = browser.new_page(viewport=viewport)
    page.set_default_timeout(10_000)
    errors: list[str] = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(f'{message.type}: {message.text}') if message.type in ('error','warning') else None)
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_content(HTML, wait_until='load')
    page.wait_for_timeout(1_200)
    check(not page.locator('#fatal-error').is_visible(), 'Fatal startup error')
    page.locator('[data-pane="settings"]').click(); page.wait_for_timeout(100)
    QA.restore_selected_backup(page, ROOT/'tests/fixtures/browser-baseline.rdbackup')
    page.add_style_tag(content='*{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}')
    return page, errors

def verify_kernel(page) -> None:
    attributes = page.evaluate("""() => ({
      presentation: document.documentElement.dataset.presentation,
      typography: document.documentElement.dataset.typography,
      shape: document.documentElement.dataset.shape,
      material: document.documentElement.dataset.material,
      depth: document.documentElement.dataset.depth,
      density: document.documentElement.dataset.density,
      responsive: document.documentElement.dataset.responsive,
      motion: document.documentElement.dataset.motion,
      charts: document.documentElement.dataset.charts,
    })""")
    check(attributes == {
        'presentation':'revision-current','typography':'revision','shape':'tactical','material':'solid',
        'depth':'layered','density':'standard','responsive':'adaptive','motion':'precise','charts':'analytical'
    }, 'Pre-paint profile attributes are wrong')
    summary = page.evaluate("""() => {
      const kernel=window[Symbol.for('revisionDirector.presentationKernel.v1')];
      const profile=kernel.manifest.profiles['revision-current'];
      const styles=getComputedStyle(document.documentElement);
      const aliases=kernel.manifest.tokens.aliases;
      const aliasParity=Object.entries(aliases).every(([semantic,primitive])=>styles.getPropertyValue(semantic).trim()===styles.getPropertyValue(primitive).trim());
      const same=kernel.registerPresentation({...profile});
      const replacement=kernel.registerPresentation({...profile,label:'Replacement'});
      return {
        format:kernel.format,version:kernel.version,frozen:Object.isFrozen(kernel)&&Object.isFrozen(kernel.manifest)&&Object.isFrozen(profile),
        defaultId:kernel.manifest.defaults.presentation,active:kernel.activePresentationId(),tokens:kernel.validatePublicTokens(),aliasParity,same,replacement,
        listed:kernel.listPresentations().map(item=>item.id),storageKey:kernel.manifest.storageKey,
        namedLeak:Object.prototype.hasOwnProperty.call(window,'RevisionDirectorPresentation')
      };
    }""")
    check(summary['format']=='revision-director.presentation-kernel' and summary['version']==1, 'Browser kernel identity is wrong')
    check(summary['frozen'], 'Browser kernel or default profile is mutable')
    check(summary['defaultId']=='revision-current' and summary['active']=='revision-current', 'Browser default presentation changed')
    check(summary['tokens'] and summary['aliasParity'], 'Semantic token contract is incomplete or mismatched')
    check(summary['same'] is True and summary['replacement'] is False, 'Immutable default registration contract failed')
    check(summary['listed']==['revision-current'], 'Unexpected presentation profile is bundled')
    check(summary['storageKey']=='revisionDirector.presentation.v1', 'Presentation storage key changed')
    check(summary['namedLeak'] is False, 'Presentation kernel leaked a named public global')


def verify_corrupt_preference_fallback(browser) -> None:
    corrupt = HTML.replace(QA.INDEXEDDB_SHIM, QA.INDEXEDDB_SHIM.replace('})();\n</script>', "localStorage.setItem('revisionDirector.presentation.v1','../../bad');})();\n</script>"), 1)
    page=browser.new_page(viewport={'width':900,'height':700})
    page.set_content(corrupt, wait_until='load'); page.wait_for_timeout(900)
    check(page.locator('html').get_attribute('data-presentation')=='revision-current', 'Corrupt stored presentation bypassed fallback')
    check(not page.locator('#fatal-error').is_visible(), 'Corrupt preference caused startup failure')
    page.close()


def main() -> None:
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
        verify_corrupt_preference_fallback(browser)
        for label,viewport in [('desktop',{'width':1440,'height':1000}),('phone',{'width':390,'height':844})]:
            page,errors=open_page(browser,viewport)
            verify_kernel(page)
            for pane in ('today','review','library','study','history','settings'):
                page.locator(f'[data-pane="{pane}"]').click(); page.wait_for_timeout(180)
                page.evaluate("""() => { const clock=document.querySelector('#clock'); if(clock) clock.textContent='12:34:56'; const toast=document.querySelector('#toast'); if(toast) toast.classList.remove('show'); document.documentElement.scrollTop=0; document.body.scrollTop=0; }""")
                check(not page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), f'Horizontal overflow in {label}/{pane}')
                check(page.locator(f'#pane-{pane}').is_visible(), f'Pane visibility failed in {label}/{pane}')
            check(not errors, f'Browser errors in {label}: {errors}')
            page.close()
        browser.close()
    print(f'PASS {CHECKS} Pass C1 presentation-contract and responsive checks')

if __name__=='__main__':
    main()
