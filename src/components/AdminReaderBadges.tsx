/**
 * Admin: hand out community badges after a meetup.
 *
 * The flow this is built around, in the owner's words: at a meetup one
 * reader becomes "Doctor of the Month" and everyone who came becomes a
 * "Patient", and those show on their profiles until the next meetup, when
 * the admin hands out the new ones. So the screen does three things fast:
 *
 *   1. Award one badge to several readers at once (paste the attendee
 *      emails, one per line) — the "Patient" case.
 *   2. Optionally set when it expires, or leave it until removed.
 *   3. See who holds what, and take badges back — the "next meetup" case.
 *
 * Everything is checked again server-side (awardReaderBadge etc. in
 * appsscript.js refuse anyone who is not a signed-in admin). The rows live
 * in the ReaderBadges sheet, which can also be edited by hand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../config/runtime';

const API_URL = apiUrl('/api/swapsutra');

interface BadgeRow {
  row: number;
  email: string;
  label: string;
  note: string;
  awardedAt: string;
  expiresAt: string;
  awardedBy: string;
  expired: boolean;
}

// Quick picks for the badges the owner described. Free text still works.
const SUGGESTED = ['Doctor of the Month', 'Patient', 'Top Swapper', 'Meetup Host', 'Bookworm of the Month'];

const call = async (action: string, body: Record<string, unknown> = {}) => {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  return res.json();
};

const fmt = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function AdminReaderBadges() {
  const [rows, setRows] = useState<BadgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [label, setLabel] = useState('');
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  // Post one recognition in the Reading Room for this award (one post for
  // everyone in the batch, not one per reader).
  const [announce, setAnnounce] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await call('listReaderBadges');
      if (data.success) { setRows(data.badges || []); setError(''); }
      else setError(data.message || 'Could not load badges.');
    } catch {
      setError('Network error loading badges.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // One email per line, or separated by commas/spaces — whatever got pasted
  // out of the meetup's WhatsApp group.
  const emailList = useMemo(() => Array.from(new Set(
    emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /\S+@\S+\.\S+/.test(e))
  )), [emails]);

  const award = async () => {
    if (!label.trim() || emailList.length === 0) return;
    setSaving(true); setError(''); setNotice('');
    const failed: string[] = [];
    const awarded: string[] = [];
    let ok = 0;
    // Sequential, not parallel: every award appends a row to the same
    // sheet, and one clear failure message beats a race.
    for (const email of emailList) {
      try {
        const data = await call('awardReaderBadge', {
          email, label: label.trim(), note: note.trim(),
          expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : '',
        });
        if (data.success) { ok += 1; awarded.push(email); }
        else failed.push(`${email} — ${data.message || 'refused'}`);
      } catch {
        failed.push(`${email} — network error`);
      }
    }
    let announced = false;
    if (announce && awarded.length) {
      try {
        const data = await call('announceBadgeRecognition', { label: label.trim(), emails: awarded, note: note.trim() });
        announced = Boolean(data?.success);
        if (!announced) failed.push(`Reading Room post — ${data?.message || 'not posted'}`);
      } catch {
        failed.push('Reading Room post — network error');
      }
    }
    setSaving(false);
    if (ok) setNotice(`Awarded "${label.trim()}" to ${ok} reader${ok === 1 ? '' : 's'}.${announced ? ' Announced in the Reading Room.' : ''}`);
    if (failed.length) setError(`Not awarded:\n${failed.join('\n')}`);
    if (ok) { setEmails(''); setNote(''); }
    void load();
  };

  const revoke = async (r: BadgeRow) => {
    if (!window.confirm(`Remove "${r.label}" from ${r.email}?`)) return;
    try {
      const data = await call('revokeReaderBadge', { email: r.email, label: r.label });
      if (!data.success) setError(data.message || 'Could not remove that badge.');
      else setNotice(`Removed "${r.label}" from ${r.email}.`);
    } catch {
      setError('Network error removing the badge.');
    }
    void load();
  };

  // "Next meetup" in one click: clear every live holder of one badge.
  const revokeAllOf = async (badgeLabel: string) => {
    const holders = rows.filter((r) => r.label === badgeLabel && !r.expired);
    if (!holders.length) return;
    if (!window.confirm(`Remove "${badgeLabel}" from all ${holders.length} readers who hold it?`)) return;
    for (const r of holders) {
      try { await call('revokeReaderBadge', { email: r.email, label: r.label }); } catch { /* reported below */ }
    }
    setNotice(`Cleared "${badgeLabel}" from ${holders.length} reader${holders.length === 1 ? '' : 's'}.`);
    void load();
  };

  const visible = rows.filter((r) => showExpired || !r.expired);
  const byLabel = useMemo(() => {
    const m = new Map<string, BadgeRow[]>();
    visible.forEach((r) => { m.set(r.label, [...(m.get(r.label) || []), r]); });
    return Array.from(m.entries());
  }, [visible]);

  const input = 'w-full rounded-xl border border-brand-border bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-primary)]';
  const kicker = 'text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]';

  return (
    <div className="space-y-8">
      <section className="classic-card bg-[var(--bg-surface)] p-6 md:p-8 border border-brand-border space-y-5">
        <div>
          <p className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text">Community badges</p>
          <h3 className="mt-1 font-serif text-2xl text-[var(--text-primary)]">Award a badge</h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">Shows on each reader's profile until it expires or you remove it.</p>
        </div>

        <div className="space-y-2">
          <label className={kicker} htmlFor="badge-label">Badge</label>
          <input id="badge-label" className={input} value={label} maxLength={60}
            onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Doctor of the Month" />
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTED.map((s) => (
              <button key={s} type="button" onClick={() => setLabel(s)}
                className={`rounded-full border px-3 py-1.5 text-2xs font-bold uppercase tracking-wider transition-colors ${
                  label === s ? 'border-brand-gold bg-brand-gold text-white' : 'border-brand-border text-[var(--text-secondary)] hover:border-brand-gold'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className={kicker} htmlFor="badge-emails">Reader emails — one per line, or paste a list</label>
          <textarea id="badge-emails" className={`${input} min-h-[110px] font-mono text-xs`} value={emails}
            onChange={(e) => setEmails(e.target.value)} placeholder={'reader1@gmail.com\nreader2@gmail.com'} />
          <p className="text-xs text-[var(--text-secondary)]">
            {emailList.length ? `${emailList.length} reader${emailList.length === 1 ? '' : 's'} will get this badge.` : 'No valid emails yet.'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className={kicker} htmlFor="badge-expiry">Until (optional)</label>
            <input id="badge-expiry" type="date" className={input} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            <p className="text-xs text-[var(--text-secondary)]">Set it to the next meetup's date, or leave blank and remove it by hand.</p>
          </div>
          <div className="space-y-2">
            <label className={kicker} htmlFor="badge-note">Note (optional)</label>
            <input id="badge-note" className={input} value={note} maxLength={140}
              onChange={(e) => setNote(e.target.value)} placeholder="September meetup, Saharanpur" />
          </div>
        </div>

        <label className="flex items-start gap-2.5 text-sm text-[var(--text-primary)]">
          <input type="checkbox" className="mt-1" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
          <span>
            Also announce it in the Reading Room
            <span className="block text-xs text-[var(--text-secondary)]">One recognition post naming everyone who got it. The note above is used as the message.</span>
          </span>
        </label>

        <button type="button" onClick={award} disabled={saving || !label.trim() || !emailList.length}
          className="btn-primary w-full sm:w-auto px-8 py-3.5 disabled:opacity-50">
          {saving ? 'Awarding…' : `Award to ${emailList.length || 0} reader${emailList.length === 1 ? '' : 's'}`}
        </button>

        {notice && <p className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
        {error && <p className="whitespace-pre-line rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">{error}</p>}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-serif text-2xl text-[var(--text-primary)]">Who holds what</h3>
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
            Show expired
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
        ) : byLabel.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] italic">No badges awarded yet.</p>
        ) : byLabel.map(([badgeLabel, holders]) => (
          <div key={badgeLabel} className="classic-card bg-[var(--bg-surface)] p-5 border border-brand-border space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-serif text-lg text-[var(--text-primary)]">🏅 {badgeLabel} <span className="text-sm text-[var(--text-secondary)]">· {holders.length}</span></p>
              <button type="button" onClick={() => revokeAllOf(badgeLabel)}
                className="rounded-full border border-red-200 px-3 py-1.5 text-2xs font-bold uppercase tracking-wider text-red-700 hover:bg-red-50">
                Remove from everyone
              </button>
            </div>
            <ul className="divide-y divide-brand-border/40">
              {holders.map((r) => (
                <li key={`${r.row}:${r.email}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text-primary)] break-all">{r.email}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Since {fmt(r.awardedAt)}
                      {r.expiresAt ? ` · until ${fmt(r.expiresAt)}` : ' · until removed'}
                      {r.expired ? ' · expired' : ''}
                      {r.note ? ` · ${r.note}` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => revoke(r)}
                    className="text-2xs font-bold uppercase tracking-wider text-red-700 underline underline-offset-4">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
