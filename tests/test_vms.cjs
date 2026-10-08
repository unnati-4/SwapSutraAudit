/**
 * test_vms.cjs  (7 Oct 2026, owner's request)
 *
 * VMS — video evidence for every book that travels, against the shipped
 * appsscript.js (Google Drive and the network are faked):
 *   • the sender records QUALITY (+ PACKING by courier), the receiver RECEIVING
 *   • "posted" / "handed over" / "received" are refused until the videos exist,
 *     in the delivery timeline and in the Stages panel
 *   • videos upload in 2.5 MB pieces straight into a Drive resumable session
 *   • in a dispute, SwapSutra decides each deposit; forfeits become payouts
 *   • an open dispute pauses the automatic late-return forfeit
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
function makeEnv() {
  const sheets = {};
  const props = {};
  const notifications = [];
  let session = '';
  const bookCounts = {};
  const stageLog = [];
  const emails = [];
  const swapsById = {};
  const chats = [];
  const journeyLog = [];
  const fetches = [];
  const openDisputes = {};

  function makeSheet(headers) {
    const data = headers && headers.length ? [headers.slice()] : [];
    return {
      _data: data,
      getDataRange() { return { getValues: () => data.map(r => r.slice()) }; },
      appendRow(row) { data.push(row.slice()); },
      getRange(r, c) { return { setValue: (v) => { while (data[r - 1].length < c) data[r - 1].push(''); data[r - 1][c - 1] = v; }, getValue: () => data[r - 1][c - 1] }; },
      getLastRow() { return data.length; },
      getLastColumn() { return data[0] ? data[0].length : 0; }
    };
  }

  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch() { throw new Error('no network'); } },
    Utilities: { getUuid: () => crypto.randomUUID() },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, putAll() {}, getAll: () => ({}) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    MailApp: { sendEmail() {} },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ __text: t }) }) },
    DriveApp: {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gs, ctx, { filename: 'appsscript.js' });

  // Replace the I/O edges with in-memory versions; the logic stays real.
  Object.assign(ctx, {
    getOrCreateSheet(name, headers) {
      if (!sheets[name]) sheets[name] = makeSheet(headers);
      return sheets[name];
    },
    ensureSheetHeaders(sheet, headers) {
      if (!sheet._data.length) sheet._data.push([]);
      const current = sheet._data[0];
      headers.forEach(h => { if (current.indexOf(h) === -1) current.push(h); });
      return current.slice();
    },
    saveFileToDrive: (data) => (data ? 'https://drive.example/file' : ''),
    createNotification: (...args) => { notifications.push(args); return {}; },
    appendStageEvent: () => ({}),
    getAuthenticatedEmail: () => session,
    isAuthenticatedAdmin: () => session === 'swapsutra@gmail.com',
    recalculateBooksListedCount: (e) => bookCounts[String(e).toLowerCase()] || 0,
    appendStageEvent: (e) => { stageLog.push(e); return {}; },
    sendSwapSutraEmail: (m) => { emails.push(m); return true; },
    loadSwapForCirculation: (id) => swapsById[id] || null,
    callerIsPartyTo: (swap, email) => email === swap.ownerEmail || email === swap.requesterEmail,
    swapChatUnlocked: () => true,
    getOrCreateFolder: (name) => ({ getId: () => 'folder_' + name }),
    findChatBySwapId: () => ({ chatId: 'CHAT1' }),
    sendChatMessage: (m) => { chats.push(m); return { success: true }; },
    swapHasOpenDispute: (id) => !!openDisputes[id],
    appendJourneyEvent: (e) => { journeyLog.push(e); return { success: true }; }
  });
  // Google Drive resumable upload, faked: 308 until the last piece, then the file id.
  ctx.ScriptApp = { getOAuthToken: () => 'tok' };
  ctx.UrlFetchApp = { fetch: (url, opt) => {
    fetches.push({ url, opt });
    if (url.indexOf('uploadType=resumable') !== -1) return { getResponseCode: () => 200, getHeaders: () => ({ Location: 'https://upload.example/session1' }), getContentText: () => '' };
    const range = String(opt.headers['Content-Range']); const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
    const done = Number(m[2]) + 1 === Number(m[3]);
    return { getResponseCode: () => done ? 200 : 308, getHeaders: () => ({}), getContentText: () => done ? JSON.stringify({ id: 'FILE1' }) : '' };
  } };
  ctx.DriveApp = { Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 }, getFileById: (id) => ({ setSharing() {}, getUrl: () => 'https://drive.example/' + id }) };
  ctx.Utilities = Object.assign({}, ctx.Utilities || {}, {
    getUuid: () => crypto.randomUUID(),
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
    computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(str).digest()).map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 'sha256' },
    formatDate: (d) => new Date(d).toISOString()
  });
  const api = new Proxy({}, { get: (_, name) => (...args) => { ctx.__a = args; return JSON.parse(JSON.stringify(vm.runInContext(`${String(name)}.apply(null, __a)`, ctx) ?? null)); } });

  return {
    api, sheets, props, notifications, stageLog, emails, swapsById, ctx, chats, journeyLog, fetches, openDisputes,
    as(email) { session = email; },
    setBooks(email, n) { bookCounts[email] = n; },
    addUser(email, extra) {
      const s = ctx.getOrCreateSheet('Users', ['email', 'name', 'phone', 'membershipStatus']);
      s.appendRow([email, 'R', '9800000000', (extra && extra.membershipStatus) || '']);
    },
    addSub(email, extra) {
      const s = ctx.getOrCreateSheet('Subscriptions', ['email', 'name', 'adminStatus', 'membershipStatus', 'activationType', 'trialStartDate', 'trialEndDate']);
      s.appendRow([email, 'R', (extra && extra.adminStatus) || 'Pending', (extra && extra.membershipStatus) || '',
        (extra && extra.activationType) || '', (extra && extra.trialStartDate) || '', (extra && extra.trialEndDate) || '']);
    }
  };
}



const JOURNEY_HEADERS = ['id', 'swapId', 'leg', 'event', 'actorEmail', 'method', 'courierName', 'awb', 'note', 'mediaUrl', 'expectedBy', 'createdAt', 'lat', 'lng'];
function setup(serviceType, method, extra) {
  const env = makeEnv();
  const swap = { obj: Object.assign({ id: 'S1', serviceType, status: 'Accepted', requestedBookTitle: 'Dune', securityDeposit: 260, ownerDeposit: 0, swapPreference: '' }, extra || {}),
    ownerEmail: 'own@x.com', requesterEmail: 'req@x.com' };
  env.swapsById.S1 = swap;
  const j = env.ctx.getOrCreateSheet('SwapJourney', JOURNEY_HEADERS);
  if (method) j.appendRow(['j0', 'S1', 'outbound', 'route_set', 'req@x.com', method, '', '', '', '', '', new Date(), '', '']);
  return { env, swap };
}
function addVideo(env, leg, kind, email) {
  const s = env.ctx.getOrCreateSheet('ExchangeVideos', ['id', 'swapId', 'leg', 'kind', 'uploaderEmail', 'role', 'method', 'fileId', 'url', 'mimeType', 'sizeBytes', 'durationSec', 'recordedInApp', 'stampCode', 'createdAt']);
  s.appendRow(['v' + Math.random(), 'S1', leg, kind, email, '', '', 'F', 'u', 'video/mp4', 1, 10, 'true', '', new Date()]);
}

console.log('--- which videos, for whom ---');
{
  const { env, swap } = setup('RENT', 'courier');
  // 8 Oct 2026 (Exchange Room): condition, packaging and handover videos for
  // the sender on every route; the receiver records the unboxing.
  check('1. Courier: sender records condition + packaging + handover, receiver records receiving',
    JSON.stringify(env.api.vmsKindsFor_('courier')) === JSON.stringify({ sender: ['QUALITY', 'PACKING', 'HANDOVER'], receiver: ['RECEIVING'] }));
  check('2. In person: the same three sender videos', JSON.stringify(env.api.vmsKindsFor_('in_person').sender) === JSON.stringify(['QUALITY', 'PACKING', 'HANDOVER']));
  check('3. A rental: the book out and the book back', JSON.stringify(env.api.vmsLegsFor_(swap)) === JSON.stringify(['outbound', 'return']));
  const tswap = { obj: { id: 'S2', serviceType: 'SWAP', swapPreference: 'Temporary' }, ownerEmail: 'o', requesterEmail: 'r' };
  check('4. A temporary swap: both books, both ways', JSON.stringify(env.api.vmsLegsFor_(tswap)) === JSON.stringify(['outbound', 'counter', 'return', 'counter_return']));
  check('5. A sale: one book, one way — videos still required', JSON.stringify(env.api.vmsLegsFor_({ obj: { serviceType: 'SELL' } })) === JSON.stringify(['outbound']));
}

console.log('--- the timeline refuses without videos ---');
{
  const { env } = setup('RENT', 'courier');
  env.as('own@x.com');
  let r = env.api.logJourneyEvent({ swapId: 'S1', leg: 'outbound', event: 'dispatched', courierName: 'Delhivery', awb: 'A1' });
  check('6. Owner cannot post the book without quality + packing videos', r.error === 'VIDEO_REQUIRED' && r.missing.join() === 'QUALITY,PACKING', JSON.stringify(r));
  addVideo(env, 'outbound', 'QUALITY', 'own@x.com');
  r = env.api.logJourneyEvent({ swapId: 'S1', leg: 'outbound', event: 'dispatched', courierName: 'Delhivery', awb: 'A1' });
  check('7. ...still refused with only the quality video', r.error === 'VIDEO_REQUIRED' && r.missing.join() === 'PACKING');
  addVideo(env, 'outbound', 'PACKING', 'own@x.com');
  r = env.api.logJourneyEvent({ swapId: 'S1', leg: 'outbound', event: 'dispatched', courierName: 'Delhivery', awb: 'A1' });
  check('8. With both, posting goes through', r.success === true && env.journeyLog.length === 1);
  env.as('req@x.com');
  r = env.api.logJourneyEvent({ swapId: 'S1', leg: 'outbound', event: 'received' });
  check('9. Renter cannot confirm receipt without the unboxing video', r.error === 'VIDEO_REQUIRED');
  addVideo(env, 'outbound', 'RECEIVING', 'own@x.com');
  check('10. Someone else\'s video does not count for you', env.api.logJourneyEvent({ swapId: 'S1', leg: 'outbound', event: 'received' }).error === 'VIDEO_REQUIRED');
  addVideo(env, 'outbound', 'RECEIVING', 'req@x.com');
  check('11. With their own unboxing video, receipt goes through', env.api.logJourneyEvent({ swapId: 'S1', leg: 'outbound', event: 'received' }).success === true);
  r = env.api.logJourneyEvent({ swapId: 'S1', leg: 'return', event: 'dispatched', courierName: 'Delhivery', awb: 'B2' });
  check('12. The return trip needs its own videos too', r.error === 'VIDEO_REQUIRED');
  check('13. Reporting a problem is never blocked', env.api.logJourneyEvent({ swapId: 'S1', leg: 'outbound', event: 'issue_raised', note: 'torn' }).success === true);
}
{
  const { env } = setup('SWAP', 'in_person', { ownerDeposit: 240 });
  env.as('req@x.com');
  let r = env.api.logJourneyEvent({ swapId: 'S1', leg: 'counter', event: 'handed_over' });
  check('14. In a swap the requester\'s own book needs its videos before handover', r.error === 'VIDEO_REQUIRED' && r.missing.join() === 'QUALITY,PACKING,HANDOVER');
  addVideo(env, 'counter', 'QUALITY', 'req@x.com'); addVideo(env, 'counter', 'PACKING', 'req@x.com');
  check('15a. In person, the handover video is needed too', env.api.logJourneyEvent({ swapId: 'S1', leg: 'counter', event: 'handed_over' }).missing.join() === 'HANDOVER');
  addVideo(env, 'counter', 'HANDOVER', 'req@x.com');
  check('15. With all three, the handover goes through', env.api.logJourneyEvent({ swapId: 'S1', leg: 'counter', event: 'handed_over' }).success === true);
}

console.log('--- the Stages panel asks for the same ---');
{
  const { env, swap } = setup('SWAP', 'courier', { ownerDeposit: 240 });
  check('16. Handover (owner): their outbound condition + packaging + handover', env.api.vmsStageMissing_(swap, 'HANDOVER', 'owner').join() === 'QUALITY,PACKING,HANDOVER');
  check('17. Receipt (owner, in a swap): unboxing of the requester\'s book', env.api.vmsStageMissing_(swap, 'RECEIPT', 'owner').join() === 'RECEIVING');
  addVideo(env, 'outbound', 'QUALITY', 'own@x.com'); addVideo(env, 'outbound', 'PACKING', 'own@x.com'); addVideo(env, 'outbound', 'HANDOVER', 'own@x.com');
  check('18. Once recorded, nothing is missing', env.api.vmsStageMissing_(swap, 'HANDOVER', 'owner').length === 0);
  check('19. confirmStage enforces it', /const vmsGap = vmsStageMissing_\(swap, stage, role\);/.test(gs));
}

console.log('--- chunked upload ---');
{
  const { env } = setup('RENT', 'courier');
  env.as('req@x.com');
  check('20. The renter cannot upload a packing video for the owner\'s book', env.api.vmsStartUpload({ swapId: 'S1', leg: 'outbound', kind: 'PACKING', mimeType: 'video/mp4', sizeBytes: 100 }).error === 'WRONG_PARTY');
  env.as('stranger@x.com');
  check('21. Strangers cannot upload', env.api.vmsStartUpload({ swapId: 'S1', leg: 'outbound', kind: 'QUALITY', mimeType: 'video/mp4', sizeBytes: 100 }).error === 'UNAUTHORIZED');
  env.as('own@x.com');
  check('22. Not a video: refused', env.api.vmsStartUpload({ swapId: 'S1', leg: 'outbound', kind: 'QUALITY', mimeType: 'image/png', sizeBytes: 100 }).success === false);
  check('23. Over 80 MB: refused', env.api.vmsStartUpload({ swapId: 'S1', leg: 'outbound', kind: 'QUALITY', mimeType: 'video/mp4', sizeBytes: 81 * 1048576 }).error === 'TOO_LARGE');
  const size = 2621440 * 2 + 1000;
  const st = env.api.vmsStartUpload({ swapId: 'S1', leg: 'outbound', kind: 'QUALITY', mimeType: 'video/mp4', sizeBytes: size });
  check('24. A 5 MB video is sent in 3 pieces of 2.5 MB', st.success && st.totalChunks === 3 && st.chunkBytes === 2621440);
  const piece = (n) => Buffer.alloc(n, 7).toString('base64');
  check('25. Pieces must arrive in order', env.api.vmsUploadChunk({ uploadId: st.uploadId, index: 1, data: piece(2621440) }).error === 'OUT_OF_ORDER');
  check('26. A damaged piece is refused', env.api.vmsUploadChunk({ uploadId: st.uploadId, index: 0, data: piece(100) }).success === false);
  check('27. Piece 1', env.api.vmsUploadChunk({ uploadId: st.uploadId, index: 0, data: piece(2621440) }).next === 1);
  check('28. Piece 2', env.api.vmsUploadChunk({ uploadId: st.uploadId, index: 1, data: piece(2621440) }).next === 2);
  check('29. Last piece completes the Drive file', env.api.vmsUploadChunk({ uploadId: st.uploadId, index: 2, data: piece(1000) }).stored === true);
  const ranges = env.fetches.filter(f => f.opt.method === 'put').map(f => f.opt.headers['Content-Range']);
  check('30. Drive was sent the right byte ranges', JSON.stringify(ranges) === JSON.stringify(['bytes 0-2621439/' + size, 'bytes 2621440-5242879/' + size, 'bytes 5242880-' + (size - 1) + '/' + size]), JSON.stringify(ranges));
  env.as('req@x.com');
  check('31. Someone else cannot finish your upload', env.api.vmsFinishUpload({ uploadId: st.uploadId }).error === 'UNAUTHORIZED');
  env.as('own@x.com');
  const fin = env.api.vmsFinishUpload({ uploadId: st.uploadId, durationSec: 42, recordedInApp: true });
  check('32. Finishing registers the video', fin.success && fin.video.kind === 'QUALITY');
  check('33. ...and posts a note in the exchange chat', env.chats.some(c => /book condition video/.test(c.message) && /Step 3/.test(c.message)));
  const view = env.api.getExchangeVideos({ swapId: 'S1' });
  check('34. The checklist shows it done, by you', view.legs[0].items.find(i => i.kind === 'QUALITY').done && view.legs[0].items.find(i => i.kind === 'QUALITY').byYou);
  check('35. Every exchange gets its own stamp code', /^SS-[0-9A-F]{6}$/.test(view.stampCode) && view.stampCode !== env.api.vmsStampCode_('S2'));
}

console.log('--- dispute decisions ---');
{
  const { env } = setup('SWAP', 'courier', { securityDeposit: 300, ownerDeposit: 260 });
  env.as('req@x.com');
  check('36. Only SwapSutra decides deposits', env.api.adminDecideDeposits({ swapId: 'S1', decisions: [] }).error === 'UNAUTHORIZED');
  env.as('swapsutra@gmail.com');
  check('37. Each decision needs a reason', env.api.adminDecideDeposits({ swapId: 'S1', decisions: [{ payerRole: 'requester', outcome: 'REFUND' }] }).success === false);
  check('38. Cannot forfeit more than is held', env.api.adminDecideDeposits({ swapId: 'S1', decisions: [{ payerRole: 'owner', outcome: 'FORFEIT', amount: 999, reason: 'x' }] }).success === false);
  const r = env.api.adminDecideDeposits({ swapId: 'S1', disputeId: 'D1', decisions: [
    { payerRole: 'requester', outcome: 'FORFEIT', amount: 120, reason: 'Unboxing video shows water damage the quality video did not' },
    { payerRole: 'owner', outcome: 'REFUND', reason: 'Owner\'s videos are complete' }] });
  check('39. Decision recorded', r.success === true, JSON.stringify(r));
  const rows = env.sheets.ReturnForfeits._data.slice(1);
  const f = rows.find(x => x[6] === 120);
  check('40. The forfeit is a payout to the OTHER reader', f && f[4] === 'req@x.com' && f[5] === 'own@x.com' && f[9] === 'TO_PAY_OWNER');
  check('41. ...the rest (₹180) is refunded, as the message says', env.notifications.some(n => /₹120 of the ₹300 deposit is forfeited/.test(n[3]) && /₹180 is refunded/.test(n[3])));
  check('42. Both readers are told', env.notifications.filter(n => n[1] === 'deposit_decided').length === 4);
  check('43. A deposit cannot be decided twice', env.api.adminDecideDeposits({ swapId: 'S1', disputeId: 'D1', decisions: [{ payerRole: 'owner', outcome: 'FORFEIT', reason: 'x' }] }).success === false);
}

console.log('--- an open dispute pauses the late-return forfeit ---');
{
  const env = makeEnv();
  env.ctx.DB_SCHEMA = { SwapRequests: ['id', 'serviceType', 'status', 'requestedBookTitle', 'securityDeposit', 'ownerDeposit', 'swapPreference'] };
  env.ctx.getOrCreateSheet('SwapRequests', env.ctx.DB_SCHEMA.SwapRequests).appendRow(['L1', 'RENT', 'accepted', 'Dune', 260, 0, '']);
  env.swapsById.L1 = { obj: { id: 'L1', serviceType: 'RENT', requestedBookTitle: 'Dune' }, ownerEmail: 'o@x.com', requesterEmail: 'r@x.com' };
  env.ctx.getOrCreateSheet('SwapJourney', JOURNEY_HEADERS).appendRow(['1', 'L1', 'outbound', 'received', '', '', '', '', '', '', '', new Date(Date.now() - 25 * 86400000), '', '']);
  env.openDisputes.L1 = true;
  env.api.runReturnDeadlines();
  check('44. No automatic forfeit while the dispute is open', !env.sheets.ReturnForfeits || env.sheets.ReturnForfeits._data.length <= 1);
  check('45. SwapSutra is told to decide from the videos', env.notifications.some(n => n[1] === 'return_overdue_disputed'));
}

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail === 0 ? 0 : 1);
