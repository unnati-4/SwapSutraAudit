import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';
import { depositTitle, DEPOSIT_ESTIMATE_EXPLAINER } from '../utils/deposit';
import { LocationCard } from './LocationPin';
import ReturnRuleNotice from './ReturnRuleNotice';

// The map picker pulls in Leaflet, so it loads only when someone opens it.
const LocationPinPicker = lazy(() => import('./LocationPin').then(m => ({ default: m.LocationPinPicker })));

/**
 * Where the books are, and what happens next (rewritten Oct 2026).
 *
 * The route, step by step, as the owner set it out:
 *   1. Payment — both readers' security deposits and platform fees are
 *      verified. Until then nothing below unlocks (the server enforces it).
 *   2. Route — the two readers agree in the chat to meet in person or use
 *      a courier, and either of them records it here.
 *        • In person: a pinned meeting point (map) and a place name.
 *        • Courier: both addresses and phone numbers are shared — only now,
 *          and only between the two of them.
 *   3. The exchange — each book's own timeline: packed, handed over or
 *      posted with the courier name and tracking ID (linked to the
 *      courier's own tracking page), delivered, confirmed received.
 *      In a swap both books are tracked.
 *   4. Return (rent, lend, temporary swap) — on its way back within 21
 *      days, or the deposit is forfeited to the owner. +7 / +14 days if
 *      both agree, 14 at most.
 *
 * SwapSutra has no courier integration, so it never claims to know where
 * a parcel is. Every entry is something one of the two readers reported,
 * and the tracking link goes to the courier company itself.
 */

const API_URL = apiUrl('/api/swapsutra');

type Leg = 'outbound' | 'counter' | 'return' | 'counter_return';

interface JourneyEvent {
  id: string;
  leg: Leg;
  event: string;
  label: string;
  actorName: string;
  isYou: boolean;
  method?: string;
  courierName?: string;
  awb?: string;
  trackingUrl?: string;
  note?: string;
  expectedBy?: string;
  lat?: number | null;
  lng?: number | null;
  at: string;
}

interface ReturnLeg { leg: Leg; state: string; borrower: string; owner: string; youAreBorrower?: boolean; youAreOwner?: boolean }
interface ReturnStatus {
  applies: boolean;
  started?: boolean;
  dueAt?: string;
  daysLeft?: number;
  overdue?: boolean;
  extensionDays?: number;
  extensionDaysLeft?: number;
  extensionChoices?: number[];
  pendingExtension?: { id: string; days: number; youAsked?: boolean; reason?: string } | null;
  legs?: ReturnLeg[];
}

interface JourneyData {
  swapId: string;
  serviceType: string;
  needsReturn: boolean;
  twoWay?: boolean;
  legs?: Leg[];
  route?: { method: string; note: string; lat: number | null; lng: number | null; setBy: string; at: string } | null;
  events: JourneyEvent[];
  status: { stage: string; label: string; holder: string };
  deposit: { amount: number; state: string; reason: string; estimated?: boolean };
  couriers: string[];
}

interface AddressFields {
  label: string; line1: string; line2: string; landmark: string; area: string;
  city: string; state: string; pincode: string; phone: string;
}

const BLANK_ADDRESS: AddressFields = {
  label: 'Home', line1: '', line2: '', landmark: '', area: '', city: '', state: '', pincode: '', phone: '',
};

const SENDER_ACTIONS = [
  { event: 'packed', label: 'Packed and ready' },
  { event: 'handed_over', label: 'Handed over in person' },
  { event: 'dispatched', label: 'Posted it' },
  { event: 'in_transit', label: 'Update on the parcel' },
  { event: 'delayed', label: 'Running late' },
];
const RECEIVER_ACTIONS = [
  { event: 'delivered', label: 'It arrived' },
  { event: 'received', label: 'Confirm received' },
  { event: 'issue_raised', label: 'Report a problem' },
];

/** Who sends on each leg — mirrors journeyLegParties_ on the server. */
const senderIsOwner = (leg: Leg) => leg === 'outbound' || leg === 'counter_return';

function legLabel(leg: Leg, isOwner: boolean): string {
  const mine = senderIsOwner(leg) === isOwner; // I send on this leg
  switch (leg) {
    case 'outbound': return isOwner ? 'Your book → them' : 'Their book → you';
    case 'counter': return isOwner ? 'Their book → you' : 'Your book → them';
    case 'return': return isOwner ? 'Your book coming back' : 'Returning their book';
    case 'counter_return': return mine ? 'Returning their book' : 'Your book coming back';
  }
}

function whenLabel(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function depositTone(state: string): string {
  if (state === 'release') return 'text-green-600';
  if (state === 'held_dispute' || state === 'held_overdue') return 'text-red-600';
  if (state === 'none') return 'text-[var(--text-secondary)]';
  return 'text-amber-600';
}

async function postAction(body: Record<string, unknown>) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

const btnSolid = 'px-4 py-2 rounded-lg bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50 transition-colors';
const btnQuiet = 'px-4 py-2 rounded-lg border border-brand-border/60 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors';

export default function CirculationTracker({
  swapId, isOwner, chatStatus,
}: { swapId: string; isOwner: boolean; chatStatus?: string }) {
  const [data, setData] = useState<JourneyData | null>(null);
  const [ret, setRet] = useState<ReturnStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leg, setLeg] = useState<Leg>('outbound');
  const [courierName, setCourierName] = useState('');
  const [awb, setAwb] = useState('');
  const [note, setNote] = useState('');

  const [routeMethod, setRouteMethod] = useState<'in_person' | 'courier' | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [changingRoute, setChangingRoute] = useState(false);

  const [addrForm, setAddrForm] = useState<AddressFields>(BLANK_ADDRESS);
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);
  const [addrSaved, setAddrSaved] = useState(false);
  const [counterpartyAddress, setCounterpartyAddress] = useState<(AddressFields & Record<string, string>) | null>(null);
  const [counterpartyName, setCounterpartyName] = useState('');
  const [addrNote, setAddrNote] = useState('');

  const [extBusy, setExtBusy] = useState(false);
  const [extMsg, setExtMsg] = useState<string | null>(null);

  const archived = chatStatus === 'Archived';

  const load = useCallback(async () => {
    if (!swapId) return;
    try {
      const res = await fetch(`${API_URL}?action=getSwapJourney&swapId=${encodeURIComponent(swapId)}`);
      const payload = await res.json();
      if (payload?.success) {
        setData({ ...payload, events: Array.isArray(payload.events) ? payload.events : [] } as JourneyData);
        setError(null);
        if (payload.needsReturn) {
          try {
            const r = await fetch(`${API_URL}?action=getReturnStatus&swapId=${encodeURIComponent(swapId)}`);
            const rp = await r.json();
            if (rp?.success) setRet(rp as ReturnStatus);
          } catch { /* the deadline card just doesn't show */ }
        }
      } else setError(payload?.message || 'Could not load the delivery timeline.');
    } catch {
      setError('Could not load the delivery timeline.');
    } finally {
      setLoading(false);
    }
  }, [swapId]);

  useEffect(() => { load(); }, [load]);

  const loadAddresses = useCallback(async () => {
    if (!swapId) return;
    try {
      const res = await fetch(`${API_URL}?action=getDeliveryAddress&swapId=${encodeURIComponent(swapId)}`);
      const payload = await res.json();
      if (payload?.own) setAddrForm({ ...BLANK_ADDRESS, ...payload.own });
      if (payload?.success) {
        setCounterpartyAddress(payload.counterparty || null);
        if (payload.counterpartyName) setCounterpartyName(payload.counterpartyName);
        setAddrNote(payload.counterparty ? '' : (payload.message || ''));
      } else setAddrNote(payload?.message || '');
    } catch { /* the panel shows "not shared yet" */ }
  }, [swapId]);

  // Courier route → load both addresses straight away.
  const isCourier = data?.route?.method === 'courier';
  useEffect(() => { if (isCourier) loadAddresses(); }, [isCourier, loadAddresses]);

  const postEvent = useCallback(async (event: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await postAction({
        action: 'logJourneyEvent', swapId, leg, event,
        method: event === 'dispatched' ? 'courier' : undefined,
        courierName: courierName || undefined, awb: awb || undefined, note: note || undefined,
      });
      if (payload?.success) { setNote(''); setAwb(''); await load(); }
      else setError(payload?.message || 'That update could not be recorded.');
    } catch {
      setError('That update could not be recorded.');
    } finally { setBusy(false); }
  }, [busy, swapId, leg, courierName, awb, note, load]);

  const setRoute = useCallback(async (method: 'in_person' | 'courier', pin?: { lat: number; lng: number; label: string }) => {
    if (routeBusy) return;
    setRouteBusy(true); setRouteError(null);
    try {
      const payload = await postAction({
        action: 'setSwapRoute', swapId, method,
        meetingPoint: pin?.label || undefined, meetingLat: pin?.lat, meetingLng: pin?.lng,
      });
      if (payload?.success) { setRouteMethod(null); setChangingRoute(false); await load(); }
      else setRouteError(payload?.message || 'That could not be recorded.');
    } catch {
      setRouteError('That could not be recorded.');
    } finally { setRouteBusy(false); }
  }, [routeBusy, swapId, load]);

  const saveAddress = useCallback(async () => {
    if (addrBusy) return;
    setAddrBusy(true); setAddrError(null); setAddrSaved(false);
    try {
      const payload = await postAction({ action: 'saveDeliveryAddress', ...addrForm });
      if (payload?.success) { setAddrSaved(true); await loadAddresses(); }
      else setAddrError(payload?.message || 'That address could not be saved.');
    } catch {
      setAddrError('That address could not be saved.');
    } finally { setAddrBusy(false); }
  }, [addrBusy, addrForm, loadAddresses]);

  const requestExtension = async (days: number) => {
    setExtBusy(true); setExtMsg(null);
    try {
      const p = await postAction({ action: 'requestReturnExtension', swapId, days });
      setExtMsg(p?.message || (p?.success ? 'Requested.' : 'Could not request that.'));
      if (p?.success) await load();
    } finally { setExtBusy(false); }
  };
  const answerExtension = async (accept: boolean) => {
    if (!ret?.pendingExtension) return;
    setExtBusy(true); setExtMsg(null);
    try {
      const p = await postAction({ action: 'respondReturnExtension', swapId, extensionId: ret.pendingExtension.id, accept });
      setExtMsg(p?.message || null);
      if (p?.success) await load();
    } finally { setExtBusy(false); }
  };

  if (loading) {
    return (
      <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border">
        <p className="text-xs text-[var(--text-secondary)] italic">Loading the delivery timeline…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">Where the book is</h4>
        <p className="text-xs text-[var(--text-secondary)]">{error || 'No timeline yet.'}</p>
      </div>
    );
  }

  const legs: Leg[] = (data.legs && data.legs.length ? data.legs : ['outbound', ...(data.needsReturn ? ['return' as Leg] : [])]);
  const route = data.route || null;
  const iAmSending = senderIsOwner(leg) === isOwner;
  const actions = iAmSending ? SENDER_ACTIONS : RECEIVER_ACTIONS;
  const legEvents = data.events.filter(e => e.leg === leg && e.event !== 'route_set');
  const received = (l: Leg) => data.events.some(e => e.leg === l && e.event === 'received');
  const exchangeLegs = legs.filter(l => l === 'outbound' || l === 'counter');
  const returnLegs = legs.filter(l => l === 'return' || l === 'counter_return');
  const exchanged = exchangeLegs.every(received);
  const returned = returnLegs.length > 0 && returnLegs.every(received);

  const steps = [
    { key: 'pay', label: 'Payment verified', done: true },
    { key: 'route', label: 'Meet or courier', done: !!route },
    { key: 'exchange', label: data.twoWay ? 'Both books received' : 'Book received', done: exchanged },
    ...(data.needsReturn ? [{ key: 'return', label: 'Returned', done: returned }] : []),
  ];
  const currentStep = steps.findIndex(s => !s.done);

  return (
    <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border space-y-6" data-testid="circulation-tracker">
      <div className="space-y-1">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">Delivery</h4>
        <p className="font-serif text-lg text-[var(--text-primary)]">{data.status?.label || '—'}</p>
      </div>

      {/* The route, as numbered steps. */}
      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Exchange steps">
        {steps.map((s, i) => (
          <li key={s.key} aria-current={i === currentStep ? 'step' : undefined}
            className={`rounded-xl border px-3 py-2 text-2xs font-bold uppercase tracking-widest ${s.done
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : i === currentStep ? 'border-brand-gold bg-brand-gold/10 text-brand-gold-text' : 'border-brand-border/60 text-[var(--text-secondary)]'}`}>
            <span className="tabular-nums">{s.done ? '✓' : `${i + 1}.`}</span> {s.label}
          </li>
        ))}
      </ol>

      {data.deposit.amount > 0 && (
        <div className="p-4 rounded-2xl bg-[var(--bg-page)] border border-brand-border/60 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{depositTitle(data.deposit.estimated)}</span>
            <span className={`text-sm font-bold tabular-nums ${depositTone(data.deposit.state)}`}>₹{data.deposit.amount}</span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{data.deposit.reason}</p>
          {data.deposit.estimated && <p className="text-xs italic text-[var(--text-secondary)] leading-relaxed">{DEPOSIT_ESTIMATE_EXPLAINER}</p>}
        </div>
      )}

      {/* ── Step 2: the route ─────────────────────────────────────── */}
      <section className="p-4 rounded-2xl border border-brand-border/60 bg-[var(--bg-page)] space-y-3" aria-labelledby="route-title">
        <div className="flex items-center justify-between gap-3">
          <p id="route-title" className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">How the books travel</p>
          {route && !archived && !changingRoute && (
            <button type="button" onClick={() => setChangingRoute(true)} className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text underline">Change</button>
          )}
        </div>

        {route && !changingRoute ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-primary)]">
              {route.method === 'courier' ? '📦 By courier' : '🤝 Meeting in person'}
              <span className="text-[var(--text-secondary)]"> · agreed by {route.setBy}, {whenLabel(route.at)}</span>
            </p>
            {route.method === 'in_person' && route.lat != null && route.lng != null && (
              <LocationCard lat={route.lat} lng={route.lng} label={(route.note || '').replace(/^Meeting at:\s*/, '')} />
            )}
            {route.method === 'in_person' && (route.lat == null || route.lng == null) && route.note && (
              <p className="text-xs text-[var(--text-secondary)]">{route.note}</p>
            )}
          </div>
        ) : archived ? (
          <p className="text-xs text-[var(--text-secondary)] italic">No route was agreed.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Decide together in the chat, then either of you can record it here. Addresses and phone numbers are only shared if you choose courier.
            </p>
            {routeMethod === null && (
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={() => setRouteMethod('in_person')} className={`flex-1 ${btnQuiet}`}>🤝 Meet in person</button>
                <button type="button" disabled={routeBusy} onClick={() => setRoute('courier')} className={`flex-1 ${btnQuiet}`}>📦 Courier</button>
                {changingRoute && <button type="button" onClick={() => setChangingRoute(false)} className={btnQuiet}>Cancel</button>}
              </div>
            )}
            {routeMethod === 'in_person' && (
              <Suspense fallback={<p className="text-xs text-[var(--text-secondary)] italic">Loading the map…</p>}>
                <LocationPinPicker
                  submitLabel="Set meeting point"
                  busy={routeBusy}
                  initial={route?.lat != null && route?.lng != null ? { lat: route.lat, lng: route.lng } : null}
                  onCancel={() => { setRouteMethod(null); setChangingRoute(false); }}
                  onSubmit={(pin) => setRoute('in_person', pin)}
                />
              </Suspense>
            )}
            {routeError && <p className="text-xs text-red-600" role="alert">{routeError}</p>}
          </div>
        )}
      </section>

      {/* Courier: both addresses and phone numbers. */}
      {isCourier && (
        <section className="p-4 rounded-2xl border border-brand-border/60 bg-[var(--bg-page)] space-y-4" aria-labelledby="addr-title">
          <p id="addr-title" className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Addresses &amp; phone numbers</p>
          <div className="space-y-1">
            <p className="text-2xs font-bold text-[var(--text-primary)]">{counterpartyName ? `${counterpartyName}'s address` : "The other reader's address"}</p>
            {counterpartyAddress ? (
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {[counterpartyAddress.line1, counterpartyAddress.line2, counterpartyAddress.landmark, counterpartyAddress.area,
                  counterpartyAddress.city, counterpartyAddress.state, counterpartyAddress.pincode].filter(Boolean).join(', ')}
                {counterpartyAddress.phone && <><br />Phone: <a className="underline" href={`tel:${counterpartyAddress.phone}`}>{counterpartyAddress.phone}</a></>}
              </p>
            ) : (
              <p className="text-xs text-[var(--text-secondary)] italic">{addrNote || 'Not added yet — ask them to add it here.'}</p>
            )}
          </div>
          {!archived && (
            <div className="space-y-2 pt-3 border-t border-brand-border/40">
              <p className="text-2xs font-bold text-[var(--text-primary)]">Your address (the courier needs it)</p>
              <input value={addrForm.line1} onChange={(e) => setAddrForm(f => ({ ...f, line1: e.target.value }))} placeholder="Street address" className="input-classic !py-2 text-xs w-full bg-[var(--bg-surface)]" />
              <div className="grid grid-cols-2 gap-2">
                <input value={addrForm.area} onChange={(e) => setAddrForm(f => ({ ...f, area: e.target.value }))} placeholder="Area / locality" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
                <input value={addrForm.landmark} onChange={(e) => setAddrForm(f => ({ ...f, landmark: e.target.value }))} placeholder="Landmark (optional)" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input value={addrForm.city} onChange={(e) => setAddrForm(f => ({ ...f, city: e.target.value }))} placeholder="City" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
                <input value={addrForm.state} onChange={(e) => setAddrForm(f => ({ ...f, state: e.target.value }))} placeholder="State" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
                <input value={addrForm.pincode} onChange={(e) => setAddrForm(f => ({ ...f, pincode: e.target.value }))} placeholder="Pincode" inputMode="numeric" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
              </div>
              <input value={addrForm.phone} onChange={(e) => setAddrForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone (for the courier)" inputMode="tel" className="input-classic !py-2 text-xs w-full bg-[var(--bg-surface)]" />
              {addrError && <p className="text-xs text-red-600" role="alert">{addrError}</p>}
              {addrSaved && <p className="text-xs text-green-600">Saved.</p>}
              <button type="button" disabled={addrBusy} onClick={saveAddress} className={btnSolid}>{addrBusy ? 'Saving…' : 'Save my address'}</button>
              <p className="text-2xs text-[var(--text-secondary)] italic leading-relaxed">Shown only to the other reader in this exchange, and only until it closes.</p>
            </div>
          )}
        </section>
      )}

      {/* ── Step 4: the return deadline ───────────────────────────── */}
      {data.needsReturn && (
        <section className="space-y-3" aria-labelledby="return-title">
          <p id="return-title" className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Return</p>
          {ret?.started && ret.dueAt ? (
            <div className={`p-4 rounded-2xl border space-y-2 ${ret.overdue ? 'border-red-300 bg-red-50' : (ret.daysLeft ?? 99) <= 3 ? 'border-amber-300 bg-amber-50' : 'border-brand-border/60 bg-[var(--bg-page)]'}`}>
              <p className={`font-serif text-lg ${ret.overdue ? 'text-red-800' : 'text-[var(--text-primary)]'}`}>
                {ret.overdue ? 'Return deadline has passed' : `Due by ${whenLabel(ret.dueAt)}`}
                {!ret.overdue && typeof ret.daysLeft === 'number' && <span className="text-sm text-[var(--text-secondary)]"> · {ret.daysLeft} {ret.daysLeft === 1 ? 'day' : 'days'} left</span>}
              </p>
              {(ret.extensionDays ?? 0) > 0 && <p className="text-2xs text-[var(--text-secondary)]">Includes an agreed extension of {ret.extensionDays} days.</p>}
              {(ret.legs || []).map(l => (
                <p key={l.leg} className="text-xs text-[var(--text-secondary)]">
                  {legLabel(l.leg, isOwner)}: {' '}
                  <strong className={l.state === 'FORFEITED' || l.state === 'OVERDUE' ? 'text-red-700' : l.state === 'RETURNED_ON_TIME' ? 'text-emerald-700' : 'text-[var(--text-primary)]'}>
                    {l.state === 'RETURNED_ON_TIME' ? 'on its way back in time ✓'
                      : l.state === 'FORFEITED' ? 'deposit forfeited to the owner'
                      : l.state === 'OVERDUE' || l.state === 'RETURNED_LATE' ? 'late — deposit will be forfeited'
                      : l.youAreBorrower ? 'you need to send it back' : 'waiting for it to come back'}
                  </strong>
                </p>
              ))}

              {/* Extension: one reader asks, the other agrees. */}
              {!archived && !ret.overdue && (ret.legs || []).some(l => l.state === 'DUE') && (
                <div className="pt-2 border-t border-brand-border/40 space-y-2">
                  {ret.pendingExtension ? (
                    ret.pendingExtension.youAsked ? (
                      <p className="text-xs text-[var(--text-secondary)]">You asked for +{ret.pendingExtension.days} days. Waiting for the other reader to agree.</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-[var(--text-primary)]">The other reader asks for <strong>+{ret.pendingExtension.days} days</strong>.</p>
                        <div className="flex gap-2">
                          <button type="button" disabled={extBusy} onClick={() => answerExtension(true)} className={btnSolid}>Agree</button>
                          <button type="button" disabled={extBusy} onClick={() => answerExtension(false)} className={btnQuiet}>Decline</button>
                        </div>
                      </div>
                    )
                  ) : (ret.extensionChoices || []).length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-2xs text-[var(--text-secondary)]">Need more time? Ask for</span>
                      {(ret.extensionChoices || []).map(d => (
                        <button key={d} type="button" disabled={extBusy} onClick={() => requestExtension(d)} className={btnQuiet}>+{d} days</button>
                      ))}
                      <span className="text-2xs text-[var(--text-secondary)]">— only if the other reader agrees.</span>
                    </div>
                  ) : (
                    <p className="text-2xs text-[var(--text-secondary)]">The maximum 14-day extension has been used.</p>
                  )}
                  {extMsg && <p className="text-xs text-[var(--text-secondary)]" role="status">{extMsg}</p>}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">The 21-day clock starts when the book reaches the borrower.</p>
          )}
          <ReturnRuleNotice compact />
        </section>
      )}

      {/* ── Step 3: each book's timeline ─────────────────────────── */}
      {legs.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which book">
          {legs.map(l => (
            <button key={l} type="button" role="tab" aria-selected={leg === l} onClick={() => setLeg(l)}
              className={`flex-1 min-w-[8rem] py-2 rounded-lg text-2xs font-bold uppercase tracking-widest transition-colors ${leg === l ? 'bg-brand-brown text-white' : 'border border-brand-border/60 text-[var(--text-secondary)]'}`}>
              {legLabel(l, isOwner)}{received(l) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}

      <ol className="space-y-3">
        {legEvents.length === 0 && (
          <li className="text-xs text-[var(--text-secondary)] italic">{route ? 'Nothing recorded for this book yet.' : 'Agree the route first — then updates start here.'}</li>
        )}
        {legEvents.map(e => (
          <li key={e.id} className="flex gap-3">
            <div className="mt-1.5 w-2 h-2 rounded-full bg-brand-gold shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm text-[var(--text-primary)]">
                <span className="font-bold">{e.label}</span>
                <span className="text-[var(--text-secondary)]"> · {e.isYou ? 'you' : e.actorName}</span>
              </p>
              {e.note && <p className="text-xs text-[var(--text-secondary)] break-words">{e.note}</p>}
              {e.awb && (
                <p className="text-xs text-[var(--text-secondary)] break-all">
                  {e.courierName} · <span className="font-mono">{e.awb}</span>
                  {e.trackingUrl && <> <a href={e.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-brand-gold-text underline">Track on {e.courierName}</a></>}
                </p>
              )}
              <p className="text-2xs text-[var(--text-secondary)] tabular-nums">{whenLabel(e.at)}</p>
            </div>
          </li>
        ))}
      </ol>

      {!archived && route && (
        <div className="space-y-3 pt-4 border-t border-brand-border/40">
          <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
            {iAmSending ? 'You are sending this book — post an update' : 'You are waiting for this book — confirm what happened'}
          </p>
          {iAmSending && route.method === 'courier' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select value={courierName} onChange={(e) => setCourierName(e.target.value)} className="input-classic !py-2 text-xs bg-[var(--bg-page)]" aria-label="Courier">
                <option value="">Courier company</option>
                {data.couriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="Tracking ID (AWB)" className="input-classic !py-2 text-xs bg-[var(--bg-page)]" />
            </div>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the other reader should know" className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
          <div className="flex flex-wrap gap-2">
            {actions
              .filter(a => route.method === 'courier' ? a.event !== 'handed_over' : !['dispatched', 'in_transit'].includes(a.event))
              .map(a => (
                <button key={a.event} type="button" disabled={busy || (a.event === 'dispatched' && (!courierName || !awb.trim()))}
                  onClick={() => postEvent(a.event)} className={btnQuiet}
                  title={a.event === 'dispatched' && (!courierName || !awb.trim()) ? 'Add the courier and tracking ID first' : undefined}>
                  {a.label}
                </button>
              ))}
          </div>
          {iAmSending && route.method === 'courier' && (
            <p className="text-2xs text-[var(--text-secondary)] italic">Posting needs the courier company and tracking ID, so the other reader can follow the parcel on the courier&rsquo;s own site.</p>
          )}
          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
