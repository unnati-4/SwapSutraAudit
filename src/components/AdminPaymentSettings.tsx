import React, { useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';
import { downscaleImageFile, fileToDataUrl } from '../utils/imageCompress';
import UpiPayBox, { type PayDetails } from './UpiPayBox';

/**
 * Admin → Payment details (9 Oct 2026, owner's request).
 *
 * The UPI ID, the name UPI apps show, an optional QR picture of the admin's
 * own, and bank details. Every payment box on SwapSutra uses what is saved
 * here, from the next time it is opened. Each change is logged.
 */

const API = apiUrl('/api/swapsutra');
async function post(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return res.json();
}

const blank = { vpa: '', payee: '', qrImageUrl: '', useQrImage: false, accountName: '', accountNumber: '', ifsc: '', bankName: '' };

export default function AdminPaymentSettings() {
  const [form, setForm] = useState(blank);
  const [meta, setMeta] = useState<{ updatedAt: string; updatedBy: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'load' | 'save' | 'upload'>('load');

  const fill = (u: PayDetails) => setForm({
    vpa: u.vpa || '', payee: u.payee || '', qrImageUrl: u.qrImageUrl || '', useQrImage: !!u.useQrImage,
    accountName: u.bank?.accountName || '', accountNumber: u.bank?.accountNumber || '', ifsc: u.bank?.ifsc || '', bankName: u.bank?.bankName || '',
  });

  useEffect(() => {
    (async () => {
      try {
        const d = await post('getAdminPaymentSettings');
        if (d?.success) { fill(d.upi); setMeta({ updatedAt: d.updatedAt, updatedBy: d.updatedBy }); }
        else setNote(d?.message || 'Could not load the payment details.');
      } catch { setNote('Could not load the payment details.'); }
      setBusy('');
    })();
  }, []);

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const upload = async (file?: File | null) => {
    if (!file) return;
    setBusy('upload'); setErrors((e) => ({ ...e, qrImageUrl: '' }));
    try {
      const dataUrl = await fileToDataUrl(await downscaleImageFile(file));
      const d = await post('uploadPaymentQrImage', { dataUrl });
      if (d?.success) setForm((f) => ({ ...f, qrImageUrl: d.url, useQrImage: true }));
      else setErrors((e) => ({ ...e, qrImageUrl: d?.message || 'Could not upload the QR picture.' }));
    } catch { setErrors((e) => ({ ...e, qrImageUrl: 'Could not upload the QR picture.' })); }
    setBusy('');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('save'); setErrors({}); setNote('');
    try {
      const d = await post('saveAdminPaymentSettings', {
        vpa: form.vpa.trim(), payee: form.payee.trim(), qrImageUrl: form.qrImageUrl, useQrImage: form.useQrImage,
        bank: { accountName: form.accountName, accountNumber: form.accountNumber, ifsc: form.ifsc, bankName: form.bankName },
      });
      if (d?.success) { fill(d.upi); setNote('Saved. Every payment box on SwapSutra now shows these details.'); setMeta({ updatedAt: new Date().toISOString(), updatedBy: 'you' }); }
      else { setErrors(d?.errors || {}); setNote(d?.message || 'Could not save.'); }
    } catch { setNote('Could not save — check your connection.'); }
    setBusy('');
  };

  const field = (k: keyof typeof blank, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="admin-mugp__field">
      <span className="mug-field__label">{label}</span>
      <input className="mug-input" value={String(form[k])} onChange={set(k)} {...props} />
      {errors[k] && <span className="mug-field__error" role="alert">{errors[k]}</span>}
    </label>
  );

  const preview: PayDetails = {
    vpa: form.vpa || 'name@bank', payee: form.payee || 'Name', qrImageUrl: form.qrImageUrl, useQrImage: form.useQrImage,
    bank: form.accountNumber ? { accountName: form.accountName, accountNumber: form.accountNumber, ifsc: form.ifsc, bankName: form.bankName } : null,
  };

  return (
    <div className="admin-mugs admin-mugp" data-testid="admin-payment-settings">
      <div className="admin-mugs__bar"><h3 className="type-h3">Payment details</h3></div>
      <p className="type-caption">
        Where readers and partners pay SwapSutra: exchange payments, listing unlocks, partner ad fees and “Support SwapSutra”.
        Change them any time — the new details show from the next time a payment box opens.
        {meta?.updatedAt ? ` Last changed ${new Date(meta.updatedAt).toLocaleString('en-IN')}${meta.updatedBy ? ` by ${meta.updatedBy}` : ''}.` : ''}
      </p>
      {busy === 'load' ? <p className="type-caption">Loading…</p> : (
        <form className="admin-mugp__form" onSubmit={save}>
          <div className="admin-mugp__row">
            {field('vpa', 'UPI ID *', { placeholder: 'name@okhdfcbank', autoComplete: 'off' })}
            {field('payee', 'Name in UPI apps *', { placeholder: 'e.g. SwapSutra / your name' })}
          </div>
          <div className="admin-mugp__field">
            <span className="mug-field__label">Your own QR picture (optional)</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy === 'upload'} onChange={(e) => upload(e.target.files?.[0])} aria-label="Upload your UPI QR picture" />
            <span className="type-caption">{busy === 'upload' ? 'Uploading…' : 'Without a picture, SwapSutra makes a QR from the UPI ID with the amount already filled in (recommended).'}</span>
            {errors.qrImageUrl && <span className="mug-field__error" role="alert">{errors.qrImageUrl}</span>}
            {form.qrImageUrl && (
              <label className="type-caption" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={form.useQrImage} onChange={set('useQrImage')} /> Show my QR picture instead of the generated one
                <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setForm((f) => ({ ...f, qrImageUrl: '', useQrImage: false }))}>Remove picture</button>
              </label>
            )}
          </div>
          <p className="mug-field__label">Bank details (optional — shown as “Pay by bank transfer instead”)</p>
          <div className="admin-mugp__row">
            {field('accountName', 'Account holder name')}
            {field('bankName', 'Bank name')}
          </div>
          <div className="admin-mugp__row">
            {field('accountNumber', 'Account number', { inputMode: 'numeric', autoComplete: 'off' })}
            {field('ifsc', 'IFSC', { placeholder: 'HDFC0001234', autoComplete: 'off' })}
          </div>
          <div>
            <p className="mug-field__label">Preview (₹100)</p>
            <div style={{ maxWidth: 260 }}><UpiPayBox upi={preview} amount={100} size={140} /></div>
          </div>
          {note && <p className="type-caption" role="status">{note}</p>}
          <div className="admin-mugs__bar">
            <button type="submit" className="mug-btn mug-btn--solid" disabled={busy !== ''}>{busy === 'save' ? 'Saving…' : 'Save payment details'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
