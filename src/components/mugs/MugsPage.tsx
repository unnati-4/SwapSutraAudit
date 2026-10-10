import React, { useEffect, useMemo, useRef, useState } from 'react';
import MascotBanner, { type BannerSlide } from '../MascotBanner';
import { newShelfSeed, shuffled } from '../../utils/ads';
import { apiUrl } from '../../config/runtime';
import { MUG_CATEGORIES } from '../../data/mugCategories';
import type { MugCategoryId, MugProduct } from '../../types/mugs';
import MugProductCard, { MugPlaceholder, formatInr, sourceLabel } from './MugProductCard';
import CustomMugEnquiry from './CustomMugEnquiry';
import {
  PRICE_BANDS, SORT_OPTIONS, EMPTY_FILTERS, applyMugFilters, bandCounts, discountOf,
  filtersActive, sellersOn, type MugFilterState, type MugSort,
} from '../../utils/mugFilters';

/**
 * /mugs — "SwapSutra's little secret mug shelf for readers" (30 Sep 2026).
 *
 * Products come only from the MugProducts sheet (getMugProducts), which is
 * filled from authorised sources. While it is empty the page says so
 * honestly ("Products coming soon") and leads to the custom mug enquiry.
 * On a developer's machine only, clearly-labelled sample cards fill the
 * grid so the layout can be reviewed; they never reach production.
 */

const API = apiUrl('/api/swapsutra');

/**
 * 30 Sep (owner's request): the shop says "Coming soon" until the admin
 * puts at least one mug live (Admin → Mugs → Mug shop listings). Then the
 * categories, grid and "Buy on Amazon / Flipkart" buttons appear by
 * themselves. The custom mug enquiry stays open either way.
 */

type Loaded = { state: 'loading' } | { state: 'ready'; items: MugProduct[]; dev: boolean } | { state: 'error' };

export default function MugsPage({ defaultName, defaultEmail }: { defaultName?: string; defaultEmail?: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [category, setCategory] = useState<MugCategoryId | 'all'>('all');
  const [viewing, setViewing] = useState<MugProduct | null>(null);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [filters, setFilters] = useState<MugFilterState>(EMPTY_FILTERS);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    // Deep link: /mugs?create=1 opens the enquiry.
    try { if (new URLSearchParams(window.location.search).get('create') === '1') setEnquiryOpen(true); } catch { /* ignore */ }
    (async () => {
      let items: MugProduct[] = [];
      let failed = false;
      try {
        const res = await fetch(`${API}?action=getMugProducts`);
        const data = await res.json();
        if (data?.success && Array.isArray(data.items)) items = data.items;
        else failed = true;
      } catch { failed = true; }
      // DEVELOPMENT ONLY sample cards — this branch is removed from
      // production builds (import.meta.env.DEV is false there).
      if (import.meta.env.DEV && !items.length) {
        const { DEV_SAMPLE_MUGS } = await import('../../data/mugs.dev');
        if (alive) setLoaded({ state: 'ready', items: DEV_SAMPLE_MUGS, dev: true });
        return;
      }
      if (alive) setLoaded(failed && !items.length ? { state: 'error' } : { state: 'ready', items, dev: false });
    })();
    return () => { alive = false; };
  }, []);

  const items = loaded.state === 'ready' ? loaded.items : [];
  const inCategory = useMemo(() => (category === 'all' ? items : items.filter((p) => p.category === category)), [items, category]);
  const shown = useMemo(() => applyMugFilters(inCategory, filters), [inCategory, filters]);
  const counts_ = useMemo(() => bandCounts(inCategory, filters), [inCategory, filters]);
  const sellers = useMemo(() => sellersOn(items), [items]);
  const anyOnSale = useMemo(() => inCategory.some((p) => discountOf(p) > 0), [inCategory]);
  const anyPriced = useMemo(() => inCategory.some((p) => !!p.price), [inCategory]);
  const active = filtersActive(filters);
  const setF = (patch: Partial<MugFilterState>) => setFilters((f) => ({ ...f, ...patch }));
  const counts = useMemo(() => Object.fromEntries(MUG_CATEGORIES.map((c) => [c.id, items.filter((p) => p.category === c.id).length])), [items]);
  const external = items.some((p) => p.sourceMarketplace || p.affiliateUrl);
  // Open as soon as one real (or, on a developer's machine, sample) mug is live.
  const shopOpen = loaded.state === 'ready' && items.length > 0;

  const browse = () => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // 10 Oct 2026: the walking mug unrolls a banner featuring a few mugs, a
  // new pick each visit. Before the shop opens it invites a mug idea.
  const [bannerSeed] = useState(newShelfSeed);
  const bannerSlides = useMemo<BannerSlide[]>(() => {
    if (loaded.state !== 'ready') return [];
    if (!items.length) return [{
      key: 'soon', eyebrow: 'The mug shelf', title: 'Mugs are coming soon',
      subtitle: 'Got an idea for a mug? Tell us and we’ll help make it.',
      cta: 'Create your mug', onOpen: () => setEnquiryOpen(true),
    }];
    const picks = shuffled<MugProduct>(items, bannerSeed).slice(0, 6);
    return picks.map((p) => ({
      key: `mug-${p.id}`, eyebrow: 'Featured mug', title: p.title,
      subtitle: [p.price ? formatInr(p.price) : '', p.sourceMarketplace ? `Sold on ${p.sourceMarketplace}` : ''].filter(Boolean).join(' · ') || undefined,
      imageUrl: p.imageUrl || undefined, cta: 'View mug', onOpen: () => setViewing(p),
    }));
  }, [loaded.state, items, bannerSeed]);

  return (
    <div className="mugs" data-testid="mugs-page">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="mugs-hero">
        <div className="mugs-hero__text">
          <p className="type-eyebrow mug-accent">The mug shelf</p>
          <h1 className="type-h1">Mugs for people who take their coffee personally.</h1>
          <p className="type-lead mugs-hero__lead">From quiet reading mornings to aggressively long TBRs.</p>
          {shopOpen ? (
            <div className="mugs-hero__ctas">
              <button type="button" className="mug-btn mug-btn--solid" onClick={browse}>Browse Mugs</button>
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setEnquiryOpen(true)}>Create Your Mug</button>
            </div>
          ) : (
            <div className="mugs-hero__ctas">
              {loaded.state !== 'loading' && <span className="mugs-soon" data-testid="mugs-coming-soon">Coming soon</span>}
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setEnquiryOpen(true)}>Create Your Mug</button>
            </div>
          )}
        </div>
        <div className="mugs-hero__art" aria-hidden="true">
          <MugPlaceholder />
        </div>
      </section>

      {/* ── The walking mug's banner (10 Oct 2026) ──────────── */}
      <MascotBanner mascot="mug" slides={bannerSlides} label="Featured mugs" testId="mugs-banner" />

      {shopOpen ? (<>
      {/* ── Categories ───────────────────────────────────── */}
      <section className="mugs-cats" aria-label="Mug categories">
        <button type="button" className={`mugs-cat ${category === 'all' ? 'is-on' : ''}`} onClick={() => setCategory('all')} aria-pressed={category === 'all'}>
          <span className="mugs-cat__label">All mugs</span>
          <span className="mugs-cat__blurb">The whole shelf.</span>
        </button>
        {MUG_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`mugs-cat ${category === c.id ? 'is-on' : ''}`} onClick={() => setCategory(c.id)} aria-pressed={category === c.id}>
            <span className="mugs-cat__label">{c.label}{counts[c.id] ? <span className="mugs-cat__count"> {counts[c.id]}</span> : null}</span>
            <span className="mugs-cat__blurb">{c.blurb}</span>
          </button>
        ))}
      </section>

      {/* ── Grid ─────────────────────────────────────────── */}
      <section className="mugs-grid-wrap" ref={gridRef} aria-labelledby="mugs-grid-title">
        <h2 id="mugs-grid-title" className="type-h2">{category === 'all' ? 'On the shelf' : MUG_CATEGORIES.find((c) => c.id === category)?.label}</h2>
        {loaded.state === 'ready' && loaded.dev && (
          <p className="mugs-devnote" role="note">DEVELOPMENT ONLY — sample cards, not real products. They are not included in the live site.</p>
        )}
        {/* ── Filters ─────────────────────────────────────── */}
        {inCategory.length > 0 && (
          <div className="mugs-filters" role="group" aria-label="Filter and sort mugs">
            {anyPriced && (
              <div className="mugs-filters__row">
                <span className="mugs-filters__label" id="mugs-price-label">Price</span>
                <div className="mugs-chips" role="group" aria-labelledby="mugs-price-label">
                  <button type="button" className={`mugs-chip ${filters.bandId === null ? 'is-on' : ''}`}
                    aria-pressed={filters.bandId === null} onClick={() => setF({ bandId: null })}>Any price</button>
                  {PRICE_BANDS.filter((b) => counts_[b.id] > 0 || filters.bandId === b.id).map((b) => (
                    <button key={b.id} type="button" className={`mugs-chip ${filters.bandId === b.id ? 'is-on' : ''}`}
                      aria-pressed={filters.bandId === b.id}
                      onClick={() => setF({ bandId: filters.bandId === b.id ? null : b.id })}>
                      {b.label} <span className="mugs-chip__count">{counts_[b.id]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(anyOnSale || sellers.length > 1) && (
              <div className="mugs-filters__row">
                <span className="mugs-filters__label" id="mugs-more-label">Show</span>
                <div className="mugs-chips" role="group" aria-labelledby="mugs-more-label">
                  {anyOnSale && (
                    <button type="button" className={`mugs-chip ${filters.onSale ? 'is-on' : ''}`}
                      aria-pressed={filters.onSale} onClick={() => setF({ onSale: !filters.onSale })}>On sale</button>
                  )}
                  {sellers.length > 1 && sellers.map((sel) => (
                    <button key={sel || 'swapsutra'} type="button" className={`mugs-chip ${filters.seller === sel ? 'is-on' : ''}`}
                      aria-pressed={filters.seller === sel}
                      onClick={() => setF({ seller: filters.seller === sel ? null : sel })}>
                      {sel ? `Sold on ${sel}` : 'From SwapSutra'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mugs-filters__bar">
              <p className="mugs-filters__result" role="status">
                {shown.length} {shown.length === 1 ? 'mug' : 'mugs'}
                {active && (
                  <button type="button" className="mugs-filters__clear" onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }))}>
                    Clear filters
                  </button>
                )}
              </p>
              <label className="mugs-sort">
                <span>Sort by</span>
                <select value={filters.sort} onChange={(e) => setF({ sort: e.target.value as MugSort })}>
                  {SORT_OPTIONS.filter((o) => o.id !== 'discount' || anyOnSale).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
        {loaded.state === 'loading' ? (
          <p className="type-caption" role="status">Dusting the shelf…</p>
        ) : shown.length ? (
          <div className="mugs-grid">
            {shown.map((p) => <MugProductCard key={p.id} product={p} onView={setViewing} />)}
          </div>
        ) : inCategory.length ? (
          <div className="mugs-empty" data-testid="mugs-filter-empty">
            <p className="type-h3">No mugs match these filters.</p>
            <p className="type-body">Try another price range, or clear the filters to see the whole shelf.</p>
            <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }))}>Clear filters</button>
          </div>
        ) : (
          <div className="mugs-empty" data-testid="mugs-empty">
            <p className="type-h3">Products coming soon.</p>
            <p className="type-body">
              {loaded.state === 'error'
                ? 'We couldn’t load the shelf just now. Please try again in a little while.'
                : 'We’re choosing mugs worth a reader’s morning. Until then, we can help you make your own.'}
            </p>
            <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setEnquiryOpen(true)}>Create Your Mug</button>
          </div>
        )}
        {external && (
          <p className="mugs-disclosure type-caption">
            Mugs marked “Sold on …” are sold and delivered by that marketplace, not by SwapSutra. Some links may be affiliate links: SwapSutra may earn a small commission, at no extra cost to you.
          </p>
        )}
      </section>
      </>) : loaded.state === 'loading' ? (
        <p className="type-caption" role="status">Dusting the shelf…</p>
      ) : (
        <section className="mugs-empty" data-testid="mugs-empty" aria-labelledby="mugs-soon-title">
          <h2 id="mugs-soon-title" className="type-h2">Coming soon.</h2>
          <p className="type-body">We’re choosing mugs worth a reader’s morning. The shelf opens here soon — until then, we can help you make your own.</p>
        </section>
      )}

      {/* ── Custom mug ───────────────────────────────────── */}
      <section className="mugs-custom" aria-labelledby="mugs-custom-title">
        <div>
          <p className="type-eyebrow mug-accent">Made for you</p>
          <h2 id="mugs-custom-title" className="type-h2">Have a mug idea?</h2>
          <p className="type-lead">
            Tell us what you’ve imagined. Weird shape, reader joke, tiny detail, dream café mug — if you can describe it, we’ll help figure out how it could be made.
          </p>
        </div>
        <button type="button" className="mug-btn mug-btn--solid mug-btn--large" onClick={() => setEnquiryOpen(true)}>Create My Mug</button>
      </section>

      {viewing && (
        <div className="mug-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewing(null); }}>
          <div className="mug-modal__sheet mug-detail" role="dialog" aria-modal="true" aria-labelledby="mug-detail-title">
            <header className="mug-modal__head">
              <div>
                {sourceLabel(viewing) && <p className="type-eyebrow mug-accent">{sourceLabel(viewing)}</p>}
                <h2 id="mug-detail-title" className="type-h3">{viewing.title}</h2>
              </div>
              <button type="button" className="mug-modal__close" onClick={() => setViewing(null)} aria-label="Close">×</button>
            </header>
            <div className="mug-modal__body">
              <div className="mug-detail__media">
                {viewing.imageUrl ? <img src={viewing.imageUrl} alt={viewing.title} /> : <MugPlaceholder />}
              </div>
              {viewing.description && <p className="type-body">{viewing.description}</p>}
              {viewing.price ? <p className="type-price">{formatInr(viewing.price)}{viewing.mrp ? <s className="mug-card__mrp"> {formatInr(viewing.mrp)}</s> : null}</p> : null}
              {viewing.availability && <p className="type-caption">{viewing.availability}</p>}
              {viewing.devSample && <p className="mugs-devnote">DEVELOPMENT ONLY sample — not a real product.</p>}
            </div>
            <footer className="mug-modal__foot">
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setViewing(null)}>Back to the shelf</button>
              {(viewing.affiliateUrl || viewing.sourceUrl) && (
                <a className="mug-btn mug-btn--solid" href={viewing.affiliateUrl || viewing.sourceUrl} target="_blank" rel="sponsored noopener noreferrer">
                  {viewing.sourceMarketplace ? `Buy on ${viewing.sourceMarketplace}` : 'Buy Now'} ↗
                </a>
              )}
            </footer>
          </div>
        </div>
      )}

      <CustomMugEnquiry open={enquiryOpen} onClose={() => setEnquiryOpen(false)}
        defaults={{ name: defaultName || '', email: defaultEmail || '' }} />
    </div>
  );
}
