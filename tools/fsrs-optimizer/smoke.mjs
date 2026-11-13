import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {
  FSRSBinding,
  FSRSBindingItem,
  FSRSBindingReview,
  computeParameters,
  convertCsvToFsrsItemsWithCardIds,
} from "@open-spaced-repetition/binding";
import {
  OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,
  OPTIMIZER_ROLLOVER_HOUR,
  evaluateHoldoutGate,
  splitChronologicalHoldout,
} from "./optimizer-policy.mjs";

const item=new FSRSBindingItem([
  new FSRSBindingReview(3,0),
  new FSRSBindingReview(3,1/24),
  new FSRSBindingReview(4,1),
]);
const weights=await computeParameters([item],{
  modelVersion:"FSRS-7",
  enableShortTerm:true,
  enableSchedPenalties:true,
  numRelearningSteps:1,
  trainingConfig:{numEpochs:1,batchSize:32,seed:2023,maxSeqLen:256,learningRate:0.04,gamma:1e-4},
});
assert.equal(weights.length,34);
assert.ok(weights.every(Number.isFinite));
const model=new FSRSBinding(weights);
const next=model.nextStates(null,0.9,0);
assert.ok(next.good.memory.stability>0);
assert.ok(next.good.memory.stabilityFast>0);

const rows=["review_time,card_id,review_rating,review_duration,review_state"];
for(let card=0;card<120;card++){
  const start=1704067200000+card*1000;
  rows.push(`${start},card-${card},3,1000,0`);
  rows.push(`${start+10*60*1000},card-${card},3,900,1`);
  rows.push(`${start+24*60*60*1000},card-${card},3,800,2`);
}
const csv=new TextEncoder().encode(rows.join("\n")+"\n");
const converted=convertCsvToFsrsItemsWithCardIds(
  csv,OPTIMIZER_ROLLOVER_HOUR,OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,"FSRS-7",
);
assert.ok(converted.items.length>=120);
const stockMetrics=new FSRSBinding().evaluate(converted.items,converted.cardIds);
const personalizedMetrics=model.evaluate(converted.items,converted.cardIds);
for(const metrics of [stockMetrics,personalizedMetrics]){
  assert.ok(Number.isFinite(metrics.logLoss));
  assert.ok(Number.isFinite(metrics.rmseBins));
}

const fakeItems=Array.from({length:384},(_,index)=>({index}));
const fakeIds=Array.from({length:384},(_,index)=>Math.floor(index/4));
const split=splitChronologicalHoldout(fakeItems,fakeIds);
assert.equal(split.trainCount,320);
assert.equal(split.holdoutCount,64);
assert.equal(split.holdoutCards,16);
assert.equal(evaluateHoldoutGate(
  {logLoss:.4,rmseBins:.08},{logLoss:.39,rmseBins:.08},split,
).passed,true);
assert.equal(evaluateHoldoutGate(
  {logLoss:.4,rmseBins:.08},{logLoss:.39,rmseBins:.081},split,
).passed,false);
assert.equal(evaluateHoldoutGate(
  {logLoss:.4,rmseBins:.08},{logLoss:.38,rmseBins:.07},split,
  {sourceSha256:"a".repeat(64),weightsFingerprint:"fnv1a64:0123456789abcdef",metrics:{logLoss:.39,rmseBins:.075}},
).passed,true);
assert.equal(evaluateHoldoutGate(
  {logLoss:.4,rmseBins:.08},{logLoss:.39,rmseBins:.075},split,
  {sourceSha256:"a".repeat(64),weightsFingerprint:"fnv1a64:0123456789abcdef",metrics:{logLoss:.385,rmseBins:.074}},
).passed,false);

const temp=await mkdtemp(join(tmpdir(),"revision-director-fsrs-"));
try{
  const csvPath=join(temp,"small.csv");
  const profilePath=join(temp,"profile.json");
  await writeFile(csvPath,rows.slice(0,4).join("\n")+"\n","utf8");
  await writeFile(profilePath,"sentinel","utf8");
  const cli=fileURLToPath(new URL("./optimize.mjs",import.meta.url));

  const missingOutput=spawnSync(process.execPath,[cli,csvPath],{encoding:"utf8"});
  assert.equal(missingOutput.status,2);
  assert.equal(await readFile(profilePath,"utf8"),"sentinel");

  const insufficient=spawnSync(process.execPath,[cli,csvPath,profilePath],{encoding:"utf8"});
  assert.notEqual(insufficient.status,0);
  let stale=true;
  try{await readFile(profilePath,"utf8");}catch(error){stale=error?.code!=="ENOENT";}
  assert.equal(stale,false);
}finally{
  await rm(temp,{recursive:true,force:true});
}

console.log("PASS native FSRS-7 optimizer smoke: training, conversion, evaluation, held-out policy and fail-closed CLI output");
