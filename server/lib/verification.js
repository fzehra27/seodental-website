'use strict';
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { now, record, blockedFor } = require('./ratelimit');
const { sendEmail } = require('./mailer');
const { sendSms } = require('./sms');

const CODE_TTL = 15 * 60;
const RESEND_COOLDOWN = 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

const hashCode = (userId, channel, code) =>
  crypto.createHmac('sha256', config.secret).update(`${userId}:${channel}:${code}`).digest('hex');

/**
 * Creates a code and tries to deliver it through the real provider.
 * Result: { status: 'sent' | 'not_configured' | 'failed' | 'cooldown' | 'limit', retryAfter? }
 * When delivery did not happen the code is discarded, so nothing can be "verified" by accident.
 */
async function sendVerification(user, channel) {
  const d = db.get();
  const target = channel === 'email' ? user.email : user.phone;
  if (!target) return { status: 'failed' };

  const last = d.prepare('SELECT created_at FROM verification_codes WHERE user_id=? AND channel=? ORDER BY id DESC LIMIT 1').get(user.id, channel);
  if (last && now() - last.created_at < RESEND_COOLDOWN) return { status: 'cooldown', retryAfter: RESEND_COOLDOWN - (now() - last.created_at) };
  const bucket = `verify_send:${user.id}:${channel}`;
  const wait = blockedFor(bucket, MAX_SENDS_PER_HOUR, 3600);
  if (wait) return { status: 'limit', retryAfter: wait };

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const t = now();
  d.prepare('UPDATE verification_codes SET consumed_at=? WHERE user_id=? AND channel=? AND consumed_at IS NULL').run(t, user.id, channel);
  const info = d.prepare('INSERT INTO verification_codes (user_id, channel, target, code_hash, created_at, expires_at) VALUES (?,?,?,?,?,?)')
    .run(user.id, channel, target, hashCode(user.id, channel, code), t, t + CODE_TTL);

  const minutes = CODE_TTL / 60;
  const result = channel === 'email'
    ? await sendEmail({
        to: target,
        subject: 'SeoDental e-posta doğrulama kodunuz',
        text: `Merhaba ${user.full_name},\n\nSeoDental hesabınız için doğrulama kodunuz: ${code}\n\nBu kod ${minutes} dakika geçerlidir. Bu işlemi siz başlatmadıysanız bu iletiyi dikkate almayın.\n`
      })
    : await sendSms({ to: target, text: `SeoDental dogrulama kodunuz: ${code}. ${minutes} dakika gecerlidir.` });

  if (!result.ok) {
    d.prepare('DELETE FROM verification_codes WHERE id=?').run(info.lastInsertRowid);
    if (result.reason === 'failed') console.error(`[verification] ${channel} delivery failed:`, result.detail);
    return { status: result.reason };
  }
  record(bucket);
  return { status: 'sent' };
}

/** Checks a submitted code for the user's own contact. Returns 'ok' | 'invalid' | 'expired' | 'locked' | 'none'. */
function confirmCode(user, channel, submitted) {
  const d = db.get();
  const row = d.prepare('SELECT * FROM verification_codes WHERE user_id=? AND channel=? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1').get(user.id, channel);
  if (!row) return 'none';
  if (row.expires_at <= now()) return 'expired';
  if (row.attempts >= MAX_ATTEMPTS) return 'locked';
  const current = channel === 'email' ? user.email : user.phone;
  if (row.target !== current) return 'none';

  d.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id=?').run(row.id);
  const a = Buffer.from(hashCode(user.id, channel, String(submitted)), 'hex');
  const b = Buffer.from(row.code_hash, 'hex');
  if (!crypto.timingSafeEqual(a, b)) return 'invalid';

  const col = channel === 'email' ? 'email_verified_at' : 'phone_verified_at';
  d.prepare('UPDATE verification_codes SET consumed_at=? WHERE id=?').run(now(), row.id);
  d.prepare(`UPDATE users SET ${col} = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(user.id);
  return 'ok';
}

module.exports = { sendVerification, confirmCode };
