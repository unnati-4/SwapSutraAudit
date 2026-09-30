/**
 * test_login_speed.cjs
 *
 * "The OTP page takes too long to jump to the next one."
 *
 * The cause was not the frontend — it makes one fetch and moves on. It
 * was that sending one login code cost about thirty round trips to the
 * Sheets service, including two full-sheet reads (~34,000 cells) to
 * answer two small questions: "does this address exist?" and "how many
 * codes went out in the last hour?".
 *
 * This suite runs the REAL appsscript.js against an instrumented Sheets
 * stand-in that COUNTS every API call and every cell read, so the
 * improvement is measured rather than asserted by eye — and so a future
 * change that quietly reintroduces a full-sheet scan on the login path
 * fails here instead of in production.
 *
 * It also pins the behaviour that had to survive the optimisation:
 * throttling, the unregistered-email gate, the admin exemption, and
 * end-to-end verify.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const gas = read('appsscript.js');
const app = read('src/App.tsx');
const css = read('src/index.css');

// ---------------------------------------------------------------------
// Instrumented Sheets stand-in: counts calls and cells.
// ---------------------------------------------------------------------
let apiCalls = [];
let cellsRead = 0;
const tally = (what) => apiCalls.push(what);

function makeSheet(name, headers, rowCount, fill) {
  const data = [headers.slice()];
  for (let i = 0; i < rowCount; i++) data.push(fill(i));
  return {
    __name: name,
    __rows: data,
    getDataRange: () => {
      tally(name + '.getDataRange');
      return {
        getValues: () => {
          tally(name + '.getValues:FULL');
          cellsRead += data.length * (data[0] ? data[0].length : 0);
          return data;
        }
      };
    },
    getRange: (r, c, nr, nc) => {
      tally(name + '.getRange');
      return {
        getValues: () => {
          tally(name + '.getValues:RANGE');
          cellsRead += (nr || 1) * (nc || 1);
          const out = [];
          for (let i = r - 1; i < r - 1 + (nr || 1); i++) {
            const row = data[i] || [];
            out.push(row.slice(c - 1, c - 1 + (nc || 1)));
          }
          return out;
        },
        getValue: () => ((data[r - 1] || [])[c - 1] || ''),
        setValue: (v) => { if (data[r - 1]) data[r - 1][c - 1] = v; }
      };
    },
    getLastRow: () => { tally(name + '.getLastRow'); return data.length; },
    getLastColumn: () => { tally(name + '.getLastColumn'); return headers.length; },
    appendRow: (row) => { tally(name + '.appendRow'); data.push(row.slice()); },
    deleteRow: (r) => { tally(name + '.deleteRow'); data.splice(r - 1, 1); },
    deleteRows: (r, n) => { tally(name + '.deleteRows'); data.splice(r - 1, n); },
    setName: () => {},
    getSheets: () => []
  };
}

const HOUR = 60 * 60 * 1000;
const USER_COUNT = 800;
const USER_HEADERS = ["id", "name", "email", "phone", "area", "pincode", "genres", "bio", "membershipStatus", "paymentStatus", "createdAt", "updatedAt"];
const OTP_HEADERS = ["id", "email", "otp", "expiresAt", "verified", "createdAt"];

// 4000 OTP rows — roughly a year of logins, appended OLDEST FIRST, which
// is how appendRow actually leaves a sheet.
const OTP_HISTORY = 4000;

const sheets = {};
function buildSheets() {
  sheets.Users = makeSheet('Users', USER_HEADERS, USER_COUNT, i => [
    'U' + i, 'Reader ' + i, 'reader' + i + '@example.com', '98765432' + (i % 100),
    'Area', '560001', 'Fiction', 'A fairly long bio that costs real bytes. '.repeat(4),
    'Active', 'Paid', '2026-01-01', '2026-01-01'
  ]);
  sheets.OTP = makeSheet('OTP', OTP_HEADERS, OTP_HISTORY, i => {
    const age = (OTP_HISTORY - i) * HOUR;
    return ['OTP' + i, 'reader' + (i % USER_COUNT) + '@example.com', '123456',
      new Date(Date.now() - age + 10 * 60000), 'Yes', new Date(Date.now() - age)];
  });
  sheets.OTPAttempts = makeSheet('OTPAttempts', ["email", "outcome", "createdAt"], 1200, i => {
    const age = (1200 - i) * HOUR;
    return ['reader' + (i % USER_COUNT) + '@example.com', 'failed', new Date(Date.now() - age)];
  });
  sheets.ActivityLogs = makeSheet('ActivityLogs', ["id", "email", "action", "details", "status", "category", "createdAt"], 0, () => []);
}
buildSheets();

const props = new Map([['SPREADSHEET_ID', 'TEST']]);
const sandbox = {
  console, Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => {
      tally('PropertiesService.getScriptProperties');
      return {
        getProperty: (k) => { tally('props.getProperty'); return props.has(k) ? props.get(k) : null; },
        getProperties: () => { tally('props.getProperties'); const o = {}; props.forEach((v, k) => { o[k] = v; }); return o; },
        setProperty: (k, v) => props.set(k, v),
        deleteProperty: (k) => props.delete(k)
      };
    }
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', Buffer.from(String(k))).update(Buffer.from(String(v))).digest()),
    base64EncodeWebSafe: (i) => (Array.isArray(i) ? Buffer.from(i.map(b => b & 0xff)) : Buffer.from(String(i), 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')),
    newBlob: (b) => ({ getDataAsString: () => Buffer.from((b || []).map(x => x & 0xff)).toString('utf8') }),
    formatDate: () => ''
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    openById: () => {
      tally('SpreadsheetApp.openById');
      return {
        getSheetByName: (n) => { tally('ss.getSheetByName'); return sheets[n] || null; },
        insertSheet: (n) => (sheets[n] = makeSheet(n, [], 0, () => [])),
        getSheets: () => Object.values(sheets)
      };
    }
  },
  MailApp: { sendEmail() { tally('MailApp.sendEmail'); } },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(gas, ctx, { filename: 'appsscript.js' });
const run = (expr) => vm.runInContext(expr, ctx);
const call = (fn, ...args) => vm.runInContext(`(${fn}).apply(null, ${JSON.stringify(args)})`, ctx);

/** One request: reset caches, measure, return the profile. */
function request(fn, ...args) {
  run('resetRequestIdentity()');
  apiCalls = [];
  cellsRead = 0;
  const result = fn === 'sendOTP'
    ? call('sendOTP', ...args)
    : call(fn, ...args);
  return { result, calls: apiCalls.length, cells: cellsRead, list: apiCalls.slice() };
}

const countOf = (list, needle) => list.filter(c => c === needle).length;
const reset0 = () => run('resetRequestIdentity()');

// =====================================================================
console.log('\n--- The login path no longer reads whole sheets ---');

// First call also runs the purge, because the fixture starts at 4000 rows.
const cold = request('sendOTP', 'reader500@example.com');
check('1. A login code is still sent',
  cold.result && cold.result.success === true);
check('2. NO full-sheet read happens anywhere in the login path',
  countOf(cold.list, 'Users.getValues:FULL') === 0 && countOf(cold.list, 'OTP.getValues:FULL') === 0,
  cold.list.filter(c => c.includes('FULL')).join(', '));

const steady = request('sendOTP', 'reader500@example.com');
check('3. THE FIX: a login now reads under 2,000 cells, not ~34,000',
  steady.cells < 2000, steady.cells + ' cells');
check('4. ...and costs fewer than 22 round trips, down from ~30',
  steady.calls < 22, steady.calls + ' calls');

console.log(`      measured: ${steady.calls} API calls, ${steady.cells} cells read`);

check('5. The spreadsheet is opened ONCE per request, not once per sheet lookup',
  countOf(steady.list, 'SpreadsheetApp.openById') === 1,
  countOf(steady.list, 'SpreadsheetApp.openById') + ' opens');
check('6. Each sheet is resolved once per request',
  countOf(steady.list, 'ss.getSheetByName') <= 2,
  countOf(steady.list, 'ss.getSheetByName') + ' lookups');
// Four settings are consulted per login (QA mode, code lifetime, send
// ceiling, send window). getProperties() fetches all of them in ONE
// round trip, cached for the request, so the count is one — not four.
check('7. Every script setting is fetched in a single round trip',
  countOf(steady.list, 'props.getProperties') <= 1
  && countOf(steady.list, 'props.getProperty') === 0,
  countOf(steady.list, 'props.getProperties') + ' bulk, '
  + countOf(steady.list, 'props.getProperty') + ' single');
check('8. The email is still actually sent',
  countOf(steady.list, 'MailApp.sendEmail') === 1);

check('9. Checking an address reads ONE column, not every reader\'s bio',
  /const column = sheet\.getRange\(2, emailIdx \+ 1, lastRow - 1, 1\)\.getValues\(\)/.test(gas));
check('10. The throttle counter reads a bounded tail, not the whole log',
  /function readRecentRows/.test(gas) && /OTP_RECENT_ROWS_SCAN/.test(gas));

// =====================================================================
console.log('\n--- The OTP log stops growing without limit ---');

check('11. The purge collapsed a year of rows in one deleteRows call',
  sheets.OTP.__rows.length - 1 < 100,
  (sheets.OTP.__rows.length - 1) + ' rows left');
check('12. ...using a single ranged delete, not one call per row',
  countOf(cold.list, 'OTP.deleteRows') === 1 && countOf(cold.list, 'OTP.deleteRow') === 0);
check('13. Rows inside the retention window were NOT deleted',
  sheets.OTP.__rows.slice(1).every(r => {
    const age = Date.now() - new Date(r[5]).getTime();
    return age < 25 * HOUR;
  }));
check('14. A purge on a sheet with nothing stale removes nothing',
  call('purgeStaleOtpRows', 'OTP', OTP_HEADERS) === 0);
check('15. There is a housekeeping entry point for a daily trigger',
  /function purgeStaleOtpSheets/.test(gas));

// A row with an unreadable date must stop the walk, not be deleted on a guess.
sheets.OTP.__rows.splice(1, 0, ['OTP_BAD', 'x@y.com', '000000', '', 'No', 'not-a-date']);
const beforeBad = sheets.OTP.__rows.length;
call('purgeStaleOtpRows', 'OTP', OTP_HEADERS);
check('16. A row with an unparseable date is left alone rather than dropped',
  sheets.OTP.__rows.length === beforeBad);
sheets.OTP.__rows.splice(1, 1);

// =====================================================================
console.log('\n--- Everything the optimisation had to not break ---');

const unknown = request('sendOTP', 'nobody-here@example.com');
check('17. An unregistered address still gets no code',
  unknown.result.success === false && unknown.result.code === 'EMAIL_NOT_REGISTERED');
check('18. ...and no email was sent for it',
  countOf(unknown.list, 'MailApp.sendEmail') === 0);

const known = request('sendOTP', 'reader7@example.com');
check('19. A registered address still gets one',
  known.result.success === true);

const admin = request('sendOTP', 'swapsutra@gmail.com');
check('20. The owner is still exempt from the registered-user gate',
  admin.result.success === true);

const blank = request('sendOTP', '');
check('21. A blank address is still rejected up front',
  blank.result.success === false && blank.result.code === 'EMAIL_REQUIRED');

// Throttle: the tail scan must still see the reader's own recent sends.
run('resetRequestIdentity()');
let throttled = null;
reset0();
const sendLimit = call('getOtpMaxSends');
for (let i = 0; i < sendLimit + 3; i++) {
  run('resetRequestIdentity()');
  const r = call('sendOTP', 'reader11@example.com');
  if (r.success === false && r.code === 'OTP_RATE_LIMITED') { throttled = i; break; }
}
check('22. Throttling still fires after the tail-scan change',
  throttled !== null, 'never throttled');
check('23. ...at the documented limit, not earlier or later',
  throttled === sendLimit, 'fired on attempt ' + throttled + ', limit ' + sendLimit);
// A one-minute code makes "send me another" an ordinary act, so the send
// ceiling had to rise with it. The brute-force ceiling did NOT.
// The ceiling is now "one code plus a few resends" inside a short send
// window, rather than a big hourly allowance.
check('23b. The send ceiling allows at least one original plus resends',
  sendLimit >= 2 && sendLimit <= 20, 'limit ' + sendLimit);
check('23c. ...but the guess ceiling, which is the real takeover control, did not',
  run('OTP_MAX_FAILED_ATTEMPTS') === 8);

// A reader whose sends are OLD must not be throttled by them.
sheets.OTP.__rows.push(['OTP_OLD_1', 'reader12@example.com', '111111', new Date(), 'Yes', new Date(Date.now() - 5 * HOUR)]);
sheets.OTP.__rows.push(['OTP_OLD_2', 'reader12@example.com', '111111', new Date(), 'Yes', new Date(Date.now() - 4 * HOUR)]);
run('resetRequestIdentity()');
// countRecentOtpSends now returns {count, oldestAt} so the caller can
// say exactly how long the wait is, rather than quoting a flat window.
check('24. Sends older than the window do not count against a reader',
  call('countRecentOtpSends', 'reader12@example.com').count === 0);

// =====================================================================
console.log('\n--- Verify still works end to end ---');

run('resetRequestIdentity()');
const issued = call('sendOTP', 'reader21@example.com');
const lastOtpRow = sheets.OTP.__rows[sheets.OTP.__rows.length - 1];
const code = String(lastOtpRow[2]);
check('25. A code was written to the sheet for that address',
  issued.success === true && String(lastOtpRow[1]) === 'reader21@example.com' && /^\d{6}$/.test(code));

run('resetRequestIdentity()');
const wrong = call('verifyOTP', 'reader21@example.com', '000000');
check('26. A wrong code is refused',
  wrong.success === false);

run('resetRequestIdentity()');
const right = call('verifyOTP', 'reader21@example.com', code);
check('27. The right code signs the reader in',
  right.success === true && typeof right.sessionToken === 'string' && right.sessionToken.length > 0);
check('28. ...and the session it returns actually verifies',
  (() => {
    const s = call('verifySessionToken', right.sessionToken);
    return s && s.email === 'reader21@example.com';
  })());

run('resetRequestIdentity()');
const replay = call('verifyOTP', 'reader21@example.com', code);
check('29. The same code cannot be replayed',
  replay.success === false);

// =====================================================================
console.log('\n--- The handle cache is per-request, never across readers ---');

check('30. resetRequestIdentity clears the sheet cache with the session',
  /function resetRequestIdentity\(\)[\s\S]{0,240}resetSheetCache\(\)/.test(gas));
const a = request('sendOTP', 'reader31@example.com');
const b = request('sendOTP', 'reader32@example.com');
check('31. A second request re-opens the spreadsheet rather than reusing the first',
  countOf(a.list, 'SpreadsheetApp.openById') === 1 && countOf(b.list, 'SpreadsheetApp.openById') === 1);
check('32. The one place that deletes/renames sheets drops the cache',
  /function safeCleanupSheets\(\)[\s\S]{0,320}resetSheetCache\(\)/.test(gas));

check('33. ensureSheetHeaders still exists for sheets that genuinely reconcile columns',
  /function ensureSheetHeaders/.test(gas) && /sheet\.getRange\(1, headers\.length \+ 1\)\.setValue\(header\)/.test(gas));

// =====================================================================
console.log('\n--- The wait that remains is honest, not a frozen button ---');

check('34. The send button spins instead of showing a static word',
  /const WaitingButton = memo/.test(app) && /className="auth-spinner"/.test(app));
check('35. It says what it is doing',
  /busyLabel="Sending your code…"/.test(app));
check('36. ...and admits it when the wait runs long, rather than looking stuck',
  /slowLabel="Still sending — one moment"/.test(app));
check('37. The waiting state is announced to screen readers',
  /aria-busy=\{loading \|\| undefined\}/.test(app));
check('38. Reduced motion slows the spinner instead of freezing it mid-turn',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,160}\.auth-spinner \{ animation: auth-spin 1\.6s/.test(css));
check('39. The code field offers a phone its number pad',
  /inputMode="numeric"/.test(app) && /autoComplete="one-time-code"/.test(app));
check('40. ...and still focuses itself so the reader can type straight away',
  /autoFocus[\s\S]{0,200}inputMode="numeric"/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
