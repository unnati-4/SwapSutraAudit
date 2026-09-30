import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../../config/runtime';
import { MUG_CATEGORIES } from '../../data/mugCategories';

/**
 * Admin → Mugs → Shop listings (30 Sep 2026).
 *
 * The admin lists a mug sold on Amazon, Flipkart or any other store by
 * pasting its product link plus the name, photo link and price shown on
 * that page. Nothing is scraped. On the shop, "Buy on Amazon/Flipkart"
 * opens that link in a new tab — the order happens on the store.
 * No ratings or reviews can be typed in (they would be unverifiable).
 */

const API = apiUrl('/api/swapsutra');
type Row = Record<string, any>;
const EMPTY = { id: '', title: '', description: '', category: 'bookish', imageUrl: '', price: '', mrp: '', sourceUrl: '', affiliateUrl: '', sourceMarketplace: '', vendor: '', availability: '', sortOrder: '', status: 'draft' };

/** Same rule as Apps Script's mugMarketplaceFromUrl_, for the live hint. */
export function marketplaceFromUrl(url: string): string {
  const m = String(url || '').toLowerCase().match(/^https:\/\/([^/?#]+)/);
  const host = m ? m[1].replace(/^www\./, '') : '';
  if (/(^|\.)amazon\.(in|com)$|^amzn\.(to|in|eu)$|^a\.co$/.test(host)) return 'Amazon';
  if (/(^|\.)flipkart\.com$|^fkrt\.(it|cc|co)$|^fktr\.in$/.test(host)) return 'Flipkart';
  return '';
}

async function post(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return res.json();
}

export default function AdminMugProducts() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await post('getAdminMugProducts');
      if (!d?.success) throw new Error(d?.message || 'Could not load the mug listings.');
      setItems(d.items || []);
    } catch (e: any) { setError(e?.message || 'Could not load the mug listings.'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const live = useMemo(() => items.filter((i) => String(i.status).toLowerCase() === 'live').length, [items]);
  const detected = form ? marketplaceFromUrl(form.sourceUrl) : '';
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const edit = (i: Row) => {
    setErrors({}); setNote('');
    setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, i[k] === undefined || i[k] === null ? '' : String(i[k])])) } as typeof EMPTY);
  };

  const save = async (override?: Partial<typeof EMPTY>) => {
    if (!form) return;
    const body = { ...form, ...override };
    setSaving(true); setErrors({}); setNote('');
    try {
      const d = await post('saveMugProduct', body);
      if (!d?.success) { setErrors(d?.errors || {}); setNote(d?.message || 'Could not save.'); }
      else { setNote(body.status === 'removed' ? 'Removed from the shop.' : body.status === 'live' ? 'Saved — it is live on /mugs.' : 'Saved as a draft.'); setForm(null); await load(); }
    } catch { setNote('Could not save — check your connection and try again.'); }
    setSaving(false);
  };

  const field = (k: keyof typeof EMPTY, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: React.ReactNode) => (
    <label className="admin-mugp__field">
      <span className="mug-field__label">{label}</span>
      <input className="mug-input" value={form ? String(form[k]) : ''} onChange={set(k)} {...props} />
      {hint && <span className="type-caption">{hint}</span>}
      {errors[k] && <span className="mug-field__error" role="alert">{errors[k]}</span>}
    </label>
  );

  return (
    <div className="admin-mugs admin-mugp" data-testid="admin-mug-products">
      <div className="admin-mugs__bar">
        <h3 className="type-h3">Mug shop listings</h3>
        <span className="type-caption">{live} live</span>
        <button type="button" className="mug-btn mug-btn--solid" onClick={() => { setErrors({}); setNote(''); setForm({ ...EMPTY }); }}>+ Add a mug</button>
        <button type="button" className="mug-btn mug-btn--quiet" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <p className="type-caption">
        Paste the Amazon or Flipkart product link (an affiliate link works too) and copy the name, photo link and price from that page.
        Shoppers tap “Buy on Amazon/Flipkart” and the store opens in a new tab. The shop shows “Coming soon” until at least one mug is live.
      </p>
      {error && <p className="mug-field__error" role="alert">{error}</p>}
      {note && !form && <p className="type-caption" role="status">{note}</p>}

      {form && (
        <form className="admin-mugp__form" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="admin-mug-form">
          {field('sourceUrl', 'Product link *', { type: 'url', inputMode: 'url', placeholder: 'https://www.amazon.in/dp/… or https://www.flipkart.com/…' },
            detected ? <>Detected: <strong>{detected}</strong> — the button will say “Buy on {detected}”.</> : form.sourceUrl ? 'Other store — name it below.' : null)}
          {!detected && field('sourceMarketplace', 'Store name', { placeholder: 'e.g. Chumbak, The Souled Store' })}
          {field('affiliateUrl', 'Affiliate link (optional)', { type: 'url', placeholder: 'https://amzn.to/… — used for the Buy button if given' })}
          {field('title', 'Mug name *', { maxLength: 120 })}
          <label className="admin-mugp__field">
            <span className="mug-field__label">Category *</span>
            <select className="mug-input" value={form.category} onChange={set('category')}>
              {MUG_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {errors.category && <span className="mug-field__error" role="alert">{errors.category}</span>}
          </label>
          {field('imageUrl', 'Photo link (needed to go live)', { type: 'url', placeholder: 'https://… (right-click the product photo → Copy image address)' })}
          {form.imageUrl.startsWith('https://') && <img className="admin-mugp__preview" src={form.imageUrl} alt="" />}
          <div className="admin-mugp__row">
            {field('price', 'Price ₹', { inputMode: 'numeric', placeholder: '499' })}
            {field('mrp', 'MRP ₹ (optional)', { inputMode: 'numeric', placeholder: '799' })}
          </div>
          <label className="admin-mugp__field">
            <span className="mug-field__label">Short description</span>
            <textarea className="mug-input mug-textarea" rows={2} maxLength={400} value={form.description} onChange={set('description')} />
          </label>
          <div className="admin-mugp__row">
            {field('availability', 'Availability note', { placeholder: 'e.g. Ships in 2 days' })}
            {field('sortOrder', 'Order on shelf', { inputMode: 'numeric', placeholder: '0 = first' })}
          </div>
          <label className="admin-mugp__field">
            <span className="mug-field__label">Status</span>
            <select className="mug-input" value={form.status} onChange={set('status')}>
              <option value="draft">Draft (hidden)</option>
              <option value="live">Live on the shop</option>
            </select>
          </label>
          <div className="admin-mugs__bar">
            <button type="submit" className="mug-btn mug-btn--solid" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setForm(null)}>Cancel</button>
            {form.id && <button type="button" className="mug-btn mug-btn--quiet" disabled={saving} onClick={() => save({ status: 'removed' })}>Remove from shop</button>}
            {note && <span className="type-caption" role="status">{note}</span>}
          </div>
        </form>
      )}

      {items.length > 0 && (
        <ul className="admin-mugp__list">
          {items.map((i) => (
            <li key={i.id}>
              {i.imageUrl ? <img src={i.imageUrl} alt="" /> : <span className="admin-mugp__noimg" aria-hidden="true">☕</span>}
              <span className="admin-mugp__meta">
                <strong>{i.title}</strong>
                <span className="type-caption">{i.sourceMarketplace || 'Store'} · {i.price ? `₹${i.price}` : 'no price'} · {i.category}</span>
              </span>
              <span className={`admin-mugs__status is-${String(i.status).toLowerCase()}`}>{String(i.status).toLowerCase() === 'live' ? 'Live' : 'Draft'}</span>
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => edit(i)}>Edit</button>
            </li>
          ))}
        </ul>
      )}
      {!loading && !items.length && !error && <p className="type-caption">No mugs listed yet. Tap “+ Add a mug”.</p>}
    </div>
  );
}
