/**
 * test_rent_split.cjs  (9 Oct 2026, owner's rule: "rent me refund me se rent
 * wali fee book owner ko jayegi, baaki bacha amount renter ko")
 *
 * When a rental is complete, the rent comes out of the renter's security
 * deposit and is paid to the book's owner; the rest is refunded to the
 * renter. A late (forfeited) deposit or a dispute decision overrides this.
 *
 * (Harness copied from test_exchange_room.cjs.)
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

const SWAP_HEADERS = ['id', 'serviceType', 'status', 'requestedBookTitle', 'securityDeposit', 'ownerDeposit', 'amount', 'swapPreference', 'createdAt', 'updatedAt', 'requesterEmail', 'ownerEmail'];
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
      const full = Object.assign({ requesterEmail: 'req@x.com', ownerEmail: 'own@x.com', status: 'Accepted', requestedBookTitle: 'Dune', securityDeposit: 0, ownerDeposit: 0, amount: 0, swapPreference: '', createdAt: new Date(T0 - D), updatedAt: new Date(T0) }, o);
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
const J = (env) => env.ctx.getOrCreateSheet('SwapJourney', vm.runInContext('JOURNEY_HEADERS', env.ctx));
function completeRental(env, id) {
  const j = J(env);
  [['outbound', 'handed_over'], ['outbound', 'received'], ['return', 'route_set'], ['return', 'handed_over'], ['return', 'received']].forEach(([leg, ev], i) =>
    j.appendRow(['j' + id + i, id, leg, ev, '', 'in_person', '', '', '', '', '', new Date(T0 + i * H), '', '']));
  env.api.runExchangeRoomTicks_(T0 + 10 * H);
}
{
  const env = makeEnv();
  env.addSwap({ id: 'R', serviceType: 'RENT', securityDeposit: 260, amount: 52, requestedBookTitle: 'Dune', createdAt: new Date(T0 - H) });
  env.video('R', 'outbound', 'QUALITY', 'own@x.com');
  env.as('req@x.com'); env.api.getExchangeRoom({ swapId: 'R' });
  C('The room tells the renter the rent (₹52) before paying', room(env, 'req@x.com').rentCharge === 52);
  env.approveAll('R');
  completeRental(env, 'R');
  const p = env.payouts('R');
  const rent = p.find(x => x.leg === 'rent'), refund = p.find(x => x.leg === 'refund:requester');
  C('Rent of ₹52 is paid to the owner', rent && rent.amount === 52 && rent.ownerEmail === 'own@x.com' && rent.payoutStatus === 'TO_PAY_OWNER', JSON.stringify(rent));
  C('The renter gets back ₹208 (₹260 − ₹52)', refund && refund.amount === 208 && refund.ownerEmail === 'req@x.com', JSON.stringify(refund));
  C('...with the working shown', /₹260 deposit − ₹52 rent/.test(refund.note));
  C('The owner is told, and asked for a UPI ID if missing', env.notifications.some(x => x[0] === 'own@x.com' && x[1] === 'room_rent_due') && room(env, 'own@x.com').actions.some(a => a.type === 'payoutAccount'));
  C('The chat says where the money goes', env.chats.some(c => /rent, ₹52, comes out of the deposit and goes to the owner/.test(c.message)));
  env.api.runExchangeRoomTicks_(T0 + 11 * H);
  C('Run again: nothing is paid twice', env.payouts('R').filter(x => x.leg === 'rent' || x.leg === 'refund:requester').length === 2);
  env.api.runExchangeRoomTicks_(T0 + 9 * D);
  const o = (env.as('req@x.com'), env.api.getMyOrders()).orders[0];
  C('My orders (renter): ₹52 rent from the ₹260 deposit, ₹208 coming back', o.deposit.rent === 52 && o.deposit.of === 260 && o.deposit.amount === 208 && o.deposit.status === 'refund_due', JSON.stringify(o.deposit));
  const ow = (env.as('own@x.com'), env.api.getMyOrders()).orders[0];
  C('My orders (owner): ₹52 rent on its way', ow.payout && ow.payout.kind === 'rent' && ow.payout.amount === 52 && ow.payout.status === 'due');
}
{
  const env = makeEnv();
  env.addSwap({ id: 'H', serviceType: 'RENT', securityDeposit: 100, amount: 150, createdAt: new Date(T0 - H) });
  env.approveAll('H');
  completeRental(env, 'H');
  const p = env.payouts('H');
  C('Rent above the deposit: the owner gets the whole deposit, no refund row', p.find(x => x.leg === 'rent').amount === 100 && !p.some(x => x.leg === 'refund:requester'));
}
{
  const env = makeEnv();
  env.addSwap({ id: 'F', serviceType: 'RENT', securityDeposit: 260, amount: 52, createdAt: new Date(T0 - H) });
  env.approveAll('F');
  env.ctx.getOrCreateSheet('ReturnForfeits', vm.runInContext('RETURN_FORFEIT_HEADERS', env.ctx)).appendRow(['X1', 'F', 'return', 'Dune', 'req@x.com', 'own@x.com', 260]);
  completeRental(env, 'F');
  C('A late return (deposit forfeited to the owner): no separate rent, no refund', env.payouts('F').length === 1);
}
{
  const env = makeEnv();
  env.addSwap({ id: 'L', serviceType: 'LEND', securityDeposit: 200, amount: 0, createdAt: new Date(T0 - H) });
  env.approveAll('L');
  completeRental(env, 'L');
  const p = env.payouts('L');
  C('A loan has no rent: the whole deposit is refunded', p.length === 1 && p[0].leg === 'refund:requester' && p[0].amount === 200);
}
const ui = fs.readFileSync(path.join(root, 'src/components/ExchangeRoom.tsx'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'src/components/AdminReturnForfeits.tsx'), 'utf8');
C('The pay step explains the rent comes out of the deposit', /the rent \(₹\$\{Math\.min\(room\.rentCharge/.test(ui));
C('Admin payouts label rent', /'Rent payout · '/.test(admin));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
