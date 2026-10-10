/**
 * test_sponsored_ads.cjs  (9 Oct 2026, owner's request: "admin ad laga sakta
 * hai bookstore ka ya author ka ya koi particular book ka, vo ad library ke
 * banner pe bhi show hoga or bookshelf me bhi books ke bich bich me, or books
 * or mugs shuffle hote rahenge har open karne par")
 *
 * Apps Script: the admin saves / pauses / removes ads; the site gets only the
 * live ones inside their dates; clicks are counted. Site: the shelf mixer
 * (src/utils/ads.ts) shuffles the books each visit and puts mugs and ads
 * between them; the banner, the shelf cards and the admin tab are wired.
 *
 * (Harness copied from test_rent_split.cjs.)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
const H = 3600e3, D = 24 * H;
const T0 = Date.parse('2026-10-12T04:30:00Z');   // after the room's timers start

const SWAP_HEADERS = ['id', 'serviceType', 'status', 'requestedBookTitle', 'securityDeposit', 'ownerDeposit', 'amount', 'swapPreference', 'createdAt', 'updatedAt', 'requesterEmail', 'ownerEmail'];
const CHAT_HEADERS = ['chatId', 'bookId', 'ownerEmail', 'requesterEmail', 'adminEmail', 'chatStatus', 'createdAt', 'swapId'];

function makeEnv() {
  const sheets = {};
  const notifications = [];
  const chats = [];
  const emails = [];
  const openDisputes = {};
  let session = '';
  function makeSheet(headers) {
    const data = headers && headers.length ? [headers.slice()] : [];
    return {
      _data: data,
      getDataRange() { return { getValues: () => data.map(r => r.slice()) }; },
      appendRow(row) { data.push(row.slice()); },
      getRange(r, c) { return {
        setValue: (v) => { while (data[r - 1].length < c) data[r - 1].push(''); data[r - 1][c - 1] = v; }, getValue: () => data[r - 1][c - 1],
        setValues: (rows) => rows.forEach((row, i) => row.forEach((v, j) => { const rr = data[r - 1 + i]; while (rr.length < c + j) rr.push(''); rr[c - 1 + j] = v; })) }; },
      getLastRow() { return data.length; },
      getLastColumn() { return data[0] ? data[0].length : 0; }
    };
  }
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch() { throw new Error('no network'); } },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, putAll() {}, getAll: () => ({}) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    MailApp: { sendEmail() {} },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
    DriveApp: {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gs, ctx, { filename: 'appsscript.js' });
  // A clock the test controls (new Date() and Date.now()).
  vm.runInContext(`(function(){ const RealDate = Date; let fake = null;
    class FakeDate extends RealDate { constructor(...a) { if (a.length === 0 && fake !== null) super(fake); else super(...a); }
      static now() { return fake !== null ? fake : RealDate.now(); } }
    globalThis.Date = FakeDate; globalThis.__setNow = v => { fake = v; }; })()`, ctx);
  ctx.Utilities = {
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(str).digest()).map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 'sha256' },
    formatDate: (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ')
  };
  ctx.ScriptApp = { getOAuthToken: () => 'tok' };
  ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getHeaders: () => ({ Location: 'https://upload.example/s' }), getContentText: () => '' }) };
  Object.assign(ctx, {
    getOrCreateSheet(name, headers) {
      if (!sheets[name]) sheets[name] = makeSheet(headers);
      return sheets[name];
    },
    ensureSheetHeaders(sheet, headers) {
      if (!sheet._data.length) sheet._data.push([]);
      const current = sheet._data[0];
      headers.forEach(h => { if (current.indexOf(h) === -1) current.push(h); });
      return current.slice();
    },
    createNotification: (...args) => { notifications.push(args); return {}; },
    sendSwapSutraEmail: (m) => { emails.push(m); return true; },
    getAuthenticatedEmail: () => session,
    isAuthenticatedAdmin: () => session === 'swapsutra@gmail.com',
    sendChatMessage: (m) => { chats.push(m); return { success: true }; },
    swapHasOpenDispute: (id) => !!openDisputes[id],
    getOrCreateFolder: (name) => ({ getId: () => 'folder_' + name }),
    publicReaderName: (n, email) => ({ 'own@x.com': 'Asha Owner', 'req@x.com': 'Ravi Reader' })[email] || '',
    loadSwapForCirculation(id) {
      const s = sheets.SwapRequests; if (!s) return null;
      const headers = s._data[0];
      for (let r = 1; r < s._data.length; r++) {
        if (String(s._data[r][0]) !== String(id)) continue;
        const obj = {}; headers.forEach((h, i) => { obj[h] = s._data[r][i]; });
        return { rowIndex: r, headers, row: s._data[r], obj, ownerEmail: 'own@x.com', requesterEmail: 'req@x.com', sheet: s };
      }
      return null;
    },
  });
  const api = new Proxy({}, { get: (_, name) => (...args) => { ctx.__a = args; return JSON.parse(JSON.stringify(vm.runInContext(`${String(name)}.apply(null, __a)`, ctx) ?? null)); } });
  const env = {
    api, ctx, sheets, notifications, chats, emails, openDisputes,
    as(email) { session = email; },
    now(ms) { ctx.__setNow(ms); },
    addSwap(o) {
      env.lastId = o.id;
      const s = ctx.getOrCreateSheet('SwapRequests', SWAP_HEADERS);
      const full = Object.assign({ requesterEmail: 'req@x.com', ownerEmail: 'own@x.com', status: 'Accepted', requestedBookTitle: 'Dune', securityDeposit: 0, ownerDeposit: 0, amount: 0, swapPreference: '', createdAt: new Date(T0 - D), updatedAt: new Date(T0) }, o);
      s.appendRow(SWAP_HEADERS.map(h => full[h] !== undefined ? full[h] : ''));
      const c = ctx.getOrCreateSheet('Chats', CHAT_HEADERS);
      c.appendRow(['CHAT_' + o.id, 'B1', 'own@x.com', 'req@x.com', 'swapsutra@gmail.com', 'Active', new Date(T0), o.id]);
    },
    swapStatus(id) { const s = sheets.SwapRequests; const r = s._data.find(x => x[0] === id); return r[s._data[0].indexOf('status')]; },
    chatStatus(id) { const s = sheets.Chats; const r = s._data.find(x => x[s._data[0].indexOf('swapId')] === id); return r[s._data[0].indexOf('chatStatus')]; },
    video(swapId, leg, kind, email, at) {
      const s = ctx.getOrCreateSheet('ExchangeVideos', vm.runInContext('VMS_VIDEO_HEADERS', ctx));
      const h = ctx.ensureSheetHeaders(s, vm.runInContext('VMS_VIDEO_HEADERS', ctx));
      const rec = { id: 'V' + Math.random(), swapId, leg, kind, uploaderEmail: email, url: 'https://drive/' + kind, createdAt: new Date(at || T0), recordedInApp: 'true' };
      s.appendRow(h.map(k => rec[k] !== undefined ? rec[k] : ''));
    },
    approveAll(id) {
      env.as('req@x.com'); env.api.getExchangeRoom({ swapId: id }); // creates the fee rows
      const s = sheets.SecurityFeePayments; const h = s._data[0];
      s._data.forEach((r, i) => { if (i && r[h.indexOf('swapId')] === id) { r[h.indexOf('adminStatus')] = 'ADMIN_APPROVED'; r[h.indexOf('paymentStatus')] = 'SUBMITTED'; } });
    },
    setFee(id, role, adminStatus) {
      const s = sheets.SecurityFeePayments; const h = s._data[0];
      s._data.forEach((r, i) => { if (i && r[h.indexOf('swapId')] === id && r[h.indexOf('payerRole')] === role) { r[h.indexOf('adminStatus')] = adminStatus; } });
    },
    payouts(id) { const s = sheets.ReturnForfeits; if (!s) return []; const h = s._data[0]; return s._data.slice(1).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; }).filter(o => o.swapId === id); },
    address(email) {
      const s = ctx.getOrCreateSheet('DeliveryAddresses', vm.runInContext('ADDRESS_HEADERS', ctx));
      const h = ctx.ensureSheetHeaders(s, vm.runInContext('ADDRESS_HEADERS', ctx));
      const rec = { id: 'A1', email, line1: '1 Road', pincode: '110001', phone: '9800000000' };
      s.appendRow(h.map(k => rec[k] !== undefined ? rec[k] : ''));
    }
  };
  env.now(T0);
  return env;
}
const act = (env, who, body) => { env.as(who); return env.api.exchangeRoomAction(body); };
const room = (env, who, id) => { env.as(who); return env.api.getExchangeRoom({ swapId: id || env.lastId }); };
const types = r => r.actions.map(a => a.type + (a.kind ? ':' + a.kind : '') + (a.leg ? '@' + a.leg : '')).join(',');
const step = (r, n) => r.steps.find(s => s.n === n);

let n = 0;
const C = (label, cond, d) => check((++n) + '. ' + label, cond, d);
const ADMIN = 'swapsutra@gmail.com';
const ad = (o) => Object.assign({ kind: 'bookstore', sponsor: 'Midland Books', headline: 'Saturday sale', tagline: '20% off',
  imageUrl: 'https://img.example/a.jpg', linkUrl: 'https://midland.example', placement: 'both', status: 'live' }, o || {});

console.log('--- Apps Script: saving ads ---');
{
  const env = makeEnv();
  env.as('req@x.com');
  C('Only the admin can save an ad', env.api.saveSponsoredAd(ad()).error === 'ADMIN_ONLY');
  C('Only the admin can list ads with their clicks', env.api.getAdminSponsoredAds().error === 'ADMIN_ONLY');
  C('Only the admin can upload an ad picture', env.api.uploadSponsoredAdImage({ dataUrl: 'data:image/png;base64,AAAA' }).error === 'ADMIN_ONLY');
  env.as(ADMIN);
  const bad = env.api.saveSponsoredAd({ kind: 'shop', sponsor: '', headline: '', imageUrl: 'http://x', linkUrl: 'javascript:alert(1)' });
  C('Bad input is refused field by field', !bad.success && ['kind', 'sponsor', 'headline', 'imageUrl', 'linkUrl'].every(k => bad.errors[k]), JSON.stringify(bad.errors));
  C('An ad needs a picture', env.api.saveSponsoredAd(ad({ imageUrl: '' })).errors.imageUrl);
  C('The end date cannot be before the start date', env.api.saveSponsoredAd(ad({ startDate: '2026-10-20', endDate: '2026-10-10' })).errors.endDate);
  const ok = env.api.saveSponsoredAd(ad());
  C('A bookstore ad is saved', ok.success && /^AD-/.test(ok.id), JSON.stringify(ok));
  const book = env.api.saveSponsoredAd(ad({ kind: 'book', sponsor: 'Penguin', headline: 'New Ruskin Bond', linkUrl: '', bookId: 'BK42', placement: 'shelf' }));
  C('A book ad may open a SwapSutra listing instead of a link', book.success, JSON.stringify(book));
  C('...but an author ad needs a link', env.api.saveSponsoredAd(ad({ kind: 'author', linkUrl: '', bookId: 'BK42' })).errors.linkUrl);
  const list = env.api.getAdminSponsoredAds();
  C('The admin sees both, with clicks and "showing now"', list.success && list.items.length === 2 && list.items.every(i => i.clicks === 0 && i.showingNow === true));
  const edited = env.api.saveSponsoredAd(Object.assign({}, list.items.find(i => i.id === ok.id), { headline: 'Sunday sale' }));
  C('Editing keeps the same ad', edited.success && edited.id === ok.id && env.api.getAdminSponsoredAds().items.find(i => i.id === ok.id).headline === 'Sunday sale');
  env.api.saveSponsoredAd({ id: book.id, status: 'removed' });
  C('Removing hides it from the admin list (the row is kept)', env.api.getAdminSponsoredAds().items.length === 1 && env.sheets.SponsoredAds._data.length === 3);
  C('Saving a missing ad is refused', env.api.saveSponsoredAd(ad({ id: 'AD-NOPE' })).success === false);
}

console.log('--- Apps Script: what the site gets ---');
{
  const env = makeEnv();
  env.as(ADMIN);
  const live = env.api.saveSponsoredAd(ad({ headline: 'Live one' })).id;
  const paused = env.api.saveSponsoredAd(ad({ headline: 'Paused one', status: 'paused' })).id;
  env.api.saveSponsoredAd(ad({ headline: 'Starts later', startDate: '2026-11-01' }));
  env.api.saveSponsoredAd(ad({ headline: 'Ended', endDate: '2026-10-01' }));
  // T0 = 12 Oct 10:00 IST: a window of exactly today counts.
  env.api.saveSponsoredAd(ad({ headline: 'Today only', startDate: '2026-10-12', endDate: '2026-10-12', placement: 'banner' }));
  env.as('');
  const pub = env.api.getSponsoredAds();
  C('Visitors get only live ads inside their dates', pub.success && pub.items.map(a => a.headline).sort().join() === 'Live one,Today only', JSON.stringify(pub.items.map(a => a.headline)));
  C('...without click counts or who made them', pub.items.every(a => a.clicks === undefined && a.createdBy === undefined && a.status === undefined));
  C('...with where each one shows', pub.items.find(a => a.headline === 'Today only').placement === 'banner');
  env.now(Date.parse('2026-10-12T19:00:00Z')); // 13 Oct 00:30 IST
  C('The date runs on India time (a one-day ad ends at midnight IST)', env.api.getSponsoredAds().items.length === 1);
  env.now(T0);
  C('A click is counted', env.api.recordAdClick({ id: live }).success === true && env.api.recordAdClick({ id: live }).success === true);
  env.as(ADMIN);
  C('...and the admin sees 2 clicks', env.api.getAdminSponsoredAds().items.find(i => i.id === live).clicks === 2);
  env.as('');
  C('A paused ad does not count clicks', env.api.recordAdClick({ id: paused }).success === false);
  C('An unknown id is ignored', env.api.recordAdClick({ id: 'AD-X' }).success === false && env.api.recordAdClick({}).success === false);
}

console.log('--- Apps Script: the ad picture ---');
{
  const env = makeEnv();
  const files = [];
  env.ctx.DriveApp = { Access: { ANYONE_WITH_LINK: 'A' }, Permission: { VIEW: 'V' } };
  env.ctx.getOrCreateFolder = (name) => ({ createFile: (blob) => { files.push({ name, blob }); return { setSharing() {}, getId: () => 'FILE1' }; } });
  env.ctx.Utilities.base64Decode = (s) => Buffer.from(s, 'base64');
  env.ctx.Utilities.newBlob = (bytes, type, name) => ({ bytes, type, name });
  env.as(ADMIN);
  C('Only JPG / PNG / WebP pictures are accepted', env.api.uploadSponsoredAdImage({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }).success === false);
  const big = 'data:image/jpeg;base64,' + Buffer.alloc(2.2 * 1024 * 1024).toString('base64');
  C('A picture over 2 MB is refused', env.api.uploadSponsoredAdImage({ dataUrl: big }).success === false);
  const up = env.api.uploadSponsoredAdImage({ dataUrl: 'data:image/png;base64,' + Buffer.from('png').toString('base64') });
  C('A picture is saved in the SwapSutra_Ads folder and a link comes back', up.success && /thumbnail\?id=FILE1/.test(up.url) && files[0].name === 'SwapSutra_Ads', JSON.stringify(up));
}

console.log('--- the shelf mixer (src/utils/ads.ts) ---');
const ts = require(path.join(root, 'node_modules', 'typescript'));
function loadTs(rel, stubs) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const out = ts.transpileModule(src, { fileName: rel, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', out)((p) => stubs[p] || require(p), mod, mod.exports);
  return mod.exports;
}
const A = loadTs('src/utils/ads.ts', { '../config/runtime': { apiUrl: (p) => p } });
{
  const books = Array.from({ length: 23 }, (_, i) => ({ id: 'b' + i }));
  const mugs = [{ id: 'm1' }, { id: 'm2' }];
  const ads = [{ id: 'a1', placement: 'both' }, { id: 'a2', placement: 'shelf' }];
  const s1 = A.mixShelf(books, mugs, ads, 111);
  const bookIds = s1.filter(x => x.type === 'book').map(x => x.book.id);
  C('Every book is on the shelf exactly once', bookIds.length === 23 && new Set(bookIds).size === 23);
  C('Books are shuffled', bookIds.join() !== books.map(b => b.id).join());
  C('The same visit (same seed) keeps the same order', JSON.stringify(A.mixShelf(books, mugs, ads, 111)) === JSON.stringify(s1));
  const s2 = A.mixShelf(books, mugs, ads, 222);
  C('A new visit (new seed) gives a new order', s2.filter(x => x.type === 'book').map(x => x.book.id).join() !== bookIds.join());
  const extras = s1.filter(x => x.type !== 'book');
  C('A mug or an ad comes after every 5 books (4 here, none at the very end)', extras.length === 4 && s1[s1.length - 1].type === 'book', s1.map(x => x.type[0]).join(''));
  C('...between books, never two extras together', s1.every((x, i) => x.type === 'book' || (s1[i - 1] && s1[i - 1].type === 'book' && s1[i + 1] && s1[i + 1].type === 'book')));
  C('Both mugs and ads appear, taking turns', extras.some(x => x.type === 'mug') && extras.some(x => x.type === 'ad') && extras.every((x, i) => i === 0 || x.type !== extras[i - 1].type), extras.map(x => x.type).join());
  C('Keys are unique (React)', new Set(s1.map(x => x.key)).size === s1.length);
  const near = A.mixShelf(books, mugs, ads, 111, { keepBookOrder: true });
  C('"Near me" keeps the nearest-first order (extras still added)', near.filter(x => x.type === 'book').map(x => x.book.id).join() === books.map(b => b.id).join() && near.length === 27);
  C('Only ads, no mugs: ads fill the gaps', A.mixShelf(books, [], ads, 5).filter(x => x.type !== 'book').every(x => x.type === 'ad'));
  C('Only mugs, no ads: mugs fill the gaps', A.mixShelf(books, mugs, [], 5).filter(x => x.type !== 'book').every(x => x.type === 'mug'));
  C('No books: no mugs or ads either', A.mixShelf([], mugs, ads, 5).length === 0);
  C('A short shelf (3 books) still gets one ad', A.mixShelf(books.slice(0, 3), mugs, ads, 5).filter(x => x.type === 'ad').length === 1);
  C('Ads choose banner / shelf', A.adShowsOn({ placement: 'both' }, 'banner') && A.adShowsOn({ placement: 'shelf' }, 'shelf') && !A.adShowsOn({ placement: 'shelf' }, 'banner'));
  C('A Google Drive share link becomes a picture link', A.adImageSrc('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing') === 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz&sz=w1600');
  const cta = (k) => A.adCta({ kind: k, ctaLabel: '' });
  C('Default button words per kind', cta('bookstore') === 'Visit the store' && cta('author') === 'Meet the author' && cta('book') === 'See the book');
}

console.log('--- the site ---');
{
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const app = read('src/App.tsx'), hero = read('src/components/LibraryHero.tsx'), comp = read('src/components/SponsoredAds.tsx');
  const admin = read('src/components/AdminSponsoredAds.tsx');
  C('The Library banner shows the banner ads (the walking book unrolls them)', /if \(ads\.length\) return ads\.map\(\(a\) => adToSlide\(a, onOpenAdBook\)\)/.test(hero) && /<MascotBanner mascot="book" slides=\{bannerSlides\}/.test(hero) && /ads=\{bannerAds\}/.test(app));
  C('The shelf renders books, ads and mugs from the mixed list', /shelfItems\.map\(\(item\) => item\.type === 'book'/.test(app) && /<ShelfAdCard /.test(app) && /<ShelfMugCard /.test(app) && /shelfFillers\(shelfItems\.length/.test(app));
  C('A new shuffle every time the Library is opened', /if \(activeTab !== 'browse'\) return;\s*setShelfSeed\(newShelfSeed\(\)\);/.test(app));
  C('Searching shows only matching books', /const quiet = search\.trim\(\)\.length > 0;/.test(app));
  C('Shelf ads say "Sponsored" and link out as sponsored', /Sponsored<\/span>/.test(comp) && /rel="sponsored noopener noreferrer"/.test(comp));
  const mascot = read('src/components/MascotBanner.tsx');
  C('The banner pauses on hover/focus and for reduced motion', /prefers-reduced-motion: reduce/.test(mascot) && /onMouseEnter=\{\(\) => setPaused\(true\)\}/.test(mascot));
  C('Every ad slide is marked Sponsored and links out as sponsored', /sponsored: true,/.test(comp) && /rel=\{s\.sponsored \? 'sponsored noopener noreferrer'/.test(mascot) && /<span className="ss-ad__chip">Sponsored<\/span>/.test(mascot));
  C('A mug on the shelf opens the mug shop', /onOpen=\{\(\) => navigateTo\('mugs'\)\}/.test(app));
  C('Admin has an Ads tab', /id: 'sponsoredAds', label: 'Ads'/.test(app) && /tab === 'sponsoredAds' && <AdminSponsoredAds \/>/.test(app) && /import\('\.\/components\/AdminSponsoredAds'\)/.test(admin.length ? app : ''));
  C('The admin form covers bookstore / author / book, picture, link, listing, where, dates', ['"bookstore"', '"author"', '"book"', "'uploadSponsoredAdImage'", "field('linkUrl'", "field('bookId'", "set('placement')", "field('startDate'", "field('endDate'"].every(s => admin.includes(s)));
  const T = loadTs('src/components/AdminSponsoredAds.tsx', { react: { createElement() {}, useEffect() {}, useMemo() {}, useState() {} }, '../config/runtime': { apiUrl: (p) => p }, '../utils/imageCompress': {}, '../utils/ads': {} });
  C('A pasted SwapSutra book link gives the listing id', T.bookIdFromInput('https://swapsutra.in/book/BK42') === 'BK42' && T.bookIdFromInput('BK42') === 'BK42' && T.bookIdFromInput('not an id!') === '');
  for (const p of ['api/swapsutra.ts', 'server.ts']) C(`${p} lets visitors fetch ads and count a click`, /'getSponsoredAds', 'recordAdClick'/.test(read(p)));
  C('Apps Script routes every ad action', ['getSponsoredAds', 'recordAdClick', 'getAdminSponsoredAds', 'saveSponsoredAd', 'uploadSponsoredAdImage'].every(a => gs.includes(`action === '${a}'`)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
