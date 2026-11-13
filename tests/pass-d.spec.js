'use strict';
const { createAppRuntime } = require('./helpers/runtime-harness');

const { api, context } = createAppRuntime({
  globalName: '__RD_D_TEST__',
  expose: ["Rating","RevisionService","MasteryPolicy","durationObservationFor","weeklySubjectBalanceScores","createAutomaticChunks","interleaveSelected","planItemKey"],
  requireFsrs: false,
});

let checks=0;
function check(value,message){ checks++; if(!value) throw new Error(message); }
const now='2026-07-25T06:00:00.000Z';
const timing=(ms)=>({totalActiveMs:ms,activeByPhase:{attempt:ms,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]});
const policy=new api.MasteryPolicy();
const obligation={id:'o',unitId:'u',type:'concept-reconstruction',status:'active',dueAt:now,expectedMinutes:20,baselineMinutes:20,durationSampleCount:0,protocol:'reconstruct',successCriteria:'complete',workflow:{kind:'reconstruction',prompt:'reconstruct',checkpoints:['a'],responseMedium:'in-app',reconstructionShape:'outline'},freshnessDays:30,priority:0,policyState:policy.createInitialState(now),createdAt:now,updatedAt:now};
const accepted=api.durationObservationFor(obligation,[],30*60000);
check(accepted.accepted && accepted.reason==='accepted','A plausible completed review must be accepted as a duration sample');
check(accepted.estimateAfter>20 && accepted.estimateAfter<30,'A first duration sample must adjust gradually rather than replace the estimate');
const tooShort=api.durationObservationFor(obligation,[],60*1000);
check(!tooShort.accepted && tooShort.reason==='too-short' && tooShort.estimateAfter===20,'Implausibly short sessions must not distort duration estimates');
const oldEvent=(id,actual,reviewedAt)=>({id,obligationId:'o',unitId:'u',workflow:'reconstruction',reviewedAt,durationObservation:{plannedMinutes:20,actualMinutes:actual,accepted:true,reason:'accepted',estimateBefore:20,estimateAfter:actual,exactSamples:1,unitWorkflowSamples:0,globalWorkflowSamples:0}});
const learned=api.durationObservationFor(obligation,[oldEvent('e1',30,'2026-07-24T00:00:00Z'),oldEvent('e2',32,'2026-07-23T00:00:00Z'),oldEvent('e3',31,'2026-07-22T00:00:00Z'),oldEvent('e4',33,'2026-07-21T00:00:00Z')],31*60000);
check(learned.estimateAfter>=29 && learned.estimateAfter<=32 && learned.exactSamples===5,'Sufficient exact-obligation history must dominate learned duration');
let adaptive={...obligation,expectedMinutes:20};
const adaptiveEvents=[];
for(let index=0;index<8;index++){
  const observation=api.durationObservationFor(adaptive,adaptiveEvents,60*60000);
  adaptive.expectedMinutes=observation.estimateAfter;
  adaptiveEvents.push(oldEvent(`grow${index}`,60,new Date(Date.parse(now)-index*86400000).toISOString()));
}
check(adaptive.expectedMinutes>40,'Repeated consistent sessions must be able to correct an initial estimate by more than the old two-times lifetime cap');
const rejectedWithHistory=api.durationObservationFor(adaptive,adaptiveEvents,60*1000);
check(rejectedWithHistory.estimateAfter===adaptive.expectedMinutes && !rejectedWithHistory.accepted,'Rejected duration samples must leave the current estimate unchanged');
const synth={...obligation,expectedMinutes:120,baselineMinutes:120,chunking:{cycleId:'c',status:'synthesis-ready',originalMinutes:120,synthesisMinutes:25,capacityMinutes:60,totalChunks:3,completedChunks:3,createdAt:now}};
const fullCycle=api.durationObservationFor(synth,[],140*60000);
check(fullCycle.plannedMinutes===120 && fullCycle.actualMinutes===140,'Split cycles must learn from chunk work plus final synthesis without inflating the parent estimate');

const joined=(subject,id,importance=3)=>({obligation:{...obligation,id,unitId:id},unit:{id,profileId:'p',topicNodeId:'t',title:id,scope:'scope',source:'',importance,status:'active',createdAt:now,updatedAt:now,evidenceCount:0,lapseCount:0},profile:{id:'p',name:'Exam',examDate:'2026-12-01',status:'active',createdAt:now,updatedAt:now},subject,section:'S',topic:'T'});
const joinedItems=[joined('Geology','g'),joined('Microbiology','m')];
const plan={id:'p1',studyDayKey:'2026-07-24',createdAt:now,updatedAt:now,plannerVersion:'pass-d-2',versions:[{version:1,generatedAt:now,capacityMinutes:120,reason:'initial',items:[{key:'g',obligationId:'g',profileId:'p',unitId:'g',subject:'Geology',workflow:'reconstruction',title:'G',estimatedMinutes:120,score:80,disposition:'selected',reasons:[]}]}],outcomes:[{itemKey:'g',status:'completed',actualMinutes:120,completedAt:now}]};
const balance=api.weeklySubjectBalanceScores(joinedItems,[plan],new Date('2026-07-25T04:00:00Z'));
check(balance.get('p::microbiology')>balance.get('p::geology'),'A neglected important subject must receive a larger weekly-balance signal');
const item=(id,subject,workflow,score,dueRisk=.6,dueState='due')=>({joined:{...joined(subject,id),obligation:{...obligation,id,unitId:id,workflow:{...obligation.workflow,kind:workflow}}},score,dueState,executionMinutes:20,factors:{dueRisk,examImportance:1,weakness:.5,reviewDuration:.8,examinationProximity:.7,weeklyBalance:.5},daysToExam:30,examDateKnown:true,daysFromDue:0,reasons:[]});
const interleaved=api.interleaveSelected([item('a1','Geology','reconstruction',90),item('a2','Geology','reconstruction',88),item('b1','Microbiology','questions',87)]);
check(interleaved[0].joined.subject==='Geology' && interleaved[1].joined.subject==='Microbiology','Comparable work should interleave subjects and workflows');
const urgent=api.interleaveSelected([item('urgent','Geology','reconstruction',95,.95,'overdue'),item('other','Microbiology','questions',94)]);
check(urgent[0].joined.obligation.id==='urgent','Interleaving must not displace severe overdue risk');

const large={...joined('Geology','large'),unit:{...joined('Geology','large').unit,title:'Pathoma Neurology',scope:'Pages 181-193',source:'Pathoma pages 181-193'},obligation:{...obligation,id:'large',unitId:'large',expectedMinutes:120,baselineMinutes:120}};
const split=api.createAutomaticChunks(large,60,new Date(now));
check(split.chunks.length>=2 && split.chunks.every(c=>c.expectedMinutes<=45),'Oversized work must be divided into capacity-safe chunks');
check(split.chunks[0].scope.includes('Pages') && split.chunks.reduce((sum,c)=>sum+c.expectedMinutes,0)+split.state.synthesisMinutes===120,'Natural page boundaries and the total parent estimate must be preserved');
check(split.state.status==='chunking' && split.state.synthesisMinutes<=60,'Chunking must reserve a bounded final synthesis step');

async function serviceChecks(){
  let storedPlan;
  let atomicPlan;
  const plans=[];
  const repo={
    dailyPlanByStudyDay:async()=>storedPlan,
    put:async(store,value)=>{ if(store==='dailyPlans') storedPlan=structuredClone(value); },
    get:async(store,key)=> store==='chunks'? chunks.find(c=>c.id===key) : store==='obligations'? parent : undefined,
    updateChunkWithObligation:async(chunk,obligation,dailyPlan)=>{ Object.assign(chunks.find(c=>c.id===chunk.id),chunk); Object.assign(parent,obligation); atomicPlan=dailyPlan; if(dailyPlan) storedPlan=structuredClone(dailyPlan); },
  };
  const service=new api.RevisionService(repo);
  service.settings={schemaVersion:1,key:'app',activeProfileId:'p',fsrsScheduling:{policy:{kind:'fixed-retention',desiredRetention:.9}},memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}},dailyCapacityMinutes:60,studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false,replayProfiles:[]}};
  service.manualPlanItem=async(obligationId,chunkId)=>({key:api.planItemKey(obligationId,chunkId),obligationId,...(chunkId?{chunkId}:{}),profileId:'p',unitId:'u',subject:'Geology',workflow:'reconstruction',title:'Manual item',estimatedMinutes:20,score:0,disposition:'selected',reasons:['manual']});
  const queueItem={...item('x','Geology','reconstruction',80),executionMinutes:30};
  const base={generatedAt:now,studyDayKey:'2026-07-25',capacityMinutes:60,candidateMinutes:30,plannedMinutes:30,selected:[queueItem],requiredOverrun:[],mustSplit:[],deferred:[],overdueCount:0,dueCount:1,broughtForwardCount:0};
  let persisted=await service.persistDailyPlan(base,false);
  check(persisted.version===1 && storedPlan.versions.length===1,'First daily plan must persist an immutable original version');
  check(storedPlan.outcomes.length===1 && storedPlan.outcomes[0].status==='planned','Selected work must receive an explicit planned outcome');
  await service.persistDailyPlan(base,false);
  check(storedPlan.versions.length===1,'Unchanged live projections must not create duplicate plan versions');
  const changed={...base,selected:[],deferred:[queueItem],plannedMinutes:0};
  persisted=await service.persistDailyPlan(changed,false);
  check(persisted.version===2 && storedPlan.versions[1].reason==='data-change','Material live-plan changes must be preserved as amendments');
  persisted=await service.persistDailyPlan(changed,true);
  check(persisted.version===3 && storedPlan.versions[2].reason==='manual-regeneration','Manual regeneration must preserve a distinct plan version');

  storedPlan=undefined;
  const overrun={...queueItem,joined:{...queueItem.joined,obligation:{...queueItem.joined.obligation,id:'overrun'}}};
  const overrunPlan={...base,selected:[overrun],requiredOverrun:[overrun],plannedMinutes:30};
  await service.persistDailyPlan(overrunPlan,false);
  check(storedPlan.versions[0].items.length===1 && storedPlan.versions[0].items[0].disposition==='required-overrun','Required-overrun work must appear once in the persisted plan snapshot');

  let chunkWrites=0;
  const eligibilityRepo={
    getAll:async()=>[],
    putObligationWithChunks:async()=>{chunkWrites++;},
    put:async()=>{},
  };
  const eligibilityService=new api.RevisionService(eligibilityRepo);
  eligibilityService.settings={schemaVersion:1,key:'app',activeProfileId:'p',fsrsScheduling:{policy:{kind:'fixed-retention',desiredRetention:.9}},memoryDifficultyPolicy:{remediationLapses:2,persistentDifficultyLapses:4,automaticHold:{enabled:false,lapseThreshold:8}},dailyCapacityMinutes:60,studyDayBoundaryHour:4,fsrsPersonalization:{profile:null,active:false,replayProfiles:[]}};
  const oversized={...joined('Geology','eligible'),obligation:{...obligation,id:'eligible',unitId:'eligible',expectedMinutes:120,baselineMinutes:120,dueAt:now}};
  await eligibilityService.ensureAutomaticChunking([{...oversized,profile:{...oversized.profile,status:'suspended'}}],60,new Date(now));
  await eligibilityService.ensureAutomaticChunking([{...oversized,obligation:{...oversized.obligation,dueAt:'2027-07-25T06:00:00.000Z'}}],60,new Date(now));
  check(chunkWrites===0,'Paused or far-future obligations must not be split as a side effect of opening the planner');

  const parent={...obligation,id:'parent',expectedMinutes:120,baselineMinutes:120,chunking:structuredClone(split.state)};
  const chunks=split.chunks.map((c,i)=>({...c,id:`c${i+1}`,obligationId:'parent'}));
  service.obligation=async()=>parent;
  service.markPlanItemCompleted=async()=>{};
  for (let index=0; index<chunks.length; index++) {
    await service.completeChunk(chunks[index].id,timing(40*60000),`chunk ${index+1}`,new Date(`2026-07-25T${String(8+index).padStart(2,'0')}:00:00Z`));
    if (index<chunks.length-1) check(parent.chunking.status==='chunking' && parent.dueAt===now,'Completing an intermediate chunk must not advance the parent schedule');
    check(atomicPlan?.outcomes.some(outcome=>outcome.itemKey===`parent::${chunks[index].id}` && outcome.status==='completed'),'Chunk state and daily-plan outcome must be committed through the same repository operation');
    check(atomicPlan?.versions.some(version=>version.reason==='manual-addition' && version.items.some(item=>item.key===`parent::${chunks[index].id}`)),'Unplanned execution must become a durable manual plan amendment before its outcome is stored');
  }
  check(parent.chunking.status==='synthesis-ready' && parent.chunking.completedChunks===chunks.length,'The final chunk must unlock, not replace, parent synthesis retrieval');
}
serviceChecks().then(()=>console.log(`PASS ${checks} Pass D adaptive-planning checks`)).catch(err=>{console.error(err);process.exitCode=1;});
