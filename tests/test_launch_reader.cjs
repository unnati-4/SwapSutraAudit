/**
 * test_launch_reader.cjs (11 Oct 2026, launch check) — what an independent
 * new-reader review found, kept fixed. (Each was also reproduced and
 * re-checked end to end against the real script during the review.)
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
let pass = 0, fail = 0;
const C = (label, cond) => { if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label); } };
const fn = (name) => { const i = gs.indexOf('function ' + name + '('); return i === -1 ? '' : gs.slice(i, gs.indexOf('\n}\n', i)); };

const reg = fn('registerFreeReader');
C('Starting the free trial keeps the name and mobile typed at sign-up', /findRowByEmail_\('Subscriptions', normEmail\) \|\| findRowByEmail_\('Users', normEmail\)/.test(reg) && /phone: knownPhone,/.test(reg) && !/phone: data\.phone \|\| '',/.test(reg));

const accept = gs.slice(gs.indexOf("if (action === 'acceptSwapRequest') {"), gs.indexOf("if (action === 'sendChatMessage') {"));
C('Only a waiting request can be accepted or declined', (accept.match(/error: 'NOT_PENDING'/g) || []).length === 2);
C('One copy goes to one reader at a time (partners: as many as in stock)', /copiesInExchange_\(values, headers, parties\.requestedBookId, id\)/.test(accept) && /partnerBookStock_\(parties\.requestedBookId\)/.test(accept) && /error: 'BOOK_IN_EXCHANGE'/.test(accept));
C('...a finished or closed exchange frees the copy', /a === 'exchange_done' \|\| a === 'room_closed'/.test(fn('copiesInExchange_')) && /completedSwapIdSet\(\)/.test(fn('copiesInExchange_')));

const circle = fn('getCircleMessages');
C('A circle\'s messages are read as the signed-in reader (no borrowed address)', /getAuthenticatedEmail\(\)/.test(circle) && /error: 'SESSION_REQUIRED'/.test(circle) && /getCircleMessages: \["user_id", "userId", "email"\]/.test(gs));

C('Readers can only notify readers they deal with, and only with on-site links', /canNotifyReader_\(caller, userEmail/.test(fn('handleCreateNotificationApi')) && /error: 'NOT_ALLOWED'/.test(gs) && /\^\\\/\(\?!\\\/\)/.test(fn('handleCreateNotificationApi')));

const create = fn('createSwapRequest');
C('A loan needs no book offered in return (only a swap does)', /if \(serviceType === 'SWAP' && !offeredBook\) \{/.test(create));
C('The book page offers "Borrow" for a book on loan, with its own request form', /key: 'LEND', title: 'Borrow'/.test(app) && /'Send Borrow Request'/.test(app) && /serviceType: 'RENT' \| 'SELL' \| 'LEND'/.test(app));
C('Books on loan are shown in the Library (site and server)', /flags\.permanentExchange \|\| flags\.temporaryExchange \|\| flags\.rent \|\| flags\.sell \|\| flags\.lend/.test(app) && /flags\.rent \|\| flags\.sell \|\| flags\.lend;\n\}/.test(gs));
C('No request for your own book, and no second open request for the same book', /error: 'OWN_BOOK'/.test(create) && /error: 'ALREADY_REQUESTED'/.test(create));
C('The owner hears about a new request from SwapSutra, by name and with the right verb (in-app + email)', /SELL: 'wants to buy', LEND: 'wants to borrow'/.test(create) && /createNotification\(ownerEmail, 'swap_request_received'/.test(create) && /sendSwapSutraEmail\(\{ to: ownerEmail/.test(create));
C('The site no longer sends request notices with the reader\'s email as the name', !/swap_request_received',\s*recipientEmail/.test(app) && !/senderName: activeUserEmail/.test(app));

C('A listing needs a real title and author', /error: 'TITLE_REQUIRED'/.test(fn('createBook')));
C('Reactions and comments only on posts that exist', /That post is no longer there/.test(fn('togglePostReaction')) && /That post is no longer there/.test(fn('addPostComment')));
C('Support messages need a valid email to reply to', /so we can reply/.test(fn('createSupportMessage')));
C('Room copy points to the exchange room, not the old "Stages tab"', !/Stages tab/.test(app));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
