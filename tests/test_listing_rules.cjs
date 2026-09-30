/**
 * test_listing_rules.cjs
 *
 * The listing rules that decide money and eligibility, tested against the
 * shipped appsscript.js rather than a re-implementation.
 *
 * Five things are pinned here, and each one existed as a real defect:
 *
 *   1. MRP NEVER BECOMES ZERO. An unresolved price used to return 0, and
 *      0 flowed into the sheet, the screens and the deposits as though
 *      somebody had established that the book was worth nothing.
 *
 *   2. RENT IS 10% OF THE PRINTED MRP. It used to be a flat Rs.49 for
 *      every book — the same to rent a Rs.150 paperback as a Rs.2,400
 *      textbook — and it came from nowhere near the MRP.
 *
 *   3. RENT AND LEND ARE DIFFERENT TRANSACTIONS. A LEND request used to be
 *      authorised by the temporary_exchange flag, so every reader offering
 *      a temporary swap was also offering a straight loan without ever
 *      having been asked.
 *
 *   4. THE FOUR MEDIA ARE FOUR SEPARATE REQUIREMENTS. The old rule was
 *      `images.length >= 2`, which two photographs of the same front cover
 *      satisfy, and which no count could ever extend to "one of them must
 *      be a video".
 *
 *   5. AN UNAUTHORISED COPY IS BARRED STRUCTURALLY. Not by hiding a
 *      button — by the server function that creates the transaction.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
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
  UrlFetchApp: { fetch() { throw new Error('no network in this test'); } },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')),
    newBlob: (b, type, name) => ({ b, type, name }),
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {},
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8'), ctx,
                { filename: 'appsscript.js' });
const call = (fn, ...args) => {
  ctx.__args = args;
  return vm.runInContext(`${fn}.apply(null, __args)`, ctx);
};

// A data URI of the right shape for each kind. The bytes are not real
// media; what is under test is the gate, and the gate reads the declared
// type and the size, both of which these carry honestly.
const img = (bytes = 1000, type = 'image/jpeg') => ({
  fileName: 'x.jpg', mimeType: type,
  base64Data: `data:${type};base64,` + 'A'.repeat(Math.ceil(bytes * 4 / 3)),
});
const vid = (bytes = 5000, type = 'video/mp4') => ({
  fileName: 'x.mp4', mimeType: type,
  base64Data: `data:${type};base64,` + 'A'.repeat(Math.ceil(bytes * 4 / 3)),
});
const allFour = () => ({
  frontCoverImage: img(), internalBookImage: img(), internalBookVideo: vid(), backCoverImage: img(),
});
// The minimum a listing can get away with: both covers, and ONE of the two
// inside items.
const coversPlusInsideImage = () => ({
  frontCoverImage: img(), internalBookImage: img(), backCoverImage: img(),
});
const coversPlusInsideVideo = () => ({
  frontCoverImage: img(), internalBookVideo: vid(), backCoverImage: img(),
});

// ═══════════════════════ 1. MRP NEVER BECOMES ZERO ══════════════════════
console.log('\n--- an unknown MRP is unknown, never Rs.0 ---');

check('1. A blank MRP parses to null, not 0', call('parsePrintedMrp', '') === null);
check('2. undefined parses to null', call('parsePrintedMrp', undefined) === null);
check('3. Zero is refused — it is not a price', call('parsePrintedMrp', 0) === null);
check('4. A negative MRP is refused', call('parsePrintedMrp', -50) === null);
check('5. Text that is not a number is refused', call('parsePrintedMrp', 'not a price') === null);
check('6. A real MRP survives', call('parsePrintedMrp', '599') === 599);
check('7. Rupee formatting is tolerated', call('parsePrintedMrp', 'Rs. 1,299') === 1299,
  String(call('parsePrintedMrp', 'Rs. 1,299')));
check('8. A book with no printed MRP reports null', call('printedMrpOf', { printedMrp: '' }) === null);

// ═════════════════════ 2. RENT IS 10% OF PRINTED MRP ════════════════════
console.log('\n--- monthly rent is exactly a tenth of the printed MRP ---');

check('9. MRP 500 rents at 50/month', call('monthlyRentForMrp', 500) === 50);
check('10. MRP 599 rents at 59.90/month', call('monthlyRentForMrp', 599) === 59.9,
  String(call('monthlyRentForMrp', 599)));
check('11. MRP 1000 rents at 100/month', call('monthlyRentForMrp', 1000) === 100);
check('12. No MRP means no rent, not free rent', call('monthlyRentForMrp', null) === null);
check('13. A zero MRP means no rent', call('monthlyRentForMrp', 0) === null);
check('14. A negative MRP means no rent', call('monthlyRentForMrp', -100) === null);

// The seller's own numbers must not appear anywhere in that answer.
const rentBook = { printedMrp: 400, mrp: 9999, sellPrice: 8888, rent: 'TRUE' };
check('15. Rent ignores the listing value and the asking price',
  call('monthlyRentForBook', rentBook) === 40,
  String(call('monthlyRentForBook', rentBook)));

// ══════════════════ 3. RENT AND LEND ARE INDEPENDENT ════════════════════
console.log('\n--- rent and lend are separate offers ---');

const rentOnly = call('bookAvailabilityFlags', { rent: 'TRUE' });
check('16. Offering rent does not offer lending', rentOnly.rent === true && rentOnly.lend === false);

const lendOnly = call('bookAvailabilityFlags', { lend: 'TRUE' });
check('17. Offering lending does not offer rent', lendOnly.lend === true && lendOnly.rent === false);

const tempSwap = call('bookAvailabilityFlags', { temporary_exchange: 'TRUE' });
check('18. A temporary swap is not a loan',
  tempSwap.temporary_exchange === true && tempSwap.lend === false,
  'temporary_exchange still implies lend');

const both = call('bookAvailabilityFlags', { rent: 'TRUE', lend: 'TRUE' });
check('19. Both can be offered together when the owner says so',
  both.rent === true && both.lend === true);

// ════════════════ 4. THE FOUR MEDIA, CHECKED SEPARATELY ═════════════════
console.log('\n--- four media requirements, four separate answers ---');

check('20. All four present passes', call('validateRequiredBookMedia', allFour()).ok === true,
  JSON.stringify(call('validateRequiredBookMedia', allFour()).missing));

// Either inside item satisfies the inside requirement, on its own.
check('20b. Both covers plus an inside PHOTO is enough',
  call('validateRequiredBookMedia', coversPlusInsideImage()).ok === true,
  JSON.stringify(call('validateRequiredBookMedia', coversPlusInsideImage()).missing));

check('20c. Both covers plus an inside VIDEO is enough',
  call('validateRequiredBookMedia', coversPlusInsideVideo()).ok === true,
  JSON.stringify(call('validateRequiredBookMedia', coversPlusInsideVideo()).missing));

// CHANGED 24 Sep 2026 (founder's decision): the front cover alone lists a
// book. The back cover joins the inside media as "add later to finish your
// listing" — the book goes live with a "More photos coming" label.
{
  const payload = allFour();
  delete payload.frontCoverImage;
  const res = call('validateRequiredBookMedia', payload);
  check('21. Missing the front cover blocks the listing', res.ok === false);
  check('22. ...and the front cover is named as what is missing',
    Array.isArray(res.missing) && res.missing.indexOf('frontCoverImage') !== -1,
    JSON.stringify(res.missing));
}
{
  const payload = allFour();
  delete payload.backCoverImage;
  const res = call('validateRequiredBookMedia', payload);
  check('21b. Missing the back cover no longer blocks the listing', res.ok === true, JSON.stringify(res.messages));
}

// Neither inside item.
//
// CHANGED 20 Sep 2026: inside-the-book media is now OPTIONAL. The covers are
// quick — the book is in the reader's hand — but photographing a page inside
// or filming a flick-through is the step people abandoned, and a listing
// nobody finishes shows their copy to nobody. The two covers are still
// required; the inside pair is an invitation, not a gate.
const noInside = allFour();
delete noInside.internalBookImage;
delete noInside.internalBookVideo;
const noInsideResult = call('validateRequiredBookMedia', noInside);
check('22b. Two covers and nothing from inside is now accepted',
  noInsideResult.ok === true,
  JSON.stringify(noInsideResult.messages));
check('22c. ...and nothing inside is named as missing',
  !Array.isArray(noInsideResult.missing) || noInsideResult.missing.length === 0,
  JSON.stringify(noInsideResult.missing));

// The case a count can never catch, and the reason this is grouped rather
// than "any three of four".
const threeButNoBack = {
  frontCoverImage: img(), internalBookImage: img(), internalBookVideo: vid(),
};
check('23. Front cover plus inside media, no back cover, is accepted (back is "add later")',
  call('validateRequiredBookMedia', threeButNoBack).ok === true);
const frontOnly = call('validateRequiredBookMedia', { frontCoverImage: img() });
check('23b. The front cover on its own is a valid listing',
  frontOnly.ok === true && !!frontOnly.accepted.frontCoverImage, JSON.stringify(frontOnly.messages));

// One required group now — and the optional ones must not pad the list
// with something the reader was never obliged to provide.
const nothingAtAll = call('validateRequiredBookMedia', {});
check('24. Nothing at all names only the front cover',
  nothingAtAll.messages.length === 1 && /front cover/i.test(nothingAtAll.messages[0]),
  JSON.stringify(nothingAtAll.messages));

check('24b. ...and does not ask for the optional inside media',
  !/photo of a page or a short video/.test(nothingAtAll.message),
  nothingAtAll.message);

check('25. ...and does not ask for the back cover either',
  !/back cover/i.test(nothingAtAll.message), nothingAtAll.message);

// A supplied-but-rejected file must not be reported as "not supplied".
const badInside = coversPlusInsideImage();
badInside.internalBookImage = img(9 * 1024 * 1024);
const badInsideResult = call('validateRequiredBookMedia', badInside);
check('25b. A too-large inside photo is reported as too large, not as missing',
  badInsideResult.ok === false && /too large/i.test(badInsideResult.message),
  badInsideResult.message);

// Server-side type checking: the declared type is not taken on faith.
const lying = coversPlusInsideVideo();
lying.internalBookVideo = { fileName: 'clip.mp4', mimeType: 'video/mp4',
                            base64Data: 'data:image/png;base64,' + 'A'.repeat(400) };
check('26. A file whose bytes contradict its declared type is refused',
  call('validateRequiredBookMedia', lying).ok === false);

const oversize = allFour();
oversize.frontCoverImage = img(9 * 1024 * 1024);
check('27. An oversized image is refused server-side',
  call('validateRequiredBookMedia', oversize).ok === false);

const executable = allFour();
executable.frontCoverImage = { fileName: 'x.exe', mimeType: 'application/x-msdownload',
                               base64Data: 'data:application/x-msdownload;base64,AAAA' };
check('28. A non-image in an image slot is refused',
  call('validateRequiredBookMedia', executable).ok === false);

// A catalogue cover is a URL, not an uploaded file, so it cannot even be
// offered here — which is the structural reason it cannot satisfy the
// reader's own front-cover requirement.
const catalogueCover = allFour();
catalogueCover.frontCoverImage = 'https://covers.openlibrary.org/b/id/123-M.jpg';
check('29. A catalogue cover URL cannot stand in for the physical front cover',
  call('validateRequiredBookMedia', catalogueCover).ok === false);

// ═══════════════ 5. AUTHENTICITY BARS THE TRANSACTION ═══════════════════
console.log('\n--- an unauthorised copy is barred at the server ---');

const pirated = {
  authenticityStatus: 'UNAUTHORISED', printedMrp: 500,
  sell: 'TRUE', rent: 'TRUE', lend: 'TRUE', permanent_exchange: 'TRUE',
};
const pe = call('bookTransactionEligibility', pirated);
check('30. An unauthorised copy cannot be sold', pe.can_sell === false);
check('31. ...cannot be swapped', pe.can_swap === false);
check('32. ...cannot be rented', pe.can_rent === false);
check('33. ...cannot be lent', pe.can_lend === false);
check('34. ...even though its owner ticked every box', pe.authenticity === 'UNAUTHORISED');

const original = {
  authenticityStatus: 'ORIGINAL', printedMrp: 500, sell: 'TRUE', rent: 'TRUE',
};
const oe = call('bookTransactionEligibility', original);
check('35. An original book is eligible for what its owner offered',
  oe.can_sell === true && oe.can_rent === true);
check('36. ...and not for what they did not offer',
  oe.can_lend === false && oe.can_swap === false);

const noMrp = { authenticityStatus: 'ORIGINAL', rent: 'TRUE' };
check('37. Rent needs a printed MRP — without one it is unavailable, not free',
  call('bookTransactionEligibility', noMrp).can_rent === false);

console.log('\n--- authenticity is never silently upgraded ---');
check('38. An undeclared copy reads as UNKNOWN, not ORIGINAL',
  call('bookAuthenticity', { title: 'x' }) === 'UNKNOWN');
check('39. An old UNOFFICIAL declaration still reads as unauthorised',
  call('bookAuthenticity', { bookEdition: 'UNOFFICIAL' }) === 'UNAUTHORISED');
check('40. American and British spellings mean the same thing',
  call('normalizeAuthenticity', 'unauthorized') === 'UNAUTHORISED'
  && call('normalizeAuthenticity', 'PIRATED') === 'UNAUTHORISED');
check('41. An unrecognised value falls to UNKNOWN, never to ORIGINAL',
  call('normalizeAuthenticity', 'probably fine') === 'UNKNOWN');

// ══════════════════════════ 6. FORMAT ═══════════════════════════════════
console.log('\n--- hardcover survives every spelling ---');

check('42. Hardcover is a format the server accepts',
  call('normalizeBookFormat', 'HARDCOVER') === 'HARDCOVER');
check('43. Open Library\'s "Hardback" is a hardcover',
  call('normalizeBookFormat', 'Hardback') === 'HARDCOVER');
check('44. So is "hardbound"', call('normalizeBookFormat', 'hardbound') === 'HARDCOVER');
check('45. Mass-market paperback is a paperback',
  call('normalizeBookFormat', 'Mass Market Paperback') === 'PAPERBACK');
check('46. Trade paperback is a paperback',
  call('normalizeBookFormat', 'TRADE_PAPERBACK') === 'PAPERBACK');
check('47. An unplaceable binding is UNKNOWN, not silently a paperback',
  call('normalizeBookFormat', 'Spiral bound') === '');

// ── a link is not a photograph ─────────────────────────────────────────
//
// The four files travel as bytes inside the request. A caller sending a
// URL where a file belongs is refused: an unchecked URL means a listing
// whose "photograph of my copy" is a link to somebody else's website, and
// the whole point of asking for these four is that they show THIS copy.
console.log('\n--- a pasted link is not an uploaded file ---');

const linked = allFour();
linked.frontCoverImage = { url: 'https://someone-elses-site.example/cover.jpg' };
check('48. A URL sent in place of a file is refused',
  call('validateRequiredBookMedia', linked).ok === false);

const linkedString = allFour();
linkedString.backCoverImage = 'https://images.example/back.jpg';
check('49. ...including a bare string URL',
  call('validateRequiredBookMedia', linkedString).ok === false);

const catalogueLink = allFour();
catalogueLink.frontCoverImage = { url: 'https://covers.openlibrary.org/b/id/123-M.jpg' };
check('50. A catalogue cover URL still cannot satisfy the front cover',
  call('validateRequiredBookMedia', catalogueLink).ok === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
