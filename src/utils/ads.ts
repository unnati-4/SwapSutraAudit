import { apiUrl } from '../config/runtime';

/**
 * Sponsored ads + the mixed Library shelf (9 Oct 2026, owner's request:
 * "admin ad laga sakta hai bookstore ka ya author ka ya koi particular book
 * ka, vo ad library ke banner pe bhi show hoga or bookshelf me bhi books ke
 * bich bich me, or books or mugs shuffle hote rahenge har open karne par").
 *
 * - The admin's ads come from Apps Script (getSponsoredAds); each is shown
 *   as "Sponsored" and its link opens with rel="sponsored".
 * - Every time the Library is opened the shelf gets a new seed: the books
 *   are shuffled, and mugs and ads are dropped in between them.
 */

export type AdKind = 'bookstore' | 'author' | 'book';
export type AdPlacement = 'both' | 'banner' | 'shelf';

export interface SponsoredAd {
  id: string;
  kind: AdKind;
  sponsor: string;
  headline: string;
  tagline: string;
  imageUrl: string;
  linkUrl: string;
  bookId: string;
  ctaLabel: string;
  placement: AdPlacement;
  /** A SwapSutra partner's banner or ad (9 Oct 2026) — shown with the SwapSutra logo. */
  partner?: boolean;
}

export const AD_KIND_LABEL: Record<AdKind, string> = { bookstore: 'Bookstore', author: 'Author', book: 'Book' };

export const adShowsOn = (ad: SponsoredAd, where: 'banner' | 'shelf') => ad.placement === 'both' || ad.placement === where;

export const adCta = (ad: SponsoredAd) =>
  ad.ctaLabel || (ad.kind === 'bookstore' ? 'Visit the store' : ad.kind === 'author' ? 'Meet the author' : 'See the book');

/** A Google Drive share link → an image link a page can show. */
export function adImageSrc(url: string): string {
  const u = String(url || '').trim();
  const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/.exec(u);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600` : u;
}

const API = apiUrl('/api/swapsutra');
let adsPromise: Promise<SponsoredAd[]> | null = null;
let adsAt = 0;

/** The live ads, fetched at most once every 5 minutes per tab. */
export function loadSponsoredAds(force = false): Promise<SponsoredAd[]> {
  if (!force && adsPromise && Date.now() - adsAt < 5 * 60 * 1000) return adsPromise;
  adsAt = Date.now();
  adsPromise = fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getSponsoredAds' }) })
    .then((r) => r.json())
    .then((d) => (d?.success && Array.isArray(d.items) ? (d.items as SponsoredAd[]) : []))
    .catch(() => { adsPromise = null; return []; });
  return adsPromise;
}

/** Count a click. Fire-and-forget; never blocks opening the link. */
export function recordAdClick(id: string) {
  try {
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recordAdClick', id }), keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}

/** Small seeded random generator (mulberry32), so a shuffle is stable for one visit. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rnd = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type ShelfItem<B, M> =
  | { type: 'book'; key: string; book: B }
  | { type: 'mug'; key: string; mug: M }
  | { type: 'ad'; key: string; ad: SponsoredAd };

/**
 * The Library shelf for one visit: books (shuffled unless `keepBookOrder`,
 * e.g. when sorted nearest-first), with a mug or an ad after every few
 * books. Mugs and ads each take turns in a shuffled order and repeat only
 * once all have been shown; nothing extra is added when there are no books.
 */
export function mixShelf<B extends { id: string | number }, M extends { id: string | number }>(
  books: readonly B[], mugs: readonly M[], ads: readonly SponsoredAd[], seed: number,
  opts: { keepBookOrder?: boolean; every?: number } = {},
): ShelfItem<B, M>[] {
  const every = Math.max(2, opts.every || 5);
  const ordered = opts.keepBookOrder ? books.slice() : shuffled(books, seed);
  const mugQueue = shuffled(mugs, seed + 1);
  const adQueue = shuffled(ads, seed + 2);
  const rnd = seededRandom(seed + 3);
  const out: ShelfItem<B, M>[] = [];
  let mi = 0, ai = 0, slot = 0;
  // Ads lead the extras when there are ads (the first extra slot is an ad).
  let nextIsAd = adQueue.length > 0 && (mugQueue.length === 0 || rnd() < 0.6);
  ordered.forEach((book, i) => {
    out.push({ type: 'book', key: `b-${book.id}`, book });
    const isGap = (i + 1) % every === 0 && i < ordered.length - 1;
    if (!isGap) return;
    if (nextIsAd && adQueue.length) {
      const ad = adQueue[ai % adQueue.length];
      out.push({ type: 'ad', key: `a-${ad.id}-${slot}`, ad });
      ai++;
    } else if (mugQueue.length) {
      const mug = mugQueue[mi % mugQueue.length];
      out.push({ type: 'mug', key: `m-${mug.id}-${slot}`, mug });
      mi++;
    } else if (adQueue.length) {
      const ad = adQueue[ai % adQueue.length];
      out.push({ type: 'ad', key: `a-${ad.id}-${slot}`, ad });
      ai++;
    }
    slot++;
    nextIsAd = adQueue.length > 0 && (mugQueue.length === 0 || !nextIsAd);
  });
  // A short shelf (fewer books than one gap) still shows one ad.
  if (ordered.length > 0 && ordered.length < every && adQueue.length) {
    out.push({ type: 'ad', key: `a-${adQueue[0].id}-end`, ad: adQueue[0] });
  }
  return out;
}

/** A new seed for each time the Library is opened. */
export const newShelfSeed = () => Math.floor(Math.random() * 2 ** 31);

/** The mugs on sale (the mug shop's live list), for the Library shelf. */
export interface ShelfMug { id: string; title: string; imageUrl: string; price: number | null }
let mugsPromise: Promise<ShelfMug[]> | null = null;
export function loadShelfMugs(): Promise<ShelfMug[]> {
  if (mugsPromise) return mugsPromise;
  mugsPromise = fetch(`${API}?action=getMugProducts`)
    .then((r) => r.json())
    .then((d) => (d?.success && Array.isArray(d.items) ? (d.items as ShelfMug[]).filter((m) => m && m.id && m.title) : []))
    .catch(() => { mugsPromise = null; return []; });
  return mugsPromise;
}
