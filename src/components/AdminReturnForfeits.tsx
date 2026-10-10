import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';

/**
 * Admin: deposits forfeited because a book wasn't on its way back by its
 * return deadline (Oct 2026). Each one is owed to the book's owner.
 * SwapSutra can't move money by itself, so the admin pays the owner by UPI
 * and marks it paid here, which tells the owner.
 */
const API_URL = apiUrl('/api/swapsutra');

interface Forfeit {
  id: string; swapId: string; leg: string; bookTitle: string;
  defaulterEmail: string; ownerEmail: string; amount: number;
  dueAt: string; forfeitedAt: string; payoutStatus: string; paidAt?: string; note?: string;
  payTo?: { upiId: string; payeeName: string; qrUrl: string } | null;
}

const when = (v: string) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function AdminReturnForfeits() {
  const [items, setItems] = useState<Forfeit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'adminListReturnForfeits' }) });
      const data = await res.json();
      if (data.success) { setItems(data.items || []); setError(''); } else setError(data.message || 'Could not load forfeits.');
    } catch { setError('Network error loading forfeits.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const markPaid = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'adminMarkForfeitPaid', id }) });
      const data = await res.json();
      if (!data.success) setError(data.message || 'Could not mark it paid.');
      await load();
    } finally { setBusy(''); }
  };

  const toPay = items.filter(i => i.payoutStatus === 'TO_PAY_OWNER');
  const done = items.filter(i => i.payoutStatus !== 'TO_PAY_OWNER');

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-2xl text-[var(--text-primary)]">Payouts to make</h3>
        <button onClick={load} className="text-xs text-brand-gold-text underline">Refresh</button>
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
        Sale payments to sellers (after the buyer closes the purchase), and deposits forfeited for a late return or by a dispute decision. Pay the UPI shown, then mark it paid — the reader is notified.
      </p>
      {loading && <p className="text-sm text-[var(--text-secondary)]">Loading…</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</p>}
      {!loading && !toPay.length && !error && <p className="text-sm text-[var(--text-secondary)]">Nothing to pay out.</p>}
      {toPay.map(f => (
        <div key={f.id} className="rounded-2xl border border-red-200 bg-[var(--bg-surface)] p-4 space-y-2">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {String(f.leg) === 'sale' ? 'Sale payout · ' : String(f.leg) === 'rent' ? 'Rent payout · ' : String(f.leg).startsWith('refund:') ? 'Refund · ' : ''}Pay ₹{f.amount} to <span className="break-all">{f.ownerEmail}</span>
          </p>
          {f.payTo ? (
            <p className="text-xs text-[var(--text-primary)]">
              UPI <strong className="font-mono">{f.payTo.upiId}</strong> · {f.payTo.payeeName}
              {f.payTo.qrUrl && <> · <a href={f.payTo.qrUrl} target="_blank" rel="noopener noreferrer" className="underline text-brand-gold-text">QR</a></>}
            </p>
          ) : (
            <p className="text-xs text-amber-700">No UPI ID saved yet — the reader has been asked to add one.</p>
          )}
          {f.note && <p className="text-2xs text-[var(--text-secondary)]">{f.note}</p>}
          <p className="text-xs text-[var(--text-secondary)]">
            &ldquo;{f.bookTitle}&rdquo; · {String(f.leg) === 'sale' ? 'buyer closed the purchase' : String(f.leg).startsWith('refund:') ? 'refund to the reader who paid' : String(f.leg) === 'rent' ? 'rent from the renter’s deposit' : String(f.leg).startsWith('dispute:') ? 'dispute decision' : `not returned by ${when(f.dueAt)}`}{f.defaulterEmail ? <> · from <span className="break-all">{f.defaulterEmail}</span></> : null} · exchange {f.swapId}
          </p>
          <button onClick={() => markPaid(f.id)} disabled={busy === f.id} className="px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50">
            {busy === f.id ? 'Saving…' : 'I have paid this'}
          </button>
        </div>
      ))}
      {done.length > 0 && (
        <details className="text-xs text-[var(--text-secondary)]">
          <summary className="cursor-pointer">Paid / closed ({done.length})</summary>
          <ul className="mt-2 space-y-1">
            {done.map(f => <li key={f.id}>₹{f.amount} → {f.ownerEmail} · {f.payoutStatus === 'PAID_TO_OWNER' ? `paid ${when(f.paidAt || '')}` : f.payoutStatus === 'KEPT_AS_FEE' ? 'platform fee kept from the deposit' : 'no deposit'}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
