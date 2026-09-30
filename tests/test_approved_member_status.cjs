/**
 * test_approved_member_status.cjs — an approved reader must never see 'Waiting for Admin Approval'.
 * (Harness copied from test_reader_badges.cjs.)
 *
 *
 * Community badges the admin awards by hand after a meetup — "Doctor of the
 * Month" for one reader, "Patient" for everyone who came — shown on reader
 * profiles until they expire or are removed.
 *
 * Runs the real appsscript.js functions against an in-memory sheet, so what
 * is under test is the actual award / list / revoke / expiry logic, and the
 * admin-only gate on all three.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}

// ── a tiny in-memory Sheet ──────────────────────────────────────────────
const sheets = {};
function makeSheet(name, headers) {
  const data = [headers && headers.length ? headers.slice() : []];
  const sheet = {
    __data: data,
    getName: () => name,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getLastColumn: () => data[0].length,
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
      setValues: (vals) => { vals.forEach((v, i) => { data[r - 1 + i] = data[r - 1 + i] || []; v.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; }); }); },
      setValue: (v) => { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = v; },
    }),
    appendRow: (row) => data.push(row.slice()),
    deleteRow: (r) => data.splice(r - 1, 1),
    insertColumnAfter() {},
  };
  sheets[name] = sheet;
  return sheet;
}

const scriptProperties = new Map();
const mails = [];
const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (scriptProperties.has(k) ? scriptProperties.get(k) : null),
      setProperty: (k, v) => { scriptProperties.set(k, v); },
      deleteProperty: (k) => { scriptProperties.delete(k); },
    }),
  },
  UrlFetchApp: { fetch() { throw new Error('no network'); } },
  Utilities: { getUuid: () => crypto.randomUUID() },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  MailApp: { sendEmail(o) { mails.push(o); } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {},
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8'), ctx, { filename: 'appsscript.js' });

// Swap in the in-memory sheet and a controllable session.
ctx.__sheets = sheets;
ctx.__makeSheet = makeSheet;
vm.runInContext(`
  getOrCreateSheet = function (name, headers) { return __sheets[name] || __makeSheet(name, headers); };
  ensureSheetHeaders = function (sheet, headers) {
    const have = sheet.__data[0];
    headers.forEach(function (h) { if (have.indexOf(h) === -1) have.push(h); });
    return have.slice();
  };
  emailExistsInUsersSheet = function (e) { return ['doc@x.com','p1@x.com','p2@x.com','p3@x.com'].indexOf(e) !== -1; };
  logActivity = function () {};
  var __ROLE = 'admin';
  isAuthenticatedAdmin = function () { return __ROLE === 'admin'; };
  getAuthenticatedEmail = function () { return __ROLE === 'admin' ? 'swapsutra@gmail.com' : 'p1@x.com'; };
`, ctx);


const call = (fn, ...args) => { ctx.__args = args; return vm.runInContext(`${fn}.apply(null, __args)`, ctx); };
const rows = (name) => { const d = sheets[name].__data; const h = d[0]; return d.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const seed = (name, headers, list) => { const sh = makeSheet(name, headers); list.forEach((o) => sh.__data.push(headers.map((h) => (o[h] === undefined ? '' : o[h])))); };

const respond = (fnSrc) => vm.runInContext(fnSrc, ctx);
// Drive the real doGet checkSubscription branch.
vm.runInContext(`respondJson = function (o) { return o; };`, ctx);
const check_ = (email) => vm.runInContext(`doGet({ parameter: { action: 'checkSubscription', email: ${JSON.stringify(email)} } })`, ctx);

const H = ['id','name','email','adminStatus','membershipType','activationType','paymentRequired','trialStartDate','trialEndDate','subscriptionStartDate','subscriptionExpiry','approvedAt','booksListedCount'];
seed('Subscriptions', H, [
  { id:'A', email:'free@x.com', adminStatus:'Approved', activationType:'free', paymentRequired:'No', booksListedCount:0 },
  { id:'B', email:'paid@x.com', adminStatus:'Approved', membershipType:'premium', paymentRequired:'Yes', approvedAt:new Date(Date.now()-86400000), booksListedCount:0 },
  { id:'C', email:'wait@x.com', adminStatus:'Pending', activationType:'free', paymentRequired:'No', booksListedCount:0 },
  { id:'D', email:'paywait@x.com', adminStatus:'Pending', membershipType:'premium', paymentRequired:'Yes', booksListedCount:0 },
  { id:'E', email:'trial@x.com', adminStatus:'Approved', activationType:'free_trial', trialStartDate:new Date(Date.now()-5*86400000), trialEndDate:new Date(Date.now()+25*86400000), booksListedCount:0 },
]);
seed('Users', ['id','email','name'], []);
seed('Books', ['id','ownerEmail','status'], []);

let r = check_('free@x.com');
check('1. An approved free reader with no trial dates is NOT "pending"', r.userTier === 'trial', JSON.stringify(r.userTier));
const a = rows('Subscriptions').find(x => x.email === 'free@x.com');
check('2. ...and the 30-day trial window is written back for good', a.trialStartDate && a.trialEndDate && Math.round((new Date(a.trialEndDate) - new Date(a.trialStartDate))/86400000) === 30);
check('3. ...with about 30 days remaining', r.daysRemaining >= 29 && r.daysRemaining <= 31, String(r.daysRemaining));

r = check_('paid@x.com');
check('4. An approved paid member with no dates is premium', r.userTier === 'premium', JSON.stringify(r.userTier));
const b = rows('Subscriptions').find(x => x.email === 'paid@x.com');
check('5. ...with a 1-year window from approval', b.subscriptionExpiry && new Date(b.subscriptionExpiry).getTime() > Date.now()+360*86400000);

check('6. A reader the admin has NOT approved stays pending', check_('wait@x.com').userTier === 'pending');
check('7. A paid application not yet approved stays payment-pending', check_('paywait@x.com').userTier === 'pending');
const c = rows('Subscriptions').find(x => x.email === 'wait@x.com');
check('8. ...and nothing is written to unapproved rows', !c.trialStartDate && !c.subscriptionStartDate);

const beforeE = JSON.stringify(rows('Subscriptions').find(x => x.email === 'trial@x.com'));
r = check_('trial@x.com');
check('9. An existing trial keeps its own dates', r.userTier === 'trial' && JSON.stringify(rows('Subscriptions').find(x => x.email === 'trial@x.com')) === beforeE);

// manageMembershipApproval on a trial row without dates starts the trial
const src2 = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
check('10. Approving a trial row in the admin panel starts its 30-day window', /updates\['trialStartDate'\] = startDate;/.test(src2) && /updates\['trialEndDate'\] = new Date\(startDate\.getTime\(\) \+ 30/.test(src2));
check('11. The membership check no longer reads the Users sheet when a subscription exists', /const userData = sub \? \[\] :/.test(src2));
check('12. The book count is only written when it changed', /Number\(knownCount\) === count\) return count;/.test(src2));

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
check('13. The membership check times out and retries instead of hanging', /setTimeout\(\(\) => ctrl\.abort\(\), 15000\)/.test(app) && /catch \{ data = await attempt\(\); \}/.test(app));
check('14. A failed check shows "couldn\'t confirm" with a retry, not "awaiting approval"', /We couldn't confirm your membership/.test(app) && /checkFailed=\{membershipCheckFailed\}/.test(app));
check('15. Returning readers skip the verifying screen for 24h (background re-check still runs)', /const VERIFICATION_TTL_MS = 24 \* 60 \* 60 \* 1000;/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
