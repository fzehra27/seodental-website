'use strict';
/**
 * Database access. The only module that knows the database engine.
 * Uses Node's built-in SQLite (node:sqlite) — no third-party packages.
 * All queries are parameterised prepared statements.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db;

function open(file = config.databaseFile) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(handle) {
  handle.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = path.join(__dirname, 'migrations');
  const applied = new Set(handle.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    handle.exec('BEGIN');
    try {
      handle.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      handle.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      handle.exec('COMMIT');
    } catch (err) {
      handle.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}

function close() { if (db) { db.close(); db = undefined; } }
const get = () => db || open();

module.exports = { open, close, get };
