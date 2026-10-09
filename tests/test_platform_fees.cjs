/**
 * test_platform_fees.cjs  (Oct 2026)
 *
 * Free registration, the per-exchange platform fee and the 20-book listing
 * allowance, tested against the shipped appsscript.js. Sheets, Drive and
 * the session are replaced with in-memory stand-ins; everything else is the
 * real code.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}

function makeEnv() {
  const sheets = {};
  const props = {};
  const notifications = [];
  let session = '';
  const bookCounts = {};

  function makeSheet(headers) {
    const data = headers && headers.length ? [headers.slice()] : [];
    return {
      _data: data,
      getDataRange() { return { getValues: () => data.map(r => r.slice()) }; },
      appendRow(row) { data.push(row.slice()); },
      getRange(r, c) { return { setValue: (v) => { while (data[r - 1].length < c) data[r - 1].push(''); data[r - 1][c - 1] = v; }, getValue: () => data[r - 1][c - 1] }; },
      getLastRow() { return data.length; },
      getLastColumn() { return data[0] ? data[0].length : 0; }
    };
  }

  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch() { throw new Error('no network'); } },
    Utilities: { getUuid: () => crypto.randomUUID() },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, putAll() {}, getAll: () => ({}) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    MailApp: { sendEmail() {} },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
    DriveApp: {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gs, ctx, { filename: 'appsscript.js' });

  // Replace the I/O edges with in-memory versions; the logic stays real.
  Object.assign(ctx, {
    getOrCreateSheet(name, headers) {
      if (!sheets[name]) sheets[name] = makeSheet(headers);
      return sheets[name];
    },
    ensureSheetHeaders(sheet, headers) {
      if (!sheet._data.length) sheet._data.push([]);
      const current = sheet._data[0];
      headers.forEach(h => { if (current.indexOf(h) === -1) current.push(h); });
      return current.slice();
    },
    saveFileToDrive: (data) => (data ? 'https://drive.example/file' : ''),
    createNotification: (...args) => { notifications.push(args); return {}; },
    appendStageEvent: () => ({}),
    getAuthenticatedEmail: () => session,
    isAuthenticatedAdmin: () => session === 'swapsutra@gmail.com',
    recalculateBooksListedCount: (e) => bookCounts[String(e).toLowerCase()] || 0
  });
  const api = new Proxy({}, { get: (_, name) => (...args) => { ctx.__a = args; return JSON.parse(JSON.stringify(vm.runInContext(`${String(name)}.apply(null, __a)`, ctx) ?? null)); } });

  return {
    api, sheets, props, notifications,
    as(email) { session = email; },
    setBooks(email, n) { bookCounts[email] = n; },
    addUser(email, extra) {
      const s = ctx.getOrCreateSheet('Users', ['email', 'name', 'phone', 'membershipStatus']);
      s.appendRow([email, 'R', '9800000000', (extra && extra.membershipStatus) || '']);
    },
    addSub(email, extra) {
      const s = ctx.getOrCreateSheet('Subscriptions', ['email', 'name', 'adminStatus', 'membershipStatus', 'activationType', 'trialStartDate', 'trialEndDate']);
      s.appendRow([email, 'R', (extra && extra.adminStatus) || 'Pending', (extra && extra.membershipStatus) || '',
        (extra && extra.activationType) || '', (extra && extra.trialStartDate) || '', (extra && extra.trialEndDate) || '']);
    }
  };
}

const NEW = '2026-10-10T10:00:00+05:30';
const OLD = '2026-09-01T10:00:00+05:30';
const swap = (serviceType, createdAt, extra) => ({
  obj: Object.assign({ serviceType, createdAt, securityDeposit: 0, ownerDeposit: 0 }, extra || {}),
  requesterEmail: 'req@x.com', ownerEmail: 'own@x.com'
});
const byRole = (reqs) => Object.fromEntries(reqs.map(r => [r.payerRole, r]));

console.log('--- free registration ---');
{
  const env = makeEnv();
  env.addUser('a@x.com');
  env.addSub('b@x.com', { adminStatus: 'Pending', membershipStatus: 'PAYMENT_PENDING' });
  env.addSub('c@x.com', { adminStatus: 'Cancelled' });
  check('1. Users row alone = member', env.api.isRegisteredReader_('a@x.com') === true);
  check('2. Old unpaid ₹49 application = member now', env.api.isRegisteredReader_('b@x.com') === true);
  check('3. Cancelled (suspended) account is not a member', env.api.isRegisteredReader_('c@x.com') === false);
  check('4. Unknown email is not a member', env.api.isRegisteredReader_('nobody@x.com') === false);
  check('5. Email case and spaces are ignored', env.api.isRegisteredReader_('  A@X.com ') === true);

  const r = env.api.freeMemberCheckSubscriptionResponse_('a@x.com', null, { email: 'a@x.com', name: 'A' });
  check('6. checkSubscription says registered, active, never expired',
    r.isRegistered === true && r.isTrial === true && r.isExpired === false && r.membershipStatus === 'TRIAL');
  check('7. No countdown is offered', r.daysRemaining === undefined && r.daysRemainingValid === false);
  check('8. Listing allowance rides along', r.listingAllowance && r.listingAllowance.limit === 20);
  const c = env.api.freeMemberCheckSubscriptionResponse_('c@x.com', { email: 'c@x.com', adminStatus: 'Cancelled' }, null);
  check('9. Suspended account is reported as not registered', c.isRegistered === false && c.membershipStatus === 'CANCELLED');
}

console.log('--- platform fee ---');
{
  const env = makeEnv();
  const s1 = byRole(env.api.computeExchangePayments_(swap('SWAP', NEW)));
  check('10. Permanent swap, no deposits: both pay ₹10',
    s1.requester.requiredAmount === 10 && s1.owner.requiredAmount === 10 && s1.owner.depositAmount === 0);

  const s2 = byRole(env.api.computeExchangePayments_(swap('SWAP', NEW, { securityDeposit: 150, ownerDeposit: 90 })));
  // 9 Oct 2026 (owner's rule): in a swap with a deposit the ₹10 fee is
  // taken from the deposit at the refund — nothing extra is paid up front.
  check('11. Temporary swap: each pays only the deposit (fee comes out of it later)',
    s2.requester.requiredAmount === 150 && s2.requester.depositAmount === 150 && s2.requester.platformFee === 0 &&
    s2.owner.requiredAmount === 90 && s2.owner.depositAmount === 90);

  {
    const r = byRole(env.api.computeExchangePayments_(swap('RENT', NEW, { securityDeposit: 120, ownerDeposit: 999 })));
    check('12. RENT: requester pays deposit + fee, owner pays only the fee (ownerDeposit ignored)',
      r.requester.requiredAmount === 130 && r.owner.requiredAmount === 10 && r.owner.depositAmount === 0);
    const l = byRole(env.api.computeExchangePayments_(swap('LEND', NEW, { securityDeposit: 120, ownerDeposit: 999 })));
    check('12a. LEND: only the borrower pays (deposit + ₹10); the owner pays nothing',
      l.requester.requiredAmount === 130 && l.requester.platformFee === 10 && !l.owner);
  }

  // Oct 2026: a sale goes through SwapSutra — the buyer pays price + fee,
  // the seller pays nothing up front (their fee comes out of the payout).
  const sale = env.api.computeExchangePayments_(swap('SELL', NEW, { amount: 300 }));
  check('12b. SELL: the buyer pays the price + ₹10 to SwapSutra', sale.length === 1 && sale[0].payerRole === 'requester'
    && sale[0].requiredAmount === 310 && sale[0].saleAmount === 300 && sale[0].platformFee === 10 && sale[0].depositAmount === 0);
  check('12c. SELL: the seller pays nothing up front', !sale.some(r => r.payerRole === 'owner'));
  const oldSale = byRole(env.api.computeExchangePayments_(swap('SELL', '2026-10-07T10:00:00+05:30', { amount: 300 })));
  check('12d. A sale made before the change keeps the old rule (fee only, each side)', oldSale.requester.requiredAmount === 10 && oldSale.owner.requiredAmount === 10);
  const old = env.api.computeExchangePayments_(swap('SWAP', OLD));
  check('13. Exchange created before launch: unchanged (no rows, chat stays open)', old.length === 0);
  const oldDep = byRole(env.api.computeExchangePayments_(swap('RENT', OLD, { securityDeposit: 120 })));
  check('14. Pre-launch rent keeps its deposit, no fee, no new owner row',
    oldDep.requester.requiredAmount === 120 && oldDep.requester.platformFee === 0 && !oldDep.owner);

  const adminSwap = swap('SWAP', NEW);
  adminSwap.ownerEmail = 'swapsutra@gmail.com';
  const a = byRole(env.api.computeExchangePayments_(adminSwap));
  check('15. The admin account never pays a platform fee', !a.owner && a.requester.requiredAmount === 10);

  env.props.PLATFORM_FEE_PER_PARTY = '12';
  const p = byRole(env.api.computeExchangePayments_(swap('LEND', NEW)));
  check('16. Fee can be changed from Script Properties', p.requester.requiredAmount === 12 && !p.owner);

  const legacy = env.api.feeRecordBreakdown_({ requiredAmount: 150, depositAmount: '', platformFee: '' });
  check('17. A pre-change fee row reads as all deposit, zero fee', legacy.depositAmount === 150 && legacy.platformFee === 0);
}

console.log('--- listing allowance ---');
{
  const env = makeEnv();
  env.addUser('r@x.com');
  env.as('r@x.com');

  env.setBooks('r@x.com', 19);
  check('18. 19 listed: may list the 20th', env.api.getListingAllowanceFor_('r@x.com').canList === true);
  env.setBooks('r@x.com', 20);
  const full = env.api.getListingAllowanceFor_('r@x.com');
  check('19. 20 listed: blocked', full.canList === false && full.remaining === 0);
  check('20. Message names the ₹20 unlock', /₹20/.test(env.api.listingLimitMessage_(full)));

  // 9 Oct 2026 (owner's request): coupon codes were removed.
  const old = env.api.redeemListingUnlockCoupon({ code: 'BOOKSTORE2627' });
  check('21. Coupon codes are no longer accepted (even the old bookstore code)', old.success === false && old.error === 'COUPONS_REMOVED');
  check('22. ...and the reply points bookstores to partner registration', /\/partners/.test(old.message));
  check('23. Still blocked after trying a code', env.api.getListingAllowanceFor_('r@x.com').canList === false);
  check('24. The limit message no longer mentions coupons', !/coupon/i.test(env.api.listingLimitMessage_(full)));
}

{
  const env = makeEnv();
  env.addUser('p@x.com');
  env.addUser('q@x.com');
  env.setBooks('p@x.com', 20);
  env.as('p@x.com');

  check('25. Payment without screenshot is refused',
    env.api.submitListingUnlockPayment({ utr: 'ABC123456789' }).success === false);
  check('26. Malformed UTR is refused',
    env.api.submitListingUnlockPayment({ utr: '12-34', fileData: 'x' }).success === false);

  const sub = env.api.submitListingUnlockPayment({ utr: 'ABC123456789', fileData: 'x' });
  check('27. Valid payment is recorded as pending', sub.success === true && !!sub.allowance.pendingUnlock);
  check('28. Pending does NOT unlock yet', env.api.getListingAllowanceFor_('p@x.com').canList === false);
  check('29. Admin is notified', env.notifications.some(n => n[1] === 'listing_unlock_submitted'));
  check('30. A second submission while pending is refused',
    env.api.submitListingUnlockPayment({ utr: 'XYZ999999999', fileData: 'x' }).success === false);

  env.as('q@x.com');
  check('31. Someone else cannot reuse the same UTR',
    env.api.submitListingUnlockPayment({ utr: 'abc123456789', fileData: 'x' }).success === false);

  env.as('p@x.com');
  check('32. Readers cannot list or review unlocks', env.api.adminListListingUnlocks({}).success === false &&
    env.api.adminReviewListingUnlock({ id: 'x' }).success === false);

  env.as('swapsutra@gmail.com');
  const queue = env.api.adminListListingUnlocks({});
  check('33. Admin sees the pending request', queue.success && queue.count === 1);
  const id = queue.items[0].id;
  check('34. Reject needs a reason', env.api.adminReviewListingUnlock({ id, decision: 'REJECT' }).success === false);
  const rej = env.api.adminReviewListingUnlock({ id, decision: 'REJECT', reason: 'Amount was ₹2' });
  check('35. Reject works with a reason', rej.success === true);
  const afterRej = env.api.getListingAllowanceFor_('p@x.com');
  check('36. Rejected: still limited, reason shown to reader',
    afterRej.canList === false && afterRej.lastRejection && /₹2/.test(afterRej.lastRejection.reason));

  env.as('p@x.com');
  check('37. After rejection the reader can resubmit — even the same UTR',
    env.api.submitListingUnlockPayment({ utr: 'ABC123456789', fileData: 'x' }).success === true);

  env.as('swapsutra@gmail.com');
  const id2 = env.api.adminListListingUnlocks({}).items[0].id;
  env.api.adminReviewListingUnlock({ id: id2, decision: 'APPROVE' });
  check('38. Approved: unlimited', env.api.getListingAllowanceFor_('p@x.com').unlimited === true);
  check('39. Reviewing twice is refused', env.api.adminReviewListingUnlock({ id: id2, decision: 'APPROVE' }).success === false);

  const rev = env.api.adminPlatformRevenueSummary();
  check('40. Revenue counts the ₹20 unlock', rev.success && rev.unlockFees === 20 && rev.unlocksPaid === 1);
}

console.log('--- wiring into the existing code ---');
{
  const env = makeEnv();
  const expiredTrial = { email: 'old@x.com', activationType: 'free_trial', trialStartDate: '2026-01-01', trialEndDate: '2026-01-31', adminStatus: 'Approved' };
  check('41. A trial that ended in January now counts as an active member (Library keeps the shelf)',
    env.api.computeSubscriptionStatus(expiredTrial) === 'FREE_TRIAL');
  check('42. An unpaid ₹49 application counts as an active member',
    env.api.computeSubscriptionStatus({ paymentRequired: 'Yes', adminStatus: 'Pending', membershipStatus: 'PAYMENT_PENDING' }) === 'FREE_TRIAL');
  check('43. Cancelled stays cancelled', env.api.computeSubscriptionStatus({ adminStatus: 'Cancelled' }) === 'CANCELLED');
  env.addSub('old@x.com', { adminStatus: 'Approved', activationType: 'free_trial', trialStartDate: '2026-01-01', trialEndDate: '2026-01-31' });
  check('44. isApprovedActiveMember: expired-trial reader may list and request again', env.api.isApprovedActiveMember('old@x.com') === true);
  check('45. isApprovedActiveMember: a stranger still may not', env.api.isApprovedActiveMember('stranger@x.com') === false);
  check('46. The expiry job does nothing', env.api.checkExpiredSubscriptions() === null);
  check('47. The expiry-reminder job sends nothing', env.api.sendMembershipExpiryReminders().remindersSent === 0);

  const swapObj = { id: 'SS_SWAP_1', serviceType: 'RENT', createdAt: NEW, securityDeposit: 120, requesterEmail: 'req@x.com', ownerEmail: 'own@x.com' };
  const s = { obj: swapObj, requesterEmail: 'req@x.com', ownerEmail: 'own@x.com' };
  const reqs = byRole(env.api.securityFeeRequirements(s));
  check('48. securityFeeRequirements now charges both readers on a rent', reqs.requester.requiredAmount === 130 && reqs.owner.requiredAmount === 10);
  env.api.ensureSecurityFeeRecords(s);
  const status = env.api.securityFeeStatus(s, 'req@x.com', false);
  const mine = status.payers.find(p => p.payerRole === 'requester');
  check('49. The fee sheet stores deposit and fee apart', mine.depositAmount === 120 && mine.platformFee === 10 && mine.requiredAmount === 130);
  check('50. Chat stays locked until both are approved', status.required === true && status.allApproved === false);

  check('51. createBook enforces the new allowance', /const allowance = getListingAllowanceFor_\(ownerEmail, currentCount\);/.test(gs) && !/isPremium \? 500 : 10/.test(gs));
  check('52. The new actions are routed in doPost', ['getListingAllowance', 'redeemListingUnlockCoupon', 'submitListingUnlockPayment', 'adminListListingUnlocks', 'adminReviewListingUnlock', 'adminPlatformRevenueSummary'].every(a => gs.includes(`action === '${a}'`)));
}

console.log('--- the app ---');
{
  check('53. Sign-up form no longer offers a paid tier', !/Premium \(₹49\)/.test(app));
  check('54. Sign-up form has no UPI payment fields', !/name="utr"/.test(app) && !/SwapSutra%20Reader%20Pass/.test(app));
  const visible = app.split('\n').filter(l => !/^\s*(\/\/|\*|\{\/\*)/.test(l) && !/\/\/.*₹49/.test(l)).join('\n');
  check('55. No "₹49" left anywhere a reader can see', !/₹49/.test(visible));
  check('56. The listing form asks the server for the allowance', /fetchListingAllowance\(\)/.test(app) && /LISTING_LIMIT_REACHED/.test(app));
  check('57. The unlock modal is mounted', /<ListingUnlockPanel/.test(app));
  check('58. The admin unlock queue is mounted', /<AdminListingUnlockQueue/.test(app));
  const ssm = fs.readFileSync(path.join(root, 'src/components/SwapStateMachine.tsx'), 'utf8');
  check('59. Stages tab shows the fee breakdown', /platform fee/.test(ssm) && /p\.platformFee/.test(ssm));
}

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail === 0 ? 0 : 1);
