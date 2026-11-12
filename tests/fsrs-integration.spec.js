'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_FSRS_VERIFY__ = { FsrsMemoryPolicy, RevisionService, Rating, prepareFsrsScheduler, revisionSchedulerPort, memoryReviewObservationsFor, validateFsrsOptimizerProfile, validateFsrsConfigSnapshot, fsrsConfigSnapshot, canonicalFsrsSchedulingPolicy, measuredCostAdrSchedulingPolicy, defaultFsrsSchedulingSettings, FSRS_COST_ADR_MEASURED_GOAL_COST_WEIGHT, FSRS7_DEFAULT_WEIGHTS, buildPlanningCandidate, activeFsrsOptimizerProfile, fsrsOptimizerEvidenceRows, fsrsOptimizerEvidenceSnapshot, fsrsHoldoutDiagnostics };';
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
const costAdr=()=>api.measuredCostAdrSchedulingPolicy();
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

function optimizerProfile(sourceSha256='b'.repeat(64),personalizedLogLoss=.40,personalizedRmse=.08){
  const weights=[...api.FSRS7_DEFAULT_WEIGHTS];
  weights[2]=4.2;
  return api.validateFsrsOptimizerProfile({
    schema:'revision-director-fsrs-profile/v1',model:'FSRS-7',bindingVersion:'0.6.1',
    trainedAt:'2026-11-11T00:00:00.000Z',sourceSha256,evidenceItems:384,weights,
    evaluation:{
      crossValidation:{logLoss:.39,rmseBins:.07},
      holdout:{strategy:'final-sixth',trainItems:320,holdoutItems:64,holdoutCards:16,
        minimumTrainItems:64,minimumHoldoutItems:64,minimumHoldoutCards:16,
        stock:{logLoss:.42,rmseBins:.08},personalized:{logLoss:personalizedLogLoss,rmseBins:personalizedRmse},gate:'passed'}
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
  const defaultScheduling=api.defaultFsrsSchedulingSettings();
  check(defaultScheduling.policy.kind==='cost-adr'&&defaultScheduling.policy.goalCostWeight===1024,'New installations must default to the measured Cost-ADR preset');
  const fixedConfig=api.fsrsConfigSnapshot(fixed(.9),null);
  const adaptive=api.canonicalFsrsSchedulingPolicy(costAdr());
  const adaptiveConfig=api.fsrsConfigSnapshot(adaptive,null);
  check(fixedConfig.schedulingPolicy.kind==='fixed-retention'&&fixedConfig.schedulingPolicy.desiredRetention===.9,'Fixed-retention policy must be explicit in scheduler provenance');
  check(adaptiveConfig.schedulingPolicy.kind==='cost-adr'&&adaptiveConfig.schedulingPolicy.goalCostWeight===1024&&adaptiveConfig.fingerprint!==fixedConfig.fingerprint,'Measured Cost-ADR must participate in scheduler identity');
  check(api.FSRS_COST_ADR_MEASURED_GOAL_COST_WEIGHT===1024,'Measured Cost-ADR goal cost weight must remain pinned to the evaluated preset');
  const changedGoal=costAdr(); changedGoal.goalCostWeight=992;
  mustFail(()=>api.canonicalFsrsSchedulingPolicy(changedGoal),'Unmeasured Cost-ADR goal weights must remain unavailable');
  const changedCoefficient=costAdr(); changedCoefficient.costAdrPolicy.coefficients[0]-=.001;
  mustFail(()=>api.canonicalFsrsSchedulingPolicy(changedCoefficient),'Unmeasured Cost-ADR coefficient variants must remain unavailable');
  const overflowingDifficulty=costAdr(); overflowingDifficulty.costAdrPolicy.bounds={sMin:.0001,sMax:36500,dMin:-1e308,dMax:1e308};
  mustFail(()=>api.canonicalFsrsSchedulingPolicy(overflowingDifficulty),'Cost-ADR validation must reject invalid state bounds');
  await api.prepareFsrsScheduler(adaptive);
  const adaptivePort=api.revisionSchedulerPort(adaptive);
  const adaptiveCard=adaptivePort.newCard('2026-01-01T08:00:00.000Z','adaptive-probe');
  const adaptivePreviews=adaptivePort.preview(adaptiveCard,[],new Date('2026-01-01T08:00:00.000Z'));
  check(adaptivePreviews.length===4&&adaptivePort.configuration.schedulingPolicy.kind==='cost-adr','Measured Cost-ADR runtime must expose the normal FSRS preview surface');
  mustFail(
    ()=>optimizerProfile('b'.repeat(64),.4195,.079),
    'Application profile validation must reject a microscopic holdout log-loss win even when calibration improves'
  );
  mustFail(
    ()=>optimizerProfile('b'.repeat(64),.40,.081),
    'Application profile validation must reject RMSE-bins calibration regression'
  );
  const profile=optimizerProfile();
  const diagnostics=api.fsrsHoldoutDiagnostics(profile.evaluation.holdout.stock,profile.evaluation.holdout.personalized);
  check(diagnostics.logLossImprovement.absolute>=diagnostics.logLossImprovement.required&&diagnostics.calibration.status==='unchanged','Application holdout diagnostics must expose practical discrimination gain and calibration status');
  const personalized=api.fsrsConfigSnapshot(fixed(.9),profile);
  check(JSON.stringify(personalized.schedulingPolicy)===JSON.stringify(fixedConfig.schedulingPolicy)&&personalized.fingerprint!==fixedConfig.fingerprint,'Weight personalization must be orthogonal to scheduling policy while still changing scheduler identity');
  await api.prepareFsrsScheduler(adaptive,profile);
  const adaptivePersonalized=api.fsrsConfigSnapshot(adaptive,profile);
  const adaptivePersonalizedPort=api.revisionSchedulerPort(adaptive,profile);
  const adaptivePersonalizedCard=adaptivePersonalizedPort.newCard('2026-01-02T08:00:00.000Z','adaptive-personalized-probe');
  check(adaptivePersonalized.weightsSource==='optimizer-profile'&&adaptivePersonalized.fingerprint!==adaptiveConfig.fingerprint&&adaptivePersonalizedCard.cardId==='adaptive-personalized-probe','Cost-ADR and personalized FSRS-7 weights must remain independent runtime axes');
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

async function testCostAdrRebase(){
  const built=await realisticHistory();
  const repo=new MemoryRepo(built.payload);
  const service=new api.RevisionService(repo);
  await service.initialize();
  const evidenceBefore=JSON.stringify(repo.evidenceEvents);
  const before=service.getSettings();
  const adaptive=costAdr();
  await service.saveSettings({...before,fsrsScheduling:{...before.fsrsScheduling,policy:adaptive}});
  const adaptiveSettings=service.getSettings();
  check(adaptiveSettings.fsrsScheduling.policy.kind==='cost-adr'&&adaptiveSettings.fsrsScheduling.lastRebase.reason==='scheduler-policy-change','Cost-ADR activation must use the explicit scheduler-policy rebase path');
  check(repo.replaceSettingsAndObligationsCalls===1,'Cost-ADR activation must atomically replace settings and materialized projections once');
  check(JSON.stringify(repo.evidenceEvents)===evidenceBefore,'Cost-ADR rebase must preserve immutable review evidence');
  const adaptiveObligation=memoryObligation(repo);
  api.revisionSchedulerPort(adaptive).verifyProjection(adaptiveObligation.policyState.fsrsCard,api.memoryReviewObservationsFor(adaptiveObligation.id,repo.evidenceEvents)); checks++;
  const adaptiveUnit=memoryUnit(repo,adaptiveObligation);
  const adaptiveJoined={obligation:clone(adaptiveObligation),unit:clone(adaptiveUnit),profile:clone(memoryProfile(repo,adaptiveUnit)),subject:'Microbiology',section:'Bacteriology',topic:'Staphylococcus aureus'};
  const adaptiveDueBefore=adaptiveJoined.obligation.dueAt;
  const adaptiveCandidate=api.buildPlanningCandidate(adaptiveJoined,clone(repo.evidenceEvents),adaptiveSettings,new Date(adaptiveDueBefore));
  check(Boolean(adaptiveCandidate),'Planner must accept Cost-ADR memory without inventing a fixed retention target');
  check(adaptiveJoined.obligation.dueAt===adaptiveDueBefore,'Cost-ADR planning must preserve scheduler-owned dueAt');
  const archive=await service.createBackupArchive(false);
  const decoded=await service.decodeBackupArchive(archive.bytes);
  check(decoded.payload.settings.fsrsScheduling.policy.kind==='cost-adr','Backup must preserve the measured Cost-ADR scheduler identity');

  const restoreRepo=new MemoryRepo(buildRepositoryPayload());
  const restored=new api.RevisionService(restoreRepo);
  await restored.restoreBackupPayload(decoded.payload,'discard');
  await restored.initialize();
  check(restored.getSettings().fsrsScheduling.policy.kind==='cost-adr','Restore must prepare and verify the measured Cost-ADR runtime');

  const current=restored.getSettings();
  await restored.saveSettings({...current,fsrsScheduling:{...current.fsrsScheduling,policy:fixed(.9)}});
  check(restored.getSettings().fsrsScheduling.policy.kind==='fixed-retention','Explicit return from Cost-ADR to fixed retention must succeed through rebase');
  check(restoreRepo.evidenceEvents.length===built.events.length,'Cost-ADR round-trip must not synthesize or drop memory evidence');
}

async function testCorrectiveMemoryVerificationReplay(){
  await api.prepareFsrsScheduler(fixed(.9));
  const policy=new api.FsrsMemoryPolicy(()=>fixed(.9));
  const id='corrective-memory';
  const start='2026-09-01T08:00:00.000Z';
  let obligation={id,unitId:'u',type:'memory-recall',status:'active',dueAt:start,expectedMinutes:15,baselineMinutes:15,durationSampleCount:0,
    protocol:'Recall',successCriteria:'Complete recall',workflow:clone(recallWorkflow),freshnessDays:30,priority:0,
    policyState:policy.createInitialState(start,id),createdAt:start,updatedAt:start};

  const failed=policy.complete(obligation,api.Rating.Again,ratingEvidence(api.Rating.Again),new Date(start),{memoryReviews:[]});
  const failedEvent={id:'direct-fail',obligationId:id,obligationType:'memory-recall',reviewedAt:start,confirmedRating:api.Rating.Again,
    beforePolicyState:clone(obligation.policyState),afterPolicyState:clone(failed.policyState),schedulerConfig:clone(failed.schedulerConfig)};
  obligation={...obligation,dueAt:failed.dueAt,policyState:clone(failed.policyState)};

  const firstHistory=api.memoryReviewObservationsFor(id,[failedEvent]);
  const failedVerificationAt=new Date(new Date(start).getTime()+86400000).toISOString();
  const failedVerification=policy.complete(obligation,api.Rating.Again,ratingEvidence(api.Rating.Again),new Date(failedVerificationAt),{memoryReviews:firstHistory});
  const failedVerificationEvent={id:'corrective-fail',obligationId:'relearn',obligationType:'relearn',reviewedAt:failedVerificationAt,
    correctiveMemoryTransition:{obligationId:id,rating:api.Rating.Again,beforeDueAt:obligation.dueAt,afterDueAt:failedVerification.dueAt,
      beforePolicyState:clone(obligation.policyState),afterPolicyState:clone(failedVerification.policyState),policyId:failedVerification.policyId,
      schedulerPackage:'ts-fsrs',schedulerVersion:'6.0.0',schedulerModel:'FSRS-7',schedulerConfig:clone(failedVerification.schedulerConfig),reviewLog:clone(failedVerification.reviewLog)},
    timing:{...clone(timing),totalActiveMs:1140000,activeByPhase:{attempt:0,compare:300000,'relearn-repair':600000,'relearn-verify':240000}},elapsedMs:1140000};
  obligation={...obligation,dueAt:failedVerification.dueAt,policyState:clone(failedVerification.policyState)};

  const secondHistory=api.memoryReviewObservationsFor(id,[failedEvent,failedVerificationEvent]);
  const successfulVerificationAt=new Date(new Date(failedVerificationAt).getTime()+86400000).toISOString();
  const successfulVerification=policy.complete(obligation,api.Rating.Good,ratingEvidence(api.Rating.Good),new Date(successfulVerificationAt),{memoryReviews:secondHistory});
  const successfulVerificationEvent={id:'corrective-success',obligationId:'relearn',obligationType:'relearn',reviewedAt:successfulVerificationAt,
    correctiveMemoryTransition:{obligationId:id,rating:api.Rating.Good,beforeDueAt:obligation.dueAt,afterDueAt:successfulVerification.dueAt,
      beforePolicyState:clone(obligation.policyState),afterPolicyState:clone(successfulVerification.policyState),policyId:successfulVerification.policyId,
      schedulerPackage:'ts-fsrs',schedulerVersion:'6.0.0',schedulerModel:'FSRS-7',schedulerConfig:clone(successfulVerification.schedulerConfig),reviewLog:clone(successfulVerification.reviewLog)},
    timing:{...clone(timing),totalActiveMs:900000,activeByPhase:{attempt:0,compare:180000,'relearn-repair':480000,'relearn-verify':240000}},elapsedMs:900000};

  const canonical=api.memoryReviewObservationsFor(id,[failedEvent,failedVerificationEvent,successfulVerificationEvent]);
  check(canonical.length===3&&canonical.map(row=>row.source).join(',')==='direct-memory,relearning-verification,relearning-verification','Every closed-book corrective verification must be canonical replay evidence');
  check(canonical.map(row=>row.rating).join(',')==='1,1,3','Corrective replay evidence must preserve failed and successful ratings');
  const optimizerRows=api.fsrsOptimizerEvidenceRows([failedVerificationEvent,successfulVerificationEvent]);
  check(optimizerRows.length===2&&optimizerRows[0].rating===api.Rating.Again&&optimizerRows[1].rating===api.Rating.Good,'Optimizer evidence must preserve corrective verification outcomes');
  check(optimizerRows.every(row=>row.source==='relearning-verification'&&row.durationPhase==='relearn-verify'&&row.durationMs===240000),'Corrective optimizer cost must use closed-book verification time only');
  api.revisionSchedulerPort(fixed(.9)).verifyProjection(successfulVerification.policyState.fsrsCard,canonical); checks++;
  const corrupted=clone(failedVerificationEvent);
  corrupted.correctiveMemoryTransition.beforePolicyState.fsrsCard.reps+=1;
  mustFail(()=>api.memoryReviewObservationsFor(id,[failedEvent,corrupted]),'Corrective-memory corruption must fail chain validation');
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

  const retiredTransitionShape=clone(payload);
  retiredTransitionShape.evidenceEvents[0].returnedMemoryTransition={};
  const retiredRepo=new MemoryRepo(buildRepositoryPayload());
  const retiredService=new api.RevisionService(retiredRepo);
  await mustReject(()=>retiredService.restoreBackupPayload(retiredTransitionShape,'discard'),'Restore must reject retired evidence-transition fields instead of carrying compatibility state');
  check(retiredRepo.replaceFromBackupCalls===0,'Retired evidence-transition shape must fail before replacement');

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
  await testCostAdrRebase();
  await testCorrectiveMemoryVerificationReplay();
  await testCanonicalOptimizerEvidence();
  await testTransactionalSettingsPublication();
  await testRebasesBackupRestorePlannerAndCorruption();
  console.log(`PASS ${checks} independent FSRS replay/personalization/restore/planner checks`);
})().catch(error=>{ console.error(error); process.exitCode=1; });
