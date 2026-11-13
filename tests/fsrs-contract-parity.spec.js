'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { createAppRuntime } = require('./helpers/runtime-harness');

(async () => {
  const root = path.resolve(__dirname, '..');
  const contractModule = await import(pathToFileURL(path.join(root, 'tools', 'fsrs-optimizer', 'optimizer-contract.mjs')).href);
  const canonical = contractModule.OPTIMIZER_CONTRACT;
  const { api } = createAppRuntime({
    globalName: '__RD_FSRS_CONTRACT_PARITY__',
    expose: ['FSRS_OPTIMIZER_CONTRACT'],
  });
  const browserContract = JSON.parse(JSON.stringify(api.FSRS_OPTIMIZER_CONTRACT));
  assert.deepEqual(browserContract, canonical, 'Browser FSRS optimizer contract drifted from canonical static contract');

  const policy = await import(pathToFileURL(path.join(root, 'tools', 'fsrs-optimizer', 'optimizer-policy.mjs')).href);
  assert.equal(policy.OPTIMIZER_CONTRACT, canonical, 'Optimizer tooling did not share the canonical static contract module');
  assert.equal(policy.HOLDOUT_SEGMENTS, canonical.holdoutSegments);
  assert.equal(policy.MIN_TRAIN_ITEMS, canonical.minimumTrainItems);
  assert.equal(policy.MIN_HOLDOUT_ITEMS, canonical.minimumHoldoutItems);
  assert.equal(policy.MIN_HOLDOUT_CARDS, canonical.minimumHoldoutCards);
  assert.equal(policy.MIN_ABSOLUTE_LOG_LOSS_IMPROVEMENT, canonical.minimumAbsoluteLogLossImprovement);
  assert.equal(policy.MIN_RELATIVE_LOG_LOSS_IMPROVEMENT, canonical.minimumRelativeLogLossImprovement);
  assert.equal(policy.CALIBRATION_EPSILON, canonical.calibrationEpsilon);
  assert.equal(policy.HOLDOUT_STRATEGY, canonical.holdoutStrategy);
  assert.equal(policy.OPTIMIZER_CHRONOLOGY, canonical.chronology);
  assert.equal(policy.OPTIMIZER_FIXED_UTC_OFFSET_MINUTES, canonical.converterFixedUtcOffsetMinutes);
  assert.equal(policy.OPTIMIZER_ROLLOVER_HOUR, canonical.converterRolloverHour);

  console.log('PASS FSRS optimizer contract exact parity');
})().catch((error) => { console.error(error); process.exitCode = 1; });
