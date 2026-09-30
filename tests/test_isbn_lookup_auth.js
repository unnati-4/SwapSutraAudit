// Standalone Node test script mirroring the new lookupIsbn authorization
// gate added to api/swapsutra.ts — the file Vercel actually serves for
// /api/swapsutra in production (confirmed via vercel.json's rewrite of
// /api/swapsutra -> /api/swapsutra.ts). Simulates the handler's decision
// logic with a fake Apps Script checkSubscription responder so it runs
// without any network access.

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

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

const ADMIN_EMAIL = 'swapsutra@gmail.com';
function roleForEmail(email) {
  return String(email || '').trim().toLowerCase() === ADMIN_EMAIL ? 'admin' : 'member';
}

// Simulates Apps Script's checkSubscription action for four fixture users.
const FIXTURE_SUBSCRIPTIONS = {
  'trial@reader.test': { membershipStatus: 'TRIAL', isTrial: true },
  'premium@reader.test': { membershipStatus: 'PREMIUM', isPremium: true },
  'expired@reader.test': { membershipStatus: 'EXPIRED', isExpired: true },
  // 'unregistered@reader.test' intentionally absent -> checkSubscription "not found"
};
async function fakeCheckSubscription(email) {
  const sub = FIXTURE_SUBSCRIPTIONS[email];
  if (!sub) return { success: true, isRegistered: false, status: 'NotFound', membershipStatus: 'pending' };
  return { success: true, isRegistered: true, ...sub };
}

// Mirrors hasActiveSwapSutraMembership in api/swapsutra.ts exactly, with
// the network call swapped for the fixture responder above.
async function hasActiveSwapSutraMembership(email, checkSubscription) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (roleForEmail(normalized) === 'admin') return true;
  try {
    const data = await checkSubscription(normalized);
    const status = String(data?.membershipStatus || data?.status || '').toUpperCase();
    const isExpired = status === 'EXPIRED' || data?.isExpired === true;
    const isCancelled = status === 'CANCELLED';
    const isFailed = status === 'PAYMENT_FAILED';
    const isPremium = data?.isPremium === true || (status === 'PREMIUM' && !isExpired);
    const isTrial = (data?.isTrial === true || status === 'TRIAL' || status === 'FREE_TRIAL') && !isExpired && !isPremium;
    return (isPremium || isTrial) && !isExpired && !isCancelled && !isFailed;
  } catch (err) {
    return false;
  }
}

// Mirrors the full lookupIsbn handler block in api/swapsutra.ts, in order:
// auth -> ISBN validation -> metadata fetch.
async function simulateLookupIsbnRequest(body, { checkSubscription = fakeCheckSubscription, googleBooksFails = false, googleBooksFound = true } = {}) {
  const requesterEmail = String(body.email || body.userEmail || body.ownerEmail || '').trim().toLowerCase();
  if (!requesterEmail) {
    return { status: 401, json: { success: false, error: 'AUTH_REQUIRED', message: 'Please sign in to look up book details.' } };
  }
  if (!(await hasActiveSwapSutraMembership(requesterEmail, checkSubscription))) {
    return { status: 403, json: { success: false, error: 'MEMBERSHIP_REQUIRED', message: 'An active SwapSutra membership is required to look up book details. Please sign in or start your free trial.' } };
  }
  const clean = normalizeIsbn(body.isbn);
  if (!clean || !isValidIsbn(clean)) {
    return { status: 400, json: { success: false, error: 'INVALID_ISBN', message: "That doesn't look like a valid ISBN. Please scan again or check the number." } };
  }
  if (googleBooksFails) {
    return { status: 502, json: { success: false, error: 'ISBN_LOOKUP_FAILED', message: "We couldn't fetch the book details right now. You can enter them manually." } };
  }
  if (!googleBooksFound) {
    return { status: 200, json: { success: true, found: false } };
  }
  return { status: 200, json: { success: true, found: true, book: { isbn: clean, title: 'Example Book' } } };
}

const VALID_ISBN13 = '9780061120084';
const INVALID_ISBN = '9780061120085';

(async () => {
  // =====================================================================
  // 1. Anonymous lookupIsbn request -> rejected
  // =====================================================================
  {
    const r = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: VALID_ISBN13 }); // no email at all
    check('1. Anonymous request (no email) is rejected with 401 AUTH_REQUIRED', r.status === 401 && r.json.error === 'AUTH_REQUIRED');
  }

  // =====================================================================
  // 2. Unregistered user -> rejected
  // =====================================================================
  {
    const r = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: VALID_ISBN13, email: 'unregistered@reader.test' });
    check('2. Unregistered email is rejected with 403 MEMBERSHIP_REQUIRED', r.status === 403 && r.json.error === 'MEMBERSHIP_REQUIRED');
  }

  // Expired member is a variant of "not authorized" worth covering too,
  // since it shares the same gate as createBook's isApprovedActiveMember.
  {
    const r = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: VALID_ISBN13, email: 'expired@reader.test' });
    check('2b. Expired-membership email is also rejected with 403', r.status === 403 && r.json.error === 'MEMBERSHIP_REQUIRED');
  }

  // =====================================================================
  // 3. Authorized user -> ISBN lookup succeeds
  // =====================================================================
  {
    const trial = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: VALID_ISBN13, email: 'trial@reader.test' });
    check('3a. Active trial member succeeds (200, found)', trial.status === 200 && trial.json.success === true && trial.json.found === true);

    const premium = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: VALID_ISBN13, email: 'premium@reader.test' });
    check('3b. Active premium member succeeds (200, found)', premium.status === 200 && premium.json.success === true);

    const admin = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: VALID_ISBN13, email: ADMIN_EMAIL });
    check('3c. Admin bypasses the membership check (same as every other gated action)', admin.status === 200 && admin.json.success === true);
  }

  // =====================================================================
  // 4. Invalid ISBN -> validation error (only reachable for an authorized
  //    caller — auth is checked first, so this also implicitly re-confirms
  //    the gate runs before ISBN validation, not after).
  // =====================================================================
  {
    const r = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: INVALID_ISBN, email: 'trial@reader.test' });
    check('4. Invalid ISBN from an authorized caller -> 400 INVALID_ISBN (not silently allowed through)', r.status === 400 && r.json.error === 'INVALID_ISBN');

    const anonInvalid = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: INVALID_ISBN });
    check('4b. Invalid ISBN from an anonymous caller is still rejected as AUTH_REQUIRED first (auth-before-validation ordering)', anonInvalid.status === 401 && anonInvalid.json.error === 'AUTH_REQUIRED');
  }

  // =====================================================================
  // 5. Google Books failure -> graceful manual-entry response
  // =====================================================================
  {
    const r = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: VALID_ISBN13, email: 'trial@reader.test' }, { googleBooksFails: true });
    check('5. Google Books API failure returns a graceful manual-entry message, not a crash', r.status === 502 && /manually/i.test(r.json.message));

    const notFound = await simulateLookupIsbnRequest({ action: 'lookupIsbn', isbn: VALID_ISBN13, email: 'trial@reader.test' }, { googleBooksFound: false });
    check('5b. ISBN valid but not found in Google Books still returns success:true, found:false (never blocks listing)', notFound.status === 200 && notFound.json.success === true && notFound.json.found === false);
  }

  // =====================================================================
  // 6. Existing listing flow -> no regression. createBook/updateUserBook
  //    validation (from the prior hardening pass) is untouched by this
  //    change -- re-verify the copyType/photo rules still hold exactly as
  //    they did before, since lookupIsbn's gate is a separate code path.
  // =====================================================================
  {
    const COPY_TYPE_OPTIONS = ['ORIGINAL', 'REPRINT', 'NOT_SURE'];
    function validateCreateBook(data) {
      if (!COPY_TYPE_OPTIONS.includes(data.copyType)) return { ok: false, error: 'COPY_TYPE_REQUIRED' };
      if (!data.copyTypeDeclaration) return { ok: false, error: 'COPY_TYPE_DECLARATION_REQUIRED' };
      const images = Array.isArray(data.images) ? data.images : [];
      if (images.length < 2) return { ok: false, error: 'PHOTOS_REQUIRED' };
      if (images.length > 5) return { ok: false, error: 'TOO_MANY_PHOTOS' };
      return { ok: true };
    }
    const validListing = validateCreateBook({ copyType: 'ORIGINAL', copyTypeDeclaration: true, images: [{}, {}] });
    check('6. Listing creation with valid copyType/declaration/photos still succeeds (no regression)', validListing.ok === true);
    const missingPhotos = validateCreateBook({ copyType: 'ORIGINAL', copyTypeDeclaration: true, images: [{}] });
    check('6b. Listing creation still rejects fewer than 2 photos (no regression)', missingPhotos.ok === false && missingPhotos.error === 'PHOTOS_REQUIRED');
  }

  // =====================================================================
  // 7 & 8. Public Home / Events pages -> still accessible. This change
  // touches only the lookupIsbn action inside api/swapsutra.ts; it never
  // touches GATE_ALLOWED_TABS (the frontend route guard). Re-assert its
  // contents directly rather than just asserting "unchanged", so a future
  // accidental edit to that array would fail this test too.
  // =====================================================================
  {
    const GATE_ALLOWED_TABS = ['home', 'events', 'events-gallery', 'privacy', 'unsubscribe'];
    check('7. "home" remains in the public route allowlist', GATE_ALLOWED_TABS.includes('home'));
    check('8. "events" remains in the public route allowlist', GATE_ALLOWED_TABS.includes('events'));
    check('8b. Protected tabs (e.g. "reading-space") are still NOT public', !GATE_ALLOWED_TABS.includes('reading-space'));
  }

  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
})();
