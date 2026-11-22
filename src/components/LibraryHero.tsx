import ListingImage from './ListingImage';
import React, { useMemo, useRef } from 'react';
import { uploadedBookImages, shelfCoverUrl, SHELF_FALLBACK_COVER } from '../utils/bookCover';
import { adImageSrc, shuffled, type SponsoredAd } from '../utils/ads';
import { adToSlide } from './SponsoredAds';
import MascotBanner, { type BannerSlide } from './MascotBanner';
import { seoForPath } from '../seo/pages';

/**
 * The Library's front (30 Sep 2026): a bookshop window.
 *
 * Split editorial hero — a large serif sentence on a warm painted panel,
 * and the real books readers have put on their shelves, face-out like a
 * shop wall — then a scrolling row of covers ("New on the shelves").
 * Covers come from owner-supplied listing photos, so
 * the page shows what is actually available, never stock photography.
 */

export interface LibraryHeroEvent {
  eventId?: string | number;
  title?: string;
  date?: string;
  time?: string;
  startTime?: string;
  venue?: string;
  location?: string;
  thumbnailUrl?: string;
  bannerUrl?: string;
  imageUrl?: string;
  status?: string;
}

export interface HeroBook {
  id: string | number;
  title?: string;
  author?: string;
  isbn?: string;
  imageUrls?: string[] | string;
  frontCoverImage?: string;
  imageUrl?: string;
  listedAt?: string;
  createdAt?: string;
}

const coverOf = (b: HeroBook) => photoOf(b) || shelfCoverUrl(b.isbn);
const eventDateFromValue = (value) => {
  const raw = String(value || '').trim();
  // Event dates may be serialized as India midnight in UTC (for example,
  // 29 Nov at 18:30Z). Keep the calendar date from the source record.
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (isoDate) return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  return new Date(raw);
};
/** The reader's own first photo of the book (Drive links made viewable). */
const photoOf = (b: HeroBook) => {
  const raw = uploadedBookImages(b)[0];
  const u = String(raw || '').trim();
  return /^https:\/\//i.test(u) ? adImageSrc(u) : '';
};

export default function LibraryHero<B extends HeroBook>({ books, onOpenBook, onBrowse, onJoin, showJoin, ads = [], events = [], onOpenAdBook, adStart = 0 }: {
  books: B[];
  /** Sponsored ads and upcoming event posters for the banner. */
  ads?: SponsoredAd[];
  events?: LibraryHeroEvent[];
  onOpenAdBook?: (bookId: string) => boolean;
  adStart?: number;
  onOpenBook: (b: B) => void;
  onBrowse: () => void;
  /** No longer shown (10 Oct 2026: the banner fills the Library window). */
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
  // Upcoming event posters rotate with sponsored ads. Their dates and
  // artwork come from the same event records used by the Events page.
  const bannerSlides = useMemo<BannerSlide[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventSlides: BannerSlide[] = events
      .filter((event) => {
        const date = eventDateFromValue(event.date);
        return !Number.isNaN(date.getTime()) && date >= today;
      })
      .sort((a, b) => eventDateFromValue(a.date).getTime() - eventDateFromValue(b.date).getTime())
      .map((event) => {
        const date = eventDateFromValue(event.date);
        const posterUrl = event.bannerUrl || event.thumbnailUrl || event.imageUrl || '';
        const details = [
          date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          event.time || event.startTime,
          event.venue || event.location,
        ].filter(Boolean).join(' · ');
        return {
          key: `event-${event.eventId || event.title || date.toISOString()}`,
          eyebrow: 'Upcoming event',
          title: event.title || 'SwapSutra community event',
          subtitle: details || undefined,
          imageUrl: posterUrl ? adImageSrc(posterUrl) : undefined,
          imageFit: 'contain' as const,
          cta: 'See event details',
          href: '/events',
          ariaLabel: `Upcoming event: ${event.title || 'SwapSutra community event'}${details ? ` · ${details}` : ''}. Open Events.`,
        };
      });
    const adSlides = ads.map((a) => adToSlide(a, onOpenAdBook));
    if (adSlides.length || eventSlides.length) return [...adSlides, ...eventSlides];
    const pictured = books.filter((b) => b.title && (coverOf(b) || photoOf(b)));
    const picks = shuffled<B>(pictured.slice(0, 60), adStart || 1).slice(0, 6);
    if (!picks.length) return [{
      key: 'welcome', eyebrow: 'SwapSutra library', title: 'Books from readers near you',
      subtitle: 'Swap, lend, rent or buy — straight from their shelves.', imageUrl: '/swapsutra-logo.png',
      cta: 'Browse the shelves', onOpen: () => onBrowse(),
    }];
    return picks.map((b) => ({
      key: `book-${b.id}`,
      eyebrow: photoOf(b) ? 'Featured book' : 'Reference cover · edition may vary',
      title: b.title || 'A book on the shelves',
      subtitle: b.author ? `by ${b.author}` : undefined,
      imageUrl: coverOf(b) || photoOf(b),
      cta: 'See the book',
      onOpen: () => onOpenBook(b),
    }));
  }, [ads, events, books, adStart, onOpenAdBook, onOpenBook, onBrowse]);
  const row = withCovers.slice(0, 16);
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollRow = (dir: number) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <section className="lib-front" aria-label="Welcome to the SwapSutra library">
      {/* 10 Oct 2026 (owner's request): the whole Library window is now the
          banner — the heading panel and the cover wall are gone. The walking
          book comes forward, walks right and unrolls an ad, or a featured
          book when no ad is running. The heading stays for screen readers
          and search engines. */}
      <div className="lib-hero lib-hero--banner ss-bleed">
        <h1 className="sr-only">{(typeof window !== 'undefined' && seoForPath(window.location.pathname)?.h1) || 'SwapSutra is a reader-first library spread across homes in India.'}</h1>
        <MascotBanner mascot="book" slides={bannerSlides} interval={5000} startAt={adStart}
          label={ads.length ? 'Sponsored' : 'Featured books'} testId="library-banner" />
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
                  <ListingImage isbn={b.isbn} src={photoOf(b)} alt={b.title ? `Cover of ${b.title}` : 'Book cover'} loading="lazy" decoding="async"
                    onError={(e) => { if (e.currentTarget.getAttribute('src') !== SHELF_FALLBACK_COVER) e.currentTarget.src = SHELF_FALLBACK_COVER; }} />
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
