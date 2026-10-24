'use strict';
/**
 * SMS delivery adapters. ok:true only when the provider API confirms acceptance.
 *   SMS_PROVIDER=netgsm  — Netgsm (Turkey) HTTP GET API
 *   SMS_PROVIDER=twilio  — Twilio Programmable Messaging
 * Neither adapter has been exercised against the real provider (no credentials);
 * they were tested against local stand-in servers that mimic the documented responses.
 */
const config = require('../config');

function isConfigured(cfg = config.sms) {
  if (cfg.provider === 'netgsm') return Boolean(cfg.netgsm.user && cfg.netgsm.pass && cfg.netgsm.header);
  if (cfg.provider === 'twilio') return Boolean(cfg.twilio.sid && cfg.twilio.token && (cfg.twilio.from || cfg.twilio.messagingServiceSid));
  return false;
}

async function withTimeout(url, options) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

async function sendNetgsm({ to, text }, cfg) {
  const n = cfg.netgsm;
  const params = new URLSearchParams({
    usercode: n.user, password: n.pass, gsmno: to.replace(/^\+90/, '').replace(/^\+/, ''),
    message: text, msgheader: n.header, dil: 'TR'
  });
  const res = await withTimeout(`${n.url}?${params}`, { method: 'GET' });
  const body = (await res.text()).trim();
  // Documented success: "00 <jobid>" (also "01"/"02" variants). Anything else is an error code.
  if (res.ok && /^0[012]\b/.test(body)) return { ok: true };
  return { ok: false, reason: 'failed', detail: `Netgsm HTTP ${res.status} ${body.slice(0, 80)}` };
}

async function sendTwilio({ to, text }, cfg) {
  const t = cfg.twilio;
  const form = new URLSearchParams({ To: to, Body: text });
  if (t.messagingServiceSid) form.set('MessagingServiceSid', t.messagingServiceSid); else form.set('From', t.from);
  const res = await withTimeout(`${t.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(t.sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${t.sid}:${t.token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form
  });
  if (res.status === 201) return { ok: true };
  return { ok: false, reason: 'failed', detail: `Twilio HTTP ${res.status}` };
}

async function sendSms(message, cfg = config.sms) {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    return cfg.provider === 'netgsm' ? await sendNetgsm(message, cfg) : await sendTwilio(message, cfg);
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err.message };
  }
}

module.exports = { sendSms, isConfigured };
