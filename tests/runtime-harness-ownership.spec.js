'use strict';

// Use esbuild's parsed import graph: TypeScript 7 has no legacy compiler API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const tests = __dirname;
const root = path.dirname(tests);
const harness = 'tests/helpers/runtime-harness.js';
const entries = [
  ...fs.readdirSync(tests).filter(name => name.endsWith('.spec.js') && name !== path.basename(__filename))
    .map(name => path.join(tests, name)),
  ...fs.readdirSync(path.join(tests, 'scenarios')).filter(name => name.endsWith('.js'))
    .map(name => path.join(tests, 'scenarios', name)),
  ...fs.readdirSync(path.join(tests, 'helpers')).filter(name => name.endsWith('.js'))
    .map(name => path.join(tests, 'helpers', name)),
];
const normalized = value => value.replace(/\\/g, '/');
const vendorModule = value => /(?:^|[/\\])vendor(?:[/\\]|$)/.test(value);
const vmModule = value => value === 'vm' || value === 'node:vm';
function graph(entryPoints, stdin) {
  return esbuild.buildSync({
    ...(stdin ? {stdin: {contents: stdin, resolveDir: tests, sourcefile: 'synthetic.js', loader: 'js'}}
      : {entryPoints}),
    bundle: true, platform: 'node', format: 'cjs', packages: 'external',
    external: ['./vendor/*'], absWorkingDir: root,
    outdir: path.join(root, 'build', 'qa-graph-unwritten'),
    write: false, metafile: true, logLevel: 'silent',
  }).metafile.inputs;
}
// Compare parsed string tokens, rather than source comments or incidental words.
function stringLiterals(source) {
  const literals = [];
  for (let i = 0; i < source.length;) {
    if (source[i] === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i + 2);
      if (i < 0) break;
    } else if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (source[i] === "'" || source[i] === '"' || source.charCodeAt(i) === 96) {
      const quote = source[i++];
      let value = '';
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        value += source[i++];
      }
      literals.push(value);
    } else i++;
  }
  return literals;
}
function explicitVendorFileReference(source) {
  const literals = stringLiterals(source);
  return literals.some(value => value.includes('ts-fsrs-6.0.0'))
    && literals.some(value => value === 'vendor' || vendorModule(value));
}
function forbiddenImports(inputs, label) {
  const violations = [];
  for (const [name, info] of Object.entries(inputs)) {
    if (normalized(name) === harness) continue;
    for (const dependency of info.imports) {
      if (vmModule(dependency.path)) violations.push(name + ': direct VM import');
      if (vendorModule(dependency.path)) violations.push(name + ': direct vendor import');
    }
  }
  assert.deepEqual(violations, [], label + ': bypassed canonical test harness');
}

// Negative and benign controls verify a real import graph, not source wording.
for (const [code, forbidden] of [
  ["const vm = require('node:vm'); vm.createContext({});", true],
  ["const {createContext}=require('vm'); createContext({});", true],
  ["const v=require('./vendor/fake.js');", true],
  ["const label='vm.createContext('; // inert text", false],
]) {
  const imports = Object.values(graph([], code)).flatMap(value => value.imports);
  assert.equal(imports.some(value => vmModule(value.path) || vendorModule(value.path)), forbidden,
    'Parsed import-graph control failed');
}
assert.ok(explicitVendorFileReference("const p=path.join(root,'vendor','ts-fsrs-6.0.0','index.umd.js');"),
  'Vendor file-path control did not detect direct access');
assert.ok(!explicitVendorFileReference("// 'vendor/ts-fsrs-6.0.0' is a comment\nconst x=1;"),
  'Comment produced false-positive vendor access');

const inputs = graph(entries);
for (const entry of entries) {
  const name = normalized(path.relative(root, entry));
  if (name !== harness) {
    assert.ok(!explicitVendorFileReference(fs.readFileSync(entry, 'utf8')),
      name + ': direct vendored runtime load');
  }
}
forbiddenImports(inputs, 'Node QA');
assert.ok(Object.hasOwn(inputs, harness), 'Canonical harness absent from parsed graph');
assert.ok(Object.values(inputs).some(info => info.imports.some(imp =>
  normalized(imp.path).endsWith('helpers/runtime-harness.js'))),
  'Node QA does not import its canonical runtime harness');
console.log('PASS parsed import-graph harness contract: ' + Object.keys(inputs).length + ' modules, 6 controls');
