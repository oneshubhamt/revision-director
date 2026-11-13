const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { performance } = require('perf_hooks');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_PASS4_VERIFY__ = { Rating, Reschedule, prepareFsrsScheduler, revisionSchedulerPort, memoryReviewObservationIndex, verifyMemoryDatasetIntegrityWithIndex, choosePlanItems };';
if (!source.includes('void boot();')) throw new Error('Boot marker missing');
source = source.replace('void boot();', hook);
const vendor = fs.readFileSync(path.join(root, 'vendor', 'ts-fsrs-6.0.0', 'index.umd.js'), 'utf8');
const context = { crypto:webcrypto, structuredClone, console, Date, Intl, URL, Blob, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set, Math, Number, String, Object, Array, JSON, Error, Promise, Int32Array, Uint8Array };
context.window=context; context.self=context; context.globalThis=context;
vm.createContext(context);
vm.runInContext(vendor, context, { filename:'ts-fsrs-6.0.0.umd.js' });
vm.runInContext(source, context, { filename:'app.js' });
const api=context.__RD_PASS4_VERIFY__;
if (!api) throw new Error('Pass 4 verification API unavailable');

const DAY_MS=86_400_000;
const CARD_COUNT=96;
const REVIEWS_PER_CARD=48;
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
    let successStreak=0;
    let failureCount=0;
    for(let reviewIndex=0;reviewIndex<templateReviews.length;reviewIndex+=1){
      const review=templateReviews[reviewIndex];
      if(review.rating>=api.Rating.Good) successStreak+=1; else successStreak=0;
      if(review.rating===api.Rating.Again) failureCount+=1;
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
    obligations.push({
      id:cardId,
      type:'memory-recall',
      policyState:{
        engine:'ts-fsrs',
        version:'6.0.0',
        stage:finalCard.state,
        successStreak,
        failureCount,
        lastIntervalDays:finalCard.scheduledDays,
        fsrsCard:clone(finalCard),
      },
    });
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

  assert.ok(indexMs<5000&&reversedIndexMs<5000,'Multi-year evidence indexing exceeded the regression envelope');
  assert.ok(forcedReplayMs<20000,'Multi-year forced replay exceeded the regression envelope');
  assert.ok(cachedRetrievabilityMs<5000,'Cached multi-year retrievability exceeded the regression envelope');

  console.log(
    `PASS Pass 4 scale/determinism: ${CARD_COUNT} cards × ${REVIEWS_PER_CARD} reviews = ${events.length} events, ${years.toFixed(1)}y/card | index ${indexMs.toFixed(1)}ms / reversed ${reversedIndexMs.toFixed(1)}ms | forced replay ${forcedReplayMs.toFixed(1)}ms | 3× cached retrievability ${cachedRetrievabilityMs.toFixed(1)}ms | replay calls ${replayCalls}`
  );
})().catch(error=>{console.error(error);process.exitCode=1;});
