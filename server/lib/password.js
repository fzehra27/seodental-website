'use strict';
const crypto = require('node:crypto');

// scrypt (RFC 7914) from Node's crypto — OWASP-accepted password hashing.
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64, MAXMEM = 128 * 1024 * 1024;

function scrypt(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => err ? reject(err) : resolve(key));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), +n, +r, +p);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Used to keep response time similar when the account does not exist.
let dummy;
async function verifyAgainstDummy(password) {
  dummy = dummy || await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummy);
}

module.exports = { hashPassword, verifyPassword, verifyAgainstDummy };
