/**
 * test_notifications_badges_cafe.cjs — readers hear about a new badge and
 * about being @mentioned in the Reader's Café (bell + optional phone push).
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
const fetched = [];
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
  UrlFetchApp: { fetch(url, opts) { fetched.push({ url, opts }); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
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
const notes = () => (sheets.Notifications ? sheets.Notifications.__data : [[]]);
const noteRows = () => { const d = notes(); const h = d[0]; return d.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const forUser = (e) => noteRows().filter((n) => n.userEmail === e);

console.log('\n--- Badge notifications ---');
const r = call('awardReaderBadge', { email: 'doc@x.com', label: 'Doctor of the Month', note: 'September meetup' });
check('1. Awarding still works', r.success === true);
const n = forUser('doc@x.com');
check('2. The reader gets a notification', n.length === 1);
check('3. It names the badge', /Doctor of the Month/.test(n[0] && n[0].title));
check('4. It carries the note and says where to see it', /September meetup/.test(n[0].message) && /profile/i.test(n[0].message));
check('5. Tapping it opens the profile', n[0].link === '/profile' && n[0].type === 'badge_awarded');
check('6. Nobody else is notified', noteRows().length === 1);
check('7. No push relay call when the relay is not configured', fetched.length === 0);

console.log('\n--- Push relay ---');
scriptProperties.set('PUSH_RELAY_URL', 'https://swapsutra.example/api/notifications/relay');
scriptProperties.set('PUSH_RELAY_SECRET', 'a-very-long-relay-secret-123');
// 28 Sep: pop-ups go only to readers who have a device registered.
call('savePushSubscription', { userEmail: 'p1@x.com', endpoint: 'https://fcm.googleapis.com/fcm/send/p1phone', keys: { p256dh: 'k', auth: 'a' } });
call('awardReaderBadge', { email: 'p1@x.com', label: 'Patient' });
check('8. With the relay configured, a push is requested', fetched.length === 1 && /\/api\/notifications\/relay$/.test(fetched[0].url));
check('9. The secret travels in a header, not the body', fetched[0].opts.headers['X-Relay-Secret'] === 'a-very-long-relay-secret-123' && !fetched[0].opts.payload.includes('relay-secret'));
const pushed = JSON.parse(fetched[0].opts.payload).items[0];
check('10. The push goes to the right reader with the badge name', pushed.userEmail === 'p1@x.com' && /Patient/.test(pushed.title));
check('10b. The reader\'s phone is attached, so the relay does not have to look it up', Array.isArray(pushed.devices) && pushed.devices[0].endpoint.endsWith('p1phone'));
check('11. getPushSubscriptionsForRelay refuses a wrong secret', call('getPushSubscriptionsForRelay', { relaySecret: 'nope', emails: ['p1@x.com'] }).success === false);
check('12. ...and a missing one', call('getPushSubscriptionsForRelay', { emails: ['p1@x.com'] }).success === false);
check('13. reportPushFailureForRelay refuses without the secret', call('reportPushFailureForRelay', { endpoint: 'x' }).success === false);
vm.runInContext(`getPushSubscriptions = function () { return { success: true, subscriptions: [
  { userEmail: 'p1@x.com', endpoint: 'e1', keys: {} }, { userEmail: 'p2@x.com', endpoint: 'e2', keys: {} } ] }; };`, ctx);
const subs = call('getPushSubscriptionsForRelay', { relaySecret: 'a-very-long-relay-secret-123', emails: ['p1@x.com'] });
check('14. With the secret, only the requested readers\' devices come back', subs.success && subs.subscriptions.length === 1 && subs.subscriptions[0].endpoint === 'e1');
fetched.length = 0;
scriptProperties.delete('PUSH_RELAY_URL');

console.log('\n--- Café @mentions ---');
const cafeRows = { messages: [
  { circle_id: 'SS_READERS_CAFE', user_id: 'asha@x.com', user_name: 'Asha Verma', message: 'hello' },
  { circle_id: 'SS_READERS_CAFE', user_id: 'bina@x.com', user_name: 'Bina', message: 'hi all' },
  { circle_id: 'SOME_CIRCLE', user_id: 'chitra@x.com', user_name: 'Chitra', message: 'in a private circle' },
] };
const before = noteRows().length;
let m = call('notifyCafeMentions_', { message_id: 'M1', message: '@Asha have you read Gitanjali?', is_spoiler: 'FALSE' }, 'bina@x.com', 'Bina', cafeRows);
const asha = forUser('asha@x.com');
check('15. "@Asha" notifies Asha', m.mentions === 1 && asha.length === 1);
check('16. It says who mentioned her and shows the message', /Bina mentioned you/.test(asha[0].title) && /Gitanjali/.test(asha[0].message));
check('17. Tapping it opens the café', asha[0].link === '/readers-cafe' && asha[0].type === 'cafe_mention');
check('18. A plain message notifies nobody', call('notifyCafeMentions_', { message_id: 'M2', message: 'lovely evening' }, 'bina@x.com', 'Bina', cafeRows).mentions === 0);
check('19. Mentioning yourself does nothing', call('notifyCafeMentions_', { message_id: 'M3', message: '@Bina here' }, 'bina@x.com', 'Bina', cafeRows).mentions === 0);
check('20. Only people who have spoken in the café can be reached (not private-circle members)', call('notifyCafeMentions_', { message_id: 'M4', message: '@Chitra hi' }, 'bina@x.com', 'Bina', cafeRows).mentions === 0);
call('notifyCafeMentions_', { message_id: 'M5', message: '@asha spoiler: he dies', is_spoiler: 'TRUE' }, 'bina@x.com', 'Bina', cafeRows);
const spoil = forUser('asha@x.com').find((x) => x.relatedId === 'M5');
check('21. Mentions are case-insensitive, and a spoiler is not printed in the notification', spoil && !/dies/.test(spoil.message));
check('22. The same message never notifies twice', (call('notifyCafeMentions_', { message_id: 'M1', message: '@Asha have you read Gitanjali?' }, 'bina@x.com', 'Bina', cafeRows), forUser('asha@x.com').filter((x) => x.relatedId === 'M1').length === 1));
const many = { messages: Array.from({ length: 30 }, (_, i) => ({ circle_id: 'SS_READERS_CAFE', user_id: `r${i}@x.com`, user_name: 'Ravi', message: 'x' })) };
call('notifyCafeMentions_', { message_id: 'M6', message: '@Ravi' }, 'bina@x.com', 'Bina', many);
check('23. One message reaches at most 10 readers', noteRows().filter((x) => x.relatedId === 'M6').length === 10);
vm.runInContext(`createNotificationsBatch = function () { throw new Error('sheet down'); };`, ctx);
let threw = false; try { call('notifyCafeMentions_', { message_id: 'M7', message: '@Asha' }, 'bina@x.com', 'Bina', cafeRows); } catch (e) { threw = true; }
check('24. A notification failure never breaks sending the message', !threw);

console.log('\n--- Wiring ---');
const app = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
check('25. Café messages run the mention check', /isCafe\s*\?\s*notifyCafeMentions_\(row, userId, userName, rows\)/.test(app));
check('26. Relay actions are routed and session-exempt (they check the secret themselves)', /getPushSubscriptionsForRelay: true/.test(app) && /action === 'getPushSubscriptionsForRelay'/.test(app));
const relay = fs.readFileSync(path.join(__dirname, '..', 'api', 'notifications.ts'), 'utf8');
check('27. The website relay checks the secret with a timing-safe compare', /timingSafeEqual/.test(relay) && /route === 'relay'/.test(relay));
check('28. The relay only sends in-site links', /startsWith\('\/'\)/.test(relay));
const tsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
check('29. The app pops up new notifications', /announceNewNotifications\(nextNotifications\)/.test(tsx));
check('30. Café shows an unread count in the bottom bar', /item\.key === 'chat' && cafeUnread > 0/.test(tsx));
check('31. Badge and mention notifications open the right page', /type === 'cafe_mention'\) return \{ tab: 'cafe' \}/.test(tsx) && /type === 'badge_awarded'/.test(tsx));
const eng = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'notificationEngine.ts'), 'utf8');
check("32. The sender's own phone no longer shows notifications meant for someone else", !/displayLocalNotification/.test(eng));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
