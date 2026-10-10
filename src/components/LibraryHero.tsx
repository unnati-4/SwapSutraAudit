import React, { useMemo, useRef } from 'react';
import { shelfCoverUrl } from '../utils/bookCover';
import { adImageSrc, shuffled, type SponsoredAd } from '../utils/ads';
import { adToSlide } from './SponsoredAds';
import MascotBanner, { type BannerSlide } from './MascotBanner';

/**
 * The Library's front (30 Sep 2026): a bookshop window.
 *
 * Split editorial hero — a large serif sentence on a warm painted panel,
 * and the real books readers have put on their shelves, face-out like a
 * shop wall — then a scrolling row of covers ("New on the shelves").
 * Covers come from the listings themselves (ISBN → publisher cover), so
 * the page shows what is actually available, never stock photography.
 */

export interface HeroBook {
  id: string | number;
  title?: string;
  author?: string;
  isbn?: string;
  imageUrls?: string[] | string;
  listedAt?: string;
  createdAt?: string;
}

const coverOf = (b: HeroBook) => shelfCoverUrl(b.isbn);
/** The reader's own first photo of the book (Drive links made viewable). */
const photoOf = (b: HeroBook) => {
  const raw = Array.isArray(b.imageUrls) ? b.imageUrls[0] : String(b.imageUrls || '').split(/[|,]/)[0];
  const u = String(raw || '').trim();
  return /^https:\/\//i.test(u) ? adImageSrc(u) : '';
};

export default function LibraryHero<B extends HeroBook>({ books, onOpenBook, onBrowse, onJoin, showJoin, ads = [], onOpenAdBook, adStart = 0 }: {
  books: B[];
  /** Sponsored ads for the banner (9 Oct 2026); shown under the window. */
  ads?: SponsoredAd[];
  onOpenAdBook?: (bookId: string) => boolean;
  adStart?: number;
  onOpenBook: (b: B) => void;
  onBrowse: () => void;
  onJoin?: () => void;
  showJoin?: boolean;
}) {
  const withCovers = useMemo(() => {
    const seen = new Set<string>();
    return books
      .filter((b) => {
        const c = coverOf(b);
        if (!c || seen.has(c)) return false;
        seen.add(c);
        return true;
      })
      .sort((a, b) => String(b.listedAt || b.createdAt || '').localeCompare(String(a.listedAt || a.createdAt || '')));
  }, [books]);
  // The banner (in the Library window, 10 Oct 2026): ads first; with no ad
  // running, featured books take turns — any listed book with a cover or a
  // photo; with no books yet, an invitation to browse.
  const bannerSlides = useMemo<BannerSlide[]>(() => {
    if (ads.length) return ads.map((a) => adToSlide(a, onOpenAdBook));
    const pictured = books.filter((b) => b.title && (coverOf(b) || photoOf(b)));
    const picks = shuffled<B>(pictured.slice(0, 60), adStart || 1).slice(0, 6);
    if (!picks.length) return [{
      key: 'welcome', eyebrow: 'SwapSutra library', title: 'Books from readers near you',
      subtitle: 'Swap, lend, rent or buy — straight from their shelves.', imageUrl: '/swapsutra-logo.png',
      cta: 'Browse the shelves', onOpen: () => onBrowse(),
    }];
    return picks.map((b) => ({
      key: `book-${b.id}`,
      eyebrow: 'Featured book',
      title: b.title || 'A book on the shelves',
      subtitle: b.author ? `by ${b.author}` : undefined,
      imageUrl: coverOf(b) || photoOf(b),
      cta: 'See the book',
      onOpen: () => onOpenBook(b),
    }));
  }, [ads, books, adStart, onOpenAdBook, onOpenBook, onBrowse]);
  const row = withCovers.slice(0, 16);
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollRow = (dir: number) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <section className="lib-front" aria-label="Welcome to the SwapSutra library">
      <div className="lib-hero ss-bleed">
        <div className="lib-hero__panel">
          <h1 className="lib-hero__title">
            SwapSutra is a reader-first library spread across homes in India.
          </h1>
          <p className="lib-hero__sub">Swap, lend and share the books you’ve finished with readers near you.</p>
          <div className="lib-hero__actions">
            <button type="button" className="lib-hero__cta" onClick={onBrowse}>Browse the shelves</button>
            {showJoin && onJoin && (
              <button type="button" className="lib-hero__cta lib-hero__cta--ghost" onClick={onJoin}>Join</button>
            )}
          </div>
        </div>
        {/* 10 Oct 2026 (owner's request): the Library window's right side is
            the banner — the walking book comes forward, walks right and
            unrolls an ad, or a featured book when no ad is running. */}
        <div className="lib-hero__wall lib-hero__wall--banner">
          <MascotBanner mascot="book" slides={bannerSlides} startAt={adStart}
            label={ads.length ? 'Sponsored' : 'Featured books'} testId="library-banner" />
        </div>
      </div>


      {row.length >= 4 && (
        <div className="lib-row">
          <div className="lib-row__head">
            <h2 className="type-h3">New on the shelves</h2>
            <div className="lib-row__arrows">
              <button type="button" onClick={() => scrollRow(-1)} aria-label="Scroll back">‹</button>
              <button type="button" onClick={() => scrollRow(1)} aria-label="Scroll forward">›</button>
            </div>
          </div>
          <div className="lib-row__track" ref={rowRef}>
            {row.map((b) => (
              <button key={String(b.id)} type="button" className="lib-row__item" onClick={() => onOpenBook(b)}>
                <span className="lib-row__cover">
                  <img src={coverOf(b)} alt={b.title ? `Cover of ${b.title}` : 'Book cover'} loading="lazy" decoding="async"
                    onError={(e) => { (e.currentTarget.closest('.lib-row__item') as HTMLElement).style.display = 'none'; }} />
                </span>
                <span className="lib-row__title">{b.title}</span>
                {b.author && <span className="lib-row__author">{b.author}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
