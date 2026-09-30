/**
 * test_cafe_mobile_and_stories.cjs
 *
 * Covers this round of Reader's Café work:
 *   A. Emails are never published as usernames (a live privacy leak).
 *   B. The mobile layout — the composer must be reachable.
 *   C. WhatsApp-style chat ergonomics: bubbles, sides, day dividers,
 *      Enter-to-send, an emoji picker.
 *   D. Stories: post, expire after 24h, record views, and let ONLY the
 *      author see who watched.
 *
 * The Apps Script assertions run the REAL appsscript.js against an
 * in-memory Sheets stand-in, so the privacy rules and the story gates are
 * actually executed rather than pattern-matched. The React and CSS
 * assertions are source-level: they prove the wiring, not the pixels.
 * The rendered result was reviewed separately in headless Chromium at a
 * true 390px column — visual review, which no assertion replaces.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label); }
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const gas = read('appsscript.js');
const app = read('src/App.tsx');
const cafe = read('src/components/ReadersCafe.tsx');
const stories = read('src/components/CafeStories.tsx');
const emoji = read('src/components/CafeEmojiPicker.tsx');
const css = read('src/index.css');
const proxy = read('api/swapsutra.ts');
// Comment-stripped, for the same reason as elsewhere in this suite: the
// comment explaining why `bodyParser` was removed contains the word
// `bodyParser`, so an "it must be absent" check run against the prose
// fails on its own explanation.
const proxyCode = proxy.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------
// In-memory Sheets stand-in.
// ---------------------------------------------------------------------
const CAFE_ID = 'SS_READERS_CAFE';
const MSG_HEADERS = ['message_id', 'circle_id', 'user_id', 'user_name', 'message', 'is_spoiler', 'created_at', 'image_url'];
// The real computeSubscriptionStatus is strict about what counts as an
// active member — a row's mere existence is not evidence. These fixtures
// carry the full shape of a genuinely approved, dated, paid membership.
const SUB_HEADERS = ['id', 'name', 'email', 'userEmail', 'adminStatus', 'paymentRequired',
  'membershipType', 'subscriptionStartDate', 'subscriptionExpiry', 'paymentStatus'];
const STORY_HEADERS = ['story_id', 'user_id', 'user_name', 'media_type', 'media_url', 'caption', 'created_at', 'expires_at', 'status'];
const VIEW_HEADERS = ['view_id', 'story_id', 'viewer_id', 'viewer_name', 'viewed_at'];

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
const memberStart = new Date(now - 10 * 24 * HOUR).toISOString();
const memberExpiry = new Date(now + 80 * 24 * HOUR).toISOString();

function makeSheet(headers, rows) {
  const data = [headers.slice(), ...rows.map(r => r.slice())];
  return {
    __rows: data,
    getDataRange: () => ({ getValues: () => data }),
    getRange: (row, col) => ({
      getValues: () => data,
      getValue: () => (data[row - 1] ? data[row - 1][col - 1] : ''),
      setValue: (v) => { if (data[row - 1]) data[row - 1][col - 1] = v; }
    }),
    getLastRow: () => data.length,
    getLastColumn: () => headers.length,
    appendRow: (row) => { data.push(row.slice()); },
    deleteRow: (row) => { data.splice(row - 1, 1); }
  };
}

const sheets = {
  // Row 1 stored the SENDER'S EMAIL in user_name — this is exactly what
  // the old `firstNameOnly` published verbatim to the open web.
  current_read_messages: makeSheet(MSG_HEADERS, [
    ['CRMSG_1', CAFE_ID, 'priya.sharma94@gmail.com', 'priya.sharma94@gmail.com', 'Started Em and the Big Hoom.', 'FALSE', iso(-3 * HOUR), ''],
    ['CRMSG_2', CAFE_ID, 'arjun@example.com', 'Arjun Rao', 'Anyone read Dholavira?', 'FALSE', iso(-2 * HOUR), '']
  ]),
  Subscriptions: makeSheet(SUB_HEADERS, [
    ['SUB1', 'Priya Sharma', 'priya.sharma94@gmail.com', 'priya.sharma94@gmail.com', 'Approved', 'Yes', 'premium', memberStart, memberExpiry, 'Paid'],
    ['SUB2', 'Arjun Rao', 'arjun@example.com', 'arjun@example.com', 'Approved', 'Yes', 'premium', memberStart, memberExpiry, 'Paid'],
    ['SUB3', 'Meera Nair', 'meera@example.com', 'meera@example.com', 'Approved', 'Yes', 'premium', memberStart, memberExpiry, 'Paid']
  ]),
  cafe_stories: makeSheet(STORY_HEADERS, [
    ['STORY_LIVE', 'arjun@example.com', 'Arjun Rao', 'image', 'https://drive.google.com/file/d/AAA/view', 'My shelf', iso(-2 * HOUR), iso(22 * HOUR), 'active'],
    ['STORY_MINE', 'priya.sharma94@gmail.com', 'priya.sharma94@gmail.com', 'image', 'https://drive.google.com/file/d/BBB/view', 'Rain and a book', iso(-1 * HOUR), iso(23 * HOUR), 'active'],
    ['STORY_OLD', 'meera@example.com', 'Meera Nair', 'image', 'https://drive.google.com/file/d/CCC/view', 'Yesterday', iso(-30 * HOUR), iso(-6 * HOUR), 'active']
  ]),
  cafe_story_views: makeSheet(VIEW_HEADERS, [
    ['SV1', 'STORY_MINE', 'arjun@example.com', 'Arjun Rao', iso(-30 * 60 * 1000)],
    ['SV2', 'STORY_MINE', 'meera@example.com', 'Meera Nair', iso(-20 * 60 * 1000)],
    ['SV3', 'STORY_LIVE', 'meera@example.com', 'Meera Nair', iso(-10 * 60 * 1000)]
  ])
};

const scriptProperties = new Map([['SPREADSHEET_ID', 'TEST']]);
const blank = (name) => makeSheet([], []);
const savedFiles = [];

const sandbox = {
  console, Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (scriptProperties.has(k) ? scriptProperties.get(k) : null),
      setProperty: (k, v) => scriptProperties.set(k, v),
      deleteProperty: (k) => scriptProperties.delete(k)
    })
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', Buffer.from(String(k))).update(Buffer.from(String(v))).digest()),
    base64EncodeWebSafe: (i) => (Array.isArray(i) ? Buffer.from(i.map(b => b & 0xff)) : Buffer.from(String(i), 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')),
    newBlob: (b) => ({ getDataAsString: () => Buffer.from((b || []).map(x => x & 0xff)).toString('utf8') })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => sheets[name] || null,
      insertSheet: (name) => (sheets[name] = blank(name))
    }),
    openById: () => ({
      getSheetByName: (name) => sheets[name] || null,
      insertSheet: (name) => (sheets[name] = blank(name))
    })
  },
  MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(gas, ctx, { filename: 'appsscript.js' });
const run = (expr) => vm.runInContext(expr, ctx);
const call = (fn, ...args) => vm.runInContext(`(${fn}).apply(null, ${JSON.stringify(args)})`, ctx);

/** Signs in as this address for the calls that follow. */
function signIn(email) {
  run('resetRequestIdentity()');
  const token = call('createSessionToken', email, 'member');
  call('establishRequestIdentity', { sessionToken: token });
  return token;
}
function signOut() { run('resetRequestIdentity()'); }

// =====================================================================
console.log('\n--- A: THE BUG — email addresses were published as usernames ---');

check('1. THE ROOT CAUSE: an email has no whitespace, so the old split returned the whole address',
  'priya.sharma94@gmail.com'.trim().split(/\s+/)[0] === 'priya.sharma94@gmail.com');
check('2. firstNameOnly no longer hands an address back',
  call('firstNameOnly', 'priya.sharma94@gmail.com') === 'Priya');
check('3. ...and it still does the ordinary thing with a real name',
  call('firstNameOnly', 'Priya Sharma') === 'Priya');
check('4. Digits and separators in a local part are not treated as a name',
  call('firstNameOnly', 'reader_42@x.in') === 'Reader');
check('5. An empty value still falls back to a person, not a blank',
  call('firstNameOnly', '') === 'Reader' && call('firstNameOnly', null) === 'Reader');

check('6. publicReaderName prefers the REGISTERED name over the address',
  call('publicReaderName', 'priya.sharma94@gmail.com', 'priya.sharma94@gmail.com') === 'Priya');
check('7. A real stored name is used as-is (first name only)',
  call('publicReaderName', 'Arjun Rao', 'arjun@example.com') === 'Arjun');
check('8. An unknown address degrades to its human part, never the address',
  !call('publicReaderName', 'someone.new@nowhere.com', 'someone.new@nowhere.com').includes('@'));

signOut();
const guestView = call('getReadersCafe', {});
check('9. THE FIX AT READ TIME: rows already holding an email now render as a name',
  guestView.data[0].user_name === 'Priya');
check('10. No "@" reaches a public visitor anywhere in the payload',
  !JSON.stringify(guestView.data).includes('@'));
check('11. ...including the homepage preview line',
  !String(guestView.lastMessageBy).includes('@'));

check('12. THE FIX AT WRITE TIME: the client no longer sends the address as a name',
  !/user_name: profileData\?\.name \|\| activeUserEmail/.test(app));
check('13. It sends a computed display name instead',
  /user_name: cafeDisplayName/.test(app));
check('14. ...which is defined never to be an address',
  /const cafeDisplayName = useMemo\([\s\S]{0,700}if \(value && !value\.includes\('@'\)\) return value;/.test(app));
check('15. The component keeps a last-line-of-defence strip, for a stale deployment',
  /export function publicName/.test(cafe) && /if \(raw\.includes\('@'\)\)/.test(cafe));
check('16. The name directory is rebuilt per request, not cached across users',
  /function resetRequestIdentity\(\)[\s\S]{0,160}resetReaderNameDirectory\(\)/.test(gas));

// =====================================================================
console.log('\n--- B: THE BUG — the composer could not be reached on a phone ---');

check('17. THE ROOT CAUSE is named: a global rule forced every textarea to 96px',
  /textarea\.input-classic, textarea \{ min-height: 96px; \}/.test(css));
check('18. The chat composer opts out of it by name',
  /textarea\.cafe-compose__input \{[\s\S]{0,120}min-height: 2\.6rem/.test(css));
check('19. ...with enough specificity to actually win (element + class)',
  css.includes('textarea.cafe-compose__input'));

check('20. The room no longer has a viewport-relative cap that pushes the composer off-screen',
  !/\.cafe-room__log \{[^}]*max-height:\s*min\(62vh/.test(css));
check('21. It owns the height it is given instead',
  /\.cafe-room \{[\s\S]{0,600}height: 100%;[\s\S]{0,120}min-height: 0;[\s\S]{0,120}display: flex/.test(css));
check('22. The log is the only scroller, and it can shrink',
  /\.cafe-room__log \{[\s\S]{0,300}flex: 1 1 auto;[\s\S]{0,60}min-height: 0/.test(css));
check('23. The composer never shrinks or scrolls away',
  /\.cafe-room__counter \{[\s\S]{0,80}flex: 0 0 auto/.test(css));
check('24. ...and it clears the phone\'s home indicator',
  /\.cafe-room__counter \{[\s\S]{0,300}env\(safe-area-inset-bottom\)/.test(css));

check('25. The page shell gives the Café a real height, like a reader circle already had',
  /activeTab === 'cafe'[\s\S]{0,140}h-\[calc\(100dvh-80px-4\.25rem\)\]/.test(app));
check('26. It uses dvh, so a collapsing mobile address bar cannot hide the input',
  /100dvh/.test(app));
check('27. Below xl the fixed bottom nav is subtracted; at xl it is not',
  /xl:h-\[calc\(100dvh-80px\)\]/.test(app));
check('28. Height flows unbroken from the shell down to the room',
  /className="h-full min-h-0"[\s\S]{0,400}<div className="h-full min-h-0 max-w-3xl/.test(app));
check('29. iOS will not zoom the page when the input is focused',
  /\.cafe-compose__input \{[\s\S]{0,300}font-size: var\(--font-size-md\)/.test(css) && /--font-size-md:\s*1rem;/.test(css));  // 16px token (30 Sep)

// =====================================================================
console.log('\n--- C: chat ergonomics (a deliberate reversal of the earlier brief) ---');

check('30. Messages are bubbles now',
  /\.cafe-bubble \{/.test(css) && /className={`cafe-bubble/.test(cafe));
check('31. Your own sit on your own side',
  /\.cafe-line--mine \{[\s\S]{0,80}justify-content: flex-end/.test(css));
check('32. Which side is decided by the SERVER, not by matching a name',
  /is_mine: Boolean\(viewerEmail\) && normalizeEmail\(message\.user_id\) === viewerEmail/.test(gas));
check('33. ...and the address itself is still never sent to build it',
  !JSON.stringify(guestView.data).includes('user_id'));
check('34. Day dividers break up a long backlog',
  /export function cafeDayLabel/.test(cafe) && /\.cafe-day \{/.test(css));
check('35. Consecutive messages from one reader are grouped',
  /cafe-line--grouped/.test(cafe) && /\.cafe-line--grouped/.test(css));
check('36. Enter sends, Shift+Enter breaks the line',
  /e\.key === 'Enter' && !e\.shiftKey/.test(cafe));
check('37. The input grows with the message, up to a ceiling',
  /const resizeInput = useCallback/.test(cafe) && /Math\.min\(el\.scrollHeight, 120\)/.test(cafe));
check('38. There is a real send button, not just a form submit on Enter',
  /className="cafe-compose__send"/.test(cafe) && /type="submit"/.test(cafe));

check('39. An emoji picker exists and is self-contained (no npm dependency)',
  /EMOJI_CATEGORIES/.test(emoji) && !/from 'emoji/.test(emoji));
check('40. It is categorised, starting with reading',
  /key: 'reading'/.test(emoji));
check('41. Its tabs and cells are labelled for screen readers',
  /role="tablist"/.test(emoji) && /aria-label={`Insert \$\{e\}`}/.test(emoji));
check('42. Picking inserts at the caret rather than always appending',
  /el\.selectionStart/.test(cafe) && /setSelectionRange/.test(cafe));
check('43. Control icons are drawn, not typed — a missing emoji font cannot blank the row',
  /const SendIcon = \(\)/.test(cafe) && /<svg \{\.\.\.iconProps\}/.test(cafe));

// =====================================================================
console.log('\n--- D: Stories — posting ---');

check('44. Stories keep Google Sheets as the database (no new backend)',
  /getOrCreateSheet\("cafe_stories", CAFE_STORY_HEADERS\)/.test(gas));
check('45. A story expires after 24 hours',
  run('CAFE_STORY_TTL_MS') === 24 * 60 * 60 * 1000);

signOut();
const guestPost = call('postCafeStory', { media: 'data:image/jpeg;base64,' + 'A'.repeat(400) });
check('46. A signed-out visitor cannot post',
  guestPost.success === false && guestPost.error === 'SESSION_REQUIRED');

signIn('priya.sharma94@gmail.com');
const badType = call('postCafeStory', { media: 'data:application/pdf;base64,' + 'A'.repeat(400) });
check('47. A non-media file is refused',
  badType.success === false && badType.error === 'STORY_MEDIA_REJECTED');

const hugeVideo = call('postCafeStory', { media: 'data:video/mp4;base64,' + 'A'.repeat(9 * 1024 * 1024) });
check('48. An oversized clip is refused BEFORE upload',
  hugeVideo.success === false && hugeVideo.error === 'STORY_MEDIA_REJECTED');
check('49. ...and the message states the real limit instead of failing silently',
  /3MB|ten seconds/.test(hugeVideo.message));

check('50. The client compresses a photo rather than pushing the limit onto the reader',
  /const prepareStoryMedia/.test(app) && /canvas\.toDataURL\('image\/jpeg', quality\)/.test(app));
check('51. ...and refuses a clip client-side too, with the same honest reason',
  /STORY_VIDEO_MAX_BYTES/.test(app) && /roughly ten seconds/.test(app));
// This used to assert `api: { bodyParser: { sizeLimit: '4mb' } }` in the
// proxy — a Next.js Pages Router key that means nothing in a plain Vercel
// serverless function. It was ignored at runtime, so the test was pinning
// a limit nothing was setting. Vercel's body ceiling is a fixed 4.5MB,
// which is what the story caps are sized against; the config that DOES
// matter is maxDuration, because a slow upload being killed at the
// default 10s is what actually broke listing a book.
check('52. The proxy sets the function config that actually has an effect',
  /export const config = \{\s*maxDuration: 60\s*\}/.test(proxy)
  && !/bodyParser/.test(proxyCode));
check('52b. ...and the story caps stay under Vercel\'s fixed 4.5MB body ceiling',
  /CAFE_STORY_MAX_VIDEO_BYTES = 3 \* 1024 \* 1024/.test(gas));

// =====================================================================
console.log('\n--- D: Stories — reading the wall ---');

signOut();
const wall = call('getCafeStories', {});
check('53. A visitor can watch the wall without an account',
  wall.success === true && run('requireSessionForAction("getCafeStories")') === null);
check('54. A story older than 24 hours is gone',
  !JSON.stringify(wall.stories).includes('STORY_OLD'));
check('55. ...while live ones are there',
  wall.stories.length === 2);
check('56. No author email is published',
  !JSON.stringify(wall).includes('@'));
check('57. An address stored as an author name renders as the registered name',
  wall.stories.some(s => s.authorName === 'Priya'));
check('58. A visitor is told nobody\'s view count',
  wall.stories.every(s => s.viewCount === null));
check('59. Stories are grouped by author so the rail can show rings',
  Array.isArray(wall.groups) && wall.groups.length === 2);

signIn('priya.sharma94@gmail.com');
const myWall = call('getCafeStories', {});
const mine = myWall.stories.find(s => s.storyId === 'STORY_MINE');
const theirs = myWall.stories.find(s => s.storyId === 'STORY_LIVE');
check('60. An author sees the count on their OWN story',
  mine && mine.isMine === true && mine.viewCount === 2);
check('61. ...and still sees nothing on anyone else\'s',
  theirs && theirs.isMine === false && theirs.viewCount === null);
check('62. Your own story sorts to the front of the rail',
  myWall.groups[0].isMine === true);

// =====================================================================
console.log('\n--- D: Stories — who watched (the whole point, and the risk) ---');

signIn('meera@example.com');
const notMine = call('getCafeStoryViewers', { storyId: 'STORY_MINE' });
check('63. Another member CANNOT read someone else\'s audience list',
  notMine.success === false && notMine.error === 'NOT_STORY_OWNER');

signOut();
const anonViewers = call('getCafeStoryViewers', { storyId: 'STORY_MINE' });
check('64. Nor can an anonymous caller',
  anonViewers.success === false && anonViewers.error === 'SESSION_REQUIRED');
check('65. ...and the action is not on the public allowlist',
  run('requireSessionForAction("getCafeStoryViewers")') !== null);

signIn('priya.sharma94@gmail.com');
const myViewers = call('getCafeStoryViewers', { storyId: 'STORY_MINE' });
check('66. The author sees exactly who watched',
  myViewers.success === true && myViewers.viewCount === 2);
check('67. ...by name, never by email address',
  !JSON.stringify(myViewers.viewers).includes('@')
  && myViewers.viewers.map(v => v.name).sort().join(',') === 'Arjun,Meera');
check('68. ...newest first, so the list reads as "who just watched"',
  new Date(myViewers.viewers[0].viewedAt).getTime() >= new Date(myViewers.viewers[1].viewedAt).getTime());

// =====================================================================
console.log('\n--- D: Stories — recording a view ---');

signIn('meera@example.com');
const beforeViews = sheets.cafe_story_views.__rows.length;
const dupe = call('markCafeStoryViewed', { storyId: 'STORY_MINE' });
check('69. Watching a story twice does not inflate the author\'s count',
  dupe.success === true && dupe.skipped === 'already_recorded'
  && sheets.cafe_story_views.__rows.length === beforeViews);

const fresh = call('markCafeStoryViewed', { storyId: 'STORY_LIVE', user_id: 'someone.else@evil.com' });
check('70. A caller cannot record a view as somebody else',
  fresh.success === true
  && !JSON.stringify(sheets.cafe_story_views.__rows).includes('evil.com'));

signIn('arjun@example.com');
const own = call('markCafeStoryViewed', { storyId: 'STORY_LIVE' });
check('71. An author watching their own story is not counted as an audience',
  own.success === true && own.skipped === 'author_is_not_a_viewer');

const expiredView = call('markCafeStoryViewed', { storyId: 'STORY_OLD' });
check('72. A faded story cannot be viewed or counted',
  expiredView.success === false && expiredView.error === 'STORY_EXPIRED');

signOut();
const anonView = call('markCafeStoryViewed', { storyId: 'STORY_LIVE' });
check('73. An anonymous watcher is counted as nobody, not invented as someone',
  anonView.success === true && anonView.skipped === 'anonymous_viewer');

// =====================================================================
console.log('\n--- D: Stories — removing one ---');

signIn('meera@example.com');
const notYours = call('deleteCafeStory', { storyId: 'STORY_LIVE' });
check('74. Only the author (or an admin) can take a story down',
  notYours.success === false && notYours.error === 'NOT_STORY_OWNER');

signIn('arjun@example.com');
const removed = call('deleteCafeStory', { storyId: 'STORY_LIVE' });
check('75. The author can remove their own before it expires',
  removed.success === true);
signOut();
check('76. ...and it leaves the wall immediately',
  !JSON.stringify(call('getCafeStories', {}).stories).includes('STORY_LIVE'));

check('77. Expired rows can be swept by a daily trigger, bottom-up so rows do not shift',
  /function purgeExpiredCafeStories/.test(gas)
  && /sort\(function \(a, b\) \{ return b - a; \}\)/.test(gas));

// =====================================================================
console.log('\n--- Stories in the UI ---');

check('78. The rail, the viewer and the composer are all present',
  /export const CafeStoryRail/.test(stories)
  && /export const CafeStoryViewer/.test(stories)
  && /export const CafeStoryComposer/.test(stories));
check('79. A reader can shoot with the camera OR pick from the gallery',
  /capture="environment"/.test(stories) && /accept="image\/\*,video\/\*"/.test(stories));
check('80. The viewer advances by tap, with labelled zones for a screen reader',
  /aria-label="Next story"/.test(stories) && /aria-label="Previous story"/.test(stories));
check('81. Keyboard works too — arrows and Escape',
  /e\.key === 'ArrowRight'/.test(stories) && /e\.key === 'Escape'/.test(stories));
check('82. A view is recorded once per story per session',
  /seenRef\.current\.has\(story\.storyId\)/.test(stories));
check('83. "Seen by" only appears on your own story',
  /\{story\.isMine && \(/.test(stories) && /cafe-story__seen/.test(stories));
check('84. A story shows how long it has left — that is the point of one',
  /export function storyTimeLeft/.test(stories));
check('85. Drive links are converted to something that actually renders',
  /drive\.google\.com\/thumbnail\?id=/.test(stories) && /\/preview/.test(stories));
check('86. The room hides the story controls entirely if the handlers are absent',
  /const storiesEnabled = Boolean\(onPostStory && onStorySeen/.test(cafe));
check('87. A failed story fetch never breaks the conversation',
  /catch \{[\s\S]{0,220}\/\/ The wall is an extra, never a blocker/.test(app));

// =====================================================================
console.log('\n--- E: the floating buttons stopped sitting on the composer ---');

check('88. THE BUG: the list-a-book button is no longer centred over the nav',
  !/fixed z-\[90\] left-1\/2 -translate-x-1\/2/.test(app));
check('89. It lives in a bottom-right column instead',
  /\.ss-fabs \{[\s\S]{0,260}right: 0\.85rem/.test(css)
  && /flex-direction: column/.test(css.slice(css.indexOf('.ss-fabs {'), css.indexOf('.ss-fabs {') + 400)));
// 22 Sep: the floating button is shown on the Library tabs only, which
// covers the Café (and every other page) by construction.
check('90. THE FIX: the Café shows no floating button at all',
  /\{\(activeTab === 'browse' \|\| activeTab === 'book-requests'\) && \(/.test(app));
check('91. ...so nothing can land on the message box again',
  /className=\{`ss-fabs /.test(app));
check('92. They clear the mobile bottom nav and the home indicator',
  /bottom: calc\(56px \+ env\(safe-area-inset-bottom\) \+ 0\.75rem\)/.test(css));
check('93. Smaller than the 56px button they replace, but still a real tap target',
  /\.ss-fab \{[\s\S]{0,200}width: 2\.75rem/.test(css));
// CHANGED 20 Sep 2026. Readers said the site felt crowded, and the home
// screen was carrying four floating things at once — this Café button, the
// "list a book" button, Quill, and the bottom nav — before a single scroll.
// The Café is one tap away in the menu, so the floating door bought nothing
// and cost the first impression. One floating action is left, and it says
// what it does in words.
check('94. Home no longer carries a second floating button',
  !/aria-label="Open the Reader's Café"/.test(app));
check('95. The one floating action names itself instead of being a bare icon',
  /aria-label="List a book"/.test(app)
  && /List a book<\/span>/.test(app));
check('96. The dead Café button styling went with it',
  !/\.ss-fab--cafe/.test(css));
check('97. The primary button keeps legible contrast on the brand colour',
  /\.ss-fab--list \{[\s\S]{0,160}color: #FFFFFF/.test(css));
check('98. The onboarding badge was moved out of the same corner',
  !/className="fixed bottom-24 right-6 z-\[100\]/.test(app));
check('99. Quill still owns the opposite corner, so they cannot collide',
  /quill-mobile \$\{[^}]*\} fixed bottom-24 left-4/.test(app));

console.log('\n--- E: a photo that the phone can open now actually posts ---');

check('100. Decoding tries createImageBitmap before an <img> element',
  /createImageBitmap\(file\)/.test(app));
check('101. A zero-dimension decode is treated as failure, not as a 1x1 photo',
  /decode-empty/.test(app));
check('102. Size is stepped down, not just quality — 1280 then smaller',
  /for \(const edge of \[STORY_PHOTO_MAX_EDGE, 1024, 800, 640\]\)/.test(app));
check('103. The original bytes are still a last resort when small enough',
  /if \(file\.size <= STORY_PHOTO_MAX_BYTES\) return fileToBase64\(file\)/.test(app));
check('104. A real failure names the file type, so a report is actionable',
  /We couldn’t open that \$\{file\.type \|\| 'file'\}/.test(app));
check('105. ...and logs the underlying error rather than swallowing it',
  /console\.error\('\[story\] decode failed'/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
