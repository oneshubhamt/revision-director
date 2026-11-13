from __future__ import annotations
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

TESTS = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(TESTS))
from backup_fixture_codec import baseline_backup_path
from helpers.browser_harness import (
    ROOT,
    accept_dialogs,
    capture_browser_errors,
    launch_chromium,
    wait_until as shared_wait_until,
)
from helpers.persistent_browser import (
    BASE_HTML,
    PERSISTENT_BROWSER_SHIM,
    create_persistent_frame,
    host_state_all,
    host_state_get,
    restore_backup_with_safety_copy,
)
FIXTURE = baseline_backup_path()

# Inject a one-shot hostile mutation immediately after a committing active-session
# write. This changes the commit token before the atomic evidence transaction reads
# its guard, simulating a stale/racing writer at the crash boundary.
_put = "this.data.records.set(JSON.stringify(key),clone(value)); return clone(key);"
_hostile_put = """this.data.records.set(JSON.stringify(key),clone(value));
      if(HOST.sabotageCommit && this.data.name==='activeRetrieval' && value.status==='committing'){
        HOST.sabotageCommit=false; const encoded=JSON.stringify(key); const data=this.data;
        setTimeout(()=>{ const current=data.records.get(encoded); if(current){ current.commitToken='hostile_guard_mismatch'; data.records.set(encoded,current); this.tx.db._persist(); } },0);
      }
      return clone(key);"""
if _put not in PERSISTENT_BROWSER_SHIM:
    raise RuntimeError('Hostile transaction injection point is missing')
_hostile_shim = PERSISTENT_BROWSER_SHIM.replace(_put, _hostile_put, 1)
HTML = BASE_HTML.replace('<head>', '<head>' + _hostile_shim, 1)

checks = 0

def check(value: bool, message: str) -> None:
    global checks
    checks += 1
    if not value:
        raise AssertionError(message)

def wait_until(frame, predicate, timeout=10000) -> None:
    shared_wait_until(
        frame,
        predicate,
        timeout=timeout,
        interval=70,
        message="Timed out waiting for hostile-recovery condition",
    )

def remove_frame(page, frame) -> None:
    frame.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
    wait_until(
        frame,
        lambda: frame.locator("html").get_attribute("data-review-ownership") == "secondary",
        timeout=5000,
    )
    page.evaluate("document.querySelector('#app')?.remove()")

def import_fixture(page, frame) -> None:
    frame.locator('[data-pane="settings"]').click()
    wait_until(frame, lambda: frame.locator('#pane-settings').is_visible())
    wait_until(frame, lambda: frame.locator('#import-backup').is_enabled())
    restore_backup_with_safety_copy(page, frame, FIXTURE)
    wait_until(frame, lambda: "restored" in frame.locator('#toast').inner_text().lower())

def start_recall(page, frame, answer: str) -> None:
    frame.locator('[data-pane="library"]').click()
    row = frame.locator('.unit-row').filter(has_text='Staphylococcus aureus — recognition and clinical reasoning')
    check(row.count() == 1, 'Hostile-recovery target unit is missing')
    row.locator('[data-action="review-unit"]').click()
    wait_until(frame, lambda: frame.locator('#attempt-text').count() == 1)
    frame.locator('#attempt-text').fill(answer)
    wait_until(
        frame,
        lambda: (host_state_get(page, 'activeRetrieval', 'current') or {}).get('draft', {}).get('values', {}).get('attempt-text') == answer,
        timeout=5000,
    )

def host_local(page, key: str):
    return page.evaluate("key => window.__RD_B1_QA_STATE__.local[key] ?? null", key)

def set_host_local(page, key: str, value) -> None:
    page.evaluate("([key,value]) => { if(value === null) delete window.__RD_B1_QA_STATE__.local[key]; else window.__RD_B1_QA_STATE__.local[key]=value; }", [key, value])

def mutate_raw_record(page, store: str, key: str, expression: str) -> None:
    page.evaluate(f"""([store,key]) => {{
      const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
      const records=raw.stores[store].records;
      const index=records.findIndex(([encoded]) => encoded === JSON.stringify(key));
      if(index < 0) throw new Error('record missing');
      const value=structuredClone(records[index][1]);
      {expression}
      records[index][1]=value;
    }}""", [store, key])

def delete_raw_record(page, store: str, key: str) -> None:
    page.evaluate("""([store,key]) => {
      const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
      raw.stores[store].records = raw.stores[store].records.filter(([encoded]) => encoded !== JSON.stringify(key));
    }""", [store, key])

def prepare_good(frame) -> None:
    if frame.locator('#attempt-completed').count() and not frame.locator('#attempt-completed').is_checked():
        frame.locator('#attempt-completed').check()
    frame.locator('[data-action="reveal"]').click()
    wait_until(frame, lambda: frame.locator('[data-review-phase="compare"]').count() and not frame.locator('[data-review-phase="compare"]').is_hidden())
    for index in range(frame.locator('[data-checkpoint]').count()):
        box = frame.locator('[data-checkpoint]').nth(index)
        if not box.is_checked():
            box.check()
    for index in range(frame.locator('[data-rubric]').count()):
        frame.locator('[data-rubric]').nth(index).evaluate("e=>{e.value='4';e.dispatchEvent(new Event('input',{bubbles:true}))}")


def complete_good(frame) -> None:
    prepare_good(frame)
    frame.evaluate("""() => { const button=document.querySelector('[data-action="rate"][data-rating="3"]'); button.click(); button.click(); }""")


def boot_frame(page):
    frame = create_persistent_frame(page, HTML, name="revision-app", element_id="app", width=1280, height=900)
    wait_until(frame, lambda: frame.locator("html").get_attribute("data-review-ownership") == "primary")
    check(not frame.locator("#fatal-error").is_visible(), "Fatal startup error")
    return frame

def main() -> None:
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        context = browser.new_context(viewport={'width': 1320, 'height': 940}, accept_downloads=True)
        page = context.new_page()
        errors = capture_browser_errors(page)
        accept_dialogs(page)
        page.set_content("<body><script>window.__RD_B1_QA_STATE__={local:{},databases:{}}</script></body>")

        # Establish a valid canonical session.
        frame = boot_frame(page)
        import_fixture(page, frame)
        start_recall(page, frame, 'Canonical IndexedDB recovery answer')
        initial = host_state_get(page, 'activeRetrieval', 'current')
        check(initial and initial['status'] == 'active', 'Canonical active session was not established')

        # Corrupted emergency copy must be discarded; valid IndexedDB must recover and repair it.
        remove_frame(page, frame)
        set_host_local(page, 'revision-director:active-retrieval:v1', '{malformed-json')
        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator('#attempt-text').count() == 1)
        check(frame.locator('#attempt-text').input_value() == 'Canonical IndexedDB recovery answer', 'Corrupted local copy displaced valid IndexedDB state')
        repaired = json.loads(host_local(page, 'revision-director:active-retrieval:v1'))
        check(repaired['session']['draft']['values']['attempt-text'] == 'Canonical IndexedDB recovery answer', 'Valid IndexedDB state did not repair the emergency copy')
        diagnostics = json.loads(host_local(page, 'revision-director:diagnostics:v1') or '[]')
        check(any(item['code'] == 'active-retrieval.local.invalid' for item in diagnostics), 'Corrupted emergency copy was not diagnosed')

        # Corrupted IndexedDB active document must not defeat a valid emergency copy.
        frame.locator('#attempt-text').fill('Emergency copy survives hostile IndexedDB')
        wait_until(
            frame,
            lambda: (host_state_get(page, 'activeRetrieval', 'current') or {}).get('draft', {}).get('values', {}).get('attempt-text') == 'Emergency copy survives hostile IndexedDB',
            timeout=5000,
        )
        remove_frame(page, frame)
        mutate_raw_record(page, 'activeRetrieval', 'current', "value.revision='invalid';")
        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator('#attempt-text').count() == 1)
        check(frame.locator('#attempt-text').input_value() == 'Emergency copy survives hostile IndexedDB', 'Valid emergency state did not survive corrupted IndexedDB')
        repaired_idb = host_state_get(page, 'activeRetrieval', 'current')
        check(isinstance(repaired_idb['revision'], int) and repaired_idb['revision'] >= 1, 'Emergency state did not repair corrupted IndexedDB')
        diagnostics = json.loads(host_local(page, 'revision-director:diagnostics:v1') or '[]')
        check(any(item['code'] == 'active-retrieval.indexeddb.read' for item in diagnostics), 'Corrupted IndexedDB session was not diagnosed')

        # A recovered target that no longer exists must be rejected and both recovery copies cleared.
        active = host_state_get(page, 'activeRetrieval', 'current')
        target = active['activeTargetId']
        remove_frame(page, frame)
        delete_raw_record(page, 'obligations', target)
        frame = boot_frame(page)
        wait_until(
            frame,
            lambda: frame.locator('#attempt-text').count() == 0
            and host_state_get(page, 'activeRetrieval', 'current') is None
            and host_local(page, 'revision-director:active-retrieval:v1') is None,
            timeout=8000,
        )
        check(frame.locator('#attempt-text').count() == 0, 'Missing recovery target was reopened')
        check(host_state_get(page, 'activeRetrieval', 'current') is None, 'Invalid-target IndexedDB recovery state was not cleared')
        check(host_local(page, 'revision-director:active-retrieval:v1') is None, 'Invalid-target emergency recovery state was not cleared')

        # A hostile commit-token change between the committing snapshot and the
        # evidence transaction must abort all scheduler/evidence mutation.
        import_fixture(page, frame)
        start_recall(page, frame, 'Transactional guard sabotage')
        guarded = host_state_get(page, 'activeRetrieval', 'current')
        guarded_target = guarded['activeTargetId']
        before_obligation = next(item for item in host_state_all(page, 'obligations') if item['id'] == guarded_target)
        before_guard_evidence = len(host_state_all(page, 'evidenceEvents'))
        prepare_good(frame)
        page.evaluate("window.__RD_B1_QA_STATE__.sabotageCommit=true")
        frame.locator('[data-action="rate"][data-rating="3"]').click()
        wait_until(
            frame,
            lambda: (host_state_get(page, 'activeRetrieval', 'current') or {}).get('status') == 'active',
            timeout=8000,
        )
        check(len(host_state_all(page, 'evidenceEvents')) == before_guard_evidence, 'Guard mismatch wrote Evidence despite transaction abort')
        after_obligation = next(item for item in host_state_all(page, 'obligations') if item['id'] == guarded_target)
        check(after_obligation == before_obligation, 'Guard mismatch advanced scheduler state despite transaction abort')
        guard_active = host_state_get(page, 'activeRetrieval', 'current')
        check(guard_active and guard_active['status'] == 'active', 'Guard mismatch did not safely restore an active retry state')
        frame.locator('[data-action="rate"][data-rating="3"]').click()
        wait_until(frame, lambda: len(host_state_all(page, 'evidenceEvents')) == before_guard_evidence + 1)
        check(len(host_state_all(page, 'evidenceEvents')) == before_guard_evidence + 1, 'Retry after guard abort did not commit exactly once')
        wait_until(
            frame,
            lambda: frame.locator('#pane-today').is_visible()
            or (
                frame.locator('[data-review-phase="attempt"]').count() > 0
                and not frame.locator('[data-review-phase="attempt"]').is_hidden()
            ),
        )

        # Re-establish data, then simulate a crash after the committing snapshot but before the atomic evidence transaction.
        import_fixture(page, frame)
        start_recall(page, frame, 'Retry after committing-state crash')
        remove_frame(page, frame)
        envelope = json.loads(host_local(page, 'revision-director:active-retrieval:v1'))
        envelope['session']['status'] = 'committing'
        envelope['session']['commitToken'] = 'commit_hostile_retry'
        envelope['session']['revision'] += 5
        envelope['session']['updatedAt'] = '2026-07-27T23:59:59.000Z'
        envelope['savedAt'] = envelope['session']['updatedAt']
        set_host_local(page, 'revision-director:active-retrieval:v1', json.dumps(envelope))
        mutate_raw_record(page, 'activeRetrieval', 'current', "value.status='committing'; value.commitToken='commit_hostile_retry'; value.revision += 5; value.updatedAt='2026-07-27T23:59:59.000Z';")
        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator('#attempt-text').count() == 1)
        resumed = host_state_get(page, 'activeRetrieval', 'current')
        check(resumed['status'] == 'active' and 'commitToken' not in resumed, 'Stale committing snapshot was not safely returned to active state')
        before = len(host_state_all(page, 'evidenceEvents'))
        complete_good(frame)
        wait_until(frame, lambda: len(host_state_all(page, 'evidenceEvents')) == before + 1)
        check(len(host_state_all(page, 'evidenceEvents')) == before + 1, 'Retry after committing-state crash duplicated evidence')

        # A newer completed tombstone must suppress an older active emergency snapshot.
        current = host_state_get(page, 'activeRetrieval', 'current')
        if current is not None:
            remove_frame(page, frame)
            local = json.loads(host_local(page, 'revision-director:active-retrieval:v1'))
            local['session']['revision'] = max(1, current['revision'] - 1)
            local['session']['status'] = 'active'
            local['session'].pop('commitToken', None)
            set_host_local(page, 'revision-director:active-retrieval:v1', json.dumps(local))
            mutate_raw_record(page, 'activeRetrieval', 'current', "value.status='completed'; value.activeIndex=value.queueTargetIds.length; value.activeTargetId=''; value.commitToken='commit_completed'; value.revision += 10; value.updatedAt='2026-07-28T00:00:00.000Z'; value.phase='attempt'; value.draft.phase='attempt'; value.timeRuntime.currentPhase='attempt';")
            frame = boot_frame(page)
            wait_until(
                frame,
                lambda: host_state_get(page, 'activeRetrieval', 'current') is None
                and host_local(page, 'revision-director:active-retrieval:v1') is None,
                timeout=8000,
            )
            check(frame.locator('.review-card').count() == 0, 'Completed tombstone was exposed as unfinished work')
            check(host_state_get(page, 'activeRetrieval', 'current') is None, 'Completed tombstone was not cleared from IndexedDB')
            check(host_local(page, 'revision-director:active-retrieval:v1') is None, 'Completed tombstone was not cleared from emergency storage')

        check(not errors, f'Hostile recovery browser errors: {errors}')
        context.close()
        browser.close()
    print(f'PASS {checks} Stage B hostile recovery browser checks')

if __name__ == '__main__':
    main()
