import { useCallback, useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';

/**
 * The rating prompt for a genuinely completed swap (Trust Gap Closure
 * Plan, P0-1). Eligibility is decided server-side by getRatingPromptStatus
 * — the same completed-swap + not-already-rated check rateCounterparty
 * itself enforces — so this component never has to guess from a chat
 * status string whether it is safe to show the form.
 */

const API_URL = apiUrl('/api/swapsutra');

export default function RateCounterparty({ swapId }: { swapId: string }) {
  const [eligible, setEligible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const check = useCallback(async () => {
    if (!swapId) return;
    try {
      const res = await fetch(`${API_URL}?action=getRatingPromptStatus&swapId=${encodeURIComponent(swapId)}`);
      const payload = await res.json();
      if (payload?.success) setEligible(!!payload.eligible);
    } catch {
      // Silent — worst case the prompt just doesn't show.
    } finally {
      setChecked(true);
    }
  }, [swapId]);

  useEffect(() => { check(); }, [check]);

  const submit = useCallback(async () => {
    if (busy || rating < 1) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rateCounterparty', swapId, rating, comment }),
      });
      const payload = await res.json();
      if (payload?.success) {
        setDone(true);
      } else {
        setError(payload?.message || 'That rating could not be submitted.');
      }
    } catch {
      setError('That rating could not be submitted.');
    } finally {
      setBusy(false);
    }
  }, [busy, rating, comment, swapId]);

  if (!checked || (!eligible && !done)) return null;

  if (done) {
    return (
      <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border">
        <p className="text-xs text-green-600 font-bold">Thank you — your rating helps other readers.</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-surface)] p-6 rounded-3xl border border-brand-border space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">Rate the other reader</h4>
      <p className="text-2xs text-[var(--text-secondary)] italic">This exchange is complete — how did it go with them?</p>

      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className={`text-2xl leading-none ${n <= rating ? 'text-brand-gold' : 'text-[var(--text-secondary)]/30'}`}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="A short note (optional)"
        rows={2}
        className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]"
      />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        disabled={busy || rating < 1}
        onClick={submit}
        className="w-full py-3 rounded-xl bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50 transition-colors"
      >
        {busy ? 'Submitting…' : 'Submit Rating'}
      </button>
    </div>
  );
}
