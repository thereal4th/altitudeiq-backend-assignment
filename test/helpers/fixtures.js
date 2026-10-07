// Test data builders. Every user is recorded for cleanup the moment it exists.
const assert = require('node:assert/strict');
const db = require('../../server/config/db');
const passwordUtil = require('../../server/utils/password');
const { recordUser } = require('./cleanup');
const { client } = require('./client');

const PASSWORD = 'correct horse battery';

const uniqueName = () => `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// scrypt is deliberately slow, so the default password is hashed once and reused.
let defaultHash;
const hashFor = (password) => (password === PASSWORD ? (defaultHash ??= passwordUtil.hash(PASSWORD)) : passwordUtil.hash(password));

// Inserted straight into the DB: registering through the API would hit the
// per-IP sign-up limit, and is covered by its own tests.
async function createUser({ username = uniqueName(), password = PASSWORD, hash } = {}) {
  const passwordHash = hash ?? await hashFor(password);
  const [result] = await db.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
  recordUser(result.insertId);
  return { id: result.insertId, username, password };
}

// A logged-in API client for a brand-new user.
async function signedIn(ctx, options) {
  const user = await createUser(options);
  const call = client(ctx);
  const res = await call('POST', '/api/login', { username: user.username, password: user.password });
  assert.equal(res.status, 200, 'test user should be able to log in');
  return { call, user };
}

// Posts `count` messages as this client, oldest first; returns them newest first.
async function postMessages(call, count, prefix = 'msg') {
  const posted = [];
  for (let i = 1; i <= count; i++) {
    const res = await call('POST', '/api/messages', { body: `${prefix} ${i}` });
    assert.equal(res.status, 201);
    posted.push(res.json);
  }
  return posted.reverse();
}

module.exports = { PASSWORD, uniqueName, createUser, signedIn, postMessages };
