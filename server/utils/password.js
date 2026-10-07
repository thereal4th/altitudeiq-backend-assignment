// Password hashing with Node's built-in scrypt. Unlike bcryptjs (pure JavaScript
// on the main thread), crypto.scrypt runs on libuv's thread pool, so a login
// never stalls other requests.
//
// Stored format: scrypt$N$r$p$<salt base64>$<key base64>, so the parameters can
// be raised later and old hashes still verify (and get flagged by needsRehash).
// Hashes from before the switch are bcrypt ("$2...") and are still accepted.
const crypto = require('crypto');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');

const scrypt = promisify(crypto.scrypt);

// OWASP-listed scrypt parameters: N=2^14, r=8, p=5 (about 16 MiB per hash).
const N = 16384;
const R = 8;
const P = 5;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEM = 32 * 1024 * 1024; // must exceed 128 * N * R
const MAX_N = 2 ** 20; // refuse absurd parameters from a corrupted row

async function hash(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEM });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

function parse(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0) || n > MAX_N) return null;
  const salt = Buffer.from(parts[4], 'base64');
  const key = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || key.length === 0) return null;
  return { n, r, p, salt, key };
}

const isBcrypt = (stored) => typeof stored === 'string' && /^\$2[aby]\$/.test(stored);

async function verify(password, stored) {
  if (isBcrypt(stored)) return bcrypt.compare(password, stored).catch(() => false);
  const parsed = parse(stored);
  if (!parsed) return false;
  try {
    const key = await scrypt(password, parsed.salt, parsed.key.length, {
      N: parsed.n, r: parsed.r, p: parsed.p, maxmem: 128 * parsed.n * parsed.r * 2,
    });
    return crypto.timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}

// True when the stored hash should be replaced on the next successful login.
function needsRehash(stored) {
  const parsed = parse(stored);
  return !parsed || parsed.n !== N || parsed.r !== R || parsed.p !== P;
}

module.exports = { hash, verify, needsRehash };
