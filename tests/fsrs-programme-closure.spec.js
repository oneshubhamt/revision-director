'use strict';
const { createAppRuntime } = require('./helpers/runtime-harness');

const { api, context } = createAppRuntime({
  globalName: '__RD_FSRS_CLOSURE__',
  expose: ["RevisionService","Rating","memoryReviewObservationsFor","memoryDifficultyAssessment","defaultMemoryDifficultyPolicy","revisionSchedulerPort","costAdrPresetSchedulingPolicy","buildPlanningCandidate","fsrsOptimizerEvidenceSnapshot","validateFsrsOptimizerProfile","FSRS7_DEFAULT_WEIGHTS","fsrsWeightsFingerprint","activeFsrsOptimizerProfile","fsrsPersonalizationProfileCatalog"],
  requireFsrs: true,
});
const F = context.FSRS;

let checks=0;
const clone=value=>structuredClone(value);
const fixed=desiredRetention=>({kind:'fixed-retention',desiredRetention});
function check(value,message){ checks++; if(!value) throw new Error(message); }

const timingRecall={
  totalActiveMs:600000,
  activeByPhase:{attempt:420000,compare:180000,'relearn-repair':0,'relearn-verify':0},
  pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]
};
const timingRelearn={
  totalActiveMs:900000,
  activeByPhase:{attempt:0,compare:180000,'relearn-repair':480000,'relearn-verify':240000},
  pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]
};
function recallDraft(rating, checkpointTotal=6){
  const failed=rating===api.Rating.Again;
  return {
    completeness:failed?0:4,independence:failed?1:4,application:failed?1:3,
    errorTypes:failed?['conceptual-misunderstanding']:[],correctionNote:failed?'Rebuild the causal chain before the next closed-book verification.':'',
    workflowResult:{kind:'recall',responseMedium:'oral',attemptText:'',checkpointTotal,checkpointsMet:failed?0:checkpointTotal,cueLevel:failed?'major':'none'},
    elapsedMs:timingRecall.totalActiveMs,timing:clone(timingRecall),confirmedRating:rating
  };
}
function relearnDraft(rating, checkpointTotal=6){
  const failed=rating===api.Rating.Again;
  return {
    completeness:failed?0:4,independence:4,application:failed?1:3,
    errorTypes:failed?['conceptual-misunderstanding']:[],correctionNote:failed?'Verification still failed; repair again.':'',
    workflowResult:{kind:'relearning',diagnosis:'conceptual-misunderstanding',repairAction:'Rebuilt the mechanism from the source',verificationText:failed?'Closed-book verification remained incomplete':'Explained the repaired concept independently with the source closed',checkpointTotal,checkpointsMet:failed?0:checkpointTotal,sourceClosedForVerification:true,repairCompleted:true},
    elapsedMs:timingRelearn.totalActiveMs,timing:clone(timingRelearn),confirmedRating:rating
  };
}

class MemoryRepo {
  constructor(payload){ this.replaceSettingsAndObligationsCalls=0; this.load(payload); }
  load(payload){
    for(const name of ['profiles','nodes','units','studyEvents','obligations','evidenceEvents','chunks','dailyPlans']) this[name]=clone(payload[name]||[]);
    this.settings=clone(payload.settings); this.activeRetrieval=clone(payload.activeRetrieval??null);
  }
  async getAll(store){ return clone(this[store]||[]); }
  async getByIndex(store,indexName,query){ return clone((this[store]||[]).filter(item=>item[indexName]===query)); }
  async get(store,key){
    if(store==='settings') return key==='app'?clone(this.settings):undefined;
    if(store==='activeRetrieval') return key==='current'&&this.activeRetrieval?clone(this.activeRetrieval):undefined;
    return clone((this[store]||[]).find(item=>item.id===key));
  }
  async put(store,value){
    if(store==='settings'){ this.settings=clone(value); return; }
    if(store==='activeRetrieval'){ this.activeRetrieval=clone(value); return; }
    const rows=this[store]||[]; const index=rows.findIndex(item=>item.id===value.id);
    if(index>=0) rows[index]=clone(value); else rows.push(clone(value)); this[store]=rows;
  }
  async dailyPlanByStudyDay(studyDayKey){ return clone(this.dailyPlans.find(item=>item.studyDayKey===studyDayKey)); }
  async recordReview(unit,obligation,event,followUp,relatedObligation,chunkUpdates=[],dailyPlan,commitGuard,postCommitSession){
    await this.put('units',unit); await this.put('obligations',obligation);
    if(this.evidenceEvents.some(item=>item.id===event.id)) throw new Error('Duplicate evidence event');
    this.evidenceEvents.push(clone(event));
    if(followUp){ if(this.obligations.some(item=>item.id===followUp.id)) throw new Error('Duplicate follow-up obligation'); this.obligations.push(clone(followUp)); }
    if(relatedObligation) await this.put('obligations',relatedObligation);
    for(const chunk of chunkUpdates) await this.put('chunks',chunk);
    if(dailyPlan) await this.put('dailyPlans',dailyPlan);
    if(commitGuard&&postCommitSession) this.activeRetrieval=clone(postCommitSession);
  }
  async backupState(){
    return clone({
      profiles:this.profiles,nodes:this.nodes,units:this.units,studyEvents:this.studyEvents,
      obligations:this.obligations,evidenceEvents:this.evidenceEvents,chunks:this.chunks,dailyPlans:this.dailyPlans,
      settings:this.settings,activeRetrieval:this.activeRetrieval,
    });
  }
  async replaceSettingsAndObligations(settings,updatedObligations){
    this.replaceSettingsAndObligationsCalls++;
    const updates=new Map(updatedObligations.map(item=>[item.id,clone(item)]));
    this.obligations=this.obligations.map(item=>updates.get(item.id)||item);
    this.settings=clone(settings);
  }
}

function optimizerProfile(sourceSha256, personalizedLogLoss=.40, personalizedRmse=.075, incumbentProfile=null, weight2=4.2){
  const weights=[...api.FSRS7_DEFAULT_WEIGHTS]; weights[2]=weight2;
  const incumbent=incumbentProfile?{
    sourceSha256:incumbentProfile.sourceSha256,
    weightsFingerprint:api.fsrsWeightsFingerprint(incumbentProfile.weights),
    metrics:{logLoss:.41,rmseBins:.079}
  }:undefined;
  return api.validateFsrsOptimizerProfile({
    schema:'revision-director-fsrs-profile/v1',model:'FSRS-7',bindingVersion:'0.6.1',trainedAt:'2026-11-12T00:00:00.000Z',sourceSha256,evidenceItems:384,weights,
    evaluation:{crossValidation:{logLoss:.39,rmseBins:.07},holdout:{strategy:'final-sixth',trainItems:320,holdoutItems:64,holdoutCards:16,minimumTrainItems:64,minimumHoldoutItems:64,minimumHoldoutCards:16,stock:{logLoss:.42,rmseBins:.08},personalized:{logLoss:personalizedLogLoss,rmseBins:personalizedRmse},...(incumbent?{incumbent}:{}),gate:'passed'}},
    training:{enableShortTerm:true,enableSchedPenalties:true,numRelearningSteps:1,chronology:'elapsed-24h',converterFixedUtcOffsetMinutes:0,converterRolloverHour:0,runtimeLearningSteps:['1d'],runtimeRelearningSteps:['1d'],validationCandidateTrainedItems:320,finalRetrainedOnAllEvidence:true}
  });
}

function findMemory(repo){ const value=repo.obligations.find(item=>item.type==='memory-recall'); if(!value) throw new Error('Baseline memory obligation missing'); return value; }
function findUnit(repo,id){ const value=repo.units.find(item=>item.id===id); if(!value) throw new Error('Unit missing'); return value; }
function findProfile(repo,id){ const value=repo.profiles.find(item=>item.id===id); if(!value) throw new Error('Profile missing'); return value; }

async function testNewLearningReviewBoundary(){
  const scheduler=await F.DefaultScheduler({version:'FSRS-7',desiredRetention:.9,enableShortTerm:true,learningSteps:['23h'],relearningSteps:['23h'],graduatingInterval:1,allowModelOverride:true,enableFuzz:false,maximumInterval:36500,clearStatsOnForget:false});
  const start=new Date('2026-01-01T08:00:00.000Z');
  const fresh=scheduler.newCard({now:start,cardId:'transition-probe'});
  check(fresh.state===0,'FSRS transition probe must begin in New state');
  const learning=scheduler.review({card:fresh,grade:F.Rating.Again,now:start}).card;
  check(learning.state===1,'A sub-graduating learning step must produce New → Learning');
  const review=scheduler.review({card:learning,grade:F.Rating.Good,now:new Date(learning.dueAt)}).card;
  check(review.state===2,'A successful learning-step review must produce Learning → Review');
}

async function testProgrammeLifecycleAndRebases(){
  const payload=JSON.parse(fs.readFileSync(path.join(root,'tests','fixtures','browser-baseline.json'),'utf8'));
  payload.dailyPlans=[]; payload.chunks=[]; payload.activeRetrieval=null; payload.evidenceEvents=[];
  const repo=new MemoryRepo(payload);
  const service=new api.RevisionService(repo);
  await service.initialize();

  let memory=findMemory(repo);
  const initialDue=memory.dueAt;
  check(memory.policyState.fsrsCard.state===0&&memory.policyState.fsrsCard.scheduleStatus==='new','Production lifecycle must begin from a canonical New FSRS card');

  await service.recordEvidence(memory.id,recallDraft(api.Rating.Again,memory.workflow.checkpoints.length),new Date(initialDue));
  memory=findMemory(repo);
  let relearn=repo.obligations.find(item=>item.type==='relearn'&&item.returnObligationId===memory.id&&item.status==='active');
  check(Boolean(relearn),'Direct memory Again must create one corrective relearning obligation');
  check(memory.status==='suspended'&&memory.suspensionReason==='relearning','Direct memory Again must remove the original memory from the normal queue');
  check(memory.policyState.fsrsCard.state===2&&memory.policyState.fsrsCard.scheduleStatus==='review','The selected 1d step must preserve its explicit production semantics: raw FSRS enters Review at the graduation boundary');
  check(memory.policyState.successStreak===0,'Raw Review state must not falsely establish host learning success');

  await service.recordEvidence(relearn.id,relearnDraft(api.Rating.Again,relearn.workflow.checkpoints.length),new Date(relearn.dueAt));
  memory=findMemory(repo); relearn=repo.obligations.find(item=>item.id===relearn.id);
  check(relearn.status==='active','Failed corrective verification must keep the repair obligation active');
  check(memory.status==='suspended'&&memory.suspensionReason==='relearning','Failed corrective verification must keep the original memory suspended');
  let history=api.memoryReviewObservationsFor(memory.id,repo.evidenceEvents);
  check(history.length===2&&history.map(item=>item.rating).join(',')==='1,1','Direct failure and failed closed-book verification must both reach canonical FSRS history exactly once');
  const difficulty=api.memoryDifficultyAssessment(memory,api.defaultMemoryDifficultyPolicy(),history);
  check(difficulty.level==='learning-difficulty'&&difficulty.earlyLearningFailures===2&&difficulty.establishedLapses===0,'Pre-establishment failures must remain host learning difficulty even after the 1d raw FSRS state entered Review');

  await service.recordEvidence(relearn.id,relearnDraft(api.Rating.Good,relearn.workflow.checkpoints.length),new Date(relearn.dueAt));
  memory=findMemory(repo); relearn=repo.obligations.find(item=>item.id===relearn.id);
  check(relearn.status==='completed','One successful closed-book corrective verification must close the repair obligation');
  check(memory.status==='active'&&!memory.suspensionReason,'Successful corrective verification must reactivate the original memory immediately');
  history=api.memoryReviewObservationsFor(memory.id,repo.evidenceEvents);
  check(history.length===3&&history.map(item=>item.source).join(',')==='direct-memory,relearning-verification,relearning-verification','Successful return must preserve the complete corrective evidence topology');
  check(history.map(item=>item.rating).join(',')==='1,1,3','Successful return must preserve Again, Again, Good without synthetic reviews');
  api.revisionSchedulerPort(fixed(.9)).verifyProjection(memory.policyState.fsrsCard,history); checks++;

  const immutableBeforeCostAdr=JSON.stringify(repo.evidenceEvents);
  const costSettings=clone(service.getSettings()); costSettings.fsrsScheduling={...costSettings.fsrsScheduling,policy:api.costAdrPresetSchedulingPolicy()};
  const costRebasesBefore=repo.replaceSettingsAndObligationsCalls;
  await service.saveSettings(costSettings);
  check(repo.replaceSettingsAndObligationsCalls===costRebasesBefore+1,'Cost-ADR policy change must use one atomic settings/projection replacement');
  check(service.getSettings().fsrsScheduling.policy.kind==='cost-adr'&&service.getSettings().fsrsScheduling.lastRebase.reason==='scheduler-policy-change','Cost-ADR must publish through the explicit scheduler-policy rebase');
  check(JSON.stringify(repo.evidenceEvents)===immutableBeforeCostAdr,'Cost-ADR rebase must not rewrite canonical review evidence');
  memory=findMemory(repo); history=api.memoryReviewObservationsFor(memory.id,repo.evidenceEvents);
  api.revisionSchedulerPort(service.getSettings().fsrsScheduling.policy).verifyProjection(memory.policyState.fsrsCard,history); checks++;
  const unit=findUnit(repo,memory.unitId); const profile=findProfile(repo,unit.profileId); const dueBeforePlanning=memory.dueAt;
  const planner=api.buildPlanningCandidate({obligation:clone(memory),unit:clone(unit),profile:clone(profile),subject:'Closure',section:'FSRS',topic:'Cost-ADR'},clone(repo.evidenceEvents),service.getSettings(),new Date(memory.dueAt));
  check(Boolean(planner),'Planner must consume a correctly rebased Cost-ADR memory projection');
  check(memory.dueAt===dueBeforePlanning,'Planner must not rewrite the Cost-ADR scheduler-owned due date');

  const fixedSettings=clone(service.getSettings()); fixedSettings.fsrsScheduling={...fixedSettings.fsrsScheduling,policy:fixed(.9)};
  await service.saveSettings(fixedSettings);
  check(service.getSettings().fsrsScheduling.policy.kind==='fixed-retention','Explicit Cost-ADR → fixed-retention return must succeed');

  const snapshot=await api.fsrsOptimizerEvidenceSnapshot(repo.evidenceEvents);
  const firstProfile=optimizerProfile(snapshot.sourceSha256,.40,.075,null,4.2);
  await service.stageFsrsOptimizerProfile(firstProfile);
  const activationBefore=repo.replaceSettingsAndObligationsCalls;
  await service.activateFsrsOptimizerProfile();
  check(repo.replaceSettingsAndObligationsCalls===activationBefore+1&&service.getSettings().fsrsScheduling.lastRebase.reason==='activate-profile','Initial personalized activation must use one atomic rebase');
  check(Boolean(api.activeFsrsOptimizerProfile(service.getSettings())),'Personalized FSRS profile must be active after activation');

  memory=findMemory(repo);
  await service.recordEvidence(memory.id,recallDraft(api.Rating.Good,memory.workflow.checkpoints.length),new Date(memory.dueAt));
  const incumbent=api.activeFsrsOptimizerProfile(service.getSettings());
  const replacementSnapshot=await api.fsrsOptimizerEvidenceSnapshot(repo.evidenceEvents);
  const replacement=optimizerProfile(replacementSnapshot.sourceSha256,.38,.07,incumbent,4.25);
  const replacementBefore=repo.replaceSettingsAndObligationsCalls;
  await service.replaceActiveFsrsOptimizerProfile(replacement);
  check(repo.replaceSettingsAndObligationsCalls===replacementBefore+1,'Personalized → personalized replacement must perform exactly one atomic rebase');
  check(service.getSettings().fsrsScheduling.lastRebase.reason==='replace-profile','Personalized replacement must retain replace-profile provenance');
  check(service.getSettings().fsrsPersonalization.active===true,'Replacement must never pass through a stock inactive state');
  check(api.fsrsWeightsFingerprint(api.activeFsrsOptimizerProfile(service.getSettings()).weights)===api.fsrsWeightsFingerprint(replacement.weights),'The winning optimizer candidate must become the active scheduler weights');
  check(service.getSettings().fsrsPersonalization.replayProfiles.length===1,'A displaced profile referenced by immutable evidence must be retained exactly once for historical replay');
  check(api.fsrsPersonalizationProfileCatalog(service.getSettings()).length===2,'Historical replay catalog must resolve both incumbent and replacement profiles');
  memory=findMemory(repo); history=api.memoryReviewObservationsFor(memory.id,repo.evidenceEvents);
  api.revisionSchedulerPort(fixed(.9),replacement).verifyProjection(memory.policyState.fsrsCard,history); checks++;
}

(async()=>{
  await testNewLearningReviewBoundary();
  await testProgrammeLifecycleAndRebases();
  console.log('PASS '+checks+' FSRS programme-closure scheduler/replay/planner/rebase checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
