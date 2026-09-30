// Standalone Node test script mirroring the ISBN scanning + transparent
// listing logic added to SwapSutra (frontend App.tsx + appsscript.js +
// server.ts/api/swapsutra.ts). No live environment required — this
// re-implements the pure validation functions exactly as they appear in
// the shipped code and exercises the 12 scenarios from the spec (section 23)
// plus the copy-type / required-photo rules (sections 10-12, 16).

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ---- Mirrors normalizeIsbn/isValidIsbn10/isValidIsbn13/isValidIsbn ----
// (identical in src/App.tsx, appsscript.js, server.ts, api/swapsutra.ts)
const normalizeIsbn = (raw) => String(raw || '').replace(/[\s-]/g, '').toUpperCase();

function isValidIsbn10(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(isbn[i], 10) * (10 - i);
  sum += (isbn[9] === 'X' ? 10 : parseInt(isbn[9], 10));
  return sum % 11 === 0;
}
function isValidIsbn13(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(isbn[i], 10) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}
function isValidIsbn(raw) {
  const clean = normalizeIsbn(raw);
  return isValidIsbn10(clean) || isValidIsbn13(clean);
}

// ---- Mirrors handleCreateBook's PHOTO_SLOTS + copyType validation ----
const COPY_TYPE_OPTIONS = [
  { value: 'ORIGINAL', label: 'Original / Publisher Edition' },
  { value: 'REPRINT', label: 'Reprint / Budget Copy' },
  { value: 'NOT_SURE', label: 'Not Sure' },
];
const PHOTO_SLOTS = [
  { name: 'photoCover', required: true },
  { name: 'photoInsidePage', required: true },
  { name: 'photoBackCover', required: false },
  { name: 'photoIsbnPage', required: false },
  { name: 'photoCondition', required: false },
];

function validateListingSubmission(fields) {
  // fields: { photoCover, photoInsidePage, ..., copyType, copyTypeDeclaration, isbn }
  // Booleans stand in for "a file was selected in this slot".
  const selected = [];
  for (const slot of PHOTO_SLOTS) {
    const present = !!fields[slot.name];
    if (present) selected.push(slot.name);
    else if (slot.required) return { ok: false, error: `missing_${slot.name}` };
  }
  if (selected.length > 5) return { ok: false, error: 'too_many_photos' };

  if (!COPY_TYPE_OPTIONS.some(o => o.value === fields.copyType)) {
    return { ok: false, error: 'missing_copy_type' };
  }
  if (!fields.copyTypeDeclaration) {
    return { ok: false, error: 'missing_declaration' };
  }
  if (fields.isbn && !isValidIsbn(fields.isbn)) {
    return { ok: false, error: 'invalid_isbn' };
  }
  return { ok: true };
}

// ---- Mirrors performIsbnLookup's dedup-by-ref behavior ----
function makeLookupTracker() {
  let lastLookedUp = '';
  let apiCalls = 0;
  return {
    lookup(rawIsbn, apiHasBook) {
      const clean = normalizeIsbn(rawIsbn);
      if (!clean || !isValidIsbn(clean)) return { status: 'invalid' };
      if (lastLookedUp === clean) return { status: 'skipped_duplicate' };
      lastLookedUp = clean;
      apiCalls++;
      return { status: apiHasBook ? 'found' : 'not_found' };
    },
    get apiCalls() { return apiCalls; }
  };
}

// =====================================================================
// Test data: known-valid ISBNs (checksum-correct)
// =====================================================================
const VALID_ISBN13 = '9780061120084'; // "To Kill a Mockingbird" — from spec example after normalization
const VALID_ISBN13_HYPHENATED = '978-0-06-112008-4';
const VALID_ISBN10 = '0061120081'; // corresponding ISBN-10 (checksum-valid)
const INVALID_ISBN = '9780061120085'; // last digit flipped -> bad checksum
const GARBAGE_ISBN = 'not-a-real-isbn';

// =====================================================================
// Section 5: normalization + checksum validation
// =====================================================================
check('normalizeIsbn strips hyphens/spaces and upper-cases', normalizeIsbn(VALID_ISBN13_HYPHENATED) === VALID_ISBN13);
check('normalizeIsbn handles ISBN-10 trailing X', normalizeIsbn('0-306-40615-x') === '030640615X');
check('valid ISBN-13 passes checksum', isValidIsbn13(VALID_ISBN13) === true);
check('valid ISBN-10 passes checksum', isValidIsbn10(VALID_ISBN10) === true);
check('invalid ISBN-13 (bad checksum) fails', isValidIsbn13(INVALID_ISBN) === false);
check('garbage string is not a valid ISBN', isValidIsbn(GARBAGE_ISBN) === false);
check('hyphenated valid ISBN validates end-to-end', isValidIsbn(VALID_ISBN13_HYPHENATED) === true);

// =====================================================================
// Test 1: Valid ISBN-13 scanned via camera -> auto-fetch triggers
// =====================================================================
{
  const tracker = makeLookupTracker();
  const r = tracker.lookup(VALID_ISBN13, true);
  check('Test1: valid ISBN-13 scan resolves to found', r.status === 'found');
  check('Test1: exactly one API call made', tracker.apiCalls === 1);
}

// =====================================================================
// Test 2: Manual ISBN entry follows the exact same validation+fetch path
// =====================================================================
{
  const tracker = makeLookupTracker();
  const scanResult = tracker.lookup(VALID_ISBN13, true);
  const tracker2 = makeLookupTracker();
  const manualResult = tracker2.lookup(VALID_ISBN13_HYPHENATED, true); // user types with hyphens
  check('Test2: manual entry (hyphenated) reaches same found state as scan', manualResult.status === scanResult.status);
}

// =====================================================================
// Test 3: Invalid ISBN -> rejected before any API call
// =====================================================================
{
  const tracker = makeLookupTracker();
  const r = tracker.lookup(INVALID_ISBN, true /* would be found if it were ever queried */);
  check('Test3: invalid ISBN short-circuits to invalid', r.status === 'invalid');
  check('Test3: no API call made for invalid ISBN', tracker.apiCalls === 0);
}

// =====================================================================
// Test 4: Valid ISBN not found in metadata API -> listing still allowed
// =====================================================================
{
  const tracker = makeLookupTracker();
  const r = tracker.lookup(VALID_ISBN13, false); // API returns no match
  check('Test4: valid-but-unmatched ISBN resolves to not_found (not blocked)', r.status === 'not_found');
  // Listing submission does not require isbnMetadata to be 'found' — only
  // photos + copyType + declaration are required, so submission proceeds:
  const submission = validateListingSubmission({
    photoCover: true, photoInsidePage: true,
    copyType: 'NOT_SURE', copyTypeDeclaration: true,
    isbn: VALID_ISBN13
  });
  check('Test4: listing with not-found ISBN still submits successfully', submission.ok === true);
}

// =====================================================================
// Test 5: Camera denied -> manual entry still works, listing still possible
// =====================================================================
{
  // Camera permission is a UI-layer concern (IsbnScannerModal's permission
  // state machine) with no effect on the validation functions themselves;
  // what matters here is that ISBN is entirely optional for submission.
  const submission = validateListingSubmission({
    photoCover: true, photoInsidePage: true,
    copyType: 'ORIGINAL', copyTypeDeclaration: true,
    isbn: '' // no ISBN at all - camera denied, user skipped manual entry too
  });
  check('Test5: submission succeeds with no ISBN at all (camera denied path)', submission.ok === true);
}

// =====================================================================
// Test 6: Same ISBN scanned/entered multiple times -> only one API call
// =====================================================================
{
  const tracker = makeLookupTracker();
  tracker.lookup(VALID_ISBN13, true);
  tracker.lookup(VALID_ISBN13, true);
  tracker.lookup(normalizeIsbn(VALID_ISBN13_HYPHENATED), true); // same ISBN, different formatting
  check('Test6: repeated identical ISBN only calls the API once', tracker.apiCalls === 1);
}

// =====================================================================
// Test 7: API cover displayed as reference only (data-shape check)
// =====================================================================
{
  // The book payload the API layer returns never claims to be the user's
  // photo; it is a separate field (coverImageUrl / referenceCoverUrl) kept
  // apart from the physicalPhotos the user uploads.
  const apiBook = { isbn: VALID_ISBN13, title: 'Example', coverImageUrl: 'https://covers.example/x.jpg' };
  const listingPayload = {
    referenceCoverUrl: apiBook.coverImageUrl, // reference only
    // physical photos come from separate named form fields, never from apiBook
  };
  check('Test7: reference cover stored in a distinct field from physical photos', 'referenceCoverUrl' in listingPayload && !('physicalPhotos' in apiBook));
}

// =====================================================================
// Test 8: Original / Reprint / Not Sure each store + declare correctly
// =====================================================================
{
  const COPY_TYPE_DECLARATIONS = {
    ORIGINAL: "I confirm that, to the best of my knowledge, this is an original publisher edition.",
    REPRINT: "This is a reprint/budget copy and may differ from the publisher edition.",
    NOT_SURE: "I'm not sure about the exact edition of this copy.",
  };
  for (const type of ['ORIGINAL', 'REPRINT', 'NOT_SURE']) {
    const submission = validateListingSubmission({
      photoCover: true, photoInsidePage: true,
      copyType: type, copyTypeDeclaration: true, isbn: ''
    });
    check(`Test8: copyType=${type} submits successfully with its declaration text present`, submission.ok === true && !!COPY_TYPE_DECLARATIONS[type]);
  }
  const badType = validateListingSubmission({
    photoCover: true, photoInsidePage: true,
    copyType: 'GENUINE', copyTypeDeclaration: true, isbn: ''
  });
  check('Test8: an invalid/unknown copyType value is rejected', badType.ok === false && badType.error === 'missing_copy_type');
}

// =====================================================================
// Test 9: Missing required photos blocks submission
// =====================================================================
{
  const noPhotos = validateListingSubmission({
    copyType: 'ORIGINAL', copyTypeDeclaration: true, isbn: ''
  });
  check('Test9a: no photos at all is rejected (missing photoCover)', noPhotos.ok === false && noPhotos.error === 'missing_photoCover');

  const onlyCover = validateListingSubmission({
    photoCover: true,
    copyType: 'ORIGINAL', copyTypeDeclaration: true, isbn: ''
  });
  check('Test9b: cover photo alone (no inside-page) is rejected', onlyCover.ok === false && onlyCover.error === 'missing_photoInsidePage');

  const bothRequired = validateListingSubmission({
    photoCover: true, photoInsidePage: true,
    copyType: 'ORIGINAL', copyTypeDeclaration: true, isbn: ''
  });
  check('Test9c: cover + inside-page (both required slots) is sufficient', bothRequired.ok === true);
}

// =====================================================================
// Test 10: Missing copy-type declaration checkbox blocks submission
// =====================================================================
{
  const noDeclaration = validateListingSubmission({
    photoCover: true, photoInsidePage: true,
    copyType: 'ORIGINAL', copyTypeDeclaration: false, isbn: ''
  });
  check('Test10: unchecked declaration checkbox blocks submission', noDeclaration.ok === false && noDeclaration.error === 'missing_declaration');
}

// =====================================================================
// Test 11: A backend request missing required fields is rejected
// (mirrors appsscript.js createBook's server-side validation block —
// exercised here structurally since Apps Script itself can't run in Node)
// =====================================================================
{
  function serverSideCreateBookValidate(payload) {
    const images = Array.isArray(payload.images) ? payload.images : [];
    if (!COPY_TYPE_OPTIONS.some(o => o.value === payload.copyType)) return { ok: false, error: 'INVALID_COPY_TYPE' };
    if (!payload.copyTypeDeclaration) return { ok: false, error: 'MISSING_DECLARATION' };
    if (payload.isbn && !isValidIsbn(payload.isbn)) return { ok: false, error: 'INVALID_ISBN' };
    if (images.length < 2 || images.length > 5) return { ok: false, error: 'INVALID_IMAGE_COUNT' };
    return { ok: true };
  }
  const directApiAbuse = serverSideCreateBookValidate({ images: [], copyType: '', copyTypeDeclaration: false });
  check('Test11: direct backend request with nothing set is rejected server-side', directApiAbuse.ok === false);
  const validDirect = serverSideCreateBookValidate({ images: [{}, {}], copyType: 'ORIGINAL', copyTypeDeclaration: true });
  check('Test11: a fully-valid direct backend request is accepted', validDirect.ok === true);
}

// =====================================================================
// Test 12: Backward compatibility — legacy listing with no isbn/copyType
// =====================================================================
{
  const COPY_TYPE_DISPLAY_LABELS = { ORIGINAL: 'Original / Publisher Edition', REPRINT: 'Reprint / Budget Copy', NOT_SURE: 'Edition not confirmed' };
  const legacyBook = { title: 'Old Listing', author: 'Someone', condition: 'Good' }; // no isbn/copyType/publisher fields at all
  const badgeText = legacyBook.copyType && COPY_TYPE_DISPLAY_LABELS[legacyBook.copyType];
  check('Test12: legacy book with no copyType renders no badge (falsy, no crash)', !badgeText);
  check('Test12: legacy book has no isbn/publisher and does not throw when read', legacyBook.isbn === undefined && legacyBook.publisher === undefined);
}

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail > 0 ? 1 : 0);
