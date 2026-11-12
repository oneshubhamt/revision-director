import {
 HOLDOUT_STRATEGY,MIN_HOLDOUT_CARDS,MIN_HOLDOUT_ITEMS,MIN_TRAIN_ITEMS,
 OPTIMIZER_CHRONOLOGY,OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,OPTIMIZER_ROLLOVER_HOUR,
 assertChronologicalCsv,evaluateHoldoutGate,splitChronologicalHoldout
} from "./optimizer-policy.mjs";

export class OptimizerGateRejectedError extends Error{
 constructor(reasons){
  super(reasons.join("; "));
  this.name="OptimizerGateRejectedError";
  this.reasons=[...reasons];
 }
}

export const optimizerMetrics=(value,label)=>{
 if(!value||!Number.isFinite(value.logLoss)||value.logLoss<0||
   !Number.isFinite(value.rmseBins)||value.rmseBins<0)
  throw Error(label+" returned invalid evaluation metrics");
 return {logLoss:value.logLoss,rmseBins:value.rmseBins};
};

const ensureWeights=(weights,label)=>{
 if(!Array.isArray(weights)||weights.length!==34||weights.some(value=>!Number.isFinite(value)))
  throw Error(label+" did not return exactly 34 finite FSRS-7 weights");
 return weights;
};

export async function convertFsrsEvidence({binding,csv,sourceSha256}){
 if(typeof csv!=="string"||!csv.trim())throw Error("Optimizer evidence is empty");
 const rawRows=assertChronologicalCsv(csv);
 if(rawRows<1)throw Error("Review evidence is empty");

 const bytes=new TextEncoder().encode(csv);
 const checksum=await sourceSha256(bytes);
 if(typeof checksum!=="string"||!/^[a-f0-9]{64}$/.test(checksum))
  throw Error("Optimizer source checksum is invalid");

 const converted=await Promise.resolve(binding.convertCsvToFsrsItemsWithCardIds(
  bytes,OPTIMIZER_ROLLOVER_HOUR,OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,"FSRS-7"
 ));
 const {items,cardIds}=converted;
 if(!Array.isArray(items)||!Array.isArray(cardIds)||items.length<1||items.length!==cardIds.length)
  throw Error("Review evidence did not produce aligned FSRS-7 optimizer items");
 return {rawRows,sourceSha256:checksum,items,cardIds};
}

export async function optimizeFsrsProfile({
 binding,csv,sourceSha256,optimizerOptions,checkpoint=()=>undefined
}){
 const converted=await convertFsrsEvidence({binding,csv,sourceSha256});
 const {rawRows,sourceSha256:checksum,items,cardIds}=converted;
 const split=splitChronologicalHoldout(items,cardIds);
 if(split.trainCount<MIN_TRAIN_ITEMS||split.holdoutCount<MIN_HOLDOUT_ITEMS||split.holdoutCards<MIN_HOLDOUT_CARDS){
  throw new OptimizerGateRejectedError([
   "Need at least "+MIN_TRAIN_ITEMS+" historical optimizer items, "+MIN_HOLDOUT_ITEMS+
   " later holdout items and "+MIN_HOLDOUT_CARDS+" distinct holdout cards; observed "+
   split.trainCount+", "+split.holdoutCount+" and "+split.holdoutCards+"."
  ]);
 }

 const validationWeights=ensureWeights(
  await binding.computeParameters(
   split.trainItems,
   optimizerOptions(split.trainCardIds,"Train validation candidate")
  ),
  "Validation training"
 );
 await checkpoint("after-validation-training");

 const stock=optimizerMetrics(
  new binding.FSRSBinding().evaluate(split.holdoutItems,split.holdoutCardIds),
  "Stock FSRS-7"
 );
 const personalized=optimizerMetrics(
  new binding.FSRSBinding(validationWeights).evaluate(split.holdoutItems,split.holdoutCardIds),
  "Personalized FSRS-7"
 );
 const gate=evaluateHoldoutGate(stock,personalized,split);
 if(!gate.passed)throw new OptimizerGateRejectedError(gate.reasons);
 await checkpoint("after-holdout-gate");

 const weights=ensureWeights(
  await binding.computeParameters(
   items,
   optimizerOptions(cardIds,"Retrain final profile on all evidence")
  ),
  "Final training"
 );

 const crossValidation=optimizerMetrics(
  await binding.evaluateWithTimeSeriesSplits(
   items,
   optimizerOptions(cardIds,"Time-series cross-validation")
  ),
  "Time-series cross-validation"
 );
 await checkpoint("before-profile-result");

 return {
  rawRows,
  profile:{
   schema:"revision-director-fsrs-profile/v1",
   model:"FSRS-7",
   bindingVersion:"0.6.1",
   trainedAt:new Date().toISOString(),
   sourceSha256:checksum,
   evidenceItems:items.length,
   weights,
   evaluation:{
    crossValidation,
    holdout:{
     strategy:HOLDOUT_STRATEGY,
     trainItems:split.trainCount,
     holdoutItems:split.holdoutCount,
     holdoutCards:split.holdoutCards,
     minimumTrainItems:MIN_TRAIN_ITEMS,
     minimumHoldoutItems:MIN_HOLDOUT_ITEMS,
     minimumHoldoutCards:MIN_HOLDOUT_CARDS,
     stock:gate.stock,
     personalized:gate.personalized,
     gate:"passed"
    }
   },
   training:{
    enableShortTerm:true,
    enableSchedPenalties:true,
    numRelearningSteps:1,
    chronology:OPTIMIZER_CHRONOLOGY,
    converterFixedUtcOffsetMinutes:OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,
    converterRolloverHour:OPTIMIZER_ROLLOVER_HOUR,
    runtimeLearningSteps:["1d"],
    runtimeRelearningSteps:["1d"],
    validationCandidateTrainedItems:split.trainCount,
    finalRetrainedOnAllEvidence:true
   }
  }
 };
}
