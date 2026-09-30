/**
 * test_reading_tracker.cjs
 *
 * The Reading tab's tracker for physical books: readers write down what
 * they are reading (several at once), keep a page number, and mark books
 * finished. The page is only the tracker plus a yearly goal — the old
 * mood picker, weekend calculator and made-up insights are gone.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

let passed = 0, failed = 0;
const check = (label, cond) => { if (cond) { passed++; console.log('PASS: ' + label); } else { failed++; console.log('FAIL: ' + label); } };

const root = path.join(__dirname, '..');
const trackerSrc = fs.readFileSync(path.join(root, 'src/components/ReadingTracker.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const gas = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');

// Load the real parseProgress / formatProgress.
const js = esbuild.transformSync(trackerSrc, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, (m) => (m === 'react' || m === 'react/jsx-runtime' ? { useState() { return []; }, jsx() {}, jsxs() {}, Fragment: 'f' } : require(m)));
const { parseProgress, formatProgress, minutesLeft, formatMinutes, finishDate, readingStreak, dayKey } = mod.exports;

console.log('\n--- Page progress ---');
check('1. "120/480" reads as page 120 of 480', JSON.stringify(parseProgress('120/480')) === '{"page":120,"total":480}');
check('2. Spaces are tolerated', parseProgress(' 5 / 10 ').page === 5);
check('3. Old labels like "Just Started" read as not started', parseProgress('Just Started').page === 0 && parseProgress('Just Started').total === 0);
check('4. Empty reads as not started', parseProgress('').total === 0 && parseProgress(undefined).total === 0);
check('5. A page past the end is capped at the end', parseProgress('600/480').page === 480);
check('6. formatProgress writes page/total', formatProgress(50, 200) === '50/200' && formatProgress(-3, 0) === '0/0');

console.log('\n--- Time to finish ---');
check('T1. 360 pages left at 30 pages/hour = 12 hours', minutesLeft(360, 30) === 720 && formatMinutes(720) === '12 hr');
check('T2. 150 pages at 40/hour rounds up to 3 hr 45 min', formatMinutes(minutesLeft(150, 40)) === '3 hr 45 min');
check('T3. Under an hour shows minutes only', formatMinutes(minutesLeft(10, 30)) === '20 min');
check('T4. No speed → no guess', minutesLeft(100, 0) === null);
check('T5. Each book shows % read, % left with pages left, and time to finish', /\{100 - pct\}%/.test(trackerSrc) && /Left · \{left\} pg/.test(trackerSrc) && /To finish/.test(trackerSrc));
check('T6. The reader sets their own speed, remembered on this phone', /aria-label="Your reading speed in pages per hour"/.test(trackerSrc) && /swapsutraReadingSpeed/.test(trackerSrc));

console.log('\n--- Making it worth coming back to ---');
const base = new Date(2026, 8, 21, 10);
const ago = (n) => { const d = new Date(base); d.setDate(d.getDate() - n); return dayKey(d); };
check('M1. Three days in a row is a 3-day streak', readingStreak({ [ago(0)]: 10, [ago(1)]: 5, [ago(2)]: 8, [ago(4)]: 9 }, base) === 3);
check('M2. Not read yet today keeps yesterday\'s streak alive', readingStreak({ [ago(1)]: 5, [ago(2)]: 8 }, base) === 2);
check('M3. A missed day ends the streak', readingStreak({ [ago(2)]: 8 }, base) === 0);
const fd = finishDate(720, 30, base);
check('M4. 12 hours left at 30 min a day finishes in 24 days (23 days from today)', fd && Math.round((fd - new Date(2026, 8, 21, 12)) / 86400000) === 23);
check('M5. Less than a day of reading finishes today', Math.round((finishDate(20, 30, base) - new Date(2026, 8, 21, 12)) / 86400000) === 0);
check('M6. One-tap logging (+5/+10/+25/+50)', /QUICK_PAGES = \[5, 10, 25, 50\]/.test(trackerSrc) && /aria-label=\{`Add \$\{n\} pages to/.test(trackerSrc));
check('M7. Finishing a book celebrates', /confetti\(/.test(trackerSrc));
check('M8. Streak, pages this week and books this year are shown', /Day streak/.test(trackerSrc) && /Pages this week/.test(trackerSrc) && /Books this year/.test(trackerSrc));
check('M10. Four tabs like the reference: Currently Reading / Want to Read / Completed / All Books', ['Currently Reading', 'Want to Read', 'Completed', 'All Books'].every((l) => trackerSrc.includes(`label: '${l}'`)));
check('M11. Each card has Update Progress and shows time left or the start date', /Update Progress/.test(trackerSrc) && /Started \$\{niceDate/.test(trackerSrc) && /left` :/.test(trackerSrc));
check('M14. A "Continue reading" hero with a progress ring leads the page', /Continue reading/.test(trackerSrc) && /const ContinueCard/.test(trackerSrc));
check('M15. Tabs are short enough for one line on a phone', /short: 'Reading'/.test(trackerSrc) && /whitespace-nowrap/.test(trackerSrc));
// 30 Sep (owner's request): the tracker left the bar and menu; /tracker still works.
check('M12. /tracker opens the tracker inside the profile', /'\/tracker': 'tracker'/.test(app) && /if \(activeTab !== 'tracker'\) return;\s*setProfileActiveSubTab\('tracker'\);/.test(app));
check('M13. Library covers are reused on tracker cards', /cover: trackerCoverFor\(/.test(app));
check('M9. Each book shows a finish-by date', /Finish by/.test(trackerSrc) && /aria-label="Minutes you read a day"/.test(trackerSrc));

console.log('\n--- The page ---');
// The tracker lives on its own page (/tracker) now, not inside My Profile.
const insights = app.slice(app.indexOf("profileActiveSubTab === 'tracker' && ("), app.indexOf("profileActiveSubTab === 'tracker' && (") + 4000);
check('7. The tracker page renders the tracker', /<ReadingTracker[\s\S]*onUpdate=\{saveTrackerBook\}/.test(insights));
check('8. It shows reading, want-to-read and finished books from the reading space', /currentlyReading: Boolean\(item\.currently_reading\)/.test(app) && /wantToRead: Boolean\(item\.tbr\)/.test(app) && /books=\{trackerBooks\}/.test(insights));
for (const gone of ['Reading Mood', 'Weekend Calculator', 'Magical Realism', 'readingPaceInput', 'Bento']) {
  check(`9. Removed from the page: ${gone}`, !insights.includes(gone));
}
// 30 Sep (owner's request): the tracker moved into the profile — still one copy.
check('10. One tracker, in Profile → Reading Tracker', !/profileActiveSubTab === 'insights'/.test(app) && (app.match(/<ReadingTracker\b/g) || []).length === 1 && /profileActiveSubTab === 'tracker' && \(/.test(app) && /sub: 'tracker'/.test(app));
check('11. Several books can be tracked (the list is mapped, not a single slot)', /shown\.map\(\(b\) =>/.test(trackerSrc));
check('12. Finishing moves the book to the shelf', /currently_reading: false,\s*bookshelf: true/.test(trackerSrc));
check('13. Saves go to the reading space with the page progress', /action: 'upsertReadingSpaceBook'[\s\S]{0,300}\.\.\.changes/.test(app));
check('14. Saving does not blank the profile on success', (() => {
  const fn = app.slice(app.indexOf('const saveTrackerBook'), app.indexOf('// The floating buttons'));
  return fn.includes('setProfileData((prev') && !/return true;[\s\S]*fetchUserProfile[\s\S]*return true/.test(fn);
})());

console.log('\n--- Backend ---');
check('15. reading_progress is a reading_space column', /READING_SPACE_HEADERS[\s\S]{0,400}"reading_progress"/.test(gas));
check('16. The upsert keeps the page progress', /reading_progress: data\.reading_progress \|\| existing\.reading_progress/.test(gas));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed ? 1 : 0);
