'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_D_QA__ = { RevisionService, MasteryPolicy, createAutomaticChunks, weeklySubjectBalanceScores, interleaveSelected, planItemKey, subjectBalanceKey };';
if (!source.includes('void boot();')) throw new Error('Boot marker missing');
source = source.replace('void boot();', hook);
const vendor = fs.readFileSync(path.join(root, 'vendor/ts-fsrs-6.0.0', 'index.umd.js'), 'utf8');
const context = { crypto: webcrypto, structuredClone, console, Date, Intl, URL, Blob, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set, Math, Number, String, Object, Array, JSON, Error, Promise, Int32Array, Uint8Array };
context.window = context; context.self = context; context.globalThis = context;
vm.createContext(context); vm.runInContext(vendor, context); vm.runInContext(source, context);
const api = context.__RD_D_QA__;
let checks = 0;
function check(value, message) { checks += 1; if (!value) throw new Error(message); }
function mustFail(fn, message) { checks += 1; try { fn(); } catch { return; } throw new Error(message); }

const now = '2026-07-25T06:00:00.000Z';
const policy = new api.MasteryPolicy();
const workflow = { kind:'reconstruction', prompt:'Reconstruct the full framework', checkpoints:['Alpha','Beta'], responseMedium:'in-app', reconstructionShape:'outline' };
const baseObligation = { schemaVersion:1, id:'o', unitId:'u', type:'concept-reconstruction', status:'active', dueAt:now, expectedMinutes:15, baselineMinutes:15, durationSampleCount:0, protocol:'Reconstruct properly', successCriteria:'Alpha; Beta', workflow, freshnessDays:30, priority:0, policyState:policy.createInitialState(now), createdAt:now, updatedAt:now };
const profile = { schemaVersion:1, id:'p', name:'Exam', examDate:'2026-12-01', status:'active', createdAt:now, updatedAt:now };
const nodes = [
  { schemaVersion:1, id:'s', profileId:'p', parentId:null, kind:'subject', name:'Subject', normalizedName:'subject', createdAt:now, updatedAt:now },
  { schemaVersion:1, id:'c', profileId:'p', parentId:'s', kind:'section', name:'Section', normalizedName:'section', createdAt:now, updatedAt:now },
  { schemaVersion:1, id:'t', profileId:'p', parentId:'c', kind:'topic', name:'Topic', normalizedName:'topic', createdAt:now, updatedAt:now },
];
const unit = { schemaVersion:1, id:'u', profileId:'p', topicNodeId:'t', title:'Unit', scope:'Scope', source:'Source', importance:3, status:'active', createdAt:now, updatedAt:now, evidenceCount:0, lapseCount:0 };
const settings = { schemaVersion:1, key:'app', activeProfileId:'p', fsrsScheduling:{policy:{kind:'fixed-retention',desiredRetention:.9}}, memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}}, dailyCapacityMinutes:60, studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false,replayProfiles:[]} };
const validBackup = { format:'revision-director-backup', schemaVersion:2, exportedAt:now, appVersion:'va7.1-pass-f1', profiles:[profile], nodes, units:[unit], studyEvents:[], obligations:[baseObligation], evidenceEvents:[], chunks:[], dailyPlans:[], settings, activeRetrieval:null };
const validator = new api.RevisionService({});

// Exhaustive bounded split conservation across the entire supported duration/capacity domain.
for (let capacity = 5; capacity <= 239; capacity += 1) {
  for (let expected = capacity + 1; expected <= 240; expected += 1) {
    const joined = { obligation:{...baseObligation,id:`o-${capacity}-${expected}`,expectedMinutes:expected,baselineMinutes:expected}, unit:{...unit,title:'Range unit',scope:'Pages 1-240',source:'Pages 1-240'}, profile, subject:'Subject', section:'Section', topic:'Topic' };
    const result = api.createAutomaticChunks(joined, capacity, new Date(now));
    check(result.state.capacityMinutes === capacity, 'Chunk cycle must retain the creating capacity');
    check(result.chunks.length >= 2, 'Oversized work must produce at least two chunks');
    check(result.chunks.every((chunk) => chunk.expectedMinutes <= capacity), 'Every chunk must fit the creating capacity');
    check(result.state.synthesisMinutes <= capacity, 'Synthesis must fit the creating capacity');
    check(result.chunks.reduce((sum, chunk) => sum + chunk.expectedMinutes, 0) + result.state.synthesisMinutes === expected, 'Chunk work and synthesis must conserve parent duration');
  }
}

// Weekly balance uses seven study-day keys and isolates identically named subjects across profiles.
const joined = (profileId, subject, id) => ({ obligation:{...baseObligation,id,unitId:id}, unit:{...unit,id,profileId,importance:3}, profile:{...profile,id:profileId}, subject, section:'Section', topic:'Topic' });
const joinedItems = [joined('p1','Medicine','u1'), joined('p2','Medicine','u2')];
const planFor = (day, profileId, unitId, minutes) => ({ schemaVersion:1, id:`plan-${day}-${profileId}`, studyDayKey:day, createdAt:now, updatedAt:now, plannerVersion:'pass-d-2', versions:[{ version:1, generatedAt:now, capacityMinutes:120, reason:'initial', items:[{ key:unitId, obligationId:unitId, profileId, unitId, subject:'Medicine', workflow:'reconstruction', title:unitId, estimatedMinutes:minutes, score:80, disposition:'selected', reasons:[] }] }], outcomes:[{ itemKey:unitId, status:'completed', completedAt:now, actualMinutes:minutes }] });
const sevenDayPlans = [
  planFor('2026-07-19','p1','u1',60),
  planFor('2026-07-18','p2','u2',600), // eighth day; must be excluded
];
const balance = api.weeklySubjectBalanceScores(joinedItems, sevenDayPlans, new Date('2026-07-25T04:00:00'));
check(balance.get(api.subjectBalanceKey('p2','Medicine')) > balance.get(api.subjectBalanceKey('p1','Medicine')), 'Weekly balance must isolate same-named subjects by exam profile and include exactly seven study days');
const preBoundaryPlans = [planFor('2026-07-24','p1','u1',90), planFor('2026-07-17','p2','u2',600)];
const preBoundaryBalance = api.weeklySubjectBalanceScores(joinedItems, preBoundaryPlans, new Date('2026-07-25T02:00:00'), 4);
check(preBoundaryBalance.get(api.subjectBalanceKey('p2','Medicine')) > preBoundaryBalance.get(api.subjectBalanceKey('p1','Medicine')), 'Weekly balance must apply the configured 4 a.m. study-day boundary before dawn');

// Persisted plans must version capacity, order, score/reason, and manual re-additions.
async function persistenceChecks() {
  let stored;
  const repo = { dailyPlanByStudyDay:async()=>stored, put:async(store,value)=>{ if (store === 'dailyPlans') stored = structuredClone(value); } };
  const service = new api.RevisionService(repo);
  const joinedItem = { obligation:baseObligation, unit, profile, subject:'Subject', section:'Section', topic:'Topic' };
  const item = (id, score=70, reason='initial') => ({ joined:{...joinedItem,obligation:{...baseObligation,id}}, factors:{dueRisk:.5,examImportance:1,weakness:.5,reviewDuration:.8,examinationProximity:.5,weeklyBalance:.5}, score, dueState:'due', daysToExam:100, examDateKnown:true, daysFromDue:0, reasons:[reason], executionMinutes:15 });
  const a = item('a',70,'a'); const b = item('b',69,'b');
  const base = { generatedAt:now, studyDayKey:'2026-07-25', capacityMinutes:60, candidateMinutes:30, plannedMinutes:30, selected:[a,b], requiredOverrun:[], mustSplit:[], deferred:[], overdueCount:0, dueCount:2, broughtForwardCount:0 };
  await service.persistDailyPlan(base,false);
  check(stored.versions.length === 1, 'Initial plan should create one version');
  await service.persistDailyPlan({...base,capacityMinutes:120},false);
  check(stored.versions.length === 2 && stored.versions[1].capacityMinutes === 120, 'Capacity changes must create a durable version');
  await service.persistDailyPlan({...base,capacityMinutes:120,selected:[b,a]},false);
  check(stored.versions.length === 3 && stored.versions[2].items[0].key === 'b', 'Queue-order changes must create a durable version');
  const changedA = item('a',75,'new rationale');
  await service.persistDailyPlan({...base,capacityMinutes:120,selected:[changedA,b]},false);
  check(stored.versions.length === 4 && stored.versions[3].items[0].score === 75, 'Score or rationale changes must create a durable version');

  // Latest version defers A; manually starting A must add it back as selected in a new amendment.
  const latest = stored.versions.at(-1);
  latest.items = latest.items.map((entry) => entry.key === 'a' ? {...entry,disposition:'deferred'} : entry);
  const count = stored.versions.length;
  service.appendManualPlanItems(stored,[{...latest.items.find((entry)=>entry.key==='a'),disposition:'selected',reasons:['manually added during execution']}],new Date(now));
  check(stored.versions.length === count + 1 && stored.versions.at(-1).reason === 'manual-addition' && stored.versions.at(-1).items.find((entry)=>entry.key==='a').disposition === 'selected', 'Manual execution of a deferred item must become an explicit amendment');
}

// Capacity changes before execution must safely reflow or remove an untouched split cycle.
async function reflowChecks() {
  let chunks = [];
  const writes = [];
  const repo = {
    getAll:async(store)=> store === 'chunks' ? structuredClone(chunks) : [],
    putObligationWithChunks:async(obligation,updates)=>{ writes.push({obligation:structuredClone(obligation),updates:structuredClone(updates)}); for (const update of updates) { const index=chunks.findIndex((chunk)=>chunk.id===update.id); if(index>=0) chunks[index]=structuredClone(update); else chunks.push(structuredClone(update)); } },
    put:async()=>{},
  };
  const service = new api.RevisionService(repo);
  service.settings = {...settings,dailyCapacityMinutes:60};
  const obligation = {...baseObligation,id:'large',unitId:'large',expectedMinutes:120,baselineMinutes:120};
  const item = { obligation, unit:{...unit,id:'large'}, profile, subject:'Subject', section:'Section', topic:'Topic' };
  let next = await service.ensureAutomaticChunking([item],60,new Date(now));
  check(obligation.chunking.capacityMinutes === 60 && next.get('large').expectedMinutes <= 60, 'Initial split must use current capacity');
  next = await service.ensureAutomaticChunking([item],30,new Date(now));
  check(obligation.chunking.capacityMinutes === 30 && next.get('large').expectedMinutes <= 30, 'Untouched split cycles must reflow after capacity decreases');
  const activeCycle = obligation.chunking.cycleId;
  check(chunks.filter((chunk)=>chunk.cycleId!==activeCycle).every((chunk)=>chunk.status==='archived'), 'Replanned prior chunks must be archived');
  next = await service.ensureAutomaticChunking([item],180,new Date(now));
  check(obligation.chunking === undefined && !next.has('large'), 'Untouched split cycles must dissolve when the parent now fits capacity');
  check(writes.length >= 3, 'Capacity reflow must be persisted transactionally');
}

// Strict backup validation for all Pass D records.
const evidenceObjective={completeness:3,independence:3,application:3,errorTypes:[],correctionNote:''};
const evidenceCompletion=policy.complete(baseObligation,3,evidenceObjective,new Date(now));
const evidence = { schemaVersion:1, id:'e', profileId:'p', unitId:'u', obligationId:'o', obligationType:'concept-reconstruction', reviewedAt:now, elapsedMs:15*60000, evidence:evidenceObjective, workflow:'reconstruction', workflowResult:{kind:'reconstruction',responseMedium:'in-app',attemptText:'Valid attempt',shape:'outline',checkpointTotal:2,checkpointsMet:2,structuralAccuracy:3,relationshipAccuracy:3,cueLevel:'none'}, suggestedRating:3, confirmedRating:3, beforeDueAt:now, afterDueAt:evidenceCompletion.dueAt, beforePolicyState:baseObligation.policyState, afterPolicyState:evidenceCompletion.policyState, policyId:evidenceCompletion.policyId, durationObservation:{plannedMinutes:15,actualMinutes:15,accepted:true,reason:'accepted',estimateBefore:15,estimateAfter:15,exactSamples:1,unitWorkflowSamples:0,globalWorkflowSamples:0}, timing:{totalActiveMs:15*60000,activeByPhase:{attempt:15*60000,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]}, createdAt:now };
const reviewedObligation={...baseObligation,dueAt:evidenceCompletion.dueAt,policyState:evidenceCompletion.policyState,durationSampleCount:1};
const evidenceBackup = {...validBackup, units:[{...unit,evidenceCount:1}], obligations:[reviewedObligation], evidenceEvents:[evidence]};
check(validator.validateBackup(evidenceBackup).evidenceEvents.length === 1, 'Valid duration evidence must pass strict validation');
mustFail(()=>validator.validateBackup({...evidenceBackup,evidenceEvents:[{...evidence,durationObservation:{...evidence.durationObservation,accepted:'yes'}}]}),'Non-boolean duration acceptance must fail');
mustFail(()=>validator.validateBackup({...evidenceBackup,evidenceEvents:[{...evidence,durationObservation:{...evidence.durationObservation,actualMinutes:-1}}]}),'Negative duration observations must fail');
mustFail(()=>validator.validateBackup({...evidenceBackup,obligations:[{...reviewedObligation,durationSampleCount:0}]}),'Duration sample counters must match accepted history');

const planItem = { key:'o', obligationId:'o', profileId:'p', unitId:'u', subject:'Subject', workflow:'reconstruction', title:'Unit', estimatedMinutes:15, score:70, disposition:'selected', reasons:[] };
const dailyPlan = { schemaVersion:1, id:'d', studyDayKey:'2026-07-25', createdAt:now, updatedAt:now, plannerVersion:'pass-d-2', versions:[{version:1,generatedAt:now,capacityMinutes:60,items:[planItem],reason:'initial'}], outcomes:[{itemKey:'o',status:'completed',startedAt:now,completedAt:now,actualMinutes:15,evidenceEventId:'e'}] };
const planBackup = {...evidenceBackup,dailyPlans:[dailyPlan]};
check(validator.validateBackup(planBackup).dailyPlans.length === 1, 'Valid persisted daily plan must pass strict validation');
mustFail(()=>validator.validateBackup({...planBackup,dailyPlans:[{...dailyPlan,studyDayKey:'2026-02-31'}]}),'Impossible daily-plan dates must fail');
mustFail(()=>validator.validateBackup({...planBackup,dailyPlans:[{...dailyPlan,versions:[{...dailyPlan.versions[0],capacityMinutes:-1}]}]}),'Invalid plan capacity must fail');
mustFail(()=>validator.validateBackup({...planBackup,dailyPlans:[{...dailyPlan,versions:[{...dailyPlan.versions[0],items:[{...planItem,disposition:'evil'}]}]}]}),'Invalid plan disposition must fail');
mustFail(()=>validator.validateBackup({...planBackup,dailyPlans:[{...dailyPlan,versions:[{...dailyPlan.versions[0],items:[{...planItem,profileId:'wrong'}]}]}]}),'Cross-record plan relationships must fail');
mustFail(()=>validator.validateBackup({...planBackup,dailyPlans:[{...dailyPlan,outcomes:[{itemKey:'o',status:'started'}]}]}),'Started outcomes without timestamps must fail');
mustFail(()=>validator.validateBackup({...planBackup,dailyPlans:[{...dailyPlan,outcomes:[{...dailyPlan.outcomes[0],actualMinutes:20000}]}]}),'Implausible completed durations must fail');
mustFail(()=>validator.validateBackup({...planBackup,dailyPlans:[dailyPlan,{...dailyPlan,id:'d2'}]}),'Duplicate study-day plans must fail');

Promise.all([persistenceChecks(),reflowChecks()]).then(()=>{
  console.log(`PASS ${checks} Pass D de novo QA checks`);
}).catch((error)=>{ console.error(error); process.exitCode=1; });
