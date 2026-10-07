// main.js decides which screen to show and only then downloads that screen's
// code with import(). These tests watch the network to prove it.
const { test, expect, postMessage, card } = require('./fixtures');

// Records the pathnames of every /js/ module the page requests.
function watchScripts(page) {
  const loaded = [];
  page.on('request', (req) => {
    const { pathname } = new URL(req.url());
    if (pathname.startsWith('/js/')) loaded.push(pathname);
  });
  return loaded;
}

test('logged out: the login code loads, the feed code does not', async ({ page }) => {
  const loaded = watchScripts(page);
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  expect(loaded).toEqual(expect.arrayContaining(['/js/main.js', '/js/api.js', '/js/dom.js', '/js/auth.js']));
  for (const lazy of ['/js/feed.js', '/js/comments.js', '/js/editor.js']) expect(loaded).not.toContain(lazy);
});

test('logged in: the feed code loads, the login code does not', async ({ page, user }) => {
  const loaded = watchScripts(page);
  await page.goto('/');
  await expect(page.locator('#me')).toHaveText(user.username);
  await expect(page.locator('#feed article').first()).toBeVisible();
  expect(loaded).toEqual(expect.arrayContaining(['/js/feed.js', '/js/comments.js']));
  expect(loaded).not.toContain('/js/auth.js');
  expect(loaded).not.toContain('/js/editor.js');
});

test('the editor is only downloaded on the first click of Edit', async ({ page, user }) => {
  const msg = await postMessage(page, `split test ${Date.now()}`);
  const loaded = watchScripts(page);
  await page.goto('/');
  await expect(card(page, msg.id)).toBeVisible();
  expect(loaded).not.toContain('/js/editor.js');

  const editorRequest = page.waitForRequest((req) => req.url().endsWith('/js/editor.js'));
  await card(page, msg.id).getByRole('button', { name: 'Edit message' }).click();
  await editorRequest;
  await expect(card(page, msg.id).locator('textarea')).toHaveValue(msg.body);
});
