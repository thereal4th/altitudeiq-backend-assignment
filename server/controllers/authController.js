const User = require('../models/userModel');
const password = require('../utils/password');
const { HttpError } = require('../utils/httpError');
const log = require('../utils/logger');

const USERNAME = /^[A-Za-z0-9_.-]{3,30}$/;
const MIN_PASSWORD = 8;
// Kept from the bcrypt days (bcrypt ignores bytes past 72, and legacy hashes are
// still verified with it); it also bounds the work per login.
const MAX_PASSWORD_BYTES = 72;

// Compared against when the username doesn't exist, so a failed login takes the
// same time either way and response timing doesn't reveal which usernames exist.
const dummyHash = password.hash('not-a-real-password');

const credentials = (body) => ({
  username: String(body.username || '').trim(),
  password: String(body.password || ''),
});

// Replace the session id on login so a pre-login session can't be reused.
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = user;
      resolve(user);
    });
  });
}

async function register(req, res) {
  const { username, password: plain } = credentials(req.body);
  if (!USERNAME.test(username)) {
    throw new HttpError(400, 'Username must be 3–30 characters: letters, numbers, dots, dashes or underscores');
  }
  if (plain.length < MIN_PASSWORD) throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  if (Buffer.byteLength(plain) > MAX_PASSWORD_BYTES) throw new HttpError(400, 'Password is too long');

  if (await User.findByUsername(username)) throw new HttpError(400, 'Username already taken');

  let user;
  try {
    user = await User.create(username, await password.hash(plain));
  } catch (err) {
    // Two sign-ups racing for the same name: the UNIQUE index decides.
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(400, 'Username already taken');
    throw err;
  }
  log.info('user_registered', { ...log.from(req), userId: user.id });
  res.status(201).json(await startSession(req, user));
}

async function login(req, res) {
  const { username, password: plain } = credentials(req.body);
  const user = await User.findByUsername(username);
  const valid = await password.verify(plain, user ? user.password_hash : await dummyHash);
  if (!user || !valid) {
    log.warn('login_failed', { ...log.from(req), username: username.slice(0, 30) });
    throw new HttpError(401, 'Invalid username or password');
  }
  // Upgrade legacy bcrypt (or outdated scrypt) hashes while we have the plain password.
  if (password.needsRehash(user.password_hash)) {
    try {
      await User.updateHash(user.id, await password.hash(plain));
    } catch (err) {
      log.error('rehash_failed', { ...log.from(req), userId: user.id, message: err.message });
    }
  }
  const sessionUser = await startSession(req, { id: user.id, username: user.username });
  log.info('login', { ...log.from(req), userId: user.id });
  res.json(sessionUser);
}

function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('wall.sid');
    res.json({ ok: true });
  });
}

function me(req, res) {
  res.json(req.session.user || null);
}

module.exports = { register, login, logout, me };
