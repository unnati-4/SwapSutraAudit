import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';

/**
 * A sale through SwapSutra (Oct 2026).
 *
 *   Buyer   pays SwapSutra the owner's price + ₹10 (the exchange's QR), gets
 *           the book, records the receiving video, confirms receipt — then
 *           closes the purchase here when they are happy. Afterwards they are
 *           invited (optionally) to leave a Google review.
 *   Seller  gives the UPI ID (and QR) to be paid on, and is paid the price
 *           minus their ₹10 platform fee once the buyer closes.
 *
 * Not happy? The buyer reports a problem (below in this tab) instead; the
 * payout waits for SwapSutra's decision from the videos.
 */
const API_URL = apiUrl('/api/swapsutra');

interface SaleStatus {
  applies: boolean;
  you?: 'buyer' | 'seller' | 'admin';
  escrow?: boolean;
  price?: number;
  buyerPays?: number;
  sellerReceives?: number;
  sellerFee?: number;
  received?: boolean;
  closed?: boolean;
  payoutStatus?: string;
  paidAt?: string;
  disputeOpen?: boolean;
  reviewUrl?: string;
  payoutAccount?: { upiId: string; payeeName: string; qrUrl: string } | null;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('read')); r.readAsDataURL(f); });
}

export function GoogleReviewCard({ url }: { url: string }) {
  return (
    <div className="rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-4 space-y-2" data-testid="google-review-card">
      <p className="text-sm font-semibold text-[var(--text-primary)]">Enjoyed SwapSutra?</p>
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        A short Google review helps other readers find us. It&rsquo;s completely optional — thank you either way.
      </p>
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-brand-brown px-4 py-2 text-2xs font-bold uppercase tracking-widest text-white">
        ★ Leave a Google review
      </a>
    </div>
  );
}

export default function SalePanel({ swapId, archived }: { swapId: string; archived?: boolean }) {
  const [st, setSt] = useState<SaleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [happy, setHappy] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [qr, setQr] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);
  const [justClosed, setJustClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await post({ action: 'getSaleStatus', swapId });
      if (d?.success) {
        setSt(d);
        if (d.payoutAccount) { setUpiId(d.payoutAccount.upiId); setPayeeName(d.payoutAccount.payeeName); }
      }
    } catch { /* the panel simply doesn't show */ }
  }, [swapId]);
  useEffect(() => { load(); }, [load]);

  if (!st || !st.applies) return null;
  if (!st.escrow) {
    return (
      <section className="p-4 rounded-2xl border border-brand-border/60 bg-[var(--bg-page)]">
        <p className="text-xs text-[var(--text-secondary)]">This sale was agreed before payments went through SwapSutra, so the price is settled directly between you.</p>
      </section>
    );
  }

  const saveAccount = async () => {
    setBusy(true); setMsg('');
    try {
      const fileData = qr ? await fileToDataUrl(qr) : undefined;
      const d = await post({ action: 'savePayoutAccount', upiId: upiId.trim(), payeeName: payeeName.trim(), fileData });
      setMsg(d.message || (d.success ? 'Saved.' : 'Could not save.'));
      if (d.success) { setEditing(false); setQr(null); await load(); }
    } catch { setMsg('Could not save. Check your connection.'); } finally { setBusy(false); }
  };

  const closePurchase = async () => {
    setBusy(true); setMsg('');
    try {
      const d = await post({ action: 'confirmSaleComplete', swapId, happy: true });
      setMsg(d.message || '');
      if (d.success) { setJustClosed(true); await load(); }
    } catch { setMsg('Could not close the purchase. Check your connection.'); } finally { setBusy(false); }
  };

  const money = (n?: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const paid = st.payoutStatus === 'PAID_TO_OWNER';

  return (
    <section className="p-4 rounded-2xl border border-brand-border/60 bg-[var(--bg-page)] space-y-3" aria-labelledby="sale-title" data-testid="sale-panel">
      <p id="sale-title" className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Payment for this sale</p>

      {st.you === 'buyer' && (
        <>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            You paid SwapSutra <strong className="text-[var(--text-primary)]">{money(st.buyerPays)}</strong> ({money(st.price)} book + {money((st.buyerPays || 0) - (st.price || 0))} platform fee).
            SwapSutra holds the book&rsquo;s price and pays the seller only after you have the book and close the purchase.
          </p>
          {st.closed ? (
            <>
              <p className="text-sm text-emerald-700 font-semibold">✓ Purchase closed — the seller is {paid ? 'paid' : 'being paid'}.</p>
              <GoogleReviewCard url={st.reviewUrl || ''} />
            </>
          ) : st.disputeOpen ? (
            <p className="text-xs text-amber-700">A problem you reported is being reviewed. SwapSutra will decide from the videos; the seller isn&rsquo;t paid meanwhile.</p>
          ) : !st.received ? (
            <p className="text-xs text-[var(--text-secondary)]">When the book arrives, record the receiving video and confirm receipt above. Then you can close the purchase here.</p>
          ) : !archived && (
            <div className="space-y-2 rounded-xl bg-[var(--bg-surface)] p-3">
              <label className="flex items-start gap-2 text-xs text-[var(--text-primary)] cursor-pointer">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-gold" checked={happy} onChange={(e) => setHappy(e.target.checked)} />
                <span>I have the book, it matches its listing and videos, and I&rsquo;m happy with it. Release the payment to the seller.</span>
              </label>
              <button type="button" disabled={!happy || busy} onClick={closePurchase}
                className="w-full rounded-xl bg-brand-brown py-3 text-2xs font-bold uppercase tracking-widest text-white disabled:opacity-50">
                {busy ? 'Closing…' : 'Close the purchase'}
              </button>
              <p className="text-2xs text-[var(--text-secondary)]">Not happy? Don&rsquo;t close — report a problem below instead, and SwapSutra will review the videos.</p>
            </div>
          )}
          {justClosed && !st.closed && <GoogleReviewCard url={st.reviewUrl || ''} />}
        </>
      )}

      {st.you === 'seller' && (
        <>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            The buyer pays SwapSutra. You receive <strong className="text-[var(--text-primary)]">{money(st.sellerReceives)}</strong> ({money(st.price)} minus the {money(st.sellerFee)} platform fee)
            {st.closed ? (paid ? ' — paid ✓' : ' — the buyer has closed the purchase; SwapSutra is sending it.') : ' as soon as the buyer has the book and closes the purchase.'}
          </p>
          {st.payoutAccount && !editing ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--bg-surface)] px-3 py-2">
              <span className="text-xs text-[var(--text-primary)]">Paid to <strong>{st.payoutAccount.upiId}</strong> · {st.payoutAccount.payeeName}{st.payoutAccount.qrUrl ? ' · QR added' : ''}</span>
              {!archived && <button type="button" onClick={() => setEditing(true)} className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text underline">Change</button>}
            </div>
          ) : !archived && (
            <div className="space-y-2 rounded-xl bg-[var(--bg-surface)] p-3">
              <p className="text-xs font-semibold text-[var(--text-primary)]">Where should SwapSutra pay you?</p>
              <input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="UPI ID, e.g. name@okaxis" autoComplete="off"
                className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
              <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Name on the account"
                className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
              <label className="block text-2xs text-[var(--text-secondary)]">
                Your UPI QR (optional, helps us pay quickly)
                <input type="file" accept="image/jpeg,image/png,image/webp" className="block mt-1 text-xs" onChange={(e) => setQr(e.currentTarget.files?.[0] || null)} />
              </label>
              <div className="flex gap-2">
                {st.payoutAccount && <button type="button" onClick={() => setEditing(false)} className="flex-1 rounded-lg border border-brand-border py-2 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Cancel</button>}
                <button type="button" disabled={busy || !upiId.trim() || !payeeName.trim()} onClick={saveAccount}
                  className="flex-1 rounded-lg bg-brand-brown py-2 text-2xs font-bold uppercase tracking-widest text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save payout details'}</button>
              </div>
            </div>
          )}
        </>
      )}
      {msg && <p className="text-xs text-[var(--text-secondary)]" role="status">{msg}</p>}
    </section>
  );
}

/** Profile → Settings: where SwapSutra sends any money owed to you (sales, forfeited deposits). */
export function PayoutAccountForm() {
  const [acct, setAcct] = useState<{ upiId: string; payeeName: string; qrUrl: string } | null>(null);
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [qr, setQr] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { (async () => {
    try { const d = await post({ action: 'getPayoutAccount' }); if (d?.success && d.account) { setAcct(d.account); setUpiId(d.account.upiId); setPayeeName(d.account.payeeName); } } catch { /* stays empty */ }
  })(); }, []);
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const fileData = qr ? await fileToDataUrl(qr) : undefined;
      const d = await post({ action: 'savePayoutAccount', upiId: upiId.trim(), payeeName: payeeName.trim(), fileData });
      setMsg(d.message || (d.success ? 'Saved.' : 'Could not save.'));
      if (d.success) { setAcct(d.account); setQr(null); }
    } catch { setMsg('Could not save. Check your connection.'); } finally { setBusy(false); }
  };
  return (
    <section className="classic-card p-6 bg-[var(--bg-surface)] space-y-3 max-w-xl mx-auto" data-testid="payout-account-form">
      <h3 className="font-serif text-xl text-[var(--text-primary)]">Where SwapSutra pays you</h3>
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        Money owed to you — a book you sold, or a deposit awarded to you — is sent to this UPI ID.{acct ? ` Currently: ${acct.upiId}.` : ''}
      </p>
      <input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="UPI ID, e.g. name@okaxis" autoComplete="off" className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
      <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Name on the account" className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
      <label className="block text-2xs text-[var(--text-secondary)]">
        UPI QR (optional){acct?.qrUrl ? ' — one is saved' : ''}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="block mt-1 text-xs" onChange={(e) => setQr(e.currentTarget.files?.[0] || null)} />
      </label>
      <button type="button" disabled={busy || !upiId.trim() || !payeeName.trim()} onClick={save}
        className="rounded-lg bg-brand-brown px-5 py-2 text-2xs font-bold uppercase tracking-widest text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      {msg && <p className="text-xs text-[var(--text-secondary)]" role="status">{msg}</p>}
    </section>
  );
}
