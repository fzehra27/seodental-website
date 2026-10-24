'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const auth = require('./routes/auth');
const { clientIp, fail, sameOrigin } = require('./lib/http');
const { purge } = require('./lib/ratelimit');

const ROUTES = {
  'POST /api/auth/register': auth.register,
  'POST /api/auth/login': auth.login,
  'POST /api/auth/logout': auth.logout,
  'GET /api/auth/session': auth.sessionStatus,
  'GET /api/account': auth.account,
  'POST /api/account/verify': auth.verify,
  'POST /api/account/verify/resend': auth.resend
};

// Static files: ONLY these locations are public. server/, data/, .env, test/ etc. can never be served.
const PUBLIC_FILES = new Set(['/index.html']);
const PUBLIC_DIRS = ['/css/', '/js/', '/assets/'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  ...(config.cookieSecure ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return notFound(res); }
  if (rel === '/') rel = '/index.html';
  if (rel.includes('\0') || rel.includes('\\') || rel.split('/').includes('..')) return notFound(res);
  if (!PUBLIC_FILES.has(rel) && !PUBLIC_DIRS.some(d => rel.startsWith(d))) return notFound(res);

  const file = path.join(config.root, rel);
  if (!file.startsWith(config.root + path.sep)) return notFound(res);
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile() || path.basename(file).startsWith('.')) return notFound(res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Sayfa bulunamadı.');
}

async function handle(req, res) {
  req.ip = clientIp(req);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname.startsWith('/api/')) {
    const handler = ROUTES[`${req.method} ${pathname}`];
    if (!handler) {
      const known = Object.keys(ROUTES).some(k => k.endsWith(' ' + pathname));
      return fail(res, known ? 405 : 404, known ? 'method_not_allowed' : 'not_found', known ? 'Yöntem desteklenmiyor.' : 'Bulunamadı.');
    }
    if (req.method !== 'GET' && !sameOrigin(req)) return fail(res, 403, 'cross_site', 'Bu istek reddedildi.');
    try {
      return await handler(req, res);
    } catch (err) {
      if (err && err.status) return fail(res, err.status, 'bad_request', err.message);
      console.error('[error]', err);
      return fail(res, 500, 'server_error', 'Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
  }
  serveStatic(req, res, pathname);
}

function createServer() {
  db.open();
  return http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) fail(res, 500, 'server_error', 'Beklenmeyen bir hata oluştu.'); }); });
}

if (require.main === module) {
  const server = createServer();
  purge();
  setInterval(purge, 3600 * 1000).unref();
  server.listen(config.port, config.host, () => {
    console.log(`SeoDental sunucusu: http://${config.host}:${config.port}`);
    if (config.ephemeralSecret) console.warn('UYARI: APP_SECRET tanımlı değil; geçici bir anahtar kullanılıyor (yalnızca geliştirme).');
    console.log(`E-posta servisi: ${require('./lib/mailer').isConfigured() ? 'yapılandırıldı' : 'YAPILANDIRILMADI (doğrulama e-postası gönderilemez)'}`);
    console.log(`SMS servisi: ${require('./lib/sms').isConfigured() ? 'yapılandırıldı' : 'YAPILANDIRILMADI (doğrulama SMS\'i gönderilemez)'}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}

module.exports = { createServer };
