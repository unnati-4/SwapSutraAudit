// Standalone simulation of the FIXED checkSubscription daysRemaining logic
// (both the `sub` branch and the `profileUser` fallback branch), copied
// verbatim from appsscript.js, to unit-test the trial-days calculation
// across all states without a live Apps Script environment.

function simulateSubBranch(sub, now) {
  const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_SANE_TRIAL_DAYS = 31;

  // computeSubscriptionStatus (simplified mirror, trial/premium/expired only)
  const activationType = String(sub.activationType || '').trim().toLowerCase();
  const isTrialActivation = activationType === 'free_trial' || activationType === 'free';
  const expiryForStatus = sub.subscriptionExpiry || sub.trialEndDate;
  const expiryDateForStatus = expiryForStatus ? new Date(expiryForStatus) : null;
  let computed;
  if (isTrialActivation) {
    computed = (expiryDateForStatus && now > expiryDateForStatus) ? 'EXPIRED' : 'FREE_TRIAL';
  } else {
    computed = (expiryDateForStatus && now > expiryDateForStatus) ? 'EXPIRED' : 'PREMIUM';
  }

  const isPremium = computed === 'PREMIUM';
  const isExpired = computed === 'EXPIRED';
  let mStatus = isPremium ? 'PREMIUM' : (isExpired ? 'EXPIRED' : 'TRIAL');

  const expiryVal = sub.subscriptionExpiry || sub.trialEndDate;
  const expiryDate = expiryVal ? new Date(expiryVal) : null;
  let daysRemaining = 0;
  let daysRemainingValid = false;
  if (expiryDate && !isNaN(expiryDate.getTime())) {
    daysRemaining = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    daysRemainingValid = true;
  }

  if (mStatus === 'TRIAL' && (!daysRemainingValid || daysRemaining > MAX_SANE_TRIAL_DAYS)) {
    const trialStartVal = sub.trialStartDate || sub.subscriptionStartDate;
    const trialStartDate = trialStartVal ? new Date(trialStartVal) : null;
    if (trialStartDate && !isNaN(trialStartDate.getTime())) {
      const recomputedEnd = new Date(trialStartDate.getTime() + TRIAL_DURATION_MS);
      daysRemaining = Math.max(0, Math.ceil((recomputedEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      daysRemainingValid = true;
    } else {
      daysRemaining = 0;
      daysRemainingValid = false;
    }
  }

  return { mStatus, isPremium, isExpired, daysRemaining, daysRemainingValid };
}

function simulateProfileUserBranch(profileUser, now) {
  const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_SANE_TRIAL_DAYS = 31;

  const mStatusRaw = String(profileUser.membershipStatus || '').trim().toUpperCase();
  const payStatusRaw = String(profileUser.paymentStatus || '').trim().toLowerCase();
  const isPremium = (mStatusRaw === 'PREMIUM' || mStatusRaw === 'ACTIVE') && payStatusRaw === 'paid';
  let isTrialStatus = mStatusRaw === 'TRIAL' || mStatusRaw === 'FREE_TRIAL' || mStatusRaw === 'ACTIVE' || mStatusRaw === 'FREE';

  const joinDateVal = profileUser.createdAt;
  const rawJoinDate = joinDateVal ? new Date(joinDateVal) : now;
  const joinDate = (isNaN(rawJoinDate.getTime()) || rawJoinDate.getTime() > now.getTime()) ? now : rawJoinDate;
  const trialEnd = new Date(joinDate.getTime() + TRIAL_DURATION_MS);
  const isExpired = !isPremium && isTrialStatus && now > trialEnd;
  const daysRemaining = Math.max(0, Math.min(MAX_SANE_TRIAL_DAYS, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))));

  return { isPremium, isExpired, daysRemaining, isTrialStatus };
}

const NOW = new Date('2026-08-20T12:00:00Z');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${detail || ''}`); }
}

// 1. New trial user (registered seconds ago)
{
  const start = new Date(NOW.getTime());
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sub = { activationType: 'free_trial', membershipType: 'trial', trialStartDate: start, trialEndDate: end, subscriptionStartDate: start, subscriptionExpiry: end };
  const r = simulateSubBranch(sub, NOW);
  check('1. New trial user -> ~30 days, TRIAL, valid', r.daysRemaining === 30 && r.mStatus === 'TRIAL' && r.daysRemainingValid, JSON.stringify(r));
}

// 2. Trial with ~30 days remaining (same as above, redundant but explicit)
{
  const start = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000); // joined 1 day ago
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sub = { activationType: 'free_trial', trialStartDate: start, trialEndDate: end, subscriptionExpiry: end };
  const r = simulateSubBranch(sub, NOW);
  check('2. Trial ~29 days remaining', r.daysRemaining === 29, JSON.stringify(r));
}

// 3. Trial with 15 days remaining
{
  const start = new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sub = { activationType: 'free_trial', trialStartDate: start, trialEndDate: end, subscriptionExpiry: end };
  const r = simulateSubBranch(sub, NOW);
  check('3. Trial 15 days remaining', r.daysRemaining === 15, JSON.stringify(r));
}

// 4. Trial with 1 day remaining
{
  const start = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sub = { activationType: 'free_trial', trialStartDate: start, trialEndDate: end, subscriptionExpiry: end };
  const r = simulateSubBranch(sub, NOW);
  check('4. Trial 1 day remaining', r.daysRemaining === 1 && !r.isExpired, JSON.stringify(r));
}

// 5. Trial expired
{
  const start = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sub = { activationType: 'free_trial', trialStartDate: start, trialEndDate: end, subscriptionExpiry: end };
  const r = simulateSubBranch(sub, NOW);
  check('5. Trial expired -> 0 days, EXPIRED', r.daysRemaining === 0 && r.isExpired, JSON.stringify(r));
}

// 6. Active paid (Chapters) subscriber, ~1 year membership, ~300 days left
{
  const start = new Date(NOW.getTime() - 65 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
  const sub = { activationType: 'paid', membershipType: 'premium', subscriptionStartDate: start, subscriptionExpiry: end };
  const r = simulateSubBranch(sub, NOW);
  check('6. Paid subscriber -> PREMIUM, ~300 days, NOT clamped to 31', r.mStatus === 'PREMIUM' && r.daysRemaining === 300, JSON.stringify(r));
}

// 7. Missing/invalid trial date (both expiry and start blank)
{
  const sub = { activationType: 'free_trial', trialStartDate: '', trialEndDate: '', subscriptionExpiry: '' };
  const r = simulateSubBranch(sub, NOW);
  check('7. Missing trial dates -> fails safe (0, invalid) not fabricated', r.daysRemaining === 0 && r.daysRemainingValid === false, JSON.stringify(r));
}

// 7b. THE REPORTED BUG: expiry corrupted to ~1 year out (old manageMembershipApproval
//     bug) while activationType is still free_trial and a valid trialStartDate exists
//     -> must self-heal from trialStartDate instead of showing the corrupted expiry.
{
  const start = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000); // joined 2 days ago, should have 28 left
  const corruptedEnd = new Date(NOW.getTime());
  corruptedEnd.setFullYear(corruptedEnd.getFullYear() + 1); // the old bug's "+1 Year" write
  const sub = { activationType: 'free_trial', trialStartDate: start, subscriptionStartDate: start, trialEndDate: '', subscriptionExpiry: corruptedEnd };
  const r = simulateSubBranch(sub, NOW);
  check('7b. Corrupted +1yr expiry on a trial row self-heals to true 28 days (not ~365)', r.daysRemaining === 28 && r.mStatus === 'TRIAL', JSON.stringify(r));
}

// 8. Existing older user: Users-sheet-only fallback branch, createdAt from long ago (expired)
{
  const profileUser = { membershipStatus: 'TRIAL', paymentStatus: 'Free Trial', createdAt: new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000) };
  const r = simulateProfileUserBranch(profileUser, NOW);
  check('8a. Old existing trial user (400 days old) -> expired, 0 days', r.isExpired === true && r.daysRemaining === 0, JSON.stringify(r));
}
// 8b. Existing older user with a genuinely fresh createdAt (recently onboarded)
{
  const profileUser = { membershipStatus: 'TRIAL', paymentStatus: 'Free Trial', createdAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000) };
  const r = simulateProfileUserBranch(profileUser, NOW);
  check('8b. Existing user w/ createdAt 5 days ago -> 25 days left', r.daysRemaining === 25, JSON.stringify(r));
}
// 8c. Existing user with a bad/future createdAt (clock skew / bad manual edit)
{
  const profileUser = { membershipStatus: 'TRIAL', paymentStatus: 'Free Trial', createdAt: new Date(NOW.getTime() + 500 * 24 * 60 * 60 * 1000) };
  const r = simulateProfileUserBranch(profileUser, NOW);
  check('8c. Future/bad createdAt -> clamped to 30, not negative/huge', r.daysRemaining === 30, JSON.stringify(r));
}

// Extra: never exceed MAX_SANE_TRIAL_DAYS for a TRIAL row no matter how corrupted the expiry is
{
  const start = new Date(NOW.getTime()); // fresh, would be valid 30 on its own
  const insaneEnd = new Date(NOW.getTime() + 10000 * 24 * 60 * 60 * 1000); // +10,000 days
  const sub = { activationType: 'free_trial', trialStartDate: start, subscriptionStartDate: start, subscriptionExpiry: insaneEnd };
  const r = simulateSubBranch(sub, NOW);
  check('Extra: insane stored expiry never surfaces raw -> self-heals to 30', r.daysRemaining === 30 && r.daysRemaining <= 31, JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
