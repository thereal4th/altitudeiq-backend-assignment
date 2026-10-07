const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { useApp } = require('../helpers/app');
const { client, sessionId } = require('../helpers/client');
const { createUser, uniqueName, PASSWORD } = require('../helpers/fixtures');
const { recordUser } = require('../helpers/cleanup');

const ctx = useApp();

// Registers through the API, recording the new user for cleanup.
async function register(call, username, password = PASSWORD) {
  const res = await call('POST', '/api/register', { username, password });
  if (res.status === 201) recordUser(res.json.id);
  return res;
}

test('register creates the account and signs it in', async () => {
  const call = client(ctx);
  const username = uniqueName();
  const res = await register(call, username);
  assert.equal(res.status, 201);
  assert.equal(res.json.username, username);
  assert.deepEqual((await call('GET', '/api/me')).json, res.json);
});

test('register rejects usernames outside 3-30 letters, digits, dots, dashes, underscores', async () => {
  const call = client(ctx);
  for (const username of ['', 'ab', 'x'.repeat(31), 'has space', '<script>', 'émile', 'semi;colon']) {
    assert.equal((await register(call, username)).status, 400, JSON.stringify(username));
  }
});

test('register requires 8+ characters and at most 72 bytes', async () => {
  const call = client(ctx);
  assert.equal((await register(call, uniqueName(), 'short')).status, 400);
  assert.equal((await register(client(ctx), uniqueName(), 'a'.repeat(72))).status, 201);
  assert.equal((await register(call, uniqueName(), 'a'.repeat(73))).status, 400);
  // Multibyte characters count by bytes: 18 x 4-byte emoji = 72 bytes (ok), 19 = 76 bytes (too long)
  assert.equal((await register(client(ctx), uniqueName(), '🔒'.repeat(18))).status, 201);
  assert.equal((await register(call, uniqueName(), '🔒'.repeat(19))).status, 400);
});

test('register refuses a taken username, ignoring case', async () => {
  const existing = await createUser();
  assert.equal((await register(client(ctx), existing.username)).status, 400);
  assert.equal((await register(client(ctx), existing.username.toUpperCase())).status, 400);
});

test('login succeeds with the right password', async () => {
  const user = await createUser();
  const call = client(ctx);
  const res = await call('POST', '/api/login', { username: user.username, password: user.password });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { id: user.id, username: user.username });
});

test('a legacy bcrypt account can still log in, and its hash is upgraded to scrypt', async () => {
  const user = await createUser({ hash: await bcrypt.hash(PASSWORD, 4) });
  const login = () => client(ctx)('POST', '/api/login', { username: user.username, password: PASSWORD });
  assert.equal((await login()).status, 200);
  const [[row]] = await ctx.db.query('SELECT password_hash FROM users WHERE id = ?', [user.id]);
  assert.match(row.password_hash, /^scrypt\$/);
  assert.equal((await login()).status, 200, 'the upgraded hash works');
});

test('login gives the same 401 for a wrong password and an unknown user', async () => {
  const user = await createUser();
  const wrong = await client(ctx)('POST', '/api/login', { username: user.username, password: 'wrong password' });
  const unknown = await client(ctx)('POST', '/api/login', { username: uniqueName(), password: 'wrong password' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, unknown.json, 'no hint about which usernames exist');
});

test('logging in issues a new session id and invalidates the old one (no session fixation)', async () => {
  const user = await createUser();
  const call = client(ctx);
  await call('POST', '/api/login', { username: user.username, password: user.password });
  const first = call.cookie();
  await call('POST', '/api/login', { username: user.username, password: user.password });
  assert.notEqual(sessionId(call.cookie()), sessionId(first));

  const stale = client(ctx);
  stale.setCookie(first);
  assert.equal((await stale('GET', '/api/me')).json, null);
});

test('sessions are stored in MySQL, so they survive a server restart', async () => {
  const user = await createUser();
  const call = client(ctx);
  await call('POST', '/api/login', { username: user.username, password: user.password });
  const [rows] = await ctx.db.query('SELECT data FROM sessions WHERE session_id = ?', [sessionId(call.cookie())]);
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].data).user.id, user.id);
});

test('logout destroys the session: the old cookie stops working', async () => {
  const user = await createUser();
  const call = client(ctx);
  await call('POST', '/api/login', { username: user.username, password: user.password });
  const cookie = call.cookie();
  assert.equal((await call('POST', '/api/logout')).status, 200);

  const reused = client(ctx);
  reused.setCookie(cookie);
  assert.equal((await reused('GET', '/api/messages')).status, 401);
  const [rows] = await ctx.db.query('SELECT 1 FROM sessions WHERE session_id = ?', [sessionId(cookie)]);
  assert.equal(rows.length, 0);
});
