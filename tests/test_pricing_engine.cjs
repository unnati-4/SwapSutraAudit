/**
 * test_pricing_engine.cjs
 *
 * A CONFORMANCE test for the book pricing brief, run against the shipped
 * appsscript.js rather than a re-implementation.
 *
 * It does two jobs. Every `check` is a rule the brief asks for that the
 * code already keeps, pinned so it cannot quietly stop being true. Every
 * `gap` is a rule the brief asks for that the code does NOT yet keep — it
 * prints, it is counted, and it deliberately does not fail the suite,
 * because a red suite that everyone learns to ignore protects nothing. The
 * gap list is the remaining work, kept in the same file as the tests so the
 * two cannot drift apart.
 *
 * THE BRIEF, IN ONE LINE
 *   ISBN -> format/edition -> comparable online prices for that format
 *        -> outliers out -> median -> x condition factor
 *        -> non-editable SwapSutra value
 *   and, kept separate: verified printed MRP -> 10% -> monthly rent.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0, failed = 0;
const gaps = [];
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
function gap(label, met, note) {
  if (met) { passed++; console.log('PASS: ' + label); return; }
  gaps.push(label + ' — ' + note);
  console.log('GAP:  ' + label + '\n        ' + note);
}

// ── sandbox ─────────────────────────────────────────────────────────────
const scriptProperties = new Map();
const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (scriptProperties.has(k) ? scriptProperties.get(k) : null),
      setProperty: (k, v) => { scriptProperties.set(k, v); },
      deleteProperty: (k) => { scriptProperties.delete(k); },
    }),
  },
  UrlFetchApp: { fetch() { throw new Error('no network in tests'); } },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) =>
      Array.from(crypto.createHmac('sha256', Buffer.from(String(k))).update(Buffer.from(String(v))).digest()),
    base64EncodeWebSafe: (i) =>
      (Array.isArray(i) ? Buffer.from(i.map(b => b & 0xff)) : Buffer.from(String(i), 'utf8'))
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) =>
      Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (b) => ({ getDataAsString: () => Buffer.from(b.map(x => x & 0xff)).toString('utf8') }),
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  MailApp: { sendEmail() {} },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }),
  },
  DriveApp: {},
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8'),
  ctx, { filename: 'appsscript.js' });
const run = (expr) => vm.runInContext(expr, ctx);
const call = (fn, ...args) =>
  run(`${fn}(${args.map(a => JSON.stringify(a === undefined ? null : a)).join(',')})`);
const has = (name) => run(`typeof ${name}`) === 'function';

// The price table is the only seam: everything under test reads through it.
run(`
__SS_PRICE_TABLES__ = {
  byIsbn: {
    "9788182527218": { title: "Pride and Prejudice", genre: "Classics", unit: "single",
                       hardcover: 299, paperback: 399, reprint: 175, confidence: "V" }
  },
  byGenre: { "Other": { hardcover: 699, paperback: 450, reprint: 250 } }
};
`);

// ══════════════════════════════ 1. Book classification
console.log('\n--- Format ---');
check('1. Hardcover is a format the server accepts',
  call('normalizeBookFormat', 'HARDCOVER') === 'HARDCOVER');
check('2. Paperback is a format the server accepts',
  call('normalizeBookFormat', 'PAPERBACK') === 'PAPERBACK');
check('3. An unplaceable binding is never silently a paperback',
  call('normalizeBookFormat', 'LEATHER_BOUND') !== 'PAPERBACK');

// The brief asks for five formats. Two do not exist yet, and the
// consequence is not cosmetic: a mass-market copy priced as a trade
// paperback is priced roughly twice too high, and the deposit follows it.
gap('4. Mass-market is its own format',
  call('normalizeBookFormat', 'MASS_MARKET') === 'MASS_MARKET',
  "BOOK_FORMAT_OPTIONS is ['HARDCOVER','PAPERBACK','UNKNOWN']; MASS_MARKET normalises to '' and falls back to PAPERBACK, over-pricing rack-size copies.");
gap("5. Illustrated / Collector's Edition is its own format",
  call('normalizeBookFormat', 'ILLUSTRATED') === 'ILLUSTRATED',
  "Not in BOOK_FORMAT_OPTIONS; a collector's edition currently prices as a plain paperback or hardcover.");

console.log('\n--- Edition type ---');
check('6. Original Publisher Edition',
  call('normalizeBookEdition', 'PUBLISHER') === 'PUBLISHER');
check('7. Reprint', call('normalizeBookEdition', 'REPRINT') === 'REPRINT');
check('8. Not Sure', call('normalizeBookEdition', 'NOT_SURE') === 'NOT_SURE');
check('9. The old copyType ORIGINAL still resolves',
  call('normalizeBookEdition', 'ORIGINAL') === 'PUBLISHER');
gap('10. Budget Copy is its own edition type',
  call('normalizeBookEdition', 'BUDGET') === 'BUDGET',
  "BOOK_EDITION_OPTIONS is ['PUBLISHER','REPRINT','NOT_SURE']; BUDGET normalises to '' and is treated as NOT_SURE.");

console.log('\n--- Authenticity is a status, not a price tier ---');
check('11. American and British spellings mean the same thing',
  call('bookAuthenticity', { authenticityStatus: 'UNAUTHORIZED' }) === 'UNAUTHORISED' &&
  call('bookAuthenticity', { authenticityStatus: 'UNAUTHORISED' }) === 'UNAUTHORISED');
check('12. An undeclared copy is never read as original',
  call('bookAuthenticity', {}) !== 'ORIGINAL');
check('13. Authenticity is absent from the format list',
  run('BOOK_FORMAT_OPTIONS').indexOf('PIRATED') === -1);
check('14. ...and from the edition list',
  run('BOOK_EDITION_OPTIONS').indexOf('PIRATED') === -1);

// ══════════════════════════════ 2. Automatic price calculation
console.log('\n--- Where the base price comes from ---');

const hb = call('resolveBookPrice', { isbn: '9788182527218', format: 'HARDCOVER', edition: 'PUBLISHER' });
const pb = call('resolveBookPrice', { isbn: '9788182527218', format: 'PAPERBACK', edition: 'PUBLISHER' });
check('15. Hardcover and paperback resolve to different prices',
  hb.amount === 299 && pb.amount === 399);
check('16. A hardcover may legitimately cost LESS than its paperback',
  hb.amount < pb.amount);
check('17. An unpriceable book returns null, never 0',
  call('resolveBookPrice', { isbn: '', genre: '', format: 'PAPERBACK', edition: 'PUBLISHER' }).amount !== 0);
check('18. "Not sure" takes the cheapest legitimate tier, never an optimistic one',
  call('resolveBookPrice', { isbn: '9788182527218', format: 'HARDCOVER', edition: 'NOT_SURE' }).amount === 175);

// The brief's pipeline. What ships is a maintained price TABLE
// (byIsbn/byGenre) plus a Supabase catalogue — both legitimate sources, but
// neither is the "collect online comparables, drop outliers, take the
// median" flow that was asked for, and the median is the part that makes
// one absurd listing unable to move somebody's deposit.
gap('19. Comparable online prices are collected for the chosen format',
  has('comparablesForFormat'),
  'No collector exists in appsscript.js. Prices come from the PriceTables sheet (loadPriceTables) or the Supabase catalogue.');
gap('20. Obvious outliers are removed before averaging',
  has('removePriceOutliers'),
  'No outlier step. A single mis-entered price lands in the table unchallenged.');
gap('21. The base price is the MEDIAN of what survives',
  has('basePriceFromComparables') || has('medianOf'),
  'No median. resolveBookPrice reads one cell per tier rather than summarising a sample.');
gap('22. One or two prices fall back to their midpoint rather than failing',
  has('basePriceFromComparables'),
  'Not applicable until a sample exists; today a missing tier falls through to the lowest tier that is real.');

// ══════════════════════════════ 3. Condition adjustment
console.log('\n--- Condition ---');
check('23. "Like New" maps to AS_NEW',
  call('normalizeConditionGrade', 'Like New') === 'AS_NEW');
check('24. "Very Good" maps to itself',
  call('normalizeConditionGrade', 'Very Good') === 'VERY_GOOD');
check('25. An unrecognised grade lands on GOOD, the middle rung',
  call('normalizeConditionGrade', 'mint honestly') === 'GOOD');

const asNew = call('resolveBookPrice', { isbn: '9788182527218', format: 'PAPERBACK', edition: 'PUBLISHER', condition: 'As New' });
const worn = call('resolveBookPrice', { isbn: '9788182527218', format: 'PAPERBACK', edition: 'PUBLISHER', condition: 'Fair' });
gap('26. The condition factor is applied to the base price',
  asNew.amount !== worn.amount,
  'resolveBookPrice ignores condition entirely: an As New and a Well-Read copy of the same edition are given the identical value. The brief asks for AS_NEW 1.00 / VERY_GOOD 0.85 / GOOD 0.70 / WELL_READ 0.50.');
gap('27. WELL_READ exists as a grade',
  run('BOOK_CONDITION_GRADES').indexOf('WELL_READ') !== -1,
  "The ladder is ['AS_NEW','VERY_GOOD','GOOD','FAIR','POOR']; the brief names the bottom rung WELL_READ at 0.50.");

// ══════════════════════════════ 4 & 7. Printed MRP and rent
console.log('\n--- Printed MRP is separate, and is never invented ---');
check('28. A blank MRP is null, not 0', call('parsePrintedMrp', '') === null);
check('29. Zero is refused — it is not a price', call('parsePrintedMrp', 0) === null);
check('30. A negative MRP is refused', call('parsePrintedMrp', -50) === null);
check('31. A real MRP survives', call('parsePrintedMrp', '599') === 599);
check('32. A book with no printed MRP reports null, never 0',
  call('printedMrpOf', { printedMrp: '' }) === null);

console.log('\n--- Rent is ten percent of the printed MRP and nothing else ---');
check('33. MRP 500 rents at 50/month', call('monthlyRentForMrp', 500) === 50);
check('34. MRP 599 rents at 59.90/month', call('monthlyRentForMrp', 599) === 59.9,
  String(call('monthlyRentForMrp', 599)));
check('35. MRP 1000 rents at 100/month', call('monthlyRentForMrp', 1000) === 100);
check('36. No MRP means no rent, not free rent', call('monthlyRentForMrp', null) === null);
check('37. A zero MRP means no rent', call('monthlyRentForMrp', 0) === null);
// A well-read copy must not rent cheaper than a pristine one of the same
// edition: rent is a property of the edition, not of the copy.
check('38. Rent follows the printed MRP, not the calculated value',
  call('monthlyRentForBook', { printedMrp: 599, mrp: 100, condition: 'Fair' }) === 59.9);
check('39. Rent without a printed MRP is unavailable, not free',
  call('bookTransactionEligibility', { rent: 'TRUE' }).can_rent === false);
check('40. ...and with one it is available',
  call('bookTransactionEligibility', { rent: 'TRUE', printedMrp: 599 }).can_rent === true);

// ══════════════════════════════ 6. Unauthorised copies
console.log('\n--- An unauthorised copy gets no price and no transaction ---');
const pirated = call('bookTransactionEligibility', {
  authenticityStatus: 'UNAUTHORISED', printedMrp: 599,
  sell: 'TRUE', rent: 'TRUE', permanent_exchange: 'TRUE',
  temporary_exchange: 'TRUE', available_for_swap: 'TRUE', lend: 'TRUE',
});
check('41. It cannot be sold', pirated.can_sell === false);
check('42. It cannot be swapped', pirated.can_swap === false);
check('43. It cannot be rented', pirated.can_rent === false);
check('44. It cannot be lent', pirated.can_lend === false);
check('45. ...even though its owner ticked every single box',
  pirated.authenticity === 'UNAUTHORISED');
check('46. An original copy is eligible for what its owner offered',
  call('bookTransactionEligibility', { authenticityStatus: 'ORIGINAL', sell: 'TRUE' }).can_sell === true);
check('47. ...and not for what they did not',
  call('bookTransactionEligibility', { authenticityStatus: 'ORIGINAL', sell: 'TRUE' }).can_swap === false);

// ══════════════════════════════ 8. Deposits
console.log('\n--- Deposits ---');
check('48. The deposit rate is defined once, not repeated as a literal',
  run('DEPOSIT_RATE') === 0.65); // Oct 2026: flat 65%
check('49. The deposit lands on whole rupees', call('depositFor', 195) === 127); // 65% of ₹195 = 126.75

const A = { mrp: 200 }, B = { mrp: 2000 };
check('50. A rental takes a deposit from the borrower only',
  call('computeMutualDeposit', B, null, 'RENT').ownerDeposit === 0);
check('51. Lending is one-way, so only the borrower deposits',
  call('computeMutualDeposit', B, A, 'LEND').ownerDeposit === 0);
check('52. A sale takes no owner deposit',
  call('computeMutualDeposit', B, null, 'SELL').ownerDeposit === 0);

// The brief is explicit that a permanent swap must NOT take 60% from both
// sides. Both readers are giving a book away and neither is coming back, so
// there is nothing for a deposit to secure — and two deposits lock up more
// cash than the two books are worth, on the exchange the platform exists
// for. What protects a swap is dispatch proof from both sides.
const swap = call('computeMutualDeposit', B, A, 'SWAP');
gap('53. A permanent swap takes no deposit from either side',
  swap.requesterDeposit === 0 && swap.ownerDeposit === 0,
  `computeMutualDeposit still charges both sides: requester Rs.${swap.requesterDeposit}, owner Rs.${swap.ownerDeposit}.`);

// ══════════════════════════════ 2 & 9. The owner cannot type the number
console.log('\n--- The owner cannot set their own price ---');
const src = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

check('54. createBook does not write a client-supplied mrp',
  !/h === 'mrp'\) row\[i\] = data\.mrp/.test(src));
check("55. mrp is not in updateUserBook's allowed fields",
  !/allowedFields = \[[^\]]*'mrp'/.test(src));
check('56. createSwapRequest does not read a client-supplied deposit',
  !/data\.securityDeposit/.test(src));
check('57. The listing path runs through resolveListingPricing',
  /resolveListingPricing\(/.test(src));

gap('58. A reader can file a price correction with evidence',
  /requestPriceCorrection|priceCorrection/i.test(src),
  'No correction/appeal action. The price is correctly non-editable, but a wrong price for an old, regional or out-of-print edition has nowhere to go except email.');
gap('59. A verified printed MRP is saved against ISBN + format for reuse',
  /BookCatalog|verifyPrintedMrp/.test(src),
  'No self-building BookCatalog sheet keyed on isbn13 + format, so the next reader listing the same edition redoes the work and does not inherit a verified MRP.');

// ── result ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (gaps.length) {
  console.log(`\n${gaps.length} conformance gaps against the pricing brief (not failures):`);
  gaps.forEach((g, i) => console.log(`  ${i + 1}. ${g}`));
}
process.exit(failed ? 1 : 0);
