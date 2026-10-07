/**
 * test_returns_and_swaps.cjs  (Oct 2026)
 *
 * The owner's exchange rules, against the shipped appsscript.js:
 *   • security 65% of MRP for swap / rent / lend, none for a sale
 *   • owner-set selling price and monthly rent
 *   • a swap only between books of the same condition, type and MRP (±10%)
 *   • the route comes first; addresses only on courier; location pins
 *   • 21-day returns, +7/+14 extensions (14 max, both agree), strict forfeit
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

function makeEnv() {
  const sheets = {};
  const props = {};
  const notifications = [];
  let session = '';
  const bookCounts = {};
  const stageLog = [];
  const emails = [];
  const swapsById = {};

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
    callerIsPartyTo: (swap, email) => email === swap.ownerEmail || email === swap.requesterEmail
  });
  const api = new Proxy({}, { get: (_, name) => (...args) => { ctx.__a = args; return JSON.parse(JSON.stringify(vm.runInContext(`${String(name)}.apply(null, __a)`, ctx) ?? null)); } });

  return {
    api, sheets, props, notifications, stageLog, emails, swapsById, ctx,
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


const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-10T10:00:00+05:30');
const iso = (ms) => new Date(ms).toISOString();
const ev = (leg, event, ms, extra) => Object.assign({ leg, event, createdAt: iso(ms) }, extra || {});

console.log('--- security and prices ---');
{
  const env = makeEnv();
  const B = { id: 'b', condition: 'Good', userEnteredMRP: 400, pricingSource: 'USER', bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER' };
  const swap = env.api.computeMutualDeposit(B, Object.assign({}, B, { id: 'c' }), 'SWAP');
  check('1. Swap: 65% of MRP from each side', swap.requesterDeposit === 260 && swap.ownerDeposit === 260, JSON.stringify(swap));
  check('2. Rent: 65% from the renter', env.api.computeMutualDeposit(B, null, 'RENT').requesterDeposit === 260);
  check('3. Lend: 65% from the borrower', env.api.computeMutualDeposit(B, null, 'LEND').requesterDeposit === 260);
  check('4. Condition no longer changes the rate (Poor = 65% too)', env.api.computeMutualDeposit(Object.assign({}, B, { condition: 'Poor' }), null, 'RENT').requesterDeposit === 260);
  const sell = env.api.computeMutualDeposit(Object.assign({}, B, { ownerSellPrice: 299 }), null, 'SELL');
  check('5. Sale: no security at all', sell.requesterDeposit === 0 && sell.ownerDeposit === 0);
  check('6. Sale price is the owner\'s own price', sell.salePrice === 299);
  check('7. An older listing with no asking price falls back to its value', env.api.sellPriceForBook(B) === 400);
  check('8. Owner\'s monthly rent is used', env.api.monthlyRentForBook(Object.assign({}, B, { ownerRentPerMonth: 55 })) === 55);
  check('9. No owner rent: 10% of MRP, as before', env.api.monthlyRentForBook(Object.assign({}, B, { printedMrp: 400 })) === 40);
  check('10. Prices must be whole rupees ₹1–₹50,000', env.api.ownerPrice_('0') === null && env.api.ownerPrice_('-5') === null
    && env.api.ownerPrice_('60000') === null && env.api.ownerPrice_('₹ 249') === 249 && env.api.ownerPrice_('') === null);
  check('11. createBook refuses a sale with no price', /listingFlags\.sell && ownerSellPrice === null/.test(gs) && /SELL_PRICE_REQUIRED/.test(gs));
  check('12. createBook refuses a rental with no rent', /listingFlags\.rent && ownerRentPerMonth === null/.test(gs) && /RENT_PRICE_REQUIRED/.test(gs));
  check('13. The catalogue no longer vetoes the owner\'s price', /resolveListingPricing\(Object\.assign\(\{\}, data, \{ sellPrice: null \}\), id\)/.test(gs));
}

console.log('--- swap matching ---');
{
  const env = makeEnv();
  const base = { condition: 'Good', bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER', userEnteredMRP: 500, pricingSource: 'USER' };
  const m = (a, b) => env.api.swapBooksMatch_(Object.assign({ id: 'a' }, base, a), Object.assign({ id: 'b' }, base, b));
  check('14. Same condition, type and MRP: allowed', m({}, {}).ok === true);
  check('15. MRP 10% apart (₹500 vs ₹450): allowed', m({}, { userEnteredMRP: 450 }).ok === true);
  check('16. MRP more than 10% apart (₹500 vs ₹440): refused', m({}, { userEnteredMRP: 440 }).reasons.indexOf('mrp') !== -1);
  check('17. Different condition: refused', m({}, { condition: 'Fair' }).reasons.indexOf('condition') !== -1);
  check('18. Paperback vs hardcover: refused', m({}, { bookFormat: 'HARDCOVER' }).reasons.indexOf('type') !== -1);
  check('19. A budget copy (reprint) only swaps with a budget copy', m({ bookEdition: 'REPRINT' }, {}).reasons.indexOf('type') !== -1
    && m({ bookEdition: 'REPRINT' }, { bookEdition: 'REPRINT', bookFormat: 'HARDCOVER' }).ok === true);
  check('20. The message says exactly what differs', /condition \(Good vs Fair\)/.test(m({}, { condition: 'Fair' }).message));
  check('21. createSwapRequest enforces it before any deposit is worked out',
    gs.indexOf("error: 'SWAP_NOT_MATCHING'") > 0 && gs.indexOf("error: 'SWAP_NOT_MATCHING'") < gs.indexOf('const deposits = computeMutualDeposit(requestedBook, offeredBook, serviceType);'));
}

console.log('--- route, address, location ---');
{
  const env = makeEnv();
  check('22. Pins must be real coordinates', env.api.cleanLatLng_(27.17, 78.04) !== null && env.api.cleanLatLng_(0, 0) === null && env.api.cleanLatLng_(95, 10) === null);
  check('23. A place name cannot smuggle a phone number', env.api.cleanPlaceLabel_('Café Coffee Day 98765 43210 gate') === 'Café Coffee Day gate', env.api.cleanPlaceLabel_('Café Coffee Day 98765 43210 gate'));
  check('24. Nothing moves before a route is agreed', /error: 'ROUTE_NOT_SET'/.test(gs));
  check('25. Addresses and phones only when the route is courier', /error: 'ROUTE_NOT_COURIER'/.test(gs) && /route\.method !== 'courier'/.test(gs));
  check('26. A location goes through sendChatMessage (all its gates)', /mediaType: 'location'/.test(gs) && /return sendChatMessage\(\{\s*chatId: chatId,\s*senderEmail: caller/.test(gs));
  check('27. In a swap the requester sends the counter leg', JSON.stringify(env.api.journeyLegParties_({ ownerEmail: 'o', requesterEmail: 'r' }, 'counter')) === JSON.stringify({ sender: 'r', receiver: 'o' }));
}

console.log('--- 21-day returns ---');
{
  const env = makeEnv();
  const R = (obj, events, exts, forfeits, now, stage) => env.api.computeReturnState_(obj, events, exts || [], forfeits || [], now, stage || null);
  const rent = { id: 's1', serviceType: 'RENT', securityDeposit: 260 };
  const tswap = { id: 's2', serviceType: 'SWAP', swapPreference: 'Temporary', securityDeposit: 260, ownerDeposit: 240 };
  check('28. Sale and permanent swap have no return date',
    !R({ serviceType: 'SELL' }, []).applies && !R({ serviceType: 'SWAP', swapPreference: 'Permanent' }, []).applies);
  check('29. The clock waits until the book reaches the borrower', R(rent, [ev('outbound', 'route_set', T0)]).started === false);
  const s = R(rent, [ev('outbound', 'received', T0)], [], [], T0 + 5 * DAY);
  check('30. Due exactly 21 days after it arrived', s.dueAt === iso(T0 + 21 * DAY), s.dueAt);
  check('31. ...with 16 days left on day 5', s.daysLeft === 16);
  check('32. The Stages panel\'s receipt also starts the clock', R(rent, [], [], [], T0, { receiptAt: T0, returnByRole: {} }).dueAt === iso(T0 + 21 * DAY));
  const posted = R(rent, [ev('outbound', 'received', T0), ev('return', 'dispatched', T0 + 20 * DAY, { awb: 'X1' })], [], [], T0 + 30 * DAY);
  check('33. Posted with a tracking ID on day 20: on time, even if it arrives on day 30 (courier delay)', posted.legs[0].state === 'RETURNED_ON_TIME');
  const noAwb = R(rent, [ev('outbound', 'received', T0), ev('return', 'dispatched', T0 + 20 * DAY)], [], [], T0 + 22 * DAY);
  check('34. "Posted" with no tracking ID does not count', noAwb.legs[0].state === 'OVERDUE');
  check('35. Handed over in person on time counts',
    R(rent, [ev('outbound', 'received', T0), ev('return', 'handed_over', T0 + 21 * DAY - 1000)], [], [], T0 + 25 * DAY).legs[0].state === 'RETURNED_ON_TIME');
  check('36. Day 22 with nothing sent: overdue', R(rent, [ev('outbound', 'received', T0)], [], [], T0 + 22 * DAY).legs[0].state === 'OVERDUE');
  check('37. Borrower confirming the return in the Stages panel counts',
    R(rent, [], [], [], T0 + 25 * DAY, { receiptAt: T0, returnByRole: { requester: T0 + 10 * DAY } }).legs[0].state === 'RETURNED_ON_TIME');
  const ext = R(rent, [ev('outbound', 'received', T0)], [{ status: 'APPROVED', days: 7 }], [], T0);
  check('38. An agreed +7 moves the deadline to day 28', ext.dueAt === iso(T0 + 28 * DAY) && ext.extensionDaysLeft === 7);
  check('39. ...after which only +7 is still on offer', JSON.stringify(ext.extensionChoices) === '[7]');
  check('40. A pending (not agreed) extension changes nothing', R(rent, [ev('outbound', 'received', T0)], [{ status: 'PENDING', days: 14 }], [], T0).dueAt === iso(T0 + 21 * DAY));
  check('41. Never more than 14 days in total', R(rent, [ev('outbound', 'received', T0)], [{ status: 'APPROVED', days: 14 }, { status: 'APPROVED', days: 7 }], [], T0).dueAt === iso(T0 + 35 * DAY));
  const ts = R(tswap, [ev('outbound', 'received', T0), ev('counter', 'received', T0 + DAY)], [], [], T0 + 2 * DAY);
  check('42. A temporary swap has two returns — one per book', ts.legs.length === 2 && ts.legs[1].leg === 'counter_return' && ts.legs[1].borrower === 'owner');
  check('43. ...on one clock, from the first book to arrive', ts.dueAt === iso(T0 + 21 * DAY));
}

console.log('--- extensions need both readers ---');
{
  const env = makeEnv();
  const swap = { obj: { id: 'S9', serviceType: 'RENT', requestedBookTitle: 'Dune', securityDeposit: 260 }, ownerEmail: 'own@x.com', requesterEmail: 'req@x.com' };
  env.swapsById.S9 = swap;
  env.ctx.getOrCreateSheet('SwapJourney', ['id', 'swapId', 'leg', 'event', 'actorEmail', 'method', 'courierName', 'awb', 'note', 'mediaUrl', 'expectedBy', 'createdAt', 'lat', 'lng'])
    .appendRow(['j1', 'S9', 'outbound', 'received', 'req@x.com', '', '', '', '', '', '', new Date(Date.now() - 3 * DAY), '', '']);
  env.as('req@x.com');
  check('44. +10 days is refused (only +7 or +14)', env.api.requestReturnExtension({ swapId: 'S9', days: 10 }).success === false);
  check('45. The borrower asks for +7', env.api.requestReturnExtension({ swapId: 'S9', days: 7 }).success === true);
  check('46. Only one request at a time', env.api.requestReturnExtension({ swapId: 'S9', days: 7 }).success === false);
  const extId = env.sheets.ReturnExtensions._data[1][0];
  check('47. The one who asked cannot approve it', env.api.respondReturnExtension({ swapId: 'S9', extensionId: extId, accept: true }).error === 'WRONG_PARTY');
  env.as('own@x.com');
  check('48. The other reader agrees', env.api.respondReturnExtension({ swapId: 'S9', extensionId: extId, accept: true }).success === true);
  env.as('req@x.com');
  const st = env.api.getReturnStatus({ swapId: 'S9' });
  check('49. The deadline moved by 7 days', st.extensionDays === 7 && st.daysLeft === 25, JSON.stringify({ d: st.daysLeft, e: st.extensionDays }));
  check('50. +14 now refused (would pass 14 in total)', env.api.requestReturnExtension({ swapId: 'S9', days: 14 }).error === 'EXTENSION_LIMIT');
  check('51. Both readers were told, in the app and by email',
    env.notifications.filter(n => n[1] === 'return_extension_approved').length === 2 && env.emails.some(m => /Return date extended/.test(m.subject)));
}

console.log('--- the daily job ---');
{
  const env = makeEnv();
  env.ctx.DB_SCHEMA = { SwapRequests: ['id', 'serviceType', 'status', 'requestedBookTitle', 'securityDeposit', 'ownerDeposit', 'swapPreference'] };
  const sheet = env.ctx.getOrCreateSheet('SwapRequests', env.ctx.DB_SCHEMA.SwapRequests);
  sheet.appendRow(['L1', 'RENT', 'accepted', 'Dune', 260, 0, '']);   // overdue, never sent back
  sheet.appendRow(['L2', 'RENT', 'accepted', 'Emma', 200, 0, '']);   // 2 days left
  sheet.appendRow(['L3', 'RENT', 'accepted', 'Kim', 150, 0, '']);    // posted on time
  sheet.appendRow(['L4', 'SELL', 'accepted', 'Sold', 0, 0, '']);     // no return date
  ['L1', 'L2', 'L3', 'L4'].forEach(id => { env.swapsById[id] = { obj: { id, serviceType: id === 'L4' ? 'SELL' : 'RENT', requestedBookTitle: id }, ownerEmail: 'o' + id + '@x.com', requesterEmail: 'r' + id + '@x.com' }; });
  const j = env.ctx.getOrCreateSheet('SwapJourney', ['id', 'swapId', 'leg', 'event', 'actorEmail', 'method', 'courierName', 'awb', 'note', 'mediaUrl', 'expectedBy', 'createdAt', 'lat', 'lng']);
  const now = Date.now();
  j.appendRow(['1', 'L1', 'outbound', 'received', '', '', '', '', '', '', '', new Date(now - 23 * DAY), '', '']);
  j.appendRow(['2', 'L2', 'outbound', 'received', '', '', '', '', '', '', '', new Date(now - 19 * DAY), '', '']);
  j.appendRow(['3', 'L3', 'outbound', 'received', '', '', '', '', '', '', '', new Date(now - 25 * DAY), '', '']);
  j.appendRow(['4', 'L3', 'return', 'dispatched', '', 'courier', 'Delhivery', 'AWB1', '', '', '', new Date(now - 5 * DAY), '', '']);
  const sum = env.api.runReturnDeadlines();
  const f = env.sheets.ReturnForfeits._data.slice(1);
  check('52. Only the overdue rental is forfeited', f.length === 1 && f[0][1] === 'L1', JSON.stringify(f.map(r => r[1])));
  check('53. ...its ₹260 goes to the owner', f[0][5] === 'oL1@x.com' && f[0][6] === 260 && f[0][9] === 'TO_PAY_OWNER');
  check('54. Borrower, owner and admin are all told', ['return_forfeited', 'return_forfeited_owner', 'return_forfeit_admin'].every(t => env.notifications.some(n => n[1] === t)));
  check('55. The 3-day reminder went to the borrower with 2 days left', env.notifications.some(n => n[0] === 'rL2@x.com' && /3 days left/.test(n[2])));
  check('56. Nothing for the one posted on time, or the sale', !env.notifications.some(n => /L3|L4/.test(n[0]) && /forfeit/i.test(n[1])));
  env.api.runReturnDeadlines();
  check('57. Running again never forfeits twice', env.sheets.ReturnForfeits._data.length === 2);
  env.as('swapsutra@gmail.com');
  const id = env.sheets.ReturnForfeits._data[1][0];
  check('58. Admin marks the payout done', env.api.adminMarkForfeitPaid({ id }).success === true && env.sheets.ReturnForfeits._data[1][9] === 'PAID_TO_OWNER');
  check('59. WhatsApp stays off until it is configured', env.api.sendWhatsAppNotice_('a@x.com', 't', 'b') === false);
}

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail === 0 ? 0 : 1);
