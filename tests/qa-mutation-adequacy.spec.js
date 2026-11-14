'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT } = require('./helpers/runtime-harness');

// Faults are applied to the in-memory compiled app in isolated Node children.
// No production sources, generated artifacts or tracked files are rewritten.
const compiled = fs.readFileSync(path.join(ROOT, 'dist/app.js'), 'utf8');
const cases = [
  {
    name:'fsrs-retention-not-forwarded',
    before:'desiredRetention,\n          enableShortTerm: true',
    after:'desiredRetention: 0.76,\n          enableShortTerm: true',
    suite:'tests/fsrs-scheduler-reference.spec.js',
    signature:/FSRS|card|scheduler|upstream|parity/i,
  },
  {
    name:'planner-critical-risk-suppressed',
    before:'item.factors.dueRisk >= 0.85',
    after:'item.factors.dueRisk >= 1.01',
    suite:'tests/planner-properties.spec.js',
    signature:/critical|oracle|priority|selection/i,
  },
  {
    name:'recovery-revision-order-reversed',
    before:'a.revision > b.revision ? a : b',
    after:'a.revision < b.revision ? a : b',
    suite:'tests/scenarios/active-retrieval-persistence.js',
    signature:/precedence|recovery|revision|copy/i,
  },
  {
    name:'active-time-subtracted',
    before:'this.state.activeByPhase[this.state.currentPhase] += delta',
    after:'this.state.activeByPhase[this.state.currentPhase] -= delta',
    suite:'tests/scenarios/phase-time-runtime.js',
    signature:/time|duration|phase|canonical|invalid/i,
  },
  {
    name:'guarded-evidence-id-randomized',
    before:'eventId: commitGuard ? `evidence_${commitGuard.commitToken}` : uid("evidence")',
    after:'eventId: uid("evidence")',
    suite:'tests/fsrs-memory-lifecycle.spec.js',
    signature:/evidence|publication|commit|token|identity/i,
  },
];

const bootstrap = `
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(process.cwd(), 'dist/app.js');
const before = process.env.RD_MUTANT_BEFORE;
const after = process.env.RD_MUTANT_AFTER;
const original = fs.readFileSync;
let applied = 0;
fs.readFileSync = function (file, ...options) {
  const value = original.call(this, file, ...options);
  if (path.resolve(String(file)) !== target) return value;
  if (typeof value !== 'string' || value.split(before).length !== 2) {
    throw new Error('Mutation target was not unique in the runtime-loaded app');
  }
  applied += 1;
  return value.replace(before, after);
};
process.on('exit', () => {
  if (applied !== 1) process.stderr.write('Mutation bootstrap never exercised the app once\\n');
});
require(path.resolve(process.env.RD_MUTANT_SUITE));
`;

for (const probe of cases) {
  if (probe.before === probe.after || compiled.split(probe.before).length !== 2)
    throw new Error('Mutation target missing/ambiguous: ' + probe.name);
  const result = spawnSync(process.execPath, ['-e', bootstrap], {
    cwd: ROOT,
    env: {
      ...process.env,
      RD_MUTANT_BEFORE:probe.before,
      RD_MUTANT_AFTER:probe.after,
      RD_MUTANT_SUITE:probe.suite,
    },
    encoding:'utf8',
    timeout:20_000,
    maxBuffer:2_000_000,
  });
  const output = (result.stdout || '') + '\n' + (result.stderr || '');
  if (result.error || result.signal || result.status === 0 || !probe.signature.test(output)
    || /SyntaxError|MODULE_NOT_FOUND|Mutation target was not unique|bootstrap never exercised/.test(output)) {
    throw new Error('Mutation survived or failed for an unrelated reason: ' + probe.name
      + ' status=' + result.status + '\n' + output.slice(-1800));
  }
  console.log('MUTATION_KILLED ' + probe.name + ' by ' + probe.suite);
}

console.log('PASS ' + cases.length + ' isolated source-level fault mutations caught by independent Node witnesses');
