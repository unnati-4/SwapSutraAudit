/**
 * test_newsletter_members.cjs — every member is a newsletter subscriber
 * until they unsubscribe; past letters are public.
 * (Harness copied from test_delete_account.cjs.)
 *
 * Original header:
 * test_delete_account.cjs — a reader deleting their own account.
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
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()),
    base64EncodeWebSafe: (v) => Buffer.from(typeof v === 'string' ? v : Uint8Array.from(v.map((b) => (b + 256) % 256))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
  },
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

vm.runInContext(`__ROLE = 'member'; var __ME = 'old@x.com'; getAuthenticatedEmail = function () { return __ME; };
  sendSwapSutraEmail = function (o) { __sent.push(o); return true; }; var __sent = [];
  generateId = function (p) { return p + Math.random().toString(36).slice(2, 8); };`, ctx);
const sent = () => vm.runInContext('__sent', ctx);
const setMe = (e) => vm.runInContext(`__ME = ${JSON.stringify(e)}`, ctx);

seed('Subscriptions', ['id', 'name', 'email', 'adminStatus'], [
  { id: 1, name: 'Old', email: 'old@x.com', adminStatus: 'Approved' },
  { id: 2, name: 'Trial', email: 'trial@x.com', adminStatus: 'Pending' },
  { id: 3, name: 'Gone', email: 'deleted:gone@x.com', adminStatus: 'Approved' },
  { id: 4, name: 'No', email: 'rejected@x.com', adminStatus: 'Rejected' },
]);
seed('NewsletterSubscribers', ['id', 'name', 'email', 'timestamp', 'LastEmailSentAt', 'LastEmailSubject', 'LastEmailStatus', 'MonthlyEmailCount'], [
  { id: 'x', email: 'legacy@x.com' },
]);
seed('MonthlyNewsletters', ['newsletterId', 'editionLabel', 'status', 'subject', 'headerTitle', 'preheader', 'bodyContent', 'sentAt', 'createdAt', 'totalRecipients', 'successCount', 'failureCount', 'errorLog'], [
  { newsletterId: 'N1', editionLabel: 'August', status: 'Sent', subject: 'Aug letter', headerTitle: 'Monsoon reads', bodyContent: 'Hello', sentAt: new Date('2026-08-05') },
  { newsletterId: 'N2', editionLabel: 'Sept', status: 'Draft', subject: 'Draft letter', headerTitle: 'Not yet', bodyContent: 'Secret' },
  { newsletterId: 'N3', editionLabel: 'July', status: 'Sent', subject: 'Jul letter', headerTitle: 'Rainy', bodyContent: 'Hi', sentAt: new Date('2026-07-05') },
]);

console.log('\n--- Who gets the letter ---');
let r = call('getNewsletterRecipientResult', {});
const has = (e) => r.recipients.includes(e);
check('1. Existing members with no subscriber row still get it', has('old@x.com') && has('trial@x.com'));
check('2. Old sign-up-box subscribers still get it', has('legacy@x.com'));
check('3. Deleted accounts and rejected applications do not', !r.recipients.some((e) => /gone|rejected/.test(e)));

console.log('\n--- Joining subscribes you ---');
call('ensureNewsletterSubscriber_', 'New@X.com', 'New', 'signup');
const nrow = rows('NewsletterSubscribers').find((x) => x.email === 'new@x.com');
check('4. A new member gets a Subscribed row', nrow && nrow.status === 'Subscribed' && nrow.source === 'signup');
call('ensureNewsletterSubscriber_', 'new@x.com', 'New', 'signup');
check('5. Joining twice does not duplicate', rows('NewsletterSubscribers').filter((x) => x.email === 'new@x.com').length === 1);

console.log('\n--- Unsubscribe from the email link ---');
const tok = call('newsletterUnsubscribeToken', 'old@x.com');
check('6. Bad or tampered tokens are refused', call('unsubscribeNewsletter', { token: 'abc.def' }).success === false
  && call('unsubscribeNewsletter', { token: tok.split('.')[0] + '.AAAAAAAAAAAAAAAAAAAAAA' }).success === false
  && call('unsubscribeNewsletter', { token: call('newsletterUnsubscribeToken', 'trial@x.com').split('.')[0] + '.' + tok.split('.')[1] }).success === false);
check('7. The real token unsubscribes that reader', call('unsubscribeNewsletter', { token: tok }).success === true);
r = call('getNewsletterRecipientResult', {});
check('8. ...and they stop receiving it', !r.recipients.includes('old@x.com') && r.recipients.includes('trial@x.com'));
call('ensureNewsletterSubscriber_', 'old@x.com', 'Old', 'signup');
check('9. Signing up again later does not silently resubscribe them', !call('getNewsletterRecipientResult', {}).recipients.includes('old@x.com'));

console.log('\n--- Settings toggle (session only) ---');
setMe('old@x.com');
check('10. Settings shows them as unsubscribed', call('getMyNewsletterSubscription', {}).subscribed === false);
check('11. They can subscribe again', call('setMyNewsletterSubscription', { subscribed: true }).subscribed === true
  && call('getNewsletterRecipientResult', {}).recipients.includes('old@x.com'));
setMe('trial@x.com');
check('12. A member with no row reads as subscribed', call('getMyNewsletterSubscription', {}).subscribed === true);
setMe('');
check('13. Signed out: no toggle', call('setMyNewsletterSubscription', { subscribed: false }).success === false);

console.log('\n--- Sending ---');
const res = call('sendNewsletterToRecipients', 'N1');
const toOld = sent().find((m) => m.to === 'old@x.com');
check('14. Each email carries that reader\'s own unsubscribe link', res.success && toOld && toOld.htmlBody.includes('/newsletter?unsubscribe=' + encodeURIComponent(call('newsletterUnsubscribeToken', 'old@x.com')))
  && !toOld.htmlBody.includes('{{SS_UNSUBSCRIBE_URL}}'));
const toTrial = sent().find((m) => m.to === 'trial@x.com');
check('15. ...not someone else\'s', toTrial && !toTrial.htmlBody.includes(encodeURIComponent(call('newsletterUnsubscribeToken', 'old@x.com'))));

console.log('\n--- Public archive ---');
const a = call('getNewsletterArchive', {});
check('16. Only sent letters are listed, newest first', a.success && a.editions.map((e) => e.newsletterId).join(',') === 'N1,N3');
check('17. Drafts cannot be opened', call('getNewsletterEdition', { newsletterId: 'N2' }).success === false);
const ed = call('getNewsletterEdition', { newsletterId: 'N3' });
check('18. A sent letter opens, without anyone\'s unsubscribe link', ed.success && ed.html.includes('Rainy') && !ed.html.includes('SS_UNSUB') && !ed.html.includes('unsubscribe='));

console.log('\n--- Wiring ---');
const gs = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
const px = fs.readFileSync(path.join(__dirname, '..', 'api', 'swapsutra.ts'), 'utf8');
check('19. Archive + unsubscribe are public, the toggle is not', /getNewsletterArchive: true, getNewsletterEdition: true, unsubscribeNewsletter: true/.test(gs)
  && !/getMyNewsletterSubscription: true/.test(gs) && /'getNewsletterArchive', 'getNewsletterEdition', 'unsubscribeNewsletter'/.test(px));
check('20. Signing up calls ensureNewsletterSubscriber_', /ensureNewsletterSubscriber_\(result\.email \|\| data\.email/.test(gs));
check('21. No sign-up box left on the site', !/handleNewsletterSubscribe|id="newsletter"|Count Me In/.test(app));
// 30 Sep (owner's request): Newsletter left the menu; the page is still at
// /newsletter and linked from Profile → Settings.
check('22. /newsletter still works and Settings links to it', /'\/newsletter': 'newsletter'/.test(app) && /onClick=\{\(\) => navigateTo\('newsletter'\)\}/.test(app));
check('23. The admin preview no longer calls a function that does not exist', !/generateNewsletterHtml\(/.test(gs));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
