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

function projectWorkload(scheduler,pattern,cardIndex,horizonDays=365){
  let card=scheduler.newCard({now:new Date(START.getTime()+cardIndex*6*HOUR_MS),cardId:`workload-${cardIndex}`});
  let now=new Date(card.dueAt);
  const horizon=START.getTime()+horizonDays*DAY_MS;
  let reviews=0,retentionSum=0,minRetention=1,intervalSum=0,sameDay=0,againCount=0;
  while(now.getTime()<=horizon&&reviews<200){
    const retention=predictedRetrievability(scheduler,card,now);
    retentionSum+=retention;
    minRetention=Math.min(minRetention,retention);
    const rating=pattern[reviews%pattern.length];
    if(rating===F.Rating.Again) againCount++;
    const result=scheduler.review({card,grade:rating,now});
    const next=result.card;
    const intervalDays=daysBetween(next.dueAt,now);
    intervalSum+=intervalDays;
    if(intervalDays<1) sameDay++;
    card=next;
    now=new Date(card.dueAt);
    reviews++;
  }
  return {reviews,retentionSum,minRetention,intervalSum,sameDay,againCount};
}

function aggregateWorkload(rows){
  const total=rows.reduce((acc,row)=>{
    for(const key of ['reviews','retentionSum','intervalSum','sameDay','againCount']) acc[key]+=row[key];
    acc.minRetention=Math.min(acc.minRetention,row.minRetention);
    return acc;
  },{reviews:0,retentionSum:0,minRetention:1,intervalSum:0,sameDay:0,againCount:0});
  return {
    cards:rows.length,
    reviews:total.reviews,
    workloadMinutes:total.reviews*SESSION_MINUTES,
    meanDueRetrievability:total.retentionSum/Math.max(1,total.reviews),
    minDueRetrievability:total.minRetention,
    meanIntervalDays:total.intervalSum/Math.max(1,total.reviews),
    sameDayReviews:total.sameDay,
    againCount:total.againCount,
  };
}

async function policyWorkloadExperiment(){
  const cards=120;
  const schedulers=[
    {name:'fixed-0.90',scheduler:await fixedScheduler({learningSteps:['23h'],relearningSteps:['23h'],desiredRetention:.9})},
    {name:'cost-adr-16',scheduler:await costAdrScheduler(16)},
    {name:'cost-adr-64',scheduler:await costAdrScheduler(64)},
    {name:'cost-adr-256',scheduler:await costAdrScheduler(256)},
    {name:'cost-adr-1024',scheduler:await costAdrScheduler(1024)},
  ];
  const results=[];
  for(const entry of schedulers){
    const rows=[];
    for(let i=0;i<cards;i++) rows.push(projectWorkload(entry.scheduler,RATING_PATTERNS[i%RATING_PATTERNS.length],i));
    results.push({name:entry.name,...aggregateWorkload(rows)});
  }
  const baseline=results.find(row=>row.name==='fixed-0.90');
  assert.ok(baseline,'Fixed-retention baseline missing');
  for(const row of results){
    row.reviewDelta=(row.reviews-baseline.reviews)/baseline.reviews;
    row.retentionDelta=row.meanDueRetrievability-baseline.meanDueRetrievability;
    row.meaningfulBenefit=(
      row.reviewDelta<=-.10&&row.retentionDelta>=-.01&&row.minDueRetrievability>=baseline.minDueRetrievability-.02
    )||(
      row.retentionDelta>=.01&&row.reviewDelta<=.05
    );
  }
  return results;
}

(async()=>{
  const learning=await learningStepExperiment();
  const workload=await policyWorkloadExperiment();
  console.log('PASS Pass 5 learning-step experiment: '+JSON.stringify(learning));
  console.log('PASS Pass 5 scheduling-policy workload experiment: '+JSON.stringify(workload));
})().catch(error=>{console.error(error);process.exitCode=1;});
