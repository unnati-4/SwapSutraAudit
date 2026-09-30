/**
 * test_catalogue_integration.cjs
 *
 * The Apps Script side of the catalogue integration, against the shipped
 * appsscript.js rather than a re-implementation.
 *
 * What matters here is the SEAM. The pricing authority moved to Postgres,
 * but SwapSutra has real users and a listing must not fail because a
 * database is briefly unreachable. So there are two engines, and the
 * interesting cases are all about which one answers and when:
 *
 *   - Supabase configured and answering  -> Supabase decides, always.
 *   - Supabase says NO                   -> that refusal is authoritative.
 *   - Supabase unreachable               -> the sheet answers, and the
 *                                           listing is marked so it can be
 *                                           found and recomputed later.
 *   - Unofficial copy                    -> refused before either engine
 *                                           is consulted at all.
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
let fetchLog = [];
let fetchImpl = () => { throw new Error('no fetch configured'); };

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
  UrlFetchApp: {
    fetch(url, opts) {
      fetchLog.push({ url, opts });
      return fetchImpl(url, opts);
    },
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
    newBlob: (b) => ({ getDataAsString: () => Buffer.from(b.map(x => x & 0xff)).toString('utf8') }),
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
const run = (expr) => vm.runInContext(expr, ctx);

function reply(code, body) {
  return {
    getResponseCode: () => code,
    getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ══════════════════════════════════════════════ the condition ladder
console.log('\n--- five grades, without breaking the three that shipped ---');

check('1. "Like New" from an existing listing maps to AS_NEW',
  run('normalizeConditionGrade("Like New")') === 'AS_NEW');
check('2. "Good" is unchanged', run('normalizeConditionGrade("Good")') === 'GOOD');
check('3. "Fair" is unchanged', run('normalizeConditionGrade("Fair")') === 'FAIR');
check('4. The new "As New" maps to itself',
  run('normalizeConditionGrade("As New")') === 'AS_NEW');
check('5. The new "Very Good" maps to itself',
  run('normalizeConditionGrade("Very Good")') === 'VERY_GOOD');
check('6. "Poor" maps to POOR', run('normalizeConditionGrade("Poor")') === 'POOR');
// Failing toward the middle is the smallest error available: it neither
// over-prices nor under-prices as badly as either extreme would.
check('7. An unrecognised grade lands on GOOD, the middle rung',
  run('normalizeConditionGrade("pristine")') === 'GOOD');
check('8. An empty grade lands on GOOD too',
  run('normalizeConditionGrade("")') === 'GOOD');

console.log('\n--- format and edition map onto the catalogue enums ---');
check('9. PAPERBACK -> TRADE_PAPERBACK',
  run('catalogueFormat_("PAPERBACK")') === 'TRADE_PAPERBACK');
check('10. HARDCOVER -> HARDCOVER', run('catalogueFormat_("HARDCOVER")') === 'HARDCOVER');
check('11. MASS_MARKET -> MASS_MARKET_PAPERBACK',
  run('catalogueFormat_("MASS_MARKET")') === 'MASS_MARKET_PAPERBACK');
check('12. The old copyType ORIGINAL -> PUBLISHER',
  run('catalogueTier_("ORIGINAL")') === 'PUBLISHER');
check('13. REPRINT -> INDIAN_REPRINT', run('catalogueTier_("REPRINT")') === 'INDIAN_REPRINT');
check('14. PIRATED -> UNOFFICIAL', run('catalogueTier_("PIRATED")') === 'UNOFFICIAL');
check('15. Anything unrecognised -> NOT_SURE, never PUBLISHER',
  run('catalogueTier_("mystery")') === 'NOT_SURE');

// ═══════════════════════════════════ which engine answers, and when
console.log('\n--- Supabase is authoritative when it answers ---');

scriptProperties.set('SUPABASE_URL', 'https://example.supabase.co');
scriptProperties.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');

fetchLog = [];
fetchImpl = () => reply(200, {
  ok: true, priceable: true, sell_price: 135, allowed_min: 120, allowed_max: 150,
  reference_price: 135, deposit: 81, methodology: 'MRP_DERIVED', confidence: 0.55,
});
let r = run(`resolveListingPricing({
  isbn: '9789390085255', bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER',
  condition: 'Very Good', sellPrice: 135, email: 'a@x.com'
}, 'L1')`);

check('16. A successful catalogue call decides the price',
  r.ok === true && r.source === 'SUPABASE' && r.referencePrice === 135, JSON.stringify(r));
check('17. ...and the deposit comes back with it', r.deposit === 81);
check('18. The call went to validate_and_record_listing',
  fetchLog.length === 1 && /rpc\/validate_and_record_listing$/.test(fetchLog[0].url),
  fetchLog[0] && fetchLog[0].url);

// A refusal from the catalogue is authoritative. Falling back to the sheet
// here would let a rejected price through by way of a second opinion.
fetchImpl = () => reply(200, {
  ok: false, error: 'PRICE_OUT_OF_RANGE', message: 'Allowed range is Rs.120 to Rs.150.',
  allowed_min: 120, allowed_max: 150, suggested: 135,
});
r = run(`resolveListingPricing({
  isbn: '9789390085255', bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER',
  condition: 'Very Good', sellPrice: 900, email: 'a@x.com'
}, 'L2')`);
check('19. A refusal from the catalogue is final — no second opinion',
  r.ok === false && r.error === 'PRICE_OUT_OF_RANGE', JSON.stringify(r));
check('20. ...and the allowed range comes back so the reader is told',
  r.allowedMin === 120 && r.allowedMax === 150);

console.log('\n--- an outage degrades, it does not block ---');

fetchImpl = () => { throw new Error('ECONNREFUSED'); };
r = run(`resolveListingPricing({
  isbn: '9789390085255', bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER',
  genre: 'Fiction', condition: 'Good', email: 'a@x.com'
}, 'L3')`);
check('21. An unreachable catalogue falls back to the sheet rather than failing',
  r.ok === true && r.source === 'SHEET_FALLBACK', JSON.stringify(r));
check('22. ...and the fallback is LABELLED, so those listings can be found later',
  r.methodology === 'SHEET_FALLBACK');
check('23. ...with a low confidence, because it is a weaker answer',
  r.confidence <= 0.35);

fetchImpl = () => reply(500, 'Internal Server Error');
r = run(`resolveListingPricing({
  isbn: '9789390085255', bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER',
  genre: 'Fiction', condition: 'Good', email: 'a@x.com'
}, 'L4')`);
check('24. A 5xx is treated as unreachable, not as a refusal',
  r.ok === true && r.source === 'SHEET_FALLBACK');

scriptProperties.delete('SUPABASE_URL');
scriptProperties.delete('SUPABASE_SERVICE_ROLE_KEY');
r = run(`resolveListingPricing({
  isbn: '9789390085255', bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER',
  genre: 'Fiction', condition: 'Good', email: 'a@x.com'
}, 'L5')`);
check('25. An unconfigured deployment still lists books, via the sheet',
  r.ok === true && r.source === 'SHEET_FALLBACK');

// ═════════════════════════════════════════ unauthorised copies
console.log('\n--- an unofficial copy is refused before either engine runs ---');

scriptProperties.set('SUPABASE_URL', 'https://example.supabase.co');
scriptProperties.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
fetchLog = [];
fetchImpl = () => reply(200, { ok: true, priceable: true, reference_price: 500, deposit: 300 });

r = run(`resolveListingPricing({
  isbn: '9789390085255', bookFormat: 'PAPERBACK', bookEdition: 'UNOFFICIAL',
  condition: 'Good', sellPrice: 150, email: 'a@x.com'
}, 'L6')`);
check('26. Selling an unofficial copy is refused',
  r.ok === false && r.error === 'UNOFFICIAL_NOT_SALEABLE', JSON.stringify(r));
check('27. ...without the catalogue even being asked',
  fetchLog.length === 0, `${fetchLog.length} calls made`);

fetchLog = [];
r = run(`resolveListingPricing({
  isbn: '9789390085255', bookFormat: 'PAPERBACK', bookEdition: 'UNOFFICIAL',
  condition: 'Good', email: 'a@x.com'
}, 'L7')`);
check('28. Listing one WITHOUT a price is allowed, and carries no price',
  r.ok === true && r.priceable === false && r.referencePrice === undefined,
  JSON.stringify(r));

// ═════════════════════════════════════════ the client cannot set a price
console.log('\n--- the client is not authoritative for anything that moves money ---');

const src = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

check('29. createBook does not write a client-supplied mrp',
  !/h === 'mrp'\) row\[i\] = data\.mrp/.test(src));
check('30. createSwapRequest does not accept a client-supplied deposit',
  !/data\.securityDeposit/.test(src));
check('31. The deposit rate is defined once', /const DEPOSIT_RATE = 0\.6;/.test(src));
check('32. The listing price path runs through resolveListingPricing',
  /const pricing = resolveListingPricing\(data, id\)/.test(src));
check('33. A rejected price stops the listing rather than being ignored',
  /if \(!pricing\.ok\) \{[\s\S]{0,200}return \{[\s\S]{0,200}success: false/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
