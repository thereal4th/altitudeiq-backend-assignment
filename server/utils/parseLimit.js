const { HttpError } = require('./httpError');

const MAX_LIMIT = 50;

// Page size from the query string. Capped so no request can ask for an unbounded result.
function parseLimit(value, fallback = 20) {
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HttpError(400, `limit must be between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

module.exports = { parseLimit };
