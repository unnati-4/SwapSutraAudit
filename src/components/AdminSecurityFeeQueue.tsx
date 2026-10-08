import { Fragment, useCallback, useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';

/**
 * Exchange payments to verify (Admin → Payments).
 *
 * Every accepted exchange whose payments are not all verified. "Review"
 * opens the payment right here — amount and what it is made of, the UTR,
 * the screenshot — with Approve / Reject (9 Oct 2026: the button used to
 * call a callback nobody passed, so it did nothing). Each payment is still
 * approved one at a time; there is no bulk approve.
 */

const API_URL = apiUrl('/api/swapsutra');

interface BacklogPayer {
  payerRole: string;
  payerEmail: string;
  requiredAmount: number;
  estimated?: boolean;
  paymentStatus: string;
  adminStatus: string;
  depositAmount?: number;
  platformFee?: number;
  saleAmount?: number;
  utr?: string;
  screenshotUrl?: string;
  submittedAt?: string;
  rejectedReason?: string;
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
  const [filterAdminPending, setFilterAdminPending] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

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

  const decide = async (swapId: string, payerRole: string, decision: 'APPROVE' | 'REJECT') => {
    const key = swapId + ':' + payerRole;
    const reason = (reasons[key] || '').trim();
    if (decision === 'REJECT' && !reason) { setNotice('Write why the payment is not accepted — the reader sees it.'); return; }
    setBusy(key); setNotice('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adminApproveSecurityFeePayment', swapId, payerRole, decision, reason }),
      });
      const data = await res.json();
      setNotice(data.success ? (decision === 'APPROVE' ? 'Approved — the reader is told and the exchange moves on.' : 'Rejected — the reader is asked to pay again.') : (data.message || 'That did not go through.'));
      if (data.success) await load();
    } catch {
      setNotice('Network error. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const breakdown = (p: BacklogPayer) => {
    if ((p.saleAmount ?? 0) > 0) return `₹${p.saleAmount} book price + ₹${p.platformFee ?? 0} fee`;
    if ((p.depositAmount ?? 0) > 0) return `₹${p.depositAmount} deposit + ₹${p.platformFee ?? 0} fee`;
    return `₹${p.platformFee ?? p.requiredAmount} platform fee`;
  };

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
        <p className="text-xs font-bold text-amber-800 uppercase tracking-widest">Exchange payments to verify</p>
        <p className="text-2xs text-amber-700 mt-1">
          {rows.filter(r => r.payers.some(p => p.adminStatus === 'ADMIN_PENDING')).length} waiting for you to check ·
          {' '}{rows.length} exchange{rows.length === 1 ? '' : 's'} not fully paid yet. Check the UTR in your UPI app, then approve.
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
          Paid — waiting for my check
        </label>
        <button onClick={load} className="ml-auto px-3 py-2 rounded-lg border border-brand-border text-2xs font-bold uppercase tracking-widest">Refresh</button>
      </div>

      {loading && <p className="text-2xs text-[var(--text-secondary)] italic">Loading…</p>}
      {error && <p className="text-2xs text-red-500">{error}</p>}
      {notice && <p className="text-xs text-[var(--text-primary)]" role="status">{notice}</p>}

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
            {visible.map(r => (<Fragment key={r.swapId}>
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
                    type="button"
                    onClick={() => { setOpen(open === r.swapId ? null : r.swapId); onOpenSwap?.(r.swapId); }}
                    aria-expanded={open === r.swapId}
                    className="px-3 py-1.5 rounded-lg bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest"
                    data-testid="fee-review"
                  >
                    {open === r.swapId ? 'Close' : 'Review'}
                  </button>
                </td>
              </tr>
              {open === r.swapId && (
                <tr key={r.swapId + '-review'} className="bg-[var(--bg-page)]">
                  <td colSpan={7} className="p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      {r.payers.map(p => {
                        const key = r.swapId + ':' + p.payerRole;
                        return (
                          <div key={key} className="rounded-xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-2 text-xs">
                            <p className="font-bold text-[var(--text-primary)]">{p.payerRole === 'owner' ? 'Owner' : 'Requester'} · {p.payerEmail}</p>
                            <p>₹{p.requiredAmount} <span className="text-[var(--text-secondary)]">({breakdown(p)})</span></p>
                            <p className={p.adminStatus === 'ADMIN_APPROVED' ? 'text-green-700 font-semibold' : p.adminStatus === 'ADMIN_PENDING' ? 'text-amber-700 font-semibold' : 'text-[var(--text-secondary)]'}>
                              {p.adminStatus === 'ADMIN_APPROVED' ? 'Verified ✓' : p.adminStatus === 'ADMIN_PENDING' ? 'Paid — check it' : p.adminStatus === 'ADMIN_REJECTED' ? `Rejected${p.rejectedReason ? ': ' + p.rejectedReason : ''}` : 'Not paid yet'}
                            </p>
                            {p.utr && <p>UTR: <span className="font-mono font-bold select-all">{p.utr}</span>{p.submittedAt ? ` · ${fmtDate(p.submittedAt)}` : ''}</p>}
                            {p.screenshotUrl && (
                              <a href={p.screenshotUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-brand-gold-text underline font-semibold">Open payment screenshot</a>
                            )}
                            {p.adminStatus === 'ADMIN_PENDING' && (
                              <div className="space-y-2 pt-2 border-t border-brand-border/40">
                                <input
                                  value={reasons[key] || ''}
                                  onChange={(e) => setReasons(x => ({ ...x, [key]: e.target.value }))}
                                  placeholder="Reason, only if rejecting (the reader sees it)"
                                  className="input-classic !py-2 text-xs w-full bg-[var(--input-bg)]"
                                />
                                <div className="flex gap-2">
                                  <button type="button" disabled={busy === key} onClick={() => decide(r.swapId, p.payerRole, 'APPROVE')}
                                    className="flex-1 px-3 py-2 rounded-lg bg-green-600 text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">
                                    {busy === key ? '…' : 'Approve'}
                                  </button>
                                  <button type="button" disabled={busy === key} onClick={() => decide(r.swapId, p.payerRole, 'REJECT')}
                                    className="flex-1 px-3 py-2 rounded-lg bg-red-500 text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">
                                    Reject
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-[var(--text-secondary)] italic">Nothing waiting.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
