import React from 'react';
import type { MugProduct } from '../../types/mugs';

/**
 * One mug on the shelf (30 Sep 2026).
 *
 * Shows only what the product's source supplied: an MRP (and the saving)
 * only when the feed gave both prices, a rating only with the name of
 * where it comes from. External products say where they are sold and
 * link out — SwapSutra does not pretend to fulfil those orders.
 */

export const formatInr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** A calm line-drawn mug on cream, used when a product has no photo yet. */
export function MugPlaceholder({ label }: { label?: string }) {
  return (
    <div className="mug-placeholder" role="img" aria-label={label || 'Mug photo coming soon'}>
      <svg viewBox="0 0 120 120" width="46%" aria-hidden="true">
        <path d="M30 38h52v38c0 14-11 24-26 24S30 90 30 76V38z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M82 48h7c8 0 13 5 13 12s-5 12-13 12h-7" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M44 22c-4 5 4 7 0 12M56 20c-4 6 4 8 0 14M68 22c-4 5 4 7 0 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      </svg>
    </div>
  );
}

export function sourceLabel(p: MugProduct): string {
  if (p.sourceMarketplace) return `Sold on ${p.sourceMarketplace}`;
  if (p.vendor) return `By ${p.vendor}`;
  return '';
}

export function discountPercent(p: MugProduct): number | null {
  if (!p.price || !p.mrp || p.mrp <= p.price) return null;
  return Math.round(((p.mrp - p.price) / p.mrp) * 100);
}

const MugProductCard: React.FC<{ product: MugProduct; onView: (p: MugProduct) => void }> = ({ product, onView }) => {
  const off = discountPercent(product);
  const buyUrl = product.affiliateUrl || product.sourceUrl;
  return (
    <article className="mug-card" data-testid="mug-card">
      <button type="button" className="mug-card__media" onClick={() => onView(product)} aria-label={`View ${product.title}`}>
        {product.imageUrl
          ? <img src={product.imageUrl} alt={product.title} loading="lazy" decoding="async" />
          : <MugPlaceholder label={`${product.title} — photo coming soon`} />}
      </button>
      <div className="mug-card__body">
        {sourceLabel(product) && <p className="mug-card__source">{sourceLabel(product)}</p>}
        <h3 className="mug-card__title">{product.title}</h3>
        {product.description && <p className="mug-card__desc">{product.description}</p>}
        <div className="mug-card__price">
          {product.price
            ? <span className="type-price">{formatInr(product.price)}</span>
            : <span className="mug-card__price-na">Price on the seller’s page</span>}
          {product.mrp && product.price && (
            <>
              <s className="mug-card__mrp" aria-label={`MRP ${formatInr(product.mrp)}`}>{formatInr(product.mrp)}</s>
              {off ? <span className="mug-card__off">{off}% off MRP</span> : null}
            </>
          )}
        </div>
        {product.rating && product.ratingSource ? (
          <p className="mug-card__rating">
            {product.rating.toFixed(1)} ★ on {product.ratingSource}
            {product.ratingCount ? ` (${product.ratingCount.toLocaleString('en-IN')})` : ''}
          </p>
        ) : null}
        <div className="mug-card__actions">
          <button type="button" className="mug-btn mug-btn--quiet" onClick={() => onView(product)}>View Mug</button>
          {buyUrl && (
            <a className="mug-btn mug-btn--solid" href={buyUrl} target="_blank" rel="sponsored noopener noreferrer">
              {product.sourceMarketplace ? `Buy on ${product.sourceMarketplace}` : 'Buy Now'}<span className="sr-only"> (opens in a new tab)</span> ↗
            </a>
          )}
        </div>
      </div>
    </article>
  );
};

export default MugProductCard;
