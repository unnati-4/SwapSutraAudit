// Standalone mirror of the membership-lifecycle fix, SECOND PASS.
//
// This supersedes the first version of this file. The first pass fixed
// createSubscription's membershipType hardcoding and the broken upgrade
// path, but a real production Google Sheet row proved the lifecycle was
// STILL fundamentally wrong underneath that:
//
//   email = unnatigoyal61@gmail.com
//   paymentRequired = No, activationType = free, paymentStatus = Approved,
//   adminStatus = Approved, membershipType = premium,
//   membershipStatus = PAYMENT_PENDING, trialStartDate/trialEndDate = blank,
//   subscriptionStartDate = 2026-08-21T11:39:09.688Z,
//   subscriptionExpiry = 2036-08-21T11:39:09.688Z  (+10 YEARS)
//
// Root causes found by re-auditing the actual code (not guessed):
//
//   ROOT BUG #1 (the main one): createSubscription's brand-new-row branch
//   wrote `row[i] = data.activatedAt || data.subscriptionStartDate || ''`
//   and `row[i] = data.expiresAt || data.subscriptionExpiry || ''` for
//   subscriptionStartDate/subscriptionExpiry -- i.e. it TRUSTED CLIENT-
//   SUPPLIED DATES. App.tsx's handleCreateSubscription sent
//   `expiresAt: subFormTier === 'free' ? now + 10 years : null` for every
//   free-tier registration. That client value landed verbatim in the Sheet.
//
//   ROOT BUG #5: createSubscription also hardcoded membershipStatus =
//   'PAYMENT_PENDING' for EVERY row regardless of tier, and the old
//   computeSubscriptionStatus() checked `membershipStatus === 'PAYMENT_PENDING'`
//   BEFORE ever checking whether the row was trial-flavored -- so a Free
//   Explorer stub could never even reach the trial branch.
//
//   ROOT BUG #4: computeSubscriptionStatus()'s check order and lack of any
//   "was payment actually required on THIS row" signal meant a stray
//   membershipType='premium' (from the OLD, now also-fixed, hardcoding bug)
//   plus a populated (fabricated) subscriptionStartDate/subscriptionExpiry
//   was indistinguishable from a genuinely active paid membership.
//
// This file mirrors the corrected computeSubscriptionStatus, createSubscription,
// and registerFreeReader exactly as now implemented in appsscript.js,
// including the sane-duration cap that defuses a corrupted/fabricated paid
// window, and the repairAllCorruptedFreeExplorerStubs() self-heal logic.

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}  ${detail ? JSON.stringify(detail) : ''}`); }
}

function normalizeEmail(email) { return (email || '').trim().toLowerCase(); }
function normalizePhoneLast10(phone) { return String(phone || '').replace(/\D/g, '').slice(-10); }

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SANE_PAID_MEMBERSHIP_MS = 400 * DAY_MS;

// ---------------------------------------------------------------------
// EXACT mirror of the rewritten computeSubscriptionStatus(sub) in
// appsscript.js.
// ---------------------------------------------------------------------
function computeSubscriptionStatus(sub, now) {
  if (!sub) return 'NoSubscription';
  now = now || new Date();
  const adminStatus = String(sub.adminStatus || 'Pending').trim();
  const adminStatusLower = adminStatus.toLowerCase();
  const membershipStatus = String(sub.membershipStatus || '').trim().toUpperCase();
  const activationType = String(sub.activationType || '').trim().toLowerCase();
  const membershipType = String(sub.membershipType || '').trim().toLowerCase();
  const paymentStatus = String(sub.paymentStatus || '').trim().toLowerCase();
  const paymentRequiredRaw = String(sub.paymentRequired || '').trim().toLowerCase();
  const paymentWasRequired = paymentRequiredRaw === 'yes' || paymentRequiredRaw === 'true';

  const getValLocal = (obj, keys) => {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return null;
  };

  // 1. CANCELLED
  if (adminStatusLower === 'cancelled' || membershipStatus === 'CANCELLED') return 'CANCELLED';

  // 2. PAYMENT_FAILED -- only for a row that actually required payment.
  if (paymentWasRequired && (adminStatusLower === 'rejected' || membershipStatus === 'PAYMENT_FAILED')) return 'PAYMENT_FAILED';

  // 3/4. VERIFIED (PAID) MEMBER -- from its own dated, sane, approved window.
  const isPaidMembershipType = membershipType === 'premium' || membershipType === 'paid' || membershipType === 'verified' || membershipType === 'verified_member';
  const paymentGenuinelyApproved = adminStatusLower === 'approved' || paymentStatus === 'approved' || paymentStatus === 'paid';
  if (paymentWasRequired || isPaidMembershipType) {
    const subStart = sub.subscriptionStartDate ? new Date(sub.subscriptionStartDate) : null;
    const subExpiry = sub.subscriptionExpiry ? new Date(sub.subscriptionExpiry) : null;
    const hasSaneDatedWindow = subStart && subExpiry
      && !isNaN(subStart.getTime()) && !isNaN(subExpiry.getTime())
      && (subExpiry.getTime() - subStart.getTime()) <= MAX_SANE_PAID_MEMBERSHIP_MS;
    if (paymentGenuinelyApproved && hasSaneDatedWindow) {
      if (now > subExpiry) return 'EXPIRED';
      return 'PREMIUM';
    }
    if (paymentWasRequired && !paymentGenuinelyApproved) return 'PAYMENT_PENDING';
    // else: paid-looking label but not trustworthy -- fall through.
  }

  // 5/6. FREE EXPLORER trial -- from genuine trial evidence only.
  const hasGenuineTrialSignal = activationType === 'free_trial' || membershipType === 'trial' || !!sub.trialStartDate || !!sub.trialEndDate;
  if (hasGenuineTrialSignal) {
    const trialStart = sub.trialStartDate ? new Date(sub.trialStartDate)
      : ((activationType === 'free_trial' || membershipType === 'trial') && sub.subscriptionStartDate ? new Date(sub.subscriptionStartDate) : null);
    const trialEnd = sub.trialEndDate ? new Date(sub.trialEndDate)
      : ((activationType === 'free_trial' || membershipType === 'trial') && sub.subscriptionExpiry ? new Date(sub.subscriptionExpiry) : null);
    if (trialStart && trialEnd && !isNaN(trialStart.getTime()) && !isNaN(trialEnd.getTime())) {
      if (now >= trialEnd) return 'EXPIRED';
      if (now >= trialStart) return 'FREE_TRIAL';
    }
  }

  // 7. Bare registration stub -- no payment, no genuine trial yet.
  if (!paymentWasRequired && !hasGenuineTrialSignal) return 'NoSubscription';

  // 8. Legacy fallback.
  const expiryVal = getValLocal(sub, ['subscriptionExpiry', 'trialEndDate']);
  const expiryDate = expiryVal ? new Date(expiryVal) : null;
  if (expiryDate && now > expiryDate) return 'EXPIRED';
  return adminStatus;
}

// ---------------------------------------------------------------------
// Mirrors createSubscription(data) as now implemented: strict backend-
// derived membershipType, no client-trusted dates, tier-gated
// membershipStatus, and the upgrade-in-place path from the prior pass.
// ---------------------------------------------------------------------
function makeStore() { return { users: [], subs: [] }; }

function createSubscription(store, data) {
  const normEmail = normalizeEmail(data.email);
  const normPhone = normalizePhoneLast10(data.phone);
  const existingRowIndex = store.subs.findIndex(r => normalizeEmail(r.email) === normEmail);
  const emailExistsInUsers = store.users.some(u => normalizeEmail(u.email) === normEmail);
  const phoneExistsInUsers = normPhone.length >= 10 && store.users.some(u => normalizePhoneLast10(u.phone) === normPhone);

  const isExistingAccount = existingRowIndex !== -1 || emailExistsInUsers;
  const isUpgradeRequest = data.isUpgrade === true || String(data.isUpgrade || '').toLowerCase() === 'true';
  const canUpgradeInPlace = isUpgradeRequest && existingRowIndex !== -1;

  if (isExistingAccount && !canUpgradeInPlace) {
    return { success: false, code: 'EMAIL_EXISTS', message: 'You already have a SwapSutra account. Please log in to continue.' };
  }
  if (!canUpgradeInPlace && phoneExistsInUsers) {
    return { success: false, code: 'PHONE_EXISTS', message: 'You already have a SwapSutra account. Please log in to continue.' };
  }

  const paymentRequired = !!data.paymentRequired;

  // Backend-derived membershipType -- paymentRequired:false can NEVER
  // resolve to a paid-sounding value, regardless of what the client sends.
  const clientMembershipTypeLower = String(data.membershipType || '').trim().toLowerCase();
  const clientClaimsPaidVariant = ['premium', 'paid', 'verified', 'verified_member', 'coupon_discount', 'coupon_free'].includes(clientMembershipTypeLower);
  const resolvedMembershipType = !paymentRequired ? 'free' : (clientClaimsPaidVariant ? clientMembershipTypeLower : 'premium');

  if (canUpgradeInPlace) {
    const row = store.subs[existingRowIndex];
    row.name = data.name;
    row.phone = data.phone;
    row.paymentRequired = paymentRequired ? 'Yes' : 'No';
    row.activationType = data.activationType || (paymentRequired ? 'paid' : 'free');
    row.membershipType = resolvedMembershipType;
    row.membershipStatus = paymentRequired ? 'PAYMENT_PENDING' : 'REGISTERED';
    row.adminStatus = data.adminStatus || 'Pending';
    row.subscriptionStartDate = '';
    row.subscriptionExpiry = '';
    row.approvedAt = '';
    if (!store.users.some(u => normalizeEmail(u.email) === normEmail)) {
      store.users.push({ email: normEmail, phone: data.phone, membershipStatus: 'Pending' });
    }
    return { success: true, id: row.id, email: normEmail, message: 'Saved successfully' };
  }

  const id = 'SS_SUB_' + Math.random().toString(36).slice(2);
  const row = {
    id, email: normEmail, name: data.name, phone: data.phone,
    paymentRequired: paymentRequired ? 'Yes' : 'No',
    activationType: data.activationType || (paymentRequired ? 'paid' : 'free'),
    membershipType: resolvedMembershipType,
    membershipStatus: paymentRequired ? 'PAYMENT_PENDING' : 'REGISTERED',
    adminStatus: data.adminStatus || (paymentRequired ? 'Pending' : 'Approved'),
    // NEVER trust data.activatedAt/data.expiresAt (client-supplied) -- this
    // is exactly ROOT BUG #1. Always blank at creation; only a genuine
    // backend activation (registerFreeReader for trial, approval pipeline
    // for paid) ever writes these.
    subscriptionStartDate: '', subscriptionExpiry: '', approvedAt: '',
    trialStartDate: '', trialEndDate: '',
    createdAt: data.now || new Date(),
  };
  store.subs.push(row);
  store.users.push({ email: normEmail, phone: data.phone, membershipStatus: paymentRequired ? 'Pending' : 'Approved' });
  return { success: true, id, email: normEmail, message: 'Saved successfully' };
}

// ---------------------------------------------------------------------
// Mirrors registerFreeReader(data) as now implemented: trialStartDate/
// trialEndDate are the ONLY trial-window fields; subscriptionStartDate/
// subscriptionExpiry are always blanked for a trial (never duplicated).
// ---------------------------------------------------------------------
function hasGenuineTrialRecord(sub) {
  return String(sub.activationType || '').trim().toLowerCase() === 'free_trial' ||
    String(sub.membershipType || '').trim().toLowerCase() === 'trial' ||
    !!sub.trialStartDate || !!sub.trialEndDate;
}

function registerFreeReader(store, email, now) {
  now = now || new Date();
  const normEmail = normalizeEmail(email);
  const trialEnd = new Date(now.getTime() + 30 * DAY_MS);
  const idx = store.subs.findIndex(r => normalizeEmail(r.email) === normEmail);

  if (idx !== -1) {
    const existing = store.subs[idx];
    const computed = computeSubscriptionStatus(existing, now);
    const isPremium = computed === 'PREMIUM';
    const genuine = hasGenuineTrialRecord(existing);

    const RECENT_ACTIVATION_WINDOW_MS = 60 * 1000;
    if (genuine && computed === 'FREE_TRIAL' && existing.trialStartDate) {
      const startedMsAgo = now.getTime() - new Date(existing.trialStartDate).getTime();
      if (startedMsAgo >= 0 && startedMsAgo <= RECENT_ACTIVATION_WINDOW_MS) {
        return { success: true, isRegistered: true, membershipStatus: 'TRIAL', trialStartDate: existing.trialStartDate, trialEndDate: existing.trialEndDate };
      }
    }

    if (genuine || isPremium) {
      const isExpired = computed === 'EXPIRED';
      return {
        success: false, isRegistered: !isExpired, alreadyUsedTrial: true,
        message: isPremium ? 'You already have an active SwapSutra Chapters membership.' : 'You have already taken your 30-day free trial. Please subscribe to SwapSutra Chapters (₹49/month) to continue.',
        membershipStatus: computed, isExpired,
      };
    }

    // Stub row -- convert IN PLACE. subscriptionStartDate/subscriptionExpiry
    // are explicitly blanked (never duplicated with the trial window).
    existing.activationType = 'free_trial';
    existing.membershipType = 'trial';
    existing.membershipStatus = 'TRIAL';
    existing.adminStatus = 'Approved';
    existing.subscriptionStartDate = '';
    existing.subscriptionExpiry = '';
    existing.trialStartDate = now;
    existing.trialEndDate = trialEnd;
    return { success: true, isRegistered: true, membershipStatus: 'TRIAL', trialStartDate: now, trialEndDate: trialEnd };
  }

  store.subs.push({
    email: normEmail, activationType: 'free_trial', membershipType: 'trial', membershipStatus: 'TRIAL',
    adminStatus: 'Approved', subscriptionStartDate: '', subscriptionExpiry: '', trialStartDate: now, trialEndDate: trialEnd,
  });
  return { success: true, isRegistered: true, membershipStatus: 'TRIAL', trialStartDate: now, trialEndDate: trialEnd };
}

// Mirrors the pre-existing, unmodified activateSubscriptionIfEligible: only
// fires on an actual successful/approved payment + an approved book,
// guarded against re-activation -- this is the ONLY place a paid window's
// real dates get written.
function approvePaymentAndActivate(store, email, now) {
  now = now || new Date();
  const row = store.subs.find(r => normalizeEmail(r.email) === normalizeEmail(email));
  if (!row) return { activated: false, reason: 'NOT_FOUND' };
  if (row.subscriptionStartDate && row.subscriptionStartDate !== '') return { activated: false, reason: 'ALREADY_ACTIVE' };
  row.adminStatus = 'Approved';
  row.membershipStatus = 'PREMIUM';
  row.paymentStatus = 'PAID';
  row.subscriptionStartDate = now;
  const expiry = new Date(now); expiry.setMonth(expiry.getMonth() + 1);
  row.subscriptionExpiry = expiry;
  row.approvedAt = now;
  return { activated: true };
}

// Mirrors the LOGIN/ACCESS CALCULATION priority rule.
function computeMembershipState(sub, now) {
  now = now || new Date();
  if (!sub) return 'NO_ACTIVE_MEMBERSHIP';
  const status = computeSubscriptionStatus(sub, now);
  const membershipType = String(sub.membershipType || '').toLowerCase();
  if (status === 'PREMIUM' && (membershipType === 'premium' || membershipType === 'paid')) return 'VERIFIED_MEMBER';
  if (status === 'FREE_TRIAL') return 'ACTIVE_TRIAL';
  if (status === 'EXPIRED') return 'TRIAL_EXPIRED'; // both trial- and paid-expired route through the same expired flow
  return 'NO_ACTIVE_MEMBERSHIP';
}

// Mirrors repairAllCorruptedFreeExplorerStubs()'s per-row decision (with
// ACTIVATE_ON_REPAIR = true, the default).
function repairIfCorrupted(sub, now) {
  now = now || new Date();
  const paymentRequiredRaw = String(sub.paymentRequired || '').trim().toLowerCase();
  const paymentWasRequired = paymentRequiredRaw === 'yes' || paymentRequiredRaw === 'true';
  if (paymentWasRequired) return false;
  const hasGenuineTrial = !!sub.trialStartDate || !!sub.trialEndDate;
  if (hasGenuineTrial) return false;
  const subStart = sub.subscriptionStartDate ? new Date(sub.subscriptionStartDate) : null;
  const subExpiry = sub.subscriptionExpiry ? new Date(sub.subscriptionExpiry) : null;
  const hasFabricatedWindow = subStart && subExpiry && !isNaN(subStart.getTime()) && !isNaN(subExpiry.getTime())
    && (subExpiry.getTime() - subStart.getTime()) > MAX_SANE_PAID_MEMBERSHIP_MS;
  if (!hasFabricatedWindow) return false;

  const trialEnd = new Date(now.getTime() + 30 * DAY_MS);
  sub.membershipType = 'free';
  sub.activationType = 'free_trial';
  sub.membershipStatus = 'TRIAL';
  sub.paymentStatus = 'Free Trial';
  sub.subscriptionStartDate = '';
  sub.subscriptionExpiry = '';
  sub.trialStartDate = now;
  sub.trialEndDate = trialEnd;
  return true;
}

(async () => {
  // =====================================================================
  // CRITICAL: exact reproduction of the reported production row.
  // =====================================================================
  {
    const now = new Date('2026-08-21T12:00:00Z');
    const corruptedRow = {
      email: 'unnatigoyal61@gmail.com',
      paymentRequired: 'No',
      activationType: 'free',
      paymentStatus: 'Approved',
      adminStatus: 'Approved',
      membershipType: 'premium', // stale/corrupted -- old hardcoding bug
      membershipStatus: 'PAYMENT_PENDING',
      trialStartDate: '',
      trialEndDate: '',
      subscriptionStartDate: '2026-08-21T11:39:09.688Z',
      subscriptionExpiry: '2036-08-21T11:39:09.688Z', // +10 years
    };

    check('CRITICAL-PROD-1. Corrupted row is NOT computed as PREMIUM (sane-duration cap defuses the fabricated 10-year window)',
      computeSubscriptionStatus(corruptedRow, now) !== 'PREMIUM');
    check('CRITICAL-PROD-2. Corrupted row is NOT computed as PAYMENT_PENDING either (paymentRequired=No)',
      computeSubscriptionStatus(corruptedRow, now) !== 'PAYMENT_PENDING');
    check('CRITICAL-PROD-3. Corrupted row correctly computes as NoSubscription (registered, no active membership yet)',
      computeSubscriptionStatus(corruptedRow, now) === 'NoSubscription');
    check('CRITICAL-PROD-4. Login-time membership state is NO_ACTIVE_MEMBERSHIP, not falsely VERIFIED_MEMBER',
      computeMembershipState(corruptedRow, now) === 'NO_ACTIVE_MEMBERSHIP');

    // Since it's no longer mistaken for PREMIUM, registerFreeReader's own
    // isPremium/hasGenuineTrialRecord checks now correctly see this as a
    // plain stub and self-heal it via the normal "convert in place" branch.
    const store = makeStore();
    store.subs.push({ ...corruptedRow });
    const activation = registerFreeReader(store, 'unnatigoyal61@gmail.com', now);
    check('CRITICAL-PROD-5. Re-attempting "Continue as Free Reader" on the corrupted row now succeeds (self-heals)', activation.success === true && !activation.alreadyUsedTrial);
    const healedRow = store.subs[0];
    check('CRITICAL-PROD-6. Healed row: membershipType is free (not premium)', healedRow.membershipType === 'trial'); // set by registerFreeReader itself once activated
    check('CRITICAL-PROD-7. Healed row: subscriptionStartDate/Expiry are blank, not the fabricated 10-year window', healedRow.subscriptionStartDate === '' && healedRow.subscriptionExpiry === '');
    check('CRITICAL-PROD-8. Healed row: trialStartDate/trialEndDate now hold a real 30-day window', new Date(healedRow.trialEndDate).getTime() - new Date(healedRow.trialStartDate).getTime() === 30 * DAY_MS);

    // Also verify the standalone manual repair function's logic directly.
    const repairRow = { ...corruptedRow };
    const repaired = repairIfCorrupted(repairRow, now);
    check('CRITICAL-PROD-9. repairAllCorruptedFreeExplorerStubs logic identifies and repairs this exact row', repaired === true);
    check('CRITICAL-PROD-10. Repaired row is now correctly ACTIVE_TRIAL', computeMembershipState(repairRow, now) === 'ACTIVE_TRIAL');
    check('CRITICAL-PROD-11. Repair never touches a genuinely paid row (paymentRequired=Yes is left alone)', repairIfCorrupted({ paymentRequired: 'Yes', subscriptionStartDate: '2020-01-01', subscriptionExpiry: '2036-01-01' }, now) === false);
  }

  // =====================================================================
  // CRITICAL (original): the bare-registration-stub reproduction from the
  // first pass -- still must hold with the rewritten computeSubscriptionStatus.
  // =====================================================================
  {
    const store = makeStore();
    store.users.push({ email: 'new@example.com', phone: '9800000000' });
    store.subs.push({
      email: 'new@example.com', membershipStatus: 'REGISTERED', activationType: 'free',
      membershipType: 'free', adminStatus: 'Approved', paymentRequired: 'No', trialStartDate: '', trialEndDate: '',
      subscriptionStartDate: '', subscriptionExpiry: '',
    });
    const now = new Date('2026-08-21T10:00:00Z');
    const result = registerFreeReader(store, 'new@example.com', now);
    check('CRITICAL. Activation succeeds, not rejected as "already used"', result.success === true && !result.alreadyUsedTrial);
    check('CRITICAL. trialStartDate set to the actual activation moment', new Date(result.trialStartDate).getTime() === now.getTime());
    const expectedEnd = new Date(now.getTime() + 30 * DAY_MS);
    check('CRITICAL. trialEndDate = activation date + 30 days', new Date(result.trialEndDate).getTime() === expectedEnd.getTime());
    check('CRITICAL. Resulting state is ACTIVE_TRIAL', computeMembershipState(store.subs[0], now) === 'ACTIVE_TRIAL');
  }

  // 1. Brand-new Free Explorer via createSubscription -> registerFreeReader,
  //    end to end -- confirms the row createSubscription actually produces
  //    is never mistaken for PAYMENT_PENDING and never carries a fabricated
  //    subscription window.
  {
    const store = makeStore();
    const now = new Date('2026-08-21T09:00:00Z');
    const reg = createSubscription(store, { email: 'brandnew1@example.com', phone: '9800000001', name: 'N', paymentRequired: false, membershipType: 'free', now });
    check('1a. Registration succeeds', reg.success === true);
    const stub = store.subs[0];
    check('1b. Registration stub membershipStatus is never PAYMENT_PENDING', stub.membershipStatus !== 'PAYMENT_PENDING');
    check('1c. Registration stub carries no fabricated subscription window', stub.subscriptionStartDate === '' && stub.subscriptionExpiry === '');
    check('1d. Registration stub is not falsely computed as an active/pending membership', computeSubscriptionStatus(stub, now) === 'NoSubscription');
    const r = registerFreeReader(store, 'brandnew1@example.com', now);
    check('1e. Trial activates with correct 30-day window', r.success && new Date(r.trialEndDate).getTime() - new Date(r.trialStartDate).getTime() === 30 * DAY_MS);
    check('1f. Active protected-page access', computeMembershipState(store.subs[0], now) === 'ACTIVE_TRIAL');
  }

  // 2. Free Explorer must NOT have: premium, PAYMENT_PENDING, or a 10-year
  //    subscriptionExpiry, at any point in the flow.
  {
    const store = makeStore();
    const now = new Date('2026-08-21T00:00:00Z');
    createSubscription(store, { email: 'clean2@example.com', phone: '9800000002', name: 'N', paymentRequired: false, now });
    registerFreeReader(store, 'clean2@example.com', now);
    const row = store.subs[0];
    check('2a. membershipType is never premium for a free registration', row.membershipType !== 'premium');
    check('2b. membershipStatus is never PAYMENT_PENDING', row.membershipStatus !== 'PAYMENT_PENDING');
    check('2c. subscriptionExpiry is never a multi-year-out date', row.subscriptionExpiry === '' || (new Date(row.subscriptionExpiry).getTime() - now.getTime()) < 400 * DAY_MS);
  }

  // 3. Existing registration stub -> converted into active trial.
  {
    const store = makeStore();
    store.subs.push({ email: 'stub3@example.com', membershipStatus: 'REGISTERED', activationType: 'free', membershipType: 'free', adminStatus: 'Approved', paymentRequired: 'No', trialStartDate: '', trialEndDate: '' });
    const r = registerFreeReader(store, 'stub3@example.com', new Date('2026-08-21T00:00:00Z'));
    check('3. A bare registration stub (no genuine trial signals) converts to an active trial', r.success === true);
  }

  // 4. Existing email -> Login.
  {
    const store = makeStore();
    store.users.push({ email: 'exists4@example.com', phone: '9800000004' });
    const res = createSubscription(store, { email: 'exists4@example.com', phone: '9911111111', name: 'X', paymentRequired: false });
    check('4. Existing email is blocked at registration (routes to Login)', res.success === false && res.code === 'EMAIL_EXISTS');
  }

  // 5. Existing phone -> Login.
  {
    const store = makeStore();
    store.users.push({ email: 'other5@example.com', phone: '9800000005' });
    const res = createSubscription(store, { email: 'new5@example.com', phone: '98-000-00005', name: 'X', paymentRequired: false });
    check('5. Existing mobile (different formatting) blocks registration', res.success === false && res.code === 'PHONE_EXISTS');
  }

  // 6. New email + new phone -> new account.
  {
    const store = makeStore();
    const res = createSubscription(store, { email: 'brandnew6@example.com', phone: '9800000006', name: 'X', paymentRequired: false });
    check('6. Genuinely new email+phone registers successfully', res.success === true);
  }

  // 7. Previous genuine trial -> no second trial.
  {
    const store = makeStore();
    const t0 = new Date('2026-07-01T00:00:00Z');
    registerFreeReader(store, 'reuse7@example.com', t0);
    const later = new Date('2026-07-02T00:00:00Z');
    const r2 = registerFreeReader(store, 'reuse7@example.com', later);
    check('7. Re-activating an already-genuine trial is blocked', r2.success === false && r2.alreadyUsedTrial === true);
  }

  // 8. Expired trial -> TRIAL_EXPIRED.
  {
    const store = makeStore();
    const t0 = new Date('2026-01-01T00:00:00Z');
    registerFreeReader(store, 'expired8@example.com', t0);
    const wayLater = new Date('2026-08-21T00:00:00Z');
    check('8. Access recalculates to TRIAL_EXPIRED once trialEndDate has passed', computeMembershipState(store.subs[0], wayLater) === 'TRIAL_EXPIRED');
  }

  // 9. Active trial -> protected pages unlocked.
  {
    const store = makeStore();
    const now = new Date('2026-08-21T00:00:00Z');
    registerFreeReader(store, 'active9@example.com', now);
    check('9. Active trial grants protected-page access', computeMembershipState(store.subs[0], now) === 'ACTIVE_TRIAL');
  }

  // 10. Rs.49 payment pending -> NOT Verified Member.
  {
    const store = makeStore();
    createSubscription(store, { email: 'pending10@example.com', phone: '9800000010', name: 'P', paymentRequired: true, membershipType: 'paid' });
    const row = store.subs[0];
    check('10a. A genuinely paid-tier application IS reported PAYMENT_PENDING while awaiting approval', computeSubscriptionStatus(row, new Date('2026-08-21T00:00:00Z')) === 'PAYMENT_PENDING');
    check('10b. Payment-pending row is NOT Verified Member', computeMembershipState(row, new Date('2026-08-21T00:00:00Z')) !== 'VERIFIED_MEMBER');
  }

  // 11. Rs.49 payment failed -> NOT Verified Member.
  {
    const store = makeStore();
    createSubscription(store, { email: 'failed11@example.com', phone: '9800000011', name: 'P', paymentRequired: true, membershipType: 'paid' });
    const row = store.subs[0];
    row.membershipStatus = 'PAYMENT_FAILED';
    check('11. Failed-payment row is NOT Verified Member', computeMembershipState(row, new Date('2026-08-21T00:00:00Z')) !== 'VERIFIED_MEMBER');
  }

  // 12. Rs.49 successfully approved -> VERIFIED_MEMBER.
  {
    const store = makeStore();
    createSubscription(store, { email: 'payer12@example.com', phone: '9800000012', name: 'P', paymentRequired: true, membershipType: 'paid' });
    const now = new Date('2026-08-21T00:00:00Z');
    const act = approvePaymentAndActivate(store, 'payer12@example.com', now);
    check('12a. Successful payment activation succeeds', act.activated === true);
    const row = store.subs[0];
    check('12b. membershipType is paid, not free', row.membershipType === 'paid');
    check('12c. subscriptionStartDate/Expiry saved (only place these are ever set for a paid row)', !!row.subscriptionStartDate && !!row.subscriptionExpiry);
    check('12d. State is VERIFIED_MEMBER', computeMembershipState(row, now) === 'VERIFIED_MEMBER');
  }

  // 13. Free Explorer upgrades to Rs.49 -> paid takes precedence, trial
  //     history preserved.
  {
    const store = makeStore();
    const trialStart = new Date('2026-08-01T00:00:00Z');
    registerFreeReader(store, 'upgrader13@example.com', trialStart);
    store.users.push({ email: 'upgrader13@example.com', phone: '9800000013' });
    const upgradeRes = createSubscription(store, { email: 'upgrader13@example.com', phone: '9800000013', name: 'U', paymentRequired: true, membershipType: 'paid', isUpgrade: true });
    check('13a. Upgrade-in-place is accepted', upgradeRes.success === true);
    const row = store.subs.find(r => normalizeEmail(r.email) === 'upgrader13@example.com');
    check('13b. Old trial history preserved (trialStartDate untouched)', new Date(row.trialStartDate).getTime() === trialStart.getTime());
    const payDate = new Date('2026-08-20T00:00:00Z');
    approvePaymentAndActivate(store, 'upgrader13@example.com', payDate);
    check('13c. After successful payment, membershipType is paid', row.membershipType === 'paid');
    check('13d. Active paid membership takes precedence over the old trial', computeMembershipState(row, payDate) === 'VERIFIED_MEMBER');
    check('13e. Only one Subscriptions row exists (updated in place)', store.subs.filter(r => normalizeEmail(r.email) === 'upgrader13@example.com').length === 1);
  }

  // 14. Paid membership expiry -> EXPIRED.
  {
    const store = makeStore();
    createSubscription(store, { email: 'paidexp14@example.com', phone: '9800000014', name: 'P', paymentRequired: true, membershipType: 'paid' });
    const start = new Date('2026-01-01T00:00:00Z');
    approvePaymentAndActivate(store, 'paidexp14@example.com', start);
    const row = store.subs[0];
    const wayLater = new Date('2026-08-21T00:00:00Z');
    check('14. Expired paid membership routes to the expired flow, not Verified Member', computeMembershipState(row, wayLater) !== 'VERIFIED_MEMBER');
  }

  // 15. Refresh during active trial -> still ACTIVE_TRIAL.
  {
    const store = makeStore();
    const start = new Date('2026-08-21T00:00:00Z');
    registerFreeReader(store, 'refresh15@example.com', start);
    const refreshedNow = new Date(start.getTime() + 60 * 1000);
    check('15. Status re-read shortly after (simulated refresh) is still ACTIVE_TRIAL', computeMembershipState(store.subs[0], refreshedNow) === 'ACTIVE_TRIAL');
  }

  // 16. Refresh after trial -> TRIAL_EXPIRED.
  {
    const store = makeStore();
    const start = new Date('2026-01-01T00:00:00Z');
    registerFreeReader(store, 'refresh16@example.com', start);
    const refreshedAfterExpiry = new Date(start.getTime() + 31 * DAY_MS);
    check('16. Status re-read after expiry (simulated refresh) is TRIAL_EXPIRED', computeMembershipState(store.subs[0], refreshedAfterExpiry) === 'TRIAL_EXPIRED');
  }

  // 17. Exactly at trialEnd -> expired according to the exclusive-after boundary rule.
  {
    const store = makeStore();
    const start = new Date('2026-08-01T00:00:00Z');
    registerFreeReader(store, 'boundary17@example.com', start);
    const row = store.subs[0];
    const exactlyAtEnd = new Date(row.trialEndDate);
    check('17. Exactly at trialEndDate is expired (now >= trialEnd)', computeMembershipState(row, exactlyAtEnd) === 'TRIAL_EXPIRED');
  }

  // 18. Email case normalization.
  {
    const store = makeStore();
    store.users.push({ email: 'CaseTest@Example.com', phone: '9800000018' });
    const res = createSubscription(store, { email: '  casetest@example.com  ', phone: '9800099999', name: 'X', paymentRequired: false });
    check('18. Differently-cased/whitespaced email is recognized as the same existing account', res.success === false && res.code === 'EMAIL_EXISTS');
  }

  // 19. Phone normalization.
  {
    const store = makeStore();
    store.users.push({ email: 'other19@example.com', phone: '+91 98000-00019' });
    const res = createSubscription(store, { email: 'new19@example.com', phone: '9800000019', name: 'X', paymentRequired: false });
    check('19. Differently-formatted phone is recognized as the same existing number', res.success === false && res.code === 'PHONE_EXISTS');
  }

  // 20. Double-click registration -> one user only.
  {
    const store = makeStore();
    const r1 = createSubscription(store, { email: 'dup20@example.com', phone: '9800000020', name: 'X', paymentRequired: false });
    const r2 = createSubscription(store, { email: 'dup20@example.com', phone: '9800000020', name: 'X', paymentRequired: false });
    check('20. First registration succeeds, second is blocked', r1.success === true && r2.success === false);
    check('20b. Exactly one Subscriptions row', store.subs.filter(r => normalizeEmail(r.email) === 'dup20@example.com').length === 1);
  }

  // 21. Double trial activation -> one trial only.
  {
    const store = makeStore();
    const t0 = new Date('2026-08-21T00:00:00Z');
    registerFreeReader(store, 'dbltrial21@example.com', t0);
    const t1 = new Date(t0.getTime() + 5000);
    const r2 = registerFreeReader(store, 'dbltrial21@example.com', t1);
    check('21a. Rapid double-activation is treated as the same activation succeeding', r2.success === true);
    check('21b. Still exactly one Subscriptions row', store.subs.filter(r => normalizeEmail(r.email) === 'dbltrial21@example.com').length === 1);
  }

  // 22. No duplicate Users row.
  {
    const store = makeStore();
    createSubscription(store, { email: 'nodup22@example.com', phone: '9800000022', name: 'X', paymentRequired: false });
    createSubscription(store, { email: 'nodup22@example.com', phone: '9800000022', name: 'X', paymentRequired: false });
    check('22. No duplicate Users row for the same email', store.users.filter(u => normalizeEmail(u.email) === 'nodup22@example.com').length === 1);
  }

  // 23. No duplicate Subscriptions row across register -> activate -> re-register attempt.
  {
    const store = makeStore();
    const now = new Date('2026-08-21T00:00:00Z');
    createSubscription(store, { email: 'nodupsub23@example.com', phone: '9800000023', name: 'X', paymentRequired: false, now });
    registerFreeReader(store, 'nodupsub23@example.com', now);
    createSubscription(store, { email: 'nodupsub23@example.com', phone: '9800000023', name: 'X', paymentRequired: false });
    check('23. No duplicate Subscriptions row for the same email', store.subs.filter(r => normalizeEmail(r.email) === 'nodupsub23@example.com').length === 1);
  }

  // 24. CRITICAL CURRENT BUG REPRODUCTION (as literally specified): a
  //     paymentRequired:false / activationType:free / adminStatus:Approved
  //     application must end up, after activation, with activationType=
  //     free_trial, membershipType=free(trial-flavored), membershipStatus=
  //     ACTIVE_TRIAL-equivalent, real trial dates, and blank subscription
  //     dates.
  {
    const store = makeStore();
    const now = new Date('2026-08-21T00:00:00Z');
    createSubscription(store, { email: 'repro24@example.com', phone: '9800000024', name: 'R', paymentRequired: false, activationType: 'free', adminStatus: 'Approved', now });
    const stub = store.subs[0];
    check('24a. Pre-activation stub is not mistaken for any active/pending membership', computeMembershipState(stub, now) === 'NO_ACTIVE_MEMBERSHIP');
    const act = registerFreeReader(store, 'repro24@example.com', now);
    check('24b. Activation succeeds', act.success === true);
    const row = store.subs[0];
    check('24c. activationType = free_trial', row.activationType === 'free_trial');
    check('24d. membershipType = trial (canonical Free Explorer active-trial value)', row.membershipType === 'trial');
    check('24e. trialStartDate/trialEndDate populated', !!row.trialStartDate && !!row.trialEndDate);
    check('24f. subscriptionStartDate/subscriptionExpiry blank', row.subscriptionStartDate === '' && row.subscriptionExpiry === '');
    check('24g. Resulting state is ACTIVE_TRIAL', computeMembershipState(row, now) === 'ACTIVE_TRIAL');
  }

  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
})();
