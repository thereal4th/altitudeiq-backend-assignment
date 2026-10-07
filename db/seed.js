// Seed the wall with fake data: node db/seed.js [messages=1000000]
// Rows are generated inside MySQL (INSERT ... SELECT from a recursive CTE), in
// batches, so Node never holds the data and 100M works the same way as 1M.
// Every seeded user's password is "password123" (user1 ... user1000).
const db = require('../server/config/db');
const password = require('../server/utils/password');

const TOTAL = Number(process.argv[2] || 1_000_000);
const USERS = 1000;
const BATCH = 50_000;
const PHRASES = ['Hello from the wall!', 'Anyone around today?', 'Coffee first, code second.', 'Just shipped a thing.', 'What is everyone reading?'];

async function seedUsers() {
  const hash = await password.hash('password123');
  const rows = Array.from({ length: USERS }, (_, i) => [`user${i + 1}`, hash]);
  await db.query('INSERT IGNORE INTO users (username, password_hash) VALUES ?', [rows]);
  // Messages pick a random id in [first, first + count), so the ids must be contiguous.
  const [[range]] = await db.query(
    "SELECT MIN(id) AS first, MAX(id) - MIN(id) + 1 AS span, COUNT(*) AS count FROM users WHERE username REGEXP '^user[0-9]+$'"
  );
  if (range.span !== range.count) throw new Error('Seed users are not contiguous; run `node db/setup.js --reset` first');
  return range;
}

async function seedBatch(conn, users, start, size) {
  // Messages: created_at increases with id, one second apart, ending now.
  const [result] = await conn.query(
    `INSERT INTO messages (user_id, body, created_at)
     WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     SELECT ? + FLOOR(RAND() * ?),
            CONCAT(ELT(1 + FLOOR(RAND() * 5), ?, ?, ?, ?, ?), ' (#', ? + n, ')'),
            NOW() - INTERVAL (? - (? + n)) SECOND
     FROM seq`,
    [size, users.first, users.count, ...PHRASES, start, TOTAL, start]
  );
  const firstId = result.insertId;
  const lastId = firstId + result.affectedRows - 1;

  // 0-4 comments per message (avg 2), picked deterministically from the id
  // so comment_count can be set to exactly the number inserted.
  await conn.query(
    `INSERT INTO comments (message_id, user_id, body, created_at)
     SELECT m.id, ? + (m.id * 31 + k.n * 17) % ?, CONCAT('Comment ', k.n, ' on #', m.id),
            LEAST(NOW(), m.created_at + INTERVAL k.n MINUTE)
     FROM messages m
     JOIN (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) k
       ON k.n <= (m.id * 7919) % 5
     WHERE m.id BETWEEN ? AND ?`,
    [users.first, users.count, firstId, lastId]
  );
  await conn.query(
    'UPDATE messages SET comment_count = (id * 7919) % 5 WHERE id BETWEEN ? AND ?',
    [firstId, lastId]
  );
}

async function main() {
  const users = await seedUsers();
  const conn = await db.getConnection();
  const started = Date.now();
  try {
    await conn.query('SET SESSION cte_max_recursion_depth = ?', [BATCH]);
    for (let done = 0; done < TOTAL; done += BATCH) {
      const size = Math.min(BATCH, TOTAL - done);
      await conn.beginTransaction();
      await seedBatch(conn, users, done, size);
      await conn.commit();
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      process.stdout.write(`\r${(done + size).toLocaleString()} / ${TOTAL.toLocaleString()} messages (${secs}s)`);
    }
    console.log('\nDone. Log in as user1 / password123');
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
    await db.end();
  }
}

main().catch((err) => { console.error('\n' + err.message); process.exit(1); });
