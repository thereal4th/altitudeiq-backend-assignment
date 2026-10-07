const db = require('../config/db');

// liked_by_me is a primary-key lookup on message_likes, so it costs one index probe per row.
const COLUMNS = `m.id, m.user_id, m.body, m.comment_count, m.like_count, m.created_at, m.edited_at, u.username,
  EXISTS (SELECT 1 FROM message_likes l WHERE l.message_id = m.id AND l.user_id = ?) AS liked_by_me`;

const withLiked = (rows) => rows.map((row) => ({ ...row, liked_by_me: !!row.liked_by_me }));

// Keyset pagination on the clustered primary key: "id < cursor ORDER BY id DESC
// LIMIT n" jumps straight to the cursor in the index and reads n rows, so a page
// costs the same at row 100 as at row 100,000,000. Never OFFSET, never COUNT(*).
// Newest first. `before` pages towards older messages, `after` back towards newer.
// Soft-deleted messages are skipped; the purge job removes them for good.
async function findPage({ before, after, limit, viewerId }) {
  if (after) {
    const [rows] = await db.query(
      `SELECT ${COLUMNS} FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.id > ? AND m.deleted_at IS NULL ORDER BY m.id ASC LIMIT ?`,
      [viewerId, after, limit]
    );
    return withLiked(rows.reverse());
  }
  const [rows] = await db.query(
    `SELECT ${COLUMNS} FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.deleted_at IS NULL ${before ? 'AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT ?`,
    before ? [viewerId, before, limit] : [viewerId, limit]
  );
  return withLiked(rows);
}

async function create(userId, body) {
  const [result] = await db.query(
    'INSERT INTO messages (user_id, body) VALUES (?, ?)',
    [userId, body]
  );
  return { id: result.insertId };
}

// Returns { edited_at } when a row belonging to this user was updated, else null.
// edited_at only moves when the text really changed (BINARY: a case-only edit counts).
// Assignments in a single-table UPDATE run left to right, so edited_at sees the old body.
async function update(userId, id, body) {
  const [result] = await db.query(
    `UPDATE messages SET edited_at = IF(BINARY body = ?, edited_at, NOW()), body = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [body, body, id, userId]
  );
  if (!result.affectedRows) return null;
  const [[row]] = await db.query('SELECT edited_at FROM messages WHERE id = ?', [id]);
  return { edited_at: row.edited_at };
}

// A soft delete: one row update however many comments the message has. A real
// DELETE would cascade through the whole thread inside this request.
// Returns true when a row belonging to this user was deleted.
async function remove(userId, id) {
  const [result] = await db.query(
    'UPDATE messages SET deleted_at = NOW() WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    [id, userId]
  );
  return result.affectedRows > 0;
}

module.exports = { findPage, create, update, remove };
