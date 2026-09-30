import { useCallback, useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';
import { depositTitle, DEPOSIT_ESTIMATE_EXPLAINER } from '../utils/deposit';

/**
 * Where the book actually is.
 *
 * The Condition Protection panel beside this one photographs the book at
 * four moments. This is the other half: how it is travelling, where it
 * has got to, and whether it is late.
 *
 * An important honesty constraint shapes the whole design — SwapSutra has
 * no courier integration, so it cannot fetch a parcel's live position.
 * Nothing here implies it can. Every entry is something one of the two
 * readers reported, attributed to them by name, with the time they said
 * it. Where a courier is involved, the reader's own tracking number gets
 * a link straight to that courier's page, which is the real source.
 *
 * That framing is not a limitation to apologise for. A ledger both people
 * can see, that neither can edit afterwards, is what makes a disagreement
 * about a lost book resolvable — which is the actual problem.
 */

const API_URL = apiUrl('/api/swapsutra');

interface JourneyEvent {
  id: string;
  leg: 'outbound' | 'return';
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
  at: string;
}

interface JourneyData {
  swapId: string;
  serviceType: string;
  needsReturn: boolean;
  events: JourneyEvent[];
  status: { stage: string; label: string; holder: string };
  deposit: { amount: number; state: string; reason: string; estimated?: boolean };
  couriers: string[];
}

interface AddressFields {
  label: string;
  line1: string;
  line2: string;
  landmark: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

const BLANK_ADDRESS: AddressFields = {
  label: 'Home', line1: '', line2: '', landmark: '', area: '', city: '', state: '', pincode: '', phone: '',
};

/** Only what the person holding the book, or waiting for it, can honestly say. */
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

export default function CirculationTracker({
  swapId,
  isOwner,
  chatStatus,
}: {
  swapId: string;
  isOwner: boolean;
  chatStatus?: string;
}) {
  const [data, setData] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leg, setLeg] = useState<'outbound' | 'return'>('outbound');
  const [courierName, setCourierName] = useState('');
  const [awb, setAwb] = useState('');
  const [note, setNote] = useState('');

  // Route (in-person vs courier) — set once per leg, before any other
  // journey event can meaningfully be logged for it.
  const [routeMethod, setRouteMethod] = useState<'in_person' | 'courier'>('in_person');
  const [meetingPoint, setMeetingPoint] = useState('');
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Delivery address exchange — only meaningful once a route is agreed as
  // courier; reuses saveDeliveryAddress/getDeliveryAddress rather than any
  // new address system.
  const [addrOpen, setAddrOpen] = useState(false);
  const [addrForm, setAddrForm] = useState<AddressFields>(BLANK_ADDRESS);
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);
  const [addrSaved, setAddrSaved] = useState(false);
  const [counterpartyAddress, setCounterpartyAddress] = useState<(AddressFields & Record<string, string>) | null>(null);
  const [counterpartyName, setCounterpartyName] = useState('');
  const [addrLoaded, setAddrLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!swapId) return;
    try {
      const res = await fetch(`${API_URL}?action=getSwapJourney&swapId=${encodeURIComponent(swapId)}`);
      const payload = await res.json();
      // A reply without an events list used to crash the whole app.
      if (payload?.success) { setData({ ...payload, events: Array.isArray(payload.events) ? payload.events : [] } as JourneyData); setError(null); }
      else setError(payload?.message || 'Could not load the delivery timeline.');
    } catch {
      setError('Could not load the delivery timeline.');
    } finally {
      setLoading(false);
    }
  }, [swapId]);

  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (event: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'logJourneyEvent',
          swapId, leg, event,
          method: event === 'dispatched' ? 'courier' : undefined,
          courierName: courierName || undefined,
          awb: awb || undefined,
          note: note || undefined,
        }),
      });
      const payload = await res.json();
      if (payload?.success) {
        setNote(''); setAwb('');
        await load();
      } else {
        setError(payload?.message || 'That update could not be recorded.');
      }
    } catch {
      setError('That update could not be recorded.');
    } finally {
      setBusy(false);
    }
  }, [busy, swapId, leg, courierName, awb, note, load]);

  const submitRoute = useCallback(async () => {
    if (routeBusy) return;
    if (routeMethod === 'in_person' && !meetingPoint.trim()) {
      setRouteError('Agree a public place to meet — a café, a metro station, a campus gate.');
      return;
    }
    setRouteBusy(true);
    setRouteError(null);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setSwapRoute',
          swapId, leg, method: routeMethod,
          meetingPoint: routeMethod === 'in_person' ? meetingPoint : undefined,
        }),
      });
      const payload = await res.json();
      if (payload?.success) {
        setMeetingPoint('');
        await load();
      } else {
        setRouteError(payload?.message || 'That could not be recorded.');
      }
    } catch {
      setRouteError('That could not be recorded.');
    } finally {
      setRouteBusy(false);
    }
  }, [routeBusy, routeMethod, meetingPoint, swapId, leg, load]);

  const loadAddresses = useCallback(async () => {
    if (!swapId) return;
    try {
      const res = await fetch(`${API_URL}?action=getDeliveryAddress&swapId=${encodeURIComponent(swapId)}`);
      const payload = await res.json();
      if (payload?.success) {
        if (payload.counterparty) setCounterpartyAddress(payload.counterparty);
        if (payload.counterpartyName) setCounterpartyName(payload.counterpartyName);
        if (payload.own) setAddrForm({ ...BLANK_ADDRESS, ...payload.own });
      } else if (payload?.message) {
        setAddrError(payload.message);
      }
    } catch {
      // Silent — the address panel just shows "not shared yet".
    } finally {
      setAddrLoaded(true);
    }
  }, [swapId]);

  const saveAddress = useCallback(async () => {
    if (addrBusy) return;
    setAddrBusy(true);
    setAddrError(null);
    setAddrSaved(false);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveDeliveryAddress', ...addrForm }),
      });
      const payload = await res.json();
      if (payload?.success) {
        setAddrSaved(true);
        await loadAddresses();
      } else {
        setAddrError(payload?.message || 'That address could not be saved.');
      }
    } catch {
      setAddrError('That address could not be saved.');
    } finally {
      setAddrBusy(false);
    }
  }, [addrBusy, addrForm, loadAddresses]);

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

  // On the way out the owner sends; on the way back the borrower does.
  const iAmSending = leg === 'outbound' ? isOwner : !isOwner;
  const actions = iAmSending ? SENDER_ACTIONS : RECEIVER_ACTIONS;
  const showCourierFields = iAmSending;

  const legEvents = data.events.filter(e => e.leg === leg);
  const routeEvent = legEvents.find(e => e.event === 'route_set');
  const routeIsCourier = routeEvent?.method === 'courier';

  return (
    <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border space-y-6">
      <div className="space-y-1">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">Where the book is</h4>
        <p className="font-serif text-lg text-[var(--text-primary)]">{data.status?.label || "—"}</p>
        <p className="text-2xs text-[var(--text-secondary)] italic">
          Every entry below is reported by one of you, with the time it was posted. SwapSutra does not
          track parcels itself — the courier link goes to the company carrying it.
        </p>
      </div>

      {data.deposit.amount > 0 && (
        <div className="p-4 rounded-2xl bg-[var(--bg-page)] border border-brand-border/60 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{depositTitle(data.deposit.estimated)}</span>
            <span className={`text-sm font-bold tabular-nums ${depositTone(data.deposit.state)}`}>₹{data.deposit.amount}</span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{data.deposit.reason}</p>
          {data.deposit.estimated && (
            <p className="text-xs italic text-[var(--text-secondary)] leading-relaxed">{DEPOSIT_ESTIMATE_EXPLAINER}</p>
          )}
        </div>
      )}

      {data.needsReturn && (
        <div className="flex gap-2">
          {(['outbound', 'return'] as const).map(l => (
            <button
              key={l}
              type="button"
              onClick={() => setLeg(l)}
              className={`flex-1 py-2 rounded-lg text-2xs font-bold uppercase tracking-widest transition-colors ${
                leg === l
                  ? 'bg-brand-brown text-white'
                  : 'border border-brand-border/60 text-[var(--text-secondary)]'
              }`}
            >
              {l === 'outbound' ? 'Going out' : 'Coming back'}
            </button>
          ))}
        </div>
      )}

      {!routeEvent && legEvents.length === 0 && chatStatus !== 'Archived' && (
        <div className="p-4 rounded-2xl border border-brand-border/60 bg-[var(--bg-page)] space-y-3">
          <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
            {iAmSending ? 'Before anything else — how will this book travel?' : 'Waiting for the sender to agree how the book will travel'}
          </p>
          {iAmSending ? (
            <>
              <div className="flex gap-2">
                {(['in_person', 'courier'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRouteMethod(m)}
                    className={`flex-1 py-2 rounded-lg text-2xs font-bold uppercase tracking-widest transition-colors ${
                      routeMethod === m
                        ? 'bg-brand-brown text-white'
                        : 'border border-brand-border/60 text-[var(--text-secondary)]'
                    }`}
                  >
                    {m === 'in_person' ? 'Meeting in person' : 'Posting by courier'}
                  </button>
                ))}
              </div>
              {routeMethod === 'in_person' && (
                <input
                  value={meetingPoint}
                  onChange={(e) => setMeetingPoint(e.target.value)}
                  placeholder="Public place to meet — a café, a metro station, a campus gate"
                  className="input-classic !py-2 text-xs w-full bg-[var(--bg-surface)]"
                />
              )}
              {routeError && <p className="text-xs text-red-600">{routeError}</p>}
              <button
                type="button"
                disabled={routeBusy}
                onClick={submitRoute}
                className="px-4 py-2 rounded-lg bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50 transition-colors"
              >
                {routeBusy ? 'Saving…' : 'Agree route'}
              </button>
            </>
          ) : (
            <p className="text-xs text-[var(--text-secondary)] italic">
              You'll be able to post updates once the sender has agreed whether you're meeting in person or the book is being posted.
            </p>
          )}
        </div>
      )}

      {routeIsCourier && (
        <div className="p-4 rounded-2xl border border-brand-border/60 bg-[var(--bg-page)] space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Delivery address</p>
            <button
              type="button"
              onClick={() => { setAddrOpen(v => !v); if (!addrLoaded) loadAddresses(); }}
              className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text"
            >
              {addrOpen ? 'Hide' : counterpartyAddress ? 'View addresses' : 'Add your address'}
            </button>
          </div>

          {addrOpen && (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-2xs font-bold text-[var(--text-primary)]">
                  {counterpartyName ? `${counterpartyName}'s address` : "The other reader's address"}
                </p>
                {counterpartyAddress ? (
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {[counterpartyAddress.line1, counterpartyAddress.line2, counterpartyAddress.landmark, counterpartyAddress.area,
                      counterpartyAddress.city, counterpartyAddress.state, counterpartyAddress.pincode].filter(Boolean).join(', ')}
                    {counterpartyAddress.phone && <><br />Phone: {counterpartyAddress.phone}</>}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--text-secondary)] italic">Not shared yet.</p>
                )}
              </div>

              <div className="space-y-2 pt-3 border-t border-brand-border/40">
                <p className="text-2xs font-bold text-[var(--text-primary)]">Your address</p>
                <input value={addrForm.line1} onChange={(e) => setAddrForm(f => ({ ...f, line1: e.target.value }))}
                  placeholder="Street address" className="input-classic !py-2 text-xs w-full bg-[var(--bg-surface)]" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={addrForm.area} onChange={(e) => setAddrForm(f => ({ ...f, area: e.target.value }))}
                    placeholder="Area / locality" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
                  <input value={addrForm.landmark} onChange={(e) => setAddrForm(f => ({ ...f, landmark: e.target.value }))}
                    placeholder="Landmark (optional)" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={addrForm.city} onChange={(e) => setAddrForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="City" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
                  <input value={addrForm.state} onChange={(e) => setAddrForm(f => ({ ...f, state: e.target.value }))}
                    placeholder="State" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
                  <input value={addrForm.pincode} onChange={(e) => setAddrForm(f => ({ ...f, pincode: e.target.value }))}
                    placeholder="Pincode" className="input-classic !py-2 text-xs bg-[var(--bg-surface)]" />
                </div>
                <input value={addrForm.phone} onChange={(e) => setAddrForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="Phone (for the courier)" className="input-classic !py-2 text-xs w-full bg-[var(--bg-surface)]" />
                {addrError && <p className="text-xs text-red-600">{addrError}</p>}
                {addrSaved && <p className="text-xs text-green-600">Saved.</p>}
                <button
                  type="button"
                  disabled={addrBusy}
                  onClick={saveAddress}
                  className="px-4 py-2 rounded-lg bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50 transition-colors"
                >
                  {addrBusy ? 'Saving…' : 'Save my address'}
                </button>
                <p className="text-2xs text-[var(--text-secondary)] italic leading-relaxed">
                  Only visible to the other reader once this request is accepted, and only until the exchange closes.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <ol className="space-y-3">
        {data.events.filter(e => e.leg === leg).length === 0 && (
          <li className="text-xs text-[var(--text-secondary)] italic">
            Nothing recorded on this leg yet. The first update starts the trail.
          </li>
        )}
        {data.events.filter(e => e.leg === leg).map(e => (
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
                  {e.trackingUrl && (
                    <>
                      {' '}
                      <a href={e.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-brand-gold-text underline">
                        Track on {e.courierName}
                      </a>
                    </>
                  )}
                </p>
              )}
              <p className="text-2xs text-[var(--text-secondary)] tabular-nums">{whenLabel(e.at)}</p>
            </div>
          </li>
        ))}
      </ol>

      {chatStatus !== 'Archived' && (routeEvent || legEvents.length > 0) && (
        <div className="space-y-3 pt-4 border-t border-brand-border/40">
          <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
            {iAmSending ? 'You are sending — post an update' : 'You are waiting — confirm what happened'}
          </p>

          {showCourierFields && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={courierName}
                onChange={(e) => setCourierName(e.target.value)}
                className="input-classic !py-2 text-xs bg-[var(--bg-page)]"
                aria-label="Courier"
              >
                <option value="">Courier (if posting)</option>
                {data.couriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
                placeholder="Tracking number"
                className="input-classic !py-2 text-xs bg-[var(--bg-page)]"
              />
            </div>
          )}

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the other reader should know"
            className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]"
          />

          <div className="flex flex-wrap gap-2">
            {actions.map(a => (
              <button
                key={a.event}
                type="button"
                disabled={busy}
                onClick={() => post(a.event)}
                className="px-4 py-2 rounded-lg border border-brand-border/60 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
              >
                {a.label}
              </button>
            ))}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
