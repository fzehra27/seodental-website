'use strict';
// Exercises the e-mail (SMTP) and SMS adapters and the verification flow against LOCAL stand-in servers.
// This proves our client code speaks SMTP / the documented HTTP APIs; it does NOT prove delivery by a real provider.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seodental-deliv-'));
Object.assign(process.env, {
  DATABASE_FILE: path.join(tmp, 'e2e.sqlite'), APP_SECRET: 'y'.repeat(40), EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1',
  SMTP_SECURE: 'false', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'SeoDental <noreply@example.com>', SMTP_TLS_REJECT_UNAUTHORIZED: 'false', SMS_PROVIDER: 'none'
});
delete process.env.NODE_ENV;
const config = require('../server/config');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem'),
  '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
const TLS_OPTS = { key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) };

/** Tiny SMTP server. mode 'implicit' = TLS from the start, 'starttls' = upgrade after STARTTLS. Captures messages. */
function fakeSmtp(mode, { user = 'u', pass = 'p' } = {}) {
  const inbox = [];
  const handle = (socket, secure, upgraded = false) => {
    let buf = '', data = null, msg = { from: '', to: '', raw: '' }, authed = false;
    const w = (s) => socket.write(s + '\r\n');
    if (!upgraded) w('220 fake ESMTP');   // a STARTTLS upgrade must NOT send a new greeting
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data !== null) {
          if (line === '.') { msg.raw = data.join('\r\n'); inbox.push(msg); data = null; msg = { from: '', to: '', raw: '' }; w('250 queued'); }
          else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        const u = line.toUpperCase();
        if (u.startsWith('EHLO')) { socket.write(`250-fake\r\n${mode === 'starttls' && !secure ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN LOGIN\r\n`); }
        else if (u === 'STARTTLS') {
          w('220 go ahead');
          const secureSocket = new tls.TLSSocket(socket, { ...TLS_OPTS, isServer: true });
          socket.removeAllListeners('data');
          handle(secureSocket, true, true);
          return;
        }
        else if (u.startsWith('AUTH PLAIN')) {
          const [, u2, p2] = Buffer.from(line.slice(11), 'base64').toString().split('\0');
          if (u2 === user && p2 === pass) { authed = true; w('235 ok'); } else w('535 bad credentials');
        }
        else if (u.startsWith('MAIL FROM')) { if (!authed) w('530 auth first'); else { msg.from = line; w('250 ok'); } }
        else if (u.startsWith('RCPT TO')) { msg.to = line; w('250 ok'); }
        else if (u === 'DATA') { data = []; w('354 go'); }
        else if (u === 'QUIT') { w('221 bye'); socket.end(); }
        else w('500 ?');
      }
    });
    socket.on('error', () => {});
  };
  const server = mode === 'implicit' ? tls.createServer(TLS_OPTS, (s) => handle(s, true)) : net.createServer((s) => handle(s, false));
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, inbox, port: server.address().port })));
}

function decodeBody(raw) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  return { head, text: Buffer.from(rest.join('').replace(/\r?\n/g, ''), 'base64').toString('utf8') };
}

function fakeHttp(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => { calls.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, calls, port: server.address().port })));
}

const cfgFor = (port, over = {}) => ({ provider: 'smtp', from: 'SeoDental <noreply@example.com>', host: '127.0.0.1', port, secure: false, user: 'u', pass: 'p', rejectUnauthorized: false, ...over });

test('SMTP adapter: STARTTLS (587-style) delivers a UTF-8 message', async () => {
  const { sendEmail } = require('../server/lib/mailer');
  const smtp = await fakeSmtp('starttls');
  const r = await sendEmail({ to: 'ayse@example.com', subject: 'Doğrulama kodunuz: şğüıöç', text: 'Kod: 123456\n.nokta ile başlayan satır' }, cfgFor(smtp.port));
  smtp.server.close();
  assert.deepEqual(r, { ok: true });
  assert.equal(smtp.inbox.length, 1);
  assert.match(smtp.inbox[0].to, /ayse@example\.com/);
  const { head, text } = decodeBody(smtp.inbox[0].raw);
  assert.match(head, /Subject: =\?UTF-8\?B\?/);
  assert.ok(text.includes('Kod: 123456') && text.includes('.nokta ile'));
});

test('SMTP adapter: implicit TLS (465-style) works', async () => {
  const { sendEmail } = require('../server/lib/mailer');
  const smtp = await fakeSmtp('implicit');
  const r = await sendEmail({ to: 'a@example.com', subject: 'Test', text: 'merhaba' }, cfgFor(smtp.port, { secure: true }));
  smtp.server.close();
  assert.equal(r.ok, true);
  assert.equal(smtp.inbox.length, 1);
});

test('SMTP adapter: wrong credentials, missing config, header injection and plaintext-only servers all fail honestly', async () => {
  const { sendEmail } = require('../server/lib/mailer');
  const smtp = await fakeSmtp('starttls');
  const bad = await sendEmail({ to: 'a@example.com', subject: 'x', text: 'y' }, cfgFor(smtp.port, { pass: 'wrong' }));
  assert.equal(bad.ok, false); assert.equal(bad.reason, 'failed'); assert.match(bad.detail, /535/);
  assert.equal(smtp.inbox.length, 0);
  smtp.server.close();
  assert.deepEqual(await sendEmail({ to: 'a@example.com', subject: 'x', text: 'y' }, { ...cfgFor(1), provider: 'none' }), { ok: false, reason: 'not_configured' });
  assert.equal((await sendEmail({ to: 'a@example.com\r\nBcc: evil@x.com', subject: 'x', text: 'y' }, cfgFor(smtp.port))).ok, false);
  const down = await sendEmail({ to: 'a@example.com', subject: 'x', text: 'y' }, cfgFor(1)); // nothing listens on port 1
  assert.equal(down.ok, false);
  // server that offers no STARTTLS: credentials must not be sent in clear text
  const plain = net.createServer(s => { s.write('220 hi\r\n'); s.on('data', () => s.write('250 plain\r\n')); s.on('error', () => {}); });
  await new Promise(r => plain.listen(0, '127.0.0.1', r));
  const refused = await sendEmail({ to: 'a@example.com', subject: 'x', text: 'y' }, cfgFor(plain.address().port));
  plain.close();
  assert.equal(refused.ok, false); assert.match(refused.detail, /STARTTLS/);
});

test('SMS adapters: Netgsm and Twilio requests are well-formed; provider errors are reported as failures', async () => {
  const { sendSms } = require('../server/lib/sms');
  const ng = await fakeHttp((req, res) => { res.end(req.url.includes('FAIL') ? '30' : '00 123456789'); });
  const base = { provider: 'netgsm', netgsm: { url: `http://127.0.0.1:${ng.port}/sms/send/get`, user: 'usr', pass: 'pw', header: 'SEODENTAL' }, twilio: {} };
  assert.equal((await sendSms({ to: '+905321234567', text: 'Kod 123456' }, base)).ok, true);
  const q = new URL(ng.calls[0].url, 'http://x').searchParams;
  assert.equal(q.get('gsmno'), '5321234567'); assert.equal(q.get('msgheader'), 'SEODENTAL'); assert.equal(q.get('message'), 'Kod 123456');
  ng.calls.length = 0;
  const bad = await sendSms({ to: '+905321234567', text: 'FAIL' }, base);
  assert.equal(bad.ok, false); assert.equal(bad.reason, 'failed');
  ng.server.close();

  const tw = await fakeHttp((req, res) => { res.statusCode = req.headers.authorization ? 201 : 401; res.end('{}'); });
  const tcfg = { provider: 'twilio', netgsm: {}, twilio: { baseUrl: `http://127.0.0.1:${tw.port}`, sid: 'ACxxx', token: 'tok', from: '+15005550006', messagingServiceSid: '' } };
  assert.equal((await sendSms({ to: '+905321234567', text: 'Kod 1' }, tcfg)).ok, true);
  assert.equal(tw.calls[0].url, '/2010-04-01/Accounts/ACxxx/Messages.json');
  assert.match(tw.calls[0].body, /To=%2B905321234567/);
  assert.equal(tw.calls[0].headers.authorization, 'Basic ' + Buffer.from('ACxxx:tok').toString('base64'));
  tw.server.close();

  assert.deepEqual(await sendSms({ to: '+905321234567', text: 'x' }, { provider: 'none', netgsm: {}, twilio: {} }), { ok: false, reason: 'not_configured' });
  assert.deepEqual(await sendSms({ to: '+905321234567', text: 'x' }, { provider: 'netgsm', netgsm: { user: '', pass: '', header: '' }, twilio: {} }), { ok: false, reason: 'not_configured' });
});

test('end-to-end: register by e-mail → code arrives by SMTP → wrong code rejected → right code verifies', async () => {
  const smtp = await fakeSmtp('starttls');
  config.email.port = smtp.port;
  const { createServer } = require('../server/index.js');
  const db = require('../server/db');
  const app = await start(createServer);
  try {
    const c = app.client();
    const r = await c.call('POST', '/api/auth/register', { method: 'email', fullName: 'Deniz Arslan', identifier: 'deniz@example.com', password: 'Guvenli-sifre-77', passwordConfirm: 'Guvenli-sifre-77' });
    assert.equal(r.status, 201);
    assert.equal(r.data.verification.status, 'sent');
    c.csrf = r.data.csrfToken;
    assert.equal(smtp.inbox.length, 1, 'a real SMTP transaction happened');
    const code = /(\d{6})/.exec(decodeBody(smtp.inbox[0].raw).text)[1];
    assert.equal(db.get().prepare('SELECT COUNT(*) n FROM verification_codes WHERE code_hash LIKE ?').get('%' + code + '%').n, 0, 'code not stored in clear');

    const resendTooSoon = await c.call('POST', '/api/account/verify/resend', {});
    assert.equal(resendTooSoon.status, 429);                     // 60 s cooldown
    const wrong = await c.call('POST', '/api/account/verify', { code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    assert.equal((await c.call('GET', '/api/account')).data.user.emailVerified, false);
    const noCsrf = await c.call('POST', '/api/account/verify', { code }, { 'X-CSRF-Token': 'nope' });
    assert.equal(noCsrf.status, 403);
    const ok = await c.call('POST', '/api/account/verify', { code });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.emailVerified, true);
    assert.ok(db.get().prepare('SELECT email_verified_at FROM users WHERE email=?').get('deniz@example.com').email_verified_at);
    const reuse = await c.call('POST', '/api/account/verify', { code });
    assert.equal(reuse.status, 200);                              // already verified → no-op, still honest
  } finally { await app.close(); db.close(); smtp.server.close(); }
});

test('verification code locks after 5 wrong attempts and expires', async () => {
  const smtp = await fakeSmtp('starttls');
  config.email.port = smtp.port;
  const db = require('../server/db');
  const { createServer } = require('../server/index.js');
  const app = await start(createServer);
  try {
    const c = app.client();
    const r = await c.call('POST', '/api/auth/register', { method: 'email', fullName: 'Kemal Aydın', identifier: 'kemal@example.com', password: 'Guvenli-sifre-77', passwordConfirm: 'Guvenli-sifre-77' });
    assert.equal(r.data.verification.status, 'sent');
    c.csrf = r.data.csrfToken;
    const code = /(\d{6})/.exec(decodeBody(smtp.inbox[0].raw).text)[1];
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/api/account/verify', { code: wrong })).status, 400);
    const locked = await c.call('POST', '/api/account/verify', { code });
    assert.equal(locked.status, 400);
    assert.match(locked.data.error.message, /deneme hakkınız doldu/);
    assert.equal((await c.call('GET', '/api/account')).data.user.emailVerified, false, 'correct code after lock-out does not verify');

    db.get().prepare('UPDATE verification_codes SET attempts = 0, expires_at = 1').run();
    const expired = await c.call('POST', '/api/account/verify', { code });
    assert.match(expired.data.error.message, /süresi dolmuş/);
  } finally { await app.close(); db.close(); smtp.server.close(); }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
