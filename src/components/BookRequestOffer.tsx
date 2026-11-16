import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';
import ExchangeRoom from './ExchangeRoom';

type Offer = { revision: string; title: string; serviceType: string; swapPreference: string; durationDays: number; price: number | null; acceptedAt?: string };
type ShelfBook = { id: string; title: string; ownerEmail?: string; status?: string };
export default function BookRequestOffer({ chatId, onChanged }: {
  chatId: string; onChanged?: () => void;
}) {
  const [state, setState] = useState<{ offer?: Offer; isOwner?: boolean; swapId?: string; books?: ShelfBook[] }>({});
  const [bookId, setBookId] = useState('');
  const [serviceType, setType] = useState('SELL');
  const [swapPreference, setPreference] = useState('Permanent');
  const [durationDays, setDays] = useState('30');
  const [offeredBookId, setCounterBook] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const post = useCallback(async (action: string, payload = {}) => {
    const res = await fetch(apiUrl('/api/swapsutra'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, chatId, ...payload }) });
    return res.json();
  }, [chatId]);
  const refresh = useCallback(async () => {
    try { const r = await post('getBookRequestOffer'); if (r.success) setState(r); else setMessage(r.message); }
    catch { setMessage('Could not load the offer. Please retry.'); }
  }, [post]);
  useEffect(() => { setState({}); setMessage(''); void refresh(); const t = setInterval(refresh, 10000); return () => clearInterval(t); }, [refresh]);
  const act = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true); setMessage('');
    try {
      let r = await post(action, payload);
      if (r.error === 'LOCATION_NEEDED') {
        const location = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
        r = await post(action, { ...payload, readerLat: location.coords.latitude, readerLng: location.coords.longitude });
      }
      if (!r.success) setMessage(r.message || 'Please try again.');
      else { await refresh(); onChanged?.(); }
    } catch { setMessage('Could not complete this action. Check your connection and location permission, then retry.'); }
    finally { setBusy(false); }
  };
  const shelf = state.books || [];
  if (state.swapId) return <ExchangeRoom swapId={state.swapId} onChanged={onChanged} />;
  return <section className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-3">
    <h3 className="font-serif text-lg">Book offer</h3>
    {state.offer && <div className="space-y-1 text-sm">
      <p><strong>{state.offer.title}</strong> · {state.offer.serviceType === 'SELL' ? 'For sale' : state.offer.serviceType === 'RENT' ? 'For rent' : `${state.offer.swapPreference} swap`}</p>
      {state.offer.price != null && <p>{state.offer.serviceType === 'RENT' ? `₹${state.offer.price}/month · ${state.offer.durationDays} days` : `Book price ₹${state.offer.price}`}</p>}
      <p className="text-xs">Shipping is quoted separately by admin. The existing platform fees and swap/rental protection rules apply.</p>
    </div>}
    {state.isOwner ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act('saveBookRequestOffer', { bookId, serviceType, swapPreference, durationDays: Number(durationDays) }); }}>
      <label className="block text-xs">Your listed book
        <select required className="input-classic w-full" value={bookId} onChange={e => setBookId(e.target.value)}><option value="">Choose a book</option>{shelf.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select>
      </label>
      {!shelf.length && <p className="text-xs">List your book and complete approval first, then return here to send the offer.</p>}
      <label className="block text-xs">Available for
        <select className="input-classic w-full" value={serviceType} onChange={e => setType(e.target.value)}><option value="SELL">Sell</option><option value="RENT">Rent</option><option value="SWAP">Swap</option></select>
      </label>
      {serviceType === 'SWAP' && <label className="block text-xs">Swap type<select className="input-classic w-full" value={swapPreference} onChange={e => setPreference(e.target.value)}><option>Permanent</option><option>Temporary</option></select></label>}
      {serviceType === 'RENT' && <label className="block text-xs">Rental days<input required type="number" min="1" max="365" className="input-classic w-full" value={durationDays} onChange={e => setDays(e.target.value)} /></label>}
      <button disabled={busy || !bookId} className="btn-primary px-4 py-2">{busy ? 'Saving…' : 'Send offer for confirmation'}</button>
      <p className="text-xs">Use the availability and price already set on your listing. The requester must agree before the exchange begins.</p>
    </form> : state.offer ? <div className="space-y-3">
      {state.offer.serviceType === 'SWAP' && <label className="block text-xs">Your book to offer in return<select required className="input-classic w-full" value={offeredBookId} onChange={e => setCounterBook(e.target.value)}><option value="">Choose your listed book</option>{shelf.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></label>}
      <button className="btn-primary px-4 py-2" disabled={busy || (state.offer.serviceType === 'SWAP' && !offeredBookId)} onClick={() => act('confirmBookRequestOffer', { revision: state.offer?.revision, offeredBookId })}>{busy ? 'Confirming…' : 'I agree — start this exchange'}</button>
      <p className="text-xs">Not agreed? Discuss changes in the chat before confirming.</p>
    </div> : <p className="text-sm">Waiting for the owner to offer this book for rent, swap or sale.</p>}
    {message && <p role="alert" className="text-sm">{message}</p>}
  </section>;
}
