/**
 * test_custom_mug_enquiry.cjs  (30 Sep 2026)
 * Custom mug enquiries and the mug shelf, run against the real Apps Script
 * code with in-memory sheets, plus the browser-side rules (mugEnquiry.ts).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const esbuild = require('esbuild');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const sheets = {};
function makeSheet(name, headers) {
  const data = [headers && headers.length ? headers.slice() : []];
  const sheet = {
    __data: data,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getLastRow: () => data.length, getLastColumn: () => data[0].length,
    getRange: (r, c) => ({ setValue: (v) => { data[r - 1][c - 1] = v; }, getValues: () => [[data[r - 1][c - 1]]] }),
    appendRow: (row) => data.push(row.slice()),
  };
  sheets[name] = sheet; return sheet;
}
const rows = (name) => { const d = sheets[name].__data; return d.slice(1).map((r) => Object.fromEntries(d[0].map((h, i) => [h, r[i]]))); };
const mails = [];
const drive = [];
const cache = new Map();
const sandbox = {
  console: { log() {}, error() {}, warn() {} }, Logger: { log() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
  Utilities: { getUuid: () => crypto.randomUUID(), base64Decode: (s) => Buffer.from(s, 'base64'), newBlob: () => ({}) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null }, MailApp: { sendEmail() {} },
  ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
  DriveApp: {}, UrlFetchApp: { fetch() { return { getContentText: () => '{}' }; } },
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(read('appsscript.js'), ctx, { filename: 'appsscript.js' });
ctx.__sheets = sheets; ctx.__makeSheet = makeSheet; ctx.__mails = mails; ctx.__drive = drive;
vm.runInContext(`
  getOrCreateSheet = function (name, headers) { return __sheets[name] || __makeSheet(name, headers); };
  ensureSheetHeaders = function (sheet, headers) { const have = sheet.__data[0]; headers.forEach(function (h) { if (have.indexOf(h) === -1) have.push(h); }); return have.slice(); };
  sendSwapSutraEmail = function (a, b, c) { __mails.push(typeof a === 'object' ? a : { to: a, subject: b, body: c }); };
  saveFileToDrive = function (data, name) { __drive.push(name); return 'https://drive.google.com/file/d/REF' + __drive.length + '/view'; };
  var __ADMIN = false;
  isAuthenticatedAdmin = function () { return __ADMIN; };
`, ctx);
const call = (fn, ...args) => { ctx.__args = args; return vm.runInContext(`${fn}.apply(null, __args)`, ctx); };
const good = () => ({
  name: 'Asha Verma', email: 'Asha@Example.com', phone: '+91 98765 43210',
  idea: 'A mug shaped like three stacked hardbacks with gold spine text.',
  mugType: 'Coffee Mug', volumeRange: 'custom', volumeMl: 350, quantityRange: '6-20', quantityExact: '10',
  budgetType: 'per_mug', budgetAmount: 700, budgetRange: '', pincode: '302001', city: 'Jaipur', state: 'Rajasthan',
  timeline: 'within_1_month', specificDate: '', additionalNotes: 'Gift for a book club.', website: '', referenceImage: '',
});

console.log('--- server validation ---');
let r = call('submitCustomMugEnquiry', { ...good(), name: '', email: 'x', phone: '12345', idea: 'short', mugType: 'Bucket', volumeRange: '', quantityRange: '', budgetType: '', budgetAmount: 0, pincode: '01234', timeline: '' });
const fe = r.fieldErrors || {};
check('1. Nothing is stored when required fields are missing or wrong', r.success === false && !sheets.CustomMugEnquiries?.__data[1]);
check('2. Every required field is checked on the server', ['name', 'email', 'phone', 'idea', 'mugType', 'volumeRange', 'quantityRange', 'budgetType', 'budgetAmount', 'pincode', 'timeline'].every((k) => fe[k]), Object.keys(fe).join(','));
check('3. Pincode must be 6 digits and not start with 0', !!call('validateCustomMugEnquiry_', { ...good(), pincode: '012345' }).errors.pincode && !call('validateCustomMugEnquiry_', { ...good(), pincode: '110001' }).errors.pincode);
check('4. Indian mobile numbers only (+91 / 0 / 10 digits from 6–9)', ['9876543210', '+919876543210', '09876543210', '98765-43210'].every((p) => !call('validateCustomMugEnquiry_', { ...good(), phone: p }).errors.phone) && ['5876543210', '987654321', '+1 415 555 0100'].every((p) => call('validateCustomMugEnquiry_', { ...good(), phone: p }).errors.phone));
check('5. Custom capacity must be 30–2000 ml', !!call('validateCustomMugEnquiry_', { ...good(), volumeMl: 0 }).errors.volumeMl && !!call('validateCustomMugEnquiry_', { ...good(), volumeMl: 5000 }).errors.volumeMl);
const rng = call('validateCustomMugEnquiry_', { ...good(), volumeRange: '300-350', volumeMl: undefined }).clean;
check('6. A capacity range is stored as a number in ml (midpoint) plus the range', rng.volumeMl === 325 && rng.volumeRange === '300–350 ml');
check('7. Exact quantity must match the chosen range', !!call('validateCustomMugEnquiry_', { ...good(), quantityExact: '40' }).errors.quantityExact);
check('8. Budget must be above zero', !!call('validateCustomMugEnquiry_', { ...good(), budgetAmount: -5 }).errors.budgetAmount);
const now = new Date('2026-09-30T06:00:00Z');
check('9. A specific date is required, and cannot be in the past', !!call('validateCustomMugEnquiry_', { ...good(), timeline: 'specific_date', specificDate: '' }, now).errors.specificDate && !!call('validateCustomMugEnquiry_', { ...good(), timeline: 'specific_date', specificDate: '2026-09-01' }, now).errors.specificDate && !call('validateCustomMugEnquiry_', { ...good(), timeline: 'specific_date', specificDate: '2026-11-15' }, now).errors.specificDate);

console.log('--- storing ---');
r = call('submitCustomMugEnquiry', { ...good(), referenceImage: 'data:image/png;base64,' + Buffer.from('png').toString('base64') });
const row = rows('CustomMugEnquiries')[0];
check('10. A valid enquiry is stored and its id returned', r.success === true && /^MUG-\d{8}-[A-Z0-9]{5}$/.test(r.id) && row.id === r.id, JSON.stringify(r));
check('11. The row has every requested column', ['id', 'createdAt', 'name', 'email', 'phone', 'idea', 'referenceImageUrl', 'mugType', 'volumeMl', 'volumeRange', 'quantityRange', 'quantityExact', 'budgetType', 'budgetAmount', 'budgetRange', 'pincode', 'city', 'state', 'timeline', 'specificDate', 'additionalNotes', 'status', 'adminNotes', 'assignedManufacturer', 'lastUpdatedAt'].every((h) => sheets.CustomMugEnquiries.__data[0].includes(h)));
check('12. Values are clean: status new, email lower-case, phone +91, capacity 350 ml, budget 700 per mug', row.status === 'new' && row.email === 'asha@example.com' && row.phone === '+919876543210' && row.volumeMl === 350 && row.budgetAmount === 700 && row.budgetType === 'per_mug' && row.quantityExact === 10);
check('13. The reference image is stored in Drive and linked', /^https:\/\/drive\.google\.com\//.test(row.referenceImageUrl));
check('14. The customer gets only their id back — never admin fields', Object.keys(r).sort().join(',') === 'id,success');
const owner = mails.find((m) => m.to === 'swapsutra@gmail.com');
const cust = mails.find((m) => m.to === 'asha@example.com');
check('15. SwapSutra is emailed the manufacturer brief', owner && /CUSTOM MUG REQUEST/.test(owner.body) && /Capacity: 350 ml/.test(owner.body) && /Customer budget: ₹700 per mug/.test(owner.body) && /Delivery pincode: 302001/.test(owner.body));
check('16. The customer is emailed an acknowledgement that promises nothing', cust && /on its way/.test(cust.subject) && /Nothing is confirmed yet/.test(cust.htmlBody) && !/adminNotes|manufacturer/i.test(cust.htmlBody));
r = call('submitCustomMugEnquiry', { ...good(), referenceImage: 'data:image/gif;base64,R0lGOD' });
check('17. A GIF reference image is refused (JPG/PNG/WebP only)', r.success === false && r.fieldErrors.referenceImage);
r = call('submitCustomMugEnquiry', { ...good(), referenceImage: 'data:image/jpeg;base64,' + 'A'.repeat(2.2 * 1024 * 1024) });
check('18. An oversized reference image is refused', r.success === false && /too large/.test(r.message));
const before = rows('CustomMugEnquiries').length;
r = call('submitCustomMugEnquiry', { ...good(), website: 'http://spam' });
check('19. The honeypot looks accepted to a bot but stores nothing', r.success === true && rows('CustomMugEnquiries').length === before);
for (let i = 0; i < 6; i++) r = call('submitCustomMugEnquiry', { ...good(), email: 'flood@example.com' });
check('20. One email cannot flood the sheet (5 an hour)', r.success === false && r.error === 'RATE_LIMITED');

console.log('--- admin ---');
check('21. Listing enquiries needs an admin session', call('getAdminCustomMugEnquiries', {}).success === false);
check('22. Updating needs an admin session', call('updateCustomMugEnquiry', { id: row.id, status: 'reviewing' }).success === false);
vm.runInContext('__ADMIN = true', ctx);
const list = call('getAdminCustomMugEnquiries', {});
check('23. Admin sees every enquiry, newest first, with a manufacturer brief', list.success && list.items.length >= 1 && /CUSTOM MUG REQUEST/.test(list.items[list.items.length - 1].manufacturerBrief));
check('24. The brief holds the manufacturer\'s specs together and no customer contact', (() => { const b = list.items.find((i) => i.id === row.id).manufacturerBrief; return /Style: Coffee Mug/.test(b) && /Quantity: 10 mugs/.test(b) && /Timeline: Within 1 month/.test(b) && /approximate/.test(b) && !/asha@example\.com|98765/.test(b); })());
check('25. All ten workflow statuses are offered', JSON.stringify(list.statuses) === JSON.stringify(['new', 'reviewing', 'manufacturer_search', 'prototype', 'quoted', 'customer_approval', 'manufacturing', 'shipped', 'completed', 'rejected']));
r = call('updateCustomMugEnquiry', { id: row.id, status: 'manufacturer_search', adminNotes: 'Try the Khurja studio', assignedManufacturer: 'Studio A' });
const upd = rows('CustomMugEnquiries').find((x) => x.id === row.id);
check('26. Admin can change status, notes and manufacturer', r.success && upd.status === 'manufacturer_search' && upd.adminNotes === 'Try the Khurja studio' && upd.assignedManufacturer === 'Studio A');
check('27. An unknown status is refused', call('updateCustomMugEnquiry', { id: row.id, status: 'paid' }).success === false);
check('28. Customer-typed fields cannot be changed through the admin update', upd.idea === row.idea && upd.budgetAmount === 700);

console.log('--- the shelf ---');
check('29. The shelf is empty at launch — no products invented', call('getMugProducts').items.length === 0);
const ph = sheets.MugProducts.__data[0];
const addP = (o) => sheets.MugProducts.__data.push(ph.map((h) => (o[h] !== undefined ? o[h] : '')));
addP({ id: 'a', title: 'Live mug', category: 'minimal', status: 'live', price: 749, mrp: 999, sourceMarketplace: 'Amazon', sourceUrl: 'https://www.amazon.in/dp/X', imageUrl: 'http://insecure/img.jpg' });
addP({ id: 'b', title: 'Hidden mug', category: 'minimal', status: 'hidden', price: 100 });
addP({ id: 'c', title: 'Odd category', category: 'teapots', status: 'live', price: 100 });
addP({ id: 'd', title: 'Rated mug', category: 'bookish', status: 'live', price: 500, mrp: 400, rating: 4.4, ratingCount: 120 });
addP({ id: 'e', title: 'Sourced rating', category: 'bookish', status: 'live', price: 500, rating: 4.4, ratingCount: 120, ratingSource: 'Amazon' });
const shelf = call('getMugProducts').items;
check('30. Only live rows in a known category are shown', shelf.map((p) => p.id).join(',') === 'a,d,e', shelf.map((p) => p.id).join(','));
check('31. Only https images/links pass', shelf[0].imageUrl === '' && shelf[0].sourceUrl === 'https://www.amazon.in/dp/X');
check('32. An MRP is passed on only when it is above the price', shelf[0].mrp === 999 && shelf.find((p) => p.id === 'd').mrp === null);
check('33. A rating is shown only with its source', shelf.find((p) => p.id === 'd').rating === null && shelf.find((p) => p.id === 'e').rating === 4.4);
const src = read('appsscript.js');
check('34. The shelf and the enquiry are public; the admin actions are not', /getMugProducts: true,\s*submitCustomMugEnquiry: true/.test(src) && !/getAdminCustomMugEnquiries: true|updateCustomMugEnquiry: true/.test(src));
check('35. The website proxy lets the two public actions through', /'getMugProducts', 'submitCustomMugEnquiry'/.test(read('api/swapsutra.ts')));

console.log('--- the browser rules match the server ---');
const M = { exports: {} };
vm.runInNewContext(esbuild.transformSync(read('src/utils/mugEnquiry.ts'), { loader: 'ts', format: 'cjs' }).code, { module: M, exports: M.exports, Number, Date, Object, String });
const c = M.exports;
check('36. Same mug styles on both sides', JSON.stringify([...c.MUG_TYPES]) === JSON.stringify(vm.runInContext('MUG_TYPES', ctx)));
check('37. Same capacity ranges', c.MUG_VOLUME_OPTIONS.map((o) => o.id).join() === Object.keys(vm.runInContext('MUG_VOLUME_RANGES', ctx)).join() && c.MUG_VOLUME_OPTIONS.every((o) => vm.runInContext('MUG_VOLUME_RANGES', ctx)[o.id].min === o.min));
check('38. Same quantity ranges, budget types, budget ranges and timelines',
  c.MUG_QUANTITY_OPTIONS.map((o) => o.id).join() === Object.keys(vm.runInContext('MUG_QUANTITY_RANGES', ctx)).join()
  && c.MUG_BUDGET_TYPES.map((o) => o.id).join() === Object.keys(vm.runInContext('MUG_BUDGET_TYPES', ctx)).join()
  && c.MUG_BUDGET_RANGES.map((o) => o.label).join() === vm.runInContext('MUG_BUDGET_RANGES', ctx).join()
  && c.MUG_TIMELINES.map((o) => o.id).join() === Object.keys(vm.runInContext('MUG_TIMELINES', ctx)).join());
const form = { ...c.EMPTY_MUG_ENQUIRY, name: 'Asha', email: 'a@b.co', phone: '9876543210', idea: 'x'.repeat(25), mugType: 'Tea Cup', volumeRange: '200-250', quantityRange: '1', budgetAmount: '600', pincode: '560001', timeline: 'no_rush' };
check('39. A complete form passes in the browser', Object.keys(c.validateMugEnquiry(form)).length === 0);
const payload = c.toEnquiryPayload(form, '');
check('40. ...and its payload passes on the server', call('validateCustomMugEnquiry_', payload).ok === true, JSON.stringify(call('validateCustomMugEnquiry_', payload).errors));
check('41. The brief the customer reviews shows capacity in ml', c.mugBrief(form).find((b) => b.label === 'Capacity').value === '200–250 ml (about 225 ml)');
check('42. The Next button checks only the current step', Object.keys(c.stepErrors(c.validateMugEnquiry({ ...c.EMPTY_MUG_ENQUIRY }), 0)).sort().join() === 'email,idea,name,phone');

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
