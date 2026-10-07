// Tests run against the dev database, so every row they create must be removed
// again. Each test user's id is appended to test/.cleanup.jsonl the moment it is
// created, so even a crashed or interrupted run leaves a record that the next
// run's cleanup() picks up. Only recorded ids are ever deleted: seeded users and
// real accounts are never touched.
const fs = require('fs');
const path = require('path');

const REGISTRY = path.join(__dirname, '..', '.cleanup.jsonl');

// appendFileSync of one short line is safe even with parallel Playwright workers.
function recordUser(id) {
  fs.appendFileSync(REGISTRY, JSON.stringify({ user: id }) + '\n');
}

function recordedUserIds() {
  if (!fs.existsSync(REGISTRY)) return [];
  return fs.readFileSync(REGISTRY, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).user);
}

// Deletes the recorded users' sessions, then the users. The foreign keys cascade
// to their messages and comments. Tests only comment on test users' messages,
// so no seeded message's comment_count is left wrong.
async function cleanup(db) {
  const ids = recordedUserIds();
  if (ids.length) {
    await db.query("DELETE FROM sessions WHERE JSON_EXTRACT(data, '$.user.id') IN (?)", [ids]);
    await db.query('DELETE FROM users WHERE id IN (?)', [ids]);
  }
  fs.rmSync(REGISTRY, { force: true });
  return ids.length;
}

module.exports = { recordUser, cleanup };
