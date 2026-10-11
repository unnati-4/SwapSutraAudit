/**
 * tests/e2e/bridge.cjs — the real appsscript.js (in gas_fake) behind an
 * HTTP endpoint shaped like production's /api/swapsutra (api/swapsutra.ts):
 * the session comes from "Authorization: Bearer …", actions outside the
 * public list need a session, and the answer is the script's JSON.
 * A browser test routes /api/swapsutra to this, so the built site runs
 * against the real backend logic.
 *
 *   node tests/e2e/bridge.cjs 8990
 *   GET /__otp?email=…   → the last login code mailed to that address
 *   GET /__now?ms=…      → move the clock
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const H = require('./journey_helpers.cjs');

const port = Number(process.argv[2] || 8990);
const rt = H.boot({});
const api = fs.readFileSync(path.join(require('./gas_fake.cjs').root, 'api', 'swapsutra.ts'), 'utf8');
const pubBlock = api.slice(api.indexOf('const PUBLIC_ACTIONS'), api.indexOf(']);', api.indexOf('const PUBLIC_ACTIONS')));
const PUBLIC = new Set([...pubBlock.matchAll(/'([a-zA-Z_]+)'/g)].map(m => m[1]));

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    try {
      if (u.pathname === '/__otp') return send(res, 200, { otp: rt.lastOtp(u.searchParams.get('email') || '') });
      if (u.pathname === '/__now') { rt.now(Number(u.searchParams.get('ms'))); return send(res, 200, { ok: true }); }
      if (u.pathname === '/__rows') return send(res, 200, rt.rows(u.searchParams.get('sheet') || ''));
      if (!/\/api\/swapsutra/.test(u.pathname)) return send(res, 200, { success: true });
      const body = req.method === 'POST' && raw ? JSON.parse(raw) : {};
      const auth = String(req.headers['authorization'] || '');
      const token = (auth.startsWith('Bearer ') ? auth.slice(7) : '') || body.sessionToken || u.searchParams.get('sessionToken') || '';
      const action = String(req.method === 'POST' ? body.action : u.searchParams.get('action') || '');
      if (req.method === 'POST' && action === 'logout') return send(res, 200, { success: true });
      if (req.method === 'POST' && action === 'lookupIsbn') return send(res, 200, { success: true, found: false });
      if (action && !PUBLIC.has(action) && !token) return send(res, 401, { success: false, error: 'SESSION_REQUIRED', message: 'Your session has expired. Please sign in again to continue.' });
      let out;
      if (req.method === 'POST') { const { adminEmail, ...rest } = body; out = rt.post(rest, token); }
      else { const p = {}; u.searchParams.forEach((v, k) => { if (k !== 'adminEmail' && k !== 'fresh') p[k] = v; }); out = rt.get(p, token); }
      return send(res, 200, out === undefined ? null : out);
    } catch (e) {
      return send(res, 500, { success: false, message: String(e && e.stack || e) });
    }
  });
}).listen(port, '127.0.0.1', () => console.log('bridge on ' + port));
