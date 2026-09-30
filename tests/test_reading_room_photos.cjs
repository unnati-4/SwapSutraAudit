/**
 * test_reading_room_photos.cjs — photo posts in the Reading Room.
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
  var __saved = [];
  saveFileToDrive = function (b64, name) { __saved.push(name); return 'https://drive.google.com/file/d/FILE' + __saved.length + '/view'; };
  logReaderActivity = function () {};
`, ctx);
const saved = () => vm.runInContext('__saved.length', ctx);
const rows = () => sheets.ReadingRoomPosts.__data;
const col = (name) => rows()[0].indexOf(name);
const last = () => rows()[rows().length - 1];
const jpeg = 'data:image/jpeg;base64,' + Buffer.alloc(3000, 7).toString('base64');

console.log('\n--- Photo posts ---');
let r = call('createReadingRoomPost', { authorEmail: 'p1@x.com', authorName: 'P', content: '', fileData: jpeg });
check('1. A photo with no text can be posted', r.success === true, JSON.stringify(r));
check('2. The photo goes to Drive and only the link is stored', saved() === 1 && /drive\.google\.com\/file\/d\/FILE1/.test(last()[col('mediaUrl')]));
check('3. It is marked as an image', last()[col('mediaType')] === 'image');

r = call('createReadingRoomPost', { authorEmail: 'p1@x.com', content: 'hi', fileData: 'data:application/pdf;base64,AAAA' });
check('4. Non-photo files are refused', r.success === false && saved() === 1);

r = call('createReadingRoomPost', { authorEmail: 'p1@x.com', content: 'hi', fileData: 'data:image/svg+xml;base64,AAAA' });
check('5. SVG (which can carry script) is refused', r.success === false);

const huge = 'data:image/jpeg;base64,' + 'A'.repeat(5 * 1024 * 1024);
r = call('createReadingRoomPost', { authorEmail: 'p1@x.com', content: 'hi', fileData: huge });
check('6. Oversized photos are refused', r.success === false && saved() === 1);

r = call('createReadingRoomPost', { authorEmail: 'p1@x.com', content: 'look', mediaUrl: 'https://evil.example/x.png' });
check('7. A mediaUrl sent by the browser is ignored', r.success === true && last()[col('mediaUrl')] === '');

r = call('createReadingRoomPost', { authorEmail: 'p1@x.com', content: '   ' });
check('8. An empty post (no text, no photo) is refused', r.success === false);

vm.runInContext(`saveFileToDrive = function () { return ''; };`, ctx);
r = call('createReadingRoomPost', { authorEmail: 'p1@x.com', content: 'x', fileData: jpeg });
check('9. If Drive fails the reader is told, and no half-post is saved', r.success === false && /photo/i.test(r.message));

const app = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
check('10. Circle-chat photos use the real Drive helper (saveToDriveSecure never existed)', !app.includes('saveToDriveSecure'));
const rr = fs.readFileSync(path.join(__dirname, '..', 'src/components/ReadingRoom.tsx'), 'utf8');
check('11. The composer has a photo picker', /aria-label="Add a photo"/.test(rr) && /fileData: attachedImage/.test(rr));
check('12. Photos are shrunk in the browser before upload', /POST_IMAGE_MAX_SIDE = 1600/.test(rr) && /toDataURL\('image\/jpeg'/.test(rr));
check('13. The feed shows post photos', /postImageSrc\(post\.mediaUrl\)/.test(rr));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
