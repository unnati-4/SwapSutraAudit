/**
 * test_e2e_new_user.cjs (11 Oct 2026, final launch check)
 *
 * The real appsscript.js, driven only through doPost/doGet with real
 * session tokens (tests/e2e/gas_fake.cjs), walked the way a new reader,
 * a library partner and the admin would: sign up → list → request →
 * pay → videos → delivery → return → rate, plus the things that go wrong
 * (decline, close, late return, disputes, unanswered requests) and the
 * hourly/daily jobs over weeks. Each check below was a real problem found
 * on this walk, or a step that must keep working.
 */
const vm = require('vm');
const H = require('./e2e/journey_helpers.cjs');

const out = H.mkCheck();
const C = out.C;
const T0 = Date.parse('2026-10-11T06:00:00Z');
const DAY = 864e5, HOUR = 36e5;

function world() {
  const rt = H.boot({ now: T0 });
  const m = H.signup(rt, 'Meera Sharma', 'meera@gmail.com', '9876543210');
  const a = H.signup(rt, 'Arjun Verma', 'arjun@gmail.com', '9812345678');
  const admin = H.login(rt, H.ADMIN).token;
  return { rt, m, a, admin, people: { owner: { token: m.token }, requester: { token: a.token } } };
}
const ledger = (rt) => rt.rows('ReturnForfeits').map(x => x.leg + ':' + x.amount).sort().join(' ');

console.log('--- a new reader joins and lists ---');
{
  const { rt, m } = world();
  C('Sign up → email code → free account, all through the site\'s own calls', m.steps.every(s => s && s.success) && m.steps[3].userTier === 'trial');
  const b = H.listBook(rt, m.token, 'meera@gmail.com', { sell: true, sellPrice: 250 });
  C('A first listing goes live at once', b.success && b.status === 'Approved');
  C('...and a signed-out visitor sees it in the Library', rt.get({ action: 'getBooks' }).some(x => x.id === b.id));
  const dir = rt.get({ action: 'getReaderDirectory' });
  C('The public reader directory carries no email addresses', dir.success && dir.readers.length > 0 && dir.readers.every(r => !r.email && r.readerId));
  rt.post({ action: 'updateUserProfile', email: 'meera@gmail.com', bio: 'I read everything' }, m.token);
  const prof = rt.get({ action: 'getUserProfile', email: 'meera@gmail.com' }, m.token).profile.profile;
  C('Saving one profile field never blanks the others (name, phone kept)', prof.bio === 'I read everything' && prof.name === 'Meera Sharma' && prof.phone === '9876543210');
  for (const d of [31, 400]) {
    rt.now(T0 + d * DAY);
    C('Free membership does not run out (day ' + d + ': still listed and can list)', rt.get({ action: 'getBooks' }).length >= 1 && H.listBook(rt, H.login(rt, 'meera@gmail.com').token, 'meera@gmail.com', { title: 'Day ' + d }).success);
  }
}

console.log('--- every kind of exchange, start to finish ---');
const expected = {
  'RENT in_person': 'refund:requester:188 rent:40',
  'RENT courier': 'refund:requester:188 rent:40',
  'SELL in_person': 'sale:240',
  'SELL courier': 'sale:240',
  'LEND in_person': 'refund:requester:228',
  'SWAP in_person': 'fee:owner:10 fee:requester:10 refund:owner:218 refund:requester:218',
  'SWAP_T courier': 'fee:owner:10 fee:requester:10 refund:owner:218 refund:requester:218',
};
for (const key of Object.keys(expected)) {
  const [kind, route] = key.split(' ');
  const { rt, m, a, admin, people } = world();
  const b = H.listBook(rt, m.token, 'meera@gmail.com', { rent: true, sell: true, lend: true, temporary_exchange: true, permanent_exchange: true, sellPrice: 250, rentPerMonth: 40 });
  let body;
  if (kind.startsWith('SWAP')) {
    const offered = H.listBook(rt, a.token, 'arjun@gmail.com', { title: 'Ikigai', author: 'Hector Garcia', isbn: '9781786330895' });
    body = { action: 'createSwapRequest', serviceType: 'SWAP', offeredBookId: offered.id, requestedBookId: b.id, receiverBookId: b.id, swapPreference: kind === 'SWAP_T' ? 'Temporary' : 'Permanent', policy_accepted: 'TRUE' };
  } else body = { action: 'createSwapRequest', serviceType: kind, receiverBookId: b.id, requestedBookTitle: 'The Alchemist', policy_accepted: 'TRUE' };
  const req = rt.post(body, a.token);
  const acc = rt.post({ action: 'acceptSwapRequest', requestId: req.id }, m.token);
  const res = H.playRoom(rt, req.id, people, { admin, route });
  C(key + ': requested, accepted, paid, filmed, delivered' + (/RENT|LEND|SWAP_T/.test(key) ? ', returned' : '') + ', rated, closed', req.success && acc.success && res.done, res.reason);
  C(key + ': the money comes out right (' + expected[key] + ')', ledger(rt) === expected[key], ledger(rt));
  const order = rt.post({ action: 'getMyOrders' }, a.token).orders;
  C(key + ': it is in the reader\'s My orders', order.length === 1 && order[0].swapId === req.id);
  if (key === 'RENT in_person') {
    const firsts = {};
    res.log.forEach((l, i) => { if (!(l.act in firsts)) firsts[l.act] = i; });
    C('The receiver is asked for the unboxing video only after the sender handed the book over',
      firsts['video:RECEIVING@outbound'] > firsts['video:HANDOVER@outbound'] && firsts['video:RECEIVING@return'] > firsts['video:HANDOVER@return']);
  }
}

console.log('--- a late return, with +7 days agreed ---');
{
  let { rt, m, a, admin, people } = world();
  const b = H.listBook(rt, m.token, 'meera@gmail.com', { rent: true, rentPerMonth: 40 });
  const req = rt.post({ action: 'createSwapRequest', serviceType: 'RENT', receiverBookId: b.id, requestedBookTitle: 'The Alchemist', policy_accepted: 'TRUE' }, a.token);
  rt.post({ action: 'acceptSwapRequest', requestId: req.id }, m.token);
  H.playRoom(rt, req.id, people, { admin, until: (o) => o.current >= 10 });
  let asked = null, agreed = null;
  for (let d = 1; d <= 45; d++) {
    rt.now(T0 + d * DAY);
    if (d % 6 === 0) { people.owner.token = H.login(rt, 'meera@gmail.com').token; people.requester.token = H.login(rt, 'arjun@gmail.com').token; admin = H.login(rt, H.ADMIN).token; }
    for (let h = 0; h < 24; h += 6) { rt.now(T0 + d * DAY + h * HOUR); rt.ctx.runReturnDeadlines(); rt.ctx.runSwapRequestSla(); }
    rt.ctx.runCirculationSla();
    const r = rt.post({ action: 'getExchangeRoom', swapId: req.id }, people.requester.token);
    if (!asked && r.actions.some(x => x.type === 'requestExtension')) {
      asked = rt.post({ action: 'exchangeRoomAction', swapId: req.id, act: 'requestExtension', reason: 'Exams' }, people.requester.token);
      const ans = rt.post({ action: 'getExchangeRoom', swapId: req.id }, people.owner.token).actions.find(x => x.type === 'answerExtension');
      agreed = rt.post({ action: 'exchangeRoomAction', swapId: req.id, act: 'answerExtension', extensionId: ans.extensionId, accept: true }, people.owner.token);
    }
  }
  C('+7 days asked by the renter and agreed by the owner in the room', asked && asked.success && agreed && agreed.success);
  C('Kept past the extended date: the deposit goes to the owner', ledger(rt) === 'return:228');
  const counts = {};
  rt.emails.forEach(e => { if (!/Login Code/.test(e.subject)) { const k = e.to + '|' + e.subject; counts[k] = (counts[k] || 0) + 1; } });
  // ("7 days left" is sent once per due date — the original and the extended one.)
  C('Every reminder email is sent once — not again on every hourly run', Object.entries(counts).every(([k, n]) => n === 1 || (/7 days left/.test(k) && n === 2)), JSON.stringify(Object.entries(counts).filter(([, n]) => n > 1)));
  C('No "where has the book got to?" nudge while it is simply on loan', !rt.rows('Notifications').some(n => /circulation_(stale|escalated)/.test(n.type)));
  const p2 = H.playRoom(rt, req.id, people, { admin });
  C('A late return can still be completed and rated', p2.done, p2.reason);
}

console.log('--- a disputed purchase ---');
{
  const { rt, m, a, admin, people } = world();
  const b = H.listBook(rt, m.token, 'meera@gmail.com', { sell: true, sellPrice: 250 });
  const req = rt.post({ action: 'createSwapRequest', serviceType: 'SELL', receiverBookId: b.id, requestedBookTitle: 'The Alchemist', policy_accepted: 'TRUE' }, a.token);
  rt.post({ action: 'acceptSwapRequest', requestId: req.id }, m.token);
  H.playRoom(rt, req.id, people, { admin, until: (o, r) => r.actions.some(x => x.type === 'markReceived') });
  const d = rt.post({ action: 'disputeSwapRequest', swapId: req.id, category: 'CONDITION_MISMATCH', reason: 'Condition did not match', details: 'Torn pages and water damage.', evidenceFiles: [] }, a.token);
  rt.post({ action: 'adminDecideSale', swapId: req.id, outcome: 'REFUND_BUYER', reason: 'Damage in the receiving video only.' }, admin);
  rt.post({ action: 'resolveDispute', disputeId: d.disputeId, resolutionStatus: 'RESOLVED', resolutionNote: 'Refunded', depositOutcome: 'NOT_APPLICABLE' }, admin);
  const room = rt.post({ action: 'getExchangeRoom', swapId: req.id }, a.token);
  C('SwapSutra\'s decision closes the room — no "received" step left to tap', room.closed && !room.actions.length && /refunded the buyer/.test(room.closedReason));
  C('...the buyer is refunded in full (₹260), the seller is not paid', ledger(rt) === 'sale_refund:260');
  const o = rt.post({ action: 'getMyOrders' }, a.token).orders[0];
  C('...and it stays in both readers\' My orders with the decision', o && /refunded/.test(o.decision) && o.payout.kind === 'refund' && rt.post({ action: 'getMyOrders' }, m.token).orders.length === 1);
}

console.log('--- a rental returned damaged ---');
{
  const { rt, m, a, admin, people } = world();
  const b = H.listBook(rt, m.token, 'meera@gmail.com', { rent: true, rentPerMonth: 40 });
  const req = rt.post({ action: 'createSwapRequest', serviceType: 'RENT', receiverBookId: b.id, requestedBookTitle: 'The Alchemist', policy_accepted: 'TRUE' }, a.token);
  rt.post({ action: 'acceptSwapRequest', requestId: req.id }, m.token);
  H.playRoom(rt, req.id, people, { admin, until: (o) => o.actions.some(x => x.type === 'markReceived' && x.leg === 'return') });
  const d = rt.post({ action: 'disputeSwapRequest', swapId: req.id, category: 'DAMAGED', reason: 'Book returned damaged', details: 'Cover torn.', evidenceFiles: [] }, m.token);
  const too = rt.post({ action: 'adminDecideDeposits', swapId: req.id, disputeId: d.disputeId, decisions: [{ payerRole: 'requester', outcome: 'FORFEIT', amount: 228, reason: 'x' }] }, admin);
  C('The admin cannot forfeit the part of the deposit that is the rent', too.success === false && /rent goes to the owner/.test(too.message));
  const dec = rt.post({ action: 'adminDecideDeposits', swapId: req.id, disputeId: d.disputeId, decisions: [{ payerRole: 'requester', outcome: 'FORFEIT', amount: 150, reason: 'Damage in the return video.' }] }, admin);
  C('Rent ₹40 to the owner, ₹150 forfeited to the owner, ₹38 back to the renter', dec.success && ledger(rt) === 'dispute:' + d.disputeId + ':requester:150 refund:requester:38 rent:40', ledger(rt));
  rt.post({ action: 'resolveDispute', disputeId: d.disputeId, resolutionStatus: 'RESOLVED', resolutionNote: 'ok', depositOutcome: 'PARTIAL_DEDUCTION', depositOutcomeAmount: 150 }, admin);
  const p2 = H.playRoom(rt, req.id, people, { admin });
  C('After the decision the exchange finishes normally (no extra refund)', p2.done && ledger(rt) === 'dispute:' + d.disputeId + ':requester:150 refund:requester:38 rent:40');
  const mo = rt.post({ action: 'getMyOrders' }, m.token).orders[0];
  const ao = rt.post({ action: 'getMyOrders' }, a.token).orders[0];
  C('My orders shows each side what they get', mo.awarded && mo.awarded.amount === 150 && mo.payout.kind === 'rent' && /₹38 coming back/.test(ao.deposit.note));
}

console.log('--- review fixes ---');
{
  const { rt, m, a, admin, people } = world();
  const b = H.listBook(rt, m.token, 'meera@gmail.com', { rent: true, rentPerMonth: 40 });
  const req = rt.post({ action: 'createSwapRequest', serviceType: 'RENT', receiverBookId: b.id, requestedBookTitle: 'The Alchemist', policy_accepted: 'TRUE' }, a.token);
  rt.post({ action: 'acceptSwapRequest', requestId: req.id }, m.token);
  // Courier: the owner adds the tracking ID but has not recorded the hand-over video yet.
  H.playRoom(rt, req.id, people, { admin, route: 'courier', until: (o) => o.actions.some(x => x.type === 'video' && x.kind === 'HANDOVER') && !o.actions.some(x => x.type === 'courier') });
  const r = rt.post({ action: 'getExchangeRoom', swapId: req.id }, a.token);
  C('Once a tracking ID is in, the receiver can record the unboxing even before the sender\'s hand-over video', r.actions.some(x => x.type === 'video' && x.kind === 'RECEIVING'));
  // The book never arrives: the renter reports it, and no rent is taken.
  const d = rt.post({ action: 'disputeSwapRequest', swapId: req.id, category: 'NOT_RECEIVED', reason: 'Book not received', details: 'Nothing came.', evidenceFiles: [] }, a.token);
  const dec = rt.post({ action: 'adminDecideDeposits', swapId: req.id, disputeId: d.disputeId, decisions: [{ payerRole: 'requester', outcome: 'REFUND', reason: 'Never delivered.' }] }, admin);
  C('A rental that never reached the renter takes no rent in a dispute (full ₹228 back)', dec.success && dec.results[0].rent === 0 && ledger(rt) === 'dispute:' + d.disputeId + ':requester:0 refund:requester:228', ledger(rt));
}

console.log('--- things a new reader runs into ---');
{
  const { rt, m, a } = world();
  const b = H.listBook(rt, m.token, 'meera@gmail.com', { sell: true, sellPrice: 300 });
  const r = rt.post({ action: 'createSwapRequest', serviceType: 'SELL', receiverBookId: b.id, requestedBookTitle: 'The Alchemist', policy_accepted: 'TRUE' }, a.token);
  C('The owner sees the requester by name, not by email', rt.get({ action: 'getSwapRequests', email: 'meera@gmail.com' }, m.token)[0].requesterName === 'Arjun');
  rt.now(T0 + 4 * DAY); rt.ctx.runSwapRequestSla();
  C('An unanswered request expires — and the reader who asked is told', rt.rows('SwapRequests').find(x => x.id === r.id).status === 'Expired' &&
    rt.rows('Notifications').some(n => n.userEmail === 'arjun@gmail.com' && n.type === 'swap_request_expired'));
  const before = rt.emails.length;
  for (let d = 0; d < 40; d++) { rt.now(T0 + d * DAY + 3 * HOUR); rt.ctx.runTrialConversionSequence(); }
  C('No "your free month ends / continue for ₹49" emails — joining is free', !rt.emails.slice(before).some(e => /ends|₹49/.test(e.subject + (e.htmlBody || ''))));
  // 40 days later the 30-day sessions have run out: sign in again.
  m.token = H.login(rt, 'meera@gmail.com').token; a.token = H.login(rt, 'arjun@gmail.com').token;
  const welcome = rt.emails.find(e => /Before your books/.test(e.subject));
  C('The welcome email makes no "manually vetted" promise', welcome && !/manually vetted|returned exactly as they left/.test(welcome.htmlBody || welcome.body));
  const post = rt.post({ action: 'createReadingRoomPost', postType: 'review', content: 'A gentle book about following your heart.', bookTitle: 'The Alchemist', rating: 5 }, m.token);
  C('Phone numbers and emails are kept out of public Reading Room posts and comments',
    rt.post({ action: 'createReadingRoomPost', postType: 'thought', content: 'DM me at arjun@gmail.com' }, a.token).blocked === true &&
    rt.post({ action: 'addPostComment', postId: post.id, comment: 'call me 9876543210' }, a.token).blocked === true &&
    rt.post({ action: 'addPostComment', postId: post.id, comment: 'Adding it to my list!' }, a.token).success === true);
  rt.post({ action: 'togglePostReaction', postId: post.id, reactionType: 'heart' }, a.token);
  C('"Arjun reacted to your post" — a name, not an email', rt.rows('Notifications').some(n => n.type === 'post_reaction' && n.message === 'Arjun reacted to your post.'));
  for (const [how, action] of [['get', 'cleanupDuplicates'], ['get', 'listSheets'], ['get', 'repairDatabase'], ['post', 'checkExpiredSubscriptions']]) {
    const res = rt[how]({ action }, a.token);
    C('A reader cannot run the admin\'s ' + action, res && res.success === false && /Unauthorized/.test(res.message));
  }
  C('...the admin can (repairDatabase works over GET again)', rt.get({ action: 'repairDatabase' }, H.login(rt, H.ADMIN).token).success === true);
}

console.log('--- a library partner ---');
{
  const { rt, a, admin } = world();
  rt.post({ action: 'sendOTP', email: 'gomti.library@gmail.com', purpose: 'partner' });
  const P = rt.post({ action: 'verifyOTP', email: 'gomti.library@gmail.com', otp: rt.lastOtp('gomti.library@gmail.com'), purpose: 'partner' }).sessionToken;
  const app = rt.post({ action: 'submitPartnerApplication', type: 'library', name: 'Gomti Reading Library', contactName: 'Ramesh Gupta', phone: '9876501234', about: 'Community library',
    address: '14 Gomti Nagar', city: 'Lucknow', pincode: '226010', lat: 26.85, lng: 80.99, placeLabel: 'Gomti', registeredName: 'Ramesh Gupta', panNumber: 'ABCDE1234F', aadhaarLast4: '4321',
    showBanner: true, runAds: true, typeFields: { libraryType: 'Community' }, docs: { aadhaar: H.PNG, pan: H.PNG, businessProof: H.PDF }, agree: true, signedName: 'Ramesh Gupta', contractVersion: 'library-2026-10-13', payout: { accountName: 'Gomti Reading Library Trust', accountNumber: '50100123456789', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' } }, P);
  const ok = rt.post({ action: 'adminReviewPartner', id: app.id, decision: 'approve' }, admin);
  const bk = H.listBook(rt, P, 'gomti.library@gmail.com', { title: 'Wings of Fire', author: 'A P J Abdul Kalam', isbn: '9788173711466', sell: true, sellPrice: 300, stock: 3 });
  C('A library applies on /partners, is approved and lists with stock', app.success && ok.success && bk.success);
  const seen = rt.get({ action: 'getBooks' }).find(x => x.id === bk.id);
  C('An approved partner\'s books are shown in the Library (they have no reader membership)', !!seen && seen.sellerType === 'library');
  const req = rt.post({ action: 'createSwapRequest', serviceType: 'SELL', receiverBookId: bk.id, requestedBookTitle: 'Wings of Fire', policy_accepted: 'TRUE' }, a.token);
  rt.post({ action: 'acceptSwapRequest', requestId: req.id }, P);
  const pc = rt.get({ action: 'getUserChats', email: 'gomti.library@gmail.com' }, P);
  const bc = rt.get({ action: 'getUserChats', email: 'arjun@gmail.com' }, a.token);
  C('The partner sees "Buyer"; the buyer sees the library\'s name', pc[0].otherName === 'Buyer' && pc[0].requesterEmail === 'buyer' && bc[0].otherName === 'Gomti Reading Library');
  const res = H.playRoom(rt, req.id, { owner: { token: P }, requester: { token: a.token } }, { admin, route: 'courier' });
  C('The sale runs to the end; the partner is paid ₹294 (2% commission), no seller fee', res.done && ledger(rt) === 'commission:6 sale:294', ledger(rt));
  C('...and one copy leaves the stock (3 → 2), the book stays listed', rt.get({ action: 'getBooks' }).find(x => x.id === bk.id).stock === 2);
  // 16 Oct 2026: a partner adds many books at once.
  const bulkRows = [
    { line: 2, isbn: '9780143440048', title: 'Ignited Minds', author: 'A P J Abdul Kalam', condition: 'New', copies: '4', mrp: '299', sellPrice: '250' },
    { line: 3, isbn: '978-0-06-231500-7', title: 'The Alchemist', author: 'Paulo Coelho', lend: 'yes', rentPerMonth: '₹60' },
    { line: 4, isbn: '9788173711466', title: 'Wings of Fire', author: 'A P J Abdul Kalam', sellPrice: '300' },
    { line: 5, isbn: '9780140449136', title: 'Crime and Punishment', author: 'Dostoevsky' },
    { line: 6, isbn: '12345', title: 'Bad', author: 'Nobody', sellPrice: '10' },
  ];
  C('A reader cannot use the bulk upload', rt.post({ action: 'partnerBulkAddBooks', rows: bulkRows, originalDeclared: true }, a.token).error === 'NOT_PARTNER');
  C('…and a partner must confirm the copies are original', rt.post({ action: 'partnerBulkAddBooks', rows: bulkRows }, P).error === 'COPY_TYPE_DECLARATION_REQUIRED');
  C('…and send at most 25 at a time', rt.post({ action: 'partnerBulkAddBooks', rows: Array.from({ length: 26 }, () => bulkRows[0]), originalDeclared: true }, P).error === 'TOO_MANY_ROWS');
  const bulk = rt.post({ action: 'partnerBulkAddBooks', rows: bulkRows, originalDeclared: true }, P);
  const byLine = (n) => (bulk.results || []).find(x => x.line === n) || {};
  C('A bulk upload lists the good rows and explains the rest', bulk.success && bulk.added === 2 && bulk.failed === 3, JSON.stringify(bulk));
  C('…a book already on the shelf is not listed twice', /Already on your shelf/.test(byLine(4).message || ''));
  C('…a row with no price, rent, lend or swap is refused', /selling price or a rent/.test(byLine(5).message || ''));
  C('…and a wrong ISBN is caught', /ISBN/.test(byLine(6).message || ''));
  const lib = rt.get({ action: 'getBooks' });
  const im = lib.find(x => x.title === 'Ignited Minds'), al = lib.find(x => x.title === 'The Alchemist' && x.sellerType === 'library');
  C('Bulk books are live with copies, price, the ISBN cover and the partner\'s area', !!im && im.stock === 4 && Number(im.ownerSellPrice || im.sellPrice) === 250
    && /covers\.openlibrary\.org\/b\/isbn\/9780143440048/.test(im.imageUrls || '') && im.condition === 'As New' && im.sellerType === 'library', JSON.stringify(im && { stock: im.stock, sell: im.ownerSellPrice, img: im.imageUrls, c: im.condition }));
  C('…lend and rent come through too', !!al && String(al.lend).toUpperCase() === 'TRUE' && String(al.rent).toUpperCase() === 'TRUE', JSON.stringify(al && { lend: al.lend, rent: al.rent }));
  const sneaky = H.listBook(rt, a.token, 'arjun@gmail.com', { title: 'No Photos', isbn: '9780140449136', frontCoverImage: undefined, backCoverImage: undefined, __SS_PARTNER_BULK__: true, coverImageUrl: 'https://x.com/a.jpg' });
  C('A reader cannot skip the photos by faking the bulk flag', sneaky.success === false && sneaky.error === 'REQUIRED_MEDIA_MISSING', JSON.stringify(sneaky));
  // 14 Oct 2026: a partner may sell and rent only nearby.
  C('A partner sells all over India unless it says otherwise', rt.get({ action: 'getBooks' }).find(x => x.id === bk.id).serviceArea === 'india');
  const bad = rt.post({ action: 'updatePartnerProfile', serviceArea: 'nearby', serviceRadiusKm: 7 }, P);
  C('Only the offered distances can be chosen', bad.success === false && bad.errors.serviceRadiusKm);
  const near = rt.post({ action: 'updatePartnerProfile', serviceArea: 'nearby', serviceRadiusKm: 5 }, P);
  const lb = rt.get({ action: 'getBooks' }).find(x => x.id === bk.id);
  C('The partner switches to "within 5 km" and the Library shows it', near.success && lb.serviceArea === 'nearby' && lb.serviceRadiusKm === 5 && lb.serviceCity === 'Lucknow', JSON.stringify(near));
  const sell = (extra) => rt.post(Object.assign({ action: 'createSwapRequest', serviceType: 'SELL', receiverBookId: bk.id, requestedBookTitle: 'Wings of Fire', policy_accepted: 'TRUE' }, extra), a.token);
  const noLoc = sell({});
  C('A reader who gives no location is asked for it', noLoc.success === false && noLoc.error === 'LOCATION_NEEDED' && /within 5 km of Lucknow/.test(noLoc.message), JSON.stringify(noLoc));
  const far = sell({ readerLat: 28.61, readerLng: 77.21 });
  C('A reader in Delhi (~420 km away) cannot request it', far.success === false && far.error === 'OUT_OF_AREA' && far.distanceKm > 400, JSON.stringify(far));
  const neha = H.signup(rt, 'Neha Lucknow', 'neha.lko@gmail.com', '9812312312').token;
  const inRange = rt.post({ action: 'createSwapRequest', serviceType: 'SELL', receiverBookId: bk.id, requestedBookTitle: 'Wings of Fire', policy_accepted: 'TRUE', readerLat: 26.87, readerLng: 80.97 }, neha);
  C('A reader 3 km away can', inRange.success === true, JSON.stringify(inRange));
  const back = rt.post({ action: 'updatePartnerProfile', serviceArea: 'india' }, P);
  C('…and the partner can go back to all of India', back.success && rt.get({ action: 'getBooks' }).find(x => x.id === bk.id).serviceArea === 'india');
  const appr = rt.mailTo('gomti.library@gmail.com').filter(e => /partner/.test(e.subject));
  C('Partner emails link to the live site', appr.length > 0 && rt.mailTo('gomti.library@gmail.com').every(e => !/run\.app/.test(String(e.body || e.htmlBody))));
}

console.log('--- the routine jobs over 40 days ---');
{
  const { rt, m, a } = world();
  H.listBook(rt, m.token, 'meera@gmail.com');
  H.listBook(rt, a.token, 'arjun@gmail.com', { title: 'Ikigai', author: 'Hector Garcia', isbn: '9781786330895' });
  const before = rt.emails.length;
  let errors = 0;
  for (let h = 0; h < 24 * 40; h++) {
    rt.now(T0 + h * HOUR);
    for (const j of ['runSwapRequestSla', 'runDailyEngagementPush', 'runReturnDeadlines']) { try { rt.ctx[j](); } catch (e) { errors++; } }
    if (h % 24 === 3) for (const j of ['runTrialConversionSequence', 'runCirculationSla', 'runWeeklyShelfDigest']) { try { rt.ctx[j](); } catch (e) { errors++; } }
  }
  const counts = {};
  rt.emails.slice(before).forEach(e => { const k = e.to + '|' + e.subject; counts[k] = (counts[k] || 0) + 1; });
  C('Every scheduled job runs hourly/daily for 40 days without an error', errors === 0);
  C('...and no reader gets the same email twice', Object.values(counts).every(n => n === 1), JSON.stringify(counts));
}

{
  const gs = require('fs').readFileSync(require('path').join(__dirname, '..', 'appsscript.js'), 'utf8');
  C('Header lookups match "requesterEmail" / "createdAt" (candidates are normalised too)', vm.runInNewContext(gs.slice(gs.indexOf('function normalizeHeader('), gs.indexOf('\n}\n', gs.indexOf('function normalizeHeader(')) + 3) +
    gs.slice(gs.indexOf('function findHeaderIndex('), gs.indexOf('\n}\n', gs.indexOf('function findHeaderIndex(')) + 3) + ';[findHeaderIndex(["id","requesterEmail"],["requesterEmail"]), findHeaderIndex(["id","senderEmail","requesterEmail"],["requesterEmail","senderEmail"])].join()') === '1,2');
}

console.log(`\n${out.pass} passed, ${out.fail} failed`);
process.exit(out.fail ? 1 : 0);
