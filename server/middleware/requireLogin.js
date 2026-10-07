const { HttpError } = require('../utils/httpError');

// Fails closed: anything other than a session with a user id is treated as logged out.
module.exports = function requireLogin(req, res, next) {
  if (!req.session?.user?.id) return next(new HttpError(401, 'Please log in'));
  next();
};
