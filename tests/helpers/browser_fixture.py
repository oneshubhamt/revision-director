from __future__ import annotations
from pathlib import Path
from datetime import date, timedelta
from tempfile import TemporaryDirectory
from backup_fixture_codec import baseline_backup_path, decode_file, encode_payload
from helpers.browser_harness import open_rendered_pane, select_backup_file, wait_for_app_ready, wait_for_layout, wait_for_toast_outcome, wait_until

ROOT = Path(__file__).resolve().parents[2]
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
    expected_profile_ids = sorted(item["id"] for item in decode_file(Path(backup_path))["profiles"])
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
    wait_for_toast_outcome(
        page,
        expect_error=False,
        timeout=8_000,
        message="Restore did not report a successful terminal outcome",
    )
    wait_until(
        page,
        lambda: sorted(profile["id"] for profile in page.evaluate("async()=>await RevisionDirector.records.listProfiles()")) == expected_profile_ids,
        timeout=8_000,
        interval=40,
        message="Restore completion did not hydrate the canonical profile set",
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
        check(
            sorted(profile["id"] for profile in page.evaluate("async()=>await RevisionDirector.records.listProfiles()"))
            == sorted(profile["id"] for profile in payload["profiles"]),
            "Baseline fixture restore did not hydrate the expected profiles",
        )
    return page, errors


def stored_record(page, store: str, key):
    return page.evaluate("""([store,key]) => new Promise((resolve, reject) => {
      const opened = indexedDB.open('revision-director');
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const request = opened.result.transaction(store, 'readonly').objectStore(store).get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result ?? null);
      };
    })""", [store, key])


def stored_all(page, store: str):
    return page.evaluate("""store => new Promise((resolve, reject) => {
      const opened = indexedDB.open('revision-director');
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const request = opened.result.transaction(store, 'readonly').objectStore(store).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      };
    })""", store)


def stored_scheduling_policy(page):
    settings = stored_record(page, "settings", "app")
    return settings.get("fsrsScheduling", {}).get("policy") if settings else None


def active_workflow_kind(page):
    session = stored_record(page, "activeRetrieval", "current")
    if not session or session.get("status") != "active":
        return None
    target = session.get("activeTargetId", "")
    if target.startswith("chunk:"):
        return "chunk"
    obligation = stored_record(page, "obligations", target)
    return obligation.get("workflow", {}).get("kind") if obligation else None


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
