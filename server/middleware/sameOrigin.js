const { HttpError } = require('../utils/httpError');
const log = require('../utils/logger');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF defense for the JSON API, on top of the SameSite cookie: a state-changing
// request must come from this origin and carry a JSON body, which a cross-site
// HTML form can't send.
module.exports = function sameOrigin(req, res, next) {
  if (SAFE.has(req.method)) return next();

  const site = req.get('sec-fetch-site');
  const origin = req.get('origin');
  const expected = `${req.protocol}://${req.get('host')}`;
  const crossSite = site ? !['same-origin', 'none'].includes(site) : origin && origin !== expected;
  if (crossSite) {
    log.warn('csrf_rejected', { ...log.from(req), origin, site });
    return next(new HttpError(403, 'Cross-site request blocked'));
  }

  if (req.headers['content-length'] > 0 || req.headers['transfer-encoding']) {
    if (!req.is('application/json')) return next(new HttpError(415, 'Expected application/json'));
  }
  next();
};
