/**
 * test_chat_send_free_members.cjs  (9 Oct 2026, owner's report: "chat area
 * me sent messages hi nahi aa rahe")
 *
 * Membership is free, so a registered reader's tier is 'trial'. The chat
 * still required 'premium' before sending, so no normal reader's message
 * ever left the browser. Any registered reader (not a paused account) can
 * send now, and a message the server refuses is never dropped silently.
 */
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'src/App.tsx'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
const start = app.indexOf('const handleSendMessage = async (text: string) => {');
const fn = app.slice(start, app.indexOf('const markNotificationReadLocal', start));
check('1. Sending is no longer premium-only', start !== -1 && !/userTier !== 'premium'/.test(fn));
check('2. Any registered reader may send; a paused account may not', /if \(!isAdmin && \(!isRegisteredMember \|\| userTier === 'expired'\)\)/.test(fn));
check('3. A refused message shows the reason (not just a console line)', /notify\.error\(data\.message \|\| 'Your message could not be sent/.test(fn));
check('4. Registered readers are trial or premium', /return userTier === 'trial' \|\| userTier === 'premium';/.test(app));
check('5. No other feature is premium-only for actions', !/if \(userTier !== 'premium' && !isAdmin\)/.test(app));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
