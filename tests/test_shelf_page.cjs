/**
 * test_shelf_page.cjs  (7 Oct 2026, owner's request)
 * The Shelf page holds "My Book Shelf" and "My Reading Tracker";
 * the Profile page no longer does.
 */
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
let pass = 0, fail = 0;
const check = (l, c) => { if (c) { pass++; console.log('PASS  ' + l); } else { fail++; console.log('FAIL  ' + l); } };

const tabs = app.slice(app.indexOf('{(isShelfView\n                        ? ['), app.indexOf(').map((t) => (', app.indexOf('{(isShelfView\n                        ? [')));
const shelfTabs = tabs.slice(0, tabs.indexOf(': ['));
const profileTabs = tabs.slice(tabs.indexOf(': ['));
check('1. Shelf and tracker count as the Shelf page', /const isShelfView = activeProfileGroup === 'books' \|\| activeProfileGroup === 'tracker';/.test(app));
check('2. The Shelf page shows My Book Shelf and My Reading Tracker', /My Book Shelf/.test(shelfTabs) && /My Reading Tracker/.test(shelfTabs));
check('3. The Profile page no longer lists either', !/'books'|'tracker'/.test(profileTabs) && /Reading Space/.test(profileTabs) && /Settings/.test(profileTabs));
check('4. The bottom-nav "Shelf" lights up for both', /activeTab === 'profile' \? \(isShelfView \? 'shelf' : 'profile'\)/.test(app));
check('5. The Shelf page has its own heading, not "Reading Space"', /isShelfView \? \(\s*<>\s*<h2[^]*?Shelf<\/span>/.test(app));
check('6. The profile header card stays on the Profile page only', /\{!isShelfView && \(<>/.test(app));
check('7. Tapping Shelf opens My Book Shelf', /case 'shelf': setProfileActiveSubTab\('books'\); navigateTo\('profile'\); break;/.test(app));
console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail === 0 ? 0 : 1);
