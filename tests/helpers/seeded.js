'use strict';

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function integer(random, minimum, maximum) {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) throw new Error('Invalid integer range');
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function shuffle(random, values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = integer(random, 0, index);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

module.exports = { mulberry32, integer, shuffle };
