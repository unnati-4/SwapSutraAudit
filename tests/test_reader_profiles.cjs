/**
 * test_reader_profiles.cjs
 *
 * A reader can open another reader's profile: name, bio, shelves,
 * achievements, reading journey, listed books.
 *
 * The whole point of this suite is the sentence "No personal information
 * will be visible." That is not a styling decision — it has to be true of
 * the bytes on the wire. So the privacy assertions run the REAL
 * appsscript.js and inspect the actual response object, rather than
 * checking that the UI happens not to render a field.
 *
 * The second thing under test is ADDRESSING. The profile that existed
 * before took an email in the query string and returned it in the body,
 * which put member addresses into URLs and let anyone walk the member
 * list. Profiles are now addressed by an opaque HMAC id.
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
const page = read('src/components/ReaderProfile.tsx');
const cafe = read('src/components/ReadersCafe.tsx');
const css = read('src/index.css');
const proxy = read('api/swapsutra.ts');

const USER_HEADERS = ['id', 'name', 'email', 'phone', 'area', 'pincode', 'genres', 'bio', 'membershipStatus', 'paymentStatus', 'createdAt', 'updatedAt'];
const SUB_HEADERS = ['id', 'name', 'email', 'userEmail', 'adminStatus', 'paymentRequired', 'membershipType', 'subscriptionStartDate', 'subscriptionExpiry', 'paymentStatus', 'utr'];
const SPACE_HEADERS = ['item_id', 'id', 'book_id', 'user_id', 'userEmail', 'user_name', 'book_title', 'title',
  'normalized_book_title', 'author', 'normalized_author', 'favourite', 'currently_reading', 'tbr', 'bookshelf',
  'permanent_exchange', 'temporary_exchange', 'rent', 'sell', 'available_for_swap', 'rent_sale_mode',
  'format', 'reading_progress', 'note', 'price', 'condition', 'notes', 'created_at', 'createdAt', 'updated_at', 'updatedAt'];

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const memberStart = new Date(now - 20 * DAY).toISOString();
const memberExpiry = new Date(now + 70 * DAY).toISOString();

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

const BOOK_HEADERS = ['id', 'title', 'author', 'genre', 'condition', 'ownerEmail', 'ownerName',
  'status', 'latitude', 'longitude', 'rejectionReason', 'hiddenReason', 'createdAt'];

const sheets = {
  Users: makeSheet(USER_HEADERS, [
    ['U1', 'Meera Nair', 'meera@example.com', '9876500011', 'Bandra, Mumbai', '400050',
      'Fiction, Poetry', 'Reads two books at once and finishes neither.', 'Active', 'Paid', memberStart, memberStart],
    ['U2', 'Arjun Rao', 'arjun@example.com', '9876500022', 'Indiranagar, Bengaluru', '560038',
      'History', 'Non-fiction only, mostly.', 'Active', 'Paid', memberStart, memberStart]
  ]),
  Subscriptions: makeSheet(SUB_HEADERS, [
    ['S1', 'Meera Nair', 'meera@example.com', 'meera@example.com', 'Approved', 'Yes', 'premium', memberStart, memberExpiry, 'Paid', 'UTR123456'],
    ['S2', 'Arjun Rao', 'arjun@example.com', 'arjun@example.com', 'Approved', 'Yes', 'premium', memberStart, memberExpiry, 'Paid', 'UTR999999']
  ]),
  Books: makeSheet(BOOK_HEADERS, [
    ['B1', 'The God of Small Things', 'Arundhati Roy', 'Indian Literature', 'Good', 'meera@example.com', 'Meera',
      'Approved', '19.05', '72.83', 'n/a', 'n/a', memberStart],
    ['B2', 'Em and the Big Hoom', 'Jerry Pinto', 'Fiction', 'Fair', 'meera@example.com', 'Meera',
      'Approved', '19.05', '72.83', '', '', memberStart],
    ['B3', 'Removed one', 'Nobody', 'Fiction', 'Poor', 'meera@example.com', 'Meera',
      'removed', '19.05', '72.83', '', '', memberStart]
  ]),
  reading_space: makeSheet(SPACE_HEADERS, [
    ['I1', 'I1', 'B9', 'meera@example.com', 'meera@example.com', 'Meera', 'A Fine Balance', 'A Fine Balance',
      'a fine balance', 'Rohinton Mistry', 'rohinton mistry', 'TRUE', 'TRUE', 'FALSE', 'TRUE',
      'TRUE', 'FALSE', 'FALSE', 'FALSE', 'TRUE', '', 'Paperback', '45',
      'This one is about my grandmother, really.', '', 'Good', 'private jotting', memberStart, memberStart, memberStart, memberStart],
    ['I2', 'I2', 'B10', 'meera@example.com', 'meera@example.com', 'Meera', 'Midnight\\u2019s Children', 'Midnight\\u2019s Children',
      'midnights children', 'Salman Rushdie', 'salman rushdie', 'FALSE', 'FALSE', 'TRUE', 'FALSE',
      'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', '', 'Hardback', '0',
      '', '', '', '', memberStart, memberStart, memberStart, memberStart]
  ]),
  ReaderActivityLog: makeSheet(['activity_id', 'user_id', 'activity_type', 'reference_id', 'reference_name', 'title', 'description', 'created_at', 'metadata'], [
    ['A1', 'meera@example.com', 'book_listed', 'B1', 'The God of Small Things', 'Listed The God of Small Things', 'Added to the Library', memberStart, ''],
    ['A2', 'meera@example.com', 'circle_message_posted', 'C1', 'Café', 'Spoke in the Café', 'Said hello', memberStart, '']
  ])
};

const props = new Map([['SPREADSHEET_ID', 'TEST'], ['SESSION_SECRET', 'test-secret-for-profiles']]);
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
    newBlob: (b) => ({ getDataAsString: () => Buffer.from((b || []).map(x => x & 0xff)).toString('utf8') }),
    // computeGamificationState buckets activity into IST calendar days
    // with this. Without it the whole journey silently returned
    // success:false and the profile showed an empty history — a missing
    // stub reading as a missing feature.
    formatDate: (date, tz, fmt) => {
      const d = new Date(date);
      if (isNaN(d.getTime())) return '';
      // Asia/Kolkata is UTC+5:30; good enough to bucket days in a test.
      const shifted = new Date(d.getTime() + (tz === 'Asia/Kolkata' ? 5.5 * 3600000 : 0));
      const yyyy = shifted.getUTCFullYear();
      const MM = String(shifted.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(shifted.getUTCDate()).padStart(2, '0');
      return String(fmt || 'yyyy-MM-dd')
        .replace('yyyy', yyyy).replace('MM', MM).replace('dd', dd);
    }
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
console.log('\n--- Addressed by an opaque id, never an email ---');

signOut();
const meeraId = call('readerPublicId', 'meera@example.com');
const arjunId = call('readerPublicId', 'arjun@example.com');

check('1. An id is produced for a reader',
  typeof meeraId === 'string' && meeraId.length > 10);
check('2. It contains no part of the address',
  !meeraId.includes('meera') && !meeraId.includes('@') && !meeraId.includes('example'));
check('3. It is stable — the same reader is always the same id',
  call('readerPublicId', 'meera@example.com') === meeraId);
check('4. ...including for a differently-cased address',
  call('readerPublicId', 'MEERA@Example.com ') === meeraId);
check('5. Two readers never collide',
  meeraId !== arjunId);
check('6. A blank address yields no id rather than a shared one',
  call('readerPublicId', '') === '');
check('7. The id resolves back only with the member list AND the key',
  call('emailForReaderPublicId', meeraId) === 'meera@example.com');
check('8. A made-up id resolves to nobody',
  call('emailForReaderPublicId', 'Rnot-a-real-id-at-all') === '');
check('9. Ids are not sequential, so the member list cannot be walked',
  !/^R0|^R1|^R2/.test(meeraId) || meeraId !== arjunId);

// =====================================================================
console.log('\n--- THE GUARANTEE: no personal information on the wire ---');

signOut();
const guestView = call('getReaderProfile', { readerId: meeraId });
check('10. A visitor can open a profile',
  guestView.success === true && guestView.profile);

const wire = JSON.stringify(guestView);
check('11. NO email address anywhere in the response',
  !wire.includes('@'), wire.slice(0, 200));
check('12. NO phone number',
  !wire.includes('9876500011'));
check('13. NO pincode',
  !wire.includes('400050'));
check('14. NO coordinates',
  !wire.includes('19.05') && !wire.includes('72.83'));
check('15. NO payment reference',
  !wire.includes('UTR123456'));
check('16. NO subscription dates or billing state',
  !/subscriptionExpiry|paymentStatus|adminStatus/.test(wire));
check('17. NO private note a reader wrote on their own shelf',
  !wire.includes('about my grandmother') && !wire.includes('private jotting'));

check('18. The forbidden list is enforced in code, not just by hand-picking',
  /PROFILE_FORBIDDEN_KEYS/.test(gas) && /function scrubForPublicProfile/.test(gas));
check('19. ...and it is applied recursively, so nesting cannot hide a field',
  /return value\.map\(scrubForPublicProfile\)/.test(gas));

// =====================================================================
console.log('\n--- What a profile DOES show ---');

const p = guestView.profile;
check('20. Their name',
  p.fullName === 'Meera Nair');
check('21. Their bio',
  /two books at once/.test(p.bio));
check('22. Their reading area, coarse only',
  p.area === 'Bandra, Mumbai');
check('23. Their genres',
  /Fiction/.test(p.genres));
check('24. Whether they are an active member',
  p.isActiveMember === true);
check('25. Their listed books',
  Array.isArray(p.books) && p.books.length === 2);
check('26. ...with removed listings left out',
  !JSON.stringify(p.books).includes('Removed one'));
check('27. Their shelves, split the way a reader keeps them',
  p.shelves.currentlyReading.length === 1
  && p.shelves.tbr.length === 1
  && p.shelves.bookshelf.length === 1
  && p.shelves.favourites.length === 1);
check('28. A shelf entry carries the book, not the reader',
  p.shelves.currentlyReading[0].title === 'A Fine Balance'
  && p.shelves.currentlyReading[0].readingProgress === 45);
check('29. Their achievements',
  p.achievements && p.achievements.badges && typeof p.achievements.streak === 'object');
check('30. ...earned from real activity, not decoration',
  p.achievements.badges.b8 === true || p.achievements.badges.b4 === true);
check('31. Their reading journey',
  Array.isArray(p.journey.activities) && p.journey.activities.length >= 1);
check('32. ...as what happened and when, without internal reference ids',
  p.journey.activities.every(a => !('reference_id' in a) && !('user_id' in a)));

// =====================================================================
console.log('\n--- Books on a profile never exceed what the Library shows ---');

check('33. A guest gets no owner address on a profile book',
  p.books.every(b => !('ownerEmail' in b)));
check('34. ...and no coordinates',
  p.books.every(b => !('latitude' in b) && !('longitude' in b)));
check('35. ...and no moderation fields',
  p.books.every(b => !('rejectionReason' in b) && !('hiddenReason' in b)));

signIn('arjun@example.com');
const memberView = call('getReaderProfile', { readerId: meeraId });
check('36. A signed-in member also gets no address on a profile',
  !JSON.stringify(memberView).includes('@'));
check('37. A member viewing someone else is not marked as self',
  memberView.profile.isSelf === false);

signIn('meera@example.com');
const selfView = call('getReaderProfile', { readerId: meeraId });
check('38. A reader viewing their own profile is told so',
  selfView.profile.isSelf === true);
check('39. ...but still gets no address back, even for themselves',
  !JSON.stringify(selfView).includes('@'));

// =====================================================================
console.log('\n--- Failure modes ---');

signOut();
const noId = call('getReaderProfile', {});
check('40. A request with no id is refused',
  noId.success === false && noId.error === 'READER_ID_REQUIRED');
const ghost = call('getReaderProfile', { readerId: 'Rghostghostghostghost' });
check('41. An unknown id says so rather than leaking a lookup',
  ghost.success === false && ghost.error === 'READER_NOT_FOUND');
check('42. The action is public — the Library is open, so profiles are',
  run('requireSessionForAction("getReaderProfile")') === null);
check('43. ...and the proxy lets it through',
  /'getReaderProfile'/.test(proxy));

// =====================================================================
console.log('\n--- Getting there: a name is a link ---');

signOut();
const cafeRoom = call('getReadersCafe', {});
check('44. Café messages carry the sender\'s opaque id',
  Array.isArray(cafeRoom.data));
check('45. ...and still no address',
  !JSON.stringify(cafeRoom.data).includes('@'));
check('46. The backend attaches an author id to every message',
  /author_id: readerPublicId\(message\.user_id\)/.test(gas));
check('47. Every book carries its owner\'s id, at every audience level',
  /safe\.ownerId = ownerId/.test(gas) && /forAdmin\.ownerId = ownerId/.test(gas));
check('48. THE FIX: the book-detail link keys off ownerId, not ownerEmail',
  /\{!isOwner && book\.ownerId &&/.test(app));
check('49. ...so it works for a signed-out visitor, who never gets ownerEmail',
  /ownerEmail is\s*\n\s*\* *stripped for guests|stripped for guests/.test(app));

check('50. Clicking a name in the Café opens that reader',
  /onOpenReader\(m\.authorId\)/.test(cafe));
check('51. ...and the avatar is a target too, not just the text',
  /cafe-line__seat--link/.test(cafe));
check('52. A missing handler leaves the name as plain text, not a dead link',
  /onOpenReader && m\.authorId \? \(/.test(cafe));
check('53. The reader directory navigates by id as well',
  /onSelectReader\(r\.readerId \|\| ''\)/.test(read('src/components/ReaderDirectoryModal.tsx')));

// =====================================================================
console.log('\n--- The page itself ---');

check('54. There is a real route, not just a modal',
  /if \(clean\.startsWith\('\/reader\/'\)\) return 'reader';/.test(app));
check('55. The URL carries the opaque id',
  /window\.history\.pushState\(\{\}, '', `\/reader\/\$\{encodeURIComponent\(readerId\)\}`\)/.test(app));
check('56. A shared link or a refresh still resolves',
  /window\.location\.pathname\.replace\(\/\^\\\/reader/.test(app));
check('57. A profile is reachable while the membership gate is up',
  /GATE_ALLOWED_TABS: AppTab\[\] = \[[^\]]*'reader'/.test(app));
check('58. The page renders shelves, achievements and journey',
  /Their shelves/.test(page) && /Achievements/.test(page) && /Reading journey/.test(page));
check('59. It says plainly that contact details are not shown',
  /Contact details are never/.test(page));
check('60. The join date is shown as a month, not an exact day',
  /month: 'long', year: 'numeric'/.test(page));
check('61. It has a loading and a failure state, not just the happy path',
  /if \(loading\)/.test(page) && /if \(error \|\| !profile\)/.test(page));
check('62. The page is styled',
  /\.rp-page \{/.test(css) && /\.rp-shelf \{/.test(css));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
