'use strict';

const fs = require('fs');
const path = require('path');

const testsDir = __dirname;
const specs = fs.readdirSync(testsDir).filter((name) => name.endsWith('.spec.js'));
const directVm = [];
const directVendor = [];
let harnessUsers = 0;

for (const name of specs) {
  if (name === path.basename(__filename)) continue;
  const source = fs.readFileSync(path.join(testsDir, name), 'utf8');
  if (source.includes("require('./helpers/runtime-harness')")) harnessUsers += 1;
  if (source.includes('vm.createContext(')) directVm.push(name);
  if (source.includes("vendor/ts-fsrs-6.0.0") || source.includes("vendor', 'ts-fsrs-6.0.0")) directVendor.push(name);
}

if (directVm.length) throw new Error(`Direct VM setup bypasses shared harness: ${directVm.join(', ')}`);
if (directVendor.length) throw new Error(`Direct ts-fsrs vendor setup bypasses shared harness: ${directVendor.join(', ')}`);
if (harnessUsers < 15) throw new Error(`Shared runtime harness adoption unexpectedly low: ${harnessUsers}`);

const helper = fs.readFileSync(path.join(testsDir, 'helpers', 'runtime-harness.js'), 'utf8');
for (const required of ['function createAppRuntime', 'function createVendorRuntime', 'function memoryLocalStorage', "const BOOT_MARKER = 'void boot();'"]) {
  if (!helper.includes(required)) throw new Error(`Runtime harness contract missing: ${required}`);
}

console.log(`PASS shared runtime harness ownership · ${harnessUsers} test files`);
