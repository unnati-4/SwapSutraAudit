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

/** A walking book: maroon cloth cover, cream pages, two eyes and a smile. */
function BookMascot() {
  return (
    <svg viewBox="0 0 100 130" className="ss-mascot__svg" aria-hidden="true">
      <g className="ss-mascot__legs">
        <path className="ss-mascot__leg ss-mascot__leg--l" d="M40 100 L36 122 L28 124" />
        <path className="ss-mascot__leg ss-mascot__leg--r" d="M60 100 L64 122 L72 124" />
      </g>
      <g className="ss-mascot__body">
        <rect x="22" y="14" width="58" height="88" rx="6" fill="#F2EBE1" stroke="#5A371D" strokeWidth="2" />
        <rect x="18" y="10" width="58" height="88" rx="6" fill="#8E4A59" stroke="#5A371D" strokeWidth="2" />
        <rect x="18" y="10" width="9" height="88" rx="3" fill="#6E3343" />
        <rect x="34" y="22" width="34" height="5" rx="2.5" fill="#E7B98A" />
        <rect x="38" y="31" width="26" height="3" rx="1.5" fill="#E7B98A" opacity="0.7" />
        <g className="ss-mascot__face">
          <ellipse cx="42" cy="56" rx="5" ry="6.5" fill="#FFF7EC" />
          <ellipse cx="62" cy="56" rx="5" ry="6.5" fill="#FFF7EC" />
          <circle className="ss-mascot__pupil" cx="43" cy="57" r="2.6" fill="#2E2522" />
          <circle className="ss-mascot__pupil" cx="63" cy="57" r="2.6" fill="#2E2522" />
          <path d="M44 72 Q52 79 60 72" fill="none" stroke="#FFF7EC" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="36" cy="68" r="3" fill="#C98B9B" opacity="0.8" />
          <circle cx="68" cy="68" r="3" fill="#C98B9B" opacity="0.8" />
        </g>
      </g>
      <path className="ss-mascot__arm ss-mascot__arm--wave" d="M18 62 Q6 58 4 46" />
      <path className="ss-mascot__arm ss-mascot__arm--hold" d="M78 60 Q90 52 96 40" />
    </svg>
  );
}

/** A walking mug: cream glaze, a handle, steam, two eyes and a smile. */
function MugMascot() {
  return (
    <svg viewBox="0 0 100 130" className="ss-mascot__svg" aria-hidden="true">
      <g className="ss-mascot__steam">
        <path d="M38 16 C34 10 42 8 38 2" />
        <path d="M50 18 C46 11 54 9 50 2" />
        <path d="M62 16 C58 10 66 8 62 2" />
      </g>
      <g className="ss-mascot__legs">
        <path className="ss-mascot__leg ss-mascot__leg--l" d="M38 100 L34 122 L26 124" />
        <path className="ss-mascot__leg ss-mascot__leg--r" d="M58 100 L62 122 L70 124" />
      </g>
      <g className="ss-mascot__body">
        <path d="M74 44 h6 c10 0 14 7 14 14 s-4 14 -14 14 h-6" fill="none" stroke="#5A371D" strokeWidth="6" strokeLinecap="round" />
        <path d="M74 44 h6 c10 0 14 7 14 14 s-4 14 -14 14 h-6" fill="none" stroke="#FFF7EC" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M20 26 h56 v56 c0 12 -10 20 -22 20 h-12 c-12 0 -22 -8 -22 -20 z" fill="#FFF7EC" stroke="#5A371D" strokeWidth="2" />
        <path d="M20 26 h56 v10 h-56 z" fill="#B7705D" />
        <ellipse cx="48" cy="26" rx="28" ry="5" fill="#6E4A3B" stroke="#5A371D" strokeWidth="2" />
        <g className="ss-mascot__face">
          <ellipse cx="38" cy="58" rx="5" ry="6.5" fill="#2E2522" />
          <ellipse cx="58" cy="58" rx="5" ry="6.5" fill="#2E2522" />
          <circle cx="39.5" cy="56" r="1.8" fill="#FFF" />
          <circle cx="59.5" cy="56" r="1.8" fill="#FFF" />
          <path d="M40 73 Q48 80 56 73" fill="none" stroke="#2E2522" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="31" cy="70" r="3.2" fill="#C98B9B" opacity="0.8" />
          <circle cx="65" cy="70" r="3.2" fill="#C98B9B" opacity="0.8" />
        </g>
      </g>
      <path className="ss-mascot__arm ss-mascot__arm--wave" d="M20 62 Q8 58 6 46" />
      <path className="ss-mascot__arm ss-mascot__arm--hold" d="M74 76 Q88 70 96 58" />
    </svg>
  );
}

export default function MascotBanner({ mascot, slides, label, interval = 7000, startAt = 0, testId }: {
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
    const t = window.setTimeout(() => {
      if (reduce) { setI((n) => (n + 1) % slides.length); return; }
      setPhase('fold');
      later(() => { setI((n) => (n + 1) % slides.length); setPhase('unfold'); }, 550);
      later(() => setPhase('show'), 1450);
    }, interval);
    return () => window.clearTimeout(t);
  }, [phase, paused, slides.length, interval, reduce]);

  if (!slides.length) return null;
  const s = slides[Math.min(i, slides.length - 1)];
  const open = phase === 'unfold' || phase === 'show';
  const body = (
    <>
      <span className="ss-mascot__media">
        {s.imageUrl ? <img key={s.key} src={s.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="ss-mascot__media-blank" aria-hidden="true">{mascot === 'mug' ? '☕' : '📚'}</span>}
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
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
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
        <div className="ss-mascot__char" aria-hidden="true">
          {mascot === 'mug' ? <MugMascot /> : <BookMascot />}
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
