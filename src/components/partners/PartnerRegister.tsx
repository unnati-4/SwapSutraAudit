import React, { useMemo, useState } from 'react';
import { LocationPinPicker, LocationCard } from '../LocationPin';
import { PARTNER_CONTRACTS, PARTNER_LABEL, type PartnerType } from '../../data/partnerContracts';
import { fileForUpload, partnerPost, type PartnerView } from './partnerApi';

/**
 * Partner registration (9 Oct 2026) — a separate form for each type:
 * bookstore, author, publisher, promoter. Google location, documents,
 * banner / ads choice, and the type's own agreement signed by typing the
 * full name. Used for a first application and for "changes requested".
 */

const NAME_LABEL: Record<PartnerType, string> = {
  bookstore: 'Bookstore name', author: 'Author name (as printed on your books)', publisher: 'Publisher / imprint name', promoter: 'Agency or promoter name',
};
const REGISTERED_LABEL: Record<PartnerType, string> = {
  bookstore: 'Registered in the name of (owner / firm)', author: 'Your name as on your PAN card', publisher: 'Registered company / firm name', promoter: 'Your name (or firm) as on the PAN card',
};
const NEEDS_LOCATION: Record<PartnerType, boolean> = { bookstore: true, author: false, publisher: true, promoter: false };
const DOCS: Record<PartnerType, { key: string; label: string; required: boolean }[]> = {
  bookstore: [
    { key: 'aadhaar', label: "Owner's Aadhaar — masked (only the last 4 digits visible)", required: true },
    { key: 'pan', label: "Owner's PAN card", required: true },
    { key: 'businessProof', label: 'Shop registration / GST certificate / Udyam / trade licence', required: true },
    { key: 'other', label: 'Any other document (optional)', required: false },
  ],
  author: [
    { key: 'aadhaar', label: 'Aadhaar — masked (only the last 4 digits visible)', required: true },
    { key: 'pan', label: 'PAN card', required: true },
    { key: 'other', label: 'Proof of authorship — e.g. your book\'s copyright page (optional)', required: false },
  ],
  publisher: [
    { key: 'aadhaar', label: "Signatory's Aadhaar — masked (only the last 4 digits visible)", required: true },
    { key: 'pan', label: 'PAN card (business or signatory)', required: true },
    { key: 'businessProof', label: 'Company / GST / Udyam registration', required: true },
    { key: 'other', label: 'Any other document (optional)', required: false },
  ],
  promoter: [
    { key: 'aadhaar', label: 'Aadhaar — masked (only the last 4 digits visible)', required: true },
    { key: 'pan', label: 'PAN card', required: true },
    { key: 'businessProof', label: 'Business registration (optional)', required: false },
    { key: 'other', label: 'Any other document (optional)', required: false },
  ],
};
const TYPE_FIELDS: Record<PartnerType, { key: string; label: string; required?: boolean; placeholder?: string; long?: boolean }[]> = {
  bookstore: [
    { key: 'storeType', label: 'What do you sell?', placeholder: 'New books, second-hand, both…' },
    { key: 'openingHours', label: 'Opening hours', placeholder: 'e.g. 10 am – 8 pm, closed Tuesday' },
    { key: 'genres', label: 'Genres you are known for', placeholder: 'Fiction, exam prep, children\'s…' },
  ],
  author: [
    { key: 'penName', label: 'Pen name (if different)' },
    { key: 'booksPublished', label: 'Your books (title, year, ISBN if you have it)', required: true, long: true },
    { key: 'genres', label: 'Genres you write', placeholder: 'Poetry, thriller…' },
  ],
  publisher: [
    { key: 'imprints', label: 'Imprints', placeholder: 'If you publish under more than one name' },
    { key: 'yearEstablished', label: 'Year established', placeholder: '2015' },
    { key: 'genres', label: 'What you publish', placeholder: 'Hindi literature, academic…' },
  ],
  promoter: [
    { key: 'promotes', label: 'What do you promote?', required: true, placeholder: 'Books, authors, launches, literary events…', long: true },
    { key: 'clients', label: 'Authors / publishers / stores you work with', long: true },
  ],
};

type Form = {
  name: string; contactName: string; phone: string; about: string; website: string; instagram: string; address: string; city: string; pincode: string;
  lat: number | null; lng: number | null; placeLabel: string; registeredName: string; gstin: string; panNumber: string; aadhaarLast4: string;
  showBanner: boolean; runAds: boolean; typeFields: Record<string, string>; agree: boolean; signedName: string;
};

export default function PartnerRegister({ initialType, existing, onDone }: {
  initialType?: PartnerType; existing?: PartnerView | null; onDone: () => void;
}) {
  const [type, setType] = useState<PartnerType | null>(existing?.type || initialType || null);
  const [form, setForm] = useState<Form>(() => ({
    name: existing?.name || '', contactName: existing?.contactName || '', phone: existing?.phone || '', about: existing?.about || '',
    website: existing?.website || '', instagram: existing?.instagram || '', address: existing?.address || '', city: existing?.city || '',
    pincode: existing?.pincode || '', lat: existing?.lat ?? null, lng: existing?.lng ?? null, placeLabel: existing?.placeLabel || '',
    registeredName: existing?.registeredName || '', gstin: existing?.gstin || '', panNumber: '', aadhaarLast4: existing?.aadhaarLast4 || '',
    showBanner: existing ? existing.showBanner : true, runAds: existing ? existing.runAds : true, typeFields: existing?.typeFields || {},
    agree: false, signedName: '',
  }));
  const [docs, setDocs] = useState<Record<string, { dataUrl: string; name: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const onFile = existing ? new Set(existing.docs.map((d) => d.key)) : new Set<string>();
  const contract = type ? PARTNER_CONTRACTS[type] : null;
  const sameType = !!existing && existing.type === type;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <label className="pp-field">
      <span className="pp-label">{label}</span>
      <input className="input-classic pp-input" value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} {...props} />
      {hint && <span className="pp-hint">{hint}</span>}
      {errors[k] && <span className="pp-error" role="alert">{errors[k]}</span>}
    </label>
  );

  const pickDoc = async (key: string, file?: File | null) => {
    if (!file) return;
    const r = await fileForUpload(file, { allowPdf: true, maxMb: 4 });
    if (r.error) { setErrors((e) => ({ ...e, ['doc_' + key]: r.error! })); return; }
    setErrors((e) => ({ ...e, ['doc_' + key]: '' }));
    setDocs((d) => ({ ...d, [key]: { dataUrl: r.dataUrl!, name: file.name } }));
  };

  const missing = useMemo(() => {
    if (!type) return [];
    return DOCS[type].filter((d) => d.required && !docs[d.key] && !(sameType && onFile.has(d.key))).map((d) => d.label);
  }, [type, docs, sameType]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type || !contract) return;
    setBusy(true); setErrors({}); setNote('');
    try {
      const d = await partnerPost('submitPartnerApplication', {
        type, ...form, panNumber: form.panNumber.trim().toUpperCase(), gstin: form.gstin.trim().toUpperCase(),
        lat: form.lat ?? '', lng: form.lng ?? '',
        docs: Object.fromEntries(Object.keys(docs).map((k) => [k, docs[k].dataUrl])),
        contractVersion: contract.version,
      });
      if (d?.success) { setNote(d.message); onDone(); }
      else {
        setErrors(d?.errors || {});
        setNote(d?.message || 'Could not send the application.');
        window.setTimeout(() => document.querySelector('.pp-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      }
    } catch { setNote('Could not reach SwapSutra. Check your connection and try again.'); }
    setBusy(false);
  };

  if (!type) {
    return (
      <section className="pp-card" data-testid="partner-type-pick">
        <h2 className="pp-h2">What are you registering as?</h2>
        <div className="pp-types">
          {(Object.keys(PARTNER_LABEL) as PartnerType[]).map((t) => (
            <button key={t} type="button" className="pp-type" onClick={() => setType(t)}>
              <b>{PARTNER_LABEL[t]}</b>
              <span>{t === 'bookstore' ? 'A shop selling new or second-hand books' : t === 'author' ? 'You wrote the books you want to sell or promote' : t === 'publisher' ? 'You publish or distribute books' : 'You promote books, authors or literary events'}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <form className="pp-card pp-form" onSubmit={submit} data-testid="partner-register-form" noValidate>
      <div className="pp-form__head">
        <h2 className="pp-h2">{PARTNER_LABEL[type]} registration</h2>
        {!existing && <button type="button" className="pp-link" onClick={() => setType(null)}>Change type</button>}
      </div>
      {existing?.status === 'CHANGES_REQUESTED' && existing.reviewNote && (
        <p className="pp-alert" role="alert">SwapSutra asked for a change: {existing.reviewNote}</p>
      )}

      <fieldset className="pp-fieldset">
        <legend>About you</legend>
        {text('name', NAME_LABEL[type] + ' *', { maxLength: 100 })}
        {text('contactName', (type === 'bookstore' || type === 'publisher' ? 'Owner / authorised person — full name' : 'Your full name') + ' *', { maxLength: 80, autoComplete: 'name' })}
        {text('phone', 'Mobile number *', { inputMode: 'tel', autoComplete: 'tel', placeholder: '98xxxxxxxx' })}
        {TYPE_FIELDS[type].map((f) => (
          <label className="pp-field" key={f.key}>
            <span className="pp-label">{f.label}{f.required ? ' *' : ''}</span>
            {f.long
              ? <textarea className="input-classic pp-input" rows={3} value={form.typeFields[f.key] || ''} placeholder={f.placeholder} onChange={(e) => set('typeFields', { ...form.typeFields, [f.key]: e.target.value })} />
              : <input className="input-classic pp-input" value={form.typeFields[f.key] || ''} placeholder={f.placeholder} onChange={(e) => set('typeFields', { ...form.typeFields, [f.key]: e.target.value })} />}
            {errors[f.key] && <span className="pp-error" role="alert">{errors[f.key]}</span>}
          </label>
        ))}
        <label className="pp-field">
          <span className="pp-label">About (optional)</span>
          <textarea className="input-classic pp-input" rows={3} maxLength={600} value={form.about} onChange={(e) => set('about', e.target.value)} placeholder="A few lines readers will see" />
        </label>
        <div className="pp-row">
          {text('website', 'Website (optional)', { type: 'url', placeholder: 'https://…' })}
          {text('instagram', 'Instagram (optional)', { placeholder: '@yourhandle' })}
        </div>
      </fieldset>

      <fieldset className="pp-fieldset">
        <legend>Where you are</legend>
        {NEEDS_LOCATION[type] && text('address', 'Full address *', { maxLength: 300, autoComplete: 'street-address' })}
        <div className="pp-row">
          {text('city', 'City *', { maxLength: 60, autoComplete: 'address-level2' })}
          {text('pincode', 'Pincode *', { inputMode: 'numeric', maxLength: 6, autoComplete: 'postal-code' })}
        </div>
        <div className="pp-field">
          <span className="pp-label">Google location{NEEDS_LOCATION[type] ? ' *' : ' (optional)'}</span>
          {form.lat !== null && form.lng !== null && !picking
            ? (<>
                <LocationCard lat={form.lat} lng={form.lng} label={form.placeLabel || form.name} compact />
                <button type="button" className="pp-link" onClick={() => setPicking(true)}>Change the pin</button>
              </>)
            : picking
              ? <LocationPinPicker submitLabel="Use this location" onCancel={() => setPicking(false)}
                  initial={form.lat !== null && form.lng !== null ? { lat: form.lat, lng: form.lng } : null}
                  onSubmit={(v) => { setForm((f) => ({ ...f, lat: v.lat, lng: v.lng, placeLabel: v.label })); setPicking(false); }} />
              : <button type="button" className="btn-outline pp-btn" onClick={() => setPicking(true)}>📍 Pin {type === 'bookstore' ? 'your store' : 'your location'} on Google Maps</button>}
          {errors.location && <span className="pp-error" role="alert">{errors.location}</span>}
        </div>
      </fieldset>

      <fieldset className="pp-fieldset">
        <legend>Documents</legend>
        <p className="pp-hint">Kept in SwapSutra's private storage and used only to verify you and to pay you. Readers never see them. Cover the first 8 digits of the Aadhaar before you photograph it.</p>
        {text('registeredName', REGISTERED_LABEL[type] + ' *', { maxLength: 120 })}
        <div className="pp-row">
          {text('panNumber', 'PAN number *', { maxLength: 10, autoComplete: 'off', placeholder: existing?.panMasked ? `On file: ${existing.panMasked} — type it again` : 'ABCDE1234F', style: { textTransform: 'uppercase' } })}
          {text('aadhaarLast4', 'Aadhaar — last 4 digits only *', { inputMode: 'numeric', maxLength: 4, autoComplete: 'off' })}
        </div>
        {(type === 'bookstore' || type === 'publisher') && text('gstin', 'GSTIN (if registered)', { maxLength: 15, style: { textTransform: 'uppercase' } })}
        {DOCS[type].map((d) => (
          <div className="pp-field" key={d.key}>
            <span className="pp-label">{d.label}{d.required ? ' *' : ''}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => pickDoc(d.key, e.target.files?.[0])} aria-label={d.label} />
            <span className="pp-hint">{docs[d.key] ? `✓ ${docs[d.key].name}` : sameType && onFile.has(d.key) ? '✓ Already on file — upload again only to replace it' : 'JPG, PNG, WebP or PDF, under 4 MB'}</span>
            {errors['doc_' + d.key] && <span className="pp-error" role="alert">{errors['doc_' + d.key]}</span>}
          </div>
        ))}
      </fieldset>

      <fieldset className="pp-fieldset">
        <legend>Your banner and ads</legend>
        <label className="pp-check"><input type="checkbox" checked={form.showBanner} onChange={(e) => set('showBanner', e.target.checked)} /> Show my banner on the SwapSutra Library page (with the SwapSutra logo)</label>
        <label className="pp-check"><input type="checkbox" checked={form.runAds} onChange={(e) => set('runAds', e.target.checked)} /> Run my ads between the books on the shelf</label>
        <p className="pp-hint">Free for the first 6 months after approval, then ₹100 for every 2 months. You can change these any time; SwapSutra checks each banner and ad first.</p>
      </fieldset>

      {contract && (
        <fieldset className="pp-fieldset">
          <legend>{contract.title}</legend>
          <div className="pp-contract" tabIndex={0} aria-label={contract.title} data-testid="partner-contract">
            {contract.sections.map((s) => (
              <section key={s.title}>
                <h4>{s.title}</h4>
                {s.body.map((p, i) => <p key={i}>{p}</p>)}
              </section>
            ))}
            <p className="pp-hint">Version {contract.version}</p>
          </div>
          <label className="pp-check"><input type="checkbox" checked={form.agree} onChange={(e) => set('agree', e.target.checked)} /> I have read the {contract.title} and agree to it — including that shipping and delivery are my responsibility.</label>
          {errors.agree && <span className="pp-error" role="alert">{errors.agree}</span>}
          {text('signedName', 'Sign by typing your full name *', { autoComplete: 'off', placeholder: form.contactName || 'Your full name' }, 'It must match the name above.')}
          {errors.contract && <span className="pp-error" role="alert">{errors.contract}</span>}
        </fieldset>
      )}

      {missing.length > 0 && <p className="pp-hint">Still needed: {missing.join(' · ')}</p>}
      {note && <p className={Object.keys(errors).length ? 'pp-error' : 'pp-hint'} role="status">{note}</p>}
      <button type="submit" className="btn-primary pp-submit" disabled={busy}>{busy ? 'Sending…' : existing ? 'Send the updated application' : 'Send my application'}</button>
    </form>
  );
}
