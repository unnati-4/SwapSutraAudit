/**
 * test_payment_unstick.cjs  (9 Oct 2026, owner's report: "payment approve
 * hone ke baad next step nahi aa raha")
 *
 * After every payment is verified, the room must move to step 5 for every
 * kind of exchange. It got stuck when an exchange's payment rows had been
 * written under an older rule — e.g. a sale from before escrow, where the
 * seller also owed ₹10 and the buyer only the fee: the seller's unpaid row
 * held the gate shut forever, and the buyer was asked for ₹10 instead of
 * the price. Unpaid rows now follow today's rule; paid rows are never
 * rewritten; and a sale whose buyer paid only the fee is not paid out by
 * SwapSutra.
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


const SFH = (env) => vm.runInContext('SECURITY_FEE_HEADERS', env.ctx);
function feeRow(env, o) {
  const sh = env.ctx.getOrCreateSheet('SecurityFeePayments', SFH(env));
  const h = env.ctx.ensureSheetHeaders(sh, SFH(env));
  sh.appendRow(h.map(k => o[k] !== undefined ? o[k] : ''));
}
function payAndApprove(env, id, role) {
  env.as(role === 'owner' ? 'own@x.com' : 'req@x.com');
  const s = env.api.submitSecurityFeePayment({ swapId: id, utr: 'UTR' + role + '9', fileData: 'd' });
  env.as('swapsutra@gmail.com');
  const a = env.api.adminApproveSecurityFeePayment({ swapId: id, payerRole: role, decision: 'APPROVE' });
  return s.success && a.success;
}
let n = 0;
const C = (label, cond, d) => check((++n) + '. ' + label, cond, d);

// Every kind of exchange, clean data: approve → step 5.
for (const [svc, extra] of [['SELL', { amount: 300 }], ['RENT', { securityDeposit: 260 }], ['LEND', { securityDeposit: 260 }],
  ['SWAP', { swapPreference: 'permanent', securityDeposit: 200, ownerDeposit: 220 }], ['SWAP', { swapPreference: 'temporary', securityDeposit: 200, ownerDeposit: 220 }]]) {
  const env = makeEnv();
  env.ctx.saveFileToDrive = () => 'https://drive/shot';
  env.addSwap(Object.assign({ id: 'X', serviceType: svc, createdAt: new Date(T0 - H) }, extra));
  env.video('X', 'outbound', 'QUALITY', 'own@x.com');
  if (svc === 'SWAP') env.video('X', 'counter', 'QUALITY', 'req@x.com');
  const payers = room(env, 'req@x.com').payment.payers;
  const ok = payers.every(p => payAndApprove(env, 'X', p.payerRole));
  const ro = room(env, 'own@x.com'), rr = room(env, 'req@x.com');
  const label = svc + (extra.swapPreference ? ' (' + extra.swapPreference + ')' : '');
  C(label + ': after every payment is approved the room moves to step 5', ok && ro.payment.allApproved && ro.current === 5, 'current ' + ro.current);
  C(label + ': both readers see their next step (packaging video / route)', ro.actions.some(a => a.kind === 'PACKING') && rr.actions.some(a => a.type === 'setRoute'));
}

// A sale whose rows were written before escrow, nothing paid yet.
{
  const env = makeEnv();
  env.ctx.saveFileToDrive = () => 'https://drive/shot';
  env.addSwap({ id: 'Y', serviceType: 'SELL', amount: 300, createdAt: new Date(T0 - H) });
  feeRow(env, { id: 'F1', swapId: 'Y', payerRole: 'requester', payerEmail: 'req@x.com', requiredAmount: 10, depositAmount: 0, platformFee: 10, paymentStatus: 'PENDING', adminStatus: 'NOT_SUBMITTED' });
  feeRow(env, { id: 'F2', swapId: 'Y', payerRole: 'owner', payerEmail: 'own@x.com', requiredAmount: 10, depositAmount: 0, platformFee: 10, paymentStatus: 'PENDING', adminStatus: 'NOT_SUBMITTED' });
  env.video('Y', 'outbound', 'QUALITY', 'own@x.com');
  const r = room(env, 'req@x.com');
  C('Old sale rows: the seller\'s unpaid ₹10 row is no longer owed', r.payment.payers.length === 1 && r.payment.payers[0].payerRole === 'requester');
  C('Old sale rows: the buyer is asked for price + fee (₹310), not ₹10', r.payment.payers[0].requiredAmount === 310 && r.payment.payers[0].saleAmount === 300);
  C('...and the seller is not asked to pay', !room(env, 'own@x.com').actions.some(a => a.type === 'pay'));
  payAndApprove(env, 'Y', 'requester');
  C('Old sale rows: after the buyer is approved, the room moves on (was stuck at step 4)', room(env, 'own@x.com').current === 5);
  C('The stale row is kept in the sheet, marked NOT_REQUIRED (nothing deleted)', env.sheets.SecurityFeePayments._data.some(rw => rw[0] === 'F2' && rw.indexOf('NOT_REQUIRED') !== -1));
}

// A sale whose buyer already paid only the ₹10 fee (verified) under the old rule.
{
  const env = makeEnv();
  env.ctx.saveFileToDrive = () => 'https://drive/shot';
  env.addSwap({ id: 'Z', serviceType: 'SELL', amount: 300, createdAt: new Date(T0 - H) });
  feeRow(env, { id: 'G1', swapId: 'Z', payerRole: 'requester', payerEmail: 'req@x.com', requiredAmount: 10, depositAmount: 0, platformFee: 10, paymentStatus: 'SUBMITTED', adminStatus: 'ADMIN_APPROVED', utr: 'OLD1' });
  feeRow(env, { id: 'G2', swapId: 'Z', payerRole: 'owner', payerEmail: 'own@x.com', requiredAmount: 10, depositAmount: 0, platformFee: 10, paymentStatus: 'PENDING', adminStatus: 'NOT_SUBMITTED' });
  env.video('Z', 'outbound', 'QUALITY', 'own@x.com');
  const r = room(env, 'own@x.com');
  C('A verified payment is never rewritten', r.payment.payers[0].requiredAmount === 10 && r.payment.payers[0].adminStatus === 'ADMIN_APPROVED');
  C('...and the exchange moves on (step 5)', r.payment.allApproved && r.current === 5, 'current ' + r.current);
  C('Price paid between readers: SwapSutra holds nothing, so no seller payout / UPI ask', r.sale && r.sale.escrow === false && !r.actions.some(a => a.type === 'payoutAccount'));
  act(env, 'own@x.com', { swapId: 'Z', act: 'setRoute', phase: 'out', method: 'in_person', meetingLat: 28.6, meetingLng: 77.2, meetingPoint: 'Cafe' });
  ['PACKING', 'HANDOVER'].forEach(k => env.video('Z', 'outbound', k, 'own@x.com'));
  act(env, 'own@x.com', { swapId: 'Z', act: 'markDelivered', leg: 'outbound' });
  env.video('Z', 'outbound', 'RECEIVING', 'req@x.com');
  const mr = act(env, 'req@x.com', { swapId: 'Z', act: 'markReceived', leg: 'outbound' });
  C('...the buyer can mark it received without the escrow "happy" step', mr.success === true, JSON.stringify(mr));
  C('...and no seller payout is created from money SwapSutra never got', env.payouts('Z').filter(p => p.leg === 'sale').length === 0);
}

// A rental whose unpaid rows carry an old amount (60% deposit, no fee).
{
  const env = makeEnv();
  env.addSwap({ id: 'R', serviceType: 'RENT', securityDeposit: 260, createdAt: new Date(T0 - H) });
  feeRow(env, { id: 'H1', swapId: 'R', payerRole: 'requester', payerEmail: 'req@x.com', requiredAmount: 240, depositAmount: 240, platformFee: 0, paymentStatus: 'PENDING', adminStatus: 'NOT_SUBMITTED' });
  const p = room(env, 'req@x.com').payment.payers;
  C('An unpaid row with an outdated amount is brought up to today\'s (₹260 + ₹10)', p.find(x => x.payerRole === 'requester').requiredAmount === 270);
  C('...and the missing owner fee row is added', p.some(x => x.payerRole === 'owner' && x.requiredAmount === 10));
}
{
  const env = makeEnv();
  env.addSwap({ id: 'Q', serviceType: 'RENT', securityDeposit: 260, createdAt: new Date(T0 - H) });
  feeRow(env, { id: 'J1', swapId: 'Q', payerRole: 'requester', payerEmail: 'req@x.com', requiredAmount: 240, depositAmount: 240, platformFee: 0, paymentStatus: 'SUBMITTED', adminStatus: 'ADMIN_PENDING', utr: 'U1' });
  const p = room(env, 'req@x.com').payment.payers;
  C('A payment waiting for SwapSutra\'s check keeps the amount that was paid', p.find(x => x.payerRole === 'requester').requiredAmount === 240);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
