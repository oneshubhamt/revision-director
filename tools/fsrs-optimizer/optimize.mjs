import {createHash} from "node:crypto";
import {readFile,rename,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {
 FSRSBinding,computeParameters,convertCsvToFsrsItemsWithCardIds,evaluateWithTimeSeriesSplits
} from "@open-spaced-repetition/binding";
import {OptimizerGateRejectedError,optimizeFsrsProfile} from "./optimizer-core.mjs";

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

const progress=stage=>{
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

const checkpoint=()=>{
 if(abortRequested||Date.now()>=deadline)throw Error("Optimizer interrupted before completion");
};

const bytes=new Uint8Array(await readFile(inputPath));
const csv=new TextDecoder().decode(bytes);
try{
 const {profile,rawRows}=await optimizeFsrsProfile({
  binding:{FSRSBinding,computeParameters,convertCsvToFsrsItemsWithCardIds,evaluateWithTimeSeriesSplits},
  csv,
  sourceSha256:data=>createHash("sha256").update(data).digest("hex"),
  optimizerOptions,
  checkpoint
 });
 checkpoint();
 await writeFile(temporaryOutput,JSON.stringify(profile,null,2)+"\n","utf8");
 await rename(temporaryOutput,outputPath);
 console.log("FSRS-7 profile written:",outputPath);
 console.log("raw evidence rows:",rawRows);
 console.log("optimizer items:",profile.evidenceItems);
 console.log("holdout log loss: stock",profile.evaluation.holdout.stock.logLoss,
  "personalized",profile.evaluation.holdout.personalized.logLoss);
 console.log("holdout RMSE bins: stock",profile.evaluation.holdout.stock.rmseBins,
  "personalized",profile.evaluation.holdout.personalized.rmseBins);
 console.log("time-series log loss:",profile.evaluation.crossValidation.logLoss);
 console.log("time-series RMSE bins:",profile.evaluation.crossValidation.rmseBins);
}catch(error){
 if(error instanceof OptimizerGateRejectedError)
  console.error("Personalized FSRS-7 activation gate failed:",error.reasons.join("; "));
 throw error;
}
