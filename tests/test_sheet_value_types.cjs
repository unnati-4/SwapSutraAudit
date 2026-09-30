/**
 * test_sheet_value_types.cjs
 *
 * Google Sheets returns "1984" as the number 1984. One such book title
 * made the Reading Room crash to a blank page ("(b.title || '').trim is
 * not a function"). These checks keep sheet values going through a
 * string conversion before any string method is called on them, and keep
 * the service worker from answering a request with nothing.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
let passed = 0, failed = 0;
const check = (l, c) => { if (c) { passed++; console.log('PASS: ' + l); } else { failed++; console.log('FAIL: ' + l); } };
const root = path.join(__dirname, '..');
const rr = fs.readFileSync(path.join(root, 'src/components/ReadingRoom.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');

// Run the real normalizePost.
const js = esbuild.transformSync(rr, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
const mod = { exports: {} };
const stub = new Proxy({}, { get: () => () => null });
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => stub);
const { normalizePost } = mod.exports;
const p = normalizePost({ id: 7, authorName: 1234, content: 1984, bookTitle: 1984, bookAuthor: null, isSpoiler: 'Yes', reactionsCount: '3', comments: [{ id: 1, userEmail: null, userName: 42, comment: 7 }] });
check('1. A numeric book title becomes the text "1984"', p.bookTitle === '1984');
check('2. Numeric content, author name and id become text', p.content === '1984' && p.authorName === '1234' && p.id === '7');
check('3. An empty author stays empty instead of "null"', p.bookAuthor === undefined);
check('4. "Yes" in the spoiler column means spoiler', p.isSpoiler === true);
check('5. Counts become numbers', p.reactionsCount === 3 && p.commentsCount === 0);
check('6. Comment fields become text', p.comments[0].userName === '42' && p.comments[0].comment === '7' && p.comments[0].userEmail === '');
check('7. A post with no name still gets one', normalizePost({}).authorName === 'Reader');

check('8. Feed posts go through normalizePost', /const p = normalizePost\(raw\)/.test(rr));
check('9. The listing check no longer calls .trim() on a raw title', !/\(b\.title \|\| ''\)\.trim\(\)/.test(rr) && /low\(b\?\.title\)/.test(rr));
check('10. Books are normalised where they enter the app (fetch, refresh and cache)',
  (app.match(/normalizeBookList\(/g) || []).length >= 3);
check('11. The Library search no longer meets a numeric title', /title: b\.title === undefined \|\| b\.title === null \? '' : String\(b\.title\)/.test(app));

// 30 Sep: the PWA is gone. The worker no longer intercepts any request
// (so it can neither break other sites' requests nor answer undefined),
// and it deletes the old app-shell caches.
check('12. The service worker intercepts no requests at all (no fetch handler)', !/addEventListener\(['"]fetch['"]/.test(sw));
check('13. ...so no request can be answered with undefined', !/respondWith/.test(sw));
check('14. It deletes every cache the old PWA worker left behind', /caches\.keys\(\)[\s\S]*caches\.delete\(key\)/.test(sw));
console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed ? 1 : 0);
