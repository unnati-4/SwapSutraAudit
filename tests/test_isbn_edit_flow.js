// Standalone Node test script mirroring updateUserBook's new validation
// logic (appsscript.js) for the ISBN/copy-type/photo hardening pass.
// Complements test_isbn_flow.js (which covers create/lookup) — this one
// focuses on: (a) legacy listings edited without touching the new fields
// must never be newly blocked, (b) actively setting copyType requires the
// declaration, (c) photo replacement is all-or-nothing and optional.

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
// Mirrors isValidIsbnServer in appsscript.js: blank is valid (optional field).
function isValidIsbnServer(raw) {
  const clean = normalizeIsbn(raw);
  if (!clean) return true;
  return isValidIsbn10(clean) || isValidIsbn13(clean);
}
const COPY_TYPE_OPTIONS = ['ORIGINAL', 'REPRINT', 'NOT_SURE'];
function normalizeCopyType(raw) {
  const value = String(raw || '').trim().toUpperCase();
  return COPY_TYPE_OPTIONS.includes(value) ? value : '';
}

// Mirrors updateUserBook's new validation block exactly (appsscript.js).
function validateUpdateUserBook(data) {
  let copyType;
  if (data.copyType !== undefined && String(data.copyType).trim() !== '') {
    copyType = normalizeCopyType(data.copyType);
    if (!copyType) return { ok: false, error: 'INVALID_COPY_TYPE' };
    if (!data.copyTypeDeclaration) return { ok: false, error: 'COPY_TYPE_DECLARATION_REQUIRED' };
  }
  if (data.isbn && !isValidIsbnServer(data.isbn)) return { ok: false, error: 'INVALID_ISBN' };

  const submittedImages = Array.isArray(data.images) ? data.images : [];
  if (submittedImages.length > 0) {
    if (submittedImages.length < 2) return { ok: false, error: 'PHOTOS_REQUIRED' };
    if (submittedImages.length > 5) return { ok: false, error: 'TOO_MANY_PHOTOS' };
  }
  return { ok: true, copyType, willReplacePhotos: submittedImages.length > 0 };
}

const VALID_ISBN13 = '9780061120084';
const INVALID_ISBN = '9780061120085';

// =====================================================================
// Legacy listing: no isbn/publisher/copyType/referenceCoverUrl/conditionNotes.
// Editing only title/area (as the pre-existing edit form always did) must
// keep working exactly as before — this is the core backward-compat rule.
// =====================================================================
{
  const legacyEditPayload = { title: 'New Title', area: 'New Area', copyType: '', copyTypeDeclaration: false, isbn: '' };
  const r = validateUpdateUserBook(legacyEditPayload);
  check('Legacy listing: ordinary edit (blank isbn/copyType) is never blocked', r.ok === true);
  check('Legacy listing: no photo replacement is triggered when images absent', r.willReplacePhotos === false);
}

// =====================================================================
// Actively setting copyType requires the declaration checkbox
// =====================================================================
{
  const missingDeclaration = validateUpdateUserBook({ title: 'X', copyType: 'ORIGINAL', copyTypeDeclaration: false });
  check('Edit: setting copyType without declaration is rejected', missingDeclaration.ok === false && missingDeclaration.error === 'COPY_TYPE_DECLARATION_REQUIRED');

  const withDeclaration = validateUpdateUserBook({ title: 'X', copyType: 'ORIGINAL', copyTypeDeclaration: true });
  check('Edit: setting copyType with declaration succeeds', withDeclaration.ok === true && withDeclaration.copyType === 'ORIGINAL');

  const invalidType = validateUpdateUserBook({ title: 'X', copyType: 'FAKE', copyTypeDeclaration: true });
  check('Edit: an invalid copyType value is rejected', invalidType.ok === false && invalidType.error === 'INVALID_COPY_TYPE');
}

// =====================================================================
// ISBN on edit: optional, but validated if provided
// =====================================================================
{
  const blankIsbn = validateUpdateUserBook({ title: 'X', isbn: '' });
  check('Edit: blank ISBN is accepted (optional field)', blankIsbn.ok === true);

  const validIsbn = validateUpdateUserBook({ title: 'X', isbn: VALID_ISBN13 });
  check('Edit: a checksum-valid ISBN is accepted', validIsbn.ok === true);

  const badIsbn = validateUpdateUserBook({ title: 'X', isbn: INVALID_ISBN });
  check('Edit: a checksum-invalid ISBN is rejected', badIsbn.ok === false && badIsbn.error === 'INVALID_ISBN');
}

// =====================================================================
// Photo replacement: all-or-nothing, same required-slot rule as create
// =====================================================================
{
  const noReplace = validateUpdateUserBook({ title: 'X' }); // "Replace photos" left unchecked
  check('Edit: no images submitted -> existing photos untouched, no validation triggered', noReplace.ok === true && noReplace.willReplacePhotos === false);

  const tooFew = validateUpdateUserBook({ title: 'X', images: [{}] }); // only cover, missing inside-page
  check('Edit: replacing with only 1 photo is rejected (below the 2-photo minimum)', tooFew.ok === false && tooFew.error === 'PHOTOS_REQUIRED');

  const justRight = validateUpdateUserBook({ title: 'X', images: [{}, {}] });
  check('Edit: replacing with cover + inside-page (2 photos) succeeds', justRight.ok === true && justRight.willReplacePhotos === true);

  const tooMany = validateUpdateUserBook({ title: 'X', images: [{}, {}, {}, {}, {}, {}] });
  check('Edit: replacing with 6 photos is rejected (over the 5-photo max)', tooMany.ok === false && tooMany.error === 'TOO_MANY_PHOTOS');
}

// =====================================================================
// Frontend guard mirror: BookCard/BookDetailModal never crash on a book
// with none of the new fields (truthyFlag-style safe access).
// =====================================================================
{
  const truthyFlag = (value) => value === true || String(value || '').trim().toLowerCase() === 'true' || String(value || '').trim().toLowerCase() === 'yes';
  const COPY_TYPE_DISPLAY_LABELS = { ORIGINAL: 'Original / Publisher Edition', REPRINT: 'Reprint / Budget Copy', NOT_SURE: 'Edition not confirmed' };
  const legacyBook = { title: 'Old Book', author: 'Someone' }; // no isbn/publisher/copyType/referenceCoverUrl/conditionNotes at all

  let crashed = false;
  let badgeText;
  try {
    badgeText = legacyBook.copyType && COPY_TYPE_DISPLAY_LABELS[String(legacyBook.copyType)];
    const editFormSeed = {
      isbn: legacyBook.isbn || '',
      publisher: legacyBook.publisher || '',
      copyType: legacyBook.copyType || '',
      copyTypeDeclaration: truthyFlag(legacyBook.copyTypeDeclaration),
      referenceCoverUrl: legacyBook.referenceCoverUrl || '',
      conditionNotes: legacyBook.conditionNotes || ''
    };
    check('Legacy book: edit-form seed produces safe blank defaults, no throw', editFormSeed.copyType === '' && editFormSeed.copyTypeDeclaration === false);
  } catch (e) {
    crashed = true;
  }
  check('Legacy book: reading new fields for card/detail/edit never throws', crashed === false);
  check('Legacy book: no copy-type badge is rendered (falsy)', !badgeText);
}

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail > 0 ? 1 : 0);
