// Before the E2E run: remove anything a crashed earlier run left behind.
// Playwright runs global setup and teardown in the same process, so the pool
// stays open here and is closed by global-teardown.js.
const db = require('../../server/config/db');
const { cleanup } = require('../helpers/cleanup');

module.exports = async () => {
  await cleanup(db);
};
