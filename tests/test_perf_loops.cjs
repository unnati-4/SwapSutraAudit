/**
 * test_perf_loops.cjs — guards for the "every page loads slowly" fixes (22 Sep 2026).
 * A browser run showed 640 API calls on one page load and ~400 per page
 * after that, almost all from a Quill auto-message loop. These keep it fixed.
 */
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
const check = (l, c) => { if (c) { passed++; console.log('PASS: ' + l); } else { failed++; console.log('FAIL: ' + l); } };
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');

check('1. Quill auto-message is tried at most once per circle per visit',
  /quillTriedRef\.current\.has\(circle\.id\)\) return;/.test(app) && /quillTriedRef\.current\.add\(circle\.id\)/.test(app));
check('2. ...and is no longer fired from inside a setState updater',
  !/setCurrentReadCircles\(prev => \{[^}]*checkQuillAutoTriggers/.test(app));
check('3. Circle chat is only fetched while a circle page is open',
  /if \(!joinedCurrentReadId \|\| \(activeTab !== 'reader-circle' && activeTab !== 'reading-room'\)\) return;\n    fetchCurrentReadMessages/.test(app));
check('4. Scrolling no longer re-renders the whole app (activity is a ref)',
  /const lastActivityRef = useRef<number>/.test(app) && !/setLastActivity\(/.test(app));
check('5. Background polling is every 30s, not 15s', /\}, 30000\); \/\/ Poll every 30 seconds/.test(app));
check('6. Idle animation re-renders every 20s, not 9s', /\}, 20000\); \/\/ was 9s/.test(app));

check('7. Book-request chats do not show swap-only tools ("That exchange could not be found")',
  /const hasRealSwap = !!currentChat\.swapId && !isBookRequestChat;/.test(app) && /\{chatTab === 'stages' && hasRealSwap && \(/.test(app) && !/currentChat\.swapId && \(/.test(app));
check('8. One failing section can no longer blank the whole app', /class SectionBoundary extends React\.Component/.test(app) && /<SectionBoundary>/.test(app));
check('9. Chat tabs fit a phone (one row, "Stages" short label)', /<span className="sm:hidden">Stages<\/span>/.test(app));

const fdStart = app.indexOf('PERF (22 Sep): only what the Library needs');
const fd = app.slice(fdStart, app.indexOf('const results = await Promise.all(fetchActions)', fdStart));
check('10. Opening the app asks only for books + settings (no testimonials/events)', /action=getBooks/.test(fd) && !/getTestimonials/.test(fd) && !/getEvents/.test(fd));
check('11. Events load when an events page opens', /eventsLoadedRef\.current = true;/.test(app));
check('12. Reading journey loads with the profile, not on every open', /if \(activeTab !== 'profile' \|\| journeyLoadedForRef\.current === activeUserEmail\) return;/.test(app));
check('13. Book requests load only on the pages that show them', /if \(activeTab !== 'profile' && activeTab !== 'book-requests' && activeTab !== 'cart'\) return;/.test(app));
check('14. Swaps/chats/notifications wait 2.5s and never run twice at once', /setTimeout\(\(\) => \{ fetchOngoingData\(\); \}, 2500\)/.test(app) && /if \(ongoingInFlightRef\.current\) return;/.test(app));
check('15. Genres are kept for a day', /swapsutraGenres/.test(app));
const px = fs.readFileSync(path.join(__dirname, '..', 'api', 'swapsutra.ts'), 'utf8');
check('16. Proxy cache is keyed by audience (no member/admin copy served to guests)', /function publicReadCacheKey\(query: any, sessionToken = ''\)/.test(px) && /publicReadCacheKey\(req\.query, sessionToken\)/.test(px));
check('17. Settings, genres and events are CDN-cached; the Library is not', /CDN_CACHEABLE_ACTIONS = new Set\(\['getAppSettings', 'getBookGenres', 'getEvents'\]\)/.test(px));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
