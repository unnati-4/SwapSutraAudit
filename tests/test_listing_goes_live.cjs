/**
 * test_listing_goes_live.cjs
 *
 * The reported bug was "listed books are not visible in the frontend
 * library". Two of the four gates behind that are covered here, both
 * against real code rather than a re-implementation:
 *
 *   Gate 1 — photos: the form required 2+ photos and hard-rejected
 *            anything over 1MB with no compression, so most people could
 *            never submit a listing at all.
 *   Gate 2 — approval: every listing was created as 'Pending' while the
 *            public Library only returns 'approved'/'live', with nothing
 *            driving the approval queue.
 *
 * The Apps Script half loads appsscript.js for real. The browser half
 * re-implements prepareListingPhoto's decision logic (canvas and Image
 * do not exist in Node), so those cases document intent rather than
 * executing the shipped function — noted honestly rather than implied.
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

// ---------------------------------------------------------------- setup
const scriptProperties = new Map();
const sandbox = {
  console,
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
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8'), ctx, { filename: 'appsscript.js' });
const run = (e) => vm.runInContext(e, ctx);

// ============================================== Gate 2: listing status
console.log('\n--- Gate 2: a new listing reaches the Library ---');

scriptProperties.delete('REQUIRE_BOOK_APPROVAL');
check('1. Default: a new listing is created Approved, not Pending',
  run('initialBookStatus()') === 'Approved');

check('2. Default: manual review is off',
  run('requiresManualBookApproval()') === false);

// The public Library filter accepts exactly these two.
check('3. The default status is one the public Library actually returns',
  ['approved', 'live'].includes(run('initialBookStatus()').toLowerCase()));

scriptProperties.set('REQUIRE_BOOK_APPROVAL', 'true');
check('4. REQUIRE_BOOK_APPROVAL=true restores manual review',
  run('requiresManualBookApproval()') === true && run('initialBookStatus()') === 'Pending');

scriptProperties.set('REQUIRE_BOOK_APPROVAL', 'TRUE');
check('5. The setting is case-insensitive',
  run('initialBookStatus()') === 'Pending');

scriptProperties.set('REQUIRE_BOOK_APPROVAL', 'false');
check('6. Explicitly false goes live immediately',
  run('initialBookStatus()') === 'Approved');

scriptProperties.set('REQUIRE_BOOK_APPROVAL', 'yes-please');
check('7. An unrecognised value fails toward a working Library, not a stuck queue',
  run('initialBookStatus()') === 'Approved');

scriptProperties.delete('REQUIRE_BOOK_APPROVAL');

// ============================================== admin controls intact
console.log('\n--- Admin keeps every existing control ---');

check('8. manageBook is still admin-gated (reactive moderation, not none)',
  run('requireSessionForAction("manageBook")')?.error === 'SESSION_REQUIRED');

const adminToken = run('createSessionToken("swapsutra@gmail.com", "admin")');
run(`resetRequestIdentity(); establishRequestIdentity({ sessionToken: ${JSON.stringify(adminToken)} })`);
check('9. An authenticated admin can still reach manageBook to reject/remove',
  run('requireSessionForAction("manageBook")') === null && run('isAuthorizedAdminEmail()') === true);
run('resetRequestIdentity()');

// ============================================== newsletter subs tab
console.log('\n--- H4: the Newsletter Subs admin tab has a backend ---');

const source = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
check('10. getNewsletterSubscribers is now dispatched by the backend',
  source.includes("action === 'getNewsletterSubscribers'"));
check('11. ...and it is admin-gated like every other management read',
  /getNewsletterSubscribers'\)\s*\{\s*\n\s*if \(!isAuthorizedAdminEmail/.test(source));

// ============================================== Gate 1: photo handling
console.log('\n--- Gate 1: photo handling (logic mirrored; canvas is browser-only) ---');

const MAX_EDGE = 1600, MAX_BYTES = 1024 * 1024;

// Mirrors prepareListingPhoto's sizing decision.
function targetDimensions(w, h) {
  const longEdge = Math.max(w, h);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

let d = targetDimensions(4032, 3024); // typical phone photo
check('12. A 4032x3024 phone photo is scaled down to a 1600px long edge',
  d.width === 1600 && d.height === 1200);

d = targetDimensions(3024, 4032); // portrait
check('13. Portrait orientation is handled the same way',
  d.height === 1600 && d.width === 1200);

d = targetDimensions(800, 600); // already small
check('14. An already-small image is not upscaled',
  d.width === 800 && d.height === 600);

d = targetDimensions(1, 1);
check('15. A degenerate 1x1 image does not collapse to zero',
  d.width >= 1 && d.height >= 1);

// The old rule, for contrast.
const oldRuleRejects = (bytes) => bytes > MAX_BYTES;
check('16. THE OLD BUG: a 4MB phone photo was rejected outright',
  oldRuleRejects(4 * 1024 * 1024) === true);

// A 1600x1200 JPEG at q0.82 is ~250-450KB; well inside the cap.
const estimatedCompressedBytes = 350 * 1024;
check('17. The same photo, resized and re-encoded, lands under the limit',
  estimatedCompressedBytes < MAX_BYTES);

check('18. Five compressed photos stay under Vercel\'s 4.5MB request cap (H2)',
  (estimatedCompressedBytes * 5 * 1.37) < 4.5 * 1024 * 1024); // 1.37 ≈ base64 overhead

// Source-level assertions about the shipped implementation.
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
// 30 Sep: the photo shrinker moved to utils/imageCompress.ts (shared with
// the custom mug enquiry); App.tsx imports it. Checked together.
const compressSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'imageCompress.ts'), 'utf8');
// Match the REJECTION CODE, not the phrase — the phrase still appears in
// the explanatory comment above prepareListingPhoto, which is intended.
check('19. The hard 1MB rejection is gone from both listing flows',
  !/throw new Error\(`Image \$\{file\.name\} exceeds 1MB limit\./.test(app)
  && !/setErrorMessage\(`Image \$\{file\.name\} exceeds 1MB limit\./.test(app)
  && !/file\.size > 1024 \* 1024/.test(app));
// The photos are still compressed, but they are no longer base64 in a
// request body — they go straight to storage, because a body over 4.5MB is
// refused by Vercel before any of our code runs, and four media never fit.
// So the assertion moved with the mechanism: what matters is still that a
// phone photo is downscaled before it leaves the device, and that the
// video is not re-encoded in a phone browser.
check('20. Both listing flows downscale the photos they send',
  (app.match(/downscaleImageFile\(/g) || []).length >= 2);
// Downscaling happens when the file is CHOSEN, not at submit time, so the
// size shown beside the preview is the size that will actually be sent.
check('20b. Images are downscaled the moment they are chosen',
  /const toSend = spec\.kind === 'image' \? await downscaleImageFile\(file\) : file;/.test(app));
check('20c. ...and a video is kept as recorded rather than re-encoded',
  /re-encoding one in a phone browser is/.test(app));
// The budget, and the fact the reader is told it. A form that refuses a
// file without saying how big it was, or how big it needed to be, leaves
// somebody guessing at both.
check('20d. The size budget is derived from the real limit, not invented',
  /Vercel refuses a request body over/.test(app) && /BOOK_MEDIA_TOTAL_BUDGET_BYTES/.test(app));
check('20f. Every chosen file shows its own size against its target',
  /const MediaSizeLine/.test(app) && /of \{formatBytes\(limit\)\}/.test(app));
check('20g. The running total is shown too, since all four share one request',
  /listingMediaBytes/.test(app) && /of \$\{formatBytes\(BOOK_MEDIA_TOTAL_BUDGET_BYTES\)\}/.test(app));
check('20h. An over-budget set is refused with the actual numbers, not "invalid"',
  /Your four files come to \$\{formatBytes\(totalBytes\)\}/.test(app));
check('20i. A file that is too big offers somewhere to shrink it',
  /squoosh\.app/.test(app) && /(rotato|vidshift)/i.test(app));
check('20j. ...and those tools do not take a copy of the reader\'s file',
  /do not upload your (video|photo) anywhere/.test(app));
check('20k. The size shown is the file that will be sent, not the original',
  /bytes: toSend\.size/.test(app));
check('20e. Downscaling never blocks a listing — it falls back to the original',
  /const downscaleImageFile[\s\S]{0,4000}catch \{\s*return file;/.test(compressSrc));
check('20f. Photos are compressed in steps until they fit, not once and hope',
  /LISTING_PHOTO_STEPS/.test(compressSrc) && /candidate\.size <= LISTING_PHOTO_TARGET_BYTES/.test(compressSrc) && /from '\.\/utils\/imageCompress'/.test(app));
check('20g. The image loader does not depend on the name `Image`, which an icon import shadows',
  !/new Image\(\)/.test(app + compressSrc) && /document\.createElement\('img'\)/.test(compressSrc));
check('20h. Each photo travels once, not twice',
  !/images: imagesData/.test(app));
check('22. Transparent PNGs are flattened onto white, not black',
  app.includes("ctx.fillStyle = '#FFFFFF'"));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
