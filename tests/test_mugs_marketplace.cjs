/**
 * test_mugs_marketplace.cjs  (30 Sep 2026) — /mugs wiring and honesty rules.
 */
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('src/App.tsx');
const page = read('src/components/mugs/MugsPage.tsx');
const card = read('src/components/mugs/MugProductCard.tsx');
const cats = read('src/data/mugCategories.ts');

check('1. /mugs (and /coffee-mugs) is a route, and the tab maps back to /mugs', /'\/mugs': 'mugs'/.test(app) && /'\/coffee-mugs': 'mugs'/.test(app) && /mugs: '\/mugs'/.test(app));
check('2. It is public (no sign-in wall)', /GATE_ALLOWED_TABS: AppTab\[\] = \[[^\]]*'mugs'/.test(app));
// 30 Sep: header, menu and bottom bar all read one PRIMARY_NAV list.
check('3. "Mugs" is in the primary navigation (header + menu)', /\{ key: 'mugs', label: 'Mugs' \}/.test(app) && /PRIMARY_NAV\.map/.test(app) && /PRIMARY_NAV\.filter/.test(app));
check('4. The page and its admin screen load on demand', /import\('\.\/components\/mugs\/MugsPage'\)/.test(app) && /import\('\.\/components\/mugs\/AdminCustomMugs'\)/.test(app));
check('5. Admin has a Mugs tab (enquiries + shop listings)', /id: 'customMugs', label: 'Mugs'/.test(app) && /tab === 'customMugs' && \(\s*<AdminCustomMugs \/>/.test(app));
check('6. The six categories are data, not repeated markup', ['bookish', 'minimal', 'funny-reader', 'cafe-style', 'aesthetic', 'personalized'].every((c) => cats.includes(`id: '${c}'`)) && /MUG_CATEGORIES\.map/.test(page));
check('7. Hero copy and CTAs as briefed', page.includes('Mugs for people who take their coffee personally.') && page.includes('From quiet reading mornings to aggressively long TBRs.') && page.includes('>Browse Mugs<') && page.includes('>Create Your Mug<'));
check('8. "Have a mug idea?" section with the brief\'s copy and CTA', page.includes('Have a mug idea?') && page.includes('if you can describe it, we’ll help figure out how it could be made') && page.includes('>Create My Mug<'));
check('9. Empty shelf says "Products coming soon" instead of inventing products', page.includes('Products coming soon.'));
check('10. Sample data is DEVELOPMENT ONLY and behind import.meta.env.DEV', /if \(import\.meta\.env\.DEV && !items\.length\)/.test(page) && /DEVELOPMENT ONLY/.test(read('src/data/mugs.dev.ts')));
const dist = path.join(root, 'dist', 'assets');
if (fs.existsSync(dist)) {
  const all = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, f), 'utf8')).join('\n');
  check('11. The production build contains no sample products', !/DEV SAMPLE|Margin Notes Mug|DEV_SAMPLE_MUGS/.test(all));
} else console.log('SKIP: 11 (no dist — run the build first)');
check('12. Card: MRP/discount only when both prices exist; rating only with its source', /if \(!p\.price \|\| !p\.mrp \|\| p\.mrp <= p\.price\) return null/.test(card) && /product\.rating && product\.ratingSource/.test(card));
check('13. External purchases leave SwapSutra, marked sponsored', /target="_blank" rel="sponsored noopener noreferrer"/.test(card) && /Sold on \$\{p\.sourceMarketplace\}/.test(card));
check('14. Marketplace disclosure: sold and delivered by that marketplace, not by SwapSutra', page.includes('sold and delivered by that marketplace, not by SwapSutra'));
check('15. No fake urgency or social proof in the mug screens', !/only \d+ left|hurry|bestseller|customers bought|limited time/i.test(page + card + read('src/components/mugs/CustomMugEnquiry.tsx')));
check('16. The enquiry reuses the site\'s photo shrinker (no second copy)', /from '\.\.\/\.\.\/utils\/imageCompress'/.test(read('src/components/mugs/CustomMugEnquiry.tsx')) && !/canvas\.toBlob/.test(read('src/components/mugs/CustomMugEnquiry.tsx')));
check('17. Success is shown only from a server id', /if \(data\?\.success && data\.id\) \{\s*setDoneId/.test(read('src/components/mugs/CustomMugEnquiry.tsx')));

// 30 Sep: the admin lists mugs sold on Amazon / Flipkart by pasting the link.
const gs = read('appsscript.js');
const adm = read('src/components/mugs/AdminMugProducts.tsx');
const saveFn = gs.slice(gs.indexOf('function saveMugProduct('), gs.indexOf('function saveMugProduct(') + 5000);
check('18. Admin can add / edit / remove shop listings (admin-only)', /function getAdminMugProducts\(\)\s*\{\s*if \(!isAuthenticatedAdmin\(\)\)/.test(gs) && /function saveMugProduct\(data\)\s*\{\s*if \(!isAuthenticatedAdmin\(\)\)/.test(gs) && /action === 'saveMugProduct'/.test(gs) && /<AdminMugProducts \/>/.test(app));
eval(gs.match(/function mugMarketplaceFromUrl_[\s\S]*?\n}\n/)[0]);
check('19. Amazon and Flipkart links (and their short links) are recognised', mugMarketplaceFromUrl_('https://www.amazon.in/dp/X') === 'Amazon' && mugMarketplaceFromUrl_('https://amzn.to/x') === 'Amazon' && mugMarketplaceFromUrl_('https://www.flipkart.com/p/itm') === 'Flipkart' && mugMarketplaceFromUrl_('https://fkrt.it/x') === 'Flipkart' && mugMarketplaceFromUrl_('http://amazon.in/x') === '');
check('20. A listing needs a https product link, and a photo to go live', /errors\.sourceUrl = /.test(saveFn) && /status === 'live' && !imageUrl/.test(saveFn));
check('21. Ratings can never be typed in by the admin', /set\('rating', ''\); set\('ratingCount', ''\); set\('ratingSource', ''\);/.test(saveFn) && !/name="rating|'rating'|ratingSource/.test(adm));
check('22. Removing hides a mug (no hard delete)', /MUG_PRODUCT_STATUSES = \['live', 'draft', 'removed'\]/.test(gs) && !/deleteRow/.test(saveFn));
check('23. The shop opens by itself once one mug is live', /const shopOpen = loaded\.state === 'ready' && items\.length > 0;/.test(page) && !/MUG_SHOP_OPEN/.test(page));
check('24. The buy button names the store and opens it in a new tab', /Buy on \$\{product\.sourceMarketplace\}/.test(card) && /target="_blank" rel="sponsored noopener noreferrer"/.test(card));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
