const { test, expect, postMessage, postComment, card } = require('./fixtures');

const unique = (label) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test('posting puts the message at the top of the feed', async ({ page, user }) => {
  await page.goto('/');
  const body = unique('hello from playwright');
  await page.locator('#post-body').fill(body);
  await page.getByRole('button', { name: 'Post', exact: true }).click();

  const first = page.locator('#feed article').first();
  await expect(first.locator('.msg-body')).toHaveText(body);
  await expect(first.locator('.you')).toHaveText('You');
  await expect(page.locator('#post-body')).toHaveValue('');

  await page.reload();
  await expect(page.locator('#feed article').first().locator('.msg-body')).toHaveText(body);
});

test('commenting adds the comment and updates the count', async ({ page, user }) => {
  const msg = await postMessage(page, unique('comment target'));
  await page.goto('/');
  const target = card(page, msg.id);
  await target.getByPlaceholder('Write a comment…').fill('first!');
  await target.getByRole('button', { name: 'Comment' }).click();
  await expect(target.locator('.comment')).toHaveCount(1);
  await expect(target.locator('.comment p')).toHaveText('first!');
  await expect(target.locator('.comments h2')).toHaveText('1 comment');
});

test('older comments load on request', async ({ page, user }) => {
  const msg = await postMessage(page, unique('long thread'));
  for (let i = 1; i <= 5; i++) await postComment(page, msg.id, `comment ${i}`);
  await page.goto('/');
  const target = card(page, msg.id);
  await expect(target.locator('.comment p')).toHaveText(['comment 3', 'comment 4', 'comment 5']);
  await target.getByRole('button', { name: 'View older comments (2)' }).click();
  await expect(target.locator('.comment p')).toHaveText(['comment 1', 'comment 2', 'comment 3', 'comment 4', 'comment 5']);
  await expect(target.getByRole('button', { name: /View older comments/ })).toBeHidden();
});

test('editing a message saves it; Escape and Cancel discard changes', async ({ page, user }) => {
  const original = unique('edit me');
  const msg = await postMessage(page, original);
  await page.goto('/');
  const target = card(page, msg.id);
  const edit = target.getByRole('button', { name: 'Edit message' });

  await edit.click();
  await target.locator('textarea').fill('never saved');
  await target.locator('textarea').press('Escape');
  await expect(target.locator('.msg-body')).toHaveText(original);

  await edit.click();
  await target.locator('textarea').fill('never saved either');
  await target.getByRole('button', { name: 'Cancel' }).click();
  await expect(target.locator('.msg-body')).toHaveText(original);

  await edit.click();
  await target.locator('textarea').fill('edited for real');
  await target.getByRole('button', { name: 'Save' }).click();
  await expect(target.locator('.msg-body')).toHaveText('edited for real');
  await page.reload();
  await expect(card(page, msg.id).locator('.msg-body')).toHaveText('edited for real');
});

test('an edited message shows "(edited)", and it survives a reload', async ({ page, user }) => {
  const msg = await postMessage(page, unique('mark me'));
  await page.goto('/');
  const target = card(page, msg.id);
  await expect(target.locator('.msg-head .edited')).toHaveCount(0);

  await target.getByRole('button', { name: 'Edit message' }).click();
  await target.locator('textarea').fill('now edited');
  await target.getByRole('button', { name: 'Save' }).click();
  await expect(target.locator('.msg-head .edited')).toHaveText('(edited)');

  await page.reload();
  await expect(card(page, msg.id).locator('.msg-head .edited')).toHaveText('(edited)');
});

test('liking a message toggles the heart and the count, and is remembered', async ({ page, user }) => {
  const msg = await postMessage(page, unique('like me'));
  await page.goto('/');
  const heart = card(page, msg.id).locator('.msg-foot .like');
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await expect(heart.locator('.like-count')).toHaveText('');

  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await expect(heart.locator('.like-count')).toHaveText('1');

  await page.reload();
  const again = card(page, msg.id).locator('.msg-foot .like');
  await expect(again).toHaveAttribute('aria-pressed', 'true');
  await expect(again.locator('.like-count')).toHaveText('1');

  await again.click();
  await expect(again).toHaveAttribute('aria-pressed', 'false');
  await expect(again.locator('.like-count')).toHaveText('');
});

test('a failed like is rolled back and an error is shown', async ({ page, user }) => {
  const msg = await postMessage(page, unique('like fails'));
  await page.goto('/');
  await page.route('**/api/messages/*/like', (route) => route.fulfill({ status: 500, json: { error: 'Something went wrong' } }));
  const heart = card(page, msg.id).locator('.msg-foot .like');
  await heart.click();
  await expect(page.locator('#app-error')).toBeVisible();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await expect(heart.locator('.like-count')).toHaveText('');
});

test('liking a comment works the same way', async ({ page, user }) => {
  const msg = await postMessage(page, unique('comment likes'));
  await postComment(page, msg.id, 'like this one');
  await page.goto('/');
  const heart = card(page, msg.id).locator('.comment .like');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await expect(heart.locator('.like-count')).toHaveText('1');
  await page.reload();
  await expect(card(page, msg.id).locator('.comment .like')).toHaveAttribute('aria-pressed', 'true');
});

test('you can edit your own comment, and it shows "(edited)"', async ({ page, user }) => {
  const msg = await postMessage(page, unique('edit a comment'));
  await postComment(page, msg.id, 'first draft');
  await page.goto('/');
  const target = card(page, msg.id);
  const comment = target.locator('.comment');

  await comment.getByRole('button', { name: 'Edit comment' }).click();
  await comment.locator('textarea').fill('second draft');
  await comment.getByRole('button', { name: 'Save' }).click();
  await expect(comment.locator('p')).toHaveText('second draft');
  await expect(comment.locator('.by .edited')).toHaveText('(edited)');

  await page.reload();
  await expect(card(page, msg.id).locator('.comment p')).toHaveText('second draft');
  await expect(card(page, msg.id).locator('.comment .by .edited')).toHaveText('(edited)');
});

test('deleting a comment takes two taps, then removes it and lowers the count', async ({ page, user }) => {
  const msg = await postMessage(page, unique('delete a comment'));
  await postComment(page, msg.id, 'keep me');
  await postComment(page, msg.id, 'remove me');
  await page.goto('/');
  const target = card(page, msg.id);
  await expect(target.locator('.comments h2')).toHaveText('2 comments');
  const doomed = target.locator('.comment', { hasText: 'remove me' });

  await doomed.getByRole('button', { name: 'Delete comment' }).click();
  await expect(doomed).toBeVisible(); // armed, nothing sent yet
  await doomed.getByRole('button', { name: 'Confirm: delete comment' }).click();
  await expect(target.locator('.comment')).toHaveCount(1);
  await expect(target.locator('.comment p')).toHaveText('keep me');
  await expect(target.locator('.comments h2')).toHaveText('1 comment');

  await page.reload();
  await expect(card(page, msg.id).locator('.comments h2')).toHaveText('1 comment');
});

test('Undo brings a deleted message back before anything is sent', async ({ page, user }) => {
  const msg = await postMessage(page, unique('undo me'));
  let deleteSent = false;
  page.on('request', (req) => { if (req.method() === 'DELETE') deleteSent = true; });
  await page.goto('/');

  await card(page, msg.id).getByRole('button', { name: 'Delete message' }).click();
  await expect(card(page, msg.id)).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, msg.id)).toBeVisible();
  expect(deleteSent).toBe(false);
});

test('a delete is committed once the 5-second undo window passes', async ({ page, user }) => {
  const msg = await postMessage(page, unique('delete me'));
  await page.clock.install(); // fake timers, so the test doesn't actually wait 5 s
  await page.goto('/');

  await card(page, msg.id).getByRole('button', { name: 'Delete message' }).click();
  await expect(page.locator('#toast')).toBeVisible();
  const deleted = page.waitForResponse((res) => res.request().method() === 'DELETE' && res.url().endsWith(`/api/messages/${msg.id}`));
  await page.clock.fastForward(5000);
  expect((await deleted).status()).toBe(200);
  await expect(page.locator('#toast')).toBeHidden();

  await page.reload();
  await expect(page.locator('#feed article').first()).toBeVisible();
  await expect(card(page, msg.id)).toHaveCount(0);
});
