/**
 * test_add_to_cart.cjs  (8 Oct 2026, owner's request)
 * The book detail has ONE action — "Add to cart" — which opens only the
 * ways this owner offers the book (swap / rent / buy), each leading to
 * the existing request flow.
 */
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
let pass = 0, fail = 0;
const check = (l, c) => { if (c) { pass++; console.log('PASS  ' + l); } else { fail++; console.log('FAIL  ' + l); } };
const block = app.slice(app.indexOf('data-testid="add-to-cart"') - 4000, app.indexOf('data-testid="add-to-cart"') + 3000);

check('1. One "Add to cart" button', (app.match(/<Icons\.ShoppingCart size=\{16\} \/> Add to cart/g) || []).length === 1);
check('2. The three old buttons are gone', !/>\s*Request to Swap\s*</.test(app) && !/Express Rent Interest/.test(app) && !/Express Buy Interest/.test(app));
check('3. Swap only if the owner offers a swap', /if \(canRequestExchange\) \{\s*options\.push\(\{\s*key: 'SWAP'/.test(block));
check('4. Rent only if the owner offers rent, with their price', /if \(availability\.rent\) \{[^]*?book\.monthlyRent/.test(block));
check('5. Buy only if the owner offers it for sale, with their price', /if \(availability\.sell\) \{[^]*?book\.sellPrice/.test(block));
check('6. Nothing offered: says so instead of an empty cart', /if \(!options\.length\)[^]*?here for discovery, not exchange/.test(block));
check('7. Each choice opens the existing flow', /if \(o\.key === 'SWAP'\) setShowSwapModal\(book\);\s*else setShowServiceModal\(\{ book, serviceType: o\.key \}\);/.test(block));
check('8. Signed out: sign in first, remembering the book', /if \(!activeUserEmail\) \{[^]*?signalBookInterest\(book\);[^]*?onShowLoginModal\(true\);/.test(block));
check('9. The options are announced to screen readers', /aria-expanded=\{cartOpen\}/.test(block) && /aria-controls="add-to-cart-options"/.test(block));
check('10. The menu closes when another book opens', /useEffect\(\(\) => \{ setCartOpen\(false\); \}, \[book\?\.id\]\);/.test(app));
console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail === 0 ? 0 : 1);
