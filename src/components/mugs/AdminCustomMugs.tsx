import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../../config/runtime';

/**
 * Admin → Custom Mugs (30 Sep 2026).
 * Every "Create My Mug" enquiry, with its manufacturer brief (the RFQ text
 * built by Apps Script, the same block for every manufacturer), a status
 * through the workflow, internal notes and the assigned manufacturer.
 * Notes and manufacturer are internal: no customer screen or email shows them.
 */

const API = apiUrl('/api/swapsutra');
const STATUS_LABEL: Record<string, string> = {
  new: 'New', reviewing: 'Reviewing', manufacturer_search: 'Finding a maker', prototype: 'Prototype',
  quoted: 'Quoted', customer_approval: 'Waiting for customer', manufacturing: 'Manufacturing',
  shipped: 'Shipped', completed: 'Completed', rejected: 'Not possible',
};

type Enquiry = Record<string, any>;

async function post(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return res.json();
}

export default function AdminCustomMugs() {
  const [items, setItems] = useState<Enquiry[]>([]);
  const [statuses, setStatuses] = useState<string[]>(Object.keys(STATUS_LABEL));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');
  const [openId, setOpenId] = useState('');
  const [draft, setDraft] = useState<{ status: string; adminNotes: string; assignedManufacturer: string }>({ status: '', adminNotes: '', assignedManufacturer: '' });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await post('getAdminCustomMugEnquiries');
      if (!d?.success) throw new Error(d?.message || 'Could not load enquiries.');
      setItems(d.items || []);
      if (Array.isArray(d.statuses)) setStatuses(d.statuses);
    } catch (e: any) { setError(e?.message || 'Could not load enquiries.'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => items.filter((i) =>
    filter === 'all' ? true : filter === 'open' ? !['completed', 'rejected'].includes(i.status) : i.status === filter), [items, filter]);
  const current = items.find((i) => i.id === openId);

  const open = (i: Enquiry) => {
    setOpenId(i.id); setNote('');
    setDraft({ status: i.status || 'new', adminNotes: i.adminNotes || '', assignedManufacturer: i.assignedManufacturer || '' });
  };

  const save = async () => {
    if (!current) return;
    setSaving(true); setNote('');
    try {
      const d = await post('updateCustomMugEnquiry', { id: current.id, ...draft });
      if (!d?.success) throw new Error(d?.message || 'Could not save.');
      setNote('Saved.');
      await load();
    } catch (e: any) { setNote(e?.message || 'Could not save.'); }
    setSaving(false);
  };

  const copyBrief = async () => {
    if (!current) return;
    try { await navigator.clipboard.writeText(current.manufacturerBrief || ''); setNote('Manufacturer brief copied.'); }
    catch { setNote('Copy failed — select the brief and copy it by hand.'); }
  };

  const budget = (i: Enquiry) => `₹${Number(i.budgetAmount || 0).toLocaleString('en-IN')} ${i.budgetType === 'total' ? 'total' : 'per mug'}`;
  const qty = (i: Enquiry) => i.quantityExact ? `${i.quantityExact}` : i.quantityRange;
  const when = (i: Enquiry) => i.timeline === 'specific_date' && i.specificDate ? `By ${i.specificDate}` : String(i.timeline || '').replace(/_/g, ' ');

  return (
    <div className="admin-mugs" data-testid="admin-custom-mugs">
      <div className="admin-mugs__bar">
        <h3 className="type-h3">Custom mug enquiries</h3>
        <label className="type-caption">
          Show{' '}
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="mug-input mug-input--inline">
            <option value="open">Open</option>
            <option value="all">All</option>
            {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
          </select>
        </label>
        <button type="button" className="mug-btn mug-btn--quiet" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {error && <p className="mug-field__error" role="alert">{error}</p>}
      {!loading && !shown.length && !error && <p className="type-caption">No enquiries here yet.</p>}

      {shown.length > 0 && (
        <div className="admin-mugs__table-wrap">
          <table className="admin-mugs__table">
            <thead>
              <tr><th>ID</th><th>Customer</th><th>Date</th><th>Idea</th><th>Capacity</th><th>Qty</th><th>Budget</th><th>Pincode</th><th>Timeline</th><th>Status</th></tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className={openId === i.id ? 'is-open' : ''} onClick={() => open(i)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(i); }}>
                  <td className="admin-mugs__id">{i.id}</td>
                  <td>{i.name}<br /><span className="type-caption">{i.email}</span></td>
                  <td>{i.createdAt ? new Date(i.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</td>
                  <td className="admin-mugs__idea">{String(i.idea || '').slice(0, 90)}{String(i.idea || '').length > 90 ? '…' : ''}</td>
                  <td>{i.volumeMl ? `${i.volumeMl} ml` : ''}</td>
                  <td>{qty(i)}</td>
                  <td>{budget(i)}</td>
                  <td>{i.pincode}</td>
                  <td>{when(i)}</td>
                  <td><span className={`admin-mugs__status is-${i.status}`}>{STATUS_LABEL[i.status] || i.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {current && (
        <div className="admin-mugs__detail">
          <div className="admin-mugs__brief">
            <div className="admin-mugs__bar">
              <p className="type-eyebrow mug-accent">Manufacturer brief</p>
              <button type="button" className="mug-btn mug-btn--quiet" onClick={copyBrief}>Copy manufacturer brief</button>
            </div>
            <pre>{current.manufacturerBrief}</pre>
            {current.referenceImageUrl && (
              <a className="mug-link" href={current.referenceImageUrl} target="_blank" rel="noopener noreferrer">Open reference image ↗</a>
            )}
            <p className="type-caption">Customer (keep internal): {current.name} · {current.email} · {current.phone}</p>
          </div>
          <div className="admin-mugs__edit">
            <label className="mug-field__label" htmlFor="adm-mug-status">Status</label>
            <select id="adm-mug-status" className="mug-input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
            </select>
            <label className="mug-field__label" htmlFor="adm-mug-maker">Assigned manufacturer (internal)</label>
            <input id="adm-mug-maker" className="mug-input" value={draft.assignedManufacturer} onChange={(e) => setDraft({ ...draft, assignedManufacturer: e.target.value })} />
            <label className="mug-field__label" htmlFor="adm-mug-notes">Internal notes</label>
            <textarea id="adm-mug-notes" className="mug-input mug-textarea" rows={5} value={draft.adminNotes} onChange={(e) => setDraft({ ...draft, adminNotes: e.target.value })} />
            <div className="admin-mugs__bar">
              <button type="button" className="mug-btn mug-btn--solid" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              {note && <span className="type-caption" role="status">{note}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
