// Shared Playwright fixtures. Import { test, expect } from here instead of
// '@playwright/test'.
const base = require('@playwright/test');
const db = require('../../server/config/db');
const { createUser } = require('../helpers/fixtures');

const { expect } = base;

const test = base.test.extend({
  // One DB pool per worker process, closed when the worker finishes.
  db: [async ({}, use) => {
    await use(db);
    await db.end();
  }, { scope: 'worker' }],

  // A fresh account that is NOT logged in.
  account: async ({ db: _db }, use) => {
    await use(await createUser());
  },

  // A fresh account, logged in. page.request shares the browser's cookies, so
  // the next page.goto('/') opens straight onto the feed.
  user: async ({ page, account }, use) => {
    const res = await page.request.post('/api/login', { data: { username: account.username, password: account.password } });
    expect(res.ok()).toBe(true);
    await use(account);
  },

  // Fails any test whose page hit a CSP violation or an uncaught JS error.
  pageProblems: [async ({ page }, use) => {
    const problems = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /content security policy|refused to/i.test(msg.text())) {
        const { url, lineNumber } = msg.location();
        problems.push(`${msg.text()} (at ${url || 'unknown'}:${lineNumber})`);
      }
    });
    page.on('pageerror', (err) => problems.push(`Uncaught: ${err.message}`));
    await use(problems);
    expect(problems, 'CSP violations or uncaught errors').toEqual([]);
  }, { auto: true }],
});

// API helpers that act as the logged-in user (they share the page's cookies).
async function postMessage(page, body) {
  const res = await page.request.post('/api/messages', { data: { body } });
  expect(res.status()).toBe(201);
  return res.json();
}

async function postComment(page, messageId, body) {
  const res = await page.request.post(`/api/messages/${messageId}/comments`, { data: { body } });
  expect(res.status()).toBe(201);
  return res.json();
}

const card = (page, id) => page.locator(`#feed article[data-id="${id}"]`);

module.exports = { test, expect, postMessage, postComment, card };
