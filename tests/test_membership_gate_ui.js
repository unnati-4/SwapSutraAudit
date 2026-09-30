// Standalone mirror of the membership-gate UI fix in src/App.tsx.
//
// BUG: after registration, an authenticated user whose account had no
// active trial/paid membership yet (userTier === 'pending') was shown the
// full "Become a SwapSutra Member" two-card selection screen (Free Reader /
// Join Chapters — ₹49), and could trigger the backend's
// "You've already used your free trial" rejection message by clicking a
// card that no longer applied to them (their trial was never genuinely
// consumed -- the row simply existed).
//
// FIX (in the shared MembershipGate component in App.tsx): a new
// `isExpiredTrial` prop (derived from the already-existing `userTier`
// state, never inferred from row existence) distinguishes "genuinely
// expired trial -- still needs the ₹49 upgrade offer" from "pending, no
// confirmed active membership -- awaiting admin approval, nothing to
// choose". Only the FIRST case still renders the two cards; the second
// renders a new, card-free "Waiting for Admin Approval" screen. Both
// derive from the same backend-driven `userTier`/`membershipStatus`
// state that already existed -- no new membership system, no new state.
//
// This file mirrors:
//   1. computeUserTier() -- the pre-existing App.tsx logic (unchanged by
//      this fix) that turns backend membershipStatus into a frontend tier.
//   2. renderMembershipGateDecision() -- the NEW decision inside the
//      MembershipGate component: isAwaitingApproval = isAuthenticated &&
//      isMembershipPending && !isExpiredTrial.
//   3. A trimmed mirror of the backend's computeSubscriptionStatus/
//      registerFreeReader (from the membership-lifecycle fix already
//      shipped) so each scenario's backend membershipStatus is derived
//      from real field state, never from "a row exists".

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}  ${detail ? JSON.stringify(detail) : ''}`); }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SANE_PAID_MEMBERSHIP_MS = 400 * DAY_MS;

// --- Trimmed mirror of the backend computeSubscriptionStatus (see
// appsscript.js / test_membership_lifecycle.js for the full version). ---
function computeSubscriptionStatus(sub, now) {
  if (!sub) return 'NoSubscription';
  now = now || new Date();
  const adminStatusLower = String(sub.adminStatus || 'Pending').trim().toLowerCase();
  const membershipStatus = String(sub.membershipStatus || '').trim().toUpperCase();
  const activationType = String(sub.activationType || '').trim().toLowerCase();
  const membershipType = String(sub.membershipType || '').trim().toLowerCase();
  const paymentStatus = String(sub.paymentStatus || '').trim().toLowerCase();
  const paymentWasRequired = String(sub.paymentRequired || '').trim().toLowerCase() === 'yes';

  if (adminStatusLower === 'cancelled' || membershipStatus === 'CANCELLED') return 'CANCELLED';
  if (paymentWasRequired && (adminStatusLower === 'rejected' || membershipStatus === 'PAYMENT_FAILED')) return 'PAYMENT_FAILED';

  const isPaidMembershipType = membershipType === 'premium' || membershipType === 'paid';
  const paymentGenuinelyApproved = adminStatusLower === 'approved' || paymentStatus === 'approved' || paymentStatus === 'paid';
  if (paymentWasRequired || isPaidMembershipType) {
    const subStart = sub.subscriptionStartDate ? new Date(sub.subscriptionStartDate) : null;
    const subExpiry = sub.subscriptionExpiry ? new Date(sub.subscriptionExpiry) : null;
    const hasSaneDatedWindow = subStart && subExpiry && (subExpiry.getTime() - subStart.getTime()) <= MAX_SANE_PAID_MEMBERSHIP_MS;
    if (paymentGenuinelyApproved && hasSaneDatedWindow) return now > subExpiry ? 'EXPIRED' : 'PREMIUM';
    if (paymentWasRequired && !paymentGenuinelyApproved) return 'PAYMENT_PENDING';
  }

  const hasGenuineTrialSignal = activationType === 'free_trial' || membershipType === 'trial' || !!sub.trialStartDate || !!sub.trialEndDate;
  if (hasGenuineTrialSignal) {
    const trialStart = sub.trialStartDate ? new Date(sub.trialStartDate) : null;
    const trialEnd = sub.trialEndDate ? new Date(sub.trialEndDate) : null;
    if (trialStart && trialEnd) {
      if (now >= trialEnd) return 'EXPIRED';
      if (now >= trialStart) return 'FREE_TRIAL';
    }
  }

  if (!paymentWasRequired && !hasGenuineTrialSignal) return 'NoSubscription';
  return sub.adminStatus || 'Pending';
}

// --- Mirrors checkSubscription's `sub` branch -> the frontend membershipStatus
// values ('pending' | 'trial' | 'premium' | 'expired') syncUserSession sets. ---
function backendMembershipStatusFor(sub, now) {
  const computed = computeSubscriptionStatus(sub, now);
  if (computed === 'PREMIUM') return 'premium';
  if (computed === 'EXPIRED') return 'expired';
  if (computed === 'PAYMENT_PENDING' || computed === 'PAYMENT_FAILED' || computed === 'CANCELLED' || computed === 'NoSubscription') return 'pending';
  if (computed === 'FREE_TRIAL') return 'trial';
  return 'pending';
}

// --- Mirrors computeUserTier from App.tsx (unchanged by this fix). ---
function computeUserTier({ activeUserEmail, isAdmin, membershipStatus }) {
  if (!activeUserEmail) return 'guest';
  if (isAdmin) return 'premium';
  if (membershipStatus === 'pending') return 'pending';
  if (membershipStatus === 'expired' || membershipStatus === 'failed' || membershipStatus === 'cancelled') return 'expired';
  if (membershipStatus === 'premium') return 'premium';
  if (membershipStatus === 'trial') return 'trial';
  return 'pending';
}

// --- Mirrors the NEW decision inside MembershipGate. ---
function renderMembershipGateDecision({ isAuthenticated, isMembershipPending, isExpiredTrial }) {
  const isAwaitingApproval = isAuthenticated && isMembershipPending && !isExpiredTrial;
  if (isAwaitingApproval) return 'WAITING_FOR_ADMIN_APPROVAL';
  if (isAuthenticated && isMembershipPending) return 'CHOOSE_MEMBERSHIP_CARDS'; // only reachable when isExpiredTrial === true now
  if (isAuthenticated) return 'NORMAL_APP_ACCESS';
  return 'JOIN_SWAPSUTRA_GUEST_CARD';
}

// --- End-to-end: given a Subscriptions row (or none) and auth state,
// produce what the embedded MembershipGate (the page shown at
// !isRegisteredMember && !isAdmin, e.g. after registration) actually
// renders -- mirrors the real call site's prop wiring exactly. ---
function renderPostRegistrationScreen({ activeUserEmail, isAdmin, sub, now }) {
  now = now || new Date();
  const membershipStatus = activeUserEmail ? backendMembershipStatusFor(sub, now) : null;
  const userTier = computeUserTier({ activeUserEmail, isAdmin, membershipStatus });
  const isRegisteredMember = Boolean(activeUserEmail) && (isAdmin || userTier === 'trial' || userTier === 'premium');
  if (isRegisteredMember || isAdmin) return { screen: 'NORMAL_APP_ACCESS', userTier };
  const isMembershipPending = true; // exact prop value the real call site passes
  const isExpiredTrial = userTier === 'expired';
  const screen = renderMembershipGateDecision({ isAuthenticated: Boolean(activeUserEmail), isMembershipPending, isExpiredTrial });
  return { screen, userTier };
}

(async () => {
  const now = new Date('2026-08-21T12:00:00Z');

  // =====================================================================
  // 1. New free registration, pending approval -> Waiting for Admin Approval.
  //    (A bare free-tier registration stub -- REGISTERED, no genuine trial
  //    signals, paymentRequired: No -- must never be read as "trial used".)
  // =====================================================================
  {
    const sub = { email: 'freepending@example.com', paymentRequired: 'No', activationType: 'free', membershipType: 'free', membershipStatus: 'REGISTERED', adminStatus: 'Approved', trialStartDate: '', trialEndDate: '', subscriptionStartDate: '', subscriptionExpiry: '' };
    const result = renderPostRegistrationScreen({ activeUserEmail: 'freepending@example.com', isAdmin: false, sub, now });
    check('1. New free registration (pending) -> Waiting for Admin Approval', result.screen === 'WAITING_FOR_ADMIN_APPROVAL', result);
  }

  // =====================================================================
  // 2. New paid registration, awaiting admin approval -> Waiting for Admin
  //    Approval (not the choose-membership cards, not blocked entirely).
  // =====================================================================
  {
    const sub = { email: 'paidpending@example.com', paymentRequired: 'Yes', activationType: 'paid', membershipType: 'premium', membershipStatus: 'PAYMENT_PENDING', adminStatus: 'Pending', paymentStatus: 'Pending', trialStartDate: '', trialEndDate: '', subscriptionStartDate: '', subscriptionExpiry: '' };
    const result = renderPostRegistrationScreen({ activeUserEmail: 'paidpending@example.com', isAdmin: false, sub, now });
    check('2. New paid registration (adminStatus=Pending) -> Waiting for Admin Approval', result.screen === 'WAITING_FOR_ADMIN_APPROVAL', result);
  }

  // =====================================================================
  // 3. Active free trial -> normal app access (no gate screen at all).
  // =====================================================================
  {
    const trialStart = new Date(now.getTime() - 5 * DAY_MS);
    const trialEnd = new Date(trialStart.getTime() + 30 * DAY_MS);
    const sub = { email: 'activetrial@example.com', paymentRequired: 'No', activationType: 'free_trial', membershipType: 'trial', membershipStatus: 'TRIAL', adminStatus: 'Approved', trialStartDate: trialStart, trialEndDate: trialEnd };
    const result = renderPostRegistrationScreen({ activeUserEmail: 'activetrial@example.com', isAdmin: false, sub, now });
    check('3. Active free trial -> normal app access', result.screen === 'NORMAL_APP_ACCESS' && result.userTier === 'trial', result);
  }

  // =====================================================================
  // 4. Expired free trial -> upgrade/membership state (two cards, offering
  //    the ₹49 upgrade) -- NOT the waiting screen, NOT normal access.
  // =====================================================================
  {
    const trialStart = new Date(now.getTime() - 60 * DAY_MS);
    const trialEnd = new Date(trialStart.getTime() + 30 * DAY_MS); // ended 30 days ago
    const sub = { email: 'expiredtrial@example.com', paymentRequired: 'No', activationType: 'free_trial', membershipType: 'trial', membershipStatus: 'TRIAL', adminStatus: 'Approved', trialStartDate: trialStart, trialEndDate: trialEnd };
    const result = renderPostRegistrationScreen({ activeUserEmail: 'expiredtrial@example.com', isAdmin: false, sub, now });
    check('4. Expired free trial -> membership-selection / upgrade cards (not the waiting screen)', result.screen === 'CHOOSE_MEMBERSHIP_CARDS' && result.userTier === 'expired', result);
  }

  // =====================================================================
  // 5. Active verified member -> normal app access.
  // =====================================================================
  {
    const start = new Date(now.getTime() - 5 * DAY_MS);
    const expiry = new Date(start.getTime() + 30 * DAY_MS);
    const sub = { email: 'verified@example.com', paymentRequired: 'Yes', activationType: 'paid', membershipType: 'premium', membershipStatus: 'PREMIUM', adminStatus: 'Approved', paymentStatus: 'Approved', subscriptionStartDate: start, subscriptionExpiry: expiry };
    const result = renderPostRegistrationScreen({ activeUserEmail: 'verified@example.com', isAdmin: false, sub, now });
    check('5. Active verified member -> normal app access', result.screen === 'NORMAL_APP_ACCESS' && result.userTier === 'premium', result);
  }

  // =====================================================================
  // 6. Existing user login -> reflects their existing membership state
  //    (here: an existing active trial), not re-shown any gate screen.
  // =====================================================================
  {
    const trialStart = new Date(now.getTime() - 2 * DAY_MS);
    const trialEnd = new Date(trialStart.getTime() + 30 * DAY_MS);
    const sub = { email: 'returning@example.com', paymentRequired: 'No', activationType: 'free_trial', membershipType: 'trial', membershipStatus: 'TRIAL', adminStatus: 'Approved', trialStartDate: trialStart, trialEndDate: trialEnd };
    const result = renderPostRegistrationScreen({ activeUserEmail: 'returning@example.com', isAdmin: false, sub, now });
    check('6. Existing user login reflects their real (trial) state on this login', result.screen === 'NORMAL_APP_ACCESS' && result.userTier === 'trial', result);
  }

  // =====================================================================
  // 7. Users row exists but no genuine trial -> NOT "trial already used";
  //    lands on the waiting screen, never the false-rejection error path
  //    (the error can only ever come from clicking the removed "Continue
  //    as Free Reader" button, which this screen no longer renders).
  // =====================================================================
  {
    const sub = { email: 'stubonly@example.com', paymentRequired: 'No', activationType: 'free', membershipType: 'free', membershipStatus: 'REGISTERED', adminStatus: 'Approved', trialStartDate: '', trialEndDate: '' };
    const result = renderPostRegistrationScreen({ activeUserEmail: 'stubonly@example.com', isAdmin: false, sub, now });
    check('7a. A Users/Subscriptions row existing is NOT read as trial-consumed', computeSubscriptionStatus(sub, now) !== 'EXPIRED' && computeSubscriptionStatus(sub, now) !== 'PREMIUM');
    check('7b. Screen shown is the waiting screen, which has no "Continue as Free Reader" button to click (so the false error cannot be triggered)', result.screen === 'WAITING_FOR_ADMIN_APPROVAL');
  }

  // =====================================================================
  // 8. Subscriptions row exists but admin approval is pending -> Waiting
  //    for Admin Approval (duplicate-emphasis case for the ₹49 flow).
  // =====================================================================
  {
    const sub = { email: 'awaiting8@example.com', paymentRequired: 'Yes', activationType: 'paid', membershipType: 'premium', membershipStatus: 'PAYMENT_PENDING', adminStatus: 'Pending', paymentStatus: 'Pending' };
    const result = renderPostRegistrationScreen({ activeUserEmail: 'awaiting8@example.com', isAdmin: false, sub, now });
    check('8. Subscriptions row exists, adminStatus=Pending -> Waiting for Admin Approval', result.screen === 'WAITING_FOR_ADMIN_APPROVAL');
  }

  // =====================================================================
  // Extra: brand-new unauthenticated visitor still sees the normal
  // login/signup ("Join SwapSutra") card, completely unaffected.
  // =====================================================================
  {
    const result = renderPostRegistrationScreen({ activeUserEmail: null, isAdmin: false, sub: null, now });
    check('Extra. Unauthenticated guest still sees the normal Join SwapSutra card', result.screen === 'JOIN_SWAPSUTRA_GUEST_CARD');
  }

  // Extra: admin is never gated regardless of subscription state.
  {
    const result = renderPostRegistrationScreen({ activeUserEmail: 'admin@example.com', isAdmin: true, sub: null, now });
    check('Extra. Admin always gets normal app access', result.screen === 'NORMAL_APP_ACCESS');
  }

  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
})();
