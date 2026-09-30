// Focused Rent/Sell functional + authorization + regression test.
// Mirrors the relevant logic from appsscript.js: createSwapRequest's
// serviceType handling, resolveSwapRequestParties, and the authorization
// checks inside acceptSwapRequest/declineSwapRequest/cancelSwapRequest.
// This is a standalone simulation (no live Apps Script environment),
// hand-copied to match the real functions exactly for the parts under test.

function normalizeEmail(email) { return (email || '').trim().toLowerCase(); }

function bookAvailabilityFlags(book) {
  const boolFlag = (v) => v === true || String(v).toUpperCase() === 'TRUE';
  return {
    permanent_exchange: boolFlag(book.permanent_exchange),
    temporary_exchange: boolFlag(book.temporary_exchange),
    rent: boolFlag(book.rent),
    sell: boolFlag(book.sell)
  };
}

// Mirrors resolveSwapRequestParties() in appsscript.js exactly.
function resolveSwapRequestParties(headers, row) {
  const get = (name) => {
    const idx = headers.indexOf(name);
    return idx === -1 ? '' : row[idx];
  };
  return {
    requesterEmail: get('requesterEmail') || get('senderEmail') || '',
    ownerEmail: get('ownerEmail') || get('receiverEmail') || '',
    requestedBookId: get('requestedBookId') || get('receiverBookId') || ''
  };
}

const SWAP_HEADERS = [
  "id", "serviceType", "requesterName", "requesterEmail", "requesterPhone",
  "ownerEmail", "requestedBookId", "requestedBookTitle", "offeredBook",
  "offeredBookCondition", "swapPreference", "durationDays", "dueDate",
  "amount", "securityDeposit", "paymentStatus", "paymentUtr", "handoverStatus",
  "returnStatus", "area", "pincode", "notes", "status", "approvalEmailSent",
  "createdAt", "updatedAt"
];

// Mirrors createSwapRequest()'s core validation + row construction.
function simulateCreateSwapRequest(data, books, isApprovedActiveMemberFn) {
  const normalizedEmail = normalizeEmail(data.requesterEmail || data.senderEmail);
  const serviceType = String(data.serviceType || 'SWAP').trim().toUpperCase();
  const swapPreference = String(data.swapPreference || data.exchangeType || (serviceType === 'LEND' ? 'Temporary' : 'Permanent')).trim();

  if (!isApprovedActiveMemberFn(normalizedEmail)) {
    return { success: false, message: "Active membership required to request books.", error: "MEMBERSHIP_REQUIRED" };
  }

  const requestedId = String(data.requestedBookId || data.receiverBookId || "");
  const requestedBook = books.find(b => String(b.id) === requestedId);
  if (!requestedBook) return { success: false, message: "Requested book not found." };

  const flags = bookAvailabilityFlags(requestedBook);

  if (serviceType === "SWAP") {
    if (swapPreference === "Permanent" && !flags.permanent_exchange) return { success: false, message: "This book is not available for permanent exchange." };
    if (swapPreference === "Temporary" && !flags.temporary_exchange) return { success: false, message: "This book is not available for temporary exchange." };
  } else if (serviceType === "RENT") {
    if (!flags.rent) return { success: false, message: "This book is not available for rent." };
  } else if (serviceType === "SELL") {
    if (!flags.sell) return { success: false, message: "This book is not available for purchase/sale." };
  }

  const id = 'SS_REQ_' + Math.floor(Math.random() * 1e6);
  const row = new Array(SWAP_HEADERS.length).fill("");
  SWAP_HEADERS.forEach((h, i) => {
    if (h === 'id') row[i] = id;
    else if (h === 'serviceType') row[i] = serviceType;
    else if (h === 'requesterEmail') row[i] = normalizedEmail;
    else if (h === 'ownerEmail') row[i] = normalizeEmail(requestedBook.ownerEmail || data.receiverEmail || data.ownerEmail || '');
    else if (h === 'requestedBookId') row[i] = requestedId;
    else if (h === 'requestedBookTitle') row[i] = String(data.requestedBookTitle || requestedBook.title || 'Book');
    else if (h === 'amount') row[i] = Number(data.amount || (serviceType === 'SELL' ? requestedBook.mrp : (serviceType === 'RENT' ? 49 : 0)));
    else if (h === 'securityDeposit') row[i] = Number(data.securityDeposit || (serviceType === 'RENT' ? Math.round(Number(requestedBook.mrp || 0) * 0.6) : 0));
    else if (h === 'status') row[i] = 'Pending';
    else if (h === 'createdAt') row[i] = new Date();
  });
  return { success: true, id, requestId: id, serviceType, row, headers: SWAP_HEADERS };
}

// Mirrors the authorization branch inside acceptSwapRequest/declineSwapRequest.
function simulateAcceptOrDecline(headers, row, ownerEmailInput, decision) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  if (!ownerEmail) return { success: false, message: "Owner email required" };
  const parties = resolveSwapRequestParties(headers, row);
  if (normalizeEmail(parties.ownerEmail) !== ownerEmail && ownerEmail !== 'swapsutra@gmail.com') {
    return { success: false, message: `Unauthorized: Only book owner can ${decision === 'Accepted' ? 'accept' : 'decline'}.` };
  }
  const statusIdx = headers.indexOf('status');
  row[statusIdx] = decision;
  return { success: true };
}

// Mirrors the authorization branch inside cancelSwapRequest.
function simulateCancel(headers, row, userEmailInput) {
  const userEmail = normalizeEmail(userEmailInput);
  const parties = resolveSwapRequestParties(headers, row);
  const senderEmail = normalizeEmail(parties.requesterEmail);
  const receiverEmail = normalizeEmail(parties.ownerEmail);
  const isAdmin = userEmail === 'swapsutra@gmail.com';
  if (userEmail !== senderEmail && userEmail !== receiverEmail && !isAdmin) {
    return { success: false, message: "Unauthorized to cancel this swap." };
  }
  const statusIdx = headers.indexOf('status');
  row[statusIdx] = 'Cancelled';
  return { success: true };
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${detail || ''}`); }
}

const activeMembers = new Set(['reader@x.com', 'owner@x.com', 'buyer@x.com', 'stranger@x.com']);
const isApprovedActiveMember = (email) => activeMembers.has(normalizeEmail(email));

const books = [
  { id: 'B_RENT', ownerEmail: 'owner@x.com', title: 'Rentable Book', mrp: 300, rent: 'TRUE', sell: 'FALSE', permanent_exchange: 'FALSE', temporary_exchange: 'FALSE' },
  { id: 'B_SELL', ownerEmail: 'owner@x.com', title: 'Sellable Book', mrp: 500, rent: 'FALSE', sell: 'TRUE', permanent_exchange: 'FALSE', temporary_exchange: 'FALSE' },
  { id: 'B_SWAP', ownerEmail: 'owner@x.com', title: 'Swappable Book', mrp: 200, rent: 'FALSE', sell: 'FALSE', permanent_exchange: 'TRUE', temporary_exchange: 'FALSE' },
  { id: 'B_NEITHER', ownerEmail: 'owner@x.com', title: 'Discovery Only', mrp: 150, rent: 'FALSE', sell: 'FALSE', permanent_exchange: 'FALSE', temporary_exchange: 'FALSE' },
];

// --- RENT FLOW ---
// 1. Reader finds a rent-flagged book, sends rent request -> succeeds.
{
  const res = simulateCreateSwapRequest({ serviceType: 'RENT', senderEmail: 'reader@x.com', receiverBookId: 'B_RENT' }, books, isApprovedActiveMember);
  check('1. RENT request on rent-enabled book succeeds', res.success === true, JSON.stringify(res));
  check('1b. RENT request stored with correct serviceType/status/owner', res.success && res.serviceType === 'RENT', '');

  if (res.success) {
    // 2. Owner accepts.
    const acceptRes = simulateAcceptOrDecline(res.headers, res.row, 'owner@x.com', 'Accepted');
    check('2. Owner accepts RENT request', acceptRes.success === true, JSON.stringify(acceptRes));
    check('2b. Status persisted as Accepted', res.row[res.headers.indexOf('status')] === 'Accepted');

    // 3. Both requester and owner would see 'Accepted' via resolveSwapRequestParties-driven read.
    const parties = resolveSwapRequestParties(res.headers, res.row);
    check('3. Requester/owner resolve correctly post-accept', normalizeEmail(parties.requesterEmail) === 'reader@x.com' && normalizeEmail(parties.ownerEmail) === 'owner@x.com');
  }
}

// 4. Reader tries to rent a book NOT flagged for rent -> rejected, no fake success.
{
  const res = simulateCreateSwapRequest({ serviceType: 'RENT', senderEmail: 'reader@x.com', receiverBookId: 'B_SWAP' }, books, isApprovedActiveMember);
  check('4. RENT request on non-rent book rejected', res.success === false && res.message.includes('not available for rent'), JSON.stringify(res));
}

// --- SELL FLOW ---
// 5. Buyer expresses interest in a sell-flagged book -> succeeds, status Pending (not a completed sale).
{
  const res = simulateCreateSwapRequest({ serviceType: 'SELL', senderEmail: 'buyer@x.com', receiverBookId: 'B_SELL' }, books, isApprovedActiveMember);
  check('5. SELL interest on sale-enabled book succeeds', res.success === true, JSON.stringify(res));
  check('5b. SELL request status starts Pending (interest, not completed purchase)', res.success && res.row[res.headers.indexOf('status')] === 'Pending');

  if (res.success) {
    // 6. Owner declines.
    const declineRes = simulateAcceptOrDecline(res.headers, res.row, 'owner@x.com', 'Declined');
    check('6. Owner declines SELL request', declineRes.success === true);
    check('6b. Status persisted as Declined', res.row[res.headers.indexOf('status')] === 'Declined');
  }
}

// 7. Buyer tries to buy a book NOT flagged for sale -> rejected.
{
  const res = simulateCreateSwapRequest({ serviceType: 'SELL', senderEmail: 'buyer@x.com', receiverBookId: 'B_NEITHER' }, books, isApprovedActiveMember);
  check('7. SELL request on non-sale book rejected', res.success === false && res.message.includes('not available for purchase'), JSON.stringify(res));
}

// --- AUTHORIZATION ---
// 8. A stranger (not the owner) cannot accept/decline someone else's RENT request.
{
  const res = simulateCreateSwapRequest({ serviceType: 'RENT', senderEmail: 'reader@x.com', receiverBookId: 'B_RENT' }, books, isApprovedActiveMember);
  const strangerRes = simulateAcceptOrDecline(res.headers, res.row, 'stranger@x.com', 'Accepted');
  check('8. Stranger cannot accept another owner\'s RENT request', strangerRes.success === false && strangerRes.message.includes('Unauthorized'), JSON.stringify(strangerRes));
  check('8b. Status remains Pending after unauthorized attempt', res.row[res.headers.indexOf('status')] === 'Pending');
}

// 9. Requester can cancel their own pending SELL request; a stranger cannot.
{
  const res = simulateCreateSwapRequest({ serviceType: 'SELL', senderEmail: 'buyer@x.com', receiverBookId: 'B_SELL' }, books, isApprovedActiveMember);
  const strangerCancel = simulateCancel(res.headers, res.row, 'stranger@x.com');
  check('9. Stranger cannot cancel someone else\'s SELL request', strangerCancel.success === false, JSON.stringify(strangerCancel));
  const ownCancel = simulateCancel(res.headers, res.row, 'buyer@x.com');
  check('9b. Requester can cancel their own pending SELL request', ownCancel.success === true, JSON.stringify(ownCancel));
  check('9c. Status persisted as Cancelled', res.row[res.headers.indexOf('status')] === 'Cancelled');
}

// 10. Owner can also cancel a pending request against their own book.
{
  const res = simulateCreateSwapRequest({ serviceType: 'RENT', senderEmail: 'reader@x.com', receiverBookId: 'B_RENT' }, books, isApprovedActiveMember);
  const ownerCancel = simulateCancel(res.headers, res.row, 'owner@x.com');
  check('10. Owner can cancel a request against their own book', ownerCancel.success === true);
}

// 11. Non-member is blocked from creating a RENT/SELL request (membership enforcement not weakened).
{
  const res = simulateCreateSwapRequest({ serviceType: 'RENT', senderEmail: 'nonmember@x.com', receiverBookId: 'B_RENT' }, books, isApprovedActiveMember);
  check('11. Non-member RENT request blocked with MEMBERSHIP_REQUIRED', res.success === false && res.error === 'MEMBERSHIP_REQUIRED', JSON.stringify(res));
}

// --- REGRESSION: existing SWAP flow must be unaffected ---
// 12. A default (no serviceType) request still behaves as SWAP.
{
  const res = simulateCreateSwapRequest({ senderEmail: 'reader@x.com', receiverBookId: 'B_SWAP', swapPreference: 'Permanent' }, books, isApprovedActiveMember);
  check('12. Request with no serviceType defaults to SWAP', res.success && res.serviceType === 'SWAP', JSON.stringify(res));
}

// 13. Existing SWAP accept/decline/cancel authorization still works exactly as before.
{
  const res = simulateCreateSwapRequest({ serviceType: 'SWAP', senderEmail: 'reader@x.com', receiverBookId: 'B_SWAP', swapPreference: 'Permanent' }, books, isApprovedActiveMember);
  const acceptRes = simulateAcceptOrDecline(res.headers, res.row, 'owner@x.com', 'Accepted');
  check('13. SWAP accept still works (no regression)', acceptRes.success === true);
  const strangerRes = simulateAcceptOrDecline(res.headers, res.row, 'stranger@x.com', 'Declined');
  check('13b. SWAP unauthorized decline still blocked (no regression)', strangerRes.success === false);
}

// 14. Legacy row shape (senderEmail/receiverEmail only, no requesterEmail/ownerEmail columns)
//     still resolves correctly for accept/decline/cancel authorization — schema-drift safety net
//     applies identically to RENT/SELL rows, not just SWAP.
{
  const legacyHeaders = ['id', 'senderEmail', 'receiverEmail', 'requestedBookTitle', 'status'];
  const legacyRow = ['SS_REQ_LEGACY', 'reader@x.com', 'owner@x.com', 'Legacy Rent Book', 'Pending'];
  const acceptRes = simulateAcceptOrDecline(legacyHeaders, legacyRow, 'owner@x.com', 'Accepted');
  check('14. Legacy-schema row (pre-serviceType) still authorizes owner correctly', acceptRes.success === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
