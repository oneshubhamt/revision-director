const assert=require("node:assert/strict");

(async()=>{
 const policy=await import("../tools/fsrs-optimizer/optimizer-policy.mjs");
 const items=Array.from({length:384},(_,index)=>({index}));
 const cardIds=items.map((_,index)=>"card-"+Math.floor(index/4));
 const split=policy.splitChronologicalHoldout(items,cardIds);
 assert.equal(split.trainCount,320);
 assert.equal(split.holdoutCount,64);
 assert.equal(split.holdoutCards,16);
 assert.deepEqual(split.trainItems.map(x=>x.index),Array.from({length:320},(_,i)=>i));
 assert.deepEqual(split.holdoutItems.map(x=>x.index),Array.from({length:64},(_,i)=>i+320));

 const passed=policy.evaluateHoldoutGate(
  {logLoss:.42,rmseBins:.08},{logLoss:.40,rmseBins:.08},split);
 assert.equal(passed.passed,true);
 assert.deepEqual(passed.reasons,[]);
 assert.ok(Math.abs(passed.diagnostics.logLossImprovement.absolute-.02)<1e-12);
 assert.ok(passed.diagnostics.logLossImprovement.relative>.04);
 assert.equal(passed.diagnostics.calibration.status,"unchanged");
 const microscopic=policy.evaluateHoldoutGate(
  {logLoss:.42,rmseBins:.08},{logLoss:.4195,rmseBins:.079},split);
 assert.equal(microscopic.passed,false);
 assert.ok(microscopic.reasons.some(reason=>reason.includes("practical minimum")));
 const calibrated=policy.holdoutDiagnostics(
  {logLoss:.42,rmseBins:.08},{logLoss:.40,rmseBins:.07});
 assert.equal(calibrated.calibration.status,"improved");
 assert.ok(calibrated.calibration.delta<0);
 assert.equal(policy.evaluateHoldoutGate(
  {logLoss:.42,rmseBins:.08},{logLoss:.43,rmseBins:.07},split).passed,false);
 assert.equal(policy.evaluateHoldoutGate(
  {logLoss:.42,rmseBins:.08},{logLoss:.40,rmseBins:.081},split).passed,false);
 assert.equal(policy.evaluateHoldoutGate(
  {logLoss:.42,rmseBins:.08},{logLoss:.40,rmseBins:.08},
  {...split,holdoutCards:15}).passed,false);

 const csv=[
  "review_time,card_id,review_rating,review_duration,review_state",
  '1000,"a",3,500,0','2000,"b",3,400,0','2000,"a",1,300,2'
 ].join("\n")+"\n";
 assert.equal(policy.assertChronologicalCsv(csv),3);
 assert.throws(()=>policy.assertChronologicalCsv(
  "review_time,card_id,review_rating,review_duration,review_state\n2000,a,3,1,0\n1000,b,3,1,0\n"),
  /chronological/);
 console.log("PASS 19 FSRS optimizer policy checks");
})().catch(error=>{console.error(error);process.exitCode=1;});
