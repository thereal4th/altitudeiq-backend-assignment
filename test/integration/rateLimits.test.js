// Runs in its own process with low limits, so the real limiter logic is exercised
// without hundreds of requests.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { useApp } = require('../helpers/app');
const { client } = require('../helpers/client');
const { createUser, signedIn, uniqueName, PASSWORD } = require('../helpers/fixtures');
const { recordUser } = require('../helpers/cleanup');
const log = require('../../server/utils/logger');

const ctx = useApp({ RATE_LIMIT_LOGIN: '3', RATE_LIMIT_REGISTER: '2', RATE_LIMIT_WRITE: '4' });
mock.method(log, 'warn', () => {});

const login = (call, username, password) => call('POST', '/api/login', { username, password });

test('login is blocked after 3 failures for that username, even with the right password', async () => {
  const user = await createUser();
  const call = client(ctx);
  for (let i = 0; i < 3; i++) assert.equal((await login(call, user.username, 'wrong')).status, 401);
  const blocked = await login(call, user.username, user.password);
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('ratelimit'), 'standard RateLimit header');

  const other = await createUser();
  assert.equal((await login(call, other.username, other.password)).status, 200, 'other accounts unaffected');
});

test('successful logins do not count towards the limit', async () => {
  const user = await createUser();
  const call = client(ctx);
  for (let i = 0; i < 5; i++) assert.equal((await login(call, user.username, user.password)).status, 200);
});

test('sign-ups are capped per IP; rejected sign-ups do not count', async () => {
  const call = client(ctx);
  const register = async (username, password = PASSWORD) => {
    const res = await call('POST', '/api/register', { username, password });
    if (res.status === 201) recordUser(res.json.id);
    return res.status;
  };
  for (let i = 0; i < 4; i++) assert.equal(await register(uniqueName(), 'short'), 400);
  assert.equal(await register(uniqueName()), 201);
  assert.equal(await register(uniqueName()), 201);
  assert.equal(await register(uniqueName()), 429);
});

test('writes are capped per user, not globally', async () => {
  const alice = await signedIn(ctx);
  const bob = await signedIn(ctx);
  for (let i = 0; i < 4; i++) assert.equal((await alice.call('POST', '/api/messages', { body: `m${i}` })).status, 201);
  assert.equal((await alice.call('POST', '/api/messages', { body: 'one too many' })).status, 429);
  assert.equal((await bob.call('POST', '/api/messages', { body: 'bob is fine' })).status, 201);
});
