const app = require('./app');
const db = require('./config/db');
const log = require('./utils/logger');
const purgeDeleted = require('./jobs/purgeDeleted');

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`The Wall running at http://localhost:${port}`);
});
purgeDeleted.start();

// Stop taking new connections, let in-flight requests finish, then close the DB.
let closing = false;
function shutdown(signal, code = 0) {
  if (closing) return;
  closing = true;
  log.info('shutdown', { signal });
  const force = setTimeout(() => process.exit(code || 1), 10_000).unref();
  server.close(async () => {
    await purgeDeleted.stop().catch(() => {});
    await app.locals.sessionStore.close().catch(() => {});
    await db.end().catch(() => {});
    clearTimeout(force);
    process.exit(code);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// After an unexpected error the process state can't be trusted: log it and exit
// (a process manager restarts the server) rather than limp on.
process.on('unhandledRejection', (err) => {
  log.error('unhandled_rejection', { message: err?.message, stack: err?.stack });
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  log.error('uncaught_exception', { message: err.message, stack: err.stack });
  shutdown('uncaughtException', 1);
});
