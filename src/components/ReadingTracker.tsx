/**
 * My Reading Tracker — physical books tracked like e-books.
 *
 * Laid out after the owner's reference: a big "My Reading Tracker" title
 * with a "+ Add a Book" button, four tabs (Currently Reading · Want
 * to Read · Completed · All Books), and one clean card per book with its
 * cover, a progress bar, "241 / 388 pages", the day it was started and an
 * "Update Progress" button. Updating opens a sheet with one-tap "+10
 * pages" chips, the time left at the reader's own speed and the day they
 * will finish.
 *
 * Storage is the reader's Reading Space (reading_space sheet):
 *   currently_reading = true   → Currently Reading
 *   tbr = true                 → Want to Read
 *   finished                   → currently_reading false, bookshelf true,
 *                                reading_progress "t/t", finished_at set
 *   reading_progress = "p/t"   → page p of t
 *   started_at / finished_at   → set by the server when the status changes
 * The streak, week total, speed and minutes-a-day are personal nudges kept
 * in this browser (like the yearly goal).
 */

import React, { useMemo, useState } from 'react';
import confetti from 'canvas-confetti';

export interface TrackerBook {
  title: string;
  author?: string;
  progress?: string;
  /** Status flags (only the ones that apply). */
  currentlyReading?: boolean;
  wantToRead?: boolean;
  finished?: boolean;
  startedAt?: string;
  finishedAt?: string;
  /** A real cover picture when the book is in the Library. */
  cover?: string;
}

export type TrackerChanges = {
  currently_reading?: boolean;
  tbr?: boolean;
  bookshelf?: boolean;
  reading_progress?: string;
};

type OnUpdate = (book: TrackerBook, changes: TrackerChanges) => Promise<boolean>;

/* ── Progress text ─────────────────────────────────────────────────── */

/** "120/340" → { page: 120, total: 340 }. Anything else reads as not started. */
export const parseProgress = (raw?: string) => {
  const m = String(raw || '').match(/^\s*(\d{1,5})\s*\/\s*(\d{1,5})\s*$/);
  if (!m) return { page: 0, total: 0 };
  const total = Number(m[2]);
  return { page: Math.min(Number(m[1]), total || Number(m[1])), total };
};

export const formatProgress = (page: number, total: number) =>
  `${Math.max(0, Math.round(page || 0))}/${Math.max(0, Math.round(total || 0))}`;

const percent = (page: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((page / total) * 100)) : 0;

/* ── Time left ─────────────────────────────────────────────────────── */

export const SPEED_KEY = 'swapsutraReadingSpeed';
export const DAILY_KEY = 'swapsutraReadingDailyMinutes';
export const LOG_KEY = 'swapsutraReadingLog';
export const DEFAULT_SPEED = 30;
export const DEFAULT_DAILY = 30;

/** Minutes of reading left, or null when we cannot say (no total / no speed). */
export const minutesLeft = (pagesLeft: number, pagesPerHour: number): number | null => {
  if (!(pagesPerHour > 0) || !(pagesLeft >= 0) || !Number.isFinite(pagesLeft)) return null;
  return Math.ceil((pagesLeft / pagesPerHour) * 60);
};

/** 45 → "45 min", 90 → "1 hr 30 min", 600 → "10 hr". */
export const formatMinutes = (mins: number): string => {
  if (mins <= 0) return '0 min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
};

/** The day the book will be done if the reader keeps `dailyMinutes` a day. */
export const finishDate = (mins: number | null, dailyMinutes: number, from = new Date()): Date | null => {
  if (mins === null || !(dailyMinutes > 0)) return null;
  const days = Math.max(0, Math.ceil(mins / dailyMinutes) - 1);
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
};

const finishLabel = (d: Date | null) => {
  if (!d) return '';
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

const niceDate = (raw?: string) => {
  if (!raw) return '';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/* ── Reading log (streak + week) ───────────────────────────────────── */

export type ReadingLog = Record<string, number>; // 'YYYY-MM-DD' → pages

export const dayKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Consecutive days with pages logged, ending today (or yesterday — the
 *  streak is not broken until a whole day passes with nothing). */
export const readingStreak = (log: ReadingLog, today = new Date()): number => {
  const d = new Date(today);
  if (!(log[dayKey(d)] > 0)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (log[dayKey(d)] > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
};

const weekPages = (log: ReadingLog, today = new Date()) => {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    sum += Math.max(0, Number(log[dayKey(d)]) || 0);
  }
  return sum;
};

const readNumber = (key: string, fallback: number, max: number) => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? Math.min(v, max) : fallback;
  } catch { return fallback; }
};

const readLog = (): ReadingLog => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
};

const clampInt = (v: string | number, max = 99999) => {
  const n = Math.floor(Number(String(v).replace(/[^\d]/g, '')));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};

/* ── Colours: the SwapSutra palette only ────────────────────────────
   Dusty rose (brand-gold) for actions and progress, brand brown for
   text-weight accents, beige for tracks. */
const ROSE = '#8E4A59';        // --color-brand-gold
const ROSE_MUTED = '#A85D6D';  // --color-brand-gold-muted
const BROWN = '#4A3B32';       // --color-brand-brown
const SOFT_BROWN = '#7C6E65';  // --color-brand-softbrown
const CONFETTI = [ROSE, ROSE_MUTED, BROWN, '#E5DDD3', '#F2EBE1'];

/* ── Covers ────────────────────────────────────────────────────────── */

// Printed covers in SwapSutra tones only.
const COVER_COLOURS = [
  ['#8E4A59', '#A85D6D'], ['#4A3B32', '#7C6E65'], ['#6E3845', '#8E4A59'],
  ['#5E4A3F', '#7C6E65'], ['#7C6E65', '#A08F84'], ['#A85D6D', '#C07E8B'],
];

const coverColours = (title: string) => {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return COVER_COLOURS[h % COVER_COLOURS.length];
};

/** The real cover when we have one; otherwise a printed-looking cover. */
export const BookCover = ({ title, author, src, size = 'md' }: { title: string; author?: string; src?: string; size?: 'sm' | 'md' }) => {
  const [broken, setBroken] = useState(false);
  const dims = size === 'sm' ? 'w-12 h-[72px] text-2xs' : 'w-[76px] h-[114px] sm:w-[88px] sm:h-[132px] text-2xs';
  if (src && !broken) {
    return (
      <div className={`${dims} shrink-0 overflow-hidden rounded-md shadow-md bg-brand-beige`} aria-hidden="true">
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      </div>
    );
  }
  const [a, b] = coverColours(title);
  return (
    <div
      aria-hidden="true"
      className={`${dims} shrink-0 relative overflow-hidden rounded-md shadow-md flex flex-col justify-between p-2 text-white`}
      style={{ background: `linear-gradient(150deg, ${a}, ${b})` }}
    >
      <span className="absolute inset-y-0 left-0 w-1.5 bg-black/25" />
      <span className="pl-1.5 font-serif font-bold leading-tight line-clamp-4 break-words" style={{ color: '#fff' }}>{title}</span>
      {author && <span className="pl-1.5 opacity-80 leading-tight line-clamp-1" style={{ color: '#fff' }}>{author}</span>}
    </div>
  );
};

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" strokeLinecap="round" />
  </svg>
);

/* ── Bottom sheet ──────────────────────────────────────────────────── */

const Sheet = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-brand-brown/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}
    onClick={onClose}>
    <div className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[var(--bg-surface)] p-5 pb-8 shadow-2xl space-y-4"
      onClick={(e) => e.stopPropagation()}>
      <div className="mx-auto h-1.5 w-10 rounded-full bg-brand-beige sm:hidden" aria-hidden="true" />
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-xl text-[var(--text-primary)]">{title}</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full px-2 text-2xl leading-none text-[var(--text-secondary)]">×</button>
      </div>
      {children}
    </div>
  </div>
);

/* ── Update-progress sheet ─────────────────────────────────────────── */

export const QUICK_PAGES = [5, 10, 25, 50];

const UpdateSheet = ({
  book, speed, daily, onClose, onUpdate, onPagesRead, onPace,
}: {
  book: TrackerBook; speed: number; daily: number; onClose: () => void;
  onUpdate: OnUpdate; onPagesRead: (n: number) => void; onPace: (speed: string, daily: string) => void;
}) => {
  const initial = parseProgress(book.progress);
  const [page, setPage] = useState(String(initial.page || 0));
  const [total, setTotal] = useState(String(initial.total || ''));
  const [busy, setBusy] = useState(false);
  const [paceOpen, setPaceOpen] = useState(false);

  const p = clampInt(page);
  const t = clampInt(total);
  const pct = percent(p, t);
  const left = t > 0 ? Math.max(0, t - Math.min(p, t)) : 0;
  const mins = t > 0 ? minutesLeft(left, speed) : null;
  const done = t > 0 && left === 0;

  const bump = (n: number) => setPage(String(t ? Math.min(t, p + n) : p + n));

  const save = async () => {
    setBusy(true);
    const ok = await onUpdate(book, { reading_progress: formatProgress(Math.min(p, t || p), t) });
    if (ok && p > initial.page) onPagesRead(p - initial.page);
    setBusy(false);
    if (ok) onClose();
  };

  const finish = async () => {
    setBusy(true);
    const ok = await onUpdate(book, {
      currently_reading: false,
      bookshelf: true,
      reading_progress: t ? formatProgress(t, t) : book.progress || '',
    });
    if (ok) {
      if (t > initial.page) onPagesRead(t - initial.page);
      try { confetti({ particleCount: 140, spread: 80, origin: { y: 0.7 }, colors: CONFETTI }); } catch { /* no canvas */ }
      onClose();
    }
    setBusy(false);
  };

  const num = 'w-24 rounded-xl border border-brand-border bg-[var(--input-bg)] px-3 py-2.5 text-center font-serif text-xl text-[var(--text-primary)]';

  return (
    <Sheet title="Update progress" onClose={onClose}>
      <div className="flex items-center gap-4">
        <BookCover title={book.title} author={book.author} src={book.cover} size="sm" />
        <div className="min-w-0">
          <p className="font-serif text-lg leading-snug text-[var(--text-primary)] line-clamp-2">{book.title}</p>
          {book.author && <p className="text-sm text-[var(--text-secondary)] truncate">{book.author}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
        <span>I'm on page</span>
        <input type="number" inputMode="numeric" min={0} value={page} onChange={(e) => setPage(e.target.value)}
          aria-label={`Current page of ${book.title}`} className={num} />
        <span>of</span>
        <input type="number" inputMode="numeric" min={0} value={total} onChange={(e) => setTotal(e.target.value)}
          aria-label={`Total pages of ${book.title}`} className={num} placeholder="—" />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {QUICK_PAGES.map((n) => (
          <button key={n} type="button" onClick={() => bump(n)} aria-label={`Add ${n} pages to ${book.title}`}
            className="rounded-2xl border py-2.5 font-serif text-base font-bold active:scale-95 transition-transform"
            style={{ borderColor: `${ROSE}55`, color: ROSE, background: `${ROSE}0D` }}>
            +{n}
          </button>
        ))}
      </div>

      {t > 0 ? (
        <div className="rounded-2xl bg-[var(--bg-page)] p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-brand-beige">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: ROSE }} />
            </div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">{pct}%</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center" aria-live="polite">
            <div>
              <p className="font-serif text-lg leading-none text-[var(--text-primary)]">{100 - pct}%</p>
              <p className="mt-1 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Left · {left} pg</p>
            </div>
            <div>
              <p className="font-serif text-lg leading-none text-[var(--text-primary)]">{done ? 'Done' : mins !== null ? formatMinutes(mins) : '—'}</p>
              <p className="mt-1 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">To finish</p>
            </div>
            <div>
              <p className="font-serif text-lg leading-none text-[var(--text-primary)]">{done ? '🎉' : finishLabel(finishDate(mins, daily)) || '—'}</p>
              <p className="mt-1 text-2xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Finish by</p>
            </div>
          </div>
          <button type="button" onClick={() => setPaceOpen((v) => !v)} className="w-full text-left text-xs text-[var(--text-secondary)]">
            ⏱️ At {speed} pages/hour, {daily} min a day · <span className="underline underline-offset-2">change</span>
          </button>
          {paceOpen && (
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <label className="flex flex-wrap items-center gap-2">
                <span>I read about</span>
                <input type="number" inputMode="numeric" min={1} max={1000} defaultValue={speed}
                  onChange={(e) => onPace(e.target.value, '')} aria-label="Your reading speed in pages per hour"
                  className="w-20 rounded-xl border border-brand-border bg-[var(--input-bg)] px-2 py-1.5 text-center font-serif text-base text-[var(--text-primary)]" />
                <span>pages an hour</span>
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <span>and read</span>
                <input type="number" inputMode="numeric" min={1} max={1440} defaultValue={daily}
                  onChange={(e) => onPace('', e.target.value)} aria-label="Minutes you read a day"
                  className="w-20 rounded-xl border border-brand-border bg-[var(--input-bg)] px-2 py-1.5 text-center font-serif text-base text-[var(--text-primary)]" />
                <span>minutes a day</span>
              </label>
              <p className="text-xs">Most people read 30–50 pages of a paperback an hour.</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--text-secondary)]">Add the total pages (see the last page of the book) to see how much is left and when you'll finish.</p>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <button type="button" onClick={save} disabled={busy}
          className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white shadow-md disabled:opacity-50" style={{ background: ROSE }}>
          {busy ? 'Saving…' : 'Save progress'}
        </button>
        <button type="button" onClick={finish} disabled={busy}
          className={`w-full rounded-2xl py-3 text-sm font-semibold disabled:opacity-50 ${done ? 'text-white shadow-md' : 'border'}`}
          style={done ? { background: BROWN } : { borderColor: `${BROWN}40`, color: BROWN, background: '#F2EBE1' }}>
          ✓ Finished this book
        </button>
      </div>
    </Sheet>
  );
};

/* ── One book card ─────────────────────────────────────────────────── */

type Tab = 'reading' | 'want' | 'done' | 'all';

const BookCard: React.FC<{
  book: TrackerBook; speed: number; daily: number; busy: boolean;
  onOpenUpdate: () => void;
  onAction: (what: 'finish' | 'want' | 'read' | 'remove') => void;
}> = ({ book, speed, busy, onOpenUpdate, onAction }) => {
  const [menu, setMenu] = useState(false);
  const { page, total } = parseProgress(book.progress);
  const pct = book.finished ? 100 : percent(page, total);
  const left = total > 0 ? Math.max(0, total - page) : 0;
  const mins = total > 0 && !book.finished ? minutesLeft(left, speed) : null;
  const tapToUpdate = book.currentlyReading ? onOpenUpdate : undefined;

  return (
    <li className="relative rounded-2xl bg-[var(--bg-surface)] p-3 shadow-[0_2px_10px_-4px_rgba(74,59,50,0.18)] ring-1 ring-brand-border/70">
      <div className="flex gap-3">
        <button type="button" onClick={tapToUpdate} disabled={!tapToUpdate || busy} className="shrink-0 disabled:cursor-default" aria-hidden={!tapToUpdate} tabIndex={tapToUpdate ? 0 : -1}>
          <BookCover title={book.title} author={book.author} src={book.cover} />
        </button>
        <div className="min-w-0 flex-1 flex flex-col">
          <div className="pr-7">
            <p className="font-serif text-lg leading-tight text-[var(--text-primary)] line-clamp-2">{book.title}</p>
            {book.author && <p className="mt-0.5 text-sm text-[var(--text-secondary)] truncate">{book.author}</p>}
          </div>

          {(book.currentlyReading || book.finished) ? (
            <div className="mt-auto pt-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>{total > 0 ? `${book.finished ? total : page} / ${total} pages` : 'Add total pages'}</span>
                <span className="font-semibold text-[var(--text-primary)]">{pct}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-brand-beige">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${ROSE_MUTED}, ${ROSE})` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-[var(--text-secondary)]">
                  {book.finished
                    ? `✓ Finished${book.finishedAt ? ` ${niceDate(book.finishedAt)}` : ''}`
                    : mins ? `⏱ ${formatMinutes(mins)} left` : (book.startedAt ? `Started ${niceDate(book.startedAt)}` : '')}
                </span>
                {book.currentlyReading && (
                  <button type="button" onClick={onOpenUpdate} disabled={busy}
                    className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm active:scale-95 transition-transform disabled:opacity-50"
                    style={{ background: ROSE }}>
                    Update Progress
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-auto pt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--text-secondary)]">{total > 0 ? `${total} pages` : ''}</span>
              <button type="button" onClick={() => onAction('read')} disabled={busy}
                className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50" style={{ background: ROSE }}>
                Start Reading
              </button>
            </div>
          )}
        </div>
      </div>

      <button type="button" onClick={() => setMenu((v) => !v)} aria-label={`More options for ${book.title}`} aria-expanded={menu}
        className="absolute right-1.5 top-2 rounded-full px-2 py-1 text-lg leading-none text-[var(--text-secondary)]">
        ⋮
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} aria-hidden="true" />
          <div role="menu" className="absolute right-3 top-9 z-20 min-w-[190px] rounded-xl border border-brand-border bg-[var(--bg-surface)] p-1.5 shadow-xl">
            {book.currentlyReading && (
              <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--bg-page)]"
                onClick={() => { setMenu(false); onAction('finish'); }}>✓ Mark as finished</button>
            )}
            {!book.currentlyReading && (
              <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--bg-page)]"
                onClick={() => { setMenu(false); onAction('read'); }}>{book.finished ? 'Read it again' : 'Start reading'}</button>
            )}
            {!book.wantToRead && !book.finished && (
              <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--bg-page)]"
                onClick={() => { setMenu(false); onAction('want'); }}>Move to Want to Read</button>
            )}
            <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-brand-gold-text hover:bg-brand-beige"
              onClick={() => { setMenu(false); onAction('remove'); }}>Remove from tracker</button>
          </div>
        </>
      )}
    </li>
  );
};

/* ── "Continue reading": the book you touched last, front and centre ── */

const ContinueCard = ({ book, speed, streak, thisWeek, finishedCount, goal, onOpen, onGoal }: {
  book?: TrackerBook; speed: number; streak: number; thisWeek: number; finishedCount: number; goal: number;
  onOpen: () => void; onGoal: () => void;
}) => {
  const { page, total } = parseProgress(book?.progress);
  const pct = percent(page, total);
  const mins = book && total > 0 ? minutesLeft(Math.max(0, total - page), speed) : null;
  const R = 26, C = 2 * Math.PI * R;
  return (
    <section className="relative overflow-hidden rounded-3xl p-4 text-white shadow-[0_14px_30px_-14px_rgba(74,59,50,0.6)]"
      style={{ background: `linear-gradient(135deg, ${BROWN} 0%, #6E3845 55%, ${ROSE} 100%)` }}>
      <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
      {book ? (
        <button type="button" onClick={onOpen} className="relative flex w-full items-center gap-3.5 text-left" aria-label={`Continue reading ${book.title}`}>
          <BookCover title={book.title} author={book.author} src={book.cover} />
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-bold uppercase tracking-eyebrow" style={{ color: 'rgba(255,255,255,0.7)' }}>Continue reading</p>
            <p className="mt-1 font-serif text-xl leading-tight line-clamp-2" style={{ color: '#fff' }}>{book.title}</p>
            <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {total > 0 ? `Page ${page} of ${total}` : 'Tap to add pages'}{mins ? ` · ${formatMinutes(mins)} left` : ''}
            </p>
          </div>
          <div className="relative h-16 w-16 shrink-0">
            <svg width="64" height="64" className="-rotate-90" aria-hidden="true">
              <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="6" />
              <circle cx="32" cy="32" r={R} fill="none" stroke="#F2EBE1" strokeWidth="6" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset .7s' }} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-serif text-base font-bold" style={{ color: '#fff' }}>{pct}%</span>
          </div>
        </button>
      ) : (
        <div className="relative">
          <p className="font-serif text-xl" style={{ color: '#fff' }}>Start your reading journey</p>
          <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>Add the book on your bedside table.</p>
        </div>
      )}
      <div className="relative mt-3.5 grid grid-cols-3 gap-2">
        {[
          { icon: streak > 0 ? '🔥' : '🌱', value: String(streak), label: 'Day streak' },
          { icon: '📖', value: String(thisWeek), label: 'Pages this week' },
          { icon: '📚', value: `${finishedCount}/${goal}`, label: 'Books this year', onClick: onGoal },
        ].map((s) => (
          <button key={s.label} type="button" onClick={s.onClick} disabled={!s.onClick}
            className="rounded-2xl py-2 text-center disabled:cursor-default" style={{ background: 'rgba(255,255,255,0.12)' }}>
            <p className="font-serif text-lg leading-none" style={{ color: '#fff' }}>{s.icon} {s.value}</p>
            <p className="mt-1 text-2xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.7)' }}>{s.label}</p>
          </button>
        ))}
      </div>
    </section>
  );
};

/* ── The page ──────────────────────────────────────────────────────── */

export default function ReadingTracker({
  books,
  finishedCount,
  goal,
  onGoalChange,
  onUpdate,
}: {
  books: TrackerBook[];
  finishedCount: number;
  goal: number;
  onGoalChange: (n: number) => void;
  onUpdate: OnUpdate;
}) {
  const [tab, setTab] = useState<Tab>('reading');
  const [adding, setAdding] = useState(false);
  const [updating, setUpdating] = useState<TrackerBook | null>(null);
  const [busyTitle, setBusyTitle] = useState('');
  const [goalOpen, setGoalOpen] = useState(false);
  const [speed, setSpeed] = useState<number>(() => readNumber(SPEED_KEY, DEFAULT_SPEED, 1000));
  const [daily, setDaily] = useState<number>(() => readNumber(DAILY_KEY, DEFAULT_DAILY, 1440));
  const [log, setLog] = useState<ReadingLog>(readLog);

  // add-book form
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [addAs, setAddAs] = useState<'reading' | 'want'>('reading');
  const [saving, setSaving] = useState(false);

  const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
  const onPace = (s: string, d: string) => {
    if (s) { const n = Math.max(1, Math.min(1000, clampInt(s) || 1)); setSpeed(n); store(SPEED_KEY, String(n)); }
    if (d) { const n = Math.max(1, Math.min(1440, clampInt(d) || 1)); setDaily(n); store(DAILY_KEY, String(n)); }
  };
  const recordPages = (n: number) => {
    if (!(n > 0)) return;
    setLog((prev) => {
      const next = { ...prev, [dayKey()]: (Number(prev[dayKey()]) || 0) + n };
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60);
      Object.keys(next).forEach((k) => { if (k < dayKey(cutoff)) delete next[k]; });
      store(LOG_KEY, JSON.stringify(next));
      return next;
    });
  };

  const reading = books.filter((b) => b.currentlyReading);
  const want = books.filter((b) => b.wantToRead && !b.currentlyReading && !b.finished);
  const done = books.filter((b) => b.finished && !b.currentlyReading);
  const shown = tab === 'reading' ? reading : tab === 'want' ? want : tab === 'done' ? done : books;

  const streak = readingStreak(log);
  const thisWeek = useMemo(() => weekPages(log), [log]);

  const already = (t: string) => books.some((b) => String(b.title ?? '').trim().toLowerCase() === t.trim().toLowerCase());

  const act = async (book: TrackerBook, what: 'finish' | 'want' | 'read' | 'remove') => {
    setBusyTitle(book.title);
    const { page, total } = parseProgress(book.progress);
    let ok = false;
    if (what === 'finish') {
      ok = await onUpdate(book, { currently_reading: false, bookshelf: true, reading_progress: total ? formatProgress(total, total) : book.progress || '' });
      if (ok) {
        if (total > page) recordPages(total - page);
        try { confetti({ particleCount: 140, spread: 80, origin: { y: 0.7 }, colors: CONFETTI }); } catch { /* no canvas */ }
      }
    } else if (what === 'read') {
      ok = await onUpdate(book, { currently_reading: true, tbr: false, ...(book.finished ? { reading_progress: total ? formatProgress(0, total) : '' } : {}) });
      if (ok) setTab('reading');
    } else if (what === 'want') {
      ok = await onUpdate(book, { currently_reading: false, tbr: true });
    } else if (what === 'remove') {
      if (!window.confirm(`Remove "${book.title}" from your tracker?`)) { setBusyTitle(''); return; }
      ok = await onUpdate(book, book.finished
        ? { currently_reading: false, tbr: false, bookshelf: false }
        : { currently_reading: false, tbr: false });
    }
    setBusyTitle('');
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean || saving) return;
    if (already(clean)) { setTitle(''); return; }
    setSaving(true);
    const total = clampInt(pages);
    const ok = await onUpdate(
      { title: clean, author: author.trim() },
      addAs === 'reading'
        ? { currently_reading: true, tbr: false, reading_progress: total ? formatProgress(0, total) : '' }
        : { tbr: true, reading_progress: total ? formatProgress(0, total) : '' },
    );
    setSaving(false);
    if (ok) {
      setTitle(''); setAuthor(''); setPages('');
      setAdding(false);
      setTab(addAs === 'reading' ? 'reading' : 'want');
    }
  };

  const TABS: { id: Tab; label: string; short: string; count: number }[] = [
    { id: 'reading', label: 'Currently Reading', short: 'Reading', count: reading.length },
    { id: 'want', label: 'Want to Read', short: 'Want', count: want.length },
    { id: 'done', label: 'Completed', short: 'Done', count: done.length },
    { id: 'all', label: 'All Books', short: 'All', count: books.length },
  ];

  const input = 'w-full rounded-xl border border-brand-border bg-[var(--input-bg)] px-4 py-3 text-base sm:text-sm text-[var(--text-primary)]';
  const goalPct = Math.min(100, Math.round((finishedCount / Math.max(1, goal)) * 100));

  return (
    <div className="space-y-4">
      {/* Header: title + one round add button */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-3xl leading-none tracking-tight text-[var(--text-primary)]">My Reading Tracker</h2>
        <button type="button" onClick={() => setAdding(true)} aria-label="＋ Add a Book"
          className="flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-md active:scale-95 transition-transform"
          style={{ background: ROSE }}>
          <span className="text-base leading-none">＋</span> Add
        </button>
      </div>

      <ContinueCard
        book={reading[0]}
        speed={speed}
        streak={streak}
        thisWeek={thisWeek}
        finishedCount={finishedCount}
        goal={goal}
        onOpen={() => (reading[0] ? setUpdating(reading[0]) : setAdding(true))}
        onGoal={() => setGoalOpen((v) => !v)}
      />
      {goalOpen && (
        <div className="rounded-2xl bg-[var(--bg-surface)] ring-1 ring-brand-border/70 p-3.5 space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm text-[var(--text-primary)]">
            <span>Books to read this year</span>
            <input type="number" min={1} max={999} value={goal} onChange={(e) => onGoalChange(Number(e.target.value))}
              aria-label="Books you want to read this year"
              className="w-20 rounded-xl border border-brand-border bg-[var(--input-bg)] px-2 py-1.5 text-center font-serif text-base" />
          </label>
          <div className="h-1.5 overflow-hidden rounded-full bg-brand-beige">
            <div className="h-full rounded-full" style={{ width: `${goalPct}%`, background: ROSE }} />
          </div>
        </div>
      )}

      {/* Tabs: one line, short words */}
      <div role="tablist" aria-label="Your books" className="flex gap-1 rounded-full bg-brand-beige p-1">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            aria-label={`${t.label}${t.count ? ` (${t.count})` : ''}`}
            className={`flex-1 rounded-full px-1 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${tab === t.id ? 'text-white shadow' : 'text-[var(--text-secondary)]'}`}
            style={tab === t.id ? { background: ROSE } : undefined}>
            {t.short}{t.count ? <span className="ml-1 opacity-75">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {/* Books */}
      {shown.length > 0 ? (
        <ul className="space-y-2.5">
          {shown.map((b) => (
            <BookCard
              key={`${b.title}::${b.author || ''}::${b.progress || ''}::${b.currentlyReading ? 1 : 0}${b.wantToRead ? 1 : 0}${b.finished ? 1 : 0}`}
              book={b}
              speed={speed}
              daily={daily}
              busy={busyTitle === b.title}
              onOpenUpdate={() => setUpdating(b)}
              onAction={(what) => act(b, what)}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-3xl border border-dashed border-brand-border bg-[var(--bg-surface)] px-6 py-10 text-center space-y-3">
          <div className="flex items-end justify-center gap-2" aria-hidden="true">
            <div className="-rotate-6"><BookCover title="Your next favourite" size="sm" /></div>
            <BookCover title="The book on your bedside table" />
            <div className="rotate-6"><BookCover title="Many more to come" size="sm" /></div>
          </div>
          <p className="font-serif text-xl text-[var(--text-primary)]">
            {tab === 'reading' ? 'What are you reading right now?' : tab === 'want' ? 'Nothing on your list yet' : tab === 'done' ? 'No finished books yet' : 'Your tracker is empty'}
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            {tab === 'done' ? 'Finished books land here 🎉' : 'Pages, time left, finish date — all in one place.'}
          </p>
          {tab !== 'done' && (
            <button type="button" onClick={() => { setAddAs(tab === 'want' ? 'want' : 'reading'); setAdding(true); }}
              className="rounded-2xl px-5 py-3 text-sm font-medium text-white" style={{ background: ROSE }}>
              ＋ Add a Book
            </button>
          )}
        </div>
      )}

      {/* Add a book */}
      {adding && (
        <Sheet title="Add a book" onClose={() => setAdding(false)}>
          <form onSubmit={add} className="space-y-3">
            <input className={input} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Book name" aria-label="Book name" required maxLength={150} autoFocus />
            <input className={input} value={author} onChange={(e) => setAuthor(e.target.value)}
              placeholder="Author (optional)" aria-label="Author" maxLength={120} />
            <input className={input} value={pages} onChange={(e) => setPages(e.target.value)}
              type="number" inputMode="numeric" min={0}
              placeholder="Total pages (see the last page)" aria-label="Total pages" />
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-brand-beige p-1" role="radiogroup" aria-label="Add to">
              {([['reading', 'Reading it now'], ['want', 'Want to read']] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={addAs === id} onClick={() => setAddAs(id)}
                  className={`rounded-xl py-2.5 text-sm ${addAs === id ? 'text-white shadow' : 'text-[var(--text-primary)]'}`}
                  style={addAs === id ? { background: ROSE } : undefined}>
                  {label}
                </button>
              ))}
            </div>
            {title.trim() && already(title) && <p className="text-xs text-brand-gold-text">You're already tracking this one.</p>}
            <button type="submit" disabled={!title.trim() || saving}
              className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white shadow-md disabled:opacity-50" style={{ background: ROSE }}>
              {saving ? 'Adding…' : 'Start tracking'}
            </button>
          </form>
        </Sheet>
      )}

      {updating && (
        <UpdateSheet
          book={updating}
          speed={speed}
          daily={daily}
          onClose={() => setUpdating(null)}
          onUpdate={onUpdate}
          onPagesRead={recordPages}
          onPace={onPace}
        />
      )}
    </div>
  );
}
