'use strict';
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");

(async()=>{
 const mod=await import(pathToFileURL(path.resolve(__dirname,"../tools/fsrs-optimizer/optimizer-core.mjs")).href);
 const csv="review_time,card_id,review_rating,review_duration,review_state\n1000,a,3,500,0\n";
 const weights=Array.from({length:34},(_,index)=>0.2+index/1000);
 const incumbentWeights=Array.from({length:34},(_,index)=>0.3+index/1000);
 const stages=[];
 class Model{
  constructor(candidate){this.candidate=candidate;}
  evaluate(){
   if(!this.candidate)return {logLoss:.42,rmseBins:.08};
   return this.candidate[0]>.25?{logLoss:.41,rmseBins:.079}:{logLoss:.40,rmseBins:.075};
  }
 }
 const binding={
  FSRSBinding:Model,
  convertCsvToFsrsItemsWithCardIds(){
   const items=Array.from({length:384},(_,index)=>({index}));
   return {items,cardIds:items.map((_,index)=>"card-"+Math.floor(index/4))};
  },
  async computeParameters(_items,options){stages.push(options.__stage);return [...weights];},
  async evaluateWithTimeSeriesSplits(){return {logLoss:.39,rmseBins:.07};}
 };
 const optimizerOptions=(cardIds,stage)=>({cardIds,__stage:stage});
 const incumbentProfile={sourceSha256:"f".repeat(64),weights:incumbentWeights};
 const result=await mod.optimizeFsrsProfile({
  binding,csv,sourceSha256:async()=>"a".repeat(64),optimizerOptions,incumbentProfile
 });
 assert.equal(result.rawRows,1);
 assert.equal(result.profile.schema,"revision-director-fsrs-profile/v1");
 assert.equal(result.profile.evidenceItems,384);
 assert.equal(result.profile.weights.length,34);
 assert.equal(result.profile.evaluation.holdout.trainItems,320);
 assert.equal(result.profile.evaluation.holdout.holdoutItems,64);
 assert.equal(result.profile.evaluation.holdout.holdoutCards,16);
 assert.equal(result.profile.evaluation.holdout.gate,"passed");
 assert.equal(result.profile.evaluation.holdout.incumbent.sourceSha256,incumbentProfile.sourceSha256);
 assert.equal(result.profile.evaluation.holdout.incumbent.weightsFingerprint,mod.optimizerWeightsFingerprint(incumbentWeights));
 assert.deepEqual(result.profile.training.runtimeLearningSteps,["1d"]);
 assert.deepEqual(result.profile.training.runtimeRelearningSteps,["1d"]);
 assert.deepEqual(stages,["Train validation candidate","Retrain final profile on all evidence"]);

 const rejectedBinding={...binding,FSRSBinding:class{
   constructor(candidate){this.candidate=candidate;}
   evaluate(){return this.candidate?{logLoss:.43,rmseBins:.07}:{logLoss:.42,rmseBins:.08};}
 }};
 await assert.rejects(
  mod.optimizeFsrsProfile({binding:rejectedBinding,csv,sourceSha256:async()=>"b".repeat(64),optimizerOptions}),
  error=>error instanceof mod.OptimizerGateRejectedError&&error.reasons.some(reason=>reason.includes("log loss"))
 );

 const microscopicBinding={...binding,FSRSBinding:class{
   constructor(candidate){this.candidate=candidate;}
   evaluate(){return this.candidate?{logLoss:.4195,rmseBins:.079}:{logLoss:.42,rmseBins:.08};}
 }};
 await assert.rejects(
  mod.optimizeFsrsProfile({binding:microscopicBinding,csv,sourceSha256:async()=>"d".repeat(64),optimizerOptions}),
  error=>error instanceof mod.OptimizerGateRejectedError&&error.reasons.some(reason=>reason.includes("practical minimum"))
 );

 const incumbentWinsBinding={...binding,FSRSBinding:class{
   constructor(candidate){this.candidate=candidate;}
   evaluate(){
    if(!this.candidate)return {logLoss:.42,rmseBins:.08};
    return this.candidate[0]>.25?{logLoss:.395,rmseBins:.074}:{logLoss:.40,rmseBins:.075};
   }
 }};
 await assert.rejects(
  mod.optimizeFsrsProfile({
   binding:incumbentWinsBinding,csv,sourceSha256:async()=>"e".repeat(64),optimizerOptions,incumbentProfile
  }),
  error=>error instanceof mod.OptimizerGateRejectedError&&error.reasons.some(reason=>reason.includes("active personalized profile"))
 );

 const tooSmall={...binding,convertCsvToFsrsItemsWithCardIds(){
  const items=Array.from({length:120},(_,index)=>({index}));
  return {items,cardIds:items.map((_,index)=>"card-"+Math.floor(index/4))};
 }};
 await assert.rejects(
  mod.optimizeFsrsProfile({binding:tooSmall,csv,sourceSha256:async()=>"c".repeat(64),optimizerOptions}),
  error=>error instanceof mod.OptimizerGateRejectedError&&error.reasons.some(reason=>reason.includes("Need at least 64"))
 );

 console.log("PASS 24 shared FSRS optimizer-core checks");
})().catch(error=>{console.error(error);process.exitCode=1;});
