/**
 * test_listing_unlock_and_support.cjs  (8 Oct 2026, owner's request)
 *   • After 20 free listings, the "list more books" popup shows ONCE; after
 *     that the profile has the button. ₹20 covers 3 months (a coupon does
 *     not expire). Books already listed stay.
 *   • A "Support SwapSutra" heart in the header, for everyone, shows the
 *     UPI QR with no amount.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/components/ListingUnlockPanel.tsx'), 'utf8');
const support = fs.readFileSync(path.join(root, 'src/components/SupportQr.tsx'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
const ctx = vm.createContext({ console: { log() {} }, Logger: { log() {} } });
vm.runInContext(gs, ctx);
const DAY = 86400000;
const row = (o) => ({ obj: Object.assign({ email: 'a@x.com', status: 'APPROVED' }, o) });
const now = Date.now();
const st = (rows) => ctx.listingUnlockStateFor_('a@x.com', rows);

check('1. A paid unlock approved 10 days ago is active', !!st([row({ method: 'UPI', reviewedAt: new Date(now - 10 * DAY) })]).approved);
check('2. ...one approved 91 days ago has ended (3 months)', (() => { const s = st([row({ method: 'UPI', reviewedAt: new Date(now - 91 * DAY) })]); return !s.approved && !!s.expired; })());
check('3. A coupon unlock does not expire', !!st([row({ method: 'COUPON', reviewedAt: new Date(now - 400 * DAY) })]).approved);
check('4. Paying again after it ended unlocks again', !!st([row({ method: 'UPI', reviewedAt: new Date(now - 200 * DAY) }), row({ method: 'UPI', reviewedAt: new Date(now - DAY) })]).approved);
check('5. The allowance reports until when, and that it ended', /unlockedUntil:/.test(gs) && /unlockExpired: !unlimited && !!state\.expired/.test(gs));
check('6. The message offers ₹20 for 3 months', /it's ₹\$\{allowance\.unlockFee\} for 3 months/.test(gs));
check('7. Approval says 3 months', /for the next 3 months/.test(gs));

check('8. The popup is shown once per reader', /const offerListingUnlock = \(\) =>/.test(app) && /listingPopupAlreadyShown\(email\)/.test(app) && /markListingPopupShown\(email\)/.test(app));
check('9. ...right after the 20th listing', /needsListingUnlock\(a\) && !a\.pendingUnlock && !listingPopupAlreadyShown/.test(app));
check('10. No "List unlimited" buttons are left around the app', !/List unlimited/.test(app));
check('11. The profile has the "List more books — ₹20 / 3 months" button', /List more books — ₹20 \/ 3 months/.test(app) && /data-testid="list-more-books"/.test(app));
check('12. The panel explains 3 months and that listed books stay', /₹\{fee\} for 3 months/.test(panel) && /books already listed stay/.test(panel));

check('13. A Support SwapSutra icon is in the header, for everyone', /aria-label="Support SwapSutra"/.test(app) && /data-testid="header-support"/.test(app)
  && !/\{activeUserEmail && \(\s*<button\s*type="button"\s*className="ss-header__icon relative"\s*aria-label="Support SwapSutra"/.test(app));
check('14. It opens the QR modal', /<SupportQr open=\{showSupportQr\}/.test(app));
check('15. The support QR has NO amount', /upi:\/\/pay\?pa=\$\{SUPPORT_UPI_VPA\}/.test(support) && !/&am=/.test(support));
check('16. It pays SwapSutra\'s own UPI ID', /7534845373-3@ybl/.test(support) && /'7534845373-3@ybl'/.test(gs));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
