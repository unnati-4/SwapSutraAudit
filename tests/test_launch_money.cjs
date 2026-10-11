/**
 * test_launch_money.cjs  (11 Oct 2026, launch check) — money problems an
 * independent review found, each driven through the REAL appsscript.js:
 *  - a late return is never refunded AND forfeited (one deposit, one payout)
 *  - a dispute decision really queues the refund (and the ₹10 swap fee)
 *  - a disputed purchase can be refunded to the buyer or released to the seller
 *  - a rental's deposit is never below the rent
 *  - a rejected payment gets a fresh 48 hours; a closed request takes no payment
 * (Harness copied from test_swap_lend_fee.cjs.)
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
const fees = (env, id) => { const s = env.sheets.SecurityFeePayments; const h = s._data[0]; return s._data.slice(1).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; }).filter(o => o.swapId === id); };
const legs = (env, id) => env.payouts(id).map(p => p.leg + ':' + p.amount).sort().join();
function completeSwap(env, id) {
  const j = J(env);
  [['outbound', 'handed_over'], ['outbound', 'received'], ['counter', 'handed_over'], ['counter', 'received']].forEach(([leg, ev], i) =>
    j.appendRow(['j' + id + i, id, leg, ev, '', 'in_person', '', '', '', '', '', new Date(T0 + i * H), '', '']));
  env.api.runExchangeRoomTicks_(T0 + 10 * H);
}

const P = (env, id) => env.payouts(id).map(p => [p.leg, Number(p.amount), p.payoutStatus]);
function deliverOut(env, id, t) {
  env.video(id, 'outbound', 'QUALITY', 'own@x.com', t);
  env.approveAll(id);
  act(env, 'req@x.com', { swapId: id, act: 'setRoute', phase: 'out', method: 'in_person', meetingLat: 1, meetingLng: 1, meetingPoint: 'Cafe' });
  env.video(id, 'outbound', 'PACKING', 'own@x.com', t + H);
  env.video(id, 'outbound', 'HANDOVER', 'own@x.com', t + H);
  env.now(t + 2 * H);
  act(env, 'own@x.com', { swapId: id, act: 'markDelivered', leg: 'outbound' });
  env.video(id, 'outbound', 'RECEIVING', 'req@x.com', t + 2 * H);
  act(env, 'req@x.com', { swapId: id, act: 'markReceived', leg: 'outbound' });
}
function returnBack(env, id, t) {
  env.now(t);
  act(env, 'req@x.com', { swapId: id, act: 'setRoute', phase: 'back', method: 'in_person', meetingLat: 1, meetingLng: 1, meetingPoint: 'Cafe' });
  env.video(id, 'return', 'PACKING', 'req@x.com', t);
  env.video(id, 'return', 'HANDOVER', 'req@x.com', t);
  act(env, 'req@x.com', { swapId: id, act: 'markDelivered', leg: 'return' });
  env.video(id, 'return', 'RECEIVING', 'own@x.com', t);
  act(env, 'own@x.com', { swapId: id, act: 'markReceived', leg: 'return' });
}

console.log('--- a late return: one deposit, one payout ---');
{
  const env = makeEnv();
  env.addSwap({ id: 'L1', serviceType: 'LEND', securityDeposit: 260, createdAt: new Date(T0 - H) });
  deliverOut(env, 'L1', T0 + H);
  const due = Date.parse(room(env, 'req@x.com', 'L1').returnInfo.dueAt);
  returnBack(env, 'L1', due + 30 * 60e3);   // back 30 minutes late, before the hourly job
  C('A late return is not refunded on the spot', !env.payouts('L1').some(p => p.leg === 'refund:requester'), JSON.stringify(P(env, 'L1')));
  env.now(due + H); env.api.runReturnDeadlines();
  const p = P(env, 'L1');
  C('...the hourly job forfeits it once to the owner — ₹260 out for a ₹260 deposit', p.length === 1 && p[0][0] === 'return' && p[0][1] === 260, JSON.stringify(p));
  env.api.runReturnDeadlines(); env.api.runExchangeRoomTicks_(due + 3 * H);
  C('...and nothing more is ever queued for it', env.payouts('L1').length === 1);
}
{
  const env = makeEnv();
  env.addSwap({ id: 'L2', serviceType: 'LEND', securityDeposit: 260, createdAt: new Date(T0 - H) });
  deliverOut(env, 'L2', T0 + H);
  // A refund already on the books (made before this fix) is never forfeited on top.
  env.ctx.getOrCreateSheet('ReturnForfeits', vm.runInContext('RETURN_FORFEIT_HEADERS', env.ctx))
    .appendRow(['RF1', 'L2', 'refund:requester', 'Dune', '', 'req@x.com', 260]);
  const due = Date.parse(room(env, 'req@x.com', 'L2').returnInfo.dueAt);
  env.now(due + H); env.api.runReturnDeadlines();
  C('A deposit already refunded is not also forfeited (the admin is told instead)', !env.payouts('L2').some(p => p.leg === 'return')
    && env.notifications.some(x => x[1] === 'return_late_settled'));
}

console.log('--- dispute decisions queue the money ---');
{
  const env = makeEnv();
  env.addSwap({ id: 'S1', serviceType: 'SWAP', swapPreference: 'temporary', securityDeposit: 200, ownerDeposit: 220, createdAt: new Date(T0 - H) });
  env.approveAll('S1');
  env.as('swapsutra@gmail.com');
  const r = env.api.adminDecideDeposits({ swapId: 'S1', disputeId: 'D1', decisions: [
    { payerRole: 'requester', outcome: 'REFUND', reason: 'Book was fine' },
    { payerRole: 'owner', outcome: 'FORFEIT', amount: 100, reason: 'Pages torn' }] });
  const p = P(env, 'S1');
  C('Refund decision: the deposit is refunded (₹200 − ₹10 swap fee = ₹190)', r.success && p.some(x => x[0] === 'refund:requester' && x[1] === 190 && x[2] === 'TO_PAY_OWNER'), JSON.stringify(p));
  C('Part forfeit: ₹100 to the other reader and the rest (₹220 − 100 − ₹10 = ₹110) refunded', p.some(x => x[0] === 'dispute:D1:owner' && x[1] === 100) && p.some(x => x[0] === 'refund:owner' && x[1] === 110), JSON.stringify(p));
  C('...the readers are told the real amounts', env.notifications.some(n => /₹190/.test(n[3])) && env.notifications.some(n => /₹110 is refunded/.test(n[3])));
}

console.log('--- a disputed purchase ---');
for (const outcome of ['REFUND_BUYER', 'PAY_SELLER']) {
  const env = makeEnv();
  const id = 'B' + outcome;
  env.addSwap({ id, serviceType: 'SELL', amount: 300, createdAt: new Date(T0 - H) });
  env.approveAll(id);
  env.as('req@x.com');
  C(outcome + ': only the admin decides', env.api.adminDecideSale({ swapId: id, outcome, reason: 'x' }).error === 'UNAUTHORIZED');
  env.as('swapsutra@gmail.com');
  C(outcome + ': a reason is required', env.api.adminDecideSale({ swapId: id, outcome }).success === false);
  const r = env.api.adminDecideSale({ swapId: id, outcome, reason: 'From the videos' });
  const p = P(env, id);
  if (outcome === 'REFUND_BUYER') C('Refund the buyer: ₹310 (price + ₹10) is queued for the buyer', r.success && p.length === 1 && p[0][0] === 'sale_refund' && p[0][1] === 310, JSON.stringify(p));
  else C('Pay the seller: ₹290 (price − ₹10) is queued for the seller', r.success && p.length === 1 && p[0][0] === 'sale' && p[0][1] === 290, JSON.stringify(p));
  C(outcome + ': the purchase is closed and cannot be decided twice', env.api.adminDecideSale({ swapId: id, outcome, reason: 'again' }).success === false);
  C(outcome + ': both readers are told', ['req@x.com', 'own@x.com'].every(e => env.notifications.some(n => n[0] === e && /^sale_/.test(n[1]))));
}
{
  const gsx = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
  C('The admin decision is routed', /action === 'adminDecideSale'/.test(gsx));
  const ui = fs.readFileSync(path.join(root, 'src/components/AdminVmsReview.tsx'), 'utf8');
  C('The dispute panel offers "Refund the buyer" / "Pay the seller" on a purchase', /decideSale\('REFUND_BUYER'\)/.test(ui) && /decideSale\('PAY_SELLER'\)/.test(ui));
}

console.log('--- rent never larger than the deposit ---');
{
  const gsx = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
  C('A rental deposit is raised to the rent when the rent is higher', /if \(serviceType === 'RENT' && rentCharge && deposits\.requesterDeposit !== null && Number\(deposits\.requesterDeposit\) < rentCharge\) \{\s*deposits\.requesterDeposit = Math\.ceil\(rentCharge\);/.test(gsx));
  const env = makeEnv();
  env.addSwap({ id: 'R1', serviceType: 'RENT', securityDeposit: 400, amount: 400, createdAt: new Date(T0 - H) });
  env.approveAll('R1');
  const j = env.ctx.getOrCreateSheet('SwapJourney', vm.runInContext('JOURNEY_HEADERS', env.ctx));
  [['outbound', 'handed_over'], ['outbound', 'received'], ['return', 'route_set'], ['return', 'handed_over'], ['return', 'received']].forEach(([leg, ev], i) =>
    j.appendRow(['jr' + i, 'R1', leg, ev, '', 'in_person', '', '', '', '', '', new Date(T0 + i * H), '', '']));
  env.api.runExchangeRoomTicks_(T0 + 10 * H);
  C('With the deposit at the rent, the owner gets the whole ₹400 rent', env.payouts('R1').some(p => p.leg === 'rent' && Number(p.amount) === 400), JSON.stringify(P(env, 'R1')));
}

console.log('--- payments and closed requests ---');
{
  const env = makeEnv();
  env.addSwap({ id: 'P1', serviceType: 'SELL', amount: 300, createdAt: new Date(T0 - H) });
  env.video('P1', 'outbound', 'QUALITY', 'own@x.com', T0);
  room(env, 'req@x.com', 'P1');
  const s = env.sheets.SecurityFeePayments; const h = s._data[0];
  s._data.forEach((r, i) => { if (i && r[h.indexOf('swapId')] === 'P1') { r[h.indexOf('paymentStatus')] = 'SUBMITTED'; r[h.indexOf('adminStatus')] = 'ADMIN_PENDING'; } });
  env.now(T0 + 60 * H);
  env.as('swapsutra@gmail.com');
  env.api.adminApproveSecurityFeePayment({ swapId: 'P1', payerRole: 'requester', decision: 'REJECT', reason: 'UTR not found' });
  env.api.runExchangeRoomTicks_(T0 + 61 * H);
  C('A payment rejected after 48 hours gets 48 fresh hours (not closed at once)', String(env.swapStatus('P1')).toLowerCase() === 'accepted', env.swapStatus('P1'));
  env.api.runExchangeRoomTicks_(T0 + 109 * H);
  C('...and closes if still unpaid after those 48 hours', String(env.swapStatus('P1')).toLowerCase() === 'expired', env.swapStatus('P1'));
  env.as('req@x.com');
  C('A closed request takes no payment', env.api.submitSecurityFeePayment({ swapId: 'P1', utr: '123456789012', screenshotUrl: 'https://x/s.png' }).error === 'REQUEST_CLOSED');
  s._data.forEach((r, i) => { if (i && r[h.indexOf('swapId')] === 'P1') { r[h.indexOf('paymentStatus')] = 'SUBMITTED'; r[h.indexOf('adminStatus')] = 'ADMIN_PENDING'; } });
  env.as('swapsutra@gmail.com');
  C('...and the admin cannot approve one on it (refund it instead)', env.api.adminApproveSecurityFeePayment({ swapId: 'P1', payerRole: 'requester', decision: 'APPROVE' }).error === 'REQUEST_CLOSED');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
