/**
 * tests/test_seo.cjs — search-engine basics (18 Oct 2026).
 *
 * Builds the per-page HTML from the plain index.html in a temporary folder
 * and checks each page has its own title, description, canonical link and
 * exactly one H1; that robots.txt lets Google read the sitemap and the data
 * the pages load; that vercel.json routes /sitemap.xml and /book/<id> and
 * sends www to the one host; and that a book page gets its own head.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ts = require('typescript');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const C = (label, cond, detail) => { if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); } };

function loadTs(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  const req = (p) => (p === '../src/seo/pages' ? loadTs('src/seo/pages.ts') : require(p));
  new Function('require', 'module', 'exports', out)(req, m, m.exports);
  return m.exports;
}
const seo = loadTs('src/seo/pages.ts');

// 1. The prerendered pages
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-'));
fs.mkdirSync(path.join(tmp, 'dist'));
fs.copyFileSync(path.join(root, 'index.html'), path.join(tmp, 'dist', 'index.html'));
execFileSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'scripts/prerender-seo.ts')], { cwd: tmp, stdio: 'pipe' });
const pageFile = (p) => path.join(tmp, 'dist', p === '/' ? 'index.html' : p.slice(1) + '/index.html');
const titles = new Set(), descs = new Set();
let allOk = true, detail = '';
for (const p of seo.SEO_PAGES) {
  const html = fs.readFileSync(pageFile(p.path), 'utf8');
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  const canon = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  if (h1s !== 1 || !title || !desc || !canon || !/^https:\/\/swapsutra\.in\//.test(canon) || desc.length > 170 || /<div id="root"><\/div>/.test(html)) { allOk = false; detail += p.path + ' '; }
  if (p.inSitemap) { titles.add(title); descs.add(desc); }
}
const indexed = seo.SEO_PAGES.filter((p) => p.inSitemap).length;
C('Every public page is served with its own title, description, canonical link, one H1 and real text', allOk, detail);
C('…and no two indexed pages share a title or a description', titles.size === indexed && descs.size === indexed);
const home = fs.readFileSync(pageFile('/'), 'utf8');
C('The home page says who runs SwapSutra (Organization + WebSite data)', /"@type":"Organization"/.test(home) && /"@type":"WebSite"/.test(home) && /Unnati Goyal/.test(home));
const support = fs.readFileSync(pageFile('/support'), 'utf8');
C('The Support page carries its FAQ as structured data and as visible text', /"@type":"FAQPage"/.test(support) && /Is SwapSutra free to join\?/.test(support.replace(/<script[\s\S]*?<\/script>/g, '')));
C('Inner pages have breadcrumbs', /"@type":"BreadcrumbList"/.test(fs.readFileSync(pageFile('/partners'), 'utf8')) && /aria-label="Breadcrumb"/.test(fs.readFileSync(pageFile('/partners'), 'utf8')));
C('Every page links to every other public page (no orphans)', seo.SEO_PAGES.filter((p) => p.inSitemap).every((p) => home.includes(`href="${p.path}"`)));
C('Duplicate addresses point at one canonical (/library → /, /community → /reading-room)',
  /rel="canonical" href="https:\/\/swapsutra\.in\/"/.test(fs.readFileSync(pageFile('/library'), 'utf8')) && /href="https:\/\/swapsutra\.in\/reading-room"/.test(fs.readFileSync(pageFile('/community'), 'utf8')));
C('Every image in the served pages has alt text', seo.SEO_PAGES.every((p) => (fs.readFileSync(pageFile(p.path), 'utf8').match(/<img\b[^>]*>/g) || []).every((t) => /\balt="[^"]+"/.test(t))));
C('The plain app shell is kept for every other address', fs.existsSync(path.join(tmp, 'dist', 'app.html')) && !/rel="canonical"/.test(fs.readFileSync(path.join(tmp, 'dist', 'app.html'), 'utf8')));
C('Nothing tells Google not to index the public pages', seo.SEO_PAGES.every((p) => !/noindex/.test(fs.readFileSync(pageFile(p.path), 'utf8'))));

// 2. robots.txt, sitemap and routing
const robots = fs.readFileSync(path.join(root, 'public/robots.txt'), 'utf8');
C('robots.txt lets Google read the sitemap and the data pages load', /Allow: \/api\/sitemap/.test(robots) && /Allow: \/api\/swapsutra/.test(robots) && /Sitemap: https:\/\/swapsutra\.in\/sitemap\.xml/.test(robots));
C('…and does not block the public pages', !/Disallow: \/\s*$/m.test(robots) && !/Disallow: \/(library|partners|syllabus|plot|book)\b/.test(robots));
const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const srcs = vj.rewrites.map((r) => r.source);
C('/sitemap.xml and /book/<id> are routed before the catch-all', srcs.indexOf('/sitemap.xml') !== -1 && srcs.indexOf('/book/:id') !== -1 && srcs.indexOf('/:path*') === srcs.length - 1
  && vj.rewrites.find((r) => r.source === '/book/:id').destination.startsWith('/api/book-page') && vj.rewrites[srcs.length - 1].destination === '/app.html');
C('www.swapsutra.in sends readers to swapsutra.in in one step', (vj.redirects || []).some((r) => r.has && r.has[0].value === 'www.swapsutra.in' && r.destination === 'https://swapsutra.in/:path*' && r.permanent));
C('API answers are kept out of search results by header', vj.headers.some((h) => h.source === '/api/:path*' && h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value))));
const sm = fs.readFileSync(path.join(root, 'api/sitemap.ts'), 'utf8');
const smPaths = [...sm.matchAll(/\{ path: '([^']+)'/g)].map((m) => m[1]).sort();
const wantPaths = seo.SEO_PAGES.filter((p) => p.inSitemap).map((p) => p.path).sort();
C('The sitemap lists exactly the indexed pages, on the one host', JSON.stringify(smPaths) === JSON.stringify(wantPaths) && /const SITE_URL = 'https:\/\/swapsutra\.in'/.test(sm) && !/www\.swapsutra\.in/.test(sm) && seo.SITE_ORIGIN === 'https://swapsutra.in', JSON.stringify(smPaths));
C('The book-page function imports packages only (Vercel cannot load ./files)', !/from '\.\.?\//.test(fs.readFileSync(path.join(root, 'api/book-page.ts'), 'utf8')) && !/from '\.\.?\//.test(sm));

// 3. Book pages
const bp = loadTs('api/book-page.ts');
const shell = fs.readFileSync(path.join(tmp, 'dist', 'app.html'), 'utf8');
const html = bp.renderBookPage(shell, { id: 'SS_BOOK_1', title: 'Wings of <Fire>', author: 'A P J Abdul Kalam', condition: 'As New', sell: 'TRUE', lend: 'TRUE', ownerSellPrice: 250,
  isbn: '978-81-7371-146-6', genre: 'Biography', area: 'Hazratganj', imageUrls: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view', sellerName: 'Gomti Library' });
C('A book page gets its own title and description', /<title>Wings of &lt;Fire&gt; by A P J Abdul Kalam — Borrow or buy on SwapSutra<\/title>/.test(html) && /content="Wings of &lt;Fire&gt;[^"]*Hazratganj[^"]*₹250/.test(html), (html.match(/<title>[^<]*/) || [])[0]);
C('…its canonical link, one H1 and the cover with alt text', /rel="canonical" href="https:\/\/swapsutra\.in\/book\/SS_BOOK_1"/.test(html) && (html.match(/<h1[\s>]/g) || []).length === 1
  && /<img src="https:\/\/drive\.google\.com\/thumbnail\?id=1AbCdEfGhIjKlMnOpQrStUvWx&amp;sz=w800" alt="Cover of Wings of &lt;Fire&gt;/.test(html));
const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const book = ld.find((x) => x['@type'] === 'Book');
C('…and Book data with the ISBN, author and price (and breadcrumbs)', book && book.isbn === '9788173711466' && book.author.name === 'A P J Abdul Kalam' && book.offers.price === '250' && book.offers.priceCurrency === 'INR'
  && ld.some((x) => x['@type'] === 'BreadcrumbList'), JSON.stringify(book));
C('The app\'s scripts are untouched, so readers get the same app', (shell.match(/<script type="module"[^>]*>/g) || []).every((t) => html.includes(t)));

// 4. The app keeps the head in step
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
C('The app updates title, description and canonical as readers move between pages', /seoForPath\(path\)/.test(app) && /link\[rel="canonical"\]/.test(app));
C('The splash screen has no H1 and is skipped for search engines', !/<h1[^>]*>SwapSutra<\/h1>/.test(app) && /bot\|crawl\|spider/.test(app));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
