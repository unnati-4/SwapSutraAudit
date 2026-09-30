/**
 * The cover a book shows on a shelf.
 *
 * Shelves show the publisher's front cover, fetched from Google Books by
 * ISBN (owner's decision, 23 Sep). The reader's own photos of their copy
 * are still what the book's page shows; only the shelf tile changes.
 *
 * The URL points at our own /api/books?action=cover route rather than at
 * Google directly: it is CDN-cached for a month, and being same-origin it
 * can be drawn onto the "share my shelf" canvas.
 */
export const SHELF_FALLBACK_COVER =
  'https://images.unsplash.com/photo-1543003928-a390cfd0b405?w=500&auto=format&fit=crop&q=60';

export const cleanIsbn = (raw: unknown): string =>
  String(raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();

export function shelfCoverUrl(isbn: unknown): string {
  const clean = cleanIsbn(isbn);
  if (clean.length !== 10 && clean.length !== 13) return '';
  // v=2: covers resolved by the quota-free route (23 Sep); busts browser
  // caches that still hold the old route's "no cover" answers.
  return `/api/books?action=cover&isbn=${clean}&v=2`;
}

/** Sources to try in order: Google cover → the reader's front photo → stock. */
export function shelfCoverCandidates(isbn: unknown, ownPhoto?: string): string[] {
  return [shelfCoverUrl(isbn), ownPhoto || '', SHELF_FALLBACK_COVER].filter(Boolean);
}
