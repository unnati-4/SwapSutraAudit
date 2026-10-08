/**
 * test_sale_escrow.cjs  (Oct 2026, owner's request)
 *
 * A sale through SwapSutra, against the shipped appsscript.js:
 *   • the buyer pays SwapSutra the owner's price + ₹10; the seller pays nothing up front
 *   • the buyer closes the purchase once they have the book (with the receiving video),
 *     which creates the seller's payout: price − ₹10, to their UPI ID / QR
 *   • unhappy? a dispute holds the payout; never closed? released after 7 days
 *   • the buyer is invited (optionally) to leave a Google review
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
function makeEnv() {
  const sheets = {};
  const props = {};
  const notifications = [];
  let session = '';
  const bookCounts = {};
  const stageLog = [];
  const emails = [];
  const swapsById = {};
  const chats = [];
  const journeyLog = [];
  const fetches = [];
  const openDisputes = {};

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
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch() { throw new Error('no network'); } },
    Utilities: { getUuid: () => crypto.randomUUID() },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, putAll() {}, getAll: () => ({}) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    MailApp: { sendEmail() {} },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
    DriveApp: {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gs, ctx, { filename: 'appsscript.js' });

  // Replace the I/O edges with in-memory versions; the logic stays real.
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
    saveFileToDrive: (data) => (data ? 'https://drive.example/file' : ''),
    createNotification: (...args) => { notifications.push(args); return {}; },
    appendStageEvent: () => ({}),
    getAuthenticatedEmail: () => session,
    isAuthenticatedAdmin: () => session === 'swapsutra@gmail.com',
    recalculateBooksListedCount: (e) => bookCounts[String(e).toLowerCase()] || 0,
    appendStageEvent: (e) => { stageLog.push(e); return {}; },
    sendSwapSutraEmail: (m) => { emails.push(m); return true; },
    loadSwapForCirculation: (id) => swapsById[id] || null,
    callerIsPartyTo: (swap, email) => email === swap.ownerEmail || email === swap.requesterEmail,
    swapChatUnlocked: () => true,
    getOrCreateFolder: (name) => ({ getId: () => 'folder_' + name }),
    findChatBySwapId: () => ({ chatId: 'CHAT1' }),
    sendChatMessage: (m) => { chats.push(m); return { success: true }; },
    swapHasOpenDispute: (id) => !!openDisputes[id],
    appendJourneyEvent: (e) => { journeyLog.push(e); return { success: true }; }
  });
  // Google Drive resumable upload, faked: 308 until the last piece, then the file id.
  ctx.ScriptApp = { getOAuthToken: () => 'tok' };
  ctx.UrlFetchApp = { fetch: (url, opt) => {
    fetches.push({ url, opt });
    if (url.indexOf('uploadType=resumable') !== -1) return { getResponseCode: () => 200, getHeaders: () => ({ Location: 'https://upload.example/session1' }), getContentText: () => '' };
    const range = String(opt.headers['Content-Range']); const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
    const done = Number(m[2]) + 1 === Number(m[3]);
    return { getResponseCode: () => done ? 200 : 308, getHeaders: () => ({}), getContentText: () => done ? JSON.stringify({ id: 'FILE1' }) : '' };
  } };
  ctx.DriveApp = { Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 }, getFileById: (id) => ({ setSharing() {}, getUrl: () => 'https://drive.example/' + id }) };
  ctx.Utilities = Object.assign({}, ctx.Utilities || {}, {
    getUuid: () => crypto.randomUUID(),
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
    computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(str).digest()).map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 'sha256' },
    formatDate: (d) => new Date(d).toISOString()
  });
  const api = new Proxy({}, { get: (_, name) => (...args) => { ctx.__a = args; return JSON.parse(JSON.stringify(vm.runInContext(`${String(name)}.apply(null, __a)`, ctx) ?? null)); } });

  return {
    api, sheets, props, notifications, stageLog, emails, swapsById, ctx, chats, journeyLog, fetches, openDisputes,
    as(email) { session = email; },
    setBooks(email, n) { bookCounts[email] = n; },
    addUser(email, extra) {
      const s = ctx.getOrCreateSheet('Users', ['email', 'name', 'phone', 'membershipStatus']);
      s.appendRow([email, 'R', '9800000000', (extra && extra.membershipStatus) || '']);
    },
    addSub(email, extra) {
      const s = ctx.getOrCreateSheet('Subscriptions', ['email', 'name', 'adminStatus', 'membershipStatus', 'activationType', 'trialStartDate', 'trialEndDate']);
      s.appendRow([email, 'R', (extra && extra.adminStatus) || 'Pending', (extra && extra.membershipStatus) || '',
        (extra && extra.activationType) || '', (extra && extra.trialStartDate) || '', (extra && extra.trialEndDate) || '']);
    }
  };
}




const JOURNEY_HEADERS = ['id', 'swapId', 'leg', 'event', 'actorEmail', 'method', 'courierName', 'awb', 'note', 'mediaUrl', 'expectedBy', 'createdAt', 'lat', 'lng'];
const DAY = 86400000;
const REVIEW = 'https://g.page/r/CTKbe5CpoGNPEAI/review';
function sale(opts) {
  const o = opts || {};
  const env = makeEnv();
  env.ctx.DB_SCHEMA = { SwapRequests: ['id', 'serviceType', 'status', 'requestedBookTitle', 'amount', 'securityDeposit', 'ownerDeposit', 'swapPreference', 'createdAt'] };
  const created = o.created || new Date('2026-10-10T10:00:00+05:30');
  env.ctx.getOrCreateSheet('SwapRequests', env.ctx.DB_SCHEMA.SwapRequests).appendRow(['S1', 'SELL', 'accepted', 'Dune', 300, 0, 0, '', created]);
  env.swapsById.S1 = { obj: { id: 'S1', serviceType: 'SELL', requestedBookTitle: 'Dune', amount: 300, createdAt: created.toISOString() }, ownerEmail: 'seller@x.com', requesterEmail: 'buyer@x.com' };
  const j = env.ctx.getOrCreateSheet('SwapJourney', JOURNEY_HEADERS);
  j.appendRow(['j0', 'S1', 'outbound', 'route_set', 'buyer@x.com', 'courier', '', '', '', '', '', new Date(), '', '']);
  if (o.receivedDaysAgo !== undefined) j.appendRow(['j1', 'S1', 'outbound', 'received', 'buyer@x.com', '', '', '', '', '', '', new Date(Date.now() - o.receivedDaysAgo * DAY), '', '']);
  if (o.video !== false) {
    env.ctx.getOrCreateSheet('ExchangeVideos', ['id', 'swapId', 'leg', 'kind', 'uploaderEmail', 'role', 'method', 'fileId', 'url', 'mimeType', 'sizeBytes', 'durationSec', 'recordedInApp', 'stampCode', 'createdAt'])
      .appendRow(['v1', 'S1', 'outbound', 'RECEIVING', 'buyer@x.com', 'receiver', 'courier', 'F', 'u', 'video/mp4', 1, 20, 'true', '', new Date()]);
  }
  return env;
}
const payouts = (env) => (env.sheets.ReturnForfeits ? env.sheets.ReturnForfeits._data.slice(1) : []).filter(r => r[2] === 'sale');

console.log('--- what the buyer pays and the seller gets ---');
{
  const env = sale({ receivedDaysAgo: 1 });
  env.as('buyer@x.com');
  const st = env.api.getSaleStatus({ swapId: 'S1' });
  check('1. Buyer pays SwapSutra price + fee (₹310)', st.applies && st.escrow && st.buyerPays === 310 && st.you === 'buyer');
  check('2. Seller will get price − their ₹10 fee (₹290)', st.sellerReceives === 290 && st.sellerFee === 10);
  check('3. The payment row stores the price apart from the fee', JSON.stringify(env.api.feeRecordBreakdown_({ requiredAmount: 310, platformFee: 10, saleAmount: 300, depositAmount: 0 })) === JSON.stringify({ depositAmount: 0, platformFee: 10, saleAmount: 300 }));
  check('4. ...and the Stages tab shows "₹300 book price + ₹10"', /p\.saleAmount\} book price \+ ₹\{p\.platformFee \?\? 0\} platform fee/.test(read('src/components/SwapStateMachine.tsx')));
}

console.log('--- the seller\'s UPI ---');
{
  const env = sale({});
  env.as('seller@x.com');
  check('5. A malformed UPI ID is refused', env.api.savePayoutAccount({ upiId: 'not a upi', payeeName: 'A' }).success === false);
  check('6. The name on the account is required', env.api.savePayoutAccount({ upiId: 'riya@okaxis' }).success === false);
  check('7. A valid UPI ID is saved', env.api.savePayoutAccount({ upiId: 'riya@okaxis', payeeName: 'Riya S' }).success === true);
  check('8. ...with a QR image too', env.api.savePayoutAccount({ upiId: 'riya@okaxis', payeeName: 'Riya S', fileData: 'data:image/png;base64,AAA' }).account.qrUrl !== '');
  check('9. The seller sees it on the sale', env.api.getSaleStatus({ swapId: 'S1' }).payoutAccount.upiId === 'riya@okaxis');
  check('10. Updating keeps one record per reader', env.api.savePayoutAccount({ upiId: 'riya@ybl', payeeName: 'Riya S' }).success && env.sheets.PayoutAccounts._data.length === 2);
}

console.log('--- closing the purchase ---');
{
  const env = sale({});
  env.as('seller@x.com');
  check('11. Only the buyer can close', env.api.confirmSaleComplete({ swapId: 'S1', happy: true }).error === 'WRONG_PARTY');
  env.as('buyer@x.com');
  check('12. Closing needs "I\'m happy"', env.api.confirmSaleComplete({ swapId: 'S1' }).success === false);
  check('13. Not before the book is received', env.api.confirmSaleComplete({ swapId: 'S1', happy: true }).error === 'NOT_RECEIVED');
}
{
  const env = sale({ receivedDaysAgo: 0, video: false });
  env.as('buyer@x.com');
  check('14. Not without the buyer\'s receiving video', env.api.confirmSaleComplete({ swapId: 'S1', happy: true }).error === 'VIDEO_REQUIRED');
}
{
  const env = sale({ receivedDaysAgo: 0 });
  env.openDisputes.S1 = true;
  env.as('buyer@x.com');
  check('15. Not while a problem is being reviewed', env.api.confirmSaleComplete({ swapId: 'S1', happy: true }).error === 'DISPUTE_OPEN');
}
{
  const env = sale({ receivedDaysAgo: 0 });
  env.as('seller@x.com'); env.api.savePayoutAccount({ upiId: 'riya@okaxis', payeeName: 'Riya S' });
  env.as('buyer@x.com');
  const r = env.api.confirmSaleComplete({ swapId: 'S1', happy: true });
  check('16. Closing works and returns the review link', r.success === true && r.reviewUrl === REVIEW, JSON.stringify(r));
  const p = payouts(env);
  check('17. A ₹290 payout to the seller is created', p.length === 1 && p[0][5] === 'seller@x.com' && p[0][6] === 290 && p[0][9] === 'TO_PAY_OWNER');
  check('18. The seller is told, with their UPI', env.notifications.some(n => n[0] === 'seller@x.com' && /₹290/.test(n[3]) && /riya@okaxis/.test(n[3])));
  check('19. The buyer is thanked and invited (optionally) to review', env.notifications.some(n => n[0] === 'buyer@x.com' && n[3].includes(REVIEW) && /optional/.test(n[3])));
  check('20. SwapSutra is told to pay', env.notifications.some(n => n[0] === 'swapsutra@gmail.com' && /Pay a seller/.test(n[2])));
  check('21. A purchase closes only once', env.api.confirmSaleComplete({ swapId: 'S1', happy: true }).success === false);
  env.as('swapsutra@gmail.com');
  const list = env.api.adminListReturnForfeits();
  check('22. Admin payout list shows where to pay', list.items[0].payTo && list.items[0].payTo.upiId === 'riya@okaxis');
  check('23. Marking it paid tells the seller', env.api.adminMarkForfeitPaid({ id: p[0][0] }).success && env.notifications.some(n => n[0] === 'seller@x.com' && /payment for your sale/.test(n[3])));
}
{
  const env = sale({ receivedDaysAgo: 0, created: new Date('2026-10-01T10:00:00+05:30') });
  env.as('buyer@x.com');
  check('24. A sale from before the change is not held by SwapSutra', env.api.getSaleStatus({ swapId: 'S1' }).escrow === false
    && /paid directly between readers/.test(env.api.confirmSaleComplete({ swapId: 'S1', happy: true }).message));
}

console.log('--- never closed: released after 7 days ---');
{
  const env = sale({ receivedDaysAgo: 6 });
  env.api.runSaleAutoRelease_();
  check('25. Day 6: the buyer is reminded, nothing released', payouts(env).length === 0 && env.notifications.some(n => n[1] === 'sale_close_reminder'));
}
{
  const env = sale({ receivedDaysAgo: 8 });
  env.api.runReturnDeadlines();
  check('26. Day 8: released to the seller (through the hourly job)', payouts(env).length === 1 && payouts(env)[0][6] === 290);
  env.api.runReturnDeadlines();
  check('27. ...only once', payouts(env).length === 1);
}
{
  const env = sale({ receivedDaysAgo: 30 });
  env.openDisputes.S1 = true;
  env.api.runSaleAutoRelease_();
  check('28. A disputed sale is never auto-released', payouts(env).length === 0);
}

console.log('--- the screens ---');
{
  const panel = read('src/components/SalePanel.tsx');
  const tracker = read('src/components/CirculationTracker.tsx');
  const app = read('src/App.tsx');
  check('29. The sale panel is in the Delivery panel for sales', /data\.serviceType === 'SELL' && <SalePanel/.test(tracker));
  check('30. The buyer must tick "I\'m happy" before closing', /disabled=\{!happy \|\| busy\}/.test(panel) && /action: 'confirmSaleComplete', swapId, happy: true/.test(panel));
  check('31. The Google review card links to the right page', gs.includes("const GOOGLE_REVIEW_URL = '" + REVIEW + "'") && /<GoogleReviewCard url=\{st\.reviewUrl/.test(panel) && /optional/.test(panel));
  check('32. The seller is asked for their UPI ID and QR', /Where should SwapSutra pay you\?/.test(panel) && /action: 'savePayoutAccount'/.test(panel));
  check('33. Anyone can set it in Profile → Settings', /<PayoutAccountForm \/>/.test(app));
  check('34. The buy modal explains SwapSutra holds the money', /SwapSutra holds the money and pays the seller only after you have the book/.test(app));
}

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail === 0 ? 0 : 1);
