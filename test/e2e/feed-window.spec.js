// The feed keeps at most 5 pages (100 cards) in the DOM however far you scroll,
// dropping pages at one end as it loads at the other. These tests scroll through
// the real 1M-message dev data.
const { test, expect } = require('./fixtures');

const MAX_CARDS = 100;
const articles = (page) => page.locator('#feed article');
const isOlderPage = (url) => url.pathname === '/api/messages' && url.searchParams.has('before');

const cardIds = (page) => page.$$eval('#feed article', (els) => els.map((el) => Number(el.dataset.id)));
const lastCardId = async (page) => (await cardIds(page)).at(-1);

// Scrolls to the bottom and waits for the next older page to arrive.
async function loadOlderPage(page) {
  const before = await lastCardId(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => lastCardId(page)).not.toBe(before);
  await expect(page.locator('#feed')).toHaveAttribute('aria-busy', 'false');
}

async function newestMessageId(page) {
  const res = await page.request.get('/api/messages?limit=1');
  return (await res.json()).messages[0].id;
}

// Holds the next ?before= request until release() is called.
async function holdNextOlderPage(page) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route((url) => isOlderPage(url), async (route) => { await gate; await route.continue(); }, { times: 1 });
  return release;
}

function assertNewestFirst(ids) {
  for (let i = 1; i < ids.length; i++) expect(ids[i], `card ${i} is older than card ${i - 1}`).toBeLessThan(ids[i - 1]);
}

test.beforeEach(async ({ page, user }) => {
  await page.goto('/');
  await expect(articles(page)).toHaveCount(20);
});

test('scrolling loads older pages but never keeps more than 100 cards', async ({ page }) => {
  for (let i = 0; i < 8; i++) {
    await loadOlderPage(page);
    expect(await articles(page).count()).toBeLessThanOrEqual(MAX_CARDS);
  }
  await expect(articles(page)).toHaveCount(MAX_CARDS);
  assertNewestFirst(await cardIds(page));
  await expect(page.locator('#newer')).toBeVisible();
});

test('"Back to newest" returns to the top of the wall', async ({ page }) => {
  for (let i = 0; i < 6; i++) await loadOlderPage(page);
  await expect(page.locator('#newer')).toBeVisible();

  await page.getByRole('button', { name: 'Back to newest messages' }).click();
  await expect.poll(async () => (await cardIds(page))[0]).toBe(await newestMessageId(page));
  await expect(page.locator('#newer')).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the view does not jump when a page is dropped off the top', async ({ page }) => {
  for (let i = 0; i < 4; i++) await loadOlderPage(page);
  await expect(articles(page)).toHaveCount(MAX_CARDS); // the next load drops a page

  const release = await holdNextOlderPage(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight - window.innerHeight * 1.5));
  // Pick the card in the middle of the screen and note where it is.
  const anchorId = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest('article').dataset.id);
  const anchor = page.locator(`#feed article[data-id="${anchorId}"]`);
  const topBefore = await anchor.evaluate((el) => el.getBoundingClientRect().top);

  const firstBefore = (await cardIds(page))[0];
  release();
  await expect.poll(async () => (await cardIds(page))[0]).not.toBe(firstBefore); // top page dropped
  const topAfter = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(topAfter - topBefore)).toBeLessThan(2);
});

test('"Back to newest" during a slow page load still ends on the newest messages', async ({ page }) => {
  for (let i = 0; i < 6; i++) await loadOlderPage(page);
  await expect(page.locator('#newer')).toBeVisible();

  // Start loading an older page, but hold its response...
  const release = await holdNextOlderPage(page);
  const requested = page.waitForRequest((req) => isOlderPage(new URL(req.url())));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await requested;

  // ...jump back to the newest while it's in flight, then let the stale response arrive.
  await page.getByRole('button', { name: 'Back to newest messages' }).click();
  release();

  const newest = await newestMessageId(page);
  await expect.poll(async () => (await cardIds(page))[0]).toBe(newest);
  await page.waitForTimeout(500); // give a stale response time to (wrongly) land
  const ids = await cardIds(page);
  expect(ids[0]).toBe(newest);
  assertNewestFirst(ids);
});
