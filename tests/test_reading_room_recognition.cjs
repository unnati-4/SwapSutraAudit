/**
 * test_reading_room_recognition.cjs — recognition posts in the Reading Room:
 * reader shout-outs, and the admin's badge announcements.
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
vm.runInContext(`
  var __IDS = { 'Rdoc': 'doc@x.com', 'Rp1': 'p1@x.com', 'Rp2': 'p2@x.com' };
  emailForReaderPublicId = function (id) { return __IDS[id] || ''; };
  readerPublicId = function (e) { for (var k in __IDS) if (__IDS[k] === e) return k; return ''; };
  getReaderNameDirectory = function () { return { 'doc@x.com': 'Asha Verma', 'p1@x.com': 'Bina', 'p2@x.com': 'Chitra' }; };
  logReaderActivity = function () {};
`, ctx);
const posts = () => { const d = sheets.ReadingRoomPosts.__data; const h = d[0]; return d.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const notes = () => { const d = (sheets.Notifications || { __data: [[]] }).__data; const h = d[0]; return d.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };

console.log('\n--- Reader shout-outs ---');
let r = call('createReadingRoomPost', { authorEmail: 'p1@x.com', authorName: 'Bina', postType: 'recognition', recognizedReaderId: 'Rdoc', content: 'Lent me Gitanjali for two months!' });
check('1. A reader can post a shout-out for another reader', r.success === true, JSON.stringify(r));
const sp = posts().slice(-1)[0];
check('2. It is stored as a recognition post naming the reader', sp.postType === 'recognition' && sp.recognizedNames === 'Asha' && sp.recognizedEmails === 'doc@x.com');
check('3. A reader\'s shout-out never carries a badge', sp.badgeLabel === '');
const n = notes().filter((x) => x.userEmail === 'doc@x.com');
check('4. The recognised reader is notified', n.length === 1 && /Bina gave you a shout-out/.test(n[0].title) && n[0].link === '/reading-room');
check('5. You cannot shout yourself out', call('createReadingRoomPost', { authorEmail: 'doc@x.com', postType: 'recognition', recognizedReaderId: 'Rdoc', content: 'me!' }).success === false);
check('6. An unknown reader id is refused', call('createReadingRoomPost', { authorEmail: 'p1@x.com', postType: 'recognition', recognizedReaderId: 'Rnobody', content: 'x' }).success === false);
check('7. A shout-out needs a reason', call('createReadingRoomPost', { authorEmail: 'p1@x.com', postType: 'recognition', recognizedReaderId: 'Rdoc', content: '  ' }).success === false);
check('8. An unknown post type falls back to a thought', (call('createReadingRoomPost', { authorEmail: 'p1@x.com', postType: '<script>', content: 'hi' }), posts().slice(-1)[0].postType === 'thought'));

console.log('\n--- Badge announcements ---');
vm.runInContext(`__ROLE = 'member'`, ctx);
check('9. Only the admin can announce a badge', call('announceBadgeRecognition', { label: 'Doctor of the Month', emails: ['doc@x.com'] }).success === false);
vm.runInContext(`__ROLE = 'admin'`, ctx);
r = call('announceBadgeRecognition', { label: 'Doctor of the Month', emails: ['doc@x.com'], note: '' });
const one = posts().slice(-1)[0];
check('10. The admin announcement becomes one recognition post with the badge', r.success && one.postType === 'recognition' && one.badgeLabel === 'Doctor of the Month' && one.authorName === 'SwapSutra');
check('11. It congratulates the reader by first name when no note is given', /Congratulations Asha/.test(one.content));
const before = posts().length;
r = call('announceBadgeRecognition', { label: 'Patient', emails: ['p1@x.com', 'p2@x.com', 'P1@x.com', 'nobody@x.com'], note: 'Thank you for coming to the September meetup!' });
const group = posts().slice(-1)[0];
check('12. A whole meetup gets ONE post, not one each', posts().length === before + 1);
check('13. It names everyone once, drops non-readers and duplicates', group.recognizedNames === 'Bina|Chitra' && group.recognizedEmails === 'p1@x.com,p2@x.com');
check('14. The admin\'s note is the message', group.content === 'Thank you for coming to the September meetup!');
check('15. No readers → no post', call('announceBadgeRecognition', { label: 'Patient', emails: ['nobody@x.com'] }).success === false);

console.log('\n--- Wiring ---');
const app = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
check('16. The feed sends names and public profile ids, never the addresses', /recognizedReaderIds: String\(p\.recognizedEmails/.test(app) && !/recognizedEmails: p\.recognizedEmails/.test(app));
check('17. announceBadgeRecognition is routed', /action === 'announceBadgeRecognition'/.test(app));
const rr = fs.readFileSync(path.join(__dirname, '..', 'src/components/ReadingRoom.tsx'), 'utf8');
check('18. The composer has a Shout-out type with a reader picker', /'🎉 Shout-out'/.test(rr) && /aria-label="Reader to recognise"/.test(rr) && /recognizedReaderId: postType === 'recognition'/.test(rr));
check('19. Recognition posts show the names, linking to their profiles', /onOpenReader\(rid\)/.test(rr));
check('20. There is a Shout-outs filter', /setPostFilter\('recognition'\)/.test(rr));
const adm = fs.readFileSync(path.join(__dirname, '..', 'src/components/AdminReaderBadges.tsx'), 'utf8');
check('21. The Badges screen can announce in the Reading Room (on by default)', /useState\(true\)/.test(adm) && /announceBadgeRecognition/.test(adm));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
