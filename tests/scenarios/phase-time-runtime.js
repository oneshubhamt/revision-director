'use strict';
const { createAppRuntime } = require('../helpers/runtime-harness');

const { api } = createAppRuntime({
  globalName: '__RD_B2_TEST__',
  expose: ["INACTIVE_GAP_THRESHOLD_MS","TIME_HISTORY_LIMIT","phaseTimeSnapshot","timingEvidenceSummary","canonicalTimingEvidenceSummary","canonicalPhaseTimeRuntimeSnapshot","canonicalActiveRetrievalSession","PhaseTimeRuntime","durationObservationFor"],
  requireFsrs: false,
});

let checks=0;
function check(value,message){checks+=1;if(!value)throw new Error(message);}
function mustFail(fn,message){checks+=1;try{fn();}catch{return;}throw new Error(message);}

const t0 = Date.parse('2026-07-27T06:00:00.000Z');
const runtime = api.PhaseTimeRuntime.create('attempt', false, t0);
check(api.INACTIVE_GAP_THRESHOLD_MS === 120000, 'Inactive-gap threshold changed');
check(runtime.activeMs() === 0 && runtime.status() === 'running', 'Fresh runtime is invalid');
runtime.reconcile(t0 + 10_000, 'tick');
check(runtime.activeMs() === 10_000 && runtime.phaseActiveMs('attempt') === 10_000, 'Active time did not accumulate');
runtime.pause(t0 + 15_000);
check(runtime.activeMs() === 15_000 && runtime.status() === 'paused', 'Manual pause did not freeze active time');
runtime.reconcile(t0 + 35_000, 'tick');
check(runtime.activeMs() === 15_000, 'Paused time was counted as active');
runtime.resume(t0 + 45_000);
let snap = runtime.snapshot();
check(snap.pauseHistory.length === 1 && snap.pauseHistory[0].durationMs === 30_000, 'Manual pause history is wrong');
runtime.reconcile(t0 + 50_000, 'tick');
check(runtime.activeMs() === 20_000, 'Active time did not resume');
runtime.transition('compare', 'source-reveal', true, t0 + 55_000);
snap = runtime.snapshot();
check(runtime.phaseActiveMs('attempt') === 25_000 && snap.currentPhase === 'compare', 'Phase transition lost attempt time');
check(snap.sourceVisible && snap.sourceRevealAt === new Date(t0 + 55_000).toISOString(), 'Source-reveal boundary was not recorded');
check(snap.phaseHistory.length === 1 && snap.phaseHistory[0].reason === 'source-reveal', 'Phase history is missing');
runtime.reconcile(t0 + 65_000, 'tick');
check(runtime.phaseActiveMs('compare') === 10_000, 'Compare time was not accumulated separately');
const backward = runtime.reconcile(t0 + 60_000, 'tick');
check(backward.backwardClock && runtime.activeMs() === 35_000, 'Backward clock was not safely rebased');
runtime.reconcile(t0 + 70_000, 'tick');
let summary = runtime.summary(t0 + 70_000);
check(summary.totalActiveMs === 45_000 && summary.backwardClockCount === 1, 'Backward-clock recovery changed active time');
check(summary.reliabilityFlags.includes('backward-clock') && summary.durationReliable, 'Backward-clock reliability flag is wrong');

const focusRuntime = api.PhaseTimeRuntime.create('attempt', false, t0);
focusRuntime.reconcile(t0 + 5_000, 'tick');
let opened = focusRuntime.reconcile(t0 + 130_001, 'visibility');
check(opened.gapOpened && focusRuntime.status() === 'gap-pending', 'Long gap was not detected');
check(focusRuntime.activeMs() === 5_000, 'Unclassified gap was counted automatically');
const pending = focusRuntime.pendingGap();
check(pending.gapMs === 125_001 && pending.source === 'visibility', 'Pending-gap evidence is wrong');
focusRuntime.resolveGap('focus', 0, t0 + 135_001);
summary = focusRuntime.summary(t0 + 135_001);
check(summary.totalActiveMs === 130_001 && summary.classifiedFocusMs === 125_001, 'Focus classification did not count the gap');
check(summary.promptExcludedMs === 5_000 && summary.durationReliable, 'Gap prompt time or reliability is wrong');

const breakRuntime = api.PhaseTimeRuntime.create('attempt', false, t0);
breakRuntime.reconcile(t0 + 130_000, 'tick');
breakRuntime.resolveGap('break', 0, t0 + 132_000);
summary = breakRuntime.summary(t0 + 132_000);
check(summary.totalActiveMs === 0 && summary.classifiedBreakMs === 130_000, 'Break classification counted active time');
check(summary.pauseCount === 2 && summary.pauseMs === 132_000, 'Break and classification prompt were not recorded in pause history');

const splitRuntime = api.PhaseTimeRuntime.create('attempt', false, t0);
splitRuntime.reconcile(t0 + 180_000, 'tick');
splitRuntime.resolveGap('split', 60_000, t0 + 181_000);
summary = splitRuntime.summary(t0 + 181_000);
check(summary.totalActiveMs === 60_000 && summary.classifiedBreakMs === 120_000, 'Split classification is wrong');

const ignoreRuntime = api.PhaseTimeRuntime.create('attempt', false, t0);
ignoreRuntime.reconcile(t0 + 180_000, 'tick');
ignoreRuntime.resolveGap('ignore', 0, t0 + 182_000);
summary = ignoreRuntime.summary(t0 + 182_000);
check(summary.totalActiveMs === 0 && summary.ignoredGapMs === 180_000, 'Ignore classification did not exclude the gap');
check(!summary.durationReliable && summary.reliabilityFlags.includes('ignored-gap'), 'Ignored gap did not mark timing unreliable');

const pendingRuntime = api.PhaseTimeRuntime.create('attempt', false, t0);
pendingRuntime.reconcile(t0 + 130_000, 'recovery');
const canonicalPending = api.canonicalPhaseTimeRuntimeSnapshot(pendingRuntime.snapshot());
check(canonicalPending.state === 'gap-pending' && canonicalPending.pendingGap.gapMs === 130_000, 'Pending gap did not survive canonical persistence');
mustFail(() => api.canonicalPhaseTimeRuntimeSnapshot({...canonicalPending,state:'running'}), 'Inconsistent pending-gap state was accepted');
mustFail(() => api.canonicalPhaseTimeRuntimeSnapshot({...canonicalPending,activeByPhase:{...canonicalPending.activeByPhase,attempt:-1}}), 'Negative phase time was accepted');

mustFail(() => api.canonicalActiveRetrievalSession({
  schemaVersion:1,id:'current',revision:1,status:'active',queueTargetIds:['o1'],activeIndex:0,activeTargetId:'o1',phase:'attempt',
  draft:{phase:'attempt',values:{},checked:{},diagramStrokes:[],attemptElapsedMs:0},timeRuntime:pendingRuntime.snapshot(),elapsedMs:999999,
  startedAt:new Date(t0).toISOString(),updatedAt:new Date(t0+130000).toISOString(),
}), 'Mismatched active-session elapsed time was accepted');
const activeSession = api.canonicalActiveRetrievalSession({
  schemaVersion:1,id:'current',revision:1,status:'active',queueTargetIds:['o1'],activeIndex:0,activeTargetId:'o1',phase:'attempt',
  draft:{phase:'attempt',values:{},checked:{},diagramStrokes:[],attemptElapsedMs:0},timeRuntime:pendingRuntime.snapshot(),elapsedMs:0,
  startedAt:new Date(t0).toISOString(),updatedAt:new Date(t0+130000).toISOString(),
});
check(activeSession.elapsedMs === 0 && activeSession.timeRuntime.pendingGap, 'Current active-session timing was not preserved');

const obligation = { id:'o1', unitId:'u1', workflow:{kind:'recall'}, expectedMinutes:10 };
const unreliableObservation = api.durationObservationFor(obligation, [], 10*60_000, false);
check(!unreliableObservation.accepted && unreliableObservation.reason === 'unreliable-interruption' && unreliableObservation.estimateAfter === 10, 'Uncertain time trained the duration estimator');
const reliableObservation = api.durationObservationFor(obligation, [], 10*60_000, true);
check(reliableObservation.accepted && reliableObservation.reason === 'accepted', 'Reliable active time was rejected');

mustFail(() => api.canonicalPhaseTimeRuntimeSnapshot({...canonicalPending,pendingGap:{...canonicalPending.pendingGap,gapMs:120000}}), 'Threshold-sized pending gap was accepted');
mustFail(() => api.canonicalPhaseTimeRuntimeSnapshot({...api.phaseTimeSnapshot('attempt',false,t0),backwardClockCount:Number.NaN}), 'Non-finite backward-clock count was accepted');
const badPause = api.phaseTimeSnapshot('attempt',false,t0);
badPause.pauseHistory=[{id:'pause_bad',reason:'manual',phase:'attempt',startedAt:new Date(t0+1000).toISOString(),endedAt:new Date(t0).toISOString(),durationMs:1000}];
mustFail(() => api.canonicalPhaseTimeRuntimeSnapshot(badPause), 'Backward pause chronology was accepted');
mustFail(() => api.canonicalTimingEvidenceSummary({...runtime.summary(t0+70000),reliabilityFlags:[]}), 'Missing backward-clock reliability flag was repaired instead of rejected');
mustFail(() => api.canonicalTimingEvidenceSummary({...ignoreRuntime.summary(t0+182000),durationReliable:true}), 'Inconsistent timing reliability was repaired instead of rejected');
const badTransition = api.phaseTimeSnapshot('attempt',false,t0);
badTransition.phaseHistory=[{from:'attempt',to:'compare',at:new Date(t0+1000).toISOString(),reason:'source-reveal'}];
mustFail(() => api.canonicalPhaseTimeRuntimeSnapshot(badTransition), 'Missing transition visibility was coerced instead of rejected');
const badDraftSession = {
  schemaVersion:1,id:'current',revision:1,status:'active',queueTargetIds:['o1'],activeIndex:0,activeTargetId:'o1',phase:'attempt',
  draft:{phase:'attempt',values:{},checked:{x:'false'},diagramStrokes:[],attemptElapsedMs:0},timeRuntime:api.phaseTimeSnapshot('attempt',false,t0),elapsedMs:0,
  startedAt:new Date(t0).toISOString(),updatedAt:new Date(t0).toISOString(),
};
mustFail(() => api.canonicalActiveRetrievalSession(badDraftSession), 'Non-boolean review check state was coerced instead of rejected');

console.log(`PASS ${checks} phase-time runtime phase-time runtime checks`);
