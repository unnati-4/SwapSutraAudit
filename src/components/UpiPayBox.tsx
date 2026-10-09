import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { apiUrl } from '../config/runtime';

/**
 * SwapSutra's payment details, in one place (9 Oct 2026, owner's request:
 * "admin kabhi bhi chahe toh apna personal qr code or bank details change
 * kar sakta hai"). The admin sets the UPI ID, the name, an optional QR
 * picture and bank details in Management → Payment details; every payment
 * box on the site shows whatever is saved there.
 */

export interface PayDetails {
  vpa: string;
  payee: string;
  /** The admin's own QR picture, shown instead of the generated code when useQrImage is on. */
  qrImageUrl?: string;
  useQrImage?: boolean;
  bank?: { accountName?: string; accountNumber?: string; ifsc?: string; bankName?: string } | null;
}

export const upiPayUrl = (upi: Pick<PayDetails, 'vpa' | 'payee'>, amount?: number, note?: string) =>
  `upi://pay?pa=${upi.vpa}&pn=${encodeURIComponent(upi.payee)}${amount && amount > 0 ? `&am=${amount}` : ''}&cu=INR${note ? `&tn=${encodeURIComponent(note)}` : ''}`;

const API = apiUrl('/api/swapsutra');
let cached: Promise<PayDetails | null> | null = null;
/** For pages that have no payment payload of their own (e.g. Support SwapSutra). */
export function loadPaymentDetails(): Promise<PayDetails | null> {
  if (cached) return cached;
  cached = fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getPaymentDetails' }) })
    .then((r) => r.json())
    .then((d) => (d?.success && d.upi?.vpa ? (d.upi as PayDetails) : null))
    .catch(() => { cached = null; return null; });
  return cached;
}
export function usePaymentDetails(enabled = true): PayDetails | null {
  const [upi, setUpi] = useState<PayDetails | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadPaymentDetails().then((u) => { if (alive) setUpi(u); });
    return () => { alive = false; };
  }, [enabled]);
  return upi;
}

export default function UpiPayBox({ upi, amount, note, size = 160, showAmountHint = true }: {
  upi: PayDetails; amount?: number; note?: string; size?: number; showAmountHint?: boolean;
}) {
  const url = upiPayUrl(upi, amount, note);
  const ownQr = !!(upi.useQrImage && upi.qrImageUrl);
  const bank = upi.bank && (upi.bank.accountNumber || upi.bank.ifsc) ? upi.bank : null;
  return (
    <div className="flex flex-col items-center gap-2" data-testid="upi-pay-box">
      <a href={url} title="Open in your UPI app" className="block w-fit rounded-xl bg-white p-2">
        {ownQr
          ? <img src={upi.qrImageUrl} alt={`UPI QR code for ${upi.payee}`} width={size} height={size} style={{ width: size, height: size, objectFit: 'contain' }} referrerPolicy="no-referrer" />
          : <QRCodeCanvas value={url} size={size} level="H" includeMargin />}
      </a>
      <p className="text-2xs font-bold tracking-wider text-[var(--text-secondary)] break-all text-center">{upi.vpa} · {upi.payee}</p>
      {showAmountHint && amount && amount > 0 ? (
        <p className="text-2xs text-[var(--text-secondary)] text-center">
          {ownQr ? <>Enter exactly <strong>₹{amount}</strong> in your UPI app.</> : <>Don't change the pre-filled amount (₹{amount}).</>}
        </p>
      ) : null}
      {bank && (
        <details className="w-full text-2xs text-[var(--text-secondary)]">
          <summary className="cursor-pointer text-center font-semibold">Pay by bank transfer instead</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {bank.accountName && <><dt>Name</dt><dd className="font-semibold text-[var(--text-primary)] break-all">{bank.accountName}</dd></>}
            {bank.accountNumber && <><dt>Account</dt><dd className="font-semibold text-[var(--text-primary)] break-all">{bank.accountNumber}</dd></>}
            {bank.ifsc && <><dt>IFSC</dt><dd className="font-semibold text-[var(--text-primary)]">{bank.ifsc}</dd></>}
            {bank.bankName && <><dt>Bank</dt><dd className="text-[var(--text-primary)]">{bank.bankName}</dd></>}
          </dl>
        </details>
      )}
    </div>
  );
}
