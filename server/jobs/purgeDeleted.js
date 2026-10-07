// Background cleanup for soft-deleted messages (see messageModel.remove).
//
// Deleting a message only sets deleted_at, so the request stays fast however
// big the thread is. This job then removes the comments in small batches and
// finally the message row itself. Batches are capped so one run never holds
// locks for long or competes with real traffic.
const db = require('../config/db');
const log = require('../utils/logger');

const BATCH = 5000;           // comments per DELETE statement
const MAX_PER_RUN = 10_000;   // rows removed per run, across all messages
const MESSAGES_PER_RUN = 10;
const INTERVAL_MS = 60_000;

// One bounded pass. Returns how many rows it removed (0 = nothing left to do).
async function runOnce() {
  let deleted = 0;
  const [messages] = await db.query(
    'SELECT id FROM messages WHERE deleted_at IS NOT NULL ORDER BY deleted_at LIMIT ?',
    [MESSAGES_PER_RUN]
  );
  for (const { id } of messages) {
    let threadEmpty = false;
    while (!threadEmpty && deleted < MAX_PER_RUN) {
      const [result] = await db.query(
        'DELETE FROM comments WHERE message_id = ? LIMIT ?',
        [id, Math.min(BATCH, MAX_PER_RUN - deleted)]
      );
      deleted += result.affectedRows;
      threadEmpty = result.affectedRows === 0 || deleted < MAX_PER_RUN && result.affectedRows < BATCH;
    }
    if (!threadEmpty) break; // out of budget for this run; continue next time
    const [result] = await db.query(
      'DELETE FROM messages WHERE id = ? AND deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM comments WHERE message_id = ?)',
      [id, id]
    );
    deleted += result.affectedRows;
  }
  return { deleted };
}

let timer = null;
let running = null;

function start() {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return; // a slow run is still going; skip this tick
    running = runOnce()
      .then(({ deleted }) => { if (deleted) log.info('purge_deleted', { deleted }); })
      .catch((err) => log.error('purge_failed', { message: err.message, stack: err.stack }))
      .finally(() => { running = null; });
  }, INTERVAL_MS);
  timer.unref(); // never keeps the process alive on its own
}

// Stops the timer and waits for an in-flight run, so shutdown can close the pool safely.
async function stop() {
  clearInterval(timer);
  timer = null;
  await running;
}

module.exports = { runOnce, start, stop };
