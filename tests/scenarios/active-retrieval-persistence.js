'use strict';
const { createAppRuntime, memoryLocalStorage } = require('../helpers/runtime-harness');
const { mulberry32, integer } = require('../helpers/seeded');

const memory = memoryLocalStorage();
const memoryStorage = memory.values;
const { api } = createAppRuntime({
  globalName: '__RD_B1_TEST__',
  expose: ["Store","ACTIVE_RETRIEVAL_RECOVERY_KEY","ACTIVE_RETRIEVAL_RECOVERY_FORMAT","ACTIVE_RETRIEVAL_RECOVERY_MAX_CHARS","ACTIVE_RETRIEVAL_RECOVERY_TEXT_CHARS","ACTIVE_RETRIEVAL_RECOVERY_POINTS","canonicalReviewDraftSnapshot","canonicalActiveRetrievalSession","canonicalActiveRetrievalEnvelope","newerActiveRetrieval","compactActiveRetrievalSession","ActiveRetrievalPersistence"],
  context: { localStorage: memory.api },
});

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

  const canonical = api.canonicalActiveRetrievalSession(session(1));
  check(canonical.id === 'current' && canonical.revision === 1, 'Active session canonicalisation failed');
  check(canonical.draft.diagramStrokes[0][0].x === .1, 'Diagram recovery data was lost');
  mustFail(() => api.canonicalActiveRetrievalSession(session(1, { activeTargetId: 'wrong' })), 'Queue/target mismatch was accepted');
  mustFail(() => api.canonicalActiveRetrievalSession(session(1, { status: 'committing' })), 'Committing state without token was accepted');
  mustFail(() => api.canonicalReviewDraftSnapshot({phase:'attempt',values:{},checked:{},diagramStrokes:[[{x:2,y:0}]],attemptElapsedMs:-1}), 'Invalid draft duration was accepted');
  mustFail(() => api.canonicalActiveRetrievalEnvelope({format:api.ACTIVE_RETRIEVAL_RECOVERY_FORMAT,schemaVersion:1,savedAt:'2026-07-27T05:00:00.000Z',session:null}), 'Malformed recovery envelope session was accepted');

  const committing = api.canonicalActiveRetrievalSession(session(2, { status:'committing', commitToken:'commit_2' }));
  check(committing.status === 'committing' && committing.commitToken === 'commit_2', 'Valid committing state did not survive canonicalisation');

  const random = mulberry32(0xA11CE);
  const precedenceBase = Date.parse('2026-07-27T06:00:00.000Z');
  for (let index = 0; index < 128; index += 1) {
    const revisionA = integer(random, 1, 40);
    const revisionB = integer(random, 1, 40);
    const timeA = precedenceBase + integer(random, 0, 500) * 1000;
    const timeB = precedenceBase + integer(random, 0, 500) * 1000;
    const a = session(revisionA, { updatedAt:new Date(timeA).toISOString() });
    const b = session(revisionB, { updatedAt:new Date(timeB).toISOString() });
    const expected = revisionA !== revisionB ? (revisionA > revisionB ? a : b) : (timeA >= timeB ? a : b);
    const winner = api.newerActiveRetrieval(a, b);
    check(winner.revision === expected.revision && winner.updatedAt === expected.updatedAt, 'Seeded recovery precedence mismatch at case ' + index);
  }

  const db = new Map();
  const writes = [];
  const diagnostics = [];
  let failNextGet = false;
  let failNextPut = false;
  const fakeData = {
    async get(store, key) { if (failNextGet) { failNextGet = false; throw new Error('injected read failure'); } return db.get(`${store}:${key}`); },
    async put(store, value) { writes.push(value.revision); if (failNextPut) { failNextPut = false; throw new Error('injected write failure'); } await wait(12); db.set(`${store}:${value.id}`, structuredClone(value)); },
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

  const faultPersistence = new api.ActiveRetrievalPersistence(fakeData);
  failNextPut = true;
  let rejected = false;
  try { await faultPersistence.flush(session(6)); } catch { rejected = true; }
  check(rejected, 'Injected IndexedDB write failure was not surfaced to the caller');
  const emergencyAfterFailure = JSON.parse(memoryStorage.get(api.ACTIVE_RETRIEVAL_RECOVERY_KEY));
  check(emergencyAfterFailure.session.revision === 6, 'Synchronous emergency recovery was not retained after IndexedDB failure');

  await faultPersistence.flush(session(7));
  check(db.get(api.Store.ActiveRetrieval + ':current').revision === 7, 'Serialised persistence did not recover after a prior rejected write');

  faultPersistence.forceEmergency(session(8));
  failNextGet = true;
  const fallback = await faultPersistence.load();
  check(fallback.session && fallback.session.revision === 8, 'Local emergency recovery did not survive an injected IndexedDB read failure');
  check(db.get(api.Store.ActiveRetrieval + ':current').revision === 8, 'Recovered local state was not reconciled after the read fault cleared');

  const diagnosticCodes = diagnostics.map((entry) => entry.code);
  for (const expected of ['active-retrieval.indexeddb.write','active-retrieval.previous-write','active-retrieval.indexeddb.read']) {
    check(diagnosticCodes.includes(expected), 'Expected fault diagnostic missing: ' + expected);
  }
  check(diagnosticCodes.every((code) => ['active-retrieval.indexeddb.write','active-retrieval.previous-write','active-retrieval.indexeddb.read'].includes(code)), 'Unexpected diagnostics escaped controlled fault injection: ' + JSON.stringify(diagnostics));
  console.log(`PASS ${checks} Pass B1 durable-active-retrieval checks`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
