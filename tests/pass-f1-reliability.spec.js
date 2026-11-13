'use strict';

const { createAppRuntime } = require('./helpers/runtime-harness');

const { api, source } = createAppRuntime({
  globalName: '__RD_F1_RELIABILITY__',
  expose: ['readwriteTransaction','storeWriteDurability','rootKnowledgeNodeId','IndexedDbRepository','RevisionService','Store'],
});

let checks = 0;
function check(value, message) { checks += 1; if (!value) throw new Error(message); }
function mustThrow(fn, message) {
  checks += 1;
  try { fn(); } catch { return; }
  throw new Error(message);
}
async function mustReject(fn, message) {
  checks += 1;
  try { await fn(); } catch { return; }
  throw new Error(message);
}

const defaultCalls = [];
const defaultDb = {
  transaction(stores, mode, options) {
    defaultCalls.push({ stores, mode, options });
    return { stores, mode, options };
  },
};
api.readwriteTransaction(defaultDb, 'activeRetrieval');
check(defaultCalls.length === 1 && defaultCalls[0].mode === 'readwrite' && defaultCalls[0].options === undefined,
  'Default write durability unexpectedly passed transaction options.');

const strictCalls = [];
const strictDb = {
  transaction(stores, mode, options) {
    strictCalls.push({ stores, mode, options });
    return { stores, mode, options };
  },
};
api.readwriteTransaction(strictDb, ['units', 'obligations'], 'strict');
check(strictCalls.length === 1 && strictCalls[0].options?.durability === 'strict',
  'Strict write durability did not request the strict IndexedDB durability hint.');

const fallbackCalls = [];
const legacyDb = {
  transaction(stores, mode, options) {
    fallbackCalls.push({ stores, mode, options });
    if (options) throw new TypeError('transaction options unsupported');
    return { stores, mode };
  },
};
api.readwriteTransaction(legacyDb, ['units', 'obligations'], 'strict');
check(fallbackCalls.length === 2 && fallbackCalls[0].options?.durability === 'strict' && fallbackCalls[1].options === undefined,
  'Strict durability did not fail safely to a legacy readwrite transaction.');

mustThrow(() => api.readwriteTransaction({
  transaction() {
    const error = new Error('database closed');
    error.name = 'InvalidStateError';
    throw error;
  },
}, ['units', 'obligations'], 'strict'), 'Non-compatibility IndexedDB failure was incorrectly swallowed.');

for (const store of [
  api.Store.Profiles,
  api.Store.Nodes,
  api.Store.Units,
  api.Store.StudyEvents,
  api.Store.Obligations,
  api.Store.EvidenceEvents,
  api.Store.Chunks,
  api.Store.DailyPlans,
  api.Store.Settings,
]) {
  check(api.storeWriteDurability(store) === 'strict', `Authoritative user-state store is not strict: ${store}`);
}
check(api.storeWriteDurability(api.Store.ActiveRetrieval) === 'default', 'Active-retrieval autosave must remain default durability.');
check(api.storeWriteDurability(api.Store.Metadata) === 'default', 'Release metadata refresh must remain default durability.');

for (const signature of [
  'readwriteTransaction(this.db, [Store.Profiles, Store.Settings], "strict")',
  'readwriteTransaction(this.db, [Store.Units, Store.Obligations], "strict")',
  'readwriteTransaction(this.db, [Store.Obligations, Store.Chunks], "strict")',
  'readwriteTransaction(this.db, [Store.Settings, Store.Obligations], "strict")',
  'readwriteTransaction(this.db, stores, "strict")',
]) {
  check(source.includes(signature), `Authoritative strict transaction path missing: ${signature}`);
}
check((source.match(/readwriteTransaction\(this\.db, stores, "strict"\)/g) || []).length === 3,
  'Dynamic authoritative strict transaction count changed.');
check((source.match(/readwriteTransaction\(this\.db, store, storeWriteDurability\(store\)\)/g) || []).length === 4,
  'Generic single-store writes do not consistently use the store durability policy.');
check(!source.includes('readwriteTransaction(this.db, store);'),
  'A generic single-store write bypasses the durability policy.');

check(source.includes('const deterministic = await this.get(Store.Nodes, await rootKnowledgeNodeId(profileId, normalized));'),
  'Root hierarchy lookup does not use deterministic primary-key fast lookup.');
check(source.includes('return this.getOneByIndex(Store.Nodes, "pathLookup", [profileId, parentId, kind, normalized]);'),
  'Child hierarchy lookup no longer uses the canonical pathLookup index.');
check(source.includes('const state = await this.repo.backupState("ignore");')
  && source.includes('assertActiveProfileSelection(state.profiles, this.settings);')
  && source.includes('await this.verifyMemoryProjectionIntegrity(state.obligations, state.evidenceEvents, this.settings);'),
  'Startup no longer preserves its recovery-aware canonical validation boundary.');
check(source.includes('assert(unit, "Revision obligation references a missing knowledge unit.");')
  && source.includes('assert(topicNode?.kind === "topic"'),
  'Joined obligation materialization can still silently hide broken durable relationships.');

(async () => {
  const rootId = await api.rootKnowledgeNodeId('p', 'public administration');
  const rootNode = {
    schemaVersion: 1,
    id: rootId,
    profileId: 'p',
    parentId: null,
    kind: 'subject',
    name: 'Public Administration',
    normalizedName: 'public administration',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  let indexReads = 0;
  const fakeDb = {
    transaction() {
      const tx = {
        objectStore() {
          return {
            get(key) {
              const request = {};
              setTimeout(() => {
                request.result = key === rootId ? structuredClone(rootNode) : undefined;
                request.onsuccess?.();
                setTimeout(() => tx.oncomplete?.(), 0);
              }, 0);
              return request;
            },
            index() {
              indexReads += 1;
              throw new Error('Root deterministic lookup should not touch an index.');
            },
          };
        },
      };
      return tx;
    },
  };
  const repository = new api.IndexedDbRepository(fakeDb);
  const found = await repository.findNode('p', null, 'subject', 'Public Administration');
  check(found?.id === rootId && indexReads === 0, 'Deterministic root lookup did not use its primary-key fast path.');

  const joinedService = new api.RevisionService({
    getAll: async (store) => {
      if (store === api.Store.Obligations) return [{ id:'o', unitId:'missing', status:'active', dueAt:'2026-01-01T00:00:00.000Z', priority:0 }];
      return [];
    },
  });
  await mustReject(() => joinedService.joinedObligations('active'), 'Joined obligations silently hid a missing knowledge unit.');

  console.log(`PASS ${checks} CLEER reliability-closure checks`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
