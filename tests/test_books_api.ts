/**
 * tests/test_books_api.ts
 *
 * The pure functions in api/books.ts, pinned.
 *
 * These are the ones where a bug is silent and expensive:
 *   - an ISBN that validates wrongly prices the WRONG BOOK, and then takes
 *     a deposit calculated from that price;
 *   - a physical_format that normalises wrongly prices the wrong rung of
 *     the condition ladder (a mass-market paperback read as a trade
 *     paperback prices roughly twice too high);
 *   - a hallucinated price that gets past the extraction gate becomes a
 *     financial input with no evidence behind it.
 *
 * Run: npx tsx tests/test_books_api.ts
 */

import { readFileSync } from 'node:fs';
import { __test } from '../api/books.js';

const {
  canonicalIsbn13, isValidIsbn10, isValidIsbn13, isbn10to13,
  normaliseFormat, inferEditionTier, extractYear, verifyExtraction,
} = __test;

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.log(`FAIL: ${label}${detail ? `  [${detail}]` : ''}`); }
}

// ── ISBN validation ─────────────────────────────────────────────────────
console.log('\n--- ISBN validation and normalisation ---');

check('1. A real ISBN-13 validates', isValidIsbn13('9789390085255'));
check('2. A wrong check digit is rejected', !isValidIsbn13('9789390085256'));
check('3. A real ISBN-10 validates', isValidIsbn10('0691023565'));
check('4. An ISBN-10 with an X check digit validates', isValidIsbn10('080442957X'));
check('5. A wrong ISBN-10 check digit is rejected', !isValidIsbn10('0691023566'));

check('6. ISBN-10 converts to the right ISBN-13',
  isbn10to13('0691023565') === '9780691023564', String(isbn10to13('0691023565')));
check('7. Hyphens and spaces are stripped',
  canonicalIsbn13('978-93-90085-25-5') === '9789390085255');
check('8. An ISBN-10 input yields the canonical 13',
  canonicalIsbn13('0691023565') === '9780691023564');
check('9. An invalid ISBN yields null, never a guess',
  canonicalIsbn13('9789390085256') === null);
check('10. Junk yields null', canonicalIsbn13('not an isbn') === null);
check('11. An empty input yields null', canonicalIsbn13('') === null);

// ── format normalisation ────────────────────────────────────────────────
console.log('\n--- physical_format is free text in Open Library ---');

check('12. "Paperback" -> TRADE_PAPERBACK', normaliseFormat('Paperback') === 'TRADE_PAPERBACK');
check('13. "pbk." -> TRADE_PAPERBACK', normaliseFormat('pbk.') === 'TRADE_PAPERBACK');
check('14. "Hardcover" -> HARDCOVER', normaliseFormat('Hardcover') === 'HARDCOVER');
check('15. "Hardback" -> HARDCOVER', normaliseFormat('Hardback') === 'HARDCOVER');

// The ordering trap: mass-market contains the word "paperback", so a naive
// rule order collapses it into TRADE_PAPERBACK and prices it ~2x too high.
check('16. "Mass Market Paperback" does NOT collapse into TRADE_PAPERBACK',
  normaliseFormat('Mass Market Paperback') === 'MASS_MARKET_PAPERBACK',
  normaliseFormat('Mass Market Paperback'));
check('17. "mass-market paperback" too, lowercased and hyphenated',
  normaliseFormat('mass-market paperback') === 'MASS_MARKET_PAPERBACK');

check('18. Unrecognised text is UNKNOWN, never a guess',
  normaliseFormat('Leather bound presentation copy') === 'UNKNOWN');
check('19. Empty is UNKNOWN', normaliseFormat('') === 'UNKNOWN');
check('20. Null is UNKNOWN', normaliseFormat(null) === 'UNKNOWN');

// ── edition tier ────────────────────────────────────────────────────────
console.log('\n--- edition tier is inferred conservatively ---');

check('21. "3rd South Asia Edition" -> INDIAN_REPRINT',
  inferEditionTier('3rd South Asia Edition', 'Elsevier') === 'INDIAN_REPRINT');
check('22. "Indian Edition" -> INDIAN_REPRINT',
  inferEditionTier('Indian Edition', 'Wiley') === 'INDIAN_REPRINT');
check('23. "International Student Edition" -> INDIAN_REPRINT',
  inferEditionTier('International Student Edition', undefined) === 'INDIAN_REPRINT');
// Guessing PUBLISHER when unknown is the direction that OVER-prices, which
// takes too much off the other reader.
check('24. Nothing recognisable -> NOT_SURE, not PUBLISHER',
  inferEditionTier(undefined, 'Penguin') === 'NOT_SURE');

// ── publish_date is free text ───────────────────────────────────────────
console.log('\n--- publish_date is free text, not a date ---');

check('25. "1998"', extractYear('1998') === 1998);
check('26. "March 1998"', extractYear('March 1998') === 1998);
check('27. "c1998"', extractYear('c1998') === 1998);
check('28. "1998-03-01"', extractYear('1998-03-01') === 1998);
check('29. Nonsense yields null', extractYear('no date here') === null);
check('30. A year outside the plausible range yields null', extractYear('1200') === null);

// ── the hallucination gate ──────────────────────────────────────────────
console.log('\n--- Gemini output is evidence, and evidence is checked ---');

const PAGE = 'Atomic Habits by James Clear. Paperback. M.R.P.: ₹399.00. '
           + 'Kindle edition ₹199.00. Publisher: Manjul Publishing, Indian edition.';

const good = verifyExtraction(
  { price: 399, currency: 'INR', kind: 'MRP', format: 'TRADE_PAPERBACK', quote: 'M.R.P.: ₹399.00' },
  PAGE, 'Self Help');
check('31. A price quoted verbatim from the page is accepted', good.accepted);

const hallucinated = verifyExtraction(
  { price: 450, currency: 'INR', kind: 'NEW_RETAIL', format: 'TRADE_PAPERBACK', quote: 'Price: ₹450.00' },
  PAGE, 'Self Help');
check('32. A quote that is not in the source is rejected as hallucinated',
  !hallucinated.accepted && /hallucinated/.test(hallucinated.reason || ''),
  hallucinated.reason || '');

const mismatched = verifyExtraction(
  { price: 12, currency: 'INR', kind: 'NEW_RETAIL', format: 'TRADE_PAPERBACK', quote: 'M.R.P.: ₹399.00' },
  PAGE, 'Self Help');
check('33. A price that is not inside its own quote is rejected', !mismatched.accepted,
  mismatched.reason || '');

const ebook = verifyExtraction(
  { price: 199, currency: 'INR', kind: 'EBOOK', format: 'TRADE_PAPERBACK', quote: 'Kindle edition ₹199.00' },
  PAGE, 'Self Help');
check('34. An ebook price is accepted but forced formatless, so it can never '
    + 'enter a print band', ebook.accepted && ebook.format === 'UNKNOWN', ebook.format);

const usd = verifyExtraction(
  { price: 399, currency: 'USD', kind: 'MRP', format: 'TRADE_PAPERBACK', quote: 'M.R.P.: ₹399.00' },
  PAGE, 'Self Help');
check('35. A non-INR price is rejected — no conversion is ever performed',
  !usd.accepted, usd.reason || '');

const absurd = verifyExtraction(
  { price: 4, currency: 'INR', kind: 'MRP', format: 'TRADE_PAPERBACK', quote: 'M.R.P.: ₹399.00' },
  PAGE, 'Self Help');
check('36. An implausible price is rejected even when the quote checks out',
  !absurd.accepted, absurd.reason || '');

const noQuote = verifyExtraction(
  { price: 399, currency: 'INR', kind: 'MRP', format: 'TRADE_PAPERBACK' }, PAGE, 'Self Help');
check('37. A price with no quote at all is rejected', !noQuote.accepted, noQuote.reason || '');

const badKind = verifyExtraction(
  { price: 399, currency: 'INR', kind: 'GUESS', format: 'TRADE_PAPERBACK', quote: 'M.R.P.: ₹399.00' },
  PAGE, 'Self Help');
check('38. An unknown price kind is rejected', !badKind.accepted, badKind.reason || '');

// A rejection always carries a reason, because rejected observations are
// STORED with that reason rather than dropped.
check('39. Every rejection carries a reason that can be stored and audited',
  [hallucinated, mismatched, usd, absurd, noQuote, badKind]
    .every(r => !r.accepted && typeof r.reason === 'string' && r.reason.length > 0));

// A textbook price that would be absurd for a novel must survive in its own
// category — the bounds reject the absurd, not the merely surprising.
const textbook = verifyExtraction(
  { price: 3995, currency: 'INR', kind: 'MRP', format: 'HARDCOVER',
    quote: "Gray's Anatomy South Asia Edition ₹3995" },
  "Gray's Anatomy South Asia Edition ₹3995", 'Medical & Nursing');
check('40. A Rs.3995 medical textbook is plausible in its own category',
  textbook.accepted, textbook.reason || '');


// ── the corrections ─────────────────────────────────────────────────────
console.log('\n--- no legal overclaims, and no LLM-trusted MRP ---');

const apiSrc = readFileSync(new URL('../api/books.ts', import.meta.url), 'utf8');

// The wording corrections, pinned so they cannot drift back in. These were
// claims about Indian law that this codebase is not competent to make — and
// one of them, automatic forfeiture of intermediary safe harbour, is not
// something that can be asserted as a certainty at all.
for (const banned of ['legal ceiling', 'legal maximum', 'safe harbour',
                      'safe harbor', 's.79', 'criminal exposure', 'legally required']) {
  check(`41. api/books.ts does not claim "${banned}"`,
    !apiSrc.toLowerCase().includes(banned.toLowerCase()));
}

// The same phrases must not survive in reader-facing copy either. A heading
// reading "Safe Harbor" over a paragraph about contact details is not a claim
// about intermediary liability, but it is the kind of borrowed legal label
// that gets quoted back at you later, so the UI does not use one.
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
for (const banned of ['legal ceiling', 'legal maximum', 'safe harbour',
                      'safe harbor', 's.79', 'criminal exposure']) {
  check(`41b. src/App.tsx does not use "${banned}"`,
    !appSrc.toLowerCase().includes(banned.toLowerCase()));
}

// The behavioural half: an extracted MRP with no source page behind it must
// not reach a tier the pricing engine will anchor on.
check('42. An extracted MRP is tiered by whether a real source page backs it',
  /evidence_tier[\s\S]{0,300}PUBLISHER_SOURCED[\s\S]{0,100}USER_PROVISIONAL/.test(apiSrc),
  'evidence_tier assignment not found in the extraction path');

check('43. No automated path ever assigns PHOTO_VERIFIED',
  !/evidence_tier[^\n]*PHOTO_VERIFIED/.test(apiSrc),
  'an automated path assigns PHOTO_VERIFIED');

check('44. The only route to PHOTO_VERIFIED is an explicit admin action',
  apiSrc.includes("action === 'verifyMrpPhoto'") && apiSrc.includes('verify_mrp_from_photo'));

check('45. An admin-entered MRP with no source is provisional too — no staff exemption',
  /evidence_tier: String\(b\.kind[\s\S]{0,160}b\.sourceUrl \? 'PUBLISHER_SOURCED' : 'USER_PROVISIONAL'/.test(apiSrc));

// Open Library: the bulk path is the dumps, and this file says so.
console.log('\n--- Open Library: dumps for bulk, API only for cache misses ---');

check('46. The API path documents itself as the cache-miss path, not bulk ingestion',
  /CACHE-MISS PATH, NOT THE BULK-INGESTION PATH/.test(apiSrc));

check('47. ...and points at the dump pipeline for bulk',
  /ingest_openlibrary\.py/.test(apiSrc) && /002_staging\.sql/.test(apiSrc));

check('48. It no longer claims a dump download is unnecessary',
  !/No dump download/i.test(apiSrc));

// The bulk ingester must make NO per-book HTTP calls — that is the whole
// point of using the dumps rather than the API.
const ingestSrc = readFileSync(
  new URL('../pricing/pipeline/ingest_openlibrary.py', import.meta.url), 'utf8');
const TRIPLE = String.fromCharCode(34, 34, 34);
const ingestCode = ingestSrc
  .split(TRIPLE).filter((_, i) => i % 2 === 0).join('')
  .split('\n').map(l => l.replace(/#.*$/, '')).join('\n');

check('49. The bulk ingester makes no per-book HTTP calls',
  !/openlibrary\.org\/isbn/.test(ingestCode) && !/openlibrary\.org\/books/.test(ingestCode),
  'a per-book endpoint appears in the ingester');

check('50. Its only network call is resolving the dump URL',
  (ingestCode.match(/urlopen|requests\.get|urlretrieve/g) || []).length <= 1,
  'more than one network call in the bulk ingester');

check('51. It reads from a gzipped dump file, not from an API',
  /gzip\.open/.test(ingestCode) && /ol_dump_editions/.test(ingestSrc));

// The three figures, named and separate.
console.log('\n--- the three figures are named and kept apart ---');

check('52. The quote handler names the allowed listing range',
  /ALLOWED LISTING RANGE/.test(apiSrc));
check('53. ...the reference value, disclaimed as not a market-value claim',
  /REFERENCE/.test(apiSrc) && /not a claim about market value/i.test(apiSrc));
check('54. ...and the security deposit, derived from the reference',
  /SECURITY DEPOSIT/.test(apiSrc) && /never from whatever the/i.test(apiSrc));

// ── ISBN lookup goes through the catalogue, not straight to Google ──────
//
// The listing form was still calling the old Google Books route long after
// the catalogue existed. Nothing failed loudly: lookups worked, and the
// catalogue quietly stayed empty, so every book the pricing engine was
// meant to price had no edition row behind it. It only surfaced when
// Google's unkeyed quota hit zero and lookup stopped working entirely.
console.log('\n--- ISBN lookup is wired to the catalogue ---');

check('55. The app has a route to the books API, not only to Apps Script',
  /BOOKS_API_URL/.test(appSrc) && /\/api\/books/.test(appSrc));

check('56. Lookup asks the catalogue before Google Books',
  (() => {
    const fn = appSrc.slice(appSrc.indexOf('const lookupBookMetadata'));
    const body = fn.slice(0, fn.indexOf('const clearStoredSession'));
    const cat = body.indexOf('action=lookup');
    const google = body.indexOf("action: 'lookupIsbn'");
    return cat > -1 && google > -1 && cat < google;
  })(),
  'Google Books is still queried first, or one of the two routes is missing');

check('57. Google Books survives as a fallback, not as the only path',
  /action: 'lookupIsbn'/.test(appSrc));

check('58. Neither listing form calls Google Books directly any more',
  !/performIsbnLookup[\s\S]{0,900}action: 'lookupIsbn'/.test(appSrc),
  'a form still builds its own lookupIsbn request instead of using the helper');

check("59. The catalogue's author list is flattened for the form's single line",
  /Array\.isArray\(b\.authors\) \? b\.authors\.join/.test(appSrc));

// A miss writes a row through upsert_edition_from_openlibrary. An open
// endpoint would let anyone fill the pricing catalogue with whatever they
// liked, which is worse than the quota theft the old route was gated against.
check('60. The lookup action is gated behind a signed-in session',
  /case 'lookup':[\s\S]{0,200}isSignedIn\(req\)/.test(apiSrc));

check('61. ...and refuses with AUTH_REQUIRED rather than answering anyway',
  /case 'lookup':[\s\S]{0,320}AUTH_REQUIRED/.test(apiSrc));

check('62. Identity is checked against Apps Script, not re-implemented',
  /async function resolveSession[\s\S]{0,700}APPS_SCRIPT_URL/.test(apiSrc)
  && /async function isSignedIn[\s\S]{0,200}resolveSession\(req\)/.test(apiSrc));

// ── The gate must call an action that actually exists ──────────────────
//
// The first version of this gate asked Apps Script for `verifySession`.
// There is no such action. Apps Script answered the way it answers any
// unknown action — politely, with success:false — so every signed-in
// reader was told to sign in, and nothing anywhere logged an error. The
// name of the action is the whole bug, so the name is what gets pinned.
console.log('\n--- the session gate calls a real Apps Script action ---');

const gasSrc = readFileSync(new URL('../appsscript.js', import.meta.url), 'utf8');

check('63. Apps Script routes the action the books API asks for',
  /if \(action === 'resolveSession'\) result = resolveSessionForProxy/.test(gasSrc));

check('64. It does NOT route verifySession — nothing may depend on that name',
  !/action === 'verifySession'/.test(gasSrc));

// Comments are stripped first: the word appears in a comment explaining
// why it must not appear in code, and a test that cannot tell those apart
// would force the explanation out of the file.
const apiCode = apiSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

check('65. The books API asks for resolveSession, not the name that does not exist',
  /action: 'resolveSession'/.test(apiCode) && !/verifySession/.test(apiCode),
  'api/books.ts still calls verifySession');

check('66. ...over POST, which is the only form Apps Script answers',
  /resolveSession[\s\S]{0,400}method: 'POST'/.test(apiSrc)
  || /method: 'POST'[\s\S]{0,400}resolveSession/.test(apiSrc));

check('67. Both header spellings in use across this app are accepted',
  /authorization/i.test(apiSrc) && /x-swapsutra-session/.test(apiSrc),
  'one client sends a header the gate ignores');

// Admin identity had the same defect, plus a second one: it compared an
// email taken from the request body, which the caller controls.
check('68. Admin identity comes from the verified session, not the request body',
  /async function isAdmin[\s\S]{0,400}resolveSession\(req\)/.test(apiSrc));

check('69. ...and adminEmail is no longer what decides admin access',
  !/async function isAdmin[\s\S]{0,400}adminEmail[\s\S]{0,120}ADMIN_EMAIL/.test(apiSrc));

// ── Google Books prices are never printed MRP ──────────────────────────
//
// Google's saleInfo carries listPrice and retailPrice. Neither is a
// printed MRP: retailPrice is what Google Play charges today, listPrice is
// what it charged before a discount, and for an ebook both describe a file
// with no cover to print anything on. listPrice is the dangerous one —
// it is usually the highest number available and looks exactly like an
// RRP, so it is the number somebody will eventually reach for.
console.log('\n--- a Google price is never a printed MRP ---');

const proxySrc = readFileSync(new URL('../api/swapsutra.ts', import.meta.url), 'utf8');

check('70. There is one classifier for Google prices',
  /export function classifyGooglePrice/.test(proxySrc));

check('71. It can only return NEW_RETAIL or EBOOK',
  /GooglePriceKind = 'NEW_RETAIL' \| 'EBOOK'/.test(proxySrc));

check('72. PRINTED_MRP is not reachable from it at all',
  !/PRINTED_MRP/.test(proxySrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
  'a Google price can still be classified as printed MRP');

check('73. An ebook price is classified as EBOOK',
  /isEbook \? 'EBOOK' : 'NEW_RETAIL'/.test(proxySrc));

check('74. Currencies are never converted',
  /currency !== 'INR'\) return null/.test(proxySrc));

check('75. A zero or missing amount yields nothing, not zero',
  /!Number\.isFinite\(amount\) \|\| amount <= 0/.test(proxySrc));

check('76. What Google said is not returned under the name mrp',
  /observedPrice: googlePrice/.test(proxySrc) && !/mrp: googlePrice/.test(proxySrc));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
