// MySQL session store that doesn't write on every request.
//
// express-session calls store.touch() after every request whose session didn't
// change, to push the expiry back (we use a rolling 2-day idle timeout). The
// stock store turns each of those into an UPDATE, so every page view became a
// read plus a write. Here touch() only writes when the row is over an hour old;
// the stored expiry may lag the cookie by up to that hour.
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

// Takes the base class as a parameter so the throttling can be unit-tested
// against a fake store.
function throttleTouches(Store, minIntervalMs = TOUCH_INTERVAL_MS) {
  return class ThrottledStore extends Store {
    set(sid, data, callback) {
      data.touchedAt = Date.now();
      return super.set(sid, data, callback);
    }

    touch(sid, data, callback) {
      if (Date.now() - (data.touchedAt || 0) < minIntervalMs) {
        callback?.(null);
        return Promise.resolve();
      }
      // A full set() so the new touchedAt is stored along with the new expiry.
      return this.set(sid, data, callback);
    }
  };
}

function createSessionStore(db, { expiration }) {
  const Store = throttleTouches(MySQLStore);
  return new Store({
    createDatabaseTable: false, // db/schema.sql creates it; the app user has no DDL rights
    clearExpired: true,
    expiration,
  }, db);
}

module.exports = { throttleTouches, createSessionStore };
