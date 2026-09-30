// Standalone Node mirror of the FIXED registerFreeReader() (and the
// createSubscription() registration-stub it must never be confused with)
// in appsscript.js, verifying the free-trial-eligibility bug fix.
//
// ROOT CAUSE BEING TESTED: registerFreeReader() used to treat "a
// Subscriptions row exists for this email" as equivalent to "trial already
// consumed" -- but createSubscription() (called by the ordinary Sign Up
// form, including its default "free" tier tab that every brand-new user's
// Sign Up submits through) ALWAYS creates a Subscriptions row at plain
// registration time, before any trial is ever chosen. So every single new
// user hit "already used your free trial" the first time they clicked
// "Continue as Free Reader". The fix distinguishes a genuine trial record
// (activationType='free_trial' OR membershipType='trial' OR non-blank
// trialStartDate/trialEndDate -- fields ONLY ever set by registerFreeReader
// itself) from a bare registration/payment stub row.

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}  ${detail ? JSON.stringify(detail) : ''}`); }
}

function normalizeEmail(email) { return (email || '').trim().toLowerCase(); }

// --- Mirrors computeSubscriptionStatus() in appsscript.js exactly. ---
function computeSubscriptionStatus(sub) {
  if (!sub) return 'NoSubscription';
  const now = new Date();
  const adminStatus = String(sub.adminStatus || 'Pending').trim();
  const membershipStatus = String(sub.membershipStatus || '').trim().toUpperCase();
  const activationType = String(sub.activationType || '').trim().toLowerCase();
  const paymentStatus = String(sub.paymentStatus || '').trim().toLowerCase();

  const getValLocal = (obj, keys) => {
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    return null;
  };
  const startVal = getValLocal(sub, ['subscriptionStartDate', 'subscriptionStar', 'subscriptionStart', 'trialStartDate']);
  const expiryVal = getValLocal(sub, ['subscriptionExpiry', 'subscriptionExpi', 'subscriptionExp', 'trialEndDate']);
  const expiryDate = expiryVal ? new Date(expiryVal) : null;

  if (adminStatus.toLowerCase() === 'cancelled' || membershipStatus === 'CANCELLED') return 'CANCELLED';
  if (adminStatus.toLowerCase() === 'rejected' || membershipStatus === 'PAYMENT_FAILED') return 'PAYMENT_FAILED';
  if (adminStatus.toLowerCase() === 'pending' || membershipStatus === 'PAYMENT_PENDING') return 'PAYMENT_PENDING';

  const isTrial = activationType === 'free_trial' || activationType === 'free' || membershipStatus === 'FREE_TRIAL' || paymentStatus === 'free trial' || paymentStatus === 'free';
  if (isTrial) {
    if (expiryDate && now > expiryDate) return 'EXPIRED';
    return 'FREE_TRIAL';
  }
  if (adminStatus.toLowerCase() === 'approved' || membershipStatus === 'PREMIUM' || adminStatus.toLowerCase() === 'active') {
    if (expiryDate && now > expiryDate) return 'EXPIRED';
    return 'PREMIUM';
  }
  if (expiryDate && now > expiryDate) return 'EXPIRED';
  return adminStatus;
}

// --- In-memory "Subscriptions" sheet + a real async mutex mirroring
// LockService.getScriptLock()/tryLock() for the double-click test. ---
function makeStore() {
  return { rows: [] /* [{email, ...fields}] */ };
}
function findRow(store, normEmail) {
  return store.rows.findIndex(r => normalizeEmail(r.email) === normEmail);
}

let lockHeld = false;
const lockWaiters = [];
async function acquireLock(timeoutMs) {
  if (!lockHeld) { lockHeld = true; return true; }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      const idx = lockWaiters.indexOf(entry);
      if (idx !== -1) lockWaiters.splice(idx, 1);
      resolve(false);
    }, timeoutMs);
    const entry = () => { clearTimeout(timer); lockHeld = true; resolve(true); };
    lockWaiters.push(entry);
  });
}
function releaseLock() {
  lockHeld = false;
  const next = lockWaiters.shift();
  if (next) next();
}

// --- Mirrors createSubscription()'s registration-stub row creation for the
// "free" tier of the Sign Up form -- i.e. what EVERY brand-new user's
// account looks like immediately after Sign Up, before ever touching
// "Continue as Free Reader". trialStartDate/trialEndDate are always blank;
// membershipType is always hardcoded 'premium' (a separate, pre-existing
// quirk of createSubscription unrelated to this bug, reproduced faithfully
// so the fixture is realistic); membershipStatus is hardcoded
// 'PAYMENT_PENDING' regardless of adminStatus. ---
function simulateSignupStub(store, email, { adminStatus = 'Approved', activationType = 'free' } = {}) {
  const normEmail = normalizeEmail(email);
  store.rows.push({
    id: 'SS_SUB_' + normEmail.split('@')[0],
    email: normEmail,
    name: normEmail.split('@')[0],
    paymentRequired: 'No',
    activationType,
    membershipType: 'premium', // hardcoded by createSubscription for every row, faithfully reproduced
    membershipStatus: 'PAYMENT_PENDING', // hardcoded by createSubscription for every row
    paymentStatus: 'Approved',
    adminStatus,
    subscriptionStartDate: new Date(),
    subscriptionExpiry: '',
    trialStartDate: '',
    trialEndDate: '',
    booksListedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

// --- Mirrors a genuinely-consumed trial row exactly as registerFreeReader
// itself creates it (used to seed "already consumed" / "expired trial"
// fixtures for Test 2 / Test 6). ---
function simulateGenuineTrialRow(store, email, { daysAgoStarted = 5, trialLengthDays = 30 } = {}) {
  const normEmail = normalizeEmail(email);
  const start = new Date(Date.now() - daysAgoStarted * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + trialLengthDays * 24 * 60 * 60 * 1000);
  store.rows.push({
    id: 'SS_SUB_TRIAL_' + normEmail.split('@')[0],
    email: normEmail,
    name: normEmail.split('@')[0],
    paymentRequired: 'No',
    activationType: 'free_trial',
    membershipType: 'trial',
    membershipStatus: 'TRIAL',
    paymentStatus: 'Free Trial',
    adminStatus: 'Approved',
    subscriptionStartDate: start,
    subscriptionExpiry: end,
    trialStartDate: start,
    trialEndDate: end,
    booksListedCount: 0,
    createdAt: start,
    updatedAt: start
  });
}

// --- Mirrors an active paid Chapters membership row. ---
function simulateActivePremiumRow(store, email) {
  const normEmail = normalizeEmail(email);
  store.rows.push({
    id: 'SS_SUB_' + normEmail.split('@')[0],
    email: normEmail,
    name: normEmail.split('@')[0],
    paymentRequired: 'Yes',
    activationType: 'paid',
    membershipType: 'premium',
    membershipStatus: 'PREMIUM',
    paymentStatus: 'Approved',
    adminStatus: 'Approved',
    subscriptionStartDate: new Date(),
    subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    trialStartDate: '',
    trialEndDate: '',
    booksListedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

// --- The fixed registerFreeReader(), mirroring appsscript.js's new logic
// 1:1 (lock -> find row -> hasGenuineTrialRecord/isPremium gate -> block,
// else convert-in-place or append fresh). ---
async function registerFreeReader(store, data) {
  const normEmail = normalizeEmail(data.email);
  if (!normEmail) return { success: false, message: 'Email is required to register.' };

  const now = new Date();
  const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const got = await acquireLock(10000);
  if (!got) {
    return { success: false, error: 'TRIAL_ACTIVATION_BUSY', message: 'Your trial is already being activated. Please wait a moment and check My Profile.' };
  }
  try {
    const idx = findRow(store, normEmail);
    if (idx !== -1) {
      const existingSub = store.rows[idx];
      const hasGenuineTrialRecord =
        String(existingSub.activationType || '').toLowerCase() === 'free_trial' ||
        String(existingSub.membershipType || '').toLowerCase() === 'trial' ||
        !!existingSub.trialStartDate ||
        !!existingSub.trialEndDate;
      const computed = computeSubscriptionStatus(existingSub);
      const isPremium = computed === 'PREMIUM' || computed === 'Active';

      // Idempotent replay: a trial activated moments ago (by the sibling
      // concurrent request in a double-click) is recognized as THIS
      // activation completing, not a rejection. Mirrors appsscript.js.
      const RECENT_ACTIVATION_WINDOW_MS = 60 * 1000;
      if (hasGenuineTrialRecord && computed === 'FREE_TRIAL' && existingSub.trialStartDate) {
        const startedMsAgo = now.getTime() - new Date(existingSub.trialStartDate).getTime();
        if (startedMsAgo >= 0 && startedMsAgo <= RECENT_ACTIVATION_WINDOW_MS) {
          return {
            success: true,
            isRegistered: true,
            message: 'Welcome to SwapSutra! Your 1-Month Free Trial is now active.',
            membershipStatus: 'TRIAL',
            isTrial: true,
            daysRemaining: 30,
            subscription: { id: existingSub.id, trialStartDate: existingSub.trialStartDate, trialEndDate: existingSub.trialEndDate }
          };
        }
      }

      if (hasGenuineTrialRecord || isPremium) {
        const isExpired = computed === 'EXPIRED' || computed === 'Expired';
        return {
          success: false,
          isRegistered: !isExpired,
          alreadyUsedTrial: true,
          message: isPremium
            ? 'You already have an active SwapSutra Chapters membership.'
            : 'You have already taken your 30-day free trial. Please subscribe to SwapSutra Chapters (₹49/month) to continue.',
          membershipStatus: computed,
          isExpired
        };
      }

      // Convert the stub row in place -- genuine trial activation.
      existingSub.activationType = 'free_trial';
      existingSub.membershipType = 'trial';
      existingSub.membershipStatus = 'TRIAL';
      existingSub.paymentStatus = 'Free Trial';
      existingSub.adminStatus = 'Approved';
      existingSub.paymentRequired = 'No';
      existingSub.subscriptionStartDate = now;
      existingSub.subscriptionExpiry = trialEnd;
      existingSub.trialStartDate = now;
      existingSub.trialEndDate = trialEnd;
      existingSub.updatedAt = now;

      return {
        success: true,
        isRegistered: true,
        message: 'Welcome to SwapSutra! Your 1-Month Free Trial is now active.',
        membershipStatus: 'TRIAL',
        isTrial: true,
        daysRemaining: 30,
        subscription: { id: existingSub.id, trialStartDate: now, trialEndDate: trialEnd }
      };
    }

    // No row at all: brand-new user, append a fresh genuine trial row.
    store.rows.push({
      id: 'SS_SUB_TRIAL_' + normEmail.split('@')[0],
      email: normEmail,
      activationType: 'free_trial',
      membershipType: 'trial',
      membershipStatus: 'TRIAL',
      paymentStatus: 'Free Trial',
      adminStatus: 'Approved',
      subscriptionStartDate: now,
      subscriptionExpiry: trialEnd,
      trialStartDate: now,
      trialEndDate: trialEnd,
      updatedAt: now
    });
    return {
      success: true,
      isRegistered: true,
      message: 'Welcome to SwapSutra! Your 1-Month Free Trial is now active.',
      membershipStatus: 'TRIAL',
      isTrial: true,
      daysRemaining: 30
    };
  } finally {
    releaseLock();
  }
}

(async () => {
  // ===========================================================
  // Test 1 -- Brand new user, no previous membership/trial at all.
  // ===========================================================
  {
    const store = makeStore();
    const r = await registerFreeReader(store, { email: 'new@example.com' });
    check('Test 1: Brand new user -> trial activated, no error', r.success === true && r.membershipStatus === 'TRIAL');
    check('Test 1b: Exactly one Subscriptions row created', store.rows.length === 1);
  }

  // ===========================================================
  // Test 2 -- User already consumed trial (genuine trial history exists).
  // ===========================================================
  {
    const store = makeStore();
    simulateGenuineTrialRow(store, 'used@example.com', { daysAgoStarted: 5 }); // still within 30 days, but ALREADY activated once
    const r = await registerFreeReader(store, { email: 'used@example.com' });
    check('Test 2: User with genuine trial history -> correctly blocked', r.success === false && r.alreadyUsedTrial === true);
    check('Test 2b: Exact required error message shown', r.message === 'You have already taken your 30-day free trial. Please subscribe to SwapSutra Chapters (₹49/month) to continue.');
  }

  // ===========================================================
  // Test 3 -- Registered but never activated trial (Sign Up stub only,
  // the exact scenario that caused the reported bug).
  // ===========================================================
  {
    const store = makeStore();
    simulateSignupStub(store, 'registered-only@example.com');
    check('Test 3 precondition: signup stub row exists but has no trial evidence', store.rows[0].trialStartDate === '' && store.rows[0].activationType !== 'free_trial');
    const r = await registerFreeReader(store, { email: 'registered-only@example.com' });
    check('Test 3: Registered-but-never-trialed user -> ELIGIBLE, trial activates (bug fix)', r.success === true && r.membershipStatus === 'TRIAL');
    check('Test 3b: No duplicate row created (stub converted in place)', store.rows.length === 1);
    check('Test 3c: The row now carries genuine trial evidence', store.rows[0].activationType === 'free_trial' && !!store.rows[0].trialStartDate);
  }

  // ===========================================================
  // Test 4 -- OTP verified but membership selection not yet completed.
  // Same underlying state as Test 3 (a Sign Up stub, nothing more) --
  // OTP verification itself never touches the Subscriptions sheet.
  // ===========================================================
  {
    const store = makeStore();
    simulateSignupStub(store, 'otp-only@example.com');
    const r = await registerFreeReader(store, { email: 'otp-only@example.com' });
    check('Test 4: OTP-verified, membership selection pending -> still eligible for trial', r.success === true);
  }

  // ===========================================================
  // Test 5 -- Duplicate/previous incomplete record, no trial ever consumed.
  // ===========================================================
  {
    const store = makeStore();
    simulateSignupStub(store, 'incomplete@example.com', { adminStatus: 'Pending' }); // e.g. an abandoned/never-approved signup attempt
    const r = await registerFreeReader(store, { email: 'incomplete@example.com' });
    check('Test 5: Incomplete/duplicate prior record, no real consumption -> still eligible', r.success === true, r);
  }

  // ===========================================================
  // Test 6 -- Expired trial: genuine trial history, past its 30 days.
  // ===========================================================
  {
    const store = makeStore();
    simulateGenuineTrialRow(store, 'expired-trial@example.com', { daysAgoStarted: 45 }); // 45 days ago, 30-day trial -> expired
    const r = await registerFreeReader(store, { email: 'expired-trial@example.com' });
    check('Test 6: Expired trial -> cannot be restarted (blocked)', r.success === false && r.alreadyUsedTrial === true);
    check('Test 6b: Reported as expired, not silently treated as active', r.isExpired === true);
  }

  // ===========================================================
  // Test 7 -- Email case/whitespace variants resolve to the same user.
  // ===========================================================
  {
    const store = makeStore();
    simulateGenuineTrialRow(store, 'user@example.com');
    const variants = ['User@Example.com', 'user@example.com', ' user@example.com ', 'USER@EXAMPLE.COM'];
    let allBlocked = true;
    for (const v of variants) {
      const r = await registerFreeReader(store, { email: v });
      if (!(r.success === false && r.alreadyUsedTrial === true)) allBlocked = false;
    }
    check('Test 7: Case/whitespace email variants all resolve to the same (blocked) user', allBlocked);
    check('Test 7b: No duplicate rows created for the email variants', store.rows.length === 1);
  }

  // ===========================================================
  // Test 8 -- Double-click: two near-simultaneous requests for the same
  // brand-new email must result in exactly one trial / one row, and
  // NEITHER request may see a false "already taken" error.
  // ===========================================================
  {
    const store = makeStore();
    const [r1, r2] = await Promise.all([
      registerFreeReader(store, { email: 'doubleclick@example.com' }),
      registerFreeReader(store, { email: 'doubleclick@example.com' })
    ]);
    const successes = [r1, r2].filter(r => r.success === true).length;
    const falseAlreadyUsed = [r1, r2].some(r => r.success === false && r.alreadyUsedTrial === true);
    // Both requests get told the trial is active (idempotent replay for
    // whichever one loses the race) -- what matters is only ONE trial is
    // ever actually created (Test 8c) and NEITHER sees a false rejection.
    check('Test 8: Both concurrent requests report the trial as successfully active (idempotent)', successes === 2, { r1, r2 });
    check('Test 8b: Neither request sees a false "already used" rejection', falseAlreadyUsed === false, { r1, r2 });
    check('Test 8c: Only one Subscriptions row exists after the race', store.rows.length === 1);
  }

  // ===========================================================
  // Extra -- Active paid Chapters member clicking the trial button is
  // still correctly blocked (pre-existing behavior, must not regress).
  // ===========================================================
  {
    const store = makeStore();
    simulateActivePremiumRow(store, 'premium@example.com');
    const r = await registerFreeReader(store, { email: 'premium@example.com' });
    check('Extra: Active paid Chapters member -> blocked with the premium-specific message (unchanged)', r.success === false && r.message === 'You already have an active SwapSutra Chapters membership.');
  }

  // ===========================================================
  // Extra -- A failed/cancelled payment attempt with NO trial evidence
  // must remain trial-eligible (explicit business rule).
  // ===========================================================
  {
    const store = makeStore();
    simulateSignupStub(store, 'failedpayment@example.com', { adminStatus: 'Rejected', activationType: 'paid' });
    const r = await registerFreeReader(store, { email: 'failedpayment@example.com' });
    check('Extra: Failed/rejected payment attempt, never consumed a trial -> still eligible', r.success === true, r);
  }

  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
})();
