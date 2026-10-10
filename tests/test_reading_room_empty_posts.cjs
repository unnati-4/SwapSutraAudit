/**
 * test_reading_room_empty_posts.cjs (10 Oct 2026, owner's request: "ye random
 * dikh rahe hain inko remove karo") — blank rows in the ReadingRoomPosts
 * sheet showed as empty "Reader · Thought" cards. Neither the server nor the
 * page shows a post with nothing to read, see or hear.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const C = (label, cond, d) => { if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label + (d ? '  ' + d : '')); } };
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
eval(gs.match(/function readingRoomPostHasContent_[\s\S]*?\n}\n/)[0]);
C('Server: a blank row (no id) is dropped', !readingRoomPostHasContent_({ id: '', content: 'x' }));
C('Server: a post with an id but nothing in it is dropped', !readingRoomPostHasContent_({ id: 'P1', content: '  ', bookTitle: '', mediaUrl: '', audioUrl: '', recognizedNames: [] }));
C('Server: text, a book, a photo, a voice note or a shout-out each keep a post',
  ['content', 'bookTitle', 'mediaUrl', 'audioUrl'].every(k => readingRoomPostHasContent_({ id: 'P', [k]: 'x' })) && readingRoomPostHasContent_({ id: 'P', recognizedNames: ['Asha'] }));
C('Server: the feed is filtered', /\}\)\.filter\(readingRoomPostHasContent_\);/.test(gs));
const ts = require(path.join(root, 'node_modules', 'typescript'));
const src = fs.readFileSync(path.join(root, 'src/components/ReadingRoom.tsx'), 'utf8');
const fn = src.match(/export const normalizePost[\s\S]*?\n\}\);\n/)[0] + src.match(/export const postHasContent[\s\S]*?;\n/)[0];
const pre = src.match(/const txt = [\s\S]*?;\nconst low = [\s\S]*?;\n/)[0];
const js = ts.transpileModule(pre + fn, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', js)(m, m.exports);
const { normalizePost, postHasContent } = m.exports;
C('Page: an empty "Reader · Thought" card is not shown', !postHasContent(normalizePost({ id: 'P9', postType: 'thought', content: '' })));
C('Page: a row with no id is not shown', !postHasContent(normalizePost({ content: 'hello' })));
C('Page: a real post is shown', postHasContent(normalizePost({ id: 'P1', content: 'Loved it' })) && postHasContent(normalizePost({ id: 'P2', mediaUrl: 'https://x/y.jpg' })));
C('Page: the feed is filtered', /\}\)\.filter\(postHasContent\);/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
