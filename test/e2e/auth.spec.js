const { test, expect } = require('./fixtures');
const { uniqueName, PASSWORD } = require('../helpers/fixtures');
const { recordUser } = require('../helpers/cleanup');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
});

test('logging in with the right password opens the feed', async ({ page, account }) => {
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(account.password);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#me')).toHaveText(account.username);
  await expect(page.locator('#auth')).toBeHidden();
});

test('a wrong password shows an error and stays on the login screen', async ({ page, account }) => {
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill('not the password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-error')).toBeVisible();
  await expect(page.locator('#auth-error-text')).toHaveText('Invalid username or password');
  await expect(page.locator('#app')).toBeHidden();
});

test('creating an account signs you straight in', async ({ page }) => {
  const username = uniqueName();
  await page.locator('#tab-register').click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm').fill(PASSWORD);
  const registered = page.waitForResponse((res) => res.url().endsWith('/api/register'));
  await page.locator('#auth-submit').click();
  const res = await registered;
  if (res.status() === 201) recordUser((await res.json()).id);
  expect(res.status()).toBe(201);
  await expect(page.locator('#me')).toHaveText(username);
});

test('mismatched passwords are caught before anything is sent', async ({ page }) => {
  let sent = false;
  page.on('request', (req) => { if (req.url().endsWith('/api/register')) sent = true; });
  await page.locator('#tab-register').click();
  await page.locator('#username').fill(uniqueName());
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm').fill(PASSWORD + 'x');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#confirm-error')).toBeVisible();
  await expect(page.locator('#confirm')).toHaveAttribute('aria-invalid', 'true');
  expect(sent).toBe(false);
});

test('each password field has its own Show/Hide button', async ({ page }) => {
  await page.locator('#tab-register').click();
  const showPassword = page.getByRole('button', { name: 'Show password', exact: true });
  const showConfirm = page.getByRole('button', { name: 'Show confirm password' });

  await showPassword.click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await expect(page.locator('#confirm')).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toHaveText('Hide');

  await showConfirm.click();
  await expect(page.locator('#confirm')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  await expect(page.locator('#confirm')).toHaveAttribute('type', 'text');
});
