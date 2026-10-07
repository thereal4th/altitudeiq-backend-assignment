const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { useApp } = require('../helpers/app');
const { client } = require('../helpers/client');
const { signedIn, postMessages } = require('../helpers/fixtures');
const log = require('../../server/utils/logger');

const ctx = useApp();
mock.method(log, 'warn', () => {}); // CSRF rejections are logged; keep the output clean

test('cross-site writes are blocked (CSRF), and nothing gets written', async () => {
  const { call } = await signedIn(ctx);
  const [marker] = await postMessages(call, 1);
  assert.equal((await call('POST', '/api/messages', { body: 'csrf 1' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/api/messages', { body: 'csrf 2' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call('POST', '/api/messages', 'body=csrf+3', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call('DELETE', `/api/messages/${marker.id}`, null, { origin: 'https://evil.example' })).status, 403);

  const newest = (await call('GET', `/api/messages?after=${marker.id - 1}&limit=5`)).json;
  assert.deepEqual(newest.messages.map((m) => m.body), ['msg 1'], 'no csrf message was created, marker not deleted');
});

test('pages get a strict Content Security Policy and other security headers', async () => {
  const res = await fetch(ctx.base + '/');
  const csp = res.headers.get('content-security-policy');
  for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) {
    assert.ok(csp.includes(directive), directive);
  }
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('strict-transport-security'), null, 'HSTS only in production (HTTPS)');
  assert.match(res.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
});

test('the session cookie is HttpOnly and SameSite=Lax', async () => {
  const { call } = await signedIn(ctx);
  const res = await call('GET', '/api/me');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^wall\.sid=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Secure/i, 'Secure only in production');
});

test('API responses are never cached', async () => {
  const res = await client(ctx)('GET', '/api/me');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('static files revalidate with an ETag; fonts are cached for a year', async () => {
  const js = await fetch(ctx.base + '/js/main.js');
  assert.equal(js.headers.get('cache-control'), 'no-cache');
  const etag = js.headers.get('etag');
  assert.ok(etag);
  // A hand-set If-None-Match makes fetch() add "Cache-Control: no-cache" (per the fetch spec),
  // which rightly disables 304s; a browser revalidating from its cache doesn't send that.
  const again = await fetch(ctx.base + '/js/main.js', { headers: { 'if-none-match': etag, 'cache-control': 'max-age=0' } });
  assert.equal(again.status, 304);

  const font = await fetch(ctx.base + '/fonts/dm-sans-latin-wght-normal.woff2');
  assert.equal(font.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('text responses are gzip-compressed', async () => {
  const res = await fetch(ctx.base + '/js/feed.js', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(res.headers.get('content-encoding'), 'gzip');
});

test('malformed or oversized JSON gets a plain 400 / 413', async () => {
  const { call } = await signedIn(ctx);
  const bad = await call('POST', '/api/messages', '{"body": oops');
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json, { error: 'Request body must be valid JSON' });
  const big = await call('POST', '/api/messages', { body: 'x'.repeat(11 * 1024) });
  assert.equal(big.status, 413);
  assert.deepEqual(big.json, { error: 'Request body is too large' });
});

test('unknown API routes are a JSON 404', async () => {
  const res = await client(ctx)('GET', '/api/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(res.json, { error: 'Not found' });
});
