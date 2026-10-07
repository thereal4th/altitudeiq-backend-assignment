// After the E2E run: delete every user the tests created (their messages,
// comments and sessions go with them).
const db = require('../../server/config/db');
const { cleanup } = require('../helpers/cleanup');

module.exports = async () => {
  const removed = await cleanup(db);
  console.log(`Cleaned up ${removed} test user(s).`);
  await db.end();
};
