// Browser modules that don't touch the DOM at import time can be tested in Node directly.
// public/js/package.json marks that folder as ES modules.
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { colorOf } from '../../public/js/dom.js';
import { api, friendly } from '../../public/js/api.js';

afterEach(() => mock.restoreAll());

test('colorOf gives each username a stable colour slot from 0 to 5', () => {
  assert.equal(colorOf('alice'), colorOf('alice'));
  const slots = new Set();
  for (let i = 0; i < 200; i++) {
    const slot = colorOf(`user${i}`);
    assert.ok(Number.isInteger(slot) && slot >= 0 && slot <= 5);
    slots.add(slot);
  }
  assert.equal(slots.size, 6, 'all six colours get used');
});

function mockFetch(status, body) {
  return mock.method(globalThis, 'fetch', async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

test('api() sends JSON to our own origin and returns the parsed body', async () => {
  const fetch = mockFetch(201, { id: 5 });
  assert.deepEqual(await api('POST', '/api/messages', { body: 'hi' }), { id: 5 });
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, '/api/messages');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, '{"body":"hi"}');
});

test('api() sends no body when there is no data', async () => {
  const fetch = mockFetch(200, {});
  await api('GET', '/api/me');
  assert.equal(fetch.mock.calls[0].arguments[1].body, undefined);
});

test("api() throws the server's error message on a failed response", async () => {
  mockFetch(403, { error: 'You can only edit your own messages' });
  await assert.rejects(api('PUT', '/api/messages/1', { body: 'x' }), { message: 'You can only edit your own messages' });
});

test('api() falls back to a generic message when the error body is not JSON', async () => {
  mockFetch(502, '<html>Bad Gateway</html>');
  await assert.rejects(api('GET', '/api/messages'), { message: 'Something went wrong' });
});

test('friendly() turns a network failure into an offline message', () => {
  assert.equal(friendly(new Error('Failed to fetch')), 'You appear to be offline. Try again.');
  assert.equal(friendly(new Error('Message is required')), 'Message is required');
});
