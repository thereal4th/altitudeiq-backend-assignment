// Exact assertions use each test's own messages: they are the newest ids, so
// paging from just above them walks exactly what the test posted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useApp } = require('../helpers/app');
const { client } = require('../helpers/client');
const { signedIn, postMessages } = require('../helpers/fixtures');

const ctx = useApp();
const ids = (page) => page.messages.map((m) => m.id);

test('the feed requires login', async () => {
  const call = client(ctx);
  assert.equal((await call('GET', '/api/messages')).status, 401);
  assert.equal((await call('POST', '/api/messages', { body: 'hi' })).status, 401);
});

test('posting returns the complete new message, trimmed', async () => {
  const { call, user } = await signedIn(ctx);
  const res = await call('POST', '/api/messages', { body: '  hello wall  ' });
  assert.equal(res.status, 201);
  assert.equal(res.json.body, 'hello wall');
  assert.equal(res.json.user_id, user.id);
  assert.equal(res.json.username, user.username);
  assert.equal(res.json.comment_count, 0);
  assert.deepEqual(res.json.comments, []);
});

test('message length: required, at most 2000 characters', async () => {
  const { call } = await signedIn(ctx);
  assert.equal((await call('POST', '/api/messages', { body: '' })).status, 400);
  assert.equal((await call('POST', '/api/messages', { body: '   \n  ' })).status, 400);
  assert.equal((await call('POST', '/api/messages', {})).status, 400);
  assert.equal((await call('POST', '/api/messages', { body: 'x'.repeat(2000) })).status, 201);
  assert.equal((await call('POST', '/api/messages', { body: 'x'.repeat(2001) })).status, 400);
});

test('?before= pages through messages newest first, with no gaps or duplicates', async () => {
  const { call } = await signedIn(ctx);
  const posted = await postMessages(call, 25);
  const start = posted[0].id + 1;

  const p1 = (await call('GET', `/api/messages?before=${start}&limit=10`)).json;
  const p2 = (await call('GET', `/api/messages?before=${p1.messages.at(-1).id}&limit=10`)).json;
  const p3 = (await call('GET', `/api/messages?before=${p2.messages.at(-1).id}&limit=5`)).json;
  assert.deepEqual([...ids(p1), ...ids(p2), ...ids(p3)], posted.map((m) => m.id));
  assert.equal(p1.hasMore, true);
});

test('?after= pages back towards newer messages, still newest first', async () => {
  const { call } = await signedIn(ctx);
  const posted = await postMessages(call, 15);
  const page = (await call('GET', `/api/messages?after=${posted[10].id}&limit=10`)).json;
  assert.deepEqual(ids(page), posted.slice(0, 10).map((m) => m.id));
});

test('hasMore is false at the very beginning of the wall', async () => {
  const { call } = await signedIn(ctx);
  const [oldest] = await ctx.db.query('SELECT id FROM messages ORDER BY id LIMIT 2');
  const last = (await call('GET', `/api/messages?before=${oldest[1].id}&limit=5`)).json;
  assert.deepEqual(ids(last), [oldest[0].id]);
  assert.equal(last.hasMore, false);
  const beyond = (await call('GET', `/api/messages?before=${oldest[0].id}`)).json;
  assert.deepEqual(beyond, { messages: [], hasMore: false });
});

test('bad cursors and limits are rejected with 400', async () => {
  const { call } = await signedIn(ctx);
  for (const q of ['before=abc', 'before=0', 'after=-5', 'limit=0', 'limit=51', 'limit=2.5', 'before=1&after=2']) {
    assert.equal((await call('GET', `/api/messages?${q}`)).status, 400, q);
  }
});

test('editing your own message', async () => {
  const { call } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);
  const res = await call('PUT', `/api/messages/${msg.id}`, { body: '  edited  ' });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.body, 'edited');
  assert.ok(res.json.edited_at, 'an edit is stamped');
  const page = (await call('GET', `/api/messages?before=${msg.id + 1}&limit=1`)).json;
  assert.equal(page.messages[0].body, 'edited');
  assert.equal(new Date(page.messages[0].edited_at).getTime(), new Date(res.json.edited_at).getTime());
  assert.equal((await call('PUT', `/api/messages/${msg.id}`, { body: '' })).status, 400);
  assert.equal((await call('PUT', '/api/messages/abc', { body: 'x' })).status, 400);
});

test('a new message has no edited marker, and saving unchanged text does not add one', async () => {
  const { call } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);
  assert.equal(msg.edited_at, null);
  const same = await call('PUT', `/api/messages/${msg.id}`, { body: 'msg 1' });
  assert.equal(same.status, 200);
  assert.equal(same.json.edited_at, null);
  // A change of letter case alone is still an edit.
  const recased = await call('PUT', `/api/messages/${msg.id}`, { body: 'MSG 1' });
  assert.ok(recased.json.edited_at);
});

test('messages carry like_count and liked_by_me', async () => {
  const { call } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);
  assert.equal(msg.like_count, 0);
  assert.equal(msg.liked_by_me, false);
  const page = (await call('GET', `/api/messages?before=${msg.id + 1}&limit=1`)).json;
  assert.equal(page.messages[0].like_count, 0);
  assert.equal(page.messages[0].liked_by_me, false);
});

test('deleting your own message removes it from the feed', async () => {
  const { call } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);
  assert.equal((await call('DELETE', `/api/messages/${msg.id}`)).status, 200);
  const page = (await call('GET', `/api/messages?before=${msg.id + 1}&limit=1`)).json;
  assert.notEqual(page.messages[0]?.id, msg.id);
  assert.equal((await call('DELETE', `/api/messages/${msg.id}`)).status, 403, 'already gone');
  assert.equal((await call('PUT', `/api/messages/${msg.id}`, { body: 'zombie' })).status, 403, "can't edit a deleted message");
});

test("you can't edit or delete someone else's message", async () => {
  const alice = await signedIn(ctx);
  const bob = await signedIn(ctx);
  const [msg] = await postMessages(alice.call, 1);
  assert.equal((await bob.call('PUT', `/api/messages/${msg.id}`, { body: 'hijacked' })).status, 403);
  assert.equal((await bob.call('DELETE', `/api/messages/${msg.id}`)).status, 403);
  const page = (await alice.call('GET', `/api/messages?before=${msg.id + 1}&limit=1`)).json;
  assert.equal(page.messages[0].body, 'msg 1', 'untouched');
});
