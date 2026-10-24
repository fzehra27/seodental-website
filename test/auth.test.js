'use strict';
// Runs the REAL server + a REAL SQLite file. No email/SMS provider is configured here.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dbFile = path.join(os.tmpdir(), `seodental-test-${process.pid}.sqlite`);
process.env.DATABASE_FILE = dbFile;
process.env.APP_SECRET = 'x'.repeat(40);
process.env.EMAIL_PROVIDER = 'none';
process.env.SMS_PROVIDER = 'none';
delete process.env.NODE_ENV;

const { createServer } = require('../server/index.js');
const db = require('../server/db');
const { start } = require('./helpers');

const GOOD = 'Kopru-2026-guvenli';
let app;
test.before(async () => { app = await start(createServer); });
test.after(async () => { await app.close(); db.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true }); });

const reg = (c, o = {}) => c.call('POST', '/api/auth/register', { method: 'email', fullName: 'Ayşe Yılmaz', identifier: 'ayse@example.com', password: GOOD, passwordConfirm: GOOD, ...o });

test('1+2+3: e-mail registration stores a user with a scrypt hash, never the password', async () => {
  const c = app.client();
  const r = await reg(c);
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'ayse@example.com');
  assert.equal(r.data.user.emailVerified, false);                    // not claimed verified
  assert.equal(r.data.verification.status, 'not_configured');        // honest: nothing was sent
  const row = db.get().prepare('SELECT * FROM users WHERE email = ?').get('ayse@example.com');
  assert.ok(row, 'row exists in database');
  assert.match(row.password_hash, /^scrypt\$32768\$8\$1\$/);
  assert.ok(!JSON.stringify(row).includes(GOOD), 'plaintext password not stored anywhere in the row');
  assert.equal(row.email_verified_at, null);
  assert.equal(row.role, 'customer');
  assert.ok(row.created_at && row.updated_at);
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM verification_codes').get().n, 0, 'undelivered code discarded');
  assert.ok(!JSON.stringify(r.data).includes('password_hash'));
});

test('phone registration normalises number (05xx → +905xx)', async () => {
  const c = app.client();
  const r = await reg(c, { method: 'phone', identifier: '0532 123 45 67', fullName: 'Mehmet Demir' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.phone, '+905321234567');
  assert.equal(r.data.user.email, null);
  assert.equal(r.data.user.phoneVerified, false);
  assert.equal(r.data.verification.channel, 'phone');
  assert.equal(r.data.verification.status, 'not_configured');
});

test('4: duplicate e-mail (any case) and duplicate phone (any notation) are rejected', async () => {
  const a = await reg(app.client(), { identifier: 'AYSE@Example.com' });
  assert.equal(a.status, 409);
  assert.match(a.data.error.fields.identifier, /zaten var/);
  const b = await reg(app.client(), { method: 'phone', identifier: '+90 532 123 45 67', fullName: 'Başka Kişi' });
  assert.equal(b.status, 409);
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM users').get().n, 2);
});

test('5: invalid registration data is rejected with Turkish messages', async () => {
  const c = app.client();
  const cases = [
    [{ fullName: '' }, 'fullName'], [{ fullName: 'Tek' }, 'fullName'],
    [{ identifier: 'not-an-email' }, 'identifier'], [{ identifier: '' }, 'identifier'],
    [{ method: 'phone', identifier: '12345' }, 'identifier'], [{ method: 'phone', identifier: 'abc' }, 'identifier'],
    [{ method: 'sms' }, 'identifier'],
    [{ password: 'short1', passwordConfirm: 'short1' }, 'password'],
    [{ password: 'onlyletterslong', passwordConfirm: 'onlyletterslong' }, 'password'],
    [{ password: '12345678901', passwordConfirm: '12345678901' }, 'password'],
    [{ password: 'password123', passwordConfirm: 'password123' }, 'password'],
    [{ passwordConfirm: 'Different-2026x' }, 'passwordConfirm'], [{ passwordConfirm: '' }, 'passwordConfirm']
  ];
  for (const [override, field] of cases) {
    const r = await reg(c, { identifier: 'new@example.com', ...override });
    assert.equal(r.status, 400, JSON.stringify(override));
    assert.ok(r.data.error.fields[field], `${field} error for ${JSON.stringify(override)}`);
  }
  const weak = await reg(c, { identifier: 'new@example.com', password: 'abc', passwordConfirm: 'abc' });
  assert.equal(weak.data.error.fields.password, 'Şifre en az 10 karakter olmalıdır.');
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM users').get().n, 2, 'nothing was stored');
  const bad = await c.call('POST', '/api/auth/register', 'not json');
  assert.equal(bad.status, 400);
  const wrongType = await c.call('POST', '/api/auth/register', '{}', { 'Content-Type': 'text/plain' });
  assert.equal(wrongType.status, 415);
});

test('6+9: login works, cookie is HttpOnly, session survives refresh (new request with cookie)', async () => {
  const c = app.client();
  const r = await c.call('POST', '/api/auth/login', { identifier: 'Ayse@Example.com', password: GOOD });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.fullName, 'Ayşe Yılmaz');
  assert.match(r.setCookie[0], /HttpOnly/);
  assert.match(r.setCookie[0], /SameSite=Lax/);
  c.csrf = r.data.csrfToken;
  // "page refresh": a fresh session-status call carrying only the cookie
  const s = await c.call('GET', '/api/auth/session');
  assert.equal(s.data.authenticated, true);
  assert.equal(s.data.user.email, 'ayse@example.com');
  // sessions table stores only a hash of the cookie token
  const token = Object.values(c.jar)[0];
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM sessions WHERE id = ?').get(token).n, 0);
  // phone login in several notations
  const p = app.client();
  const pr = await p.call('POST', '/api/auth/login', { identifier: '532-123-45-67'.replace(/^/, '0'), password: GOOD });
  assert.equal(pr.status, 200);
  assert.equal(pr.data.user.phone, '+905321234567');
});

test('7: invalid credentials are rejected with one generic message', async () => {
  const c = app.client();
  const wrongPw = await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: 'Wrong-password-1' });
  const noUser = await c.call('POST', '/api/auth/login', { identifier: 'nobody@example.com', password: GOOD });
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPw.data.error.message, noUser.data.error.message);
  assert.equal(Object.keys(c.jar).length, 0, 'no cookie issued');
  const malformed = await c.call('POST', '/api/auth/login', { identifier: '', password: '' });
  assert.equal(malformed.status, 400);
});

test('10+11: protected data needs a session; a user only ever sees their own record', async () => {
  const anon = app.client();
  assert.equal((await anon.call('GET', '/api/account')).status, 401);
  assert.equal((await anon.call('GET', '/api/auth/session')).data.authenticated, false);
  assert.equal((await anon.call('POST', '/api/account/verify', { code: '123456' })).status, 401);
  // forged / guessed cookies
  const forged = app.client(); forged.jar.sid = 'A'.repeat(43);
  assert.equal((await forged.call('GET', '/api/account')).status, 401);

  const a = app.client(), b = app.client();
  const ra = await a.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD }); a.csrf = ra.data.csrfToken;
  const rb = await reg(b, { identifier: 'bob@example.com', fullName: 'Bob Kaya' }); b.csrf = rb.data.csrfToken;
  const ma = await a.call('GET', '/api/account'), mb = await b.call('GET', '/api/account');
  assert.equal(ma.data.user.email, 'ayse@example.com');
  assert.equal(mb.data.user.email, 'bob@example.com');
  assert.ok(!JSON.stringify(ma.data).includes('bob@example.com'));
  // there is no endpoint that takes a user id
  for (const p of ['/api/account/1', '/api/account/2', '/api/users', '/api/users/1', '/api/account?id=2']) {
    const r = await a.call('GET', p);
    assert.ok(r.status === 404 || (p.includes('?id=') && r.data.user.email === 'ayse@example.com'), p);
  }
  // Another user's CSRF token cannot be used with my session
  const cross = await a.call('POST', '/api/auth/logout', {}, { 'X-CSRF-Token': b.csrf });
  assert.equal(cross.status, 403);
  assert.equal((await a.call('GET', '/api/account')).status, 200, 'session untouched');
});

test('8: logout invalidates the session server-side (old cookie no longer works)', async () => {
  const c = app.client();
  const r = await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD }); c.csrf = r.data.csrfToken;
  const stolen = { ...c.jar };
  assert.equal((await c.call('GET', '/api/account')).status, 200);
  assert.equal((await c.call('POST', '/api/auth/logout', {}, { 'X-CSRF-Token': '' })).status, 403, 'logout needs CSRF token');
  const out = await c.call('POST', '/api/auth/logout', {});
  assert.equal(out.status, 200);
  assert.equal(Object.keys(c.jar).length, 0);
  const replay = app.client(); Object.assign(replay.jar, stolen);
  assert.equal((await replay.call('GET', '/api/account')).status, 401, 'replaying the old cookie fails');
  assert.equal((await replay.call('GET', '/api/auth/session')).data.authenticated, false);
});

test('session renewal: logging in again issues a new token and kills the old one', async () => {
  const c = app.client();
  await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD });
  const first = { ...c.jar };
  await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD });
  assert.notEqual(Object.values(c.jar)[0], Object.values(first)[0]);
  const old = app.client(); Object.assign(old.jar, first);
  assert.equal((await old.call('GET', '/api/account')).status, 401);
});

test('session expiry: idle and absolute limits are enforced on the server', async () => {
  const c = app.client();
  const r = await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD }); c.csrf = r.data.csrfToken;
  const d = db.get();
  d.prepare('UPDATE sessions SET last_seen_at = last_seen_at - 13*3600 WHERE csrf_token = ?').run(c.csrf);
  assert.equal((await c.call('GET', '/api/account')).status, 401, 'idle > 12h');
  const c2 = app.client();
  const r2 = await c2.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD });
  d.prepare('UPDATE sessions SET expires_at = ? WHERE csrf_token = ?').run(Math.floor(Date.now() / 1000) - 1, r2.data.csrfToken);
  assert.equal((await c2.call('GET', '/api/account')).status, 401, 'absolute lifetime');
});

test('cross-site requests are refused', async () => {
  const c = app.client();
  const r = await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const r2 = await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(r2.status, 403);
});

test('verification endpoints: no code was ever issued, so nothing can be verified', async () => {
  const c = app.client();
  const r = await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD }); c.csrf = r.data.csrfToken;
  const v = await c.call('POST', '/api/account/verify', { code: '000000' });
  assert.equal(v.status, 400);
  assert.equal((await c.call('GET', '/api/account')).data.user.emailVerified, false);
  const rs = await c.call('POST', '/api/account/verify/resend', {});
  assert.equal(rs.status, 503);
  assert.equal(rs.data.verification.status, 'not_configured');
});

test('brute force: 5 failures lock that account+IP pair; a correct password is then also refused', async () => {
  const c = app.client();
  await reg(c, { identifier: 'victim@example.com', fullName: 'Kurban Kişi' });
  const attacker = app.client();
  for (let i = 0; i < 5; i++) {
    assert.equal((await attacker.call('POST', '/api/auth/login', { identifier: 'victim@example.com', password: 'Guess-number-' + i })).status, 401);
  }
  const locked = await attacker.call('POST', '/api/auth/login', { identifier: 'victim@example.com', password: GOOD });
  assert.equal(locked.status, 429);
  assert.ok(locked.headers.get('retry-after'));
  assert.match(locked.data.error.message, /dakika/);
});

test('static files: site is served; backend, database and secrets are not', async () => {
  const get = (p) => fetch(app.base + p);
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Online Sipariş Girişi/);
  assert.equal((await get('/css/style.css')).status, 200);
  assert.equal((await get('/js/main.js')).status, 200);
  assert.equal((await get('/assets/images/favicon.png')).status, 200);
  for (const p of ['/.env', '/.env.example', '/server/config.js', '/server/db.js', '/data/seodental.sqlite', '/package.json',
    '/test/auth.test.js', '/README.md', '/css/../server/config.js', '/%2e%2e/server/config.js', '/css/..%2Fserver%2Fconfig.js', '/js/%00.js']) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
});

test('XSS: a malicious name is stored as text and returned as JSON (UI renders with textContent)', async () => {
  const c = app.client();
  const r = await reg(c, { identifier: 'xss@example.com', fullName: '<img src=x onerror=alert(1)> Test' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.fullName, '<img src=x onerror=alert(1)> Test');
  assert.match(r.headers.get('content-type'), /application\/json/);
});

test('SQL injection strings are treated as data', async () => {
  const c = app.client();
  const r = await c.call('POST', '/api/auth/login', { identifier: "x@y.com' OR '1'='1", password: "' OR '1'='1" });
  assert.ok([400, 401].includes(r.status));
  assert.equal(Object.keys(c.jar).length, 0);
});

test('persistence: data survives a database re-open', async () => {
  db.close(); // simulate restart; same file
  db.open();
  const row = db.get().prepare('SELECT full_name FROM users WHERE email = ?').get('ayse@example.com');
  assert.equal(row.full_name, 'Ayşe Yılmaz');
  const c = app.client();
  assert.equal((await c.call('POST', '/api/auth/login', { identifier: 'ayse@example.com', password: GOOD })).status, 200);
});
