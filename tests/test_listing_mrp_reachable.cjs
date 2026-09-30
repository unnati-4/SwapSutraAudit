/**
 * test_listing_mrp_reachable.cjs
 *
 * The reader must be able to satisfy the server's MRP requirement.
 *
 * The defect: `listingEdition` was a piece of state whose setter was never
 * called from any control — the edition selector had lived in the second
 * copy of the listing modal, and went with it when that duplicate was
 * removed. So it sat at '' for every reader, for every book, forever.
 *
 * Everything gated on it silently disappeared: the MRP box, the "I don't
 * have the MRP" tickbox, and the price band under them. The server still
 * required a printed MRP for any listing offering swap/rent/lend/sell, so it
 * refused the submission with:
 *
 *   "Please enter the MRP printed on your book, or tick "I don't have the
 *    MRP" if you can't find it."
 *
 * ...naming two controls that were not on the page. There was no way
 * through. This is why books were not being listed.
 *
 * The rule these lock in: every piece of state that gates the MRP box must
 * be reachable from a control the reader can actually operate.
 */

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');

// --- The wiring that went missing --------------------------------------
const setterCalls = (src.match(/setListingEdition\(/g) || []).length;
check('1. setListingEdition is actually called somewhere', setterCalls > 0);

// The declaration and the reset both mention it; a real control must too.
// Counting is what catches a regression where the only remaining callers
// are the declaration and the form reset.
check('2. ...and not only by the declaration and the form reset',
  setterCalls >= 2, setterCalls + ' call(s)');

check('3. The copy-type radio sets the edition tier alongside the copy type',
  /setListingCopyType\(opt\.value\);[\s\S]{0,600}setListingEdition\(/.test(src));

check('4. Every copy-type option maps to a tier, so none leaves it blank',
  /opt\.value === 'ORIGINAL' \? 'PUBLISHER'[\s\S]{0,200}opt\.value === 'REPRINT' \? 'REPRINT'[\s\S]{0,120}'NOT_SURE'/.test(src));

// --- The gate itself ----------------------------------------------------
check('5. The MRP box is still gated on the edition (the gate is fine; the blank value was the bug)',
  /\{listingEdition && listingEdition !== 'UNOFFICIAL' && \(/.test(src));

// --- Both halves of what the server asks for must exist -----------------
check('6. The MRP input is on the form', /name="mrp"/.test(src));
check('7. The "I don\'t have the MRP" tickbox is on the form', /name="noPrintedMrp"/.test(src));

// Both are what the submit actually sends; the server accepts either.
check('8. The typed MRP is submitted', /printedMrp: formData\.get\('mrp'\)/.test(src));
check('9. The tickbox is submitted', /noPrintedMrp: formData\.get\('noPrintedMrp'\) === 'on'/.test(src));

// --- The reset must not reintroduce a blank that no control can fill ----
check('10. Resetting the form clears the copy type and the edition together',
  /setListingCopyType\('\'?\)[\s\S]{0,200}setListingEdition\(''\)/.test(src)
  || (/setListingCopyType\(''\)/.test(src) && /setListingEdition\(''\)/.test(src)));

// --- The escape hatch must stay an escape hatch -------------------------
check('11. Ticking the box clears and disables the MRP field rather than sending a stale number',
  /onChange=\{\(e\) => \{ setListingNoMrp\(e\.target\.checked\); if \(e\.target\.checked\) setListingMrp\(''\); \}\}/.test(src));

check('12. The MRP field is required unless the box is ticked',
  /required=\{!listingNoMrp\}/.test(src));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
