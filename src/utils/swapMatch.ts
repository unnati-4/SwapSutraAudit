/**
 * Swap matching, client side (Oct 2026). Mirrors swapBooksMatch_ in
 * appsscript.js so the swap form can grey out books that won't qualify
 * BEFORE the reader sends a request. The server's copy decides; this one
 * only saves a round trip. tests/test_swap_match_mirror.cjs keeps them equal.
 *
 * A swap needs: the same condition, the same type (Paperback, Hardcover or
 * Budget copy), and printed MRPs within 10% of each other.
 */

export const SWAP_MRP_TOLERANCE = 0.10;

export interface SwapMatchBook {
  condition?: string;
  bookFormat?: string;
  format?: string;
  bookEdition?: string;
  edition?: string;
  copyType?: string;
  effectiveMRP?: number | null;
  printedMrp?: number | null;
  userEnteredMRP?: number | null;
  mrp?: number | null;
}

export type SwapMismatch = 'condition' | 'type' | 'type_unknown' | 'mrp' | 'mrp_unknown';

/** Same five grades and the same old-label mapping as normalizeConditionGrade. */
export function conditionGrade(raw: unknown): string {
  const v = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['AS_NEW', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR'].includes(v)) return v;
  if (v === 'LIKE_NEW' || v === 'NEW') return 'AS_NEW';
  if (v === 'VERYGOOD') return 'VERY_GOOD';
  if (v === 'WORN' || v === 'POOR_WORN') return 'POOR';
  return 'GOOD';
}

const FORMAT_SYNONYMS: Record<string, string> = {
  HARDCOVER: 'HARDCOVER', HARDBACK: 'HARDCOVER', HARDBOUND: 'HARDCOVER', HARD_COVER: 'HARDCOVER',
  PAPERBACK: 'PAPERBACK', SOFTCOVER: 'PAPERBACK', SOFTBACK: 'PAPERBACK', TRADE_PAPERBACK: 'PAPERBACK',
  MASS_MARKET: 'PAPERBACK', MASS_MARKET_PAPERBACK: 'PAPERBACK',
};

/** PAPERBACK, HARDCOVER, BUDGET (a reprint) or UNKNOWN. */
export function swapBookType(b: SwapMatchBook): 'PAPERBACK' | 'HARDCOVER' | 'BUDGET' | 'UNKNOWN' {
  const edition = String(b.bookEdition || b.edition || b.copyType || '').trim().toUpperCase();
  if (edition === 'REPRINT') return 'BUDGET';
  const fmt = FORMAT_SYNONYMS[String(b.bookFormat || b.format || '').trim().toUpperCase().replace(/[.\s-]+/g, '_')];
  return fmt === 'HARDCOVER' || fmt === 'PAPERBACK' ? fmt : 'UNKNOWN';
}

function mrpOf(b: SwapMatchBook): number | null {
  for (const v of [b.effectiveMRP, b.userEnteredMRP, b.printedMrp, b.mrp]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

const TYPE_LABEL = { PAPERBACK: 'paperback', HARDCOVER: 'hardcover', BUDGET: 'budget copy', UNKNOWN: 'no type set' };

export function swapMatch(a: SwapMatchBook, b: SwapMatchBook): { ok: boolean; reasons: SwapMismatch[]; summary: string } {
  const reasons: SwapMismatch[] = [];
  const bits: string[] = [];
  if (conditionGrade(a.condition) !== conditionGrade(b.condition)) { reasons.push('condition'); bits.push('different condition'); }
  const ta = swapBookType(a), tb = swapBookType(b);
  if (ta === 'UNKNOWN' || tb === 'UNKNOWN') { reasons.push('type_unknown'); bits.push('type not set'); }
  else if (ta !== tb) { reasons.push('type'); bits.push(`${TYPE_LABEL[tb]}, not ${TYPE_LABEL[ta]}`); }
  const ma = mrpOf(a), mb = mrpOf(b);
  if (ma === null || mb === null) { reasons.push('mrp_unknown'); bits.push('no MRP'); }
  else if (Math.abs(ma - mb) > Math.max(ma, mb) * SWAP_MRP_TOLERANCE) { reasons.push('mrp'); bits.push(`MRP ₹${Math.round(mb)} vs ₹${Math.round(ma)}`); }
  return { ok: reasons.length === 0, reasons, summary: bits.join(' · ') };
}
