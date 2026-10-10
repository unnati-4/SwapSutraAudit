import { apiUrl } from '../../config/runtime';
import { downscaleImageFile, fileToDataUrl } from '../../utils/imageCompress';
import type { PayDetails } from '../UpiPayBox';
import type { PartnerType } from '../../data/partnerContracts';

/** Shared bits of the partner pages (9 Oct 2026). */

const API = apiUrl('/api/swapsutra');
export async function partnerPost(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return res.json();
}

/** A picture (shrunk first) or a PDF as a data URL; null with a reason when it cannot be used. */
export async function fileForUpload(file: File, { allowPdf = false, maxMb = 4 } = {}): Promise<{ dataUrl?: string; error?: string }> {
  if (allowPdf && file.type === 'application/pdf') {
    if (file.size > maxMb * 1024 * 1024) return { error: `The PDF must be under ${maxMb} MB.` };
    return { dataUrl: await fileToDataUrl(file) };
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { error: allowPdf ? 'Upload a JPG, PNG, WebP or PDF.' : 'Upload a JPG, PNG or WebP picture.' };
  const small = await downscaleImageFile(file);
  if (small.size > maxMb * 1024 * 1024) return { error: `The picture must be under ${maxMb} MB.` };
  return { dataUrl: await fileToDataUrl(small) };
}

export const inr = (n: number) => '₹' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const dateLabel = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const monthLabel = (ym: string) => {
  const d = new Date(ym + '-01T00:00:00');
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

export interface PartnerView {
  id: string; type: PartnerType; typeLabel: string; email: string; status: string; name: string; contactName: string; phone: string;
  about: string; website: string; instagram: string; address: string; city: string; pincode: string; lat: number | null; lng: number | null;
  placeLabel: string; registeredName: string; gstin: string; panMasked: string; aadhaarLast4: string; typeFields: Record<string, string>;
  showBanner: boolean; runAds: boolean; bannerImageUrl: string; bannerHeadline: string; bannerTagline: string; bannerStatus: string; bannerNote: string;
  contractVersion: string; contractSignedName: string; contractSignedAt: string; currentContractVersion: string;
  commissionPlan: string; commissionFreeUntil: string; commissionNow: number; approvedAt: string; reviewNote: string; submittedAt: string;
  docs: { key: string; label: string; at: string; url?: string; mime?: string }[];
}
export interface PartnerDash {
  success: boolean; email: string; partner: PartnerView | null; adFee: number; adMonths: number; commissionPercent: number; upi: PayDetails;
  requiredDocs: Record<PartnerType, Record<string, string>>; contractVersions: Record<PartnerType, string>;
  promotion?: { freeUntil: string; paidUntil: string; activeUntil: string; active: boolean; inFreePeriod: boolean; fee: number; months: number; dueSoon: boolean;
    pendingPayment: { id: string; utr: string; submittedAt: string } | null };
  adPayments?: { id: string; amount: number; utr: string; status: string; periodFrom: string; periodTo: string; reason: string; createdAt: string }[];
  earnings?: { months: { month: string; gross: number; commission: number; net: number; paid: number; due: number; items: number }[];
    total: { gross: number; commission: number; net: number; paid: number; due: number } } | null;
  orders?: { swapId: string; bookTitle: string; serviceType: string; amount: number; status: string; createdAt: string; nextStep: string; step: number; closed?: boolean; urgent?: boolean }[];
  books?: { id: string; title: string; author: string; status: string; stock: number; sellPrice: number | null }[];
  ads?: { id: string; kind: string; sponsor: string; headline: string; tagline: string; imageUrl: string; linkUrl: string; bookId: string; ctaLabel: string; placement: string; status: string; reviewNote: string; clicks: number }[];
  payoutAccount?: { upiId: string; payeeName: string } | null;
  nextSteps?: { key: string; text: string; swapId?: string; urgent?: boolean }[];
}
