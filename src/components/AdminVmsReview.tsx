import { useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';
import { fetchExchangeVideos, type VmsState } from './ExchangeVideos';

/**
 * Admin: review an exchange's videos and decide each security deposit
 * (Oct 2026). Shown inside a dispute in the dispute console.
 *
 * Each deposit is either refunded to the reader who paid it, or forfeited
 * — in full or in part — to the other reader. A forfeit becomes a payout
 * in "Deposits to pay out" (Admin → Payments); both readers are told.
 */
const API_URL = apiUrl('/api/swapsutra');

const LEG_LABEL: Record<string, string> = {
  outbound: "Owner's book → requester",
  counter: "Requester's book → owner",
  return: "Owner's book coming back",
  counter_return: "Requester's book going back",
};

interface Props {
  swapId: string;
  disputeId: string;
  requesterEmail?: string;
  ownerEmail?: string;
  requesterDeposit?: number;
  ownerDeposit?: number;
}

type Decision = { outcome: 'REFUND' | 'FORFEIT' | ''; amount: string; reason: string };

export default function AdminVmsReview({ swapId, disputeId, requesterEmail, ownerEmail, requesterDeposit = 0, ownerDeposit = 0 }: Props) {
  const [vms, setVms] = useState<VmsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dec, setDec] = useState<Record<'requester' | 'owner', Decision>>({
    requester: { outcome: '', amount: '', reason: '' },
    owner: { outcome: '', amount: '', reason: '' },
  });

  useEffect(() => { (async () => { setVms(await fetchExchangeVideos(swapId)); setLoading(false); })(); }, [swapId]);

  const deposits = ([['requester', requesterDeposit, requesterEmail], ['owner', ownerDeposit, ownerEmail]] as const)
    .filter(([, amt]) => Number(amt) > 0);

  const submit = async () => {
    const decisions = deposits.map(([role]) => ({
      payerRole: role, outcome: dec[role].outcome,
      amount: dec[role].outcome === 'FORFEIT' && dec[role].amount !== '' ? Number(dec[role].amount) : undefined,
      reason: dec[role].reason,
    }));
    if (decisions.some(d => !d.outcome || !d.reason.trim())) { setMsg('Choose refund or forfeit for every deposit, and give each a reason.'); return; }
    setBusy(true); setMsg('');
    try {
      const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adminDecideDeposits', swapId, disputeId, decisions }) });
      const d = await res.json();
      setMsg(d.message || (d.success ? 'Saved.' : 'Could not save.'));
    } catch { setMsg('Network error.'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-brand-border/60 bg-[var(--bg-page)] p-4" data-testid="admin-vms-review">
      <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Exchange videos</p>
      {loading && <p className="text-xs text-[var(--text-secondary)]">Loading videos…</p>}
      {!loading && !vms && <p className="text-xs text-red-700">Videos could not be loaded.</p>}
      {vms && (
        <div className="space-y-3">
          <p className="text-2xs text-[var(--text-secondary)]">Route: {vms.routeMethod || 'not set'} · stamp code <span className="font-mono">{vms.stampCode}</span> (should appear on every in-app video)</p>
          {vms.legs.map(l => (
            <div key={l.leg} className="rounded-xl bg-[var(--bg-surface)] p-3 space-y-1">
              <p className="text-xs font-semibold text-[var(--text-primary)]">{LEG_LABEL[l.leg] || l.leg}</p>
              {l.items.map(it => (
                <p key={it.side + it.kind} className="text-xs text-[var(--text-secondary)]">
                  <span className={it.done ? 'text-emerald-700' : 'text-red-700'}>{it.done ? '✓' : '✗ missing'}</span>{' '}
                  {it.label} ({it.side})
                  {it.videos.map((v, i) => (
                    <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer" className="ml-2 underline text-brand-gold-text">
                      video {i + 1}{v.durationSec ? ` · ${v.durationSec}s` : ''}{v.recordedInApp ? ' · stamped' : ' · phone camera'}
                    </a>
                  ))}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)] pt-2">Decide the deposits</p>
      {deposits.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No security deposit is held on this exchange.</p>}
      {deposits.map(([role, amt, email]) => (
        <div key={role} className="rounded-xl bg-[var(--bg-surface)] p-3 space-y-2">
          <p className="text-xs text-[var(--text-primary)]">₹{amt} paid by the {role} <span className="text-[var(--text-secondary)] break-all">({email})</span></p>
          <div className="flex flex-wrap gap-2">
            {(['REFUND', 'FORFEIT'] as const).map(o => (
              <button key={o} type="button" aria-pressed={dec[role].outcome === o}
                onClick={() => setDec(s => ({ ...s, [role]: { ...s[role], outcome: o } }))}
                className={`rounded-lg border px-3 py-1.5 text-2xs font-bold uppercase tracking-widest ${dec[role].outcome === o ? 'border-brand-gold bg-brand-gold/15 text-brand-gold-text' : 'border-brand-border text-[var(--text-secondary)]'}`}>
                {o === 'REFUND' ? 'Refund to payer' : 'Forfeit to the other reader'}
              </button>
            ))}
          </div>
          {dec[role].outcome === 'FORFEIT' && (
            <input type="number" min={1} max={Number(amt)} value={dec[role].amount}
              onChange={(e) => setDec(s => ({ ...s, [role]: { ...s[role], amount: e.target.value } }))}
              placeholder={`Amount to forfeit (blank = all ₹${amt})`} className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
          )}
          <input value={dec[role].reason} onChange={(e) => setDec(s => ({ ...s, [role]: { ...s[role], reason: e.target.value } }))}
            placeholder="Reason, from the videos — both readers see it" className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
        </div>
      ))}
      {deposits.length > 0 && (
        <button type="button" disabled={busy} onClick={submit}
          className="w-full py-3 rounded-xl bg-brand-brown text-white text-2xs font-bold uppercase tracking-widest disabled:opacity-50">
          {busy ? 'Saving…' : 'Decide deposits & notify both readers'}
        </button>
      )}
      {msg && <p className="text-xs text-[var(--text-secondary)]" role="status">{msg}</p>}
    </div>
  );
}
