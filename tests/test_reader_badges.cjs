/**
 * test_reader_badges.cjs
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
  MailApp: { sendEmail() {} },
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
const as = (role) => vm.runInContext(`__ROLE = '${role}'; __SS_BADGE_ROWS__ = null;`, ctx);
const labels = (email) => call('awardedBadgesFor', email).map((b) => b.label);

console.log('\n--- Awarding ---');
as('admin');
const r1 = call('awardReaderBadge', { email: 'doc@x.com', label: 'Doctor of the Month', note: 'Sept meetup' });
check('1. The admin can award a badge', r1.success === true, JSON.stringify(r1));
check('2. It shows on that reader', labels('doc@x.com').includes('Doctor of the Month'));
check('3. It does not leak onto anyone else', labels('p1@x.com').length === 0);

for (const e of ['p1@x.com', 'p2@x.com', 'p3@x.com']) call('awardReaderBadge', { email: e, label: 'Patient' });
check('4. The same badge can go to everyone who came',
  ['p1@x.com', 'p2@x.com', 'p3@x.com'].every((e) => labels(e).includes('Patient')));

check('5. A reader can hold several at once', (() => {
  call('awardReaderBadge', { email: 'doc@x.com', label: 'Patient' });
  return labels('doc@x.com').length === 2;
})());

const dup = call('awardReaderBadge', { email: 'p1@x.com', label: 'patient' });
check('6. Awarding the same badge twice is refused (case-insensitive)', dup.success === false);

const ghost = call('awardReaderBadge', { email: 'nobody@x.com', label: 'Patient' });
check('7. A badge cannot go to an email that is not a reader', ghost.success === false);

check('8. A badge needs a name', call('awardReaderBadge', { email: 'p1@x.com', label: '  ' }).success === false);

check('9. The award is recorded against the admin who gave it',
  sheets.ReaderBadges.__data.slice(1).some((r) => r.includes('swapsutra@gmail.com')));

console.log('\n--- Expiry ---');
call('awardReaderBadge', { email: 'p2@x.com', label: 'Old Award', expiresAt: '2020-01-01T00:00:00Z' });
as('admin');
check('10. An expired badge no longer shows on the profile', !labels('p2@x.com').includes('Old Award'));
call('awardReaderBadge', { email: 'p2@x.com', label: 'Future Award', expiresAt: '2099-01-01T00:00:00Z' });
as('admin');
check('11. A badge with a future expiry still shows', labels('p2@x.com').includes('Future Award'));
check('12. A badge with no expiry stays until removed', labels('doc@x.com').includes('Doctor of the Month'));
const listed = call('listReaderBadges', {});
check('13. The admin list still includes expired ones, marked as such',
  listed.badges.some((b) => b.label === 'Old Award' && b.expired === true));

console.log('\n--- Removing ("next meetup") ---');
const rv = call('revokeReaderBadge', { email: 'doc@x.com', label: 'Doctor of the Month' });
as('admin');
check('14. The admin can take a badge back', rv.success === true && !labels('doc@x.com').includes('Doctor of the Month'));
check('15. ...without touching that reader\'s other badges', labels('doc@x.com').includes('Patient'));
check('16. ...or anyone else\'s', labels('p1@x.com').includes('Patient'));
check('17. Removing a badge nobody holds says so', call('revokeReaderBadge', { email: 'p1@x.com', label: 'Nope' }).success === false);

console.log('\n--- Only the admin ---');
as('member');
check('18. A member cannot award badges', call('awardReaderBadge', { email: 'p1@x.com', label: 'Self-Made Star' }).success === false);
check('19. A member cannot remove badges', call('revokeReaderBadge', { email: 'p1@x.com', label: 'Patient' }).success === false);
check('20. A member cannot list everyone\'s badges', call('listReaderBadges', {}).success === false);
check('21. ...but badges still show on profiles for everyone', labels('p1@x.com').includes('Patient'));

console.log('\n--- Robustness ---');
vm.runInContext(`readerBadgeRowsUncached_ = function () { throw new Error('sheet unavailable'); }; __SS_BADGE_ROWS__ = null;`, ctx);
let threw = false; let out;
try { out = call('awardedBadgesFor', 'p1@x.com'); } catch (e) { threw = true; }
check('22. A broken badge sheet never takes a profile down with it', !threw && Array.isArray(out) && out.length === 0);

console.log('\n--- Wiring ---');
const app = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
check('23. The three admin actions are routed',
  ['listReaderBadges', 'awardReaderBadge', 'revokeReaderBadge'].every((a) => app.includes(`action === '${a}'`)));
check('24. The public reader card carries awarded badges', /awardedBadges: awardedBadgesFor\(email\)/.test(app));
check('25. The /reader page carries them too', /scrubbed\.awardedBadges = awardedBadgesFor\(email\)/.test(app));
check('26. The reader sees their own on My Profile', /awardedBadges: awardedBadgesFor\(email\),?[\s\S]{0,400}?\} : null/.test(app));
const tsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
check('27. The admin console has a Badges screen', /id: 'readerBadges', label: 'Badges'/.test(tsx) && /<AdminReaderBadges \/>/.test(tsx));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
