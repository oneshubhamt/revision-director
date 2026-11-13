'use strict';
const { createAppRuntime } = require('./helpers/runtime-harness');

const { api } = createAppRuntime({
  globalName: '__RD_PLAN_TEST__',
  expose: ["Rating","FsrsMemoryPolicy","RevisionService","buildPlanningCandidate","planningEvidenceIndex","choosePlanItems","prepareFsrsScheduler","daysToExamination","examinationProximityScore","planningLookaheadDays","obligationWeaknessScore","durationObservationFor","weeklySubjectBalanceScores","createAutomaticChunks","interleaveSelected","planItemKey","memoryDifficultyAssessment","correctiveRelearnDueAt"],
  requireFsrs: false,
});

let checks=0;
const fixed=desiredRetention=>({kind:'fixed-retention',desiredRetention});
function check(condition, message) { checks++; if (!condition) throw new Error(message); }
const ref = new Date('2026-07-25T04:00:00Z');
const settings = { schemaVersion:1,key:'app',activeProfileId:'p',fsrsScheduling:{policy:fixed(.9)},memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}},dailyCapacityMinutes:60,studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false,replayProfiles:[]} };
const profile = (id, days, status='active') => ({id,name:id,examDate:new Date(ref.getTime()+days*86400000).toISOString().slice(0,10),status,createdAt:ref.toISOString(),updatedAt:ref.toISOString()});
const unit = (id, importance=3, lapseCount=0) => ({id,profileId:'p',topicNodeId:'t',title:id,scope:'scope',source:'',importance,status:'active',createdAt:ref.toISOString(),updatedAt:ref.toISOString(),evidenceCount:0,lapseCount});
const policyState = {engine:'mastery',version:'1',stage:0,successStreak:0,failureCount:0,lastIntervalDays:0};
const obligation = (id, dueOffsetDays, mins=15, type='concept-reconstruction') => ({id,unitId:id,type,status:'active',dueAt:new Date(ref.getTime()+dueOffsetDays*86400000).toISOString(),expectedMinutes:mins,baselineMinutes:mins,durationSampleCount:0,protocol:'attempt',successCriteria:'criteria',workflow:{kind:'reconstruction',prompt:'attempt',checkpoints:['one'],responseMedium:'in-app',reconstructionShape:'outline'},freshnessDays:30,priority:0,policyState:{...policyState},createdAt:ref.toISOString(),updatedAt:ref.toISOString()});
const joined = (id, dueOffset, mins, importance, examDays, status='active') => { const u=unit(id,importance); u.profileId=id; const o=obligation(id,dueOffset,mins); o.unitId=id; return {obligation:o,unit:u,profile:profile(id,examDays,status),subject:'S',section:'C',topic:'T'}; };
const evidence = (unitId, obligationId, rating, score, reviewedAt='2026-07-24T04:00:00Z') => ({unitId,obligationId,reviewedAt,confirmedRating:rating,evidence:{completeness:score,independence:score,application:score,errorTypes:score<2?['conceptual-misunderstanding']:[],correctionNote:''}});

const dueNear = api.buildPlanningCandidate(joined('near',-2,20,3,10),[],settings,ref);
const dueFar = api.buildPlanningCandidate(joined('far',-2,20,3,200),[],settings,ref);
check(dueNear && dueFar && dueNear.score > dueFar.score, 'Exam proximity must differentiate otherwise identical profiles');
check(api.examinationProximityScore(-1) === 0 && api.planningLookaheadDays(-1) === 0, 'Passed examinations must receive no proximity or lookahead');
check(api.buildPlanningCandidate(joined('passed',0,20,3,-20),[],settings,ref) === undefined, 'Passed examination profiles must be automatically excluded from planning');
check(api.buildPlanningCandidate(joined('passed-yesterday',0,20,3,-1),[],settings,ref) === undefined, 'An examination that ended yesterday must not remain at maximum proximity because of time-of-day rounding');
const core = api.buildPlanningCandidate(joined('core',0,20,3,60),[],settings,ref);
const useful = api.buildPlanningCandidate(joined('useful',0,20,1,60),[],settings,ref);
check(core.score > useful.score, 'Exam importance must affect rank');
const weakJoined = joined('weak',0,20,3,60); weakJoined.unit.lapseCount=2;
const strongJoined = joined('strong',0,20,3,60);
const weak = api.buildPlanningCandidate(weakJoined,[evidence('weak','weak',1,1)],settings,ref);
const strong = api.buildPlanningCandidate(strongJoined,[evidence('strong','strong',4,4)],settings,ref);
check(weak.score > strong.score && weak.factors.weakness > strong.factors.weakness, 'Weakness evidence must affect rank');
const sharedUnit = unit('shared',3,0); sharedUnit.profileId='shared-profile';
const weakObligation = obligation('shared-recall',0,20,'memory-recall'); weakObligation.unitId='shared'; weakObligation.workflow={kind:'recall',prompt:'attempt',checkpoints:['one'],responseMedium:'oral'};
weakObligation.policyState = {
  engine:'ts-fsrs',version:'6.0.0',stage:0,successStreak:0,failureCount:0,lastIntervalDays:0,
  fsrsCard:{model:'FSRS-7',cardId:'shared-recall',dueAt:weakObligation.dueAt,stability:0,stabilityFast:0,difficulty:0,scheduledDays:0,learningSteps:0,reps:0,lapses:0,state:0,scheduleStatus:'new'}
};
const strongObligation = obligation('shared-application',0,20,'application-practice'); strongObligation.unitId='shared'; strongObligation.workflow={kind:'questions',prompt:'attempt',checkpoints:['one'],responseMedium:'in-app',targetCount:10,questionSetRef:'set'};
const sharedProfile = profile('shared-profile',60);
const sharedEvidence = [evidence('shared','shared-recall',1,1),evidence('shared','shared-application',4,4)];
const weakSpecific = api.buildPlanningCandidate({obligation:weakObligation,unit:sharedUnit,profile:sharedProfile,subject:'S',section:'C',topic:'T'},sharedEvidence,settings,ref);
const strongSpecific = api.buildPlanningCandidate({obligation:strongObligation,unit:sharedUnit,profile:sharedProfile,subject:'S',section:'C',topic:'T'},sharedEvidence,settings,ref);
check(weakSpecific.factors.weakness > strongSpecific.factors.weakness + .25, 'Weakness must be obligation-specific rather than shared across all workflows in a unit');
const indexedSharedEvidence = api.planningEvidenceIndex(sharedEvidence);
const weakIndexed = api.buildPlanningCandidate({obligation:weakObligation,unit:sharedUnit,profile:sharedProfile,subject:'S',section:'C',topic:'T'},indexedSharedEvidence,settings,ref);
const strongIndexed = api.buildPlanningCandidate({obligation:strongObligation,unit:sharedUnit,profile:sharedProfile,subject:'S',section:'C',topic:'T'},indexedSharedEvidence,settings,ref);
check(weakIndexed.factors.weakness === weakSpecific.factors.weakness && strongIndexed.factors.weakness === strongSpecific.factors.weakness, 'Pre-indexed planning evidence must preserve weakness semantics exactly');
const persistentObligation=structuredClone(weakObligation);
persistentObligation.expectedMinutes=60;
persistentObligation.policyState=structuredClone(weakObligation.policyState);
persistentObligation.policyState.fsrsCard.lapses=99;
const persistentReviews=new Map([['shared-recall',[
  {rating:api.Rating.Good},
  ...Array.from({length:4},()=>({rating:api.Rating.Again}))
]]]);
const persistentCandidate=api.buildPlanningCandidate({obligation:persistentObligation,unit:sharedUnit,profile:sharedProfile,subject:'S',section:'C',topic:'T'},[],settings,ref,.5,undefined,persistentReviews);
check(persistentCandidate&&persistentCandidate.factors.weakness>=.9&&persistentCandidate.reasons.some(reason=>reason.includes('persistent difficulty')),'Persistent review-evidence burden must surface as a strong planner weakness signal without using the materialized FSRS lapse counter as history');

const earlyLearningObligation=structuredClone(weakObligation);
earlyLearningObligation.policyState=structuredClone(weakObligation.policyState);
earlyLearningObligation.policyState.fsrsCard.state=1;
earlyLearningObligation.policyState.fsrsCard.scheduleStatus='learning';
const earlyReviews=[
  {rating:api.Rating.Again,beforeCard:{state:0}},
  {rating:api.Rating.Again,beforeCard:{state:1}}
];
const earlyAssessment=api.memoryDifficultyAssessment(earlyLearningObligation,settings.memoryDifficultyPolicy,earlyReviews);
check(earlyAssessment.level==='learning-difficulty'&&earlyAssessment.establishedLapses===0&&earlyAssessment.earlyLearningFailures===2,'Repeated failures during initial learning must be diagnosed separately from established-memory lapses');
check(earlyAssessment.automaticHoldEligible===false,'Initial-learning difficulty must never trigger the established-memory automatic-hold policy');
const earlyIndex=new Map([[earlyLearningObligation.id,earlyReviews]]);
const earlyCandidate=api.buildPlanningCandidate(
  {obligation:earlyLearningObligation,unit:sharedUnit,profile:sharedProfile,subject:'S',section:'C',topic:'T'},
  [],settings,ref,.5,undefined,earlyIndex
);
check(earlyCandidate&&earlyCandidate.factors.weakness>=.68&&earlyCandidate.reasons.some(reason=>reason.includes('early learning difficulty')),'Early-learning difficulty must become a planner weakness signal without inventing an FSRS lapse');

const persistentNearJoined={obligation:structuredClone(persistentObligation),unit:sharedUnit,profile:profile('shared-profile',3),subject:'S',section:'C',topic:'T'};
const persistentFarJoined={obligation:structuredClone(persistentObligation),unit:sharedUnit,profile:profile('shared-profile',120),subject:'S',section:'C',topic:'T'};
const persistentDueBefore=persistentNearJoined.obligation.dueAt;
const persistentNear=api.buildPlanningCandidate(persistentNearJoined,[],settings,ref);
const persistentFar=api.buildPlanningCandidate(persistentFarJoined,[],settings,ref);
check(persistentNear&&persistentFar&&persistentNear.score>persistentFar.score,'Exam proximity must increase corrective priority for otherwise identical difficult memory');
check(persistentNearJoined.obligation.dueAt===persistentDueBefore,'Exam-proximity corrective planning must not rewrite the FSRS due date');
const short = api.buildPlanningCandidate(joined('short',0,10,3,60),[],settings,ref);
const long = api.buildPlanningCandidate(joined('long',0,60,3,60),[],settings,ref);
check(short.score > long.score, 'Duration fit must affect rank without dominating it');
check(api.buildPlanningCandidate(joined('inactive',0,10,3,10,'suspended'),[],settings,ref) === undefined, 'Inactive exam profiles must be excluded');
const noDateJoined = joined('nodate',0,10,3,10); noDateJoined.profile.examDate='';
const noDate = api.buildPlanningCandidate(noDateJoined,[],settings,ref);
check(noDate && noDate.examDateKnown === false && noDate.factors.examinationProximity < .2, 'Missing exam dates must remain explicit and receive only a distant neutral proximity');
check(api.buildPlanningCandidate(joined('outside',3,10,3,200),[],settings,ref) === undefined, 'Far-future work outside the profile lookahead must be excluded');
const brought = api.buildPlanningCandidate(joined('bring',1.5,10,3,10),[],settings,ref);
check(brought && brought.dueState === 'brought-forward', 'Near-exam lookahead must permit controlled bring-forward');

const synthesisReady = joined('synthesis',3,20,3,200);
synthesisReady.obligation.chunking = {cycleId:'syn',status:'synthesis-ready',originalMinutes:20,synthesisMinutes:5,capacityMinutes:10,totalChunks:2,completedChunks:2,createdAt:ref.toISOString()};
const synthesisCandidate = api.buildPlanningCandidate(synthesisReady,[],settings,ref);
check(synthesisCandidate && synthesisCandidate.executionMinutes === 5, 'Synthesis-ready work must be immediately plannable without rewriting the policy due date');
check(synthesisReady.obligation.dueAt === new Date(ref.getTime()+3*86400000).toISOString(), 'Planning synthesis readiness must not mutate the policy due date');

async function testMemoryExamHorizon() {
  await api.prepareFsrsScheduler(fixed(.9));
  const memoryPolicy = new api.FsrsMemoryPolicy(() => fixed(.9));
  const memoryState = memoryPolicy.createInitialState(ref.toISOString(), 'memory');
  const memoryObligation = { ...obligation('memory',0,12,'memory-recall'), type:'memory-recall', workflow:{kind:'recall',prompt:'attempt',checkpoints:['one'],responseMedium:'oral'}, policyState:memoryState };

  const easyEvidence = {completeness:4,independence:4,application:4,errorTypes:[],correctionNote:''};
  const easy = memoryPolicy.complete(memoryObligation, api.Rating.Easy, easyEvidence, ref);
  const unreviewedExamState = memoryPolicy.createInitialState(easy.dueAt, 'memory-exam');
  const examBoundObligation = {
    ...obligation('memory-exam',0,12,'memory-recall'),
    id:'memory-exam',unitId:'memory-unit',type:'memory-recall',dueAt:easy.dueAt,
    workflow:{kind:'recall',prompt:'attempt',checkpoints:['one'],responseMedium:'oral'},
    policyState:unreviewedExamState
  };
  const examBoundJoined = {
    obligation:examBoundObligation,
    unit:{...unit('memory-exam'),id:'memory-unit',profileId:'memory-profile'},
    profile:profile('memory-profile',2),
    subject:'S',section:'C',topic:'T'
  };
  const examCandidate = api.buildPlanningCandidate(examBoundJoined,[],settings,ref);
  check(examCandidate && examCandidate.reasons.includes('final memory review before exam'), 'FSRS due dates beyond a known exam must create one final pre-exam memory opportunity');
  check(examBoundJoined.obligation.dueAt === easy.dueAt, 'Exam-horizon planning must not rewrite the FSRS policy due date');

  const reviewedExamObligation = {
    ...examBoundObligation,id:'memory',dueAt:easy.dueAt,policyState:structuredClone(easy.policyState)
  };
  reviewedExamObligation.policyState.fsrsCard.cardId='memory';
  const easyEvent = {
    id:'memory-easy',unitId:'memory-unit',obligationId:'memory',obligationType:'memory-recall',
    reviewedAt:ref.toISOString(),confirmedRating:api.Rating.Easy,evidence:easyEvidence,
    beforePolicyState:structuredClone(memoryState),afterPolicyState:structuredClone(easy.policyState),
    schedulerConfig:structuredClone(easy.schedulerConfig)
  };
  const reviewedExamJoined = {...examBoundJoined,obligation:reviewedExamObligation};
  check(api.buildPlanningCandidate(reviewedExamJoined,[easyEvent],settings,ref) === undefined, 'A memory review already completed inside the final exam window must not be forced again');

  const sameDayExam=profile('same-day-exam',0);
  const sameDayCorrective=api.correctiveRelearnDueAt(sameDayExam,ref);
  const examDeadline=new Date(`${sameDayExam.examDate}T23:59:59`);
  check(new Date(sameDayCorrective).getTime()>=ref.getTime()&&new Date(sameDayCorrective).getTime()<=examDeadline.getTime(),'Corrective relearning created on exam day must remain schedulable before the examination deadline');
  const distantExam=profile('distant-exam',10);
  check(api.correctiveRelearnDueAt(distantExam,ref)===new Date(ref.getTime()+86400000).toISOString(),'Corrective relearning should retain its ordinary one-day delay when the exam horizon does not constrain it');
}

const item = (id, score, mins, type='concept-reconstruction', dueState='due') => ({joined:{obligation:{id,type,dueAt:ref.toISOString(),expectedMinutes:mins},unit:{},profile:{}},score,dueState,executionMinutes:mins,factors:{dueRisk:.8,examImportance:1,weakness:.5,reviewDuration:.8,examinationProximity:.7,weeklyBalance:.5}});
let packed = api.choosePlanItems([item('x',90,40),item('y',80,20),item('z',50,20)],60);
check(packed.selected.map(i=>i.joined.obligation.id).includes('x') && packed.selected.map(i=>i.joined.obligation.id).includes('y'), 'Capacity packing must select the highest-value feasible combination');
check(packed.deferred.length === 1 && packed.deferred[0].joined.obligation.id === 'z', 'Capacity packing must expose deferral');
packed = api.choosePlanItems([item('critical',97,90,'relearn','overdue'),item('normal',80,20)],60);
check(packed.selected.length === 1 && packed.selected[0].joined.obligation.id === 'critical', 'Critical oversized work must produce an explicit overrun, not disappear');
check(packed.requiredOverrun.length === 1 && packed.requiredOverrun[0].joined.obligation.id === 'critical', 'Oversized critical work must be labelled as a required overrun');
packed = api.choosePlanItems([item('oversized-top',99,90,'relearn','overdue'),item('critical-fit',95,30,'relearn','overdue')],60);
check(packed.selected.length === 1 && packed.selected[0].joined.obligation.id === 'oversized-top' && packed.requiredOverrun.length === 1, 'A higher-scoring oversized critical item must not be hidden by a smaller critical item');
packed = api.choosePlanItems([item('critical-fit-top',99,30,'relearn','overdue'),item('oversized-lower',95,90,'relearn','overdue')],60);
check(packed.selected.some(i=>i.joined.obligation.id==='critical-fit-top') && packed.mustSplit.some(i=>i.joined.obligation.id==='oversized-lower'), 'A lower-ranked oversized critical item must be separated as must-split, not ordinary deferral');

(async () => {
  await testMemoryExamHorizon();
  const service = new api.RevisionService({ dailyPlanByStudyDay: async () => undefined });
  service.settings = settings;
  service.joinedObligations = async () => [joined('a',-1,40,3,20),joined('b',0,20,2,100),joined('c',0,30,1,200)];
  service.evidenceEvents = async () => [];
  service.dailyPlanHistory = async () => [];
  let ensureChunkCalls = 0;
  let existingChunkCalls = 0;
  let persistCalls = 0;
  const regenerationFlags = [];
  service.ensureAutomaticChunking = async () => { ensureChunkCalls += 1; return new Map(); };
  service.existingPendingChunks = async () => { existingChunkCalls += 1; return new Map(); };
  service.persistDailyPlan = async (_plan, regenerate) => { persistCalls += 1; regenerationFlags.push(regenerate); return {id:'plan',version:persistCalls}; };

  const preview = await service.calculateDailyPlan(ref);
  check(existingChunkCalls === 1 && ensureChunkCalls === 0 && persistCalls === 0, 'Read-only plan calculation must not create chunks or persist plan state');
  check(preview.planRecordId === '' && preview.versionNumber === 0, 'Read-only plan calculation must report absence of persisted plan state');

  const plan = await service.ensureDailyPlan(ref);
  check(ensureChunkCalls === 1 && persistCalls === 1 && regenerationFlags[0] === false, 'Plan ensure must own automatic chunking and ordinary persistence');
  check(plan.plannedMinutes <= 60, 'Service daily plan must respect configured capacity');
  check(plan.selected.length > 0 && plan.deferred.length > 0 && Array.isArray(plan.requiredOverrun) && Array.isArray(plan.mustSplit), 'Service daily plan must separate selected, exceptions and deferred work');
  check(plan.selected.every(i => Array.isArray(i.reasons) && i.reasons.length > 0), 'Every planned item must explain its inclusion');
  check(plan.studyDayKey === '2026-07-25', 'Daily plan must use the Study Director day boundary');

  await service.regenerateDailyPlan(ref);
  check(ensureChunkCalls === 2 && persistCalls === 2 && regenerationFlags[1] === true, 'Manual regeneration must remain an explicit mutating command');
  console.log(`PASS ${checks} Pass C planning scenario checks`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
