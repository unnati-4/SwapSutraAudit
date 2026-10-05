import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';

/**
 * Admin: verify ₹20 "unlimited listings" payments, one at a time, and see
 * what the platform fee and unlocks have actually brought in (verified
 * payments only). Mount next to <AdminSecurityFeeQueue /> in the admin panel.
 */

const API_URL = apiUrl('/api/swapsutra');

interface UnlockRow {
  id: string;
  email: string;
  amount: number;
  utr: string;
  screenshotUrl: string;
  createdAt: string;
}

interface Revenue {
  exchangeFees: number;
  exchangePayments: number;
  unlockFees: number;
  unlocksPaid: number;
  unlocksByCoupon: number;
  total: number;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function fmtDate(v: string) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AdminListingUnlockQueue() {
  const [rows, setRows] = useState<UnlockRow[]>([]);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, rev] = await Promise.all([
        post({ action: 'adminListListingUnlocks' }),
        post({ action: 'adminPlatformRevenueSummary' }),
      ]);
      if (queue.success) { setRows(queue.items || []); setError(''); }
      else setError(queue.message || 'Could not load unlock requests.');
      if (rev.success) setRevenue(rev);
    } catch {
      setError('Network error loading unlock requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const review = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    setBusy(id);
    try {
      const data = await post({ action: 'adminReviewListingUnlock', id, decision, reason: reasons[id] || '' });
      if (!data.success) setError(data.message || 'Could not save that decision.');
      await load();
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-2xl text-[var(--text-primary)]">Listing unlocks</h3>
        <button onClick={load} className="text-xs text-brand-gold-text underline">Refresh</button>
      </div>

      {revenue && (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          Verified so far: <span className="text-[var(--text-primary)] font-semibold tabular-nums">₹{revenue.total}</span> —
          ₹{revenue.exchangeFees} from {revenue.exchangePayments} exchange fees, ₹{revenue.unlockFees} from {revenue.unlocksPaid} paid unlocks
          ({revenue.unlocksByCoupon} unlocked by coupon).
        </p>
      )}

      {loading && <p className="text-sm text-[var(--text-secondary)]">Loading…</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</p>}
      {!loading && !rows.length && !error && (
        <p className="text-sm text-[var(--text-secondary)]">No payments waiting. New ones appear here and in your notifications.</p>
      )}

      {rows.map(r => (
        <div key={r.id} className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--text-primary)] break-all">{r.email}</p>
            <p className="text-xs text-[var(--text-secondary)]">{fmtDate(r.createdAt)}</p>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            ₹{r.amount} · UTR <span className="text-[var(--text-primary)]">{r.utr}</span>
            {r.screenshotUrl && <> · <a href={r.screenshotUrl} target="_blank" rel="noreferrer" className="underline text-brand-gold-text">View screenshot</a></>}
          </p>
          <input
            value={reasons[r.id] || ''}
            onChange={e => setReasons(s => ({ ...s, [r.id]: e.target.value }))}
            placeholder="Reason, if rejecting (shown to the reader)"
            className="input-classic w-full !py-2 text-xs bg-[var(--bg-page)]"
          />
          <div className="flex gap-2">
            <button onClick={() => review(r.id, 'APPROVE')} disabled={busy === r.id} className="flex-1 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50">Approve</button>
            <button onClick={() => review(r.id, 'REJECT')} disabled={busy === r.id || !(reasons[r.id] || '').trim()} className="flex-1 px-3 py-2 rounded-lg bg-red-500 text-white text-xs font-semibold disabled:opacity-50">Reject</button>
          </div>
        </div>
      ))}
    </section>
  );
}
