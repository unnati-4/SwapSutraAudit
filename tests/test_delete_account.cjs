/**
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
vm.runInContext(`__ROLE = 'member'; getAuthenticatedEmail = function () { return __ME; }; var __ME = 'leaver@x.com'; isAdminEmail = function (e) { return e === 'swapsutra@gmail.com'; };`, ctx);

const ME = 'leaver@x.com', OTHER = 'stay@x.com';
seed('Users', ['id', 'name', 'email', 'phone'], [{ id: 1, name: 'Leaver', email: ME, phone: '999' }, { id: 2, name: 'Stay', email: OTHER }]);
seed('reading_space', ['item_id', 'user_id', 'book_title'], [{ item_id: 'a', user_id: ME, book_title: 'X' }, { item_id: 'b', user_id: OTHER, book_title: 'Y' }]);
seed('Books', ['id', 'ownerEmail', 'title', 'status'], [{ id: 'B1', ownerEmail: ME, title: 'Mine', status: 'Approved' }, { id: 'B2', ownerEmail: OTHER, title: 'Theirs', status: 'Approved' }]);
seed('SwapRequests', ['id', 'requesterEmail', 'ownerEmail', 'requestedBookTitle', 'status', 'updatedAt'], [
  { id: 'S1', requesterEmail: OTHER, ownerEmail: ME, requestedBookTitle: 'Mine', status: 'Handed Over' },
  { id: 'S2', requesterEmail: ME, ownerEmail: OTHER, requestedBookTitle: 'Theirs', status: 'Pending' },
  { id: 'S3', requesterEmail: ME, ownerEmail: OTHER, requestedBookTitle: 'Old', status: 'Completed' },
]);
seed('ReadingRoomPosts', ['id', 'authorEmail', 'content'], [{ id: 'P1', authorEmail: ME, content: 'mine' }, { id: 'P2', authorEmail: OTHER, content: 'theirs' }]);
seed('current_read_messages', ['message_id', 'circle_id', 'user_id', 'user_name', 'message'], [{ message_id: 'M1', circle_id: 'SS_READERS_CAFE', user_id: ME, user_name: 'Leaver', message: 'hello' }]);
seed('Subscriptions', ['id', 'name', 'email', 'phone', 'paymentAmount', 'adminStatus', 'membershipStatus'], [{ id: 'SUB1', name: 'Leaver', email: ME, phone: '999', paymentAmount: 49, adminStatus: 'Approved', membershipStatus: 'ACTIVE' }]);
seed('Notifications', ['id', 'userEmail', 'title'], [{ id: 'N1', userEmail: ME, title: 'hi' }]);
seed('ReaderBadges', ['email', 'label'], [{ email: ME, label: 'Patient' }]);

console.log('\n--- Before deleting ---');
let c = call('getAccountDeletionCheck', {});
check('1. A book out on a swap blocks deletion, and says which', c.success && c.canDelete === false && c.blockers.length === 1 && c.blockers[0].title === 'Mine');
let r = call('deleteMyAccount', { confirm: 'DELETE' });
check('2. Deleting is refused while a book is out', r.success === false && r.error === 'ACTIVE_SWAPS' && rows('Users').length === 2);

// The book comes back.
sheets.SwapRequests.__data[1][4] = 'Completed';
check('3. Without typing DELETE nothing happens', call('deleteMyAccount', { confirm: 'yes' }).success === false && rows('Users').length === 2);
vm.runInContext(`__ME = ''`, ctx);
check('4. Signed out → refused', call('deleteMyAccount', { confirm: 'DELETE' }).success === false);
vm.runInContext(`__ME = 'swapsutra@gmail.com'`, ctx);
check('5. The admin account cannot delete itself here', call('deleteMyAccount', { confirm: 'DELETE' }).success === false);
vm.runInContext(`__ME = 'leaver@x.com'`, ctx);

console.log('\n--- Deleting ---');
r = call('deleteMyAccount', { confirm: 'delete', reason: 'Privacy concerns', email: OTHER });
check('6. Deleting works (confirm is case-insensitive)', r.success === true, JSON.stringify(r));
check('7. Only the signed-in reader is deleted — an email in the request is ignored', rows('Users').length === 1 && rows('Users')[0].email === OTHER);
check('8. Reading space gone (theirs only)', rows('reading_space').length === 1 && rows('reading_space')[0].user_id === OTHER);
check('9. Their listing is taken off the Library, others untouched', rows('Books').find((b) => b.id === 'B1').status === 'Removed' && rows('Books').find((b) => b.id === 'B2').status === 'Approved');
check('10. A pending swap request is cancelled', rows('SwapRequests').find((s) => s.id === 'S2').status === 'Cancelled');
check('11. Past swap records are kept (exchange records)', rows('SwapRequests').find((s) => s.id === 'S3').status === 'Completed');
check('12. Their Reading Room posts are deleted, others kept', rows('ReadingRoomPosts').length === 1 && rows('ReadingRoomPosts')[0].id === 'P2');
const msg = rows('current_read_messages')[0];
check('13. Café messages are kept but shown as "Former reader"', msg.user_name === 'Former reader' && msg.message === 'hello');
const sub = rows('Subscriptions')[0];
check('14. Payment record kept but unlinked from the address, phone removed, membership cancelled',
  sub.paymentAmount === 49 && sub.email === 'deleted:' + ME && sub.phone === '' && sub.membershipStatus === 'CANCELLED');
check('15. Notifications and badges removed', rows('Notifications').length === 0 && rows('ReaderBadges').length === 0);
check('16. The deletion is logged with the reason', rows('AccountDeletions').length === 1 && rows('AccountDeletions')[0].reason === 'Privacy concerns');
check('17. A confirmation email goes to the reader', mails.length === 1 && mails[0].to === ME);

console.log('\n--- Old sessions stop working ---');
const at = Number(scriptProperties.get('ACCOUNT_DELETED_AT:' + ME));
check('18. The deletion time is recorded', at > 0);
vm.runInContext(`
  signSessionPayload = function (p) { return 'sig'; };
  var mk = function (e, iat) { return 'v1.' + Utilities.base64EncodeWebSafe(JSON.stringify({ e: e, r: 'member', iat: iat, exp: iat + 1e9 })) + '.sig'; };
`, ctx);
ctx.Utilities.base64EncodeWebSafe = (s) => Buffer.from(s).toString('base64url');
ctx.Utilities.base64DecodeWebSafe = (s) => Buffer.from(s, 'base64url');
ctx.Utilities.newBlob = (b) => ({ getDataAsString: () => Buffer.from(b).toString() });
const verify = (e, iat) => call('verifySessionToken', vm.runInContext(`mk('${e}', ${iat})`, ctx));
check('19. A token from before the deletion is refused', verify(ME, at - 1000) === null);
check('20. A new sign-up afterwards works normally', verify(ME, at + 1000) !== null);
check('21. Other readers are unaffected', verify(OTHER, at - 1000) !== null);

console.log('\n--- Wiring ---');
const app = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
check('22. Both actions are routed and NOT session-exempt', /action === 'deleteMyAccount'/.test(app) && !/deleteMyAccount: true/.test(app));
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
check('23. A lapsed member can still delete (membership gate skipped, sign-in still needed)', /MEMBERSHIP_EXEMPT_ACTIONS = new Set\(\['getAccountDeletionCheck', 'deleteMyAccount'/.test(srv) && /'getAccountDeletionCheck', 'deleteMyAccount'[^\]]*\];/.test(srv));
const tsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
check('24. Settings shows Delete account (not for the admin)', /\{!isAdmin && <DeleteAccount apiUrl=\{API_URL\} onDeleted=\{handleAccountDeleted\} \/>\}/.test(tsx));
const comp = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DeleteAccount.tsx'), 'utf8');
check('25. The button stays disabled until DELETE is typed', /disabled=\{typed\.trim\(\)\.toUpperCase\(\) !== 'DELETE' \|\| deleting\}/.test(comp));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
