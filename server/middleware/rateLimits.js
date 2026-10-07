const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const log = require('../utils/logger');

// In-memory counters: fine for one process. With several instances, give each
// limiter a shared store (e.g. Redis) so the limits hold across them.
function limiter(name, { windowMs, limit, key, ...options }) {
  return rateLimit({
    windowMs,
    limit,
    ...options,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: key,
    handler(req, res) {
      log.warn('rate_limited', { ...log.from(req), limiter: name });
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    },
  });
}

const ip = (req) => ipKeyGenerator(req.ip);

// Limits can be overridden through env (the test suites raise them); the
// defaults are the production values.
function envLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

module.exports = {
  // Per IP + username: slows password guessing against one account without
  // letting one attacker lock everyone else out.
  login: limiter('login', {
    windowMs: 15 * 60 * 1000,
    limit: envLimit('RATE_LIMIT_LOGIN', 10),
    skipSuccessfulRequests: true, // only failed attempts count
    key: (req) => `${ip(req)}:${String(req.body?.username || '').trim().toLowerCase()}`,
  }),
  // Caps accounts created per IP; rejected sign-ups (typos, taken names) don't count.
  register: limiter('register', {
    windowMs: 60 * 60 * 1000,
    limit: envLimit('RATE_LIMIT_REGISTER', 5),
    skipFailedRequests: true,
    key: ip,
  }),
  // Writes are behind requireLogin, so key by user.
  write: limiter('write', {
    windowMs: 60 * 1000,
    limit: envLimit('RATE_LIMIT_WRITE', 30),
    key: (req) => `user:${req.session.user.id}`,
  }),
  // Likes are one tap each and get tapped often, so they have their own, higher
  // budget and don't use up the write limit.
  like: limiter('like', {
    windowMs: 60 * 1000,
    limit: envLimit('RATE_LIMIT_LIKE', 120),
    key: (req) => `user:${req.session.user.id}`,
  }),
};
