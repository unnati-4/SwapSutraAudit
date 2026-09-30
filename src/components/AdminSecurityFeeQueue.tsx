import { useCallback, useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';

/**
 * Admin backlog queue for the master state machine's security-fee gate.
 *
 * Every already-accepted swap without every required payer
 * ADMIN_APPROVED shows up here — including every pre-existing chat that
 * the retroactive "no grandfathering" migration just locked. This is
 * deliberately a review QUEUE, not a bulk "approve everything" button:
 * each payment is still approved individually, inside SwapStateMachine,
 * by calling adminApproveSecurityFeePayment. This view exists purely so
 * the admin is never stuck looking up swap IDs one at a time.
 */

const API_URL = apiUrl('/api/swapsutra');

interface BacklogPayer {
  payerRole: string;
  payerEmail: string;
  requiredAmount: number;
  estimated?: boolean;
  paymentStatus: string;
  adminStatus: string;
}

interface BacklogRow {
  swapId: string;
  serviceType: string;
  requestedBookTitle: string;
  requesterEmail: string;
  ownerEmail: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  payers: BacklogPayer[];
}

type SortKey = 'updatedAt' | 'createdAt' | 'serviceType';

function fmtDate(v: string) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminSecurityFeeQueue({ onOpenSwap }: { onOpenSwap?: (swapId: string) => void }) {
  const [rows, setRows] = useState<BacklogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [filterService, setFilterService] = useState('ALL');
  const [filterAdminPending, setFilterAdminPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adminListSecurityFeeBacklog' }),
      });
      const data = await res.json();
      if (data.success) {
        setRows(data.swaps || []);
        setError('');
      } else {
        setError(data.message || 'Could not load the backlog.');
      }
    } catch {
      setError('Network error loading the backlog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = rows
    .filter(r => filterService === 'ALL' || r.serviceType === filterService)
    .filter(r => !filterAdminPending || r.payers.some(p => p.adminStatus === 'ADMIN_PENDING'))
    .slice()
    .sort((a, b) => {
      if (sortKey === 'serviceType') return a.serviceType.localeCompare(b.serviceType);
      const av = new Date(a[sortKey] || a.createdAt).getTime();
      const bv = new Date(b[sortKey] || b.createdAt).getTime();
      return av - bv; // oldest-waiting first
    });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <p className="text-xs font-bold text-amber-800 uppercase tracking-widest">Security-fee approval backlog</p>
        <p className="text-2xs text-amber-700 mt-1">
          {rows.length} exchange{rows.length === 1 ? '' : 's'} have a chat locked pending security-fee approval —
          including exchanges accepted before this feature existed (retroactive lock, no grandfathering).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="input-classic bg-[var(--input-bg)] text-2xs">
          <option value="updatedAt">Sort: Oldest waiting first</option>
          <option value="createdAt">Sort: Oldest created first</option>
          <option value="serviceType">Sort: Service type</option>
        </select>
        <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="input-classic bg-[var(--input-bg)] text-2xs">
          <option value="ALL">All service types</option>
          <option value="SWAP">SWAP</option>
          <option value="RENT">RENT</option>
          <option value="LEND">LEND</option>
          <option value="SELL">SELL</option>
        </select>
        <label className="flex items-center gap-2 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
          <input type="checkbox" checked={filterAdminPending} onChange={(e) => setFilterAdminPending(e.target.checked)} />
          Awaiting my review only
        </label>
        <button onClick={load} className="ml-auto px-3 py-2 rounded-lg border border-brand-border text-2xs font-bold uppercase tracking-widest">Refresh</button>
      </div>

      {loading && <p className="text-2xs text-[var(--text-secondary)] italic">Loading…</p>}
      {error && <p className="text-2xs text-red-500">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-brand-border">
        <table className="w-full text-2xs">
          <thead className="bg-[var(--bg-page-alt)]">
            <tr>
              <th className="p-3 text-left">Swap ID</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Book</th>
              <th className="p-3 text-left">Parties</th>
              <th className="p-3 text-left">Payers</th>
              <th className="p-3 text-left">Waiting since</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
              <tr key={r.swapId} className="border-t border-brand-border/40">
                <td className="p-3 font-mono">{r.swapId}</td>
                <td className="p-3">{r.serviceType}</td>
                <td className="p-3">{r.requestedBookTitle}</td>
                <td className="p-3">{r.requesterEmail.split('@')[0]} ↔ {r.ownerEmail.split('@')[0]}</td>
                <td className="p-3 space-y-1">
                  {r.payers.map(p => (
                    <div key={p.payerRole} className={`font-bold uppercase ${p.adminStatus === 'ADMIN_APPROVED' ? 'text-green-600' : p.adminStatus === 'ADMIN_PENDING' ? 'text-amber-600' : 'text-[var(--text-secondary)]'}`}>
                      {p.payerRole}: ₹{p.requiredAmount}{p.estimated ? ' (estimate — price not verified)' : ''} — {p.adminStatus.replace('_', ' ')}
                    </div>
                  ))}
                </td>
                <td className="p-3">{fmtDate(r.updatedAt || r.createdAt)}</td>
                <td className="p-3">
                  <button
                    onClick={() => onOpenSwap && onOpenSwap(r.swapId)}
                    className="px-3 py-1.5 rounded-lg bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-[var(--text-secondary)] italic">Nothing waiting.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
