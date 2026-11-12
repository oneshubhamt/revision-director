'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_FSRS_VERIFY__ = { FsrsMemoryPolicy, RevisionService, Rating, prepareFsrsScheduler, revisionSchedulerPort, memoryReviewObservationsFor, validateFsrsOptimizerProfile, validateFsrsConfigSnapshot, fsrsConfigSnapshot, canonicalFsrsSchedulingPolicy, FSRS7_DEFAULT_WEIGHTS, buildPlanningCandidate, activeFsrsOptimizerProfile, fsrsOptimizerEvidenceRows, fsrsOptimizerEvidenceSnapshot };';
if (!source.includes('void boot();')) throw new Error('Boot marker missing');
source = source.replace('void boot();', hook);
const vendor = fs.readFileSync(path.join(root, 'vendor', 'ts-fsrs-6.0.0', 'index.umd.js'), 'utf8');
const context = { crypto:webcrypto, structuredClone, console, Date, Intl, URL, Blob, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set, Math, Number, String, Object, Array, JSON, Error, Promise, Int32Array, Uint8Array };
context.window=context; context.self=context; context.globalThis=context;
vm.createContext(context);
vm.runInContext(vendor, context, { filename:'ts-fsrs-6.0.0.umd.js' });
vm.runInContext(source, context, { filename:'app.js' });
const api=context.__RD_FSRS_VERIFY__;
if (!api) throw new Error('FSRS verification API unavailable');

let checks=0;
const clone=value=>structuredClone(value);
const fixed=desiredRetention=>({kind:'fixed-retention',desiredRetention});
const costAdr=()=>({kind:'cost-adr',goalCostWeight:64,costAdrPolicy:{coefficients:[-0.202,9.14,-0.0978,0.226,-5.31,-7.44,24.1,-0.375,1.81,-22.9,-5.82,22.3,1.72,-1.99,-19.4],costWeightMin:0,costWeightMax:1024,retentionMin:.3,retentionMax:.995,bounds:{sMin:.0001,sMax:36500,dMin:1,dMax:10}}});
function check(value,message){ checks++; if(!value) throw new Error(message); }
function mustFail(fn,message){ let failed=false; try{fn();}catch{failed=true;} check(failed,message); }
async function mustReject(fn,message){ let failed=false; try{await fn();}catch{failed=true;} check(failed,message); }

const recallWorkflow={kind:'recall',prompt:'Recall the target completely before comparison.',checkpoints:['Core fact','Mechanism','Discriminator'],responseMedium:'oral'};
const timing={totalActiveMs:600000,activeByPhase:{attempt:600000,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]};
const durationObservation={plannedMinutes:15,actualMinutes:10,accepted:true,reason:'accepted',estimateBefore:15,estimateAfter:15,exactSamples:0,unitWorkflowSamples:0,globalWorkflowSamples:0};
const ratingEvidence=rating=>rating===api.Rating.Hard
  ? {completeness:3,independence:3,application:2,errorTypes:['slow-retrieval'],correctionNote:'Recovered after a minor cue.'}
  : rating===api.Rating.Again
    ? {completeness:1,independence:1,application:1,errorTypes:['conceptual-misunderstanding'],correctionNote:'Core recall failed.'}
    : {completeness:4,independence:4,application:rating===api.Rating.Easy?4:3,errorTypes:[],correctionNote:''};
const recallResult=rating=>({
  kind:'recall',responseMedium:'oral',attemptText:'',checkpointTotal:3,
  checkpointsMet:rating===api.Rating.Again?1:rating===api.Rating.Hard?2:3,
  cueLevel:rating===api.Rating.Again?'major':rating===api.Rating.Hard?'minor':'none'
});

function optimizerProfile(sourceSha256='b'.repeat(64)){
  const weights=[...api.FSRS7_DEFAULT_WEIGHTS];
  weights[2]=4.2;
  return api.validateFsrsOptimizerProfile({
    schema:'revision-director-fsrs-profile/v1',model:'FSRS-7',bindingVersion:'0.6.1',
    trainedAt:'2026-11-11T00:00:00.000Z',sourceSha256,evidenceItems:384,weights,
    evaluation:{
      crossValidation:{logLoss:.39,rmseBins:.07},
      holdout:{strategy:'final-sixth',trainItems:320,holdoutItems:64,holdoutCards:16,
        minimumTrainItems:64,minimumHoldoutItems:64,minimumHoldoutCards:16,
        stock:{logLoss:.42,rmseBins:.08},personalized:{logLoss:.40,rmseBins:.08},gate:'passed'}
    },
    training:{enableShortTerm:true,enableSchedPenalties:true,numRelearningSteps:1,chronology:'elapsed-24h',
      converterFixedUtcOffsetMinutes:0,converterRolloverHour:0,runtimeLearningSteps:['1d'],
      runtimeRelearningSteps:['1d'],validationCandidateTrainedItems:320,finalRetrainedOnAllEvidence:true}
  });
}

function directEvent(payload, before, completion, rating, reviewedAt, sequence){
  const unit=payload.units.find(item=>item.id===before.unitId);
  if(!unit) throw new Error('Unit missing');
  return {
    schemaVersion:1,id:'memory-evidence-'+sequence,profileId:unit.profileId,unitId:before.unitId,
    obligationId:before.id,obligationType:'memory-recall',reviewedAt,elapsedMs:600000,
    evidence:ratingEvidence(rating),workflow:'recall',workflowResult:recallResult(rating),
    suggestedRating:rating,confirmedRating:rating,beforeDueAt:before.dueAt,afterDueAt:completion.dueAt,
    beforePolicyState:clone(before.policyState),afterPolicyState:clone(completion.policyState),
    policyId:completion.policyId,schedulerPackage:'ts-fsrs',schedulerVersion:'6.0.0',schedulerModel:'FSRS-7',
    schedulerConfig:clone(completion.schedulerConfig),reviewLog:clone(completion.reviewLog),
    durationObservation:clone(durationObservation),timing:clone(timing),createdAt:reviewedAt
  };
}

async function appendDirectReview(payload, obligation, events, policy, rating, reviewedAt){
  const before=clone(obligation);
  const history=api.memoryReviewObservationsFor(obligation.id,events);
  const completion=policy.complete(obligation,rating,ratingEvidence(rating),new Date(reviewedAt),{memoryReviews:history});
  obligation.dueAt=completion.dueAt;
  obligation.policyState=clone(completion.policyState);
  obligation.updatedAt=reviewedAt;
  const event=directEvent(payload,before,completion,rating,reviewedAt,events.length+1);
  events.push(event);
  return event;
}

function buildRepositoryPayload(){
  const payload=JSON.parse(fs.readFileSync(path.join(root,'tests','fixtures','browser-baseline.json'),'utf8'));
  payload.dailyPlans=[];
  payload.chunks=[];
  payload.activeRetrieval=null;
  payload.evidenceEvents=[];
  return payload;
}

class MemoryRepo {
  constructor(payload){
    this.replaceFromBackupCalls=0;
    this.replaceSettingsAndObligationsCalls=0;
    this.failNextSettingsPut=false;
    this.failNextReplaceSettingsAndObligations=false;
    this.failNextReplaceFromBackup=false;
    this.load(payload);
  }
  load(payload){
    for(const name of ['profiles','nodes','units','studyEvents','obligations','evidenceEvents','chunks','dailyPlans']) this[name]=clone(payload[name]||[]);
    this.settings=clone(payload.settings);
    this.activeRetrieval=clone(payload.activeRetrieval??null);
  }
  async getAll(store){ return clone(this[store]||[]); }
  async get(store,key){
    if(store==='settings') return key==='app'?clone(this.settings):undefined;
    if(store==='activeRetrieval') return key==='current'&&this.activeRetrieval?clone(this.activeRetrieval):undefined;
    const rows=this[store]||[];
    return clone(rows.find(item=>item.id===key));
  }
  async put(store,value){
    if(store==='settings'&&this.failNextSettingsPut){
      this.failNextSettingsPut=false;
      throw new Error('Injected settings write failure');
    }
    if(store==='settings'){ this.settings=clone(value); return; }
    if(store==='activeRetrieval'){ this.activeRetrieval=clone(value); return; }
    const rows=this[store]||[];
    const index=rows.findIndex(item=>item.id===value.id);
    if(index>=0) rows[index]=clone(value); else rows.push(clone(value));
    this[store]=rows;
  }
  async replaceSettingsAndObligations(settings,updatedObligations){
    this.replaceSettingsAndObligationsCalls++;
    if(this.failNextReplaceSettingsAndObligations){
      this.failNextReplaceSettingsAndObligations=false;
      throw new Error('Injected settings/obligations transaction failure');
    }
    const updates=new Map(updatedObligations.map(item=>[item.id,clone(item)]));
    this.obligations=this.obligations.map(item=>updates.get(item.id)||item);
    this.settings=clone(settings);
  }
  async replaceFromBackup(payload,activeTreatment){
    this.replaceFromBackupCalls++;
    if(this.failNextReplaceFromBackup){
      this.failNextReplaceFromBackup=false;
      throw new Error('Injected restore transaction failure');
    }
    this.load({...payload,activeRetrieval:activeTreatment==='restore'?payload.activeRetrieval:null});
  }
}

function memoryObligation(payload){
  const item=payload.obligations.find(value=>value.type==='memory-recall');
  if(!item) throw new Error('Baseline memory obligation missing');
  return item;
}
function memoryUnit(payload,obligation){
  const item=payload.units.find(value=>value.id===obligation.unitId);
  if(!item) throw new Error('Baseline memory unit missing');
  return item;
}
function memoryProfile(payload,unit){
  const item=payload.profiles.find(value=>value.id===unit.profileId);
  if(!item) throw new Error('Baseline memory profile missing');
  return item;
}

async function testSchedulingPolicyBoundary(){
  const fixedConfig=api.fsrsConfigSnapshot(fixed(.9),null);
  const adaptive=api.canonicalFsrsSchedulingPolicy(costAdr());
  const adaptiveConfig=api.fsrsConfigSnapshot(adaptive,null);
  check(fixedConfig.schedulingPolicy.kind==='fixed-retention'&&fixedConfig.schedulingPolicy.desiredRetention===.9,'Fixed-retention policy must be explicit in scheduler provenance');
  check(adaptiveConfig.schedulingPolicy.kind==='cost-adr'&&adaptiveConfig.fingerprint!==fixedConfig.fingerprint,'Policy kind and Cost-ADR parameters must participate in scheduler identity');
  const changedGoal=clone(adaptiveConfig); changedGoal.schedulingPolicy.goalCostWeight=65;
  mustFail(()=>api.validateFsrsConfigSnapshot(changedGoal),'Changing Cost-ADR goal weight without recomputing provenance must fail');
  const changedCoefficient=clone(adaptiveConfig); changedCoefficient.schedulingPolicy.costAdrPolicy.coefficients[0]-=.001;
  mustFail(()=>api.validateFsrsConfigSnapshot(changedCoefficient),'Changing a Cost-ADR coefficient without recomputing provenance must fail');
  const overflowingDifficulty=costAdr(); overflowingDifficulty.costAdrPolicy.bounds={sMin:.0001,sMax:36500,dMin:-1e308,dMax:1e308};
  mustFail(()=>api.canonicalFsrsSchedulingPolicy(overflowingDifficulty),'Cost-ADR validation must reject a non-finite difficulty span exactly as upstream does');
  const profile=optimizerProfile();
  const personalized=api.fsrsConfigSnapshot(fixed(.9),profile);
  check(JSON.stringify(personalized.schedulingPolicy)===JSON.stringify(fixedConfig.schedulingPolicy)&&personalized.fingerprint!==fixedConfig.fingerprint,'Weight personalization must be orthogonal to scheduling policy while still changing scheduler identity');
  await mustReject(()=>api.prepareFsrsScheduler(adaptive),'Cost-ADR policy must fail closed until its runtime is deliberately enabled');
}

async function realisticHistory(){
  const payload=buildRepositoryPayload();
  const obligation=memoryObligation(payload);
  const unit=memoryUnit(payload,obligation);
  const events=[];
  await api.prepareFsrsScheduler(fixed(.9));
  const policy=new api.FsrsMemoryPolicy(()=>fixed(.9));
  const start=new Date(obligation.dueAt).getTime();
  const schedule=[
    [api.Rating.Good,0],
    [api.Rating.Good,4],
    [api.Rating.Hard,11],
    [api.Rating.Easy,18],
    [api.Rating.Good,33],
    [api.Rating.Hard,49],
  ];
  for(const [rating,days] of schedule){
    await appendDirectReview(payload,obligation,events,policy,rating,new Date(start+days*86400000).toISOString());
  }
  payload.evidenceEvents=events;
  unit.evidenceCount=events.length;
  unit.lapseCount=0;
  obligation.durationSampleCount=events.length;
  api.revisionSchedulerPort(fixed(.9)).verifyProjection(obligation.policyState.fsrsCard,api.memoryReviewObservationsFor(obligation.id,events));
  check(obligation.policyState.fsrsCard.reps===events.length,'Realistic replay must preserve every review');
  check(obligation.policyState.fsrsCard.lastReviewAt===events.at(-1).reviewedAt,'Realistic replay must preserve final review time');
  return {payload,obligation,unit,events};
}

async function testReturnedMemoryReplay(){
  await api.prepareFsrsScheduler(fixed(.9));
  const policy=new api.FsrsMemoryPolicy(()=>fixed(.9));
  const id='returned-memory';
  const start='2026-09-01T08:00:00.000Z';
  let obligation={id,unitId:'u',type:'memory-recall',status:'active',dueAt:start,expectedMinutes:15,baselineMinutes:15,durationSampleCount:0,
    protocol:'Recall',successCriteria:'Complete recall',workflow:clone(recallWorkflow),freshnessDays:30,priority:0,
    policyState:policy.createInitialState(start,id),createdAt:start,updatedAt:start};
  const failed=policy.complete(obligation,api.Rating.Again,ratingEvidence(api.Rating.Again),new Date(start),{memoryReviews:[]});
  const failedEvent={id:'returned-fail',obligationId:id,obligationType:'memory-recall',reviewedAt:start,confirmedRating:api.Rating.Again,
    beforePolicyState:clone(obligation.policyState),afterPolicyState:clone(failed.policyState),schedulerConfig:clone(failed.schedulerConfig)};
  obligation={...obligation,dueAt:failed.dueAt,policyState:clone(failed.policyState)};
  const history=api.memoryReviewObservationsFor(id,[failedEvent]);
  const returnedAt=new Date(new Date(start).getTime()+86400000).toISOString();
  const repaired=policy.complete(obligation,api.Rating.Good,ratingEvidence(api.Rating.Good),new Date(returnedAt),{memoryReviews:history});
  const returnEvent={id:'returned-success',obligationId:'relearn',obligationType:'relearn',reviewedAt:returnedAt,
    returnedMemoryTransition:{obligationId:id,rating:api.Rating.Good,beforeDueAt:obligation.dueAt,afterDueAt:repaired.dueAt,
      beforePolicyState:clone(obligation.policyState),afterPolicyState:clone(repaired.policyState),policyId:repaired.policyId,
      schedulerPackage:'ts-fsrs',schedulerVersion:'6.0.0',schedulerModel:'FSRS-7',schedulerConfig:clone(repaired.schedulerConfig),reviewLog:clone(repaired.reviewLog)}};
  const canonical=api.memoryReviewObservationsFor(id,[failedEvent,returnEvent]);
  check(canonical.length===2&&canonical[0].source==='direct-memory'&&canonical[1].source==='relearning-return','Returned memory must be canonical replay evidence');
  returnEvent.timing={...clone(timing),totalActiveMs:1140000,activeByPhase:{attempt:0,compare:300000,'relearn-repair':600000,'relearn-verify':240000}};
  returnEvent.elapsedMs=1140000;
  const returnedOptimizerRow=api.fsrsOptimizerEvidenceRows([returnEvent])[0];
  check(returnedOptimizerRow.source==='relearning-return'&&returnedOptimizerRow.durationPhase==='relearn-verify'&&returnedOptimizerRow.durationMs===240000,'Returned-memory optimizer cost must use closed-book verification time only');
  api.revisionSchedulerPort(fixed(.9)).verifyProjection(repaired.policyState.fsrsCard,canonical); checks++;
  const corrupted=clone(returnEvent);
  corrupted.returnedMemoryTransition.beforePolicyState.fsrsCard.reps+=1;
  mustFail(()=>api.memoryReviewObservationsFor(id,[failedEvent,corrupted]),'Returned-memory corruption must fail chain validation');
}



async function testCanonicalOptimizerEvidence(){
  const built=await realisticHistory();
  const events=clone(built.events.slice(0,3));
  events[0].timing={...clone(timing),totalActiveMs:900000,activeByPhase:{attempt:300000,compare:600000,'relearn-repair':0,'relearn-verify':0}};
  events[0].elapsedMs=900000;
  events[1].timing={...clone(timing),totalActiveMs:720000,activeByPhase:{attempt:420000,compare:300000,'relearn-repair':0,'relearn-verify':0},ignoredGapMs:120000,durationReliable:false,reliabilityFlags:['ignored-gap']};
  events[1].elapsedMs=720000;
  events[2].timing={...clone(timing),totalActiveMs:480000,activeByPhase:{attempt:300000,compare:180000,'relearn-repair':0,'relearn-verify':0},backwardClockCount:1,durationReliable:true,reliabilityFlags:['backward-clock']};
  events[2].elapsedMs=480000;
  const rows=api.fsrsOptimizerEvidenceRows(events);
  check(rows.length===3,'Canonical optimizer evidence lost recall outcomes');
  check(rows[0].durationPhase==='attempt'&&rows[0].durationMs===300000&&rows[0].durationReliable===true,'Direct-memory optimizer cost must use closed-book attempt time rather than full workflow time');
  check(rows[1].durationMs===0&&rows[1].durationReliable===false,'Ignored-gap optimizer timing must retain the review with unavailable duration');
  check(rows[2].durationMs===0&&rows[2].durationReliable===false,'Backward-clock optimizer timing must retain the review with unavailable duration');
  const snapshot=await api.fsrsOptimizerEvidenceSnapshot(events);
  check(snapshot.summary.reviews===3&&snapshot.summary.reliableDurations===1&&snapshot.summary.unavailableDurations===2,'Optimizer evidence reliability summary is incorrect');
  check(/^[a-f0-9]{64}$/.test(snapshot.sourceSha256),'Canonical optimizer evidence snapshot lacks SHA-256 identity');
  check(snapshot.csv.includes(',300000,')&&snapshot.csv.split(',0,').length>=3,'Canonical optimizer CSV did not encode retrieval-only and unavailable durations');
}

async function testTransactionalSettingsPublication(){
  const built=await realisticHistory();
  const repo=new MemoryRepo(built.payload);
  const service=new api.RevisionService(repo);
  await service.initialize();
  const baseline=service.getSettings();
  const baselineRepo=clone(repo.settings);

  const ordinary=clone(baseline);
  ordinary.dailyCapacityMinutes=baseline.dailyCapacityMinutes===600?599:baseline.dailyCapacityMinutes+1;
  repo.failNextSettingsPut=true;
  await mustReject(()=>service.saveSettings(ordinary),'Failed ordinary settings write must reject');
  check(JSON.stringify(service.getSettings())===JSON.stringify(baseline),'Failed ordinary settings write leaked into in-memory settings');
  check(JSON.stringify(repo.settings)===JSON.stringify(baselineRepo),'Failed ordinary settings write mutated durable settings');
  const ordinaryReload=new api.RevisionService(repo);
  await ordinaryReload.initialize();
  check(JSON.stringify(ordinaryReload.getSettings())===JSON.stringify(baseline),'Reload after failed ordinary settings write did not recover durable settings');

  const profile=optimizerProfile((await service.optimizerEvidenceSnapshot()).sourceSha256);
  repo.failNextSettingsPut=true;
  await mustReject(()=>service.stageFsrsOptimizerProfile(profile),'Failed optimizer-profile staging write must reject');
  check(service.getSettings().fsrsPersonalization.profile===null,'Failed optimizer staging leaked into in-memory personalization');
  check(repo.settings.fsrsPersonalization.profile===null,'Failed optimizer staging mutated durable personalization');
  const stageReload=new api.RevisionService(repo);
  await stageReload.initialize();
  check(stageReload.getSettings().fsrsPersonalization.profile===null,'Reload after failed optimizer staging did not recover stock personalization');

  await service.stageFsrsOptimizerProfile(profile);
  const staged=service.getSettings();
  repo.failNextSettingsPut=true;
  await mustReject(()=>service.clearFsrsOptimizerProfile(),'Failed optimizer-profile clear write must reject');
  check(JSON.stringify(service.getSettings())===JSON.stringify(staged),'Failed optimizer clear leaked into in-memory personalization');
  check(JSON.stringify(repo.settings)===JSON.stringify(staged),'Failed optimizer clear mutated durable personalization');

  const beforeRebase=service.getSettings();
  const obligationsBefore=JSON.stringify(repo.obligations);
  const rebaseRequest=clone(beforeRebase);
  rebaseRequest.fsrsScheduling={...rebaseRequest.fsrsScheduling,policy:fixed(.95)};
  repo.failNextReplaceSettingsAndObligations=true;
  await mustReject(()=>service.saveSettings(rebaseRequest),'Failed scheduler rebase transaction must reject');
  check(JSON.stringify(service.getSettings())===JSON.stringify(beforeRebase),'Failed scheduler rebase leaked into in-memory settings');
  check(JSON.stringify(repo.settings)===JSON.stringify(beforeRebase),'Failed scheduler rebase mutated durable settings');
  check(JSON.stringify(repo.obligations)===obligationsBefore,'Failed scheduler rebase partially mutated obligations');
  const rebaseReload=new api.RevisionService(repo);
  await rebaseReload.initialize();
  check(JSON.stringify(rebaseReload.getSettings())===JSON.stringify(beforeRebase),'Reload after failed scheduler rebase did not recover durable settings');

  const restoreCandidate=buildRepositoryPayload();
  restoreCandidate.settings.dailyCapacityMinutes=beforeRebase.dailyCapacityMinutes===600?599:beforeRebase.dailyCapacityMinutes+1;
  const serviceBeforeRestore=service.getSettings();
  const repoBeforeRestore=clone(repo.settings);
  const obligationsBeforeRestore=JSON.stringify(repo.obligations);
  repo.failNextReplaceFromBackup=true;
  await mustReject(()=>service.restoreBackupPayload(restoreCandidate,'discard'),'Failed restore transaction must reject');
  check(JSON.stringify(service.getSettings())===JSON.stringify(serviceBeforeRestore),'Failed restore leaked candidate settings into memory');
  check(JSON.stringify(repo.settings)===JSON.stringify(repoBeforeRestore),'Failed restore mutated durable settings');
  check(JSON.stringify(repo.obligations)===obligationsBeforeRestore,'Failed restore partially replaced obligations');
  const restoreReload=new api.RevisionService(repo);
  await restoreReload.initialize();
  check(JSON.stringify(restoreReload.getSettings())===JSON.stringify(serviceBeforeRestore),'Reload after failed restore did not recover pre-restore settings');
}

async function testRebasesBackupRestorePlannerAndCorruption(){
  const built=await realisticHistory();
  const repo=new MemoryRepo(built.payload);
  const service=new api.RevisionService(repo);
  await service.initialize();
  const evidenceBefore=JSON.stringify(repo.evidenceEvents);

  const stockObligation=memoryObligation(repo);
  const stockDue=stockObligation.dueAt;
  const beforePolicyChange=service.getSettings();
  await service.saveSettings({...beforePolicyChange,fsrsScheduling:{...beforePolicyChange.fsrsScheduling,policy:fixed(.95)}});
  check(service.getSettings().fsrsScheduling.lastRebase.reason==='scheduler-policy-change','Scheduling-policy change must record an explicit rebase');
  check(service.getSettings().fsrsPersonalization.active===false,'Fixed-retention change must remain orthogonal to stock/personalized weights');
  check(service.getSettings().fsrsScheduling.lastRebase.fromConfigFingerprint!==service.getSettings().fsrsScheduling.lastRebase.toConfigFingerprint,'Scheduling-policy rebase must record distinct scheduler identities');
  check(JSON.stringify(repo.evidenceEvents)===evidenceBefore,'Retention rebase must not rewrite historical evidence');
  const retentionObligation=memoryObligation(repo);
  api.revisionSchedulerPort(fixed(.95)).verifyProjection(retentionObligation.policyState.fsrsCard,api.memoryReviewObservationsFor(retentionObligation.id,repo.evidenceEvents)); checks++;
  check(retentionObligation.policyState.fsrsCard.reps===built.events.length,'Retention rebase must preserve review count');

  const evidenceSnapshot=await service.optimizerEvidenceSnapshot();
  const staleProfile=optimizerProfile('c'.repeat(64));
  await mustReject(()=>service.stageFsrsOptimizerProfile(staleProfile),'Stale optimizer profile must be rejected before staging');
  check(service.getSettings().fsrsPersonalization.profile===null,'Stale optimizer profile mutated personalization state');
  const profile=optimizerProfile(evidenceSnapshot.sourceSha256);
  await service.stageFsrsOptimizerProfile(profile);
  check(service.getSettings().fsrsPersonalization.active===false,'Profile import must remain staging-only');
  const originalTiming=clone(repo.evidenceEvents[0].timing);
  const originalElapsed=repo.evidenceEvents[0].elapsedMs;
  repo.evidenceEvents[0].timing.activeByPhase.attempt+=1000;
  repo.evidenceEvents[0].timing.totalActiveMs+=1000;
  repo.evidenceEvents[0].elapsedMs+=1000;
  await mustReject(()=>service.activateFsrsOptimizerProfile(),'Staged optimizer profile must be rejected if review evidence changes before activation');
  repo.evidenceEvents[0].timing=originalTiming;
  repo.evidenceEvents[0].elapsedMs=originalElapsed;
  await service.activateFsrsOptimizerProfile();
  check(service.getSettings().fsrsPersonalization.active===true,'Profile activation must be explicit');
  check(service.getSettings().fsrsScheduling.lastRebase.reason==='activate-profile','Profile activation must record an explicit scheduler rebase');
  check(repo.replaceSettingsAndObligationsCalls===2,'Retention and profile changes must each use the shared atomic settings/obligations replacement');

  let activeObligation=memoryObligation(repo);
  const activeProfile=api.activeFsrsOptimizerProfile(service.getSettings());
  const activePolicy=new api.FsrsMemoryPolicy(()=>service.getSettings().fsrsScheduling.policy,()=>activeProfile);
  const boundaryReviewAt=new Date(activeObligation.dueAt).toISOString();
  const boundaryEvent=await appendDirectReview(repo,activeObligation,repo.evidenceEvents,activePolicy,api.Rating.Good,boundaryReviewAt);
  await repo.put('obligations',activeObligation);
  const activeUnit=memoryUnit(repo,activeObligation);
  activeUnit.evidenceCount=repo.evidenceEvents.length;
  activeObligation.durationSampleCount=repo.evidenceEvents.length;
  await repo.put('units',activeUnit);
  await repo.put('obligations',activeObligation);
  const mixed=api.memoryReviewObservationsFor(activeObligation.id,repo.evidenceEvents);
  check(new Set(mixed.map(item=>item.configFingerprint)).size===2,'Realistic history must preserve stock-to-personalized configuration boundary');
  api.revisionSchedulerPort(fixed(.95),profile).verifyProjection(activeObligation.policyState.fsrsCard,mixed); checks++;

  const profileDue=activeObligation.dueAt;
  const joined={obligation:clone(activeObligation),unit:clone(activeUnit),profile:clone(memoryProfile(repo,activeUnit)),subject:'Microbiology',section:'Bacteriology',topic:'Staphylococcus aureus'};
  const plannerReference=new Date(profileDue);
  const plannerDueBefore=joined.obligation.dueAt;
  const candidate=api.buildPlanningCandidate(joined,clone(repo.evidenceEvents),service.getSettings(),plannerReference);
  check(candidate&&candidate.factors.dueRisk>0,'Planner must consume the reprojected personalized memory state');
  check(joined.obligation.dueAt===plannerDueBefore,'Planner must never rewrite the scheduler due date');

  const archive=await service.createBackupArchive(false);
  check(archive.inspection.verified===true&&archive.inspection.compression==='none','Personalized history must create a verified uncompressed backup archive');
  const decoded=await service.decodeBackupArchive(archive.bytes);
  const payload=decoded.payload;
  check(decoded.inspection.stateChecksum===archive.inspection.stateChecksum,'Backup archive round-trip must preserve the state checksum');
  check(payload.settings.fsrsPersonalization.active===true,'Backup must preserve active personalization');
  check(payload.evidenceEvents.length===repo.evidenceEvents.length,'Backup must preserve complete immutable review history');

  const restoreRepo=new MemoryRepo(buildRepositoryPayload());
  const restored=new api.RevisionService(restoreRepo);
  await restored.restoreBackupPayload(payload,'discard');
  await restored.initialize();
  const restoredObligation=memoryObligation(restoreRepo);
  const restoredHistory=api.memoryReviewObservationsFor(restoredObligation.id,restoreRepo.evidenceEvents);
  api.revisionSchedulerPort(fixed(.95),profile).verifyProjection(restoredObligation.policyState.fsrsCard,restoredHistory); checks++;
  check(restored.getSettings().fsrsPersonalization.active===true,'Restore must rehydrate active personalization');
  check(restoreRepo.replaceFromBackupCalls===1,'Valid personalized backup must restore exactly once');

  const corruptProjection=clone(payload);
  memoryObligation(corruptProjection).policyState.fsrsCard.stability+=.25;
  const rejectRepo=new MemoryRepo(buildRepositoryPayload());
  const rejectService=new api.RevisionService(rejectRepo);
  await mustReject(()=>rejectService.restoreBackupPayload(corruptProjection,'discard'),'Restore must reject a corrupted materialized FSRS projection');
  check(rejectRepo.replaceFromBackupCalls===0,'Corrupt projection must fail before replacement');

  const corruptBoundary=clone(payload);
  const personalizedEvent=corruptBoundary.evidenceEvents.find(event=>event.schedulerConfig?.weightsSource==='optimizer-profile');
  check(Boolean(personalizedEvent),'Backup fixture must contain a personalized review boundary');
  personalizedEvent.beforePolicyState.fsrsCard.stability+=.25;
  const boundaryRepo=new MemoryRepo(buildRepositoryPayload());
  const boundaryService=new api.RevisionService(boundaryRepo);
  await mustReject(()=>boundaryService.restoreBackupPayload(corruptBoundary,'discard'),'Restore must reject a corrupted configuration-boundary before-state');
  check(boundaryRepo.replaceFromBackupCalls===0,'Boundary corruption must fail before replacement');

  const corruptConfig=clone(payload);
  corruptConfig.evidenceEvents[0].schedulerConfig.fingerprint='fnv1a64:0000000000000000';
  const configRepo=new MemoryRepo(buildRepositoryPayload());
  const configService=new api.RevisionService(configRepo);
  await mustReject(()=>configService.restoreBackupPayload(corruptConfig,'discard'),'Restore must reject scheduler provenance corruption');
  check(configRepo.replaceFromBackupCalls===0,'Scheduler provenance corruption must fail before replacement');

  const immutableCount=restoreRepo.evidenceEvents.length;
  await restored.deactivateFsrsOptimizerProfile();
  const stockRestored=memoryObligation(restoreRepo);
  api.revisionSchedulerPort(fixed(.95)).verifyProjection(stockRestored.policyState.fsrsCard,api.memoryReviewObservationsFor(stockRestored.id,restoreRepo.evidenceEvents)); checks++;
  check(restored.getSettings().fsrsPersonalization.active===false,'Deactivation after restore must return explicitly to stock');
  check(restoreRepo.evidenceEvents.length===immutableCount,'Deactivation must not rewrite or synthesize review evidence');
  check(stockRestored.policyState.fsrsCard.reps===restoredHistory.length,'Return to stock must preserve the complete realistic review history');
  check(stockDue!==''&&profileDue!=='','Independent verification must exercise concrete stock and personalized schedules');

  const boundaryCorruption=clone(boundaryEvent);
  boundaryCorruption.beforePolicyState.fsrsCard.difficulty+=.1;
  const corruptHistory=api.memoryReviewObservationsFor(activeObligation.id,[...repo.evidenceEvents.filter(event=>event.id!==boundaryEvent.id),boundaryCorruption]);
  mustFail(()=>api.revisionSchedulerPort(fixed(.95),profile).verifyProjection(activeObligation.policyState.fsrsCard,corruptHistory),'Active-config replay must reject a tampered reprojected before-state');
}

(async()=>{
  await testSchedulingPolicyBoundary();
  await testReturnedMemoryReplay();
  await testCanonicalOptimizerEvidence();
  await testTransactionalSettingsPublication();
  await testRebasesBackupRestorePlannerAndCorruption();
  console.log(`PASS ${checks} independent FSRS replay/personalization/restore/planner checks`);
})().catch(error=>{ console.error(error); process.exitCode=1; });
