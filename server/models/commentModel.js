const db = require('../config/db');

const COLUMNS = `c.id, c.message_id, c.user_id, c.body, c.like_count, c.created_at, c.edited_at, u.username,
    EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = ?) AS liked_by_me`;

const withLiked = (rows) => rows.map((row) => ({ ...row, liked_by_me: !!row.liked_by_me }));

// The latest `perMessage` comments of each message, oldest first within a message.
// One small query per message, glued with UNION ALL: each reads `perMessage`
// entries of idx_comments_message backwards, even if the message has millions
// of comments. (A LATERAL join looks neater, but MySQL plans it with a filesort
// that reads the whole thread: 400 ms vs 4 ms on a 300k-comment message.)
async function previews(messageIds, perMessage, viewerId) {
  if (messageIds.length === 0) return [];
  const branch = `(SELECT ${COLUMNS}
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.message_id = ? ORDER BY c.id DESC LIMIT ?)`;
  const [rows] = await db.query(
    messageIds.map(() => branch).join(' UNION ALL '),
    messageIds.flatMap((id) => [viewerId, id, perMessage])
  );
  return withLiked(rows).sort((a, b) => a.message_id - b.message_id || a.id - b.id);
}

// Older comments of one message, newest first, keyset-paginated like messages.
// A deleted message's comments are hidden while they wait to be purged.
async function findPage(messageId, before, limit, viewerId) {
  const [rows] = await db.query(
    `SELECT ${COLUMNS}
     FROM comments c
     JOIN messages m ON m.id = c.message_id AND m.deleted_at IS NULL
     JOIN users u ON u.id = c.user_id
     WHERE c.message_id = ? ${before ? 'AND c.id < ?' : ''}
     ORDER BY c.id DESC LIMIT ?`,
    before ? [viewerId, messageId, before, limit] : [viewerId, messageId, limit]
  );
  return withLiked(rows);
}

// Bumps the message's comment_count and inserts the comment in one transaction.
// Returns null when the message doesn't exist or was deleted (the UPDATE matched nothing).
async function create(userId, messageId, body) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [bump] = await conn.query(
      'UPDATE messages SET comment_count = comment_count + 1 WHERE id = ? AND deleted_at IS NULL',
      [messageId]
    );
    if (bump.affectedRows === 0) {
      await conn.rollback();
      return null;
    }
    const [result] = await conn.query(
      'INSERT INTO comments (message_id, user_id, body) VALUES (?, ?, ?)',
      [messageId, userId, body]
    );
    await conn.commit();
    return { id: result.insertId };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// Returns { edited_at } when this user's comment on a live message was updated, else null.
// Same edited_at rule as messages: only a real change to the text moves it.
async function update(userId, id, body) {
  const [result] = await db.query(
    `UPDATE comments SET edited_at = IF(BINARY body = ?, edited_at, NOW()), body = ?
     WHERE id = ? AND user_id = ?
       AND EXISTS (SELECT 1 FROM messages m WHERE m.id = comments.message_id AND m.deleted_at IS NULL)`,
    [body, body, id, userId]
  );
  if (!result.affectedRows) return null;
  const [[row]] = await db.query('SELECT edited_at FROM comments WHERE id = ?', [id]);
  return { edited_at: row.edited_at };
}

// Deletes this user's comment and lowers the message's comment_count in one
// transaction. Its likes go with it (ON DELETE CASCADE). Returns true if deleted.
async function remove(userId, id) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Locks the comment row, so two quick deletes can't both lower the count.
    const [rows] = await conn.query(
      `SELECT c.message_id FROM comments c
       JOIN messages m ON m.id = c.message_id AND m.deleted_at IS NULL
       WHERE c.id = ? AND c.user_id = ? FOR UPDATE OF c`,
      [id, userId]
    );
    if (!rows.length) {
      await conn.rollback();
      return false;
    }
    await conn.query('DELETE FROM comments WHERE id = ?', [id]);
    await conn.query('UPDATE messages SET comment_count = comment_count - 1 WHERE id = ? AND comment_count > 0', [rows[0].message_id]);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { previews, findPage, create, update, remove };
