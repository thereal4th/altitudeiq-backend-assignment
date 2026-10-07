const db = require('../config/db');

async function findByUsername(username) {
  const [rows] = await db.query(
    'SELECT id, username, password_hash FROM users WHERE username = ?',
    [username]
  );
  return rows[0] || null;
}

async function create(username, passwordHash) {
  const [result] = await db.query(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    [username, passwordHash]
  );
  return { id: result.insertId, username };
}

async function updateHash(id, passwordHash) {
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

module.exports = { findByUsername, create, updateHash };
