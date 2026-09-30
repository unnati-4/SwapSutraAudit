// Standalone simulation of the FIXED getBooks() public-library filter,
// copied verbatim from appsscript.js, to unit-test that approved listings
// from trial members, premium members, and admins all surface correctly,
// while genuinely inactive/expired/pending owners' books do not.

function computeSubscriptionStatus(sub) {
  if (!sub) return 'NoSubscription';
  const now = new Date();
  const adminStatus = String(sub.adminStatus || 'Pending').trim();
  const membershipStatus = String(sub.membershipStatus || '').trim().toUpperCase();
  const activationType = String(sub.activationType || '').trim().toLowerCase();
  const paymentStatus = String(sub.paymentStatus || '').trim().toLowerCase();
  const getValLocal = (obj, keys) => {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return null;
  };
  const expiryVal = getValLocal(sub, ["subscriptionExpiry", "subscriptionExpi", "subscriptionExp", "trialEndDate"]);
  const expiryDate = expiryVal ? new Date(expiryVal) : null;
  if (adminStatus.toLowerCase() === 'cancelled' || membershipStatus === 'CANCELLED') return 'CANCELLED';
  if (adminStatus.toLowerCase() === 'rejected' || membershipStatus === 'PAYMENT_FAILED') return 'PAYMENT_FAILED';
  if (adminStatus.toLowerCase() === 'pending' || membershipStatus === 'PAYMENT_PENDING') return 'PAYMENT_PENDING';
  const isTrial = activationType === 'free_trial' || activationType === 'free' || membershipStatus === 'FREE_TRIAL' || paymentStatus === 'free trial' || paymentStatus === 'free';
  if (isTrial) return (expiryDate && now > expiryDate) ? 'EXPIRED' : 'FREE_TRIAL';
  if (adminStatus.toLowerCase() === 'approved' || membershipStatus === 'PREMIUM' || adminStatus.toLowerCase() === 'active') {
    return (expiryDate && now > expiryDate) ? 'EXPIRED' : 'PREMIUM';
  }
  if (expiryDate && now > expiryDate) return 'EXPIRED';
  return adminStatus;
}

const ADMIN_EMAIL = 'swapsutra@gmail.com';
function isAdminEmail(email) { return String(email || '').trim().toLowerCase() === ADMIN_EMAIL; }
function normalizeEmail(email) { return (email || '').trim().toLowerCase(); }

function bookAvailabilityFlags(book) {
  const boolFlag = (v) => v === true || String(v).toUpperCase() === 'TRUE';
  const permanentExchange = boolFlag(book.permanent_exchange);
  const temporaryExchange = boolFlag(book.temporary_exchange);
  const rent = boolFlag(book.rent);
  const sell = boolFlag(book.sell);
  return { permanent_exchange: permanentExchange, temporary_exchange: temporaryExchange, rent, sell };
}
function bookStatusFlags(book) {
  const boolFlag = (v) => v === true || String(v).toUpperCase() === 'TRUE';
  return Object.assign({
    favourite: boolFlag(book.favourite),
    currently_reading: boolFlag(book.currently_reading),
    tbr: boolFlag(book.tbr),
    bookshelf: book.bookshelf === undefined ? true : boolFlag(book.bookshelf)
  }, bookAvailabilityFlags(book));
}
function bookHasPublicLibraryVisibility(book) {
  const flags = bookStatusFlags(book);
  return flags.favourite || flags.bookshelf || flags.permanent_exchange || flags.temporary_exchange || flags.rent || flags.sell;
}

// Mirrors the fixed getBooks() filter exactly.
function isBookPubliclyVisible(b, subData, subHeaders, now) {
  const emailIdx = subHeaders.indexOf('email');
  const status = String(b.status || "").toLowerCase();
  const isApproved = status === 'approved' || status === 'live';
  const expiry = b.expiresAt ? new Date(b.expiresAt) : null;
  const notExpired = !expiry || expiry >= now;
  if (!isApproved || !notExpired) return false;
  if (!bookHasPublicLibraryVisibility(b)) return false;

  if (emailIdx !== -1) {
    const ownerEmail = normalizeEmail(b.ownerEmail);
    if (isAdminEmail(ownerEmail)) return true;
    const ownerSubRow = subData.find(r => normalizeEmail(r[emailIdx]) === ownerEmail);
    if (ownerSubRow) {
      const sub = {};
      subHeaders.forEach((h, i) => sub[h] = ownerSubRow[i]);
      const computed = computeSubscriptionStatus(sub);
      return computed === 'TRIAL' || computed === 'FREE_TRIAL' || computed === 'PREMIUM' || computed === 'Active';
    }
  }
  return false;
}

// The copied filter above reads the real clock (`new Date()`), exactly as
// it does in appsscript.js, so every date here is relative to today. A
// fixed date here made the trial in the fixtures expire as soon as that
// date passed, and this file started failing on its own months later.
const NOW = new Date();
const subHeaders = ['email', 'adminStatus', 'activationType', 'membershipType', 'membershipStatus', 'paymentStatus', 'subscriptionExpiry', 'trialEndDate'];
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${detail || ''}`); }
}

const trialExpiry = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000);
const premiumExpiry = new Date(NOW.getTime() + 300 * 24 * 60 * 60 * 1000);
const expiredTrial = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);

const subData = [
  ['trial@x.com', 'Approved', 'free_trial', 'trial', 'TRIAL', 'Free Trial', trialExpiry, trialExpiry],
  ['premium@x.com', 'Approved', 'paid', 'premium', 'PREMIUM', 'paid', premiumExpiry, ''],
  ['expired@x.com', 'Approved', 'free_trial', 'trial', 'TRIAL', 'Free Trial', expiredTrial, expiredTrial],
  ['pending@x.com', 'Pending', 'paid', 'premium', 'PAYMENT_PENDING', 'Pending', '', ''],
  ['cancelled@x.com', 'Cancelled', 'paid', 'premium', 'CANCELLED', 'Cancelled', '', ''],
];

const baseBook = { status: 'Approved', bookshelf: 'TRUE', permanent_exchange: 'TRUE' };

// 1. Trial member's approved book -> WAS the reported bug, must now be visible
check('1. Trial owner approved book -> visible', isBookPubliclyVisible({ ...baseBook, ownerEmail: 'trial@x.com' }, subData, subHeaders, NOW) === true);

// 2. Premium/Chapters member's approved book -> visible
check('2. Premium owner approved book -> visible', isBookPubliclyVisible({ ...baseBook, ownerEmail: 'premium@x.com' }, subData, subHeaders, NOW) === true);

// 3. Admin's own approved book -> visible
check('3. Admin owner approved book -> visible', isBookPubliclyVisible({ ...baseBook, ownerEmail: ADMIN_EMAIL }, subData, subHeaders, NOW) === true);

// 4. Expired trial owner's book -> must NOT be visible
check('4. Expired-trial owner book -> hidden', isBookPubliclyVisible({ ...baseBook, ownerEmail: 'expired@x.com' }, subData, subHeaders, NOW) === false);

// 5. Pending (unapproved membership) owner's book -> must NOT be visible
check('5. Payment-pending owner book -> hidden', isBookPubliclyVisible({ ...baseBook, ownerEmail: 'pending@x.com' }, subData, subHeaders, NOW) === false);

// 6. Cancelled owner's book -> must NOT be visible
check('6. Cancelled-membership owner book -> hidden', isBookPubliclyVisible({ ...baseBook, ownerEmail: 'cancelled@x.com' }, subData, subHeaders, NOW) === false);

// 7. Owner with no Subscriptions row at all -> must NOT be visible (unknown membership)
check('7. Unknown/no-subscription owner book -> hidden', isBookPubliclyVisible({ ...baseBook, ownerEmail: 'ghost@x.com' }, subData, subHeaders, NOW) === false);

// 8. Book still Pending admin approval -> must NOT be visible regardless of owner membership
check('8. Pending-approval book (trial owner) -> hidden', isBookPubliclyVisible({ ...baseBook, ownerEmail: 'trial@x.com', status: 'Pending' }, subData, subHeaders, NOW) === false);

// 9. Approved book but no public-use flags set (private/bookshelf=false, no swap/rent/sell/favourite/tbr/reading) -> hidden
check('9. Approved book w/ no visibility flags -> hidden', isBookPubliclyVisible({ status: 'Approved', ownerEmail: 'trial@x.com', bookshelf: 'FALSE' }, subData, subHeaders, NOW) === false);

// 10. Expired listing (expiresAt in the past) -> hidden even if owner active
check('10. Expired listing (expiresAt past) -> hidden', isBookPubliclyVisible({ ...baseBook, ownerEmail: 'trial@x.com', expiresAt: new Date(NOW.getTime() - 86400000) }, subData, subHeaders, NOW) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
