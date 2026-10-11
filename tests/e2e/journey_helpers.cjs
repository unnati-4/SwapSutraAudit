const { boot } = require('./gas_fake.cjs');
const PNG = 'data:image/png;base64,' + Buffer.from('\x89PNG\r\n\x1a\nfakepngdata').toString('base64');
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 fake').toString('base64');
const MP4 = Buffer.from('fake-mp4-bytes-for-a-short-clip').toString('base64');
const ADMIN = 'swapsutra@gmail.com';

function mkCheck() {
  const out = { pass: 0, fail: 0, fails: [] };
  out.C = (label, cond, detail) => {
    if (cond) { out.pass++; console.log('PASS  ' + label); }
    else { out.fail++; out.fails.push(label); console.log('FAIL  ' + label + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
    return !!cond;
  };
  return out;
}

function signup(rt, name, email, phone) {
  const r1 = rt.post({ action: 'createSubscription', name, email, phone, activationType: 'free', membershipType: 'free', paymentRequired: false, isPaymentRequired: false, originalAmount: 0, amount: 0, finalAmount: 0, adminStatus: 'Approved', paymentStatus: 'Approved', isUpgrade: false });
  const r2 = rt.post({ action: 'sendOTP', email });
  const otp = rt.lastOtp(email);
  const r3 = rt.post({ action: 'verifyOTP', email, otp });
  const r4 = r3.sessionToken ? rt.post({ action: 'registerFreeReader', email }, r3.sessionToken) : null;
  return { token: r3.sessionToken, steps: [r1, r2, r3, r4] };
}

function login(rt, email, purpose) {
  const s = rt.post({ action: 'sendOTP', email, purpose });
  const v = rt.post({ action: 'verifyOTP', email, otp: rt.lastOtp(email), purpose });
  return { token: v.sessionToken, send: s, verify: v };
}

function listBook(rt, token, email, o) {
  return rt.post(Object.assign({
    action: 'createBook', ownerEmail: email, title: 'The Alchemist', author: 'Paulo Coelho', condition: 'Good', genre: 'Fiction',
    area: 'Hazratganj', pincode: '226001', swapType: 'Permanent', bookshelf: true, permanent_exchange: true, temporary_exchange: false,
    rent: false, lend: false, sell: false, notes: 'Lightly read', bookFormat: 'PAPERBACK', bookEdition: 'PUBLISHER',
    printedMrp: 350, userEnteredMRP: 350, mrp: 350, noPrintedMrp: false, sellPrice: null, rentPerMonth: null,
    authenticityStatus: 'ORIGINAL', frontCoverImage: { fileName: 'front.png', mimeType: 'image/png', base64Data: PNG },
    backCoverImage: { fileName: 'back.png', mimeType: 'image/png', base64Data: PNG },
    latitude: '26.85', longitude: '80.94', isbn: '9780062315007', publisher: 'HarperCollins', copyType: 'ORIGINAL', copyTypeDeclaration: true, conditionNotes: ''
  }, o || {}), token);
}

/** Record and upload a condition/handover video the way the room's recorder does. */
function video(rt, token, swapId, leg, kind) {
  const start = rt.post({ action: 'vmsStartUpload', swapId, leg, kind, mimeType: 'video/mp4', sizeBytes: Buffer.from(MP4, 'base64').length, durationSec: 20 }, token);
  if (!start.success) return start;
  let r;
  for (let i = 0; i < start.totalChunks; i++) {
    const bytes = Buffer.from(MP4, 'base64');
    const piece = bytes.slice(i * start.chunkBytes, (i + 1) * start.chunkBytes).toString('base64');
    r = rt.post({ action: 'vmsUploadChunk', uploadId: start.uploadId, index: i, data: piece }, token);
    if (!r.success) return r;
  }
  return rt.post({ action: 'vmsFinishUpload', uploadId: start.uploadId, durationSec: 20, recordedInApp: true }, token);
}

module.exports = { boot, PNG, PDF, MP4, ADMIN, mkCheck, signup, login, listBook, video };

/**
 * Plays an exchange room to the end the way two readers and the admin
 * would: each turn, whoever has something to do does the first thing the
 * room offers them; the admin verifies payments; when nobody can act,
 * a day passes and the hourly/daily jobs run. Returns the log.
 */
function playRoom(rt, swapId, people, opts) {
  const o = Object.assign({ route: 'in_person', maxTurns: 260, admin: null, decline: {} }, opts || {});
  const log = [];
  const DAY = 24 * 3600e3;
  let idle = 0;
  const addr = (who) => ({ label: 'Home', line1: '12 MG Road', line2: '', landmark: 'Near metro', area: 'Hazratganj', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001', phone: who === 'owner' ? '9876543210' : '9812345678' });
  for (let turn = 0; turn < o.maxTurns; turn++) {
    let acted = false;
    for (const role of ['owner', 'requester']) {
      const p = people[role];
      const room = rt.post({ action: 'getExchangeRoom', swapId }, p.token);
      if (!room.success) { log.push({ role, error: room.message || room.error }); return { log, done: false, reason: 'room failed: ' + (room.message || room.error) }; }
      if (room.closed) continue;
      const todo = (room.actions || []).filter(a => a.type !== 'close' && a.type !== 'requestExtension' && a.type !== 'answerExtension')
        .sort((x, y) => (x.type === 'payoutAccount' ? -1 : 0) - (y.type === 'payoutAccount' ? -1 : 0));
      const a = todo[0];
      if (!a) continue;
      let r;
      if (a.type === 'video') r = video(rt, p.token, swapId, a.leg, a.kind);
      else if (a.type === 'pay') r = rt.post({ action: 'submitSecurityFeePayment', swapId, utr: '4321' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), fileData: PNG, fileName: 'paid.png' }, p.token);
      else if (a.type === 'setRoute') r = rt.post(Object.assign({ action: 'exchangeRoomAction', swapId, act: 'setRoute', phase: a.phase },
        o.route === 'courier' ? { method: 'courier' } : { method: 'in_person', meetingLat: 26.85, meetingLng: 80.94, meetingPoint: 'Hazratganj metro gate 2' }), p.token);
      else if (a.type === 'address') r = rt.post(Object.assign({ action: 'saveDeliveryAddress' }, addr(role)), p.token);
      else if (a.type === 'courier') r = rt.post({ action: 'exchangeRoomAction', swapId, act: 'courierDetails', leg: a.leg, courierName: 'Delhivery', awb: 'DL' + String(Date.now() % 1e9).padStart(9, '0') }, p.token);
      else if (a.type === 'markDelivered') r = rt.post({ action: 'exchangeRoomAction', swapId, act: 'markDelivered', leg: a.leg }, p.token);
      else if (a.type === 'markReceived') r = rt.post({ action: 'exchangeRoomAction', swapId, act: 'markReceived', leg: a.leg, happy: true }, p.token);
      else if (a.type === 'payoutAccount') r = rt.post({ action: 'savePayoutAccount', upiId: role + '.reader@okicici', payeeName: role === 'owner' ? 'Meera Sharma' : 'Arjun Verma' }, p.token);
      else if (a.type === 'rate') r = rt.post({ action: 'exchangeRoomAction', swapId, act: 'rate', readerRating: 5, platformRating: 5, readerComment: 'Smooth exchange, thank you!' }, p.token);
      else { log.push({ role, unknown: a }); return { log, done: false, reason: 'unknown action ' + a.type }; }
      log.push({ role, act: a.type + (a.kind ? ':' + a.kind : '') + (a.leg ? '@' + a.leg : ''), ok: !!(r && r.success), msg: r && !r.success ? (r.message || r.error) : '' });
      if (!r || !r.success) return { log, done: false, reason: role + ' ' + a.type + ' failed: ' + (r && (r.message || r.error)) };
      acted = true;
    }
    // The admin verifies any payment waiting for them.
    if (o.admin) {
      const room = rt.post({ action: 'getExchangeRoom', swapId }, o.admin);
      const waiting = ((room.payment && room.payment.payers) || []).filter(x => x.adminStatus === 'ADMIN_PENDING');
      for (const w of waiting) {
        const r = rt.post({ action: 'adminApproveSecurityFeePayment', swapId, payerRole: w.payerRole, decision: 'APPROVE' }, o.admin);
        log.push({ role: 'admin', act: 'approve:' + w.payerRole, ok: !!r.success, msg: r.success ? '' : (r.message || r.error) });
        if (!r.success) return { log, done: false, reason: 'admin approve failed: ' + (r.message || r.error) };
        acted = true;
      }
    }
    const both = ['owner', 'requester'].map(role => rt.post({ action: 'getExchangeRoom', swapId }, people[role].token));
    if (both.every(r => r.closed)) return { log, done: true, rooms: both };
    if (o.until && o.until(both[0], both[1])) return { log, done: false, paused: true, rooms: both };
    if (!acted) {
      idle++;
      if (idle > 40) return { log, done: false, reason: 'stuck: ' + both.map(r => r.waitingOn + ' [step ' + r.current + ']').join(' | '), rooms: both };
      rt.now(Date.now() + DAY);
      for (const job of ['runReturnDeadlines', 'runSwapRequestSla', 'runCirculationSla']) {
        try { rt.ctx[job](); } catch (e) { log.push({ role: 'job', act: job, ok: false, msg: String(e && e.message || e) }); }
      }
      log.push({ role: 'clock', act: '+1 day' });
    } else idle = 0;
  }
  return { log, done: false, reason: 'too many turns' };
}

module.exports.playRoom = playRoom;
