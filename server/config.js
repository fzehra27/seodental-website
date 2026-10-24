'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Minimal .env loader (no dependency). Real environment variables win. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnvFile(process.env.ENV_FILE || path.join(ROOT, '.env'));

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(v));
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const production = env.NODE_ENV === 'production';

const config = {
  root: ROOT,
  production,
  host: env.HOST || '127.0.0.1',
  port: int(env.PORT, 3000),
  trustProxy: bool(env.TRUST_PROXY, false),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  databaseFile: env.DATABASE_FILE === ':memory:' ? ':memory:' : path.resolve(ROOT, env.DATABASE_FILE || 'data/seodental.sqlite'),
  secret: env.APP_SECRET || '',
  cookieSecure: bool(env.COOKIE_SECURE, production),
  session: {
    idleSeconds: int(env.SESSION_IDLE_HOURS, 12) * 3600,
    absoluteSeconds: int(env.SESSION_MAX_DAYS, 14) * 86400
  },
  email: {
    provider: (env.EMAIL_PROVIDER || 'none').toLowerCase(), // none | smtp
    from: env.SMTP_FROM || '',
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false), // true = implicit TLS (465); false = STARTTLS (587)
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    rejectUnauthorized: bool(env.SMTP_TLS_REJECT_UNAUTHORIZED, true)
  },
  sms: {
    provider: (env.SMS_PROVIDER || 'none').toLowerCase(), // none | netgsm | twilio
    netgsm: {
      url: env.NETGSM_API_URL || 'https://api.netgsm.com.tr/sms/send/get',
      user: env.NETGSM_USERCODE || '',
      pass: env.NETGSM_PASSWORD || '',
      header: env.NETGSM_MSGHEADER || ''
    },
    twilio: {
      baseUrl: env.TWILIO_API_URL || 'https://api.twilio.com',
      sid: env.TWILIO_ACCOUNT_SID || '',
      token: env.TWILIO_AUTH_TOKEN || '',
      from: env.TWILIO_FROM || '',
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || ''
    }
  }
};

if (config.secret.length < 32) {
  if (production) {
    throw new Error('APP_SECRET must be set to a random string of at least 32 characters (see .env.example).');
  }
  // Development only: an ephemeral secret. Verification codes issued before a restart stop working.
  config.secret = require('node:crypto').randomBytes(32).toString('hex');
  config.ephemeralSecret = true;
}

module.exports = config;
