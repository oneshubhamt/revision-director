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
  assert.deepEqual({
    holdoutSegments: policy.HOLDOUT_SEGMENTS,
    minimumTrainItems: policy.MIN_TRAIN_ITEMS,
    minimumHoldoutItems: policy.MIN_HOLDOUT_ITEMS,
    minimumHoldoutCards: policy.MIN_HOLDOUT_CARDS,
    minimumAbsoluteLogLossImprovement: policy.MIN_ABSOLUTE_LOG_LOSS_IMPROVEMENT,
    minimumRelativeLogLossImprovement: policy.MIN_RELATIVE_LOG_LOSS_IMPROVEMENT,
    calibrationEpsilon: policy.CALIBRATION_EPSILON,
    holdoutStrategy: policy.HOLDOUT_STRATEGY,
    chronology: policy.OPTIMIZER_CHRONOLOGY,
    converterFixedUtcOffsetMinutes: policy.OPTIMIZER_FIXED_UTC_OFFSET_MINUTES,
    converterRolloverHour: policy.OPTIMIZER_ROLLOVER_HOUR,
  }, {
    holdoutSegments: canonical.holdoutSegments,
    minimumTrainItems: canonical.minimumTrainItems,
    minimumHoldoutItems: canonical.minimumHoldoutItems,
    minimumHoldoutCards: canonical.minimumHoldoutCards,
    minimumAbsoluteLogLossImprovement: canonical.minimumAbsoluteLogLossImprovement,
    minimumRelativeLogLossImprovement: canonical.minimumRelativeLogLossImprovement,
    calibrationEpsilon: canonical.calibrationEpsilon,
    holdoutStrategy: canonical.holdoutStrategy,
    chronology: canonical.chronology,
    converterFixedUtcOffsetMinutes: canonical.converterFixedUtcOffsetMinutes,
    converterRolloverHour: canonical.converterRolloverHour,
  }, 'Optimizer policy exports drifted from the canonical contract');

  console.log('PASS FSRS optimizer contract exact parity');
})().catch((error) => { console.error(error); process.exitCode = 1; });
