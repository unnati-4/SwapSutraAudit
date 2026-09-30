import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../../config/runtime';
import { MUG_CATEGORIES } from '../../data/mugCategories';
import type { MugCategoryId, MugProduct } from '../../types/mugs';
import MugProductCard, { MugPlaceholder, formatInr, sourceLabel } from './MugProductCard';
import CustomMugEnquiry from './CustomMugEnquiry';

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
 * 30 Sep (owner's request): the shop shows "Coming soon" for now. Flip to
 * true when the MugProducts sheet has live, authorised products — the
 * categories, grid and product pages below come back as they were.
 * The custom mug enquiry stays open either way.
 */
export const MUG_SHOP_OPEN = true;

type Loaded = { state: 'loading' } | { state: 'ready'; items: MugProduct[]; dev: boolean } | { state: 'error' };

export default function MugsPage({ defaultName, defaultEmail }: { defaultName?: string; defaultEmail?: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [category, setCategory] = useState<MugCategoryId | 'all'>('all');
  const [viewing, setViewing] = useState<MugProduct | null>(null);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    // Deep link: /mugs?create=1 opens the enquiry.
    try { if (new URLSearchParams(window.location.search).get('create') === '1') setEnquiryOpen(true); } catch { /* ignore */ }
    if (!MUG_SHOP_OPEN) return () => { alive = false; };
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
  const shown = useMemo(() => (category === 'all' ? items : items.filter((p) => p.category === category)), [items, category]);
  const counts = useMemo(() => Object.fromEntries(MUG_CATEGORIES.map((c) => [c.id, items.filter((p) => p.category === c.id).length])), [items]);
  const external = items.some((p) => p.sourceMarketplace || p.affiliateUrl);

  const browse = () => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="mugs" data-testid="mugs-page">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="mugs-hero">
        <div className="mugs-hero__text">
          <p className="type-eyebrow mug-accent">The mug shelf</p>
          <h1 className="type-h1">Mugs for people who take their coffee personally.</h1>
          <p className="type-lead mugs-hero__lead">From quiet reading mornings to aggressively long TBRs.</p>
          {MUG_SHOP_OPEN ? (
            <div className="mugs-hero__ctas">
              <button type="button" className="mug-btn mug-btn--solid" onClick={browse}>Browse Mugs</button>
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setEnquiryOpen(true)}>Create Your Mug</button>
            </div>
          ) : (
            <div className="mugs-hero__ctas">
              <span className="mugs-soon" data-testid="mugs-coming-soon">Coming soon</span>
              <button type="button" className="mug-btn mug-btn--quiet" onClick={() => setEnquiryOpen(true)}>Create Your Mug</button>
            </div>
          )}
        </div>
        <div className="mugs-hero__art" aria-hidden="true">
          <MugPlaceholder />
        </div>
      </section>

      {MUG_SHOP_OPEN ? (<>
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
        {loaded.state === 'loading' ? (
          <p className="type-caption" role="status">Dusting the shelf…</p>
        ) : shown.length ? (
          <div className="mugs-grid">
            {shown.map((p) => <MugProductCard key={p.id} product={p} onView={setViewing} />)}
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
      </>) : (
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
