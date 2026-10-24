'use strict';
const http = require('node:http');

/** Starts the real server on a random port; returns a tiny cookie-jar HTTP client. */
async function start(createServer) {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    const jar = {};
    const c = {
      csrf: '',
      jar,
      async call(method, path, body, headers = {}) {
        const h = { ...headers };
        if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
        if (Object.keys(jar).length) h.Cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (method !== 'GET' && c.csrf && !('X-CSRF-Token' in h)) h['X-CSRF-Token'] = c.csrf;
        const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
        for (const sc of res.headers.getSetCookie()) {
          const [pair, ...attrs] = sc.split(';');
          const i = pair.indexOf('=');
          const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
          if (value === '' || attrs.some(a => /max-age=0/i.test(a))) delete jar[name]; else jar[name] = value;
        }
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: res.status, data, headers: res.headers, setCookie: res.headers.getSetCookie() };
      }
    };
    return c;
  }
  return { server, base, client, close: () => new Promise(r => server.close(r)) };
}

module.exports = { start };
