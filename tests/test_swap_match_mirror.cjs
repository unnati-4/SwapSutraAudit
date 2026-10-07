/**
 * test_swap_match_mirror.cjs  (Oct 2026)
 *
 * src/utils/swapMatch.ts (what the swap form greys out) must agree with
 * swapBooksMatch_ in appsscript.js (what actually decides) on every case,
 * and the new screens must be wired to the server's rules.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

let pass = 0, fail = 0;
const check = (label, cond, detail) => { if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); } };
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const mod = { exports: {} };
vm.runInNewContext(esbuild.transformSync(read('src/utils/swapMatch.ts'), { loader: 'ts', format: 'cjs' }).code, { module: mod, exports: mod.exports });
const client = mod.exports;

const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Logger: { log() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) } });
vm.runInContext(read('appsscript.js'), ctx);
// The server resolves a book's value (effectiveBookMRP), falling back to a
// catalogue estimate; the Library payload sends that same figure to the app
// as effectiveMRP, which is what the client rule reads first. Here the
// payload's figure stands in for the catalogue lookup.
ctx.effectiveBookMRP = (b) => (Number(b && b.effectiveMRP) > 0 ? Number(b.effectiveMRP) : null);
const server = (a, b) => { ctx.__a = a; ctx.__b = b; return vm.runInContext('swapBooksMatch_(__a, __b)', ctx); };

console.log('--- the swap form agrees with the server ---');
const conditions = ['Like New', 'Good', 'Fair', 'Very Good', 'Poor'];
const types = [
  { bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER' }, { bookFormat: 'HARDCOVER', bookEdition: 'PUBLISHER' },
  { bookFormat: 'PAPERBACK', bookEdition: 'REPRINT' }, { bookFormat: 'Hardback', bookEdition: '' },
  { bookFormat: 'Softcover', bookEdition: '' },
];
const mrps = [500, 450, 449, 551, 556, null];
let cases = 0, disagreements = [];
for (const ca of conditions.slice(0, 3)) for (const cb of conditions) for (const ta of types.slice(0, 3)) for (const tb of types) for (const mb of mrps) {
  const a = { id: 'a', condition: ca, ...ta, userEnteredMRP: 500, pricingSource: 'USER', effectiveMRP: 500 };
  const b = { id: 'b', condition: cb, ...tb, userEnteredMRP: mb, pricingSource: mb ? 'USER' : '', effectiveMRP: mb };
  const s = server(a, b), c = client.swapMatch(a, b);
  cases++;
  if (s.ok !== c.ok || JSON.stringify([...s.reasons].sort()) !== JSON.stringify([...c.reasons].sort())) disagreements.push({ ca, cb, ta, tb, mb, s: s.reasons, c: c.reasons });
}
check(`1. Same verdict and same reasons on all ${cases} combinations`, disagreements.length === 0, JSON.stringify(disagreements.slice(0, 3)));
check('2. ±10% is measured the same way (₹500 vs ₹450 ok, ₹449 not)',
  client.swapMatch({ condition: 'Good', bookFormat: 'PAPERBACK', mrp: 500 }, { condition: 'Good', bookFormat: 'PAPERBACK', mrp: 450 }).ok
  && !client.swapMatch({ condition: 'Good', bookFormat: 'PAPERBACK', mrp: 500 }, { condition: 'Good', bookFormat: 'PAPERBACK', mrp: 449 }).ok);

console.log('--- the screens use the server rules ---');
const app = read('src/App.tsx');
const tracker = read('src/components/CirculationTracker.tsx');
check('3. Listing form sends the owner\'s sell price and monthly rent', /sellPrice: listingStatuses\.sell && listingSellPrice !== ''/.test(app) && /rentPerMonth: listingStatuses\.rent && listingRentPrice !== ''/.test(app));
check('4. ...and refuses to submit a sale or rental without one', /Enter the price you want to sell this book for\./.test(app) && /Enter the rent you want per month for this book\./.test(app));
check('5. Rent starts at a 10%-of-MRP suggestion', /Math\.round\(listingMrpNumber \* 0\.10\)/.test(app));
check('6. Owners can change their prices when editing', /sellPrice: \(book as any\)\.ownerSellPrice/.test(app) && /placeholder="Your rent per month/.test(app));
check('7. Book detail shows the owner\'s prices', /Owner's price · no deposit/.test(app) && /return in 21 days/.test(app));
check('8. Swap form greys out books that don\'t match', /disabled=\{!m\.ok\}/.test(app) && /swapMatch\(showSwapModal as any, b as any\)/.test(app));
check('9. Return rule shown before a rental or temporary swap is requested',
  /\{showServiceModal\.serviceType === 'RENT' && <ReturnRuleNotice \/>\}/.test(app) && /\{swapFormPreference === 'Temporary' && <ReturnRuleNotice \/>\}/.test(app));
check('10. Nearby radius is the reader\'s choice', /dist <= nearbyRadiusKm/.test(app) && /NEARBY_RADIUS_CHOICES = \[2, 5, 10, 25, 50, 100\]/.test(app) && !/dist <= 25\b/.test(app));
check('11. Chat can send a map pin, and shows pins as maps', /action: 'shareChatLocation'/.test(app) && /m\.mediaType === 'location' && parseGeoUrl/.test(app));
check('12. Delivery panel: route first, either reader, pin or courier', /action: 'setSwapRoute'/.test(tracker) && /meetingLat: pin\?\.lat/.test(tracker) && /Agree the route first/.test(tracker));
check('13. Courier shows both addresses and phone numbers', /isCourier && \(/.test(tracker) && /Phone: <a/.test(tracker));
check('14. Posting needs the courier and a tracking ID', /a\.event === 'dispatched' && \(!courierName \|\| !awb\.trim\(\)\)/.test(tracker));
check('15. Both books tracked in a swap', /case 'counter':/.test(tracker) && /case 'counter_return':/.test(tracker));
check('16. Return countdown with +7/+14 extension that the other reader must agree to',
  /action: 'requestReturnExtension'/.test(tracker) && /action: 'respondReturnExtension'/.test(tracker) && /ret\.pendingExtension\.youAsked/.test(tracker));
check('17. Admin can see and settle forfeited deposits', /<AdminReturnForfeits \/>/.test(app) && /adminMarkForfeitPaid/.test(read('src/components/AdminReturnForfeits.tsx')));
check('18. No "60%" deposit copy is left where readers can see it', !/60% of (original )?MRP|60% refundable|60% MRP/.test(app) && !/up to 60%/.test(read('src/components/LegalPages.tsx')));
check('19. GET route exists for the return status the panel reads', /if \(action === 'getReturnStatus'\) return respondJson\(getReturnStatus\(e\.parameter\)\);/.test(read('appsscript.js')));

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail === 0 ? 0 : 1);
