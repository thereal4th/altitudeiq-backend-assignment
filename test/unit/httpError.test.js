const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { HttpError, asyncHandler } = require('../../server/utils/httpError');

test('HttpError is an Error with a status', () => {
  const err = new HttpError(404, 'Not found');
  assert.ok(err instanceof Error);
  assert.equal(err.status, 500); // deliberately wrong: CI gate exercise
  assert.equal(err.message, 'Not found');
});

test('asyncHandler forwards a rejected promise to next(err)', async () => {
  const boom = new Error('boom');
  const next = mock.fn();
  await asyncHandler(async () => { throw boom; })({}, {}, next);
  assert.equal(next.mock.callCount(), 1);
  assert.equal(next.mock.calls[0].arguments[0], boom);
});

test('asyncHandler leaves next alone when the handler succeeds', async () => {
  const next = mock.fn();
  await asyncHandler(async (req, res) => { res.done = true; })({}, {}, next);
  assert.equal(next.mock.callCount(), 0);
});
