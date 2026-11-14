'use strict';
const { createAppRuntime, memoryLocalStorage } = require('../helpers/runtime-harness');

const storage = memoryLocalStorage();
const memory = storage.values;
const { api, context } = createAppRuntime({
  globalName: '__RD_C1_TEST__',
  expose: ["PRESENTATION_KERNEL"],
  context: { localStorage: storage.api },
});

let checks = 0;
function check(value, message) { checks += 1; if (!value) throw new Error(message); }

const kernel = api.PRESENTATION_KERNEL;
check(kernel.format === 'revision-director.presentation-kernel' && kernel.version === 1, 'Kernel identity is wrong');
check(Object.isFrozen(kernel) && Object.isFrozen(kernel.manifest), 'Kernel or manifest is mutable');
check(kernel.manifest.format === 'revision-director.presentation-manifest' && kernel.manifest.version === 1, 'Manifest identity is wrong');
check(kernel.manifest.defaults.presentation === 'revision-current', 'Default presentation changed');
check(kernel.manifest.profiles['revision-current'].immutable === true, 'Default presentation is not immutable');
check(kernel.manifest.invariants.exactPixelReference === 'revision-current', 'Pixel reference changed');
check(kernel.manifest.tokens.namespace === '--rd-' && kernel.manifest.tokens.contractVersion === 1, 'Token contract is wrong');
const publicTokens = kernel.manifest.tokens.public;
const requiredTokens = {
  foundation: ['--rd-color-canvas', '--rd-color-text-primary', '--rd-color-border-soft'],
  typography: ['--rd-font-body', '--rd-font-display'],
  surfaces: ['--rd-surface-neutral', '--rd-shadow-floating'],
  geometry: ['--rd-radius-default', '--rd-touch-target-minimum', '--rd-safe-area-bottom'],
  motion: ['--rd-motion-standard'],
  charts: ['--rd-chart-primary', '--rd-chart-success'],
};
check(Object.entries(requiredTokens).every(([group, tokens]) =>
  Array.isArray(publicTokens[group]) && tokens.every(token => publicTokens[group].includes(token))),
  'Required semantic token families or their concrete roles are missing');
const declaredTokens = Object.values(publicTokens).flat();
check(declaredTokens.every(token => typeof token === 'string' && token.startsWith('--rd-'))
  && new Set(declaredTokens).size === declaredTokens.length,
  'Semantic token names are invalid or duplicated');
check(kernel.listPresentations().length === 1 && Object.isFrozen(kernel.listPresentations()), 'Built-in presentation registry is wrong');
check(kernel.normalizePresentationId('revision-current') === 'revision-current', 'Default presentation normalization failed');
check(kernel.normalizePresentationId('unknown-pack') === 'revision-current', 'Unknown presentation did not fall back');
check(kernel.registerPresentation({...kernel.manifest.profiles['revision-current']}) === true, 'Identical immutable default registration should be idempotent');
check(kernel.registerPresentation({...kernel.manifest.profiles['revision-current'], label:'Replacement'}) === false, 'Immutable default was replaceable');

const future = {
  id:'future-pack', label:'Future Pack', contractVersion:1,
  typography:'future-type', shape:'future-shape', material:'future-material', depth:'future-depth',
  density:'future-density', responsive:'future-responsive', motion:'future-motion', charts:'future-charts', immutable:false,
};
check(kernel.registerPresentation(future) === true, 'Valid future presentation could not register');
check(kernel.listPresentations().length === 2, 'Registered presentation is missing');
check(kernel.switchPresentation('future-pack') === 'future-pack', 'Registered presentation did not activate');
check(kernel.activePresentationId() === 'future-pack', 'Active presentation identity is wrong');
check(kernel.switchPresentation('missing-pack') === 'revision-current', 'Unknown switch did not fall back');
check(kernel.switchPresentation('future-pack', {persist:true}) === 'future-pack', 'Persisted switch failed');
check(memory.get(kernel.manifest.storageKey) === 'future-pack', 'Presentation preference was not persisted');
check(kernel.readStoredPresentation() === 'future-pack', 'Stored presentation was not read');
check(kernel.validatePublicTokens() === true, 'Headless token validation should remain test-safe');
check(!Object.keys(context).includes('RevisionDirectorPresentation'), 'Presentation kernel leaked a named public global');

console.log(`PASS ${checks} presentation presentation-kernel checks`);
