/**
 * test_session_auth.js
 *
 * Unlike the other suites in this folder (which re-implement the logic
 * they describe), this one loads the REAL appsscript.js into a sandbox
 * with the Apps Script globals mocked, and calls the actual functions.
 * That matters here: the whole point of the change under test is that
 * authorization no longer comes from the request, so a re-implementation
 * would prove nothing about the deployed file.
 *
 * Covers the critical findings:
 *   C1 — admin access was granted by an `adminEmail` request parameter
 *   C2 — login produced no session; localStorage was the credential
 *   C3 — getUserProfile returned any member's record by email
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label); }
}

// --- Apps Script runtime mock -----------------------------------------

const scriptProperties = new Map();

function makeSandbox() {
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
      computeHmacSha256Signature: (value, key) => {
        const mac = crypto.createHmac('sha256', Buffer.from(String(key), 'utf8'))
          .update(Buffer.from(String(value), 'utf8'))
          .digest();
        // Apps Script returns signed bytes; the code only ever re-encodes
        // them, so a plain byte array is a faithful stand-in.
        return Array.from(mac);
      },
      base64EncodeWebSafe: (input) => {
        const buf = Array.isArray(input)
          ? Buffer.from(input.map(b => b & 0xff))
          : Buffer.from(String(input), 'utf8');
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      },
      base64DecodeWebSafe: (str) => {
        const normalized = String(str).replace(/-/g, '+').replace(/_/g, '/');
        return Array.from(Buffer.from(normalized, 'base64'));
      },
      newBlob: (bytes) => ({
        getDataAsString: () => Buffer.from(bytes.map(b => b & 0xff)).toString('utf8')
      })
    },
    // Never reached by the functions under test; present so top-level
    // initialisation in appsscript.js does not throw on load.
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    MailApp: { sendEmail() {} },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({ setMimeType: () => ({ __text: text }) })
    },
    DriveApp: {},
    // Whatever the current test wants Google's tokeninfo endpoint to say.
    UrlFetchApp: {
      fetch: (url) => {
        sandbox.__lastTokenInfoUrl = url;
        const reply = sandbox.__googleReply || { code: 200, body: {} };
        return {
          getResponseCode: () => reply.code,
          getContentText: () => JSON.stringify(reply.body)
        };
      }
    }
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

const source = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
const context = vm.createContext(makeSandbox());
vm.runInContext(source, context, { filename: 'appsscript.js' });

const run = (expr) => vm.runInContext(expr, context);
const call = (fn, ...args) =>
  vm.runInContext(`(${fn}).apply(null, ${JSON.stringify(args)})`, context);

const ADMIN = 'swapsutra@gmail.com';
const MEMBER = 'reader@example.com';
const OTHER = 'someone.else@example.com';

// ======================================================================
console.log('\n--- Token integrity ---');

const memberToken = call('createSessionToken', MEMBER, 'member');
const adminToken = call('createSessionToken', ADMIN, 'admin');

check('1. A minted member token verifies back to the same email',
  call('verifySessionToken', memberToken)?.email === MEMBER);

check('2. A minted admin token resolves to the admin role',
  call('verifySessionToken', adminToken)?.role === 'admin');

check('3. A member token does NOT resolve to the admin role',
  call('verifySessionToken', memberToken)?.role === 'member');

check('4. Empty / missing token is rejected',
  call('verifySessionToken', '') === null && call('verifySessionToken', null) === null);

check('5. Garbage token is rejected',
  call('verifySessionToken', 'not-a-token') === null);

// Tamper with the payload but keep the original signature.
const parts = memberToken.split('.');
const forgedPayload = Buffer.from(JSON.stringify({
  e: ADMIN, r: 'admin', iat: Date.now(), exp: Date.now() + 100000
})).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
check('6. Payload swapped for the admin, signature reused -> rejected',
  call('verifySessionToken', `${parts[0]}.${forgedPayload}.${parts[2]}`) === null);

check('7. Signature altered -> rejected',
  call('verifySessionToken', `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xy`) === null);

check('8. Wrong version prefix -> rejected',
  call('verifySessionToken', `v9.${parts[1]}.${parts[2]}`) === null);

// Sign a genuinely-signed payload that has already expired.
const expiredPayload = Buffer.from(JSON.stringify({
  e: MEMBER, r: 'member', iat: Date.now() - 200000, exp: Date.now() - 100000
})).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const expiredSig = call('signSessionPayload', expiredPayload);
check('9. Correctly signed but expired token -> rejected',
  call('verifySessionToken', `v1.${expiredPayload}.${expiredSig}`) === null);

// A validly-signed member token that CLAIMS admin in its payload.
const escalationPayload = Buffer.from(JSON.stringify({
  e: MEMBER, r: 'admin', iat: Date.now(), exp: Date.now() + 100000
})).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const escalationSig = call('signSessionPayload', escalationPayload);
check('10. Role claimed in the payload is ignored; it is re-derived from the email',
  call('verifySessionToken', `v1.${escalationPayload}.${escalationSig}`)?.role === 'member');

// ======================================================================
console.log('\n--- C1: admin can no longer be claimed by parameter ---');

run('resetRequestIdentity()');
check('11. THE OLD ATTACK: adminEmail=swapsutra@gmail.com with no session is refused',
  call('isAuthorizedAdminEmail', ADMIN) === false);

check('12. ...and so is any other value passed to the gate',
  call('isAuthorizedAdminEmail', 'attacker@evil.test') === false);

run(`establishRequestIdentity({ sessionToken: ${JSON.stringify(memberToken)} })`);
check('13. A signed MEMBER session still does not pass the admin gate',
  run('isAuthorizedAdminEmail("swapsutra@gmail.com")') === false);

run(`establishRequestIdentity({ sessionToken: ${JSON.stringify(adminToken)} })`);
check('14. A signed ADMIN session passes the admin gate',
  run('isAuthorizedAdminEmail()') === true);

check('15. ...and the gate ignores a contradictory parameter entirely',
  run('isAuthorizedAdminEmail("attacker@evil.test")') === true);

// ======================================================================
console.log('\n--- isAdminEmail stays a DATA predicate (no regressions) ---');

run('resetRequestIdentity()');
check('16. isAdminEmail("swapsutra@gmail.com") is still true with no session',
  call('isAdminEmail', ADMIN) === true);
check('17. isAdminEmail(member) is false',
  call('isAdminEmail', MEMBER) === false);
check('18. Case/whitespace variants still resolve (getBooks owner check relies on this)',
  call('isAdminEmail', '  SwapSutra@Gmail.com ') === true);

// ======================================================================
console.log('\n--- C2/C3: identity is taken from the session, not the request ---');

run(`resetRequestIdentity(); establishRequestIdentity({ sessionToken: ${JSON.stringify(memberToken)} })`);

let payload = run(`applyAuthenticatedIdentity({ action: 'getUserProfile', email: ${JSON.stringify(OTHER)} }, 'getUserProfile')`);
check('19. THE OLD ATTACK: getUserProfile for another member is rewritten to the caller',
  payload.email === MEMBER);

payload = run(`applyAuthenticatedIdentity({ action: 'getNotifications', email: ${JSON.stringify(OTHER)} }, 'getNotifications')`);
check('20. Reading another member\'s notifications is rewritten to the caller',
  payload.email === MEMBER);

payload = run(`applyAuthenticatedIdentity({ action: 'createBook', ownerEmail: ${JSON.stringify(OTHER)} }, 'createBook')`);
check('21. Listing a book "as" another member is rewritten to the caller',
  payload.ownerEmail === MEMBER);

payload = run(`applyAuthenticatedIdentity({ action: 'sendChatMessage', senderEmail: ${JSON.stringify(OTHER)} }, 'sendChatMessage')`);
check('22. Sending a chat message as someone else is rewritten to the caller',
  payload.senderEmail === MEMBER);

payload = run(`applyAuthenticatedIdentity({ action: 'getBooks', adminEmail: ${JSON.stringify(ADMIN)} }, 'getBooks')`);
check('23. A member supplying adminEmail has it stripped',
  payload.adminEmail === '');

payload = run(`applyAuthenticatedIdentity({ action: 'getUserProfile' }, 'getUserProfile')`);
check('24. A self-scoped action with no email at all is filled in from the session',
  payload.email === MEMBER);

payload = run(`applyAuthenticatedIdentity({ action: 'getPublicReaderProfile', email: ${JSON.stringify(OTHER)} }, 'getPublicReaderProfile')`);
check('25. A genuinely public profile lookup is NOT rewritten (feature still works)',
  payload.email === OTHER);

payload = run(`applyAuthenticatedIdentity({ action: 'createSwapRequest', requesterEmail: ${JSON.stringify(OTHER)}, ownerEmail: ${JSON.stringify(OTHER)} }, 'createSwapRequest')`);
check('26. On a swap request the REQUESTER is pinned to the caller...',
  payload.requesterEmail === MEMBER);
check('27. ...but the counterparty owner is left alone (swaps still work)',
  payload.ownerEmail === OTHER);

// ======================================================================
console.log('\n--- Admin exemption (management screens keep working) ---');

run(`resetRequestIdentity(); establishRequestIdentity({ sessionToken: ${JSON.stringify(adminToken)} })`);
payload = run(`applyAuthenticatedIdentity({ action: 'getUserProfile', email: ${JSON.stringify(OTHER)} }, 'getUserProfile')`);
check('28. An authenticated admin may still read another member\'s profile',
  payload.email === OTHER);
check('29. ...and adminEmail is set from the verified session',
  payload.adminEmail === ADMIN);

// ======================================================================
console.log('\n--- Default-deny action gate ---');

run('resetRequestIdentity()');
check('30. Guest may call sendOTP (auth handshake)',
  call('requireSessionForAction', 'sendOTP') === null);
check('31. Guest may call getBooks (public Library)',
  call('requireSessionForAction', 'getBooks') === null);
check('32. Guest may call checkSubscription (eligibility before signup)',
  call('requireSessionForAction', 'checkSubscription') === null);
check('33. Guest may call registerFreeReader (signup)',
  call('requireSessionForAction', 'registerFreeReader') === null);

const denied = call('requireSessionForAction', 'getUserProfile');
check('34. Guest is BLOCKED from getUserProfile',
  denied && denied.error === 'SESSION_REQUIRED');
check('35. Guest is BLOCKED from the admin surface (manageBook)',
  call('requireSessionForAction', 'manageBook')?.error === 'SESSION_REQUIRED');
check('36. Guest is BLOCKED from sendChatMessage',
  call('requireSessionForAction', 'sendChatMessage')?.error === 'SESSION_REQUIRED');
check('37. An action added later defaults to DENY rather than allow',
  call('requireSessionForAction', 'someActionAddedLater')?.error === 'SESSION_REQUIRED');

run(`establishRequestIdentity({ sessionToken: ${JSON.stringify(memberToken)} })`);
check('38. A signed-in member passes the gate for member actions',
  run('requireSessionForAction("getUserProfile")') === null);

// ======================================================================
console.log('\n--- Login response shape ---');

run('resetRequestIdentity()');
const memberLogin = call('buildLoginSuccessResponse', MEMBER);
check('39. Login returns a session token (it previously returned only success:true)',
  typeof memberLogin.sessionToken === 'string' && memberLogin.sessionToken.length > 0);
check('40. Login reports the role the backend derived, not one the client picked',
  memberLogin.role === 'member');
check('41. The issued token verifies and is bound to the account that logged in',
  call('verifySessionToken', memberLogin.sessionToken)?.email === MEMBER);

const adminLogin = call('buildLoginSuccessResponse', ADMIN);
check('42. Admin login is issued an admin token',
  call('verifySessionToken', adminLogin.sessionToken)?.role === 'admin');
check('43. Admin sessions are shorter-lived than member sessions',
  new Date(adminLogin.sessionExpiresAt) < new Date(memberLogin.sessionExpiresAt));

// ======================================================================
console.log('\n--- Session revocation ---');

scriptProperties.delete('SESSION_SECRET');
check('44. Clearing SESSION_SECRET invalidates every previously issued token',
  call('verifySessionToken', memberToken) === null && call('verifySessionToken', adminToken) === null);

// ======================================================================
console.log('\n--- Sign in with Google ---');

// Neither of these touches a sheet: the reader is treated as "verified but
// not registered", which is the branch that matters for a new visitor.
run("emailExistsInUsersSheet = function () { return false; };");
run("logActivity = function () {};");

const googleToken = (over) => Object.assign({
  iss: 'https://accounts.google.com',
  aud: 'test-client.apps.googleusercontent.com',
  exp: String(Math.floor(Date.now() / 1000) + 600),
  email: 'reader@example.com',
  email_verified: 'true',
  name: 'Test Reader'
}, over || {});

const withGoogle = (body, code) => {
  run(`__googleReply = ${JSON.stringify({ code: code || 200, body })};`);
  return call('googleSignIn', { credential: 'FAKE.JWT.TOKEN' });
};

scriptProperties.delete('GOOGLE_CLIENT_ID');
check('45. With no client id configured, Google sign-in refuses rather than guessing',
  withGoogle(googleToken()).success === false);

scriptProperties.set('GOOGLE_CLIENT_ID', 'test-client.apps.googleusercontent.com');

const ok = withGoogle(googleToken());
// 22 Sep: Google sign-up is off. A valid token for an address with no
// SwapSutra account gets no session and a "not registered" answer.
check('46. A good Google token for an unregistered reader is refused', ok.success === false && ok.code === 'GOOGLE_NOT_REGISTERED');
check('47. ...and gets no session token', !ok.sessionToken);
check('48. ...and is told they are not registered yet', /not registered/.test(ok.message || ''));
run("emailExistsInUsersSheet = function () { return true; };");
const reg = withGoogle(googleToken());
check('48b. A REGISTERED reader can still sign in with Google', reg.success === true && reg.email === 'reader@example.com' && call('verifySessionToken', reg.sessionToken) !== null);
run("emailExistsInUsersSheet = function () { return false; };");

check('49. A token for somebody else\'s app is refused',
  withGoogle(googleToken({ aud: 'someone-elses-client.apps.googleusercontent.com' })).success === false);
check('50. A token not issued by Google is refused',
  withGoogle(googleToken({ iss: 'https://evil.example.com' })).success === false);
check('51. An expired token is refused',
  withGoogle(googleToken({ exp: String(Math.floor(Date.now() / 1000) - 60) })).success === false);
check('52. An unverified Google address is refused',
  withGoogle(googleToken({ email_verified: 'false' })).success === false);
check('53. A credential Google itself rejects is refused',
  withGoogle({ error: 'invalid_token' }, 400).success === false);
check('54. Signing in with Google needs no existing session',
  run('SESSION_EXEMPT_ACTIONS.googleSignIn') === true);

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
