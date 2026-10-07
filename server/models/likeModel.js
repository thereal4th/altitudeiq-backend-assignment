const db = require('../config/db');

// Likes work the same for messages and comments, so one function serves both.
// The SQL below is built only from these constants, never from request input.
//   alive:  reads the current like_count of an item that can still be liked
//           (a deleted message, or a comment on one, can't be).
//   lock:   the same read, but it also locks the item's row (see set()).
//   counts: the table holding like_count.
const MESSAGE_ALIVE = 'SELECT like_count FROM messages WHERE id = ? AND deleted_at IS NULL';
const COMMENT_ALIVE = `SELECT c.like_count FROM comments c
  JOIN messages m ON m.id = c.message_id AND m.deleted_at IS NULL
  WHERE c.id = ?`;
const TARGETS = {
  message: {
    likes: 'message_likes',
    key: 'message_id',
    counts: 'messages',
    alive: MESSAGE_ALIVE,
    lock: MESSAGE_ALIVE + ' FOR UPDATE',
  },
  comment: {
    likes: 'comment_likes',
    key: 'comment_id',
    counts: 'comments',
    alive: COMMENT_ALIVE,
    lock: COMMENT_ALIVE + ' FOR UPDATE OF c', // locks the comment row, not the message
  },
};

// Likes (liked = true) or unlikes the item for this user. Idempotent: liking
// twice leaves one like. The like row and the stored total change in one
// transaction, so like_count always equals the number of rows.
// Returns { liked, like_count }, or null when the item doesn't exist.
async function set(target, userId, id, liked) {
  const { likes, key, counts, alive, lock } = TARGETS[target];
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Lock the item's row first. Every like or unlike of one item then queues here,
    // always in the same order (item row, then like row). Without this, two
    // simultaneous requests could each hold one lock and wait for the other's,
    // and MySQL would abort one of them with a deadlock.
    const [found] = await conn.query(lock, [id]);
    if (!found.length) {
      await conn.rollback();
      return null;
    }

    // The primary key (item, user) makes the INSERT a no-op the second time;
    // affectedRows says whether anything really changed.
    const [change] = liked
      ? await conn.query(`INSERT IGNORE INTO ${likes} (${key}, user_id) VALUES (?, ?)`, [id, userId])
      : await conn.query(`DELETE FROM ${likes} WHERE ${key} = ? AND user_id = ?`, [id, userId]);
    if (change.affectedRows) {
      await conn.query(
        liked
          ? `UPDATE ${counts} SET like_count = like_count + 1 WHERE id = ?`
          : `UPDATE ${counts} SET like_count = like_count - 1 WHERE id = ? AND like_count > 0`,
        [id]
      );
    }

    const [[row]] = await conn.query(alive, [id]);
    await conn.commit();
    return { liked, like_count: row.like_count };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { set };
