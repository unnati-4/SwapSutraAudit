import { useEffect, useState } from 'react';
import UpiPayBox, { type PayDetails } from './UpiPayBox';
import { apiUrl } from '../config/runtime';

/**
 * Shown ONCE as a popup when a reader reaches their free listing limit
 * (20 books); after that it opens only from the profile's "list more
 * books" button (Oct 2026, owner's rule). Two ways past the limit:
 *   • pay ₹20 by UPI QR — SwapSutra verifies the UTR; it covers 3 months
 *   • a bookstore, author, publisher or promoter registers as a SwapSutra
 *     partner (/partners) instead — partners list without a limit.
 * Coupon codes were removed on 9 Oct 2026 (owner's request).
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
  /** A paid unlock covers 3 months (Oct 2026): until when, and whether one ran out. */
  unlockedUntil?: string;
  unlockExpired?: boolean;
  unlockDays?: number;
}

/** "12 Jan 2027" — for the end of a 3-month unlock. */
export function unlockUntilLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The reader has used their free listings (or their 3 months ran out). */
export function needsListingUnlock(a: ListingAllowance | null): boolean {
  return !!a && !a.unlimited && (a.unlockExpired === true || (a.limit !== null && a.used >= a.limit));
}

const POPUP_KEY = 'ss_listing_unlock_popup_shown_v1_';
/** The popup is shown once per reader; afterwards the profile button is the way in. */
export function listingPopupAlreadyShown(email: string): boolean {
  try { return localStorage.getItem(POPUP_KEY + email) === '1'; } catch { return false; }
}
export function markListingPopupShown(email: string): void {
  try { localStorage.setItem(POPUP_KEY + email, '1'); } catch { /* private mode: it may show again */ }
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
  /** Called with the new allowance once a payment is submitted. */
  onChange?: (allowance: ListingAllowance) => void;
}

export default function ListingUnlockPanel({ open, onClose, onChange }: Props) {
  const [allowance, setAllowance] = useState<ListingAllowance | null>(null);
  const [upi, setUpi] = useState<PayDetails | null>(null);
  const [utr, setUtr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(''); setDone(''); setUtr(''); setFile(null);
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

  const finish = (next: ListingAllowance, message: string) => {
    setAllowance(next);
    setDone(message);
    onChange?.(next);
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
          {allowance?.unlimited ? 'You can list more books' : 'Want to list more books?'}
        </h3>

        {!allowance && !error && <p className="text-sm text-[var(--text-secondary)]">Checking your shelf…</p>}

        {allowance && allowance.unlimited && (
          <div className="space-y-6">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{done || (allowance.unlockedUntil ? `You can list as many books as you like until ${unlockUntilLabel(allowance.unlockedUntil)}.` : 'You can list as many books as you like.')}</p>
            <button onClick={onClose} className="btn-primary w-full !py-4">Add a book</button>
          </div>
        )}

        {allowance && !allowance.unlimited && pending && (
          <div className="space-y-6">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {done || `Your ₹${fee} payment (UTR ${pending.utr}) is being verified. Once it's approved you can list as many books as you like for 3 months — we'll notify you.`}
            </p>
            {error && <ErrorLine text={error} />}
            <PartnerHint />
          </div>
        )}

        {allowance && !allowance.unlimited && !pending && (
          <>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
              {allowance.unlockExpired
                ? <>Your 3 months of extra listings have ended. If you'd like to list more books, it's ₹{fee} for another 3 months. Your books already listed stay in the Library.</>
                : <>You've listed {allowance.used} of {allowance.limit} free books. If you'd like to list more books, it's ₹{fee} for 3 months. Your books already listed stay in the Library.</>}
            </p>

            {allowance.lastRejection && (
              <p className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 leading-relaxed">
                Your last payment couldn't be verified{allowance.lastRejection.reason ? `: ${allowance.lastRejection.reason}` : '.'} Please pay again below.
              </p>
            )}

            {(
              <div className="space-y-5">
                {upi && (
                  <div className="flex flex-col items-center gap-2 rounded-2xl bg-[var(--bg-page)] p-5">
                    <UpiPayBox upi={upi} amount={fee} note="SwapSutra Listing Unlock" size={176} showAmountHint={false} />
                    <p className="font-serif text-3xl text-[var(--text-primary)] tabular-nums">₹{fee} <span className="text-sm font-sans text-[var(--text-secondary)]">for 3 months</span></p>
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
                <PartnerHint />
              </div>
            )}
          </>
        )}

        {!allowance && error && <ErrorLine text={error} />}
      </div>
    </div>
  );
}

/** Bookstores, authors and publishers list without a limit as partners. */
function PartnerHint() {
  return (
    <p className="text-xs text-[var(--text-secondary)] text-center leading-relaxed" data-testid="partner-hint">
      A bookstore, author, publisher or promoter? <a href="/partners" className="font-semibold text-brand-gold-text underline">Register as a SwapSutra partner</a> — partners list without a limit.
    </p>
  );
}

function ErrorLine({ text }: { text: string }) {
  return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">{text}</p>;
}
