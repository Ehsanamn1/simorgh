import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, normalizeUsername, verifyPassword } from './server.mjs';

test('normalizes valid Persian and Latin usernames consistently', () => {
  assert.equal(normalizeUsername('  Ehsan.AMN  '), 'ehsan.amn');
  assert.equal(normalizeUsername('کاربر_۱۲'), 'کاربر_۱۲');
});

test('rejects malformed usernames before database access', () => {
  for (const value of ['', 'ab', '.starts', 'ends-', 'double..dot', 'has space', 'bad/name', 'x'.repeat(33), null, 12]) {
    assert.equal(normalizeUsername(value), null, String(value));
  }
});

test('PBKDF2 password hashes verify without storing the plaintext', async () => {
  const password = 'a-very-strong-test-password';
  const encoded = await hashPassword(password);
  assert.match(encoded, /^pbkdf2_sha256\$100000\$/);
  assert.notEqual(encoded, password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword(password + '-wrong', encoded), false);
});

test('rejects malformed and unsupported password hash formats', async () => {
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(await verifyPassword('anything', 'pbkdf2_sha256$1$c2FsdA==$aGFzaA=='), false);
  assert.equal(await verifyPassword('anything', 'scrypt$100000$c2FsdA==$aGFzaA=='), false);
});
