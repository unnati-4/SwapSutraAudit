import React, { useState } from 'react';
import { partnerPost } from './partnerApi';

/**
 * Bulk listing for partners (16 Oct 2026, owner's request).
 *
 * The partner downloads a template, fills it in Excel or Google Sheets and
 * uploads it as CSV — or copies the rows straight from the spreadsheet and
 * pastes them. Rows go to the server 25 at a time (partnerBulkAddBooks in
 * appsscript.js), which lists each one with the usual checks; the cover is
 * taken from the ISBN, and photos can be added to any book later.
 */

export const BULK_COLUMNS = ['isbn', 'title', 'author', 'condition', 'genre', 'copies', 'mrp', 'sell_price', 'rent_per_month', 'lend', 'swap', 'notes', 'cover_image_url'];
const ALIASES: Record<string, string> = {
  isbn: 'isbn', isbn13: 'isbn', isbn10: 'isbn', title: 'title', name: 'title', bookname: 'title', author: 'author', writer: 'author',
  condition: 'condition', genre: 'genre', category: 'genre', copies: 'copies', stock: 'copies', quantity: 'copies', qty: 'copies',
  mrp: 'mrp', printedmrp: 'mrp', sellprice: 'sellPrice', price: 'sellPrice', sellingprice: 'sellPrice', saleprice: 'sellPrice',
  rentpermonth: 'rentPerMonth', rent: 'rentPerMonth', monthlyrent: 'rentPerMonth', lend: 'lend', swap: 'swap', exchange: 'swap',
  notes: 'notes', note: 'notes', description: 'notes', coverimageurl: 'coverImageUrl', cover: 'coverImageUrl', coverurl: 'coverImageUrl', imageurl: 'coverImageUrl',
};
const CHUNK = 25;
const MAX_ROWS = 500;

export type BulkRow = Record<string, string> & { line: string };

/** Splits CSV or tab-separated text (from Excel / Google Sheets) into rows, honouring quotes. */
export function parseSheetText(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = firstLine.includes('\t') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Turns the sheet into book rows by its header line; a row's `line` is its line in the file. */
export function rowsFromSheet(table: string[][]): { rows: BulkRow[]; error?: string } {
  if (table.length < 2) return { rows: [], error: 'The file needs a header line and at least one book.' };
  const keys = table[0].map((h) => ALIASES[h.toLowerCase().replace(/[^a-z0-9]/g, '')] || '');
  if (!keys.includes('isbn') || !keys.includes('title') || !keys.includes('author')) {
    return { rows: [], error: 'The first line must name the columns — at least isbn, title and author. Download the template to see the layout.' };
  }
  const rows = table.slice(1).map((cells, i) => {
    const r: BulkRow = { line: String(i + 2) };
    keys.forEach((k, j) => { if (k) r[k] = (cells[j] || '').trim(); });
    return r;
  });
  return { rows };
}

/** What is plainly wrong with a row before it is sent (the server checks again). */
export function rowProblem(r: BulkRow): string {
  const isbn = (r.isbn || '').replace(/[^0-9Xx]/g, '');
  if (isbn.length !== 10 && isbn.length !== 13) return 'ISBN must have 10 or 13 digits';
  if (!r.title) return 'Title missing';
  if (!r.author) return 'Author missing';
  const yes = (v?: string) => /^(yes|y|true|1|haan|ha)$/i.test((v || '').trim());
  if (!r.sellPrice && !r.rentPerMonth && !yes(r.lend) && !yes(r.swap)) return 'Add a selling price or rent, or yes for lend / swap';
  return '';
}

function templateCsv() {
  return [
    BULK_COLUMNS.join(','),
    '9780143440048,Wings of Fire,A P J Abdul Kalam,As New,Biography,5,350,300,,no,no,Brand new copies,',
    '9780062315007,The Alchemist,Paulo Coelho,As New,Fiction,2,399,350,60,yes,no,,',
  ].join('\r\n') + '\r\n';
}

export default function BulkAddBooks({ onDone }: { onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [error, setError] = useState('');
  const [paste, setPaste] = useState('');
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<{ line: number; title: string; ok: boolean; message?: string }[]>([]);

  const load = (text: string) => {
    setResults([]); setProgress('');
    const { rows: r, error: e } = rowsFromSheet(parseSheetText(text));
    if (e) { setError(e); setRows([]); return; }
    if (r.length > MAX_ROWS) { setError(`At most ${MAX_ROWS} books in one file — split it into smaller files.`); setRows([]); return; }
    setError(''); setRows(r);
  };
  const onFile = async (f?: File | null) => {
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { setError('Save the sheet as CSV first: in Excel, File → Save As → CSV; in Google Sheets, File → Download → CSV. Or copy the rows and paste them below.'); return; }
    load(await f.text());
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'swapsutra-books-template.csv'; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const ready = rows.filter((r) => !rowProblem(r));
  const send = async () => {
    if (!ready.length || !declared) return;
    setBusy(true); setResults([]);
    const all: typeof results = rows.filter((r) => rowProblem(r)).map((r) => ({ line: Number(r.line), title: r.title || '', ok: false, message: rowProblem(r) }));
    for (let i = 0; i < ready.length; i += CHUNK) {
      const part = ready.slice(i, i + CHUNK);
      setProgress(`Listing ${Math.min(i + CHUNK, ready.length)} of ${ready.length}…`);
      try {
        const d = await partnerPost('partnerBulkAddBooks', { rows: part, originalDeclared: true });
        if (d?.success) all.push(...(d.results || []));
        else part.forEach((r) => all.push({ line: Number(r.line), title: r.title || '', ok: false, message: d?.message || 'Not sent — try again.' }));
      } catch {
        part.forEach((r) => all.push({ line: Number(r.line), title: r.title || '', ok: false, message: 'Could not reach SwapSutra — try these again.' }));
      }
    }
    all.sort((a, b) => a.line - b.line);
    setResults(all);
    const added = all.filter((x) => x.ok).length;
    setProgress(`${added} book${added === 1 ? '' : 's'} listed${all.length - added ? ` · ${all.length - added} need fixing (below)` : ''}.`);
    setRows([]); setPaste('');
    setBusy(false);
    await onDone();
  };

  if (!open) {
    return <button type="button" className="btn-outline pp-btn" onClick={() => setOpen(true)} data-testid="bulk-open">Add many books at once (Excel / CSV)</button>;
  }
  return (
    <div className="pp-bulk" data-testid="bulk-add">
      <h3 className="pp-h3">Add many books at once</h3>
      <ol className="pp-hint">
        <li>Download the template and fill one book per line in Excel or Google Sheets.</li>
        <li>Save it as CSV and upload it — or select the rows (with the header line) and paste them below.</li>
        <li>Check the list, confirm, and list them. Up to {MAX_ROWS} books per file.</li>
      </ol>
      <p className="pp-hint">
        Needed: <b>isbn, title, author</b>, and a <b>sell_price</b> or <b>rent_per_month</b> (or <b>yes</b> under lend / swap).
        Optional: condition (As New, Very Good, Good, Fair, Poor — As New if blank), genre, copies (1 if blank), mrp, notes, cover_image_url.
        The cover is taken from the ISBN; you can add your own photos to any book later.
      </p>
      <div className="pp-row">
        <button type="button" className="btn-outline pp-btn" onClick={download}>Download the template</button>
        <label className="btn-outline pp-btn" style={{ cursor: 'pointer' }}>
          Upload CSV
          <input type="file" accept=".csv,.tsv,.txt,text/csv,.xlsx,.xls" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.currentTarget.value = ''; }} aria-label="Upload CSV" />
        </label>
      </div>
      <label className="pp-field">
        <span className="pp-label">…or paste the rows here</span>
        <textarea className="input-classic pp-input" rows={4} value={paste} placeholder={'isbn\ttitle\tauthor\t…'} data-testid="bulk-paste"
          onChange={(e) => { setPaste(e.target.value); if (e.target.value.trim()) load(e.target.value); else setRows([]); }} />
      </label>
      {error && <p className="pp-error" role="alert">{error}</p>}

      {rows.length > 0 && (
        <>
          <p className="pp-hint" data-testid="bulk-summary"><b>{rows.length}</b> book{rows.length === 1 ? '' : 's'} found · <b>{ready.length}</b> ready{rows.length - ready.length ? ` · ${rows.length - ready.length} to fix` : ''}</p>
          <div className="pp-bulk__table" role="region" aria-label="Books to list" tabIndex={0}>
            <table>
              <thead><tr><th>Line</th><th>Title</th><th>Author</th><th>Copies</th><th>Price</th><th>Rent</th><th>Check</th></tr></thead>
              <tbody>
                {rows.slice(0, 200).map((r) => {
                  const pr = rowProblem(r);
                  return (
                    <tr key={r.line} className={pr ? 'is-bad' : ''}>
                      <td>{r.line}</td><td>{r.title}</td><td>{r.author}</td><td>{r.copies || '1'}</td>
                      <td>{r.sellPrice ? '₹' + r.sellPrice : '—'}</td><td>{r.rentPerMonth ? '₹' + r.rentPerMonth : '—'}</td>
                      <td>{pr || '✓'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 200 && <p className="pp-hint">…and {rows.length - 200} more.</p>}
          </div>
          <label className="pp-check">
            <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} data-testid="bulk-declare" />
            {' '}These are original copies — not photocopies or pirated prints.
          </label>
          <button type="button" className="btn-primary pp-btn" disabled={busy || !ready.length || !declared} onClick={send} data-testid="bulk-send">
            {busy ? progress || 'Listing…' : `List ${ready.length} book${ready.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}

      {!busy && progress && <p className="pp-flash" role="status" data-testid="bulk-result">{progress}</p>}
      {results.some((x) => !x.ok) && (
        <ul className="pp-list" data-testid="bulk-failures">
          {results.filter((x) => !x.ok).map((x) => <li key={x.line}><div><b>Line {x.line}{x.title ? ` — ${x.title}` : ''}</b><span className="pp-hint">{x.message}</span></div></li>)}
        </ul>
      )}
      <button type="button" className="pp-link" onClick={() => { setOpen(false); setRows([]); setResults([]); setProgress(''); setError(''); }}>Close</button>
    </div>
  );
}
