import { useCallback, useEffect, useState } from 'react';
import { track } from '../services/analytics';
import {apiUrl} from '../config/runtime';

/**
 * "Invite a reader" — the loop SwapSutra was shaped for and did not have.
 *
 * The reward is deliberately not paid at signup. The backend records an
 * invite as Pending and only pays out — 30 days to each side — once the
 * invited reader lists their first book. Rewarding a signup buys empty
 * accounts; rewarding a first listing buys shelves, which is the thing
 * a hyperlocal marketplace is actually short of.
 *
 * WhatsApp is the share target that matters here, so it is the primary
 * button rather than one option in a row of icons: this is how a book
 * community in India actually spreads.
 */

const API_URL = apiUrl('/api/swapsutra');

interface ReferralState {
  code: string;
  link: string;
  rewardDays: number;
  invited: number;
  joined: number;
  daysEarned: number;
  readers: Array<{ name: string; joinedAt?: string }>;
}

export default function InviteReaders({ activeUserEmail }: { activeUserEmail?: string }) {
  const [state, setState] = useState<ReferralState | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!activeUserEmail) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getMyReferral', email: activeUserEmail }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.success) setState(data as ReferralState);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeUserEmail]);

  const shareMessage = state
    ? `I've been swapping books with readers near me on SwapSutra. Join with my invite and we both get ${state.rewardDays} extra days: ${state.link}`
    : '';

  const shareOnWhatsApp = useCallback(() => {
    if (!state) return;
    track('referral_link_shared', { channel: 'whatsapp' });
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`, '_blank', 'noopener,noreferrer');
  }, [state, shareMessage]);

  const copyLink = useCallback(async () => {
    if (!state) return;
    track('referral_link_shared', { channel: 'copy' });
    try {
      await navigator.clipboard.writeText(state.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard is blocked in some in-app browsers. Selecting the text
      // is the fallback, so the link is rendered as real, selectable text
      // rather than hidden behind the button.
      setCopied(false);
    }
  }, [state]);

  if (!activeUserEmail) return null;

  if (loading) {
    return (
      <div className="classic-card bg-[var(--bg-surface)] p-6 border border-brand-border/60">
        <p className="text-xs text-[var(--text-secondary)] italic">Preparing your invite link…</p>
      </div>
    );
  }

  if (failed || !state) {
    return (
      <div className="classic-card bg-[var(--bg-surface)] p-6 border border-brand-border/60 space-y-2">
        <span className="text-2xs font-bold text-brand-gold-text uppercase tracking-widest">Invite a reader</span>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          We couldn't load your invite link just now. Reopening this page usually fixes it.
        </p>
      </div>
    );
  }

  return (
    <div className="classic-card bg-gradient-to-br from-brand-gold/10 to-transparent p-6 border border-brand-gold/20 space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-bold text-brand-gold-text uppercase tracking-widest">Invite a reader</span>
        <span className="text-2xs font-bold text-brand-gold-text uppercase tracking-widest tabular-nums">
          {state.joined} joined
        </span>
      </div>

      <p className="text-sm text-[var(--text-primary)] font-serif leading-relaxed">
        A shelf is only as good as the readers around it. Invite someone who reads —
        when they list their first book, <strong>you both get {state.rewardDays} extra days</strong>.
      </p>

      <div className="space-y-2">
        <label className="text-2xs font-bold text-[var(--text-secondary)] uppercase tracking-widest" htmlFor="referral-link">
          Your invite link
        </label>
        <input
          id="referral-link"
          readOnly
          value={state.link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full bg-[var(--bg-page)] border border-brand-border/60 rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] font-mono"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={shareOnWhatsApp}
          className="flex-1 min-w-[150px] px-4 py-3 rounded-lg bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
        >
          Share on WhatsApp
        </button>
        <button
          type="button"
          onClick={copyLink}
          className="px-4 py-3 rounded-lg border border-brand-border/60 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 border-t border-brand-border/40">
        <span className="text-2xs text-[var(--text-secondary)] tabular-nums">
          <strong className="text-[var(--text-primary)]">{state.invited}</strong> invited
        </span>
        <span className="text-2xs text-[var(--text-secondary)] tabular-nums">
          <strong className="text-[var(--text-primary)]">{state.daysEarned}</strong> days earned
        </span>
      </div>

      {/* A response that omits `readers` entirely used to take the whole
          profile page down with "Cannot read properties of undefined". The
          field is optional in practice — an older backend version, a partial
          payload, a referral record with nothing in it yet — and a missing
          list of names is never a reason to show a reader a blank screen. */}
      {(state.readers || []).length > 0 && (
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic">
          Readers you brought: {(state.readers || []).map(r => r.name).filter(Boolean).join(', ')}.
        </p>
      )}
    </div>
  );
}
