// server/utils/password.js: scrypt hashing on Node's thread pool, with
// transparent support for the bcrypt hashes stored before the switch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const password = require('../../server/utils/password');

const B64 = '[A-Za-z0-9+/]+={0,2}';

test('hash() produces a self-describing scrypt string', async () => {
  const hash = await password.hash('correct horse battery');
  assert.match(hash, new RegExp(`^scrypt\\$16384\\$8\\$5\\$${B64}\\$${B64}$`));
});

test('hash() salts randomly, so the same password never hashes the same way twice', async () => {
  assert.notEqual(await password.hash('same'), await password.hash('same'));
});

test('verify() accepts the right password and rejects a wrong one', async () => {
  const hash = await password.hash('correct horse battery');
  assert.equal(await password.verify('correct horse battery', hash), true);
  assert.equal(await password.verify('correct horse batterz', hash), false);
  assert.equal(await password.verify('', hash), false);
});

test('verify() returns false for malformed hashes instead of throwing', async () => {
  for (const hash of ['', 'nonsense', 'scrypt$1$2', 'scrypt$16384$8$5$!!$!!', 'scrypt$abc$8$5$AAAA$AAAA', null, undefined]) {
    assert.equal(await password.verify('anything', hash), false, String(hash));
  }
});

test('verify() still accepts legacy bcrypt hashes', async () => {
  const legacy = await bcrypt.hash('password123', 4);
  assert.equal(await password.verify('password123', legacy), true);
  assert.equal(await password.verify('password124', legacy), false);
});

test('needsRehash() flags legacy bcrypt and outdated scrypt settings only', async () => {
  assert.equal(password.needsRehash(await bcrypt.hash('x', 4)), true);
  assert.equal(password.needsRehash('scrypt$1024$8$1$AAAA$AAAA'), true);
  assert.equal(password.needsRehash(await password.hash('x')), false);
});
