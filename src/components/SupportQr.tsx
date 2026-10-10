import { QRCodeCanvas } from 'qrcode.react';
import { upiPayUrl, usePaymentDetails } from './UpiPayBox';

/**
 * "Support SwapSutra" (Oct 2026, owner's request): an icon in the header,
 * for everyone, that shows SwapSutra's UPI QR with NO amount filled in —
 * the reader chooses what to give in their UPI app.
 * 9 Oct 2026: uses the payment details the admin saves in Management
 * (these constants are only the fallback while they load).
 */
export const SUPPORT_UPI_VPA = '7534845373-3@ybl';
export const SUPPORT_UPI_PAYEE = 'Unnati Goyal';
export const SUPPORT_UPI_URL = `upi://pay?pa=${SUPPORT_UPI_VPA}&pn=${encodeURIComponent(SUPPORT_UPI_PAYEE)}&cu=INR&tn=${encodeURIComponent('Support SwapSutra')}`;

export default function SupportQr({ open, onClose }: { open: boolean; onClose: () => void }) {
  const saved = usePaymentDetails(open);
  if (!open) return null;
  const upi = saved || { vpa: SUPPORT_UPI_VPA, payee: SUPPORT_UPI_PAYEE };
  const url = upiPayUrl(upi, undefined, 'Support SwapSutra');
  const ownQr = !!(saved?.useQrImage && saved.qrImageUrl);
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <div className="absolute inset-0 bg-brand-brown/40 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-3xl border border-brand-border bg-[var(--bg-surface)] p-6 sm:p-8 text-center shadow-editorial">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-5 text-xl leading-none text-[var(--text-secondary)] hover:text-brand-gold-text">×</button>
        <h3 id="support-title" className="font-serif text-2xl text-[var(--text-primary)]">Support SwapSutra</h3>
        <p className="mt-2 text-xs text-[var(--text-secondary)] leading-relaxed">
          SwapSutra is run by readers, for readers. If you'd like to help keep it going, scan this with any UPI app and give whatever you like.
        </p>
        <a href={url} title="Open in your UPI app" className="mx-auto mt-5 block w-fit rounded-2xl bg-white p-3" data-testid="support-qr">
          {ownQr
            ? <img src={saved!.qrImageUrl} alt={`UPI QR code for ${upi.payee}`} width={200} height={200} style={{ width: 200, height: 200, objectFit: 'contain' }} referrerPolicy="no-referrer" />
            : <QRCodeCanvas value={url} size={200} level="H" />}
        </a>
        <p className="mt-3 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{upi.vpa}</p>
        <p className="mt-1 text-2xs text-[var(--text-secondary)]">On your phone, tap the code to open your UPI app. We never ask for your UPI PIN.</p>
      </div>
    </div>
  );
}
