'use strict';

const { createAppRuntime } = require('./helpers/runtime-harness');
const { mulberry32, integer, shuffle } = require('./helpers/seeded');

const { api } = createAppRuntime({
  globalName: '__RD_PLANNER_PROPERTIES__',
  expose: ['choosePlanItems'],
});

let checks = 0;
function check(value, message) { checks += 1; if (!value) throw new Error(message); }

const BASE_DUE = Date.parse('2026-07-25T04:00:00.000Z');

function item(id, score, minutes, options = {}) {
  const type = options.type || 'concept-reconstruction';
  const dueState = options.dueState || 'due';
  const dueRisk = options.dueRisk === undefined ? 0.6 : options.dueRisk;
  const dueAt = options.dueAt || new Date(BASE_DUE).toISOString();
  return {
    joined: { obligation: { id, type, dueAt, expectedMinutes: minutes }, unit: {}, profile: {} },
    score, dueState, executionMinutes: minutes,
    factors: { dueRisk, examImportance:0.7, weakness:0.5, reviewDuration:0.8, examinationProximity:0.5, weeklyBalance:0.5 },
  };
}

function duration(value) { return Math.max(1, Math.ceil(value.executionMinutes || value.joined.obligation.expectedMinutes)); }
function scoreValue(value) { return Math.max(1, Math.round(value.score * 100)); }
function critical(value) { return value.joined.obligation.type === 'relearn' || (value.dueState === 'overdue' && value.factors.dueRisk >= 0.85); }
function key(value) { return value.joined.obligation.id; }

function bruteForce(items, capacity) {
  let bestValue = 0;
  let bestUsed = 0;
  const limit = 1 << items.length;
  for (let mask = 0; mask < limit; mask += 1) {
    let used = 0; let value = 0;
    for (let index = 0; index < items.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      used += duration(items[index]); value += scoreValue(items[index]);
    }
    if (used > capacity) continue;
    if (value > bestValue || (value === bestValue && used < bestUsed)) { bestValue = value; bestUsed = used; }
  }
  return { value: bestValue, used: bestUsed };
}

function selectedObjective(items) {
  return { value: items.reduce((sum, value) => sum + scoreValue(value), 0), used: items.reduce((sum, value) => sum + duration(value), 0) };
}

function canonicalResult(result) {
  return { selected:result.selected.map(key), requiredOverrun:result.requiredOverrun.map(key), mustSplit:result.mustSplit.map(key), deferred:result.deferred.map(key) };
}

function assertPartition(candidates, result, label) {
  const selected = new Set(result.selected.map(key));
  const split = new Set(result.mustSplit.map(key));
  const deferred = new Set(result.deferred.map(key));
  check(selected.size === result.selected.length, label + ': duplicate selected item');
  check(split.size === result.mustSplit.length, label + ': duplicate must-split item');
  check(deferred.size === result.deferred.length, label + ': duplicate deferred item');
  check([...selected].every((id) => !split.has(id) && !deferred.has(id)), label + ': selected overlaps another disposition');
  check([...split].every((id) => !deferred.has(id)), label + ': must-split overlaps deferred');
  const union = new Set([...selected, ...split, ...deferred]);
  check(union.size === candidates.length && candidates.every((value) => union.has(key(value))), label + ': disposition partition lost an item');
  check(result.requiredOverrun.every((value) => selected.has(key(value))), label + ': required overrun is not selected');
}

check(JSON.stringify(api.choosePlanItems([], 60)) === JSON.stringify({selected:[],requiredOverrun:[],mustSplit:[],deferred:[]}), 'Empty planning input must stay empty');

let result = api.choosePlanItems([item('a',90,40), item('b',80,20)], 60);
check(result.selected.length === 2 && result.deferred.length === 0, 'Exact-capacity work should fit without deferral');

result = api.choosePlanItems([item('critical',20,60,{type:'relearn',dueState:'overdue',dueRisk:1}), item('normal',99,60)], 60);
check(result.selected.length === 1 && key(result.selected[0]) === 'critical', 'Critical policy must precede normal-score maximization');

result = api.choosePlanItems([
  item('critical-large',98,61,{type:'relearn',dueState:'overdue',dueRisk:1}),
  item('critical-fit',97,30,{type:'relearn',dueState:'overdue',dueRisk:1}),
  item('normal',96,20),
], 60);
check(key(result.selected[0]) === 'critical-large' && result.requiredOverrun.length === 1, 'Highest critical oversized item must remain explicit');
check(result.deferred.some((value) => key(value) === 'critical-fit'), 'Fit critical work must remain visible when a higher critical overrun owns the day');

result = api.choosePlanItems([item('critical-fit',99,30,{type:'relearn',dueState:'overdue',dueRisk:1}), item('critical-large',90,90,{type:'relearn',dueState:'overdue',dueRisk:1})], 60);
check(result.mustSplit.length === 1 && key(result.mustSplit[0]) === 'critical-large', 'Lower-ranked oversized critical work must be classified as must-split');

result = api.choosePlanItems([item('normal-large',88,90), item('normal-larger',70,120)], 60);
check(result.requiredOverrun.length === 1 && key(result.requiredOverrun[0]) === 'normal-large', 'No-fit fallback must keep the highest-ranked work visible');

result = api.choosePlanItems([item('later',80,10,{dueAt:new Date(BASE_DUE+3600000).toISOString()}), item('earlier',80,10,{dueAt:new Date(BASE_DUE).toISOString()})], 10);
check(key(result.selected[0]) === 'earlier', 'Equal-score tie must prefer earlier due work');

const random = mulberry32(0xC0FFEE);
const CASES = 320;
for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
  const capacity = integer(random, 12, 90);
  const count = integer(random, 1, 10);
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const mode = integer(random, 0, 4);
    const isRelearn = mode === 0;
    const isRiskCritical = mode === 1;
    candidates.push(item('case-' + caseIndex + '-item-' + index, integer(random,1,1000)/10, integer(random,1,capacity), {
      type:isRelearn?'relearn':'concept-reconstruction',
      dueState:isRiskCritical?'overdue':(integer(random,0,1)?'due':'brought-forward'),
      dueRisk:isRiskCritical?integer(random,85,100)/100:integer(random,0,84)/100,
      dueAt:new Date(BASE_DUE + integer(random,-72,72)*3600000).toISOString(),
    }));
  }

  const actual = api.choosePlanItems(candidates, capacity);
  const label = 'seeded case ' + caseIndex;
  assertPartition(candidates, actual, label);
  check(actual.requiredOverrun.length === 0 && actual.mustSplit.length === 0, label + ': all generated items fit individually');
  check(actual.selected.reduce((sum, value) => sum + duration(value), 0) <= capacity, label + ': selected work exceeds capacity');

  const criticalItems = candidates.filter(critical);
  const productionCritical = actual.selected.filter(critical);
  const expectedCritical = bruteForce(criticalItems, capacity);
  const actualCritical = selectedObjective(productionCritical);
  check(actualCritical.value === expectedCritical.value, label + ': critical objective differs from exhaustive oracle');
  check(actualCritical.used === expectedCritical.used, label + ': critical tie-break does not minimize capacity used');

  const remaining = capacity - actualCritical.used;
  const normalItems = candidates.filter((value) => !critical(value));
  const productionNormal = actual.selected.filter((value) => !critical(value));
  const expectedNormal = bruteForce(normalItems, remaining);
  const actualNormal = selectedObjective(productionNormal);
  check(actualNormal.value === expectedNormal.value, label + ': normal objective differs from exhaustive oracle');
  check(actualNormal.used === expectedNormal.used, label + ': normal tie-break does not minimize capacity used');

  const permuted = api.choosePlanItems(shuffle(random, candidates), capacity);
  check(JSON.stringify(canonicalResult(actual)) === JSON.stringify(canonicalResult(permuted)), label + ': result depends on input permutation');

  const expanded = api.choosePlanItems(candidates, capacity + 1);
  const expandedCriticalValue = selectedObjective(expanded.selected.filter(critical)).value;
  check(expandedCriticalValue >= actualCritical.value, label + ': increasing capacity reduced the attainable critical objective');
}

console.log('PASS ' + checks + ' seeded planner/oracle property checks across ' + CASES + ' cases');
