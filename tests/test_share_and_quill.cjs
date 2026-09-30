/** test_share_and_quill.cjs — Reading Room sharing, circle invites, Quill on every page, Library-only FAB (22 Sep 2026). */
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
const check = (l, c) => { if (c) { passed++; console.log('PASS: ' + l); } else { failed++; console.log('FAIL: ' + l); } };
const rr = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ReadingRoom.tsx'), 'utf8');
const chat = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DedicatedCurrentReadChat.tsx'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
const util = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'share.ts'), 'utf8');

check('1. Sharing uses the phone share sheet, else copies the link', /nav\?\.share/.test(util) && /clipboard/.test(util));
check('2. Every post has a Share button linking to that post', /aria-label="Share this post"/.test(rr) && /\/reading-room\?post=\$\{encodeURIComponent\(post\.id\)\}/.test(rr));
check('3. A shared post link scrolls to the post', /get\('post'\)/.test(rr) && /document\.getElementById\(`post-\$\{linkedPostId\}`\)/.test(rr));
check('4. Circle cards have an Invite button', /onClick=\{\(\) => inviteToCircle\(c\)\}/.test(rr) && /\/readers-circle\/\$\{encodeURIComponent\(cId\)\}/.test(rr));
check('5. Inside a circle, Invite is visible on phone and desktop', (chat.match(/aria-label="Invite readers to this circle"/g) || []).length === 2);
const guides = app.slice(app.indexOf('const quillGuides'), app.indexOf('const quillGuide = quillGuides'));
for (const k of ['browse', "'book-requests'", "'reading-room'", 'cafe', 'tracker', 'events', 'newsletter', 'about', 'privacy', "'profile:overview'", "'profile:settings'", 'notifications', 'ambassador']) {
  check(`6. Quill has a note for ${k}`, new RegExp(`\\n    ${k.replace(/[-:']/g, m => m === "'" ? "'" : '\\' + m)}: `).test(guides));
}
check('7. Quill no longer describes pages that were removed', !/Reading Space, Readers Circle/.test(guides) && !/A circle becomes active when three readers join/.test(guides));
check('8. "+ List a book" floats on the Library only', /\{\(activeTab === 'browse' \|\| activeTab === 'book-requests'\) && \(/.test(app));
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
