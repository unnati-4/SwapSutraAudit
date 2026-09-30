import { useCallback, useState } from 'react';
import {apiUrl} from '../config/runtime';

/**
 * Pricing administration.
 *
 * The catalogue prices books on its own; this is for the cases where it
 * needs a human. Four of them, in the order they actually come up:
 *
 *   1. A book is priced wrongly and someone has to correct it.
 *   2. A real price was found somewhere and should be recorded.
 *   3. A page of text needs its prices extracted.
 *   4. Someone needs to see WHY a book is priced the way it is.
 *
 * One rule shapes the whole screen: an override never edits the computed
 * band. It is recorded as a separate row with a reason and an author, and
 * the automated figure stays visible beside it. "Admin overrides must be
 * auditable, and must not silently overwrite automated values" is a
 * requirement, and the only way to honour it is to keep both numbers.
 */

const API_URL = apiUrl('/api/books');

const FORMATS = ['TRADE_PAPERBACK', 'HARDCOVER', 'MASS_MARKET_PAPERBACK', 'UNKNOWN'];
const TIERS = ['PUBLISHER', 'INDIAN_REPRINT', 'IMPORT', 'NOT_SURE', 'UNOFFICIAL'];
const CONDITIONS = ['AS_NEW', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR'];
const KINDS = ['MRP', 'NEW_RETAIL', 'USED_RETAIL', 'EBOOK'];

const label = (s: string) => s.replace(/_/g, ' ').toLowerCase();

interface Quote {
  found?: boolean;
  priceable?: boolean;
  reason?: string;
  book?: { edition_id: number; title: string; authors?: string[]; publisher?: string;
           publication_year?: number; cover_url?: string; category?: string };
  mrp?: number | null;
  sell?: { allowed_min: number; suggested: number; allowed_max: number } | null;
  reference_price?: number | null;
  deposit?: number | null;
  methodology?: string;
  confidence?: number;
  sample_size?: number;
  is_estimate?: boolean;
  explanation?: string;
}

export default function PricingAdmin({ adminEmail, sessionToken }:
  { adminEmail: string; sessionToken?: string }) {

  const [isbn, setIsbn] = useState('');
  const [format, setFormat] = useState('TRADE_PAPERBACK');
  const [tier, setTier] = useState('PUBLISHER');
  const [condition, setCondition] = useState('GOOD');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [obsPrice, setObsPrice] = useState('');
  const [obsKind, setObsKind] = useState('NEW_RETAIL');
  const [obsUrl, setObsUrl] = useState('');

  const [ovLower, setOvLower] = useState('');
  const [ovRef, setOvRef] = useState('');
  const [ovUpper, setOvUpper] = useState('');
  const [ovReason, setOvReason] = useState('');

  const [pageText, setPageText] = useState('');
  const [extracted, setExtracted] = useState<any[] | null>(null);

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(sessionToken ? { 'x-swapsutra-session': sessionToken } : {}),
  }), [sessionToken]);

  const post = useCallback(async (action: string, body: Record<string, unknown>) => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ action, adminEmail, ...body }),
      });
      const payload = await res.json();
      if (!payload?.success) {
        setError(payload?.message || 'That did not work.');
        return null;
      }
      return payload;
    } catch {
      setError('Could not reach the catalogue.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [adminEmail, headers]);

  const load = useCallback(async () => {
    if (!isbn.trim()) return;
    setBusy(true); setError(null); setMessage(null); setExtracted(null);
    try {
      const params = new URLSearchParams({ action: 'quote', isbn: isbn.trim(), format, tier, condition });
      const res = await fetch(`${API_URL}?${params}`);
      const payload = await res.json();
      if (!payload?.success || payload?.found === false) {
        setQuote(null);
        setError(payload?.reason || payload?.message || 'That ISBN is not in the catalogue.');
        return;
      }
      setQuote(payload);
    } catch {
      setError('Could not reach the catalogue.');
    } finally {
      setBusy(false);
    }
  }, [isbn, format, tier, condition]);

  const editionId = quote?.book?.edition_id;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-primary)]">Book pricing</h3>
        <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
          Every figure below is computed by the catalogue. A correction here is recorded as a
          separate, attributed row &mdash; the automated value stays visible beside it.
        </p>
      </div>

      {/* ── Find a book ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            placeholder="ISBN-13 or ISBN-10"
            className="input-classic !py-2 text-sm bg-[var(--bg-page)] font-mono"
          />
          <button type="button" onClick={load} disabled={busy || !isbn.trim()}
                  className="btn-primary !py-2 text-2xs disabled:opacity-50">
            {busy ? 'Loading…' : 'Look up'}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select value={format} onChange={(e) => setFormat(e.target.value)}
                  className="input-classic !py-2 text-xs bg-[var(--bg-page)]">
            {FORMATS.map(f => <option key={f} value={f}>{label(f)}</option>)}
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)}
                  className="input-classic !py-2 text-xs bg-[var(--bg-page)]">
            {TIERS.map(t => <option key={t} value={t}>{label(t)}</option>)}
          </select>
          <select value={condition} onChange={(e) => setCondition(e.target.value)}
                  className="input-classic !py-2 text-xs bg-[var(--bg-page)]">
            {CONDITIONS.map(c => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {message && <p className="text-xs text-green-700">{message}</p>}

      {quote?.book && (
        <>
          {/* ── What the catalogue currently says ───────────────────── */}
          <div className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4 space-y-3">
            <div className="flex gap-3">
              {quote.book.cover_url && (
                <img src={quote.book.cover_url} alt="" className="w-12 h-16 object-cover rounded shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-serif text-base text-[var(--text-primary)] leading-tight">{quote.book.title}</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {(quote.book.authors || []).join(', ')}
                  {quote.book.publisher ? ` · ${quote.book.publisher}` : ''}
                  {quote.book.publication_year ? ` · ${quote.book.publication_year}` : ''}
                </p>
                <p className="text-2xs text-[var(--text-secondary)] opacity-70 font-mono">
                  edition #{quote.book.edition_id}{quote.book.category ? ` · ${quote.book.category}` : ''}
                </p>
              </div>
            </div>

            {quote.priceable && quote.sell ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-brand-border/40">
                {[
                  ['Printed MRP', quote.mrp],
                  ['May list for', `${quote.sell.allowed_min}–${quote.sell.allowed_max}`],
                  ['Reference value', quote.reference_price],
                  ['Deposit 60%', quote.deposit],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <p className="text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{k}</p>
                    <p className="text-sm text-[var(--text-primary)] tabular-nums">
                      {v == null ? '—' : `₹${v}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)] pt-2 border-t border-brand-border/40">
                {quote.reason || 'This edition is not priceable.'}
              </p>
            )}

            {/* How firm the number is, said plainly rather than implied. */}
            <p className="text-2xs text-[var(--text-secondary)] leading-relaxed">
              {quote.methodology} · {quote.sample_size ?? 0} observation(s) ·
              confidence {quote.confidence ?? 0}
              {quote.is_estimate ? ' · ESTIMATE — derived from MRP and policy, not from observed sale prices' : ''}
            </p>
            {quote.explanation && (
              <p className="text-2xs text-[var(--text-secondary)] italic">{quote.explanation}</p>
            )}
          </div>

          {quote.priceable && editionId && (
            <>
              {/* ── Record a real price someone found ───────────────── */}
              <details className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4">
                <summary className="text-2xs font-bold uppercase tracking-widest text-[var(--text-primary)] cursor-pointer">
                  Record a price observation
                </summary>
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input value={obsPrice} onChange={(e) => setObsPrice(e.target.value)}
                           type="number" placeholder="Price in ₹"
                           className="input-classic !py-2 text-xs bg-[var(--bg-page)]" />
                    <select value={obsKind} onChange={(e) => setObsKind(e.target.value)}
                            className="input-classic !py-2 text-xs bg-[var(--bg-page)]">
                      {KINDS.map(k => <option key={k} value={k}>{label(k)}</option>)}
                    </select>
                  </div>
                  <input value={obsUrl} onChange={(e) => setObsUrl(e.target.value)}
                         placeholder="Where you saw it (URL)"
                         className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
                  {obsKind === 'EBOOK' && (
                    <p className="text-2xs text-amber-700 leading-relaxed">
                      An ebook price is stored, but it can never enter a print band. It is recorded
                      for reference only.
                    </p>
                  )}
                  <button type="button" disabled={busy || !obsPrice}
                    onClick={async () => {
                      const r = await post('observation', {
                        isbn: isbn.trim(), format, tier, condition,
                        price: Number(obsPrice), kind: obsKind, sourceUrl: obsUrl || null,
                      });
                      if (r) { setMessage('Observation recorded and the band recomputed.'); setObsPrice(''); load(); }
                    }}
                    className="btn-outline !py-2 text-2xs disabled:opacity-50">
                    Record and recompute
                  </button>
                </div>
              </details>

              {/* ── Extract prices from a page ──────────────────────── */}
              <details className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4">
                <summary className="text-2xs font-bold uppercase tracking-widest text-[var(--text-primary)] cursor-pointer">
                  Extract prices from page text
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-2xs text-[var(--text-secondary)] leading-relaxed">
                    Paste the text of a publisher or retailer page. Every price must be quoted
                    verbatim from what you paste; anything the model produces that is not in this
                    text is rejected and stored with the reason.
                  </p>
                  <textarea value={pageText} onChange={(e) => setPageText(e.target.value)}
                            rows={5} placeholder="Paste the page text here"
                            className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
                  <input value={obsUrl} onChange={(e) => setObsUrl(e.target.value)}
                         placeholder="Source URL"
                         className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
                  <button type="button" disabled={busy || pageText.trim().length < 20}
                    onClick={async () => {
                      const r = await post('extract', {
                        isbn: isbn.trim(), pageText, sourceUrl: obsUrl || null,
                        category: quote.book?.category || '',
                      });
                      if (r) {
                        setExtracted(r.observations || []);
                        setMessage(`${r.accepted} accepted, ${r.rejected} rejected.`);
                        load();
                      }
                    }}
                    className="btn-outline !py-2 text-2xs disabled:opacity-50">
                    Extract
                  </button>

                  {extracted && (
                    <div className="space-y-1 pt-2">
                      {extracted.length === 0 && (
                        <p className="text-xs text-[var(--text-secondary)] italic">
                          No prices found in that text.
                        </p>
                      )}
                      {extracted.map((e, i) => (
                        <div key={i} className={`text-xs px-2 py-1.5 rounded ${
                          e.accepted ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}>
                          <span className="font-bold">{e.accepted ? 'ACCEPTED' : 'REJECTED'}</span>
                          {' ₹'}{e.price} · {label(e.kind)} · {label(e.format)}
                          {e.reason && <span className="block opacity-80">{e.reason}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>

              {/* ── Correct it by hand ──────────────────────────────── */}
              <details className="rounded-2xl border border-brand-border bg-[var(--bg-surface)] p-4">
                <summary className="text-2xs font-bold uppercase tracking-widest text-[var(--text-primary)] cursor-pointer">
                  Override the band
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-2xs text-[var(--text-secondary)] leading-relaxed">
                    This does not replace the computed band. It is stored as a separate row with
                    your name and your reason, wins at read time, and can be revoked &mdash; the
                    automated figure stays on the record.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <input value={ovLower} onChange={(e) => setOvLower(e.target.value)}
                           type="number" placeholder="Lower"
                           className="input-classic !py-2 text-xs bg-[var(--bg-page)]" />
                    <input value={ovRef} onChange={(e) => setOvRef(e.target.value)}
                           type="number" placeholder="Reference"
                           className="input-classic !py-2 text-xs bg-[var(--bg-page)]" />
                    <input value={ovUpper} onChange={(e) => setOvUpper(e.target.value)}
                           type="number" placeholder="Upper"
                           className="input-classic !py-2 text-xs bg-[var(--bg-page)]" />
                  </div>
                  <input value={ovReason} onChange={(e) => setOvReason(e.target.value)}
                         placeholder="Why (required — this is the audit trail)"
                         className="input-classic !py-2 text-xs w-full bg-[var(--bg-page)]" />
                  <button type="button"
                    disabled={busy || !ovReason.trim() || !ovRef}
                    onClick={async () => {
                      const r = await post('override', {
                        editionId, format, tier, condition,
                        lower: ovLower ? Number(ovLower) : null,
                        reference: Number(ovRef),
                        upper: ovUpper ? Number(ovUpper) : null,
                        reason: ovReason.trim(),
                      });
                      if (r) { setMessage('Override recorded.'); setOvReason(''); load(); }
                    }}
                    className="btn-outline !py-2 text-2xs disabled:opacity-50">
                    Record override
                  </button>
                </div>
              </details>

              <button type="button" disabled={busy}
                onClick={async () => {
                  const r = await post('recalculate', {
                    editionId, format, tier, condition, reason: `manual recompute by ${adminEmail}`,
                  });
                  if (r) { setMessage('Recomputed.'); load(); }
                }}
                className="text-2xs font-bold uppercase tracking-widest text-brand-gold-text underline">
                Force a recompute
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
