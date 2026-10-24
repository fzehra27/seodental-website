'use strict';
const db = require('../db');
const config = require('../config');
const { hashPassword, verifyPassword, verifyAgainstDummy } = require('../lib/password');
const { validateRegistration, parseIdentifier } = require('../lib/validation');
const sessions = require('../lib/sessions');
const { record, clear, blockedFor } = require('../lib/ratelimit');
const { sendVerification, confirmCode } = require('../lib/verification');
const { readJson, send, fail, csrfValid } = require('../lib/http');

const LOGIN_WINDOW = 15 * 60;
const GENERIC_LOGIN_ERROR = 'E-posta/telefon numarası veya şifre hatalı.';

/** The only shape in which user data leaves the server. Never includes the hash or other users' data. */
function publicUser(u) {
  return {
    fullName: u.full_name,
    email: u.email,
    phone: u.phone,
    emailVerified: Boolean(u.email_verified_at),
    phoneVerified: Boolean(u.phone_verified_at),
    role: u.role,
    createdAt: u.created_at
  };
}

const findUserById = (id) => db.get().prepare('SELECT * FROM users WHERE id = ?').get(id);

function currentUser(req) {
  const s = sessions.resolve(req);
  if (!s) return null;
  const user = findUserById(s.userId);
  return user ? { user, session: s } : null;
}

/** Wraps a handler that needs a signed-in user (and, for writes, a valid CSRF token). */
function requireAuth(handler, { write = false } = {}) {
  return async (req, res) => {
    const auth = currentUser(req);
    if (!auth) return fail(res, 401, 'unauthenticated', 'Bu işlem için giriş yapmanız gerekir.', {}, { 'Set-Cookie': sessions.clearCookieHeader() });
    if (write && !csrfValid(req, auth.session)) return fail(res, 403, 'csrf', 'Oturum doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.');
    return handler(req, res, auth);
  };
}

const VERIFY_MESSAGES = {
  sent: (channel) => channel === 'email' ? 'Doğrulama kodu e-posta adresinize gönderildi.' : 'Doğrulama kodu telefonunuza SMS ile gönderildi.',
  not_configured: (channel) => channel === 'email'
    ? 'Hesabınız oluşturuldu ancak e-posta servisi henüz yapılandırılmadığı için doğrulama kodu gönderilemedi. Adresiniz doğrulanmış sayılmaz.'
    : 'Hesabınız oluşturuldu ancak SMS servisi henüz yapılandırılmadığı için doğrulama kodu gönderilemedi. Numaranız doğrulanmış sayılmaz.',
  failed: () => 'Doğrulama kodu gönderilemedi. Lütfen daha sonra tekrar deneyin.',
  cooldown: () => 'Yeni bir kod istemeden önce lütfen biraz bekleyin.',
  limit: () => 'Çok fazla kod istendi. Lütfen daha sonra tekrar deneyin.'
};
const verificationInfo = (channel, r) => ({ channel, status: r.status, message: VERIFY_MESSAGES[r.status](channel), retryAfter: r.retryAfter });

async function register(req, res) {
  // Two limits per IP: accounts actually created (spam) and all attempts (stops mass duplicate-probing).
  // Plain typos in the form must not use up the small "created" allowance.
  const attemptBucket = `register:attempt:${req.ip}`;
  const createdBucket = `register:created:${req.ip}`;
  const wait = Math.max(blockedFor(attemptBucket, 60, 3600), blockedFor(createdBucket, 20, 3600));
  if (wait) return fail(res, 429, 'rate_limited', 'Çok fazla kayıt denemesi yapıldı. Lütfen daha sonra tekrar deneyin.', {}, { 'Retry-After': String(wait) });
  record(attemptBucket);

  const body = await readJson(req);
  const { value, errors } = validateRegistration(body);
  if (Object.keys(errors).length) return fail(res, 400, 'validation', 'Lütfen işaretli alanları kontrol edin.', { fields: errors });

  const d = db.get();
  if (value.email && d.prepare('SELECT 1 FROM users WHERE email = ?').get(value.email)) {
    return fail(res, 409, 'duplicate', 'Bu e-posta adresiyle kayıtlı bir hesap zaten var.', { fields: { identifier: 'Bu e-posta adresiyle kayıtlı bir hesap zaten var. Giriş yapmayı deneyin.' } });
  }
  if (value.phone && d.prepare('SELECT 1 FROM users WHERE phone = ?').get(value.phone)) {
    return fail(res, 409, 'duplicate', 'Bu telefon numarasıyla kayıtlı bir hesap zaten var.', { fields: { identifier: 'Bu telefon numarasıyla kayıtlı bir hesap zaten var. Giriş yapmayı deneyin.' } });
  }

  const hash = await hashPassword(value.password);
  let id;
  try {
    id = d.prepare('INSERT INTO users (full_name, email, phone, password_hash) VALUES (?,?,?,?)')
      .run(value.fullName, value.email, value.phone, hash).lastInsertRowid;
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) { // lost a race with a concurrent registration
      return fail(res, 409, 'duplicate', 'Bu bilgilerle kayıtlı bir hesap zaten var.', { fields: { identifier: 'Bu bilgilerle kayıtlı bir hesap zaten var. Giriş yapmayı deneyin.' } });
    }
    throw err;
  }

  record(createdBucket);
  const user = findUserById(id);
  const token = sessions.create(user.id, req);
  const session = sessions.resolve({ headers: { cookie: `${sessions.COOKIE}=${token}` } });
  const channel = value.method;
  const delivery = await sendVerification(user, channel);

  send(res, 201, { user: publicUser(user), csrfToken: session.csrfToken, verification: verificationInfo(channel, delivery) },
    { 'Set-Cookie': sessions.cookieHeader(token) });
}

async function login(req, res) {
  const body = await readJson(req);
  const ident = parseIdentifier(body.identifier);
  if (!ident || typeof body.password !== 'string' || !body.password || body.password.length > 128) {
    return fail(res, 400, 'validation', 'Lütfen e-posta/telefon numaranızı ve şifrenizi doğru biçimde girin.');
  }

  const pair = `login_fail:pair:${ident.value}|${req.ip}`;
  const byId = `login_fail:id:${ident.value}`;
  const byIp = `login_fail:ip:${req.ip}`;
  const wait = Math.max(blockedFor(pair, 5, LOGIN_WINDOW), blockedFor(byId, 20, LOGIN_WINDOW), blockedFor(byIp, 50, LOGIN_WINDOW));
  if (wait) {
    return fail(res, 429, 'rate_limited', `Çok fazla başarısız giriş denemesi. Lütfen ${Math.ceil(wait / 60)} dakika sonra tekrar deneyin.`, { retryAfter: wait }, { 'Retry-After': String(wait) });
  }

  const user = db.get().prepare(`SELECT * FROM users WHERE ${ident.type === 'email' ? 'email' : 'phone'} = ?`).get(ident.value);
  let ok = false;
  if (user) ok = await verifyPassword(body.password, user.password_hash);
  else await verifyAgainstDummy(body.password);

  if (!ok) {
    record(pair); record(byId); record(byIp);
    return fail(res, 401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
  }

  clear(pair);
  // Session renewal: drop any session presented with this request, issue a fresh token.
  const old = sessions.resolve(req);
  if (old) sessions.destroy(old.id);
  const token = sessions.create(user.id, req);
  const session = sessions.resolve({ headers: { cookie: `${sessions.COOKIE}=${token}` } });
  send(res, 200, { user: publicUser(user), csrfToken: session.csrfToken }, { 'Set-Cookie': sessions.cookieHeader(token) });
}

const logout = async (req, res) => {
  const s = sessions.resolve(req);
  if (s) {
    if (!csrfValid(req, s)) return fail(res, 403, 'csrf', 'Oturum doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.');
    sessions.destroy(s.id);
  }
  send(res, 200, { ok: true }, { 'Set-Cookie': sessions.clearCookieHeader() });
};

/** Public: lets the page know the sign-in state after a refresh. Never an error for visitors. */
const sessionStatus = async (req, res) => {
  const auth = currentUser(req);
  if (!auth) return send(res, 200, { authenticated: false });
  send(res, 200, { authenticated: true, user: publicUser(auth.user), csrfToken: auth.session.csrfToken });
};

const account = requireAuth(async (req, res, { user }) => send(res, 200, { user: publicUser(user) }));

const primaryChannel = (user) => (user.email ? 'email' : 'phone');

const verify = requireAuth(async (req, res, { user }) => {
  const body = await readJson(req);
  const channel = primaryChannel(user);
  if (user[channel === 'email' ? 'email_verified_at' : 'phone_verified_at']) {
    return send(res, 200, { user: publicUser(user), message: 'Hesabınız zaten doğrulanmış.' });
  }
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return fail(res, 400, 'validation', 'Lütfen 6 haneli doğrulama kodunu girin.', { fields: { code: 'Lütfen 6 haneli doğrulama kodunu girin.' } });

  const bucket = `verify_try:${user.id}`;
  const wait = blockedFor(bucket, 10, 900);
  if (wait) return fail(res, 429, 'rate_limited', 'Çok fazla deneme yaptınız. Lütfen daha sonra tekrar deneyin.', {}, { 'Retry-After': String(wait) });

  const result = confirmCode(user, channel, code);
  if (result === 'ok') return send(res, 200, { user: publicUser(findUserById(user.id)), message: 'Doğrulama başarılı.' });
  record(bucket);
  const msg = {
    invalid: 'Doğrulama kodu hatalı.',
    expired: 'Doğrulama kodunun süresi dolmuş. Lütfen yeni bir kod isteyin.',
    locked: 'Bu kod için deneme hakkınız doldu. Lütfen yeni bir kod isteyin.',
    none: 'Etkin bir doğrulama kodu yok. Lütfen yeni bir kod isteyin.'
  }[result];
  fail(res, 400, 'bad_code', msg, { fields: { code: msg } });
}, { write: true });

const resend = requireAuth(async (req, res, { user }) => {
  const channel = primaryChannel(user);
  if (user[channel === 'email' ? 'email_verified_at' : 'phone_verified_at']) {
    return send(res, 200, { message: 'Hesabınız zaten doğrulanmış.' });
  }
  const r = await sendVerification(user, channel);
  const info = verificationInfo(channel, r);
  send(res, r.status === 'sent' ? 200 : (r.status === 'cooldown' || r.status === 'limit' ? 429 : 503), { verification: info });
}, { write: true });

module.exports = { register, login, logout, sessionStatus, account, verify, resend, config };
