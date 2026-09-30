/**
 * test_public_library_and_expiry.cjs
 *
 * Two changes, both driven by "a reader shouldn't be surprised":
 *
 *   1. The Library is readable without an account — but read-only in
 *      substance, not just appearance. Owner identity and coordinates
 *      must not reach a signed-out visitor.
 *   2. A membership ending no longer removes someone's shelf from the
 *      Library silently; they are warned first, in-app and by email.
 *
 * The Apps Script half runs the real appsscript.js. The React half is
 * asserted at source level (there is no DOM here), which is weaker —
 * stated plainly rather than implied.
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

const scriptProperties = new Map();
const sandbox = {
  console,
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (scriptProperties.has(k) ? scriptProperties.get(k) : null),
      setProperty: (k, v) => { scriptProperties.set(k, v); },
      deleteProperty: (k) => { scriptProperties.delete(k); }
    })
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) =>
      Array.from(crypto.createHmac('sha256', Buffer.from(String(k))).update(Buffer.from(String(v))).digest()),
    base64EncodeWebSafe: (i) =>
      (Array.isArray(i) ? Buffer.from(i.map(b => b & 0xff)) : Buffer.from(String(i), 'utf8'))
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) =>
      Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (b) => ({ getDataAsString: () => Buffer.from(b.map(x => x & 0xff)).toString('utf8') })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8'), ctx, { filename: 'appsscript.js' });
const run = (e) => vm.runInContext(e, ctx);

const BOOK = {
  id: 'SS_BOOK_1', title: 'The God of Small Things', author: 'Arundhati Roy',
  ownerEmail: 'owner@example.com', area: 'Indiranagar', pincode: '560038',
  genre: 'Indian Literature', condition: 'Good', status: 'Approved',
  latitude: '12.9784', longitude: '77.6408',
  imageUrls: 'https://drive.google.com/file/d/abc/view',
  driveFolderId: 'folder123', rejectionReason: 'n/a', hiddenReason: '',
  email_error: 'SMTP quota exceeded', bookApprovalEmailSent: 'Yes',
  bookApprovalEmailSentAt: '2026-01-01', approvalEmailSent: 'Yes', visibleUntil: ''
};

// ============================================ guest view of the Library
console.log('\n--- A signed-out visitor can read the Library ---');

run('resetRequestIdentity()');
check('1. getBooks is reachable without a session',
  run('requireSessionForAction("getBooks")') === null);

const guestView = run(`redactBookForAudience(${JSON.stringify(BOOK)})`);

check('2. Guest still sees the title', guestView.title === BOOK.title);
check('3. Guest still sees the author', guestView.author === BOOK.author);
check('4. Guest still sees the cover image', guestView.imageUrls === BOOK.imageUrls);
check('5. Guest still sees genre and condition',
  guestView.genre === BOOK.genre && guestView.condition === BOOK.condition);
check('6. Guest still sees neighbourhood-level area + pincode (discovery is the point)',
  guestView.area === BOOK.area && guestView.pincode === BOOK.pincode);

console.log('\n--- ...but read-only in substance, not just appearance ---');

check('7. Owner email is NOT exposed to a signed-out visitor',
  guestView.ownerEmail === undefined);
check('8. Exact latitude is NOT exposed (the form promises this)',
  guestView.latitude === undefined);
check('9. Exact longitude is NOT exposed',
  guestView.longitude === undefined);
check('10. The whole member base is not enumerable by scraping the Library',
  Object.values(guestView).every(v => !String(v).includes('@')));

console.log('\n--- Internal plumbing never reaches any reader ---');

check('11. Moderation rejection reason is stripped', guestView.rejectionReason === undefined);
check('12. Email-delivery bookkeeping is stripped',
  guestView.email_error === undefined && guestView.bookApprovalEmailSent === undefined);
check('13. Drive folder id is stripped', guestView.driveFolderId === undefined);

// ============================================ member and admin views
console.log('\n--- Members and admins see what they need ---');

const memberToken = run('createSessionToken("reader@example.com", "member")');
run(`resetRequestIdentity(); establishRequestIdentity({ sessionToken: ${JSON.stringify(memberToken)} })`);
const memberView = run(`redactBookForAudience(${JSON.stringify(BOOK)})`);

check('14. A signed-in member DOES get ownerEmail (swap requests need it)',
  memberView.ownerEmail === BOOK.ownerEmail);
check('15. A member gets coordinates (the "near me" filter needs them)',
  memberView.latitude === BOOK.latitude && memberView.longitude === BOOK.longitude);
check('16. ...but a member still does not see moderation internals',
  memberView.rejectionReason === undefined && memberView.email_error === undefined);

const adminToken = run('createSessionToken("swapsutra@gmail.com", "admin")');
run(`resetRequestIdentity(); establishRequestIdentity({ sessionToken: ${JSON.stringify(adminToken)} })`);
const adminView = run(`redactBookForAudience(${JSON.stringify(BOOK)})`);
check('17. An admin sees the full row, moderation fields included',
  adminView.rejectionReason === BOOK.rejectionReason && adminView.email_error === BOOK.email_error);
run('resetRequestIdentity()');

// ============================================ acting still needs an account
console.log('\n--- Acting on a book still requires an account ---');

check('18. A guest cannot create a swap request',
  run('requireSessionForAction("createSwapRequest")')?.error === 'SESSION_REQUIRED');
check('19. A guest cannot message a reader',
  run('requireSessionForAction("sendChatMessage")')?.error === 'SESSION_REQUIRED');
check('20. A guest cannot list a book',
  run('requireSessionForAction("createBook")')?.error === 'SESSION_REQUIRED');
check('21. A guest cannot open a reader\'s reading space',
  run('requireSessionForAction("getReadingSpace")')?.error === 'SESSION_REQUIRED');

// ============================================ expiry reminders
console.log('\n--- Expiry reminders exist and are addressed correctly ---');

const src = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');

check('22. A reminder function exists',
  typeof run('typeof sendMembershipExpiryReminders') === 'string'
  && run('typeof sendMembershipExpiryReminders') === 'function');
check('23. It warns ahead of expiry, not on the day',
  run('EXPIRY_REMINDER_DAYS_BEFORE') >= 3);
check('24. It writes to the reminderSent columns that already existed but were never used',
  src.includes("headers.indexOf('reminderSent')") && src.includes("headers.indexOf('reminderSentAt')"));
check('25. The email states the actual consequence (books leave the Library)',
  /comes\b[\s\S]{0,80}out of the community Library|come\b[\s\S]{0,80}out of the community Library/.test(src));
check('26. ...and reassures that nothing is deleted',
  src.includes('Nothing is deleted'));
check('27. Only active trial/premium members are reminded, never expired ones',
  /if \(status !== 'FREE_TRIAL' && status !== 'TRIAL' && status !== 'PREMIUM'\) continue;/.test(src));
check('28. The manual trigger action is admin-gated',
  /action === 'sendExpiryReminders'\)\s*\{\s*\n\s*if \(!isAuthorizedAdminEmail/.test(src));

// ============================================ frontend (source-level)
console.log('\n--- Frontend wiring (source-level assertions) ---');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');

check('29. The Library route is open to signed-out visitors',
  /GATE_ALLOWED_TABS: AppTab\[\] = \[[^\]]*'browse'/.test(app));
check('30. Home, events and the policy pages stay reachable too (no regression)',
  /GATE_ALLOWED_TABS: AppTab\[\] = \[[^\]]*'home'[^\]]*'events'[^\]]*'privacy'/.test(app));
check('31. Guests are told up front that acting needs an account',
  app.includes("You're browsing as a guest"));
check('32. An expiry warning banner exists',
  app.includes('expiryNoticeDismissed') && app.includes('Renew · ₹49/mo'));
check('33. The banner names the real consequence, with a real count',
  app.includes('myListedBookCount') && /out of the Library until you renew/.test(app));
check('34. Dismissing the warning silences it for the day only, not for good',
  app.includes('swapsutraExpiryNoticeDismissedOn') && app.includes('todayKey'));
check('35. The warning covers paid members too, not just trials',
  /userTier === 'trial' \|\| userTier === 'premium'/.test(app));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
