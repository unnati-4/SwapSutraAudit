import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The animated banner (10 Oct 2026, owner's request: "banner me library me
 * ek anime aana chahiye, move karta hua pehle saamne ki taraf, fir right
 * side jaake banner unfold kare ad ke liye — same mugs wale page pe mug").
 *
 * A small character of SwapSutra's own — a walking book on the Library,
 * a walking mug on the mug shelf — comes towards the reader, walks to the
 * right, and unrolls a banner. Every few seconds it rolls the banner up and
 * unrolls the next one (an ad, or a featured book / mug).
 *
 * Readers who ask for reduced motion get the banner open and still. The
 * rotation pauses while the banner is hovered or focused, and the banner is
 * an ordinary link / button for keyboards and screen readers.
 */

export interface BannerSlide {
  key: string;
  /** Small line above the title, e.g. "Featured book" or the sponsor. */
  eyebrow: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  /** Preserve the complete artwork for portrait or landscape event posters. */
  imageFit?: 'cover' | 'contain';
  /** Shown as a "Sponsored" chip — every ad must carry it. */
  sponsored?: boolean;
  /** A partner's banner shows the SwapSutra logo with it. */
  partner?: boolean;
  cta: string;
  href?: string;
  external?: boolean;
  onOpen?: (e: React.MouseEvent) => void;
  ariaLabel?: string;
}

type Phase = 'idle' | 'enter' | 'walk' | 'unfold' | 'show' | 'fold';

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** The SwapSutra fox mascot from the Library banner asset. */
function BookMascot() {
  return <img src="/swapsutra-fox-mascot.webp" alt="" aria-hidden="true" className="ss-mascot__svg ss-mascot__fox" decoding="async" />;
}

/** A walking mug: cream glaze, a handle, steam, two eyes and a smile. */
function MugMascot() {
  return <img src="/swapsutra-fox-mascot.webp" alt="" aria-hidden="true" className="ss-mascot__svg ss-mascot__fox" decoding="async" />;
}

export default function MascotBanner({ mascot, slides, label, interval = 10000, startAt = 0, testId }: {
  mascot: 'book' | 'mug';
  slides: BannerSlide[];
  label: string;
  interval?: number;
  startAt?: number;
  testId?: string;
}) {
  const reduce = useMemo(reducedMotion, []);
  const [phase, setPhase] = useState<Phase>(reduce ? 'show' : 'idle');
  const [i, setI] = useState(() => (slides.length ? Math.abs(startAt) % slides.length : 0));
  const [paused, setPaused] = useState(false);
  const [foxMessage, setFoxMessage] = useState('');
  const [foxTap, setFoxTap] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  useEffect(() => { if (i >= slides.length && slides.length) setI(0); }, [slides.length, i]);

  // The entrance starts when the banner first scrolls into view.
  useEffect(() => {
    if (reduce || phase !== 'idle' || !slides.length) return;
    const el = rootRef.current;
    const go = () => {
      setPhase('enter');
      later(() => setPhase('walk'), 1300);
      later(() => setPhase('unfold'), 2600);
      later(() => setPhase('show'), 3500);
    };
    if (!el || typeof IntersectionObserver === 'undefined') { go(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); go(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduce, phase, slides.length]);

  // Then: roll up, next slide, unroll.
  useEffect(() => {
    if (phase !== 'show' || paused || slides.length < 2) return;
    const transitionMs = reduce ? 0 : 1450;
    const holdMs = Math.max(0, interval - transitionMs);
    const t = window.setTimeout(() => {
      if (reduce) { setI((n) => (n + 1) % slides.length); return; }
      setPhase('fold');
      later(() => { setI((n) => (n + 1) % slides.length); setPhase('unfold'); }, 550);
      later(() => setPhase('show'), transitionMs);
    }, holdMs);
    return () => window.clearTimeout(t);
  }, [phase, paused, slides.length, interval, reduce, i]);

  if (!slides.length) return null;
  const s = slides[Math.min(i, slides.length - 1)];
  const open = phase === 'unfold' || phase === 'show';
  const body = (
    <>
      <span className="ss-mascot__media">
        {s.imageUrl ? <img key={s.key} src={s.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={s.imageFit ? { objectFit: s.imageFit } : undefined} /> : <span className="ss-mascot__media-blank" aria-hidden="true">{mascot === 'mug' ? '☕' : '📚'}</span>}
        {s.partner && <span className="ss-adbanner__logo"><img src="/swapsutra-logo.png" alt="" />SwapSutra partner</span>}
      </span>
      <span className="ss-mascot__text">
        <span className="ss-ad__eyebrow">{s.sponsored && <span className="ss-ad__chip">Sponsored</span>}{s.eyebrow}</span>
        <span className="ss-mascot__title">{s.title}</span>
        {s.subtitle && <span className="ss-mascot__subtitle">{s.subtitle}</span>}
        <span className="ss-adbanner__cta">{s.cta} {s.external ? '↗' : '→'}</span>
      </span>
    </>
  );

  return (
    <section
      ref={rootRef}
      className={`ss-mascot ss-mascot--${mascot} is-${phase}`}
      aria-label={label}
      aria-roledescription="carousel"
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      data-testid={testId || 'mascot-banner'}
      data-phase={phase}
    >
      <div className="ss-mascot__stage">
        <div className={`ss-mascot__scroll ${open ? 'is-open' : ''}`} aria-hidden={!open}>
          <span className="ss-mascot__rod ss-mascot__rod--l" aria-hidden="true" />
          {s.href ? (
            <a className="ss-mascot__cloth" href={s.href} target={s.external ? '_blank' : undefined}
              rel={s.sponsored ? 'sponsored noopener noreferrer' : s.external ? 'noopener noreferrer' : undefined}
              onClick={s.onOpen} aria-label={s.ariaLabel || `${s.eyebrow}: ${s.title} — ${s.cta}`} tabIndex={open ? 0 : -1}
              data-testid={s.sponsored ? 'sponsored-ad' : undefined}>
              {body}
            </a>
          ) : (
            <button type="button" className="ss-mascot__cloth" onClick={s.onOpen} aria-label={s.ariaLabel || `${s.eyebrow}: ${s.title} — ${s.cta}`} tabIndex={open ? 0 : -1}>
              {body}
            </button>
          )}
          <span className="ss-mascot__rod ss-mascot__rod--r" aria-hidden="true" />
        </div>
        <div className="ss-mascot__char">
          <button type="button" className={`ss-mascot__talk ${foxTap % 2 ? 'ss-mascot__talk--bounce-a' : 'ss-mascot__talk--bounce-b'}`} aria-label="Say hello to the SwapSutra fox" onClick={() => { const greetings = ['Found a lovely read lately?', 'Tap me for your next bookish spark!', 'Psst… there are readers to meet here.']; setFoxMessage(greetings[foxTap % greetings.length]); setFoxTap(value => value + 1); }}>
            {mascot === 'mug' ? <MugMascot /> : <BookMascot />}
          </button>
          {foxMessage && <span className="ss-mascot__speech" role="status">{foxMessage}</span>}
          <span className="ss-mascot__shadow" />
        </div>
      </div>
      {slides.length > 1 && (
        <div className="ss-adbanner__dots">
          {slides.map((x, n) => (
            <button key={x.key} type="button" aria-label={`Show banner ${n + 1} of ${slides.length}`} aria-current={n === i}
              className={n === i ? 'is-on' : ''} onClick={() => { setI(n); if (phase === 'idle') setPhase('show'); }} />
          ))}
        </div>
      )}
    </section>
  );
}
