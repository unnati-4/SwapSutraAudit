/**
 * test_admin_cleanup.cjs  (9 Oct 2026, owner's request)
 *   • The management page shows only what the site still uses.
 *   • Payments → "Review" works: it opens the payment (amount, UTR,
 *     screenshot) with Approve / Reject, right there.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const q = fs.readFileSync(path.join(root, 'src/components/AdminSecurityFeeQueue.tsx'), 'utf8');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
const tabsBlock = app.slice(app.indexOf('  const tabs = [\n    { id: \'dashboard\''), app.indexOf('  ];', app.indexOf('  const tabs = [\n    { id: \'dashboard\'')));
['quillInsights', 'approvals', 'coupons', 'pricing', 'newsletterSubscribers', 'bookRequestResponses'].forEach((t, i) =>
  check(`${i + 1}. "${t}" is gone from the management tabs`, tabsBlock.indexOf(`id: '${t}'`) === -1));
['dashboard', 'securityFeeQueue', 'disputes', 'members', 'books', 'bookRequests', 'support', 'events', 'newsletter', 'bookPricing', 'readerBadges', 'customMugs'].forEach((t, i) =>
  check(`${i + 7}. "${t}" stays`, tabsBlock.indexOf(`id: '${t}'`) !== -1));
check('19. Payments is second, right after Analytics', /id: 'dashboard'[^\n]*\n\s*\{ id: 'securityFeeQueue', label: 'Payments'/.test(tabsBlock));
check('20. An old link to a removed tab opens Analytics', /const REMOVED = \['quillInsights', 'approvals', 'coupons', 'pricing'/.test(app));
check('21. No stale membership-fee cards on Analytics', !/'Pending Approvals'/.test(app) && !/'Estimated Revenue'/.test(app) && !/Coupons Usage/.test(app));

check('22. Review no longer depends on a callback nobody passes', /setOpen\(open === r\.swapId \? null : r\.swapId\)/.test(q));
check('23. Review shows the UTR and the screenshot', /UTR: <span/.test(q) && /Open payment screenshot/.test(q));
check('24. Approve / Reject call the real action', /action: 'adminApproveSecurityFeePayment', swapId, payerRole, decision, reason/.test(q));
check('25. Rejecting needs a reason (the reader sees it)', /decision === 'REJECT' && !reason/.test(q));
check('26. The server sends UTR / screenshot / breakdown with the queue', /utr: p\.utr, screenshotUrl: p\.screenshotUrl, submittedAt: p\.submittedAt/.test(gs));
check('27. Closed (expired / cancelled) requests leave the queue', /if \(!roomSwapAccepted_\(status\)\) continue;/.test(gs));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
