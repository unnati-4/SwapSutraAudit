/**
 * test_proxy_non_json.cjs — when Apps Script answers with a Google web page
 * (e.g. "You need access" because a new permission is waiting for the
 * owner's approval), readers must see one plain sentence, never the page's
 * HTML/JavaScript, and it must never be reported as success.
 */
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
const check = (l, c) => { if (c) { passed++; console.log('PASS: ' + l); } else { failed++; console.log('FAIL: ' + l); } };
const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'swapsutra.ts'), 'utf8');
check('1. The raw Apps Script page is no longer forwarded to the browser', !/"Apps Script returned non-JSON error: " \+ text/.test(src));
check('2. A 200 HTML page is not reported as success', !/success: true, message: text/.test(src));
check('3. Readers get one plain sentence', /SwapSutra is having trouble reaching its library right now/.test(src));
check('4. The details go to the server log', /console\.error\(`\[proxy\] Apps Script returned non-JSON/.test(src));
// Run the classifier on real-looking pages.
const fnSrc = src.slice(src.indexOf('function classifyAppsScriptPage'), src.indexOf('export default async function handler'));
const classify = new Function(fnSrc.replace(/\(text: string, status: number\): string/, '(text, status)') + '; return classifyAppsScriptPage;')();
check('5. "You need access" → BACKEND_ACCESS_DENIED', classify('<title>Access Denied</title><div>You need access</div>', 403) === 'BACKEND_ACCESS_DENIED');
check('6. "Authorization needed" → BACKEND_NEEDS_AUTHORIZATION', classify('<title>Authorization needed</title>', 200) === 'BACKEND_NEEDS_AUTHORIZATION');
check('7. Script crash → BACKEND_SCRIPT_ERROR', classify('TypeError: Cannot read properties of undefined (line 12, file "Code")', 200) === 'BACKEND_SCRIPT_ERROR');
check('8. Archived deployment → BACKEND_DEPLOYMENT_NOT_FOUND', classify('Sorry, unable to open the file at this time. Page Not Found', 404) === 'BACKEND_DEPLOYMENT_NOT_FOUND');
console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed ? 1 : 0);
