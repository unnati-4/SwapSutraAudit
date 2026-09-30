/**
 * My Profile → Settings → Delete account.
 *
 * Deliberately two steps and a typed "DELETE": this cannot be undone, and
 * a reader should know exactly what goes and what the law makes us keep
 * before they press anything. The server (deleteMyAccount in
 * appsscript.js) acts only on the signed-in session's own address and
 * refuses while a book is actually out on a swap.
 */

import { useState } from 'react';

type Blocker = { title: string; status: string };

const REASONS = [
  'I don’t use SwapSutra any more',
  'I couldn’t find books near me',
  'Too hard to use on my phone',
  'Privacy concerns',
  'I’m making a new account',
  'Something else',
];

export default function DeleteAccount({
  apiUrl,
  onDeleted,
}: {
  apiUrl: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [checkError, setCheckError] = useState('');
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const start = async () => {
    setOpen(true);
    setChecking(true);
    setCheckError('');
    try {
      const data = await post({ action: 'getAccountDeletionCheck' });
      if (!data?.success) setCheckError(data?.message || 'Could not check your account. Please try again.');
      else if (data.canDelete === false && !(data.blockers || []).length) setCheckError(data.message || 'This account cannot be deleted here.');
      else setBlockers(Array.isArray(data.blockers) ? data.blockers : []);
    } catch {
      setCheckError('Connection problem. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const confirmDelete = async () => {
    if (typed.trim().toUpperCase() !== 'DELETE' || deleting) return;
    setDeleting(true);
    setError('');
    try {
      const data = await post({ action: 'deleteMyAccount', confirm: 'DELETE', reason });
      if (data?.success) {
        onDeleted();
        return;
      }
      if (Array.isArray(data?.blockers) && data.blockers.length) setBlockers(data.blockers);
      setError(data?.message || 'Your account could not be deleted. Please try again.');
    } catch {
      setError('Connection problem. Your account has not been deleted — please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const cancel = () => { setOpen(false); setTyped(''); setError(''); setBlockers(null); };

  return (
    <section className="classic-card mt-10 border border-red-200 bg-[var(--bg-surface)] p-6 md:p-8 space-y-4" aria-labelledby="delete-account-title">
      <div>
        <p className="text-2xs font-bold uppercase tracking-widest text-red-700">Danger zone</p>
        <h3 id="delete-account-title" className="mt-1 font-serif text-2xl text-[var(--text-primary)]">Delete account</h3>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Permanently delete your SwapSutra account. This cannot be undone.
        </p>
      </div>

      {!open && (
        <button type="button" onClick={start}
          className="rounded-full border border-red-300 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-red-700 hover:bg-red-50">
          Delete my account
        </button>
      )}

      {open && checking && <p className="text-sm text-[var(--text-secondary)]">Checking your account…</p>}

      {open && !checking && checkError && (
        <div className="space-y-3">
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{checkError}</p>
          <button type="button" onClick={cancel} className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Close</button>
        </div>
      )}

      {open && !checking && !checkError && blockers && blockers.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
            <p className="font-semibold">Finish your swaps first</p>
            <p>A book is still out on these swaps. Return it (or get yours back) and mark the swap complete, then come back here:</p>
            <ul className="list-disc pl-5">
              {blockers.map((b, i) => <li key={i}>“{b.title}” — {b.status}</li>)}
            </ul>
          </div>
          <button type="button" onClick={cancel} className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Close</button>
        </div>
      )}

      {open && !checking && !checkError && blockers && blockers.length === 0 && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4 text-sm text-[var(--text-primary)]">
              <p className="mb-2 text-2xs font-bold uppercase tracking-widest text-red-700">Deleted now</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>Your profile, name and contact details</li>
                <li>Your listings (taken off the Library)</li>
                <li>Reading tracker, reading space and badges</li>
                <li>Your Reading Room posts, comments and café stories</li>
                <li>Notifications, newsletter and event alerts</li>
                <li>Any swap requests still waiting for a reply</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-brand-border bg-[var(--bg-page)]/60 p-4 text-sm text-[var(--text-primary)]">
              <p className="mb-2 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Kept, as the law requires</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>Past swap records — 3 years</li>
                <li>Chat and café messages — 1 year, shown as “Former reader”</li>
                <li>Payment records — 8 years (tax law)</li>
              </ul>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">See our Privacy Policy for details. You can sign up again later with the same email, starting fresh.</p>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Why are you leaving? (optional)</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-brand-border bg-[var(--input-bg)] px-4 py-3 text-base sm:text-sm text-[var(--text-primary)]">
              <option value="">Choose a reason…</option>
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm text-[var(--text-primary)]">Type <strong>DELETE</strong> to confirm</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off" autoCapitalize="characters" spellCheck={false}
              aria-label="Type DELETE to confirm"
              className="w-full rounded-xl border border-red-300 bg-[var(--input-bg)] px-4 py-3 text-base tracking-widest text-[var(--text-primary)]"
              placeholder="DELETE"
            />
          </label>

          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={cancel} disabled={deleting}
              className="rounded-full border border-brand-border px-6 py-3 text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">
              Keep my account
            </button>
            <button type="button" onClick={confirmDelete}
              disabled={typed.trim().toUpperCase() !== 'DELETE' || deleting}
              className="rounded-full bg-red-700 px-6 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-sm disabled:opacity-40">
              {deleting ? 'Deleting…' : 'Delete my account forever'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
