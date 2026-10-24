'use strict';
/**
 * Minimal SMTP client (node:net / node:tls) so no npm package is needed.
 * Supports implicit TLS (port 465) and STARTTLS (port 587), AUTH PLAIN/LOGIN.
 * Returns { ok:true } only when the SMTP server accepted the message (250 after DATA).
 * Returns { ok:false, reason:'not_configured' | 'failed', detail } otherwise — never pretends.
 */
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const config = require('../config');

const TIMEOUT_MS = 15000;

function isConfigured(cfg = config.email) {
  return cfg.provider === 'smtp' && Boolean(cfg.host && cfg.from && cfg.user && cfg.pass);
}

/** Line-oriented SMTP conversation helper. */
function createConversation(socket) {
  let buffer = '';
  const waiters = [];
  let current = [];
  let failure = null;

  function feed(chunk) {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
      current.push(line);
      if (/^\d{3} /.test(line)) { // final line of a reply
        const reply = { code: parseInt(line.slice(0, 3), 10), lines: current }; current = [];
        const w = waiters.shift(); if (w) w.resolve(reply);
      }
    }
  }
  function fail(err) { failure = failure || err; while (waiters.length) waiters.shift().reject(failure); }
  const attach = (s) => {
    s.on('data', feed);
    s.on('error', fail);
    s.on('close', () => fail(new Error('Connection closed by server')));
    s.setTimeout(TIMEOUT_MS, () => { fail(new Error('SMTP timeout')); s.destroy(); });
  };
  attach(socket);

  return {
    read: () => failure ? Promise.reject(failure) : new Promise((resolve, reject) => waiters.push({ resolve, reject })),
    write: (s) => socket.write(s),
    detach: () => { socket.removeAllListeners('data'); socket.removeAllListeners('close'); socket.removeAllListeners('error'); },
    attach, feedReset: () => { buffer = ''; }
  };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encodeHeader = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const noCRLF = (s) => String(s).replace(/[\r\n]+/g, ' ');
const addressOf = (from) => { const m = /<([^>]+)>/.exec(from); return (m ? m[1] : from).trim(); };

function buildMessage({ from, to, subject, text }) {
  const headers = [
    `From: ${noCRLF(from)}`,
    `To: ${noCRLF(to)}`,
    `Subject: ${encodeHeader(noCRLF(subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@seodental.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];
  const body = b64(text).replace(/.{1,76}/g, '$&\r\n');
  return headers.join('\r\n') + '\r\n\r\n' + body;
}

async function sendEmail({ to, subject, text }, cfg = config.email) {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  if (/[\r\n<>]/.test(to)) return { ok: false, reason: 'failed', detail: 'invalid recipient' };

  const tlsOpts = { host: cfg.host, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized };
  let socket;
  try {
    socket = cfg.secure
      ? await new Promise((res, rej) => { const s = tls.connect({ ...tlsOpts, port: cfg.port }, () => res(s)); s.once('error', rej); })
      : await new Promise((res, rej) => { const s = net.connect({ host: cfg.host, port: cfg.port }, () => res(s)); s.once('error', rej); });

    let conv = createConversation(socket);
    const expect = async (codes, label) => {
      const r = await conv.read();
      if (!codes.includes(r.code)) throw new Error(`${label}: ${r.lines.join(' | ')}`);
      return r;
    };
    const cmd = async (line, codes, label) => { conv.write(line + '\r\n'); return expect(codes, label || line.split(' ')[0]); };

    await expect([220], 'greeting');
    let ehlo = await cmd('EHLO seodental.local', [250], 'EHLO');

    if (!cfg.secure) {
      if (!ehlo.lines.some(l => /STARTTLS/i.test(l))) throw new Error('Server does not offer STARTTLS; refusing to send credentials in clear text');
      await cmd('STARTTLS', [220], 'STARTTLS');
      conv.detach();
      socket = tls.connect({ ...tlsOpts, socket });
      await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
      conv = createConversation(socket);
      ehlo = await cmd('EHLO seodental.local', [250], 'EHLO');
    }

    const mechs = ehlo.lines.map(l => l.slice(4)).find(l => /^AUTH\b/i.test(l)) || '';
    if (/\bPLAIN\b/i.test(mechs)) {
      await cmd('AUTH PLAIN ' + b64(`\0${cfg.user}\0${cfg.pass}`), [235], 'AUTH');
    } else if (/\bLOGIN\b/i.test(mechs)) {
      await cmd('AUTH LOGIN', [334], 'AUTH');
      await cmd(b64(cfg.user), [334], 'AUTH user');
      await cmd(b64(cfg.pass), [235], 'AUTH pass');
    } else {
      throw new Error('Server offers no supported AUTH mechanism');
    }

    await cmd(`MAIL FROM:<${addressOf(cfg.from)}>`, [250], 'MAIL FROM');
    await cmd(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
    await cmd('DATA', [354], 'DATA');
    const message = buildMessage({ from: cfg.from, to, subject, text }).replace(/^\./gm, '..');
    conv.write(message + '\r\n.\r\n');
    await expect([250], 'message not accepted');
    try { conv.write('QUIT\r\n'); } catch { /* ignore */ }
    socket.end();
    return { ok: true };
  } catch (err) {
    if (socket) socket.destroy();
    return { ok: false, reason: 'failed', detail: err.message };
  }
}

module.exports = { sendEmail, isConfigured, buildMessage };
