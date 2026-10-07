// One-time setup, run as a MySQL admin:
//   DB_ADMIN_USER=root DB_ADMIN_PASSWORD=... node db/setup.js [--reset]
// Creates the database, the least-privilege app user from .env, and the tables.
// --reset drops the tables first (deletes all data).
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
// Where the app connects from, as MySQL sees it. Locally that's localhost; when
// MySQL runs in a container (e.g. CI) connections arrive from another address,
// so set DB_APP_USER_HOST=% there.
const APP_HOST = process.env.DB_APP_USER_HOST || 'localhost';
const reset = process.argv.includes('--reset');

// schema.sql only creates missing tables; bring existing ones up to date.
// Each step checks first, so running setup again is harmless.
async function migrate(admin) {
  const has = async (sql) => (await admin.query(sql, [DB_NAME]))[0].length > 0;

  if (!await has("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'deleted_at'")) {
    // INSTANT: a metadata-only change, no table rebuild even with 100M rows.
    await admin.query('ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ALGORITHM=INSTANT');
    console.log('Migrated: messages.deleted_at');
  }
  // Likes and the "edited" marker. (The like tables themselves come from schema.sql.)
  const columns = [
    ['messages', 'like_count', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['messages', 'edited_at', 'TIMESTAMP NULL DEFAULT NULL'],
    ['comments', 'like_count', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['comments', 'edited_at', 'TIMESTAMP NULL DEFAULT NULL'],
  ];
  for (const [table, column, definition] of columns) {
    const [rows] = await admin.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [DB_NAME, table, column]
    );
    if (!rows.length) {
      await admin.query('ALTER TABLE ?? ADD COLUMN ?? ' + definition + ', ALGORITHM=INSTANT', [table, column]);
      console.log(`Migrated: ${table}.${column}`);
    }
  }
  if (!await has("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'messages' AND INDEX_NAME = 'idx_messages_deleted'")) {
    // Built online: reads and writes continue while the index is created.
    await admin.query('ALTER TABLE messages ADD INDEX idx_messages_deleted (deleted_at), ALGORITHM=INPLACE, LOCK=NONE');
    console.log('Migrated: idx_messages_deleted');
  }
}

async function main() {
  if (!process.env.DB_ADMIN_PASSWORD) throw new Error('Set DB_ADMIN_PASSWORD (and DB_ADMIN_USER if not root)');
  const admin = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: process.env.DB_ADMIN_USER || 'root',
    password: process.env.DB_ADMIN_PASSWORD,
    multipleStatements: true,
  });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`, [DB_NAME]);
    await admin.query('USE ??', [DB_NAME]);
    if (reset) await admin.query('DROP TABLE IF EXISTS comment_likes, message_likes, comments, messages, sessions, users');
    await admin.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await migrate(admin);

    // The app can read and write rows, nothing else: no DDL, no other databases.
    await admin.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [DB_USER, APP_HOST, DB_PASSWORD]);
    await admin.query('ALTER USER ?@? IDENTIFIED BY ?', [DB_USER, APP_HOST, DB_PASSWORD]);
    await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ??.* TO ?@?', [DB_NAME, DB_USER, APP_HOST]);
    console.log(`Ready: database "${DB_NAME}", app user "${DB_USER}"@${APP_HOST}${reset ? ' (tables reset)' : ''}`);
  } finally {
    await admin.end();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
