import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { apiUrl } from '../config/runtime';
import { VideoRecorder, uploadExchangeVideo, VMS_TITLES, type VmsKind, type VmsLeg } from './ExchangeVideos';
import { LocationCard } from './LocationPin';
import { GoogleReviewCard, PayoutAccountForm } from './SalePanel';
import DisputeReport from './DisputeReport';

const LocationPinPicker = lazy(() => import('./LocationPin').then(m => ({ default: m.LocationPinPicker })));

/**
 * THE EXCHANGE ROOM (Oct 2026, owner's request).
 *
 * Chat, condition protection and the exchange stages used to be three tabs.
 * Now they are one room: this panel sits above the chat and shows the 16
 * steps every exchange goes through (sell, rent, lend, swap), the step
 * you're on, and exactly what YOU can do next. Every step also posts a line
 * into the chat below, so the conversation is the record.
 *
 * The server (getExchangeRoom) decides everything shown here — which steps
 * are done, what each reader may do, the deadlines — and re-checks every
 * action. Nothing here is trusted on its own.
 */

const API_URL = apiUrl('/api/swapsutra');

type StepState = 'done' | 'current' | 'upcoming' | 'skipped' | 'closed';
interface RoomStep { n: number; title: string; state: StepState; detail: string; at: string }
interface VideoState { done: boolean; url?: string; at?: string }
interface RoomLeg {
  leg: VmsLeg; sender: string; receiver: string; youSend: boolean; youReceive: boolean;
  videos: Record<VmsKind, VideoState>;
  courierName: string; awb: string; trackingUrl: string; senderMarkedAt: string; receivedAt: string;
}
interface RoomRoute { method: string; note: string; lat: number | null; lng: number | null; setBy: string; at: string }
interface RoomAction {
  type: string; step: number; leg?: VmsLeg; kind?: VmsKind; phase?: 'out' | 'back'; amount?: number;
  method?: string; sale?: boolean; extensionId?: string; days?: number; reason?: string; closesAt?: string;
}
interface Payer {
  payerRole: string; requiredAmount: number; depositAmount?: number; platformFee?: number; saleAmount?: number;
  adminStatus: string; utr?: string; screenshotUrl?: string; rejectedReason?: string;
}
export interface RoomData {
  success: boolean; message?: string;
  swapId: string; role: string; type: string; bookTitle: string; otherName: string;
  needsReturn: boolean; closed: boolean; closedReason: string; current: number;
  steps: RoomStep[]; actions: RoomAction[]; waitingOn: string; disputeOpen: boolean;
  legs: { out: RoomLeg[]; back: RoomLeg[] };
  route: { out: RoomRoute | null; back: RoomRoute | null };
  deadlines: { conditionBy: string; payBy: string };
  payment: { payers: Payer[]; allApproved: boolean; upi: { vpa: string; payee: string } };
  returnInfo: { dueAt: string; daysLeft: number; overdue: boolean; extensionDays: number } | null;
  sale: { price: number; sellerReceives: number; payoutStatus: string } | null;
  exchangeDone: boolean; myAddressSaved?: boolean;
  stampCode: string; couriers: string[]; reviewUrl: string;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

export function roomWhen(v?: string) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const btnSolid = 'px-4 py-2.5 rounded-xl bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50';
const btnQuiet = 'px-4 py-2.5 rounded-xl border border-brand-border text-2xs font-bold uppercase tracking-widest text-[var(--text-primary)] hover:border-brand-gold disabled:opacity-50';

/** "your book" / "their book" when two books travel; "the book" otherwise. */
function bookName(leg: RoomLeg | undefined, room: RoomData) {
  if (!leg) return 'the book';
  const two = room.legs.out.length > 1;
  if (!two) return 'the book';
  return leg.sender === room.role ? 'your book' : 'their book';
}

function StepDot({ state }: { state: StepState }) {
  const cls = state === 'done' ? 'bg-emerald-600 text-white' : state === 'current' ? 'bg-brand-gold text-[var(--text-primary)] ring-4 ring-brand-gold/20'
    : state === 'closed' ? 'bg-red-100 text-red-700' : state === 'skipped' ? 'bg-transparent border border-dashed border-brand-border text-[var(--text-secondary)]'
    : 'bg-[var(--bg-surface-inset)] text-[var(--text-secondary)]';
  return <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${cls}`}>{state === 'done' ? '✓' : state === 'closed' ? '×' : ''}</span>;
}

export default function ExchangeRoom({ swapId, isAdmin = false, onChanged }: { swapId: string; isAdmin?: boolean; onChanged?: () => void }) {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [showSteps, setShowSteps] = useState(false);
  const [recording, setRecording] = useState<{ leg: VmsLeg; kind: VmsKind } | null>(null);
  const [progress, setProgress] = useState<{ key: string; p: number } | null>(null);
  const [pinFor, setPinFor] = useState<'out' | 'back' | null>(null);
  const [utr, setUtr] = useState('');
  const [payFile, setPayFile] = useState<File | null>(null);
  const [courier, setCourier] = useState<Record<string, { name: string; awb: string }>>({});
  const [happy, setHappy] = useState(false);
  const [extReason, setExtReason] = useState('');
  const [rating, setRating] = useState({ reader: 0, platform: 0, readerComment: '', platformComment: '' });
  const [rated, setRated] = useState<{ reviewUrl: string; message: string } | null>(null);
  const [addr, setAddr] = useState({ line1: '', area: '', city: '', state: '', pincode: '', phone: '' });
  const [counterAddr, setCounterAddr] = useState<Record<string, string> | null>(null);
  const [showReport, setShowReport] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const d = await post({ action: 'getExchangeRoom', swapId });
      if (d?.success) { setRoom(d as RoomData); setError(''); }
      else setError(d?.message || 'The exchange could not be loaded.');
    } catch {
      setError('Could not reach SwapSutra. Check your connection.');
    }
  }, [swapId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  // On a courier route, the sender needs the receiver's address.
  const courierRoute = room && !room.closed && ((room.route.out?.method === 'courier' && !room.exchangeDone) || room.route.back?.method === 'courier');
  useEffect(() => {
    if (!courierRoute) { setCounterAddr(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}?action=getDeliveryAddress&swapId=${encodeURIComponent(swapId)}`);
        const d = await res.json();
        if (!cancelled) setCounterAddr(d?.counterparty || null);
      } catch { /* shown as "not added yet" */ }
    })();
    return () => { cancelled = true; };
  }, [courierRoute, swapId, room?.myAddressSaved]);

  const after = async (res: any, okText?: string) => {
    setMsg(res?.success ? (okText || res.message || 'Done.') : (res?.message || 'That did not go through. Please try again.'));
    await refresh();
    onChanged?.();
  };

  const roomAct = async (key: string, body: Record<string, unknown>, okText?: string) => {
    setBusy(key); setMsg('');
    try { await after(await post({ action: 'exchangeRoomAction', swapId, ...body }), okText); }
    catch { setMsg('Network error. Please try again.'); }
    finally { setBusy(''); }
  };

  const onRecorded = async (leg: VmsLeg, kind: VmsKind, blob: Blob, meta: { durationSec: number; recordedInApp: boolean }) => {
    setRecording(null); setMsg('');
    const key = leg + kind;
    setProgress({ key, p: 0 });
    const r = await uploadExchangeVideo(blob, swapId, leg, kind, meta, (p) => setProgress({ key, p }));
    setProgress(null);
    setMsg(r.ok ? 'Video saved — it is recorded in this room.' : (r.message || 'The video could not be saved.'));
    if (r.ok) { await refresh(); onChanged?.(); }
  };

  const submitPayment = async () => {
    if (!utr.trim()) { setMsg('Enter the UTR / transaction reference from your UPI app.'); return; }
    if (!payFile) { setMsg('Attach a screenshot of the payment.'); return; }
    setBusy('pay'); setMsg('');
    try {
      const fileData = await fileToDataUrl(payFile);
      const res = await post({ action: 'submitSecurityFeePayment', swapId, utr: utr.trim(), fileData, fileName: payFile.name });
      if (res?.success) { setUtr(''); setPayFile(null); }
      await after(res, 'Payment sent — SwapSutra will verify it shortly.');
    } catch { setMsg('Network error. Please try again.'); }
    finally { setBusy(''); }
  };

  const adminReview = async (payerRole: string, decision: 'APPROVE' | 'REJECT') => {
    let reason = '';
    if (decision === 'REJECT') { reason = window.prompt('Why is this payment not accepted?') || ''; if (!reason) return; }
    setBusy('admin_' + payerRole);
    try { await after(await post({ action: 'adminApproveSecurityFeePayment', swapId, payerRole, decision, reason })); }
    finally { setBusy(''); }
  };

  const saveAddress = async () => {
    setBusy('addr'); setMsg('');
    try { await after(await post({ action: 'saveDeliveryAddress', label: 'Home', ...addr }), 'Address saved — only the other reader in this exchange sees it.'); }
    finally { setBusy(''); }
  };

  if (error && !room) return <div className="p-4 text-center text-xs text-red-600" role="alert">{error}</div>;
  if (!room) return <div className="p-4 text-center text-xs italic text-[var(--text-secondary)]">Opening the exchange room…</div>;

  const current = room.steps.find(s => s.n === room.current);
  const doneCount = room.steps.filter(s => s.state === 'done' || s.state === 'skipped').length;
  const legOf = (leg?: string) => room.legs.out.concat(room.legs.back).find(l => l.leg === leg);
  const myPayer = room.payment.payers.find(p => p.payerRole === room.role);
  const otherPayer = room.payment.payers.find(p => p.payerRole !== room.role);
  const upiLink = (amount: number) => `upi://pay?pa=${room.payment.upi.vpa}&pn=${encodeURIComponent(room.payment.upi.payee)}&am=${amount}&cu=INR&tn=${encodeURIComponent('SwapSutra exchange ' + room.swapId.slice(-6))}`;
  const videoActions = room.actions.filter(a => a.type === 'video');
  const otherActions = room.actions.filter(a => a.type !== 'video');

  const card = (key: string, title: string, body: ReactNode, step?: number) => (
    <div key={key} className="rounded-2xl border border-brand-gold/30 bg-[var(--bg-surface)] p-4 space-y-3" data-testid={'room-action-' + key}>
      <p className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text">{step ? `Step ${step} · ` : ''}{title}</p>
      {body}
    </div>
  );

  const renderAction = (a: RoomAction, i: number) => {
    const leg = legOf(a.leg);
    switch (a.type) {
      case 'pay': {
        const p = myPayer;
        if (!p) return null;
        const parts = (p.saleAmount ?? 0) > 0
          ? `₹${p.saleAmount} book price + ₹${p.platformFee ?? 0} platform fee. SwapSutra holds the price and pays the seller only after you have the book and say you're happy.`
          : (p.depositAmount ?? 0) > 0 ? `₹${p.depositAmount} refundable security deposit + ₹${p.platformFee ?? 0} platform fee. The deposit comes back when the exchange is complete.`
          : `₹${p.platformFee ?? p.requiredAmount} platform fee.`;
        return card('pay', `Pay ₹${p.requiredAmount}`, (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{parts}</p>
            {p.adminStatus === 'ADMIN_REJECTED' && <p className="text-xs text-red-600">Your last payment was not accepted{p.rejectedReason ? `: ${p.rejectedReason}` : ''}. Please pay again.</p>}
            <a href={upiLink(p.requiredAmount)} className="mx-auto block w-fit rounded-xl bg-white p-2" title="Open in your UPI app">
              <QRCodeCanvas value={upiLink(p.requiredAmount)} size={156} level="H" includeMargin />
            </a>
            <p className="text-center text-2xs text-[var(--text-secondary)]">Scan with any UPI app (or tap it on your phone). Don't change the amount.{room.deadlines.payBy ? ` Pay by ${roomWhen(room.deadlines.payBy)}.` : ''}</p>
            <input value={utr} onChange={e => setUtr(e.target.value)} placeholder="UTR / transaction reference" className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)]" />
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPayFile(e.currentTarget.files?.[0] || null)} className="block w-full text-2xs" aria-label="Payment screenshot" />
            <button type="button" onClick={submitPayment} disabled={busy === 'pay'} className={`w-full ${btnSolid}`}>{busy === 'pay' ? 'Sending…' : 'I have paid — send for verification'}</button>
          </div>
        ), a.step);
      }
      case 'close':
        return (
          <div key={'close' + i} className="text-center">
            <button type="button" disabled={busy === 'close'} onClick={() => {
              if (window.confirm('Close this request? Nothing happens to the book, and anything you already paid is refunded in full.')) roomAct('close', { act: 'close' }, 'The request is closed.');
            }} className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] underline hover:text-red-600">
              Changed your mind? Close this request
            </button>
          </div>
        );
      case 'setRoute':
        return card('route-' + a.phase, a.phase === 'back' ? 'How will the book come back?' : 'Meeting point or courier?', (
          pinFor === a.phase ? (
            <Suspense fallback={<p className="text-xs italic text-[var(--text-secondary)]">Loading the map…</p>}>
              <LocationPinPicker submitLabel="Set meeting point" busy={busy === 'route'} onCancel={() => setPinFor(null)}
                onSubmit={(pin) => roomAct('route', { act: 'setRoute', phase: a.phase, method: 'in_person', meetingLat: pin.lat, meetingLng: pin.lng, meetingPoint: pin.label })
                  .then(() => setPinFor(null))} />
            </Suspense>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">Agree in the chat below, then either of you records it. Addresses and phone numbers are shared only for courier.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={() => setPinFor(a.phase || 'out')} className={`flex-1 ${btnQuiet}`}>🤝 Meet in person</button>
                <button type="button" disabled={busy === 'route'} onClick={() => roomAct('route', { act: 'setRoute', phase: a.phase, method: 'courier' })} className={`flex-1 ${btnQuiet}`}>📦 Courier</button>
              </div>
            </div>
          )
        ), a.step);
      case 'address':
        return card('address', 'Your delivery address', (
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-secondary)]">The sender needs it for the courier. Only the other reader in this exchange sees it.</p>
            <input value={addr.line1} onChange={e => setAddr(f => ({ ...f, line1: e.target.value }))} placeholder="House / street" className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)]" />
            <div className="grid grid-cols-2 gap-2">
              <input value={addr.area} onChange={e => setAddr(f => ({ ...f, area: e.target.value }))} placeholder="Area" className="input-classic !py-2 text-xs bg-[var(--input-bg)]" />
              <input value={addr.city} onChange={e => setAddr(f => ({ ...f, city: e.target.value }))} placeholder="City" className="input-classic !py-2 text-xs bg-[var(--input-bg)]" />
              <input value={addr.state} onChange={e => setAddr(f => ({ ...f, state: e.target.value }))} placeholder="State" className="input-classic !py-2 text-xs bg-[var(--input-bg)]" />
              <input value={addr.pincode} onChange={e => setAddr(f => ({ ...f, pincode: e.target.value }))} placeholder="Pincode" inputMode="numeric" className="input-classic !py-2 text-xs bg-[var(--input-bg)]" />
            </div>
            <input value={addr.phone} onChange={e => setAddr(f => ({ ...f, phone: e.target.value }))} placeholder="Phone (for the courier)" inputMode="tel" className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)]" />
            <button type="button" disabled={busy === 'addr'} onClick={saveAddress} className={btnSolid}>{busy === 'addr' ? 'Saving…' : 'Save address'}</button>
          </div>
        ), a.step);
      case 'courier': {
        const c = courier[a.leg || ''] || { name: '', awb: '' };
        const set = (v: Partial<typeof c>) => setCourier(prev => ({ ...prev, [a.leg || '']: { ...c, ...v } }));
        return card('courier-' + a.leg, `Courier & tracking ID — ${bookName(leg, room)}`, (
          <div className="space-y-2">
            {counterAddr ? (
              <p className="rounded-xl bg-[var(--bg-page)] p-3 text-xs text-[var(--text-secondary)] leading-relaxed">
                <b className="text-[var(--text-primary)]">Send to {room.otherName}:</b> {[counterAddr.line1, counterAddr.line2, counterAddr.landmark, counterAddr.area, counterAddr.city, counterAddr.state, counterAddr.pincode].filter(Boolean).join(', ')}
                {counterAddr.phone && <> · <a className="underline" href={`tel:${counterAddr.phone}`}>{counterAddr.phone}</a></>}
              </p>
            ) : <p className="text-xs italic text-[var(--text-secondary)]">{room.otherName} hasn't added their address yet — ask in the chat.</p>}
            <select value={c.name} onChange={e => set({ name: e.target.value })} className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)]" aria-label="Courier company">
              <option value="">Courier company…</option>
              {room.couriers.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <input value={c.awb} onChange={e => set({ awb: e.target.value })} placeholder="Tracking ID (AWB)" className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)] uppercase" />
            <button type="button" disabled={busy === 'courier' || !c.name || !c.awb.trim()} onClick={() => roomAct('courier', { act: 'courierDetails', leg: a.leg, courierName: c.name, awb: c.awb.trim() })} className={btnSolid}>
              {busy === 'courier' ? 'Saving…' : 'Save tracking ID'}
            </button>
          </div>
        ), a.step);
      }
      case 'markDelivered':
        return card('delivered-' + a.leg, a.step === 14 ? 'Mark the book returned' : `Mark ${bookName(leg, room)} delivered`, (
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-secondary)]">{a.method === 'courier' ? 'Mark it once the tracking shows it delivered.' : 'Mark it once you have handed it over.'} The other reader marks it received.</p>
            <button type="button" disabled={busy === 'delivered'} onClick={() => roomAct('delivered', { act: 'markDelivered', leg: a.leg })} className={btnSolid}>
              {busy === 'delivered' ? 'Saving…' : a.step === 14 ? 'Book returned ✓' : 'Book delivered ✓'}
            </button>
          </div>
        ), a.step);
      case 'markReceived':
        return card('received-' + a.leg, a.step === 14 ? 'Mark your book received back' : `Mark ${bookName(leg, room)} received`, (
          <div className="space-y-2">
            {a.sale && (
              <label className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
                <input type="checkbox" checked={happy} onChange={e => setHappy(e.target.checked)} className="mt-0.5" />
                <span>I have the book and I'm happy with it. (SwapSutra then pays the seller.)</span>
              </label>
            )}
            <button type="button" disabled={busy === 'received' || (!!a.sale && !happy)} onClick={() => roomAct('received', { act: 'markReceived', leg: a.leg, happy: a.sale ? happy : undefined })} className={btnSolid}>
              {busy === 'received' ? 'Saving…' : 'Book received ✓'}
            </button>
            {a.sale && <button type="button" onClick={() => setShowReport(true)} className="block text-2xs underline text-[var(--text-secondary)]">Something wrong with the book? Report a problem</button>}
          </div>
        ), a.step);
      case 'requestExtension':
        return card('ext-ask', 'Need 7 more days?', (
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-secondary)]">You can ask once{a.closesAt ? `, until ${roomWhen(a.closesAt)}` : ''}. It applies only if the owner agrees.</p>
            <input value={extReason} onChange={e => setExtReason(e.target.value)} maxLength={120} placeholder="Why? (optional)" className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)]" />
            <button type="button" disabled={busy === 'ext'} onClick={() => roomAct('ext', { act: 'requestExtension', reason: extReason }, 'Asked for +7 days. The owner will answer here.')} className={btnQuiet}>Ask for +7 days</button>
          </div>
        ), a.step);
      case 'answerExtension':
        return card('ext-answer', `${room.otherName} asked for ${a.days} more days`, (
          <div className="space-y-2">
            {a.reason && <p className="text-xs italic text-[var(--text-secondary)]">"{a.reason}"</p>}
            <div className="flex gap-2">
              <button type="button" disabled={busy === 'ans'} onClick={() => roomAct('ans', { act: 'answerExtension', extensionId: a.extensionId, accept: true })} className={`flex-1 ${btnSolid}`}>Agree</button>
              <button type="button" disabled={busy === 'ans'} onClick={() => roomAct('ans', { act: 'answerExtension', extensionId: a.extensionId, accept: false })} className={`flex-1 ${btnQuiet}`}>Decline</button>
            </div>
          </div>
        ), a.step);
      case 'rate': {
        const stars = (value: number, onPick: (n: number) => void, label: string) => (
          <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onPick(n)}
                className={`text-2xl leading-none ${n <= value ? 'text-brand-gold' : 'text-[var(--text-secondary)] opacity-40'}`}>★</button>
            ))}
          </div>
        );
        return card('rate', 'Reflect & rate', (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[var(--text-primary)]">How was {room.otherName}?</p>
              {stars(rating.reader, n => setRating(r => ({ ...r, reader: n })), 'Rate the other reader')}
              <input value={rating.readerComment} onChange={e => setRating(r => ({ ...r, readerComment: e.target.value }))} maxLength={300} placeholder="A line for other readers (optional)" className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)]" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[var(--text-primary)]">How was SwapSutra?</p>
              {stars(rating.platform, n => setRating(r => ({ ...r, platform: n })), 'Rate SwapSutra')}
              <input value={rating.platformComment} onChange={e => setRating(r => ({ ...r, platformComment: e.target.value }))} maxLength={300} placeholder="What should we improve? (optional)" className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)]" />
            </div>
            <button type="button" disabled={busy === 'rate' || !rating.reader || !rating.platform} onClick={async () => {
              setBusy('rate'); setMsg('');
              try {
                const res = await post({ action: 'exchangeRoomAction', swapId, act: 'rate', readerRating: rating.reader, readerComment: rating.readerComment, platformRating: rating.platform, platformComment: rating.platformComment });
                if (res?.success) setRated({ reviewUrl: res.reviewUrl, message: res.message });
                await after(res);
              } finally { setBusy(''); }
            }} className={btnSolid}>{busy === 'rate' ? 'Sending…' : 'Send my reflection'}</button>
          </div>
        ), a.step);
      }
      case 'payoutAccount':
        return card('payout', room.type === 'SELL' ? 'Where should SwapSutra pay you?' : 'Where should your refund go?', <PayoutAccountForm />, a.step);
      default:
        return null;
    }
  };

  return (
    <section className="space-y-3" aria-label="Exchange steps" data-testid="exchange-room">
      {/* Where we are: one line, a bar, and every step on demand. */}
      <div className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-3 space-y-2">
        <button type="button" onClick={() => setShowSteps(v => !v)} aria-expanded={showSteps} className="flex w-full items-center justify-between gap-3 text-left">
          <span className="min-w-0">
            <span className="block text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
              {room.closed ? 'Exchange closed' : `Step ${room.current} of 16`}{room.bookTitle ? ` · ${room.bookTitle}` : ''}
            </span>
            <span className="block truncate font-serif text-base text-[var(--text-primary)]">{room.closed ? (room.closedReason || 'This exchange is closed.') : current?.title}</span>
          </span>
          <span className="shrink-0 text-2xs font-bold uppercase tracking-widest text-brand-gold-text">{showSteps ? 'Hide steps' : 'All steps'}</span>
        </button>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-border/30" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.round((doneCount / 16) * 100)}%` }} />
        </div>
        {showSteps && (
          <ol className="space-y-2 pt-2" data-testid="room-steps">
            {room.steps.map(s => (
              <li key={s.n} className={`flex items-start gap-2 ${s.state === 'skipped' ? 'opacity-50' : ''}`}>
                <StepDot state={s.state} />
                <span className="min-w-0 text-xs leading-snug">
                  <span className={`font-semibold ${s.state === 'current' ? 'text-brand-gold-text' : 'text-[var(--text-primary)]'}`}>{s.n}. {s.title}</span>
                  {s.at && s.state === 'done' && <span className="text-[var(--text-secondary)]"> · {roomWhen(s.at)}</span>}
                  {s.detail && (s.state === 'current' || s.state === 'skipped' || s.n === 9 || s.n === 14 || s.n === 7) && <span className="block text-2xs text-[var(--text-secondary)]">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {room.disputeOpen && (
        <p className="rounded-2xl border border-red-300 bg-red-50 p-3 text-xs text-red-700">A problem was reported. SwapSutra is reviewing the videos — the steps are paused until it decides. You can keep chatting.</p>
      )}
      {room.waitingOn && !room.disputeOpen && (
        <p className="rounded-2xl bg-[var(--bg-page)] px-3 py-2 text-xs text-[var(--text-secondary)]" role="status">{room.waitingOn}</p>
      )}
      {room.deadlines.conditionBy && (
        <p className="text-2xs text-amber-700">⏱ Condition video due by {roomWhen(room.deadlines.conditionBy)} — otherwise the request closes.</p>
      )}
      {otherPayer && !room.payment.allApproved && !room.closed && room.current === 4 && (
        <p className="text-2xs text-[var(--text-secondary)]">{room.otherName}: ₹{otherPayer.requiredAmount} — {otherPayer.adminStatus === 'ADMIN_APPROVED' ? 'paid ✓' : otherPayer.adminStatus === 'ADMIN_PENDING' ? 'paid, being verified' : 'not paid yet'}</p>
      )}

      {/* Your turn: videos first (one tap each), then the rest. */}
      {videoActions.length > 0 && card('videos', 'Your videos', (
        <ul className="space-y-2">
          {videoActions.map(a => {
            const key = (a.leg || '') + a.kind;
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--text-primary)]">
                  <b>Step {a.step}</b> · {VMS_TITLES[a.kind as VmsKind]} video{room.legs.out.length > 1 || a.step >= 13 ? ` — ${a.step >= 13 ? 'return' : bookName(legOf(a.leg), room)}` : ''}
                </span>
                {progress?.key === key
                  ? <span className="text-2xs tabular-nums text-[var(--text-secondary)]" role="status">Uploading {Math.round(progress.p * 100)}%</span>
                  : <button type="button" disabled={!!progress} onClick={() => setRecording({ leg: a.leg as VmsLeg, kind: a.kind as VmsKind })} className="rounded-lg bg-red-600 px-3 py-1.5 text-2xs font-bold uppercase tracking-widest text-white disabled:opacity-50">● Record</button>}
              </li>
            );
          })}
        </ul>
      ))}
      {otherActions.map(renderAction)}

      {msg && <p className="text-xs text-[var(--text-primary)]" role="status">{msg}</p>}
      {rated && rated.reviewUrl && <GoogleReviewCard url={rated.reviewUrl} />}

      {/* What's agreed, and the evidence so far. */}
      {(room.route.out || room.route.back) && (
        <details className="rounded-2xl border border-brand-border/60 bg-[var(--bg-page)] p-3">
          <summary className="cursor-pointer text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Route, tracking & videos</summary>
          <div className="mt-3 space-y-3 text-xs">
            {([['out', room.route.out], ['back', room.route.back]] as const).filter(([, r]) => r).map(([k, r]) => (
              <div key={k} className="space-y-2">
                <p className="text-[var(--text-primary)]">{k === 'back' ? 'Return: ' : ''}{r!.method === 'courier' ? '📦 Courier' : '🤝 In person'}</p>
                {r!.method === 'in_person' && r!.lat != null && r!.lng != null && <LocationCard lat={r!.lat} lng={r!.lng} label={(r!.note || '').replace(/^Meeting at:\s*/, '')} compact />}
              </div>
            ))}
            {room.legs.out.concat(room.legs.back).map(l => (
              <div key={l.leg} className="space-y-1 border-t border-brand-border/40 pt-2">
                <p className="font-semibold text-[var(--text-primary)]">{l.leg === 'return' || l.leg === 'counter_return' ? 'Coming back' : 'Going out'} — {bookName(l, room)}</p>
                {l.awb && <p>{l.courierName} {l.awb} {l.trackingUrl && <a href={l.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline text-brand-gold-text">Track</a>}</p>}
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-[var(--text-secondary)]">
                  {(['QUALITY', 'PACKING', 'HANDOVER', 'RECEIVING'] as VmsKind[]).map(k => l.videos[k]?.done
                    ? <a key={k} href={l.videos[k].url} target="_blank" rel="noopener noreferrer" className="underline">✓ {VMS_TITLES[k]}</a>
                    : <span key={k}>○ {VMS_TITLES[k]}</span>)}
                </p>
              </div>
            ))}
            <p className="text-2xs italic text-[var(--text-secondary)]">Every video is stamped with this exchange's code ({room.stampCode}) and the time. In a dispute, SwapSutra decides the deposit from them.</p>
          </div>
        </details>
      )}

      {!room.closed && room.payment.allApproved && room.role !== 'admin' && (
        showReport
          ? <DisputeReport swapId={swapId} />
          : <button type="button" onClick={() => setShowReport(true)} className="text-2xs underline text-[var(--text-secondary)]">Report a problem</button>
      )}

      {isAdmin && room.payment.payers.filter(p => p.adminStatus === 'ADMIN_PENDING').map(p => (
        <div key={p.payerRole} className="rounded-2xl border border-gray-300 bg-gray-50 p-3 space-y-2 text-xs">
          <p>Admin: {p.payerRole} paid ₹{p.requiredAmount} · UTR {p.utr} {p.screenshotUrl && <a href={p.screenshotUrl} target="_blank" rel="noreferrer" className="underline">screenshot</a>}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy === 'admin_' + p.payerRole} onClick={() => adminReview(p.payerRole, 'APPROVE')} className="flex-1 rounded-lg bg-green-600 py-2 text-2xs font-bold uppercase text-white">Approve</button>
            <button type="button" disabled={busy === 'admin_' + p.payerRole} onClick={() => adminReview(p.payerRole, 'REJECT')} className="flex-1 rounded-lg bg-red-500 py-2 text-2xs font-bold uppercase text-white">Reject</button>
          </div>
        </div>
      ))}

      {recording && (
        <VideoRecorder kind={recording.kind} stampCode={room.stampCode} onCancel={() => setRecording(null)}
          onDone={(blob, meta) => onRecorded(recording.leg, recording.kind, blob, meta)} />
      )}
    </section>
  );
}
