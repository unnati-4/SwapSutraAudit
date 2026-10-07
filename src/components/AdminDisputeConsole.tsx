import { useCallback, useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';
import AdminVmsReview from './AdminVmsReview';

/**
 * Admin dispute console — the resolution workflow disputeSwapRequest's
 * creation half never had (Trust Gap Closure Plan, P0-3). Rendered as a
 * tab inside the existing ManagementConsole, not a separate admin app.
 * Calls getOpenDisputes (read) and resolveDispute (write); both are
 * admin-guarded server-side by isAuthorizedAdminEmail, the same helper
 * every other admin action in this console already relies on.
 */

const API_URL = apiUrl('/api/swapsutra');

interface DisputeRow {
  id: string;
  swapId: string;
  reporterEmail: string;
  category: string;
  categoryLabel: string;
  reason: string;
  details: string;
  status: string;
  resolutionStatus: string;
  resolutionNote: string;
  depositOutcome: string;
  depositOutcomeAmount: string;
  resolvedBy: string;
  resolvedAt: string;
  evidenceUrls: string[];
  createdAt: string;
  swap: {
    requesterEmail: string;
    ownerEmail: string;
    requestedBookTitle: string;
    serviceType: string;
    status: string;
    securityDeposit: string | number;
  } | null;
}

const RESOLUTION_STATUSES = ['UNDER_REVIEW', 'RESOLVED', 'REJECTED'];
const DEPOSIT_OUTCOMES = ['NOT_APPLICABLE', 'NONE', 'FULL_REFUND', 'PARTIAL_DEDUCTION', 'FULL_FORFEIT'];

function whenLabel(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminDisputeConsole() {
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [resolutionDraft, setResolutionDraft] = useState<Record<string, {
    resolutionStatus: string; resolutionNote: string; depositOutcome: string; depositOutcomeAmount: string;
  }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}?action=getOpenDisputes${includeResolved ? '&includeResolved=1' : ''}`);
      const payload = await res.json();
      if (payload?.success) setDisputes(payload.disputes || []);
      else setError(payload?.message || 'Could not load disputes.');
    } catch {
      setError('Could not load disputes.');
    } finally {
      setLoading(false);
    }
  }, [includeResolved]);

  useEffect(() => { load(); }, [load]);

  const draftFor = (d: DisputeRow) => resolutionDraft[d.id] || {
    resolutionStatus: 'RESOLVED',
    resolutionNote: '',
    depositOutcome: 'NOT_APPLICABLE',
    depositOutcomeAmount: '',
  };

  const setDraft = (id: string, patch: Partial<ReturnType<typeof draftFor>>) => {
    setResolutionDraft(prev => ({ ...prev, [id]: { ...draftFor({ id } as DisputeRow), ...prev[id], ...patch } }));
  };

  const resolve = useCallback(async (d: DisputeRow) => {
    const draft = draftFor(d);
    setBusy(d.id);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolveDispute',
          disputeId: d.id,
          resolutionStatus: draft.resolutionStatus,
          resolutionNote: draft.resolutionNote,
          depositOutcome: draft.depositOutcome,
          depositOutcomeAmount: draft.depositOutcomeAmount,
        }),
      });
      const payload = await res.json();
      if (payload?.success) {
        await load();
      } else {
        setError(payload?.message || 'Could not resolve that dispute.');
      }
    } catch {
      setError('Could not resolve that dispute.');
    } finally {
      setBusy(null);
    }
  }, [resolutionDraft, load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xl font-serif text-[var(--text-primary)]">Disputes</h3>
        <label className="flex items-center gap-2 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
          <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} />
          Show resolved too
        </label>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>
      )}
      {loading && <p className="text-xs text-[var(--text-secondary)] italic">Loading disputes…</p>}

      {!loading && disputes.length === 0 && (
        <div className="p-10 text-center border border-dashed border-brand-border rounded-3xl">
          <p className="text-2xs text-[var(--text-secondary)] uppercase font-bold tracking-widest">No open disputes.</p>
        </div>
      )}

      <div className="space-y-4">
        {disputes.map(d => {
          const isOpenRow = expanded === d.id;
          const draft = draftFor(d);
          return (
            <div key={d.id} className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-5 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-serif text-lg text-[var(--text-primary)]">{d.categoryLabel}</p>
                  <p className="text-2xs text-[var(--text-secondary)] uppercase tracking-widest">
                    Swap #{d.swapId} · reported by {d.reporterEmail} · {whenLabel(d.createdAt)}
                  </p>
                  {d.swap && (
                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                      "{d.swap.requestedBookTitle}" · {d.swap.serviceType} · requester: {d.swap.requesterEmail} · owner: {d.swap.ownerEmail}
                      {!!d.swap.securityDeposit && <> · deposit ₹{d.swap.securityDeposit}</>}
                    </p>
                  )}
                </div>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-2xs font-bold uppercase tracking-widest ${
                  d.status === 'Closed' ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  {d.resolutionStatus || d.status}
                </span>
              </div>

              {d.reason && <p className="text-xs text-[var(--text-primary)]">{d.reason}</p>}
              {d.details && <p className="text-xs text-[var(--text-secondary)] italic">{d.details}</p>}

              {d.evidenceUrls.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {d.evidenceUrls.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noopener noreferrer"
                      className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text underline">
                      Evidence {i + 1}
                    </a>
                  ))}
                </div>
              )}

              {d.resolutionNote && (
                <p className="text-xs text-[var(--text-secondary)]">
                  <span className="font-bold">Resolution note:</span> {d.resolutionNote}
                  {d.resolvedBy && <> · by {d.resolvedBy} on {whenLabel(d.resolvedAt)}</>}
                </p>
              )}

              <button
                type="button"
                onClick={() => setExpanded(isOpenRow ? null : d.id)}
                className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text"
              >
                {isOpenRow ? 'Hide decision panel' : 'Review & decide'}
              </button>

              {isOpenRow && (
                <div className="pt-3 border-t border-brand-border/40 space-y-3">
                  {/* Oct 2026: review the exchange's videos, then decide each deposit. */}
                  <AdminVmsReview
                    swapId={d.swapId}
                    disputeId={d.id}
                    requesterEmail={d.swap?.requesterEmail}
                    ownerEmail={d.swap?.ownerEmail}
                    requesterDeposit={Number(d.swap?.securityDeposit || 0)}
                    ownerDeposit={Number((d.swap as any)?.ownerDeposit || 0)}
                  />
                  <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] pt-2">Close the dispute</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                      value={draft.resolutionStatus}
                      onChange={(e) => setDraft(d.id, { resolutionStatus: e.target.value })}
                      className="input-classic !py-2 text-xs bg-[var(--bg-page)]"
                    >
                      {RESOLUTION_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                    <select
                      value={draft.depositOutcome}
                      onChange={(e) => setDraft(d.id, { depositOutcome: e.target.value })}
                      className="input-classic !py-2 text-xs bg-[var(--bg-page)]"
                    >
                      {DEPOSIT_OUTCOMES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  {draft.depositOutcome === 'PARTIAL_DEDUCTION' && (
                    <input
                      type="number"
                      min={0}
                      value={draft.depositOutcomeAmount}
                      onChange={(e) => setDraft(d.id, { depositOutcomeAmount: e.target.value })}
                      placeholder="Amount to deduct (₹)"
                      className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]"
                    />
                  )}
                  <textarea
                    value={draft.resolutionNote}
                    onChange={(e) => setDraft(d.id, { resolutionNote: e.target.value })}
                    placeholder="Resolution note — shown to both readers"
                    rows={3}
                    className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]"
                  />
                  <p className="text-2xs text-[var(--text-secondary)] italic leading-relaxed">
                    Decide the deposits above first; forfeits appear in Admin → Payments → Deposits to pay out. This
                    closes the dispute and sends both readers the note.
                  </p>
                  <button
                    type="button"
                    disabled={busy === d.id}
                    onClick={() => resolve(d)}
                    className="w-full py-3 rounded-xl bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50 transition-colors"
                  >
                    {busy === d.id ? 'Saving…' : 'Save Decision & Notify Both Parties'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
