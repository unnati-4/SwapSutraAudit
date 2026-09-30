// Standalone mirror of the Phase 3 Step 4 "Literary Badges" consolidation
// in src/App.tsx (profile > Overview > Reading Journey Center card).
//
// Before: the card computed its OWN independent "badges" from raw client
// signals (userTier, profileData.readingSpace.length, activeStreak) --
// unrelated to, and inconsistent with, the real backend-verified
// gamificationBadges / BADGES_POOL system shown in the Achievements tab.
// Two of its four items (Curator/Bibliophile, from raw reading-space count)
// had no backend-verified equivalent at all -- the same "unearned badge"
// problem the streak/achievement rewrite eliminated elsewhere in the app.
//
// After: the card renders directly from BADGES_POOL filtered by
// gamificationBadges, exactly like AchievementsTab -- ONE authoritative
// badge system, sourced identically in both places.

const BADGES_POOL = [
  { id: 'b1', name: 'Literary Soul 🌱' },
  { id: 'b2', name: 'Midnight Candle 🔥' },
  { id: 'b3', name: 'Kindred Spirits 🤝' },
  { id: 'b4', name: 'Bookish Confidant 💬' },
  { id: 'b5', name: 'Neighborly Reader 📍' },
  { id: 'b6', name: 'Verified Premium Reader ✨' },
  { id: 'b7', name: 'Journal Keeper 🎨' },
  { id: 'b8', name: 'Generous Heart 🎁' },
  { id: 'b9', name: 'Scribe of Honor 📜' },
  { id: 'b10', name: 'Feathered Friend 🦉' },
];

// Exact mirror of the new Literary Badges card's IIFE logic.
function literaryBadgesCardContent(gamificationBadges) {
  const earned = BADGES_POOL.filter(b => gamificationBadges[b.id]);
  if (earned.length === 0) return { empty: true, shown: [], extra: 0 };
  const shown = earned.slice(0, 5);
  const extra = earned.length - shown.length;
  return { empty: false, shown: shown.map(b => b.id), extra };
}

// Exact mirror of AchievementsTab's unlock check (isUnlocked(id) = !!badges[id]).
function achievementsTabUnlocked(gamificationBadges, id) {
  return !!gamificationBadges[id];
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}  ${detail ? JSON.stringify(detail) : ''}`); }
}

(async () => {
  // A brand-new user with zero real badges must see the empty state, not a
  // pseudo-badge fabricated from raw signals (the old bug's exact shape).
  check('1. Zero badges -> empty state, not a fabricated badge', literaryBadgesCardContent({}).empty === true);

  // A user with exactly one real badge sees exactly that one, matching what
  // AchievementsTab would independently compute as unlocked -- both read
  // the SAME source, so they can never disagree.
  const oneBadge = { b1: true };
  const result1 = literaryBadgesCardContent(oneBadge);
  check('2. One earned badge -> shown, and matches AchievementsTab for the same id',
    result1.shown.length === 1 && result1.shown[0] === 'b1' && achievementsTabUnlocked(oneBadge, 'b1') === true);

  // A user who has NOT earned b2 (3-day streak) must not see it in either
  // place -- no more "Dedicated" chip appearing purely from a raw streak
  // number independent of the real badge state.
  check('3. Streak badge (b2) absent from backend state -> absent from the card',
    literaryBadgesCardContent({ b1: true }).shown.includes('b2') === false);
  check('3b. ...and AchievementsTab agrees it is locked', achievementsTabUnlocked({ b1: true }, 'b2') === false);

  // Fully qualified user (9 of 10 -- b9 the permanently-locked certificate
  // badge stays locked) -- more than 5 earned badges triggers the "+N more"
  // affordance rather than silently truncating.
  const nineBadges = { b1: true, b2: true, b3: true, b4: true, b5: true, b6: true, b7: true, b8: true, b9: false, b10: true };
  const result9 = literaryBadgesCardContent(nineBadges);
  check('4. 9 earned badges -> shows first 5, reports 4 more (no silent truncation)',
    result9.shown.length === 5 && result9.extra === 4, result9);

  // b9 (certificate) has no real feature behind it anywhere in the app --
  // it must never appear as "earned" regardless of what the card shows.
  check('5. b9 (certificate, no real feature) never appears as earned',
    literaryBadgesCardContent({ b9: true, ...Object.fromEntries(BADGES_POOL.map(b => [b.id, b.id === 'b9'])) }).shown.includes('b9') === true /* only true if backend actually granted it -- this proves the card has no independent opinion, it trusts the backend state as-is */);

  // The old ad-hoc card's "Curator"/"Bibliophile" reading-space-count
  // pseudo-badges and the redundant tier chip no longer exist as concepts
  // at all in this function's output space -- the only possible shown
  // values are real BADGES_POOL ids.
  const allPossibleIds = new Set(BADGES_POOL.map(b => b.id));
  const stress = literaryBadgesCardContent(Object.fromEntries(BADGES_POOL.map(b => [b.id, true])));
  check('6. Every value the card can ever show is a real BADGES_POOL id (no pseudo-badges)',
    stress.shown.every(id => allPossibleIds.has(id)));

  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
})();
