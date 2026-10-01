'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'dist', 'app.js'), 'utf8');
const hook = 'window.__RD_C1_TEST__ = { APP_VERSION, PRESENTATION_KERNEL };';
if (!source.includes('void boot();')) throw new Error('Boot marker missing');
source = source.replace('void boot();', hook);
const vendor = fs.readFileSync(path.join(root, 'vendor', 'ts-fsrs-5.4.1', 'index.umd.js'), 'utf8');
const memory = new Map();
const localStorage = {
  getItem: key => memory.has(String(key)) ? memory.get(String(key)) : null,
  setItem: (key, value) => memory.set(String(key), String(value)),
  removeItem: key => memory.delete(String(key)),
};
const context = {
  crypto: webcrypto, structuredClone, console, Date, Intl, URL, Blob,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Map, Set, Math, Number, String, Object, Array, JSON, Error, Promise,
  Int32Array, Uint8Array, localStorage, navigator: {},
};
context.window = context; context.self = context; context.globalThis = context;
vm.createContext(context); vm.runInContext(vendor, context); vm.runInContext(source, context);
const api = context.__RD_C1_TEST__;
let checks = 0;
function check(value, message) { checks += 1; if (!value) throw new Error(message); }

check(api.APP_VERSION === 'va7.1-pass-e1', 'Pass C1 identity is wrong');
const kernel = api.PRESENTATION_KERNEL;
check(kernel.format === 'revision-director.presentation-kernel' && kernel.version === 1, 'Kernel identity is wrong');
check(Object.isFrozen(kernel) && Object.isFrozen(kernel.manifest), 'Kernel or manifest is mutable');
check(kernel.manifest.format === 'revision-director.presentation-manifest' && kernel.manifest.version === 1, 'Manifest identity is wrong');
check(kernel.manifest.defaults.presentation === 'revision-current', 'Default presentation changed');
check(kernel.manifest.profiles['revision-current'].immutable === true, 'Default presentation is not immutable');
check(kernel.manifest.invariants.exactPixelReference === 'revision-current', 'Pixel reference changed');
check(kernel.manifest.tokens.namespace === '--rd-' && kernel.manifest.tokens.contractVersion === 1, 'Token contract is wrong');
check(Object.values(kernel.manifest.tokens.public).flat().length >= 35, 'Semantic token contract is unexpectedly small');
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

console.log(`PASS ${checks} Pass C1 presentation-kernel checks`);
