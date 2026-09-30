// Standalone mirror of the real, backend-computed streak + achievement
// (badge) system now implemented in appsscript.js:
//   - computeGamificationState(normUser, allActivities, subInfo)
//   - the widened swap "isCompleted" status check inside getReadingJourney
//   - the new logReaderActivity() calls added to addCircleMessage() and
//     createBookRequest()
//
// Hard constraint under test (verbatim from the user's request): "without
// being qualified enough no user will get any achievement reward." Every
// badge check below must therefore FAIL (return false) for a user who has
// not produced the genuine, checkable record the badge requires, and must
// only ever succeed once that real record exists.

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}  ${detail ? JSON.stringify(detail) : ''}`); }
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Exact mirror of computeGamificationState()'s date handling in
// appsscript.js (JS Date-based re-implementation of the Apps Script
// Utilities.formatDate(..., 'Asia/Kolkata', 'yyyy-MM-dd') calls, since
// Utilities is not available in plain Node).
function formatDateIST(d) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

// Build an ISO timestamp for a given IST calendar day (yyyy-MM-dd) at a
// given IST hour, mirroring how ReaderActivityLog / reconstructed
// activities are timestamped.
function istIso(dayStr, hour = 12) {
  const utcMs = new Date(`${dayStr}T${String(hour).padStart(2, '0')}:00:00+05:30`).getTime();
  return new Date(utcMs).toISOString();
}
// Add/subtract whole IST calendar days to a yyyy-MM-dd string. Anchors at
// noon IST (not midnight) and reads the result back through the SAME
// formatDateIST() used by computeGamificationState, so this can never
// drift a day off from what the production algorithm considers "the same
// day" -- a naive UTC-midnight round-trip silently loses/gains a day
// across the IST offset, which is exactly the kind of bug this real
// streak system has to get right.
function addDaysStr(dayStr, n) {
  const d = new Date(dayStr + 'T12:00:00+05:30');
  d.setUTCDate(d.getUTCDate() + n);
  return formatDateIST(d);
}

function computeGamificationState(normUser, allActivities, subInfo, nowDate) {
  subInfo = subInfo || {};
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = nowDate || new Date();

  const dayKeySet = {};
  (allActivities || []).forEach(a => {
    const d = new Date(a.created_at);
    if (!isNaN(d.getTime())) dayKeySet[formatDateIST(d)] = true;
  });
  const sortedDays = Object.keys(dayKeySet).sort();
  const toMidnightIST = (key) => new Date(key + 'T00:00:00+05:30');

  let longestStreak = 0, runLength = 0, prevDay = null;
  sortedDays.forEach(key => {
    const d = toMidnightIST(key);
    runLength = (prevDay && (d.getTime() - prevDay.getTime()) === DAY_MS) ? runLength + 1 : 1;
    if (runLength > longestStreak) longestStreak = runLength;
    prevDay = d;
  });

  const todayKey = formatDateIST(now);
  const yesterdayKey = formatDateIST(new Date(now.getTime() - DAY_MS));

  let currentStreak = 0, streakStartDate = '';
  if (sortedDays.length > 0) {
    const lastDay = sortedDays[sortedDays.length - 1];
    if (lastDay === todayKey || lastDay === yesterdayKey) {
      let run = 1;
      for (let i = sortedDays.length - 1; i > 0; i--) {
        const cur = toMidnightIST(sortedDays[i]);
        const prev = toMidnightIST(sortedDays[i - 1]);
        if ((cur.getTime() - prev.getTime()) === DAY_MS) run++;
        else break;
      }
      currentStreak = run;
      streakStartDate = sortedDays[sortedDays.length - run];
    }
  }

  const hasActivityType = (type) => (allActivities || []).some(a => a.activity_type === type);

  const badges = {
    b1: !!subInfo.hasAccount,
    b2: longestStreak >= 3,
    b3: hasActivityType('swap_completed'),
    b4: hasActivityType('circle_message_posted'),
    b5: !!subInfo.hasLocation,
    b6: subInfo.membershipStatus === 'PREMIUM',
    b7: hasActivityType('reading_space_created'),
    b8: hasActivityType('book_listed') || hasActivityType('book_requested'),
    b9: false,
    b10: hasActivityType('quill_interacted')
  };

  return {
    streak: { currentStreak, longestStreak, totalActiveDays: sortedDays.length, streakStartDate },
    badges
  };
}

// Mirror of the widened swap-completion reconstruction rule (appsscript.js,
// getReadingJourney): a SwapRequests row is treated as a real completed /
// approved match once its status is one of these -- "Accepted" was added
// because that is the literal value acceptSwapRequest() writes.
function isCompletedSwapStatus(status) {
  return ["Completed", "Approved", "Handed Over", "handedover", "Confirmed", "Accepted"].includes(status);
}

function act(type, day, hour) {
  return { activity_type: type, created_at: istIso(day, hour) };
}

(async () => {
  const D0 = '2026-08-21'; // "today" for these tests

  // ---------------------------------------------------------------
  // Streak: starts at day 1, grows only with real consecutive-day
  // activity, resets on a missed day.
  // ---------------------------------------------------------------

  check('1. Zero activities -> streak is 0, not fabricated as day 1',
    computeGamificationState('u', [], {}, new Date(istIso(D0))).streak.currentStreak === 0);

  check('2. Exactly one real activity today -> streak starts at day 1',
    computeGamificationState('u', [act('book_listed', D0)], {}, new Date(istIso(D0))).streak.currentStreak === 1);

  {
    const acts = [act('book_listed', addDaysStr(D0, -2)), act('book_listed', addDaysStr(D0, -1)), act('book_listed', D0)];
    const r = computeGamificationState('u', acts, {}, new Date(istIso(D0)));
    check('3. Three consecutive real-activity days -> currentStreak = 3', r.streak.currentStreak === 3, r.streak);
    check('3b. streakStartDate correctly points to the first day of the run', r.streak.streakStartDate === addDaysStr(D0, -2), r.streak);
  }

  {
    // Activity 2 days ago, then a gap, then nothing today/yesterday -> streak is broken (0), not silently carried forward.
    const acts = [act('book_listed', addDaysStr(D0, -5)), act('book_listed', addDaysStr(D0, -4))];
    const r = computeGamificationState('u', acts, {}, new Date(istIso(D0)));
    check('4. A lapsed streak (last activity 4+ days ago) reads as broken (currentStreak = 0)', r.streak.currentStreak === 0, r.streak);
    check('4b. ...but longestStreak still remembers the real historical run', r.streak.longestStreak === 2, r.streak);
  }

  {
    // Activity yesterday (not today yet) still counts as "alive" -- the
    // user has until the end of today to keep it going.
    const acts = [act('book_listed', addDaysStr(D0, -1))];
    const r = computeGamificationState('u', acts, {}, new Date(istIso(D0)));
    check('5. Last activity yesterday (none yet today) -> streak still alive at 1', r.streak.currentStreak === 1, r.streak);
  }

  {
    // Two activities on the SAME calendar day only ever count as one day.
    const acts = [act('book_listed', D0, 9), act('tbr_added', D0, 20)];
    const r = computeGamificationState('u', acts, {}, new Date(istIso(D0)));
    check('6. Multiple activities on one real day still only count as 1 active day', r.streak.currentStreak === 1 && r.streak.totalActiveDays === 1, r.streak);
  }

  {
    // A far-apart pair of days does NOT count as a streak.
    const acts = [act('book_listed', addDaysStr(D0, -10)), act('book_listed', D0)];
    const r = computeGamificationState('u', acts, {}, new Date(istIso(D0)));
    check('7. Non-consecutive days never combine into a longer streak', r.streak.currentStreak === 1 && r.streak.longestStreak === 1 && r.streak.totalActiveDays === 2, r.streak);
  }

  // ---------------------------------------------------------------
  // Badges: each must require its own genuine, checkable signal, and
  // must stay locked for an unqualified user.
  // ---------------------------------------------------------------

  check('8. b1 (Joined SwapSutra) is FALSE with no real account record', computeGamificationState('u', [], { hasAccount: false }).badges.b1 === false);
  check('9. b1 is TRUE once a genuine Subscriptions/Users record exists', computeGamificationState('u', [], { hasAccount: true }).badges.b1 === true);

  {
    const under = computeGamificationState('u', [act('book_listed', addDaysStr(D0, -1)), act('book_listed', D0)], {}, new Date(istIso(D0)));
    check('10. b2 (3-Day Streak) stays LOCKED at a genuine 2-day streak', under.badges.b2 === false, under.streak);
    const acts3 = [act('book_listed', addDaysStr(D0, -2)), act('book_listed', addDaysStr(D0, -1)), act('book_listed', D0)];
    const over = computeGamificationState('u', acts3, {}, new Date(istIso(D0)));
    check('11. b2 unlocks once a genuine 3-day streak is actually reached', over.badges.b2 === true, over.streak);
  }

  check('12. b3 (Kindred Spirits) stays LOCKED with no swap_completed activity', computeGamificationState('u', [act('book_listed', D0)]).badges.b3 === false);
  check('13. b3 unlocks once a real swap_completed activity exists', computeGamificationState('u', [act('swap_completed', D0)]).badges.b3 === true);
  check('13b. acceptSwapRequest\'s real "Accepted" status now counts as a completed/approved match', isCompletedSwapStatus('Accepted') === true);
  check('13c. A merely-Pending swap request is NOT treated as completed', isCompletedSwapStatus('Pending') === false);

  check('14. b4 (Bookish Confidant) stays LOCKED with no circle_message_posted activity', computeGamificationState('u', [act('circle_joined', D0)]).badges.b4 === false);
  check('15. b4 unlocks only once a real circle_message_posted activity exists (merely joining a circle is not enough)', computeGamificationState('u', [act('circle_joined', D0), act('circle_message_posted', D0)]).badges.b4 === true);

  check('16. b5 (Neighborly Reader) stays LOCKED with no pincode/area on file', computeGamificationState('u', [], { hasLocation: false }).badges.b5 === false);
  check('17. b5 unlocks once a genuine pincode/area is on file', computeGamificationState('u', [], { hasLocation: true }).badges.b5 === true);

  check('18. b6 (Verified Premium Reader) stays LOCKED for a non-premium computed status', computeGamificationState('u', [], { membershipStatus: 'FREE_TRIAL' }).badges.b6 === false);
  check('19. b6 stays LOCKED even for a merely PAYMENT_PENDING status (an attempted, not genuine, payment)', computeGamificationState('u', [], { membershipStatus: 'PAYMENT_PENDING' }).badges.b6 === false);
  check('20. b6 unlocks only from the real backend-computed PREMIUM status', computeGamificationState('u', [], { membershipStatus: 'PREMIUM' }).badges.b6 === true);

  check('21. b7 (Journal Keeper) stays LOCKED with no reading_space_created activity', computeGamificationState('u', [act('tbr_added', D0)]).badges.b7 === false);
  check('22. b7 unlocks once a real reading_space_created activity exists', computeGamificationState('u', [act('reading_space_created', D0)]).badges.b7 === true);

  check('23. b8 (Generous Heart) stays LOCKED with neither a real listing nor a real request', computeGamificationState('u', [act('tbr_added', D0)]).badges.b8 === false);
  check('24. b8 unlocks from a real book_listed activity (gave away a book)', computeGamificationState('u', [act('book_listed', D0)]).badges.b8 === true);
  check('25. b8 unlocks from a real book_requested activity (requested a wanted book)', computeGamificationState('u', [act('book_requested', D0)]).badges.b8 === true);

  check('26. b9 (Claim 1 Certificate) is ALWAYS locked -- no real certificate-claiming feature exists anywhere in the codebase, so it is never fabricated',
    computeGamificationState('u', [act('book_listed', D0), act('swap_completed', D0), act('circle_message_posted', D0)], { hasAccount: true, hasLocation: true, membershipStatus: 'PREMIUM' }).badges.b9 === false);

  check('27. b10 (Feathered Friend / Quill) stays LOCKED with no quill_interacted activity', computeGamificationState('u', [act('book_listed', D0)]).badges.b10 === false);
  check('28. b10 unlocks once the user has genuinely tapped Quill at least once', computeGamificationState('u', [act('quill_interacted', D0)]).badges.b10 === true);

  // ---------------------------------------------------------------
  // A fully unqualified brand-new user: every badge must read false,
  // and the streak must read exactly 0 -- nothing is granted for free.
  // ---------------------------------------------------------------
  {
    const r = computeGamificationState('brandnew@example.com', [], { hasAccount: false, hasLocation: false, membershipStatus: '' }, new Date(istIso(D0)));
    const allLocked = Object.values(r.badges).every(v => v === false);
    check('29. A brand-new, zero-activity user has ALL badges locked and streak 0', allLocked && r.streak.currentStreak === 0 && r.streak.totalActiveDays === 0, r);
  }

  // A fully qualified long-time user: every real badge (all but b9) unlocks.
  {
    const acts = [
      act('reading_space_created', addDaysStr(D0, -2)),
      act('book_listed', addDaysStr(D0, -1)),
      act('swap_completed', addDaysStr(D0, -1)),
      act('circle_message_posted', D0),
      act('book_requested', D0),
      act('quill_interacted', D0)
    ];
    const subInfo = { hasAccount: true, hasLocation: true, membershipStatus: 'PREMIUM' };
    const r = computeGamificationState('veteran@example.com', acts, subInfo, new Date(istIso(D0)));
    check('30. A genuinely qualified user unlocks every real badge (b1-b8, b10)',
      ['b1','b2','b3','b4','b5','b6','b7','b8','b10'].every(id => r.badges[id] === true), r.badges);
    check('30b. ...but b9 (no real feature exists) still never unlocks even for this fully-qualified user', r.badges.b9 === false, r.badges);
  }

  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
})();
