'use strict';
const { createAppRuntime } = require('./helpers/runtime-harness');

(async()=>{
 {
  const { api } = createAppRuntime({
    globalName: '__RD_PLANNER_ADAPTATION__',
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
  await serviceChecks();
  
 }
 {
  const { api } = createAppRuntime({
    globalName: '__RD_PLANNER_PERSISTENCE__',
    expose: ["RevisionService","MasteryPolicy","createAutomaticChunks","weeklySubjectBalanceScores","interleaveSelected","planItemKey","subjectBalanceKey","validateBackupPayload"],
    requireFsrs: false,
  });
  
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
  
  // Strict backup validation for canonical planner records.
  const evidence = { schemaVersion:1, id:'e', profileId:'p', unitId:'u', obligationId:'o', obligationType:'concept-reconstruction', reviewedAt:now, elapsedMs:15*60000, evidence:{completeness:3,independence:3,application:3,errorTypes:[],correctionNote:''}, workflow:'reconstruction', workflowResult:{kind:'reconstruction',responseMedium:'in-app',attemptText:'Valid attempt',shape:'outline',checkpointTotal:2,checkpointsMet:2,structuralAccuracy:3,relationshipAccuracy:3,cueLevel:'none'}, suggestedRating:3, confirmedRating:3, beforeDueAt:now, afterDueAt:now, beforePolicyState:baseObligation.policyState, afterPolicyState:baseObligation.policyState, policyId:'concept-mastery/v1', durationObservation:{plannedMinutes:15,actualMinutes:15,accepted:true,reason:'accepted',estimateBefore:15,estimateAfter:15,exactSamples:1,unitWorkflowSamples:0,globalWorkflowSamples:0}, timing:{totalActiveMs:15*60000,activeByPhase:{attempt:15*60000,compare:0,'relearn-repair':0,'relearn-verify':0},pauseMs:0,pauseCount:0,inactiveGapCount:0,classifiedFocusMs:0,classifiedBreakMs:0,ignoredGapMs:0,promptExcludedMs:0,backwardClockCount:0,durationReliable:true,reliabilityFlags:[]}, createdAt:now };
  const evidenceBackup = {...validBackup, units:[{...unit,evidenceCount:1}], obligations:[{...baseObligation,durationSampleCount:1}], evidenceEvents:[evidence]};
  check(api.validateBackupPayload(evidenceBackup).evidenceEvents.length === 1, 'Valid duration evidence must pass strict validation');
  mustFail(()=>api.validateBackupPayload({...evidenceBackup,evidenceEvents:[{...evidence,durationObservation:{...evidence.durationObservation,accepted:'yes'}}]}),'Non-boolean duration acceptance must fail');
  mustFail(()=>api.validateBackupPayload({...evidenceBackup,evidenceEvents:[{...evidence,durationObservation:{...evidence.durationObservation,actualMinutes:-1}}]}),'Negative duration observations must fail');
  mustFail(()=>api.validateBackupPayload({...evidenceBackup,obligations:[{...baseObligation,durationSampleCount:0}]}),'Duration sample counters must match accepted history');
  
  const planItem = { key:'o', obligationId:'o', profileId:'p', unitId:'u', subject:'Subject', workflow:'reconstruction', title:'Unit', estimatedMinutes:15, score:70, disposition:'selected', reasons:[] };
  const dailyPlan = { schemaVersion:1, id:'d', studyDayKey:'2026-07-25', createdAt:now, updatedAt:now, plannerVersion:'pass-d-2', versions:[{version:1,generatedAt:now,capacityMinutes:60,items:[planItem],reason:'initial'}], outcomes:[{itemKey:'o',status:'completed',startedAt:now,completedAt:now,actualMinutes:15,evidenceEventId:'e'}] };
  const planBackup = {...evidenceBackup,dailyPlans:[dailyPlan]};
  check(api.validateBackupPayload(planBackup).dailyPlans.length === 1, 'Valid persisted daily plan must pass strict validation');
  mustFail(()=>api.validateBackupPayload({...planBackup,dailyPlans:[{...dailyPlan,studyDayKey:'2026-02-31'}]}),'Impossible daily-plan dates must fail');
  mustFail(()=>api.validateBackupPayload({...planBackup,dailyPlans:[{...dailyPlan,versions:[{...dailyPlan.versions[0],capacityMinutes:-1}]}]}),'Invalid plan capacity must fail');
  mustFail(()=>api.validateBackupPayload({...planBackup,dailyPlans:[{...dailyPlan,versions:[{...dailyPlan.versions[0],items:[{...planItem,disposition:'evil'}]}]}]}),'Invalid plan disposition must fail');
  mustFail(()=>api.validateBackupPayload({...planBackup,dailyPlans:[{...dailyPlan,versions:[{...dailyPlan.versions[0],items:[{...planItem,profileId:'wrong'}]}]}]}),'Cross-record plan relationships must fail');
  mustFail(()=>api.validateBackupPayload({...planBackup,dailyPlans:[{...dailyPlan,outcomes:[{itemKey:'o',status:'started'}]}]}),'Started outcomes without timestamps must fail');
  mustFail(()=>api.validateBackupPayload({...planBackup,dailyPlans:[{...dailyPlan,outcomes:[{...dailyPlan.outcomes[0],actualMinutes:20000}]}]}),'Implausible completed durations must fail');
  mustFail(()=>api.validateBackupPayload({...planBackup,dailyPlans:[dailyPlan,{...dailyPlan,id:'d2'}]}),'Duplicate study-day plans must fail');
  
  await Promise.all([persistenceChecks(), reflowChecks()]);
  
 }
 console.log("PASS planner persistence, adaptation, chunking and versioning checks");
})().catch(error=>{console.error(error);process.exitCode=1;});
