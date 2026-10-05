import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { apiUrl } from '../config/runtime';

/**
 * Shown when a reader reaches their free listing limit (20 books).
 * Two ways past it, both permanent:
 *   • pay ₹20 once by UPI QR — SwapSutra verifies the UTR, then it's unlimited
 *   • enter a coupon code (BOOKSTORE2627) — unlimited immediately
 *
 * The server decides everything: the limit, the fee, whether a code is
 * valid. This component only shows what getListingAllowance returns.
 */

const API_URL = apiUrl('/api/swapsutra');

export interface ListingAllowance {
  used: number;
  limit: number | null;
  unlimited: boolean;
  unlockedVia: string;
  remaining: number | null;
  canList: boolean;
  unlockFee: number;
  pendingUnlock: { id: string; submittedAt: string; utr: string } | null;
  lastRejection: { reason: string; at: string } | null;
}

export async function fetchListingAllowance(): Promise<ListingAllowance | null> {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getListingAllowance' }),
    });
    const data = await res.json();
    return data.success ? (data.allowance as ListingAllowance) : null;
  } catch {
    return null;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 3 * 1024 * 1024;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the new allowance once listing is unlimited (coupon) or a payment is submitted. */
  onChange?: (allowance: ListingAllowance) => void;
}

export default function ListingUnlockPanel({ open, onClose, onChange }: Props) {
  const [allowance, setAllowance] = useState<ListingAllowance | null>(null);
  const [upi, setUpi] = useState<{ vpa: string; payee: string } | null>(null);
  const [mode, setMode] = useState<'pay' | 'code'>('pay');
  const [code, setCode] = useState('');
  const [utr, setUtr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(''); setDone(''); setCode(''); setUtr(''); setFile(null);
    (async () => {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getListingAllowance' }),
        });
        const data = await res.json();
        if (data.success) { setAllowance(data.allowance); setUpi(data.upi); }
        else setError(data.message || 'Could not load your listing allowance.');
      } catch {
        setError('Unable to connect. Check your connection and try again.');
      }
    })();
  }, [open]);

  if (!open) return null;

  const fee = allowance?.unlockFee ?? 20;
  const upiString = upi
    ? `upi://pay?pa=${upi.vpa}&pn=${encodeURIComponent(upi.payee)}&am=${fee}&cu=INR&tn=SwapSutra%20Listing%20Unlock`
    : '';

  const finish = (next: ListingAllowance, message: string) => {
    setAllowance(next);
    setDone(message);
    onChange?.(next);
  };

  const redeem = async () => {
    if (!code.trim()) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeemListingUnlockCoupon', code: code.trim() }),
      });
      const data = await res.json();
      if (data.success) finish(data.allowance, data.message || 'Coupon applied.');
      else setError(data.message || "That code isn't valid.");
    } catch {
      setError('Unable to connect. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (f: File | undefined) => {
    setError('');
    if (!f) { setFile(null); return; }
    if (!ALLOWED_TYPES.includes(f.type)) { setError('Upload a JPG, PNG or WebP screenshot.'); return; }
    if (f.size > MAX_SIZE) { setError('Upload a screenshot under 3 MB.'); return; }
    setFile(f);
  };

  const submitPayment = async () => {
    if (!utr.trim()) { setError('Enter the UTR / transaction reference from your UPI app.'); return; }
    if (!file) { setError('Attach a screenshot of the payment.'); return; }
    setBusy(true); setError('');
    try {
      const fileData = await fileToBase64(file);
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submitListingUnlockPayment', utr: utr.trim(), fileData, fileName: file.name }),
      });
      const data = await res.json();
      if (data.success) finish(data.allowance, data.message || 'Payment submitted.');
      else setError(data.message || 'Could not submit the payment.');
    } catch {
      setError('Unable to connect. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const pending = allowance?.pendingUnlock;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
      <div className="absolute inset-0 bg-brand-brown/40 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-[var(--bg-surface)] max-w-md w-full rounded-3xl shadow-editorial p-6 sm:p-10 max-h-[90vh] overflow-y-auto border border-brand-border">
        <button onClick={onClose} aria-label="Close" className="absolute top-5 right-5 text-[var(--text-secondary)] hover:text-brand-gold-text text-xl leading-none">×</button>

        <h3 id="unlock-title" className="font-serif text-3xl text-[var(--text-primary)] tracking-tight mb-2">
          {allowance?.unlimited ? 'Your shelf has no limit' : 'Room for more books'}
        </h3>

        {!allowance && !error && <p className="text-sm text-[var(--text-secondary)]">Checking your shelf…</p>}

        {allowance && allowance.unlimited && (
          <div className="space-y-6">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{done || 'You can list as many books as you like.'}</p>
            <button onClick={onClose} className="btn-primary w-full !py-4">Add a book</button>
          </div>
        )}

        {allowance && !allowance.unlimited && pending && (
          <div className="space-y-6">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {done || `Your ₹${fee} payment (UTR ${pending.utr}) is being verified. Once it's approved you can list as many books as you like — we'll notify you.`}
            </p>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Have a coupon code? You can use it now instead of waiting.
            </p>
            <CodeForm code={code} setCode={setCode} busy={busy} onSubmit={redeem} />
            {error && <ErrorLine text={error} />}
          </div>
        )}

        {allowance && !allowance.unlimited && !pending && (
          <>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
              You've listed {allowance.used} of {allowance.limit} free books. Pay ₹{fee} once to list as many as you like — it never expires.
            </p>

            {allowance.lastRejection && (
              <p className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 leading-relaxed">
                Your last payment couldn't be verified{allowance.lastRejection.reason ? `: ${allowance.lastRejection.reason}` : '.'} Please pay again below.
              </p>
            )}

            <div className="flex rounded-full border border-brand-border p-1 mb-6" role="tablist">
              {(['pay', 'code'] as const).map(m => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(''); }}
                  className={`flex-1 rounded-full py-2 text-sm transition-colors ${mode === m
                    ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)] font-semibold shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  {m === 'pay' ? `Pay ₹${fee}` : 'I have a code'}
                </button>
              ))}
            </div>

            {mode === 'pay' ? (
              <div className="space-y-5">
                {upi && (
                  <div className="flex flex-col items-center gap-2 rounded-2xl bg-[var(--bg-page)] p-5">
                    <a href={upiString} title="Open in your UPI app" className="block bg-white rounded-xl p-2">
                      <QRCodeCanvas value={upiString} size={176} level="H" />
                    </a>
                    <p className="font-serif text-3xl text-[var(--text-primary)] tabular-nums">₹{fee}</p>
                    <p className="text-xs text-[var(--text-secondary)] text-center leading-relaxed">
                      Scan with any UPI app, or tap the code on your phone. Don't change the amount.
                    </p>
                  </div>
                )}
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">UTR / transaction reference</span>
                  <input value={utr} onChange={e => setUtr(e.target.value)} placeholder="e.g. 427812345678" className="input-classic w-full bg-[var(--input-bg)]" inputMode="text" autoComplete="off" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">Payment screenshot</span>
                  <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={e => pickFile(e.currentTarget.files?.[0])} className="block w-full text-xs text-[var(--text-secondary)]" />
                </label>
                {error && <ErrorLine text={error} />}
                <button onClick={submitPayment} disabled={busy} className="btn-primary w-full !py-4 disabled:opacity-50">
                  {busy ? 'Submitting…' : 'Submit payment'}
                </button>
                <p className="text-xs text-[var(--text-secondary)] text-center leading-relaxed">
                  SwapSutra checks every payment by hand, usually within a day. We never ask for your UPI PIN.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <CodeForm code={code} setCode={setCode} busy={busy} onSubmit={redeem} />
                {error && <ErrorLine text={error} />}
              </div>
            )}
          </>
        )}

        {!allowance && error && <ErrorLine text={error} />}
      </div>
    </div>
  );
}

function CodeForm({ code, setCode, busy, onSubmit }: { code: string; setCode: (v: string) => void; busy: boolean; onSubmit: () => void }) {
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(); }} className="flex gap-3">
      <input
        value={code}
        onChange={e => setCode(e.target.value)}
        placeholder="Coupon code"
        aria-label="Coupon code"
        className="input-classic bg-[var(--input-bg)] flex-1 uppercase"
        autoCapitalize="characters"
        autoComplete="off"
      />
      <button type="submit" disabled={busy || !code.trim()} className="btn-primary !py-0 px-6 h-[52px] disabled:opacity-50">
        {busy ? '…' : 'Apply'}
      </button>
    </form>
  );
}

function ErrorLine({ text }: { text: string }) {
  return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">{text}</p>;
}
