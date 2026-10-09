import React, { useEffect, useMemo, useState } from 'react';
import type { MugProduct } from '../types/mugs';
import { AD_KIND_LABEL, adCta, adImageSrc, recordAdClick, type SponsoredAd } from '../utils/ads';

/**
 * Sponsored ads in the Library (9 Oct 2026).
 *
 * SponsoredBanner — the Library banner's ad strip: one ad at a time,
 *   moving on every few seconds (paused while hovered or focused, and not
 *   at all for readers who ask for reduced motion).
 * ShelfAdCard     — an ad standing on the shelf between the books.
 * ShelfMugCard    — a mug from the mug shop, standing between the books.
 *
 * Every ad says "Sponsored" and who it is from; outside links open in a
 * new tab with rel="sponsored". A "book" ad can open a SwapSutra listing.
 */

type OpenBook = (bookId: string) => boolean;

function makeAdOpen(ad: SponsoredAd, onOpenBook?: OpenBook) {
  return (e: React.MouseEvent) => {
    recordAdClick(ad.id);
    // A book on SwapSutra opens its own page; otherwise the link opens.
    if (ad.bookId && onOpenBook && onOpenBook(ad.bookId)) { e.preventDefault(); return; }
    if (!ad.linkUrl && !ad.bookId) e.preventDefault();
  };
}

function AdLink({ ad, onOpenBook, className, children, label }: {
  ad: SponsoredAd; onOpenBook?: OpenBook; className: string; children: React.ReactNode; label: string;
}) {
  const open = makeAdOpen(ad, onOpenBook);
  return (
    <a
      href={ad.linkUrl || (ad.bookId ? `/book/${encodeURIComponent(ad.bookId)}` : '#')}
      target={ad.linkUrl ? '_blank' : undefined}
      rel="sponsored noopener noreferrer"
      className={className}
      onClick={open}
      aria-label={label}
      data-testid="sponsored-ad"
    >
      {children}
    </a>
  );
}

export function SponsoredBanner({ ads, onOpenBook, startAt = 0 }: { ads: SponsoredAd[]; onOpenBook?: OpenBook; startAt?: number }) {
  const [i, setI] = useState(() => (ads.length ? startAt % ads.length : 0));
  const [paused, setPaused] = useState(false);
  const reduce = useMemo(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }, []);
  useEffect(() => { if (i >= ads.length) setI(0); }, [ads.length, i]);
  useEffect(() => {
    if (ads.length < 2 || paused || reduce) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % ads.length), 7000);
    return () => window.clearInterval(t);
  }, [ads.length, paused, reduce]);
  if (!ads.length) return null;
  const ad = ads[Math.min(i, ads.length - 1)];
  return (
    <section
      className="ss-adbanner"
      aria-label="Sponsored"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      data-testid="sponsored-banner"
    >
      <AdLink ad={ad} onOpenBook={onOpenBook} className="ss-adbanner__card"
        label={`Sponsored by ${ad.sponsor}: ${ad.headline} — ${adCta(ad)}`}>
        <span className="ss-adbanner__media">
          {ad.imageUrl && <img key={ad.id} src={adImageSrc(ad.imageUrl)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
        </span>
        <span className="ss-adbanner__body">
          <span className="ss-ad__eyebrow"><span className="ss-ad__chip">Sponsored</span>{AD_KIND_LABEL[ad.kind]} · {ad.sponsor}</span>
          <span className="ss-adbanner__headline">{ad.headline}</span>
          {ad.tagline && <span className="ss-adbanner__tagline">{ad.tagline}</span>}
          <span className="ss-adbanner__cta">{adCta(ad)} {ad.linkUrl && !ad.bookId ? '↗' : '→'}</span>
        </span>
      </AdLink>
      {ads.length > 1 && (
        <div className="ss-adbanner__dots">
          {ads.map((a, n) => (
            <button key={a.id} type="button" aria-label={`Show sponsored ad ${n + 1} of ${ads.length}`} aria-current={n === i}
              className={n === i ? 'is-on' : ''} onClick={() => setI(n)} />
          ))}
        </div>
      )}
    </section>
  );
}

export const ShelfAdCard: React.FC<{ ad: SponsoredAd; onOpenBook?: OpenBook }> = ({ ad, onOpenBook }) => {
  return (
    <AdLink ad={ad} onOpenBook={onOpenBook} className="ss-shelf__book ss-shelf__ad"
      label={`Sponsored by ${ad.sponsor}: ${ad.headline} — ${adCta(ad)}`}>
      <span className="ss-shelf__standee">
        <span className="ss-shelf__standee-media">
          {ad.imageUrl && <img src={adImageSrc(ad.imageUrl)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
          <span className="ss-ad__chip ss-shelf__standee-chip">Sponsored</span>
        </span>
        <span className="ss-shelf__standee-body">
          <span className="ss-shelf__standee-kind">{AD_KIND_LABEL[ad.kind]} · {ad.sponsor}</span>
          <b className="ss-shelf__standee-title">{ad.headline}</b>
          <span className="ss-shelf__standee-cta">{adCta(ad)}</span>
        </span>
      </span>
    </AdLink>
  );
};

export const ShelfMugCard: React.FC<{ mug: Pick<MugProduct, 'id' | 'title' | 'imageUrl' | 'price'>; onOpen: () => void }> = ({ mug, onOpen }) => {
  return (
    <button type="button" className="ss-shelf__book ss-shelf__mug" onClick={onOpen}
      aria-label={`Mug: ${mug.title}${mug.price ? `, ₹${mug.price}` : ''} — open the mug shop`} data-testid="shelf-mug">
      <span className="ss-shelf__mug-stand">
        {mug.imageUrl
          ? <img src={mug.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          : <span className="ss-shelf__mug-blank" aria-hidden="true">☕</span>}
      </span>
      <span className="ss-shelf__mug-tag">Mug{mug.price ? ` · ₹${mug.price}` : ''}</span>
    </button>
  );
};
