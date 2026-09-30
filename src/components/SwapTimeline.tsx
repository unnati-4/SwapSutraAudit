import { useCallback, useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';
import { depositTitle, DEPOSIT_ESTIMATE_EXPLAINER } from '../utils/deposit';

/**
 * One chronological view of a swap, aggregated server-side by
 * getSwapTimeline from data that already exists (SwapRequests,
 * SwapProofs, SwapJourney, ChatMessages, SwapDisputes) — see the Trust
 * Gap Closure Plan, P0-4. This component only renders whatever list the
 * backend returns; it stores nothing and computes no event itself.
 */

const API_URL = apiUrl('/api/swapsutra');

interface TimelineEvent {
  type: string;
  label: string;
  at: string;
  by?: string;
  courierName?: string;
  awb?: string;
  trackingUrl?: string;
  mediaUrl?: string;
}

interface TimelineData {
  swapId: string;
  events: TimelineEvent[];
  deposit?: { amount: number; state: string; reason: string; estimated?: boolean };
  currentStatus: string;
}

function whenLabel(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const TONE: Record<string, string> = {
  request_declined: 'bg-red-400',
  request_cancelled: 'bg-[var(--text-secondary)]',
  dispute_opened: 'bg-red-500',
  dispute_resolved: 'bg-green-500',
  refund_issued: 'bg-green-500',
  completed: 'bg-green-500',
};

export default function SwapTimeline({ swapId }: { swapId: string }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!swapId) return;
    try {
      const res = await fetch(`${API_URL}?action=getSwapTimeline&swapId=${encodeURIComponent(swapId)}`);
      const payload = await res.json();
      if (payload?.success) { setData(payload as TimelineData); setError(null); }
      else setError(payload?.message || 'Could not load the timeline.');
    } catch {
      setError('Could not load the timeline.');
    } finally {
      setLoading(false);
    }
  }, [swapId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border">
        <p className="text-xs text-[var(--text-secondary)] italic">Loading the exchange timeline…</p>
      </div>
    );
  }

  if (!data || !data.events?.length) {
    return (
      <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-primary)] mb-2">Exchange timeline</h4>
        <p className="text-xs text-[var(--text-secondary)]">{error || 'Nothing recorded yet — this fills in as the exchange happens.'}</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border space-y-5">
      <div className="space-y-1">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">Exchange timeline</h4>
        <p className="text-2xs text-[var(--text-secondary)] italic">
          Everything recorded about this exchange, in order — instead of piecing it together from the chat.
        </p>
      </div>

      <ol className="space-y-4">
        {data.events.map((e, i) => (
          <li key={`${e.type}-${e.at}-${i}`} className="flex gap-3">
            <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TONE[e.type] || 'bg-brand-gold'}`} aria-hidden="true" />
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-sm text-[var(--text-primary)]">
                <span className="font-bold">{e.label}</span>
                {e.by && <span className="text-[var(--text-secondary)]"> · {e.by}</span>}
              </p>
              {e.awb && (
                <p className="text-xs text-[var(--text-secondary)] break-all">
                  {e.courierName} · <span className="font-mono">{e.awb}</span>
                  {e.trackingUrl && (
                    <>
                      {' '}
                      <a href={e.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-brand-gold-text underline">
                        Track
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

      {data.deposit && data.deposit.amount > 0 && (
        <div className="p-4 rounded-2xl bg-[var(--bg-page)] border border-brand-border/60 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{depositTitle(data.deposit.estimated)}</span>
            <span className="text-sm font-bold tabular-nums text-[var(--text-primary)]">₹{data.deposit.amount}</span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{data.deposit.reason}</p>
          {data.deposit.estimated && (
            <p className="text-xs italic text-[var(--text-secondary)] leading-relaxed">{DEPOSIT_ESTIMATE_EXPLAINER}</p>
          )}
        </div>
      )}
    </div>
  );
}
