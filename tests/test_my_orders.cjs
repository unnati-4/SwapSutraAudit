/**
 * test_my_orders.cjs  (9 Oct 2026, owner's request: "after the chat is closed
 * the cart should get empty and there will be a space named My orders with
 * the book details and the price paid")
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
const orders = (env, who) => { env.as(who); return env.api.getMyOrders(); };

// A sale, all the way to the room closing.
{
  const env = makeEnv();
  env.ctx.saveFileToDrive = () => 'https://drive/shot';
  env.addSwap({ id: 'S', serviceType: 'SELL', amount: 420, requestedBookTitle: 'Brida', createdAt: new Date(T0 - H) });
  env.video('S', 'outbound', 'QUALITY', 'own@x.com');
  env.as('req@x.com'); env.api.getExchangeRoom({ swapId: 'S' });
  env.as('req@x.com'); env.api.submitSecurityFeePayment({ swapId: 'S', utr: 'UTR4321', fileData: 'd' });
  env.as('swapsutra@gmail.com'); env.api.adminApproveSecurityFeePayment({ swapId: 'S', payerRole: 'requester', decision: 'APPROVE' });
  C('Open exchange: no orders yet', orders(env, 'req@x.com').orders.length === 0);
  act(env, 'own@x.com', { swapId: 'S', act: 'setRoute', phase: 'out', method: 'in_person', meetingLat: 28.6, meetingLng: 77.2, meetingPoint: 'Cafe' });
  ['PACKING', 'HANDOVER'].forEach(k => env.video('S', 'outbound', k, 'own@x.com'));
  act(env, 'own@x.com', { swapId: 'S', act: 'markDelivered', leg: 'outbound' });
  env.video('S', 'outbound', 'RECEIVING', 'req@x.com');
  act(env, 'req@x.com', { swapId: 'S', act: 'markReceived', leg: 'outbound', happy: true });
  C('Delivered but the room is still open (rating): still in the cart, not an order', orders(env, 'req@x.com').orders.length === 0);
  act(env, 'own@x.com', { swapId: 'S', act: 'rate', readerRating: 5, platformRating: 5 });
  act(env, 'req@x.com', { swapId: 'S', act: 'rate', readerRating: 5, platformRating: 4 });
  C('Both rated → the chat is closed', env.chatStatus('S') === 'Archived');
  const b = orders(env, 'req@x.com');
  C('The buyer now has one order', b.success && b.orders.length === 1, JSON.stringify(b).slice(0, 300));
  const o = b.orders[0];
  C('...with the book and the seller', o.bookTitle === 'Brida' && o.kind === 'Bought' && o.otherName === 'Asha');
  C('...and what was paid: ₹430 = ₹420 book + ₹10 fee', o.paid.total === 430 && o.paid.sale === 420 && o.paid.fee === 10 && o.paid.deposit === 0, JSON.stringify(o.paid));
  C('...and when it was completed', !!o.completedAt);
  const s = orders(env, 'own@x.com').orders[0];
  C('The seller sees it too, as Sold', s && s.kind === 'Sold' && s.otherName === 'Ravi');
  C('Categories: the buyer\'s is under Received, the seller\'s under Sold', o.category === 'received' && s.category === 'sold');
  C('...with the payout (₹410 = price − fee), due', s.payout && s.payout.amount === 410 && s.payout.status === 'due', JSON.stringify(s.payout));
  env.as('zz@x.com');
  C('Someone else has no orders from it', env.api.getMyOrders().orders.length === 0);
}

// A rental with a deposit, closed after the return.
{
  const env = makeEnv();
  env.addSwap({ id: 'R', serviceType: 'RENT', securityDeposit: 260, requestedBookTitle: 'Dune', createdAt: new Date(T0 - H) });
  env.approveAll('R');
  const j = env.ctx.getOrCreateSheet('SwapJourney', vm.runInContext('JOURNEY_HEADERS', env.ctx));
  [['outbound', 'handed_over'], ['outbound', 'received'], ['return', 'route_set'], ['return', 'handed_over'], ['return', 'received']].forEach(([leg, ev], i) =>
    j.appendRow(['j' + i, 'R', leg, ev, '', 'in_person', '', '', '', '', '', new Date(T0 + i * H), '', '']));
  env.api.runExchangeRoomTicks_(T0 + 10 * H);                 // records completion, queues the refund
  env.api.runExchangeRoomTicks_(T0 + 9 * D);                  // nobody rated: closes after 7 days
  const r = orders(env, 'req@x.com').orders[0];
  C('A rental shows as Rented, with ₹270 = ₹260 deposit + ₹10 fee', r && r.kind === 'Rented' && r.paid.total === 270 && r.paid.deposit === 260, JSON.stringify(r));
  C('...and the deposit refund on its way', r.deposit && r.deposit.status === 'refund_due' && r.deposit.amount === 260);
  // SwapSutra pays it.
  const fsh = env.sheets.ReturnForfeits; const fh = fsh._data[0];
  fsh._data.forEach((row, i) => { if (i && row[fh.indexOf('leg')] === 'refund:requester') row[fh.indexOf('payoutStatus')] = 'PAID_TO_OWNER'; });
  C('...and once paid, "refunded"', orders(env, 'req@x.com').orders[0].deposit.status === 'refunded');
  const ow = orders(env, 'own@x.com').orders[0];
  C('The owner sees Rented out, having paid the ₹10 fee', ow.kind === 'Rented out' && ow.paid.total === 10);
  C('Both are in the Rented category', r.category === 'rented' && ow.category === 'rented');
}

// A loan whose book is with the borrower now: "In return process".
{
  const env = makeEnv();
  env.addSwap({ id: 'L', serviceType: 'LEND', securityDeposit: 200, requestedBookTitle: 'Gitanjali', createdAt: new Date(T0 - H) });
  env.approveAll('L');
  const j = env.ctx.getOrCreateSheet('SwapJourney', vm.runInContext('JOURNEY_HEADERS', env.ctx));
  j.appendRow(['a', 'L', 'outbound', 'route_set', 'own@x.com', 'in_person', '', '', 'Meeting at: Cafe', '', '', new Date(T0), '', '']);
  j.appendRow(['b', 'L', 'outbound', 'handed_over', 'own@x.com', 'in_person', '', '', '', '', '', new Date(T0 + H), '', '']);
  const before = orders(env, 'req@x.com').orders;
  C('Before the borrower has it: not listed', before.length === 0);
  j.appendRow(['c', 'L', 'outbound', 'received', 'req@x.com', '', '', '', '', '', '', new Date(T0 + 2 * H), '', '']);
  const b = orders(env, 'req@x.com').orders;
  C('The borrower sees it under In return process', b.length === 1 && b[0].category === 'in_return' && b[0].kind === 'Borrowed', JSON.stringify(b));
  C('...with the due date and the step', !!b[0].inReturn.dueAt && b[0].inReturn.step === 10 && /21 days/.test(b[0].inReturn.stepTitle), JSON.stringify(b[0].inReturn));
  C('...and its chat, which is still open', b[0].chatId === 'CHAT_L');
  C('...and the deposit held until the book is back', b[0].deposit && b[0].deposit.status === 'held' && b[0].deposit.amount === 200);
  C('The owner sees it under In return process too, as Lent', orders(env, 'own@x.com').orders[0].category === 'in_return' && orders(env, 'own@x.com').orders[0].kind === 'Lent');
}

// A request closed before any exchange is not an order.
{
  const env = makeEnv();
  env.addSwap({ id: 'X', serviceType: 'LEND', securityDeposit: 200, createdAt: new Date(T0 - H) });
  act(env, 'req@x.com', { swapId: 'X', act: 'close' });
  C('A closed (cancelled) request is not an order', orders(env, 'req@x.com').orders.length === 0);
}

const ui = fs.readFileSync(path.join(root, 'src/components/CartPage.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
C('Cart tabs: My cart, Chats, Wishlist, My orders (no separate Requests tab)', /id: 'orders', label: 'My orders'/.test(ui) && /id: 'wanted', label: 'Wishlist'/.test(ui) && !/id: 'incoming', label: 'Requests'/.test(ui));
C('Requests for my books are the first section of My orders, with Accept / Decline', /data-testid="orders-requests"/.test(ui) && /onClick=\{\(\) => p\.onAccept\(r\.id\)\}/.test(ui));
C('Old links to the Requests view open My orders → Requests', /props\.view === 'incoming' \? 'requests' : 'all'/.test(ui));
C('My orders is sorted into sections: In return process, Received, Sold, Swapped, Rented, Lent',
  ["'in_return', label: 'In return process'", "'received', label: 'Received'", "'sold', label: 'Sold'", "'swapped', label: 'Swapped'", "'rented', label: 'Rented'", "'lent', label: 'Lent'"].every(x => ui.includes(x)));
C('Profile also says Wishlist', /label: `Wishlist \(/.test(app));
C('A finished (ordered) or closed request leaves the cart and the requests list', /const open = \(r: CartSwap\) => !ordered\.has\(String\(r\.id\)\) && !CLOSED\.includes/.test(ui) && /const CLOSED = \['cancelled', 'expired', 'completed'\]/.test(ui));
C('Orders show the price paid and its parts', /You paid/.test(ui) && /deposit refunded/.test(ui));
C('The app loads orders when the cart opens and after a chat closes', /action: 'getMyOrders'/.test(app) && /\[activeTab, activeUserEmail, activeChat\]/.test(app));
C('getMyOrders is routed', /action === 'getMyOrders'/.test(gs));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
