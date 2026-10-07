// The small Express middlewares, called directly with fake req/res objects.
const { test, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const log = require('../../server/utils/logger');
const sameOrigin = require('../../server/middleware/sameOrigin');
const requireLogin = require('../../server/middleware/requireLogin');
const { HttpError } = require('../../server/utils/httpError');
const { notFound, errorHandler } = require('../../server/middleware/errorHandler');

// Keep security-event logging out of the test output.
beforeEach(() => {
  mock.restoreAll();
  for (const level of ['info', 'warn', 'error']) mock.method(log, level, () => {});
});

function fakeReq({ method = 'POST', headers = {}, session } = {}) {
  const h = Object.fromEntries(Object.entries({ host: 'localhost:3000', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    protocol: 'http',
    headers: h,
    originalUrl: '/api/messages',
    id: 'req-1',
    ip: '::1',
    session,
    get: (name) => h[name.toLowerCase()],
    is: (type) => ((h['content-type'] || '').split(';')[0] === type ? type : false),
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// Runs a middleware and returns what it passed to next(): undefined means "allowed".
function run(middleware, req) {
  const next = mock.fn();
  middleware(req, fakeRes(), next);
  assert.equal(next.mock.callCount(), 1, 'next() called exactly once');
  return next.mock.calls[0].arguments[0];
}

// ---------- sameOrigin (CSRF) ----------

test('sameOrigin lets safe methods through, even cross-site', () => {
  assert.equal(run(sameOrigin, fakeReq({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } })), undefined);
});

test('sameOrigin allows writes the browser marks same-origin or user-initiated', () => {
  for (const site of ['same-origin', 'none']) {
    assert.equal(run(sameOrigin, fakeReq({ headers: { 'sec-fetch-site': site } })), undefined, site);
  }
});

test('sameOrigin blocks writes the browser marks cross-site or same-site (another subdomain)', () => {
  for (const site of ['cross-site', 'same-site']) {
    const err = run(sameOrigin, fakeReq({ headers: { 'sec-fetch-site': site } }));
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 403, site);
  }
  assert.equal(log.warn.mock.calls[0].arguments[0], 'csrf_rejected');
});

test('sameOrigin falls back to the Origin header when Sec-Fetch-Site is absent', () => {
  assert.equal(run(sameOrigin, fakeReq({ headers: { origin: 'http://localhost:3000' } })), undefined);
  assert.equal(run(sameOrigin, fakeReq({ headers: { origin: 'https://evil.example' } })).status, 403);
});

test('sameOrigin allows non-browser clients that send neither header', () => {
  assert.equal(run(sameOrigin, fakeReq()), undefined);
});

test('sameOrigin requires a JSON body on writes that have one', () => {
  const asForm = fakeReq({ headers: { 'content-type': 'text/plain', 'content-length': '5' } });
  assert.equal(run(sameOrigin, asForm).status, 415);
  const asJson = fakeReq({ headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': '5' } });
  assert.equal(run(sameOrigin, asJson), undefined);
  const empty = fakeReq({ headers: { 'content-length': '0' } });
  assert.equal(run(sameOrigin, empty), undefined);
});

// ---------- requireLogin ----------

test('requireLogin fails closed for anything but a session with a user id', () => {
  for (const session of [undefined, {}, { user: null }, { user: {} }, { user: { username: 'x' } }]) {
    const err = run(requireLogin, fakeReq({ session }));
    assert.equal(err?.status, 401, JSON.stringify(session));
  }
});

test('requireLogin lets a signed-in user through', () => {
  assert.equal(run(requireLogin, fakeReq({ session: { user: { id: 1, username: 'a' } } })), undefined);
});

// ---------- errorHandler ----------

function handle(err) {
  const res = fakeRes();
  errorHandler(err, fakeReq(), res, () => {});
  return res;
}

test('errorHandler hides 5xx details but returns the request id, and logs the error', () => {
  const res = handle(new Error('database password is wrong'));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Something went wrong', requestId: 'req-1' });
  assert.equal(log.error.mock.calls[0].arguments[0], 'server_error');
});

test('errorHandler passes 4xx messages through', () => {
  const res = handle(new HttpError(403, 'You can only edit your own messages'));
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'You can only edit your own messages' });
});

test('errorHandler replaces body-parser internals with plain messages', () => {
  const bad = handle(Object.assign(new Error('Unexpected token } in JSON at position 9'), { status: 400, type: 'entity.parse.failed' }));
  assert.deepEqual(bad.body, { error: 'Request body must be valid JSON' });
  const big = handle(Object.assign(new Error('request entity too large'), { statusCode: 413, type: 'entity.too.large' }));
  assert.equal(big.statusCode, 413);
  assert.deepEqual(big.body, { error: 'Request body is too large' });
});

test('notFound produces a 404 HttpError', () => {
  assert.equal(run(notFound, fakeReq()).status, 404);
});
