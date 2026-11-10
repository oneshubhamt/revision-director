'use strict';
const fs = require('fs');
const vm = require('vm');
const { webcrypto } = require('crypto');
const path = require('path');
const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_TEST_API__ = { suggestRating, objectiveScore, workflowEvidence, validateWorkflowResult, validateWorkflowSpec, defaultWorkflowSpec, defaultWorkflowForType, compatibleWorkflows, MasteryPolicy, ApplicationPolicy, PerformancePolicy, RelearnPolicy, FreshnessPolicy, SchedulerPolicyRouter, FsrsMemoryPolicy, RevisionService, UIController, Rating, examinationProximityScore, planningLookaheadDays, examImportanceScore, reviewDurationScore, evidenceWeaknessScore, obligationWeaknessScore, temporalDueRisk, plannerScore, buildPlanningCandidate, choosePlanItems, fsrsRetrievability, prepareFsrsScheduler, daysToExamination, durationObservationFor, weeklySubjectBalanceScores, createAutomaticChunks, interleaveSelected, planItemKey };';
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
let checks = 0;
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
check(api.suggestRating('memory-recall', evidence(4,4,4)) === 4, 'Strong evidence should suggest Easy');
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
async function testFsrs7Integration() {
  await api.prepareFsrsScheduler(.9);
  const memory = new api.FsrsMemoryPolicy(() => .9);
  const memoryObligation = obligation('memory-recall', memory, 'recall');
  check(memoryObligation.policyState.fsrsCard.model === 'FSRS-7', 'New memory obligations must use FSRS-7');
  check(Number.isFinite(memoryObligation.policyState.fsrsCard.stabilityFast), 'FSRS-7 must persist the fast-memory trace');
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

  const failedObligation = {...memoryObligation, dueAt:again.dueAt, policyState:again.policyState};
  const nextDay = new Date(new Date(due).getTime() + 86400000);
  const repaired = memory.complete(failedObligation, api.Rating.Good, evidence(4,4,3), nextDay);
  const repairedDays = (new Date(repaired.dueAt) - nextDay) / 86400000;
  check(repairedDays >= 2.9 && repairedDays <= 3.1, 'Successful next-day repair must return to FSRS-7 at about a three-day interval');

  const good = memory.complete(memoryObligation, api.Rating.Good, evidence(3,3,1), new Date(due));
  check(good.policyId === 'memory/ts-fsrs@6.0.0/fsrs-7', 'FSRS-7 policy provenance must be explicit');
  check(good.policyState.fsrsCard.model === 'FSRS-7' && Number.isFinite(good.policyState.fsrsCard.stabilityFast), 'Reviewed FSRS-7 state must preserve both traces');
  check(good.schedulerConfig.model === 'FSRS-7' && good.schedulerConfig.desiredRetention === .9 && good.schedulerConfig.fractionalDays === true, 'FSRS-7 configuration provenance must be complete');
  const halfDay = api.fsrsRetrievability({...memoryObligation, policyState:good.policyState}, new Date(new Date(due).getTime()+12*60*60*1000), .9);
  const fullDay = api.fsrsRetrievability({...memoryObligation, policyState:good.policyState}, new Date(new Date(due).getTime()+24*60*60*1000), .9);
  check(halfDay > fullDay && halfDay < 1, 'FSRS-7 retrievability must preserve fractional elapsed time within a day');
  check(context.FSRS === undefined, 'Temporary FSRS global must be removed after private capture');

  await Promise.all([api.prepareFsrsScheduler(.85), api.prepareFsrsScheduler(.95)]);
  const lowerRetention = new api.FsrsMemoryPolicy(() => .85);
  const higherRetention = new api.FsrsMemoryPolicy(() => .95);
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

const router = new api.SchedulerPolicyRouter(() => .9);
for (const type of ['memory-recall','concept-reconstruction','application-practice','performance-practice','relearn','freshness-review']) check(router.get(type).type === type, `Router missing ${type}`);

// Workflow UI surfaces are distinct rather than one generic rubric.
const ui = Object.create(api.UIController.prototype);
ui.reviewPreviews = [{rating:1,label:'1d'},{rating:2,label:'2d'},{rating:3,label:'3d'},{rating:4,label:'8d'}];
const uiObligation = (kind) => {
  const type = kind === 'recall' ? 'memory-recall' : kind === 'reconstruction' ? 'concept-reconstruction' : kind === 'questions' ? 'application-practice' : kind === 'relearning' ? 'relearn' : 'performance-practice';
  const policy = kind === 'recall' ? memory : kind === 'reconstruction' ? new api.MasteryPolicy() : kind === 'questions' ? new api.ApplicationPolicy() : kind === 'relearning' ? new api.RelearnPolicy() : new api.PerformancePolicy();
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
const validBackup = {format:'revision-director-backup',schemaVersion:2,exportedAt:due,appVersion:'x',profiles:[{schemaVersion:1,id:'p',name:'Exam',examDate:'',status:'active',createdAt:due,updatedAt:due}],nodes:[{schemaVersion:1,id:'s',profileId:'p',parentId:null,kind:'subject',name:'S',normalizedName:'s',createdAt:due,updatedAt:due},{schemaVersion:1,id:'c',profileId:'p',parentId:'s',kind:'section',name:'C',normalizedName:'c',createdAt:due,updatedAt:due},{schemaVersion:1,id:'t',profileId:'p',parentId:'c',kind:'topic',name:'T',normalizedName:'t',createdAt:due,updatedAt:due}],units:[{schemaVersion:1,id:'u',profileId:'p',topicNodeId:'t',title:'U',scope:'scope',source:'',importance:3,status:'active',createdAt:due,updatedAt:due,evidenceCount:0,lapseCount:0}],studyEvents:[],obligations:[],evidenceEvents:[],chunks:[],dailyPlans:[],settings:{schemaVersion:1,key:'app',activeProfileId:'p',desiredRetention:.9,dailyCapacityMinutes:60,studyDayBoundaryHour:4},activeRetrieval:null};
check(service.validateBackup(validBackup).format === 'revision-director-backup', 'Valid backup should pass');
const conceptPolicy = new api.MasteryPolicy();
const conceptObligation = { schemaVersion:1, ...obligation('concept-reconstruction', conceptPolicy, 'reconstruction'), id:'o' };
const conceptEvidence = { schemaVersion:1, id:'e', profileId:'p', unitId:'u', obligationId:'o', obligationType:'concept-reconstruction', reviewedAt:due, elapsedMs:1000, evidence:evidence(3,3,3), workflow:'reconstruction', workflowResult:reconstructionResult, suggestedRating:3, confirmedRating:3, beforeDueAt:due, afterDueAt:new Date(Date.parse(due)+3*86400000).toISOString(), beforePolicyState:conceptObligation.policyState, afterPolicyState:{...conceptObligation.policyState,stage:1,successStreak:1,lastIntervalDays:3}, policyId:'concept-mastery/v1', durationObservation:{plannedMinutes:15,actualMinutes:15,accepted:true,reason:'accepted',estimateBefore:15,estimateAfter:15,exactSamples:1,unitWorkflowSamples:0,globalWorkflowSamples:0}, createdAt:due };
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
  {...validBackup,settings:{...validBackup.settings,desiredRetention:1.2}},
]) mustFail(() => service.validateBackup(mutation), 'Hostile backup should fail');
check(service.validateBackup({...validBackup,units:[{...validBackup.units[0],evidenceCount:1}],obligations:[{...conceptObligation,durationSampleCount:1}],evidenceEvents:[conceptEvidence]}).evidenceEvents.length === 1, 'Relational workflow evidence backup should pass');
const chunkedObligation={...conceptObligation,chunking:{cycleId:'cycle',status:'chunking',originalMinutes:15,synthesisMinutes:5,capacityMinutes:60,totalChunks:2,completedChunks:1,createdAt:due}};
const chunkRecords=[
  {schemaVersion:1,id:'ch1',obligationId:'o',cycleId:'cycle',ordinal:1,total:2,label:'U · Part 1 of 2',scope:'Part 1 of 2',expectedMinutes:5,status:'completed',createdAt:due,updatedAt:due,completedAt:due,actualMinutes:6,note:''},
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
  const unit = { id:'u', profileId:'p', topicNodeId:'t', title:'U', scope:'scope', source:'', importance:3, status:'active', createdAt:due, updatedAt:due, evidenceCount:0, lapseCount:0 };
  const original = { ...obligation('memory-recall', memory, 'recall'), id:'original', unitId:'u', priority:1 };
  const calls = [];
  const repo = { get: async (_store, key) => key === 'original' ? original : undefined, dailyPlanByStudyDay: async()=>undefined, recordReview: async (...args) => { calls.push(args); } };
  const lifecycle = new api.RevisionService(repo);
  lifecycle.obligation = async () => original;
  lifecycle.unit = async () => unit;
  lifecycle.obligationsForUnit = async () => [];
  lifecycle.evidenceEvents = async () => [];
  lifecycle.chunksForObligation = async () => [];
  lifecycle.markPlanItemCompleted = async () => {};
  await lifecycle.recordEvidence('original', { ...evidence(0,0,0), workflowResult:{...recallResult,checkpointTotal:4,checkpointsMet:0}, elapsedMs:1000, confirmedRating:1 }, new Date(due));
  check(calls.length === 1, 'Failed review must commit once');
  check(calls[0][1].status === 'suspended' && calls[0][1].suspensionReason === 'relearning', 'Failed original must be paused for relearning');
  check(calls[0][3]?.type === 'relearn' && calls[0][3]?.workflow.kind === 'relearning', 'Failed review must create a proper relearning workflow');
  check(calls[0][3]?.returnObligationId === 'original', 'Relearning must return to its exact original');

  const relearnPolicy = new api.RelearnPolicy();
  const relearn = { ...obligation('relearn', relearnPolicy, 'relearning'), id:'relearn', unitId:'u', returnObligationId:'original', policyState:{ ...relearnPolicy.createInitialState(due), successStreak:1 } };
  original.status = 'suspended'; original.suspensionReason='relearning';
  calls.length = 0;
  lifecycle.obligation = async () => relearn;
  lifecycle.obligationsForUnit = async () => [relearn];
  await lifecycle.recordEvidence('relearn', { ...evidence(4,4,3), workflowResult:relearnResult, elapsedMs:1000, confirmedRating:3 }, new Date(due));
  check(calls[0][1].status === 'completed', 'Relearning must complete after two successful cycles');
  check(calls[0][4]?.status === 'active', 'Original obligation must reactivate atomically');
  check(calls[0][4]?.policyState.fsrsCard.dueAt === calls[0][4]?.dueAt, 'Reactivated FSRS due state must stay synchronized');
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
  svc.settings = { schemaVersion:1, key:'app', activeProfileId:'active', desiredRetention:.9, dailyCapacityMinutes:60, studyDayBoundaryHour:4 };
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
  const base = { schemaVersion:1, key:'app', activeProfileId:'p', desiredRetention:.9, dailyCapacityMinutes:60, studyDayBoundaryHour:4 };
  await svc.saveSettings(base); check(true, 'Valid settings should save');
  for (const mutation of [{...base,activeProfileId:'missing'},{...base,dailyCapacityMinutes:60.5},{...base,studyDayBoundaryHour:4.5}]) {
    let failed=false; try { await svc.saveSettings(mutation); } catch { failed=true; }
    check(failed, 'Invalid settings boundary must fail');
  }
}

Promise.all([testFsrs7Integration(), testTriggerEvidenceLookup(), testRelearningLifecycle(), testStudyEventRuntimeBoundary(), testDueSummaryScope(), testSettingsBoundary()]).then(() => console.log(`PASS ${checks} kernel, workflow, policy and backup checks`)).catch((error) => { console.error(error); process.exitCode = 1; });
