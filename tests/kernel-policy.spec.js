'use strict';
const fs = require('fs');
const vm = require('vm');
const { webcrypto } = require('crypto');
const path = require('path');
const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_TEST_API__ = { suggestRating, objectiveScore, workflowEvidence, validateWorkflowResult, validateWorkflowSpec, defaultWorkflowSpec, defaultWorkflowForType, compatibleWorkflows, MasteryPolicy, ApplicationPolicy, PerformancePolicy, RelearnPolicy, FreshnessPolicy, SchedulerPolicyRouter, FsrsMemoryPolicy, RevisionService, UIController, Rating, examinationProximityScore, planningLookaheadDays, examImportanceScore, reviewDurationScore, evidenceWeaknessScore, obligationWeaknessScore, temporalDueRisk, plannerScore, buildPlanningCandidate, choosePlanItems, prepareFsrsScheduler, revisionSchedulerPort, memoryReviewObservationsFor, validateFsrsConfigSnapshot, validateStoredFsrsCard, defaultMemoryDifficultyPolicy, canonicalMemoryDifficultyPolicy, memoryDifficultyAssessment, memoryDifficultyRemediationPlan, memoryDifficultyActionLabel, daysToExamination, durationObservationFor, weeklySubjectBalanceScores, createAutomaticChunks, interleaveSelected, planItemKey };';
if (!source.includes('void boot();')) throw new Error('Boot marker missing');
source = source.replace('void boot();', hook);

const vendor = fs.readFileSync(path.join(root, 'vendor', 'ts-fsrs-6.0.0', 'index.umd.js'), 'utf8');
const context = { crypto: webcrypto, structuredClone, console, Date, Intl, URL, Blob, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set, Math, Number, String, Object, Array, JSON, Error, Promise };
context.window = context;
context.self = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(vendor, context, { filename: 'ts-fsrs-6.0.0.umd.js' });
if (!context.FSRS || typeof context.FSRS.DefaultScheduler !== 'function') throw new Error('Modern ts-fsrs runtime did not load');
vm.runInContext(source, context, { filename: 'app.js' });

const api = context.__RD_TEST_API__;
if (!api) throw new Error('Test API was not exposed');
let checks=0;
const fixed=desiredRetention=>({kind:'fixed-retention',desiredRetention});
function check(condition, message) { checks++; if (!condition) throw new Error(message); }
function mustFail(fn, message) { let failed = false; try { fn(); } catch { failed = true; } check(failed, message); }
const errors = [];
const evidence = (c, i, a, accuracy, errorTypes = []) => ({ completeness:c, independence:i, application:a, ...(accuracy === undefined ? {} : { accuracyPercent: accuracy }), errorTypes, correctionNote:'' });
const due = new Date('2026-07-25T00:00:00Z').toISOString();
const workflow = (kind) => {
  const type = kind === 'recall' ? 'memory-recall' : kind === 'reconstruction' ? 'concept-reconstruction' : kind === 'questions' ? 'application-practice' : kind === 'answer-writing' || kind === 'diagram' ? 'performance-practice' : 'relearn';
  const spec = api.defaultWorkflowSpec(type, 'Attempt the task', 'Checkpoint one; Checkpoint two');
  spec.kind = kind;
  if (kind === 'diagram') { spec.diagramSurface = 'canvas'; delete spec.answerMode; delete spec.timeLimitMinutes; delete spec.wordLimit; }
  if (kind === 'answer-writing') { spec.answerMode='full-answer'; spec.timeLimitMinutes=10; spec.wordLimit=150; }
  if (kind === 'questions') { spec.targetCount=10; spec.questionSetRef='Q-bank block 1'; }
  if (kind === 'reconstruction') spec.reconstructionShape='outline';
  return spec;
};

// Workflow routing and validation.
check(api.defaultWorkflowForType('memory-recall') === 'recall', 'Memory should default to recall');
check(api.defaultWorkflowForType('concept-reconstruction') === 'reconstruction', 'Concept should default to reconstruction');
check(api.defaultWorkflowForType('application-practice') === 'questions', 'Application should default to questions');
check(api.defaultWorkflowForType('performance-practice') === 'answer-writing', 'Performance should default to answer writing');
check(api.defaultWorkflowForType('relearn') === 'relearning', 'Relearn should use relearning');
check(api.compatibleWorkflows('memory-recall').join(',') === 'recall', 'FSRS memory must stay a recall workflow');
check(api.compatibleWorkflows('concept-reconstruction').includes('diagram'), 'Concept work should allow diagram reconstruction');
check(api.compatibleWorkflows('performance-practice').join(',') === 'answer-writing,diagram,questions', 'Performance work should allow exam-performance workflows');
check(api.compatibleWorkflows('freshness-review').join(',') === 'recall,reconstruction', 'Freshness should remain retrieval-based');
for (const [type, kind] of [['memory-recall','recall'],['concept-reconstruction','reconstruction'],['application-practice','questions'],['performance-practice','answer-writing'],['relearn','relearning'],['freshness-review','recall']]) {
  const spec = api.defaultWorkflowSpec(type, 'Attempt properly', 'First; Second');
  check(spec.kind === kind, `Default workflow mismatch for ${type}`);
  api.validateWorkflowSpec(spec, type); checks++;
}
mustFail(() => api.validateWorkflowSpec(workflow('relearning'), 'memory-recall'), 'Relearning cannot attach to a normal obligation');
mustFail(() => api.validateWorkflowSpec({...workflow('questions'), targetCount:0}, 'application-practice'), 'Question target must be valid');
mustFail(() => api.validateWorkflowSpec({...workflow('questions'), questionSetRef:''}, 'application-practice'), 'Question workflow must identify its source set');
mustFail(() => api.validateWorkflowSpec(workflow('answer-writing'), 'memory-recall'), 'FSRS memory must reject answer-writing workflows');
mustFail(() => api.validateWorkflowSpec(workflow('recall'), 'application-practice'), 'Application obligations must require questions');

// Modality-specific evidence normalization.
const recallResult = {kind:'recall',responseMedium:'oral',attemptText:'',checkpointTotal:4,checkpointsMet:4,cueLevel:'none'};
api.validateWorkflowResult(recallResult,'recall'); checks++;
let normalized = api.workflowEvidence(recallResult, errors, '');
check(normalized.completeness === 4 && normalized.independence === 4, 'Recall should reflect checkpoint coverage and cueing');

const reconstructionResult = {kind:'reconstruction',responseMedium:'in-app',attemptText:'outline',shape:'outline',checkpointTotal:5,checkpointsMet:4,structuralAccuracy:3,relationshipAccuracy:4,cueLevel:'minor'};
api.validateWorkflowResult(reconstructionResult,'reconstruction'); checks++;
normalized = api.workflowEvidence(reconstructionResult, errors, '');
check(normalized.completeness === 3 && normalized.application === 4 && normalized.independence === 3, 'Reconstruction normalization is wrong');

const questionResult = {kind:'questions',targetCount:10,attempted:8,correct:6,partial:2,incorrect:0,novelCount:3,cueLevel:'none',questionSetRef:'Q-bank block 1',attemptNotes:'Reasoning notes',errorSummary:'Q4—missed qualifier'};
api.validateWorkflowResult(questionResult,'questions'); checks++;
normalized = api.workflowEvidence(questionResult, errors, '');
check(normalized.completeness === 3, 'Question completion should use the configured target');
check(Math.abs(normalized.accuracyPercent - 87.5) < .01 && normalized.application === 4, 'Question accuracy normalization is wrong');
mustFail(() => api.validateWorkflowResult({...questionResult,incorrect:2},'questions'), 'Question outcomes must reconcile');
mustFail(() => api.validateWorkflowResult({...questionResult,questionSetRef:''},'questions'), 'Question evidence must retain the question-set reference');

const diagramResult = {kind:'diagram',surface:'canvas',checkpointTotal:5,checkpointsMet:4,labelAccuracy:3,spatialAccuracy:4,processAccuracy:3,cueLevel:'none',attemptCompleted:true,notes:''};
api.validateWorkflowResult(diagramResult,'diagram'); checks++;
normalized = api.workflowEvidence(diagramResult, ['diagram-reconstruction'], '');
check(normalized.completeness === 3 && normalized.application === 3, 'Diagram evidence normalization is wrong');

const answerResult = {kind:'answer-writing',mode:'full-answer',responseMedium:'paper',answerText:'',demandAddressed:4,structure:4,contentAccuracy:3,examplesEvidence:3,conclusion:3,completedWithinTime:false,attemptElapsedMs:660000,timeLimitMinutes:10,wordCount:150,wordLimit:150,cueLevel:'none'};
api.validateWorkflowResult(answerResult,'answer-writing'); checks++;
normalized = api.workflowEvidence(answerResult, ['slow-retrieval'], '');
check(normalized.completeness === 3, 'Answer completion should reflect time compliance');
check(normalized.application === 3, 'Answer application evidence is wrong');
mustFail(() => api.validateWorkflowResult({...answerResult,attemptElapsedMs:-1},'answer-writing'), 'Answer attempt time must be valid');

const relearnResult = {kind:'relearning',diagnosis:'conceptual-misunderstanding',repairAction:'Rebuilt the mechanism',verificationText:'Explained it closed-book',checkpointTotal:2,checkpointsMet:2,sourceClosedForVerification:true,repairCompleted:true};
api.validateWorkflowResult(relearnResult,'relearning'); checks++;
normalized = api.workflowEvidence(relearnResult, errors, '');
check(normalized.completeness === 4 && normalized.independence === 4 && normalized.application === 3, 'Relearning evidence normalization is wrong');
mustFail(() => api.validateWorkflowResult({...relearnResult,sourceClosedForVerification:false},'relearning'), 'Relearning verification must remain closed-book');

check(api.suggestRating('memory-recall', evidence(0,0,0)) === 1, 'Failure should suggest Again');
check(api.suggestRating('memory-recall', evidence(3,4,2)) === 2, 'Incomplete recall should suggest Hard even when uncued');
check(api.suggestRating('memory-recall', evidence(4,3,2)) === 2, 'Cued recall should suggest Hard even when complete');
check(api.suggestRating('memory-recall', evidence(4,4,4)) === 3, 'Complete independent recall should default to Good; Easy remains a user judgement');
check(api.suggestRating('application-practice', evidence(3,3,3,85)) >= 3, 'Good application evidence should pass');
check(api.suggestRating('application-practice', evidence(3,3,3,85,['application-failure','conceptual-misunderstanding'])) <= 3, 'Errors should reduce suggestion');

function obligation(type, policy, workflowKind = api.defaultWorkflowForType(type)) {
  const spec = workflow(workflowKind);
  return { id:'o',unitId:'u',type,status:'active',dueAt:due,expectedMinutes:15,baselineMinutes:15,durationSampleCount:0,protocol:'Attempt properly',successCriteria:'Checkpoint one; Checkpoint two',workflow:spec,freshnessDays:30,priority:0,policyState:policy.createInitialState(due, 'o'),createdAt:due,updatedAt:due };
}
for (const Policy of [api.MasteryPolicy, api.ApplicationPolicy, api.PerformancePolicy, api.RelearnPolicy, api.FreshnessPolicy]) {
  const policy = new Policy();
  const o = obligation(policy.type, policy);
  const previews = policy.preview(o, new Date(due));
  check(previews.length === 4, `${policy.id} must preview four outcomes`);
  check(previews[0].intervalDays <= previews[1].intervalDays && previews[1].intervalDays <= previews[2].intervalDays && previews[2].intervalDays <= previews[3].intervalDays, `${policy.id} intervals must be monotonic`);
  const completed = policy.complete(o, 3, evidence(3,3,3,80), new Date(due));
  check(new Date(completed.dueAt) > new Date(due), `${policy.id} must schedule forward`);
}
async function testFsrs7Integration() {  await api.prepareFsrsScheduler(fixed(.9));
  const memory = new api.FsrsMemoryPolicy(() => fixed(.9));
  const memoryObligation = obligation('memory-recall', memory, 'recall');
  check(memoryObligation.policyState.fsrsCard.model === 'FSRS-7', 'New memory obligations must use FSRS-7');
  check(Number.isFinite(memoryObligation.policyState.fsrsCard.stabilityFast), 'FSRS-7 must persist the fast-memory trace');
  const defaultDifficulty=api.defaultMemoryDifficultyPolicy();
  check(defaultDifficulty.remediationLapses===2&&defaultDifficulty.persistentDifficultyLapses===4&&defaultDifficulty.automaticHold.enabled===false&&defaultDifficulty.automaticHold.lapseThreshold===8,'Persistent-difficulty defaults must preserve ordinary early relearning and keep automatic hold opt-in');
  const difficultyProbe=structuredClone(memoryObligation); difficultyProbe.expectedMinutes=60;
  difficultyProbe.policyState.fsrsCard.lapses=1;
  check(api.memoryDifficultyAssessment(difficultyProbe,defaultDifficulty).level==='normal','A first FSRS review lapse must remain ordinary relearning');
  difficultyProbe.policyState.fsrsCard.lapses=2;
  const remediation=api.memoryDifficultyAssessment(difficultyProbe,defaultDifficulty);
  check(remediation.level==='remediation'&&remediation.recommendedActions.includes('source-revisit')&&remediation.recommendedActions.includes('representation-change'),'Repeated FSRS lapses must escalate the kind of remediation');
  difficultyProbe.policyState.fsrsCard.lapses=4;
  const persistent=api.memoryDifficultyAssessment(difficultyProbe,defaultDifficulty);
  check(persistent.level==='persistent-difficulty'&&persistent.recommendedActions.includes('scope-review')&&persistent.recommendedActions.includes('split-scope')&&persistent.recommendedActions.includes('prerequisite-review')&&persistent.recommendedActions.includes('deliberate-intervention'),'Persistent difficulty must surface structural interventions for oversized memory work');
  const persistentPlan=api.memoryDifficultyRemediationPlan(persistent);
  check(persistentPlan.priorityBoost===4&&persistentPlan.guidance.includes('Persistent difficulty (4 FSRS lapses)'),'Persistent difficulty must strengthen remediation without replacing the relearning workflow');
  const holdPolicy={...defaultDifficulty,automaticHold:{enabled:true,lapseThreshold:8}};
  difficultyProbe.policyState.fsrsCard.lapses=8;
  check(api.memoryDifficultyAssessment(difficultyProbe,holdPolicy).automaticHoldEligible===true,'Automatic removal from the normal queue must require an explicit enabled final policy and threshold');
  mustFail(()=>api.canonicalMemoryDifficultyPolicy({...defaultDifficulty,remediationLapses:1}),'Difficulty policy must reject a threshold that escalates the first FSRS lapse');
  mustFail(()=>api.canonicalMemoryDifficultyPolicy({...defaultDifficulty,persistentDifficultyLapses:2}),'Persistent difficulty must occur strictly after remediation');
  mustFail(()=>api.validateStoredFsrsCard({...difficultyProbe.policyState.fsrsCard,scheduleStatus:'suspended'}),'FSRS scheduleStatus must not become a second suspension truth');
  check(memoryObligation.policyState.fsrsCard.cardId === 'o', 'FSRS cards must retain stable obligation identity');

  const previews = memory.preview(memoryObligation, new Date(due));
  check(previews.length === 4 && previews.map(item => item.rating).join(',') === '1,2,3,4', 'FSRS-7 must preview all four ratings');
  check(Math.abs(previews[0].intervalDays - 1) < .001, 'Again must use the one-day corrective learning step');
  check(previews[1].intervalDays > 1 && previews[1].intervalDays < 2, 'Hard must use the FSRS-7/model-override learning interval');
  check(previews[2].intervalDays > previews[1].intervalDays && previews[3].intervalDays > previews[2].intervalDays, 'Good and Easy must preserve monotonic FSRS-7 model intervals');

  const again = memory.complete(memoryObligation, api.Rating.Again, evidence(4,4,4), new Date(due));
  check(again.followUpType === 'relearn', 'Again must route through corrective relearning');
  check(Math.abs((new Date(again.dueAt) - new Date(due)) / 86400000 - 1) < .001, 'Again must persist the one-day scheduler due date');
  check(again.schedulerConfig.enableShortTerm === true && again.schedulerConfig.learningSteps.join(',') === '1d' && again.schedulerConfig.relearningSteps.join(',') === '1d', 'Revision Director must use one-day FSRS learning/relearning middleware');
  check(again.schedulerConfig.graduatingInterval === 1 && again.schedulerConfig.allowModelOverride === true, 'FSRS-7 graduation and model override must be explicit');
  check(/^fnv1a64:[0-9a-f]{16}$/.test(again.schedulerConfig.fingerprint), 'FSRS configuration must carry a deterministic fingerprint');
  mustFail(() => api.validateFsrsConfigSnapshot({...again.schedulerConfig, schedulingPolicy:fixed(.91)}), 'Tampered FSRS scheduling policy must fail its fingerprint');

  const againObservation = {
    evidenceEventId:'again-event', reviewedAt:due, rating:api.Rating.Again, source:'direct-memory',
    beforeCard:structuredClone(memoryObligation.policyState.fsrsCard),
    afterCard:structuredClone(again.policyState.fsrsCard),
    configFingerprint:again.schedulerConfig.fingerprint
  };
  const failedObligation = {...memoryObligation, dueAt:again.dueAt, policyState:again.policyState};
  const nextDay = new Date(new Date(due).getTime() + 86400000);
  const repaired = memory.complete(failedObligation, api.Rating.Good, evidence(4,4,3), nextDay, {memoryReviews:[againObservation]});
  const repairedDays = (new Date(repaired.dueAt) - nextDay) / 86400000;
  check(repairedDays >= 2.9 && repairedDays <= 3.1, 'Successful next-day repair must return to FSRS-7 at about a three-day interval');

  const good = memory.complete(memoryObligation, api.Rating.Good, evidence(3,3,1), new Date(due));
  check(good.policyId === 'memory/ts-fsrs@6.0.0/fsrs-7', 'FSRS-7 policy provenance must be explicit');
  check(good.policyState.fsrsCard.model === 'FSRS-7' && Number.isFinite(good.policyState.fsrsCard.stabilityFast), 'Reviewed FSRS-7 state must preserve both traces');
  check(good.schedulerConfig.model === 'FSRS-7' && good.schedulerConfig.schedulingPolicy.kind === 'fixed-retention' && good.schedulerConfig.schedulingPolicy.desiredRetention === .9 && good.schedulerConfig.fractionalDays === true, 'FSRS-7 configuration provenance must include the scheduling-policy discriminant');

  const goodObservation = {
    evidenceEventId:'good-event', reviewedAt:due, rating:api.Rating.Good, source:'direct-memory',
    beforeCard:structuredClone(memoryObligation.policyState.fsrsCard),
    afterCard:structuredClone(good.policyState.fsrsCard),
    configFingerprint:good.schedulerConfig.fingerprint
  };
  const reviewedObligation={...memoryObligation,dueAt:good.dueAt,policyState:structuredClone(good.policyState)};
  const reviewLapseAt=new Date(good.dueAt);
  const reviewLapse=memory.complete(reviewedObligation,api.Rating.Again,evidence(1,1,1),reviewLapseAt,{memoryReviews:[goodObservation]});
  check(reviewLapse.policyState.fsrsCard.lapses===1&&reviewLapse.followUpType==='relearn','The difficulty signal must use the FSRS Review-state lapse counter, while Again still routes to relearning');
  const port = api.revisionSchedulerPort(fixed(.9));
  port.verifyProjection(good.policyState.fsrsCard, [goodObservation]); checks++;
  const rescheduled = port.reschedule(memoryObligation.policyState.fsrsCard, [goodObservation]);
  check(rescheduled.dueAt === good.policyState.fsrsCard.dueAt && rescheduled.stabilityFast === good.policyState.fsrsCard.stabilityFast, 'Reschedule must reproduce a same-policy review transition');

  const halfDay = port.retrievability(good.policyState.fsrsCard, [goodObservation], new Date(new Date(due).getTime()+12*60*60*1000));
  const fullDay = port.retrievability(good.policyState.fsrsCard, [goodObservation], new Date(new Date(due).getTime()+24*60*60*1000));
  check(halfDay > fullDay && halfDay < 1, 'FSRS-7 retrievability must preserve fractional elapsed time within a day');

  const normalized = api.memoryReviewObservationsFor('o', [{
    id:'good-event', obligationId:'o', obligationType:'memory-recall', reviewedAt:due,
    confirmedRating:api.Rating.Good, beforePolicyState:memoryObligation.policyState,
    afterPolicyState:good.policyState, schedulerConfig:good.schedulerConfig
  }]);
  check(normalized.length === 1 && normalized[0].source === 'direct-memory' && normalized[0].configFingerprint === good.schedulerConfig.fingerprint, 'Evidence Events must normalize into canonical memory-review observations');

  const corruptedProjection = structuredClone(good.policyState.fsrsCard);
  corruptedProjection.stability += .01;
  mustFail(() => port.verifyProjection(corruptedProjection, [goodObservation]), 'Replay integrity must reject a corrupted materialized projection');
  const corruptedHistory = structuredClone([goodObservation]);
  corruptedHistory[0].rating = api.Rating.Again;
  mustFail(() => port.verifyProjection(good.policyState.fsrsCard, corruptedHistory), 'Replay integrity must reject history that no longer produces the immutable transition');
  check(context.FSRS === undefined, 'Temporary FSRS global must be removed after private capture');

  await Promise.all([api.prepareFsrsScheduler(fixed(.85)), api.prepareFsrsScheduler(fixed(.95))]);
  const lowerRetention = new api.FsrsMemoryPolicy(() => fixed(.85));
  const higherRetention = new api.FsrsMemoryPolicy(() => fixed(.95));
  check(lowerRetention.preview(obligation('memory-recall', lowerRetention), new Date(due))[3].intervalDays > higherRetention.preview(obligation('memory-recall', higherRetention), new Date(due))[3].intervalDays, 'Higher desired retention must shorten the Easy interval');

  const invalid = structuredClone(memoryObligation);
  delete invalid.policyState.fsrsCard.stabilityFast;
  mustFail(() => memory.preview(invalid, new Date(due)), 'Non-current FSRS card shapes must be rejected rather than transformed');
}

// Pass C planning factors and capacity selection.
check(api.examinationProximityScore(10) > api.examinationProximityScore(100), 'Closer examinations must raise planning priority');
check(api.planningLookaheadDays(10) === 3 && api.planningLookaheadDays(200) === .5, 'Planning horizon must contract for distant exams');
check(api.examImportanceScore(3) > api.examImportanceScore(1), 'Core knowledge must outrank useful knowledge');
check(api.reviewDurationScore(10, 60) > api.reviewDurationScore(60, 60), 'Shorter obligations should fit capacity more easily');
const weakUnit = {id:'weak',lapseCount:2};
const weakEvents = [
  {unitId:'weak',reviewedAt:'2026-07-24T00:00:00Z',confirmedRating:1,evidence:{completeness:1,independence:1,application:1,errorTypes:['conceptual-misunderstanding']}},
  {unitId:'weak',reviewedAt:'2026-07-20T00:00:00Z',confirmedRating:2,evidence:{completeness:2,independence:2,application:2,errorTypes:[]}},
];
check(api.evidenceWeaknessScore(weakEvents) > .6, 'Repeated weak evidence must create a strong weakness signal');
const dayStart = new Date('2026-07-25T04:00:00Z');
const dayEnd = new Date('2026-07-26T04:00:00Z');
check(api.temporalDueRisk(new Date('2026-07-20T04:00:00Z'), dayStart, dayEnd, 1) > api.temporalDueRisk(new Date('2026-07-26T12:00:00Z'), dayStart, dayEnd, 1), 'Overdue work must carry higher due risk');
const planItem = (id, score, mins, type='concept-reconstruction', state='due') => ({
  joined:{obligation:{id,type,dueAt:due,expectedMinutes:mins},unit:{},profile:{}}, score, dueState:state, executionMinutes:mins, factors:{dueRisk:.7,examImportance:.7,weakness:.5,reviewDuration:.8,examinationProximity:.5,weeklyBalance:.5}
});
let packed = api.choosePlanItems([planItem('a',90,40),planItem('b',80,20),planItem('c',70,20)],60);
check(packed.selected.reduce((sum,item)=>sum+item.joined.obligation.expectedMinutes,0) <= 60, 'Daily plan must respect capacity when feasible');
check(packed.selected.some(item=>item.joined.obligation.id==='a'), 'Highest-value feasible obligation should be retained');
packed = api.choosePlanItems([planItem('r',95,90,'relearn','overdue'),planItem('n',70,20)],60);
check(packed.selected.length === 1 && packed.selected[0].joined.obligation.id === 'r', 'Oversized critical relearning must remain visible as a necessary overrun');

const router = new api.SchedulerPolicyRouter(() => fixed(.9));
for (const type of ['memory-recall','concept-reconstruction','application-practice','performance-practice','relearn','freshness-review']) check(router.get(type).type === type, `Router missing ${type}`);

// Workflow UI surfaces are distinct rather than one generic rubric.
const ui = Object.create(api.UIController.prototype);
ui.reviewPreviews = [{rating:1,label:'1d'},{rating:2,label:'2d'},{rating:3,label:'3d'},{rating:4,label:'8d'}];
const uiMemoryPolicy = {
  createInitialState(firstDueAt, cardId) {
    return {
      engine:'ts-fsrs',version:'6.0.0',stage:0,successStreak:0,failureCount:0,lastIntervalDays:0,
      fsrsCard:{model:'FSRS-7',cardId,dueAt:firstDueAt,stability:0,stabilityFast:0,difficulty:0,scheduledDays:0,learningSteps:0,reps:0,lapses:0,state:0,scheduleStatus:'new'}
    };
  }
};
const uiObligation = (kind) => {
  const type = kind === 'recall' ? 'memory-recall' : kind === 'reconstruction' ? 'concept-reconstruction' : kind === 'questions' ? 'application-practice' : kind === 'relearning' ? 'relearn' : 'performance-practice';
  const policy = kind === 'recall' ? uiMemoryPolicy : kind === 'reconstruction' ? new api.MasteryPolicy() : kind === 'questions' ? new api.ApplicationPolicy() : kind === 'relearning' ? new api.RelearnPolicy() : new api.PerformancePolicy();
  return {...obligation(type, policy, kind), workflow:workflow(kind)};
};
check(ui.workflowAttemptPanel(uiObligation('recall')).includes('attempt-text'), 'Recall must provide a closed-book workspace');
check(ui.workflowAttemptPanel(uiObligation('questions')).includes('attempt-completed'), 'Question workflow must require pre-check attempt confirmation');
check(ui.workflowAttemptPanel(uiObligation('diagram')).includes('diagram-canvas'), 'Diagram workflow must provide the canvas');
check(ui.workflowAttemptPanel(uiObligation('answer-writing')).includes('attempt-completed') && ui.workflowAttemptPanel(uiObligation('answer-writing')).includes('150 words'), 'Answer writing must enforce an external or in-app constrained attempt');
check(ui.workflowAssessmentPanel(uiObligation('reconstruction')).includes('relationship-accuracy'), 'Reconstruction must assess relationships');
check(ui.workflowAssessmentPanel(uiObligation('questions')).includes('questions-correct'), 'Questions must capture objective outcomes');
check(ui.workflowAssessmentPanel(uiObligation('diagram')).includes('diagram-spatial'), 'Diagram practice must assess spatial form');
check(ui.workflowAssessmentPanel(uiObligation('answer-writing')).includes('answer-demand'), 'Answer writing must assess question demand');
check(ui.attemptComparisonPanel(uiObligation('recall')).includes('comparison-attempt-text'), 'Recall comparison must keep the original attempt visible');
check(ui.attemptComparisonPanel(uiObligation('diagram')).includes('comparison-diagram-canvas'), 'Diagram comparison must preserve the drawn attempt');
check(ui.workflowAttemptPanel(uiObligation('questions')).includes('Q-bank block 1'), 'Question workflow must display the question-set reference');
check(ui.workflowAssessmentPanel(uiObligation('questions')).includes('questions-error-summary'), 'Question workflow must capture per-question errors');
check(ui.workflowAssessmentPanel(uiObligation('answer-writing')).includes('Automatic attempt timing') && !ui.workflowAssessmentPanel(uiObligation('answer-writing')).includes('answer-within-time'), 'Answer timing must be automatic rather than self-declared');
const failedEventForPanel = { reviewedAt:due, confirmedRating:1, evidence:{completeness:1,independence:1,application:1,errorTypes:['conceptual-misunderstanding'],correctionNote:'Repair the causal chain'}, workflowResult:recallResult };
check(ui.relearningTriggerPanel(failedEventForPanel).includes('WHY THIS RELEARNING EXISTS') && ui.relearningTriggerPanel(failedEventForPanel).includes('Repair the causal chain'), 'Relearning must expose the triggering failure and correction');

const dummyRepo = {};
const service = new api.RevisionService(dummyRepo);
const validBackup = {format:'revision-director-backup',schemaVersion:2,exportedAt:due,appVersion:'va7.1-pass-f1',profiles:[{schemaVersion:1,id:'p',name:'Exam',examDate:'',status:'active',createdAt:due,updatedAt:due}],nodes:[{schemaVersion:1,id:'s',profileId:'p',parentId:null,kind:'subject',name:'S',normalizedName:'s',createdAt:due,updatedAt:due},{schemaVersion:1,id:'c',profileId:'p',parentId:'s',kind:'section',name:'C',normalizedName:'c',createdAt:due,updatedAt:due},{schemaVersion:1,id:'t',profileId:'p',parentId:'c',kind:'topic',name:'T',normalizedName:'t',createdAt:due,updatedAt:due}],units:[{schemaVersion:1,id:'u',profileId:'p',topicNodeId:'t',title:'U',scope:'scope',source:'',importance:3,status:'active',createdAt:due,updatedAt:due,evidenceCount:0,lapseCount:0}],studyEvents:[],obligations:[],evidenceEvents:[],chunks:[],dailyPlans:[],settings:{schemaVersion:1,key:'app',activeProfileId:'p',fsrsScheduling:{policy:fixed(.9)},memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}},dailyCapacityMinutes:60,studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false}},activeRetrieval:null};
check(service.validateBackup(validBackup).format === 'revision-director-backup', 'Valid backup should pass');
const conceptPolicy = new api.MasteryPolicy();
const conceptObligation = { schemaVersion:1, ...obligation('concept-reconstruction', conceptPolicy, 'reconstruction'), id:'o' };
const conceptEvidence = { schemaVersion:1, id:'e', profileId:'p', unitId:'u', obligationId:'o', obligationType:'concept-reconstruction', reviewedAt:due, elapsedMs:1000, evidence:evidence(3,3,3), workflow:'reconstruction', workflowResult:reconstructionResult, suggestedRating:3, confirmedRating:3, beforeDueAt:due, afterDueAt:new Date(Date.parse(due)+3*86400000).toISOString(), beforePolicyState:conceptObligation.policyState, afterPolicyState:{...conceptObligation.policyState,stage:1,successStreak:1,lastIntervalDays:3}, policyId:'concept-mastery/v1', durationObservation:{plannedMinutes:15,actualMinutes:15,accepted:true,reason:'accepted',estimateBefore:15,estimateAfter:15,exactSamples:1,unitWorkflowSamples:0,globalWorkflowSamples:0}, timing:{totalActiveMs:1000,activeByPhase:{attempt:1000,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]}, createdAt:due };
for (const mutation of [
  {...validBackup,format:'wrong'},
  {...validBackup,profiles:[...validBackup.profiles,{...validBackup.profiles[0]}]},
  {...validBackup,profiles:[{...validBackup.profiles[0],examDate:'not-a-date'}]},
  {...validBackup,profiles:[{...validBackup.profiles[0],examDate:'2026-02-31'}]},
  {...validBackup,nodes:[{...validBackup.nodes[0],profileId:'missing'}]},
  {...validBackup,nodes:validBackup.nodes.map(n=>n.id==='c'?{...n,parentId:'t'}:n)},
  {...validBackup,units:[{...validBackup.units[0],topicNodeId:'missing'}]},
  {...validBackup,obligations:[{...conceptObligation,unitId:'missing'}]},
  {...validBackup,obligations:[{...conceptObligation,workflow:workflow('relearning')}]},
  {...validBackup,obligations:[{...conceptObligation,policyState:{...conceptObligation.policyState,engine:'application'}}]},
  {...validBackup,obligations:[conceptObligation],evidenceEvents:[{...conceptEvidence,workflow:'questions'}]},
  {...validBackup,settings:{...validBackup.settings,activeProfileId:'missing'}},
  {...validBackup,settings:{...validBackup.settings,fsrsScheduling:{policy:fixed(1.2)}}},
]) mustFail(() => service.validateBackup(mutation), 'Hostile backup should fail');
check(service.validateBackup({...validBackup,units:[{...validBackup.units[0],evidenceCount:1}],obligations:[{...conceptObligation,durationSampleCount:1}],evidenceEvents:[conceptEvidence]}).evidenceEvents.length === 1, 'Relational workflow evidence backup should pass');
mustFail(()=>service.validateBackup({...validBackup,units:[{...validBackup.units[0],evidenceCount:1}],obligations:[{...conceptObligation,durationSampleCount:1}],evidenceEvents:[(({timing,...rest})=>rest)(conceptEvidence)]}),'Current evidence without timing must be rejected');
const chunkedObligation={...conceptObligation,chunking:{cycleId:'cycle',status:'chunking',originalMinutes:15,synthesisMinutes:5,capacityMinutes:60,totalChunks:2,completedChunks:1,createdAt:due}};
const chunkRecords=[
  {schemaVersion:1,id:'ch1',obligationId:'o',cycleId:'cycle',ordinal:1,total:2,label:'U · Part 1 of 2',scope:'Part 1 of 2',expectedMinutes:5,status:'completed',createdAt:due,updatedAt:due,completedAt:due,actualMinutes:6,note:'',timing:{totalActiveMs:360000,activeByPhase:{attempt:360000,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]}},
  {schemaVersion:1,id:'ch2',obligationId:'o',cycleId:'cycle',ordinal:2,total:2,label:'U · Part 2 of 2',scope:'Part 2 of 2',expectedMinutes:5,status:'pending',createdAt:due,updatedAt:due},
];
const dailyPlan={schemaVersion:1,id:'dp',studyDayKey:'2026-07-25',createdAt:due,updatedAt:due,plannerVersion:'pass-d-2',versions:[{version:1,generatedAt:due,capacityMinutes:60,reason:'initial',items:[{key:'o::ch1',obligationId:'o',chunkId:'ch1',profileId:'p',unitId:'u',subject:'S',workflow:'reconstruction',title:'U · Part 1 of 2',estimatedMinutes:5,score:70,disposition:'selected',reasons:[]}]}],outcomes:[{itemKey:'o::ch1',status:'completed',startedAt:due,completedAt:due,actualMinutes:6}]};
const passDBackup={...validBackup,obligations:[chunkedObligation],chunks:chunkRecords,dailyPlans:[dailyPlan]};
check(service.validateBackup(passDBackup).dailyPlans.length===1,'Chunk and persisted-plan records must survive relational backup validation');
mustFail(()=>service.validateBackup({...passDBackup,chunks:[chunkRecords[1]]}),'Daily plans must reject missing chunk references');
mustFail(()=>service.validateBackup({...passDBackup,dailyPlans:[{...dailyPlan,plannerVersion:'wrong'}]}),'Daily plans must reject unknown planner versions');
mustFail(()=>service.validateBackup({...passDBackup,dailyPlans:[{...dailyPlan,versions:[{...dailyPlan.versions[0],reason:'wrong'}]}]}),'Daily plans must reject unknown amendment reasons');
mustFail(()=>service.validateBackup({...passDBackup,obligations:[{...chunkedObligation,chunking:{...chunkedObligation.chunking,completedChunks:0}}]}),'Chunk counters must match durable chunk records');
mustFail(()=>service.validateBackup({...passDBackup,dailyPlans:[{...dailyPlan,outcomes:[{itemKey:'unknown',status:'completed',completedAt:due,actualMinutes:5}]}]}),'Daily-plan outcomes must reference a known planned item');

async function testTriggerEvidenceLookup() {
  const trigger = { id:'trigger', followUpObligationId:'relearn', obligationId:'original', reviewedAt:due };
  const lookup = new api.RevisionService({});
  lookup.obligation = async () => ({ type:'relearn', id:'relearn', parentObligationId:'original' });
  lookup.evidenceEvents = async () => [trigger];
  check((await lookup.triggeringEvidence('relearn')) === trigger, 'Relearning must retrieve the exact triggering evidence event');
}

async function testRelearningLifecycle() {
  await api.prepareFsrsScheduler(fixed(.9));
  const memory = new api.FsrsMemoryPolicy(() => fixed(.9));
  const unit = { id:'u', profileId:'p', topicNodeId:'t', title:'U', scope:'scope', source:'', importance:3, status:'active', createdAt:due, updatedAt:due, evidenceCount:0, lapseCount:0 };
  const original = { ...obligation('memory-recall', memory, 'recall'), id:'original', unitId:'u', priority:1 };
  original.policyState.fsrsCard.cardId = 'original';
  const calls = [];
  const repo = { get: async (_store, key) => key === 'original' ? original : undefined, dailyPlanByStudyDay: async()=>undefined, recordReview: async (...args) => { calls.push(args); } };
  const lifecycle = new api.RevisionService(repo);
  lifecycle.obligation = async () => original;
  lifecycle.unit = async () => unit;
  lifecycle.obligationsForUnit = async () => [];
  lifecycle.evidenceEvents = async () => [];
  lifecycle.chunksForObligation = async () => [];
  lifecycle.markPlanItemCompleted = async () => {};
  await lifecycle.recordEvidence('original', { ...evidence(0,0,0), workflowResult:{...recallResult,checkpointTotal:4,checkpointsMet:0}, elapsedMs:1000, timing:{totalActiveMs:1000,activeByPhase:{attempt:1000,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]}, confirmedRating:1 }, new Date(due));
  check(calls.length === 1, 'Failed review must commit once');
  check(calls[0][1].status === 'suspended' && calls[0][1].suspensionReason === 'relearning', 'Failed original must be paused for relearning');
  check(calls[0][3]?.type === 'relearn' && calls[0][3]?.workflow.kind === 'relearning', 'Failed review must create a proper relearning workflow');
  check(calls[0][3]?.returnObligationId === 'original', 'Relearning must return to its exact original');
  check(Math.abs((new Date(calls[0][1].dueAt) - new Date(due)) / 86400000 - 1) < .001, 'Failed FSRS memory must retain the one-day scheduler due date while suspended');
  const failedMemoryEvent = structuredClone(calls[0][2]);

  const failedState = structuredClone(calls[0][1].policyState);
  original.policyState = failedState;
  original.dueAt = calls[0][1].dueAt;
  const relearnPolicy = new api.RelearnPolicy();
  const nextDay = new Date(new Date(due).getTime() + 86400000);
  const relearn = { ...obligation('relearn', relearnPolicy, 'relearning'), id:'relearn', unitId:'u', returnObligationId:'original', policyState:{ ...relearnPolicy.createInitialState(nextDay.toISOString()), successStreak:1 } };
  original.status = 'suspended'; original.suspensionReason='relearning';
  calls.length = 0;
  lifecycle.obligation = async () => relearn;
  lifecycle.obligationsForUnit = async () => [relearn];
  lifecycle.evidenceEvents = async () => [failedMemoryEvent];
  await lifecycle.recordEvidence('relearn', { ...evidence(4,4,3), workflowResult:relearnResult, elapsedMs:1000, timing:{totalActiveMs:1000,activeByPhase:{attempt:1000,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]}, confirmedRating:3 }, nextDay);
  check(calls[0][1].status === 'completed', 'Relearning must complete after two successful cycles');
  const returnedTransition = calls[0][2].returnedMemoryTransition;
  check(returnedTransition?.obligationId === 'original' && returnedTransition?.rating === api.Rating.Good, 'Successful relearning must record the returned-memory FSRS transition');
  check(returnedTransition?.schedulerModel === 'FSRS-7' && returnedTransition?.schedulerVersion === '6.0.0', 'Returned-memory transition must preserve exact FSRS-7 provenance');
  const resumed = calls[0][4];
  check(resumed?.status === 'active', 'Original obligation must reactivate atomically');
  check(resumed?.policyState.fsrsCard.dueAt === resumed?.dueAt, 'Reactivated FSRS due state must stay synchronized');
  check(returnedTransition?.afterDueAt === resumed?.dueAt && returnedTransition?.afterPolicyState.fsrsCard.dueAt === resumed?.dueAt, 'Returned-memory transition must exactly describe the reactivated FSRS state');
  check(resumed?.policyState.fsrsCard.model === 'FSRS-7', 'Reactivated memory must remain FSRS-7');
  const resumedDays = (new Date(resumed.dueAt) - nextDay) / 86400000;
  check(resumedDays >= 2.9 && resumedDays <= 3.1, 'Successful relearning must advance the original through FSRS-7 rather than a fixed app interval');
  const canonicalHistory = api.memoryReviewObservationsFor('original', [failedMemoryEvent, calls[0][2]]);
  check(canonicalHistory.length === 2 && canonicalHistory[0].source === 'direct-memory' && canonicalHistory[1].source === 'relearning-return', 'Canonical memory history must include the corrective return transition');
  api.revisionSchedulerPort(fixed(.9)).verifyProjection(resumed.policyState.fsrsCard, canonicalHistory); checks++;
}


async function testPersistentDifficultyResume() {
  const held={id:'held',unitId:'u',type:'memory-recall',status:'suspended',suspensionReason:'persistent-difficulty',updatedAt:due};
  const unit={id:'u',status:'active'};
  let persisted;
  const svc=new api.RevisionService({put:async(_store,value)=>{persisted=structuredClone(value);}});
  svc.obligation=async()=>held;
  svc.unit=async()=>unit;
  svc.obligationsForUnit=async()=>[];
  await svc.resumePersistentDifficulty('held');
  check(persisted?.status==='active'&&persisted?.suspensionReason===undefined,'A deliberate manual resume must clear only the host-owned persistent-difficulty hold');
}

async function testAutomaticPersistentDifficultyHold() {
  await api.prepareFsrsScheduler(fixed(.9));
  const memory=new api.FsrsMemoryPolicy(()=>fixed(.9));
  const unit={id:'u',profileId:'p',topicNodeId:'t',title:'U',scope:'scope',source:'',importance:3,status:'active',createdAt:due,updatedAt:due,evidenceCount:0,lapseCount:8};
  const original={...obligation('memory-recall',memory,'recall'),id:'persistent-original',unitId:'u',status:'suspended',suspensionReason:'relearning'};
  original.policyState.fsrsCard.cardId='persistent-original';
  original.policyState.fsrsCard.lapses=8;
  original.policyState.fsrsCard.reps=12;
  original.policyState.fsrsCard.state=2;
  original.policyState.fsrsCard.scheduleStatus='review';
  const relearnPolicy=new api.RelearnPolicy();
  const relearn={...obligation('relearn',relearnPolicy,'relearning'),id:'persistent-relearn',unitId:'u',returnObligationId:'persistent-original',policyState:{...relearnPolicy.createInitialState(due),successStreak:1}};
  const calls=[];
  const repo={get:async(_store,key)=>key==='persistent-original'?original:undefined,dailyPlanByStudyDay:async()=>undefined,recordReview:async(...args)=>{calls.push(args);}};
  const svc=new api.RevisionService(repo);
  svc.settings={...svc.getSettings(),memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:true,lapseThreshold:8}}};
  svc.obligation=async()=>relearn;
  svc.unit=async()=>unit;
  svc.obligationsForUnit=async()=>[relearn];
  svc.evidenceEvents=async()=>[];
  svc.chunksForObligation=async()=>[];
  svc.markPlanItemCompleted=async()=>{};
  const realGet=svc.router.get.bind(svc.router);
  const returnedDue=new Date(Date.parse(due)+3*86400000).toISOString();
  svc.router.get=(type)=>type==='memory-recall'?{
    complete:()=>({
      dueAt:returnedDue,
      policyState:{...structuredClone(original.policyState),successStreak:1,lastIntervalDays:3,fsrsCard:{...structuredClone(original.policyState.fsrsCard),dueAt:returnedDue,lastReviewAt:due}},
      policyId:'memory/ts-fsrs@6.0.0/fsrs-7',
      reviewLog:{},
      schedulerConfig:{model:'FSRS-7',schedulingPolicy:fixed(.9),fractionalDays:true,enableFuzz:false,enableShortTerm:true,learningSteps:['1d'],relearningSteps:['1d'],graduatingInterval:1,allowModelOverride:true,maximumInterval:36500,clearStatsOnForget:false,weightsSource:'ts-fsrs-package-default',weightsFingerprint:'fnv1a64:0000000000000001',fingerprint:'fnv1a64:0000000000000002'}
    })
  }:realGet(type);
  await svc.recordEvidence('persistent-relearn',{...evidence(4,4,3),workflowResult:relearnResult,elapsedMs:1000,timing:{totalActiveMs:1000,activeByPhase:{attempt:1000,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]},confirmedRating:3},new Date(due));
  const heldAgain=calls[0]?.[4];
  check(calls[0]?.[2]?.returnedMemoryTransition?.obligationId==='persistent-original','Persistent difficulty must still complete the verified return transition to the original FSRS card');
  check(heldAgain?.status==='suspended'&&heldAgain?.suspensionReason==='persistent-difficulty','Enabled final policy may hold a persistently difficult memory obligation only after successful remediation');
  check(heldAgain?.policyState.fsrsCard.scheduleStatus==='review','Host queue hold must not mutate FSRS scheduleStatus');
}

async function testDifficultyPolicyReconciliation() {
  await api.prepareFsrsScheduler(fixed(.9));
  const memory=new api.FsrsMemoryPolicy(()=>fixed(.9));
  const held={...obligation('memory-recall',memory,'recall'),id:'held-policy',unitId:'u',status:'suspended',suspensionReason:'persistent-difficulty'};
  held.policyState.fsrsCard.cardId='held-policy';
  held.policyState.fsrsCard.lapses=8;
  held.policyState.fsrsCard.reps=12;
  held.policyState.fsrsCard.state=2;
  held.policyState.fsrsCard.scheduleStatus='review';
  const current={schemaVersion:1,key:'app',activeProfileId:'',fsrsScheduling:{policy:fixed(.9)},memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:true,lapseThreshold:8}},dailyCapacityMinutes:60,studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false}};
  let atomic;
  const svc=new api.RevisionService({
    put:async()=>{},
    replaceSettingsAndObligations:async(settings,obligations)=>{atomic={settings:structuredClone(settings),obligations:structuredClone(obligations)};}
  });
  svc.settings=structuredClone(current);
  svc.profiles=async()=>[];
  svc.obligations=async()=>[held];
  svc.units=async()=>[{id:'u',status:'active'}];
  const disabled={...current,memoryDifficultyPolicy:{...current.memoryDifficultyPolicy,automaticHold:{enabled:false,lapseThreshold:8}}};
  await svc.saveSettings(disabled);
  check(atomic?.settings.memoryDifficultyPolicy.automaticHold.enabled===false&&atomic?.obligations[0]?.status==='active'&&atomic?.obligations[0]?.suspensionReason===undefined,'Disabling automatic hold must atomically return stale policy-held memory to an active unit');

  atomic=undefined;
  svc.settings=structuredClone(current);
  svc.units=async()=>[{id:'u',status:'suspended'}];
  await svc.saveSettings({...current,memoryDifficultyPolicy:{remediationLapses:9,persistentDifficultyLapses:10,automaticHold:{enabled:true,lapseThreshold:12}}});
  check(atomic?.obligations[0]?.status==='suspended'&&atomic?.obligations[0]?.suspensionReason==='unit','Releasing a stale persistent-difficulty hold must preserve an independent unit-level pause');
}

async function testStudyEventRuntimeBoundary() {
  const stored = [];
  const repo = {
    get: async (_store, key) => key === 'p' ? { id:'p', name:'Exam', examDate:'', status:'active', createdAt:due, updatedAt:due } : undefined,
    put: async (_store, value) => { stored.push(value); },
  };
  const boundary = new api.RevisionService(repo);
  const base = { profileId:'p', occurredAt:due, activityMode:'learn', area:'A', task:'T', measure:'M', source:'', durationMinutes:10, understanding:3, linkedUnitIds:[], notes:'', origin:'study-director' };
  await boundary.logStudyEvent(base); check(stored.length === 1, 'Valid Study Event should persist');
  for (const mutation of [
    {...base,activityMode:'evil'},
    {...base,understanding:99},
    {...base,origin:'unknown'},
    {...base,occurredAt:'not-a-date'},
    {...base,linkedUnitIds:null},
  ]) {
    let failed=false; try { await boundary.logStudyEvent(mutation); } catch { failed=true; }
    check(failed, 'Invalid Study Event runtime payload must fail');
  }
}

async function testDueSummaryScope() {
  const svc = new api.RevisionService({});
  svc.settings = { schemaVersion:1, key:'app', activeProfileId:'active', fsrsScheduling:{policy:fixed(.9)}, memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}}, dailyCapacityMinutes:60, studyDayBoundaryHour:4, fsrsPersonalization:{profile:null,active:false} };
  const obligation = { id:'o', unitId:'u', type:'concept-reconstruction', status:'active', dueAt:'2026-07-25T05:00:00Z', expectedMinutes:10, baselineMinutes:10, durationSampleCount:0, protocol:'x', successCriteria:'x', workflow:{kind:'reconstruction',prompt:'x',checkpoints:['x'],responseMedium:'in-app',reconstructionShape:'outline'}, freshnessDays:30, priority:0, policyState:{engine:'mastery',version:'1',stage:0,successStreak:0,failureCount:0,lastIntervalDays:0}, createdAt:due, updatedAt:due };
  const unit = { id:'u', profileId:'p', topicNodeId:'t', title:'U', scope:'x', source:'', importance:3, status:'active', createdAt:due, updatedAt:due, evidenceCount:0, lapseCount:0 };
  const join = (id,status,examDate) => ({ obligation:{...obligation,id}, unit:{...unit,id:'u'+id,profileId:id}, profile:{id,name:id,examDate,status,createdAt:due,updatedAt:due}, subject:'S',section:'C',topic:'T' });
  svc.joinedObligations = async () => [join('active','active','2026-08-01'),join('paused','suspended','2026-08-01'),join('past','active','2026-07-24')];
  const dueItems = await svc.dueQueue(new Date('2026-07-25T12:00:00Z'));
  check(dueItems.length === 1 && dueItems[0].profile.id === 'active', 'Due queue must exclude paused and passed exam profiles');
}

async function testSettingsBoundary() {
  const repo = { getAll: async () => [{schemaVersion:1,id:'p',name:'Exam',examDate:'',status:'active',createdAt:due,updatedAt:due}], get: async (_store,key) => key==='p' ? {schemaVersion:1,id:'p',status:'active'} : undefined, put: async()=>{} };
  const svc = new api.RevisionService(repo);
  const base = { schemaVersion:1, key:'app', activeProfileId:'p', fsrsScheduling:{policy:fixed(.9)}, memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}}, dailyCapacityMinutes:60, studyDayBoundaryHour:4, fsrsPersonalization:{profile:null,active:false} };
  await svc.saveSettings(base); check(true, 'Valid settings should save');
  for (const mutation of [{...base,activeProfileId:'missing'},{...base,dailyCapacityMinutes:60.5},{...base,studyDayBoundaryHour:4.5},{...base,memoryDifficultyPolicy:{...base.memoryDifficultyPolicy,remediationLapses:1}},{...base,memoryDifficultyPolicy:{...base.memoryDifficultyPolicy,persistentDifficultyLapses:2}}]) {
    let failed=false; try { await svc.saveSettings(mutation); } catch { failed=true; }
    check(failed, 'Invalid settings boundary must fail');
  }
}

Promise.all([testFsrs7Integration(), testTriggerEvidenceLookup(), testRelearningLifecycle(), testPersistentDifficultyResume(), testAutomaticPersistentDifficultyHold(), testDifficultyPolicyReconciliation(), testStudyEventRuntimeBoundary(), testDueSummaryScope(), testSettingsBoundary()]).then(() => console.log(`PASS ${checks} kernel, workflow, policy and backup checks`)).catch((error) => { console.error(error); process.exitCode = 1; });
