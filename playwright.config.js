// E2E tests: real browsers against a real server on :3100 (your dev server on
// :3000 can keep running). Run with `pnpm test:e2e`.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 3100;

module.exports = defineConfig({
  testDir: 'test/e2e',
  globalSetup: require.resolve('./test/e2e/global-setup.js'),
  globalTeardown: require.resolve('./test/e2e/global-teardown.js'),
  // One at a time: the tests share the dev database, and several check "the newest message".
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The closest thing to Safari on Windows; it exercises the manual scroll
    // anchoring written because Safari lacks overflow-anchor.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node server/index.js',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), RATE_LIMIT_LOGIN: '1000', RATE_LIMIT_REGISTER: '1000', RATE_LIMIT_WRITE: '1000', RATE_LIMIT_LIKE: '1000' },
  },
});
