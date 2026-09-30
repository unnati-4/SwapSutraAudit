import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../../config/runtime';
import { downscaleImageFile, fileToDataUrl } from '../../utils/imageCompress';
import {
  CAPACITY_NOTE, EMPTY_MUG_ENQUIRY, MUG_BUDGET_RANGES, MUG_BUDGET_TYPES, MUG_CUSTOM_VOLUME,
  MUG_IMAGE_INPUT_MAX_BYTES, MUG_IMAGE_TYPES, MUG_IMAGE_UPLOAD_MAX_BYTES, MUG_QUANTITY_OPTIONS,
  MUG_TIMELINES, MUG_TYPES, MUG_VOLUME_OPTIONS, mugBrief, stepErrors, toEnquiryPayload, validateMugEnquiry,
  type MugEnquiryForm, type MugErrors,
} from '../../utils/mugEnquiry';

/**
 * "Create My Mug" — the custom mug enquiry (30 Sep 2026).
 *
 * Four steps: 1 Idea → 2 Requirements → 3 Delivery → 4 review, then Done.
 * Full-screen on a phone, a centred sheet on larger screens. Every field is
 * checked here and again by Apps Script; "Your mug idea is on its way" is
 * shown only after the server has stored the enquiry and returned its id.
 * Nothing on this form promises a price, a maker, feasibility or a date.
 */

const STEPS = ['Idea', 'Requirements', 'Delivery', 'Done'];
const API = apiUrl('/api/swapsutra');

function Field({ id, label, error, hint, children, optional }: {
  id: string; label: string; error?: string; hint?: string; optional?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="mug-field">
      <label htmlFor={id} className="mug-field__label">
        {label}{optional && <span className="mug-field__optional"> (optional)</span>}
      </label>
      {children}
      {hint && !error && <p className="mug-field__hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="mug-field__error" id={`${id}-error`} role="alert">{error}</p>}
    </div>
  );
}

function Chips<T extends string>({ name, options, value, onChange, error }: {
  name: string; options: { id: T; label: string; hint?: string }[]; value: string; onChange: (v: T) => void; error?: string;
}) {
  return (
    <div className="mug-chips" role="radiogroup" aria-label={name} aria-invalid={!!error}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`mug-chip ${value === o.id ? 'is-on' : ''}`}
          onClick={() => onChange(o.id)}
        >
          <span>{o.label}</span>
          {o.hint && <span className="mug-chip__hint">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export default function CustomMugEnquiry({ open, onClose, defaults }: {
  open: boolean;
  onClose: () => void;
  defaults?: Partial<MugEnquiryForm>;
}) {
  const [form, setForm] = useState<MugEnquiryForm>({ ...EMPTY_MUG_ENQUIRY, ...defaults });
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<MugErrors>({});
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [imageError, setImageError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [doneId, setDoneId] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  const errors = useMemo(() => validateMugEnquiry(form), [form]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus(), 30);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, sending, onClose]);

  if (!open) return null;

  const set = <K extends keyof MugEnquiryForm>(key: K, value: MugEnquiryForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // A corrected field stops shouting straight away.
    setShown((s) => { const n = { ...s }; delete n[key]; return n; });
  };

  const next = () => {
    const errs = stepErrors(errors, step);
    if (Object.keys(errs).length) {
      setShown(errs);
      const first = Object.keys(errs)[0];
      setTimeout(() => dialogRef.current?.querySelector<HTMLElement>(`#mug-${first}, [aria-label="${first}"] button`)?.focus(), 0);
      return;
    }
    setShown({});
    setStep((s) => Math.min(s + 1, 3));
    dialogRef.current?.querySelector('.mug-modal__body')?.scrollTo({ top: 0 });
  };

  const pickImage = async (file: File | undefined) => {
    setImageError('');
    if (!file) return;
    if (!MUG_IMAGE_TYPES.includes(file.type)) { setImageError('Please choose a JPG, PNG or WebP image.'); return; }
    if (file.size > MUG_IMAGE_INPUT_MAX_BYTES) { setImageError('That image is over 15 MB. Please choose a smaller one.'); return; }
    setImageBusy(true);
    try {
      const small = await downscaleImageFile(file);
      if (small.size > MUG_IMAGE_UPLOAD_MAX_BYTES) { setImageError('We couldn’t shrink that image enough. Please try another one.'); return; }
      setImage({ dataUrl: await fileToDataUrl(small), name: file.name });
    } catch {
      setImageError('We couldn’t read that image. Please try another one.');
    } finally {
      setImageBusy(false);
    }
  };

  const send = async () => {
    const all = validateMugEnquiry(form);
    if (Object.keys(all).length) {
      setShown(all);
      const firstStep = [0, 1, 2].find((s) => Object.keys(stepErrors(all, s)).length) ?? 0;
      setStep(firstStep);
      return;
    }
    setSending(true);
    setSendError('');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toEnquiryPayload(form, image?.dataUrl || '')),
      });
      const data = await res.json().catch(() => null);
      if (data?.success && data.id) {
        setDoneId(String(data.id));
        return;
      }
      if (data?.fieldErrors && Object.keys(data.fieldErrors).length) {
        setShown(data.fieldErrors);
        if (data.fieldErrors.referenceImage) setImageError(data.fieldErrors.referenceImage);
        const firstStep = [0, 1, 2].find((s) => Object.keys(stepErrors(data.fieldErrors, s)).length);
        if (firstStep !== undefined) setStep(firstStep);
      }
      setSendError(data?.message || 'We couldn’t send your idea just now. Please try again in a minute.');
    } catch {
      setSendError('We couldn’t reach SwapSutra. Check your connection and try again — nothing was lost.');
    } finally {
      setSending(false);
    }
  };

  const closeAndReset = () => {
    if (doneId) { setForm({ ...EMPTY_MUG_ENQUIRY, ...defaults }); setImage(null); setStep(0); setDoneId(''); }
    onClose();
  };

  const err = (k: keyof MugErrors) => shown[k];
  const inputProps = (k: keyof MugEnquiryForm) => ({
    id: `mug-${k}`,
    value: form[k],
    'aria-invalid': !!err(k),
    'aria-describedby': err(k) ? `mug-${k}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value),
  });
  const brief = mugBrief(form);
  const doneStep = doneId ? 4 : step;

  return (
    <div className="mug-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !sending) closeAndReset(); }}>
      <div className="mug-modal__sheet" role="dialog" aria-modal="true" aria-labelledby="mug-modal-title" ref={dialogRef}>
        <header className="mug-modal__head">
          <div>
            <p className="type-eyebrow mug-accent">Create your mug</p>
            <h2 id="mug-modal-title" className="type-h3">{doneId ? 'Your mug idea is on its way.' : 'Tell us what you’ve imagined'}</h2>
          </div>
          <button type="button" className="mug-modal__close" onClick={closeAndReset} aria-label="Close" disabled={sending}>×</button>
        </header>

        <ol className="mug-steps" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className={`mug-steps__item ${i < doneStep ? 'is-done' : ''} ${i === doneStep ? 'is-current' : ''}`} aria-current={i === doneStep ? 'step' : undefined}>
              <span className="mug-steps__num">{i < doneStep ? '✓' : i + 1}</span>
              <span className="mug-steps__label">{label}</span>
            </li>
          ))}
        </ol>

        <div className="mug-modal__body">
          {sendError && !doneId && <p className="mug-banner" role="alert">{sendError}</p>}
          {doneId ? (
            <div className="mug-done" data-testid="mug-done">
              <p className="type-lead">We’ll review the idea, check what kind of manufacturing it needs, and get back to you with the next step.</p>
              <p className="type-caption">Your reference: <strong>{doneId}</strong>. A copy is on its way to {form.email.trim()}.</p>
            </div>
          ) : step === 0 ? (
            <>
              <Field id="mug-name" label="Name" error={err('name')}>
                <input className="mug-input" autoComplete="name" {...inputProps('name')} />
              </Field>
              <div className="mug-row">
                <Field id="mug-email" label="Email" error={err('email')}>
                  <input className="mug-input" type="email" inputMode="email" autoComplete="email" {...inputProps('email')} />
                </Field>
                <Field id="mug-phone" label="Phone / WhatsApp" error={err('phone')}>
                  <input className="mug-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" {...inputProps('phone')} />
                </Field>
              </div>
              <Field id="mug-idea" label="Your mug idea" error={err('idea')}>
                <textarea className="mug-input mug-textarea" rows={7} maxLength={3000}
                  placeholder={'Describe your dream mug...\nWhat should it look like?\nWhat shape?\nWhat colour?\nAny quote, illustration or special detail?\nYou can also mention a reference image.'}
                  {...inputProps('idea')} />
              </Field>
              <Field id="mug-image" label="Reference image" optional error={imageError}
                hint="JPG, PNG or WebP. We shrink large photos before sending.">
                {image ? (
                  <div className="mug-image">
                    <img src={image.dataUrl} alt="Your reference" />
                    <div>
                      <p className="type-caption">{image.name}</p>
                      <button type="button" className="mug-link" onClick={() => setImage(null)}>Remove</button>
                    </div>
                  </div>
                ) : (
                  <input id="mug-image" className="mug-file" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    disabled={imageBusy} onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = ''; }} />
                )}
                {imageBusy && <p className="mug-field__hint" role="status">Preparing your image…</p>}
              </Field>
              {/* Honeypot: hidden from people and screen readers. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="mug-hp"
                value={form.website} onChange={(e) => set('website', e.target.value)} />
            </>
          ) : step === 1 ? (
            <>
              <Field id="mug-mugType" label="Preferred mug type / style" error={err('mugType')}>
                <Chips name="mugType" options={MUG_TYPES.map((t) => ({ id: t, label: t }))} value={form.mugType} onChange={(v) => set('mugType', v)} error={err('mugType')} />
              </Field>
              <Field id="mug-volumeRange" label="How much coffee should it hold?" error={err('volumeRange')} hint={CAPACITY_NOTE}>
                <Chips name="volumeRange"
                  options={[...MUG_VOLUME_OPTIONS.map((o) => ({ id: o.id as string, label: o.label, hint: o.hint })), { id: 'custom', label: 'Custom capacity' }]}
                  value={form.volumeRange} onChange={(v) => set('volumeRange', v)} error={err('volumeRange')} />
              </Field>
              {form.volumeRange === 'custom' && (
                <Field id="mug-volumeCustomMl" label="Enter preferred capacity in ml" error={err('volumeCustomMl')}>
                  <input className="mug-input mug-input--short" type="number" inputMode="numeric" min={MUG_CUSTOM_VOLUME.min} max={MUG_CUSTOM_VOLUME.max} step={10} {...inputProps('volumeCustomMl')} />
                </Field>
              )}
              <Field id="mug-quantityRange" label="Quantity" error={err('quantityRange')}>
                <Chips name="quantityRange" options={MUG_QUANTITY_OPTIONS.map((o) => ({ id: o.id as string, label: o.label }))} value={form.quantityRange} onChange={(v) => set('quantityRange', v)} error={err('quantityRange')} />
              </Field>
              <Field id="mug-quantityExact" label="Exact quantity" optional error={err('quantityExact')}>
                <input className="mug-input mug-input--short" type="number" inputMode="numeric" min={1} {...inputProps('quantityExact')} />
              </Field>
              <Field id="mug-budgetType" label="Budget" error={err('budgetType') || err('budgetAmount')} hint="Your budget helps us look for the right maker. It is not a quote.">
                <div className="mug-segment" role="radiogroup" aria-label="Budget type">
                  {MUG_BUDGET_TYPES.map((b) => (
                    <button key={b.id} type="button" role="radio" aria-checked={form.budgetType === b.id}
                      className={`mug-segment__opt ${form.budgetType === b.id ? 'is-on' : ''}`} onClick={() => set('budgetType', b.id)}>{b.label}</button>
                  ))}
                </div>
                <div className="mug-money">
                  <span aria-hidden="true">₹</span>
                  <input id="mug-budgetAmount" className="mug-input" type="number" inputMode="numeric" min={1} placeholder="Amount in rupees"
                    aria-label={`Budget amount in rupees, ${form.budgetType === 'total' ? 'total project' : 'per mug'}`}
                    aria-invalid={!!err('budgetAmount')} value={form.budgetAmount}
                    onChange={(e) => { set('budgetAmount', e.target.value); set('budgetRange', ''); }} />
                </div>
                <div className="mug-chips mug-chips--small" aria-label="Budget ranges">
                  {MUG_BUDGET_RANGES.map((r) => (
                    <button key={r.label} type="button" className={`mug-chip ${form.budgetRange === r.label ? 'is-on' : ''}`}
                      onClick={() => { set('budgetAmount', String(r.amount)); set('budgetRange', r.label); }}>{r.label}</button>
                  ))}
                </div>
              </Field>
            </>
          ) : step === 2 ? (
            <>
              <Field id="mug-pincode" label="Where should we deliver?" error={err('pincode')}>
                <input className="mug-input mug-input--short" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="6-digit pincode"
                  {...inputProps('pincode')} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
              <div className="mug-row">
                <Field id="mug-city" label="City" optional error={err('city')}>
                  <input className="mug-input" autoComplete="address-level2" {...inputProps('city')} />
                </Field>
                <Field id="mug-state" label="State" optional error={err('state')}>
                  <input className="mug-input" autoComplete="address-level1" {...inputProps('state')} />
                </Field>
              </div>
              <Field id="mug-timeline" label="Timeline" error={err('timeline')}>
                <Chips name="timeline" options={MUG_TIMELINES.map((t) => ({ id: t.id as string, label: t.label }))} value={form.timeline} onChange={(v) => set('timeline', v)} error={err('timeline')} />
              </Field>
              {form.timeline === 'specific_date' && (
                <Field id="mug-specificDate" label="Need it by" error={err('specificDate')}>
                  <input className="mug-input mug-input--short" type="date" min={new Date().toISOString().slice(0, 10)} {...inputProps('specificDate')} />
                </Field>
              )}
              <Field id="mug-additionalNotes" label="Additional notes" optional error={err('additionalNotes')}>
                <textarea className="mug-input mug-textarea" rows={3} maxLength={1000} placeholder="Anything else we should know?" {...inputProps('additionalNotes')} />
              </Field>
            </>
          ) : (
            <div className="mug-review" data-testid="mug-review">
              <h3 className="type-h3">Your Mug Brief</h3>
              <p className="mug-review__idea">{form.idea.trim()}</p>
              <dl className="mug-review__grid">
                {brief.map((b) => (
                  <div key={b.label}>
                    <dt><span aria-hidden="true">{b.icon}</span> {b.label}</dt>
                    <dd>{b.value || '—'}</dd>
                  </div>
                ))}
              </dl>
              <p className="type-caption">Approximate capacity — final usable volume will be confirmed during prototyping.</p>
              {image && <img className="mug-review__image" src={image.dataUrl} alt="Your reference" />}
              {form.additionalNotes.trim() && <p className="type-caption"><strong>Notes:</strong> {form.additionalNotes.trim()}</p>}
              <p className="type-caption">We’ll review your idea before anything is confirmed — no price, maker or delivery date is promised yet.</p>
            </div>
          )}
        </div>

        <footer className="mug-modal__foot">
          {doneId ? (
            <button type="button" className="mug-btn mug-btn--solid" onClick={closeAndReset}>Close</button>
          ) : (
            <>
              {step > 0
                ? <button type="button" className="mug-btn mug-btn--quiet" onClick={() => { setShown({}); setStep(step - 1); }} disabled={sending}>Back</button>
                : <span />}
              {step < 3
                ? <button type="button" className="mug-btn mug-btn--solid" onClick={next} disabled={imageBusy}>Next</button>
                : <button type="button" className="mug-btn mug-btn--solid" onClick={send} disabled={sending}>{sending ? 'Sending…' : 'Send My Mug Idea'}</button>}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
