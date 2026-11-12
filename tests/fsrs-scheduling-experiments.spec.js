const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
const vendor = fs.readFileSync(path.join(root, 'vendor', 'ts-fsrs-6.0.0', 'index.umd.js'), 'utf8');
const context = { crypto:webcrypto, structuredClone, console, Date, Intl, URL, Blob, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set, Math, Number, String, Object, Array, JSON, Error, Promise, Int32Array, Uint8Array };
context.window=context; context.self=context; context.globalThis=context;
vm.createContext(context);
vm.runInContext(vendor, context, { filename:'ts-fsrs-6.0.0.umd.js' });
const F=context.FSRS;
if(!F) throw new Error('Vendored ts-fsrs runtime unavailable');

const DAY_MS=86_400_000;
const HOUR_MS=3_600_000;
const START=new Date('2026-01-01T08:00:00.000Z');
const MAX_INTERVAL=36_500;
const SESSION_MINUTES=15;
const clone=value=>structuredClone(value);
const hoursBetween=(left,right)=>(new Date(left).getTime()-new Date(right).getTime())/HOUR_MS;
const daysBetween=(left,right)=>(new Date(left).getTime()-new Date(right).getTime())/DAY_MS;

async function fixedScheduler({learningSteps,relearningSteps,enableShortTerm=true,desiredRetention=.9}){
  return F.DefaultScheduler({
    version:'FSRS-7',
    desiredRetention,
    enableShortTerm,
    learningSteps,
    relearningSteps,
    graduatingInterval:1,
    allowModelOverride:true,
    enableFuzz:false,
    maximumInterval:MAX_INTERVAL,
    clearStatsOnForget:false,
  });
}

async function costAdrScheduler(goalCostWeight,{learningSteps=['23h'],relearningSteps=['23h']}={}){
  const reference=await fixedScheduler({learningSteps,relearningSteps});
  const definition=F.defineScheduler({model:reference.definition.model,chrono:reference.definition.chrono})
    .use(
      F.schedulerCostAdrMiddleware,
      F.schedulerFuzzingMiddleware,
      F.schedulerStatsMiddleware,
      F.schedulerScheduledDaysMiddleware,
      F.schedulerLearningStepsMiddleware,
      F.schedulerMaximumIntervalMiddleware,
      F.schedulerMonotonicIntervalMiddleware,
    );
  return definition.create({config:{
    weights:Array.from(reference.model.config.weights),
    fractionalDays:true,
    costAdrPolicy:F.COST_ADR_DEFAULT_POLICY,
    goalCostWeight,
    enableFuzz:false,
    clearStatsOnForget:false,
    enableShortTerm:true,
    learningSteps:Array.from(learningSteps),
    relearningSteps:Array.from(relearningSteps),
    graduatingInterval:1,
    allowModelOverride:true,
    maximumInterval:MAX_INTERVAL,
  }});
}

function memoryState(card){
  return {stability:card.stability,stabilityFast:card.stabilityFast,difficulty:card.difficulty};
}
function predictedRetrievability(scheduler,card,at){
  if(!card.lastReviewAt||card.reps===0) return 1;
  const elapsedDays=Math.max(0,scheduler.chrono.difference(new Date(card.lastReviewAt),at));
  return Number(scheduler.model.forgettingCurve(memoryState(card),elapsedDays));
}

async function learningStepExperiment(){
  const variants=[
    {name:'current-1d',learningSteps:['1d'],relearningSteps:['1d']},
    {name:'near-daily-23h',learningSteps:['23h'],relearningSteps:['23h']},
    {name:'half-day-12h',learningSteps:['12h'],relearningSteps:['12h']},
    {name:'no-explicit-steps',learningSteps:[],relearningSteps:[]},
    {name:'upstream-default',learningSteps:['1m','10m'],relearningSteps:['10m']},
  ];
  const results=[];
  for(const variant of variants){
    const scheduler=await fixedScheduler(variant);
    const first=scheduler.newCard({now:START,cardId:`learn-${variant.name}`});
    const again1=scheduler.review({card:first,grade:F.Rating.Again,now:START}).card;
    const again2=scheduler.review({card:again1,grade:F.Rating.Again,now:new Date(again1.dueAt)}).card;

    const seeded=scheduler.newCard({now:START,cardId:`review-${variant.name}`});
    const established=scheduler.review({card:seeded,grade:F.Rating.Good,now:START}).card;
    const lapseAt=new Date(established.dueAt);
    const lapsed=scheduler.review({card:established,grade:F.Rating.Again,now:lapseAt}).card;

    // Revision Director does not follow an Again card directly. It suspends the
    // memory obligation, runs corrective relearning, then records one successful
    // closed-book return roughly a day later. Measure the actual host lifecycle.
    const initialReturnAt=new Date(START.getTime()+DAY_MS);
    const initialReturned=scheduler.review({card:again1,grade:F.Rating.Good,now:initialReturnAt}).card;
    const lapseReturnAt=new Date(lapseAt.getTime()+DAY_MS);
    const lapseReturned=scheduler.review({card:lapsed,grade:F.Rating.Good,now:lapseReturnAt}).card;

    results.push({
      name:variant.name,
      firstAgainHours:hoursBetween(again1.dueAt,START),
      firstAgainState:again1.state,
      firstAgainStatus:again1.scheduleStatus,
      secondAgainHours:hoursBetween(again2.dueAt,new Date(again1.dueAt)),
      secondAgainState:again2.state,
      secondAgainLapses:again2.lapses,
      establishedAfterGoodState:established.state,
      lapseAgainHours:hoursBetween(lapsed.dueAt,lapseAt),
      lapseAgainState:lapsed.state,
      lapseAgainStatus:lapsed.scheduleStatus,
      lapseCount:lapsed.lapses,
      initialCorrectiveReturnState:initialReturned.state,
      initialCorrectiveNextDays:daysBetween(initialReturned.dueAt,initialReturnAt),
      initialCorrectiveLapses:initialReturned.lapses,
      lapseCorrectiveReturnState:lapseReturned.state,
      lapseCorrectiveNextDays:daysBetween(lapseReturned.dueAt,lapseReturnAt),
      lapseCorrectiveLapses:lapseReturned.lapses,
    });
  }
  const byName=new Map(results.map(row=>[row.name,row]));
  const current=byName.get('current-1d');
  const nearDaily=byName.get('near-daily-23h');
  assert.ok(current&&nearDaily,'Required learning-step variants missing');
  assert.ok(nearDaily.firstAgainHours>=22.9&&nearDaily.firstAgainHours<=24,'23h policy must remain operationally near-daily');
  assert.equal(nearDaily.firstAgainState,F.State.Learning,'23h Again must retain initial-learning state');
  assert.equal(nearDaily.secondAgainLapses,0,'Repeated initial-learning failure under 23h must not invent an established-memory lapse');
  assert.equal(nearDaily.lapseAgainState,F.State.Relearning,'23h established lapse must retain relearning state');
  return results;
}

const RATING_PATTERNS=[
  [F.Rating.Good,F.Rating.Good,F.Rating.Hard,F.Rating.Good,F.Rating.Easy,F.Rating.Good],
  [F.Rating.Good,F.Rating.Hard,F.Rating.Good,F.Rating.Hard,F.Rating.Good,F.Rating.Good],
  [F.Rating.Again,F.Rating.Good,F.Rating.Good,F.Rating.Hard,F.Rating.Good,F.Rating.Easy],
  [F.Rating.Good,F.Rating.Good,F.Rating.Good,F.Rating.Easy,F.Rating.Good,F.Rating.Good],
  [F.Rating.Hard,F.Rating.Good,F.Rating.Hard,F.Rating.Good,F.Rating.Good,F.Rating.Easy],
  [F.Rating.Again,F.Rating.Good,F.Rating.Hard,F.Rating.Good,F.Rating.Again,F.Rating.Good],
];

function projectWorkload(scheduler,pattern,cardIndex,horizonDays){
  let card=scheduler.newCard({now:new Date(START.getTime()+cardIndex*6*HOUR_MS),cardId:`workload-${cardIndex}`});
  let now=new Date(card.dueAt);
  const horizon=START.getTime()+horizonDays*DAY_MS;
  let memoryAttempts=0,correctiveSessions=0,fsrsReviews=0;
  let retentionSum=0,minRetention=1,intervalSum=0,sub20h=0,againCount=0;
  let reviewStateAttempts=0,reviewStateRetentionSum=0,minReviewStateRetention=1;
  while(now.getTime()<=horizon&&memoryAttempts<300){
    const retention=predictedRetrievability(scheduler,card,now);
    retentionSum+=retention;
    minRetention=Math.min(minRetention,retention);
    if(card.state===F.State.Review){
      reviewStateAttempts++;
      reviewStateRetentionSum+=retention;
      minReviewStateRetention=Math.min(minReviewStateRetention,retention);
    }

    const rating=pattern[memoryAttempts%pattern.length];
    memoryAttempts++;
    if(rating===F.Rating.Again) againCount++;
    const direct=scheduler.review({card,grade:rating,now});
    fsrsReviews++;

    let completedAt=now;
    if(rating===F.Rating.Again){
      // Revision Director suspends failed memory and owns a separate corrective
      // relearning obligation due one day later. A successful closed-book
      // verification records a Good return transition through FSRS.
      const correctiveAt=new Date(now.getTime()+DAY_MS);
      if(correctiveAt.getTime()>horizon) break;
      correctiveSessions++;
      const returned=scheduler.review({card:direct.card,grade:F.Rating.Good,now:correctiveAt});
      fsrsReviews++;
      card=returned.card;
      completedAt=correctiveAt;
    }else{
      card=direct.card;
    }

    const intervalDays=daysBetween(card.dueAt,completedAt);
    intervalSum+=intervalDays;
    if(intervalDays<20/24) sub20h++;
    now=new Date(card.dueAt);
  }
  const workloadSessions=memoryAttempts+correctiveSessions;
  return {
    workloadSessions,memoryAttempts,correctiveSessions,fsrsReviews,
    retentionSum,minRetention,intervalSum,sub20h,againCount,
    reviewStateAttempts,reviewStateRetentionSum,minReviewStateRetention,
  };
}

function aggregateWorkload(rows){
  const total=rows.reduce((acc,row)=>{
    for(const key of ['workloadSessions','memoryAttempts','correctiveSessions','fsrsReviews','retentionSum','intervalSum','sub20h','againCount','reviewStateAttempts','reviewStateRetentionSum']) acc[key]+=row[key];
    acc.minRetention=Math.min(acc.minRetention,row.minRetention);
    acc.minReviewStateRetention=Math.min(acc.minReviewStateRetention,row.minReviewStateRetention);
    return acc;
  },{workloadSessions:0,memoryAttempts:0,correctiveSessions:0,fsrsReviews:0,retentionSum:0,minRetention:1,intervalSum:0,sub20h:0,againCount:0,reviewStateAttempts:0,reviewStateRetentionSum:0,minReviewStateRetention:1});
  return {
    cards:rows.length,
    workloadSessions:total.workloadSessions,
    memoryAttempts:total.memoryAttempts,
    correctiveSessions:total.correctiveSessions,
    fsrsReviews:total.fsrsReviews,
    workloadMinutes:total.workloadSessions*SESSION_MINUTES,
    meanDueRetrievability:total.retentionSum/Math.max(1,total.memoryAttempts),
    minDueRetrievability:total.minRetention,
    meanReviewStateRetrievability:total.reviewStateRetentionSum/Math.max(1,total.reviewStateAttempts),
    minReviewStateRetrievability:total.minReviewStateRetention,
    reviewStateAttempts:total.reviewStateAttempts,
    meanIntervalDays:total.intervalSum/Math.max(1,total.memoryAttempts-total.againCount+total.correctiveSessions),
    sub20hReviews:total.sub20h,
    againCount:total.againCount,
  };
}

async function productionPolicyExperiment(){
  const cards=72;
  const horizons=[90,365,730];
  const schedulers=[
    {name:'fixed-0.84',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['1d'],relearningSteps:['1d'],desiredRetention:.84})},
    {name:'fixed-0.86',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['1d'],relearningSteps:['1d'],desiredRetention:.86})},
    {name:'fixed-0.88',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['1d'],relearningSteps:['1d'],desiredRetention:.88})},
    {name:'fixed-0.90',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['1d'],relearningSteps:['1d'],desiredRetention:.9})},
    {name:'fixed-0.92',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['1d'],relearningSteps:['1d'],desiredRetention:.92})},
    {name:'cost-adr-832',kind:'cost-adr',scheduler:await costAdrScheduler(832,{learningSteps:['1d'],relearningSteps:['1d']})},
    {name:'cost-adr-896',kind:'cost-adr',scheduler:await costAdrScheduler(896,{learningSteps:['1d'],relearningSteps:['1d']})},
    {name:'cost-adr-960',kind:'cost-adr',scheduler:await costAdrScheduler(960,{learningSteps:['1d'],relearningSteps:['1d']})},
  ];
  const experiments=[];
  for(const horizonDays of horizons){
    const results=[];
    for(const entry of schedulers){
      const rows=[];
      for(let i=0;i<cards;i++) rows.push(projectWorkload(entry.scheduler,RATING_PATTERNS[i%RATING_PATTERNS.length],i,horizonDays));
      results.push({name:entry.name,kind:entry.kind,...aggregateWorkload(rows)});
    }
    const baseline=results.find(row=>row.name==='fixed-0.90');
    assert.ok(baseline,'Production fixed-retention baseline missing');
    const fixedRows=results.filter(row=>row.kind==='fixed');
    for(const row of results){
      row.reviewDelta=(row.workloadSessions-baseline.workloadSessions)/baseline.workloadSessions;
      row.retentionDelta=row.meanReviewStateRetrievability-baseline.meanReviewStateRetrievability;
      if(row.kind==='cost-adr'){
        const dominator=fixedRows.find(fixedRow=>
          fixedRow.workloadSessions<=row.workloadSessions
          && fixedRow.meanReviewStateRetrievability>=row.meanReviewStateRetrievability-.001
          && (fixedRow.workloadSessions<row.workloadSessions||fixedRow.meanReviewStateRetrievability>row.meanReviewStateRetrievability+.001)
        );
        row.paretoDominatedBy=dominator?.name??null;
        row.meaningfulBenefit=(
          (
            row.reviewDelta<=-.10
            && row.retentionDelta>=-.01
            && row.minReviewStateRetrievability>=baseline.minReviewStateRetrievability-.02
          )||(
            row.retentionDelta>=.01&&row.reviewDelta<=.05
          )
        )&&!dominator;
      }
    }
    experiments.push({horizonDays,results});
  }
  const costNames=schedulers.filter(entry=>entry.kind==='cost-adr').map(entry=>entry.name);
  const robustCostAdr=costNames.map(name=>({
    name,
    allHorizonsMeaningful:experiments.every(experiment=>experiment.results.find(row=>row.name===name)?.meaningfulBenefit===true),
    worstReviewDelta:Math.max(...experiments.map(experiment=>experiment.results.find(row=>row.name===name).reviewDelta)),
    worstRetentionLoss:Math.max(...experiments.map(experiment=>Math.max(0,-experiment.results.find(row=>row.name===name).retentionDelta))),
    paretoDominatedAnywhere:experiments.some(experiment=>Boolean(experiment.results.find(row=>row.name===name).paretoDominatedBy)),
  }));
  return {experiments,robustCostAdr};
}

async function policyWorkloadExperiment(){
  const cards=72;
  const horizons=[90,365,730];
  const schedulers=[
    {name:'current-step-fixed-0.90',kind:'fixed-reference',scheduler:await fixedScheduler({learningSteps:['1d'],relearningSteps:['1d'],desiredRetention:.9})},
    {name:'fixed-0.84',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['23h'],relearningSteps:['23h'],desiredRetention:.84})},
    {name:'fixed-0.86',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['23h'],relearningSteps:['23h'],desiredRetention:.86})},
    {name:'fixed-0.88',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['23h'],relearningSteps:['23h'],desiredRetention:.88})},
    {name:'fixed-0.90',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['23h'],relearningSteps:['23h'],desiredRetention:.9})},
    {name:'fixed-0.92',kind:'fixed',scheduler:await fixedScheduler({learningSteps:['23h'],relearningSteps:['23h'],desiredRetention:.92})},
    {name:'cost-adr-512',kind:'cost-adr',scheduler:await costAdrScheduler(512)},
    {name:'cost-adr-768',kind:'cost-adr',scheduler:await costAdrScheduler(768)},
    {name:'cost-adr-832',kind:'cost-adr',scheduler:await costAdrScheduler(832)},
    {name:'cost-adr-896',kind:'cost-adr',scheduler:await costAdrScheduler(896)},
    {name:'cost-adr-960',kind:'cost-adr',scheduler:await costAdrScheduler(960)},
    {name:'cost-adr-1024',kind:'cost-adr',scheduler:await costAdrScheduler(1024)},
  ];
  const experiments=[];
  for(const horizonDays of horizons){
    const results=[];
    for(const entry of schedulers){
      const rows=[];
      for(let i=0;i<cards;i++) rows.push(projectWorkload(entry.scheduler,RATING_PATTERNS[i%RATING_PATTERNS.length],i,horizonDays));
      results.push({name:entry.name,kind:entry.kind,...aggregateWorkload(rows)});
    }
    const baseline=results.find(row=>row.name==='fixed-0.90');
    const currentStep=results.find(row=>row.name==='current-step-fixed-0.90');
    assert.ok(baseline&&currentStep,'Required fixed-retention baselines missing');
    const fixedRows=results.filter(row=>row.kind==='fixed');
    for(const row of results){
      row.reviewDelta=(row.workloadSessions-baseline.workloadSessions)/baseline.workloadSessions;
      row.retentionDelta=row.meanReviewStateRetrievability-baseline.meanReviewStateRetrievability;
      if(row.kind==='cost-adr'){
        const dominator=fixedRows.find(fixedRow=>
          fixedRow.workloadSessions<=row.workloadSessions
          && fixedRow.meanReviewStateRetrievability>=row.meanReviewStateRetrievability-.001
          && (fixedRow.workloadSessions<row.workloadSessions||fixedRow.meanReviewStateRetrievability>row.meanReviewStateRetrievability+.001)
        );
        row.paretoDominatedBy=dominator?.name??null;
        const initialBenefit=(
          row.reviewDelta<=-.10&&row.retentionDelta>=-.01&&row.minReviewStateRetrievability>=baseline.minReviewStateRetrievability-.02
        )||(
          row.retentionDelta>=.01&&row.reviewDelta<=.05
        );
        row.meaningfulBenefit=initialBenefit&&!dominator;
      }
    }
    const stepReviewDelta=(baseline.workloadSessions-currentStep.workloadSessions)/currentStep.workloadSessions;
    const stepRetentionDelta=baseline.meanReviewStateRetrievability-currentStep.meanReviewStateRetrievability;
    experiments.push({
      horizonDays,
      stepComparison:{reviewDelta:stepReviewDelta,retentionDelta:stepRetentionDelta,currentReviews:currentStep.workloadSessions,nearDailyReviews:baseline.workloadSessions,currentSub20h:currentStep.sub20hReviews,nearDailySub20h:baseline.sub20hReviews},
      results,
    });
  }
  const costNames=schedulers.filter(entry=>entry.kind==='cost-adr').map(entry=>entry.name);
  const robustCostAdr=costNames.map(name=>({
    name,
    allHorizonsMeaningful:experiments.every(experiment=>experiment.results.find(row=>row.name===name)?.meaningfulBenefit===true),
    worstReviewDelta:Math.max(...experiments.map(experiment=>experiment.results.find(row=>row.name===name).reviewDelta)),
    worstRetentionLoss:Math.max(...experiments.map(experiment=>Math.max(0,-experiment.results.find(row=>row.name===name).retentionDelta))),
    paretoDominatedAnywhere:experiments.some(experiment=>Boolean(experiment.results.find(row=>row.name===name).paretoDominatedBy)),
  }));
  return {experiments,robustCostAdr};
}

(async()=>{
  const learning=await learningStepExperiment();
  const workload=await policyWorkloadExperiment();
  const production=await productionPolicyExperiment();
  console.log('PASS Pass 5 learning-step experiment: '+JSON.stringify(learning));
  console.log('PASS Pass 5 scheduling-policy workload experiment: '+JSON.stringify(workload));
  console.log('PASS Pass 5 production-policy workload experiment: '+JSON.stringify(production));
})().catch(error=>{console.error(error);process.exitCode=1;});
