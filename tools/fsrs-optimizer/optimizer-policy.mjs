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

export function holdoutDiagnostics(stockEvaluation,personalizedEvaluation){
 const stock=metric(stockEvaluation,"stock"),personalized=metric(personalizedEvaluation,"personalized");
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

export function evaluateHoldoutGate(stockEvaluation,personalizedEvaluation,counts){
 const diagnostics=holdoutDiagnostics(stockEvaluation,personalizedEvaluation);
 const {stock,personalized}=diagnostics;
 const reasons=[];
 if(!Number.isSafeInteger(counts.trainCount)||counts.trainCount<MIN_TRAIN_ITEMS)
  reasons.push("historical training prefix has fewer than "+MIN_TRAIN_ITEMS+" optimizer items");
 if(!Number.isSafeInteger(counts.holdoutCount)||counts.holdoutCount<MIN_HOLDOUT_ITEMS)
  reasons.push("later holdout has fewer than "+MIN_HOLDOUT_ITEMS+" optimizer items");
 if(!Number.isSafeInteger(counts.holdoutCards)||counts.holdoutCards<MIN_HOLDOUT_CARDS)
  reasons.push("later holdout spans fewer than "+MIN_HOLDOUT_CARDS+" cards");
 if(diagnostics.logLossImprovement.absolute+Number.EPSILON<diagnostics.logLossImprovement.required)
  reasons.push("personalized holdout log loss improvement is below the practical minimum");
 if(diagnostics.calibration.status==="regressed")
  reasons.push("personalized holdout RMSE bins calibration regresses versus stock FSRS-7");
 return {passed:reasons.length===0,reasons,stock,personalized,diagnostics};
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
