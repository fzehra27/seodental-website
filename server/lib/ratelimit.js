'use strict';
const db = require('../db');

const now = () => Math.floor(Date.now() / 1000);

function record(bucket) {
  db.get().prepare('INSERT INTO rate_events (bucket, created_at) VALUES (?, ?)').run(bucket, now());
}

function count(bucket, windowSeconds) {
  return db.get().prepare('SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND created_at > ?')
    .get(bucket, now() - windowSeconds).n;
}

/** Seconds until the oldest counted event leaves the window (>= 1). */
function retryAfter(bucket, windowSeconds) {
  const row = db.get().prepare('SELECT MIN(created_at) AS t FROM rate_events WHERE bucket = ? AND created_at > ?')
    .get(bucket, now() - windowSeconds);
  return row.t ? Math.max(1, row.t + windowSeconds - now()) : 1;
}

function clear(bucket) { db.get().prepare('DELETE FROM rate_events WHERE bucket = ?').run(bucket); }

/** Returns 0 if allowed, else the number of seconds to wait. */
function blockedFor(bucket, limit, windowSeconds) {
  return count(bucket, windowSeconds) >= limit ? retryAfter(bucket, windowSeconds) : 0;
}

function purge() {
  const d = db.get();
  d.prepare('DELETE FROM rate_events WHERE created_at < ?').run(now() - 86400);
  d.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  d.prepare('DELETE FROM verification_codes WHERE expires_at < ?').run(now() - 86400);
}

module.exports = { record, count, clear, blockedFor, purge, now };
