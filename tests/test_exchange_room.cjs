/**
 * test_exchange_room.cjs  (8 Oct 2026, owner's request)
 *
 * The Exchange Room: chat, condition protection and the delivery stages are
 * one room with 16 steps, the same for sell, rent, lend and swap. Run
 * against the shipped appsscript.js with in-memory sheets and a fake clock:
 *   • the step list, the current step and what each reader can do
 *   • condition video before payment; 48-hour clocks that close a request
 *   • route, courier + tracking ID, handover video, both marks
 *   • 21 days, the 7-days-left notice, +7 asked by the borrower in 3 days,
 *     agreed by the owner; the return with the same videos
 *   • deposit refunds, rating each other and SwapSutra, the room closing
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
const H = 3600e3, D = 24 * H;
const T0 = Date.parse('2026-10-12T04:30:00Z');   // after the room's timers start

const SWAP_HEADERS = ['id', 'serviceType', 'status', 'requestedBookTitle', 'securityDeposit', 'ownerDeposit', 'amount', 'swapPreference', 'createdAt', 'updatedAt'];
const CHAT_HEADERS = ['chatId', 'bookId', 'ownerEmail', 'requesterEmail', 'adminEmail', 'chatStatus', 'createdAt', 'swapId'];

function makeEnv() {
  const sheets = {};
  const notifications = [];
  const chats = [];
  const emails = [];
  const openDisputes = {};
  let session = '';
  function makeSheet(headers) {
    const data = headers && headers.length ? [headers.slice()] : [];
    return {
      _data: data,
      getDataRange() { return { getValues: () => data.map(r => r.slice()) }; },
      appendRow(row) { data.push(row.slice()); },
      getRange(r, c) { return { setValue: (v) => { while (data[r - 1].length < c) data[r - 1].push(''); data[r - 1][c - 1] = v; }, getValue: () => data[r - 1][c - 1] }; },
      getLastRow() { return data.length; },
      getLastColumn() { return data[0] ? data[0].length : 0; }
    };
  }
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch() { throw new Error('no network'); } },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, putAll() {}, getAll: () => ({}) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    MailApp: { sendEmail() {} },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
    DriveApp: {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gs, ctx, { filename: 'appsscript.js' });
  // A clock the test controls (new Date() and Date.now()).
  vm.runInContext(`(function(){ const RealDate = Date; let fake = null;
    class FakeDate extends RealDate { constructor(...a) { if (a.length === 0 && fake !== null) super(fake); else super(...a); }
      static now() { return fake !== null ? fake : RealDate.now(); } }
    globalThis.Date = FakeDate; globalThis.__setNow = v => { fake = v; }; })()`, ctx);
  ctx.Utilities = {
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(str).digest()).map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 'sha256' },
    formatDate: (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ')
  };
  ctx.ScriptApp = { getOAuthToken: () => 'tok' };
  ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getHeaders: () => ({ Location: 'https://upload.example/s' }), getContentText: () => '' }) };
  Object.assign(ctx, {
    getOrCreateSheet(name, headers) {
      if (!sheets[name]) sheets[name] = makeSheet(headers);
      return sheets[name];
    },
    ensureSheetHeaders(sheet, headers) {
      if (!sheet._data.length) sheet._data.push([]);
      const current = sheet._data[0];
      headers.forEach(h => { if (current.indexOf(h) === -1) current.push(h); });
      return current.slice();
    },
    createNotification: (...args) => { notifications.push(args); return {}; },
    sendSwapSutraEmail: (m) => { emails.push(m); return true; },
    getAuthenticatedEmail: () => session,
    isAuthenticatedAdmin: () => session === 'swapsutra@gmail.com',
    sendChatMessage: (m) => { chats.push(m); return { success: true }; },
    swapHasOpenDispute: (id) => !!openDisputes[id],
    getOrCreateFolder: (name) => ({ getId: () => 'folder_' + name }),
    publicReaderName: (n, email) => ({ 'own@x.com': 'Asha Owner', 'req@x.com': 'Ravi Reader' })[email] || '',
    loadSwapForCirculation(id) {
      const s = sheets.SwapRequests; if (!s) return null;
      const headers = s._data[0];
      for (let r = 1; r < s._data.length; r++) {
        if (String(s._data[r][0]) !== String(id)) continue;
        const obj = {}; headers.forEach((h, i) => { obj[h] = s._data[r][i]; });
        return { rowIndex: r, headers, row: s._data[r], obj, ownerEmail: 'own@x.com', requesterEmail: 'req@x.com', sheet: s };
      }
      return null;
    },
  });
  const api = new Proxy({}, { get: (_, name) => (...args) => { ctx.__a = args; return JSON.parse(JSON.stringify(vm.runInContext(`${String(name)}.apply(null, __a)`, ctx) ?? null)); } });
  const env = {
    api, ctx, sheets, notifications, chats, emails, openDisputes,
    as(email) { session = email; },
    now(ms) { ctx.__setNow(ms); },
    addSwap(o) {
      env.lastId = o.id;
      const s = ctx.getOrCreateSheet('SwapRequests', SWAP_HEADERS);
      const full = Object.assign({ status: 'Accepted', requestedBookTitle: 'Dune', securityDeposit: 0, ownerDeposit: 0, amount: 0, swapPreference: '', createdAt: new Date(T0 - D), updatedAt: new Date(T0) }, o);
      s.appendRow(SWAP_HEADERS.map(h => full[h] !== undefined ? full[h] : ''));
      const c = ctx.getOrCreateSheet('Chats', CHAT_HEADERS);
      c.appendRow(['CHAT_' + o.id, 'B1', 'own@x.com', 'req@x.com', 'swapsutra@gmail.com', 'Active', new Date(T0), o.id]);
    },
    swapStatus(id) { const s = sheets.SwapRequests; const r = s._data.find(x => x[0] === id); return r[s._data[0].indexOf('status')]; },
    chatStatus(id) { const s = sheets.Chats; const r = s._data.find(x => x[s._data[0].indexOf('swapId')] === id); return r[s._data[0].indexOf('chatStatus')]; },
    video(swapId, leg, kind, email, at) {
      const s = ctx.getOrCreateSheet('ExchangeVideos', vm.runInContext('VMS_VIDEO_HEADERS', ctx));
      const h = ctx.ensureSheetHeaders(s, vm.runInContext('VMS_VIDEO_HEADERS', ctx));
      const rec = { id: 'V' + Math.random(), swapId, leg, kind, uploaderEmail: email, url: 'https://drive/' + kind, createdAt: new Date(at || T0), recordedInApp: 'true' };
      s.appendRow(h.map(k => rec[k] !== undefined ? rec[k] : ''));
    },
    approveAll(id) {
      env.as('req@x.com'); env.api.getExchangeRoom({ swapId: id }); // creates the fee rows
      const s = sheets.SecurityFeePayments; const h = s._data[0];
      s._data.forEach((r, i) => { if (i && r[h.indexOf('swapId')] === id) { r[h.indexOf('adminStatus')] = 'ADMIN_APPROVED'; r[h.indexOf('paymentStatus')] = 'SUBMITTED'; } });
    },
    setFee(id, role, adminStatus) {
      const s = sheets.SecurityFeePayments; const h = s._data[0];
      s._data.forEach((r, i) => { if (i && r[h.indexOf('swapId')] === id && r[h.indexOf('payerRole')] === role) { r[h.indexOf('adminStatus')] = adminStatus; } });
    },
    payouts(id) { const s = sheets.ReturnForfeits; if (!s) return []; const h = s._data[0]; return s._data.slice(1).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; }).filter(o => o.swapId === id); },
    address(email) {
      const s = ctx.getOrCreateSheet('DeliveryAddresses', vm.runInContext('ADDRESS_HEADERS', ctx));
      const h = ctx.ensureSheetHeaders(s, vm.runInContext('ADDRESS_HEADERS', ctx));
      const rec = { id: 'A1', email, line1: '1 Road', pincode: '110001', phone: '9800000000' };
      s.appendRow(h.map(k => rec[k] !== undefined ? rec[k] : ''));
    }
  };
  env.now(T0);
  return env;
}
const act = (env, who, body) => { env.as(who); return env.api.exchangeRoomAction(body); };
const room = (env, who, id) => { env.as(who); return env.api.getExchangeRoom({ swapId: id || env.lastId }); };
const types = r => r.actions.map(a => a.type + (a.kind ? ':' + a.kind : '') + (a.leg ? '@' + a.leg : '')).join(',');
const step = (r, n) => r.steps.find(s => s.n === n);

// ── 1. A rental, just accepted ─────────────────────────────────────────
{
  const env = makeEnv();
  env.addSwap({ id: 'S1', serviceType: 'RENT', securityDeposit: 260 });
  const ro = room(env, 'own@x.com');
  const rr = room(env, 'req@x.com');
  check('1. The room loads for both readers', ro.success && rr.success, JSON.stringify(ro).slice(0, 200));
  check('2. Sixteen steps, the same list for every exchange', ro.steps.length === 16 && ro.steps.map(s => s.n).join() === Array.from({ length: 16 }, (_, i) => i + 1).join());
  check('3. Requested and accepted are done; the condition video is the current step', step(ro, 1).state === 'done' && step(ro, 2).state === 'done' && ro.current === 3);
  check('4. The owner (who sends the book) records the condition video first', types(ro) === 'video:QUALITY@outbound,close', types(ro));
  check('5. The renter cannot pay before the condition video — only close', types(rr) === 'close', types(rr));
  check('6. ...and is told what they are waiting for', /condition video/.test(rr.waitingOn), rr.waitingOn);
  check('7. The condition video has a 48-hour deadline', rr.deadlines.conditionBy === new Date(T0 + 48 * H).toISOString(), rr.deadlines.conditionBy);
  check('8. A rental keeps the return steps 10–14', [10, 11, 12, 13, 14].every(n => step(ro, n).state === 'upcoming'));
  check('9. The chat is open from acceptance (before payment)', env.ctx.roomChatOpen_('S1') === true);
  env.as('zz@x.com');
  check('10. A stranger cannot open the room', env.api.getExchangeRoom({ swapId: 'S1' }).error === 'UNAUTHORIZED');

  // The condition video is allowed before payment; packaging is not.
  env.as('own@x.com');
  const q = env.api.vmsStartUpload({ swapId: 'S1', leg: 'outbound', kind: 'QUALITY', mimeType: 'video/mp4', sizeBytes: 1000 });
  check('11. The condition video can be uploaded before payment', q.error !== 'SECURITY_FEE_PENDING', JSON.stringify(q));
  const p = env.api.vmsStartUpload({ swapId: 'S1', leg: 'outbound', kind: 'PACKING', mimeType: 'video/mp4', sizeBytes: 1000 });
  check('12. The packaging video waits for the payment', p.error === 'SECURITY_FEE_PENDING', JSON.stringify(p));
  env.as('req@x.com');
  const q2 = env.api.vmsStartUpload({ swapId: 'S1', leg: 'outbound', kind: 'QUALITY', mimeType: 'video/mp4', sizeBytes: 1000 });
  check('13. The renter cannot record the owner\'s condition video', q2.error === 'WRONG_PARTY', JSON.stringify(q2));

  // Condition video in → the renter pays within 48 hours.
  env.video('S1', 'outbound', 'QUALITY', 'own@x.com', T0 + 5 * H);
  env.now(T0 + 6 * H);
  const r2 = room(env, 'req@x.com');
  check('14. After the condition video, the renter can pay (deposit + fee)', r2.actions.some(a => a.type === 'pay' && a.amount === 270), types(r2));
  check('15. Payment is due 48 hours after the condition video', r2.deadlines.payBy === new Date(T0 + 53 * H).toISOString(), r2.deadlines.payBy);
  check('16. The current step is 4 (payment)', r2.current === 4 && /Pay by/.test(step(r2, 4).detail), step(r2, 4).detail);

  // Payment verified → packaging, route.
  env.approveAll('S1');
  const r3o = room(env, 'own@x.com'), r3r = room(env, 'req@x.com');
  check('17. Paid: the owner records the packaging video and either reader picks the route', types(r3o) === 'video:PACKING@outbound,setRoute', types(r3o));
  check('18. ...the renter can pick the route too', types(r3r) === 'setRoute', types(r3r));
  check('19. Closing is no longer possible once paid', act(env, 'req@x.com', { swapId: 'S1', act: 'close' }).success === false);

  // Route: in person, pinned.
  const sr = act(env, 'req@x.com', { swapId: 'S1', act: 'setRoute', phase: 'out', method: 'in_person', meetingLat: 28.61, meetingLng: 77.2, meetingPoint: 'Metro gate 2' });
  check('20. The route is recorded (in person, pinned)', sr.success === true, JSON.stringify(sr));
  check('21. ...and posted into the chat as step 6', env.chats.some(c => /Step 6/.test(c.message) && /in person/.test(c.message)));
  const r4 = room(env, 'own@x.com');
  check('22. In person: step 7 (the place) is done with the pin', step(r4, 7).state === 'done' && /Metro gate 2/.test(step(r4, 7).detail), JSON.stringify(step(r4, 7)));
  check('23. The owner still owes packaging and handover videos', types(r4) === 'video:PACKING@outbound,video:HANDOVER@outbound', types(r4));
  const md0 = act(env, 'own@x.com', { swapId: 'S1', act: 'markDelivered', leg: 'outbound' });
  check('24. "Delivered" is refused until the videos exist', md0.success === false && md0.error === 'VIDEO_REQUIRED', JSON.stringify(md0));
  env.video('S1', 'outbound', 'PACKING', 'own@x.com', T0 + 7 * H);
  env.video('S1', 'outbound', 'HANDOVER', 'own@x.com', T0 + 8 * H);
  const r5 = room(env, 'own@x.com');
  check('25. With all three videos the owner can mark delivered', types(r5) === 'markDelivered@outbound', types(r5));
  check('26. The renter records the unboxing video before marking received', types(room(env, 'req@x.com')) === 'video:RECEIVING@outbound', types(room(env, 'req@x.com')));
  const mr0 = act(env, 'req@x.com', { swapId: 'S1', act: 'markReceived', leg: 'outbound' });
  check('27. "Received" is refused without the unboxing video', mr0.error === 'VIDEO_REQUIRED');
  env.now(T0 + 9 * H);
  check('28. The owner marks delivered', act(env, 'own@x.com', { swapId: 'S1', act: 'markDelivered', leg: 'outbound' }).success === true);
  check('29. ...once only', act(env, 'own@x.com', { swapId: 'S1', act: 'markDelivered', leg: 'outbound' }).success === false);
  env.video('S1', 'outbound', 'RECEIVING', 'req@x.com', T0 + 9 * H);
  check('30. The renter marks received', act(env, 'req@x.com', { swapId: 'S1', act: 'markReceived', leg: 'outbound' }).success === true);
  check('31. Both marks are posted in the chat', env.chats.filter(c => /Step 9/.test(c.message)).length === 2);
  const r6 = room(env, 'req@x.com');
  check('32. Step 9 done; step 10 (21 days) is current', step(r6, 9).state === 'done' && r6.current === 10, 'current ' + r6.current);
  check('33. The return is due 21 days after the handover', /Return due by/.test(step(r6, 10).detail), step(r6, 10).detail);
  check('34. Not finished yet — no rating, no refund', !r6.exchangeDone && env.payouts('S1').length === 0);

  // +7: only in the 3 days after the 7-days-left reminder.
  const ext0 = act(env, 'req@x.com', { swapId: 'S1', act: 'requestExtension' });
  check('35. +7 cannot be asked for on day 1', ext0.success === false && ext0.error === 'EXTENSION_WINDOW', JSON.stringify(ext0));
  env.now(T0 + 9 * H + 14 * D + H);  // 7 days left
  const tick = env.api.runExchangeRoomTicks_(T0 + 9 * H + 14 * D + H);
  check('36. With 7 days left the hourly job posts the reminder in the chat (step 11)', tick.notices === 1 && env.chats.some(c => /Step 11/.test(c.message) && /\+7 days/.test(c.message)), JSON.stringify(tick));
  env.api.runExchangeRoomTicks_(T0 + 9 * H + 14 * D + 2 * H);
  check('37. ...once', env.chats.filter(c => /Step 11/.test(c.message)).length === 1);
  const r7r = room(env, 'req@x.com'), r7o = room(env, 'own@x.com');
  check('38. Steps 10 and 11 are done; 12 is current', step(r7r, 10).state === 'done' && step(r7r, 11).state === 'done' && r7r.current === 12);
  check('39. The renter (who has the book) may ask for +7', r7r.actions.some(a => a.type === 'requestExtension'), types(r7r));
  check('40. The owner may not ask', !r7o.actions.some(a => a.type === 'requestExtension') && act(env, 'own@x.com', { swapId: 'S1', act: 'requestExtension' }).success === false);
  const ext1 = act(env, 'req@x.com', { swapId: 'S1', act: 'requestExtension', reason: 'Exams' });
  check('41. The renter asks for +7', ext1.success === true, JSON.stringify(ext1));
  check('42. ...and it is posted in the chat', env.chats.some(c => /asked for 7 more days/.test(c.message)));
  check('43. A second request is refused', act(env, 'req@x.com', { swapId: 'S1', act: 'requestExtension' }).success === false);
  const r8o = room(env, 'own@x.com');
  check('44. The owner sees agree / decline', r8o.actions.some(a => a.type === 'answerExtension' && a.days === 7), types(r8o));
  check('45. The renter cannot answer their own request', act(env, 'req@x.com', { swapId: 'S1', act: 'answerExtension', extensionId: r8o.actions.find(a => a.type === 'answerExtension').extensionId, accept: true }).success === false);
  const dueBefore = room(env, 'req@x.com').returnInfo.dueAt;
  const ans = act(env, 'own@x.com', { swapId: 'S1', act: 'answerExtension', extensionId: r8o.actions.find(a => a.type === 'answerExtension').extensionId, accept: true });
  check('46. The owner agrees', ans.success === true, JSON.stringify(ans));
  const dueAfter = room(env, 'req@x.com').returnInfo.dueAt;
  check('47. The due date moves by exactly 7 days', Date.parse(dueAfter) - Date.parse(dueBefore) === 7 * D, dueBefore + ' → ' + dueAfter);

  // The return, by courier.
  const r9 = room(env, 'req@x.com');
  check('48. Now the return route is chosen (step 12)', r9.actions.some(a => a.type === 'setRoute' && a.phase === 'back'), types(r9));
  check('49. Return route: courier', act(env, 'req@x.com', { swapId: 'S1', act: 'setRoute', phase: 'back', method: 'courier' }).success === true);
  const r10o = room(env, 'own@x.com');
  check('50. The owner (receiving it back) is asked for an address', r10o.actions.some(a => a.type === 'address'), types(r10o));
  env.address('own@x.com');
  const r10 = room(env, 'req@x.com');
  check('51. The renter records the return packaging and condition videos (step 13)', types(r10) === 'video:PACKING@return,video:QUALITY@return,video:HANDOVER@return', types(r10));
  env.video('S1', 'return', 'QUALITY', 'req@x.com', T0 + 16 * D);
  env.video('S1', 'return', 'PACKING', 'req@x.com', T0 + 16 * D);
  check('52. Then the courier and tracking ID', room(env, 'req@x.com').actions.some(a => a.type === 'courier' && a.leg === 'return'));
  check('53. A made-up courier is refused', act(env, 'req@x.com', { swapId: 'S1', act: 'courierDetails', leg: 'return', courierName: 'Fake Co', awb: 'AB12345' }).success === false);
  const cd = act(env, 'req@x.com', { swapId: 'S1', act: 'courierDetails', leg: 'return', courierName: 'Delhivery', awb: 'dl12345678' });
  check('54. Courier + tracking ID are saved', cd.success === true, JSON.stringify(cd));
  const r11 = room(env, 'req@x.com');
  check('55. ...with a tracking link', r11.legs.back[0].awb === 'DL12345678' && /delhivery/.test(r11.legs.back[0].trackingUrl), JSON.stringify(r11.legs.back[0]));
  check('56. Then the handover video', types(r11) === 'video:HANDOVER@return', types(r11));
  env.video('S1', 'return', 'HANDOVER', 'req@x.com', T0 + 16 * D);
  check('57. The renter marks it returned', act(env, 'req@x.com', { swapId: 'S1', act: 'markDelivered', leg: 'return' }).success === true);
  env.video('S1', 'return', 'RECEIVING', 'own@x.com', T0 + 18 * D);
  check('58. The owner marks it received back', act(env, 'own@x.com', { swapId: 'S1', act: 'markReceived', leg: 'return' }).success === true);
  const r12 = room(env, 'own@x.com');
  check('59. Step 14 done: the exchange is complete; rating is current', r12.exchangeDone && r12.current === 15 && types(r12) === 'rate', r12.current + ' ' + types(r12));
  check('60. The chat is marked Completed (so ratings are allowed)', env.chatStatus('S1') === 'Completed');
  const ref = env.payouts('S1');
  check('61. The renter\'s ₹260 deposit is queued for refund (not the ₹10 fee)', ref.length === 1 && ref[0].leg === 'refund:requester' && ref[0].amount === 260 && ref[0].ownerEmail === 'req@x.com', JSON.stringify(ref));
  env.api.runExchangeRoomTicks_(T0 + 19 * D);
  check('62. ...once (the hourly job does not duplicate it)', env.payouts('S1').length === 1);

  // Reflect & rate.
  check('63. A rating needs both stars', act(env, 'own@x.com', { swapId: 'S1', act: 'rate', readerRating: 5 }).success === false);
  check('64. Contact details are kept out of comments', act(env, 'own@x.com', { swapId: 'S1', act: 'rate', readerRating: 5, platformRating: 5, readerComment: 'call me 9876543210' }).blocked === true);
  const rt1 = act(env, 'own@x.com', { swapId: 'S1', act: 'rate', readerRating: 5, platformRating: 5, readerComment: 'Lovely reader' });
  check('65. The owner rates the renter and SwapSutra', rt1.success === true && rt1.closed === false && /g\.page/.test(rt1.reviewUrl), JSON.stringify(rt1));
  check('66. The reader rating is stored for the profile', env.sheets.ReaderRatings && env.sheets.ReaderRatings._data.length === 2);
  check('67. Rating twice is refused', act(env, 'own@x.com', { swapId: 'S1', act: 'rate', readerRating: 4, platformRating: 4 }).success === false);
  const rt2 = act(env, 'req@x.com', { swapId: 'S1', act: 'rate', readerRating: 4, platformRating: 5 });
  check('68. When both have rated the room closes (step 16)', rt2.success && rt2.closed === true, JSON.stringify(rt2));
  check('69. The chat is archived — gone from both readers\' chats, kept by SwapSutra', env.chatStatus('S1') === 'Archived');
  const r13 = room(env, 'req@x.com');
  check('70. Every step shows done', r13.steps.every(s => s.state === 'done') && r13.closed, r13.steps.map(s => s.state).join());
  check('71. The closing line is posted', env.chats.some(c => /Step 16/.test(c.message)));
  check('72. A closed room accepts no more actions', act(env, 'req@x.com', { swapId: 'S1', act: 'markReceived', leg: 'outbound' }).error === 'ROOM_CLOSED');
  check('73. The SwapSutra rating is stored', env.sheets.PlatformFeedback._data.length === 3);
}

// ── 2. 48-hour clocks ──────────────────────────────────────────────────
{
  const env = makeEnv();
  env.addSwap({ id: 'S2', serviceType: 'LEND', securityDeposit: 300 });
  env.api.runExchangeRoomTicks_(T0 + 25 * H);
  check('74. After 24 hours without a condition video, the owner is reminded', env.notifications.some(n => n[0] === 'own@x.com' && n[1] === 'room_condition_reminder'));
  env.api.runExchangeRoomTicks_(T0 + 49 * H);
  check('75. After 48 hours without it, the request closes by itself', env.swapStatus('S2') === 'Expired' && env.chatStatus('S2') === 'Archived', env.swapStatus('S2'));
  check('76. ...and both readers are told', env.notifications.filter(n => n[1] === 'room_request_closed').length === 2);
}
{
  const env = makeEnv();
  env.addSwap({ id: 'S3', serviceType: 'LEND', securityDeposit: 300 });
  env.video('S3', 'outbound', 'QUALITY', 'own@x.com', T0 + 10 * H);
  env.api.runExchangeRoomTicks_(T0 + 49 * H);
  check('77. The payment clock starts at the condition video, not at acceptance', env.swapStatus('S3') === 'Accepted');
  check('78. The borrower is reminded to pay', env.notifications.some(n => n[0] === 'req@x.com' && n[1] === 'room_payment_reminder'));
  env.api.runExchangeRoomTicks_(T0 + 59 * H);
  check('79. Not paid 48 hours after the video → closed', env.swapStatus('S3') === 'Expired');
}
{
  const env = makeEnv();
  env.addSwap({ id: 'S4', serviceType: 'LEND', securityDeposit: 300 });
  env.video('S4', 'outbound', 'QUALITY', 'own@x.com', T0 + 1 * H);
  room(env, "req@x.com");
  env.setFee('S4', 'requester', 'ADMIN_PENDING');
  env.api.runExchangeRoomTicks_(T0 + 60 * H);
  check('80. A payment that was made and is being verified is never closed', env.swapStatus('S4') === 'Accepted');
  const rp = room(env, 'req@x.com');
  check('81. ...the reader is told SwapSutra is verifying it', /verifying/.test(rp.waitingOn), rp.waitingOn);
  const c = act(env, 'req@x.com', { swapId: 'S4', act: 'close', reason: 'Found it elsewhere' });
  check('82. A reader can still close before the payment is verified', c.success === true && env.swapStatus('S4') === 'Cancelled');
  const pay = env.payouts('S4');
  check('83. ...and what the borrower paid is queued for a full refund (a lending owner pays nothing)', pay.map(p => p.leg + ':' + p.amount).sort().join() === 'refund:requester:310', JSON.stringify(pay));
  check('84. The closed room shows step 16 done and the rest closed', (() => { const r = room(env, 'req@x.com'); return r.closed && step(r, 16).state === 'done' && step(r, 5).state === 'closed'; })());
  check('85. The chat of a closed request is not open', env.ctx.roomChatOpen_('S4') === false);
}

// ── 3. A sale: buyer must be happy; steps 10–14 skipped ────────────────
{
  const env = makeEnv();
  env.addSwap({ id: 'S5', serviceType: 'SELL', amount: 300, createdAt: new Date(T0 - H) });
  const r = room(env, 'req@x.com');
  check('86. A sale skips the return steps', [10, 11, 12, 13, 14].every(n => step(r, n).state === 'skipped') && /sale is final/.test(step(r, 10).detail));
  check('87. The seller is asked for a payout UPI', room(env, 'own@x.com').actions.some(a => a.type === 'payoutAccount'));
  env.video('S5', 'outbound', 'QUALITY', 'own@x.com');
  check('88. The buyer pays price + fee', room(env, 'req@x.com').actions.some(a => a.type === 'pay' && a.amount === 310));
  env.approveAll('S5');
  act(env, 'own@x.com', { swapId: 'S5', act: 'setRoute', phase: 'out', method: 'courier' });
  env.video('S5', 'outbound', 'PACKING', 'own@x.com');
  check('89. Courier: tracking ID before the handover video is allowed', room(env, 'own@x.com').actions.some(a => a.type === 'courier'));
  check('90. A delivered mark without a tracking ID is refused', (() => { env.video('S5', 'outbound', 'HANDOVER', 'own@x.com'); return act(env, 'own@x.com', { swapId: 'S5', act: 'markDelivered', leg: 'outbound' }).success === false; })());
  act(env, 'own@x.com', { swapId: 'S5', act: 'courierDetails', leg: 'outbound', courierName: 'India Post', awb: 'EE123456789IN' });
  check('91. Then delivered', act(env, 'own@x.com', { swapId: 'S5', act: 'markDelivered', leg: 'outbound' }).success === true);
  env.video('S5', 'outbound', 'RECEIVING', 'req@x.com');
  const notHappy = act(env, 'req@x.com', { swapId: 'S5', act: 'markReceived', leg: 'outbound' });
  check('92. The buyer must say they are happy (or report a problem)', notHappy.error === 'NOT_HAPPY', JSON.stringify(notHappy));
  const happy = act(env, 'req@x.com', { swapId: 'S5', act: 'markReceived', leg: 'outbound', happy: true });
  check('93. Happy → received and the purchase closes', happy.success === true && happy.sale && happy.sale.success === true, JSON.stringify(happy));
  check('94. The seller\'s payout is price − ₹10', env.payouts('S5').some(p => p.leg === 'sale' && p.amount === 290));
  const r2 = room(env, 'req@x.com');
  check('95. Step 9 done → straight to rating', r2.exchangeDone && r2.current === 15, String(r2.current));
}

// ── 4. A temporary swap: two books, four legs ──────────────────────────
{
  const env = makeEnv();
  env.addSwap({ id: 'S6', serviceType: 'SWAP', swapPreference: 'temporary', securityDeposit: 200, ownerDeposit: 220 });
  const ro = room(env, 'own@x.com'), rr = room(env, 'req@x.com');
  check('96. In a swap, each reader records their own book\'s condition', types(ro) === 'video:QUALITY@outbound,close' && types(rr) === 'video:QUALITY@counter,close', types(ro) + ' | ' + types(rr));
  check('97. A temporary swap has both books coming back', ro.legs.back.map(l => l.leg).join() === 'return,counter_return');
  env.video('S6', 'outbound', 'QUALITY', 'own@x.com');
  check('98. Payment waits for both condition videos', !room(env, 'req@x.com').actions.some(a => a.type === 'pay'));
  env.video('S6', 'counter', 'QUALITY', 'req@x.com');
  check('99. Then both pay', room(env, 'req@x.com').actions.some(a => a.type === 'pay') && room(env, 'own@x.com').actions.some(a => a.type === 'pay'));
}

// ── 5. A permanent swap and an exchange from before the room ───────────
{
  const env = makeEnv();
  env.addSwap({ id: 'S7', serviceType: 'SWAP', swapPreference: 'permanent', securityDeposit: 200, ownerDeposit: 220 });
  env.approveAll('S7');
  const j = env.ctx.getOrCreateSheet('SwapJourney', vm.runInContext('JOURNEY_HEADERS', env.ctx));
  j.appendRow(['j1', 'S7', 'outbound', 'route_set', 'own@x.com', 'in_person', '', '', 'Meeting at: Cafe', '', '', new Date(T0), '', '']);
  j.appendRow(['j2', 'S7', 'outbound', 'handed_over', 'own@x.com', 'in_person', '', '', '', '', '', new Date(T0), '', '']);
  j.appendRow(['j3', 'S7', 'outbound', 'received', 'req@x.com', '', '', '', '', '', '', new Date(T0), '', '']);
  j.appendRow(['j4', 'S7', 'counter', 'handed_over', 'req@x.com', 'in_person', '', '', '', '', '', new Date(T0), '', '']);
  j.appendRow(['j5', 'S7', 'counter', 'received', 'own@x.com', '', '', '', '', '', '', new Date(T0), '', '']);
  const r = room(env, 'own@x.com');
  check('100. An exchange done before the room (no videos) counts its earlier steps done', [3, 5, 8, 9].every(n => step(r, n).state === 'done') && r.exchangeDone, r.steps.map(s => s.n + s.state[0]).join(' '));
  env.api.runExchangeRoomTicks_(T0 + H);
  check('101. The hourly job records completion and refunds both deposits, minus ₹10 each', env.payouts('S7').map(p => p.leg + ':' + p.amount).sort().join() === 'fee:owner:10,fee:requester:10,refund:owner:210,refund:requester:190', JSON.stringify(env.payouts('S7')));
  env.api.runExchangeRoomTicks_(T0 + 8 * D + H);
  check('102. A room nobody rates closes by itself after 7 days', env.chatStatus('S7') === 'Archived');
}
{
  // Deposits are not refunded while a dispute is open, nor when forfeited.
  const env = makeEnv();
  env.addSwap({ id: 'S8', serviceType: 'SWAP', swapPreference: 'permanent', securityDeposit: 200, ownerDeposit: 220 });
  env.approveAll('S8');
  env.openDisputes.S8 = true;
  const j = env.ctx.getOrCreateSheet('SwapJourney', vm.runInContext('JOURNEY_HEADERS', env.ctx));
  ['outbound', 'counter'].forEach(leg => {
    j.appendRow(['x', 'S8', leg, 'handed_over', 'a', 'in_person', '', '', '', '', '', new Date(T0), '', '']);
    j.appendRow(['y', 'S8', leg, 'received', 'b', '', '', '', '', '', '', new Date(T0), '', '']);
  });
  env.api.runExchangeRoomTicks_(T0 + H);
  check('103. No refund while a dispute is open', env.payouts('S8').filter(p => /^refund/.test(p.leg)).length === 0);
  const rd = room(env, 'req@x.com');
  check('104. The room says the steps are paused', /paused/.test(rd.waitingOn) && rd.actions.every(a => a.type === 'payoutAccount'), rd.waitingOn);
  env.ctx.getOrCreateSheet('ReturnForfeits', vm.runInContext('RETURN_FORFEIT_HEADERS', env.ctx)).appendRow(['F1', 'S8', 'dispute:D1:requester', 'Dune', 'req@x.com', 'own@x.com', 200]);
  delete env.openDisputes.S8;
  env.api.runExchangeRoomTicks_(T0 + 2 * H);
  check('105. After the dispute, only the deposit SwapSutra did not award is refunded', env.payouts('S8').filter(p => /^refund/.test(p.leg)).map(p => p.leg).join() === 'refund:owner', JSON.stringify(env.payouts('S8')));
}

// ── 6. Wiring ─────────────────────────────────────────────────────────
check('106. Both actions are routed', /action === 'getExchangeRoom'/.test(gs) && /action === 'exchangeRoomAction'/.test(gs));
check('107. The hourly job runs the room timers', /summary\.rooms = runExchangeRoomTicks_\(\)/.test(gs));
check('108. Extensions are +7 only', /const RETURN_EXTENSION_CHOICES = \[7\];/.test(gs) && /const RETURN_MAX_EXTENSION_DAYS = 7;/.test(gs));
check('109. The handover video is a required sender video on every route', /sender: \['QUALITY', 'PACKING', 'HANDOVER'\]/.test(gs));
check('110. Accepting a request opens the room with the steps', /message: roomIntroMessage_\(request\)/.test(gs));
check('111. An archived room is never pulled back to Completed', /!== 'Completed' && String\(values\[r\]\[statusIdx\]\) !== 'Archived'/.test(gs));

// ── 7. The app: one room ──────────────────────────────────────────────
{
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const roomUi = fs.readFileSync(path.join(root, 'src/components/ExchangeRoom.tsx'), 'utf8');
  check('112. The chat has no Condition / Stages / Timeline tabs any more', !/setChatTab\(/.test(app) && !/Condition Protection</.test(app) && !/Exchange Stages</.test(app) && !/Swap Timeline</.test(app));
  check('113. The steps panel sits above the chat, for real exchanges', /\{hasRealSwap && roomOpen && \(/.test(app) && /<ExchangeRoom swapId=\{String\(currentChat\.swapId\)\}/.test(app));
  check('114. There is no payment lock on the chat in the app', !/chatLocked/.test(app));
  check('115. The room renders what the server says (getExchangeRoom / exchangeRoomAction)', /action: 'getExchangeRoom'/.test(roomUi) && /action: 'exchangeRoomAction'/.test(roomUi));
  check('116. Every action has a control: videos, pay, close, route, address, courier, marks, +7, answer, rate, payout',
    ['pay', 'close', 'setRoute', 'address', 'courier', 'markDelivered', 'markReceived', 'requestExtension', 'answerExtension', 'rate', 'payoutAccount'].every(t => roomUi.indexOf("case '" + t + "':") !== -1) && /videoActions/.test(roomUi));
  check('117. A buyer ticks "happy" before marking received', /I have the book and I'm happy with it/.test(roomUi));
  check('118. Rating includes SwapSutra and offers the Google review', /How was SwapSutra\?/.test(roomUi) && /GoogleReviewCard/.test(roomUi));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
