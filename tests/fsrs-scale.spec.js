'use strict';
const assert = require('assert/strict');
const { performance } = require('perf_hooks');
const { createAppRuntime } = require('./helpers/runtime-harness');

const { api } = createAppRuntime({
  globalName: '__RD_FSRS_SCALE__',
  expose: ["Rating","Reschedule","prepareFsrsScheduler","revisionSchedulerPort","memoryReviewObservationIndex","verifyMemoryDatasetIntegrityWithIndex","choosePlanItems"],
  requireFsrs: true,
});

const DAY_MS=86_400_000;
const performanceMode = process.argv.includes('--performance');
const CARD_COUNT = performanceMode ? 96 : 20;
const REVIEWS_PER_CARD = performanceMode ? 48 : 12;
const fixed={kind:'fixed-retention',desiredRetention:.9};
const clone=value=>structuredClone(value);

(async()=>{
  await api.prepareFsrsScheduler(fixed);
  const scheduler=api.revisionSchedulerPort(fixed);
  const originalReschedule=api.Reschedule.prototype.reschedule;
  let replayCalls=0;
  api.Reschedule.prototype.reschedule=function(...args){
    replayCalls+=1;
    return originalReschedule.apply(this,args);
  };

  const start=Date.parse('2020-01-01T08:00:00.000Z');
  let card=scheduler.newCard(new Date(start).toISOString(),'template');
  const templateReviews=[];
  const ratings=[api.Rating.Good,api.Rating.Good,api.Rating.Hard,api.Rating.Easy];
  for(let index=0;index<REVIEWS_PER_CARD;index+=1){
    const reviewedAt=new Date(start+index*45*DAY_MS).toISOString();
    const rating=ratings[index%ratings.length];
    const before=clone(card);
    const result=scheduler.review(card,templateReviews,rating,new Date(reviewedAt));
    card=clone(result.card);
    templateReviews.push({
      evidenceEventId:`template-${index}`,
      reviewedAt,
      rating,
      source:'direct-memory',
      beforeCard:before,
      afterCard:clone(card),
      schedulerConfig:clone(scheduler.configuration),
      configFingerprint:scheduler.configuration.fingerprint,
    });
  }
  const years=(REVIEWS_PER_CARD-1)*45/365.25;
  replayCalls=0;

  const events=[];
  const obligations=[];
  for(let cardIndex=0;cardIndex<CARD_COUNT;cardIndex+=1){
    const cardId=`scale-card-${String(cardIndex).padStart(3,'0')}`;
    let finalCard;
    for(let reviewIndex=0;reviewIndex<templateReviews.length;reviewIndex+=1){
      const review=templateReviews[reviewIndex];
      const before={...clone(review.beforeCard),cardId};
      const after={...clone(review.afterCard),cardId};
      finalCard=after;
      events.push({
        id:`scale-event-${String(cardIndex).padStart(3,'0')}-${String(reviewIndex).padStart(2,'0')}`,
        obligationId:cardId,
        obligationType:'memory-recall',
        reviewedAt:review.reviewedAt,
        confirmedRating:review.rating,
        beforePolicyState:{fsrsCard:before},
        afterPolicyState:{fsrsCard:after},
        schedulerConfig:clone(scheduler.configuration),
      });
    }
    obligations.push({id:cardId,type:'memory-recall',policyState:{fsrsCard:clone(finalCard)}});
  }

  const indexStart=performance.now();
  const chronologicalIndex=api.memoryReviewObservationIndex(events);
  const indexMs=performance.now()-indexStart;
  const reversedStart=performance.now();
  const reversedIndex=api.memoryReviewObservationIndex([...events].reverse());
  const reversedIndexMs=performance.now()-reversedStart;

  assert.equal(chronologicalIndex.size,CARD_COUNT);
  assert.equal(reversedIndex.size,CARD_COUNT);
  const keys=[...chronologicalIndex.keys()].sort();
  assert.deepEqual(keys,[...reversedIndex.keys()].sort());
  for(const key of keys){
    const left=chronologicalIndex.get(key);
    const right=reversedIndex.get(key);
    assert.equal(left.length,REVIEWS_PER_CARD);
    assert.deepEqual(
      left.map(review=>[review.evidenceEventId,review.reviewedAt,review.rating,review.configFingerprint]),
      right.map(review=>[review.evidenceEventId,review.reviewedAt,review.rating,review.configFingerprint]),
      'Evidence indexing must normalize input order deterministically'
    );
  }

  const forcedStart=performance.now();
  await api.verifyMemoryDatasetIntegrityWithIndex(obligations,chronologicalIndex,fixed,null);
  const forcedReplayMs=performance.now()-forcedStart;
  assert.equal(replayCalls,CARD_COUNT,'Integrity verification must independently replay every reviewed memory exactly once');

  const replayCallsAfterIntegrity=replayCalls;
  const cachedStart=performance.now();
  for(let pass=0;pass<3;pass+=1){
    for(const obligation of obligations){
      const reviews=chronologicalIndex.get(obligation.id);
      const value=scheduler.retrievability(obligation.policyState.fsrsCard,reviews,new Date('2026-01-01T08:00:00.000Z'));
      assert.ok(Number.isFinite(value)&&value>=0&&value<=1,'Cached retrievability must remain a valid probability');
    }
  }
  const cachedRetrievabilityMs=performance.now()-cachedStart;
  assert.equal(replayCalls,replayCallsAfterIntegrity,'Repeated retrievability must reuse replay verification instead of replaying unchanged history');

  const first=obligations[0];
  scheduler.verifyProjection(first.policyState.fsrsCard,chronologicalIndex.get(first.id),true);
  assert.equal(replayCalls,replayCallsAfterIntegrity+1,'Forced trust-boundary verification must bypass the replay cache');

  const deterministicA=scheduler.reschedule(templateReviews[0].beforeCard,templateReviews);
  const deterministicB=scheduler.reschedule(templateReviews[0].beforeCard,templateReviews);
  assert.deepEqual(deterministicA,deterministicB,'Identical canonical history must produce identical FSRS materialization');

  const candidate=id=>({
    joined:{
      obligation:{id,type:'concept-reconstruction',dueAt:'2026-01-01T04:00:00.000Z',expectedMinutes:10,workflow:{kind:'reconstruction'}},
      unit:{id:`unit-${id}`},
      profile:{id:'profile'},
      subject:'Subject',section:'Section',topic:'Topic'
    },
    score:80,
    dueState:'due',
    executionMinutes:10,
    factors:{dueRisk:.8,examImportance:.8,weakness:.5,reviewDuration:.8,examinationProximity:.5,weeklyBalance:.5}
  });
  const tied=['zeta','alpha','mu','beta'].map(candidate);
  const packedForward=api.choosePlanItems(tied,20);
  const packedReverse=api.choosePlanItems([...tied].reverse(),20);
  assert.deepEqual(
    packedForward.selected.map(item=>item.joined.obligation.id),
    packedReverse.selected.map(item=>item.joined.obligation.id),
    'Planner tie resolution must be independent of repository/input order'
  );
  assert.deepEqual(
    packedForward.deferred.map(item=>item.joined.obligation.id),
    packedReverse.deferred.map(item=>item.joined.obligation.id),
    'Planner deferral order must be deterministic'
  );

  if (performanceMode) {
    assert.ok(indexMs<5000&&reversedIndexMs<5000,'Multi-year evidence indexing exceeded the regression envelope');
    assert.ok(forcedReplayMs<20000,'Multi-year forced replay exceeded the regression envelope');
    assert.ok(cachedRetrievabilityMs<5000,'Cached multi-year retrievability exceeded the regression envelope');
  }

  console.log(
    `PASS ${performanceMode ? 'performance' : 'core'} scale/determinism: ${CARD_COUNT} cards × ${REVIEWS_PER_CARD} reviews = ${events.length} events, ${years.toFixed(1)}y/card | index ${indexMs.toFixed(1)}ms / reversed ${reversedIndexMs.toFixed(1)}ms | forced replay ${forcedReplayMs.toFixed(1)}ms | 3× cached retrievability ${cachedRetrievabilityMs.toFixed(1)}ms | replay calls ${replayCalls}`
  );
})().catch(error=>{console.error(error);process.exitCode=1;});
