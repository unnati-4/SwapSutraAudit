import React, { useCallback, useEffect, useState } from 'react';
import {apiUrl} from '../config/runtime';

/**
 * "Report a Problem" — the user-facing half of the backend's
 * disputeSwapRequest/getSwapDisputes actions, which already existed but
 * had no frontend call site (see the Trust Gap Closure Plan, P0-2).
 * This component does not implement any dispute logic itself: it collects
 * a category, an optional note, and up to 3 evidence photos, then hands
 * them to the existing disputeSwapRequest action exactly as
 * uploadSwapProof already handles file uploads elsewhere in this app.
 */

const API_URL = apiUrl('/api/swapsutra');

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'NOT_RECEIVED', label: 'Book not received' },
  { value: 'NOT_RETURNED', label: 'Book not returned' },
  { value: 'DAMAGED', label: 'Book returned damaged' },
  { value: 'CONDITION_MISMATCH', label: 'Condition did not match the listing' },
  { value: 'WRONG_BOOK', label: 'Wrong book received' },
  { value: 'OTHER', label: 'Other issue' },
];

interface DisputeSummary {
  id: string;
  category: string;
  categoryLabel: string;
  reason: string;
  details: string;
  status: string;
  resolutionStatus: string;
  resolutionNote: string;
  depositOutcome: string;
  evidenceCount: number;
  reportedByMe: boolean;
  createdAt: string;
  resolvedAt: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function statusTone(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'resolved') return 'text-green-600';
  if (s === 'rejected') return 'text-[var(--text-secondary)]';
  if (s === 'under review') return 'text-amber-600';
  return 'text-red-600'; // Open
}

export default function DisputeReport({ swapId }: { swapId: string }) {
  const [disputes, setDisputes] = useState<DisputeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('OTHER');
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!swapId) return;
    try {
      const res = await fetch(`${API_URL}?action=getSwapDisputes&swapId=${encodeURIComponent(swapId)}`);
      const payload = await res.json();
      if (payload?.success) setDisputes(payload.disputes || []);
    } catch {
      // Silent — this panel degrades to "no dispute shown", which is safe.
    } finally {
      setLoading(false);
    }
  }, [swapId]);

  useEffect(() => { load(); }, [load]);

  const hasOpenDisputeOfMine = disputes.some(d => d.reportedByMe && d.status !== 'Closed');

  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []).slice(0, 3);
    setFiles(list);
  };

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const evidenceFiles = await Promise.all(
        files.map(async f => ({ fileData: await fileToBase64(f), fileName: f.name }))
      );
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'disputeSwapRequest',
          swapId,
          category,
          reason: CATEGORIES.find(c => c.value === category)?.label || 'Issue reported',
          details,
          evidenceFiles,
        }),
      });
      const payload = await res.json();
      if (payload?.success) {
        setOpen(false);
        setDetails('');
        setFiles([]);
        setCategory('OTHER');
        await load();
      } else {
        setError(payload?.message || 'That could not be submitted. Please try again.');
      }
    } catch {
      setError('That could not be submitted. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, files, category, details, swapId, load]);

  if (loading) return null;

  return (
    <div className="bg-[var(--bg-surface)] p-4 sm:p-6 rounded-3xl border border-brand-border space-y-4 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h4 className="min-w-0 text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">If something goes wrong</h4>
        {!hasOpenDisputeOfMine && (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="shrink-0 whitespace-nowrap px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-2xs font-bold uppercase tracking-wider text-red-700 hover:bg-red-100 transition-colors"
          >
            {open ? 'Cancel' : 'Report a Problem'}
          </button>
        )}
      </div>

      {disputes.length > 0 && (
        <ul className="space-y-2">
          {disputes.map(d => (
            <li key={d.id} className="p-3 rounded-xl bg-[var(--bg-page)] border border-brand-border/50 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--text-primary)]">{d.categoryLabel}</span>
                <span className={`text-2xs font-bold uppercase tracking-widest ${statusTone(d.resolutionStatus || d.status)}`}>
                  {d.resolutionStatus || d.status}
                </span>
              </div>
              {d.reportedByMe && <p className="text-2xs text-[var(--text-secondary)] italic">Reported by you</p>}
              {d.resolutionNote && (
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  SwapSutra's note: {d.resolutionNote}
                </p>
              )}
              {d.evidenceCount > 0 && (
                <p className="text-2xs text-[var(--text-secondary)]">{d.evidenceCount} piece{d.evidenceCount === 1 ? '' : 's'} of evidence attached</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="space-y-3 pt-3 border-t border-brand-border/40">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]"
          >
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="What happened? (optional, but helps us review this faster)"
            rows={3}
            className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]"
          />
          <div>
            <label className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] block mb-1">
              Evidence photos (up to 3)
            </label>
            <input type="file" accept="image/*" multiple onChange={onFilesSelected}
              className="block w-full min-w-0 max-w-full text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-lg file:border-0 file:bg-brand-gold/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-gold-text" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="w-full py-3 rounded-xl bg-red-700 text-white text-2xs font-bold uppercase tracking-widest hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Submitting…' : 'Submit Report'}
          </button>
          <p className="text-2xs text-[var(--text-secondary)] italic leading-relaxed">
            SwapSutra will review this using the condition proof, journey and messages already on record for this exchange.
          </p>
        </div>
      )}
    </div>
  );
}
