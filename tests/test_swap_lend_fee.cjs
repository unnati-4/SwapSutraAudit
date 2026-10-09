/**
 * test_swap_lend_fee.cjs  (9 Oct 2026, owner's rule: "swap me security me se
 * 10 rupee cut hokar refund hoga, lend me bas buyer 10 rupee dega platform fee")
 *
 * Swap: readers pay only their deposit; SwapSutra's ₹10 is kept from each
 * deposit when it is refunded (or forfeited). Lend: only the borrower pays the
 * ₹10 fee — the lending owner pays nothing.
 *
 * (Harness copied from test_rent_split.cjs / test_exchange_room.cjs.)
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

console.log('--- swap: the fee comes out of the deposit ---');
{
  const env = makeEnv();
  env.addSwap({ id: 'S1', serviceType: 'SWAP', swapPreference: 'permanent', securityDeposit: 200, ownerDeposit: 220, createdAt: new Date(T0 - H) });
  room(env, 'req@x.com', 'S1');
  const f = fees(env, 'S1');
  const req = f.find(x => x.payerRole === 'requester'), own = f.find(x => x.payerRole === 'owner');
  C('Swap: the requester pays only the ₹200 deposit', req && Number(req.requiredAmount) === 200 && Number(req.platformFee) === 0, JSON.stringify(req));
  C('Swap: the owner pays only the ₹220 deposit', own && Number(own.requiredAmount) === 220 && Number(own.platformFee) === 0, JSON.stringify(own));
  C('The room tells each reader ₹10 will come out of their deposit', room(env, 'req@x.com', 'S1').feeFromDeposit === 10 && room(env, 'own@x.com', 'S1').feeFromDeposit === 10);
  env.approveAll('S1');
  completeSwap(env, 'S1');
  C('Done: each deposit is refunded minus ₹10, and the ₹10s are kept as fees', legs(env, 'S1') === 'fee:owner:10,fee:requester:10,refund:owner:210,refund:requester:190', legs(env, 'S1'));
  const kept = env.payouts('S1').filter(p => /^fee:/.test(p.leg));
  C('...kept fees are marked KEPT_AS_FEE (nothing to pay out)', kept.every(p => p.payoutStatus === 'KEPT_AS_FEE' && p.ownerEmail === 'swapsutra@gmail.com'));
  C('...the refund note shows the working', /₹200 deposit − ₹10 platform fee/.test(env.payouts('S1').find(p => p.leg === 'refund:requester').note));
  env.api.runExchangeRoomTicks_(T0 + 11 * H);
  C('Run again: nothing is kept or refunded twice', env.payouts('S1').length === 4);
  env.as('swapsutra@gmail.com');
  const rev = env.api.adminPlatformRevenueSummary();
  C('Revenue counts the two ₹10s kept from deposits', rev.exchangeFees === 20 && rev.exchangePayments === 2, JSON.stringify(rev));
  env.api.runExchangeRoomTicks_(T0 + 9 * D);
  const o = (env.as('req@x.com'), env.api.getMyOrders()).orders[0];
  C('My orders: ₹10 fee from the ₹200 deposit, ₹190 coming back', o && o.deposit && o.deposit.fee === 10 && o.deposit.of === 200 && o.deposit.amount === 190, JSON.stringify(o && o.deposit));
}
{
  const env = makeEnv();
  env.addSwap({ id: 'S2', serviceType: 'SWAP', swapPreference: 'permanent', createdAt: new Date(T0 - H) });
  room(env, 'req@x.com', 'S2');
  const f = fees(env, 'S2');
  C('A swap with no deposit: each still pays ₹10 up front', f.length === 2 && f.every(x => Number(x.requiredAmount) === 10 && Number(x.platformFee) === 10), JSON.stringify(f.map(x => x.requiredAmount)));
  env.approveAll('S2');
  completeSwap(env, 'S2');
  C('...and nothing is kept or refunded at the end', env.payouts('S2').length === 0, legs(env, 'S2'));
}
{
  const env = makeEnv();
  env.addSwap({ id: 'S3', serviceType: 'SWAP', swapPreference: 'permanent', securityDeposit: 200, ownerDeposit: 220, createdAt: new Date('2026-10-08T10:00:00+05:30') });
  room(env, 'req@x.com', 'S3');
  const req = fees(env, 'S3').find(x => x.payerRole === 'requester');
  C('A swap made before the change keeps the old rule (deposit + ₹10 up front)', Number(req.requiredAmount) === 210 && Number(req.platformFee) === 10, JSON.stringify(req));
  env.approveAll('S3');
  completeSwap(env, 'S3');
  C('...and gets the whole deposit back', legs(env, 'S3') === 'refund:owner:220,refund:requester:200', legs(env, 'S3'));
}
{
  const env = makeEnv();
  env.addSwap({ id: 'S4', serviceType: 'SWAP', swapPreference: 'permanent', securityDeposit: 200, ownerDeposit: 220, createdAt: new Date(T0 - H) });
  env.video('S4', 'outbound', 'QUALITY', 'own@x.com');
  env.video('S4', 'counter', 'QUALITY', 'req@x.com');
  room(env, 'req@x.com', 'S4');
  env.setFee('S4', 'requester', 'ADMIN_APPROVED');
  const c = act(env, 'own@x.com', { swapId: 'S4', act: 'close', reason: 'Changed my mind' });
  C('A swap closed before the exchange: the paid deposit comes back in full, nothing kept', c.success === true && legs(env, 'S4') === 'refund:requester:200', legs(env, 'S4'));
}
{
  const env = makeEnv();
  env.addSwap({ id: 'S5', serviceType: 'SWAP', swapPreference: 'permanent', securityDeposit: 200, ownerEmail: 'swapsutra@gmail.com', createdAt: new Date(T0 - H) });
  C('The admin account never has a fee taken', env.api.feeTakenFromDeposit_({ serviceType: 'SWAP', createdAt: new Date(T0) }, 'swapsutra@gmail.com') === 0
    && env.api.feeTakenFromDeposit_({ serviceType: 'SWAP', createdAt: new Date(T0) }, 'req@x.com') === 10);
  C('Rent, lend and sale never have the fee taken from a deposit', ['RENT', 'LEND', 'SELL'].every(t => env.api.feeTakenFromDeposit_({ serviceType: t, createdAt: new Date(T0) }, 'req@x.com') === 0));
}

{
  // Paid under the old rule (deposit + ₹10 up front) after the cut-off, e.g.
  // before the new script was deployed: the ₹10 is never taken twice.
  const env = makeEnv();
  env.addSwap({ id: 'S7', serviceType: 'SWAP', swapPreference: 'permanent', securityDeposit: 200, ownerDeposit: 220, createdAt: new Date(T0 - H) });
  room(env, 'req@x.com', 'S7');
  const s = env.sheets.SecurityFeePayments; const h = s._data[0];
  s._data.forEach((r, i) => { if (i && r[h.indexOf('swapId')] === 'S7' && r[h.indexOf('payerRole')] === 'requester') { r[h.indexOf('requiredAmount')] = 210; r[h.indexOf('platformFee')] = 10; r[h.indexOf('adminStatus')] = 'ADMIN_APPROVED'; } });
  C('The room shows no fee to take from a reader who already paid it', room(env, 'req@x.com', 'S7').feeFromDeposit === 0 && room(env, 'own@x.com', 'S7').feeFromDeposit === 10);
  env.approveAll('S7');
  completeSwap(env, 'S7');
  C('...and refunds that reader the whole deposit (no double fee)', legs(env, 'S7') === 'fee:owner:10,refund:owner:210,refund:requester:200', legs(env, 'S7'));
}

console.log('--- swap: a late return ---');
{
  const env = makeEnv();
  env.addSwap({ id: 'S6', serviceType: 'SWAP', swapPreference: 'temporary', securityDeposit: 200, ownerDeposit: 220, createdAt: new Date(T0 - H) });
  env.approveAll('S6');
  const j = J(env);
  j.appendRow(['jf1', 'S6', 'outbound', 'received', '', '', '', '', '', '', '', new Date(T0), '', '']);
  j.appendRow(['jf2', 'S6', 'counter', 'received', '', '', '', '', '', '', '', new Date(T0), '', '']);
  env.now(T0 + 25 * D);
  env.api.runReturnDeadlines();
  const p = env.payouts('S6');
  C('A forfeited swap deposit: ₹10 is kept, the rest goes to the other reader', legs(env, 'S6') === 'counter_return:210,fee:owner:10,fee:requester:10,return:190', legs(env, 'S6'));
  C('...the borrower is told the split', env.notifications.some(x => x[0] === 'req@x.com' && x[1] === 'return_forfeited' && /₹190 to the owner, ₹10 platform fee/.test(x[3])), JSON.stringify(env.notifications.filter(x => x[1] === 'return_forfeited')));
  env.api.runReturnDeadlines();
  C('Run again: never forfeited or kept twice', env.payouts('S6').length === p.length);
}

console.log('--- lend: only the borrower pays ---');
{
  const env = makeEnv();
  env.addSwap({ id: 'L1', serviceType: 'LEND', securityDeposit: 300, createdAt: new Date(T0 - H) });
  room(env, 'req@x.com', 'L1');
  const f = fees(env, 'L1');
  C('Lend: the borrower pays the deposit + ₹10', f.length === 1 && f[0].payerRole === 'requester' && Number(f[0].requiredAmount) === 310 && Number(f[0].platformFee) === 10, JSON.stringify(f));
  C('Lend: the lending owner has nothing to pay', !room(env, 'own@x.com', 'L1').actions.some(a => a.type === 'pay'));
  env.approveAll('L1');
  const j = J(env);
  [['outbound', 'handed_over'], ['outbound', 'received'], ['return', 'route_set'], ['return', 'handed_over'], ['return', 'received']].forEach(([leg, ev], i) =>
    j.appendRow(['jl' + i, 'L1', leg, ev, '', 'in_person', '', '', '', '', '', new Date(T0 + i * H), '', '']));
  env.api.runExchangeRoomTicks_(T0 + 10 * H);
  C('Lend done: the whole deposit is refunded (the fee was paid up front)', legs(env, 'L1') === 'refund:requester:300', legs(env, 'L1'));
}
{
  const env = makeEnv();
  env.addSwap({ id: 'L2', serviceType: 'LEND', securityDeposit: 300, createdAt: new Date(T0 - H) });
  // An owner fee row left over from before the change, never paid.
  const s = env.ctx.getOrCreateSheet('SecurityFeePayments', vm.runInContext('SECURITY_FEE_HEADERS', env.ctx));
  const h = env.ctx.ensureSheetHeaders(s, vm.runInContext('SECURITY_FEE_HEADERS', env.ctx));
  const old = { id: 'OLD1', swapId: 'L2', payerRole: 'owner', payerEmail: 'own@x.com', requiredAmount: 10, platformFee: 10, depositAmount: 0, paymentStatus: 'PENDING', adminStatus: 'NOT_SUBMITTED' };
  s.appendRow(h.map(k => old[k] !== undefined ? old[k] : ''));
  room(env, 'req@x.com', 'L2');
  const ownRow = fees(env, 'L2').find(x => x.payerRole === 'owner');
  C('An unpaid owner fee from before the change is no longer asked for', ownRow && ownRow.adminStatus === 'NOT_REQUIRED', JSON.stringify(ownRow));
  C('...and the owner sees nothing to pay', !room(env, 'own@x.com', 'L2').actions.some(a => a.type === 'pay'));
}
{
  const env = makeEnv();
  env.addSwap({ id: 'L3', serviceType: 'LEND', securityDeposit: 300, createdAt: new Date(T0 - H) });
  const s = env.ctx.getOrCreateSheet('SecurityFeePayments', vm.runInContext('SECURITY_FEE_HEADERS', env.ctx));
  const h = env.ctx.ensureSheetHeaders(s, vm.runInContext('SECURITY_FEE_HEADERS', env.ctx));
  const paid = { id: 'OLD2', swapId: 'L3', payerRole: 'owner', payerEmail: 'own@x.com', requiredAmount: 10, platformFee: 10, depositAmount: 0, paymentStatus: 'SUBMITTED', adminStatus: 'ADMIN_APPROVED' };
  s.appendRow(h.map(k => paid[k] !== undefined ? paid[k] : ''));
  room(env, 'req@x.com', 'L3');
  C('An owner fee already paid before the change is left as it is (kept on record)', fees(env, 'L3').find(x => x.payerRole === 'owner').adminStatus === 'ADMIN_APPROVED');
}

console.log('--- the words on the site ---');
{
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const legal = fs.readFileSync(path.join(root, 'src/components/LegalPages.tsx'), 'utf8');
  const terms = fs.readFileSync(path.join(root, 'legal/terms-of-use.md'), 'utf8');
  const policy = fs.readFileSync(path.join(root, 'legal/refund-and-security-deposit-policy.md'), 'utf8');
  C('The site no longer says each reader pays ₹10 on every exchange', !/each reader pays a ₹10 platform fee|you each pay a ₹10 platform fee —|each reader pays SwapSutra ₹10/.test(app + legal));
  C('Terms explain the swap and lend rules', /Swap\*\* — nothing extra is paid up front/.test(terms) && /only the \*\*borrower\*\* pays/.test(terms));
  C('The refund policy explains them too', /₹10 is kept from each deposit and the rest is refunded/.test(policy) && /only the borrower pays ₹10/.test(policy));
  C('The legal page in the app matches', /kept from each reader’s security deposit|kept from each reader's security deposit/.test(legal) && /only the borrower pays ₹10/.test(legal));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
