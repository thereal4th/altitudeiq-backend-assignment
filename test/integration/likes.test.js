// Likes are only ever put on test users' messages and comments, so cleanup
// (which deletes the test users) never leaves a seeded row's like_count wrong.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useApp } = require('../helpers/app');
const { client } = require('../helpers/client');
const { signedIn, postMessages } = require('../helpers/fixtures');

const ctx = useApp();

const fetchMessage = async (call, id) => (await call('GET', `/api/messages?before=${id + 1}&limit=1`)).json.messages[0];
const like = (call, kind, id) => call('PUT', `/api/${kind}/${id}/like`);
const unlike = (call, kind, id) => call('DELETE', `/api/${kind}/${id}/like`);

async function rows(table, column, id) {
  const [[{ n }]] = await ctx.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, [id]);
  return n;
}

async function commentOnNewMessage(call) {
  const [msg] = await postMessages(call, 1);
  const comment = (await call('POST', `/api/messages/${msg.id}/comments`, { body: 'hello' })).json;
  return { msg, comment };
}

test('liking and unliking require login', async () => {
  const call = client(ctx);
  assert.equal((await like(call, 'messages', 1)).status, 401);
  assert.equal((await unlike(call, 'messages', 1)).status, 401);
  assert.equal((await like(call, 'comments', 1)).status, 401);
  assert.equal((await unlike(call, 'comments', 1)).status, 401);
});

test('liking a message returns the new state and shows up in the feed', async () => {
  const { call } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);
  const res = await like(call, 'messages', msg.id);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { liked: true, like_count: 1 });
  const shown = await fetchMessage(call, msg.id);
  assert.equal(shown.like_count, 1);
  assert.equal(shown.liked_by_me, true);
});

test('liking twice is the same as liking once; so is unliking twice', async () => {
  const { call } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);
  await like(call, 'messages', msg.id);
  assert.deepEqual((await like(call, 'messages', msg.id)).json, { liked: true, like_count: 1 });
  assert.equal(await rows('message_likes', 'message_id', msg.id), 1);

  assert.deepEqual((await unlike(call, 'messages', msg.id)).json, { liked: false, like_count: 0 });
  assert.deepEqual((await unlike(call, 'messages', msg.id)).json, { liked: false, like_count: 0 });
  assert.equal(await rows('message_likes', 'message_id', msg.id), 0);
});

test('each viewer sees their own liked_by_me but the shared like_count', async () => {
  const alice = await signedIn(ctx);
  const bob = await signedIn(ctx);
  const [msg] = await postMessages(alice.call, 1);
  await like(alice.call, 'messages', msg.id);
  await like(bob.call, 'messages', msg.id);

  const forAlice = await fetchMessage(alice.call, msg.id);
  assert.equal(forAlice.like_count, 2);
  assert.equal(forAlice.liked_by_me, true);

  await unlike(bob.call, 'messages', msg.id);
  const forBob = await fetchMessage(bob.call, msg.id);
  assert.equal(forBob.like_count, 1);
  assert.equal(forBob.liked_by_me, false, "bob took his like back; alice's stays");
  assert.equal((await fetchMessage(alice.call, msg.id)).liked_by_me, true);
});

test('you can like your own message', async () => {
  const { call } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);
  assert.equal((await like(call, 'messages', msg.id)).json.like_count, 1);
});

test('like_count always matches the like rows, even with simultaneous requests', async () => {
  const users = await Promise.all([signedIn(ctx), signedIn(ctx), signedIn(ctx), signedIn(ctx)]);
  const [msg] = await postMessages(users[0].call, 1);
  // Everyone likes at once, and the first user sends the same request three times.
  await Promise.all([
    ...users.map((u) => like(u.call, 'messages', msg.id)),
    like(users[0].call, 'messages', msg.id),
    like(users[0].call, 'messages', msg.id),
  ]);
  assert.equal(await rows('message_likes', 'message_id', msg.id), 4);
  assert.equal((await fetchMessage(users[0].call, msg.id)).like_count, 4);
});

test('simultaneous likes and unlikes of one comment never deadlock or miscount', async () => {
  const users = await Promise.all([signedIn(ctx), signedIn(ctx), signedIn(ctx), signedIn(ctx)]);
  const { comment } = await commentOnNewMessage(users[0].call);
  const results = await Promise.all([
    ...users.map((u) => like(u.call, 'comments', comment.id)),
    like(users[0].call, 'comments', comment.id),
    unlike(users[3].call, 'comments', comment.id),
    like(users[3].call, 'comments', comment.id),
  ]);
  for (const res of results) assert.equal(res.status, 200, 'no request fails');
  const expected = await rows('comment_likes', 'comment_id', comment.id);
  const [[{ like_count }]] = await ctx.db.query('SELECT like_count FROM comments WHERE id = ?', [comment.id]);
  assert.equal(like_count, expected, 'the stored total equals the like rows');
});

test('liking a missing or deleted message is a 404, a malformed id a 400', async () => {
  const { call } = await signedIn(ctx);
  assert.equal((await like(call, 'messages', 999999999999)).status, 404);
  assert.equal((await unlike(call, 'messages', 999999999999)).status, 404);
  assert.equal((await like(call, 'messages', 'abc')).status, 400);

  const [msg] = await postMessages(call, 1);
  await call('DELETE', `/api/messages/${msg.id}`);
  assert.equal((await like(call, 'messages', msg.id)).status, 404);
});

test('comments can be liked and unliked too', async () => {
  const alice = await signedIn(ctx);
  const bob = await signedIn(ctx);
  const { msg, comment } = await commentOnNewMessage(alice.call);
  assert.equal(comment.like_count, 0);
  assert.equal(comment.liked_by_me, false);

  assert.deepEqual((await like(bob.call, 'comments', comment.id)).json, { liked: true, like_count: 1 });
  assert.deepEqual((await like(bob.call, 'comments', comment.id)).json, { liked: true, like_count: 1 });
  assert.equal(await rows('comment_likes', 'comment_id', comment.id), 1);

  const forBob = (await fetchMessage(bob.call, msg.id)).comments[0];
  assert.equal(forBob.like_count, 1);
  assert.equal(forBob.liked_by_me, true);
  assert.equal((await fetchMessage(alice.call, msg.id)).comments[0].liked_by_me, false);

  // The older-comments endpoint reports likes as well.
  const page = (await alice.call('GET', `/api/messages/${msg.id}/comments?limit=5`)).json;
  assert.equal(page.comments[0].like_count, 1);

  assert.deepEqual((await unlike(bob.call, 'comments', comment.id)).json, { liked: false, like_count: 0 });
});

test('liking a missing comment, or one on a deleted message, is a 404', async () => {
  const { call } = await signedIn(ctx);
  assert.equal((await like(call, 'comments', 999999999999)).status, 404);
  assert.equal((await like(call, 'comments', 'abc')).status, 400);

  const { msg, comment } = await commentOnNewMessage(call);
  await call('DELETE', `/api/messages/${msg.id}`);
  assert.equal((await like(call, 'comments', comment.id)).status, 404);
});

test("deleting a comment removes its likes; deleting a message's thread leaves no orphan likes", async () => {
  const alice = await signedIn(ctx);
  const bob = await signedIn(ctx);
  const { msg, comment } = await commentOnNewMessage(alice.call);
  await like(bob.call, 'comments', comment.id);
  await like(bob.call, 'messages', msg.id);
  assert.equal(await rows('comment_likes', 'comment_id', comment.id), 1);

  assert.equal((await alice.call('DELETE', `/api/comments/${comment.id}`)).status, 200);
  assert.equal(await rows('comment_likes', 'comment_id', comment.id), 0);

  // Purging a soft-deleted message removes the row and, by cascade, its likes.
  await alice.call('DELETE', `/api/messages/${msg.id}`);
  const purge = require('../../server/jobs/purgeDeleted');
  let rounds = 0;
  while ((await purge.runOnce()).deleted > 0) assert.ok(++rounds < 100, 'purge finishes');
  assert.equal(await rows('message_likes', 'message_id', msg.id), 0);
});
