'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_FSRS_VERIFY__ = { FsrsMemoryPolicy, RevisionService, Rating, prepareFsrsScheduler, revisionSchedulerPort, memoryReviewObservationsFor, validateFsrsOptimizerProfile, FSRS7_DEFAULT_WEIGHTS, buildPlanningCandidate, verifyMemoryDatasetIntegrity, activeFsrsOptimizerProfile };';
if (!source.includes('void boot();')) throw new Error('Boot marker missing');
source = source.replace('void boot();', hook);
const vendor = fs.readFileSync(path.join(root, 'vendor', 'ts-fsrs-6.0.0', 'index.umd.js'), 'utf8');
const context = { crypto:webcrypto, structuredClone, console, Date, Intl, URL, Blob, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set, Math, Number, String, Object, Array, JSON, Error, Promise, Int32Array, Uint8Array };
context.window=context; context.self=context; context.globalThis=context;
vm.createContext(context);
vm.runInContext(vendor, context, { filename:'ts-fsrs-6.0.0.umd.js' });
vm.runInContext(source, context, { filename:'app.js' });
const api=context.__RD_FSRS_VERIFY__;
if (!api) throw new Error('FSRS verification API unavailable');

let checks=0;
const clone=value=>structuredClone(value);
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

function optimizerProfile(){
  const weights=[...api.FSRS7_DEFAULT_WEIGHTS];
  weights[2]=4.2;
  return api.validateFsrsOptimizerProfile({
    schema:'revision-director-fsrs-profile/v1',model:'FSRS-7',bindingVersion:'0.6.1',
    trainedAt:'2026-11-11T00:00:00.000Z',sourceSha256:'b'.repeat(64),evidenceItems:384,weights,
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
    evidence:ratingEvidence(rating),workflow:clone(recallWorkflow),workflowResult:recallResult(rating),
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
    this.replaceMemorySchedulingCalls=0;
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
    if(store==='settings'){ this.settings=clone(value); return; }
    if(store==='activeRetrieval'){ this.activeRetrieval=clone(value); return; }
    const rows=this[store]||[];
    const index=rows.findIndex(item=>item.id===value.id);
    if(index>=0) rows[index]=clone(value); else rows.push(clone(value));
    this[store]=rows;
  }
  async replaceMemoryScheduling(settings,updatedMemory){
    this.replaceMemorySchedulingCalls++;
    const updates=new Map(updatedMemory.map(item=>[item.id,clone(item)]));
    this.obligations=this.obligations.map(item=>updates.get(item.id)||item);
    this.settings=clone(settings);
  }
  async replaceFromBackup(payload,activeTreatment){
    this.replaceFromBackupCalls++;
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

async function realisticHistory(){
  const payload=buildRepositoryPayload();
  const obligation=memoryObligation(payload);
  const unit=memoryUnit(payload,obligation);
  const events=[];
  await api.prepareFsrsScheduler(.9);
  const policy=new api.FsrsMemoryPolicy(()=>.9);
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
  api.revisionSchedulerPort(.9).verifyProjection(obligation.policyState.fsrsCard,api.memoryReviewObservationsFor(obligation.id,events));
  check(obligation.policyState.fsrsCard.reps===events.length,'Realistic replay must preserve every review');
  check(obligation.policyState.fsrsCard.lastReviewAt===events.at(-1).reviewedAt,'Realistic replay must preserve final review time');
  return {payload,obligation,unit,events};
}

async function testReturnedMemoryReplay(){
  await api.prepareFsrsScheduler(.9);
  const policy=new api.FsrsMemoryPolicy(()=>.9);
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
  api.revisionSchedulerPort(.9).verifyProjection(repaired.policyState.fsrsCard,canonical); checks++;
  const corrupted=clone(returnEvent);
  corrupted.returnedMemoryTransition.beforePolicyState.fsrsCard.reps+=1;
  mustFail(()=>api.memoryReviewObservationsFor(id,[failedEvent,corrupted]),'Returned-memory corruption must fail chain validation');
}

async function testRebasesBackupRestorePlannerAndCorruption(){
  const built=await realisticHistory();
  const repo=new MemoryRepo(built.payload);
  const service=new api.RevisionService(repo);
  await service.initialize();
  const evidenceBefore=JSON.stringify(repo.evidenceEvents);

  const stockObligation=memoryObligation(repo);
  const stockDue=stockObligation.dueAt;
  await service.saveSettings({...service.getSettings(),desiredRetention:.95});
  check(service.getSettings().fsrsPersonalization.lastRebase.reason==='retention-change','Retention change must record an explicit rebase');
  check(service.getSettings().fsrsPersonalization.lastRebase.target==='stock','Stock retention change must stay on stock weights');
  check(JSON.stringify(repo.evidenceEvents)===evidenceBefore,'Retention rebase must not rewrite historical evidence');
  const retentionObligation=memoryObligation(repo);
  api.revisionSchedulerPort(.95).verifyProjection(retentionObligation.policyState.fsrsCard,api.memoryReviewObservationsFor(retentionObligation.id,repo.evidenceEvents)); checks++;
  check(retentionObligation.policyState.fsrsCard.reps===built.events.length,'Retention rebase must preserve review count');

  const profile=optimizerProfile();
  await service.stageFsrsOptimizerProfile(profile);
  check(service.getSettings().fsrsPersonalization.active===false,'Profile import must remain staging-only');
  await service.activateFsrsOptimizerProfile();
  check(service.getSettings().fsrsPersonalization.active===true,'Profile activation must be explicit');
  check(service.getSettings().fsrsPersonalization.lastRebase.target==='personalized','Profile activation must record personalized target');
  check(repo.replaceMemorySchedulingCalls===2,'Retention and profile changes must each use atomic projection replacement');

  let activeObligation=memoryObligation(repo);
  const activeProfile=api.activeFsrsOptimizerProfile(service.getSettings());
  const activePolicy=new api.FsrsMemoryPolicy(()=>service.getSettings().desiredRetention,()=>activeProfile);
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
  api.revisionSchedulerPort(.95,profile).verifyProjection(activeObligation.policyState.fsrsCard,mixed); checks++;

  const profileDue=activeObligation.dueAt;
  const joined={obligation:clone(activeObligation),unit:clone(activeUnit),profile:clone(memoryProfile(repo,activeUnit)),subject:'Microbiology',section:'Bacteriology',topic:'Staphylococcus aureus'};
  const plannerReference=new Date(profileDue);
  const plannerDueBefore=joined.obligation.dueAt;
  const candidate=api.buildPlanningCandidate(joined,clone(repo.evidenceEvents),service.getSettings(),plannerReference);
  check(candidate&&candidate.factors.dueRisk>0,'Planner must consume the reprojected personalized memory state');
  check(joined.obligation.dueAt===plannerDueBefore,'Planner must never rewrite the scheduler due date');

  const payload=service.validateBackup(await service.exportBackup());
  check(payload.settings.fsrsPersonalization.active===true,'Backup must preserve active personalization');
  check(payload.evidenceEvents.length===repo.evidenceEvents.length,'Backup must preserve complete immutable review history');

  const restoreRepo=new MemoryRepo(buildRepositoryPayload());
  const restored=new api.RevisionService(restoreRepo);
  await restored.restoreBackupPayload(payload,'discard');
  await restored.initialize();
  const restoredObligation=memoryObligation(restoreRepo);
  const restoredHistory=api.memoryReviewObservationsFor(restoredObligation.id,restoreRepo.evidenceEvents);
  api.revisionSchedulerPort(.95,profile).verifyProjection(restoredObligation.policyState.fsrsCard,restoredHistory); checks++;
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
  api.revisionSchedulerPort(.95).verifyProjection(stockRestored.policyState.fsrsCard,api.memoryReviewObservationsFor(stockRestored.id,restoreRepo.evidenceEvents)); checks++;
  check(restored.getSettings().fsrsPersonalization.active===false,'Deactivation after restore must return explicitly to stock');
  check(restoreRepo.evidenceEvents.length===immutableCount,'Deactivation must not rewrite or synthesize review evidence');
  check(stockRestored.policyState.fsrsCard.reps===restoredHistory.length,'Return to stock must preserve the complete realistic review history');
  check(stockDue!==''&&profileDue!=='','Independent verification must exercise concrete stock and personalized schedules');

  const boundaryCorruption=clone(boundaryEvent);
  boundaryCorruption.beforePolicyState.fsrsCard.difficulty+=.1;
  const corruptHistory=api.memoryReviewObservationsFor(activeObligation.id,[...repo.evidenceEvents.filter(event=>event.id!==boundaryEvent.id),boundaryCorruption]);
  mustFail(()=>api.revisionSchedulerPort(.95,profile).verifyProjection(activeObligation.policyState.fsrsCard,corruptHistory),'Active-config replay must reject a tampered reprojected before-state');
}

(async()=>{
  await testReturnedMemoryReplay();
  await testRebasesBackupRestorePlannerAndCorruption();
  console.log(`PASS ${checks} independent FSRS replay/personalization/restore/planner checks`);
})().catch(error=>{ console.error(error); process.exitCode=1; });
