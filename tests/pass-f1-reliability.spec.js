'use strict';

const { createAppRuntime } = require('./helpers/runtime-harness');

const { api, source } = createAppRuntime({
  globalName: '__RD_F1_RELIABILITY__',
  expose: ['readwriteTransaction'],
});

let checks = 0;
function check(value, message) { checks += 1; if (!value) throw new Error(message); }
function mustThrow(fn, message) {
  checks += 1;
  try { fn(); } catch { return; }
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
check(source.includes('readwriteTransaction(this.db, store)'),
  'Ordinary single-store writes no longer use default durability.');
check(!source.includes('readwriteTransaction(this.db, store, "strict")'),
  'Single-store writes were incorrectly promoted to strict durability.');

console.log(`PASS ${checks} selective durability reliability checks`);
