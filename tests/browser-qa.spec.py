from __future__ import annotations
from pathlib import Path
from datetime import date, timedelta
from tempfile import TemporaryDirectory
import os
import json
from backup_fixture_codec import baseline_backup_path, decode_file, encode_payload
from playwright.sync_api import sync_playwright
from helpers.browser_harness import launch_chromium, open_rendered_pane, select_backup_file, wait_for_app_ready, wait_for_layout, wait_until

ROOT = Path(__file__).resolve().parents[1]
BASE_HTML = (ROOT / "index.html").read_text()
BASELINE_BACKUP = baseline_backup_path()
INDEXEDDB_SHIM = r"""
<script>
(() => {
  const localRecords=new Map();
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    get length(){return localRecords.size}, key(index){return [...localRecords.keys()][index] ?? null},
    getItem(key){key=String(key);return localRecords.has(key)?localRecords.get(key):null},
    setItem(key,value){localRecords.set(String(key),String(value))}, removeItem(key){localRecords.delete(String(key))}, clear(){localRecords.clear()}
  }});
  class Req { constructor(){this.result=undefined;this.error=null;this.onsuccess=null;this.onerror=null;this.onupgradeneeded=null;} ok(v){this.result=v;setTimeout(()=>this.onsuccess&&this.onsuccess({target:this}),0)} fail(e){this.error=e;setTimeout(()=>this.onerror&&this.onerror({target:this}),0)} }
  const databases=new Map();
  const keyFrom=(obj,path)=>Array.isArray(path)?path.map(k=>obj[k]):obj[path];
  class StoreData { constructor(name,opts={}){this.name=name;this.keyPath=opts.keyPath||null;this.records=new Map();this.indices=new Map();} }
  class Tx {
    constructor(db,names,mode){this.db=db;this.names=Array.isArray(names)?names:[names];this.mode=mode;this.error=null;this._pending=0;this._complete=false;this._oncomplete=null;this.onabort=null;this.onerror=null;setTimeout(()=>this._maybe(),0)}
    set oncomplete(fn){this._oncomplete=fn;if(this._complete&&fn)setTimeout(()=>fn({target:this}),0)} get oncomplete(){return this._oncomplete}
    _inc(){this._pending++} _dec(){this._pending--;this._maybe()} _maybe(){if(this._pending===0&&!this._complete){this._complete=true;if(this._oncomplete)setTimeout(()=>this._oncomplete({target:this}),0)}}
    objectStore(n){if(!this.names.includes(n)) throw new Error('store not in tx');return new ObjStore(this,this.db._stores.get(n));}
  }
  function asyncReq(tx,fn){const r=new Req();tx._inc();setTimeout(()=>{try{r.result=fn();r.onsuccess&&r.onsuccess({target:r})}catch(e){r.error=e;r.onerror&&r.onerror({target:r});tx.error=e;tx.onerror&&tx.onerror({target:tx})}finally{tx._dec()}},0);return r}
  class Index { constructor(tx,data,cfg){this.tx=tx;this.data=data;this.cfg=cfg} get(q){return asyncReq(this.tx,()=>{for(const v of this.data.records.values()){const k=keyFrom(v,this.cfg.keyPath);if(JSON.stringify(k)===JSON.stringify(q))return structuredClone(v)}return undefined})} getAll(q){return asyncReq(this.tx,()=>[...this.data.records.values()].filter(v=>{const k=keyFrom(v,this.cfg.keyPath);return JSON.stringify(k)===JSON.stringify(q)}).map(v=>structuredClone(v)))} }
  class ObjStore {
    constructor(tx,data){this.tx=tx;this.data=data}
    createIndex(name,keyPath,opts={}){this.data.indices.set(name,{keyPath,unique:!!opts.unique});return {}}
    index(name){const cfg=this.data.indices.get(name);if(!cfg)throw new Error('missing index '+name);return new Index(this.tx,this.data,cfg)}
    get(key){return asyncReq(this.tx,()=>{const v=this.data.records.get(JSON.stringify(key));return v===undefined?undefined:structuredClone(v)})}
    getAll(){return asyncReq(this.tx,()=>[...this.data.records.values()].map(v=>structuredClone(v)))}
    count(){return asyncReq(this.tx,()=>this.data.records.size)}
    put(v){return asyncReq(this.tx,()=>{const key=keyFrom(v,this.data.keyPath);if(key===undefined)throw new Error('missing key');this.data.records.set(JSON.stringify(key),structuredClone(v));return key})}
    add(v){return asyncReq(this.tx,()=>{const key=keyFrom(v,this.data.keyPath);const sk=JSON.stringify(key);if(this.data.records.has(sk))throw new Error('ConstraintError');for(const cfg of this.data.indices.values()){if(cfg.unique){const nk=JSON.stringify(keyFrom(v,cfg.keyPath));for(const old of this.data.records.values())if(JSON.stringify(keyFrom(old,cfg.keyPath))===nk)throw new Error('ConstraintError')}}this.data.records.set(sk,structuredClone(v));return key})}
    delete(key){return asyncReq(this.tx,()=>{this.data.records.delete(JSON.stringify(key));return undefined})}
    clear(){return asyncReq(this.tx,()=>{this.data.records.clear();return undefined})}
  }
  class DB { constructor(name,version){this.name=name;this.version=version;this._stores=new Map();this.onversionchange=null} createObjectStore(n,opts){const d=new StoreData(n,opts);this._stores.set(n,d);return new ObjStore(new Tx(this,[n],'versionchange'),d)} transaction(names,mode){return new Tx(this,names,mode)} close(){} }
  Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(name,version){const r=new Req();setTimeout(()=>{let db=databases.get(name);const fresh=!db;if(!db){db=new DB(name,version||1);databases.set(name,db)}r.result=db;if(fresh&&r.onupgradeneeded)r.onupgradeneeded({target:r,oldVersion:0,newVersion:version||1});setTimeout(()=>r.onsuccess&&r.onsuccess({target:r}),0)},0);return r}}});
})();
</script>
"""
HTML = BASE_HTML.replace("<head>", "<head>" + INDEXEDDB_SHIM, 1)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)



def wait_for_text(page, selector: str, expected: str, timeout_seconds: float = 5.0) -> None:
    wait_until(
        page,
        lambda: page.locator(selector).inner_text().strip() == expected,
        timeout=int(timeout_seconds * 1000),
        interval=40,
        message=f"Timed out waiting for {selector}={expected!r}",
    )


def set_range(page, selector: str, value: int) -> None:
    page.locator(selector).evaluate("(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}", value)


def check_all_checkpoints(page) -> None:
    for index in range(page.locator("[data-checkpoint]").count()):
        item = page.locator("[data-checkpoint]").nth(index)
        if not item.is_checked():
            item.check()




def restore_selected_backup(page, backup_path: str | Path, treatment: str = "discard", wait_ms: int = 900, download_page=None) -> None:
    timeout = max(20_000, wait_ms)
    result = select_backup_file(page, backup_path, timeout=timeout)
    if not result["preview"]:
        raise AssertionError(f"Restore preview did not open within {timeout}ms; result={result!r}")
    with TemporaryDirectory() as tmpdir:
        download_surface = download_page or page
        with download_surface.expect_download() as download_info:
            page.locator('[data-action="create-restore-safety"]').click()
        safety_path = Path(tmpdir) / download_info.value.suggested_filename
        download_info.value.save_as(str(safety_path))
        check(safety_path.exists() and safety_path.stat().st_size > 0, "Safety copy was not downloaded")
    if page.locator('input[name="restore-active-treatment"]').count():
        page.locator(f'input[name="restore-active-treatment"][value="{treatment}"]').check()
    page.locator("#restore-safety-saved").check()
    page.locator("#restore-replace-confirm").check()
    check(page.locator("#restore-final-button").is_enabled(), "Final restore remained disabled")
    page.evaluate("document.querySelector('#toast').textContent=''")
    page.locator("#restore-final-button").click()
    page.locator("#restore-dialog").wait_for(state="hidden")
    wait_until(
        page,
        lambda: "restored" in page.locator("#toast").inner_text().lower(),
        timeout=8000,
        interval=40,
        message="Restore did not complete canonical hydration",
    )

def open_page(browser, viewport=None, baseline: bool = False):
    page = browser.new_page(viewport=viewport or {"width": 1440, "height": 1000})
    errors: list[tuple[str, str]] = []
    page.on("console", lambda message: errors.append((message.type, message.text)) if message.type in ("error", "warning") else None)
    page.on("pageerror", lambda error: errors.append(("pageerror", str(error))))
    page.on("dialog", lambda dialog: dialog.accept())
    page.set_content(HTML, wait_until="load")
    wait_for_app_ready(page)
    if baseline:
        page.locator('[data-pane="settings"]').click()
        page.locator("#pane-settings").wait_for(state="visible")
        payload = decode_file(BASELINE_BACKUP)
        test_exam_date = (date.today() + timedelta(days=14)).isoformat()
        for profile in payload["profiles"]:
            profile["examDate"] = test_exam_date
        with TemporaryDirectory() as tmpdir:
            current_fixture = Path(tmpdir) / "browser-baseline-current.rdbackup"
            current_fixture.write_bytes(encode_payload(payload))
            restore_selected_backup(page, current_fixture)
        check("restored" in page.locator("#toast").inner_text().lower(), "Baseline fixture restore failed")
    return page, errors


def stored_scheduling_policy(page):
    return page.evaluate("""async () => await new Promise((resolve, reject) => {
      const opened = indexedDB.open('revision-director');
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const request = opened.result.transaction('settings', 'readonly').objectStore('settings').get('app');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result?.fsrsScheduling?.policy ?? null);
      };
    })""")


def review_unit(page, title: str) -> None:
    page.locator('[data-pane="library"]').click()
    page.locator("#pane-library").wait_for(state="visible")
    row = page.locator(".unit-row").filter(has_text=title)
    check(row.count() == 1, f"Knowledge Unit not found: {title}")
    row.locator('[data-action="review-unit"]').click()
    page.locator("#review-content").wait_for(state="visible")
    wait_until(
        page,
        lambda: title in page.locator("#review-content").inner_text(),
        timeout=5_000,
        interval=30,
        message=f"Review surface did not render selected unit: {title}",
    )


def rate_good(page) -> None:
    button = page.locator('[data-action="rate"][data-rating="3"]')
    button.click()
    button.wait_for(state="hidden", timeout=5_000)


def scenario_basic(browser) -> None:
    page, errors = open_page(browser)
    check(page.locator("#sb-units").inner_text() == "0", "Clean production database should start empty")
    check("Indian Forest Service" not in page.locator("body").inner_text(), "Sample profile leaked into production startup")
    for pane in ("review", "library", "study", "history", "settings", "today"):
        page.locator(f'[data-pane="{pane}"]') .click()
        page.locator(f"#pane-{pane}").wait_for(state="visible")
        check(page.locator(f"#pane-{pane}").evaluate('e=>e.classList.contains("on")'), f"Pane did not open: {pane}")

    page.locator('[data-pane="settings"]').click()
    page.locator("#settings-content").wait_for(state="visible")
    settings_text = page.locator("#settings-content").inner_text()
    check("Storage health" in settings_text and "IndexedDB" in settings_text, "Storage-health contract is not visible")
    check(page.locator('#settings-form [name="memorySchedulingPolicy"]').input_value() == "fixed-retention", "Clean installations must default to measured fixed-retention scheduling")
    check("Fixed · 90%" in settings_text, "Clean-install Settings must expose the measured fixed-90% default policy")
    page.locator("#new-profile-name").fill("IFoS Production Test")
    page.locator("#new-profile-date").fill("2027-11-01")
    page.locator('[data-action="add-profile"]').click()
    page.wait_for_function("() => document.querySelectorAll('[data-profile-editor]').length === 1")
    check(page.locator("[data-profile-editor]").count() == 1, "First production exam profile was not created")

    page.locator("#quick-add-unit").click()
    page.locator("#unit-dialog").wait_for(state="visible")
    form = page.locator("#unit-form")
    values = {
        "subject": "Public Administration", "section": "Administrative Thinkers", "topic": "Max Weber",
        "title": "Weberian bureaucracy core features", "scope": "Authority, hierarchy, rules, merit and impersonality.",
        "source": "Optional notes pages 10-15", "protocol": "Recall six features and two criticisms without notes.",
        "successCriteria": "Six features\nTwo criticisms", "workflowPrompt": "State the features and criticisms from memory.",
        "workflowCheckpoints": "Authority\nHierarchy\nRules\nMerit\nImpersonality\nCriticisms",
        "firstDueAt": "2026-07-25T08:00",
    }
    for name, value in values.items():
        form.locator(f'[name="{name}"]') .fill(value)
    form.locator('button[type="submit"]').click()
    wait_for_text(page, "#sb-units", "1")
    check(page.locator("#sb-units").inner_text() == "1", "Knowledge Unit creation failed")

    page.locator("#quick-log-study").click()
    study = page.locator("#study-form")
    study.locator('[name="area"]').fill("Public Administration")
    study.locator('[name="task"]').fill("Weber")
    study.locator('[name="measure"]').fill("Pages 10-15")
    study.locator('[name="durationMinutes"]').fill("45")
    study.locator('button[type="submit"]').click()
    page.locator("#study-dialog").wait_for(state="hidden")
    page.locator('[data-pane="study"]').click()
    wait_until(page, lambda: "Weber" in page.locator("#study-content").inner_text(), timeout=5000, interval=40, message="Study Event not displayed")

    page.set_viewport_size({"width": 390, "height": 844})
    wait_for_layout(page)
    check(not page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), "Horizontal mobile overflow")
    for pane in ("today", "review", "library", "study", "history", "settings"):
        check(page.locator(f'[data-pane="{pane}"]') .is_visible(), f"Mobile navigation hidden: {pane}")
    check(not errors, f"Browser errors: {errors}")
    page.close()


def scenario_backups(browser) -> None:
    page, errors = open_page(browser, baseline=True)
    with TemporaryDirectory() as tmp:
        backup_path = str(Path(tmp) / "backup.rdbackup")
        hostile_path = str(Path(tmp) / "hostile.rdbackup")
        page.locator('[data-pane="settings"]').click()
        with page.expect_download() as download_info:
            page.locator('[data-action="export-backup"]').click()
        download_info.value.save_as(backup_path)
        payload = decode_file(Path(backup_path))
        check(payload["format"] == "revision-director-backup" and payload["schemaVersion"] == 2, "Production backup identity missing")
        check(all(item.get("schemaVersion") == 1 for key in ("profiles", "nodes", "units", "studyEvents", "obligations", "evidenceEvents", "chunks", "dailyPlans") for item in payload[key]), "Backup contains an unversioned document")
        check(page.locator('[data-action="reset-data"]').count() == 0, "Prototype reset remains in production UI")

        page.locator("#new-profile-name").fill("Temporary profile")
        page.locator("#new-profile-date").fill("2028-01-01")
        page.locator('[data-action="add-profile"]').click()
        page.wait_for_function("() => document.querySelectorAll('[data-profile-editor]').length === 3")
        check(page.locator("[data-profile-editor]").count() == 3, "Mutation before restore failed")

        restore_selected_backup(page, backup_path)
        check("restored" in page.locator("#toast").inner_text().lower(), "Backup restore not reported")
        page.locator('[data-pane="settings"]').click(); page.locator("#pane-settings").wait_for(state="visible")
        check(page.locator("[data-profile-editor]").count() == 2, "Backup restore did not replace temporary data")

        Path(hostile_path).write_bytes(encode_payload({**payload, 'settings':{**payload['settings'], 'activeProfileId':'missing-profile'}}))
        result = select_backup_file(page, hostile_path, timeout=5000)
        check(
            bool(result["message"]) and result["error"] and not result["preview"],
            f"Hostile backup did not fail through the rejection UI contract · result={result!r}",
        )
    check(not errors, f"Browser errors: {errors}")
    page.close()


def scenario_workflows(browser) -> None:
    page, errors = open_page(browser, baseline=True)
    review_unit(page, "Drainage patterns and structural control")
    check("RECONSTRUCTION" in page.locator("#review-content").inner_text(), "Reconstruction did not start")
    page.locator("#attempt-text").fill("Dendritic uniform rocks; trellis folded strata; rectangular joints; radial domes; annular rings; parallel slopes.")
    page.locator('[data-action="reveal"]').click(); page.locator("#comparison-attempt-text").wait_for(state="visible")
    check("Dendritic uniform rocks" in page.locator("#comparison-attempt-text").inner_text(), "Reconstruction attempt lost")
    check_all_checkpoints(page); set_range(page, "#structural-accuracy", 4); set_range(page, "#relationship-accuracy", 4); rate_good(page)

    check("DIAGRAM PRACTICE" in page.locator("#review-content").inner_text(), "Diagram did not follow")
    canvas = page.locator("#diagram-canvas"); box = canvas.bounding_box(); check(box is not None, "Diagram canvas missing")
    page.mouse.move(box["x"] + 20, box["y"] + 30); page.mouse.down(); page.mouse.move(box["x"] + 120, box["y"] + 100, steps=6); page.mouse.up()
    page.locator('[data-action="reveal"]').click(); page.locator("#comparison-diagram-canvas").wait_for(state="visible")
    check(page.locator("#comparison-diagram-canvas").is_visible(), "Diagram comparison missing")
    check_all_checkpoints(page)
    for selector in ("#diagram-labels", "#diagram-spatial", "#diagram-process"): set_range(page, selector, 4)
    rate_good(page)

    check("ANSWER WRITING" in page.locator("#review-content").inner_text(), "Answer writing did not follow")
    page.locator("#attempt-completed").check(); page.locator('[data-action="reveal"]').click(); page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    for selector in ("#answer-demand", "#answer-structure-score", "#answer-content", "#answer-examples", "#answer-conclusion"): set_range(page, selector, 4)
    page.locator("#answer-word-count").fill("148")
    check("Within the 10-minute limit" in page.locator("#answer-time-status").inner_text(), "Automatic timing missing")
    rate_good(page)

    review_unit(page, "Staphylococcus aureus")
    check("QUESTIONS / APPLICATION" in page.locator("#review-content").inner_text(), "Questions did not start")
    page.locator("#attempt-text").fill("Attempted; toxin distinctions uncertain.")
    page.locator("#attempt-completed").check(); page.locator('[data-action="reveal"]').click(); page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    page.locator("#questions-attempted").fill("10"); page.locator("#questions-correct").fill("1"); page.locator("#questions-partial").fill("0")
    page.locator("#questions-error-summary").fill("Q2 toxin; Q3 resistance.")
    page.locator("#correction-note").fill("Relearn toxin syndromes and resistance logic.")
    page.locator("#error-application-failure").check()
    page.locator('[data-action="rate"][data-rating="1"]').click()
    wait_until(page, lambda: "RECALL" in page.locator("#review-content").inner_text(), timeout=5000, interval=40, message="Recall did not follow")
    page.locator("#attempt-completed").check(); page.locator('[data-action="reveal"]').click(); page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    check_all_checkpoints(page); rate_good(page)

    relearn = page.locator(".planner-row").filter(has_text="Relearn")
    wait_until(
        page,
        lambda: relearn.count() >= 1,
        timeout=5_000,
        interval=40,
        message="Relearning obligation was not created",
    )
    check(relearn.count() >= 1, "Relearning obligation was not created")
    relearn.first.locator('[data-action="review-one"]').click()
    wait_until(page, lambda: "WHY THIS RELEARNING EXISTS" in page.locator("#review-content").inner_text(), timeout=5000, interval=40, message="Relearning review did not open")
    text = page.locator("#review-content").inner_text()
    check("WHY THIS RELEARNING EXISTS" in text and "Relearn toxin syndromes" in text, "Relearning trigger context missing")
    page.locator("#relearn-repair-action").fill("Rebuilt toxin and resistance distinctions from the source.")
    page.locator("#relearn-repair-completed").check(); page.locator('[data-action="begin-verification"]').click()
    page.locator("#relearn-verification-text").fill("TSS is superantigen-mediated; MRSA uses altered PBP; treatment follows susceptibility.")
    page.locator("#relearn-source-closed").check(); page.locator('[data-action="check-verification"]').click(); page.locator('[data-action="rate"][data-rating="3"]').wait_for(state="visible")
    check_all_checkpoints(page); rate_good(page)

    page.locator('[data-pane="history"]').click(); page.locator("#pane-history").wait_for(state="visible")
    expected_history = ("reconstruction", "diagram practice", "answer writing", "recall", "questions / application", "relearning")
    wait_until(
        page,
        lambda: all(label in page.locator("#history-content").inner_text().lower() for label in expected_history),
        timeout=8_000,
        interval=50,
        message="History did not project the complete workflow chain",
    )
    history = page.locator("#history-content").inner_text().lower()
    for label in expected_history:
        check(label in history, f"History missing workflow: {label}")
    check(not errors, f"Browser errors: {errors}")
    page.close()


def scenario_keyboard_accessibility(browser) -> None:
    page, errors = open_page(browser, {"width": 1280, "height": 900}, baseline=True)
    for index in range(page.locator("button").count()):
        button = page.locator("button").nth(index)
        name = button.get_attribute("aria-label") or button.inner_text().strip() or button.get_attribute("title")
        check(bool(name), f"Unnamed button: {index}")
    page.locator('[data-pane="today"]').click()
    application_row = page.locator(".planner-row").filter(has_text="Questions / application")
    check(application_row.count() >= 1, "Application workflow missing from accessibility fixture")
    application_row.first.locator('[data-action="review-one"]').click(); page.locator("#attempt-text").wait_for(state="visible")
    page.locator("#attempt-text").fill("Reasoned answers."); page.locator("#attempt-completed").check()
    page.locator(".review-card").click(position={"x": 5, "y": 5}); page.keyboard.press("Space"); page.locator('[data-review-phase="compare"]').wait_for(state="visible")
    check(page.locator('[data-review-phase="compare"]').is_visible(), "Keyboard reveal failed")
    page.locator("#questions-attempted").fill("10"); page.locator("#questions-correct").fill("8"); page.locator("#questions-partial").fill("1")
    page.locator(".review-card").click(position={"x": 5, "y": 5}); page.keyboard.press("3"); page.locator("#pane-today").wait_for(state="visible")
    check(page.locator("#pane-today").evaluate('e=>e.classList.contains("on")'), "Keyboard rating failed")
    check(not errors, f"Browser errors: {errors}")
    page.close()


def scenario_bridge(browser) -> None:
    page, errors = open_page(browser, baseline=True)
    check(page.evaluate("RevisionDirector.version") == "va7.1-pass-f1", "Public API version mismatch")
    invalid = [
        {"area":"A","task":"T","measure":"M","durationMinutes":10,"activityMode":"evil"},
        {"area":"A","task":"T","measure":"M","durationMinutes":10,"understanding":99},
        {"area":"A","task":"T","measure":"M","durationMinutes":10,"occurredAt":"not-a-date"},
    ]
    for payload in invalid:
        result = page.evaluate('async p=>{try{await RevisionDirector.intake.importStudyEvent(p);return "accepted"}catch(e){return String(e.message||e)}}', payload)
        check(result != "accepted", f"Invalid bridge payload accepted: {payload}")
    result = page.evaluate('async()=>RevisionDirector.intake.importStudyEvent({area:"Geology",task:"Bridge event",measure:"1 topic",durationMinutes:25,activityMode:"review",understanding:3})')
    check(bool(result.get("id")), "Valid bridge Study Event failed")
    page.locator('[data-pane="settings"]').click(); page.locator("#pane-settings").wait_for(state="visible")
    profile_ids = page.locator("[data-profile-editor]").evaluate_all(
        "rows => rows.map(row => row.getAttribute('data-profile-editor')).filter(Boolean)"
    )
    check(len(profile_ids) == 2, f"Unexpected bridge profile set: {profile_ids}")
    for profile_id in profile_ids:
        row = page.locator(f'[data-profile-editor="{profile_id}"]')
        check(row.count() == 1, f"Profile editor is missing durable identity: {profile_id}")
        row.locator("[data-profile-status]").select_option("suspended")
        page.evaluate("document.querySelector('#toast').textContent=''")
        row.locator('[data-action="save-profile"]').click()
        wait_until(
            page,
            lambda: "exam horizon updated" in page.locator("#toast").inner_text().lower(),
            timeout=8_000,
            interval=40,
            message=f"Profile save did not complete: {profile_id}",
        )
        wait_until(
            page,
            lambda profile_id=profile_id: next(
                (profile["status"] for profile in page.evaluate("async()=>await RevisionDirector.records.listProfiles()") if profile["id"] == profile_id),
                None,
            ) == "suspended",
            timeout=5_000,
            interval=40,
            message=f"Public profile summary did not reflect suspension: {profile_id}",
        )
    profiles = page.evaluate("async()=>await RevisionDirector.records.listProfiles()")
    check(all(profile["status"] == "suspended" for profile in profiles), f"Public profile summary did not preserve both suspensions: {profiles}")
    wait_until(page, lambda: page.evaluate("async()=> (await RevisionDirector.records.getDueSummary()).dueCount") == 0, timeout=5000, interval=40, message="Paused profiles remained due")
    summary = page.evaluate("RevisionDirector.records.getDueSummary()")
    check(summary["dueCount"] == 0, f"Paused profiles remained in bridge due summary: {summary}")
    check(not errors, f"Browser errors: {errors}")
    page.close()



def scenario_cost_adr_settings(browser) -> None:
    page, errors = open_page(browser, {"width": 1365, "height": 950}, baseline=True)
    open_rendered_pane(page, "settings")
    settings = page.locator('#settings-form')
    policy = settings.locator('[name="memorySchedulingPolicy"]')
    check(policy.count() == 1, "Memory scheduling policy selector missing")
    check(policy.input_value() == "fixed-retention", "Restored fixed-retention settings must be preserved instead of being silently migrated to the new default")

    policy.select_option("cost-adr")
    page.evaluate("document.querySelector('#toast').textContent=''")
    settings.locator('button[type="submit"]').click()
    wait_until(page, lambda: page.locator("#toast").inner_text().strip() == "Settings saved." or page.locator("#toast").evaluate("e=>e.classList.contains('error')"), timeout=8000, interval=40, message="Cost-ADR settings submit did not finish")
    check(page.locator("#toast").inner_text().strip() == "Settings saved." and not page.locator("#toast").evaluate("e=>e.classList.contains('error')"), "Cost-ADR settings submit failed: " + page.locator("#toast").inner_text())
    check(not page.locator("#fatal-error").is_visible(), "Cost-ADR activation caused a fatal application state")
    check(stored_scheduling_policy(page)["kind"] == "cost-adr", "Cost-ADR save completed but canonical IndexedDB policy was not updated")

    with TemporaryDirectory() as tmp:
        backup_path = str(Path(tmp) / "cost-adr-settings.rdbackup")
        with page.expect_download() as download_info:
            page.locator('[data-action="export-backup"]').click()
        download_info.value.save_as(backup_path)
        payload = decode_file(Path(backup_path))
        saved_policy = payload["settings"]["fsrsScheduling"]["policy"]
        check(saved_policy["kind"] == "cost-adr", "Cost-ADR policy was not persisted in backup state")
        check(saved_policy["goalCostWeight"] == 1024, "Persisted Cost-ADR goal cost weight is not the bounded preset")
        check(len(saved_policy["costAdrPolicy"]["coefficients"]) == 15, "Persisted Cost-ADR policy lost upstream coefficient provenance")

    settings = page.locator('#settings-form')
    settings.locator('[name="memorySchedulingPolicy"]').select_option("fixed-retention")
    settings.locator('[name="desiredRetention"]').fill("0.90")
    page.evaluate("document.querySelector('#toast').textContent=''")
    settings.locator('button[type="submit"]').click()
    wait_until(page, lambda: page.locator("#toast").inner_text().strip() == "Settings saved." or page.locator("#toast").evaluate("e=>e.classList.contains('error')"), timeout=8000, interval=40, message="Fixed-retention settings submit did not finish")
    check(page.locator("#toast").inner_text().strip() == "Settings saved." and not page.locator("#toast").evaluate("e=>e.classList.contains('error')"), "Fixed-retention settings submit failed: " + page.locator("#toast").inner_text())
    check(stored_scheduling_policy(page)["kind"] == "fixed-retention", "Fixed-retention save completed but canonical IndexedDB policy was not updated")
    with TemporaryDirectory() as tmp:
        backup_path = str(Path(tmp) / "fixed-retention-settings.rdbackup")
        with page.expect_download() as download_info:
            page.locator('[data-action="export-backup"]').click()
        download_info.value.save_as(backup_path)
        payload = decode_file(Path(backup_path))
        saved_policy = payload["settings"]["fsrsScheduling"]["policy"]
        check(saved_policy["kind"] == "fixed-retention", f"Fixed-retention policy did not persist: {saved_policy}")
        check(abs(float(saved_policy["desiredRetention"]) - 0.90) < 1e-12, "Fixed-retention target did not persist at 90%")
    check(not page.locator("#fatal-error").is_visible(), "Return from Cost-ADR caused a fatal application state")
    check(not errors, f"Cost-ADR Settings browser errors: {errors}")
    page.close()


def scenario_pass_d(browser) -> None:
    page, errors = open_page(browser, {"width": 1365, "height": 1000}, baseline=True)
    page.locator('[data-pane="settings"]').click(); page.locator("#pane-settings").wait_for(state="visible")
    settings = page.locator('#settings-form')
    settings.locator('[name="dailyCapacityMinutes"]').fill('30')
    settings.locator('button[type="submit"]').click()

    page.locator('#quick-add-unit').click(); page.locator("#unit-dialog").wait_for(state="visible")
    form = page.locator('#unit-form')
    due = page.evaluate("new Date(Date.now()-3600000).toISOString().slice(0,16)")
    values = {
        'subject': 'Geology', 'section': 'Geomorphology', 'topic': 'Drainage',
        'title': 'Oversized drainage synthesis', 'scope': 'Pages 101-112',
        'source': 'Geology notes pages 101-112', 'expectedMinutes': '90',
        'workflowPrompt': 'Reconstruct the complete drainage framework from memory.',
        'workflowCheckpoints': 'Definitions\nControls\nPatterns\nExamples',
        'protocol': 'Reconstruct each bounded section, then perform one final synthesis.',
        'successCriteria': 'Complete structure, relationships and examples.',
        'firstDueAt': due,
    }
    for name, value in values.items():
        form.locator(f'[name="{name}"]').fill(value)
    form.locator('[name="obligationType"]').select_option('concept-reconstruction')
    form.locator('[name="workflowKind"]').select_option('reconstruction')
    form.locator('button[type="submit"]').click(); page.locator("#unit-dialog").wait_for(state="hidden")
    page.locator('[data-pane="today"]').click(); page.locator("#pane-today").wait_for(state="visible")

    chunk_row = page.locator('.planner-row').filter(has_text='Oversized drainage synthesis').first
    check(chunk_row.count() == 1, 'Oversized obligation was not converted into a daily chunk')
    check(chunk_row.locator('[data-action="review-chunk"]').count() == 1, 'Chunk action missing')
    chunk_row.locator('details.planner-details').evaluate('e=>e.open=true')
    check('weekly balance' in chunk_row.inner_text().lower(), 'Weekly-balance factor is not exposed in the planner')

    chunk_row.locator('[data-action="review-chunk"]').click(); page.locator("#chunk-note").wait_for(state="visible")
    check('SCHEDULING SAFEGUARD' in page.locator('#review-content').inner_text().upper(), 'Chunk scheduling safeguard missing')
    page.locator('#chunk-note').fill('Completed the first bounded page range.')
    page.locator('[data-action="complete-chunk"]').click()
    wait_until(page, lambda: page.locator('.planner-row').filter(has_text='Oversized drainage synthesis').first.locator('[data-action="review-chunk"]').count() == 1, timeout=5000, interval=40, message="Next bounded chunk did not appear")
    next_chunk = page.locator('.planner-row').filter(has_text='Oversized drainage synthesis').first
    check(next_chunk.count() == 1 and next_chunk.locator('[data-action="review-chunk"]').count() == 1, 'Completing one chunk did not expose the next bounded chunk')

    page.locator('[data-action="regenerate-plan"]').click()
    page.locator('[data-pane="history"]').click(); page.locator("#pane-history").wait_for(state="visible")
    wait_until(page, lambda: "persisted daily plans" in page.locator("#history-content").inner_text().lower(), timeout=5000, interval=40, message="Persisted daily-plan history missing")
    history = page.locator('#history-content').inner_text()
    check('persisted daily plans' in history.lower(), 'Persisted daily-plan history missing')
    check('completed' in history.lower() and 'version' in history.lower(), 'Plan outcomes or amendments were not preserved')
    check(not errors, f'Pass D browser errors: {errors}')
    page.close()



def scenario_plan_execution_states(browser) -> None:
    page, errors = open_page(browser, {"width": 1365, "height": 950}, baseline=True)
    page.locator('[data-pane="today"]').click(); page.locator("#pane-today").wait_for(state="visible")
    planned_count = page.locator('#today-content .planner-row.selected, #today-content .planner-row.required-overrun').count()
    check(planned_count >= 2, 'Execution-state scenario requires at least two planned items')
    page.locator('[data-action="start-due"]').click(); page.locator("#review-content").wait_for(state="visible")
    with TemporaryDirectory() as tmp:
        backup_path = str(Path(tmp) / 'execution-state.rdbackup')
        page.locator('[data-pane="settings"]').click(); page.locator("#pane-settings").wait_for(state="visible")
        with page.expect_download() as download_info:
            page.locator('[data-action="export-backup"]').click()
        download_info.value.save_as(backup_path)
        payload = decode_file(Path(backup_path))
        plan = sorted(payload['dailyPlans'], key=lambda item: item['studyDayKey'])[-1]
        statuses = [outcome['status'] for outcome in plan['outcomes']]
        check(statuses.count('started') == 1, f'Only the current review target should be started, got {statuses}')
        check(statuses.count('planned') >= 1, f'Future review targets should remain planned, got {statuses}')
    check(not errors, f'Execution-state browser errors: {errors}')
    page.close()

def main() -> None:
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        scenario_basic(browser)
        scenario_backups(browser)
        scenario_workflows(browser)
        scenario_keyboard_accessibility(browser)
        scenario_bridge(browser)
        scenario_cost_adr_settings(browser)
        scenario_pass_d(browser)
        scenario_plan_execution_states(browser)
        browser.close()
    print("PASS 8 Chromium browser QA scenarios")


if __name__ == "__main__":
    main()
