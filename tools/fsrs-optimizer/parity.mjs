import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname,join} from "node:path";
import {
 FSRSBinding,computeParameters,convertCsvToFsrsItemsWithCardIds
} from "@open-spaced-repetition/binding";
import {createInstance} from "@open-spaced-repetition/binding-wasm32-wasip1/workerd";
import {
 OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,OPTIMIZER_ROLLOVER_HOUR
} from "./optimizer-policy.mjs";

const rows=["review_time,card_id,review_rating,review_duration,review_state"];
for(let card=0;card<40;card++){
 const start=1704067200000+card*1000;
 const ratings=card%4===0?[3,3,1,1]:card%4===1?[3,3,2,1]:
  card%4===2?[3,4,3,2]:[3,3,3,3];
 const times=[start,start+10*60*1000,start+12*60*60*1000,start+36*60*60*1000];
 const states=[0,1,2,2];
 for(let i=0;i<times.length;i++)rows.push(`${times[i]},card-${card},${ratings[i]},${1000-i*100},${states[i]}`);
}
const bytes=new TextEncoder().encode(rows.join("\n")+"\n");
const convert=binding=>binding.convertCsvToFsrsItemsWithCardIds(
 bytes,OPTIMIZER_ROLLOVER_HOUR,OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,"FSRS-7"
);
const snapshot=converted=>converted.items.map(item=>item.reviews.map(review=>[
 review.rating,Number(review.deltaT.toFixed(7))
]));
const groupSizes=ids=>{
 const counts=new Map();
 for(const id of ids)counts.set(id,(counts.get(id)??0)+1);
 return [...counts.values()].sort((a,b)=>a-b);
};
const close=(a,b,tolerance,label)=>{
 const delta=Math.abs(a-b);
 assert.ok(delta<=tolerance,`${label}: |${a} - ${b}| = ${delta} > ${tolerance}`);
};

const require=createRequire(import.meta.url);
const packageDir=dirname(require.resolve("@open-spaced-repetition/binding-wasm32-wasip1/package.json"));
const wasmModule=new WebAssembly.Module(await readFile(join(packageDir,"fsrs-binding.wasm32-wasip1.wasm")));
const runtime=await createInstance(wasmModule);
try{
 const wasm=runtime.exports;
 assert.equal(wasm.__napiBindingTarget,"wasm32-wasip1");
 const nativeConverted=await Promise.resolve(convert({convertCsvToFsrsItemsWithCardIds}));
 const wasmConverted=await Promise.resolve(convert(wasm));
 assert.deepEqual(snapshot(wasmConverted),snapshot(nativeConverted),"Native and WASM conversion diverged");
 assert.deepEqual(groupSizes(wasmConverted.cardIds),groupSizes(nativeConverted.cardIds),"Native and WASM card grouping diverged");

 const trainingConfig={numEpochs:1,batchSize:64,seed:2023,maxSeqLen:256,learningRate:0.0118,gamma:1};
 const nativeWeights=await computeParameters(nativeConverted.items,{
  modelVersion:"FSRS-7",enableShortTerm:true,enableSchedPenalties:true,numRelearningSteps:1,
  cardIds:nativeConverted.cardIds,trainingConfig
 });
 const wasmWeights=await wasm.computeParameters(wasmConverted.items,{
  modelVersion:"FSRS-7",enableShortTerm:true,enableSchedPenalties:true,numRelearningSteps:1,
  cardIds:wasmConverted.cardIds,trainingConfig
 });
 assert.equal(nativeWeights.length,34);assert.equal(wasmWeights.length,34);
 let maxWeightDelta=0;
 for(let i=0;i<34;i++)maxWeightDelta=Math.max(maxWeightDelta,Math.abs(nativeWeights[i]-wasmWeights[i]));
 assert.ok(maxWeightDelta<=1e-4,"Native/WASM trained weights diverged by "+maxWeightDelta);

 const nativeMetrics=new FSRSBinding(nativeWeights).evaluate(nativeConverted.items,nativeConverted.cardIds);
 const wasmMetrics=new wasm.FSRSBinding(wasmWeights).evaluate(wasmConverted.items,wasmConverted.cardIds);
 close(nativeMetrics.logLoss,wasmMetrics.logLoss,1e-5,"log loss");
 close(nativeMetrics.rmseBins,wasmMetrics.rmseBins,1e-5,"RMSE bins");
 console.log("FSRS optimizer native/WASM parity passed:",JSON.stringify({
  items:nativeConverted.items.length,cards:groupSizes(nativeConverted.cardIds).length,
  maxWeightDelta,logLossDelta:Math.abs(nativeMetrics.logLoss-wasmMetrics.logLoss),
  rmseBinsDelta:Math.abs(nativeMetrics.rmseBins-wasmMetrics.rmseBins)
 }));
}finally{await runtime.dispose();}
