/**
 * test_readers_cafe.cjs
 *
 * The Reader's Café — SwapSutra's permanent community table.
 *
 * The Apps Script half runs the REAL appsscript.js against an in-memory
 * Sheets stand-in, so the guest-read / member-write rules and the "no
 * second chat system" claim are actually executed. The React half is
 * source-level. The café's appearance was reviewed separately by
 * rendering it in headless Chromium against the real stylesheet, at
 * desktop and at a true 390px column — that is visual review, which a
 * test cannot stand in for.
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
const css = read('src/index.css');

// ---------------------------------------------------------------------
// A tiny in-memory Sheets stand-in, so the real backend can be exercised.
// ---------------------------------------------------------------------
const CAFE_ID = 'SS_READERS_CAFE';
const MSG_HEADERS = ['message_id', 'circle_id', 'user_id', 'user_name', 'message', 'is_spoiler', 'created_at', 'image_url'];

function makeSheet(headers, rows) {
  const data = [headers.slice(), ...rows.map(r => r.slice())];
  return {
    __rows: data,
    getDataRange: () => ({ getValues: () => data }),
    getRange: () => ({ getValues: () => data, getValue: () => '', setValue: () => {} }),
    getLastRow: () => data.length,
    getLastColumn: () => headers.length,
    appendRow: (row) => { data.push(row.slice()); }
  };
}

const sheets = {
  current_read_messages: makeSheet(MSG_HEADERS, [
    ['CRMSG_1', CAFE_ID, 'meera@example.com', 'Meera Nair', 'Finished it last night.', 'FALSE', '2026-08-20T10:00:00Z', ''],
    ['CRMSG_2', CAFE_ID, 'arjun@example.com', 'Arjun Rao', 'Anyone read Dholavira?', 'FALSE', '2026-08-21T10:00:00Z', ''],
    ['CRMSG_3', 'CIRCLE_PRIVATE', 'meera@example.com', 'Meera Nair', 'Private circle chatter.', 'FALSE', '2026-08-21T11:00:00Z', '']
  ])
};

const scriptProperties = new Map([['SPREADSHEET_ID', 'TEST']]);
const blank = () => makeSheet([], []);
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
    newBlob: (b) => ({ getDataAsString: () => Buffer.from(b.map(x => x & 0xff)).toString('utf8') })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    openById: () => ({
      getSheetByName: (name) => sheets[name] || null,
      insertSheet: (name) => (sheets[name] = blank())
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

// ============================================== no duplicate systems
console.log('\n--- It reuses the circle chat, it does not duplicate it ---');

check('1. The Café is a reserved circle id, not a new concept',
  run('READERS_CAFE_CIRCLE_ID') === CAFE_ID);
check('2. Messages live in the SAME current_read_messages sheet',
  /getReadersCafe[\s\S]{0,600}getCurrentReadRows\(\)/.test(gas));
check('3. No new sheet or header set was introduced for the Café',
  !/CAFE_MESSAGE_HEADERS|readers_cafe_messages|cafe_messages/.test(gas));
check('4. Sending reuses the existing addCircleMessage action',
  /action: 'addCircleMessage'[\s\S]{0,160}circle_id: READERS_CAFE_CIRCLE_ID/.test(app));
check('5. The frontend defines no second send action',
  !/action: 'addCafeMessage'|action: 'sendCafeMessage'/.test(app));

// ============================================== guest can read
console.log('\n--- A visitor can read the room ---');

check('6. getReadersCafe needs no session',
  run('requireSessionForAction("getReadersCafe")') === null);

run('resetRequestIdentity()');
const guestView = call('getReadersCafe', {});
check('7. A signed-out visitor gets the conversation',
  guestView.success === true && guestView.data.length === 2);
check('8. ...in chronological order',
  guestView.data[0].message === 'Finished it last night.'
  && guestView.data[1].message === 'Anyone read Dholavira?');
check('9. ...with a life signal (how many readers have spoken)',
  guestView.readerCount === 2 && guestView.totalMessages === 2);
check('10. ...and a preview of the newest message for the homepage',
  guestView.lastMessagePreview === 'Anyone read Dholavira?' && guestView.lastMessageBy === 'Arjun');

console.log('\n--- ...but the room never leaks who is in it ---');

check('11. No email address reaches a public reader',
  !JSON.stringify(guestView.data).includes('@'));
check('12. Only first names are published',
  guestView.data.every(m => m.user_name && !m.user_name.includes(' ')));
check('13. Private circle messages never appear in the Café',
  !JSON.stringify(guestView.data).includes('Private circle chatter'));
check('14. getCircleMessages is deliberately NOT public (it would expose every circle)',
  run('requireSessionForAction("getCircleMessages")')?.error === 'SESSION_REQUIRED');

// ============================================== guest cannot speak
console.log('\n--- A visitor cannot speak ---');

run('resetRequestIdentity()');
check('15. Posting requires a session',
  run('requireSessionForAction("addCircleMessage")')?.error === 'SESSION_REQUIRED');

const strangerPost = call('addCircleMessage', {
  circle_id: CAFE_ID, user_id: 'stranger@example.com', user_name: 'Stranger', message: 'Hello?'
});
check('16. A signed-in-but-not-a-member caller is refused',
  strangerPost.success === false && strangerPost.error === 'MEMBERSHIP_REQUIRED');
check('17. ...with a message naming the Café, not some other feature',
  String(strangerPost.message).includes("Reader's Café"));
check('18. The refused message was never written to the sheet',
  !JSON.stringify(sheets.current_read_messages.__rows).includes('Hello?'));

// ============================================== member can speak
console.log('\n--- A member speaks immediately, with no join step ---');

const before = sheets.current_read_messages.__rows.length;
const memberPost = call('addCircleMessage', {
  circle_id: CAFE_ID, user_id: 'swapsutra@gmail.com', user_name: 'SwapSutra Admin', message: 'Morning, all.'
});
check('19. An active member posts successfully',
  memberPost.success === true);
check('20. ...and the message is genuinely persisted',
  sheets.current_read_messages.__rows.length === before + 1
  && JSON.stringify(sheets.current_read_messages.__rows).includes('Morning, all.'));
check('21. It lands in the Café, not in some other circle',
  sheets.current_read_messages.__rows[before][1] === CAFE_ID);
check('22. Nobody ever "joins" — no members row is required or created',
  !/isCurrentReadMember\([^)]*\)[\s\S]{0,80}READERS_CAFE/.test(gas)
  && /if \(isCafe\) \{[\s\S]{0,400}requireApprovedMember/.test(gas));
check('23. No join action exists for the Café anywhere in the UI',
  !/Join (the )?(Chat|Caf)/i.test(app) && !/Join (the )?Caf/i.test(cafe));

console.log('\n--- The Café is ambient, not a mailing list ---');

// Only @mentions notify (see test_notifications_badges_cafe.cjs); the
// circle mailer is never used for the café.
check('24. Posting there does not mail every member — only @mentioned readers hear about it',
  /isCafe\s*\?\s*notifyCafeMentions_\(/.test(gas) && /CAFE_MENTION_MAX_RECIPIENTS = 10/.test(gas));
check('25. ...but it still counts toward the real Bookish Confidant activity',
  /logReaderActivity\([\s\S]{0,200}isCafe \? "Reader's Café"/.test(gas));

// ============================================== circles untouched
console.log('\n--- Current Read Circles still work exactly as before ---');

const circlePost = call('addCircleMessage', {
  circle_id: 'CIRCLE_PRIVATE', user_id: 'stranger@example.com', user_name: 'Stranger', message: 'Let me in'
});
check('26. A non-member still cannot post to a real circle',
  circlePost.success === false && /Only circle members/.test(String(circlePost.message)));
check('27. The circle membership check is still present and unchanged',
  /if \(!isCurrentReadMember\(circleId, userId, rows\.members\)\) \{[\s\S]{0,120}Only circle members can send messages/.test(gas));
check('28. The ended/archived circle guard survives',
  /This Readers Circle has ended\. New messages are disabled\./.test(gas));
check('29. Circle reads still require membership',
  /Only circle members can view messages/.test(gas));

// ============================================== frontend behaviour
console.log('\n--- The room in the app ---');

check('30. The Café route is public so a visitor can walk in',
  /GATE_ALLOWED_TABS: AppTab\[\] = \[[^\]]*'cafe'/.test(app));
check('31. It has a real URL',
  /'\/readers-cafe': 'cafe'/.test(app) && /'\/chat': 'cafe'/.test(app) && /cafe: '\/chat'/.test(app));
check('32. Speaking is gated on ordinary SwapSutra membership, not a café membership',
  /canSpeak=\{isRegisteredMember\}/.test(app));
check('33. The composer only exists for someone who may speak',
  /\{canSpeak \? \(/.test(cafe));
check('34. A visitor is offered a chair, warmly',
  cafe.includes('Pull up a chair. Become a SwapSutra reader to join the conversation.')
  && cafe.includes('Register to join'));
check('35. It is never called "General Chat"',
  !/General Chat/i.test(app) && !/General Chat/i.test(cafe));
check('36. It is discoverable from the nav, not buried',
  /navigateTo\('cafe'\)/.test(app));
// The homepage entry point went when the Home page itself was retired on
// 20 Sep 2026. The Café now has a permanent slot in the phone's bottom bar
// and its own line in the menu, which is a steadier door than a card on a
// page nobody lands on any more.
check('37. The Café has a permanent place in the bottom navigation',
  /key: 'chat' as const, label: 'Chat', icon: Icons\.MessageCircle/.test(app));
// 22 Sep: the owner asked for bottom-bar destinations to be dropped from
// the ☰ menu, so the Café lives only on the bar now.
check('38. ...and is not repeated in the ☰ menu',
  !/\{ id: 'cafe', label: `Reader's Café/.test(app));

console.log('\n--- Reused from the circle chat, not reinvented ---');

check('39. Same spoiler blur-and-reveal mechanic, now flagged on the bubble too',
  /cafe-bubble__spoiler/.test(cafe) && /Tap to reveal/.test(cafe)
  && /cafe-bubble__flag/.test(cafe));
check('40. Same first-name + initial-avatar identity',
  /firstName\.charAt\(0\)/.test(cafe));
check('41. Polling only while the reader is in the room and the tab is visible',
  /if \(activeTab !== 'cafe'\) return;/.test(app) && /document\.visibilityState === 'visible'/.test(app));

console.log('\n--- States feel intentional ---');

check('42. Loading shows chat-shaped skeletons, not a spinner',
  /sk cafe-bubble cafe-bubble--ghost/.test(cafe));
check('43. Empty invites the first voice rather than saying "no messages"',
  /The first chair is yours/.test(cafe));
check('44. Errors offer a way back in',
  /The café is quiet for a moment/.test(cafe) && /Try the door again/.test(cafe));

console.log('\n--- Accessible and responsive ---');

check('45. The conversation is a live region a screen reader can follow',
  /role="log"/.test(cafe) && /aria-live="polite"/.test(cafe));
check('46. The scrollback is keyboard reachable',
  /tabIndex=\{0\}/.test(cafe));
check('47. The composer has a real label',
  /htmlFor="cafe-draft"/.test(cafe) && /id="cafe-draft"/.test(cafe));
check('48. Autoscroll never yanks a reader away from what they are reading',
  /stickToBottom/.test(cafe));
check('49. The room has a mobile layout of its own',
  /@media \(max-width: 768px\)[\s\S]{0,320}\.cafe-room \{/.test(css));
check('50. It cannot push the page sideways on a narrow phone',
  /\.cafe-room \{[\s\S]{0,320}max-width: 100%/.test(css));

console.log('\n--- It reads as a café, not a messaging app ---');

// The room's ground moved from a flat gradient on the container to a
// drawn wallpaper behind the conversation — an SVG tile, not a photo, so
// it stays about a kilobyte and follows the theme instead of baking one
// light temperature into it.
check('51. The conversation sits on a drawn wallpaper, still lit from above',
  /radial-gradient\(120% 70% at 50% 0%/.test(css)
  && /data:image\/svg\+xml/.test(css)
  && !/\.jpg|\.png\)/.test(css.slice(css.indexOf('.cafe-room__log {'), css.indexOf('.cafe-room__log {') + 1800)));
check('52. No hardcoded colours — the room follows day/night',
  !/#[0-9A-Fa-f]{6}/.test(css.slice(css.indexOf('.cafe-room {'), css.indexOf('.cafe-room {') + 4000)));
check('53. Serif headings, bookish microcopy',
  /cafe-room__title[\s\S]{0,200}var\(--font-(serif|display)\)/.test(css)
  && cafe.includes('There\u2019s always a book being discussed'));
// NOTE — a deliberate reversal. The café was originally specified as
// "not like Discord, WhatsApp, Telegram or a generic social-media chat",
// and these two checks used to assert that no bubble styling existed.
// The owner has since asked for exactly the opposite: "it should look
// just like whatsapp message chat screen". The messaging ERGONOMICS are
// now adopted — bubbles, sides, day dividers, an emoji key — while the
// paper, the lamp, the serif and the palette stay SwapSutra's, which is
// what checks 51-53 above still hold the line on.
const cafeCss = css.slice(css.indexOf('.cafe-room {')).replace(/\/\*[\s\S]*?\*\//g, '');
check('54. Messages are bubbles, and a reader\'s own sit on their own side',
  /\.cafe-bubble \{/.test(cafeCss) && /\.cafe-bubble--mine \{/.test(cafeCss)
  && /\.cafe-line--mine \{[\s\S]{0,80}justify-content: flex-end/.test(cafeCss));
check('55. Which side a bubble takes comes from the server, not from a name match',
  /isMine: m\.is_mine === true \|\| m\.isMine === true/.test(cafe)
  && /cafe-line--mine/.test(cafe));


// ============================================== BUG: no send button
console.log('\n--- BUG: the send button never rendered for real members ---');

check('56. THE BUG: the composer is no longer gated on the weak isListerActive flag',
  !/canSpeak=\{Boolean\(activeUserEmail\) && \(isListerActive \|\| isAdmin\)\}/.test(app));
check('57. It now uses the backend-verified membership check the rest of the app uses',
  /canSpeak=\{isRegisteredMember\}/.test(app));
check('58. ...which is exactly "active trial, premium, or admin"',
  /const isRegisteredMember = useMemo[\s\S]{0,260}userTier === 'trial' \|\| userTier === 'premium'/.test(app));
check('59. A send button genuinely exists in the composer',
  /type="submit"[\s\S]{0,300}className="cafe-compose__send"/.test(cafe)
  && /aria-label=\{sending \? 'Sending your message' : 'Send'\}/.test(cafe));
check('60. It is disabled on an empty draft rather than silently doing nothing',
  /disabled=\{!draft\.trim\(\) \|\| sending\}/.test(cafe));
check('61. Enter sends and Shift+Enter breaks the line, as every chat does',
  /e\.key === 'Enter' && !e\.shiftKey/.test(cafe) && /e\.preventDefault\(\)/.test(cafe));

console.log('\n--- The invitation tells the truth about WHY you cannot speak ---');

check('62. Three distinct reasons are handled, not one catch-all',
  /inviteReason\?: 'guest' \| 'pending' \| 'expired'/.test(cafe));
// Oct 2026: 'expired' now only means a paused (cancelled) account, and
// joining is free.
check('63. A paused member is told their chair is still there',
  /Your chair is still here\. Your account is paused/.test(cafe));
check('64. A registered-but-not-yet-joined reader is offered joining',
  /Almost in\. Join and the table is yours\./.test(cafe));
check('65. A true visitor gets the register invitation',
  /Pull up a chair\. Become a SwapSutra reader to join the conversation\./.test(cafe));
check('66. The app passes the real reason from userTier',
  /inviteReason=\{!activeUserEmail \? 'guest' : \(userTier === 'expired' \? 'expired' : 'pending'\)\}/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
