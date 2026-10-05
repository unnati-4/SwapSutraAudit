/**
 * test_mug_filters.cjs  (Oct 2026)
 *
 * The mug shelf's price ranges, "on sale", seller filter and sort order,
 * tested against the shipped src/utils/mugFilters.ts, plus the wiring in
 * MugsPage.tsx.
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

const mod = { exports: {} };
vm.runInNewContext(esbuild.transformSync(read('src/utils/mugFilters.ts'), { loader: 'ts', format: 'cjs' }).code, { module: mod, exports: mod.exports });
const F = mod.exports;

const mug = (id, price, extra = {}) => ({
  id, title: id, description: '', category: 'bookish', imageUrl: '', price, mrp: null, currency: 'INR',
  availability: '', sourceMarketplace: '', sourceUrl: '', affiliateUrl: '', vendor: '',
  rating: null, ratingCount: null, ratingSource: '', ...extra,
});
const shelf = [
  mug('a', 499),
  mug('b', 299, { sourceMarketplace: 'Amazon' }),
  mug('c', 899, { mrp: 1099, sourceMarketplace: 'Flipkart' }),
  mug('d', null),
  mug('e', 1200, { mrp: 2400, sourceMarketplace: 'Amazon' }),
  mug('f', 399),
  mug('g', 400),
];
const ids = (list) => list.map((p) => p.id).join(',');
const run = (patch) => F.applyMugFilters(shelf, { ...F.EMPTY_FILTERS, ...patch });

console.log('--- price ranges ---');
check('1. No filters: the whole shelf, in the admin\'s order', ids(run({})) === 'a,b,c,d,e,f,g');
check('2. Under ₹400 (399 included, 400 not)', ids(run({ bandId: 'under-400' })) === 'b,f', ids(run({ bandId: 'under-400' })));
check('3. ₹400 – ₹699', ids(run({ bandId: '400-699' })) === 'a,g');
check('4. ₹700 – ₹999', ids(run({ bandId: '700-999' })) === 'c');
check('5. ₹1,000 & above', ids(run({ bandId: '1000-plus' })) === 'e');
check('6. A mug with no price never appears in a price range', !Object.values(F.PRICE_BANDS).some((b) => run({ bandId: b.id }).some((p) => p.id === 'd')));
check('7. Counts per range', JSON.stringify(F.bandCounts(shelf, F.EMPTY_FILTERS)) === JSON.stringify({ 'under-400': 2, '400-699': 2, '700-999': 1, '1000-plus': 1 }));
check('8. Range counts follow the other filters (Amazon only)',
  JSON.stringify(F.bandCounts(shelf, { ...F.EMPTY_FILTERS, seller: 'Amazon' })) === JSON.stringify({ 'under-400': 1, '400-699': 0, '700-999': 0, '1000-plus': 1 }));

console.log('--- sort ---');
check('9. Price low to high, unpriced last', ids(run({ sort: 'price-asc' })) === 'b,f,g,a,c,e,d', ids(run({ sort: 'price-asc' })));
check('10. Price high to low, unpriced still last', ids(run({ sort: 'price-desc' })) === 'e,c,a,g,f,b,d', ids(run({ sort: 'price-desc' })));
check('11. Biggest discount first (50% before 18%)', run({ sort: 'discount' })[0].id === 'e' && run({ sort: 'discount' })[1].id === 'c');
check('12. Sorting never drops a mug', run({ sort: 'price-asc' }).length === shelf.length);
check('13. Sorting does not reorder the original list', ids(shelf) === 'a,b,c,d,e,f,g');

console.log('--- on sale and seller ---');
check('14. On sale: only mugs with a real MRP above price', ids(run({ onSale: true })) === 'c,e');
check('15. Seller: Amazon', ids(run({ seller: 'Amazon' })) === 'b,e');
check('16. Seller: SwapSutra\'s own listings', ids(run({ seller: '' })) === 'a,d,f,g');
check('17. Sellers listed in the order first seen', JSON.stringify(F.sellersOn(shelf)) === JSON.stringify(['', 'Amazon', 'Flipkart']));
check('18. Filters combine (Amazon + on sale + ₹1,000 & above)', ids(run({ seller: 'Amazon', onSale: true, bandId: '1000-plus' })) === 'e');
check('19. "Active" ignores the sort order', !F.filtersActive({ ...F.EMPTY_FILTERS, sort: 'price-asc' }) && F.filtersActive({ ...F.EMPTY_FILTERS, onSale: true }));

console.log('--- the page ---');
const page = read('src/components/mugs/MugsPage.tsx');
check('20. The page filters the category it is showing', /applyMugFilters\(inCategory, filters\)/.test(page));
check('21. Price chips hide empty ranges (unless chosen)', /counts_\[b\.id\] > 0 \|\| filters\.bandId === b\.id/.test(page));
check('22. Chips announce their state to screen readers', /aria-pressed=\{filters\.bandId === b\.id\}/.test(page));
check('23. A sort control exists', /<select value=\{filters\.sort\}/.test(page));
check('24. Filters that match nothing say so and offer a way back', /No mugs match these filters\./.test(page) && /Clear filters/.test(page));
check('25. "Biggest discount" is only offered when something is on sale', /o\.id !== 'discount' \|\| anyOnSale/.test(page));

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed === 0 ? 0 : 1);
