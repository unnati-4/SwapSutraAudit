/**
 * test_book_pricing.cjs
 *
 * The price on a listing decides how much money the OTHER reader has to
 * put down, so it is the one number in the app an owner must not be able
 * to set. These tests run the shipped resolveBookPrice / computeMutualDeposit
 * from appsscript.js against a stubbed price table.
 *
 * The cases that matter are the ones that look like edge cases and are not:
 *
 *   - The three tiers are NOT a ladder. Wilco and Fingerprint sell classic
 *     HARDCOVERS at ~Rs.299 while the Penguin paperback is Rs.399, so any
 *     code that derives one tier from another with a multiplier is wrong
 *     for a whole genre.
 *   - A blank tier means "no such edition exists", not zero. Chetan Bhagat
 *     has no hardcover; JEE prep and South Asia medical editions have no
 *     cheaper legitimate tier. Blank must fall through to the lowest tier
 *     that is real, never price at 0.
 *   - "Not sure" must land on the cheapest legitimate tier. An owner who
 *     does not know what they have should never set someone else's deposit
 *     by an optimistic assumption.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label); }
}

const scriptProperties = new Map();
const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (scriptProperties.has(k) ? scriptProperties.get(k) : null),
      setProperty: (k, v) => { scriptProperties.set(k, v); },
      deleteProperty: (k) => { scriptProperties.delete(k); }
    })
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) =>
      Array.from(crypto.createHmac('sha256', Buffer.from(String(k))).update(Buffer.from(String(v))).digest()),
    base64EncodeWebSafe: (i) =>
      (Array.isArray(i) ? Buffer.from(i.map(b => b & 0xff)) : Buffer.from(String(i), 'utf8'))
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) =>
      Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (b) => ({ getDataAsString: () => Buffer.from(b.map(x => x & 0xff)).toString('utf8') })
  },
  CacheService: {
    getScriptCache: () => ({ get: () => null, put() {}, remove() {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8'), ctx, { filename: 'appsscript.js' });
const run = (e) => vm.runInContext(e, ctx);

// The sheets are stubbed, not the logic. loadPriceTables is the only seam:
// everything under test reads through it.
run(`
__SS_PRICE_TABLES__ = {
  byIsbn: {
    // A classic where the hardcover is CHEAPER than the paperback.
    "9788182527218": { title: "Pride and Prejudice", genre: "Classics", unit: "single",
                       hardcover: 299, paperback: 399, reprint: 175, confidence: "V" },
    // Indian mass-market: no hardcover exists at all.
    "9788129124029": { title: "Half Girlfriend", genre: "Indian Literature", unit: "single",
                       hardcover: null, paperback: 195, reprint: null, confidence: "V" },
    // South Asia medical edition: no cheaper legitimate tier.
    "9788131267486": { title: "Gray's Anatomy for Students", genre: "Medical & Nursing", unit: "set of 2",
                       hardcover: null, paperback: 3995, reprint: null, confidence: "V" }
  },
  byGenre: {
    "Classics":          { hardcover: 399, paperback: 399, reprint: 175 },
    "Indian Literature": { hardcover: 599, paperback: 399, reprint: 195 },
    "Competitive Exams": { hardcover: null, paperback: 450, reprint: null },
    "Other":             { hardcover: 699, paperback: 450, reprint: 250 }
  }
};
`);

const price = (o) => run(`resolveBookPrice(${JSON.stringify(o)})`);

// ─────────────────────────────────────────── the owner's choice picks a tier
console.log('\n--- The owner\'s format/edition choice picks the column ---');

check('1. Hardcover + publisher reads the hardcover column',
  price({ isbn: '9788182527218', format: 'HARDCOVER', edition: 'PUBLISHER' }).amount === 299);

check('2. Paperback + publisher reads the paperback column',
  price({ isbn: '9788182527218', format: 'PAPERBACK', edition: 'PUBLISHER' }).amount === 399);

check('3. Paperback + budget reprint reads the reprint column',
  price({ isbn: '9788182527218', format: 'PAPERBACK', edition: 'REPRINT' }).amount === 175);

// This is the one a multiplier-based design gets wrong.
check('4. A classic hardcover costs LESS than its paperback, and the code allows that',
  price({ isbn: '9788182527218', format: 'HARDCOVER', edition: 'PUBLISHER' }).amount <
  price({ isbn: '9788182527218', format: 'PAPERBACK', edition: 'PUBLISHER' }).amount);

// ─────────────────────────────────────────── "not sure" is never optimistic
console.log('\n--- "Not sure" lands on the cheapest legitimate tier ---');

check('5. Not sure on a book with all three tiers takes the cheapest',
  price({ isbn: '9788182527218', format: 'PAPERBACK', edition: 'NOT_SURE' }).amount === 175);

check('6. Not sure ignores the format too — hardcover + not sure is still the floor',
  price({ isbn: '9788182527218', format: 'HARDCOVER', edition: 'NOT_SURE' }).amount === 175);

check('7. Not sure reports which tier it actually used',
  price({ isbn: '9788182527218', format: 'PAPERBACK', edition: 'NOT_SURE' }).tier === 'reprint');

// ─────────────────────────────────────────── blank means absent, not zero
console.log('\n--- A missing tier falls through instead of pricing at zero ---');

const bhagatHb = price({ isbn: '9788129124029', format: 'HARDCOVER', edition: 'PUBLISHER' });
check('8. Asking for a hardcover that does not exist does not return 0',
  bhagatHb.amount === 195);
check('9. ...and it says the tier it fell back to',
  bhagatHb.tier === 'paperback');

const grays = price({ isbn: '9788131267486', format: 'PAPERBACK', edition: 'NOT_SURE' });
check('10. A South Asia medical edition has no cheaper tier, so "not sure" stays at full price',
  grays.amount === 3995);

// ─────────────────────────────────────────── genre fallback
console.log('\n--- An unlisted ISBN falls back to its genre ---');

const unlisted = price({ isbn: '9780143454212', genre: 'Indian Literature', format: 'PAPERBACK', edition: 'PUBLISHER' });
check('11. An ISBN not on the list uses the genre rate', unlisted.amount === 399);
check('12. ...and says so, so the listing can be found and corrected later',
  unlisted.basis === 'genre');

check('13. A known ISBN reports basis "isbn"',
  price({ isbn: '9788129124029', format: 'PAPERBACK', edition: 'PUBLISHER' }).basis === 'isbn');

check('14. An unknown genre falls back to Other rather than to nothing',
  price({ isbn: '', genre: 'Nonexistent Genre', format: 'PAPERBACK', edition: 'PUBLISHER' }).amount === 450);

check('15. A genre with no reprint tier does not price at zero',
  price({ isbn: '', genre: 'Competitive Exams', format: 'PAPERBACK', edition: 'REPRINT' }).amount === 450);

// ─────────────────────────────────────────── old listings still price
console.log('\n--- Listings from before this feature still resolve ---');

check('16. The old copyType ORIGINAL maps to the publisher edition',
  run('normalizeBookEdition("ORIGINAL")') === 'PUBLISHER');

check('17. A book row carrying only the old copyType still yields an edition',
  run('bookEditionFrom({ copyType: "REPRINT" })') === 'REPRINT');

check('18. A book row with no format at all defaults to paperback, not blank',
  run('bookFormatFrom({})') === 'PAPERBACK');

check('19. An unrecognised format is rejected rather than stored',
  run('normalizeBookFormat("LEATHER_BOUND")') === '');

// ─────────────────────────────────────────── the mutual deposit
console.log('\n--- Both readers deposit 60% of the OTHER book ---');

const A = { id: 'a', mrp: 200 };    // cheap novel
const B = { id: 'b', mrp: 2000 };   // expensive textbook
const swap = run(`computeMutualDeposit(${JSON.stringify(B)}, ${JSON.stringify(A)}, 'SWAP')`);

check('20. The requester deposits 60% of the book they are receiving',
  swap.requesterDeposit === 1200);
check('21. The owner deposits 60% of the book they are receiving',
  swap.ownerDeposit === 120);
check('22. The two deposits are deliberately asymmetric, following the two book values',
  swap.requesterDeposit !== swap.ownerDeposit);

const rent = run(`computeMutualDeposit(${JSON.stringify(B)}, null, 'RENT')`);
check('23. A rental moves one book, so only the renter deposits',
  rent.requesterDeposit === 1200 && rent.ownerDeposit === 0);

const sell = run(`computeMutualDeposit(${JSON.stringify(B)}, null, 'SELL')`);
check('24. A sale has no owner deposit either', sell.ownerDeposit === 0);

// This test used to assert that lending is two-way, and it was asserting a
// bug. LEND meant "temporary swap" back then — the two were the same code
// path, and a LEND request was authorised by the temporary_exchange flag.
// Now they are separate transactions, and a loan is genuinely one-way: one
// book goes out, nothing comes back in exchange. Charging the lender a
// deposit meant asking someone for money to lend their own book.
const lend = run(`computeMutualDeposit(${JSON.stringify(B)}, ${JSON.stringify(A)}, 'LEND')`);
check('25. Lending is one-way, so only the borrower deposits',
  lend.requesterDeposit === 1200 && lend.ownerDeposit === 0,
  JSON.stringify({ requester: lend.requesterDeposit, owner: lend.ownerDeposit }));
check('25b. A swap is still two-way — the two are no longer the same path',
  swap.requesterDeposit === 1200 && swap.ownerDeposit === 120);

// The first version of this test expected 0 and failed, which was the
// test being wrong rather than the code: a book with nothing to go on
// falls back to the generic "Other" genre rate, which is a better answer
// than pricing someone's deposit at zero. What actually matters is that
// the number is real.
const noPrice = run(`computeMutualDeposit({ id: 'x' }, null, 'RENT')`);
check('26. A book with no ISBN and no genre still yields a real deposit, never NaN',
  Number.isFinite(noPrice.requesterDeposit) && noPrice.requesterDeposit === 150);
// 150 rather than 270 because a row with no edition reads as NOT_SURE,
// which takes the cheapest tier of the generic "Other" rate (Rs.250), not
// its paperback (Rs.450). That is the right way round: the less the
// platform knows about a book, the less it makes someone put down.
check('27. Knowing nothing about a book produces the CHEAPEST generic rate, not the middle one',
  noPrice.requestedBookValue === 250);

check('28. Rounding lands on whole rupees',
  Number.isInteger(run(`depositFor(195)`)) && run('depositFor(195)') === 117);

// ─────────────────────────────────────────── the client cannot set a price
console.log('\n--- The client cannot supply an amount ---');

// Comments are stripped first. Tests 29 and 30 originally failed against
// the comments that EXPLAIN the removal — a line reading "'mrp' is
// deliberately ABSENT" matched a search for 'mrp'. Searching source text
// for the absence of something has to look at code only.
const src = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

check('29. createBook no longer writes data.mrp into the row',
  !/h === 'mrp'\) row\[i\] = data\.mrp/.test(src));

check('30. mrp is not in updateUserBook\'s allowed fields',
  !/allowedFields = \[[^\]]*'mrp'/.test(src));

check('31. createSwapRequest no longer accepts data.securityDeposit',
  !/data\.securityDeposit/.test(src));

check('32. The deposit rate is defined once, not repeated as a literal',
  /const DEPOSIT_RATE = 0\.6;/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
