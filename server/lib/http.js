'use strict';
const crypto = require('node:crypto');
const config = require('../config');

const MAX_BODY = 8 * 1024;

function clientIp(req) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1]; // the address our own proxy saw
  }
  return req.socket.remoteAddress || '';
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}

function fail(res, status, code, message, extra = {}, headers = {}) {
  send(res, status, { error: { code, message, ...extra } }, headers);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject({ status: 415, message: 'İçerik türü application/json olmalıdır.' });
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject({ status: 413, message: 'İstek çok büyük.' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch { reject({ status: 400, message: 'Geçersiz istek gövdesi.' }); }
    });
    req.on('error', () => reject({ status: 400, message: 'İstek okunamadı.' }));
  });
}

/** Cross-site request protection for state-changing requests (defence in depth with SameSite=Lax + CSRF token). */
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }
  return true;
}

function csrfValid(req, session) {
  const sent = Buffer.from(String(req.headers['x-csrf-token'] || ''));
  const real = Buffer.from(session.csrfToken);
  return sent.length === real.length && crypto.timingSafeEqual(sent, real);
}

module.exports = { clientIp, send, fail, readJson, sameOrigin, csrfValid };
