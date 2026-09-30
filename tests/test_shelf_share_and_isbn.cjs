/**
 * test_shelf_share_and_isbn.cjs  (23 Sep)
 *
 *  - Shelf planks are real brown, not the old grey-brown.
 *  - ISBN is required on a new listing, in the form and on the server.
 *  - Shelf tiles show the publisher's cover by ISBN (via /api/books
 *    ?action=cover), falling back to the reader's photo; the book page
 *    still shows the reader's own photos.
 *  - The cover route asks Google Books first, Open Library second, and
 *    404s when neither has a picture. The Drive relay only relays Drive.
 *  - "Share my shelf" draws a picture and shares it with the link; any
 *    share that has a picture (book, Reading Room post, circle invite)
 *    attaches it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('src/index.css');
const app = read('src/App.tsx');
const gs = read('appsscript.js');
const books = read('api/books.ts');
const share = read('src/utils/share.ts');
const rr = read('src/components/ReadingRoom.tsx');
const circle = read('src/components/DedicatedCurrentReadChat.tsx');
const rp = read('src/components/ReaderProfile.tsx');

console.log('--- Brown shelf ---');
check('1. Plank colours are brown', /--wood-light: #B7804F;/.test(css) && /--wood-mid: #8B5A32;/.test(css) && /--wood-dark: #5A371D;/.test(css));
check('2. The old grey-brown is gone', !/--wood-light: #A08F84/.test(css) && !/--wood-mid: #7C6E65/.test(css));

console.log('--- ISBN required ---');
check('3. Form marks ISBN as required', /Book ISBN <span className="text-red-700">\*<\/span>/.test(app));
check('4. Submit refuses a listing with no ISBN', /if \(!rawIsbn\) \{[\s\S]{0,120}ISBN is required/.test(app));
check('5. A typed-but-not-looked-up ISBN still counts', /normalizeIsbn\(String\(manualIsbnValue\.trim\(\) \|\| isbnMetadata\?\.isbn/.test(app));
check('6. Server refuses createBook without ISBN (ISBN_REQUIRED)', /if \(!normalizeIsbnServer\(data\.isbn\)\) \{[\s\S]{0,200}ISBN_REQUIRED/.test(gs));
check('7. ...before pricing runs', gs.indexOf('ISBN_REQUIRED') < gs.indexOf("const pricing = resolveListingPricing(data, id);"));
check('8. Scanning fills the ISBN box', /setManualIsbnValue\(isbn\);\s*performIsbnLookup\(isbn\);/.test(app));

console.log('--- Shelf cover by ISBN ---');
check('9. ShelfBook tries the ISBN cover, then own photo', /shelfCoverCandidates\(book\.isbn, images\[0\]\)/.test(app));
check('10. A failed cover steps to the next source', /onError=\{\(\) => setCoverStep/.test(app));
check('11. Book page still uses the reader\'s photos (getBookImages in detail modal)', /const images = getBookImages\(book\)/.test(app));

// util behaviour
const utilJs = esbuild.transformSync(read('src/utils/bookCover.ts'), { loader: 'ts', format: 'cjs' }).code;
const m1 = { exports: {} };
vm.runInNewContext(utilJs, { module: m1, exports: m1.exports });
const bc = m1.exports;
check('12. Cover URL built from a clean ISBN', bc.shelfCoverUrl('978-0-06-112008-4') === '/api/books?action=cover&isbn=9780061120084&v=2');
check('13. No cover URL for a missing ISBN', bc.shelfCoverUrl('') === '' && bc.shelfCoverUrl('123') === '');
const cands = bc.shelfCoverCandidates('0061120081', 'https://drive.google.com/thumbnail?id=abc');
check('14. Candidates: ISBN cover → own photo → stock', cands.length === 3 && cands[0].includes('isbn=0061120081') && cands[1].includes('drive') && cands[2] === bc.SHELF_FALLBACK_COVER);

console.log('--- Cover route ---');
check('15. books.ts routes action=cover and action=image', /case 'cover':/.test(books) && /case 'image':/.test(books));
check('16. Covers are CDN-cached for a month', /s-maxage=2592000/.test(books));
check('17. The Drive relay validates the id and builds the URL itself', /\^\[A-Za-z0-9_-\]\{10,200\}\$/.test(books) && /drive\.google\.com\/thumbnail\?id=\$\{id\}/.test(books));

(async () => {
  const booksJs = esbuild.transformSync(books, { loader: 'ts', format: 'cjs' }).code;
  const calls = [];
  let responder = () => ({ ok: false, status: 404, headers: new Map(), json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
  const img = (n) => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array(n).buffer });
  const miss = { ok: false, status: 404, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}) };
  const sandbox = {
    module: { exports: {} }, exports: {}, process: { env: {} }, console, Buffer,
    // crypto is stubbed so a body marked 0x47 hashes like Google's grey placeholder.
    require: (m) => (m === 'crypto'
      ? { createHash: () => ({ b: null, update(b) { this.b = b; return this; }, digest() { return this.b[0] === 0x47 ? 'a9af51' + '0'.repeat(58) : 'f'.repeat(64); } }) }
      : require(m)),
    AbortController, setTimeout, clearTimeout,
    fetch: async (url) => { calls.push(String(url)); return responder(String(url)); },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(booksJs, sandbox);
  const { resolveCover } = sandbox.module.exports;

  const crypto = require('crypto');
  // 18-19: the quota-free Google image route answers first
  responder = (u) => (u.includes('books.google.com/books/content?vid=ISBN9780061120084') ? img(20000) : miss);
  let r = await resolveCover('9780061120084');
  check('18. Google cover-by-ISBN image found → bytes', r && r.body.length === 20000 && r.type === 'image/jpeg');
  check('19. ...without touching the quota-limited Books API, and asking for a sharp size', !calls.some((c) => c.includes('googleapis.com')) && calls[0].includes('fife=w600'));

  // Google's grey "no cover" placeholder (10,794 bytes, sha256 a9af51…) is not a cover
  const greyBody = Buffer.alloc(10794); greyBody[0] = 0x47;
  calls.length = 0;
  responder = (u) => {
    if (u.includes('books.google.com/books/content')) return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => greyBody.buffer.slice(greyBody.byteOffset, greyBody.byteOffset + greyBody.length) };
    if (u.includes('googleapis.com/books')) return { ok: false, status: 429, headers: { get: () => 'application/json' }, json: async () => ({}) };
    if (u.includes('covers.openlibrary.org')) return img(9000);
    return miss;
  };
  r = await resolveCover('0061120081');
  check('20. Grey placeholder skipped, API quota error survived → Open Library', greyBody && r && r.body.length === 9000 && calls.some((c) => c.includes('covers.openlibrary.org/b/isbn/9780061120084-L.jpg?default=false')));

  const { resolveCoverDetailed } = sandbox.module.exports;
  responder = (u) => (u.includes('googleapis.com') ? { ok: false, status: 429, headers: { get: () => 'application/json' } } : miss);
  let d = await resolveCoverDetailed('9780061120084');
  check('21a. Quota error → no cover, marked transient (not cached)', d.cover === null && d.transient === true);
  responder = (u) => (u.includes('googleapis.com') ? { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) } : miss);
  d = await resolveCoverDetailed('9780061120084');
  check('21. Nobody has a cover → null, cacheable 404', d.cover === null && d.transient === false);
  r = await resolveCover('12345');
  check('22. Not an ISBN → null', r === null);

  calls.length = 0;
  responder = (u) => (u.includes('vid=ISBN9780008123209') ? img(12000) : { ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array(1269).buffer });
  r = await resolveCover('9780008123209');
  check('23. A mistyped check digit is still looked up as typed', r && r.body.length === 12000);
  responder = () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array(1269).buffer });
  r = await resolveCover('9780061120084');
  check('23b. Google\'s "image not available" PNG is not a cover', r === null);
  check('23c. Failed lookups are not cached; real misses cached 6h', /transient \? 'no-store'/.test(books) && /s-maxage=21600/.test(books));

  console.log('--- Sharing with pictures ---');
  const shareJs = esbuild.transformSync(share, { loader: 'ts', format: 'cjs' }).code;
  const m2 = { exports: {} };
  vm.runInNewContext(shareJs, { module: m2, exports: m2.exports, window: {}, navigator: {}, document: {} });
  const sh = m2.exports;
  check('24. Drive photos are read through our relay', sh.readableImageUrl('https://drive.google.com/thumbnail?id=1AbCdEfGhIjK&sz=w800') === '/api/books?action=image&id=1AbCdEfGhIjK'
    && sh.readableImageUrl('https://drive.google.com/file/d/1AbCdEfGhIjK/view') === '/api/books?action=image&id=1AbCdEfGhIjK');
  check('25. Same-origin and other URLs pass through', sh.readableImageUrl('/api/books?action=cover&isbn=1') === '/api/books?action=cover&isbn=1' && sh.readableImageUrl('https://x.com/a.jpg') === 'https://x.com/a.jpg');
  check('26. Files are shared with the link inside the text', /files: opts\.files, title: opts\.title, text: `\$\{opts\.text\}\\n\$\{opts\.url\}`/.test(share));
  check('27. Profile has "Share my shelf" with a drawn picture', /Share my shelf/.test(app) && /makeImage=\{\(\) => buildShelfImage\(\{ name: myName, books: shelfBooks, link \}\)\}/.test(app));
  check('28. The link is the public /reader/<id> page, never an email', /\/reader\/\$\{encodeURIComponent\(myReaderId\)\}/.test(app) && /readerId: readerPublicId\(email\)/.test(gs));
  check('29. Public reader page shows the 3-D shelf and a share button', /renderShelf\(profile\.books\)/.test(rp) && /Share this shelf/.test(rp) && /<div className="ss-shelf">/.test(app));
  check('30. "Share this book" attaches the book\'s photos', /heading="Share this book"[\s\S]{0,700}images=\{getBookImages\(book\)/.test(app));
  check('31. Reading Room posts with a photo attach it', /setPostShare\(\{ \.\.\.payload, images/.test(rr) && /heading="Share this post"/.test(rr));
  check('32. Circle invites attach the cover when there is one', /if \(circle\?\.coverUrl\) \{ setInviteShareOpen\(true\)/.test(circle) && !/alert\([^)]*Invite link/.test(circle));

  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  process.exit(failed === 0 ? 0 : 1);
})();
