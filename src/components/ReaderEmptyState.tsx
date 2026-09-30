/**
 * ReaderEmptyState — illustrated empty states for SwapSutra.
 *
 * A blank panel saying "No books found" tells a reader nothing about
 * where they are or what to do. Every empty state here answers three
 * things: what this space is, why it matters, and what to do next.
 *
 * The illustrations are hand-drawn inline SVG in SwapSutra's own visual
 * language — line art, warm ink, one dusty-mauve accent. They inherit
 * `currentColor` for the ink and read `--text-accent` for the accent, so
 * they follow the day/night theme with no second asset and no image
 * request. Each is well under 1KB; the whole set adds no dependency.
 */

import React from 'react';

export type ReaderSceneName =
  | 'shelf'        // an empty personal shelf
  | 'library'      // the community Library, quiet
  | 'swap'         // no swap / rent / sell requests
  | 'letters'      // no conversations
  | 'activity'     // no reading activity yet
  | 'saved'        // nothing saved or bookmarked
  | 'lamp'         // welcome / first visit
  | 'currentRead'  // no book open right now
  | 'circle'       // reading circles and events
  | 'quiet';       // gated or paused

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
};

const ACCENT = 'var(--text-accent, #8E4A59)';

const SCENES: Record<ReaderSceneName, React.ReactNode> = {
  // A shelf with room left on it, and something growing beside the books.
  shelf: (
    <>
      <path d="M26 86h108" />
      <path d="M34 86V60h12v26M50 86V52h10v34" />
      <path d="M74 86V64l12-3v25" stroke={ACCENT} />
      <path d="M102 86h14l-2-12h-10z" opacity=".45" />
      <path d="M109 74V62M109 66c-6 0-8-4-8-7 4 0 8 3 8 7zM109 68c6 0 8-4 8-8-5 0-8 4-8 8z" stroke={ACCENT} opacity=".8" />
      <path d="M26 86v8M134 86v8" opacity=".5" />
    </>
  ),
  // A row of spines with one gap — the book that hasn't arrived yet.
  library: (
    <>
      <rect x="28" y="44" width="12" height="46" rx="2" />
      <rect x="44" y="52" width="12" height="38" rx="2" />
      <rect x="60" y="40" width="12" height="50" rx="2" stroke={ACCENT} />
      <rect x="88" y="48" width="12" height="42" rx="2" />
      <rect x="104" y="44" width="12" height="46" rx="2" />
      <path d="M22 90h116" />
      <rect x="74" y="46" width="12" height="44" rx="2" stroke={ACCENT} strokeDasharray="4 5" opacity=".75" />
    </>
  ),
  // Two books passing each other.
  swap: (
    <>
      <rect x="24" y="46" width="34" height="44" rx="4" />
      <path d="M32 58h18M32 68h14" />
      <rect x="102" y="46" width="34" height="44" rx="4" stroke={ACCENT} />
      <path d="M110 58h18M110 68h14" stroke={ACCENT} />
      <path d="M66 60h28l-7-7M94 76H66l7 7" stroke={ACCENT} />
    </>
  ),
  // A letter, just sent.
  letters: (
    <>
      <rect x="34" y="42" width="76" height="50" rx="6" />
      <path d="M34 50l38 24 38-24" />
      <path d="M118 34l14 6-14 6z" fill={ACCENT} stroke={ACCENT} />
      <path d="M96 30c8-6 18-4 22 4" opacity=".4" stroke={ACCENT} />
    </>
  ),
  // Days you read, waiting to be filled in.
  activity: (
    <>
      <rect x="34" y="34" width="92" height="62" rx="6" />
      <path d="M34 50h92M56 34v-8M104 34v-8" />
      <rect x="46" y="60" width="11" height="11" rx="2.5" opacity=".3" />
      <rect x="64" y="60" width="11" height="11" rx="2.5" stroke={ACCENT} />
      <rect x="82" y="60" width="11" height="11" rx="2.5" stroke={ACCENT} />
      <rect x="100" y="60" width="11" height="11" rx="2.5" opacity=".3" />
      <rect x="46" y="78" width="11" height="11" rx="2.5" stroke={ACCENT} />
      <rect x="64" y="78" width="11" height="11" rx="2.5" opacity=".3" />
      <rect x="82" y="78" width="11" height="11" rx="2.5" opacity=".3" />
    </>
  ),
  // A ribbon holding a place.
  saved: (
    <>
      <rect x="44" y="26" width="60" height="72" rx="5" />
      <path d="M58 26v34l9-7 9 7V26" stroke={ACCENT} />
      <path d="M58 78h32M58 88h22" opacity=".4" />
    </>
  ),
  // A reading lamp over an open book — the welcome.
  lamp: (
    <>
      <path d="M62 26h22l8 15H54z" stroke={ACCENT} />
      <path d="M73 41v20" />
      <path d="M50 62l-8 30M96 62l8 30" opacity=".3" stroke={ACCENT} />
      <path d="M34 92h92" />
      <path d="M73 92c-8-6-16-7-24-6v-9c8-1 16 0 24 6z" />
      <path d="M73 92c8-6 16-7 24-6v-9c-8-1-16 0-24 6z" />
    </>
  ),
  // An open book, mid-story.
  currentRead: (
    <>
      <path d="M80 44v46" />
      <path d="M80 44c-10-8-24-10-36-8v46c12-2 26 0 36 8" />
      <path d="M80 44c10-8 24-10 36-8v46c-12-2-26 0-36 8" />
      <path d="M92 56l8 8 14-16" stroke={ACCENT} />
    </>
  ),
  // Readers gathered round one book.
  circle: (
    <>
      <ellipse cx="80" cy="66" rx="30" ry="14" />
      <rect x="70" y="56" width="20" height="8" rx="2" stroke={ACCENT} />
      <circle cx="36" cy="58" r="7" />
      <circle cx="124" cy="58" r="7" />
      <circle cx="56" cy="96" r="7" />
      <circle cx="104" cy="96" r="7" />
      <path d="M80 34a7 7 0 110 14 7 7 0 010-14" stroke={ACCENT} />
    </>
  ),
  // Something waiting to be opened.
  quiet: (
    <>
      <path d="M46 88h68" />
      <rect x="52" y="60" width="56" height="28" rx="4" />
      <path d="M64 60V44c0-9 7-16 16-16s16 7 16 16v16" stroke={ACCENT} />
      <circle cx="80" cy="74" r="4" stroke={ACCENT} />
    </>
  )
};

export const ReaderScene = ({
  name,
  size = 150,
  className = ''
}: {
  name: ReaderSceneName;
  size?: number;
  className?: string;
}) => (
  <svg
    viewBox="0 0 160 120"
    width={size}
    height={Math.round((size * 120) / 160)}
    className={`reader-scene ${className}`}
    role="presentation"
    aria-hidden="true"
    focusable="false"
    {...STROKE}
  >
    {SCENES[name] || SCENES.shelf}
  </svg>
);

/**
 * The empty state itself.
 *
 * `title` says where you are, `body` says why it matters, and the action
 * says what to do about it. `tone` picks how much room it takes: a whole
 * page deserves the full scene, a panel inside a tab does not.
 */
const ReaderEmptyState = ({
  scene,
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  tone = 'page',
  className = ''
}: {
  scene: ReaderSceneName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  tone?: 'page' | 'panel';
  className?: string;
}) => {
  const compact = tone === 'panel';
  return (
    <div
      className={`reader-empty ${compact ? 'reader-empty--panel' : ''} ${className}`}
      // Announced as a group rather than a pile of loose text.
      role="note"
      aria-label={title}
    >
      <ReaderScene name={scene} size={compact ? 108 : 150} />
      <h3 className={`reader-empty__title ${compact ? 'text-lg' : 'text-2xl'}`}>{title}</h3>
      {body && <p className="reader-empty__body">{body}</p>}
      {(actionLabel || secondaryLabel) && (
        <div className="reader-empty__actions">
          {actionLabel && onAction && (
            <button type="button" onClick={onAction} className="btn-primary !py-3 px-7 text-2xs uppercase tracking-widest font-bold">
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button type="button" onClick={onSecondary} className="btn-outline !py-3 px-7 text-2xs uppercase tracking-widest font-bold">
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ReaderEmptyState;
