// Standalone mirror of:
//   1. The mobile bottom navigation bar's key -> destination mapping in
//      src/App.tsx (now 5 slots again -- "Circle" was removed per a later
//      request, Readers Circle stays reachable via the hamburger menu/other
//      in-app links instead of a dedicated bottom-nav slot).
//   2. The new global "+" List-a-Book floating button's click-routing logic,
//      which replaced every scattered "List a Book" / "List Books" /
//      "Add Book" button across the site (including the profile page) as
//      the app's single entry point for listing a book.

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}  ${detail ? JSON.stringify(detail) : ''}`); }
}

// Exact mirror of the array now in App.tsx's mobile <nav> block.
const MOBILE_BOTTOM_NAV_ITEMS = [
  { key: 'home', label: 'Home', destinationTab: 'home' },
  { key: 'discover', label: 'Discover', destinationTab: 'browse' },
  { key: 'room', label: 'Room', destinationTab: 'reading-room' },
  { key: 'events', label: 'Events', destinationTab: 'events' },
  { key: 'profile', label: 'Profile', destinationTab: 'profile' },
];

// Mirrors the mobileNavKey-sync useEffect: given the tab the app navigated
// to (by any means, not just the bottom nav itself), which bottom-nav key
// should highlight as active.
function mobileNavKeyForTab(activeTab) {
  if (activeTab === 'home') return 'home';
  if (activeTab === 'browse') return 'discover';
  if (activeTab === 'reading-room') return 'room';
  if (activeTab === 'events') return 'events';
  if (activeTab === 'profile') return 'profile';
  return null;
}

// Exact mirror of the new global ListBookFab's onClick handler in App.tsx:
// the ONLY remaining trigger anywhere in the app that opens the listing
// form. Returns a description of what actually happens for a given app
// state, instead of performing the real side effects.
function listBookFabClickOutcome(state) {
  const {
    activeUserEmail = null,
    isRegisteredMember = false,
    userTier = 'guest',
    isListerActive = false,
    activeSubscription = null,
  } = state;

  if (!activeUserEmail) return { action: 'showLoginModal' };
  if (!isRegisteredMember) return { action: 'handleBecomeMemberClick' };
  if (userTier === 'expired') return { action: 'openMembershipActivation' };
  if (!isListerActive) return { action: 'promptMembershipGate' };
  // Tier-aware cap matching the backend's real per-tier limit (createBook:
  // 500 for premium/Chapters, 10 for trial) -- not a flat 10 for everyone.
  const listingLimit = userTier === 'premium' ? 500 : 10;
  if (activeSubscription && activeSubscription.booksListedCount >= listingLimit) {
    return { action: 'errorMessage' };
  }
  return { action: 'openListingForm', subscription: activeSubscription };
}

(async () => {
  // --- Bottom nav slots ---
  check('1. Exactly 5 bottom nav slots ("Circle" removed, back from 6)', MOBILE_BOTTOM_NAV_ITEMS.length === 5, MOBILE_BOTTOM_NAV_ITEMS.map(i => i.key));

  const byKey = Object.fromEntries(MOBILE_BOTTOM_NAV_ITEMS.map(i => [i.key, i]));

  check('2. "Room" lands on Reading Room', byKey.room.destinationTab === 'reading-room');
  check('3. New "Events" button lands on the community Events page', byKey.events.destinationTab === 'events');
  check('4. "Circle" is no longer a bottom-nav slot', !byKey.circle);
  check('5. "Space"/"Inbox" keys still don\'t exist as bottom-nav slots either', !byKey.space && !byKey.inbox);
  check('6. Home/Discover/Profile destinations unchanged', byKey.home.destinationTab === 'home' && byKey.discover.destinationTab === 'browse' && byKey.profile.destinationTab === 'profile');

  // No two slots point at the same destination (each button is a distinct,
  // unambiguous shortcut).
  const destinations = MOBILE_BOTTOM_NAV_ITEMS.map(i => i.destinationTab);
  check('7. No duplicate destinations across the 5 slots', new Set(destinations).size === destinations.length);

  // The active-state highlight correctly follows navigation reaching these
  // tabs via ANY route (e.g. the hamburger menu's "Reading Room" link),
  // not just a bottom-nav tap.
  check('8a. Landing on reading-room via any route highlights "Room"', mobileNavKeyForTab('reading-room') === 'room');
  check('8b. Landing on events via any route highlights "Events"', mobileNavKeyForTab('events') === 'events');
  check('8c. Landing on reader-circle (still reachable, just not from the bottom nav) highlights nothing', mobileNavKeyForTab('reader-circle') === null);
  check('8d. Landing on an unrelated tab (e.g. a gated membership screen) highlights nothing new', mobileNavKeyForTab('list') === null);

  // --- Global "+" List-a-Book FAB routing ---
  check('9. Guest (not signed in) -> routed to login, form never opens', listBookFabClickOutcome({}).action === 'showLoginModal');

  check('10. Signed in but not a registered member -> routed to membership signup', listBookFabClickOutcome({
    activeUserEmail: 'new@x.com', isRegisteredMember: false
  }).action === 'handleBecomeMemberClick');

  check('11. Expired membership -> routed to renewal, form never opens', listBookFabClickOutcome({
    activeUserEmail: 'x@x.com', isRegisteredMember: true, userTier: 'expired'
  }).action === 'openMembershipActivation');

  check('12. Registered but not yet an active lister (e.g. pending admin approval) -> membership gate prompt, not the form', listBookFabClickOutcome({
    activeUserEmail: 'x@x.com', isRegisteredMember: true, userTier: 'trial', isListerActive: false
  }).action === 'promptMembershipGate');

  check('13. At the 10-book limit -> blocked with the limit message, form never opens', listBookFabClickOutcome({
    activeUserEmail: 'x@x.com', isRegisteredMember: true, userTier: 'trial', isListerActive: true,
    activeSubscription: { booksListedCount: 10 }
  }).action === 'errorMessage');

  check('14. A genuinely eligible active member -> the form actually opens', listBookFabClickOutcome({
    activeUserEmail: 'x@x.com', isRegisteredMember: true, userTier: 'trial', isListerActive: true,
    activeSubscription: { booksListedCount: 3 }
  }).action === 'openListingForm');

  check('15. Eligible premium member under the higher limit -> the form opens', listBookFabClickOutcome({
    activeUserEmail: 'x@x.com', isRegisteredMember: true, userTier: 'premium', isListerActive: true,
    activeSubscription: { booksListedCount: 200 }
  }).action === 'openListingForm');

  check('16. Premium member with 10 books listed (at the OLD flat cap) -> form still opens (real cap is 500, not 10)', listBookFabClickOutcome({
    activeUserEmail: 'x@x.com', isRegisteredMember: true, userTier: 'premium', isListerActive: true,
    activeSubscription: { booksListedCount: 10 }
  }).action === 'openListingForm');

  check('17. Premium member genuinely at the real 500-book cap -> correctly blocked', listBookFabClickOutcome({
    activeUserEmail: 'x@x.com', isRegisteredMember: true, userTier: 'premium', isListerActive: true,
    activeSubscription: { booksListedCount: 500 }
  }).action === 'errorMessage');

  check('18. Trial member with 9/10 books -> form still opens (under their real 10-book cap)', listBookFabClickOutcome({
    activeUserEmail: 'x@x.com', isRegisteredMember: true, userTier: 'trial', isListerActive: true,
    activeSubscription: { booksListedCount: 9 }
  }).action === 'openListingForm');

  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
})();
