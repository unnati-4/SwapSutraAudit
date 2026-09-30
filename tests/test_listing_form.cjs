/**
 * test_listing_form.js
 *
 * The listing form's own rules, read off src/App.tsx.
 *
 * These are source-level checks, and they are worth having because every
 * defect below was invisible in a screenshot. The form LOOKED right in all
 * four cases:
 *
 *   - Autofill wrote into the wrong copy of a duplicated form, because
 *     both copies carried the same element ids and getElementById returns
 *     the first. The visible form simply never changed.
 *   - Media was validated by counting files, so four photographs passed a
 *     rule meant to require a video.
 *   - Lend had no control of its own, so it was answered by the
 *     temporary-swap box.
 *   - An unknown MRP rendered as ₹0, which reads as a priced book.
 */

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');

// ── autofill ────────────────────────────────────────────────────────────
console.log('\n--- a successful lookup fills the form the reader is looking at ---');

check('1. The book details live in React state, not in the DOM',
  /const \[listingDetails, setListingDetails\] = useState/.test(src));

check('2. Title, author and publisher are bound to that state',
  /value=\{listingDetails\.title\}/.test(src)
  && /value=\{listingDetails\.author\}/.test(src)
  && /value=\{listingDetails\.publisher\}/.test(src));

check('3. A successful lookup writes title, author and publisher into it',
  /setListingDetails\(\(prev\) => \(\{[\s\S]{0,400}book\.title[\s\S]{0,200}book\.authors[\s\S]{0,200}book\.publisher/.test(src));

check('4. ...and the ISBN it was looked up by',
  /setListingDetails\(\(prev\) => \(\{[\s\S]{0,600}isbn: clean/.test(src));

check('5. ...and the format, when the catalogue knows it',
  /setListingFormat\(\(prev\) => prev \|\| catalogueFormat\)/.test(src));

// The actual root cause: two copies of the form shared element ids, so the
// imperative fill reached whichever came first in the document.
check('6. The lookup no longer reaches into the DOM by id',
  !/getElementById\(['"]list-book-(title|author|publisher)['"]\)/.test(src),
  'getElementById autofill is still there');

check('7. ...and those duplicated ids are gone from the markup',
  !/id="list-book-title"/.test(src),
  'the duplicated element ids remain');

check('8. A detail the reader already typed is not overwritten by a lookup',
  /prev\.title \|\| book\.title/.test(src));

// ── format ──────────────────────────────────────────────────────────────
console.log('\n--- paperback, hardcover, and honestly-unknown ---');

check('9. The form understands Hardcover, Paperback and not sure', /'HARDCOVER' \| 'PAPERBACK' \| 'UNKNOWN'/.test(src));

check('12. Spellings are normalised rather than compared literally',
  /const normalizeListingFormat/.test(src)
  && /HARD \?\(COVER\|BACK\|BOUND\)/.test(src));

check('13. "Not sure" is not sent to the catalogue as a paperback',
  /listingFormat === 'PAPERBACK' \? 'TRADE_PAPERBACK' : 'UNKNOWN'/.test(src));

// ── the four media ──────────────────────────────────────────────────────
console.log('\n--- four required media, four previews ---');

check('14. The four requirements are named, not counted',
  /frontCoverImage/.test(src) && /internalBookImage/.test(src)
  && /internalBookVideo/.test(src) && /backCoverImage/.test(src));

check('15. One of them is a video, and it is declared as one',
  /field: 'internalBookVideo', kind: 'video'/.test(src));

// Three requirements now: each cover on its own, and the two inside items
// as ONE requirement met by either. Not "any three of four" — a front
// cover with an inside photo AND an inside video is still missing a back
// cover, which is precisely what a count cannot express.
check('16. Submission is blocked by which requirement is unmet, not by a count',
  /const missingGroups = missingMediaGroups\(listingMedia\)/.test(src));

check('16b. The requirements are three groups, not four fields',
  /BOOK_MEDIA_GROUPS/.test(src)
  && /fields: \['internalBookImage', 'internalBookVideo'\]/.test(src));

check('16c. A group is satisfied by ANY of its fields',
  /!group\.fields\.some\(\(field\) => chosen\[field\]\)/.test(src));

check('16d. The covers are each their own requirement',
  /fields: \['frontCoverImage'\]/.test(src) && /fields: \['backCoverImage'\]/.test(src));

check('17. The reader is told every unmet requirement, not just the first',
  /missingGroups\.map\(\(group\) => group\.missing\)\.join/.test(src));

check('17b. An unmet inside requirement marks both slots, not one of them',
  /group\.fields\.forEach\(\(field\) => \{ next\[field\] = group\.missing; \}\)/.test(src));

check('17c. The inside prompt offers either, in words',
  /either a photo of a page or a short video/.test(src));

check('17d. A slot reads Optional once its partner is filled',
  /groupSatisfied \? 'Optional'/.test(src));

// CHANGED 24 Sep 2026: only the front cover is required. Every other slot
// reads "Optional now" until filled — it can be added later to finish the
// listing — rather than presenting the inside pair as a choice to be made.
check('17e. Optional slots read "Optional now" while unfilled; only a required group reads Required',
  /group\.required \? 'Required'/.test(src) && /: 'Optional now'/.test(src) && !/'One of these two'/.test(src));

check('18. The old count rule is gone',
  !/Please upload no more than 5 photos/.test(src),
  'the five-photo count rule is still in the create path');

check('19. A chosen image previews as an image, in its own section',
  /<img[\s\S]{0,120}src=\{selected\.previewUrl\}/.test(src));

check('20. A chosen video previews as a playable video',
  /<video[\s\S]{0,120}src=\{selected\.previewUrl\}[\s\S]{0,120}controls/.test(src));

// The preview is built from `toSend` — the downscaled copy for an image,
// the original for a video. That is the file that will actually be
// uploaded, so the preview and the size beside it describe the same thing.
check('21. The preview is the file the reader chose, not a name or a placeholder',
  /previewUrl: URL\.createObjectURL\(toSend\)/.test(src));
check('21b. ...and its size is the size that will be sent',
  /bytes: toSend\.size/.test(src));

check('22. Each section offers Replace and Remove',
  />\s*Replace\s*</.test(src) && />\s*Remove\s*</.test(src));

check('23. Replacing one medium leaves the other three untouched',
  /\.\.\.prev,\s*\[field\]: \{/.test(src));

check('24. Removing one deletes only that field',
  /const next = \{ \.\.\.prev \}; delete next\[field\]; return next;/.test(src));

check('25. The old preview is released when replaced, not leaked',
  /releasePreview\(prev\[field\]\)/.test(src) && /revokeObjectURL/.test(src));

// Inside-the-book media became optional on 20 Sep 2026, so the counter is
// shown against however many groups are actually required rather than a
// hard-coded 3 — hard-coding it is what would silently lie after a change
// like that one.
// CHANGED 24 Sep 2026: one required group (the front cover), so the badge
// says what is needed rather than counting "1/1".
check('26. The badge says whether the front cover is still needed',
  /listingMediaComplete \? 'Ready to list ✓' : 'Front cover needed'/.test(src) && !/REQUIRED_MEDIA_GROUP_COUNT/.test(src));

check('27. Completion means every requirement met, not a file count',
  /missingMediaGroups\(listingMedia\)\.length === 0/.test(src));

check('28. The catalogue cover is labelled as not being the reader\'s copy',
  /it is not your copy/i.test(src));

check('29. The video slot only accepts video, client-side too',
  /BOOK_MEDIA_VIDEO_TYPES/.test(src));

// ── rent and lend ───────────────────────────────────────────────────────
console.log('\n--- rent and lend are asked separately ---');

check('30. Lend has a checkbox of its own', /name="readingLend"/.test(src));
check('31. Rent still has its own', /name="readingRent"/.test(src));

check('32. Lend is read from its own box, not derived from Rent',
  /lend: formData\.get\('readingLend'\) === 'on'/.test(src));

check('33. Neither checkbox sets the other',
  !/setOfferLend\(true\)[\s\S]{0,80}setOfferRent\(true\)/.test(src)
  && !/offerRent \|\| offerLend/.test(src));

check('34. Rent shows a monthly charge', /Monthly rent/.test(src));
check('35. ...at ten percent of the printed MRP',
  /listingMrpNumber \* 0\.10/.test(src));
check('36. ...and says so in words', /10% of the printed MRP per month/.test(src));

check('37. Lend shows no monthly charge at all',
  /Lending carries no monthly charge/.test(src));

check('38. Rent without an MRP is refused rather than priced at nothing',
  /this book cannot be rented/i.test(src));

// ── MRP ─────────────────────────────────────────────────────────────────
console.log('\n--- an unknown MRP says so ---');

check('39. A missing MRP renders as "Not available", not ₹0',
  /Not available<\/p>/.test(src));

check('40. The MRP number is null when unknown, never 0',
  /Number\.isFinite\(n\) && n > 0 \? n : null/.test(src));

check('41. A reader-typed MRP is sent as a provisional claim of its own',
  /printedMrp: formData\.get\('mrp'\)/.test(src));

// The listing carries the SOURCE of its price, so a number the owner typed
// is never shown as an established fact. The wording lives in the book
// detail panel (pricingSource), not in a separate badge.
check("42. A typed MRP is labelled as the owner's, a verified one as verified",
  /Printed MRP entered by owner/.test(src)
  && /Estimated value — not yet verified/.test(src)
  && /source === 'VERIFIED' \? 'Verified'/.test(src));

// ── authenticity ────────────────────────────────────────────────────────
console.log('\n--- authenticity is shown to everybody ---');

check('43. There is one reader for authenticity, used everywhere',
  /const bookAuthenticity = \(book: any\): BookAuthenticity/.test(src));

check('44. All three states have display text',
  /ORIGINAL: \{[\s\S]{0,200}Original Copy/.test(src)
  && /UNAUTHORISED: \{[\s\S]{0,200}Unauthorised \/ Pirated Copy/.test(src)
  && /UNKNOWN: \{[\s\S]{0,200}Not Verified/.test(src));

check('45. The badge appears on the book card every reader sees',
  /<BookAuthenticityBadge book=\{book\} className="mb-2/.test(src));

check('46. ...and on the listing detail, under its own heading',
  /Book Authenticity<\/p>/.test(src));

check('47. An undeclared copy is never displayed as Original',
  /return 'UNKNOWN';\n\};/.test(src));

// The separate "owner's photos of this copy" block was removed from the
// book page on 22 Sep 2026 at the owner's request; the photos still show
// in the page's main gallery (tap to open full screen).
check('48. The book page has no separate owner-photos section; photos stay in the gallery',
  !/The owner&rsquo;s photos of this copy/.test(src) && /View all \$\{images\.length\} photos/.test(src));

// ── one form, and the price is in it ───────────────────────────────────
//
// The listing modal was written out TWICE, both copies rendering on the
// same condition, so both mounted and the later one painted over the
// earlier. Everything about the price worked — the quote was fetched, the
// band was computed, the state was set — and none of it was visible,
// because the copy carrying the price section was the copy underneath.
//
// That is also what broke autofill: getElementById returns the FIRST
// match, which was the buried copy. One bug, two symptoms, and neither
// one looked like "there are two forms".
console.log('\n--- there is exactly one listing form, and it shows the price ---');

check('49. The listing modal exists once, not twice',
  (src.match(/\{\/\* Listing Form Modal \*\/\}/g) || []).length === 1,
  `found ${(src.match(/\{\/\* Listing Form Modal \*\/\}/g) || []).length}`);

check('50. There is one create form, not two',
  (src.match(/onSubmit=\{handleCreateBook\}/g) || []).length === 1,
  `found ${(src.match(/onSubmit=\{handleCreateBook\}/g) || []).length}`);

check('51. The reader can type the printed MRP',
  /name="mrp"[\s\S]{0,500}value=\{listingMrp\}/.test(src));

check('52. The allowed listing range is rendered',
  /listingBand\.sell\.allowed_min\} &ndash; &#8377;\{listingBand\.sell\.allowed_max\}/.test(src));

check('53. ...the reference value and deposit too, under their own names',
  /SwapSutra reference value/.test(src) && /security deposit/.test(src));

check('54. An MRP-derived band is marked as an estimate',
  /listingBand\.is_estimate/.test(src));

check('55. When nothing can be priced, the reason is shown rather than a blank',
  /listingBand\?\.reason \|\| listingBand\?\.explanation/.test(src));

check('56. The band section sits inside the form the reader actually sees',
  (() => {
    const form = src.indexOf('onSubmit={handleCreateBook}');
    const band = src.indexOf('listingBand?.priceable');
    const media = src.indexOf('Show us your book');
    return form > -1 && band > form && media > form;
  })(),
  'the price band is outside the create form');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
