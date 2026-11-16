/** Listing covers use the owner-supplied photo. ISBN covers are reference fallbacks. */
export const SHELF_FALLBACK_COVER =
  '/book-photo-unavailable.svg';

export const cleanIsbn = (raw: unknown): string =>
  String(raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();

export function shelfCoverUrl(isbn: unknown): string {
  const clean = cleanIsbn(isbn);
  if (clean.length !== 10 && clean.length !== 13) return '';
  // v=2: covers resolved by the quota-free route (23 Sep); busts browser
  // caches that still hold the old route's "no cover" answers.
  return `/api/books?action=cover&isbn=${clean}&v=2`;
}

/** Uploaded photo → ISBN reference → unavailable placeholder. */
export function shelfCoverCandidates(isbn: unknown, ownPhoto?: string): string[] {
  return [ownPhoto && ownPhoto !== SHELF_FALLBACK_COVER ? ownPhoto : '', shelfCoverUrl(isbn), SHELF_FALLBACK_COVER].filter(Boolean);
}

/** Named front-cover uploads take precedence over legacy gallery fields. */
export function uploadedBookImages(book: any): string[] {
  if (!book) return [];
  const split = (value: unknown): string[] => Array.isArray(value)
    ? value.flatMap(split)
    : typeof value === 'string' ? (value.startsWith('data:image/') ? [value] : value.split(/[|,]/)).map(s => s.trim()).filter(Boolean) : [];
  return [...new Set([
    ...split(book.frontCoverImage),
    ...split(book.imageUrls || book.imageUrl || book.imageurl),
    ...split(book.backCoverImage), ...split(book.internalBookImage),
  ])].filter(url => /^(https?:\/\/|\/(?!\/)|data:image\/|blob:)/i.test(url));
}
