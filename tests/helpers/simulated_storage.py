"""Canonical simulated browser storage for tests that do not require native IndexedDB semantics."""

from __future__ import annotations

from .browser_harness import ROOT

BASE_HTML = (ROOT / "index.html").read_text()
SIMULATED_STORAGE_SHIM = r"""
<script>
(() => {
  const HOST_SCOPE = parent;
  const HOST = HOST_SCOPE.__RD_SIMULATED_STORAGE_STATE__ ||= {};
  if (!HOST.local) HOST.local = {};
  if (!HOST.databases) HOST.databases = {};
  if (!HOST.faults) HOST.faults = {};

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
  function scheduleAfterPutFault(db,data,key,value){
    const fault=HOST.faults?.afterPutPatch;
    if(!fault || fault.store!==data.name) return;
    const match=fault.match ?? {};
    if(!Object.entries(match).every(([name,expected])=>sameKey(value?.[name],expected))) return;
    if(fault.once !== false) delete HOST.faults.afterPutPatch;
    const encoded=JSON.stringify(key);
    const patch=clone(fault.patch ?? {});
    setTimeout(()=>{
      const live=db._stores.get(data.name);
      const current=live?.records.get(encoded);
      if(current===undefined || !Object.entries(match).every(([name,expected])=>sameKey(current[name],expected))) return;
      const next=Object.assign(clone(current),patch);
      live.records.set(encoded,next);
      db._persist();
    },0);
  }

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
      // Provisional writes are visible within this transaction only.
      // Aborted work must never leak into canonical persisted state.
      this._view=new Map();
      for(const name of this.names){
        const live=db._stores.get(name);
        if(!live) continue;
        const data=new StoreData(name,{keyPath:clone(live.keyPath)});
        data.indices=new Map([...live.indices].map(([key,value])=>[key,clone(value)]));
        data.records=new Map([...live.records].map(([key,value])=>[key,clone(value)]));
        this._view.set(name,data);
      }
      setTimeout(() => this._maybe(), 0);
    }
    set oncomplete(fn){ this._oncomplete=fn; if(this._complete && !this._aborted && fn) setTimeout(()=>fn({target:this}),0); }
    get oncomplete(){ return this._oncomplete; }
    _inc(){ if(this._aborted) throw new Error('TransactionInactiveError'); this._pending++; }
    _dec(){ if(this._pending>0) this._pending--; this._maybe(); }
    _maybe(){
      if(this._pending===0 && !this._complete && !this._aborted){
        this._complete=true;
        if(this.mode!=='readonly'){
          for(const [name,data] of this._view) this.db._stores.set(name,data);
          this.db._persist();
        }
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
      const data=this._view.get(name); if(!data) throw new Error('Missing object store: '+name);
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
    createIndex(name,keyPath,opts={}){ this.data.indices.set(name,{keyPath:clone(keyPath),unique:!!opts.unique}); return {}; }
    index(name){ const cfg=this.data.indices.get(name); if(!cfg) throw new Error('Missing index: '+name); return new Index(this.tx,this.data,cfg); }
    get(key){ return asyncReq(this.tx,()=>{ const value=this.data.records.get(JSON.stringify(key)); return clone(value); }); }
    getAll(){ return asyncReq(this.tx,()=>[...this.data.records.values()].map(clone)); }
    count(){ return asyncReq(this.tx,()=>this.data.records.size); }
    put(value){ return asyncReq(this.tx,()=>{ const key=keyFrom(value,this.data.keyPath); if(key===undefined) throw new Error('Missing key'); this.data.records.set(JSON.stringify(key),clone(value)); scheduleAfterPutFault(this.tx.db,this.data,key,value); return clone(key); }); }
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
      return new Tx(this,[name],'versionchange').objectStore(name);
    }
    transaction(names,mode='readonly'){ return new Tx(this,names,mode); }
    close(){}
  }

  const connections=new Map();
  Object.defineProperty(window,'indexedDB',{configurable:true,value:{
    open(name,version){
      const request=new Req();
      setTimeout(()=>{
        try{
          const raw=HOST.databases[name];
          let db=connections.get(name);
          const oldVersion=db?.version ?? raw?.version ?? 0;
          const targetVersion=version ?? (oldVersion || 1);
          if(oldVersion && targetVersion < oldVersion) throw new DOMException('Lower version','VersionError');
          if(!db){
            db=raw ? DB.restore(name,raw) : new DB(name,targetVersion);
            connections.set(name,db);
          }
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
    deleteDatabase(name){
      const request=new Req();
      setTimeout(()=>{
        connections.delete(name);
        delete HOST.databases[name];
        if(request.onsuccess) request.onsuccess({target:request});
      },0);
      return request;
    }
  }});
})();
</script>
"""


def simulated_storage_html(*extra_shims: str, base_html: str = BASE_HTML) -> str:
    return base_html.replace("<head>", "<head>" + SIMULATED_STORAGE_SHIM + "".join(extra_shims), 1)


def create_simulated_frame(
    page,
    html: str,
    *,
    name: str = "revision-app",
    element_id: str | None = None,
    width: int = 1280,
    height: int = 900,
):
    frame_id = element_id or name
    page.evaluate("""([name,frameId,width,height]) => {
      const old=document.querySelector('#'+CSS.escape(frameId));
      if(old) old.remove();
      const frame=document.createElement('iframe');
      frame.id=frameId; frame.name=name;
      frame.style.width=String(width)+'px';
      frame.style.height=String(height)+'px';
      document.body.appendChild(frame);
    }""", [name, frame_id, width, height])
    frame = page.frame(name=name)
    if frame is None:
        raise AssertionError(f"QA app frame was not created: {name}")
    frame.set_content(html, wait_until="load")
    return frame


def simulated_state_all(page, store: str):
    return page.evaluate("""store => {
      const raw=window.__RD_SIMULATED_STORAGE_STATE__.databases['revision-director'];
      const records=raw?.stores?.[store]?.records ?? [];
      return records.map(([,value]) => structuredClone(value));
    }""", store)


def simulated_state_get(page, store: str, key: str):
    return page.evaluate("""([store,key]) => {
      const raw=window.__RD_SIMULATED_STORAGE_STATE__.databases['revision-director'];
      const records=raw?.stores?.[store]?.records ?? [];
      const found=records.find(([encoded]) => encoded === JSON.stringify(key));
      return found ? structuredClone(found[1]) : null;
    }""", [store, key])

def reset_simulated_storage(page, state: dict | None = None) -> None:
    page.evaluate(
        "state => { window.__RD_SIMULATED_STORAGE_STATE__ = state; }",
        state if state is not None else {"local": {}, "databases": {}},
    )


def simulated_local_get(page, key: str):
    return page.evaluate(
        "key => window.__RD_SIMULATED_STORAGE_STATE__?.local?.[key] ?? null",
        key,
    )


def simulated_local_set(page, key: str, value) -> None:
    page.evaluate(
        """([key,value]) => {
          const state=window.__RD_SIMULATED_STORAGE_STATE__ ||= {local:{},databases:{},faults:{}};
          state.local ||= {};
          if(value === null) delete state.local[key];
          else state.local[key]=String(value);
        }""",
        [key, value],
    )


def configure_after_put_patch(
    page,
    *,
    store: str,
    match: dict,
    patch: dict,
    once: bool = True,
) -> None:
    page.evaluate(
        """fault => {
          const state=window.__RD_SIMULATED_STORAGE_STATE__ ||= {local:{},databases:{},faults:{}};
          state.faults ||= {};
          state.faults.afterPutPatch=fault;
        }""",
        {"store": store, "match": match, "patch": patch, "once": once},
    )
