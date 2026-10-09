/**
 * test_courier_address.cjs  (9 Oct 2026, owner's report: the receiver saved
 * their address and the chat said it shows at the top, but the sender's
 * courier step still said "not added yet")
 *
 * The address used to be fetched once, when the courier route was chosen —
 * before the receiver had saved it — and never again. It now comes with the
 * room (refreshed every 20 s), to both readers, only on a courier route
 * after payment.
 *
 * (Harness copied from test_exchange_room.cjs.)
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


let n = 0;
const C = (label, cond, d) => check((++n) + '. ' + label, cond, d);
{
  const env = makeEnv();
  env.addSwap({ id: 'S', serviceType: 'SELL', amount: 300, createdAt: new Date(T0 - H) });
  env.video('S', 'outbound', 'QUALITY', 'own@x.com');
  C('Before payment: no addresses at all', room(env, 'own@x.com').delivery === null);
  env.approveAll('S');
  act(env, 'own@x.com', { swapId: 'S', act: 'setRoute', phase: 'out', method: 'courier' });
  const s1 = room(env, 'own@x.com');
  C('Courier chosen: the seller sees the delivery card, buyer\'s address not added yet', s1.delivery && s1.delivery.theirAddress === null);
  const b1 = room(env, 'req@x.com');
  C('The buyer is asked for their address', b1.actions.some(a => a.type === 'address'));
  env.as('req@x.com');
  const saved = env.api.saveDeliveryAddress({ line1: '12 MG Road', area: 'Hazratganj', city: 'Lucknow', state: 'UP', pincode: '226001', phone: '9876543210' });
  C('The buyer saves it', saved.success === true, JSON.stringify(saved));
  const s2 = room(env, 'own@x.com');
  C('The seller\'s next refresh shows the buyer\'s address (was stuck on "not added yet")', s2.delivery.theirAddress && s2.delivery.theirAddress.line1 === '12 MG Road' && s2.delivery.theirAddress.city === 'Lucknow');
  C('...with the phone number for the courier', s2.delivery.theirAddress.phone === '9876543210');
  C('The address card does not leak the email', !('email' in s2.delivery.theirAddress));
  const b2 = room(env, 'req@x.com');
  C('The buyer sees their own saved address, and is no longer asked for it', b2.delivery.myAddress.line1 === '12 MG Road' && !b2.actions.some(a => a.type === 'address'));
  env.as('zz@x.com');
  C('A stranger gets nothing', env.api.getExchangeRoom({ swapId: 'S' }).error === 'UNAUTHORIZED');
}
{
  const env = makeEnv();
  env.addSwap({ id: 'P', serviceType: 'RENT', securityDeposit: 260, createdAt: new Date(T0 - H) });
  env.address('req@x.com');
  env.video('P', 'outbound', 'QUALITY', 'own@x.com');
  env.approveAll('P');
  act(env, 'own@x.com', { swapId: 'P', act: 'setRoute', phase: 'out', method: 'in_person', meetingLat: 28.6, meetingLng: 77.2, meetingPoint: 'Cafe' });
  C('Meeting in person: no addresses are shared', room(env, 'own@x.com').delivery === null);
}
const ui = fs.readFileSync(path.join(root, 'src/components/ExchangeRoom.tsx'), 'utf8');
C('The room shows a Delivery details card from the room data', /data-testid="delivery-details"/.test(ui) && /room\?\.delivery\?\.theirAddress/.test(ui));
C('No one-time address fetch left behind', !/action=getDeliveryAddress/.test(ui));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
