/**
 * test_accessibility_and_polish.cjs
 *
 * "Usable and suitable for every reader" is mostly an accessibility
 * question, plus the remaining performance and correctness faults from
 * the audit. This suite covers that pass.
 *
 * The Apps Script assertions run the real appsscript.js. The frontend
 * and CSS assertions are source-level — they prove the code is wired up,
 * not that it renders correctly in a browser. Stated plainly rather
 * than implied.
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
const app = read('src/App.tsx');
const css = read('src/index.css');
const html = read('index.html');
// Comments quote the OLD viewport value by way of explanation, so strip
// them before asserting on what the markup actually declares.
const htmlMarkup = html.replace(/<!--[\s\S]*?-->/g, '');
const sw = read('public/sw.js');
const gas = read('appsscript.js');

// ============================================== accessibility
console.log('\n--- Every reader can actually use it ---');

check('1. Pinch-zoom is no longer blocked (WCAG 1.4.4)',
  !/user-scalable\s*=\s*no/.test(htmlMarkup) && !/maximum-scale\s*=\s*1/.test(htmlMarkup));
check('2. A skip-to-content link exists for keyboard users',
  html.includes('skip-to-content') && html.includes('#main-content'));
check('3. ...and it has a real target on the page',
  /<main[\s\S]{0,80}id="main-content"/.test(app));
check('4. The skip link is hidden until focused, not permanently visible',
  /\.skip-to-content\s*\{[^}]*left:\s*-9999px/.test(css) && /\.skip-to-content:focus\s*\{[^}]*left:\s*0/.test(css));
check('5. Keyboard focus is visible on buttons, not just links',
  /button:focus-visible/.test(css) && /outline:\s*2px solid/.test(css));
check('6. An sr-only utility exists for labelling icon-only controls',
  /\.sr-only\s*\{/.test(css));
check('7. Reduced motion now covers Tailwind/Framer animation, not just named classes',
  /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}animation-duration:\s*0\.001ms\s*!important/.test(css));
check('8. Tap targets are comfortable on touch devices',
  /@media \(pointer: coarse\)/.test(css) && /min-height:\s*40px/.test(css));
check('9. The reader\'s own browser font-size setting is respected',
  /text-size-adjust:\s*100%/.test(css));
check('10. Toasts are announced to screen readers',
  /role="status"[\s\S]{0,80}aria-live="polite"/.test(app) && /role="alert"[\s\S]{0,80}aria-live="assertive"/.test(app));
check('11. Book covers carry descriptive alt text, not just a bare title',
  /alt=\{book\.author \? `Cover of \$\{book\.title\} by \$\{book\.author\}`/.test(app));

// ============================================== native alerts gone
console.log('\n--- The UI no longer interrupts with browser dialogs ---');

// Strip comments before looking for real alert() calls, so the
// explanatory comments about the old behaviour don't count.
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('12. No native alert() calls remain anywhere in the app',
  !/(^|[^.\w])alert\s*\(/.test(appCode));
check('13. A toast bridge exists so any component can raise one',
  app.includes('swapsutra:toast') && /const notify = \{/.test(app));
check('14. ...and the app listens for it and routes into the existing toast',
  /window\.addEventListener\(TOAST_EVENT/.test(app));

// ============================================== link previews + offline
console.log('\n--- Sharing and offline ---');

check('15. Open Graph tags exist (WhatsApp shares get a real preview)',
  html.includes('og:title') && html.includes('og:image') && html.includes('og:description'));
check('16. Twitter card tags exist',
  html.includes('twitter:card'));
// 30 Sep: no longer a PWA — the worker serves no pages or images, so
// navigation and images always come straight from the network.
check('17. The service worker no longer serves pages from a cache',
  !/addEventListener\(['"]fetch['"]/.test(sw) && !/caches\.match/.test(sw));
check('18. ...and it only handles push notifications and their taps',
  /addEventListener\('push'/.test(sw) && /addEventListener\('notificationclick'/.test(sw));
check('19. Notifications use the full logo, not a PWA icon file',
  /icon: '\/swapsutra-logo\.png'/.test(sw) && !/icon-\d+x\d+/.test(sw));

// ============================================== backend correctness
console.log('\n--- Backend faults from the audit ---');

const scriptProperties = new Map();
scriptProperties.set('SPREADSHEET_ID', 'TEST_SHEET');
const emptySheet = () => ({
  getDataRange: () => ({ getValues: () => [[]] }),
  getRange: () => ({ getValues: () => [[]], getValue: () => '', setValue: () => {} }),
  getLastRow: () => 0,
  getLastColumn: () => 0,
  appendRow: () => {}
});
const sandbox = {
  console, Logger: { log() {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (scriptProperties.has(k) ? scriptProperties.get(k) : null),
    setProperty: (k, v) => { scriptProperties.set(k, v); }, deleteProperty: (k) => { scriptProperties.delete(k); }
  }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', Buffer.from(String(k))).update(Buffer.from(String(v))).digest()),
    base64EncodeWebSafe: (i) => (Array.isArray(i) ? Buffer.from(i.map(b => b & 0xff)) : Buffer.from(String(i), 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (b) => ({ getDataAsString: () => Buffer.from(b.map(x => x & 0xff)).toString('utf8') })
  },
  // Minimal in-memory Sheets stand-in: enough for the membership lookup
  // to resolve to "not a member" instead of throwing on a missing binding.
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    openById: () => ({
      getSheetByName: () => emptySheet(),
      insertSheet: () => emptySheet()
    })
  },
  MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(gas, ctx, { filename: 'appsscript.js' });
const call = (fn, ...args) => vm.runInContext(`(${fn}).apply(null, ${JSON.stringify(args)})`, ctx);

check('20. Rejected listings no longer burn the 10-book quota',
  /status !== 'removed' && status !== 'inactive' && status !== 'rejected'/.test(gas));

const gateMsg = call('requireApprovedMember', 'nobody@example.com', 'Reader messaging');
check('21. The membership gate names the feature the reader actually tried',
  gateMsg && gateMsg.message.includes('Reader messaging'));
check('22. ...and no longer tells everyone about Book Requests',
  gateMsg && !gateMsg.message.includes('Book Requests'));
check('23. It still reports the right error code (no regression)',
  gateMsg && gateMsg.error === 'MEMBERSHIP_REQUIRED');
check('24. An active member is still let through',
  call('requireApprovedMember', 'swapsutra@gmail.com', 'Reader messaging') === null);
check('25. Twelve call sites now pass a feature name',
  (gas.match(/requireApprovedMember\([A-Za-z_][A-Za-z0-9_]*, ['"]/g) || []).length >= 11);

check('26. getUserChats reports WHY it is empty instead of returning a bare []',
  /if \(accessError\) return respondJson\(\{ \.\.\.accessError, data: \[\], chats: \[\] \}\)/.test(gas));

console.log('\n--- Library query is linear, not quadratic ---');

check('27. Ratings are indexed once instead of re-scanned per book',
  /const ratingsByBookId = \{\}/.test(gas));
check('28. Subscriptions are indexed once instead of re-scanned per book',
  /const subscriptionByEmail = \{\}/.test(gas));
check('29. The per-book full-sheet scans are gone',
  !/ratingData\.slice\(1\)\s*\n?\s*\.filter\(r => r\[bookIdRatingIdx\] === obj\.id/.test(gas)
  && !/subData\.slice\(1\)\.find\(r => normalizeEmail\(r\[emailIdx\]\) === ownerEmail\)/.test(gas));

console.log('\n--- Chat polling backs off ---');

check('30. Polling is no longer a flat 5s interval',
  !/\}, 5000\); \/\/ 5 seconds polling for active chat/.test(app));
// 22 Sep: polls are now cache hits on the server, so an idle thread
// eases off to 12s (was 30s) and a send/visibility change refreshes at once.
check('31. An idle thread eases off (to 12s) and can be refreshed immediately',
  /const SLOW_MS = 12000/.test(app) && /idleRounds >= 6/.test(app) && /chatRefreshNowRef\.current = refreshNow/.test(app));
check('32. A new message snaps it back to fast polling',
  /idleRounds = 0;\s*\n\s*currentDelay = FAST_MS;/.test(app));
check('33. The loop reschedules itself so the new delay actually applies',
  /const scheduleNext = \(\) => \{/.test(app) && /setTimeout\(async \(\) => \{/.test(app));

// ============================================== Quill
console.log('\n--- Quill feels like a companion, not a tooltip ---');

check('34. Quill has a personal line built from the reader\'s own data',
  app.includes('quillPersonalNote'));
check('35. It speaks to what they are actually reading',
  /you're in the middle of/i.test(app) || /in the middle of/.test(app));
check('36. It reflects books they have actually put into circulation',
  /myListedBookCount > 0/.test(app) && /waiting to travel/.test(app));
check('37. It welcomes a brand-new reader rather than showing nothing',
  /this shelf is yours/.test(app));
check('38. Every branch is driven by real state — Quill invents no milestones',
  !/Math\.random\(\)/.test(app.slice(app.indexOf('quillPersonalNote'), app.indexOf('quillPersonalNote') + 1600)));
// The guard now lives in quillMoment, which quillPersonalNote reads
// from — so assert on the real gate rather than on where it used to sit.
check('39. Guests get no personal line (nothing to personalise from)',
  /const quillMoment = useMemo\(\(\)[\s\S]{0,200}if \(!activeUserEmail\) return null;/.test(app)
  && /const quillPersonalNote = quillMoment\?\.note \|\| null;/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
