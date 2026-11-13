'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_B1_TEST__ = { APP_VERSION, DB_VERSION, Store, ACTIVE_RETRIEVAL_ID, ACTIVE_RETRIEVAL_RECOVERY_KEY, ACTIVE_RETRIEVAL_RECOVERY_FORMAT, ACTIVE_RETRIEVAL_DEBOUNCE_MS, ACTIVE_RETRIEVAL_RECOVERY_MAX_CHARS, ACTIVE_RETRIEVAL_RECOVERY_TEXT_CHARS, ACTIVE_RETRIEVAL_RECOVERY_POINTS, canonicalReviewDraftSnapshot, canonicalActiveRetrievalSession, canonicalActiveRetrievalEnvelope, newerActiveRetrieval, compactActiveRetrievalSession, ActiveRetrievalPersistence };';
if (!source.includes('void boot();')) throw new Error('Boot marker missing');
source = source.replace('void boot();', hook);
const vendor = fs.readFileSync(path.join(root, 'vendor', 'ts-fsrs-6.0.0', 'index.umd.js'), 'utf8');
const memoryStorage = new Map();
const localStorage = {
  getItem: (key) => memoryStorage.has(key) ? memoryStorage.get(key) : null,
  setItem: (key, value) => memoryStorage.set(key, String(value)),
  removeItem: (key) => memoryStorage.delete(key),
};
const context = { crypto: webcrypto, structuredClone, console, Date, Intl, URL, Blob, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set, Math, Number, String, Object, Array, JSON, Error, Promise, Int32Array, Uint8Array, localStorage, navigator: {} };
context.window = context; context.self = context; context.globalThis = context;
vm.createContext(context); vm.runInContext(vendor, context); vm.runInContext(source, context);
const api = context.__RD_B1_TEST__;
let checks = 0;
function check(value, message) { checks += 1; if (!value) throw new Error(message); }
function mustFail(fn, message) { checks += 1; try { fn(); } catch { return; } throw new Error(message); }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function timeRuntime(phase, startedAt = '2026-07-27T05:00:00.000Z') {
  return { currentPhase:phase, state:'running', sessionStartedAt:startedAt, lastTickAt:startedAt, activeByPhase:{attempt:2500,compare:0,'relearn-repair':0,'relearn-verify':0}, pauseHistory:[], phaseHistory:[], gapHistory:[], sourceVisible:false, backwardClockCount:0 };
}

function session(revision, overrides = {}) {
  const phase = overrides.phase || 'attempt';
  return {
    schemaVersion: 1,
    id: 'current',
    revision,
    status: 'active',
    queueTargetIds: ['obligation_1'],
    activeIndex: 0,
    activeTargetId: 'obligation_1',
    phase,
    draft: { phase, values: { 'attempt-text': `draft-${revision}` }, checked: {}, diagramStrokes: [[{x:.1,y:.2},{x:.3,y:.4}]], attemptElapsedMs: 1200 },
    timeRuntime: timeRuntime(phase),
    elapsedMs: 2500,
    startedAt: '2026-07-27T05:00:00.000Z',
    updatedAt: `2026-07-27T05:00:0${Math.min(9, revision)}.000Z`,
    ...overrides,
  };
}

(async () => {
  check(api.APP_VERSION === 'va7.1-pass-f1' && api.DB_VERSION === 3, 'Pass B1 identity is wrong');
  check(api.Store.ActiveRetrieval === 'activeRetrieval', 'Active retrieval store is missing');
  check(api.ACTIVE_RETRIEVAL_DEBOUNCE_MS === 350, 'Debounce contract changed');
  check(api.ACTIVE_RETRIEVAL_RECOVERY_MAX_CHARS === 900000 && api.ACTIVE_RETRIEVAL_RECOVERY_TEXT_CHARS === 160000 && api.ACTIVE_RETRIEVAL_RECOVERY_POINTS === 12000, 'Emergency snapshot limits changed');

  const canonical = api.canonicalActiveRetrievalSession(session(1));
  check(canonical.id === 'current' && canonical.revision === 1, 'Active session canonicalisation failed');
  check(canonical.draft.diagramStrokes[0][0].x === .1, 'Diagram recovery data was lost');
  mustFail(() => api.canonicalActiveRetrievalSession(session(1, { activeTargetId: 'wrong' })), 'Queue/target mismatch was accepted');
  mustFail(() => api.canonicalActiveRetrievalSession(session(1, { status: 'committing' })), 'Committing state without token was accepted');
  mustFail(() => api.canonicalReviewDraftSnapshot({phase:'attempt',values:{},checked:{},diagramStrokes:[[{x:2,y:0}]],attemptElapsedMs:-1}), 'Invalid draft duration was accepted');
  mustFail(() => api.canonicalActiveRetrievalEnvelope({format:api.ACTIVE_RETRIEVAL_RECOVERY_FORMAT,schemaVersion:1,savedAt:'2026-07-27T05:00:00.000Z',session:null}), 'Malformed recovery envelope session was accepted');

  const db = new Map();
  const writes = [];
  const diagnostics = [];
  const fakeData = {
    async get(store, key) { return db.get(`${store}:${key}`); },
    async put(store, value) { writes.push(value.revision); await wait(12); db.set(`${store}:${value.id}`, structuredClone(value)); },
    async delete(store, key) { db.delete(`${store}:${key}`); },
    recordDiagnostic(code, operation, error) { diagnostics.push({code,operation,error:String(error)}); },
  };

  const persistence = new api.ActiveRetrievalPersistence(fakeData);
  const oversized = session(1, {
    draft: {
      phase: 'attempt',
      values: Object.fromEntries(Array.from({length: 40}, (_, index) => [`field-${index}`, 'x'.repeat(20000)])),
      checked: {},
      diagramStrokes: Array.from({length: 20}, () => Array.from({length: 2000}, (_, index) => ({x:(index % 1000)/1000,y:(index % 997)/997}))),
      attemptElapsedMs: 1200,
    },
  });
  const compact = api.compactActiveRetrievalSession(oversized);
  check(Object.values(compact.draft.values).reduce((total, value) => total + value.length, 0) <= api.ACTIVE_RETRIEVAL_RECOVERY_TEXT_CHARS, 'Emergency text was not compacted');
  check(compact.draft.diagramStrokes.flat().length <= api.ACTIVE_RETRIEVAL_RECOVERY_POINTS, 'Emergency diagram was not downsampled');
  check(compact.draft.diagramStrokes.length === oversized.draft.diagramStrokes.length, 'Emergency diagram dropped complete strokes');
  persistence.forceEmergency(oversized);
  check(memoryStorage.get(api.ACTIVE_RETRIEVAL_RECOVERY_KEY).length <= api.ACTIVE_RETRIEVAL_RECOVERY_MAX_CHARS, 'Emergency envelope exceeded its cap');
  persistence.forceEmergency(session(1));
  check(memoryStorage.has(api.ACTIVE_RETRIEVAL_RECOVERY_KEY), 'Forced emergency snapshot was not synchronous');
  const envelope = JSON.parse(memoryStorage.get(api.ACTIVE_RETRIEVAL_RECOVERY_KEY));
  check(envelope.format === api.ACTIVE_RETRIEVAL_RECOVERY_FORMAT && envelope.session.revision === 1, 'Emergency envelope contract is wrong');

  persistence.schedule(session(2));
  persistence.schedule(session(3));
  await wait(500);
  check(writes.filter((value) => value === 2).length === 0 && writes.filter((value) => value === 3).length === 1, 'Ordinary saves were not debounced to the newest snapshot');

  db.set(`${api.Store.ActiveRetrieval}:current`, structuredClone(session(3)));
  persistence.forceEmergency(session(4));
  const loaded = await persistence.load();
  check(loaded.session && loaded.session.revision === 4, 'Newest local recovery copy did not win');
  await wait(30);
  check(db.get(`${api.Store.ActiveRetrieval}:current`).revision === 4, 'Newest local copy was not reconciled into IndexedDB');

  const completed = session(5, { status:'completed', activeIndex:1, activeTargetId:'', commitToken:'commit_done' });
  db.set(`${api.Store.ActiveRetrieval}:current`, structuredClone(completed));
  const cleared = await new api.ActiveRetrievalPersistence(fakeData).load();
  check(!cleared.session, 'Completed tombstone was exposed as unfinished work');
  check(!memoryStorage.has(api.ACTIVE_RETRIEVAL_RECOVERY_KEY) && !db.has(`${api.Store.ActiveRetrieval}:current`), 'Completed tombstone was not cleared from both stores');

  const ts = fs.readFileSync(path.join(root, 'source/app/50-ui-controller.ts'), 'utf8');
  const workspace = fs.readFileSync(path.join(root, 'source/app/47-active-retrieval-workspace.ts'), 'utf8');
  const repo = fs.readFileSync(path.join(root, 'source/app/30-indexeddb-repository.ts'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'source/app/40-application-services.ts'), 'utf8');
  const evidenceTransition = fs.readFileSync(path.join(root, 'source/app/23-evidence-transition.ts'), 'utf8');
  check(ts.includes('document.addEventListener("visibilitychange"') && ts.includes('window.addEventListener("pagehide"') && ts.includes('window.addEventListener("beforeunload"'), 'Forced lifecycle save hooks are incomplete');
  check(workspace.includes('if (this.commitInFlight) return;') && workspace.includes('button.disabled = true') && !ts.includes('private commitInFlight'), 'Active-retrieval duplicate-commit guard is not workspace-owned');
  check(repo.includes('private applyWithCommitGuard(')
    && (repo.match(/this\.applyWithCommitGuard\(/g) || []).length === 2
    && (repo.match(/current\.commitToken === commitGuard\.commitToken/g) || []).length === 1,
  'Transactional duplicate-commit guard is not centralized in one authoritative path');
  check(service.includes('eventId: commitGuard ? `evidence_${commitGuard.commitToken}`')
    && evidenceTransition.includes('id: input.eventId'),
  'Evidence idempotency token is missing from the orchestration/transition boundary');
  check(diagnostics.length === 0, `Unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
  console.log(`PASS ${checks} Pass B1 durable-active-retrieval checks`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
