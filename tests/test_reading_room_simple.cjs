/**
 * test_reading_room_simple.cjs
 *
 * The Reading Room was five sideways-scrolling tabs, a search box, six post
 * filters and a "Recommendations" tab that duplicated a filter. Readers
 * found it confusing. It is now two tabs, Posts and Reading circles. These
 * checks stop the clutter coming back, and cover the bug where Back from a
 * circle chat went to the Events page.
 */
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
const check = (l, c) => { if (c) { passed++; console.log('PASS: ' + l); } else { failed++; console.log('FAIL: ' + l); } };
const rr = fs.readFileSync(path.join(__dirname, '..', 'src/components/ReadingRoom.tsx'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src/App.tsx'), 'utf8');

check('1. Exactly two tabs', (rr.match(/role="tab"/g) || []).length === 2);
check('2. They are Posts and Reading circles', />\s*Posts\s*</.test(rr) && /Reading circles\{/.test(rr));
for (const gone of ['globalSearchQuery', 'You Can Also Join', 'Community Feed', "In Reader's Bookshelf", "'you-can-join' && !isSearching", 'Curated Book Recommendations']) {
  check(`3. Removed: ${gone}`, !rr.includes(gone));
}
check('4. Post filters are just All / Recommendations / Saved', /setPostFilter\('all'\)/.test(rr) && /setPostFilter\('recommendation'\)/.test(rr) && /setPostFilter\('saved'\)/.test(rr) && !/'quote', 'poem'\]\.map\(type => \(\s*<button\s*key=\{type\}\s*onClick=\{\(\) => setFilterType/.test(rr));
check('5. One post card, rendered in one place', (rr.match(/const renderPost = /g) || []).length === 1 && (rr.match(/id=\{`post-\$\{post\.id\}`\}/g) || []).length === 1);
check('6. Your circles and joinable circles share one tab', /Your circles/.test(rr) && /circles you can join/.test(rr));
check('7. Old links (?tab=joined-circles etc.) still map to the circles tab', /CIRCLE_TABS = \[[^\]]*'joined-circles'[^\]]*'you-can-join'/.test(rr));
check('8. Popups sit above the phone bottom bar (z-85)', (rr.match(/z-\[120\]/g) || []).length === 3 && !/backdrop-blur-xs z-50/.test(rr));
check('9. Back from a circle chat returns to the circle list, not Events', /const backToReadingCircles = \(\) => \{[\s\S]{0,200}setReadingRoomSubTab\('readers-circles'\);\s*navigateTo\('reading-room'\);/.test(app));
const block = app.slice(app.indexOf("{activeTab === 'reading-room' && ("), app.indexOf('<ReadingRoom\n'));
check("10. The chat's back/leave/archive no longer navigate to 'reader-circle'", !block.includes("navigateTo('reader-circle')") && (block.match(/backToReadingCircles\(\)/g) || []).length === 3);
check('11. The unused renderCurrentReads block is gone from App', !app.includes('renderCurrentReads'));
console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed ? 1 : 0);
