// Regression tests for three performance problems found in review. Each was
// written first and failed against the original code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { useApp } = require('../helpers/app');
const { client } = require('../helpers/client');
const { signedIn, postMessages, uniqueName, PASSWORD } = require('../helpers/fixtures');
const { recordUser } = require('../helpers/cleanup');

const ctx = useApp();

// Max event-loop stall, in ms, while `fn` runs. The app runs in this process, so
// anything that hogs the main thread shows up here.
async function maxStallMs(fn) {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  await fn();
  histogram.disable();
  return histogram.max / 1e6;
}

test('password hashing does not stall the event loop', async () => {
  const call = client(ctx);
  await call('GET', '/api/me'); // warm up
  const username = uniqueName();
  const registerStall = await maxStallMs(async () => {
    const res = await call('POST', '/api/register', { username, password: PASSWORD });
    assert.equal(res.status, 201);
    recordUser(res.json.id);
  });
  const loginStall = await maxStallMs(async () => {
    assert.equal((await client(ctx)('POST', '/api/login', { username, password: PASSWORD })).status, 200);
  });
  assert.ok(registerStall < 50, `register stalled other requests for ${registerStall.toFixed(0)} ms`);
  assert.ok(loginStall < 50, `login stalled other requests for ${loginStall.toFixed(0)} ms`);
});

test('ordinary requests do not write to the sessions table', async () => {
  const { call } = await signedIn(ctx);
  const pool = ctx.db.pool; // the session store and the models share this core pool
  const original = pool.query;
  let writes = 0;
  pool.query = function (sql, params, ...rest) {
    if (Array.isArray(params) && params[0] === 'sessions' && /^\s*(UPDATE|INSERT)/i.test(sql)) writes++;
    return original.call(this, sql, params, ...rest);
  };
  try {
    for (let i = 0; i < 5; i++) assert.equal((await call('GET', '/api/messages?limit=1')).status, 200);
  } finally {
    pool.query = original;
  }
  assert.equal(writes, 0, `${writes} session writes for 5 read requests`);
});

test('deleting a message with a huge thread is fast; its comments are purged in the background', async () => {
  const { call, user } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);

  // 50k comments, generated inside MySQL and owned by the test user (cleanup cascades them).
  const conn = await ctx.db.getConnection();
  try {
    await conn.query('SET SESSION cte_max_recursion_depth = 50000');
    await conn.query(
      `INSERT INTO comments (message_id, user_id, body)
       WITH RECURSIVE s (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 50000)
       SELECT ?, ?, CONCAT('bulk ', n) FROM s`,
      [msg.id, user.id]
    );
    await conn.query('UPDATE messages SET comment_count = 50000 WHERE id = ?', [msg.id]);
  } finally {
    conn.release();
  }

  const started = performance.now();
  assert.equal((await call('DELETE', `/api/messages/${msg.id}`)).status, 200);
  const ms = performance.now() - started;
  assert.ok(ms < 200, `delete took ${ms.toFixed(0)} ms`);

  // Gone from the user's point of view straight away.
  const page = (await call('GET', `/api/messages?before=${msg.id + 1}&limit=1`)).json;
  assert.notEqual(page.messages[0]?.id, msg.id);
  assert.equal((await call('POST', `/api/messages/${msg.id}/comments`, { body: 'late' })).status, 404);

  // The background job removes the thread in bounded batches, then the message row.
  const purge = require('../../server/jobs/purgeDeleted');
  let rounds = 0;
  while ((await purge.runOnce()).deleted > 0) assert.ok(++rounds < 100, 'purge finishes');
  const [[left]] = await ctx.db.query('SELECT COUNT(*) AS n FROM comments WHERE message_id = ?', [msg.id]);
  const [[row]] = await ctx.db.query('SELECT COUNT(*) AS n FROM messages WHERE id = ?', [msg.id]);
  assert.equal(left.n, 0);
  assert.equal(row.n, 0);
});
