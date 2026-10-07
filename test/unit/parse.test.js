const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseId } = require('../../server/utils/parseId');
const { parseLimit } = require('../../server/utils/parseLimit');

test('parseId accepts positive integers, as numbers or numeric strings', () => {
  assert.equal(parseId('42'), 42);
  assert.equal(parseId(7), 7);
  assert.equal(parseId('1295165'), 1295165);
});

test('parseId rejects everything else with a 400 that names the field', () => {
  for (const value of ['0', '-1', '2.5', 'abc', '', undefined, null, ['1', '2'], {}, 'NaN', 'Infinity']) {
    assert.throws(() => parseId(value, 'cursor'), { status: 400, message: 'Invalid cursor' }, `value: ${JSON.stringify(value)}`);
  }
});

test('parseLimit defaults to 20 when absent', () => {
  assert.equal(parseLimit(undefined), 20);
  assert.equal(parseLimit(undefined, 5), 5);
});

test('parseLimit accepts 1 through 50', () => {
  assert.equal(parseLimit('1'), 1);
  assert.equal(parseLimit('50'), 50);
});

test('parseLimit rejects out-of-range or non-integer values', () => {
  for (const value of ['0', '51', '1000', '-5', '2.5', 'abc', '', ['10', '20']]) {
    assert.throws(() => parseLimit(value), { status: 400 }, `value: ${JSON.stringify(value)}`);
  }
});
