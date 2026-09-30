import { useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';

/**
 * Liquidity by pincode — the one number that says whether SwapSutra is
 * actually working anywhere.
 *
 * Total readers and total listings go up whether or not books move. This
 * asks the only question a hyperlocal marketplace lives or dies on: of
 * the requests old enough to have been answered, what share ended with a
 * book in someone's hands within a week — and in which neighbourhoods?
 *
 * A marketplace spread thinly across a country fails everywhere at once.
 * The same members concentrated in three pincodes produce a product that
 * works. This panel is how you tell those two situations apart, and it
 * is the input to where acquisition spend should point.
 */

const API_URL = apiUrl('/api/swapsutra');

interface PincodeRow {
  pincode: string;
  area: string;
  requests: number;
  served: number;
  expired: number;
  liquidity: number | null;
  sampleTooSmall: boolean;
}

interface LiquidityData {
  days: number;
  windowDays: number;
  minSample: number;
  overall: {
    requests: number;
    served: number;
    expired: number;
    liquidity: number | null;
    medianDaysToHandover: number | null;
  } | null;
  byPincode: PincodeRow[];
}

/** Healthy, working, or not yet a market. The thresholds are judgement, not science — but they are consistent. */
function liquidityTone(value: number | null): { label: string; className: string } {
  if (value === null) return { label: 'Not enough data', className: 'text-[var(--text-secondary)]' };
  if (value >= 50) return { label: 'Healthy', className: 'text-green-600' };
  if (value >= 25) return { label: 'Forming', className: 'text-amber-600' };
  return { label: 'Too thin', className: 'text-red-600' };
}

export default function LiquidityPanel({ adminEmail }: { adminEmail?: string }) {
  const [data, setData] = useState<LiquidityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adminEmail) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `${API_URL}?action=getLiquidityMetrics&adminEmail=${encodeURIComponent(adminEmail)}&days=90`
        );
        const payload = await res.json();
        if (cancelled) return;
        if (payload?.success) setData(payload as LiquidityData);
        else setError(payload?.message || 'Could not load liquidity.');
      } catch {
        if (!cancelled) setError('Could not load liquidity.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [adminEmail]);

  if (!adminEmail) return null;

  if (loading) {
    return (
      <div className="classic-card bg-[var(--bg-surface)] p-6 border border-brand-border/60">
        <p className="text-xs text-[var(--text-secondary)] italic">Measuring liquidity…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="classic-card bg-[var(--bg-surface)] p-6 border border-brand-border/60 space-y-2">
        <span className="text-2xs font-bold text-brand-gold-text uppercase tracking-widest">Liquidity by area</span>
        <p className="text-xs text-[var(--text-secondary)]">{error || 'No data yet.'}</p>
      </div>
    );
  }

  const overall = data.overall;
  const tone = liquidityTone(overall?.liquidity ?? null);

  return (
    <div className="classic-card bg-[var(--bg-surface)] p-6 border border-brand-border/60 space-y-6">
      <div className="space-y-1">
        <span className="text-2xs font-bold text-brand-gold-text uppercase tracking-widest">Liquidity by area</span>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Share of requests that reached handover within {data.windowDays} days, over the last {data.days} days.
          Requests younger than {data.windowDays} days are excluded — they have not had their chance yet.
        </p>
      </div>

      {overall && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <span className="text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest block">Overall</span>
            <span className={`text-3xl font-serif font-bold tabular-nums ${tone.className}`}>
              {overall.liquidity === null ? '—' : `${overall.liquidity}%`}
            </span>
            <span className={`text-2xs font-bold uppercase tracking-widest block ${tone.className}`}>{tone.label}</span>
          </div>
          <div className="space-y-1">
            <span className="text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest block">Requests judged</span>
            <span className="text-3xl font-serif font-bold text-[var(--text-primary)] tabular-nums">{overall.requests}</span>
          </div>
          <div className="space-y-1">
            <span className="text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest block">Went unanswered</span>
            <span className="text-3xl font-serif font-bold text-[var(--text-primary)] tabular-nums">{overall.expired}</span>
          </div>
          <div className="space-y-1">
            <span className="text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest block">Typical handover</span>
            <span className="text-3xl font-serif font-bold text-[var(--text-primary)] tabular-nums">
              {overall.medianDaysToHandover === null ? '—' : `${overall.medianDaysToHandover}d`}
            </span>
          </div>
        </div>
      )}

      {data.byPincode.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)] italic">
          No requests are old enough to judge yet. This fills in as swaps mature.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[440px]">
            <thead>
              <tr className="border-b border-brand-border/60">
                <th className="py-2 pr-4 text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">Area</th>
                <th className="py-2 pr-4 text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">Liquidity</th>
                <th className="py-2 pr-4 text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">Requests</th>
                <th className="py-2 pr-4 text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">Handed over</th>
                <th className="py-2 text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">Unanswered</th>
              </tr>
            </thead>
            <tbody>
              {data.byPincode.map((row) => {
                const rowTone = liquidityTone(row.liquidity);
                return (
                  <tr key={row.pincode} className="border-b border-brand-border/30">
                    <td className="py-2 pr-4 text-[var(--text-primary)]">
                      {row.pincode}
                      {row.area && row.area !== row.pincode && (
                        <span className="text-[var(--text-secondary)]"> · {row.area}</span>
                      )}
                    </td>
                    <td className={`py-2 pr-4 font-bold tabular-nums ${rowTone.className}`}>
                      {row.liquidity === null ? `under ${data.minSample}` : `${row.liquidity}%`}
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)] tabular-nums">{row.requests}</td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)] tabular-nums">{row.served}</td>
                    <td className="py-2 text-[var(--text-secondary)] tabular-nums">{row.expired}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic border-t border-brand-border/40 pt-4">
        Aim acquisition at the areas already forming rather than at new cities. A pincode that reaches
        healthy liquidity is a repeatable playbook; one that never does is a lesson, not a market.
      </p>
    </div>
  );
}
