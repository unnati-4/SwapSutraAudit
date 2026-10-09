/**
 * test_partners.cjs  (9 Oct 2026, owner's rules for bookstores, authors,
 * publishers and promoters, and the admin's payment details)
 *
 *  - separate registration with documents (private), a signed contract,
 *    admin approval (standard 2% or commission-free first year)
 *  - unlimited listings with stock; no ₹10 fee for the partner (a buyer
 *    always pays it); 2% commission on payouts; payouts paid monthly
 *  - promotion (banner + ads): 6 months free, then ₹100 per 2 months,
 *    verified by the admin; banners and partner ads approved by the admin
 *  - the partner never sees who the buyer is
 *  - the admin can change SwapSutra's UPI ID / QR / bank details
 *
 * (Harness copied from test_rent_split.cjs.)
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
      getRange(r, c) { return {
        setValue: (v) => { while (data[r - 1].length < c) data[r - 1].push(''); data[r - 1][c - 1] = v; }, getValue: () => data[r - 1][c - 1],
        setValues: (rows) => rows.forEach((row, i) => row.forEach((v, j) => { const rr = data[r - 1 + i]; while (rr.length < c + j) rr.push(''); rr[c - 1 + j] = v; })),
        getValues: () => [data[r - 1].slice()] }; },
      deleteRow(r) { data.splice(r - 1, 1); },
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
const ADMIN = 'swapsutra@gmail.com';
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64');
const getv = (env, name) => vm.runInContext(name, env.ctx);

function partnerEnv() {
  const env = makeEnv();
  const props = {};
  env.props = props;
  env.ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) };
  env.files = [];
  env.shared = [];
  const folder = (name) => ({
    name,
    getFoldersByName: (sub) => ({ hasNext: () => false }),
    createFolder: (sub) => folder(name + '/' + sub),
    createFile: (blob) => { const id = 'F' + env.files.length; env.files.push({ folder: name, blob }); return { getId: () => id, setSharing: () => env.shared.push(id) }; }
  });
  env.ctx.getOrCreateFolder = (name) => folder(name);
  env.ctx.DriveApp = { Access: { ANYONE_WITH_LINK: 'A' }, Permission: { VIEW: 'V' } };
  env.ctx.Utilities.base64Decode = (s) => Buffer.from(s, 'base64');
  env.ctx.Utilities.newBlob = (bytes, type, name) => ({ bytes, type, name });
  env.ctx.invalidateLibraryCache = () => {};
  env.ctx.emailExistsInUsersSheet = (e) => !!(env.sheets.Users && env.sheets.Users._data.some(r => r.includes(e)));
  env.ctx.sendSwapSutraEmail = (m) => { env.emails.push(m); return true; };
  vm.runInContext('resetPartnerCache_()', env.ctx);
  return env;
}
const app = (o) => Object.assign({
  type: 'bookstore', name: 'Bookworms', contactName: 'Asha Owner', phone: '9876543210', about: 'Old and new books',
  address: '12 MG Road, Hazratganj', city: 'Lucknow', pincode: '226001', lat: 26.85, lng: 80.94, placeLabel: 'Bookworms, Hazratganj',
  registeredName: 'Asha Owner', panNumber: 'ABCDE1234F', aadhaarLast4: '1234', showBanner: true, runAds: true,
  typeFields: { storeType: 'New + second-hand', openingHours: '10–8' },
  docs: { aadhaar: PNG, pan: PNG, businessProof: PDF },
  agree: true, signedName: 'Asha Owner', contractVersion: 'bookstore-2026-10-09'
}, o || {});
const P = (env) => env.sheets.Partners;
const pobj = (env) => { const s = P(env); const h = s._data[0]; const o = {}; h.forEach((k, i) => { o[k] = s._data[1][i]; }); return o; };
function approve(env, decision) {
  env.as('own@x.com');
  const r = env.api.submitPartnerApplication(app());
  env.as(ADMIN);
  env.api.adminReviewPartner({ id: r.id, decision: decision || 'approve' });
  env.ctx.resetPartnerCache_();
  return r.id;
}

console.log('--- registration ---');
{
  const env = partnerEnv();
  env.as('');
  C('Applying needs a verified email (session)', env.api.submitPartnerApplication(app()).error === 'SESSION_REQUIRED');
  env.as('own@x.com');
  const bad = env.api.submitPartnerApplication(app({ panNumber: 'XX', phone: '123', aadhaarLast4: '12', docs: { aadhaar: PNG }, signedName: 'Someone Else', lat: '', lng: '' }));
  C('Wrong PAN, phone, Aadhaar digits, missing documents, missing location and a wrong signature are all caught',
    ['panNumber', 'phone', 'aadhaarLast4', 'doc_pan', 'doc_businessProof', 'location', 'signedName'].every(k => bad.errors && bad.errors[k]), JSON.stringify(bad.errors));
  C('An old contract version is refused (they must read the current one)', env.api.submitPartnerApplication(app({ contractVersion: 'bookstore-2020' })).errors.contract);
  C('Not accepting the agreement is refused', env.api.submitPartnerApplication(app({ agree: false })).errors.agree);
  C('A document must be an image or a PDF', env.api.submitPartnerApplication(app({ docs: { aadhaar: 'data:text/html;base64,PGI+', pan: PNG, businessProof: PNG } })).errors.doc_aadhaar);
  const ok = env.api.submitPartnerApplication(app());
  C('A complete bookstore application is received', ok.success && /^SS_PARTNER_/.test(ok.id), JSON.stringify(ok));
  const p = pobj(env);
  C('...waiting for review, with the contract version, signature and time recorded',
    p.status === 'PENDING' && p.contractVersion === 'bookstore-2026-10-09' && p.contractSignedName === 'Asha Owner' && !!p.contractSignedAt);
  C('Documents are saved in a private folder — never shared', env.files.length === 3 && env.files.every(f => /SwapSutra_Partner_Documents/.test(f.folder)) && env.shared.length === 0);
  C('Only the last 4 digits of the Aadhaar are kept as text', p.aadhaarLast4 === '1234' && !JSON.stringify(p).includes('aadhaarNumber'));
  C('The admin is told', env.notifications.some(x => x[0] === ADMIN && x[1] === 'partner_application'));
  C('Applying again while under review is refused', env.api.submitPartnerApplication(app()).error === 'UNDER_REVIEW');
  const mine = env.api.getMyPartner();
  C('The partner sees their status and what happens next (no documents links)', mine.partner.status === 'PENDING' && mine.nextSteps[0].key === 'wait' && !JSON.stringify(mine).includes('drive.google.com/file'));
  C('...and their PAN only masked', mine.partner.panMasked === 'AB•••••34F' && mine.partner.panNumber === undefined);

  env.as('req@x.com');
  C('A reader cannot review partners', env.api.adminReviewPartner({ id: ok.id, decision: 'approve' }).error === 'ADMIN_ONLY');
  C('A reader cannot list partners', env.api.adminListPartners().error === 'ADMIN_ONLY');
  env.as(ADMIN);
  const list = env.api.adminListPartners();
  C('The admin sees the application with links to its documents', list.items.length === 1 && list.items[0].docs.length === 3 && list.items[0].docs.every(d => /drive\.google\.com\/file\/d\//.test(d.url)) && list.items[0].panNumber === 'ABCDE1234F');
  C('Asking for changes needs a note', env.api.adminReviewPartner({ id: ok.id, decision: 'request_changes' }).success === false);
  env.api.adminReviewPartner({ id: ok.id, decision: 'request_changes', note: 'The PAN photo is blurred' });
  env.as('own@x.com');
  const ch = env.api.getMyPartner();
  C('The partner is told what to change', ch.partner.status === 'CHANGES_REQUESTED' && ch.nextSteps.some(s => /PAN photo is blurred/.test(s.text)));
  const re = env.api.submitPartnerApplication(app({ docs: { pan: PNG } }));
  C('Resubmitting keeps the documents already sent (only the new PAN is uploaded)', re.success && env.files.length === 4 && pobj(env).status === 'PENDING', JSON.stringify(re));
}

console.log('--- approval ---');
{
  const env = partnerEnv();
  approve(env, 'approve_free_year');
  const p = pobj(env);
  const approvedAt = new Date(p.approvedAt);
  const months = (a, b) => (new Date(b).getFullYear() - a.getFullYear()) * 12 + new Date(b).getMonth() - a.getMonth();
  C('Approved with the commission-free first year', p.status === 'APPROVED' && p.commissionPlan === 'free_first_year' && months(approvedAt, p.commissionFreeUntil) === 12);
  C('Banner and ads are free for 6 months', months(approvedAt, p.adsFreeUntil) === 6);
  C('A member row is made so they can sign in, list and sell', env.sheets.Users && env.sheets.Users._data.some(r => r.includes('own@x.com') && r.includes('PARTNER')));
  C('...they count as registered', env.api.isRegisteredReader_('own@x.com') === true);
  const al = env.api.getListingAllowanceFor_('own@x.com', 500);
  C('No 20-book limit: unlimited listings', al.unlimited === true && al.canList === true && al.unlockedVia === 'PARTNER');
  C('They are emailed', env.emails.some(m => m.to === 'own@x.com' && /SwapSutra partner/.test(m.subject)));
  C('Commission is 0% in the first year…', env.api.partnerCommissionRateAt_(p, new Date(T0 + 30 * D)) === 0);
  C('…and 2% after it', env.api.partnerCommissionRateAt_(p, new Date(T0 + 400 * D)) === 0.02);
  env.as(ADMIN);
  env.api.adminReviewPartner({ id: p.id, decision: 'plan_standard' });
  env.ctx.resetPartnerCache_();
  C('The admin can move them to the standard plan (2% now)', env.api.partnerCommissionRateAt_(pobj(env), new Date(T0 + 30 * D)) === 0.02);
  env.api.adminReviewPartner({ id: p.id, decision: 'suspend', note: 'Docs expired' });
  env.ctx.resetPartnerCache_();
  C('A paused partner is no longer a partner (limits and fees apply again)', env.api.approvedPartner_('own@x.com') === null);
  env.api.adminReviewPartner({ id: p.id, decision: 'reinstate' });
  env.ctx.resetPartnerCache_();
  C('...and reinstating brings it back', !!env.api.approvedPartner_('own@x.com'));
}

console.log('--- fees and commission ---');
{
  const env = partnerEnv();
  approve(env, 'approve'); // standard: 2%
  const sale = env.api.computeExchangePayments_({ obj: { serviceType: 'SELL', amount: 300, createdAt: new Date(T0) }, requesterEmail: 'req@x.com', ownerEmail: 'own@x.com' });
  C('Buying from a partner: the buyer still pays price + ₹10', sale.length === 1 && sale[0].requiredAmount === 310 && sale[0].platformFee === 10, JSON.stringify(sale));
  const rent = env.api.computeExchangePayments_({ obj: { serviceType: 'RENT', securityDeposit: 200, createdAt: new Date(T0) }, requesterEmail: 'req@x.com', ownerEmail: 'own@x.com' });
  C('Renting from a partner: the renter pays deposit + ₹10, the partner pays nothing', rent.length === 1 && rent[0].payerRole === 'requester' && rent[0].requiredAmount === 210, JSON.stringify(rent));
  const swapAsReq = env.api.computeExchangePayments_({ obj: { serviceType: 'SWAP', createdAt: new Date(T0) }, requesterEmail: 'own@x.com', ownerEmail: 'req@x.com' });
  C('A partner never pays the ₹10 platform fee', !swapAsReq.some(r => r.payerEmail === 'own@x.com'), JSON.stringify(swapAsReq));
  C('...nor has it taken from a swap deposit', env.api.feeTakenFromDeposit_({ serviceType: 'SWAP', createdAt: new Date(T0) }, 'own@x.com') === 0);

  env.addSwap({ id: 'S1', serviceType: 'SELL', amount: 300, requestedBookId: 'BK1', createdAt: new Date(T0 - H) });
  const swap = env.ctx.loadSwapForCirculation('S1');
  swap.obj.requestedBookId = 'BK1';
  const st = env.api.saleStatusFor_(swap);
  C('The partner seller pays no ₹10; SwapSutra keeps 2% (₹6 of ₹300)', st.sellerFee === 0 && st.commission === 6 && st.sellerReceives === 294 && st.partnerSeller, JSON.stringify(st));
  // A partner listing with 3 copies.
  const books = env.ctx.getOrCreateSheet('Books', env.ctx.getBookHeaders());
  const bh = env.ctx.ensureSheetHeaders(books, env.ctx.getBookHeaders());
  const book = { id: 'BK1', ownerEmail: 'own@x.com', title: 'Dune', status: 'Approved', stock: 3, sellerType: 'bookstore' };
  books.appendRow(bh.map(k => book[k] !== undefined ? book[k] : ''));
  const sheet = env.ctx.getReturnForfeitSheet_();
  const headers = env.ctx.ensureSheetHeaders(sheet, getv(env, 'RETURN_FORFEIT_HEADERS'));
  const rec = { id: 'P1', swapId: 'S1', leg: 'sale', bookTitle: 'Dune', ownerEmail: 'own@x.com', amount: st.sellerReceives, forfeitedAt: new Date(T0), payoutStatus: 'TO_PAY_OWNER' };
  env.ctx.__a = [swap, st, rec, sheet, headers];
  vm.runInContext('salePartnerPayout_.apply(null, __a)', env.ctx);
  sheet.appendRow(headers.map(k => rec[k] !== undefined ? rec[k] : ''));
  const pays = env.payouts('S1');
  C('The sale payout is ₹294, paid with the October statement', rec.amount === 294 && rec.payoutCycle === '2026-10' && rec.grossAmount === 300);
  C('The ₹6 commission is recorded as SwapSutra\'s', pays.some(x => x.leg === 'commission' && x.amount === 6 && x.payoutStatus === 'KEPT_AS_FEE' && x.defaulterEmail === 'own@x.com'));
  C('One copy leaves stock (3 → 2)', books._data[1][bh.indexOf('stock')] === 2);
  env.as(ADMIN);
  C('Partner payouts are not in the per-payout list (they are paid monthly)', env.api.adminListReturnForfeits().items.every(i => i.swapId !== 'S1'));
  const pid = env.payouts('S1').find(x => x.leg === 'sale').id;
  C('...and cannot be paid one by one', /monthly|Partners/.test(env.api.adminMarkForfeitPaid({ id: pid }).message));
  C('October cannot be paid during October', /after it ends/.test(env.api.adminMarkPartnerMonthPaid({ email: 'own@x.com', month: '2026-10' }).message));
  const monthly = env.api.adminListPartners().monthly;
  C('The admin sees the month: ₹294 due, payable after the month ends', monthly.length === 1 && monthly[0].due === 294 && monthly[0].payable === false && monthly[0].partnerName === 'Bookworms', JSON.stringify(monthly));
  env.now(Date.parse('2026-11-03T06:00:00Z'));
  const paid = env.api.adminMarkPartnerMonthPaid({ email: 'own@x.com', month: '2026-10', note: 'UTR 5566' });
  C('In November the admin pays October in one go', paid.success && paid.total === 294 && paid.count === 1);
  C('...and the partner is told', env.notifications.some(x => x[0] === 'own@x.com' && x[1] === 'partner_month_paid'));
  env.as('own@x.com');
  const e = env.api.getMyPartner().earnings;
  C('The partner dashboard: ₹300 sold, ₹6 commission, ₹294 earned and paid', e.total.gross === 300 && e.total.commission === 6 && e.total.net === 294 && e.total.paid === 294 && e.total.due === 0, JSON.stringify(e.total));
  const rev = (env.as(ADMIN), env.api.adminPlatformRevenueSummary());
  C('SwapSutra revenue counts the commission once', rev.partnerCommission === 6 && rev.exchangeFees === 0, JSON.stringify(rev));
  env.as('own@x.com');
  C('Stock: a partner sets copies of their own book', env.api.setPartnerBookStock({ bookId: 'BK1', stock: 0 }).success && books._data[1][bh.indexOf('stock')] === 0);
  env.as('req@x.com');
  C('...nobody else can', env.api.setPartnerBookStock({ bookId: 'BK1', stock: 5 }).error === 'NOT_PARTNER');
}

{
  // A partner renting out a book: rent comes out of the deposit, minus 2%, paid monthly.
  const env = partnerEnv();
  approve(env, 'approve');
  env.addSwap({ id: 'R1', serviceType: 'RENT', securityDeposit: 260, amount: 50, createdAt: new Date(T0 - H) });
  env.approveAll('R1');
  const j = env.ctx.getOrCreateSheet('SwapJourney', getv(env, 'JOURNEY_HEADERS'));
  [['outbound', 'handed_over'], ['outbound', 'received'], ['return', 'route_set'], ['return', 'handed_over'], ['return', 'received']].forEach(([leg, ev], i) =>
    j.appendRow(['jr' + i, 'R1', leg, ev, '', 'in_person', '', '', '', '', '', new Date(T0 + i * H), '', '']));
  env.api.runExchangeRoomTicks_(T0 + 10 * H);
  const p = env.payouts('R1');
  const rent = p.find(x => x.leg === 'rent'), com = p.find(x => x.leg === 'commission'), refund = p.find(x => x.leg === 'refund:requester');
  C('Partner rent: ₹50 rent − ₹1 commission = ₹49, in the monthly statement', rent && rent.amount === 49 && rent.grossAmount === 50 && rent.payoutCycle === '2026-10' && com && com.amount === 1, JSON.stringify(p));
  C('...the renter still gets ₹210 back (₹260 − ₹50 rent)', refund && refund.amount === 210);
}

console.log('--- promotion: banner and ads ---');
{
  const env = partnerEnv();
  const id = approve(env, 'approve');
  env.as('own@x.com');
  const up = env.api.uploadPartnerBanner({ dataUrl: PNG });
  C('The partner uploads a banner; it waits for the admin', up.success && pobj(env).bannerStatus === 'PENDING');
  env.api.updatePartnerProfile({ bannerHeadline: 'Bookworms, Hazratganj', bannerTagline: 'New and second-hand books' });
  env.as('');
  C('Not on the Library before approval', !env.api.getSponsoredAds().items.some(a => a.partner));
  env.as(ADMIN);
  C('Rejecting a banner needs a note', env.api.adminReviewPartnerBanner({ id, approve: false }).success === false);
  env.api.adminReviewPartnerBanner({ id, approve: true });
  env.as('');
  const ads = env.api.getSponsoredAds().items;
  const banner = ads.find(a => a.partner);
  C('Approved: the banner shows on the Library banner, linking to the store on Google Maps', banner && banner.placement === 'banner' && banner.headline === 'Bookworms, Hazratganj' && /google\.com\/maps/.test(banner.linkUrl), JSON.stringify(banner));
  env.as('own@x.com');
  env.api.updatePartnerProfile({ showBanner: false });
  env.as('');
  C('The partner can choose not to show it', !env.api.getSponsoredAds().items.some(a => a.partner));
  env.as('own@x.com');
  env.api.updatePartnerProfile({ showBanner: true });
  const ad = env.api.savePartnerAd({ headline: 'Diwali sale — 15% off', imageUrl: 'https://img.example/d.jpg', linkUrl: 'https://bookworms.example', placement: 'shelf' });
  C('A partner ad is sent for approval', ad.success && env.notifications.some(x => x[0] === ADMIN && x[1] === 'partner_ad'));
  env.as('');
  C('...and is not shown until approved', !env.api.getSponsoredAds().items.some(a => a.headline === 'Diwali sale — 15% off'));
  env.as(ADMIN);
  const row = env.api.getAdminSponsoredAds().items.find(a => a.id === ad.id);
  C('The admin sees it as pending, with the partner\'s name', row.status === 'pending' && row.partnerName === 'Bookworms');
  env.api.saveSponsoredAd(Object.assign({}, row, { status: 'live' }));
  C('Approving tells the partner', env.notifications.some(x => x[0] === 'own@x.com' && x[1] === 'partner_ad_review'));
  env.as('');
  C('Approved: it runs between the books', env.api.getSponsoredAds().items.some(a => a.headline === 'Diwali sale — 15% off' && a.placement === 'shelf' && a.sponsor === 'Bookworms'));
  // 7 months later the free promotion has ended.
  env.now(T0 + 200 * D);
  C('After 6 free months the banner and ads stop', !env.api.getSponsoredAds().items.some(a => a.partner || a.headline === 'Diwali sale — 15% off'));
  env.as('own@x.com');
  const dash = env.api.getMyPartner();
  C('The dashboard asks for ₹100 for 2 months', dash.nextSteps.some(s => s.key === 'promo_pay' && /₹100 for 2 months/.test(s.text)) && dash.promotion.active === false);
  C('A bad UTR is refused', env.api.submitPartnerAdPayment({ utr: '12' }).success === false);
  C('The ₹100 payment is sent with its UTR', env.api.submitPartnerAdPayment({ utr: 'UTR1234567', fileData: PNG }).success === true);
  C('...not twice while it is being checked', env.api.submitPartnerAdPayment({ utr: 'UTR7654321' }).success === false);
  env.as(ADMIN);
  const pend = env.api.adminListPartners().pendingPayments;
  C('The admin sees it to verify', pend.length === 1 && pend[0].amount === 100 && pend[0].partnerName === 'Bookworms');
  const ok = env.api.adminReviewPartnerAdPayment({ id: pend[0].id, approve: true });
  const days = (new Date(ok.periodTo) - (T0 + 200 * D)) / D;
  C('Verified: promotion runs 2 more months from today', ok.success && days > 58 && days < 63, String(days));
  env.as('');
  C('...and the banner and ad are back', env.api.getSponsoredAds().items.some(a => a.partner) && env.api.getSponsoredAds().items.some(a => a.headline === 'Diwali sale — 15% off'));
  env.as('own@x.com');
  env.api.submitPartnerAdPayment({ utr: 'UTR2222222' });
  env.as(ADMIN);
  const second = env.api.adminReviewPartnerAdPayment({ id: env.api.adminListPartners().pendingPayments[0].id, approve: true });
  C('Paying early adds 2 months after the current end (no days lost)', Math.round((new Date(second.periodTo) - new Date(ok.periodTo)) / D) >= 59);
  C('Revenue counts the ₹200 of promotion fees', env.api.adminPlatformRevenueSummary().partnerAdFees === 200);
}

console.log('--- the buyer stays private ---');
{
  const env = partnerEnv();
  approve(env, 'approve');
  env.addSwap({ id: 'S9', serviceType: 'SELL', amount: 250, createdAt: new Date(T0 - H) });
  env.address('req@x.com');
  env.as('own@x.com');
  const r = env.api.getExchangeRoom({ swapId: 'S9' });
  C('In the exchange room the partner sees "the buyer", not a name', r.otherName === 'the buyer', r.otherName);
  const shipping = env.api.shippingOnlyAddress_({ name: 'Ravi', line1: '1 Road', pincode: '110001', phone: '98', email: 'req@x.com', label: 'Home' });
  C('Only what a parcel needs is passed on (no email)', !('email' in shipping) && !('label' in shipping) && shipping.line1 === '1 Road' && shipping.phone === '98');
  const dash = JSON.stringify(env.api.getMyPartner());
  C('The partner dashboard never carries the buyer\'s email or name', !dash.includes('req@x.com') && !dash.includes('Ravi Reader'));
  C('Chat messages from the buyer are masked for a partner', /maskForPartner/.test(gs) && /senderEmail: 'buyer', senderName: 'Buyer'/.test(gs));
  C('A partner verifies their email without a reader account (purpose "partner")', /const isPartnerSignup = String\(purpose \|\| ''\) === 'partner';/.test(gs) && /sendOTP\(data\.email, data\.purpose\)/.test(gs));
}

console.log('--- payment details (admin) ---');
{
  const env = partnerEnv();
  env.as('');
  const def = env.api.getPaymentDetails();
  C('By default payers see the current UPI ID', def.success && def.upi.vpa === '7534845373-3@ybl' && def.upi.bank === null);
  env.as('req@x.com');
  C('Only the admin can change them', env.api.saveAdminPaymentSettings({ vpa: 'x@ybl', payee: 'X' }).error === 'ADMIN_ONLY');
  env.as(ADMIN);
  const bad = env.api.saveAdminPaymentSettings({ vpa: 'not a upi', payee: '', bank: { accountNumber: '12ab', ifsc: 'BAD' }, useQrImage: true });
  C('A wrong UPI ID, name, account number, IFSC and a missing QR picture are caught', ['vpa', 'payee', 'accountNumber', 'ifsc', 'qrImageUrl'].every(k => bad.errors && bad.errors[k]), JSON.stringify(bad.errors));
  const ok = env.api.saveAdminPaymentSettings({ vpa: 'swapsutra@okhdfcbank', payee: 'SwapSutra', qrImageUrl: 'https://drive.google.com/thumbnail?id=Q', useQrImage: true,
    bank: { accountName: 'SwapSutra', accountNumber: '123456789012', ifsc: 'hdfc0001234', bankName: 'HDFC' } });
  C('New details are saved', ok.success && ok.upi.vpa === 'swapsutra@okhdfcbank' && ok.upi.bank.ifsc === 'HDFC0001234' && ok.upi.useQrImage === true);
  env.as('');
  C('Every payer now sees them', env.api.getPaymentDetails().upi.vpa === 'swapsutra@okhdfcbank');
  C('The change is logged (only the last 4 digits of the account)', env.sheets.PaymentSettingsLog._data.length === 2 && env.sheets.PaymentSettingsLog._data[1].includes('9012') && !env.sheets.PaymentSettingsLog._data[1].includes('123456789012'));
  C('Exchange rooms, listing unlocks and partner dashboards use them', (gs.match(/paymentDetails_\(\)/g) || []).length >= 6 && !/upi: \{ vpa: SWAPSM_UPI_VPA/.test(gs));
  env.as(ADMIN);
  const up = env.api.uploadPaymentQrImage({ dataUrl: PNG });
  C('The admin can upload their own QR picture', up.success && /thumbnail/.test(up.url));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
