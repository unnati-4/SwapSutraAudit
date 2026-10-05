/**
 * test_partial_listing_deposit_funnel.cjs  (24 Sep 2026)
 *
 * Three founder decisions, tested against the shipped appsscript.js and the
 * shipped front-end helpers rather than re-implementations:
 *
 *   1. A LISTING NEEDS ONLY THE FRONT COVER. Back cover and inside photo/
 *      video become "add later to finish your listing". The book goes live
 *      at once, labelled "More photos coming", and its owner is prompted
 *      until both are added. Old listings (no named media columns) are never
 *      labelled on a guess.
 *
 *   2. AN UNVERIFIED PRICE MAKES AN ESTIMATED DEPOSIT, AND SAYS SO. The
 *      deposit is still computed and charged (disclose, don't block), but
 *      every screen that shows it to a borrower labels it an estimate.
 *
 *   3. A LISTING FUNNEL COUNTER: form opens vs listings created, Script
 *      Properties like the visitor counter, visible on Admin → Analytics.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const esbuild = require('esbuild');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const gs = read('appsscript.js');
const app = read('src/App.tsx');

// ── Apps Script sandbox ─────────────────────────────────────────────────
const scriptProperties = new Map();
const logs = [];
const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  Logger: { log: (m) => logs.push(String(m)) },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (scriptProperties.has(k) ? scriptProperties.get(k) : null),
      setProperty: (k, v) => { scriptProperties.set(k, String(v)); },
      deleteProperty: (k) => { scriptProperties.delete(k); },
    }),
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
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
vm.runInContext(gs, ctx, { filename: 'appsscript.js' });
const call = (fn, ...args) => { ctx.__args = args; return vm.runInContext(`${fn}.apply(null, __args)`, ctx); };
const plain = (v) => JSON.parse(JSON.stringify(v));

const img = (bytes = 1000, type = 'image/jpeg') => ({
  fileName: 'x.jpg', mimeType: type,
  base64Data: `data:${type};base64,` + 'A'.repeat(Math.ceil(bytes * 4 / 3)),
});
const vid = (bytes = 5000, type = 'video/mp4') => ({
  fileName: 'x.mp4', mimeType: type,
  base64Data: `data:${type};base64,` + 'A'.repeat(Math.ceil(bytes * 4 / 3)),
});

// ═══════════════════ 1. FRONT-COVER-ONLY LISTINGS ═══════════════════════
console.log('--- 1a. the validation rule ---');
const frontOnly = call('validateRequiredBookMedia', { frontCoverImage: img() });
check('1. A front cover alone passes createBook\'s media check', frontOnly.ok === true, JSON.stringify(frontOnly.messages));
const none = call('validateRequiredBookMedia', {});
check('2. No media at all is refused, naming only the front cover',
  none.ok === false && none.messages.length === 1 && /front cover/i.test(none.message), JSON.stringify(none.messages));
const noFront = call('validateRequiredBookMedia', { backCoverImage: img(), internalBookImage: img() });
check('3. Back cover + inside without the front cover is still refused',
  noFront.ok === false && plain(noFront.missing).includes('frontCoverImage'));
const badBack = call('validateRequiredBookMedia', { frontCoverImage: img(), backCoverImage: img(9 * 1024 * 1024) });
check('4. An optional file that was sent but is too large is reported, not silently dropped',
  badBack.ok === false && /too large/i.test(badBack.message), badBack.message);
check('5. The back-cover group is no longer required (server)',
  /\{ key: 'back',\s+fields: \['backCoverImage'\], required: false,/.test(gs));
check('6. The back-cover group is no longer required (form)',
  /\{ key: 'back', label: 'Back cover', fields: \['backCoverImage'\],\s*missing: 'Please add the back cover\.', required: false \}/.test(app));
check('7. Nothing in the form still counts toward a fixed "all three" total',
  !/REQUIRED_MEDIA_GROUP_COUNT/.test(app) && !/listingMediaCount|editMediaCount/.test(app) && !/'One of these two'/.test(app));

console.log('--- 1b. "finish your listing" upload (only what is sent) ---');
const onlyBack = call('validateRequiredBookMedia', { backCoverImage: img() }, { onlySubmitted: true });
check('8. Finishing: a back cover on its own is accepted', onlyBack.ok === true);
const onlyNothing = call('validateRequiredBookMedia', {}, { onlySubmitted: true });
check('9. Finishing: nothing chosen is refused with a clear message',
  onlyNothing.ok === false && /choose a photo or video/i.test(onlyNothing.message));

console.log('--- 1c. detecting an incomplete listing (server) ---');
const gaps = (b) => plain(call('listingPhotoGaps_', b));
check('10. Legacy listing (no named media columns) is never labelled', gaps({ imageUrls: 'a|b' }).length === 0);
check('11. Front only → missing back and inside', JSON.stringify(gaps({ frontCoverImage: 'f' })) === '["back","inside"]');
check('12. Front + back → missing inside', JSON.stringify(gaps({ frontCoverImage: 'f', backCoverImage: 'b' })) === '["inside"]');
check('13. Front + inside video → missing back', JSON.stringify(gaps({ frontCoverImage: 'f', internalBookVideo: 'v' })) === '["back"]');
check('14. Front + back + inside photo → complete, label drops', gaps({ frontCoverImage: 'f', backCoverImage: 'b', internalBookImage: 'i' }).length === 0);
check('15. Library/reader payloads carry missingPhotos', /safe\.missingPhotos = listingPhotoGaps_\(book\)/.test(gs) && /forAdmin\.missingPhotos = listingPhotoGaps_\(book\)/.test(gs));
check('16. The owner\'s My Books payload carries missingPhotos', /obj\.missingPhotos = listingPhotoGaps_\(obj\)/.test(gs));

console.log('--- 1d. the front-end label/prompt logic ---');
const helperStart = app.indexOf('type ListingPhotoGap');
const helperEnd = app.indexOf("return side === 'requester' && !!book && !bookHasKnownPrice(book);\n};") + "return side === 'requester' && !!book && !bookHasKnownPrice(book);\n};".length;
const helperSrc = app.slice(helperStart, helperEnd)
  + '\nmodule.exports = { listingPhotoGaps, listingPhotoGapText, MORE_PHOTOS_LABEL, depositQuoteEstimated, bookHasKnownPrice };';
const fe = { exports: {} };
vm.runInNewContext(esbuild.transformSync(helperSrc, { loader: 'ts', format: 'cjs' }).code, { module: fe, exports: fe.exports });
const F = fe.exports;
check('17. Label copy is "More photos coming"', F.MORE_PHOTOS_LABEL === 'More photos coming');
check('18. Front-end rule matches the server on a front-only row',
  JSON.stringify(F.listingPhotoGaps({ frontCoverImage: 'f' })) === '["back","inside"]');
check('19. Server-sent missingPhotos wins over re-deriving',
  JSON.stringify(F.listingPhotoGaps({ frontCoverImage: 'f', missingPhotos: ['inside'] })) === '["inside"]');
check('20. Legacy row: no label', F.listingPhotoGaps({ imageUrls: 'a|b|c' }).length === 0);
check('21. Prompt names exactly what is missing',
  F.listingPhotoGapText(['back', 'inside']) === 'the back cover and an inside photo or video'
  && F.listingPhotoGapText(['back']) === 'the back cover');
check('22. Card tag shows only while photos are missing',
  /\{photoGaps\.length > 0 && \(\s*<span className="ss-shelf__tag"/.test(app));
check('23. Book page: label for readers, "finish your listing" prompt for the owner',
  /data-testid="more-photos-label"/.test(app) && /data-testid="finish-listing-prompt"/.test(app)
  && /Add \{listingPhotoGapText\(gaps\)\} to finish your listing/.test(app));
check('24. My Books lists unfinished listings with an Add photos button',
  /data-testid="my-books-finish-prompt"/.test(app) && /onClick=\{\(\) => setFinishingBook\(b\)\}/.test(app));
check('25. The finish modal sends finishListingPhotos and only the missing slots',
  /finishListingPhotos: true, \.\.\.media/.test(app) && /gaps\.includes\('back'\) \? \['backCoverImage'/.test(app));
check('26. Photo section: front cover first and required; the rest "Add now or later"',
  /data-testid="listing-media-front"/.test(app) && /Add now or later/.test(app)
  && /Only the front cover is needed to list your book/.test(app));
check('27. The 22 Sep form structure is untouched (share-first, shelves, Pi7)',
  /How would you like to share it\?/.test(app) && /\+ Also add to my shelves/.test(app) && /https:\/\/image\.pi7\.org\/compressor/.test(app));

console.log('--- 1e. finishing a listing on the server ---');
{
  // A fake Books row with only the front cover; upload is stubbed.
  const headers = ['id', 'ownerEmail', 'status', 'imageUrls', 'frontCoverImage', 'internalBookImage', 'internalBookVideo', 'backCoverImage', 'updatedAt', 'title'];
  const row = ['B1', 'r@e.com', 'Approved', 'F', 'F', '', '', '', '', 'Kept title'];
  const writes = {};
  const sheet = { getRange: (r, c) => ({ setValue: (v) => { writes[headers[c - 1]] = v; } }) };
  vm.runInContext(`uploadRequiredBookMedia = function (id, accepted) {
    var urls = {}; Object.keys(accepted).forEach(function (k) { urls[k] = 'U_' + k; });
    return { folderId: 'fold', urls: urls };
  }`, ctx);
  ctx.__s = sheet; ctx.__h = headers; ctx.__r = row;
  const res = plain(vm.runInContext(`finishListingPhotos_(__s, __h, __r, 1, 'B1', { backCoverImage: ${JSON.stringify(img())}, frontCoverImage: ${JSON.stringify(img())} })`, ctx));
  check('28. Adding the back cover succeeds', res.success === true, JSON.stringify(res));
  check('29. ...writes the back-cover column', writes.backCoverImage === 'U_backCoverImage');
  check('30. ...does not replace the front cover even if one is sent', !('frontCoverImage' in writes));
  check('31. ...rebuilds imageUrls front|back in slot order', writes.imageUrls === 'F|U_backCoverImage', writes.imageUrls);
  check('32. ...leaves status and title alone (book stays live)', !('status' in writes) && !('title' in writes));
  check('33. ...and reports inside is still missing', JSON.stringify(res.data.missingPhotos) === '["inside"]');
  check('34. updateUserBook routes finishListingPhotos before any other field is touched',
    gs.indexOf('if (data.finishListingPhotos)') > 0
    && gs.indexOf('if (data.finishListingPhotos)') < gs.indexOf('const flags = bookStatusFlags(data);\n    const nextSwapType'));
}

// ═══════════════════ 2. ESTIMATED DEPOSIT DISCLOSURE ════════════════════
console.log('--- 2. deposit estimate ---');
// The generic genre table is the seam (as in test_book_pricing.cjs): a book
// with nothing to go on resolves to the "Other" reprint rate, Rs.250.
vm.runInContext(`__SS_PRICE_TABLES__ = { byIsbn: {}, byGenre: {
  "Other": { hardcover: 699, paperback: 450, reprint: 250 } } };`, ctx);
check('35. No known price → estimate (knownBookMRP null)', call('isEstimatedBookValue_', { id: 'x' }) === true);
check('36. Owner-entered printed MRP → firm', call('isEstimatedBookValue_', { id: 'x', userEnteredMRP: 400, pricingSource: 'USER' }) === false);
check('37. Admin-verified → firm', call('isEstimatedBookValue_', { id: 'x', effectiveMRP: 400, pricingSource: 'VERIFIED' }) === false);
check('38. Automated, unverified figure → estimate',
  call('isEstimatedBookValue_', { id: 'x', effectiveMRP: 250, automatedMRP: 250, pricingSource: 'AUTOMATED_UNVERIFIED' }) === true);
const q = plain(call('computeMutualDeposit', { id: 'x' }, null, 'RENT'));
check('39. The estimate is still computed and charged (₹150 from the ₹250 fallback)', q.requesterDeposit === 150, JSON.stringify(q));
check('40. ...and flagged as an estimate', q.requesterDepositEstimated === true);
const q2 = plain(call('computeMutualDeposit', { id: 'y', userEnteredMRP: 500, pricingSource: 'USER', condition: 'New' }, null, 'RENT'));
check('41. A verified price is not flagged', q2.requesterDepositEstimated === false && q2.requesterDeposit > 0);
const q3 = plain(call('computeMutualDeposit', { id: 'y', userEnteredMRP: 500, pricingSource: 'USER' }, { id: 'z' }, 'SWAP'));
check('42. Each side is judged on its own book', q3.requesterDepositEstimated === false && q3.ownerDepositEstimated === true);
check('43. getDepositQuote returns both flags', /requesterDepositEstimated: q\.requesterDepositEstimated,\s*ownerDepositEstimated: q\.ownerDepositEstimated/.test(gs));
check('44. The basis is recorded on the swap when it is created',
  /"requesterDepositBasis", "ownerDepositBasis"/.test(gs) && /h === 'requesterDepositBasis'\) row\[i\] = deposits\.requesterDepositEstimated \? 'ESTIMATE' : 'KNOWN'/.test(gs));
check('45. Recorded basis wins; legacy rows fall back to the book',
  call('swapDepositEstimated_', { requesterDepositBasis: 'ESTIMATE' }, 'requester') === true
  && call('swapDepositEstimated_', { requesterDepositBasis: 'KNOWN' }, 'requester') === false);
check('46. Circulation/timeline deposit and fee payers carry `estimated`',
  /result\.estimated = result\.amount > 0 && swapDepositEstimated_\(swap\.obj, 'requester'\)/.test(gs) && /estimated: estimatedByRole\[rec\.payerRole\]/.test(gs));

const dep = { exports: {} };
vm.runInNewContext(esbuild.transformSync(read('src/utils/deposit.ts'), { loader: 'ts', format: 'cjs' }).code, { module: dep, exports: dep.exports });
check('47. Copy: "Estimated deposit (price not verified by the owner): ₹150"',
  dep.exports.depositLine(150, true) === 'Estimated deposit (price not verified by the owner): ₹150', dep.exports.depositLine(150, true));
check('48. A firm deposit keeps its plain label', dep.exports.depositLine(150, false) === 'Security deposit: ₹150');
check('49. Front-end fallback when an older server sends no flag',
  F.depositQuoteEstimated({}, 'requester', { pricingSource: 'AUTOMATED_UNVERIFIED' }) === true
  && F.depositQuoteEstimated({}, 'requester', { userEnteredMRP: 300 }) === false
  && F.depositQuoteEstimated({ requesterDepositEstimated: false }, 'requester', {}) === false);
// Every borrower-facing surface that shows the amount.
const surfaces = {
  'swap request modal': app,
  'Stages (security fee)': read('src/components/SwapStateMachine.tsx'),
  'timeline': read('src/components/SwapTimeline.tsx'),
  'circulation tracker': read('src/components/CirculationTracker.tsx'),
};
check('50. Swap request modal labels the estimate', /depositLine\(depositQuote\.requesterDeposit \?\? '—', true\)/.test(app) && /DEPOSIT_ESTIMATE_EXPLAINER/.test(app));
// Oct 2026: the QR amount is now deposit + platform fee, so the estimate
// label is applied to the deposit part only.
check('51. Stages (security fee) labels the estimate', /p\.estimated \? depositLine\(deposit, true\)/.test(surfaces['Stages (security fee)']));
check('52. Timeline labels the estimate', /\{depositTitle\(data\.deposit\.estimated\)\}/.test(surfaces.timeline));
check('53. Circulation tracker labels the estimate', /\{depositTitle\(data\.deposit\.estimated\)\}/.test(surfaces['circulation tracker']));
check('54. No borrower surface prints a bare "Security deposit" heading any more',
  !/>Security deposit<\/span>/.test(surfaces.timeline) && !/>Security deposit<\/span>/.test(surfaces['circulation tracker']));

// ═══════════════════ 3. LISTING FUNNEL COUNTER ══════════════════════════
console.log('--- 3. funnel counter ---');
scriptProperties.clear();
call('recordListingFormOpen', {});
call('recordListingFormOpen', {});
call('recordListingFormOpen', {});
call('recordListingCreated_', true);
call('recordListingCreated_', false);
call('recordListingFinished_');
const snap = plain(call('listingFunnelSnapshot_', 2));
check('55. Form opens are counted', snap.formOpens === 3, JSON.stringify(snap));
check('56. Listings created are counted, front-cover-only separately', snap.listingsCreated === 2 && snap.createdFrontCoverOnly === 1);
check('57. Finished listings are counted', snap.listingsFinished === 1);
check('58. Opened → listed rate', snap.openToListingPercent === 66.7);
check('59. The start date is recorded for the cross-check', !!snap.since && snap.booksRowsSince === 2);
check('60. Each +1 is also a log line', logs.some((l) => /\[listing-funnel\] form opened → 3/.test(l)));
check('61. createBook counts the listing after the row is written',
  gs.indexOf('recordListingCreated_(listingPhotoGaps_({') > gs.indexOf('sheet.appendRow(row);', gs.indexOf('function createBook(')));
check('62. The action is public like recordVisit (Apps Script, proxy, dev server)',
  /recordListingFormOpen: true,/.test(gs) && /'recordListingFormOpen',/.test(read('api/swapsutra.ts')) && /'recordListingFormOpen',/.test(read('server.ts')));
check('63. The form counts every closed→open transition', /if \(open && !listingFormWasOpenRef\.current\) recordListingFormOpen\(\);/.test(app));
check('64. Admin → Analytics shows the funnel', /listingFunnel: \(function \(\)/.test(gs) && /data-testid="admin-listing-funnel"/.test(app));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
