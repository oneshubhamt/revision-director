from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import shutil
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/browser-baseline.rdbackup"
BASE_HTML = (ROOT / "index.html").read_text()
checks = 0

PERSISTENT_BROWSER_SHIM = r"""
<script>
(() => {
  const HOST = parent.__RD_B1_QA_STATE__;
  if (!HOST.local) HOST.local = {};
  if (!HOST.databases) HOST.databases = {};

  class FakeStorage {
    get length(){ return Object.keys(HOST.local).length; }
    key(index){ return Object.keys(HOST.local)[index] ?? null; }
    getItem(key){ key=String(key); return Object.prototype.hasOwnProperty.call(HOST.local,key) ? HOST.local[key] : null; }
    setItem(key,value){ HOST.local[String(key)] = String(value); }
    removeItem(key){ delete HOST.local[String(key)]; }
    clear(){ for (const key of Object.keys(HOST.local)) delete HOST.local[key]; }
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: new FakeStorage() });
  Object.defineProperty(navigator, 'storage', { configurable: true, value: {
    persisted: async () => true,
    persist: async () => true,
    estimate: async () => ({ usage: JSON.stringify(HOST).length, quota: 50_000_000 }),
  }});

  const clone = (value) => value === undefined ? undefined : structuredClone(value);
  const keyFrom = (obj,path) => Array.isArray(path) ? path.map(k => obj[k]) : obj[path];
  const sameKey = (a,b) => JSON.stringify(a) === JSON.stringify(b);

  class Req {
    constructor(){ this.result=undefined; this.error=null; this.onsuccess=null; this.onerror=null; this.onupgradeneeded=null; }
  }
  class StoreData {
    constructor(name, opts={}){ this.name=name; this.keyPath=opts.keyPath ?? null; this.records=new Map(); this.indices=new Map(); }
  }
  class Tx {
    constructor(db,names,mode){
      this.db=db; this.names=Array.isArray(names)?names:[names]; this.mode=mode; this.error=null;
      this._pending=0; this._complete=false; this._aborted=false; this._oncomplete=null; this.onabort=null; this.onerror=null;
      setTimeout(() => this._maybe(), 0);
    }
    set oncomplete(fn){ this._oncomplete=fn; if(this._complete && !this._aborted && fn) setTimeout(()=>fn({target:this}),0); }
    get oncomplete(){ return this._oncomplete; }
    _inc(){ if(this._aborted) throw new Error('TransactionInactiveError'); this._pending++; }
    _dec(){ if(this._pending>0) this._pending--; this._maybe(); }
    _maybe(){
      if(this._pending===0 && !this._complete && !this._aborted){
        this._complete=true; this.db._persist();
        if(this._oncomplete) setTimeout(()=>this._oncomplete({target:this}),0);
      }
    }
    abort(){
      if(this._complete || this._aborted) return;
      this._aborted=true; this._complete=true; this.error=new DOMException('Transaction aborted','AbortError');
      if(this.onabort) setTimeout(()=>this.onabort({target:this}),0);
    }
    objectStore(name){
      if(!this.names.includes(name)) throw new Error('Store not in transaction: '+name);
      const data=this.db._stores.get(name); if(!data) throw new Error('Missing object store: '+name);
      return new ObjStore(this,data);
    }
  }
  function asyncReq(tx, fn){
    const request=new Req(); tx._inc();
    setTimeout(()=>{
      if(tx._aborted){ tx._dec(); return; }
      try { request.result=fn(); if(request.onsuccess) request.onsuccess({target:request}); }
      catch(error){ request.error=error; tx.error=error; if(request.onerror) request.onerror({target:request}); if(tx.onerror) tx.onerror({target:tx}); }
      finally { tx._dec(); }
    },0);
    return request;
  }
  class Index {
    constructor(tx,data,cfg){ this.tx=tx; this.data=data; this.cfg=cfg; }
    get(query){ return asyncReq(this.tx,()=>{ for(const value of this.data.records.values()) if(sameKey(keyFrom(value,this.cfg.keyPath),query)) return clone(value); return undefined; }); }
    getAll(query){ return asyncReq(this.tx,()=>[...this.data.records.values()].filter(value=>query===undefined || sameKey(keyFrom(value,this.cfg.keyPath),query)).map(clone)); }
  }
  class ObjStore {
    constructor(tx,data){ this.tx=tx; this.data=data; }
    createIndex(name,keyPath,opts={}){ this.data.indices.set(name,{keyPath:clone(keyPath),unique:!!opts.unique}); this.tx.db._persist(); return {}; }
    index(name){ const cfg=this.data.indices.get(name); if(!cfg) throw new Error('Missing index: '+name); return new Index(this.tx,this.data,cfg); }
    get(key){ return asyncReq(this.tx,()=>{ const value=this.data.records.get(JSON.stringify(key)); return clone(value); }); }
    getAll(){ return asyncReq(this.tx,()=>[...this.data.records.values()].map(clone)); }
    put(value){ return asyncReq(this.tx,()=>{ const key=keyFrom(value,this.data.keyPath); if(key===undefined) throw new Error('Missing key'); this.data.records.set(JSON.stringify(key),clone(value)); return clone(key); }); }
    add(value){ return asyncReq(this.tx,()=>{
      const key=keyFrom(value,this.data.keyPath); const encoded=JSON.stringify(key);
      if(this.data.records.has(encoded)) throw new DOMException('Duplicate key','ConstraintError');
      for(const cfg of this.data.indices.values()) if(cfg.unique){
        const candidate=keyFrom(value,cfg.keyPath);
        for(const old of this.data.records.values()) if(sameKey(keyFrom(old,cfg.keyPath),candidate)) throw new DOMException('Duplicate index','ConstraintError');
      }
      this.data.records.set(encoded,clone(value)); return clone(key);
    }); }
    delete(key){ return asyncReq(this.tx,()=>{ this.data.records.delete(JSON.stringify(key)); }); }
    clear(){ return asyncReq(this.tx,()=>{ this.data.records.clear(); }); }
  }
  class DB {
    constructor(name,version){ this.name=name; this.version=version; this._stores=new Map(); this.onversionchange=null; }
    static restore(name,raw){
      const db=new DB(name,raw.version);
      for(const [storeName,stored] of Object.entries(raw.stores ?? {})){
        const data=new StoreData(storeName,{keyPath:stored.keyPath});
        data.indices=new Map(Object.entries(stored.indices ?? {}).map(([key,value])=>[key,clone(value)]));
        data.records=new Map((stored.records ?? []).map(([key,value])=>[key,clone(value)]));
        db._stores.set(storeName,data);
      }
      return db;
    }
    _persist(){
      const stores={};
      for(const [name,data] of this._stores){
        stores[name]={
          keyPath:clone(data.keyPath),
          indices:Object.fromEntries([...data.indices].map(([key,value])=>[key,clone(value)])),
          records:[...data.records].map(([key,value])=>[key,clone(value)]),
        };
      }
      HOST.databases[this.name]={version:this.version,stores};
    }
    get objectStoreNames(){
      const names=[...this._stores.keys()];
      return { length:names.length, contains:(name)=>names.includes(name), item:(index)=>names[index] ?? null, [Symbol.iterator]:function*(){ yield* names; } };
    }
    createObjectStore(name,opts={}){
      if(this._stores.has(name)) throw new DOMException('Store exists','ConstraintError');
      const data=new StoreData(name,opts); this._stores.set(name,data); this._persist();
      return new ObjStore(new Tx(this,[name],'versionchange'),data);
    }
    transaction(names,mode='readonly'){ return new Tx(this,names,mode); }
    close(){}
  }

  Object.defineProperty(window,'indexedDB',{configurable:true,value:{
    open(name,version){
      const request=new Req();
      setTimeout(()=>{
        try{
          const raw=HOST.databases[name];
          const oldVersion=raw?.version ?? 0;
          const targetVersion=version ?? (oldVersion || 1);
          if(oldVersion && targetVersion < oldVersion) throw new DOMException('Lower version','VersionError');
          const db=raw ? DB.restore(name,raw) : new DB(name,targetVersion);
          request.result=db;
          if(targetVersion > oldVersion){
            db.version=targetVersion;
            if(request.onupgradeneeded) request.onupgradeneeded({target:request,oldVersion,newVersion:targetVersion});
            db._persist();
          }
          setTimeout(()=>request.onsuccess && request.onsuccess({target:request}),0);
        } catch(error){ request.error=error; if(request.onerror) request.onerror({target:request}); }
      },0);
      return request;
    },
    deleteDatabase(name){ const request=new Req(); setTimeout(()=>{ delete HOST.databases[name]; if(request.onsuccess) request.onsuccess({target:request}); },0); return request; }
  }});
})();
</script>
"""
HTML = BASE_HTML.replace("<head>", "<head>" + PERSISTENT_BROWSER_SHIM, 1)


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def wait_until(frame, predicate, timeout=8000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if predicate():
            return
        frame.wait_for_timeout(80)
    raise AssertionError("Timed out waiting for condition")


def idb_get(frame, store: str, key: str):
    return frame.evaluate("""async ([store,key]) => await new Promise((resolve,reject) => {
      const open=indexedDB.open('revision-director',2);
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const tx=open.result.transaction(store,'readonly');
        const request=tx.objectStore(store).get(key);
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>resolve(request.result || null);
      };
    })""", [store,key])


def idb_all(frame, store: str):
    return frame.evaluate("""async (store) => await new Promise((resolve,reject) => {
      const open=indexedDB.open('revision-director',2);
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const tx=open.result.transaction(store,'readonly');
        const request=tx.objectStore(store).getAll();
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>resolve(request.result || []);
      };
    })""", store)



def state_all(page, store: str):
    return page.evaluate("""(store) => {
      const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
      const records=raw?.stores?.[store]?.records ?? [];
      return records.map(([,value]) => structuredClone(value));
    }""", store)


def state_get(page, store: str, key: str):
    return page.evaluate("""([store,key]) => {
      const raw=window.__RD_B1_QA_STATE__.databases['revision-director'];
      const records=raw?.stores?.[store]?.records ?? [];
      const found=records.find(([encoded]) => encoded === JSON.stringify(key));
      return found ? structuredClone(found[1]) : null;
    }""", [store,key])

def boot_frame(page):
    page.evaluate("""() => {
      const old=document.querySelector('#app'); if(old) old.remove();
      const frame=document.createElement('iframe'); frame.id='app'; frame.name='revision-app';
      frame.style.width='1280px'; frame.style.height='900px'; document.body.appendChild(frame);
    }""")
    frame = page.frame(name="revision-app")
    if frame is None:
        raise AssertionError("QA app frame was not created")
    frame.set_content(HTML, wait_until="load")
    frame.wait_for_timeout(1000)
    check(not frame.locator("#fatal-error").is_visible(), "Fatal startup error")
    return frame



def restore_fixture_d2(page, frame, fixture) -> None:
    frame.locator("#import-backup").set_input_files([])
    frame.locator("#import-backup").set_input_files(str(fixture))
    frame.wait_for_timeout(900)
    if not frame.locator("#restore-dialog").is_visible():
        raise AssertionError("Restore preview did not open")
    with TemporaryDirectory() as tmpdir:
        with page.expect_download() as info:
            frame.locator('[data-action="create-restore-safety"]').click()
        path=Path(tmpdir)/info.value.suggested_filename
        info.value.save_as(str(path))
        if not path.exists() or path.stat().st_size <= 0:
            raise AssertionError("Safety copy was not downloaded")
    if frame.locator('input[name="restore-active-treatment"]').count():
        frame.locator('input[name="restore-active-treatment"][value="discard"]').check()
    frame.locator("#restore-safety-saved").check()
    frame.locator("#restore-replace-confirm").check()
    frame.locator("#restore-final-button").click()
    frame.wait_for_timeout(1100)

def main() -> None:
    chromium = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=chromium if chromium else None)
        context = browser.new_context(viewport={"width": 1320, "height": 940}, accept_downloads=True)
        page = context.new_page()
        browser_errors: list[str] = []
        page.on("pageerror", lambda error: browser_errors.append(str(error)))
        page.on("console", lambda msg: browser_errors.append(msg.text) if msg.type == "error" else None)
        page.on("dialog", lambda dialog: dialog.accept())
        page.set_content("<body><script>window.__RD_B1_QA_STATE__={local:{},databases:{}}</script></body>")

        frame = boot_frame(page)
        frame.locator('[data-pane="settings"]').click()
        restore_fixture_d2(page, frame, FIXTURE)
        check("restored" in frame.locator("#toast").inner_text().lower(), "Fixture import failed")

        frame.locator('[data-pane="library"]').click()
        row = frame.locator(".unit-row").filter(has_text="Staphylococcus aureus — recognition and clinical reasoning")
        check(row.count() == 1, "Target unit missing")
        row.locator('[data-action="review-unit"]').click()
        frame.wait_for_timeout(500)
        check(frame.locator("#attempt-text").count() == 1, "Recall workflow did not start")
        frame.locator("#attempt-text").fill("Recovered closed-book answer")
        frame.wait_for_timeout(700)

        active = state_get(page, "activeRetrieval", "current")
        check(active and active["status"] == "active", "Active session was not saved in IndexedDB")
        check(active["draft"]["values"].get("attempt-text") == "Recovered closed-book answer", "IndexedDB draft text is wrong")
        envelope = json.loads(frame.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')"))
        check(envelope["session"]["activeTargetId"] == active["activeTargetId"], "Emergency snapshot target differs from IndexedDB")
        check(envelope["session"]["draft"]["values"].get("attempt-text") == "Recovered closed-book answer", "Emergency snapshot did not preserve the typed attempt")

        frame.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator("#attempt-text").count() == 1)
        check(frame.locator("#attempt-text").input_value() == "Recovered closed-book answer", "Unfinished session did not recover after document reconstruction")
        check(frame.locator("#pane-review").evaluate("e=>e.classList.contains('on')"), "Recovered session did not open Review")

        page.evaluate("document.querySelector('#app').remove()")
        page.evaluate("""() => {
          const key='revision-director:active-retrieval:v1';
          const host=window.__RD_B1_QA_STATE__;
          const envelope=JSON.parse(host.local[key]);
          envelope.session.revision += 7;
          envelope.session.updatedAt = new Date(Date.now()+60000).toISOString();
          envelope.savedAt = envelope.session.updatedAt;
          envelope.session.draft.values['attempt-text']='Local emergency copy won';
          host.local[key]=JSON.stringify(envelope);
        }""")
        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator("#attempt-text").count() == 1)
        check(frame.locator("#attempt-text").input_value() == "Local emergency copy won", "Newest local copy did not win recovery arbitration")
        reconciled = state_get(page, "activeRetrieval", "current")
        check(reconciled["draft"]["values"].get("attempt-text") == "Local emergency copy won", "Newest local copy was not reconciled into IndexedDB")

        frame.locator("#attempt-text").fill("Forced lifecycle snapshot")
        frame.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
        forced = json.loads(frame.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')"))
        check(forced["session"]["draft"]["values"].get("attempt-text") == "Forced lifecycle snapshot", "pagehide did not force the emergency snapshot")
        frame.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow'))")
        wait_until(frame, lambda: frame.locator("html").get_attribute("data-review-ownership") == "primary")

        before = len(state_all(page, "evidenceEvents"))
        if frame.locator("#attempt-completed").count() and not frame.locator("#attempt-completed").is_checked():
            frame.locator("#attempt-completed").check()
        frame.locator('[data-action="reveal"]').click()
        wait_until(frame, lambda: frame.locator('[data-review-phase="compare"]').evaluate("e=>!e.hidden"))
        for index in range(frame.locator("[data-checkpoint]").count()):
            box = frame.locator("[data-checkpoint]").nth(index)
            if not box.is_checked():
                box.check()
        for index in range(frame.locator("[data-rubric]").count()):
            frame.locator("[data-rubric]").nth(index).evaluate("e=>{e.value='4';e.dispatchEvent(new Event('input',{bubbles:true}))}")
        if frame.locator("#questions-attempted").count():
            target = int(frame.locator("#questions-target").input_value())
            frame.locator("#questions-attempted").fill(str(target))
            frame.locator("#questions-correct").fill(str(target))
            frame.locator("#questions-partial").fill("0")
            frame.locator("#questions-novel").fill(str(min(target, 3)))
        if frame.locator("#diagram-attempt-completed").count() and not frame.locator("#diagram-attempt-completed").is_checked():
            frame.locator("#diagram-attempt-completed").check()
        if frame.locator("#relearn-assessment-source-closed").count() and not frame.locator("#relearn-assessment-source-closed").is_checked():
            frame.locator("#relearn-assessment-source-closed").check()
        frame.evaluate("""() => {
          const button=document.querySelector('[data-action="rate"][data-rating="3"]');
          button.click(); button.click();
        }""")
        try:
            wait_until(frame, lambda: len(state_all(page, "evidenceEvents")) == before + 1)
        except Exception:
            print("toast", frame.locator("#toast").inner_text(), flush=True)
            print("active", state_get(page, "activeRetrieval", "current"), flush=True)
            print("evidence", state_all(page, "evidenceEvents"), flush=True)
            print("errors", browser_errors, flush=True)
            print("buttons", frame.locator('[data-action="rate"]').count(), [frame.locator('[data-action="rate"]').nth(i).is_disabled() for i in range(frame.locator('[data-action="rate"]').count())], flush=True)
            raise
        frame.wait_for_timeout(350)
        after = state_all(page, "evidenceEvents")
        check(len(after) == before + 1, "Double rating created duplicate evidence")
        check(len({event["id"] for event in after}) == len(after), "Evidence identifiers are not unique")
        next_active = state_get(page, "activeRetrieval", "current")
        check(next_active and next_active["status"] == "active" and next_active["activeIndex"] == 1, "Atomic commit did not persist the next queue target")

        frame = boot_frame(page)
        wait_until(frame, lambda: frame.locator(".review-card").count() == 1)
        check("2 / 2" in frame.locator("#review-content").inner_text(), "Next queue target did not recover after committed transition")
        frame.locator('[data-action="end-session"]').click()
        frame.wait_for_timeout(500)
        check(frame.evaluate("localStorage.getItem('revision-director:active-retrieval:v1')") is None, "Manual end did not clear emergency recovery")
        check(state_get(page, "activeRetrieval", "current") is None, "Manual end did not clear IndexedDB active session")
        check(not browser_errors, f"Browser errors: {browser_errors}")

        context.close()
        browser.close()
    print(f"PASS {checks} Pass B1 persistent-browser recovery checks")


if __name__ == "__main__":
    main()
