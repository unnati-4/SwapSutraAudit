import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../config/runtime';
import { downscaleImageFile, fileToDataUrl } from '../utils/imageCompress';
import { AD_KIND_LABEL, adImageSrc, type AdKind } from '../utils/ads';

/**
 * Admin → Ads (9 Oct 2026).
 *
 * The admin places an ad for a bookstore, an author or a particular book.
 * It shows on the Library banner, between the books on the shelf, or both,
 * from an optional start date to an optional end date. Every ad says
 * "Sponsored" on the site. Clicks are counted (nothing about the reader).
 */

const API = apiUrl('/api/swapsutra');
type Row = Record<string, any>;
const EMPTY = {
  id: '', kind: 'bookstore' as AdKind, sponsor: '', headline: '', tagline: '', imageUrl: '', linkUrl: '', bookId: '',
  ctaLabel: '', placement: 'both', status: 'live', startDate: '', endDate: '',
};
type Form = typeof EMPTY;

const PLACEMENT_LABEL: Record<string, string> = {
  both: 'Library banner + between the books',
  banner: 'Library banner only',
  shelf: 'Between the books only',
};

/** A SwapSutra book link (…/book/ID) or a bare ID → the listing ID. */
export function bookIdFromInput(v: string): string {
  const s = String(v || '').trim();
  const m = /\/book\/([^/?#\s]+)/.exec(s);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return /^[\w-]{1,60}$/.test(s) ? s : '';
}

async function post(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return res.json();
}

export default function AdminSponsoredAds() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await post('getAdminSponsoredAds');
      if (!d?.success) throw new Error(d?.message || 'Could not load the ads.');
      setItems(d.items || []);
    } catch (e: any) { setError(e?.message || 'Could not load the ads.'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const showing = useMemo(() => items.filter((i) => i.showingNow).length, [items]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const edit = (i: Row) => {
    setErrors({}); setNote('');
    setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, i[k] === undefined || i[k] === null ? '' : String(i[k])])) as Form);
  };

  const save = async (override?: Partial<Form>) => {
    if (!form) return;
    const body = { ...form, ...override };
    body.bookId = bookIdFromInput(body.bookId);
    setSaving(true); setErrors({}); setNote('');
    try {
      const d = await post('saveSponsoredAd', body);
      if (!d?.success) { setErrors(d?.errors || {}); setNote(d?.message || 'Could not save.'); }
      else {
        setNote(body.status === 'removed' ? 'Ad removed.' : body.status === 'paused' ? 'Saved — paused (not showing).' : 'Saved — the ad is live in the Library.');
        setForm(null); await load();
      }
    } catch { setNote('Could not save — check your connection and try again.'); }
    setSaving(false);
  };

  const quick = async (row: Row, status: string) => {
    if (status === 'removed' && !window.confirm(`Remove the ad “${row.headline}”?`)) return;
    setNote('');
    const d = await post('saveSponsoredAd', { ...row, status }).catch(() => null);
    if (!d?.success) setNote(d?.message || 'Could not update the ad.');
    await load();
  };

  const upload = async (file?: File | null) => {
    if (!file || !form) return;
    setUploading(true); setErrors((e) => ({ ...e, imageUrl: '' }));
    try {
      const small = await downscaleImageFile(file);
      const dataUrl = await fileToDataUrl(small);
      const d = await post('uploadSponsoredAdImage', { dataUrl });
      if (d?.success && d.url) setForm((f) => (f ? { ...f, imageUrl: d.url } : f));
      else setErrors((e) => ({ ...e, imageUrl: d?.message || 'The picture could not be uploaded.' }));
    } catch { setErrors((e) => ({ ...e, imageUrl: 'The picture could not be uploaded.' })); }
    setUploading(false);
  };

  const field = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: React.ReactNode) => (
    <label className="admin-mugp__field">
      <span className="mug-field__label">{label}</span>
      <input className="mug-input" value={form ? String(form[k]) : ''} onChange={set(k)} {...props} />
      {hint && <span className="type-caption">{hint}</span>}
      {errors[k] && <span className="mug-field__error" role="alert">{errors[k]}</span>}
    </label>
  );

  return (
    <div className="admin-mugs admin-mugp" data-testid="admin-sponsored-ads">
      <div className="admin-mugs__bar">
        <h3 className="type-h3">Sponsored ads</h3>
        <span className="type-caption">{showing} showing now</span>
        <button type="button" className="mug-btn mug-btn--solid" onClick={() => { setErrors({}); setNote(''); setForm({ ...EMPTY }); }}>+ New ad</button>
        <button type="button" className="mug-btn mug-btn--quiet" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <p className="type-caption">
        Advertise a bookstore, an author or a particular book. The ad shows on the Library banner and/or between the books on the shelf,
        always marked “Sponsored”. The shelf is shuffled every time someone opens the Library, so ads and mugs land in new places.
      </p>
      {error && <p className="mug-field__error" role="alert">{error}</p>}
      {note && !form && <p className="type-caption" role="status">{note}</p>}

      {form && (
        <form className="admin-mugp__form" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="admin-ad-form">
          <div className="admin-mugp__row">
            <label className="admin-mugp__field">
              <span className="mug-field__label">The ad is for *</span>
              <select className="mug-input" value={form.kind} onChange={set('kind')}>
                <option value="bookstore">A bookstore</option>
                <option value="author">An author</option>
                <option value="book">A particular book</option>
              </select>
              {errors.kind && <span className="mug-field__error" role="alert">{errors.kind}</span>}
            </label>
            {field('sponsor', form.kind === 'bookstore' ? 'Bookstore name *' : form.kind === 'author' ? 'Author name *' : 'Publisher / seller / author *', { maxLength: 80 })}
          </div>
          {field('headline', 'Headline *', { maxLength: 90, placeholder: form.kind === 'book' ? 'e.g. The new Ruskin Bond is here' : 'e.g. 20% off every Saturday' })}
          <label className="admin-mugp__field">
            <span className="mug-field__label">One line about it</span>
            <textarea className="mug-input mug-textarea" rows={2} maxLength={160} value={form.tagline} onChange={set('tagline')} />
          </label>

          <div className="admin-mugp__field">
            <span className="mug-field__label">Ad picture *</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
              onChange={(e) => upload(e.target.files?.[0])} aria-label="Upload the ad picture" />
            <span className="type-caption">{uploading ? 'Uploading…' : 'Upload a picture (a wide one works best on the banner), or paste a link below.'}</span>
            <input className="mug-input" type="url" value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://… (an image link or a Google Drive share link)" aria-label="Ad picture link" />
            {errors.imageUrl && <span className="mug-field__error" role="alert">{errors.imageUrl}</span>}
            {form.imageUrl.startsWith('https://') && <img className="admin-mugp__preview" src={adImageSrc(form.imageUrl)} alt="" referrerPolicy="no-referrer" />}
          </div>

          {field('linkUrl', form.kind === 'book' ? 'Link (optional if you pick the SwapSutra listing)' : 'Link the ad opens *', { type: 'url', inputMode: 'url', placeholder: 'https://… (store website, Instagram, Amazon page…)' })}
          {form.kind === 'book' && field('bookId', 'SwapSutra listing (optional)', { placeholder: 'Paste the book’s SwapSutra link (…/book/…) or its ID' },
            form.bookId && bookIdFromInput(form.bookId) ? <>Opens the listing <strong>{bookIdFromInput(form.bookId)}</strong> on SwapSutra.</> : 'If the book is listed on SwapSutra, the ad opens its page here.')}
          {field('ctaLabel', 'Button text (optional)', { maxLength: 30, placeholder: form.kind === 'bookstore' ? 'Visit the store' : form.kind === 'author' ? 'Meet the author' : 'See the book' })}

          <label className="admin-mugp__field">
            <span className="mug-field__label">Where it shows</span>
            <select className="mug-input" value={form.placement} onChange={set('placement')}>
              {Object.entries(PLACEMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="admin-mugp__row">
            {field('startDate', 'From (optional)', { type: 'date' })}
            {field('endDate', 'Until (optional)', { type: 'date' })}
          </div>
          <label className="admin-mugp__field">
            <span className="mug-field__label">Status</span>
            <select className="mug-input" value={form.status} onChange={set('status')}>
              <option value="live">Live</option>
              <option value="paused">Paused (not showing)</option>
            </select>
          </label>
          {note && <p className="type-caption" role="status">{note}</p>}
          <div className="admin-mugs__bar">
            <button type="submit" className="mug-btn mug-btn--solid" disabled={saving || uploading}>{saving ? 'Saving…' : 'Save ad'}</button>
            <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {!loading && !items.length && !form && <p className="type-caption">No ads yet. Tap “+ New ad” to place the first one.</p>}
      <ul className="admin-ads__list">
        {items.map((i) => (
          <li key={i.id} className="admin-ads__item" data-testid="admin-ad-row">
            {i.imageUrl ? <img src={adImageSrc(String(i.imageUrl))} alt="" referrerPolicy="no-referrer" /> : <span className="admin-ads__noimg" />}
            <div className="admin-ads__info">
              <p className="admin-ads__title">{i.headline}</p>
              <p className="type-caption">
                {AD_KIND_LABEL[i.kind as AdKind] || i.kind} · {i.sponsor} · {PLACEMENT_LABEL[i.placement] || i.placement}
              </p>
              <p className="type-caption">
                <strong>{i.status === 'pending' ? 'Waiting for your approval' : i.status === 'rejected' ? 'Not approved' : i.showingNow ? 'Showing now' : i.status === 'paused' ? 'Paused'
                  : i.partnerName && i.partnerPromotionActive === false ? 'Not showing (partner\'s promotion is not paid)' : 'Not showing (outside its dates)'}</strong>
                {i.partnerName ? ` · partner: ${i.partnerName}` : ''}
                {(i.startDate || i.endDate) ? ` · ${i.startDate || '…'} → ${i.endDate || '…'}` : ''} · {Number(i.clicks) || 0} clicks
              </p>
            </div>
            <div className="admin-ads__actions">
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => edit(i)}>Edit</button>
              {i.status === 'live'
                ? <button type="button" className="mug-btn mug-btn--quiet" onClick={() => quick(i, 'paused')}>Pause</button>
                : <button type="button" className={i.status === 'pending' ? 'mug-btn mug-btn--solid' : 'mug-btn mug-btn--quiet'} onClick={() => quick(i, 'live')}>{i.status === 'pending' ? 'Approve' : 'Make live'}</button>}
              {i.status === 'pending' && (
                <button type="button" className="mug-btn mug-btn--quiet" onClick={() => { const r = window.prompt('Why is it not approved?'); if (r) quick({ ...i, reviewNote: r }, 'rejected'); }}>Reject</button>
              )}
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => quick(i, 'removed')}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
