import React, { useState } from 'react';
import UpiPayBox from '../UpiPayBox';
import { LocationCard, LocationPinPicker } from '../LocationPin';
import { PARTNER_CONTRACTS } from '../../data/partnerContracts';
import { adImageSrc } from '../../utils/ads';
import { dateLabel, fileForUpload, inr, monthLabel, partnerPost, type PartnerDash } from './partnerApi';

/**
 * The partner's own console (9 Oct 2026, owner's request): what they have
 * earned, what SwapSutra kept, what is paid and due, and what they need to
 * do next — orders, stock, banner and ads, the promotion fee, payouts, and
 * their signed agreement. A buyer is never named here.
 */

type Tab = 'overview' | 'orders' | 'books' | 'promo' | 'account';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'orders', label: 'Orders' }, { id: 'books', label: 'Books & stock' },
  { id: 'promo', label: 'Banner & ads' }, { id: 'account', label: 'Payouts & agreement' },
];
const SERVICE: Record<string, string> = { SELL: 'Sale', RENT: 'Rental', LEND: 'Loan', SWAP: 'Swap' };

export function PartnerBannerPreview({ imageUrl, headline, tagline, name }: { imageUrl: string; headline?: string; tagline?: string; name: string }) {
  return (
    <div className="pp-banner" data-testid="partner-banner-preview">
      {imageUrl ? <img src={adImageSrc(imageUrl)} alt="" referrerPolicy="no-referrer" /> : <div className="pp-banner__blank">Your banner picture</div>}
      <span className="pp-banner__logo"><img src="/swapsutra-logo.png" alt="SwapSutra" /> SwapSutra partner</span>
      <div className="pp-banner__text">
        <span className="ss-ad__chip">Sponsored</span>
        <b>{headline || name}</b>
        {tagline && <span>{tagline}</span>}
      </div>
    </div>
  );
}

export default function PartnerDashboard({ dash, reload, onOpenOrders, onListBook }: {
  dash: PartnerDash; reload: () => Promise<void>; onOpenOrders: () => void; onListBook: () => void;
}) {
  const p = dash.partner!;
  const [tab, setTab] = useState<Tab>('overview');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(''), 6000); };
  const act = async (key: string, action: string, body: Record<string, unknown>, ok?: string) => {
    setBusy(key);
    try {
      const d = await partnerPost(action, body);
      if (d?.success) { flash(ok || d.message || 'Saved.'); await reload(); return d; }
      flash(d?.message || 'That did not work. Try again.');
      return d;
    } catch { flash('Could not reach SwapSutra.'); return null; }
    finally { setBusy(''); }
  };

  const e = dash.earnings;
  const promo = dash.promotion!;
  return (
    <div className="pp-dash" data-testid="partner-dashboard">
      <header className="pp-dash__head">
        <div>
          <p className="pp-eyebrow">{p.typeLabel} · SwapSutra partner</p>
          <h1 className="pp-h1">{p.name}</h1>
          <p className="pp-hint">
            Commission now: <b>{p.commissionNow}%</b>{p.commissionPlan === 'free_first_year' && p.commissionFreeUntil ? ` · commission-free until ${dateLabel(p.commissionFreeUntil)}, then ${dash.commissionPercent}%` : ''}
            {' · '}Promotion: <b>{promo.active ? `on until ${dateLabel(promo.activeUntil)}${promo.inFreePeriod ? ' (free)' : ''}` : 'off'}</b>
          </p>
        </div>
      </header>
      <nav className="pp-tabs" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </nav>
      {msg && <p className="pp-flash" role="status">{msg}</p>}

      {tab === 'overview' && (
        <div className="pp-grid">
          <section className="pp-card">
            <h2 className="pp-h2">What to do next</h2>
            {(dash.nextSteps || []).length === 0 ? <p className="pp-hint">You're all set. New orders will show here.</p> : (
              <ol className="pp-steps">
                {(dash.nextSteps || []).map((s) => (
                  <li key={s.key} className={s.urgent ? 'is-urgent' : ''}>
                    {s.text}
                    {s.key === 'payout' && <button type="button" className="pp-link" onClick={() => setTab('account')}>Add UPI ID</button>}
                    {s.key.startsWith('order_') && <button type="button" className="pp-link" onClick={onOpenOrders}>Open the order</button>}
                    {s.key === 'list' && <button type="button" className="pp-link" onClick={onListBook}>List a book</button>}
                    {(s.key.startsWith('promo') || s.key.startsWith('banner')) && <button type="button" className="pp-link" onClick={() => setTab('promo')}>Banner & ads</button>}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="pp-card">
            <h2 className="pp-h2">Your earnings</h2>
            <div className="pp-stats">
              <div><span>Sold / rented</span><b>{inr(e?.total.gross || 0)}</b></div>
              <div><span>Commission</span><b>{inr(e?.total.commission || 0)}</b></div>
              <div><span>You earned</span><b>{inr(e?.total.net || 0)}</b></div>
              <div><span>Paid to you</span><b>{inr(e?.total.paid || 0)}</b></div>
              <div><span>Coming to you</span><b>{inr(e?.total.due || 0)}</b></div>
            </div>
            <p className="pp-hint">Paid monthly: a month's orders are paid after the month ends, to {dash.payoutAccount?.upiId || 'your UPI ID (add it under Payouts)'}. No ₹10 platform fee is taken from you.</p>
            {e && e.months.length > 0 && (
              <table className="pp-table">
                <thead><tr><th>Month</th><th>Orders</th><th>Sold</th><th>Commission</th><th>Earned</th><th>Status</th></tr></thead>
                <tbody>{e.months.map((m) => (
                  <tr key={m.month}><td>{monthLabel(m.month)}</td><td>{m.items}</td><td>{inr(m.gross)}</td><td>{inr(m.commission)}</td><td>{inr(m.net)}</td>
                    <td>{m.due > 0 ? `${inr(m.due)} due` : 'Paid'}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {tab === 'orders' && (
        <section className="pp-card">
          <h2 className="pp-h2">Orders</h2>
          <p className="pp-hint">You ship every order yourself. The exchange room gives you the shipping address when it is time to post — buyer details otherwise stay with SwapSutra.</p>
          {(dash.orders || []).length === 0 ? <p className="pp-hint">No orders yet.</p> : (
            <ul className="pp-list">
              {(dash.orders || []).map((o) => (
                <li key={o.swapId}>
                  <div><b>{o.bookTitle}</b><span className="pp-hint">{SERVICE[o.serviceType] || o.serviceType}{o.amount ? ` · ${inr(o.amount)}` : ''} · {dateLabel(o.createdAt)}</span></div>
                  <div className="pp-list__side">
                    <span className={o.nextStep ? 'pp-chip pp-chip--warn' : 'pp-chip'}>{o.closed ? 'Done' : o.nextStep ? 'Your turn' : o.step ? `Step ${o.step}` : o.status}</span>
                    {o.nextStep && <span className="pp-hint">{o.nextStep}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-outline pp-btn" onClick={onOpenOrders}>Open the exchange rooms</button>
        </section>
      )}

      {tab === 'books' && (
        <section className="pp-card">
          <div className="pp-form__head">
            <h2 className="pp-h2">Books & stock</h2>
            <button type="button" className="btn-primary pp-btn" onClick={onListBook}>+ List a book</button>
          </div>
          <p className="pp-hint">No listing limit. Set how many copies you have — a book with 0 copies is hidden from the Library until you add stock. Each sale takes one copy off.</p>
          {(dash.books || []).length === 0 ? <p className="pp-hint">No books yet.</p> : (
            <ul className="pp-list">
              {(dash.books || []).map((b) => <StockRow key={b.id} book={b} busy={busy === 'stock_' + b.id}
                onSave={(n) => act('stock_' + b.id, 'setPartnerBookStock', { bookId: b.id, stock: n })} />)}
            </ul>
          )}
        </section>
      )}

      {tab === 'promo' && <PromoTab dash={dash} act={act} busy={busy} />}
      {tab === 'account' && <AccountTab dash={dash} act={act} busy={busy} />}
    </div>
  );
}

const StockRow: React.FC<{ book: NonNullable<PartnerDash['books']>[number]; busy: boolean; onSave: (n: number) => void }> = ({ book, busy, onSave }) => {
  const [n, setN] = useState(String(book.stock));
  const changed = Number(n) !== book.stock;
  return (
    <li>
      <div><b>{book.title}</b><span className="pp-hint">{book.author}{book.sellPrice ? ` · ${inr(book.sellPrice)}` : ''}{book.stock === 0 ? ' · out of stock' : ''}</span></div>
      <div className="pp-stock">
        <button type="button" aria-label={`One fewer copy of ${book.title}`} onClick={() => setN(String(Math.max(0, (Number(n) || 0) - 1)))}>−</button>
        <input value={n} inputMode="numeric" aria-label={`Copies of ${book.title}`} onChange={(e) => setN(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        <button type="button" aria-label={`One more copy of ${book.title}`} onClick={() => setN(String((Number(n) || 0) + 1))}>+</button>
        <button type="button" className="pp-link" disabled={!changed || busy} onClick={() => onSave(Number(n) || 0)}>{busy ? '…' : 'Save'}</button>
      </div>
    </li>
  );
};

type Act = (key: string, action: string, body: Record<string, unknown>, ok?: string) => Promise<any>;

function PromoTab({ dash, act, busy }: { dash: PartnerDash; act: Act; busy: string }) {
  const p = dash.partner!;
  const promo = dash.promotion!;
  const [head, setHead] = useState({ bannerHeadline: p.bannerHeadline || '', bannerTagline: p.bannerTagline || '' });
  const [adForm, setAdForm] = useState<{ id?: string; headline: string; tagline: string; imageUrl: string; linkUrl: string; ctaLabel: string; placement: string } | null>(null);
  const [adErr, setAdErr] = useState<Record<string, string>>({});
  const [utr, setUtr] = useState('');
  const [shot, setShot] = useState<string>('');
  const [payErr, setPayErr] = useState('');

  const uploadBanner = async (file?: File | null) => {
    if (!file) return;
    const r = await fileForUpload(file, { maxMb: 2 });
    if (r.error) { setPayErr(r.error); return; }
    await act('banner', 'uploadPartnerBanner', { dataUrl: r.dataUrl });
  };
  const uploadAdImage = async (file?: File | null) => {
    if (!file || !adForm) return;
    const r = await fileForUpload(file, { maxMb: 2 });
    if (r.error) { setAdErr({ imageUrl: r.error }); return; }
    const d = await partnerPost('uploadPartnerAdImage', { dataUrl: r.dataUrl });
    if (d?.success) setAdForm((f) => (f ? { ...f, imageUrl: d.url } : f)); else setAdErr({ imageUrl: d?.message || 'Upload failed.' });
  };
  const saveAd = async () => {
    if (!adForm) return;
    setAdErr({});
    const d = await act('ad', 'savePartnerAd', { ...adForm }, 'Sent to SwapSutra for approval.');
    if (d?.success) setAdForm(null); else if (d?.errors) setAdErr(d.errors);
  };
  const pay = async () => {
    setPayErr('');
    const d = await act('pay', 'submitPartnerAdPayment', { utr: utr.trim(), fileData: shot || undefined }, 'Payment sent — SwapSutra will verify it.');
    if (d?.success) { setUtr(''); setShot(''); } else if (d?.errors?.utr) setPayErr(d.errors.utr);
  };

  return (
    <div className="pp-grid">
      <section className="pp-card">
        <h2 className="pp-h2">Promotion</h2>
        <p className="pp-hint">
          {promo.active
            ? <>Your banner and ads can run until <b>{dateLabel(promo.activeUntil)}</b>{promo.inFreePeriod ? ' — your 6 free months' : ''}.</>
            : <>Promotion is off. Pay ₹{promo.fee} for {promo.months} months to show your banner and ads.</>}
          {' '}After the free 6 months it is ₹{promo.fee} for every {promo.months} months.
        </p>
        <label className="pp-check"><input type="checkbox" checked={p.showBanner} disabled={busy === 'toggle'} onChange={(e) => act('toggle', 'updatePartnerProfile', { showBanner: e.target.checked })} /> Show my banner on the Library page</label>
        <label className="pp-check"><input type="checkbox" checked={p.runAds} disabled={busy === 'toggle'} onChange={(e) => act('toggle', 'updatePartnerProfile', { runAds: e.target.checked })} /> Run my ads between the books</label>
        {(!promo.inFreePeriod || promo.dueSoon || !promo.active) && (
          <div className="pp-pay">
            {promo.pendingPayment
              ? <p className="pp-hint">Your payment (UTR {promo.pendingPayment.utr}) is being verified.</p>
              : (<>
                  <UpiPayBox upi={dash.upi} amount={promo.fee} note={`SwapSutra promotion ${p.name}`.slice(0, 50)} size={150} />
                  <label className="pp-field"><span className="pp-label">UTR / transaction reference</span>
                    <input className="input-classic pp-input" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 427812345678" /></label>
                  <label className="pp-field"><span className="pp-label">Payment screenshot (optional)</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = await fileForUpload(f, { maxMb: 2 }); if (r.dataUrl) setShot(r.dataUrl); else setPayErr(r.error || ''); }} /></label>
                  {payErr && <p className="pp-error" role="alert">{payErr}</p>}
                  <button type="button" className="btn-primary pp-btn" disabled={busy === 'pay' || !utr.trim()} onClick={pay}>{busy === 'pay' ? 'Sending…' : `I have paid ₹${promo.fee}`}</button>
                </>)}
          </div>
        )}
        {(dash.adPayments || []).length > 0 && (
          <table className="pp-table">
            <thead><tr><th>Paid</th><th>UTR</th><th>Covers</th><th>Status</th></tr></thead>
            <tbody>{(dash.adPayments || []).map((x) => (
              <tr key={x.id}><td>{inr(x.amount)} · {dateLabel(x.createdAt)}</td><td>{x.utr}</td>
                <td>{x.periodFrom ? `${dateLabel(x.periodFrom)} – ${dateLabel(x.periodTo)}` : '—'}</td>
                <td>{x.status === 'APPROVED' ? 'Verified' : x.status === 'REJECTED' ? `Not verified${x.reason ? ': ' + x.reason : ''}` : 'Checking'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="pp-card">
        <h2 className="pp-h2">Your banner</h2>
        <PartnerBannerPreview imageUrl={p.bannerImageUrl} headline={head.bannerHeadline} tagline={head.bannerTagline} name={p.name} />
        <p className="pp-hint">
          {p.bannerStatus === 'APPROVED' ? '✓ Approved — it shows on the Library page while promotion is on.'
            : p.bannerStatus === 'PENDING' ? 'Waiting for SwapSutra to check it.'
            : p.bannerStatus === 'REJECTED' ? `Needs a change: ${p.bannerNote}` : 'Upload a wide picture (about 1600 × 700). The SwapSutra logo is added on top.'}
        </p>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy === 'banner'} onChange={(e) => uploadBanner(e.target.files?.[0])} aria-label="Upload your banner" />
        <label className="pp-field"><span className="pp-label">Headline</span>
          <input className="input-classic pp-input" maxLength={90} value={head.bannerHeadline} onChange={(e) => setHead({ ...head, bannerHeadline: e.target.value })} placeholder={p.name} /></label>
        <label className="pp-field"><span className="pp-label">One line</span>
          <input className="input-classic pp-input" maxLength={160} value={head.bannerTagline} onChange={(e) => setHead({ ...head, bannerTagline: e.target.value })} placeholder={`${p.typeLabel} · ${p.city}`} /></label>
        <button type="button" className="btn-outline pp-btn" disabled={busy === 'head'} onClick={() => act('head', 'updatePartnerProfile', head, 'Saved — SwapSutra will check the new words.')}>Save banner words</button>
      </section>

      <section className="pp-card">
        <div className="pp-form__head">
          <h2 className="pp-h2">Your ads</h2>
          {!adForm && <button type="button" className="btn-primary pp-btn" onClick={() => { setAdErr({}); setAdForm({ headline: '', tagline: '', imageUrl: '', linkUrl: p.website || '', ctaLabel: '', placement: 'both' }); }}>+ New ad</button>}
        </div>
        {adForm && (
          <div className="pp-adform">
            <label className="pp-field"><span className="pp-label">Headline *</span>
              <input className="input-classic pp-input" maxLength={90} value={adForm.headline} onChange={(e) => setAdForm({ ...adForm, headline: e.target.value })} />
              {adErr.headline && <span className="pp-error">{adErr.headline}</span>}</label>
            <label className="pp-field"><span className="pp-label">One line</span>
              <input className="input-classic pp-input" maxLength={160} value={adForm.tagline} onChange={(e) => setAdForm({ ...adForm, tagline: e.target.value })} /></label>
            <div className="pp-field"><span className="pp-label">Picture *</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => uploadAdImage(e.target.files?.[0])} aria-label="Upload the ad picture" />
              {adForm.imageUrl && <img className="pp-thumb" src={adImageSrc(adForm.imageUrl)} alt="" referrerPolicy="no-referrer" />}
              {adErr.imageUrl && <span className="pp-error">{adErr.imageUrl}</span>}</div>
            <label className="pp-field"><span className="pp-label">Link (https://…) *</span>
              <input className="input-classic pp-input" type="url" value={adForm.linkUrl} onChange={(e) => setAdForm({ ...adForm, linkUrl: e.target.value })} placeholder="Your website, Instagram or book page" />
              {adErr.linkUrl && <span className="pp-error">{adErr.linkUrl}</span>}</label>
            <label className="pp-field"><span className="pp-label">Where</span>
              <select className="input-classic pp-input" value={adForm.placement} onChange={(e) => setAdForm({ ...adForm, placement: e.target.value })}>
                <option value="both">Library banner + between the books</option><option value="banner">Library banner only</option><option value="shelf">Between the books only</option>
              </select></label>
            <div className="pp-actions">
              <button type="button" className="btn-primary pp-btn" disabled={busy === 'ad'} onClick={saveAd}>{busy === 'ad' ? 'Sending…' : 'Send for approval'}</button>
              <button type="button" className="pp-link" onClick={() => setAdForm(null)}>Cancel</button>
            </div>
          </div>
        )}
        {(dash.ads || []).length === 0 && !adForm ? <p className="pp-hint">No ads yet.</p> : (
          <ul className="pp-list">
            {(dash.ads || []).map((a) => (
              <li key={a.id}>
                <div><b>{a.headline}</b><span className="pp-hint">{a.status === 'pending' ? 'Waiting for approval' : a.status === 'live' ? `Approved · ${a.clicks} clicks` : a.status === 'rejected' ? `Not approved${a.reviewNote ? ': ' + a.reviewNote : ''}` : a.status}</span></div>
                <div className="pp-actions">
                  <button type="button" className="pp-link" onClick={() => setAdForm({ id: a.id, headline: a.headline, tagline: a.tagline, imageUrl: a.imageUrl, linkUrl: a.linkUrl, ctaLabel: a.ctaLabel, placement: a.placement })}>Edit</button>
                  {a.status === 'live' && <button type="button" className="pp-link" onClick={() => act('adp_' + a.id, 'savePartnerAd', { id: a.id, status: 'paused' })}>Pause</button>}
                  <button type="button" className="pp-link" onClick={() => window.confirm('Remove this ad?') && act('adr_' + a.id, 'savePartnerAd', { id: a.id, status: 'removed' })}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AccountTab({ dash, act, busy }: { dash: PartnerDash; act: Act; busy: string }) {
  const p = dash.partner!;
  const [upi, setUpi] = useState({ upiId: dash.payoutAccount?.upiId || '', payeeName: dash.payoutAccount?.payeeName || p.registeredName || '' });
  const [prof, setProf] = useState({ phone: p.phone, website: p.website, instagram: p.instagram, about: p.about });
  const [picking, setPicking] = useState(false);
  const contract = PARTNER_CONTRACTS[p.type];
  const [showContract, setShowContract] = useState(false);
  return (
    <div className="pp-grid">
      <section className="pp-card">
        <h2 className="pp-h2">Where your payouts go</h2>
        <label className="pp-field"><span className="pp-label">UPI ID</span>
          <input className="input-classic pp-input" value={upi.upiId} onChange={(e) => setUpi({ ...upi, upiId: e.target.value })} placeholder="name@okbank" /></label>
        <label className="pp-field"><span className="pp-label">Name on the account</span>
          <input className="input-classic pp-input" value={upi.payeeName} onChange={(e) => setUpi({ ...upi, payeeName: e.target.value })} /></label>
        <button type="button" className="btn-primary pp-btn" disabled={busy === 'upi'} onClick={() => act('upi', 'savePayoutAccount', upi)}>Save payout UPI</button>
        <p className="pp-hint">SwapSutra pays each month's orders after the month ends, minus {p.commissionNow}% commission{p.commissionPlan === 'free_first_year' && p.commissionFreeUntil ? ` (0% until ${dateLabel(p.commissionFreeUntil)})` : ''}.</p>
      </section>
      <section className="pp-card">
        <h2 className="pp-h2">Your details</h2>
        <label className="pp-field"><span className="pp-label">Mobile</span><input className="input-classic pp-input" value={prof.phone} onChange={(e) => setProf({ ...prof, phone: e.target.value })} /></label>
        <label className="pp-field"><span className="pp-label">Website</span><input className="input-classic pp-input" value={prof.website} onChange={(e) => setProf({ ...prof, website: e.target.value })} placeholder="https://…" /></label>
        <label className="pp-field"><span className="pp-label">Instagram</span><input className="input-classic pp-input" value={prof.instagram} onChange={(e) => setProf({ ...prof, instagram: e.target.value })} /></label>
        <label className="pp-field"><span className="pp-label">About</span><textarea className="input-classic pp-input" rows={3} value={prof.about} onChange={(e) => setProf({ ...prof, about: e.target.value })} /></label>
        <button type="button" className="btn-outline pp-btn" disabled={busy === 'prof'} onClick={() => act('prof', 'updatePartnerProfile', prof)}>Save details</button>
        <div className="pp-field">
          <span className="pp-label">Google location</span>
          {picking
            ? <LocationPinPicker submitLabel="Use this location" onCancel={() => setPicking(false)} initial={p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null}
                onSubmit={(v) => { setPicking(false); act('loc', 'updatePartnerProfile', { lat: v.lat, lng: v.lng, placeLabel: v.label }); }} />
            : (<>
                {p.lat !== null && p.lng !== null && <LocationCard lat={p.lat} lng={p.lng} label={p.placeLabel || p.name} compact />}
                <button type="button" className="pp-link" onClick={() => setPicking(true)}>{p.lat !== null ? 'Change the pin' : 'Pin your location'}</button>
              </>)}
        </div>
        <p className="pp-hint">To change your registered name, PAN or documents, write to swapsutra@gmail.com.</p>
      </section>
      <section className="pp-card">
        <h2 className="pp-h2">Your agreement</h2>
        <p className="pp-hint">Signed by <b>{p.contractSignedName}</b> on {dateLabel(p.contractSignedAt)} · version {p.contractVersion}{p.contractVersion !== p.currentContractVersion ? ' (a newer version exists — SwapSutra will ask you to sign it)' : ''}.</p>
        <p className="pp-hint">Documents on file: {p.docs.map((d) => d.label).join(' · ') || '—'}</p>
        <button type="button" className="pp-link" onClick={() => setShowContract((v) => !v)}>{showContract ? 'Hide the agreement' : 'Read the agreement'}</button>
        {showContract && (
          <div className="pp-contract">
            {contract.sections.map((s) => <section key={s.title}><h4>{s.title}</h4>{s.body.map((t, i) => <p key={i}>{t}</p>)}</section>)}
          </div>
        )}
      </section>
    </div>
  );
}
