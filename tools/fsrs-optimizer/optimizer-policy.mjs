export const HOLDOUT_SEGMENTS=6;
export const MIN_TRAIN_ITEMS=64;
export const MIN_HOLDOUT_ITEMS=64;
export const MIN_HOLDOUT_CARDS=16;
export const MIN_ABSOLUTE_LOG_LOSS_IMPROVEMENT=0.001;
export const MIN_RELATIVE_LOG_LOSS_IMPROVEMENT=0.005;
export const CALIBRATION_EPSILON=1e-9;
export const HOLDOUT_STRATEGY="final-sixth";
export const OPTIMIZER_CHRONOLOGY="elapsed-24h";
export const OPTIMIZER_FIXED_UTC_OFFSET_MINUTES=0;
export const OPTIMIZER_ROLLOVER_HOUR=0;

const metric=(value,name)=>{
 if(!value||typeof value!=="object"||!Number.isFinite(value.logLoss)||value.logLoss<0||
   !Number.isFinite(value.rmseBins)||value.rmseBins<0)throw Error("Invalid "+name+" evaluation metrics");
 return {logLoss:value.logLoss,rmseBins:value.rmseBins};
};

export function holdoutDiagnostics(referenceEvaluation,candidateEvaluation){
 const stock=metric(referenceEvaluation,"reference"),personalized=metric(candidateEvaluation,"candidate");
 const absolute=stock.logLoss-personalized.logLoss;
 const relative=stock.logLoss>0?absolute/stock.logLoss:0;
 const required=Math.max(MIN_ABSOLUTE_LOG_LOSS_IMPROVEMENT,stock.logLoss*MIN_RELATIVE_LOG_LOSS_IMPROVEMENT);
 const delta=personalized.rmseBins-stock.rmseBins;
 const relativeDelta=stock.rmseBins>0?delta/stock.rmseBins:delta===0?0:Number.POSITIVE_INFINITY;
 const calibrationStatus=delta<-CALIBRATION_EPSILON?"improved":Math.abs(delta)<=CALIBRATION_EPSILON?"unchanged":"regressed";
 return {
  stock,personalized,
  logLossImprovement:{absolute,relative,required},
  calibration:{metric:"rmse-bins",delta,relativeDelta,status:calibrationStatus}
 };
}

export function splitChronologicalHoldout(items,cardIds){
 if(!Array.isArray(items)||!Array.isArray(cardIds)||items.length!==cardIds.length)
  throw Error("Items and card IDs must be aligned arrays");
 const segmentSize=Math.floor(items.length/HOLDOUT_SEGMENTS);
 if(segmentSize<1)throw Error("Not enough optimizer items for chronological holdout");
 const trainEnd=(HOLDOUT_SEGMENTS-1)*segmentSize;
 const holdoutIds=cardIds.slice(trainEnd);
 return {
  trainItems:items.slice(0,trainEnd),trainCardIds:cardIds.slice(0,trainEnd),
  holdoutItems:items.slice(trainEnd),holdoutCardIds:holdoutIds,
  trainCount:trainEnd,holdoutCount:items.length-trainEnd,
  holdoutCards:new Set(holdoutIds).size
 };
}

const improvementReasons=(diagnostics,label)=>{
 const reasons=[];
 if(diagnostics.logLossImprovement.absolute+Number.EPSILON<diagnostics.logLossImprovement.required)
  reasons.push("candidate holdout log loss improvement versus "+label+" is below the practical minimum");
 if(diagnostics.calibration.status==="regressed")
  reasons.push("candidate holdout RMSE bins calibration regresses versus "+label);
 return reasons;
};

export function evaluateHoldoutGate(stockEvaluation,personalizedEvaluation,counts,incumbentComparison=null){
 const diagnostics=holdoutDiagnostics(stockEvaluation,personalizedEvaluation);
 const {stock,personalized}=diagnostics;
 const reasons=[];
 if(!Number.isSafeInteger(counts.trainCount)||counts.trainCount<MIN_TRAIN_ITEMS)
  reasons.push("historical training prefix has fewer than "+MIN_TRAIN_ITEMS+" optimizer items");
 if(!Number.isSafeInteger(counts.holdoutCount)||counts.holdoutCount<MIN_HOLDOUT_ITEMS)
  reasons.push("later holdout has fewer than "+MIN_HOLDOUT_ITEMS+" optimizer items");
 if(!Number.isSafeInteger(counts.holdoutCards)||counts.holdoutCards<MIN_HOLDOUT_CARDS)
  reasons.push("later holdout spans fewer than "+MIN_HOLDOUT_CARDS+" cards");
 reasons.push(...improvementReasons(diagnostics,"stock FSRS-7"));

 let incumbent;
 if(incumbentComparison!==null){
  if(!incumbentComparison||typeof incumbentComparison!=="object")throw Error("Invalid incumbent comparison");
  if(typeof incumbentComparison.sourceSha256!=="string"||!/^[a-f0-9]{64}$/.test(incumbentComparison.sourceSha256))
   throw Error("Invalid incumbent profile source checksum");
  if(typeof incumbentComparison.weightsFingerprint!=="string"||!/^fnv1a64:[0-9a-f]{16}$/.test(incumbentComparison.weightsFingerprint))
   throw Error("Invalid incumbent weights fingerprint");
  const metrics=metric(incumbentComparison.metrics,"incumbent");
  const incumbentDiagnostics=holdoutDiagnostics(metrics,personalized);
  reasons.push(...improvementReasons(incumbentDiagnostics,"active personalized profile"));
  incumbent={
   sourceSha256:incumbentComparison.sourceSha256,
   weightsFingerprint:incumbentComparison.weightsFingerprint,
   metrics
  };
 }
 return {passed:reasons.length===0,reasons,stock,personalized,diagnostics,...(incumbent?{incumbent}:{})};
}

export function assertChronologicalCsv(csv){
 const lines=csv.split(/\r?\n/).filter(Boolean);
 if(lines[0]!=="review_time,card_id,review_rating,review_duration,review_state")
  throw Error("Unexpected optimizer CSV header");
 let previous=Number.NEGATIVE_INFINITY;
 for(let index=1;index<lines.length;index++){
  const raw=lines[index].slice(0,lines[index].indexOf(","));
  const timestamp=Number(raw);
  if(!Number.isFinite(timestamp)||timestamp<previous)
   throw Error("Optimizer CSV must be globally chronological");
  previous=timestamp;
 }
 return Math.max(0,lines.length-1);
}
