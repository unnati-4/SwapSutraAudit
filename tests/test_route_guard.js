// Standalone simulation of the App.tsx route guard (GATE_ALLOWED_TABS +
// isAccessGated + pendingReturnTab), copied/mirrored from src/App.tsx, to
// verify the 6 required scenarios from the access-control spec without
// needing to boot the actual React app.

// 'ambassador' (Campus Ambassador) was added to the public allowlist during
// the Marketing/Conversion pass: it's a purely informational page (external
// Google Form link, no backend calls) that a prospective ambassador should
// be able to reach while logged out — see the comment above the real
// GATE_ALLOWED_TABS definition in src/App.tsx for the full rationale.
// 'browse' (the Library) joined the public allowlist when the Library was
// opened for read-only browsing: a marketplace nobody can look into has
// nothing to convert on, and the guest hero's "Explore Books" button
// pointed straight at this wall. Reading is public; every ACTION on a book
// (swap, rent, buy, message, list) still requires an account, and the
// backend strips ownerEmail/coordinates from getBooks for signed-out
// callers. See redactBookForAudience in appsscript.js and the
// GATE_ALLOWED_TABS comment in src/App.tsx.
const GATE_ALLOWED_TABS = ['home', 'browse', 'events', 'events-gallery', 'privacy', 'unsubscribe', 'ambassador'];

function isAccessGated(isAdmin, userTier) {
  return !isAdmin && (userTier === 'guest' || userTier === 'pending' || userTier === 'expired');
}

const routes = {
  '/': 'home',
  '/library': 'browse',
  '/reading-room': 'reading-room',
  '/book-requests': 'book-requests',
  '/notifications': 'notifications',
  '/my-requests': 'profile',
  '/events': 'events',
  '/list-access': 'list',
  '/support': 'support',
  '/rituals': 'info',
  '/management': 'management',
  '/profile': 'profile',
  '/unsubscribe': 'unsubscribe',
  '/campus-ambassador': 'ambassador',
  // Illustrative example paths from the user's test scenarios that don't
  // map to a distinct top-level route in this app (Reading Space lives
  // inside /profile, Messages/Chat is a modal, not a route) — they still
  // must not resolve to public content, so route them at a protected tab.
  '/reading-space': 'profile',
  '/messages': 'profile',
};
function routeToTab(path) {
  const clean = path.replace(/\/+$/, '') || '/';
  return routes[clean] || 'home';
}

// Mirrors userTier's useMemo: a completely logged-out visitor is always
// 'guest'; an OTP-verified-but-unregistered visitor is 'pending' — driven
// entirely by backend-reported isRegistered/membershipStatus, never by
// OTP success alone.
function computeUserTier({ activeUserEmail, isAdmin, userRole, membershipStatus, activeSubscription, isListerActive }) {
  if (!activeUserEmail) return 'guest';
  if (isAdmin || userRole === 'admin') return 'premium';
  if (membershipStatus === 'pending') return 'pending';
  if (membershipStatus === 'expired' || membershipStatus === 'failed' || membershipStatus === 'cancelled') return 'expired';
  if (membershipStatus === 'premium') return 'premium';
  if (isListerActive && activeSubscription?.membershipType === 'premium') return 'premium';
  if (activeSubscription?.computedStatus === 'PREMIUM') return 'premium';
  if (membershipStatus === 'trial') return 'trial';
  if (activeSubscription?.computedStatus === 'TRIAL' || activeSubscription?.computedStatus === 'FREE_TRIAL') return 'trial';
  return 'pending';
}

// Simulates loading a URL directly: the guard resolves the tab and reports
// whether real content renders or the access wall does.
function loadDirectUrl(path, session) {
  const tab = routeToTab(path);
  const userTier = computeUserTier(session);
  const gated = isAccessGated(session.isAdmin, userTier);
  if (gated && !GATE_ALLOWED_TABS.includes(tab)) {
    return { resolvedTab: 'profile', showsAccessWall: true, requestedTab: tab };
  }
  return { resolvedTab: tab, showsAccessWall: false, requestedTab: tab };
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${detail || ''}`); }
}

const loggedOut = { activeUserEmail: null, isAdmin: false, userRole: null, membershipStatus: null, activeSubscription: null, isListerActive: false };
const otpOnlyUnregistered = { activeUserEmail: 'new@x.com', isAdmin: false, userRole: null, membershipStatus: 'pending', activeSubscription: null, isListerActive: false };
const validTrialMember = { activeUserEmail: 'trial@x.com', isAdmin: false, userRole: null, membershipStatus: 'trial', activeSubscription: { computedStatus: 'TRIAL' }, isListerActive: true };
const validPremiumMember = { activeUserEmail: 'premium@x.com', isAdmin: false, userRole: null, membershipStatus: 'premium', activeSubscription: { computedStatus: 'PREMIUM' }, isListerActive: true };
const expiredMember = { activeUserEmail: 'expired@x.com', isAdmin: false, userRole: null, membershipStatus: 'expired', activeSubscription: null, isListerActive: false };

// Scenario A: logged-out user opens '/' -> Home page loads (no wall)
{
  const r = loadDirectUrl('/', loggedOut);
  check('A. Logged-out "/" -> Home loads, no access wall', r.showsAccessWall === false && r.resolvedTab === 'home', JSON.stringify(r));
}

// Scenario B: logged-out user opens '/events' -> Events page loads
{
  const r = loadDirectUrl('/events', loggedOut);
  check('B. Logged-out "/events" -> Events loads, no access wall', r.showsAccessWall === false && r.resolvedTab === 'events', JSON.stringify(r));
}

// Scenario C: logged-out user opens '/reading-space' -> blocked, access wall shown
{
  const r = loadDirectUrl('/reading-space', loggedOut);
  check('C. Logged-out "/reading-space" -> blocked, access wall shown', r.showsAccessWall === true, JSON.stringify(r));
}

// Scenario D: logged-out user opens '/messages' -> blocked, access wall shown
{
  const r = loadDirectUrl('/messages', loggedOut);
  check('D. Logged-out "/messages" -> blocked, access wall shown', r.showsAccessWall === true, JSON.stringify(r));
}

// Scenario E: OTP-verified but unregistered (no Sheet record) -> still blocked from protected pages
{
  const r = loadDirectUrl('/library', otpOnlyUnregistered);
  check('E. OTP-only unregistered "/library" -> can browse (reading is public now)', r.showsAccessWall === false && r.resolvedTab === 'browse', JSON.stringify(r));
  const r2 = loadDirectUrl('/reading-space', otpOnlyUnregistered);
  check('E2. OTP-only unregistered "/reading-space" -> still blocked', r2.showsAccessWall === true, JSON.stringify(r2));
}

// Scenario F: valid registered member (trial or premium) -> protected pages accessible
{
  const r = loadDirectUrl('/library', validTrialMember);
  check('F1. Valid TRIAL member "/library" -> accessible', r.showsAccessWall === false && r.resolvedTab === 'browse', JSON.stringify(r));
  const r2 = loadDirectUrl('/campus-ambassador', validPremiumMember);
  check('F2. Valid PREMIUM member "/campus-ambassador" -> accessible', r2.showsAccessWall === false && r2.resolvedTab === 'ambassador', JSON.stringify(r2));
  const r3 = loadDirectUrl('/profile', validTrialMember);
  check('F3. Valid TRIAL member "/profile" -> accessible (real profile, not wall trigger)', r3.showsAccessWall === false, JSON.stringify(r3));
}

// Expired member (trial ended, never became a paid/renewed member) is gated same as guest/pending
{
  const r = loadDirectUrl('/library', expiredMember);
  check('G. Expired member "/library" -> can still browse, but not act (must renew to swap/list)', r.showsAccessWall === false && r.resolvedTab === 'browse', JSON.stringify(r));
  const r2 = loadDirectUrl('/', expiredMember);
  check('G2. Expired member "/" -> Home still loads (public page unaffected)', r2.showsAccessWall === false && r2.resolvedTab === 'home', JSON.stringify(r2));
}

// Privacy Policy (linked from the public Home footer) and the newsletter
// unsubscribe confirmation must stay reachable while logged out.
{
  const r = loadDirectUrl('/rituals'.replace('/rituals', '/privacy-does-not-exist'), loggedOut); // not a real route, sanity check fallback
  check('H0. Unmapped path falls back to Home (not an open protected tab)', r.resolvedTab === 'home' && r.showsAccessWall === false);
}
{
  // '/privacy' and '/unsubscribe' are reached via in-app navigateTo() calls
  // (footer link, email links) rather than a distinct top-level URL route
  // in this app's `routes` map, so validate directly against
  // GATE_ALLOWED_TABS — the actual guard navigateTo() evaluates.
  check('H1. "privacy" tab exempt from gate for logged-out visitors', GATE_ALLOWED_TABS.includes('privacy'), 'GATE_ALLOWED_TABS=' + JSON.stringify(GATE_ALLOWED_TABS));
  check('H2. "unsubscribe" tab exempt from gate for logged-out visitors', GATE_ALLOWED_TABS.includes('unsubscribe'));
}

// Every other known application tab must be protected (spot-check the
// examples explicitly named in the spec). 'ambassador' is deliberately
// excluded from this list now — see the Marketing/Conversion pass note above.
{
  // 'browse' is deliberately absent: the Library is now readable without
  // an account. Everything that DOES something stays protected.
  const mustBeProtected = ['list', 'profile', 'notifications', 'book-requests', 'reading-room', 'management', 'support', 'info'];
  const allProtected = mustBeProtected.every(t => !GATE_ALLOWED_TABS.includes(t));
  check('I. Every tab that DOES something is still protected', allProtected, JSON.stringify(mustBeProtected.filter(t => GATE_ALLOWED_TABS.includes(t))));
  check('I2. The Library is public, but listing a book is not', GATE_ALLOWED_TABS.includes('browse') && !GATE_ALLOWED_TABS.includes('list'));
}

// Campus Ambassador is now public: a logged-out visitor (exactly the
// target audience for campus recruitment) must be able to load the real
// informational page, not get redirected to the access wall.
{
  const r = loadDirectUrl('/campus-ambassador', loggedOut);
  check('J. Logged-out "/campus-ambassador" -> real page loads, no access wall', r.showsAccessWall === false && r.resolvedTab === 'ambassador', JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
