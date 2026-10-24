'use strict';
/** Server-side validation + normalisation. Messages are user-facing Turkish. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', '1234567890', '12345678910', 'qwerty12345', 'qwertyuiop1',
  'iloveyou123', 'sifre12345', 'sifre123456', 'parola12345', 'admin12345', 'welcome123', 'abc1234567',
  'turkiye1923', 'galatasaray1', 'fenerbahce1', 'besiktas1903'
]);

function cleanText(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeEmail(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

/** Accepts Turkish mobile numbers in common notations, or any +E.164 number. Returns E.164 or null. */
function normalizePhone(value) {
  let v = String(value ?? '').trim();
  if (!v) return null;
  if (/[^\d\s()+\-.]/.test(v)) return null;
  const hadPlus = v.startsWith('+');
  let d = v.replace(/\D/g, '');
  if (d.startsWith('00')) { d = d.slice(2); return /^\d{8,15}$/.test(d) && !d.startsWith('0') ? normalizeIntl(d) : null; }
  if (hadPlus) return normalizeIntl(d);
  if (/^0?5\d{9}$/.test(d)) return '+90' + d.slice(-10);        // 05xx…, 5xx…
  if (/^905\d{9}$/.test(d)) return '+' + d;                     // 905xx… without plus
  return null;
}
function normalizeIntl(d) {
  if (!/^[1-9]\d{7,14}$/.test(d)) return null;
  if (d.startsWith('90') && !/^905\d{9}$/.test(d)) return null; // Turkish numbers must be mobile here
  return '+' + d;
}

/** Login identifier: e-mail if it contains '@', otherwise phone. */
function parseIdentifier(value) {
  const raw = String(value ?? '').trim();
  if (raw.includes('@')) { const email = normalizeEmail(raw); return email ? { type: 'email', value: email } : null; }
  const phone = normalizePhone(raw);
  return phone ? { type: 'phone', value: phone } : null;
}

function passwordProblem(password, identifier) {
  if (typeof password !== 'string' || !password) return 'Lütfen bir şifre belirleyin.';
  if (password.length < 10) return 'Şifre en az 10 karakter olmalıdır.';
  if (password.length > 128) return 'Şifre en fazla 128 karakter olabilir.';
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'Şifre en az bir harf ve bir rakam içermelidir.';
  if (/^(.)\1+$/.test(password)) return 'Şifre tek bir karakterin tekrarından oluşamaz.';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Bu şifre çok yaygın; lütfen daha özgün bir şifre seçin.';
  if (identifier && password.toLowerCase() === String(identifier).toLowerCase()) return 'Şifre e-posta veya telefon numaranızla aynı olamaz.';
  return null;
}

/** Returns { value, errors } for a registration payload. */
function validateRegistration(body) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};

  const fullName = cleanText(b.fullName);
  if (!fullName) errors.fullName = 'Lütfen adınızı ve soyadınızı yazın.';
  else if (fullName.length < 3 || !fullName.includes(' ')) errors.fullName = 'Lütfen adınızı ve soyadınızı birlikte yazın.';
  else if (fullName.length > 100) errors.fullName = 'Ad soyad en fazla 100 karakter olabilir.';

  const method = b.method === 'email' || b.method === 'phone' ? b.method : null;
  let email = null, phone = null;
  if (!method) {
    errors.identifier = 'Lütfen bir kayıt yöntemi seçin (e-posta veya telefon).';
  } else if (method === 'email') {
    email = normalizeEmail(b.identifier);
    if (!String(b.identifier ?? '').trim()) errors.identifier = 'Lütfen e-posta adresinizi yazın.';
    else if (!email) errors.identifier = 'Lütfen geçerli bir e-posta adresi girin.';
  } else {
    phone = normalizePhone(b.identifier);
    if (!String(b.identifier ?? '').trim()) errors.identifier = 'Lütfen telefon numaranızı yazın.';
    else if (!phone) errors.identifier = 'Lütfen geçerli bir cep telefonu numarası girin (örn. 0532 123 45 67).';
  }

  const pwError = passwordProblem(b.password, email || phone);
  if (pwError) errors.password = pwError;
  else if (typeof b.passwordConfirm !== 'string' || b.passwordConfirm === '') errors.passwordConfirm = 'Lütfen şifrenizi tekrar yazın.';
  else if (b.password !== b.passwordConfirm) errors.passwordConfirm = 'Şifreler eşleşmiyor.';

  return { value: { fullName, method, email, phone, password: b.password }, errors };
}

module.exports = { normalizeEmail, normalizePhone, parseIdentifier, passwordProblem, validateRegistration, cleanText };
