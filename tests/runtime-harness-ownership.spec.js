'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const tests = __dirname;
const harness = path.join(tests, 'helpers/runtime-harness.js');
const modules = [
  ...fs.readdirSync(tests).filter(name => name.endsWith('.spec.js') && name !== path.basename(__filename))
    .map(name => path.join(tests, name)),
  ...fs.readdirSync(path.join(tests, 'scenarios')).filter(name => name.endsWith('.js'))
    .map(name => path.join(tests, 'scenarios', name)),
  ...fs.readdirSync(path.join(tests, 'helpers')).filter(name => name.endsWith('.js'))
    .map(name => path.join(tests, 'helpers', name)),
];

function analyze(source, label, allowHarness = false) {
  const ast = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, label + ': invalid JavaScript syntax');
  const references = [], literals = [], violations = [];
  const moduleSpecifier = node => node && ts.isStringLiteralLike(node) ? node.text : null;
  const record = spec => {
    references.push(spec);
    if (!allowHarness && /^(?:node:)?vm$/.test(spec)) violations.push('direct VM import');
    if (!allowHarness && /(?:^|[/\\])vendor(?:[/\\]|$)/.test(spec))
      violations.push('direct vendor import');
  };
  function visit(node) {
    if (ts.isStringLiteralLike(node)) literals.push(node.text);
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = moduleSpecifier(node.moduleSpecifier);
      if (spec !== null) record(spec);
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require'
          || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = node.arguments.length === 1 ? moduleSpecifier(node.arguments[0]) : null;
        if (spec !== null) record(spec);
      }
      if (!allowHarness && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'createContext')
        violations.push('independent VM context creation');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!allowHarness && literals.some(value => value.includes('ts-fsrs-6.0.0'))
      && literals.some(value => value === 'vendor' || /(?:^|[/\\])vendor(?:[/\\]|$)/.test(value)))
    violations.push('direct vendored scheduler file access');
  return {references, violations};
}

// Self-test: executable imports/calls fail; incidental words in strings do not.
for (const [sample, rejected] of [
  ["const vm=require('node:vm');vm.createContext({});", true],
  ["const {createContext}=require('vm');createContext({});", true],
  ["import vendor from './vendor/runtime.js';", true],
  ["const p=path.join(root,'vendor','ts-fsrs-6.0.0','index.umd.js');", true],
  ["const label='vm.createContext('; // inert explanation", false],
  ["const {createAppRuntime}=require('../helpers/runtime-harness');", false],
]) {
  assert.equal(analyze(sample, 'fixture.js').violations.length > 0, rejected,
    'AST architecture probe failed to distinguish behavior from syntax-shaped text');
}

const graph = new Map();
for (const file of modules) {
  const label = path.relative(tests, file);
  const parsed = analyze(fs.readFileSync(file, 'utf8'), label, file === harness);
  assert.deepEqual(parsed.violations, [], label + ': bypasses shared runtime harness');
  const imports = [];
  for (const name of parsed.references.filter(ref => ref.startsWith('.'))) {
    const candidatePath = path.resolve(path.dirname(file), name);
    const resolved = [candidatePath, candidatePath + '.js', candidatePath + '.mjs',
      path.join(candidatePath, 'index.js')].find(candidate =>
        fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    assert.ok(resolved, label + ': unresolved static import ' + name);
    imports.push(path.relative(tests, resolved));
  }
  graph.set(label, imports);
}
assert.ok(graph.has('helpers/runtime-harness.js'), 'Canonical harness missing from graph');
assert.ok([...graph.values()].some(imports => imports.includes('helpers/runtime-harness.js')),
  'No Node tests depend on canonical harness');
console.log('PASS AST/import-graph ownership boundary: ' + graph.size + ' files, 6 controls');
