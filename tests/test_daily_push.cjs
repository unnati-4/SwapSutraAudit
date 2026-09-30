/**
 * test_daily_push.cjs  (27 Sep 2026)
 *
 * "Koi bhi user apna browser open karta hai ya PWA app downloaded hai uske
 * phone me toh din ke 3-4 notifications jaane chahiye … jaise Swiggy ya
 * GIVA ke … jo usko majboor kar dein books list karne ke liye."
 *
 * Runs the real appsscript.js engine against in-memory sheets, the real
 * relay (api/notifications.ts) against a fake web-push, and checks the
 * browser-side rules. Also checks that none of this touches email or the
 * in-app bell.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const esbuild = require('esbuild');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── in-memory sheets ────────────────────────────────────────────────────
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
      getValues: () => data.slice(r - 1, r - 1 + (nr || 1)).map((row) => row.slice(c - 1, c - 1 + (nc || 1))),
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
const rowsOf = (name) => { const d = sheets[name].__data; return d.slice(1).map((r) => Object.fromEntries(d[0].map((h, i) => [h, r[i]]))); };

const props = new Map();
const fetched = [];
let mailSent = 0;
let relayAnswer = () => ({ success: true, sent: 1, failed: 0 });
const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  Logger: { log() {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => { props.set(k, String(v)); },
    deleteProperty: (k) => { props.delete(k); },
    getKeys: () => Array.from(props.keys()),
  }) },
  UrlFetchApp: {
    fetch(url, opts) { fetched.push({ url, opts }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(relayAnswer(opts)) }; },
    fetchAll(reqs) { return reqs.map((r) => sandbox.UrlFetchApp.fetch(r.url, r)); },
  },
  Utilities: { getUuid: () => crypto.randomUUID() },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  MailApp: { sendEmail() { mailSent++; } },
  GmailApp: { sendEmail() { mailSent++; } },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {},
  ScriptApp: (() => {
    const triggers = [];
    const builder = (fn) => { const t = { fn, getHandlerFunction: () => fn }; const b = {
      timeBased: () => b, everyHours: (n) => { t.every = n + 'h'; return b; }, everyDays: () => b, atHour: (h) => { t.at = h; return b; },
      onWeekDay: () => b, create: () => { triggers.push(t); return t; } }; return b; };
    return { __triggers: triggers, getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1), newTrigger: builder, WeekDay: { SUNDAY: 'SUNDAY' } };
  })(),
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(read('appsscript.js'), ctx, { filename: 'appsscript.js' });
ctx.__sheets = sheets; ctx.__makeSheet = makeSheet;
vm.runInContext(`
  getOrCreateSheet = function (name, headers) { return __sheets[name] || __makeSheet(name, headers); };
  ensureSheetHeaders = function (sheet, headers) {
    const have = sheet.__data[0];
    headers.forEach(function (h) { if (have.indexOf(h) === -1) have.push(h); });
    return have.slice();
  };
  logActivity = function () {};
  var __ME = 'swapsutra@gmail.com';
  isAuthenticatedAdmin = function () { return __ME === 'swapsutra@gmail.com'; };
  getAuthenticatedEmail = function () { return __ME; };
  var __CAFE = [];
  getCurrentReadRows = function () { return { messages: __CAFE }; };
`, ctx);
const call = (fn, ...args) => { ctx.__args = args; return vm.runInContext(`${fn}.apply(null, __args)`, ctx); };
const setCtx = (k, v) => { ctx.__v = v; vm.runInContext(`${k} = __v`, ctx); };

// ── the world on 27 Sep 2026 ────────────────────────────────────────────
const IST = (h, m = 5) => new Date(Date.UTC(2026, 8, 27, h, m) - 330 * 60 * 1000);   // h:mm IST
const ago = (hours) => new Date(IST(9).getTime() - hours * 3600 * 1000);
const bookHeaders = call('getBookHeaders');
const books = makeSheet('Books', bookHeaders);
function addBook(o) {
  books.appendRow(bookHeaders.map((h) => (o[h] !== undefined ? o[h] : '')));
}
addBook({ id: 'B1', ownerEmail: 'asha@x.com', title: 'The God of Small Things', author: 'Arundhati Roy', pincode: '110017', status: 'Approved', listedAt: ago(5), frontCoverImage: 'f', backCoverImage: 'b', internalBookImage: 'i' });
addBook({ id: 'B2', ownerEmail: 'bina@x.com', title: 'Gitanjali', author: 'Tagore', pincode: '560001', status: 'Approved', listedAt: ago(10), frontCoverImage: 'f', backCoverImage: 'b', internalBookImage: 'i' });
addBook({ id: 'B3', ownerEmail: 'bina@x.com', title: 'Train to Pakistan', author: 'Khushwant Singh', pincode: '560001', status: 'Approved', listedAt: ago(200), frontCoverImage: 'f' });  // photos missing
addBook({ id: 'B4', ownerEmail: 'chitra@x.com', title: 'Rejected Book', status: 'Rejected', listedAt: ago(1) });
const users = makeSheet('Users', ['email', 'name', 'pincode']);
users.appendRow(['asha@x.com', 'Asha Verma', '560001']);
users.appendRow(['bina@x.com', 'Bina Rao', '560001']);
users.appendRow(['dev@x.com', 'Dev Kumar', '400001']);
const wanted = makeSheet('BookRequests', ["requestId", "userEmail", "title", "author", "city", "requestType", "note", "status", "createdAt", "updatedAt"]);
wanted.appendRow(['R1', 'dev@x.com', 'The Alchemist', '', '', '', '', 'Open', ago(20), '']);
wanted.appendRow(['R2', 'asha@x.com', 'The Alchemist', '', '', '', '', 'Open', ago(30), '']);
wanted.appendRow(['R3', 'asha@x.com', 'Old ask', '', '', '', '', 'Fulfilled', ago(30), '']);
const events = makeSheet('EventMaster', ["EventID", "Title", "Date", "Status"]);
events.appendRow(['E1', 'Sunday Book Swap Meetup', new Date(Date.UTC(2026, 8, 28, 5)), 'Published']);

const push = makeSheet('PushSubscriptions', ['id', 'userEmail', 'endpoint', 'p256dh', 'auth', 'userAgent', 'subscribedAt', 'lastSeenAt', 'failureCount', 'status']);
const dev = (who, n, extra = {}) => push.appendRow(['P' + n, who, 'https://fcm.googleapis.com/fcm/send/dev' + n, 'k' + n, 'a' + n, '', '', '', 0, extra.status || 'Active']);
dev('asha@x.com', 1); dev('asha@x.com', 2);          // two devices
dev('bina@x.com', 3);
dev('dev@x.com', 4);
dev('gone@x.com', 5, { status: 'Retired' });
dev('testqa.member@x.com', 6);

props.set('PUSH_RELAY_URL', 'https://swapsutra.example/api/notifications/relay');
props.set('PUSH_RELAY_SECRET', 'a-very-long-relay-secret-123');

// ── 1. Visitors can join ────────────────────────────────────────────────
console.log('--- 1. guest devices ---');
let g = call('saveGuestPushSubscription', { endpoint: 'https://evil.example.com/push/1', keys: { p256dh: 'x', auth: 'y' } });
check('1. A made-up push service is refused', g.success === false && g.error === 'INVALID_ENDPOINT');
g = call('saveGuestPushSubscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/guest1', keys: { p256dh: 'gk', auth: 'ga' } });
const guestRow = () => rowsOf('PushSubscriptions').find((r) => r.endpoint === 'https://fcm.googleapis.com/fcm/send/guest1');
check('2. A visitor who is not signed in is saved as a guest device', g.success && g.created && /^guest:/.test(guestRow().userEmail) && guestRow().status === 'Active');
check('3. No per-device on/off column any more (on by default for everyone)', !sheets.PushSubscriptions.__data[0].includes('dailyUpdates'));
const n0 = rowsOf('PushSubscriptions').length;
g = call('saveGuestPushSubscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/guest1', keys: { p256dh: 'gk2', auth: 'ga2' } });
check('4. The same browser again refreshes its row, no duplicate', g.refreshed && rowsOf('PushSubscriptions').length === n0 && guestRow().p256dh === 'gk2');
call('saveGuestPushSubscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/dev3', keys: { p256dh: 'k3', auth: 'a3' } });
check('5. A signed-out visit on a reader\'s phone does not turn it back into a guest', rowsOf('PushSubscriptions').find((r) => r.endpoint.endsWith('dev3')).userEmail === 'bina@x.com');
call('saveGuestPushSubscription', { endpoint: 'https://web.push.apple.com/guest-iphone', keys: { p256dh: 'ik', auth: 'ia' } });
check('6. An installed iPhone app (Apple push) is accepted', rowsOf('PushSubscriptions').some((r) => r.endpoint === 'https://web.push.apple.com/guest-iphone'));
// Signing in on the guest's browser: the ordinary member save takes the row over.
call('saveGuestPushSubscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/guest-to-member', keys: { p256dh: 'q', auth: 'w' } });
call('savePushSubscription', { userEmail: 'dev@x.com', endpoint: 'https://fcm.googleapis.com/fcm/send/guest-to-member', keys: { p256dh: 'q', auth: 'w' } });
check('7. After sign-in the guest device becomes the reader\'s', rowsOf('PushSubscriptions').find((r) => r.endpoint.endsWith('guest-to-member')).userEmail === 'dev@x.com');

// ── 2. Slots ────────────────────────────────────────────────────────────
console.log('--- 2. slots (IST) ---');
const slots = call('dailyPushSlots_');
check('8. Four a day by default: 9, 13, 18, 21 IST', JSON.stringify(slots) === '[9,13,18,21]');
check('9. Each slot has its theme', ['morning', 'afternoon', 'evening', 'night'].every((s, i) => call('dailyPushSlotName_', slots[i], slots) === s));
check('10. Other hours send nothing', call('dailyPushSlotName_', 10, slots) === '' && call('dailyPushSlotName_', 2, slots) === '');
props.set('DAILY_PUSH_SLOTS', '8, 12, 20, 3, 23');
check('11. Admin slots: night-time hours (before 8 / after 22) are ignored', JSON.stringify(call('dailyPushSlots_')) === '[8,12,20]');
check('12. With three slots, 20:00 still gets the "night" copy, never "morning"', call('dailyPushSlotName_', 20, [8, 12, 20]) === 'night');
props.delete('DAILY_PUSH_SLOTS');

// ── 3. A morning run ────────────────────────────────────────────────────
console.log('--- 3. the morning run ---');
const bellBefore = sheets.Notifications ? sheets.Notifications.__data.length : 0;
fetched.length = 0;
let sum = call('runDailyEngagementPush', { now: IST(9).toISOString() });
const relayCalls = () => fetched.filter((f) => /\/relay$/.test(f.url));
const sentItems = () => relayCalls().flatMap((f) => JSON.parse(f.opts.payload).items);
let items = sentItems();
const byWho = (w) => items.find((i) => i.userEmail === w);
check('13. 09:05 IST is the morning slot', sum.slot === 'morning' && !sum.skipped, JSON.stringify(sum));
check('14. Members and visitors both get it', byWho('asha@x.com') && byWho('bina@x.com') && items.some((i) => /^guest:/.test(i.userEmail)));
check('15. A reader with two phones: one item, both devices attached', byWho('asha@x.com').devices.length === 2);
check('16. Retired devices and TEST_QA accounts are left out', !byWho('gone@x.com') && !byWho('testqa.member@x.com'));
check('17. It goes through the existing relay with the secret in the header', relayCalls().length > 0 && relayCalls().every((f) => f.opts.headers['X-Relay-Secret'] === 'a-very-long-relay-secret-123'));
check('18. Asha (pincode 560001) hears about a book near her — not her own', /Gitanjali|Train to Pakistan/.test(byWho('asha@x.com').message) && /560001/.test(byWho('asha@x.com').message) && !/God of Small Things/.test(byWho('asha@x.com').message));
check('19. It opens that book', /^\/book\/B[23]\?ss_push=morning$/.test(byWho('asha@x.com').targetUrl), byWho('asha@x.com').targetUrl);
check('20. Bina\'s own books are never pitched to Bina', !/Gitanjali|Train to Pakistan/.test(byWho('bina@x.com').title + byWho('bina@x.com').message));
check('21. A rejected listing is never advertised', !items.some((i) => /Rejected Book/.test(i.message + i.title)));
check('22. Every push: short title, short text, an in-app link, one tag per slot',
  items.every((i) => i.title.length <= 120 && i.message.length <= 240 && i.targetUrl.startsWith('/') && /ss_push=morning/.test(i.targetUrl) && i.tag === 'ss-daily-morning-2026-09-27'));
check('23. Push only: no bell notification written, no email sent', (sheets.Notifications ? sheets.Notifications.__data.length : 0) === bellBefore && mailSent === 0);
fetched.length = 0;
sum = call('runDailyEngagementPush', { now: IST(9, 40).toISOString() });
check('24. The trigger firing again in the same hour does not send twice', sum.skipped === 'already sent' && relayCalls().length === 0);
sum = call('runDailyEngagementPush', { now: IST(10).toISOString() });
check('25. 10:05 is not a slot: nothing is sent', sum.skipped === 'not a slot hour' && relayCalls().length === 0);
sum = call('runDailyEngagementPush', { triggerUid: '123', authMode: 'FULL' });
check('26. Called by the real trigger (an event object), it uses the clock', typeof sum.hour === 'number');

// ── 4. The other three slots ────────────────────────────────────────────
console.log('--- 4. lunch / evening / night ---');
fetched.length = 0;
call('runDailyEngagementPush', { now: IST(13).toISOString() });
items = sentItems();
check('27. Lunch: Bina, whose listing lacks photos, is asked to finish it', /Train to Pakistan/.test(byWho('bina@x.com').message) && byWho('bina@x.com').targetUrl.startsWith('/profile'));
const guestLunch = items.find((i) => /^guest:/.test(i.userEmail));
check('28. Lunch: a visitor is asked to list a book (listing form / sign-in) or for a book the Wanted shelf needs',
  (/list/i.test(guestLunch.message) && guestLunch.targetUrl.startsWith('/library?list=1')) || (/Alchemist/.test(guestLunch.title) && /List it/.test(guestLunch.message)), JSON.stringify(guestLunch));
const devLunch = byWho('dev@x.com');
check('29. Lunch: Dev (no books) gets a first-listing nudge or the Wanted-shelf ask',
  (devLunch.targetUrl.startsWith('/library?list=1') && /photo/i.test(devLunch.message)) || (devLunch.targetUrl.startsWith('/book-requests') && /Alchemist/.test(devLunch.title)), JSON.stringify(devLunch));
check('30. Nobody is asked for a book they themselves asked for', !/Alchemist/.test(byWho('asha@x.com').title));
fetched.length = 0;
ctx.__CAFE.push(...[1, 2, 3, 4].map((k) => ({ circle_id: 'SS_READERS_CAFE', user_id: 'r' + (k % 2) + '@x.com', created_at: IST(12).toISOString() })));
call('runDailyEngagementPush', { now: IST(18).toISOString() });
items = sentItems();
check('31. Evening: the meetup or the café, from real data', items.every((i) => (/Sunday Book Swap Meetup/.test(i.title) && i.targetUrl.startsWith('/events')) || (/4 conversations in the Café today/.test(i.title) && /2 readers/.test(i.message) && i.targetUrl.startsWith('/readers-cafe'))), JSON.stringify(items.map((i) => i.title)));
check('32. ...and the meetup (tomorrow) says "tomorrow"', items.filter((i) => /Meetup/.test(i.title)).every((i) => / tomorrow\./.test(i.message)));
fetched.length = 0;
call('runDailyEngagementPush', { now: IST(21).toISOString() });
items = sentItems();
check('33. Night: a pick from the live shelf, or the reading tracker (members only)', items.every((i) => (/Tonight's pick/.test(i.title) && i.targetUrl.startsWith('/book/')) || (i.targetUrl.startsWith('/tracker') && !/^guest:/.test(i.userEmail))));
check('34. Four slots → at most four pushes per reader per day', Object.keys(JSON.parse(props.get('DAILY_PUSH_STATS'))['2026-09-27']).length === 4);

// ── 5. Variety ──────────────────────────────────────────────────────────
console.log('--- 5. not the same every day ---');
const c = call('dailyPushContext_', IST(9).toISOString());
const titles = new Set();
for (let d = 0; d < 7; d++) {
  c.day = '2026-10-0' + (d + 1);
  titles.add(call('composeDailyPush_', 'afternoon', 'dev@x.com', c).title);
  titles.add(call('composeDailyPush_', 'evening', 'dev@x.com', c).title);
}
check('35. Over a week the same reader sees different lines', titles.size >= 4, [...titles].join(' | '));
const empty = { day: '2026-09-27', users: {}, fresh: [], live: [], byOwner: {}, partialByOwner: {}, nearbyByPin: {}, wanted: [], cafeToday: 0, cafeSpeakersToday: 0, nextEvent: null };
check('36. A completely empty day still has something to say in every slot',
  ['morning', 'afternoon', 'evening', 'night'].every((s) => { const p = call('composeDailyPush_', s, 'guest:abc', empty); return p.title && p.message && p.targetUrl.startsWith('/'); }));

// ── 6. On for everyone, pausing, counting ───────────────────────────────
console.log('--- 6. control ---');
// A device that was switched off with the old (now removed) switch is on again.
sheets.PushSubscriptions.__data[0].push('dailyUpdates');
sheets.PushSubscriptions.__data.forEach((r, i) => { if (i && r[2].endsWith('dev1')) r[sheets.PushSubscriptions.__data[0].length - 1] = 'off'; });
check('37. Everyone is in the audience by default — an old "off" is ignored', !!call('dailyPushAudience_')['asha@x.com'] && call('dailyPushAudience_')['asha@x.com'].length === 2);
check('38. The in-app on/off actions are gone', typeof ctx.setDailyUpdatesPreference === 'undefined' && typeof ctx.getDailyUpdatesPreference === 'undefined');
check('39. A device the reader blocked in the browser (410) is retired and leaves the audience', (() => {
  call('reportPushFailure', { endpoint: 'https://fcm.googleapis.com/fcm/send/dev4', statusCode: 410 });
  return !call('dailyPushAudience_')['dev@x.com'] || call('dailyPushAudience_')['dev@x.com'].every((d) => !d.endpoint.endsWith('dev4'));
})());
props.set('DAILY_PUSH_PAUSED', 'true');
check('43. Admin pause stops the trigger', call('runDailyEngagementPush', { now: new Date(Date.UTC(2026, 8, 28, 3, 35)).toISOString() }).skipped === 'paused');
props.delete('DAILY_PUSH_PAUSED');
props.delete('PUSH_RELAY_URL');
fetched.length = 0;
sum = call('runDailyEngagementPush', { now: new Date(Date.UTC(2026, 8, 28, 3, 35)).toISOString() });
check('44. Without the relay configured nothing is fetched and nothing breaks', fetched.length === 0 && sum.skipped === 'relay not configured');
props.set('PUSH_RELAY_URL', 'https://swapsutra.example/api/notifications/relay');
check('45. A tap on a daily push is counted', call('recordPushOpen', { slot: 'night' }).counted === true);
check('46. ...only for real slots', call('recordPushOpen', { slot: 'hack' }).success === false);
fetched.length = 0;
const test = call('sendDailyPushTest', { slot: 'afternoon' });
check('47. Admin "send me a test" reaches only the admin\'s devices', test.success && sentItems().every((i) => i.userEmail === 'swapsutra@gmail.com'));
const admin = call('getDailyPushAdmin', {});
check('48. Admin panel data: audience, visitors, stats and a 4-slot preview', admin.success && admin.visitors >= 2 && admin.readers >= 2 && admin.preview.length === 4 && admin.preview.every((p) => p.member.title && p.visitor.title));
const src = read('appsscript.js');
check('49. Admin actions are behind the admin check', /action === 'getDailyPushAdmin' \|\| action === 'setDailyPushSettings' \|\| action === 'sendDailyPushTest'\) \{\s*if \(!isAuthorizedAdminEmail/.test(src));
check('50. Only the two device/tap actions are public — not the admin ones', /saveGuestPushSubscription: true,\s*recordPushOpen: true/.test(src) && !/getDailyPushAdmin: true/.test(src));
const inst = call('installGrowthTriggers');
check('51. installGrowthTriggers adds the hourly trigger and keeps the other four', inst.installed.length === 5 && sandbox.ScriptApp.__triggers.some((t) => t.fn === 'runDailyEngagementPush' && t.every === '1h'));
check('52. The existing email/bell path (notifyReaders_) is not used by the engine', !/notifyReaders_\(|sendSwapSutraEmail\(|createNotificationsBatch\(|MailApp|GmailApp/.test(src.slice(src.indexOf('DAILY BOOK UPDATES'), src.indexOf('COFFEE MUGS — marketplace shelf'))));

// ── 6b. English, festivals, Gemini ──────────────────────────────────────
console.log('--- 6b. English + Indian festive calendar + Gemini ---');
const HINGLISH = /\b(aaj|karo|hai|hain|kitaab\w*|dekho|bhejo|aapke|aapki|abhi|baaki|kal|raat|pehle)\b/i;
const allSlots = ['morning', 'afternoon', 'evening', 'night'];
const cx = call('dailyPushContext_', IST(9).toISOString());
const every = [];
['asha@x.com', 'bina@x.com', 'dev@x.com', 'guest:zz'].forEach((w) => allSlots.forEach((sl) => every.push(call('composeDailyPush_', sl, w, cx))));
check('75. Every line is in English (no Hinglish)', every.every((p) => !HINGLISH.test(p.title + ' ' + p.message)), every.map((p) => p.title + ' / ' + p.message).filter((t) => HINGLISH.test(t)).join(' | '));
const fest = (d) => call('festivalFor_', d);
check('76. An ordinary day has no festival (27 Sep 2026)', fest('2026-09-27') === null);
check('77. Navratri starts 11 Oct 2026', fest('2026-10-11').key === 'navratri' && fest('2026-10-11').phase === 'today');
check('78. ...and runs through the ninth night (15 Oct is "during")', fest('2026-10-15').phase === 'during');
check('79. Dussehra (20 Oct) is counted down to', fest('2026-10-18').key === 'navratri' && fest('2026-10-20').key === 'dussehra');
const dw = fest('2026-10-27');
check('80. 12 days before Diwali (8 Nov 2026) the "Diwali cleaning" season starts', dw.key === 'diwali' && dw.phase === 'soon' && dw.daysAway === 12);
check('81. Diwali day itself', fest('2026-11-08').key === 'diwali' && fest('2026-11-08').phase === 'today');
check('82. Moon-dated Eid is greeted on the day but never counted down', fest('2027-03-10').key === 'eidulfitr' && fest('2027-03-09') === null);
check('83. The calendar covers the next 12 months', call('upcomingFestivals_', '2026-09-27', 365).length >= 30);
// Festive templates (no Gemini), even with an empty shelf.
const emptyFest = Object.assign({}, empty, { day: '2026-10-27', festival: fest('2026-10-27') });
const gLunch = call('composeDailyPush_', 'afternoon', 'guest:abc', emptyFest);
check('84. Before Diwali, lunch asks to list old books found while cleaning — even with 0 books on the shelf', /Diwali cleaning/.test(gLunch.title) && gLunch.targetUrl.startsWith('/library?list=1'));
const diwaliDay = Object.assign({}, empty, { day: '2026-11-08', festival: fest('2026-11-08') });
const mMorning = call('composeDailyPush_', 'morning', 'dev@x.com', Object.assign({}, diwaliDay, { users: { 'dev@x.com': { name: 'Dev', pincode: '' } } }));
check('85. On Diwali the morning push wishes the reader by name', /Happy Diwali, Dev!/.test(mMorning.title), mMorning.title);
check('86. ...and a visitor gets the wish without a name', call('composeDailyPush_', 'morning', 'guest:abc', diwaliDay).title === '🪔 Happy Diwali!');
check('87. The night of a festival also carries it', /Happy Diwali/.test(call('composeDailyPush_', 'night', 'guest:abc', diwaliDay).title));
// Gemini copy: checks
const good = { morning: { title: '🪔 Good morning, {name}!', message: 'Diwali is 12 days away. See the new books on the shelf.', link: 'library' },
  afternoon: { title: '🧹 Diwali cleaning?', message: 'List the books you find — a front-cover photo is enough.', link: 'list' },
  evening: { title: 'Visit www.spam.com', message: 'x', link: 'cafe' },
  night: { title: 'ok', message: 'ok', link: 'somewhere' } };
const v = call('validateDailyCopy_', good);
check('88. Gemini lines are checked: links/URLs and unknown targets are dropped, good ones kept', v.morning && v.afternoon && !v.evening && !v.night);
check('89. Over-long or template-broken lines are dropped', !call('validateDailyCopy_', { morning: { title: 'x'.repeat(90), message: 'y', link: 'library' } }) && !call('validateDailyCopy_', { morning: { title: 'Hi {user}', message: 'y', link: 'library' } }));
const withAi = Object.assign({}, emptyFest, { users: { 'dev@x.com': { name: 'Dev', pincode: '' } }, aiCopy: v });
check('90. Gemini\'s {name} becomes the reader\'s first name…', call('composeDailyPush_', 'morning', 'dev@x.com', withAi).title === '🪔 Good morning, Dev!');
check('91. …and disappears cleanly for a visitor', call('composeDailyPush_', 'morning', 'guest:q', withAi).title === '🪔 Good morning!');
check('92. Gemini\'s afternoon line opens the listing form', call('composeDailyPush_', 'afternoon', 'guest:q', withAi).targetUrl === '/library?list=1&ss_push=afternoon');
const bPartial = Object.assign({}, withAi, { partialByOwner: { 'bina@x.com': { title: 'Train to Pakistan' } } });
check('93. A reader\'s own missing photo still beats the Gemini line', call('composeDailyPush_', 'afternoon', 'bina@x.com', bPartial).variant === 'afternoon_finish');
check('94. A slot Gemini got wrong falls back to the built-in line', call('composeDailyPush_', 'night', 'guest:q', withAi).variant !== 'ai_night');
// Fetching the copy (once a day, through the website, with the secret).
let copyCalls = 0;
relayAnswer = (opts) => {
  if (!/"brief"/.test(opts.payload || '')) return { success: true, sent: 1, failed: 0 };
  copyCalls++;
  return { success: true, copy: good };
};
fetched.length = 0;
const brief = call('dailyCopyBrief_', Object.assign(cx, { day: '2026-10-27', festival: fest('2026-10-27') }));
check('95. Gemini is told the festival and the numbers — never anyone\'s name or email', brief.festival.name === 'Diwali' && brief.festival.phase === 'soon' && !/@|Asha|Bina/.test(JSON.stringify(brief)));
let got = call('dailyGeminiCopy_', cx);
const copyReq = fetched.find((f) => /\/daily-copy$/.test(f.url));
check('96. The copy is asked from the website (…/daily-copy) with the relay secret', copyReq && copyReq.opts.headers['X-Relay-Secret'] === 'a-very-long-relay-secret-123' && got.afternoon);
call('dailyGeminiCopy_', cx);
check('97. …once a day: the second call uses the saved copy', copyCalls === 1);
relayAnswer = () => ({ success: false });
cx.day = '2026-10-28';
check('98. If Gemini fails the day falls back to built-in lines (null)…', call('dailyGeminiCopy_', cx) === null);
const before = fetched.length;
call('dailyGeminiCopy_', cx);
check('99. …and it does not retry on every slot (waits 2 h)', fetched.length === before);
props.set('DAILY_PUSH_AI', 'off');
cx.day = '2026-10-29';
const b2 = fetched.length;
check('100. Admin can switch Gemini off: no call is made', call('dailyGeminiCopy_', cx) === null && fetched.length === b2);
props.delete('DAILY_PUSH_AI');
relayAnswer = () => ({ success: true, sent: 1, failed: 0 });

// ── 6c. Every notification is a pop-up (28 Sep) ───────────────────────
console.log('--- 6c. every notification is a phone/browser pop-up ---');
const popCalls = () => relayCalls().map((f) => JSON.parse(f.opts.payload).items);
fetched.length = 0;
const nid = call('createNotification', 'bina@x.com', 'swap_request', 'New swap request', 'Asha wants Gitanjali', 'R9', { link: '/profile' });
let pc = popCalls();
check('107. A swap notification (from a trigger) pops up on the reader\'s phone at once', pc.length === 1 && pc[0][0].userEmail === 'bina@x.com' && pc[0][0].title === 'New swap request' && pc[0][0].targetUrl === '/profile');
check('108. ...with the tag the open app uses (noti-<id>), so it never pops twice', pc[0][0].tag === 'noti-' + nid);
check('109. ...and the reader\'s devices attached', pc[0][0].devices.length >= 1 && /dev3$/.test(pc[0][0].devices[0].endpoint));
fetched.length = 0;
call('createNotification', 'nobody@x.com', 'swap_request', 'T', 'M', 'R', {});
check('110. A reader with no device costs nothing (no call made)', popCalls().length === 0);
fetched.length = 0;
ctx.__e = null;
vm.runInContext(`withPopups_(function () {
  createNotification('bina@x.com', 'chat', 'New message', 'Hi', 'C1', { link: '/profile?tab=chats' });
  createNotification('asha@x.com', 'chat', 'New message', 'Hello', 'C1', {});
  createNotificationsBatch([{ userEmail: 'asha@x.com', type: 'tbr_match', title: 'A book from your list', message: 'x', dedupeKey: 'tbr_B1', link: '/browse' }]);
  return null;
}, null)`, ctx);
pc = popCalls();
check('111. During a web request everything is sent once, at the end (one call)', pc.length === 1 && pc[0].length === 3, JSON.stringify(pc.map((x) => x.length)));
check('112. Batch notifications pop up too, tagged by their dedupe key', pc[0].some((i) => i.tag === 'ss-tbr_B1' && i.targetUrl === '/browse'));
check('113. No link → the pop-up opens the notifications page', pc[0].some((i) => i.userEmail === 'asha@x.com' && i.targetUrl === '/notifications'));
const srcAll = read('appsscript.js');
check('114. Every web request (doGet/doPost) sends its pop-ups at the end', /function doGet\(e\) \{ return withPopups_\(doGetHandler_, e\); \}/.test(srcAll) && /function doPost\(e\) \{ return withPopups_\(doPostHandler_, e\); \}/.test(srcAll));
props.delete('PUSH_RELAY_URL');
fetched.length = 0;
call('createNotification', 'bina@x.com', 'x', 'T', 'M', 'R', {});
check('115. Without the relay configured nothing breaks (and nothing is sent)', popCalls().length === 0);
props.set('PUSH_RELAY_URL', 'https://swapsutra.example/api/notifications/relay');
check('116. Daily pushes carry the date in their tag, so yesterday\'s never hides today\'s', /tag: 'ss-daily-' \+ slot \+ '-' \+ ctx\.day/.test(srcAll));

// ── 7. The relay (api/notifications.ts), for real ───────────────────────
console.log('--- 7. relay ---');
(async () => {
  const js = esbuild.transformSync(read('api/notifications.ts'), { loader: 'ts', format: 'cjs' }).code;
  const pushed = [];
  const asCalls = [];
  const fakeWebpush = { setVapidDetails() {}, sendNotification: async (sub, payload) => {
    if (sub.endpoint.includes('dead')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
    pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  } };
  const box = {
    module: { exports: {} }, exports: {}, Buffer, console: { log() {}, warn() {}, error() {} },
    require: (m) => (m === 'web-push' ? fakeWebpush : require(m)),
    process: { env: { APPS_SCRIPT_URL: 'https://script.google.com/x', PUSH_RELAY_SECRET: 'a-very-long-relay-secret-123', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' } },
    fetch: async (url, init) => { const b = JSON.parse(init.body); asCalls.push(b); return { text: async () => JSON.stringify(b.action === 'getPushSubscriptionsForRelay' ? { subscriptions: [{ userEmail: 'p1@x.com', endpoint: 'https://fcm.googleapis.com/p1', keys: { p256dh: 'a', auth: 'b' } }] } : { success: true, echo: b }) }; },
  };
  box.exports = box.module.exports;
  vm.runInNewContext(js, box);
  const handler = box.module.exports.default;
  const hit = async (route, body, headers = {}) => {
    const out = { status: 0, body: null };
    const res = { setHeader() {}, status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return res; }, end: () => res };
    await handler({ method: 'POST', url: '/api/notifications/' + route, query: {}, body, headers }, res);
    return out;
  };
  let o = await hit('relay', { items: [{ userEmail: 'guest:ab12', title: 'T', message: 'M', targetUrl: '/library?ss_push=morning', tag: 'ss-daily-morning', devices: [{ endpoint: 'https://fcm.googleapis.com/g1', keys: { p256dh: 'x', auth: 'y' } }, { endpoint: 'https://fcm.googleapis.com/dead', keys: { p256dh: 'x', auth: 'y' } }] }] }, { 'x-relay-secret': 'a-very-long-relay-secret-123' });
  check('53. Relay sends a daily push straight to the attached devices', o.body.sent === 1 && pushed[0].endpoint === 'https://fcm.googleapis.com/g1' && pushed[0].payload.targetUrl === '/library?ss_push=morning');
  check('54. ...without asking Apps Script for the devices', !asCalls.some((b) => b.action === 'getPushSubscriptionsForRelay'));
  check('55. ...and a dead phone is still reported so its row is retired', asCalls.some((b) => b.action === 'reportPushFailureForRelay' && /dead/.test(b.endpoint) && b.statusCode === 410));
  pushed.length = 0; asCalls.length = 0;
  o = await hit('relay', { items: [{ userEmail: 'p1@x.com', title: 'Badge', message: 'm' }] }, { 'x-relay-secret': 'a-very-long-relay-secret-123' });
  check('56. Badge / @mention pushes (no devices attached) still look the reader up, as before', o.body.sent === 1 && asCalls[0].action === 'getPushSubscriptionsForRelay' && pushed[0].endpoint.endsWith('p1'));
  o = await hit('relay', { items: [{ userEmail: 'x', devices: [] }] }, { 'x-relay-secret': 'wrong-secret-wrong-secret' });
  check('57. The relay still refuses a wrong secret', o.status === 401);
  asCalls.length = 0;
  o = await hit('subscribe-guest', { endpoint: 'https://fcm.googleapis.com/g9', keys: { p256dh: 'x', auth: 'y' } });
  check('58. /subscribe-guest saves a visitor\'s device', asCalls[0].action === 'saveGuestPushSubscription' && asCalls[0].endpoint.endsWith('g9'));
  check('59. The /daily-preference on/off route is gone', !/daily-preference/.test(read('api/notifications.ts')) && !/daily-preference/.test(read('server.ts')));
  o = await hit('daily-copy', { brief: {} }, { 'x-relay-secret': 'nope-nope-nope-nope' });
  check('101. /daily-copy refuses without the relay secret', o.status === 401);
  const gem = box.module.exports;   // Gemini copy lives in api/notifications.ts (28 Sep)
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    if (/gemini-2\.5-flash/.test(url)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      morning: { title: '☀️ Good morning, {name}!', message: 'Diwali is 12 days away — see new books.', link: 'library' },
      afternoon: { title: '🪔 Diwali cleaning?', message: 'List the books you find. A front-cover photo is enough.', link: 'list' },
      evening: { title: '🎟️ Meetup', message: 'Join us.', link: 'events' },
      night: { title: '🌙 10 pages before bed?', message: 'A calm read before the lights go out.', link: 'library' } }) }] } }] }) };
  };
  const g1 = await gem.generateDailyCopy({ festival: { name: 'Diwali', phase: 'soon', daysAway: 12 } }, 'KEY', { fetchImpl: fakeFetch });
  check('102. Gemini: if one model is unavailable the next is tried', g1.success && g1.model === 'gemini-2.0-flash' && seen.length === 2);
  check('103. The key travels in a header, not in the URL', seen.every((x) => !/KEY/.test(x.url) && x.init.headers['x-goog-api-key'] === 'KEY'));
  check('104. An "events" line with no real event is dropped', g1.copy.morning && g1.copy.afternoon && !g1.copy.evening && g1.copy.night);
  const prompt = gem.buildPrompt({ festival: { name: 'Diwali' } });
  check('105. The prompt asks for English, festival themes and a listing push at lunch', /English/.test(prompt) && /festival/i.test(prompt) && /LIST a book/.test(prompt) && /never mention a number that is 0/.test(prompt));
  check('106. Without GEMINI_API_KEY it says so (and Apps Script uses the built-in lines)', (await gem.generateDailyCopy({}, '')).error === 'GEMINI_NOT_CONFIGURED');
  asCalls.length = 0;
  await hit('push-open', { slot: 'evening' });
  check('60. /push-open counts a tap', asCalls[0].action === 'recordPushOpen' && asCalls[0].slot === 'evening');

  // ── 8. The browser side ───────────────────────────────────────────────
  console.log('--- 8. browser ---');
  const B = { exports: {} };
  const bjs = esbuild.transformSync(read('src/services/dailyPush.ts'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(bjs, { module: B, exports: B.exports, URL, require: (m) => (m.includes('runtime') ? { apiUrl: (p) => p } : {}) });
  const d = B.exports;
  const now = Date.now();
  const ask = (o) => d.shouldAutoAsk({ supported: true, permission: 'default', askedAt: null, now, ...o });
  check('61. The browser box opens for anyone who has not decided yet', ask({}));
  check('62. Never when notifications are already allowed or blocked', !ask({ permission: 'granted' }) && !ask({ permission: 'denied' }));
  check('63. Never where push is unsupported (e.g. iPhone Safari tab before install)', !ask({ supported: false }));
  check('64. At most once a day, so a dismissed box is not forced on every tap', !ask({ askedAt: now - 3600000 }) && ask({ askedAt: now - 25 * 3600000 }));
  const auto = read('src/components/DailyUpdatesPrompt.tsx');
  check('65. It opens on the first tap (browsers need a tap), straight from the tap handler', /addEventListener\('pointerup', onTap, true\)/.test(auto) && /markAutoAsked\(\);[\s\S]{0,200}enableDailyUpdates\(userEmail\)/.test(auto));
  check('66. No card, no "Not now", no snooze', !/Not now|snooze/i.test(auto + read('src/services/dailyPush.ts')));
  check('67. ?ss_push=<slot> is recognised; anything else is ignored', d.pushSlotFromUrl('https://x/book/B1?ss_push=night') === 'night' && d.pushSlotFromUrl('https://x/?ss_push=evil') === '');
  const app = read('src/App.tsx');
  check('68. App counts the tap on open and when a push opens a page in the running app', (app.match(/recordPushOpenFromUrl\(\)/g) || []).length >= 2);
  check('69. App keeps an allowed device registered, and re-registers it on sign-in', /syncDevice\(activeUserEmail\)[\s\S]{0,80}\}, \[activeUserEmail\]\);/.test(app));
  check('70. "/library?list=1" opens the listing form (or sign-in for a visitor)', /searchParams\.get\('list'\) !== '1'/.test(app) && /if \(!activeUserEmail\) \{ listIntentRef\.current = false; setShowLoginModal\(true\); return; \}/.test(app) && /openListingForm\(\); \}/.test(app));
  check('71. Auto-enable runs for guests and members on every page', /<NotificationAutoEnable userEmail=\{activeUserEmail\} \/>/.test(app));
  check('72. The notification settings screen (on/off switches) is removed', !/NotificationSettings|isNotificationSettingsOpen/.test(app) && /^\/\/ REMOVED/.test(read('src/components/NotificationSettings.tsx')));
  const center = read('src/components/NotificationCenter.tsx');
  check('73. Notification Center has no Settings button and no "Enable Push" button', !/Settings|Enable Push|onNavigateToSettings/.test(center));
  const E = { exports: {} };
  const store = new Map([['swapsutra_notif_prefs_a@x.com', JSON.stringify({ pushEnabled: false, emailEnabled: false, quietHoursEnabled: true, categories: { swap: { push: false, email: false } } })]]);
  vm.runInNewContext(esbuild.transformSync(read('src/services/notificationEngine.ts'), { loader: 'ts', format: 'cjs' }).code,
    { module: E, exports: E.exports, console, require: () => ({ apiUrl: (x) => x, WebPushManager: {} }), localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, window: {} });
  const prefs = E.exports.NotificationEngine.getUserPreferences('a@x.com');
  check('117. With the app open, a notification is a real pop-up, not an in-app toast', /if \(WebPushManager\.getPermissionStatus\(\) === 'granted'\) \{\s*WebPushManager\.displayLocalNotification/.test(app) && !/hidden && WebPushManager/.test(app));
  const wpm = read('src/services/webPushManager.ts');
  check('118. The open app does not pop an event the server push already showed', /getNotifications\(\{ tag \}\)/.test(wpm) && /renotify: false/.test(wpm));
  const swSrc = read('public/sw.js');
  check('119. Service worker: same event never rings twice; old caches cleared (30 Sep: no PWA cache)', /renotify: false/.test(swSrc) && /caches\.delete\(key\)/.test(swSrc));
  check('74. Old "off" choices are ignored: push, email and every category are on, no quiet hours', prefs.pushEnabled && prefs.emailEnabled && !prefs.quietHoursEnabled && Object.values(prefs.categories).every((c) => c.push && c.email) && !store.has('swapsutra_notif_prefs_a@x.com'));

  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  process.exit(failed === 0 ? 0 : 1);
})();
