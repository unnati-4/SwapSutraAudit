import type { MugProduct } from '../types/mugs';

/**
 * Mug shelf filters (Oct 2026): price range, "on sale", where it is sold,
 * and sort order. Pure functions, so the page stays simple and the rules
 * can be tested without a browser.
 *
 * A mug without a price is never guessed at: it drops out as soon as a
 * price range is chosen, and sorts last when sorting by price.
 */

export type MugSort = 'recommended' | 'price-asc' | 'price-desc' | 'discount';

export interface PriceBand {
  id: string;
  label: string;
  min: number | null; // inclusive
  max: number | null; // inclusive
}

export const PRICE_BANDS: PriceBand[] = [
  { id: 'under-400', label: 'Under ₹400', min: null, max: 399 },
  { id: '400-699', label: '₹400 – ₹699', min: 400, max: 699 },
  { id: '700-999', label: '₹700 – ₹999', min: 700, max: 999 },
  { id: '1000-plus', label: '₹1,000 & above', min: 1000, max: null },
];

export const SORT_OPTIONS: { id: MugSort; label: string }[] = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'discount', label: 'Biggest discount' },
];

/** The empty string stands for SwapSutra's own listings. */
export const sellerOf = (p: MugProduct) => (p.sourceMarketplace || '').trim();

export const discountOf = (p: MugProduct) =>
  p.price && p.mrp && p.mrp > p.price ? (p.mrp - p.price) / p.mrp : 0;

export function inBand(p: MugProduct, band: PriceBand): boolean {
  if (!p.price) return false;
  if (band.min !== null && p.price < band.min) return false;
  if (band.max !== null && p.price > band.max) return false;
  return true;
}

export interface MugFilterState {
  bandId: string | null;
  onSale: boolean;
  seller: string | null; // null = any seller
  sort: MugSort;
}

export const EMPTY_FILTERS: MugFilterState = { bandId: null, onSale: false, seller: null, sort: 'recommended' };

export const filtersActive = (f: MugFilterState) => f.bandId !== null || f.onSale || f.seller !== null;

export function applyMugFilters(items: MugProduct[], f: MugFilterState): MugProduct[] {
  const band = f.bandId ? PRICE_BANDS.find((b) => b.id === f.bandId) || null : null;
  const kept = items.filter((p) =>
    (!band || inBand(p, band))
    && (!f.onSale || discountOf(p) > 0)
    && (f.seller === null || sellerOf(p) === f.seller));

  if (f.sort === 'recommended') return kept; // already in the admin's order
  // Stable sort: equal keys keep the admin's order.
  const indexed = kept.map((p, i) => ({ p, i }));
  const priced = (p: MugProduct) => (p.price ? 0 : 1); // unpriced mugs last
  indexed.sort((a, b) => {
    if (f.sort === 'discount') return discountOf(b.p) - discountOf(a.p) || a.i - b.i;
    const byPriced = priced(a.p) - priced(b.p);
    if (byPriced) return byPriced;
    const diff = (a.p.price || 0) - (b.p.price || 0);
    return (f.sort === 'price-asc' ? diff : -diff) || a.i - b.i;
  });
  return indexed.map((x) => x.p);
}

/** How many mugs each band would show, given the other filters as they are. */
export function bandCounts(items: MugProduct[], f: MugFilterState): Record<string, number> {
  const base = applyMugFilters(items, { ...f, bandId: null, sort: 'recommended' });
  return Object.fromEntries(PRICE_BANDS.map((b) => [b.id, base.filter((p) => inBand(p, b)).length]));
}

/** Sellers present on the shelf, in the order first seen. */
export function sellersOn(items: MugProduct[]): string[] {
  const seen: string[] = [];
  items.forEach((p) => { const s = sellerOf(p); if (!seen.includes(s)) seen.push(s); });
  return seen;
}
