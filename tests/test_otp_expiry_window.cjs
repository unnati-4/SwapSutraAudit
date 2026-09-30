/**
 * test_otp_expiry_window.cjs
 *
 * The login code's lifetime was cut from 10 minutes to 50 seconds, and
 * resends were capped at three (four sends in all) inside a 15-minute
 * window. Both are tunable from Script Properties.
 *
 * Shortening it is only half a change. A code is unusable until it lands
 * in an inbox, and email delivery is not instant, so a short window turns
 * "expired" from a rare event into a routine one. That is safe ONLY if
 * three things hold, and this suite exists to hold them:
 *
 *   1. An expired code is reported as EXPIRED, distinctly from a wrong
 *      one — the next step is "get another", not "look harder".
 *   2. The resend cap reports exactly when it lifts, and never dead-ends
 *      a reader with a button that will be refused.
 *   3. The screen counts down, so nobody types into a dead code.
 *
 * The backend half runs the REAL appsscript.js against an in-memory
 * Sheets stand-in. The React and CSS half is source-level.
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

const USER_HEADERS = ["id", "name", "email", "phone", "membershipStatus", "createdAt"];
const OTP_HEADERS = ["id", "email", "otp", "expiresAt", "verified", "createdAt"];

function makeSheet(headers, rows) {
  const data = [headers.slice(), ...rows.map(r => r.slice())];
  return {
    __rows: data,
    getDataRange: () => ({ getValues: () => data }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = r - 1; i < r - 1 + (nr || 1); i++) {
          out.push((data[i] || []).slice(c - 1, c - 1 + (nc || 1)));
        }
        return out;
      },
      getValue: () => ((data[r - 1] || [])[c - 1] || ''),
      setValue: (v) => { if (data[r - 1]) data[r - 1][c - 1] = v; }
    }),
    getLastRow: () => data.length,
    getLastColumn: () => headers.length,
    appendRow: (row) => data.push(row.slice()),
    deleteRow: (r) => data.splice(r - 1, 1),
    deleteRows: (r, n) => data.splice(r - 1, n)
  };
}

const sheets = {
  Users: makeSheet(USER_HEADERS, [
    ['U1', 'Priya Sharma', 'priya@example.com', '9876543210', 'Active', '2026-01-01'],
    ['U2', 'Arjun Rao', 'arjun@example.com', '9876543211', 'Active', '2026-01-01']
  ]),
  OTP: makeSheet(OTP_HEADERS, []),
  OTPAttempts: makeSheet(["email", "outcome", "createdAt"], []),
  ActivityLogs: makeSheet(["id", "email", "action", "details", "status", "category", "createdAt"], [])
};

const props = new Map([['SPREADSHEET_ID', 'TEST']]);
const sandbox = {
  console, Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      // The backend now fetches every setting in one getProperties call.
      getProperties: () => { const o = {}; props.forEach((v, k) => { o[k] = v; }); return o; },
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k)
    })
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', Buffer.from(String(k))).update(Buffer.from(String(v))).digest()),
    base64EncodeWebSafe: (i) => (Array.isArray(i) ? Buffer.from(i.map(b => b & 0xff)) : Buffer.from(String(i), 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')),
    newBlob: (b) => ({ getDataAsString: () => Buffer.from((b || []).map(x => x & 0xff)).toString('utf8') })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    openById: () => ({
      getSheetByName: (n) => sheets[n] || null,
      insertSheet: (n) => (sheets[n] = makeSheet([], [])),
      getSheets: () => Object.values(sheets)
    })
  },
  MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(gas, ctx, { filename: 'appsscript.js' });
const run = (expr) => vm.runInContext(expr, ctx);
const call = (fn, ...args) => vm.runInContext(`(${fn}).apply(null, ${JSON.stringify(args)})`, ctx);
const reset = () => run('resetRequestIdentity()');

/** The code and expiry of the newest OTP row. */
function newestOtp() {
  const rows = sheets.OTP.__rows;
  const last = rows[rows.length - 1];
  return { code: String(last[2]), expiresAt: new Date(last[3]), row: last };
}

// =====================================================================
console.log('\n--- The window is fifty seconds, and it is configurable ---');

check('1. The default is 50 seconds, not 10 minutes',
  run('OTP_TTL_DEFAULT_SECONDS') === 50);

reset();
check('2. getOtpTtlSeconds honours the default with nothing configured',
  call('getOtpTtlSeconds') === 50);

props.set('OTP_TTL_SECONDS', '120');
reset();
check('3. A Script Property changes it without touching code',
  call('getOtpTtlSeconds') === 120);

props.set('OTP_TTL_SECONDS', '5');
reset();
check('4. A dangerously short value is clamped up to the 30s floor',
  call('getOtpTtlSeconds') === 30,
  'got ' + call('getOtpTtlSeconds'));

props.set('OTP_TTL_SECONDS', '99999');
reset();
check('5. An absurdly long one is clamped down to the 10-minute ceiling',
  call('getOtpTtlSeconds') === 600);

props.set('OTP_TTL_SECONDS', 'banana');
reset();
check('6. Garbage falls back to the default rather than to zero',
  call('getOtpTtlSeconds') === 50);

props.delete('OTP_TTL_SECONDS');
reset();
check('7. The wording follows the setting, so the email never lies',
  call('describeOtpTtl') === '50 seconds');
props.set('OTP_TTL_SECONDS', '180');
reset();
check('8. ...including when it is expressed in minutes',
  call('describeOtpTtl') === '3 minutes');
props.delete('OTP_TTL_SECONDS');
reset();

// =====================================================================
console.log('\n--- A code issued now really does expire in fifty seconds ---');

reset();
const sent = call('sendOTP', 'priya@example.com');
check('9. A code is issued',
  sent.success === true);

const issued = newestOtp();
const lifetimeMs = issued.expiresAt.getTime() - Date.now();
check('10. It dies about fifty seconds from now, not ten minutes',
  lifetimeMs > 40 * 1000 && lifetimeMs <= 51 * 1000,
  Math.round(lifetimeMs / 1000) + 's');

check('11. sendOTP reports the exact expiry instant, so a countdown can be exact',
  typeof sent.expiresAt === 'string' && !isNaN(new Date(sent.expiresAt).getTime()));
check('12. ...and the duration too, as a fallback',
  sent.expiresInSeconds === 50);

// =====================================================================
console.log('\n--- THE THING THAT MAKES A SHORT WINDOW SAFE ---');

// Age the code past its expiry, exactly as the clock would.
issued.row[3] = new Date(Date.now() - 1000);
reset();
const expired = call('verifyOTP', 'priya@example.com', issued.code);
check('13. An expired code is refused',
  expired.success === false);
check('14. THE POINT: it is reported as EXPIRED, not as a wrong code',
  expired.code === 'OTP_EXPIRED',
  'got ' + expired.code);
check('15. ...and the message tells the reader what to do next',
  /new one/i.test(expired.message));
check('16. ...and names the real window, from the live setting',
  expired.message.includes('50 seconds'));

reset();
const wrong = call('verifyOTP', 'priya@example.com', '000000');
check('17. A genuinely wrong code is a DIFFERENT outcome',
  wrong.success === false && wrong.code === 'OTP_INVALID');
check('18. The two are distinguishable, which is what the UI branches on',
  expired.code !== wrong.code);

// A fresh code, used twice.
reset();
call('sendOTP', 'priya@example.com');
const fresh = newestOtp();
reset();
const first = call('verifyOTP', 'priya@example.com', fresh.code);
check('19. A code inside its window still signs the reader in',
  first.success === true && typeof first.sessionToken === 'string');
reset();
const second = call('verifyOTP', 'priya@example.com', fresh.code);
check('20. Reusing it is refused, and says so specifically',
  second.success === false && second.code === 'OTP_ALREADY_USED');

// =====================================================================
console.log('\n--- Three resends, then a pause that says how long ---');

reset();
check('21. Four codes per window: the original plus three resends',
  call('getOtpMaxSends') === 4);
check('22. The send window is fifteen minutes',
  call('getOtpSendWindowMs') === 15 * 60 * 1000);

// THE COUPLING BUG THIS SPLIT EXISTS TO PREVENT.
// Both limits used to share one 60-minute window. Shortening it to 15
// for resends would ALSO have shortened the brute-force window, taking
// an attacker's budget from 8 guesses an hour to 32 — a 4x weakening as
// an invisible side effect of a resend-policy change.
check('23. The GUESS ceiling is unchanged at 8',
  run('OTP_MAX_FAILED_ATTEMPTS') === 8);
check('24. ...and it still counts over a FULL HOUR, not the 15-minute send window',
  run('OTP_FAILED_WINDOW_MS') === 60 * 60 * 1000);
check('25. The two windows are genuinely separate values',
  run('OTP_FAILED_WINDOW_MS') !== call('getOtpSendWindowMs'));

// Exactly four sends, then a refusal.
const attempts = [];
for (let i = 0; i < 6; i++) {
  reset();
  attempts.push(call('sendOTP', 'arjun@example.com'));
}
check('26. The first four codes are sent',
  attempts.slice(0, 4).every(r => r.success === true));
check('27. The fifth is refused',
  attempts[4].success === false && attempts[4].code === 'OTP_RATE_LIMITED');
check('28. ...and so is the sixth',
  attempts[5].success === false && attempts[5].code === 'OTP_RATE_LIMITED');

check('29. Each success says how many codes are left, so the ceiling is never a surprise',
  attempts[0].sendsRemaining === 3 && attempts[3].sendsRemaining === 0);
check('30. The refusal reports WHEN the reader may try again, as an instant',
  typeof attempts[4].retryAt === 'string' && !isNaN(new Date(attempts[4].retryAt).getTime()));
check('31. ...and as a countdown of at most the window length',
  attempts[4].retryAfterSeconds > 0 && attempts[4].retryAfterSeconds <= 15 * 60);
check('32. The message gives the real remaining wait, not a flat "15 minutes"',
  /in under a minute|in about \d+ minute/.test(attempts[4].message),
  attempts[4].message);
check('33. ...and points at the codes already sent rather than dead-ending',
  /spam/i.test(attempts[4].message));

// A blocked address must not block everyone else.
reset();
check('34. The cap is per address — another reader is unaffected',
  call('sendOTP', 'priya@example.com').success === true);

// And it must lift as the window slides, not stay stuck.
reset();
const otpRows = sheets.OTP.__rows;
otpRows.forEach(r => {
  if (String(r[1]) === 'arjun@example.com') r[5] = new Date(Date.now() - 20 * 60 * 1000);
});
reset();
check('35. Once the oldest sends age out, the address can ask again',
  call('sendOTP', 'arjun@example.com').success === true);

check('36. Both limits are tunable without a redeploy',
  /OTP_MAX_SENDS/.test(gas) && /OTP_SEND_WINDOW_MINUTES/.test(gas));
props.set('OTP_MAX_SENDS', '1');
reset();
check('37. ...but the send ceiling cannot be set so low that one lost email is a dead end',
  call('getOtpMaxSends') === 2);
props.delete('OTP_MAX_SENDS');
reset();

// =====================================================================
console.log('\n--- Verification did not get slower while getting stricter ---');

check('26. verifyOTP no longer reads the whole OTP sheet',
  /const recent = readRecentRows\(sheet, OTP_RECENT_ROWS_SCAN\)/.test(gas));
check('27. ...and still writes to the right row after a partial read',
  /const sheetRowFor = \(i\) => firstDataRow \+ i;/.test(gas));

// The row-offset maths is the one thing a tail read can get wrong: prove
// it marks the code it actually matched, on a sheet with real history.
for (let i = 0; i < 40; i++) {
  sheets.OTP.__rows.push(['PAD' + i, 'someone' + i + '@example.com', '55555' + (i % 10),
    new Date(Date.now() + 60000), 'No', new Date()]);
}
reset();
call('sendOTP', 'arjun@example.com');
const target = newestOtp();
const targetIndex = sheets.OTP.__rows.length - 1;
reset();
const verified = call('verifyOTP', 'arjun@example.com', target.code);
check('28. A code deep in a populated sheet still verifies',
  verified.success === true);
check('29. ...and the row marked used is the RIGHT one, not an off-by-one neighbour',
  sheets.OTP.__rows[targetIndex][4] === 'Yes');
check('30. Someone else\'s outstanding code was not retired by mistake',
  sheets.OTP.__rows.some(r => String(r[1]).startsWith('someone') && r[4] === 'No'));

// =====================================================================
console.log('\n--- The screen tells the reader the code is running out ---');

check('31. A countdown component exists',
  /const OtpCountdown = memo/.test(app));
check('32. It counts from the SERVER\'s instant, not a client-side guess',
  /const stamp = String\(data\?\.expiresAt \|\| ''\)/.test(app));
check('33. ...preferring the absolute instant over a duration, so a slow round trip cannot make it optimistic',
  /expiresInSeconds/.test(app) && /beginOtpWindow/.test(app));
check('34. It ticks once a second and cleans up after itself',
  /window\.setInterval\(tick, 1000\)/.test(app) && /window\.clearInterval\(timer\)/.test(app));
check('35. It goes urgent near the end',
  /is-urgent/.test(app) && /\.otp-countdown\.is-urgent/.test(css));
check('36. It is announced politely, not once a second over a screen reader',
  /aria-live="polite"[\s\S]{0,60}aria-atomic="true"/.test(app));
check('37. Hitting zero flips the screen rather than leaving a dead form',
  /onExpire\(\)/.test(app) && /setOtpExpired\(true\)/.test(app));

check('38. An expired screen offers a new code as the primary action',
  /Send me a new code/.test(app));
check('39. ...and hides the verify button, which cannot work any more',
  /\{!otpExpired && \(\s*<WaitingButton/.test(app));
check('40. A resend is also reachable BEFORE expiry — mail that never arrived is the common case',
  /Didn't get it\? Send a new code/.test(app));
check('41. Resending restarts the countdown and clears the stale digits',
  /beginOtpWindow\(data\);\s*setLoginOtp\(''\)/.test(app));
check('42. The backend\'s expiry codes drive the UI, not a message-text match',
  /data\.code === 'OTP_EXPIRED' \|\| data\.code === 'OTP_ALREADY_USED' \|\| data\.code === 'OTP_NOT_FOUND'/.test(app));
check('43. Closing the modal clears the window, so it never reopens mid-countdown',
  /setOtpExpiresAt\(''\);\s*setOtpExpired\(false\);/.test(app));
check('44. Post-signup verification starts the countdown too, not just login',
  (app.match(/beginOtpWindow\(data\)/g) || []).length >= 3);

console.log('\n--- ...and the screen never offers a code it cannot send ---');

check('45. The screen tracks how many codes are left',
  /const \[otpSendsLeft, setOtpSendsLeft\]/.test(app));
check('46. ...from the backend\'s own count, not a client-side tally',
  /typeof data\?\.sendsRemaining === 'number'/.test(app));
check('47. At zero the resend button is replaced, not just disabled',
  /otpSendsLeft === 0 \? \(/.test(app));
check('48. ...and the reader is told when they may ask again',
  /const OtpRetryClock = memo/.test(app));
check('49. That clock keeps ticking rather than going stale on screen',
  /window\.setInterval\(tick, 15000\)/.test(app));
check('50. It rounds UP, so it never promises a shorter wait than the server enforces',
  /Math\.ceil\(left \/ 60\)/.test(app));
check('51. A rate-limited resend records the reopening time',
  /data\.code === 'OTP_RATE_LIMITED'/.test(app) && /setOtpRetryAt\(String\(data\.retryAt\)\)/.test(app));
check('52. The last code warns that it is the last',
  /One more code available before a short pause/.test(app));
check('53. Closing the modal clears the send state too',
  /setOtpSendsLeft\(null\);\s*setOtpRetryAt\(''\);/.test(app));
check('54. The exhausted panel still points at the inbox rather than dead-ending',
  /spam folder/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
