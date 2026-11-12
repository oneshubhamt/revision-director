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
const CARDS=48;
const HORIZONS=[90,365,730];
const SCENARIOS=[
  {name:'fragile',newRecall:.58,repairBoost:.05},
  {name:'balanced',newRecall:.72,repairBoost:.12},
  {name:'familiar',newRecall:.84,repairBoost:.18},
];
const STEP_VARIANTS=[
  {name:'one-day',learningSteps:['1d'],relearningSteps:['1d']},
  {name:'near-daily-23h',learningSteps:['23h'],relearningSteps:['23h']},
  {name:'eighteen-hour',learningSteps:['18h'],relearningSteps:['18h']},
  {name:'half-day-12h',learningSteps:['12h'],relearningSteps:['12h']},
  {name:'no-explicit-steps',learningSteps:[],relearningSteps:[]},
  {name:'upstream-minute-steps',learningSteps:['1m','10m'],relearningSteps:['10m']},
];
const FIXED_RETENTIONS=[.84,.86,.88,.90,.92];
const COST_WEIGHTS=[64,128,256,384,512,640,768,896,1024];

const hoursBetween=(left,right)=>(new Date(left).getTime()-new Date(right).getTime())/HOUR_MS;
const daysBetween=(left,right)=>(new Date(left).getTime()-new Date(right).getTime())/DAY_MS;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

async function fixedScheduler({learningSteps,relearningSteps,desiredRetention=.9,enableFuzz=false}){
  return F.DefaultScheduler({
    version:'FSRS-7',
    desiredRetention,
    enableShortTerm:true,
    learningSteps,
    relearningSteps,
    graduatingInterval:1,
    allowModelOverride:true,
    enableFuzz,
    maximumInterval:MAX_INTERVAL,
    clearStatsOnForget:false,
  });
}

async function costAdrScheduler(goalCostWeight,{learningSteps,relearningSteps,enableFuzz=false}){
  const reference=await fixedScheduler({learningSteps,relearningSteps,enableFuzz});
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
    enableFuzz,
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
  if(!card.lastReviewAt||card.reps===0) return undefined;
  const elapsedDays=Math.max(0,scheduler.chrono.difference(new Date(card.lastReviewAt),at));
  return clamp(Number(scheduler.model.forgettingCurve(memoryState(card),elapsedDays)),0,1);
}

function fnv1a32(value){
  let hash=0x811c9dc5;
  for(let i=0;i<value.length;i++){
    hash^=value.charCodeAt(i);
    hash=Math.imul(hash,0x01000193);
  }
  return hash>>>0;
}

function deterministicUnit(key){
  let a=fnv1a32(key);
  a=(a+0x6d2b79f5)>>>0;
  let t=a;
  t=Math.imul(t^(t>>>15),t|1);
  t^=t+Math.imul(t^(t>>>7),t|61);
  return ((t^(t>>>14))>>>0)/4294967296;
}

function outcomeRating(retrievability,key){
  const r=clamp(retrievability,0,1);
  if(deterministicUnit(key+':recall')>=r) return F.Rating.Again;
  const quality=deterministicUnit(key+':quality');
  if(quality<.10) return F.Rating.Easy;
  if(quality>.82) return F.Rating.Hard;
  return F.Rating.Good;
}

function directRetrievability(scheduler,card,at,scenario){
  return predictedRetrievability(scheduler,card,at)??scenario.newRecall;
}

function correctiveRetrievability(scheduler,card,at,scenario){
  const model=predictedRetrievability(scheduler,card,at)??scenario.newRecall;
  return clamp(model+scenario.repairBoost,0,.995);
}

function percentile(values,p){
  if(values.length===0) return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1))];
}

function projectCard(scheduler,step,scenario,cardIndex,horizonDays){
  let card=scheduler.newCard({now:new Date(START.getTime()+cardIndex*6*HOUR_MS),cardId:'r2-card-'+cardIndex});
  let now=new Date(card.dueAt);
  const horizon=START.getTime()+horizonDays*DAY_MS;
  let directAttempts=0,correctiveSessions=0,fsrsReviews=0,directAgain=0,correctiveFailures=0;
  let directRetrievabilitySum=0,minDirectRetrievability=1,intervalSum=0,intervalCount=0,sub20h=0;
  let observationIndex=0;
  const dueDays=[];

  while(now.getTime()<=horizon&&directAttempts<500){
    const directR=directRetrievability(scheduler,card,now,scenario);
    directRetrievabilitySum+=directR;
    minDirectRetrievability=Math.min(minDirectRetrievability,directR);
    const directRating=outcomeRating(directR,scenario.name+':'+cardIndex+':'+observationIndex+':direct');
    observationIndex++;
    directAttempts++;
    if(directRating===F.Rating.Again) directAgain++;
    const direct=scheduler.review({card,grade:directRating,now});
    fsrsReviews++;
    card=direct.card;
    let completedAt=now;

    if(directRating===F.Rating.Again){
      let correctiveAt=new Date(now.getTime()+DAY_MS);
      let repaired=false;
      let correctiveAttempt=0;
      while(correctiveAt.getTime()<=horizon&&correctiveAttempt<12){
        const verificationR=correctiveRetrievability(scheduler,card,correctiveAt,scenario);
        const verificationRating=outcomeRating(verificationR,scenario.name+':'+cardIndex+':'+observationIndex+':verify');
        observationIndex++;
        correctiveAttempt++;
        correctiveSessions++;
        if(verificationRating<F.Rating.Good) correctiveFailures++;
        const verification=scheduler.review({card,grade:verificationRating,now:correctiveAt});
        fsrsReviews++;
        card=verification.card;
        completedAt=correctiveAt;
        if(verificationRating>=F.Rating.Good){
          repaired=true;
          break;
        }
        correctiveAt=new Date(correctiveAt.getTime()+(verificationRating===F.Rating.Again?1:2)*DAY_MS);
      }
      if(!repaired) break;
    }

    const intervalDays=daysBetween(card.dueAt,completedAt);
    intervalSum+=intervalDays;
    intervalCount++;
    if(intervalDays<20/24) sub20h++;
    const dueDay=Math.floor((new Date(card.dueAt).getTime()-START.getTime())/DAY_MS);
    if(dueDay>=0&&dueDay<=horizonDays) dueDays.push(dueDay);
    now=new Date(card.dueAt);
  }

  return {
    directAttempts,correctiveSessions,fsrsReviews,directAgain,correctiveFailures,
    directRetrievabilitySum,minDirectRetrievability,intervalSum,intervalCount,sub20h,dueDays,
  };
}

function aggregateWorkload(rows){
  const total={
    directAttempts:0,correctiveSessions:0,fsrsReviews:0,directAgain:0,correctiveFailures:0,
    directRetrievabilitySum:0,minDirectRetrievability:1,intervalSum:0,intervalCount:0,sub20h:0,
  };
  const dueCounts=new Map();
  for(const row of rows){
    for(const key of ['directAttempts','correctiveSessions','fsrsReviews','directAgain','correctiveFailures','directRetrievabilitySum','intervalSum','intervalCount','sub20h']) total[key]+=row[key];
    total.minDirectRetrievability=Math.min(total.minDirectRetrievability,row.minDirectRetrievability);
    for(const day of row.dueDays) dueCounts.set(day,(dueCounts.get(day)??0)+1);
  }
  const dueLoads=[...dueCounts.values()];
  const workloadSessions=total.directAttempts+total.correctiveSessions;
  return {
    cards:rows.length,
    workloadSessions,
    workloadMinutes:workloadSessions*SESSION_MINUTES,
    directAttempts:total.directAttempts,
    correctiveSessions:total.correctiveSessions,
    fsrsReviews:total.fsrsReviews,
    directAgain:total.directAgain,
    correctiveFailures:total.correctiveFailures,
    directAgainRate:total.directAgain/Math.max(1,total.directAttempts),
    correctiveFailureRate:total.correctiveFailures/Math.max(1,total.correctiveSessions),
    meanDirectRetrievability:total.directRetrievabilitySum/Math.max(1,total.directAttempts),
    minDirectRetrievability:total.minDirectRetrievability,
    meanIntervalDays:total.intervalSum/Math.max(1,total.intervalCount),
    sub20hReviews:total.sub20h,
    occupiedDueDays:dueLoads.length,
    p95DueDayLoad:percentile(dueLoads,.95),
    peakDueDayLoad:dueLoads.length?Math.max(...dueLoads):0,
  };
}

async function runWorkload(scheduler,step,scenario,horizonDays){
  const rows=[];
  for(let i=0;i<CARDS;i++) rows.push(projectCard(scheduler,step,scenario,i,horizonDays));
  return aggregateWorkload(rows);
}

function summarizeAgainstBaseline(rows,names,baselineName){
  const baselineByCell=new Map(rows.filter(row=>row.name===baselineName).map(row=>[row.cell,row]));
  return names.map(name=>{
    const own=rows.filter(row=>row.name===name);
    const totals=own.reduce((acc,row)=>{
      acc.sessions+=row.workloadSessions;
      acc.directAttempts+=row.directAttempts;
      acc.directAgain+=row.directAgain;
      acc.directRWeighted+=row.meanDirectRetrievability*row.directAttempts;
      acc.sub20h+=row.sub20hReviews;
      acc.p95Due+=row.p95DueDayLoad;
      acc.peakDue+=row.peakDueDayLoad;
      return acc;
    },{sessions:0,directAttempts:0,directAgain:0,directRWeighted:0,sub20h:0,p95Due:0,peakDue:0});
    const comparisons=own.map(row=>{
      const base=baselineByCell.get(row.cell);
      assert.ok(base,'Missing baseline cell '+row.cell);
      return {
        sessionDelta:(row.workloadSessions-base.workloadSessions)/Math.max(1,base.workloadSessions),
        againRateDelta:row.directAgainRate-base.directAgainRate,
        meanRLoss:base.meanDirectRetrievability-row.meanDirectRetrievability,
        minRLoss:base.minDirectRetrievability-row.minDirectRetrievability,
      };
    });
    return {
      name,
      totalSessions:totals.sessions,
      directAgainRate:totals.directAgain/Math.max(1,totals.directAttempts),
      meanDirectRetrievability:totals.directRWeighted/Math.max(1,totals.directAttempts),
      sub20hReviews:totals.sub20h,
      meanP95DueDayLoad:totals.p95Due/Math.max(1,own.length),
      meanPeakDueDayLoad:totals.peakDue/Math.max(1,own.length),
      worstSessionDelta:Math.max(...comparisons.map(x=>x.sessionDelta)),
      worstAgainRateDelta:Math.max(...comparisons.map(x=>x.againRateDelta)),
      worstMeanRLoss:Math.max(...comparisons.map(x=>x.meanRLoss)),
      worstMinRLoss:Math.max(...comparisons.map(x=>x.minRLoss)),
    };
  });
}

async function learningStepExperiment(){
  const rows=[];
  for(const step of STEP_VARIANTS){
    for(const scenario of SCENARIOS){
      for(const horizonDays of HORIZONS){
        const scheduler=await fixedScheduler({...step,desiredRetention:.90,enableFuzz:false});
        rows.push({
          name:step.name,
          cell:scenario.name+'-'+horizonDays,
          scenario:scenario.name,
          horizonDays,
          ...await runWorkload(scheduler,step,scenario,horizonDays),
        });
      }
    }
  }
  const summaries=summarizeAgainstBaseline(rows,STEP_VARIANTS.map(x=>x.name),'one-day');
  const eligible=summaries.filter(row=>row.sub20hReviews===0&&row.worstAgainRateDelta<=.01&&row.worstMeanRLoss<=.01&&row.worstMinRLoss<=.02);
  assert.ok(eligible.length>0,'No operationally valid learning-step policy survived memory guardrails');
  const selected=eligible.reduce((best,row)=>row.totalSessions<best.totalSessions?row:best);
  return {rows,summaries,selected};
}

function policyEntries(step,enableFuzz=false){
  return [
    ...FIXED_RETENTIONS.map(value=>({name:'fixed-'+value.toFixed(2),kind:'fixed',create:()=>fixedScheduler({...step,desiredRetention:value,enableFuzz})})),
    ...COST_WEIGHTS.map(value=>({name:'cost-adr-'+value,kind:'cost-adr',create:()=>costAdrScheduler(value,{...step,enableFuzz})})),
  ];
}

async function schedulingPolicyExperiment(step){
  const entries=policyEntries(step,false);
  const rows=[];
  for(const entry of entries){
    for(const scenario of SCENARIOS){
      for(const horizonDays of HORIZONS){
        const scheduler=await entry.create();
        rows.push({
          name:entry.name,
          kind:entry.kind,
          cell:scenario.name+'-'+horizonDays,
          scenario:scenario.name,
          horizonDays,
          ...await runWorkload(scheduler,step,scenario,horizonDays),
        });
      }
    }
  }
  const summaries=summarizeAgainstBaseline(rows,entries.map(x=>x.name),'fixed-0.90').map(summary=>{
    const kind=entries.find(x=>x.name===summary.name).kind;
    const own=rows.filter(row=>row.name===summary.name);
    let paretoDominatedCells=0;
    for(const row of own){
      const fixedRows=rows.filter(candidate=>candidate.cell===row.cell&&candidate.kind==='fixed');
      if(fixedRows.some(candidate=>
        candidate.workloadSessions<=row.workloadSessions
        && candidate.meanDirectRetrievability>=row.meanDirectRetrievability-.002
        && candidate.directAgainRate<=row.directAgainRate+.002
        && (candidate.workloadSessions<row.workloadSessions||candidate.meanDirectRetrievability>row.meanDirectRetrievability+.002||candidate.directAgainRate<row.directAgainRate-.002)
      )) paretoDominatedCells++;
    }
    return {...summary,kind,paretoDominatedCells};
  });
  const baseline=summaries.find(x=>x.name==='fixed-0.90');
  assert.ok(baseline,'Fixed 0.90 baseline missing');
  const eligible=summaries.filter(row=>
    row.sub20hReviews===0
    && row.worstAgainRateDelta<=.01
    && row.worstMeanRLoss<=.01
    && row.worstMinRLoss<=.02
    && (row.kind!=='cost-adr'||row.paretoDominatedCells===0)
  );
  assert.ok(eligible.length>0,'No scheduling policy survived memory guardrails');
  const rawWinner=eligible.reduce((best,row)=>row.totalSessions<best.totalSessions?row:best);
  const improvement=(baseline.totalSessions-rawWinner.totalSessions)/baseline.totalSessions;
  const selected=rawWinner.name==='fixed-0.90'||improvement>=.05?rawWinner:baseline;
  return {rows,summaries,rawWinner,selected,improvement};
}

async function createSelectedScheduler(policy,step,enableFuzz){
  if(policy.name.startsWith('fixed-')){
    const retention=Number(policy.name.slice('fixed-'.length));
    return fixedScheduler({...step,desiredRetention:retention,enableFuzz});
  }
  const weight=Number(policy.name.slice('cost-adr-'.length));
  return costAdrScheduler(weight,{...step,enableFuzz});
}

async function fuzzExperiment(policy,step){
  const rows=[];
  for(const enabled of [false,true]){
    for(const scenario of SCENARIOS){
      for(const horizonDays of HORIZONS){
        const scheduler=await createSelectedScheduler(policy,step,enabled);
        rows.push({
          name:enabled?'fuzz-on':'fuzz-off',
          cell:scenario.name+'-'+horizonDays,
          ...await runWorkload(scheduler,step,scenario,horizonDays),
        });
      }
    }
  }
  const summaries=summarizeAgainstBaseline(rows,['fuzz-off','fuzz-on'],'fuzz-off');
  const off=summaries.find(x=>x.name==='fuzz-off');
  const on=summaries.find(x=>x.name==='fuzz-on');
  assert.ok(off&&on,'Fuzz comparison rows missing');
  const workloadDelta=(on.totalSessions-off.totalSessions)/off.totalSessions;
  const p95Improvement=(off.meanP95DueDayLoad-on.meanP95DueDayLoad)/Math.max(1,off.meanP95DueDayLoad);
  const peakImprovement=(off.meanPeakDueDayLoad-on.meanPeakDueDayLoad)/Math.max(1,off.meanPeakDueDayLoad);
  const safe=on.worstAgainRateDelta<=.005&&on.worstMeanRLoss<=.005&&on.worstMinRLoss<=.01&&workloadDelta<=.01;
  const enable=safe&&(p95Improvement>=.05||peakImprovement>=.05);
  return {rows,summaries,workloadDelta,p95Improvement,peakImprovement,enable};
}

async function lifecycleShapeExperiment(){
  const results=[];
  for(const step of STEP_VARIANTS){
    const scheduler=await fixedScheduler({...step,desiredRetention:.90,enableFuzz:false});
    const initial=scheduler.newCard({now:START,cardId:'shape-'+step.name});
    const failed=scheduler.review({card:initial,grade:F.Rating.Again,now:START}).card;
    const firstVerificationAt=new Date(START.getTime()+DAY_MS);
    const verificationAgain=scheduler.review({card:failed,grade:F.Rating.Again,now:firstVerificationAt}).card;
    const secondVerificationAt=new Date(firstVerificationAt.getTime()+DAY_MS);
    const verificationGood=scheduler.review({card:verificationAgain,grade:F.Rating.Good,now:secondVerificationAt}).card;
    results.push({
      name:step.name,
      firstAgainHours:hoursBetween(failed.dueAt,START),
      firstAgainState:failed.state,
      firstVerificationAgainState:verificationAgain.state,
      firstVerificationAgainLapses:verificationAgain.lapses,
      successfulReturnState:verificationGood.state,
      successfulReturnNextDays:daysBetween(verificationGood.dueAt,secondVerificationAt),
    });
  }
  return results;
}

(async()=>{
  let lowFailures=0,highFailures=0;
  for(let i=0;i<5000;i++){
    if(outcomeRating(.65,'sensitivity-'+i)===F.Rating.Again) lowFailures++;
    if(outcomeRating(.90,'sensitivity-'+i)===F.Rating.Again) highFailures++;
  }
  assert.ok(lowFailures>highFailures*2,'Outcome simulator must materially increase failure as retrievability falls');
  assert.equal(outcomeRating(.73,'determinism'),outcomeRating(.73,'determinism'),'Outcome simulator must be deterministic');

  const lifecycle=await lifecycleShapeExperiment();
  const steps=await learningStepExperiment();
  const selectedStep=STEP_VARIANTS.find(x=>x.name===steps.selected.name);
  assert.ok(selectedStep,'Selected learning-step definition missing');

  const policy=await schedulingPolicyExperiment(selectedStep);
  assert.ok(policy.rows.some(row=>row.correctiveFailures>0),'Corrected benchmark must exercise failed closed-book verification and repeated host corrective work');

  const fuzz=await fuzzExperiment(policy.selected,selectedStep);
  const fuzzSchedulerA=await createSelectedScheduler(policy.selected,selectedStep,true);
  const fuzzSchedulerB=await createSelectedScheduler(policy.selected,selectedStep,true);
  const deterministicA=await runWorkload(fuzzSchedulerA,selectedStep,SCENARIOS[1],365);
  const deterministicB=await runWorkload(fuzzSchedulerB,selectedStep,SCENARIOS[1],365);
  assert.deepEqual(deterministicA,deterministicB,'Fuzzing must remain deterministic for fixed card identities and review counts');

  const decision={
    learningSteps:selectedStep.learningSteps,
    relearningSteps:selectedStep.relearningSteps,
    policy:policy.selected.name,
    policyImprovementVsFixed090:(policy.summaries.find(x=>x.name==='fixed-0.90').totalSessions-policy.selected.totalSessions)/policy.summaries.find(x=>x.name==='fixed-0.90').totalSessions,
    enableFuzz:fuzz.enable,
  };
  assert.deepEqual(decision.learningSteps,['1d'],'Measured long-form learning step must remain one day');
  assert.deepEqual(decision.relearningSteps,['1d'],'Measured long-form relearning step must remain one day');
  assert.equal(decision.policy,'fixed-0.90','Outcome-sensitive scheduling benchmark must support fixed 90% as the production default');
  assert.equal(decision.enableFuzz,false,'Fuzzing must remain disabled unless it improves due-day spreading without breaching memory/workload guardrails');

  console.log('PASS FSRS-R2 corrected lifecycle shape: '+JSON.stringify(lifecycle));
  console.log('PASS FSRS-R2 learning-step summary: '+JSON.stringify(steps.summaries));
  console.log('PASS FSRS-R2 policy summary: '+JSON.stringify(policy.summaries));
  console.log('PASS FSRS-R2 raw policy winner: '+JSON.stringify({winner:policy.rawWinner.name,improvement:policy.improvement,selected:policy.selected.name}));
  console.log('PASS FSRS-R2 fuzz summary: '+JSON.stringify({summaries:fuzz.summaries,workloadDelta:fuzz.workloadDelta,p95Improvement:fuzz.p95Improvement,peakImprovement:fuzz.peakImprovement,enable:fuzz.enable}));
  console.log('PASS FSRS-R2 measured decision: '+JSON.stringify(decision));
})().catch(error=>{console.error(error);process.exitCode=1;});
