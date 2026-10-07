const { HttpError } = require('../utils/httpError');
const log = require('../utils/logger');

// body-parser errors carry a `type`; give them plain messages instead of parser internals.
const BODY_ERRORS = {
  'entity.parse.failed': 'Request body must be valid JSON',
  'entity.too.large': 'Request body is too large',
};

function notFound(req, res, next) {
  next(new HttpError(404, 'Not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    log.error('server_error', { ...log.from(req), status, message: err.message, stack: err.stack });
    return res.status(status).json({ error: 'Something went wrong', requestId: req.id });
  }
  res.status(status).json({ error: BODY_ERRORS[err.type] || err.message });
}

module.exports = { notFound, errorHandler };
