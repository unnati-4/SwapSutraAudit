import React from 'react';
import type { MugProduct } from '../types/mugs';
import { AD_KIND_LABEL, adCta, adImageSrc, recordAdClick, type SponsoredAd } from '../utils/ads';
import type { BannerSlide } from './MascotBanner';

/**
 * Sponsored ads in the Library (9 Oct 2026).
 *
 * adToSlide       — an ad as a slide of the animated Library banner
 *   (MascotBanner: the walking book unrolls it).
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

/** An ad as a slide of the animated banner (10 Oct 2026). */
export function adToSlide(ad: SponsoredAd, onOpenBook?: OpenBook): BannerSlide {
  return {
    key: `ad-${ad.id}`,
    eyebrow: `${AD_KIND_LABEL[ad.kind]} · ${ad.sponsor}`,
    title: ad.headline,
    subtitle: ad.tagline || undefined,
    imageUrl: ad.imageUrl ? adImageSrc(ad.imageUrl) : undefined,
    sponsored: true,
    partner: !!ad.partner,
    cta: adCta(ad),
    href: ad.linkUrl || (ad.bookId ? `/book/${encodeURIComponent(ad.bookId)}` : '#'),
    external: !!ad.linkUrl,
    onOpen: makeAdOpen(ad, onOpenBook),
    ariaLabel: `Sponsored by ${ad.sponsor}: ${ad.headline} — ${adCta(ad)}`,
  };
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
