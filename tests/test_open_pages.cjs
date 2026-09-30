// test_open_pages.cjs — 30 Sep 2026: every page is open to look at; only
// actions need an account. Static checks on App, ReadingRoom, the proxies
// and Apps Script.
const fs = require('fs'); const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = R('src/App.tsx'), rr = R('src/components/ReadingRoom.tsx'), gs = R('appsscript.js'), px = R('api/swapsutra.ts'), srv = R('server.ts');
let passed = 0, failed = 0;
const check = (l, c) => { if (c) { passed++; console.log('PASS: ' + l); } else { failed++; console.log('FAIL: ' + l); } };
const nav = app.slice(app.indexOf('const navigateTo = (tab: AppTab) => {'), app.indexOf('const navigateTo = (tab: AppTab) => {') + 600);
check('1. navigateTo no longer bounces anyone to the profile', !/GATE_ALLOWED_TABS/.test(nav) && !/tab = 'profile'/.test(nav));
check('2. The page-level access wall effect is gone', !/if \(isAccessGated && !GATE_ALLOWED_TABS\.includes\(activeTab\)\)/.test(app));
check('3. No "Authentication Required" block remains', !/Authentication Required/.test(app));
check('4. One requireMember() gate for activity', /const requireMember = \(reason\?: string\): boolean =>/.test(app));
check('5. Book requests: invite instead of a member-only wall', /data-testid="book-requests-invite"/.test(app) && !/title="Book Requests are member-only\."\s*reason="Book Requests are available for approved SwapSutra members\."\s*\/>\s*\) : \(\s*<>\s*\{bookRequestFeedLoading/.test(app));
check('6. Reading Room actions ask to register (no login alerts)', /onRequireAuth\?: \(why: string\) => void/.test(rr) && !/alert\('Please log in/.test(rr) && (rr.match(/canAct\('/g) || []).length >= 7);
check('7. Swap from a Reading Room post is gated', /if \(!requireMember\('Register to request a swap\.'\)\) return;/.test(app));
check('8. Cart accept/decline and request-a-book are gated', /onAccept=\{\(id\) => \{ if \(requireMember\(\)\)/.test(app) && /requireMember\('Register to ask readers for a book\.'\)/.test(app));
check('9. The Reading Room feed is public in all three lists', /getReadingRoomFeed: true/.test(gs) && /'getReadingRoomFeed'/.test(px) && /'getReadingRoomFeed'/.test(srv));
const feed = gs.slice(gs.indexOf('function getReadingRoomFeed('), gs.indexOf('function getReadingRoomFeed(') + 9000);
check('10. The feed takes the viewer from the session, not the request', /normalizeEmail\(getAuthenticatedEmail\(\) \|\| ''\)/.test(feed) && !/data\.userEmail \|\| data\.email/.test(feed));
check('11. A visitor gets no email addresses (author, reactions, comments)', /authorEmail: isVisitor \? '' : p\.authorEmail/.test(feed) && /userEmail: isVisitor \? '' : rx\[rUserIdx\]/.test(feed) && /if \(isVisitor\) \{ cObj\.userEmail = ''; cObj\.email = ''; \}/.test(feed));
check('12. Newsletter is gone from the profile', !/Read past letters or unsubscribe/.test(app) && /activity_type === 'newsletter_subscribed'\) return false;/.test(app));
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
