'use strict';

const { createAppRuntime, createVendorRuntime } = require('./helpers/runtime-harness');
const { mulberry32, integer } = require('./helpers/seeded');

const { api } = createAppRuntime({
  globalName: '__RD_FSRS_REFERENCE_PARITY__',
  expose: ['prepareFsrsScheduler','revisionSchedulerPort','fsrsBaseSchedulerOptions','Rating'],
  requireFsrs: true,
});
const vendor = createVendorRuntime();
const upstream = vendor.FSRS;

let checks = 0;
function check(value, message) { checks += 1; if (!value) throw new Error(message); }

function serialize(card) {
  const value = {
    model:'FSRS-7', cardId:card.cardId, dueAt:card.dueAt.toISOString(),
    stability:card.stability, stabilityFast:card.stabilityFast, difficulty:card.difficulty,
    scheduledDays:card.scheduledDays, learningStep:card.learningStep, reps:card.reps, lapses:card.lapses,
    state:card.state, scheduleStatus:card.scheduleStatus,
  };
  if (card.lastReviewAt) value.lastReviewAt = card.lastReviewAt.toISOString();
  return value;
}

function upstreamGrade(rating) {
  if (rating === api.Rating.Again) return upstream.Rating.Again;
  if (rating === api.Rating.Hard) return upstream.Rating.Hard;
  if (rating === api.Rating.Good) return upstream.Rating.Good;
  return upstream.Rating.Easy;
}

function observation(index, beforeCard, afterCard, rating, reviewedAt, configuration) {
  return {
    evidenceEventId:'parity-' + index, reviewedAt:reviewedAt.toISOString(), rating, source:'direct-memory',
    beforeCard:structuredClone(beforeCard), afterCard:structuredClone(afterCard),
    schedulerConfig:structuredClone(configuration), configFingerprint:configuration.fingerprint,
  };
}

async function referenceScheduler() {
  const options = JSON.parse(JSON.stringify(api.fsrsBaseSchedulerOptions(0.9)));
  return upstream.DefaultScheduler(options);
}

async function explicitTransitionBoundary() {
  const policy = {kind:'fixed-retention',desiredRetention:0.9};
  await api.prepareFsrsScheduler(policy);
  const port = api.revisionSchedulerPort(policy);
  const direct = await referenceScheduler();
  const start = new Date('2026-01-01T08:00:00.000Z');

  let appCard = port.newCard(start.toISOString(), 'transition-boundary');
  let upstreamCard = direct.newCard({now:start,cardId:'transition-boundary'});
  check(appCard.state === 0 && appCard.state === upstreamCard.state, 'Fresh card must match upstream New state');

  const first = port.review(appCard, [], api.Rating.Again, start);
  const firstReference = direct.review({card:upstreamCard,grade:upstream.Rating.Again,now:start});
  check(JSON.stringify(first.card) === JSON.stringify(serialize(firstReference.card)), 'New-state Again transition diverged from upstream');
  check(first.card.state !== 0, 'Again must leave the New state');

  const firstObservation = observation(0, appCard, first.card, api.Rating.Again, start, port.configuration);
  const secondAt = new Date(first.card.dueAt);
  const second = port.review(first.card, [firstObservation], api.Rating.Good, secondAt);
  const secondReference = direct.review({card:firstReference.card,grade:upstream.Rating.Good,now:secondAt});
  check(JSON.stringify(second.card) === JSON.stringify(serialize(secondReference.card)), 'Learning-boundary Good transition diverged from upstream');
  check(second.card.state === 2 && second.card.state === secondReference.card.state, 'Successful learning boundary must reach upstream Review state');
}

async function seededParity() {
  const policy = {kind:'fixed-retention',desiredRetention:0.9};
  await api.prepareFsrsScheduler(policy);
  const port = api.revisionSchedulerPort(policy);
  const SEQUENCES = 12;
  const REVIEWS = 18;

  for (let sequence = 0; sequence < SEQUENCES; sequence += 1) {
    const random = mulberry32(0x5F3759DF ^ sequence);
    const direct = await referenceScheduler();
    const start = new Date(Date.UTC(2026, sequence % 6, 1 + sequence, 8, 0, 0));
    const cardId = 'reference-sequence-' + sequence;
    let appCard = port.newCard(start.toISOString(), cardId);
    let upstreamCard = direct.newCard({now:start,cardId});
    let history = [];
    check(JSON.stringify(appCard) === JSON.stringify(serialize(upstreamCard)), 'Sequence ' + sequence + ': new-card projection diverged');

    for (let index = 0; index < REVIEWS; index += 1) {
      const due = Date.parse(appCard.dueAt);
      const last = appCard.lastReviewAt ? Date.parse(appCard.lastReviewAt) : start.getTime();
      const reviewedAt = new Date(Math.max(due, last + 3600000) + integer(random,0,36) * 3600000);
      const rating = integer(random,1,4);

      const appResult = port.review(appCard, history, rating, reviewedAt);
      const referenceResult = direct.review({card:upstreamCard,grade:upstreamGrade(rating),now:reviewedAt});
      const referenceCard = serialize(referenceResult.card);
      check(JSON.stringify(appResult.card) === JSON.stringify(referenceCard), 'Sequence ' + sequence + ' review ' + index + ': card diverged from upstream');

      const nextObservation = observation(history.length, appCard, appResult.card, rating, reviewedAt, port.configuration);
      history = history.concat([nextObservation]);
      port.verifyProjection(appResult.card, history, true); checks += 1;

      const replayed = port.reschedule(history[0].beforeCard, history);
      check(JSON.stringify(replayed) === JSON.stringify(appResult.card), 'Sequence ' + sequence + ' review ' + index + ': replay diverged from materialized state');

      const previewAt = new Date(reviewedAt.getTime() + integer(random,0,12) * 3600000);
      const appPreview = port.preview(appResult.card, history, previewAt).map((value) => ({rating:value.rating,dueAt:value.dueAt}));
      const referencePreview = direct.preview({card:referenceResult.card,now:previewAt})
        .map((value) => ({rating:value.grade,dueAt:value.card.dueAt.toISOString()}))
        .sort((left,right) => left.rating - right.rating);
      check(JSON.stringify(appPreview) === JSON.stringify(referencePreview), 'Sequence ' + sequence + ' review ' + index + ': preview diverged from upstream');

      const retrievalAt = new Date(reviewedAt.getTime() + integer(random,1,48) * 3600000);
      const elapsed = Math.max(0, direct.chrono.difference(reviewedAt, retrievalAt));
      const directRetrievability = Number(direct.model.forgettingCurve({
        stability:referenceResult.card.stability, stabilityFast:referenceResult.card.stabilityFast, difficulty:referenceResult.card.difficulty,
      }, elapsed));
      const appRetrievability = port.retrievability(appResult.card, history, retrievalAt);
      check(typeof appRetrievability === 'number' && Math.abs(appRetrievability-directRetrievability) < 1e-12, 'Sequence ' + sequence + ' review ' + index + ': retrievability diverged from upstream');

      appCard = appResult.card;
      upstreamCard = referenceResult.card;
    }
  }
  console.log('PASS ' + checks + ' upstream FSRS reference/parity checks across ' + SEQUENCES + ' seeded sequences');
}

(async () => {
  await explicitTransitionBoundary();
  await seededParity();
})().catch((error) => { console.error(error); process.exitCode = 1; });
