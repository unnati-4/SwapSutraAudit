/**
 * test_no_undefined_calls.cjs  (8 Oct 2026)
 *
 * A live exchange failed with "ReferenceError: getOrCreateFolder is not
 * defined": vmsStartUpload called a helper that existed only in the test
 * mocks. This scans appsscript.js for every bare function call and fails if
 * the function is not defined anywhere in the file (or is not a JS / Apps
 * Script built-in), so a missing helper can't ship again.
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'appsscript.js'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
// Parse with the TypeScript compiler (a declared dev dependency), so strings,
// template literals and comments can never be mistaken for calls.
const ts = require('typescript');
const sf = ts.createSourceFile('appsscript.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const defs = new Set();
const called = {};
(function walk(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) defs.add(node.name.text);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) defs.add(node.name.text);
  if (ts.isParameter(node) && ts.isIdentifier(node.name)) defs.add(node.name.text);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const n = node.expression.text;
    called[n] = (called[n] || 0) + 1;
  }
  ts.forEachChild(node, walk);
})(sf);
const builtins = new Set(('Number String Boolean Array Object Date Math JSON Error isFinite isNaN parseInt parseFloat ' +
  'encodeURIComponent decodeURIComponent encodeURI decodeURI RegExp Promise Set Map Symbol setTimeout escape unescape BigInt Uint8Array').split(' '));
const missing = {};
Object.keys(called).forEach(n => { if (!defs.has(n) && !builtins.has(n)) missing[n] = called[n]; });
check('1. Every function appsscript.js calls is defined', Object.keys(missing).length === 0, JSON.stringify(missing));
check('2. getOrCreateFolder exists (exchange video uploads)', /function getOrCreateFolder\(name\)/.test(src));
check('3. sendApprovalEmail exists (host enquiry approval)', /function sendApprovalEmail\(/.test(src));
check('4. Ending a Current Read notifies with createNotification', !/addInAppNotification\(/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
