/**
 * test_launch_cleanup.cjs (11 Oct 2026) — the editor-run launch cleanup:
 * preview changes nothing; unused sheets are removed after a backup;
 * the full reset needs a typed confirmation, empties data sheets, keeps
 * headers and the settings/catalogue sheets, and cannot run twice.
 */
const vm = require('vm');
const H = require('./e2e/journey_helpers.cjs');
const out = H.mkCheck(); const C = out.C;
const rt = H.boot({ now: Date.parse('2026-10-11T06:00:00Z') });
const m = H.signup(rt, 'Meera Sharma', 'meera@gmail.com', '9876543210');
H.listBook(rt, m.token, 'meera@gmail.com');
const ss = rt.ctx.SpreadsheetApp.getActiveSpreadsheet();
ss.deleteSheet = (sh) => { delete rt.sheets[sh.getName()]; };
ss.getSheets = () => Object.keys(rt.sheets).map(n => rt.sheets[n]);
rt.ctx.DriveApp.getFileById = () => ({ makeCopy: (name) => ({ getUrl: () => 'https://drive.google.com/backup/' + name }) });
['MembershipCoupons', 'Sheet1', 'Old test tab'].forEach(n => ss.insertSheet(n).appendRow(['x']));
rt.ctx.getOrCreateSheet('AppSettings', ['key', 'value']).appendRow(['standardFee', 49]);
const run = (fn) => vm.runInContext(fn + '()', rt.ctx);
const before = Object.keys(rt.sheets).length;
const plan = run('launchCleanupPreview');
C('Preview lists the unused sheets and changes nothing', ['MembershipCoupons', 'Sheet1', 'Old test tab'].every(n => plan.remove.includes(n)) && plan.remove.length === 3 && Object.keys(rt.sheets).length === before, JSON.stringify(plan.remove));
C('...and never offers to delete a sheet the site uses', !plan.remove.some(n => ['Users', 'Books', 'Subscriptions', 'Chats', 'Messages', 'Partners', 'PayoutAccounts'].includes(n)));
const rm = run('launchRemoveUnusedSheets');
C('Unused sheets are removed after a backup', rm.success && /backup/.test(rm.backupUrl) && !rt.sheets.MembershipCoupons && !rt.sheets.Sheet1 && rt.sheets.Users && rt.sheets.Books);
// Columns: old junk in Subscriptions and Users, a nameless empty column, and a used one.
const subs = rt.sheets.Subscriptions;
subs._data[0].push('oldPremiumBadgeFlag', '', 'trialStartDate');
subs._data.slice(1).forEach(r => { while (r.length < subs._data[0].length - 3) r.push(''); r.push('yes', '', r[subs._data[0].indexOf('trialStartDate')] || ''); });
const otp = rt.sheets.OTP; const otpWidth = otp._data[0].length;
const cp = run('launchColumnsPreview');
const subPlan = (cp.find(p => p.sheet === 'Subscriptions') || { columns: [] }).columns.map(c => c.header);
C('Column preview finds the unused columns (and only those)', subPlan.includes('oldPremiumBadgeFlag') && subPlan.includes('(no name)') && !subPlan.includes('trialStartDate') && !subPlan.includes('email'), JSON.stringify(subPlan));
C('...never a column of a sheet written by position', !cp.some(p => p.sheet === 'OTP' && p.columns.some(c => c.col <= otpWidth)));
const before2 = JSON.stringify(rt.rows('Subscriptions').map(r => [r.email, r.name]));
const rc = run('launchRemoveUnusedColumns');
C('Unused columns are removed after a backup; the data in the others stays put', rc.success && !rt.sheets.Subscriptions._data[0].includes('oldPremiumBadgeFlag') && JSON.stringify(rt.rows('Subscriptions').map(r => [r.email, r.name])) === before2);
const t2 = H.login(rt, 'meera@gmail.com').token;
C('...and the site still works on the trimmed sheets (sign in, list a book)', !!t2 && H.listBook(rt, t2, 'meera@gmail.com', { title: 'After cleanup' }).success);
const r0 = run('launchResetAllData');
C('The full reset refuses without the typed confirmation', r0.success === false && rt.rows('Users').length === 1);
rt.props.CONFIRM_LAUNCH_RESET = 'DELETE-ALL';
const r1 = run('launchResetAllData');
C('With it: users, books and the rest are emptied, headers kept', r1.success && rt.rows('Users').length === 0 && rt.rows('Books').length === 0 && rt.rows('Subscriptions').length === 0 && rt.sheets.Users._data[0].includes('email'));
C('...settings are kept', rt.rows('AppSettings').length === 1);
C('...and the confirmation is removed, so it cannot run again by accident', !('CONFIRM_LAUNCH_RESET' in rt.props) && run('launchResetAllData').success === false);
C('Nothing is reachable from the website', rt.post({ action: 'launchResetAllData' }, H.login(rt, H.ADMIN).token).success === false);
console.log(`\n${out.pass} passed, ${out.fail} failed`);
process.exit(out.fail ? 1 : 0);
