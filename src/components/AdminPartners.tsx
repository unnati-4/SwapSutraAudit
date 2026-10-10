import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../config/runtime';
import { LocationCard } from './LocationPin';
import { PartnerBannerPreview } from './partners/PartnerDashboard';

/**
 * Admin → Partners (9 Oct 2026, owner's request).
 *
 * Bookstores, authors, publishers and promoters: applications with their
 * documents (private Drive links), approve (2% commission) or approve
 * commission-free for the first year, ask for changes, reject, pause;
 * banners to check; ₹100 promotion payments to verify; and the monthly
 * payout statements. Partner ads are approved in the Ads tab.
 */

const API = apiUrl('/api/swapsutra');
async function post(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return res.json();
}
type Row = Record<string, any>;
type View = 'applications' | 'approved' | 'banners' | 'payments' | 'payouts';
const inr = (n: number) => '₹' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN');
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS: Record<string, string> = { PENDING: 'Waiting for review', CHANGES_REQUESTED: 'Changes asked', APPROVED: 'Approved', REJECTED: 'Rejected', SUSPENDED: 'Paused' };

export default function AdminPartners() {
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [view, setView] = useState<View>('applications');
  const [open, setOpen] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const d = await post('adminListPartners');
      if (d?.success) setData(d); else setNote(d?.message || 'Could not load partners.');
    } catch { setNote('Could not load partners.'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const run = async (action: string, body: Record<string, unknown>, ok: string) => {
    setNote('');
    const d = await post(action, body).catch(() => null);
    if (d?.success) { setNote(ok); await load(); } else setNote(d?.message || 'That did not work.');
  };
  const ask = (label: string) => { const v = window.prompt(label); return v === null ? null : v.trim(); };

  const items: Row[] = data?.items || [];
  const apps = useMemo(() => items.filter((p) => ['PENDING', 'CHANGES_REQUESTED', 'REJECTED'].includes(p.status)), [items]);
  const approved = useMemo(() => items.filter((p) => ['APPROVED', 'SUSPENDED'].includes(p.status)), [items]);
  const banners = useMemo(() => items.filter((p) => p.bannerStatus === 'PENDING' && p.bannerImageUrl), [items]);
  const payments: Row[] = data?.pendingPayments || [];
  const monthly: Row[] = data?.monthly || [];
  const counts: Record<View, number> = {
    applications: apps.filter((p) => p.status === 'PENDING').length, approved: approved.length, banners: banners.length,
    payments: payments.length, payouts: monthly.filter((m) => m.payable && m.due > 0).length,
  };

  const partnerCard = (p: Row) => (
    <li key={p.id} className="admin-ads__item" style={{ gridTemplateColumns: '1fr' }} data-testid="admin-partner-row">
      <div className="admin-ads__info">
        <p className="admin-ads__title">{p.name} <span className="type-caption">· {p.typeLabel} · {STATUS[p.status] || p.status}</span></p>
        <p className="type-caption">{p.contactName} · {p.email} · {p.phone} · {p.city} {p.pincode}</p>
        {p.status === 'APPROVED' && (
          <p className="type-caption">
            Commission now {p.commissionNow}%{p.commissionPlan === 'free_first_year' ? ` (free until ${day(p.commissionFreeUntil)})` : ''} ·
            Promotion {p.promotion?.active ? `on until ${day(p.promotion.activeUntil)}` : 'off'} · Payout UPI: {p.payoutAccount?.upiId || 'not added'}
          </p>
        )}
        {p.reviewNote && <p className="type-caption">Note: {p.reviewNote}</p>}
        <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setOpen(open === p.id ? '' : p.id)}>{open === p.id ? 'Hide details' : 'Details & documents'}</button>
        {open === p.id && (
          <div className="admin-partner__detail">
            <p className="type-caption"><b>Registered in the name of:</b> {p.registeredName} · <b>PAN:</b> {p.panNumber} · <b>Aadhaar (last 4):</b> {p.aadhaarLast4}{p.gstin ? <> · <b>GSTIN:</b> {p.gstin}</> : null}</p>
            {p.address && <p className="type-caption"><b>Address:</b> {p.address}</p>}
            {Object.keys(p.typeFields || {}).filter((k) => p.typeFields[k]).map((k) => <p key={k} className="type-caption"><b>{k}:</b> {p.typeFields[k]}</p>)}
            {p.about && <p className="type-caption"><b>About:</b> {p.about}</p>}
            {(p.website || p.instagram) && <p className="type-caption">{p.website && <a href={p.website} target="_blank" rel="noopener noreferrer">{p.website}</a>} {p.instagram}</p>}
            {p.lat !== null && p.lng !== null && <div style={{ maxWidth: 360 }}><LocationCard lat={p.lat} lng={p.lng} label={p.placeLabel || p.name} compact /></div>}
            <p className="type-caption"><b>Documents</b> (private — open while signed in to the SwapSutra Google account):</p>
            <ul className="type-caption">{(p.docs || []).map((d: Row) => <li key={d.key}><a href={d.url} target="_blank" rel="noopener noreferrer">{d.label}</a> · {day(d.at)}</li>)}</ul>
            <p className="type-caption"><b>Agreement:</b> signed by {p.contractSignedName} on {day(p.contractSignedAt)} · {p.contractVersion}</p>
            <p className="type-caption"><b>Wants:</b> {p.showBanner ? 'banner' : 'no banner'} · {p.runAds ? 'ads' : 'no ads'}</p>
          </div>
        )}
      </div>
      <div className="admin-ads__actions">
        {['PENDING', 'CHANGES_REQUESTED', 'REJECTED'].includes(p.status) && (<>
          <button type="button" className="mug-btn mug-btn--solid" onClick={() => window.confirm(`Approve ${p.name}? ${data?.commissionPercent}% commission from the start.`) && run('adminReviewPartner', { id: p.id, decision: 'approve' }, 'Approved.')}>Approve ({data?.commissionPercent}% commission)</button>
          <button type="button" className="mug-btn mug-btn--solid" onClick={() => window.confirm(`Approve ${p.name} commission-free for the first year?`) && run('adminReviewPartner', { id: p.id, decision: 'approve_free_year' }, 'Approved — no commission for a year.')}>Approve — 1 year commission-free</button>
          {p.status !== 'REJECTED' && <button type="button" className="mug-btn mug-btn--quiet" onClick={() => { const n = ask('What should they change?'); if (n) run('adminReviewPartner', { id: p.id, decision: 'request_changes', note: n }, 'Changes asked.'); }}>Ask for changes</button>}
          {p.status !== 'REJECTED' && <button type="button" className="mug-btn mug-btn--quiet" onClick={() => { const n = ask('Why is it rejected?'); if (n) run('adminReviewPartner', { id: p.id, decision: 'reject', note: n }, 'Rejected.'); }}>Reject</button>}
        </>)}
        {p.status === 'APPROVED' && (<>
          {p.commissionPlan === 'free_first_year'
            ? <button type="button" className="mug-btn mug-btn--quiet" onClick={() => window.confirm('Charge commission from now?') && run('adminReviewPartner', { id: p.id, decision: 'plan_standard' }, 'Plan changed.')}>Charge {data?.commissionPercent}% from now</button>
            : <button type="button" className="mug-btn mug-btn--quiet" onClick={() => window.confirm('Give the first year commission-free (counted from approval)?') && run('adminReviewPartner', { id: p.id, decision: 'plan_free_year' }, 'Plan changed.')}>Make first year commission-free</button>}
          <button type="button" className="mug-btn mug-btn--quiet" onClick={() => { const n = ask('Why pause this partner?'); if (n !== null) run('adminReviewPartner', { id: p.id, decision: 'suspend', note: n }, 'Paused.'); }}>Pause</button>
        </>)}
        {p.status === 'SUSPENDED' && <button type="button" className="mug-btn mug-btn--solid" onClick={() => run('adminReviewPartner', { id: p.id, decision: 'reinstate' }, 'Active again.')}>Reinstate</button>}
      </div>
    </li>
  );

  return (
    <div className="admin-mugs admin-mugp" data-testid="admin-partners">
      <div className="admin-mugs__bar">
        <h3 className="type-h3">Partners</h3>
        <button type="button" className="mug-btn mug-btn--quiet" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <p className="type-caption">
        Bookstores, authors, publishers and promoters. Approved partners list without a limit, pay no ₹10 fee, and SwapSutra keeps {data?.commissionPercent ?? 2}% of their payouts
        (0% for the first year if approved commission-free). Promotion: 6 months free, then ₹{data?.adFee ?? 100} per {data?.adMonths ?? 2} months. Partner ads are approved in the Ads tab.
      </p>
      <div className="admin-mugs__bar" role="tablist">
        {([['applications', 'Applications'], ['approved', 'Partners'], ['banners', 'Banners to check'], ['payments', 'Promotion payments'], ['payouts', 'Monthly payouts']] as [View, string][]).map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'mug-btn mug-btn--solid' : 'mug-btn mug-btn--quiet'} onClick={() => setView(v)}>
            {l}{counts[v] ? ` (${counts[v]})` : ''}
          </button>
        ))}
      </div>
      {note && <p className="type-caption" role="status">{note}</p>}

      {view === 'applications' && (apps.length ? <ul className="admin-ads__list">{apps.map(partnerCard)}</ul> : <p className="type-caption">No applications waiting.</p>)}
      {view === 'approved' && (approved.length ? <ul className="admin-ads__list">{approved.map(partnerCard)}</ul> : <p className="type-caption">No partners yet.</p>)}

      {view === 'banners' && (banners.length ? (
        <ul className="admin-ads__list">{banners.map((p) => (
          <li key={p.id} className="admin-ads__item" style={{ gridTemplateColumns: '1fr' }}>
            <div style={{ maxWidth: 520 }}><PartnerBannerPreview imageUrl={p.bannerImageUrl} headline={p.bannerHeadline} tagline={p.bannerTagline} name={p.name} /></div>
            <p className="type-caption">{p.name} · {p.typeLabel}</p>
            <div className="admin-ads__actions">
              <button type="button" className="mug-btn mug-btn--solid" onClick={() => run('adminReviewPartnerBanner', { id: p.id, approve: true }, 'Banner approved.')}>Approve banner</button>
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => { const n = ask('What should change?'); if (n) run('adminReviewPartnerBanner', { id: p.id, approve: false, note: n }, 'Sent back.'); }}>Ask for a change</button>
            </div>
          </li>
        ))}</ul>
      ) : <p className="type-caption">No banners waiting.</p>)}

      {view === 'payments' && (payments.length ? (
        <ul className="admin-ads__list">{payments.map((x) => (
          <li key={x.id} className="admin-ads__item" style={{ gridTemplateColumns: '1fr' }}>
            <p className="admin-ads__title">{inr(x.amount)} from {x.partnerName}</p>
            <p className="type-caption">UTR {x.utr} · {day(x.createdAt)} · {x.email}{x.screenshotUrl ? <> · <a href={x.screenshotUrl} target="_blank" rel="noopener noreferrer">screenshot</a></> : null}</p>
            <div className="admin-ads__actions">
              <button type="button" className="mug-btn mug-btn--solid" onClick={() => run('adminReviewPartnerAdPayment', { id: x.id, approve: true }, 'Verified — promotion extended by 2 months.')}>Verified — add 2 months</button>
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => { const n = ask('Why could it not be verified?'); if (n) run('adminReviewPartnerAdPayment', { id: x.id, approve: false, reason: n }, 'Marked not verified.'); }}>Not received</button>
            </div>
          </li>
        ))}</ul>
      ) : <p className="type-caption">No payments waiting.</p>)}

      {view === 'payouts' && (monthly.length ? (
        <ul className="admin-ads__list">{monthly.map((m) => (
          <li key={m.email + m.month} className="admin-ads__item" style={{ gridTemplateColumns: '1fr' }}>
            <p className="admin-ads__title">{m.partnerName} — {m.month}</p>
            <p className="type-caption">{m.items} order(s) · earned {inr(m.net)} after commission · paid {inr(m.paid)} · <b>due {inr(m.due)}</b> · pay to {m.payTo?.upiId || 'no UPI yet'}{m.payTo?.payeeName ? ` (${m.payTo.payeeName})` : ''}</p>
            {m.due > 0 && (m.payable
              ? <div className="admin-ads__actions"><button type="button" className="mug-btn mug-btn--solid" onClick={() => { const n = ask(`Paid ${inr(m.due)} to ${m.partnerName}? Add the UTR (optional):`); if (n !== null) run('adminMarkPartnerMonthPaid', { email: m.email, month: m.month, note: n }, 'Month marked paid.'); }}>Mark {m.month} paid</button></div>
              : <p className="type-caption">Payable after the month ends.</p>)}
          </li>
        ))}</ul>
      ) : <p className="type-caption">No partner payouts yet.</p>)}
    </div>
  );
}
