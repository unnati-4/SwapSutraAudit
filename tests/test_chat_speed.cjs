/**
 * test_chat_speed.cjs — chat polls are served from cache; writes clear it.
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
const __cache = new Map();
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
  CacheService: { getScriptCache: () => ({
    get: (k) => (__cache.has(k) ? __cache.get(k) : null),
    put: (k, v) => { __cache.set(k, v); },
    remove: (k) => { __cache.delete(k); },
  }) },
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

vm.runInContext(`respondJson = function (o) { return o; };
  getChatById = function (id) { __chatLookups++; return { chatId: id, chatStatus: 'Active' }; }; var __chatLookups = 0;
  canAccessChat = function () { return true; };
  requireApprovedMember = function () { __memberChecks++; return null; }; var __memberChecks = 0;
  isAdminEmail = function () { return false; };`, ctx);
seed('Messages', ['messageId','chatId','senderEmail','senderRole','message','createdAt'], [
  { messageId: 'm1', chatId: 'C1', senderEmail: 'a@x.com', senderRole: 'User', message: 'hi', createdAt: new Date() },
  { messageId: 'm2', chatId: 'C2', senderEmail: 'b@x.com', senderRole: 'User', message: 'other chat', createdAt: new Date() },
]);
let reads = 0;
const origGet = sheets.Messages.getDataRange;
sheets.Messages.getDataRange = () => { reads++; return origGet(); };
const poll = () => vm.runInContext(`doGet({ parameter: { action: 'getChatMessages', chatId: 'C1', email: 'a@x.com' } })`, ctx);

let r = poll();
check('1. First poll returns only this chat\'s messages', Array.isArray(r) && r.length === 1 && r[0].messageId === 'm1');
const readsAfterFirst = reads;
const lookups1 = vm.runInContext('__chatLookups', ctx), checks1 = vm.runInContext('__memberChecks', ctx);
r = poll(); r = poll();
check('2. Later polls do not read the Messages sheet again', reads === readsAfterFirst && r.length === 1);
check('3. ...nor re-check the chat and membership every time', vm.runInContext('__chatLookups', ctx) === lookups1 && vm.runInContext('__memberChecks', ctx) === checks1);

// a new message arrives through the real write path's cache clear
sheets.Messages.__data.push(['m3', 'C1', 'b@x.com', 'User', 'new one', new Date()]);
vm.runInContext(`chatThreadCacheClear_('C1')`, ctx);
r = poll();
check('4. After a send clears the cache, the new message is delivered on the next poll', r.length === 2 && r[1].messageId === 'm3');

const gs = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
check('5. sendChatMessage clears the thread cache right after saving', /msgSheet\.appendRow\(row\);\n  chatThreadCacheClear_\(chatId\);/.test(gs));
check('6. Deleting a message clears it too', /setValue\(""\);\n    chatThreadCacheClear_\(chatId\);/.test(gs));

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
check('7. A sent message shows immediately ("Sending…"), before the server answers', /pending: true,/.test(app) && /m\.pending \? 'Sending…'/.test(app));
check('8. After sending, the thread refreshes at once instead of waiting for the next poll', /chatRefreshNowRef\.current\?\.\(\);/.test(app));
check('9. Open chats poll every 3s while active', /const FAST_MS = 3000;/.test(app));
check('10. A failed send is removed and the reader is told', /dropPending\(\);\n      setErrorMessage\('Your message could not be sent/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
