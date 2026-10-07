// Starts the real app on a random port for an integration test file.
// Each node:test file runs in its own process, so env set here (e.g. low rate
// limits) applies only to that file.
const { before, after } = require('node:test');
const { cleanup } = require('./cleanup');

const TEST_ENV = { RATE_LIMIT_LOGIN: '1000', RATE_LIMIT_REGISTER: '1000', RATE_LIMIT_WRITE: '1000', RATE_LIMIT_LIKE: '1000' };

// Call at the top of a test file. Registers before/after hooks and returns an
// object whose `base` (e.g. http://localhost:51234) is filled in once started.
function useApp(env = {}) {
  Object.assign(process.env, TEST_ENV, env); // must happen before the app is required
  const app = require('../../server/app');
  const db = require('../../server/config/db');
  const ctx = { app, db, base: null };
  let server;

  before(async () => {
    await cleanup(db); // leftovers from a crashed earlier run
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    ctx.base = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await cleanup(db);
    await app.locals.sessionStore.close();
    await db.end();
  });

  return ctx;
}

module.exports = { useApp, TEST_ENV };
