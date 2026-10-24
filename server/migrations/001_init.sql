-- 001_init.sql — initial schema for SeoDental accounts (SQLite)

CREATE TABLE users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name          TEXT    NOT NULL,
  email              TEXT    UNIQUE COLLATE NOCASE,   -- stored lower-case; NULL when registered by phone
  phone              TEXT    UNIQUE,                  -- E.164 (+905XXXXXXXXX); NULL when registered by e-mail
  password_hash      TEXT    NOT NULL,                -- scrypt$N$r$p$salt$hash — never plaintext
  email_verified_at  TEXT,                            -- NULL = NOT verified
  phone_verified_at  TEXT,                            -- NULL = NOT verified
  role               TEXT    NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TRIGGER users_touch_updated_at AFTER UPDATE ON users
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- Server-side sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  id            TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token    TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,   -- unix seconds
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,   -- absolute lifetime
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- One-time verification codes (HMAC of the code is stored, not the code).
CREATE TABLE verification_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      TEXT    NOT NULL CHECK (channel IN ('email', 'phone')),
  target       TEXT    NOT NULL,
  code_hash    TEXT    NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER
);
CREATE INDEX idx_codes_user ON verification_codes(user_id, channel);

-- Rate limiting (login failures, registrations, code requests).
CREATE TABLE rate_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket      TEXT    NOT NULL,   -- e.g. login_fail:pair:<id>|<ip>
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_rate_bucket ON rate_events(bucket, created_at);
