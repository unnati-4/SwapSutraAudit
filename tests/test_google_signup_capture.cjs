/**
 * test_google_signup_capture.cjs
 *
 * What happens to a reader who signs in with Google and has no SwapSutra
 * account yet.
 *
 * The defect these guard against: that reader used to be dropped on the
 * membership gate, whose "free" option registers from the email address
 * alone. Two bad outcomes followed, and both were reported as "Google
 * signed-up users are not visible in the Google Sheet":
 *
 *   - Close the gate and nothing was written at all. No row, no record that
 *     the person had ever arrived.
 *   - Go through it and the row carried no phone number and a "name" guessed
 *     from the part of the address before the "@" — an account that cannot
 *     be used to actually run a swap.
 *
 * A brand-new Google reader is a brand-new reader, so they now get the same
 * Sign Up form as everyone else, carrying over what Google already told us.
 * The emailed code is skipped, because skipping it is the entire reason
 * somebody chooses Google in the first place.
 */

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');

// The handler that runs once Google hands back a credential.
const handlerStart = src.indexOf('const handleGoogleCredential');
check('0. handleGoogleCredential still exists', handlerStart !== -1);
const handler = src.slice(handlerStart, handlerStart + 4000);

// --- Where an unregistered Google reader is sent -------------------------
const unregisteredBranch = handler.slice(handler.indexOf('data.isRegistered === false'));

// 22 Sep 2026 (owner's decision): Google sign-UP is turned off. An
// unregistered Google account is told it is not registered and is given
// no session and no Sign Up form. (Checks 6-16 below cover form code that
// still exists for any prefill path; they are unaffected.)
check('1. An unregistered Google reader is told they are not registered',
  /not registered on SwapSutra yet/.test(unregisteredBranch));

check('2. ...and is not dropped on the membership gate',
  !/setShowMembershipGateModal\(true\)/.test(unregisteredBranch.slice(0, 600)));

check('3. ...nor sent to the Sign Up form',
  !/setShowSubForm\(true\)/.test(unregisteredBranch.slice(0, 600)));

check('4. ...and keeps no session',
  /setSessionToken\(null\)/.test(unregisteredBranch.slice(0, 600)));

check('5. The Sign Up form no longer offers "Continue with Google"',
  !/Continue with Google/.test(src));

// --- The form itself -----------------------------------------------------
check('6. The name field is prefilled from the Google account',
  /name="name"[^>]*defaultValue=\{googleSignupPrefill\?\.name/.test(src));

check('7. The email field is prefilled with the verified address',
  /defaultValue=\{googleSignupPrefill\?\.email/.test(src));

check('8. The verified email is read-only — a reader cannot register an address nobody proved they own',
  /readOnly=\{Boolean\(googleSignupPrefill\)\}/.test(src));

check('9. The form is keyed on the prefill, or the uncontrolled inputs would never show it',
  /key=\{googleSignupPrefill \? `google:\$\{googleSignupPrefill\.email\}` : 'signup'\}/.test(src));

// The WhatsApp number is the one thing Google cannot tell us, so it must
// still be asked for — and it must still be required.
const formBlock = src.slice(src.indexOf('Identity Details'), src.indexOf('Identity Details') + 3000);
check('10. The WhatsApp number is still collected and still required',
  /name="phone"[^>]*required/.test(formBlock) && !/name="phone"[^>]*defaultValue/.test(formBlock));

// --- What is submitted ---------------------------------------------------
check('11. The submitted email comes from the verified token, not the form field',
  /email:\s*googleSignupPrefill \? googleSignupPrefill\.email : formData\.get\('email'\)/.test(src));

// --- The emailed code is skipped ----------------------------------------
// Anchored on the Rule 3 comment rather than on `subFormTier === 'free'`,
// which also appears in the payment calculation further up the handler.
const submitAnchor = src.indexOf('Registration itself must never grant a session');
const submitBlock = src.slice(submitAnchor, submitAnchor + 3000);

check('12. A Google signup activates the trial directly',
  /activateFreeTrialForEmail\(normalizeEmail\(newAccountEmail\)\)/.test(submitBlock));

check('13. ...instead of being sent an emailed code it signed in with Google to avoid',
  submitBlock.indexOf('activateFreeTrialForEmail') < submitBlock.indexOf('beginPostSignupVerification'));

check('14. The skip is gated on the address matching the one Google signed',
  /normalizeEmail\(newAccountEmail\) === normalizeEmail\(googleSignupPrefill\.email\)/.test(submitBlock));

check('15. A reader who did NOT come through Google still gets the emailed code',
  /beginPostSignupVerification\(newAccountEmail\)/.test(submitBlock));

// --- Housekeeping --------------------------------------------------------
check('16. Closing the form clears the prefill, so it cannot leak into a later signup',
  (src.match(/setShowSubForm\(false\); setGoogleSignupPrefill\(null\)/g) || []).length >= 2);

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
