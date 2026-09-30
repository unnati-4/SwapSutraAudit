/**
 * test_data_never_zeroes.cjs  (25 Sep 2026)
 *
 * "Use karte hue bich me sab 0 ho jata hai" — in the middle of a session,
 * the Library and the counters dropped to 0.
 *
 * Cause: Apps Script fails for a moment now and then (Google's "page not
 * found" for a healthy deployment; quota/lock errors). Measured live: 1 of
 * 3 back-to-back getBooks calls returned 502. The Library's background
 * refresh turned that error into an EMPTY LIST (setBooks([])) and even
 * wrote the empty list to the browser cache; the profile refresh cleared
 * the profile first and left it empty when the call failed.
 *
 * Fixed in three layers, all tested here:
 *   1. proxy (api/swapsutra.ts): retries transient Apps Script answers,
 *      never caches a failure, and falls back to the last good answer;
 *   2. browser fetch wrapper (App.tsx + services/resilience.ts): retries
 *      reads and returns the last good answer instead of an error;
 *   3. the screens themselves no longer replace data with nothing.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('src/App.tsx');
const proxySrc = read('api/swapsutra.ts');

// ── 1. What counts as a passing failure ─────────────────────────────────
console.log('--- 1. transient vs real answers ---');
const R = { exports: {} };
vm.runInNewContext(esbuild.transformSync(read('src/services/resilience.ts'), { loader: 'ts', format: 'cjs' }).code,
  { module: R, exports: R.exports, URL });
const r = R.exports;
check('1. Proxy 502 (Google error page) is transient', r.isTransientFailure(502, { success: false, error: 'BACKEND_DEPLOYMENT_NOT_FOUND' }));
check('2. Apps Script "Server Error: …" is transient', r.isTransientFailure(200, { success: false, message: 'Server Error: Exception: Service Spreadsheets timed out' }));
check('3. "Too many simultaneous invocations" is transient', r.isTransientFailure(200, { success: false, message: 'Exception: Too many simultaneous invocations: Spreadsheets' }));
check('4. A real "no" is not (session expired)', !r.isTransientFailure(401, { success: false, error: 'SESSION_REQUIRED' }) && !r.isTransientFailure(200, { success: false, error: 'SESSION_REQUIRED', message: 'Your session has expired.' }));
check('5. A real "no" is not (not found / validation)', !r.isTransientFailure(200, { success: false, message: 'Book not found.' }) && !r.isTransientFailure(200, { success: false, message: 'Temporary exchange is not offered on this book.' }));
check('6. A successful answer is not a failure', !r.isTransientFailure(200, { success: true, data: [] }) && !r.isTransientFailure(200, [{ id: 1 }]));
check('7. GETs are reads; get*/list* POSTs are reads; createBook is not',
  r.isReadRequest('GET', 'anything') && r.isReadRequest('POST', 'getReadersCafe') && !r.isReadRequest('POST', 'createBook') && !r.isReadRequest('POST', 'sendChatMessage'));
check('8. checkExpiredSubscriptions (a write) is not mistaken for a read', !r.isReadRequest('POST', 'checkExpiredSubscriptions'));
check('9. Action is read from the URL or the JSON body', r.actionOf('/api/swapsutra?action=getBooks', '') === 'getBooks' && r.actionOf('/api/swapsutra', '{"action":"getNotifications"}') === 'getNotifications');
check('10. A write is retried only when the script never ran', r.isSafeToRetryWrite(502, { error: 'BACKEND_DEPLOYMENT_NOT_FOUND' }) && !r.isSafeToRetryWrite(200, { success: false, message: 'Server Error: x' }));
r.rememberGood('k', '[1,2,3]');
check('11. The last good answer is kept and recalled', r.recallGood('k') && r.recallGood('k').text === '[1,2,3]');

// ── 2. The browser wrapper ──────────────────────────────────────────────
console.log('--- 2. fetch wrapper ---');
check('12. Reads are retried with a backoff', /if \(canRetry && attempt < \(isRead \? RETRY_DELAYS_MS\.length : 1\)\)/.test(app));
check('13. A read that still fails returns the last good answer', /const good = recallGood\(memoKey\);\s*response = good\s*\? new Response\(good\.text/.test(app));
check('14. Only real answers are remembered', /if \(isRead && outcome\.good && outcome\.text\) rememberGood\(memoKey, outcome\.text\);/.test(app));
check('15. A dropped write is not repeated', /A dropped connection: retry reads; a write may have gone through/.test(app));
check('16. The remembered answer is per session (token), never shared between readers', /token \? token\.slice\(-16\) : 'guest'/.test(app));

// ── 3. The screens ──────────────────────────────────────────────────────
console.log('--- 3. screens keep what they have ---');
const fd = app.slice(app.indexOf('  const fetchData = async () => {'), app.indexOf('  // Events load the first time an events page is opened'));
check('17. Library: a failed answer no longer becomes an empty list', !/booksResponse\.success \? booksResponse\.data : \[\]\)/.test(fd) && /if \(booksData\) \{\s*setBooks\(normalizeBookList\(booksData\)\);/.test(fd));
check('18. Library: an empty list is never written to the cache on failure', !/writeLibraryCache\(LIBRARY_CACHE_KEYS\.books, booksData \|\| \[\]\)/.test(fd));
check('19. Profile: a refresh for the same reader keeps what is on screen', /if \(!sameReader\) setProfileData\(null\);/.test(app) && /const sameReader = profileEmailRef\.current === email && !!profileData;/.test(app));

// ── 4. The proxy, run for real against a flaky Apps Script ──────────────
console.log('--- 4. proxy against a flaky backend ---');
(async () => {
  const js = esbuild.transformSync(proxySrc, { loader: 'ts', format: 'cjs' }).code;
  let now = 1_000_000;
  class FakeDate extends Date { static now() { return now; } }
  let upstream = [];            // queue of answers
  let upstreamCalls = 0;
  const page404 = { status: 404, text: '<html><title>Page Not Found</title>Sorry, unable to open the file at this time.</html>' };
  const books = { status: 200, text: JSON.stringify([{ id: 'B1', title: 'One' }, { id: 'B2', title: 'Two' }]) };
  const sandbox = {
    module: { exports: {} }, exports: {}, require, console: { log() {}, warn() {}, error() {} },
    process: { env: { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/X/exec' } },
    Date: FakeDate, URL, setTimeout: (fn) => setImmediate(fn), clearTimeout,
    fetch: async () => {
      upstreamCalls++;
      const a = upstream.length ? upstream.shift() : books;
      if (a === 'THROW') throw new Error('socket hang up');
      return { status: a.status, ok: a.status < 400, text: async () => a.text, headers: new Map() };
    },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(js, sandbox);
  const handler = sandbox.module.exports.default;
  const call = async (query, method = 'GET', body) => {
    const out = { status: 0, body: null, headers: {} };
    const res = {
      setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
      status: (s) => { out.status = s; return res; },
      json: (b) => { out.body = b; return res; },
      end: () => res,
    };
    await handler({ method, query, body: body || {}, headers: {}, cookies: {} }, res);
    return out;
  };

  upstream = [page404, books];
  upstreamCalls = 0;
  let o = await call({ action: 'getBooks' });
  check('20. A passing "page not found" is retried and the Library still arrives', o.status === 200 && Array.isArray(o.body) && o.body.length === 2 && upstreamCalls === 2, JSON.stringify(o));

  now += 5 * 60 * 1000;            // past the 60 s cache, within the 10 min stale window
  upstream = [page404, page404, page404];
  upstreamCalls = 0;
  o = await call({ action: 'getBooks' });
  check('21. Three failures in a row → last good Library, marked stale, not an error',
    o.status === 200 && Array.isArray(o.body) && o.body.length === 2 && o.headers['x-swapsutra-stale'] === '1', JSON.stringify(o));
  check('22. ...after trying three times', upstreamCalls === 3, upstreamCalls);

  now += 3 * 60 * 1000;            // still inside the 10 min window
  upstream = [{ status: 200, text: JSON.stringify({ success: false, message: 'Server Error: Exception: Service Spreadsheets timed out' }) }];
  o = await call({ action: 'getBooks' });
  check('23. An Apps Script error JSON is not served as the Library — the last good one is', o.status === 200 && Array.isArray(o.body) && o.body.length === 2);
  upstream = [];
  now += 61 * 1000;
  o = await call({ action: 'getBooks' });
  check('24. ...and the error was not cached: the next call gets real data', Array.isArray(o.body) && o.body.length === 2);

  now += 20 * 60 * 1000;           // beyond the stale window
  upstream = [page404, page404, page404];
  o = await call({ action: 'getBooks' });
  check('25. Very old data is not passed off as current (plain error after 10 min)', o.status === 502 && o.body && o.body.success === false);

  upstream = [page404, { status: 200, text: JSON.stringify({ success: true, id: 'B9' }) }];
  upstreamCalls = 0;
  o = await call({}, 'POST', { action: 'createBook', sessionToken: 't', title: 'x' });
  check('26. A write that Google refused to run is sent again (it never ran)', o.body && o.body.success === true && upstreamCalls === 2, JSON.stringify(o.body));

  upstream = ['THROW'];
  upstreamCalls = 0;
  o = await call({}, 'POST', { action: 'createBook', sessionToken: 't', title: 'x' });
  check('27. A write whose connection dropped is NOT repeated (it may have gone through)', upstreamCalls === 1 && o.status === 500);

  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  process.exit(failed === 0 ? 0 : 1);
})();
