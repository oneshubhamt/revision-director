'use strict';
const { createAppRuntime, memoryLocalStorage } = require('./helpers/runtime-harness');

(async () => {
  class FakeBroadcastChannel {
    static groups = new Map();
    constructor(name) {
      this.name = name; this.onmessage = null;
      const group = FakeBroadcastChannel.groups.get(name) || new Set(); group.add(this); FakeBroadcastChannel.groups.set(name, group);
    }
    postMessage(data) { for (const peer of FakeBroadcastChannel.groups.get(this.name) || []) if (peer !== this) setTimeout(() => peer.onmessage && peer.onmessage({ data: structuredClone(data) }), 0); }
    close() { FakeBroadcastChannel.groups.get(this.name)?.delete(this); }
  }
  const memory = memoryLocalStorage();
  const localStorage = memory.api;
  const listeners = new Map();
  const document = { documentElement: { dataset: {} }, querySelector(){ return null; } };
  const navigator = { storage: { persisted: async () => false, persist: async () => false, estimate: async () => ({ usage: 80, quota: 100 }) } };
  const { api, context } = createAppRuntime({
    globalName: '__RD_B3_TEST__',
    expose: ["APP_VERSION","REVIEW_OWNER_STORAGE_KEY","REVIEW_OWNER_CHANNEL","REVIEW_OWNER_HEARTBEAT_MS","REVIEW_OWNER_STALE_MS","REVIEW_OWNER_TAKEOVER_WAIT_MS","ReviewOwnershipCoordinator","RevisionData","AppDiagnostics"],
    context: {
      localStorage,
      navigator,
      document,
      BroadcastChannel: FakeBroadcastChannel,
      addEventListener(name, handler) { const values = listeners.get(name) || []; values.push(handler); listeners.set(name, values); },
      removeEventListener() {},
    },
  });

let checks = 0;
  const check = (value, message) => { checks += 1; if (!value) throw new Error(message); };
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  check(api.APP_VERSION === 'va7.1-pass-f1', 'Pass B3 identity is wrong');
  check(api.REVIEW_OWNER_STORAGE_KEY === 'revision-director:review-owner:v1', 'Ownership key changed');
  check(api.REVIEW_OWNER_CHANNEL === 'revision-director-review-owner', 'Ownership channel changed');
  check(api.REVIEW_OWNER_HEARTBEAT_MS === 4000, 'Heartbeat interval changed');
  check(api.REVIEW_OWNER_STALE_MS === 15000, 'Lease stale threshold changed');
  check(api.REVIEW_OWNER_TAKEOVER_WAIT_MS === 1800, 'Takeover wait changed');
  check(source.includes('await data.refreshStorageHealth(false);'), 'Database startup does not use passive storage inspection');
  check(source.includes('async refreshStorageHealth(requestPersistence = false)'), 'Storage-health default is not passive');
  check(source.includes('return this.acquire("takeover", false);'), 'Takeover can still force-overwrite a newly acquired third-party lease');
  check(source.includes('lease.tabId === message.tabId'), 'Heartbeat messages are not verified against the canonical lease');

  const diagnostics = [];
  const fakeData = { recordDiagnostic(code, operation, error) { diagnostics.push({ code, operation, error: String(error) }); } };
  const eventsA = []; let flushA = 0; const hydrateA = [];
  const ownerA = new api.ReviewOwnershipCoordinator(fakeData);
  await ownerA.start({ flush: async () => { flushA += 1; }, hydrate: async reason => { hydrateA.push(reason); }, changed: snapshot => eventsA.push(snapshot) });
  check(ownerA.canMutate(), 'First tab did not become mutable owner');
  check(ownerA.snapshot().state === 'primary', 'First tab is not primary');
  check(hydrateA.length === 1 && hydrateA[0] === 'startup', 'Startup hydration did not run exactly once');
  const firstLease = JSON.parse(localStorage.getItem(api.REVIEW_OWNER_STORAGE_KEY));
  check(firstLease.version === 1 && firstLease.tabId === ownerA.snapshot().tabId, 'Verified lease was not written');

  const eventsB = []; const hydrateB = [];
  const ownerB = new api.ReviewOwnershipCoordinator(fakeData);
  await ownerB.start({ flush: async () => {}, hydrate: async reason => { hydrateB.push(reason); }, changed: snapshot => eventsB.push(snapshot) });
  check(!ownerB.canMutate() && ownerB.snapshot().state === 'secondary', 'Second tab was not read-only');
  check(hydrateB.length === 0, 'Secondary tab hydrated before ownership');

  const taken = await ownerB.takeControl();
  await delay(30);
  check(taken && ownerB.canMutate(), 'Takeover did not transfer mutation rights');
  check(ownerA.snapshot().state === 'secondary' && !ownerA.canMutate(), 'Original owner remained mutable after takeover');
  check(flushA === 1, 'Original owner did not flush before handoff');
  check(hydrateB.length === 1 && hydrateB[0] === 'takeover', 'New owner did not canonically hydrate during takeover');
  const secondLease = JSON.parse(localStorage.getItem(api.REVIEW_OWNER_STORAGE_KEY));
  check(secondLease.tabId === ownerB.snapshot().tabId, 'Lease did not move to new owner');

  localStorage.setItem(api.REVIEW_OWNER_STORAGE_KEY, JSON.stringify({ ...secondLease, tabId: 'foreign', claimId: 'foreign-claim', expiresAt: Date.now() + 5000 }));
  check(!ownerB.canMutate(), 'Lease verification did not immediately revoke mutation rights');
  await ownerB.evaluate('reacquire');
  check(ownerB.snapshot().state === 'secondary', 'Foreign active owner was not respected');

  localStorage.setItem(api.REVIEW_OWNER_STORAGE_KEY, JSON.stringify({ ...secondLease, tabId: 'stale', claimId: 'stale-claim', expiresAt: Date.now() - 1 }));
  const reacquired = await ownerB.evaluate('reacquire');
  check(reacquired && ownerB.canMutate(), 'Stale lease was not safely reclaimed');
  check(hydrateB.at(-1) === 'reacquire', 'Reacquisition did not hydrate canonical state');

  await ownerB.releaseForExit();
  check(!ownerB.canMutate() && ownerB.snapshot().state === 'secondary', 'Exit release did not close mutation ownership');
  check(localStorage.getItem(api.REVIEW_OWNER_STORAGE_KEY) === null, 'Exit release left the lease behind');

  const originalSet = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('blocked'); };
  const ownerC = new api.ReviewOwnershipCoordinator(fakeData);
  await ownerC.start({ flush: async () => {}, hydrate: async () => {}, changed: () => {} });
  check(ownerC.snapshot().state === 'faulted' && !ownerC.canMutate(), 'Lease write failure did not fail closed');
  check(diagnostics.some(item => item.code === 'ownership.lease-write'), 'Lease write failure was not diagnosed');
  localStorage.setItem = originalSet;
  ownerA.dispose(); ownerB.dispose(); ownerC.dispose();

  // A third tab may acquire after the old owner releases but before the original
  // takeover requester resumes. The requester must not force-overwrite it.
  localStorage.clear();
  const raceA = new api.ReviewOwnershipCoordinator(fakeData);
  const raceB = new api.ReviewOwnershipCoordinator(fakeData);
  const raceC = new api.ReviewOwnershipCoordinator(fakeData);
  await raceA.start({ flush: async () => {}, hydrate: async () => {}, changed: () => {} });
  await raceB.start({ flush: async () => {}, hydrate: async () => {}, changed: () => {} });
  await raceC.start({ flush: async () => {}, hydrate: async () => {}, changed: () => {} });
  const raceTaken = await raceB.takeControl();
  await delay(60);
  const raceOwners = [raceA, raceB, raceC].filter(owner => owner.canMutate());
  check(!raceTaken, 'Original takeover requester overwrote a third tab that acquired during handoff');
  check(raceOwners.length === 1 && raceOwners[0] === raceC, 'Handoff race did not preserve exactly one canonical owner');

  const attacker = new FakeBroadcastChannel(api.REVIEW_OWNER_CHANNEL);
  attacker.postMessage({ type: 'heartbeat', tabId: 'forged-tab', expiresAt: Date.now() + 10_000 });
  await delay(30);
  check(raceC.canMutate(), 'Unverified heartbeat message demoted the canonical owner');
  attacker.postMessage(null);
  attacker.postMessage({ type: 'heartbeat', tabId: 42, expiresAt: Date.now() + 10_000 });
  attacker.postMessage({ type: 'unknown', tabId: 'forged-tab' });
  await delay(30);
  check(raceC.canMutate(), 'Malformed ownership message changed canonical ownership');
  attacker.close();
  raceA.dispose(); raceB.dispose(); raceC.dispose();

  let persistCalls = 0;
  navigator.storage = { persisted: async () => false, persist: async () => { persistCalls += 1; return false; }, estimate: async () => ({ usage: 80, quota: 100 }) };
  const repo = { get: async () => undefined, put: async () => {} };
  const healthData = new api.RevisionData(repo, new api.AppDiagnostics());
  const passive = await healthData.refreshStorageHealth(false);
  check(passive.persistence === 'available' && persistCalls === 0, 'Passive storage check requested persistence');
  check(passive.level === 'warning' && passive.usageRatio === 0.8, '75% quota warning was not reported');
  const requested = await healthData.refreshStorageHealth(true);
  check(requested.persistence === 'denied' && persistCalls === 1, 'Persistence request/denial was not reported');
  navigator.storage = { persisted: async () => true, persist: async () => { throw new Error('must not call'); }, estimate: async () => ({ usage: 95, quota: 100 }) };
  const critical = await healthData.refreshStorageHealth(true);
  check(critical.persistence === 'granted' && critical.level === 'critical' && critical.usageRatio === 0.95, 'Critical quota or granted persistence state is wrong');
  navigator.storage = { persisted: async () => { throw new Error('inspect failed'); }, estimate: async () => ({ usage: 1, quota: 100 }) };
  const failed = await healthData.refreshStorageHealth(false);
  check(failed.level === 'warning' && failed.lastError === 'inspect failed' && failed.diagnosticCount === 1, 'Storage inspection failure was not surfaced');

  check(eventsA.some(event => event.state === 'primary') && eventsA.some(event => event.state === 'secondary'), 'Ownership state notifications are incomplete');
  check(eventsB.some(event => event.state === 'hydrating') && eventsB.some(event => event.state === 'primary'), 'Takeover hydration state was not published');
  check(diagnostics.length === 1, 'Unexpected ownership diagnostics were recorded');

  console.log(`PASS ${checks} Pass B3 ownership and storage-health checks`);
})().catch(error => { console.error(error); process.exitCode = 1; });
