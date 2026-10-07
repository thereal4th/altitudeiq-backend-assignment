// server/config/sessionStore.js: writes the session row at most once per hour
// instead of on every request. Tested against a fake base store.
const { test, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { throttleTouches } = require('../../server/config/sessionStore');

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 6, 12, 0, 0);

class FakeStore {
  constructor() { this.writes = []; }
  set(sid, data, callback) {
    this.writes.push({ sid, touchedAt: data.touchedAt });
    callback?.(null);
    return Promise.resolve();
  }
  touch() { throw new Error('the base touch() should never be called'); }
}

let store;
beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: START });
  store = new (throttleTouches(FakeStore, HOUR))();
});

test('set() stamps when the row was written', async () => {
  const data = {};
  await store.set('abc', data);
  assert.equal(data.touchedAt, START);
  assert.deepEqual(store.writes, [{ sid: 'abc', touchedAt: START }]);
});

test('touch() within the hour does not write, but still calls back', async () => {
  const callback = mock.fn();
  mock.timers.tick(HOUR - 1000);
  await store.touch('abc', { touchedAt: START }, callback);
  assert.equal(store.writes.length, 0);
  assert.equal(callback.mock.callCount(), 1);
  assert.equal(callback.mock.calls[0].arguments[0], null);
});

test('touch() after an hour rewrites the row with a fresh stamp', async () => {
  mock.timers.tick(HOUR + 1000);
  await store.touch('abc', { touchedAt: START });
  assert.deepEqual(store.writes, [{ sid: 'abc', touchedAt: START + HOUR + 1000 }]);
});

test('touch() writes sessions saved before throttling existed (no stamp)', async () => {
  await store.touch('old', {});
  assert.equal(store.writes.length, 1);
});
