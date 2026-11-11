import {createHash} from "node:crypto";
import {readFile,rename,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {
 FSRSBinding,computeParameters,convertCsvToFsrsItemsWithCardIds,evaluateWithTimeSeriesSplits
} from "@open-spaced-repetition/binding";
import {
 HOLDOUT_STRATEGY,MIN_HOLDOUT_CARDS,MIN_HOLDOUT_ITEMS,MIN_TRAIN_ITEMS,
 OPTIMIZER_CHRONOLOGY,OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,OPTIMIZER_ROLLOVER_HOUR,
 assertChronologicalCsv,evaluateHoldoutGate,splitChronologicalHoldout
} from "./optimizer-policy.mjs";

const args=process.argv.slice(2);
const [input,output,...flagArgs]=args;
if(!input||!output){
 console.error("Usage: npm run optimize -- <reviews.csv> <profile.json> [--max-seconds=N] [--poll-ms=N]");
 console.error("Input must be Revision Director optimizer evidence exported in chronological order.");
 process.exit(2);
}
const inputPath=resolve(input),outputPath=resolve(output),temporaryOutput=outputPath+".tmp";
if(inputPath===outputPath||inputPath===temporaryOutput)throw Error("Input CSV and output profile must use different paths");

let maxSeconds=0,pollMs=250;
for(const arg of flagArgs){
 const [name,raw]=arg.split("=",2);
 if(name==="--max-seconds"){
  maxSeconds=Number(raw);
  if(!Number.isFinite(maxSeconds)||maxSeconds<0)throw Error("--max-seconds must be a non-negative number");
 }else if(name==="--poll-ms"){
  pollMs=Number(raw);
  if(!Number.isSafeInteger(pollMs)||pollMs<50||pollMs>5000)throw Error("--poll-ms must be an integer from 50 to 5000");
 }else throw Error("Unknown optimizer option: "+arg);
}
await rm(outputPath,{force:true});
await rm(temporaryOutput,{force:true});

let abortRequested=false;
const deadline=maxSeconds>0?Date.now()+maxSeconds*1000:Number.POSITIVE_INFINITY;
process.on("SIGINT",()=>{abortRequested=true;console.error("\nOptimizer interruption requested; stopping at the next progress checkpoint.");});
const progress=(stage)=>{
 let lastPercent=-5,lastPrinted=0;
 return (current,total)=>{
  const now=Date.now();
  if(abortRequested||now>=deadline)return false;
  const percent=total>0?Math.floor(current*100/total):0;
  if(percent>=lastPercent+5||now-lastPrinted>=2000||current===total){
   console.error(stage+": "+current+"/"+total+(total>0?" ("+percent+"%)":""));
   lastPercent=percent;lastPrinted=now;
  }
  return true;
 };
};
const optimizerOptions=(cardIds,stage)=>({
 modelVersion:"FSRS-7",enableShortTerm:true,enableSchedPenalties:true,numRelearningSteps:1,
 cardIds,timeout:pollMs,progress:progress(stage)
});
const ensureWeights=(weights,label)=>{
 if(!Array.isArray(weights)||weights.length!==34||weights.some(value=>!Number.isFinite(value)))
  throw Error(label+" did not return exactly 34 finite FSRS-7 weights");
 return weights;
};

const bytes=new Uint8Array(await readFile(inputPath));
const csv=new TextDecoder().decode(bytes);
const rawRows=assertChronologicalCsv(csv);
if(rawRows<1)throw Error("Review evidence is empty");
const sourceSha256=createHash("sha256").update(bytes).digest("hex");
const converted=await Promise.resolve(convertCsvToFsrsItemsWithCardIds(
 bytes,OPTIMIZER_ROLLOVER_HOUR,OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,"FSRS-7"
));
const {items,cardIds}=converted;
if(items.length<1)throw Error("Review evidence did not produce any FSRS-7 optimizer items");

const split=splitChronologicalHoldout(items,cardIds);
if(split.trainCount<MIN_TRAIN_ITEMS||split.holdoutCount<MIN_HOLDOUT_ITEMS||split.holdoutCards<MIN_HOLDOUT_CARDS)
 throw Error("Insufficient evidence for personalized activation: need at least "+MIN_TRAIN_ITEMS+
  " historical training items, "+MIN_HOLDOUT_ITEMS+" later holdout items and "+MIN_HOLDOUT_CARDS+
  " holdout cards; observed "+split.trainCount+", "+split.holdoutCount+" and "+split.holdoutCards+".");

const validationWeights=ensureWeights(
 await computeParameters(split.trainItems,optimizerOptions(split.trainCardIds,"Train validation candidate")),
 "Validation training"
);
if(abortRequested||Date.now()>=deadline)throw Error("Optimizer interrupted before holdout evaluation");
const stockModel=new FSRSBinding();
const candidateModel=new FSRSBinding(validationWeights);
const stockHoldout=stockModel.evaluate(split.holdoutItems,split.holdoutCardIds);
const personalizedHoldout=candidateModel.evaluate(split.holdoutItems,split.holdoutCardIds);
const gate=evaluateHoldoutGate(stockHoldout,personalizedHoldout,split);
console.error("Holdout stock FSRS-7:",JSON.stringify(gate.stock));
console.error("Holdout personalized:",JSON.stringify(gate.personalized));
if(!gate.passed)throw Error("Personalized FSRS-7 activation gate failed: "+gate.reasons.join("; "));

const weights=ensureWeights(
 await computeParameters(items,optimizerOptions(cardIds,"Retrain final profile on all evidence")),
 "Final training"
);
const crossValidation=await evaluateWithTimeSeriesSplits(items,optimizerOptions(cardIds,"Time-series cross-validation"));
if(!Number.isFinite(crossValidation.logLoss)||!Number.isFinite(crossValidation.rmseBins))
 throw Error("Optimizer time-series cross-validation failed");
if(abortRequested||Date.now()>=deadline)throw Error("Optimizer interrupted before profile write");

const profile={
 schema:"revision-director-fsrs-profile/v1",model:"FSRS-7",bindingVersion:"0.6.1",
 trainedAt:new Date().toISOString(),sourceSha256,evidenceItems:items.length,weights,
 evaluation:{
  crossValidation:{logLoss:crossValidation.logLoss,rmseBins:crossValidation.rmseBins},
  holdout:{
   strategy:HOLDOUT_STRATEGY,trainItems:split.trainCount,holdoutItems:split.holdoutCount,
   holdoutCards:split.holdoutCards,minimumTrainItems:MIN_TRAIN_ITEMS,
   minimumHoldoutItems:MIN_HOLDOUT_ITEMS,minimumHoldoutCards:MIN_HOLDOUT_CARDS,
   stock:{logLoss:gate.stock.logLoss,rmseBins:gate.stock.rmseBins},
   personalized:{logLoss:gate.personalized.logLoss,rmseBins:gate.personalized.rmseBins},
   gate:"passed"
  }
 },
 training:{
  enableShortTerm:true,enableSchedPenalties:true,numRelearningSteps:1,
  chronology:OPTIMIZER_CHRONOLOGY,converterFixedUtcOffsetMinutes:OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,
  converterRolloverHour:OPTIMIZER_ROLLOVER_HOUR,runtimeLearningSteps:["1d"],
  runtimeRelearningSteps:["1d"],validationCandidateTrainedItems:split.trainCount,
  finalRetrainedOnAllEvidence:true
 }
};
await writeFile(temporaryOutput,JSON.stringify(profile,null,2)+"\n","utf8");
await rename(temporaryOutput,outputPath);
console.log("FSRS-7 profile written:",outputPath);
console.log("raw evidence rows:",rawRows);
console.log("optimizer items:",items.length);
console.log("holdout log loss: stock",gate.stock.logLoss,"personalized",gate.personalized.logLoss);
console.log("holdout RMSE bins: stock",gate.stock.rmseBins,"personalized",gate.personalized.rmseBins);
console.log("time-series log loss:",crossValidation.logLoss);
console.log("time-series RMSE bins:",crossValidation.rmseBins);
