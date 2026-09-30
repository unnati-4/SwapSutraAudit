// ════════════════════════════════════════════════════════════════════════
// SwapSutra — book catalogue and pricing API
//
// One Vercel serverless function, matching the flat-file convention the
// other functions in this directory already use (swapsutra.ts, sitemap.ts,
// notifications.ts). It is the ONLY route between the app and the pricing
// database.
//
// WHAT IT IS FOR
//   ?action=lookup&isbn=...        catalogue lookup, with Open Library
//                                  fallback and permanent caching
//   ?action=quote&isbn=&format=&tier=&condition=
//                                  the SELL band, the reference price and
//                                  the deposit, in one round trip
//   POST action=validateListing    the only way a listing price is accepted
//   POST action=swapDeposits       both sides of a two-book swap
//   POST action=observation        admin: record a price observation
//   POST action=recalculate        admin: force a band recompute
//   POST action=extract            admin: Gemini extraction, evidence-gated
//   POST action=override           admin: an audited manual correction
//   POST action=verifyMrpPhoto     admin: confirm a reader's printed MRP from
//                                  their own photo — the only route to the
//                                  strongest evidence tier
//
// WHAT IT DELIBERATELY DOES NOT DO
// It never computes a price. Every number comes from a Postgres function
// (compute_price_band, price_quote, validate_and_record_listing). This file
// moves data and enforces access; the arithmetic that decides how much money
// changes hands lives in one place, and that place is the database.
//
// SECURITY POSTURE
// The service-role key never leaves the server. The browser talks to this
// function; this function talks to Postgres. The pricing tables have RLS on
// with no policy for anon/authenticated, so even a leaked anon key reads
// nothing from them.
// ════════════════════════════════════════════════════════════════════════

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

export const config = { maxDuration: 30 };

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ADMIN_EMAIL = 'swapsutra@gmail.com';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';

// Open Library asks for an identifying User-Agent and grants 3 req/s to
// callers who send one, against 1 req/s for anonymous traffic. Identifying
// ourselves is both polite and three times faster.
const OL_USER_AGENT = 'SwapSutra/1.0 (https://swapsutra.in; hello@swapsutra.in)';
const OL_TIMEOUT_MS = 6000;
const OL_RETRIES = 2;

// ── ISBN handling ───────────────────────────────────────────────────────
// A wrong ISBN does not fail loudly. It silently prices the wrong book and
// then takes a deposit calculated from that price, so every ISBN entering
// the system is checksum-validated.

function normaliseIsbn(raw: unknown): string {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function isValidIsbn10(s: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(s)) return false;
  let total = 0;
  for (let i = 0; i < 9; i++) total += parseInt(s[i], 10) * (10 - i);
  total += s[9] === 'X' ? 10 : parseInt(s[9], 10);
  return total % 11 === 0;
}

function isValidIsbn13(s: string): boolean {
  if (!/^[0-9]{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(s[i], 10) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

function isbn10to13(s: string): string | null {
  if (!isValidIsbn10(s)) return null;
  const body = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(body[i], 10) * (i % 2 === 0 ? 1 : 3);
  return body + String((10 - (sum % 10)) % 10);
}

/**
 * The canonical ISBN-13, or null.
 *
 * Returns null rather than a best guess. A null ISBN costs one book that
 * cannot be scanned; a wrong ISBN costs somebody the wrong deposit.
 */
function canonicalIsbn13(raw: unknown): string | null {
  const clean = normaliseIsbn(raw);
  if (isValidIsbn13(clean)) return clean;
  if (isValidIsbn10(clean)) return isbn10to13(clean);
  return null;
}

// Open Library's physical_format is FREE TEXT — the type definition has no
// enum, and the real data contains "Paperback", "pbk.", "Mass Market
// Paperback", "Hardback" and a long tail. Order matters: mass-market must be
// tested before the generic paperback rule, or every mass-market copy
// collapses into TRADE_PAPERBACK and prices roughly twice too high.
const FORMAT_RULES: Array<[RegExp, string]> = [
  [/mass[\s-]?market|rack size|pocket/i, 'MASS_MARKET_PAPERBACK'],
  [/board\s*book/i, 'BOARD_BOOK'],
  [/spiral|comb\s*bound|wire[\s-]?o/i, 'SPIRAL'],
  [/hard\s*(cover|back|bound)|hbk|\bhc\b|cloth|library binding/i, 'HARDCOVER'],
  [/paper\s*(back|bound)|pbk|\bpb\b|softcover|soft\s*cover|trade\s*paper/i, 'TRADE_PAPERBACK'],
];

function normaliseFormat(raw: unknown): string {
  const text = String(raw || '').trim();
  if (!text) return 'UNKNOWN';
  for (const [re, value] of FORMAT_RULES) if (re.test(text)) return value;
  return 'UNKNOWN';   // never a guess: a wrong format prices the wrong ladder rung
}

const INDIAN_EDITION = /south\s*asia|indian?\s*(ed|edition|reprint)|for\s+sale\s+in\s+(india|south\s*asia)|low\s*price\s*edition|\blpe\b|student\s*edition|international\s*student/i;

function inferEditionTier(editionName?: string, publisher?: string): string {
  const blob = [editionName, publisher].filter(Boolean).join(' ');
  if (INDIAN_EDITION.test(blob)) return 'INDIAN_REPRINT';
  // NOT_SURE rather than PUBLISHER when nothing matches: claiming a copy is
  // a publisher edition when we do not know is the direction that
  // over-prices, and over-pricing takes too much off the other reader.
  return 'NOT_SURE';
}

function extractYear(publishDate: unknown): number | null {
  // publish_date is free text: "1998", "March 1998", "c1998", "1998-03-01".
  const m = /(1[4-9]\d{2}|20\d{2}|21\d{2})/.exec(String(publishDate || ''));
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return y >= 1400 && y <= 2100 ? y : null;
}

// ── Postgres access ─────────────────────────────────────────────────────
// Plain fetch against PostgREST rather than @supabase/supabase-js. One less
// dependency, one less thing to keep on a version, and the calls are all
// RPC anyway — the client library would add nothing here.

class ConfigError extends Error {}

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    // A missing configuration value must fail loudly and name itself. The
    // same lesson as APPS_SCRIPT_URL in swapsutra.ts: a silent fallback
    // turns a misconfiguration into an hour of debugging the wrong thing.
    throw new ConfigError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set for the book catalogue.');
  }
}

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  requireConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : (null as T);
}

async function table<T = any>(path: string, init?: RequestInit): Promise<T> {
  requireConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`table ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : (null as T);
}

// ── Open Library, on demand ─────────────────────────────────────────────

/**
 * One ISBN, fetched from Open Library's JSON endpoint.
 *
 * THIS IS THE CACHE-MISS PATH, NOT THE BULK-INGESTION PATH.
 *
 * Bulk catalogue ingestion goes through the monthly Open Library DUMPS —
 * pipeline/ingest_openlibrary.py, staged and merged by sql/002_staging.sql.
 * That is the sanctioned route for filling a catalogue with millions of
 * editions, and Open Library asks explicitly that the API not be used for
 * bulk download ("this affects our ability to serve patrons").
 *
 * What this covers is the narrow, low-volume remainder: a reader scanned an
 * ISBN the dump-loaded catalogue does not have, and is standing in the app
 * waiting. One record, one request, stored permanently — so the same ISBN is
 * never fetched twice and this path shrinks as the catalogue fills.
 *
 * Returns null for a genuine 404 (Open Library does not have it), and
 * throws for anything else, so "not in Open Library" and "Open Library is
 * down" are handled differently by the caller.
 */
async function fetchOpenLibrary(isbn13: string): Promise<any | null> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= OL_RETRIES; attempt++) {
    // Back off before a retry. Open Library's documented anonymous limit is
    // 1 req/s and 3 req/s when identified; a tight retry loop against a
    // rate-limited endpoint just earns a longer block.
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OL_TIMEOUT_MS);
    try {
      const res = await fetch(`https://openlibrary.org/isbn/${isbn13}.json`, {
        headers: { 'User-Agent': OL_USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (res.status === 404) return null;            // genuinely not there
      if (res.status === 429 || res.status >= 500) {   // retryable
        lastErr = new Error(`Open Library returned ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // AbortError and network failures are both worth one more try.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Open Library unreachable');
}

/** Resolves Open Library author references to names, best effort. */
async function resolveAuthors(rec: any): Promise<string[]> {
  const refs: string[] = (rec?.authors || [])
    .map((a: any) => a?.key).filter(Boolean).slice(0, 3);
  if (!refs.length) return [];
  const names: string[] = [];
  for (const key of refs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`https://openlibrary.org${key}.json`, {
        headers: { 'User-Agent': OL_USER_AGENT }, signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const a = await res.json();
        if (a?.name) names.push(String(a.name));
      }
    } catch {
      // An author name is nice to have. Losing it must not cost the book.
    }
  }
  return names;
}

/** One Open Library record, normalised into the shape the database takes. */
async function normaliseOpenLibrary(rec: any, isbn13: string) {
  const authors = await resolveAuthors(rec);
  const publisher = Array.isArray(rec?.publishers) ? rec.publishers[0] : rec?.publishers;
  const isbn10raw = Array.isArray(rec?.isbn_10) ? rec.isbn_10[0] : rec?.isbn_10;
  const isbn10 = normaliseIsbn(isbn10raw);
  const covers = Array.isArray(rec?.covers) ? rec.covers : [];
  const langs = Array.isArray(rec?.languages) ? rec.languages : [];

  return {
    isbn13,
    isbn10: isbn10.length === 10 ? isbn10 : null,
    title: String(rec?.title || '').slice(0, 500) || null,
    subtitle: rec?.subtitle ? String(rec.subtitle).slice(0, 500) : null,
    authors,
    publisher: publisher ? String(publisher).slice(0, 300) : null,
    publication_year: extractYear(rec?.publish_date),
    edition_name: rec?.edition_name ? String(rec.edition_name).slice(0, 200) : null,
    format: normaliseFormat(rec?.physical_format),
    edition_tier: inferEditionTier(rec?.edition_name, publisher),
    // MARC codes ('/languages/eng'), not ISO 639-1.
    language: langs[0]?.key ? String(langs[0].key).split('/').pop()!.slice(0, 3) : null,
    page_count: Number.isInteger(rec?.number_of_pages) && rec.number_of_pages < 20000
      ? rec.number_of_pages : null,
    cover_id: Number.isInteger(covers[0]) ? covers[0] : null,
    ol_edition_key: rec?.key || null,
    ol_work_key: rec?.works?.[0]?.key || null,
    category: null,
  };
}

// ── Handlers ────────────────────────────────────────────────────────────

/**
 * ISBN -> book. Database first, Open Library only on a miss.
 *
 * This is the caching contract the whole system rests on: an ISBN is
 * fetched from Open Library at most once, ever, and every later scan of the
 * same book is a single indexed lookup.
 */
async function handleLookup(isbnRaw: unknown) {
  const isbn13 = canonicalIsbn13(isbnRaw);
  if (!isbn13) {
    return {
      success: false, error: 'INVALID_ISBN',
      message: "That doesn't look like a valid ISBN. Please scan again or check the number.",
    };
  }

  // 1. Our own catalogue.
  const rows = await table<any[]>(
    `editions?isbn13=eq.${isbn13}&is_canonical=is.true&select=id,isbn13,isbn10,title,subtitle,authors,publisher,publication_year,edition_name,format,edition_tier,language,page_count,cover_id,mrp_inr&limit=1`);

  if (rows?.length) {
    return { success: true, source: 'catalogue', book: shapeBook(rows[0]) };
  }

  // 2. Open Library, once.
  let rec: any = null;
  try {
    rec = await fetchOpenLibrary(isbn13);
  } catch (err) {
    console.error('[books] Open Library unavailable:', err);
    return {
      success: false, error: 'LOOKUP_UNAVAILABLE',
      message: 'We could not reach the book database just now. You can still enter the details yourself.',
      isbn13, allowManualEntry: true,
    };
  }

  if (!rec) {
    // Not an error. Plenty of Indian editions are simply not in Open
    // Library, and the reader must still be able to list the book.
    return {
      success: false, error: 'NOT_FOUND',
      message: 'We could not find this ISBN. Please enter the book details yourself and we will add it.',
      isbn13, allowManualEntry: true,
    };
  }

  const normalised = await normaliseOpenLibrary(rec, isbn13);
  if (!normalised.title) {
    return {
      success: false, error: 'INCOMPLETE_METADATA',
      message: 'The record we found has no title. Please enter the book details yourself.',
      isbn13, allowManualEntry: true,
    };
  }

  // 3. Store it. The database owns duplicate prevention and canonical
  //    selection, so a second concurrent scan of the same ISBN returns the
  //    row the first one created rather than making another.
  const editionId = await rpc<number>('upsert_edition_from_openlibrary', { p_rec: normalised });

  const saved = await table<any[]>(
    `editions?id=eq.${editionId}&select=id,isbn13,isbn10,title,subtitle,authors,publisher,publication_year,edition_name,format,edition_tier,language,page_count,cover_id,mrp_inr&limit=1`);

  return { success: true, source: 'openlibrary', book: shapeBook(saved?.[0] || normalised) };
}

function shapeBook(row: any) {
  return {
    editionId: row.id ?? null,
    isbn13: row.isbn13,
    isbn10: row.isbn10 ?? null,
    title: row.title,
    subtitle: row.subtitle ?? null,
    authors: row.authors ?? [],
    publisher: row.publisher ?? null,
    publicationYear: row.publication_year ?? null,
    editionName: row.edition_name ?? null,
    format: row.format ?? 'UNKNOWN',
    editionTier: row.edition_tier ?? 'NOT_SURE',
    language: row.language ?? null,
    pageCount: row.page_count ?? null,
    mrp: row.mrp_inr ?? null,
    coverUrl: row.cover_id
      ? `https://covers.openlibrary.org/b/id/${row.cover_id}-M.jpg` : null,
  };
}

/**
 * The three numbers a listing screen needs, computed in Postgres and kept
 * apart on purpose:
 *
 *   sell.allowed_min / allowed_max   the ALLOWED LISTING RANGE — what the
 *                                    seller may choose from.
 *   reference_price                  SwapSutra's deterministic REFERENCE
 *                                    VALUE, used for non-sale transactions.
 *                                    It is not a claim about market value.
 *   deposit                          the SECURITY DEPOSIT, derived from the
 *                                    reference value, never from whatever the
 *                                    seller chose to list at.
 */
async function handleQuote(q: Record<string, unknown>) {
  const isbn13 = canonicalIsbn13(q.isbn);
  if (!isbn13) {
    return { success: false, error: 'INVALID_ISBN', message: 'That ISBN is not valid.' };
  }
  const quote = await rpc('price_quote', {
    p_isbn13: isbn13,
    p_format: String(q.format || 'UNKNOWN'),
    p_tier: String(q.tier || 'NOT_SURE'),
    p_condition: String(q.condition || 'GOOD'),
  });
  return { success: true, ...(quote as object) };
}

/**
 * The only path by which a listing price is accepted.
 *
 * Note what is NOT taken from the request: the band, the reference price and
 * the deposit. The client sends a price and the server compares it; nothing
 * the client sends can move the number the other reader pays.
 */
async function handleValidateListing(body: Record<string, unknown>) {
  const isbn13 = canonicalIsbn13(body.isbn);
  if (!isbn13) {
    return { success: false, error: 'INVALID_ISBN', message: 'That ISBN is not valid.' };
  }
  const result = await rpc('validate_and_record_listing', {
    p_listing_id: String(body.listingId || ''),
    p_owner_email: String(body.ownerEmail || '').toLowerCase().trim(),
    p_isbn13: isbn13,
    p_format: String(body.format || 'UNKNOWN'),
    p_tier: String(body.tier || 'NOT_SURE'),
    p_condition: String(body.condition || 'GOOD'),
    p_sell_price: body.sellPrice != null ? Number(body.sellPrice) : null,
    p_mrp_claim: body.mrp != null ? Number(body.mrp) : null,
    p_mrp_proof: body.mrpProofUrl ? String(body.mrpProofUrl) : null,
  });
  const r = result as any;
  return { success: Boolean(r?.ok), ...r };
}

// ── Gemini extraction, evidence-gated ───────────────────────────────────

const PLAUSIBLE_INR: Record<string, [number, number]> = {
  'Medical & Nursing': [300, 15000],
  'Engineering & Technical': [150, 12000],
  Law: [100, 8000],
  'Competitive Exams': [80, 5000],
  'School & Board Prep': [40, 3000],
  Academic: [100, 12000],
  __default__: [30, 5000],
};

const EXTRACTION_PROMPT = `You are extracting book price information from the text of a web page.

CRITICAL RULES
1. Only report a price that appears LITERALLY in the text below. If the page
   does not state a price, return an empty list. Do not use any knowledge you
   have about this book from anywhere else.
2. For every price, include "quote": the exact substring of the text the
   price came from, copied character for character.
3. Do not convert currencies. Do not estimate. Do not average.
4. If you are unsure whether a number is a price, leave it out.

Classify each price:
  kind: "MRP" | "NEW_RETAIL" | "USED_RETAIL" | "EBOOK"
  format: "HARDCOVER" | "TRADE_PAPERBACK" | "MASS_MARKET_PAPERBACK" | "UNKNOWN"

Return ONLY JSON:
{"prices":[{"price":<number>,"currency":"<code>","kind":"<kind>","format":"<format>","quote":"<verbatim substring>"}]}

PAGE TEXT:
---
`;

/**
 * Verifies one extracted price against the source text.
 *
 * The defence that actually works is the substring check. Asked what a book
 * costs, a model produces a confident, plausible, invented number; a model
 * required to quote the page it was given, whose quote is then checked
 * against that page, cannot. Everything else here is a backstop.
 */
function verifyExtraction(item: any, pageText: string, category?: string) {
  const reject = (reason: string) => ({
    price: Number(item?.price) || 0, kind: String(item?.kind || 'UNKNOWN'),
    format: String(item?.format || 'UNKNOWN'), quote: String(item?.quote || ''),
    accepted: false, reason,
  });

  const price = Number(item?.price);
  if (!Number.isFinite(price) || price <= 0) return reject('price is not a positive number');

  const currency = String(item?.currency || '').toUpperCase();
  if (!['INR', 'RS', 'RS.', '₹'].includes(currency)) {
    return reject(`currency ${currency || '(none)'} is not INR — no conversion is ever performed`);
  }

  const quote = String(item?.quote || '');
  if (!quote) return reject('no verbatim quote supplied');
  if (!pageText.includes(quote)) {
    return reject('quote is not a substring of the source text (hallucinated)');
  }

  const digits = (s: string) => s.replace(/[^0-9]/g, '');
  if (!digits(quote).includes(digits(String(Math.round(price))))) {
    return reject('the price does not appear within its own quote');
  }

  const [lo, hi] = PLAUSIBLE_INR[category || ''] || PLAUSIBLE_INR.__default__;
  if (price < lo || price > hi) {
    return reject(`Rs.${price} is outside the plausible range for ${category || 'this category'} (Rs.${lo}-Rs.${hi})`);
  }

  const kind = String(item?.kind || '').toUpperCase();
  if (!['MRP', 'NEW_RETAIL', 'USED_RETAIL', 'EBOOK'].includes(kind)) {
    return reject(`unknown price kind ${kind || '(none)'}`);
  }

  let format = String(item?.format || 'UNKNOWN').toUpperCase();
  if (!['HARDCOVER', 'TRADE_PAPERBACK', 'MASS_MARKET_PAPERBACK', 'UNKNOWN'].includes(format)) {
    format = 'UNKNOWN';
  }
  // An ebook price is not a print price. Forced formatless here, and the
  // database refuses it against a print format as well — stated twice
  // because a violation is silent and expensive.
  if (kind === 'EBOOK') format = 'UNKNOWN';

  return { price, kind, format, quote, accepted: true, reason: null as string | null };
}

async function handleExtract(body: Record<string, unknown>) {
  if (!GEMINI_API_KEY) {
    return { success: false, error: 'GEMINI_NOT_CONFIGURED',
             message: 'GEMINI_API_KEY is not set on the server.' };
  }
  const isbn13 = canonicalIsbn13(body.isbn);
  const pageText = String(body.pageText || '').slice(0, 40000);
  if (!isbn13 || !pageText) {
    return { success: false, error: 'BAD_REQUEST',
             message: 'An ISBN and the source page text are both required.' };
  }

  let raw = '';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: EXTRACTION_PROMPT + pageText + '\n---\n' }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      });
    if (!res.ok) throw new Error(`Gemini returned ${res.status}`);
    const payload = await res.json();
    raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    console.error('[books] Gemini extraction failed:', err);
    return { success: false, error: 'EXTRACTION_FAILED',
             message: 'The extraction service did not respond. No observations were recorded.' };
  }

  let items: any[] = [];
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    items = Array.isArray(parsed?.prices) ? parsed.prices : [];
  } catch {
    // Malformed JSON is a rejection, not a crash, and it is recorded as
    // such so a run of them is visible rather than invisible.
    return { success: false, error: 'MALFORMED_RESPONSE',
             message: 'The extraction service returned something we could not read. No observations were recorded.' };
  }

  const verified = items.map(i => verifyExtraction(i, pageText, String(body.category || '')));

  const edition = await table<any[]>(`editions?isbn13=eq.${isbn13}&is_canonical=is.true&select=id&limit=1`);
  const editionId = edition?.[0]?.id;
  if (!editionId) {
    return { success: false, error: 'BOOK_NOT_FOUND',
             message: 'That ISBN is not in the catalogue yet.' };
  }

  // Rejected extractions are STORED, not dropped. A filter you cannot
  // inspect is a filter you cannot debug, and a spike in one rejection
  // reason is the earliest warning that a source changed its page layout.
  const rows = verified.map(v => ({
    edition_id: editionId, isbn13, format: v.format, kind: v.kind,
    price: v.price, currency: 'INR', source: 'ADMIN_MANUAL',
    source_url: body.sourceUrl ? String(body.sourceUrl) : null,
    source_ref: v.quote.slice(0, 200),
    excluded: !v.accepted, excluded_reason: v.reason,
    // An extracted MRP carries an EVIDENCE TIER, and the rule is strict: a
    // model-produced number reaches PUBLISHER_SOURCED only when its quote was
    // checked against a real supplied source page. Everything else — an
    // accepted extraction with no source URL behind it included — lands as
    // USER_PROVISIONAL, which the pricing engine will not anchor on. So an
    // LLM cannot produce a trusted MRP by itself under any circumstances.
    evidence_tier: v.kind === 'MRP'
      ? (v.accepted && Boolean(body.sourceUrl) ? 'PUBLISHER_SOURCED' : 'USER_PROVISIONAL')
      : null,
    confidence: v.accepted ? 0.6 : 0,
  }));

  if (rows.length) {
    await table('book_prices?on_conflict=edition_id,source,kind,format,collected_on', {
      method: 'POST', body: JSON.stringify(rows),
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    }).catch(err => console.error('[books] observation insert:', err));
  }

  return {
    success: true,
    accepted: verified.filter(v => v.accepted).length,
    rejected: verified.filter(v => !v.accepted).length,
    observations: verified,
  };
}

// ── Admin gate ──────────────────────────────────────────────────────────
// Admin identity is verified against the Apps Script session, which is the
// app's existing source of truth for who is an admin. Re-implementing that
// check here would be a second, divergent answer to the same question.

/**
 * Is there a signed-in reader behind this request?
 *
 * The lookup action is not a read-only proxy: a miss writes a new edition
 * row through upsert_edition_from_openlibrary. Left open, anyone could pump
 * arbitrary ISBNs into the catalogue that the pricing engine then reasons
 * over. The old Google Books route was gated for a weaker reason than this
 * one — it only spent someone else's quota — so this route does not get to
 * be more open than the route it replaces.
 *
 * Identity is checked against the Apps Script session, the same source of
 * truth isAdmin uses, so there is one answer to "who is this" and not two.
 */
/**
 * Reads the session token from wherever the caller put it.
 *
 * Three spellings are in use across this app and all three are legitimate:
 * the admin panel sends `x-swapsutra-session`, the main API client sends
 * `Authorization: Bearer`, and POST bodies carry `sessionToken`. Accepting
 * one and silently rejecting the others is how a signed-in reader gets told
 * to sign in.
 */
function sessionTokenFrom(req: VercelRequest): string {
  const auth = req.headers['authorization'];
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ')
    ? auth.slice(7).trim() : '';
  return String(
    bearer
    || req.headers['x-swapsutra-session']
    || (req.body as any)?.sessionToken
    || req.query?.sessionToken
    || '').trim();
}

/**
 * Verifies a token against Apps Script, which holds the signing key.
 *
 * `resolveSession` is the action that exists — it is the same one
 * api/swapsutra.ts uses for every proxy-answered endpoint, and it is
 * deliberately session-exempt so a token can be presented for checking.
 * It is a POST; there is no GET form and no `verifySession` action, and
 * asking for one returns a polite failure that reads exactly like an
 * expired session.
 */
async function resolveSession(req: VercelRequest): Promise<{ email: string; role: string } | null> {
  const token = sessionTokenFrom(req);
  if (!token || !APPS_SCRIPT_URL) return null;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveSession', sessionToken: token }),
    });
    const data: any = await res.json().catch(() => null);
    if (!data?.success || !data?.email) return null;
    return {
      email: String(data.email).trim().toLowerCase(),
      role: String(data.role || 'member'),
    };
  } catch (err) {
    // Fail closed — an unverifiable caller is not a signed-in one.
    console.error('[books] resolveSession failed:', err);
    return null;
  }
}

async function isSignedIn(req: VercelRequest): Promise<boolean> {
  return Boolean(await resolveSession(req));
}

async function isAdmin(req: VercelRequest): Promise<boolean> {
  // The admin's identity comes from the verified session, never from the
  // adminEmail in the request — that field only says which account the
  // caller CLAIMS to be, and anyone can type it.
  const session = await resolveSession(req);
  return session?.email === ADMIN_EMAIL;
}

// ── Shelf covers ────────────────────────────────────────────────────────
// GET ?action=cover&isbn=...  → the publisher's front cover as image bytes.
//
// Every book on a shelf shows the cover Google Books has for its ISBN
// (owner's decision, 23 Sep); the reader's own photos stay on the book's
// page. The bytes are served from here, not hot-linked, for two reasons:
//   1. same origin, so the "share my shelf" image can draw them on a canvas
//      (Google's image host sends no CORS headers, which taints a canvas);
//   2. the CDN caches each cover for a month, so Google is asked about an
//      ISBN roughly once, not once per reader per page view.
// Open Library is the fallback when Google has no image. A 404 tells the
// page to fall back to the reader's own front-cover photo.
const COVER_TIMEOUT_MS = 6000;
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), COVER_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

type Fetched = { type: string; body: Buffer };
type FetchOutcome = Fetched | 'miss' | 'error';

/** Image bytes, or 'miss' (the source has no image), or 'error' (it could
 *  not be asked — timeout, rate limit, 5xx). The difference matters: a miss
 *  may be cached, an error must not be. */
async function fetchImage(url: string): Promise<FetchOutcome> {
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': OL_USER_AGENT } });
    if (r.status === 404) return 'miss';
    if (!r.ok) return 'error';
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return 'miss';
    const body = Buffer.from(await r.arrayBuffer());
    // Anything this small is a spacer or Google's "image not available"
    // placeholder (a 1,269-byte PNG), not a cover.
    if (body.length < 1500) return 'miss';
    if (isGooglePlaceholder(body)) return 'miss';
    return { type, body };
  } catch { return 'error'; }
}

async function imageBytes(url: string): Promise<Fetched | null> {
  const r = await fetchImage(url);
  return typeof r === 'object' ? r : null;
}

// Google's grey "no cover" book, served for volumes that exist but have no
// scan. Measured 23 Sep: always this exact 10,794-byte JPEG, whatever the
// ISBN and whatever size is asked for.
const GOOGLE_GREY_PLACEHOLDER = { bytes: 10794, sha256Prefix: 'a9af51' };
function isGooglePlaceholder(body: Buffer): boolean {
  if (body.length !== GOOGLE_GREY_PLACEHOLDER.bytes) return false;
  return createHash('sha256').update(body).digest('hex').startsWith(GOOGLE_GREY_PLACEHOLDER.sha256Prefix);
}

function isbn13to10(s: string): string | null {
  if (!/^978\d{10}$/.test(s)) return null;
  const core = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(core[i], 10) * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? 'X' : String(c));
}

/** Google Books' cover link for an ISBN via the Books API (quota-limited:
 *  the keyless quota is shared by everyone and is often exhausted, which
 *  is why this is the second route, not the first). */
async function googleApiCoverUrl(isbn: string): Promise<string | null | 'error'> {
  const key = GOOGLE_BOOKS_API_KEY ? `&key=${encodeURIComponent(GOOGLE_BOOKS_API_KEY)}` : '';
  try {
    const r = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1&fields=items(volumeInfo/imageLinks)${key}`);
    if (!r.ok) return 'error';
    const data: any = await r.json();
    const links = data?.items?.[0]?.volumeInfo?.imageLinks || {};
    const raw: string = links.thumbnail || links.smallThumbnail || '';
    if (!raw) return null;
    return raw.replace(/^http:/, 'https:').replace(/&edge=curl/g, '');
  } catch { return 'error'; }
}

const looksLikeIsbn = (s: string) => /^\d{9}[\dX]$/.test(s) || /^\d{13}$/.test(s);

/**
 * The publisher's cover for an ISBN.
 *   1. Google Books' cover-by-ISBN image (books.google.com/books/content
 *      ?vid=ISBN…). No API, no quota — the Books API's keyless quota was
 *      exhausted on 23 Sep and half the shelf lost its covers because of it.
 *   2. The Books API, when it answers.
 *   3. Open Library.
 * `transient` is true when a source could not be asked, so the caller does
 * not cache "no cover" for a book that may well have one.
 */
export async function resolveCoverDetailed(rawIsbn: unknown): Promise<{ cover: Fetched | null; transient: boolean }> {
  const clean = normaliseIsbn(rawIsbn);
  if (!looksLikeIsbn(clean)) return { cover: null, transient: false };
  const isbn13 = canonicalIsbn13(clean);
  // A mistyped check digit still identifies the book to Google more often
  // than not, so the number as typed is tried too.
  const ids = Array.from(new Set([isbn13, clean, isbn13 ? isbn13to10(isbn13) : null].filter(Boolean) as string[]));
  let transient = false;
  const note = (r: FetchOutcome) => { if (r === 'error') transient = true; return typeof r === 'object' ? r : null; };

  for (const id of ids) {
    const base = `https://books.google.com/books/content?vid=ISBN${id}&printsec=frontcover&img=1&zoom=1`;
    const hit = note(await fetchImage(`${base}&fife=w600`)) || note(await fetchImage(base));
    if (hit) return { cover: hit, transient };
  }

  for (const id of ids.slice(0, 2)) {
    const g = await googleApiCoverUrl(id);
    if (g === 'error') { transient = true; break; }
    if (g) {
      const hit = note(await fetchImage(`${g}&fife=w600`)) || note(await fetchImage(g));
      if (hit) return { cover: hit, transient };
    }
  }

  const olId = isbn13 || clean;
  const ol = note(await fetchImage(`https://covers.openlibrary.org/b/isbn/${olId}-L.jpg?default=false`));
  return { cover: ol, transient };
}

export async function resolveCover(rawIsbn: unknown): Promise<Fetched | null> {
  return (await resolveCoverDetailed(rawIsbn)).cover;
}

async function handleCover(req: VercelRequest, res: VercelResponse) {
  const isbn = req.query.isbn;
  if (!looksLikeIsbn(normaliseIsbn(isbn))) {
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(400).json({ success: false, error: 'INVALID_ISBN' });
  }
  const { cover, transient } = await resolveCoverDetailed(isbn);
  if (!cover) {
    // A real "nobody has a cover" is cached for a few hours (covers do get
    // added). A failed lookup is not cached at all, so the next view asks again.
    res.setHeader('Cache-Control', transient ? 'no-store' : 'public, max-age=3600, s-maxage=21600');
    return res.status(transient ? 503 : 404).json({ success: false, error: transient ? 'COVER_LOOKUP_FAILED' : 'NO_COVER' });
  }
  res.setHeader('Content-Type', cover.type);
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).send(cover.body);
}

// GET ?action=image&id=<Google Drive file id> → that photo's bytes.
// Readers' photos live on Google Drive, whose image host sends no CORS
// headers, so the browser cannot read them to attach them to a share or
// draw them on the shelf image. This relays ONLY Drive thumbnails: the id
// is validated and the URL is built here, so it cannot be pointed anywhere
// else.
async function handleDriveImage(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id || '');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) {
    return res.status(400).json({ success: false, error: 'INVALID_ID' });
  }
  const img = await imageBytes(`https://drive.google.com/thumbnail?id=${id}&sz=w1200`);
  if (!img) {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return res.status(404).json({ success: false, error: 'NO_IMAGE' });
  }
  res.setHeader('Content-Type', img.type);
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).send(img.body);
}

// ── Router ──────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action || (req.body as any)?.action || '');

  try {
    switch (action) {
      case 'cover':
        return await handleCover(req, res);

      case 'image':
        return await handleDriveImage(req, res);

      case 'lookup': {
        if (!(await isSignedIn(req))) {
          return res.status(401).json({
            success: false, error: 'AUTH_REQUIRED',
            message: 'Please sign in to look up book details.',
          });
        }
        return res.status(200).json(await handleLookup(req.query.isbn ?? (req.body as any)?.isbn));
      }

      case 'quote':
        return res.status(200).json(await handleQuote({ ...req.query, ...(req.body as any || {}) }));

      case 'validateListing': {
        if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'POST required.' });
        return res.status(200).json(await handleValidateListing((req.body as any) || {}));
      }

      case 'swapDeposits': {
        const b = (req.body as any) || {};
        const out = await rpc('swap_deposits', {
          p_listing_a: String(b.listingA || ''), p_listing_b: String(b.listingB || ''),
        });
        return res.status(200).json({ success: true, ...(out as object) });
      }

      // ── admin ────────────────────────────────────────────────────────
      case 'observation':
      case 'recalculate':
      case 'extract':
      case 'override':
      case 'verifyMrpPhoto': {
        if (!(await isAdmin(req))) {
          return res.status(403).json({ success: false, error: 'UNAUTHORIZED',
                                        message: 'Admin access is required.' });
        }
        const b = (req.body as any) || {};

        if (action === 'extract') return res.status(200).json(await handleExtract(b));

        if (action === 'observation') {
          const isbn13 = canonicalIsbn13(b.isbn);
          if (!isbn13) return res.status(200).json({ success: false, error: 'INVALID_ISBN' });
          const ed = await table<any[]>(`editions?isbn13=eq.${isbn13}&is_canonical=is.true&select=id&limit=1`);
          if (!ed?.[0]) return res.status(200).json({ success: false, error: 'BOOK_NOT_FOUND' });
          await table('book_prices', {
            method: 'POST',
            body: JSON.stringify({
              edition_id: ed[0].id, isbn13, format: String(b.format || 'UNKNOWN'),
              kind: String(b.kind || 'NEW_RETAIL'), price: Number(b.price),
              currency: 'INR', condition: b.condition || null,
              source: 'ADMIN_MANUAL', source_url: b.sourceUrl || null,
              source_ref: b.note || null, confidence: 0.9,
              // An admin entering an MRP is asserting it from somewhere. With
              // a source URL that is publisher-grade; without one it is
              // provisional like any other unsupported claim, even though an
              // admin typed it. The hierarchy has no staff exemption.
              evidence_tier: String(b.kind || 'NEW_RETAIL') === 'MRP'
                ? (b.sourceUrl ? 'PUBLISHER_SOURCED' : 'USER_PROVISIONAL')
                : null,
            }),
          });
          // A new observation invalidates the cached band immediately.
          await rpc('get_or_compute_band', {
            p_edition_id: ed[0].id, p_format: String(b.format || 'UNKNOWN'),
            p_tier: String(b.tier || 'PUBLISHER'), p_condition: String(b.condition || 'GOOD'),
            p_force: true, p_reason: `admin observation by ${b.adminEmail}`,
          });
          return res.status(200).json({ success: true });
        }

        if (action === 'verifyMrpPhoto') {
          // The only path to PHOTO_VERIFIED. A human looked at the reader's
          // photo and read the printed MRP off it — which is why this cannot
          // be reached from a reader's own request.
          const out = await rpc('verify_mrp_from_photo', {
            p_observation_id: Number(b.observationId),
            p_admin_email: String(b.adminEmail || ''),
            p_confirmed_mrp: Number(b.confirmedMrp),
          });
          return res.status(200).json({ success: Boolean((out as any)?.ok), ...(out as object) });
        }

        if (action === 'recalculate') {
          const out = await rpc('get_or_compute_band', {
            p_edition_id: Number(b.editionId), p_format: String(b.format || 'UNKNOWN'),
            p_tier: String(b.tier || 'PUBLISHER'), p_condition: String(b.condition || 'GOOD'),
            p_force: true, p_reason: String(b.reason || `manual recompute by ${b.adminEmail}`),
          });
          return res.status(200).json({ success: true, band: out });
        }

        // override — recorded as a row beside the computed band, never as
        // an edit to it, so the automated value is still visible.
        await table('price_overrides', {
          method: 'POST',
          body: JSON.stringify({
            edition_id: Number(b.editionId), format: String(b.format || 'UNKNOWN'),
            edition_tier: String(b.tier || 'PUBLISHER'), condition: b.condition || null,
            override_mrp: b.mrp != null ? Number(b.mrp) : null,
            override_lower: b.lower != null ? Number(b.lower) : null,
            override_ref: b.reference != null ? Number(b.reference) : null,
            override_upper: b.upper != null ? Number(b.upper) : null,
            reason: String(b.reason || ''), admin_email: String(b.adminEmail || ''),
          }),
        });
        await rpc('get_or_compute_band', {
          p_edition_id: Number(b.editionId), p_format: String(b.format || 'UNKNOWN'),
          p_tier: String(b.tier || 'PUBLISHER'), p_condition: String(b.condition || 'GOOD'),
          p_force: true, p_reason: `admin override: ${b.reason}`,
        });
        return res.status(200).json({ success: true });
      }

      default:
        return res.status(400).json({ success: false, error: 'UNKNOWN_ACTION',
                                      message: `Unknown action "${action}".` });
    }
  } catch (err) {
    // Never show a reader a raw backend error. The detail goes to the log,
    // where it is useful; the reader gets something they can act on.
    console.error('[books] unhandled:', err);
    if (err instanceof ConfigError) {
      return res.status(500).json({ success: false, error: 'NOT_CONFIGURED',
                                    message: 'The book catalogue is not configured on this deployment.' });
    }
    return res.status(500).json({ success: false, error: 'SERVER_ERROR',
                                  message: 'Something went wrong looking that up. Please try again.' });
  }
}

// Exported for the test suite. These are pure functions and the ones most
// worth pinning: an ISBN that validates wrongly prices the wrong book, and a
// format that normalises wrongly prices the wrong ladder rung.
export const __test = {
  canonicalIsbn13, isValidIsbn10, isValidIsbn13, isbn10to13,
  normaliseFormat, inferEditionTier, extractYear, verifyExtraction,
};
