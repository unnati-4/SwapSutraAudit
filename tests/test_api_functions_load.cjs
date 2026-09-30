/**
 * test_api_functions_load.cjs  (28 Sep 2026)
 *
 * "The pop-up notification system is not working for any user."
 * Cause: api/notifications.ts imported "./_dailyCopy" without a file
 * extension. Vercel runs api/*.ts as ES modules (package.json has
 * "type": "module"), where that import cannot be found — so the whole
 * function crashed on load (FUNCTION_INVOCATION_FAILED) for every route:
 * vapid-key, subscribe-push, subscribe-guest, relay. No device could be
 * registered and no pop-up could be sent.
 *
 * This loads every api/*.ts the way Vercel does (ESM, not bundled) and
 * checks the notifications function answers even with bad VAPID keys.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { pathToFileURL } = require('url');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const out = path.join(root, '.apiload');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');

(async () => {
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.ts') && !f.startsWith('_') && f !== 'index.ts');
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, 'api', f), 'utf8');
    const rel = [...src.matchAll(/^import[^'"]*['"](\.[^'"]+)['"]/gm)].map((m) => m[1]);
    check(`${f}: imports only packages (no "./file" imports that break on Vercel)`, rel.length === 0, rel.join(', '));
    const js = esbuild.transformSync(src, { loader: 'ts', format: 'esm', platform: 'node' }).code;
    const target = path.join(out, f.replace(/\.ts$/, '.mjs'));
    fs.writeFileSync(target, js);
    try {
      const m = await import(pathToFileURL(target).href + '?t=' + Date.now());
      check(`${f}: loads as an ES module, as on Vercel`, typeof m.default === 'function');
    } catch (err) {
      check(`${f}: loads as an ES module, as on Vercel`, false, err.code + ' ' + String(err.message).slice(0, 160));
    }
  }

  // The notifications function must answer even with broken VAPID keys.
  const call = async (env, route, method = 'GET', body = {}) => {
    const keep = { ...process.env };
    Object.assign(process.env, env);
    const target = path.join(out, `notifications_${Math.random().toString(36).slice(2)}.mjs`);
    fs.writeFileSync(target, esbuild.transformSync(fs.readFileSync(path.join(root, 'api/notifications.ts'), 'utf8'), { loader: 'ts', format: 'esm', platform: 'node' }).code);
    const m = await import(pathToFileURL(target).href);
    const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await m.default({ method, url: '/api/notifications/' + route, query: { route }, body, headers: {} }, res);
    for (const k of Object.keys(env)) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; }
    return res;
  };
  let r = await call({ VAPID_PUBLIC_KEY: 'not-a-key', VAPID_PRIVATE_KEY: 'also-bad' }, 'vapid-key');
  check('Bad VAPID keys no longer crash the function (vapid-key answers "not configured")', r.code === 200 && r.body.configured === false);
  r = await call({ VAPID_PUBLIC_KEY: 'not-a-key', VAPID_PRIVATE_KEY: 'also-bad' }, 'status');
  check('/status says what is wrong, as yes/no + a reason, never a key', r.body.vapidKeys === false && /VAPID|invalid|must|bytes/i.test(r.body.vapidKeyProblem) && !/also-bad/.test(JSON.stringify(r.body)));
  const webpush = (await import('web-push')).default;
  const keys = webpush.generateVAPIDKeys();
  r = await call({ VAPID_PUBLIC_KEY: '"' + keys.publicKey + '"\n', VAPID_PRIVATE_KEY: ' ' + keys.privateKey + ' ', PUSH_RELAY_SECRET: 'a-very-long-relay-secret-123', GEMINI_API_KEY: 'x' }, 'status');
  check('Keys pasted with quotes/spaces still work', r.body.vapidKeys === true && r.body.relaySecret === true && r.body.geminiKey === true, JSON.stringify(r.body));
  r = await call({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }, 'vapid-key');
  check('vapid-key hands the browser the public key (so phones can subscribe)', r.body.configured === true && r.body.publicKey === keys.publicKey);
  const src = fs.readFileSync(path.join(root, 'api/notifications.ts'), 'utf8');
  check('Pop-ups wait for a closed browser: TTL 12 h (daily) / 24 h, high urgency', /TTL: daily \? 12 \* 3600 : 24 \* 3600, urgency: 'high'/.test(src) && /sendNotification\(\{ endpoint: sub\.endpoint, keys: sub\.keys \}, payload, pushOptionsFor\(item\)\)/.test(src));

  fs.rmSync(out, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  process.exit(failed === 0 ? 0 : 1);
})();
