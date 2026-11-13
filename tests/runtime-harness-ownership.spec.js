'use strict';

const fs = require('fs');
const path = require('path');

const testsDir = __dirname;
const scenariosDir = path.join(testsDir, 'scenarios');
const files = [
  ...fs.readdirSync(testsDir)
    .filter((name) => name.endsWith('.spec.js') && name !== path.basename(__filename))
    .map((name) => ({label:name, file:path.join(testsDir,name)})),
  ...fs.readdirSync(scenariosDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({label:'scenarios/' + name, file:path.join(scenariosDir,name)})),
];

const directVm = [];
const directVendor = [];
for (const entry of files) {
  const source = fs.readFileSync(entry.file, 'utf8');
  if (source.includes('vm.createContext(')) directVm.push(entry.label);
  if (source.includes("vendor/ts-fsrs-6.0.0") || source.includes("vendor', 'ts-fsrs-6.0.0")) directVendor.push(entry.label);
}

if (directVm.length) throw new Error('Direct VM setup bypasses shared harness: ' + directVm.join(', '));
if (directVendor.length) throw new Error('Direct ts-fsrs vendor setup bypasses shared harness: ' + directVendor.join(', '));

console.log('PASS runtime harness boundary · ' + files.length + ' JavaScript QA files inspected');
