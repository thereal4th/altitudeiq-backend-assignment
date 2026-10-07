// JSON-lines logger for security events and errors. Callers pass only
// non-sensitive fields: never passwords, cookies, session ids or message bodies.
function write(level, event, fields) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

// Common request context: who, from where, which request.
const from = (req) => ({ requestId: req.id, ip: req.ip, userId: req.session?.user?.id, method: req.method, path: req.originalUrl });

module.exports = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  from,
};
