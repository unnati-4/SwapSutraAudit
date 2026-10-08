/**
 * test_reader_experience.cjs
 *
 * Phase two: the visual/UX transformation. Covers the illustrated empty
 * states, the personal Home space, Quill's contextual moments, the
 * loading skeletons, and the Library's presentation — plus the two real
 * bugs the visual pass turned up.
 *
 * These are source-level assertions. They prove the code is wired up and
 * the rules are present; they do NOT prove the pixels are right. The
 * illustrations and layouts were separately rendered in headless
 * Chromium against the real stylesheet and inspected — that part is
 * visual review, not something a test can stand in for.
 */

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label); }
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('src/App.tsx');
const css = read('src/index.css');
const illo = read('src/components/ReaderEmptyState.tsx');

// ============================================== illustrations
console.log('\n--- The illustration set belongs to SwapSutra ---');

const SCENES = ['shelf', 'library', 'swap', 'letters', 'activity', 'saved', 'lamp', 'currentRead', 'circle', 'quiet'];
check('1. All ten reader scenes exist',
  SCENES.every(s => new RegExp(`\\b${s}: \\(`).test(illo)));
check('2. They are inline SVG — no image requests, no new dependency',
  !/<img/.test(illo) && !/import .* from ['"](?!react|\.)/.test(illo));
check('3. Ink follows the theme via currentColor',
  /stroke: 'currentColor'/.test(illo));
check('4. The accent reads the design token, not a hardcoded hex',
  /const ACCENT = 'var\(--text-accent/.test(illo));
check('5. No hardcoded hex colours leak into the artwork',
  !/#[0-9A-Fa-f]{6}/.test(illo.split('const SCENES')[1] || ''));
check('6. Decorative artwork is hidden from screen readers',
  /aria-hidden="true"/.test(illo) && /role="presentation"/.test(illo));
check('7. The whole set stays small (well under 20KB of source)',
  Buffer.byteLength(illo, 'utf8') < 20000);

console.log('\n--- Every empty state says where you are and what to do ---');

check('8. The component takes a title, a body and an action',
  /title: string;/.test(illo) && /body\?: string;/.test(illo) && /actionLabel\?: string;/.test(illo));
check('9. It is announced as one group, not loose text',
  /role="note"/.test(illo) && /aria-label=\{title\}/.test(illo));
check('10. A page tone and a compact panel tone both exist',
  /tone\?: 'page' \| 'panel'/.test(illo));
check('11. Empty states are used across the app, not just once',
  (app.match(/<ReaderEmptyState/g) || []).length >= 6);
// The "nothing matches" title is now per-shelf, so assert on the branch
// and on both messages rather than on a fixed string.
check('12. The Library tells "nothing matches" apart from "nothing is here"',
  /hasActiveLibraryFilters \? \(/.test(app)
  && /'Nothing matches that yet'/.test(app)
  && /title="The Library is quiet right now"/.test(app));
// The "Your reader identity" section was removed from My Profile on
// 22 Sep 2026 (the reader asked for it); the tracker page covers reading.
check('13. My Profile no longer has the reader identity section',
  !app.includes('reading-space-section') && !/Your reader identity/i.test(app));
check('14. The old dead-end copy is gone',
  !app.includes('Quill is dusting the empty shelves'));
check('15. ...and so is the off-token hardcoded hex it used',
  !app.includes('text-[#783E1E]'));

// ============================================== loading
console.log('\n--- Loading looks like arriving, not like broken ---');

check('16. The Library shows shelf-shaped skeletons, not a spinner on blank',
  /sk-book__cover/.test(app) && !/Blowing dust off the shelves/.test(app));
check('17. Skeleton styles exist and shimmer',
  /\.sk::after/.test(css) && /@keyframes sk-sweep/.test(css));
check('18. The wait is announced to screen readers',
  /aria-busy="true"/.test(app) && /Loading books from the Library/.test(app));
check('19. Reduced motion stops the shimmer but keeps the shape',
  /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,300}\.sk::after \{ animation: none/.test(css));

// ============================================== library presentation
console.log('\n--- Books read as objects, and their state is legible ---');

check('20. Covers lift on hover and on keyboard focus',
  /\.book-cover-lift:hover,\s*\n\.book-cover-lift:focus-within/.test(css));
check('21. The lift is disabled under reduced motion',
  /\.book-cover-lift \{ transition: none; \}/.test(css));
check('22. Circulation state is derived from real availability flags',
  /const canCirculate = availability\.permanentExchange/.test(app));
check('23. Every circulation mode has its own words',
  ['Open to swap', 'Open to lend', 'Available to rent', 'For sale', 'On their shelf']
    .every(w => app.includes(w)));
check('24. State is never signalled by colour alone — each pill carries text',
  /<i className="avail-pill__dot" aria-hidden="true" \/>\s*\n?\s*\{circulationLabel\}/.test(app));

console.log('\n--- BUG: books were unreachable by keyboard ---');

check('25. A book card is now a real button in the accessibility tree',
  /role="button"[\s\S]{0,200}onKeyDown=\{\(e\) => \{[\s\S]{0,160}onShowBookDetail\(book\)/.test(app));
check('26. ...and it is focusable',
  /role="button"\s*\n\s*tabIndex=\{0\}/.test(app));
check('27. ...with the book title as its accessible name',
  /aria-label=\{book\.author \? `\$\{book\.title\} by \$\{book\.author\}`/.test(app));

// ============================================== the Home page is gone
console.log('\n--- The Home page was retired; the Library is the front door ---');

// The Home page was deleted on 20 Sep 2026. Readers said the site felt
// crowded and could not tell what to do with it, so the front page that sat
// between them and the books was removed: everyone now lands on the Library.
// The personal reading-space block, the greeting and the marketing hero went
// with it. These checks exist so nobody quietly reintroduces the page.
check('28. The Home page no longer exists',
  !/\{activeTab === 'home' && \(/.test(app));
check('29. The personal reading-space block went with it',
  !app.includes('your-space-heading'));
check('30. Nothing routes to a Home tab any more',
  !/navigateTo\('home'\)/.test(app));
check('31. "/" resolves to the Library',
  /'\/': 'browse',/.test(app));
check('32. An unknown path falls back to the Library, not a missing Home',
  /return routes\[clean\] \|\| 'browse';/.test(app));
check('33. Old /home links still land somewhere real',
  /'\/home': 'browse',/.test(app));

// ============================================== quill
console.log('\n--- Quill is a companion, and reacts to real events ---');

check('34. Quill has contextual moments with a mood and a line',
  /const quillMoment = useMemo\(\(\): \{ mood: string; note: string \} \| null/.test(app));
check('35. It celebrates a swap that genuinely completed',
  /completedSwaps\.length > 0/.test(app) && /mood: 'celebrating'/.test(app));
check('36. It nudges when real readers are actually waiting',
  /waitingRequests\.length > 0/.test(app));
check('37. It welcomes a reader back after a real absence',
  /daysSinceLastVisit >= 14/.test(app) && /mood: 'waving'/.test(app));
check('38. It reacts to the book actually open right now',
  /mood: 'reading'/.test(app));
check('39. The absence is measured, not guessed',
  /const daysSinceLastVisit = useMemo/.test(app) && /swapsutraLastVisit/.test(app));
check('40. Quill invents nothing — every branch is gated on real state',
  !/Math\.random\(\)/.test(app.slice(app.indexOf('const quillMoment'), app.indexOf('const quillPersonalNote'))));

console.log('\n--- BUG: the idle cycler was overwriting Quill\'s reaction ---');

check('41. The random mood interval stands down while the panel is open',
  /if \(isQuillOpenRef\.current\) return;/.test(app));
check('42. ...tracked by a ref so listeners are not rebuilt on every toggle',
  /const isQuillOpenRef = useRef\(false\)/.test(app));
check('43. The avatar wears the mood of what Quill is currently saying',
  /if \(isQuillOpen && quillMoment\?\.mood\) setQuillMood/.test(app));

// ============================================== no regressions
console.log('\n--- Phase-one work is intact ---');

check('44. Pinch-zoom is still enabled',
  !/user-scalable\s*=\s*no/.test(read('index.html').replace(/<!--[\s\S]*?-->/g, '')));
check('45. Skip link and focus rules survive',
  /\.skip-to-content/.test(css) && /button:focus-visible/.test(css));
check('46. The global reduced-motion rule survives',
  /animation-duration: 0\.001ms !important/.test(css));
check('47. No native alert() has crept back in',
  !/(^|[^.\w])alert\s*\(/.test(app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
check('48. Session auth is untouched',
  /const notify = \{/.test(app) && app.includes('swapsutraSessionToken'));


// ============================================== session recovery
console.log('\n--- BUG: signed-out readers had no way back in ---');

check('49. An expired/missing session is detected on any API response',
  app.includes('SESSION_EXPIRED_EVENT')
  && /code === 'SESSION_REQUIRED' \|\| code === 'SESSION_INVALID'/.test(app));
check('50. ...including a bare 401 from the proxy',
  /if \(response\.status === 401\) \{\s*\n\s*announceExpiry\(\);/.test(app));
check('51. It is announced once, not once per parallel request',
  /if \(expiryAnnounced\) return;/.test(app));
check('52. A guest is NOT ambushed by an expiry modal',
  /if \(!looksSignedIn\) return;/.test(app));
check('53. The app walks the reader back to sign-in and clears the stale state',
  /window\.addEventListener\(SESSION_EXPIRED_EVENT, onExpired\)/.test(app)
  && /clearStoredSession\(\);[\s\S]{0,320}setShowLoginModal\(true\)/.test(app));
check('54. The profile no longer offers a Retry that can never succeed',
  !app.includes('>Retry Access<') && /profileIsSignedOut/.test(app));
check('55. ...it offers signing in again instead',
  /Sign in again/.test(app));
check('56. Peeking at the body never breaks the request itself',
  /response\.clone\(\)\.json\(\)\.catch\(\(\) => null\)/.test(app));

console.log('\n--- Library: the duplicate carousel is gone ---');

check('57. The Recently Added strip no longer renders in the Library',
  !/<p className="mb-6 text-\[10px\] font-bold uppercase tracking-\[0\.35em\] text-brand-gold-text">Recently Added<\/p>/.test(app));
// The Home page it later moved to has itself been retired (20 Sep 2026), so
// the computation went too rather than being left to run on every render
// with nothing reading it.
check('58. ...and the data it fed is no longer computed for nobody',
  !/const recentlyListedBooks = useMemo/.test(app));


// ============================================== academic shelf
console.log('\n--- Library: the Academic & Exams shelf ---');

const gasSrc = read('appsscript.js');

const ACADEMIC = ['Academic', 'Competitive Exams', 'School & Board Prep',
                  'Engineering & Technical', 'Medical & Nursing', 'Law'];

check('59. The academic genres exist in the backend list (which is authoritative)',
  ACADEMIC.every(g => gasSrc.includes(`"${g}"`)));
check('60. ...and the frontend fallback list matches it exactly',
  ACADEMIC.every(g => app.includes(`"${g}"`)));
check('61. "Academic" is preserved, so listings tagged before this still work',
  /BOOK_GENRE_OPTIONS = \[[\s\S]{0,600}"Academic"/.test(gasSrc));
check('62. "Other" is still the last resort option',
  /"Other"\s*\n?\];/.test(gasSrc));

check('63. A single ACADEMIC_GENRES list drives the filter, the count and the copy',
  /const ACADEMIC_GENRES = \[/.test(app) && /const isAcademicBook =/.test(app));
check('64. The Library has an Academic & Exams shelf',
  /id: 'academic', label: 'Academic & Exams'/.test(app));
check('65. Selecting it actually filters the grid',
  /if \(libraryCategoryFilter === 'academic'\) return isAcademicBook\(book\);/.test(app));
check('66. Its tab count comes from the same predicate as the filter',
  /count: count\(isAcademicBook\)/.test(app));
check('67. It is a SUBJECT shelf — the circulation shelves are untouched',
  ['permanent_exchange', 'temporary_exchange', 'rent', 'sell']
    .every(k => app.includes(`libraryCategoryFilter === '${k}'`)));
check('68. An empty academic shelf invites a student rather than reporting a failure',
  /another student is looking for it/.test(app));
check('69. A selected shelf shows its own empty copy, not a generic one',
  /activeLibraryCategory\.empty/.test(app));
check('70. ...so activeLibraryCategory is no longer dead code',
  (app.match(/activeLibraryCategory/g) || []).length >= 2);


// ============================================== one way to add a book
console.log('\n--- The duplicate Reading Space listing form is gone ---');

check('71. The shadow-record modal no longer exists',
  !/showReadingSpaceForm/.test(app) && !/handleReadingSpaceSubmit/.test(app));
check('72. Its opener and item editor are gone too — no dead entry points',
  !/openReadingSpaceForm/.test(app) && !/openReadingSpaceItemEditor/.test(app));
check('73. Its form state was removed, not just hidden',
  !/setReadingSpaceForm/.test(app));
check('74. There is now ONE gated way to add a book',
  /const openListingForm = (async )?\(\) => \{/.test(app));
// Assert each guard by name rather than one long span — clearer, and it
// does not break the next time a comment is added inside the function.
const listingFn = app.slice(app.indexOf('const openListingForm'), app.indexOf('const promptMembershipGate'));
check('75. ...and it keeps the full eligibility chain',
  /if \(!activeUserEmail\) \{ setShowLoginModal\(true\); return; \}/.test(listingFn)
  && /if \(!isRegisteredMember\) \{ handleBecomeMemberClick\(\); return; \}/.test(listingFn)
  && /if \(userTier === 'expired'\) \{ openMembershipActivation\(\); return; \}/.test(listingFn)
  && /if \(!isListerActive\) \{ promptMembershipGate\(\); return; \}/.test(listingFn)
  && /setShowListingForm\(/.test(listingFn));
// Oct 2026: 20 free, then ₹20 once or a coupon — asked of the server.
check('76. ...including the real listing allowance',
  /const allowance = await fetchListingAllowance\(\);/.test(listingFn)
  // 8 Oct 2026: the unlock popup shows once; after that the profile button is the way in.
  && /if \(allowance && !allowance\.canList\) \{ offerListingUnlock\(\); return; \}/.test(listingFn));
check('77. The profile "Add Book" affordance still routes there',
  /onClick=\{openListingForm\}/.test(app));
// One place decides whether a reader may list (openListingForm). The only
// other opener is the deliberate first-listing effect after sign-up, which
// runs once the backend has confirmed membership — so two call sites, one
// eligibility check.
check('78. The floating + button shares the same function, not a copy',
  /onClick=\{openListingForm\}/.test(app)
  && (app.match(/setShowListingForm\(activeSubscription/g) || []).length <= 2
  && (app.match(/if \(!isRegisteredMember\) \{ handleBecomeMemberClick\(\); return; \}/g) || []).length === 1);

console.log('\n--- ...but the shelves still fill, from real listings ---');

// `void` on the create path is deliberate: the book already exists by then,
// so the form no longer holds the reader while the mirror is written.
check('79. The real createBook flow still mirrors into the reading space',
  (app.match(/(await|void) saveReadingSpaceBook\(\{/g) || []).length >= 2);
check('80. saveReadingSpaceBook itself was kept, not deleted',
  /const saveReadingSpaceBook = async/.test(app));
check('81. Edit is offered only for shelf items backed by a real listing',
  // (the shelf list that carried this moved out with the reader identity section)
  !/linkedBook \? openBookEditor\(linkedBook\) :/.test(app));
check('82. The book edit modal keeps its status checkboxes (not collateral damage)',
  /readingSpaceOptions\.map\(option =>/.test(app) && /bookEditForm\[option\.key\]/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
