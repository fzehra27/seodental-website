'use strict';
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { now } = require('./ratelimit');

const COOKIE = config.cookieSecure ? '__Host-sid' : 'sid';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf("=");
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed cookie */ } }
  }
  return out;
}

/** Creates a brand-new session (new random token each login = session renewal). */
function create(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  db.get().prepare(
    'INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)'
  ).run(sha256(token), userId, crypto.randomBytes(24).toString('base64url'), t, t, t + config.session.absoluteSeconds,
    req.ip || null, String(req.headers['user-agent'] || '').slice(0, 200));
  return token;
}

/** Looks up the session from the request cookie. Returns { id, userId, csrfToken } or null. */
function resolve(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const row = db.get().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  const t = now();
  if (row.expires_at <= t || row.last_seen_at + config.session.idleSeconds <= t) {
    db.get().prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  if (t - row.last_seen_at > 300) db.get().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(t, id);
  return { id, userId: row.user_id, csrfToken: row.csrf_token, expiresAt: row.expires_at };
}

function destroy(id) { db.get().prepare('DELETE FROM sessions WHERE id = ?').run(id); }
function destroyAllForUser(userId) { db.get().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }

function cookieHeader(token) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${config.session.absoluteSeconds}`];
  if (config.cookieSecure) attrs.push('Secure');
  return attrs.join('; ');
}
function clearCookieHeader() {
  const attrs = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  if (config.cookieSecure) attrs.push('Secure');
  return attrs.join('; ');
}

module.exports = { create, resolve, destroy, destroyAllForUser, cookieHeader, clearCookieHeader, COOKIE };
