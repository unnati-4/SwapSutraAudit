/**
 * test_cafe_visual_polish.cjs
 *
 * The Café was rebuilt to match a design mockup: brand header, pinned
 * house note, per-speaker colours and avatars, reaction chips, @mention
 * marks, a composer pill.
 *
 * Most of that is styling. Two parts are NOT — reactions and the pinned
 * note both need real storage — and those run against the real
 * appsscript.js here.
 *
 * The other half of this suite is about what was deliberately NOT built.
 * The mockup shows a phone icon, a video icon, "12 online", double-tick
 * read receipts and a voice-note button. The calls were excluded by the
 * owner; the other three have no data behind them in this stack, and a
 * control that reports a number nobody measured is worse than an absent
 * one. These assertions exist so nobody adds them back by eye.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const gas = read('appsscript.js');
const app = read('src/App.tsx');
const cafe = read('src/components/ReadersCafe.tsx');
const css = read('src/index.css');

// Comment-stripped source. Several assertions below are of the form
// "this word must NOT appear", and the comments explaining WHY it must
// not appear contain that very word. Asserting against the prose rather
// than the code has produced false failures repeatedly in this suite —
// so absence checks run against code only.
const cafeCode = cafe.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CAFE_ID = 'SS_READERS_CAFE';
const MSG_HEADERS = ['message_id', 'circle_id', 'user_id', 'user_name', 'message', 'is_spoiler', 'created_at', 'image_url'];
const SUB_HEADERS = ['id', 'name', 'email', 'userEmail', 'adminStatus', 'paymentRequired',
  'membershipType', 'subscriptionStartDate', 'subscriptionExpiry', 'paymentStatus'];
const RX_HEADERS = ['reaction_id', 'message_id', 'user_id', 'emoji', 'created_at'];

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (o) => new Date(now + o).toISOString();
const memberStart = new Date(now - 10 * DAY).toISOString();
const memberExpiry = new Date(now + 80 * DAY).toISOString();

function makeSheet(headers, rows) {
  const data = [headers.slice(), ...rows.map(r => r.slice())];
  return {
    __rows: data,
    getDataRange: () => ({ getValues: () => data }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = r - 1; i < r - 1 + (nr || 1); i++) out.push((data[i] || []).slice(c - 1, c - 1 + (nc || 1)));
        return out;
      },
      getValue: () => ((data[r - 1] || [])[c - 1] || ''),
      setValue: (v) => { if (data[r - 1]) data[r - 1][c - 1] = v; }
    }),
    getLastRow: () => data.length,
    getLastColumn: () => headers.length,
    appendRow: (row) => data.push(row.slice()),
    deleteRow: (r) => data.splice(r - 1, 1),
    deleteRows: (r, n) => data.splice(r - 1, n)
  };
}

const sheets = {
  current_read_messages: makeSheet(MSG_HEADERS, [
    ['MSG_A', CAFE_ID, 'aarav@example.com', 'Aarav Menon', 'Just finished The Midnight Library.', 'FALSE', iso(-3600000), ''],
    ['MSG_B', CAFE_ID, 'meera@example.com', 'Meera Nair', 'What would you read again for the first time?', 'FALSE', iso(-1800000), '']
  ]),
  Subscriptions: makeSheet(SUB_HEADERS, [
    ['S1', 'Aarav Menon', 'aarav@example.com', 'aarav@example.com', 'Approved', 'Yes', 'premium', memberStart, memberExpiry, 'Paid'],
    ['S2', 'Meera Nair', 'meera@example.com', 'meera@example.com', 'Approved', 'Yes', 'premium', memberStart, memberExpiry, 'Paid'],
    ['S3', 'Rohan Das', 'rohan@example.com', 'rohan@example.com', 'Approved', 'Yes', 'premium', memberStart, memberExpiry, 'Paid']
  ]),
  cafe_reactions: makeSheet(RX_HEADERS, []),
  current_read_circles: makeSheet(['circle_id', 'book_title', 'normalized_book_title', 'author', 'normalized_author', 'cover_url', 'status', 'created_by_user_id', 'created_at', 'updated_at'], []),
  current_read_members: makeSheet(['member_id', 'circle_id', 'user_id', 'user_name', 'reading_progress', 'format', 'note', 'joined_at'], [])
};

const props = new Map([['SPREADSHEET_ID', 'TEST']]);
const sandbox = {
  console, Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      getProperties: () => { const o = {}; props.forEach((v, k) => { o[k] = v; }); return o; },
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k)
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
    getActiveSpreadsheet: () => null,
    openById: () => ({
      getSheetByName: (n) => sheets[n] || null,
      insertSheet: (n) => (sheets[n] = makeSheet([], [])),
      getSheets: () => Object.values(sheets)
    })
  },
  MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(gas, ctx, { filename: 'appsscript.js' });
const run = (e) => vm.runInContext(e, ctx);
const call = (fn, ...a) => vm.runInContext(`(${fn}).apply(null, ${JSON.stringify(a)})`, ctx);

function signIn(email) {
  run('resetRequestIdentity()');
  const token = call('createSessionToken', email, 'member');
  call('establishRequestIdentity', { sessionToken: token });
}
const signOut = () => run('resetRequestIdentity()');

// =====================================================================
console.log('\n--- Reactions are real, not decoration ---');

signOut();
const anon = call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '❤️' });
check('1. A signed-out visitor cannot react',
  anon.success === false && anon.error === 'SESSION_REQUIRED');

signIn('aarav@example.com');
const bad = call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '💀' });
check('2. Only the allowlisted emoji are accepted',
  bad.success === false && bad.error === 'REACTION_NOT_ALLOWED');
check('3. ...which matters because this is a public page, not a private chat',
  /CAFE_REACTION_CHOICES/.test(gas) && run('CAFE_REACTION_CHOICES').length === 6);

const first = call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '❤️' });
check('4. A member can react',
  first.success === true && first.reactions[0].emoji === '❤️' && first.reactions[0].count === 1);
check('5. ...and is told it is theirs, so the chip can show as pressed',
  first.reactions[0].mine === true);

signIn('meera@example.com');
const second = call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '❤️' });
check('6. A second reader adds to the same count',
  second.reactions[0].count === 2);

signIn('aarav@example.com');
const off = call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '❤️' });
check('7. THE TOGGLE: tapping again removes only your own',
  off.reactions[0].count === 1);
check('8. ...and it is no longer marked as yours',
  off.reactions[0].mine === false);

const again = call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '❤️' });
check('9. Reacting twice cannot stack a count',
  again.reactions[0].count === 2);

call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '🔥' });
call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '📚' });
const capped = call('toggleCafeReaction', { messageId: 'MSG_A', emoji: '😮' });
check('10. One reader cannot paper a message in emoji',
  capped.success === false && capped.error === 'REACTION_LIMIT_REACHED');

signOut();
const wall = call('getReadersCafe', {});
const msgA = wall.data.find(m => m.message_id === 'MSG_A');
check('11. Reactions come back with the room, in one read',
  Array.isArray(msgA.reactions) && msgA.reactions.length === 3);
check('12. ...sorted so the loudest reaction leads',
  msgA.reactions[0].count >= msgA.reactions[1].count);
check('13. WHO reacted is never published — only how many',
  !JSON.stringify(wall.data).includes('@'));
check('14. A visitor is not told any reaction is theirs',
  msgA.reactions.every(r => r.mine === false));

signIn('meera@example.com');
const mineView = call('getReadersCafe', {}).data.find(m => m.message_id === 'MSG_A');
check('15. A signed-in reader IS told which are theirs',
  mineView.reactions.find(r => r.emoji === '❤️').mine === true);

const missing = call('toggleCafeReaction', { emoji: '❤️' });
check('16. A reaction with no message is refused',
  missing.success === false && missing.error === 'MESSAGE_NOT_FOUND');

// =====================================================================
console.log('\n--- The pinned note is the owner\'s, or it is absent ---');

signOut();
check('17. With nothing configured there is no pinned bar at all',
  call('getReadersCafe', {}).pinnedMessage === '');
check('18. ...rather than placeholder text pretending to be a house rule',
  !/Welcome to Readers Café/.test(gas));

props.set('CAFE_PINNED_MESSAGE', 'Be kind. Flag your spoilers.');
signOut();
check('19. The owner sets it from Script Properties, no redeploy',
  call('getReadersCafe', {}).pinnedMessage === 'Be kind. Flag your spoilers.');
props.set('CAFE_PINNED_MESSAGE', 'x'.repeat(900));
signOut();
check('20. An over-long note is trimmed rather than swallowing the room',
  call('getReadersCafe', {}).pinnedMessage.length === 400);
props.delete('CAFE_PINNED_MESSAGE');
signOut();

// =====================================================================
console.log('\n--- What the mockup showed that would have been FAKE ---');

check('21. No phone-call control (the owner ruled it out)',
  !/aria-label="[^"]*call/i.test(cafeCode));
check('22. No video-call control either',
  !/VideoIcon|aria-label="[^"]*video/i.test(cafeCode));
check('23. No "N online" — nothing here tracks presence, so it would be invented',
  !/online/i.test(cafeCode));
check('24. The backend says so too, where the count is produced',
  /NOT "online now"/.test(gas));
check('25. The subtitle reports readers who have actually SPOKEN',
  /readers' : 'reader'/.test(cafe) || /at the table/.test(cafe));
check('26. No delivery ticks — no delivery is tracked',
  !/DoubleCheck|read-receipt|✓✓/.test(cafeCode));
check('27. No voice-note button — there is no backend for one',
  !/MicIcon|aria-label="[^"]*voice/i.test(cafeCode));

// =====================================================================
console.log('\n--- The look itself ---');

check('28. The header carries the SwapSutra mark',
  /cafe-room__mark[\s\S]{0,120}swapsutra-logo\.png/.test(cafe));
check('29. Every speaker gets a stable colour, derived from their name',
  /export function speakerColour/.test(cafe) && /hash \* 31 \+ raw\.charCodeAt/.test(cafe));
check('30. ...so a reader is the same colour every time, not per position',
  /SPEAKER_COLOURS\[hash % SPEAKER_COLOURS\.length\]/.test(cafe));
check('31. Six hues, far enough apart to tell apart',
  (cafe.match(/\{ name: '#[0-9A-Fa-f]{6}', seat: '#[0-9A-Fa-f]{6}' \}/g) || []).length === 6);
check('32. Avatars are tinted with the same hue as the name',
  /style=\{\{ background: hue\.seat, color: hue\.name \}\}/.test(cafe));
check('33. Avatars sit beside the NAME, not down by the timestamp',
  /\.cafe-line \{[\s\S]{0,320}align-items: flex-start/.test(css));
check('34. The grouped indent matches the avatar column exactly',
  /\.cafe-line--grouped:not\(\.cafe-line--mine\) \{ padding-left: 2\.6rem; \}/.test(css));

check('35. The wallpaper is drawn, not a photograph',
  /data:image\/svg\+xml/.test(css) && !/background-image:[^;]*\.(jpg|jpeg|png|webp)/.test(css));
check('36. ...so it costs about a kilobyte instead of hundreds',
  (css.match(/data:image\/svg\+xml[^"]+/) || [''])[0].length < 3000);
check('37. It is faint enough not to fight the text',
  /stroke-opacity='0\.1/.test(css));

check('38. Reaction chips render under the bubble they belong to',
  /cafe-reacts/.test(cafe) && /\.cafe-reacts \{/.test(css));
check('39. Your own reaction is visibly yours',
  /cafe-react\$\{r\.mine \? ' is-mine' : ''\}/.test(cafe) && /\.cafe-react\.is-mine \{/.test(css));
check('40. ...and announced as pressed, not just coloured',
  /aria-pressed=\{r\.mine\}/.test(cafe));
check('41. The picker only offers what the backend will accept',
  /choices\.map\(e =>/.test(cafe) && /reactionChoices/.test(cafe));
check('42. Reactions vanish entirely if the handler is not wired',
  /const canReact = Boolean\(onToggleReaction\) && canSpeak/.test(cafe));

check('43. A spoiler is flagged on the bubble, not only blurred',
  /cafe-bubble__flag/.test(cafe) && /\.cafe-bubble__flag \{/.test(css));
check('44. @mentions are marked so being spoken to is visible',
  /export function renderMessageText/.test(cafe) && /cafe-bubble__mention/.test(css));
check('45. ...without letting a message inject markup',
  !/dangerouslySetInnerHTML/.test(cafe));

check('46. The composer is one pill with the controls inside it',
  /cafe-compose__pill/.test(cafe) && /\.cafe-compose__pill \{/.test(css));
check('47. The pinned note collapses to a line until asked',
  /\.cafe-pinned__text \{[\s\S]{0,400}white-space: nowrap/.test(css)
  && /\.cafe-pinned\.is-open \.cafe-pinned__text \{ white-space: normal/.test(css));
check('48. The overflow menu holds real actions, not decoration',
  /Refresh the room/.test(cafe) && /Jump to latest/.test(cafe));

// =====================================================================
console.log('\n--- The client keeps its optimism honest ---');

check('49. A tap updates the chip immediately',
  /reactions: \[\.\.\.m\.reactions, \{ emoji, count: 1, mine: true \}\]/.test(app)
  && /const handleToggleCafeReaction = useCallback/.test(app));
check('50. ...and the server\'s counts overwrite the guess when they land',
  /Replace the optimistic guess with what the sheet actually holds/.test(app));
check('51. A refused reaction re-reads the room rather than leaving a wrong number',
  /notify\.error\(data\?\.message \|\| 'That reaction did not stick\.'\)[\s\S]{0,80}await fetchCafe\(true\)/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
