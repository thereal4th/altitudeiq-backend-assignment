// Comments only ever go on test users' messages, so cleanup (which deletes the
// test users) never leaves a seeded message's comment_count wrong.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useApp } = require('../helpers/app');
const { client } = require('../helpers/client');
const { signedIn, postMessages } = require('../helpers/fixtures');

const ctx = useApp();

async function messageWithComments(call, count) {
  const [msg] = await postMessages(call, 1);
  const comments = [];
  for (let i = 1; i <= count; i++) {
    const res = await call('POST', `/api/messages/${msg.id}/comments`, { body: `comment ${i}` });
    assert.equal(res.status, 201);
    comments.push(res.json);
  }
  return { msg, comments };
}

const fetchMessage = async (call, id) => (await call('GET', `/api/messages?before=${id + 1}&limit=1`)).json.messages[0];

test('commenting returns the full comment and bumps comment_count', async () => {
  const { call, user } = await signedIn(ctx);
  const { msg, comments } = await messageWithComments(call, 2);
  assert.equal(comments[0].message_id, msg.id);
  assert.equal(comments[0].username, user.username);
  assert.equal(comments[0].body, 'comment 1');
  assert.equal((await fetchMessage(call, msg.id)).comment_count, 2);
});

test('anyone signed in can comment on any message', async () => {
  const alice = await signedIn(ctx);
  const bob = await signedIn(ctx);
  const [msg] = await postMessages(alice.call, 1);
  const res = await bob.call('POST', `/api/messages/${msg.id}/comments`, { body: 'nice post' });
  assert.equal(res.status, 201);
  assert.equal(res.json.username, bob.user.username);
});

test('the feed previews the latest 3 comments, oldest first', async () => {
  const { call } = await signedIn(ctx);
  const { msg } = await messageWithComments(call, 5);
  const m = await fetchMessage(call, msg.id);
  assert.equal(m.comment_count, 5);
  assert.deepEqual(m.comments.map((c) => c.body), ['comment 3', 'comment 4', 'comment 5']);
});

test('older comments page backwards from the oldest one shown', async () => {
  const { call } = await signedIn(ctx);
  const { msg, comments } = await messageWithComments(call, 5);
  const url = (before, limit) => `/api/messages/${msg.id}/comments?before=${before}&limit=${limit}`;

  const first = (await call('GET', url(comments[2].id, 1))).json;
  assert.deepEqual(first.comments.map((c) => c.body), ['comment 2']);
  assert.equal(first.hasMore, true);
  const rest = (await call('GET', url(first.comments[0].id, 20))).json;
  assert.deepEqual(rest.comments.map((c) => c.body), ['comment 1']);
  assert.equal(rest.hasMore, false);
});

test('comment length: required, at most 500 characters', async () => {
  const { call } = await signedIn(ctx);
  const [msg] = await postMessages(call, 1);
  const post = (body) => call('POST', `/api/messages/${msg.id}/comments`, { body });
  assert.equal((await post('   ')).status, 400);
  assert.equal((await post('x'.repeat(500))).status, 201);
  assert.equal((await post('x'.repeat(501))).status, 400);
});

test('editing your own comment stamps edited_at; unchanged text does not', async () => {
  const { call } = await signedIn(ctx);
  const { msg, comments } = await messageWithComments(call, 1);
  assert.equal(comments[0].edited_at, null);

  const same = await call('PUT', `/api/comments/${comments[0].id}`, { body: 'comment 1' });
  assert.equal(same.status, 200);
  assert.equal(same.json.edited_at, null);

  const res = await call('PUT', `/api/comments/${comments[0].id}`, { body: '  better comment  ' });
  assert.equal(res.status, 200);
  assert.equal(res.json.body, 'better comment');
  assert.ok(res.json.edited_at);
  const shown = (await fetchMessage(call, msg.id)).comments[0];
  assert.equal(shown.body, 'better comment');
  assert.ok(shown.edited_at);
});

test('comment edits are validated like new comments', async () => {
  const { call } = await signedIn(ctx);
  const { comments } = await messageWithComments(call, 1);
  const put = (body) => call('PUT', `/api/comments/${comments[0].id}`, { body });
  assert.equal((await put('  ')).status, 400);
  assert.equal((await put('x'.repeat(501))).status, 400);
  assert.equal((await put('x'.repeat(500))).status, 200);
  assert.equal((await call('PUT', '/api/comments/abc', { body: 'x' })).status, 400);
});

test("you can't edit or delete someone else's comment", async () => {
  const alice = await signedIn(ctx);
  const bob = await signedIn(ctx);
  const { msg, comments } = await messageWithComments(alice.call, 1);
  assert.equal((await bob.call('PUT', `/api/comments/${comments[0].id}`, { body: 'hijacked' })).status, 403);
  assert.equal((await bob.call('DELETE', `/api/comments/${comments[0].id}`)).status, 403);
  const shown = await fetchMessage(alice.call, msg.id);
  assert.equal(shown.comments[0].body, 'comment 1', 'untouched');
  assert.equal(shown.comment_count, 1);
});

test('deleting your own comment removes it and lowers comment_count', async () => {
  const { call } = await signedIn(ctx);
  const { msg, comments } = await messageWithComments(call, 3);
  assert.equal((await call('DELETE', `/api/comments/${comments[1].id}`)).status, 200);
  const shown = await fetchMessage(call, msg.id);
  assert.equal(shown.comment_count, 2);
  assert.deepEqual(shown.comments.map((c) => c.body), ['comment 1', 'comment 3']);
  assert.equal((await call('DELETE', `/api/comments/${comments[1].id}`)).status, 403, 'already gone');
  assert.equal((await fetchMessage(call, msg.id)).comment_count, 2, 'a repeat delete does not lower it again');
});

test("a message's author can't delete other people's comments on it", async () => {
  const alice = await signedIn(ctx);
  const bob = await signedIn(ctx);
  const [msg] = await postMessages(alice.call, 1);
  const comment = (await bob.call('POST', `/api/messages/${msg.id}/comments`, { body: 'bob says hi' })).json;
  assert.equal((await alice.call('DELETE', `/api/comments/${comment.id}`)).status, 403);
});

test("a deleted message's comments can't be edited or deleted", async () => {
  const { call } = await signedIn(ctx);
  const { msg, comments } = await messageWithComments(call, 1);
  await call('DELETE', `/api/messages/${msg.id}`);
  assert.equal((await call('PUT', `/api/comments/${comments[0].id}`, { body: 'zombie' })).status, 403);
  assert.equal((await call('DELETE', `/api/comments/${comments[0].id}`)).status, 403);
});

test('comment editing and deleting require login', async () => {
  const call = client(ctx);
  assert.equal((await call('PUT', '/api/comments/1', { body: 'x' })).status, 401);
  assert.equal((await call('DELETE', '/api/comments/1')).status, 401);
});

test('commenting on a missing message is a 404, on a malformed id a 400', async () => {
  const { call } = await signedIn(ctx);
  assert.equal((await call('POST', '/api/messages/999999999999/comments', { body: 'x' })).status, 404);
  assert.equal((await call('POST', '/api/messages/abc/comments', { body: 'x' })).status, 400);
  assert.equal((await call('GET', '/api/messages/abc/comments')).status, 400);
});
