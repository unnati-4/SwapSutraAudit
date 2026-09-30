/**
 * ReaderProfile — one reader, as other readers see them.
 *
 * WHAT IS NOT HERE, and why.
 *
 * No email, no phone, no pincode, no coordinates, no membership or
 * payment state. The backend strips all of it (see PROFILE_FORBIDDEN_KEYS
 * in appsscript.js) and this page never asks for it. A profile is a
 * bookshelf and a reading history, not a contact card — the way to reach
 * someone is still a swap request, which goes through the existing
 * request flow where both sides have opted in.
 *
 * The reader is addressed by an opaque id, never an email, so an address
 * cannot end up in a URL, in browser history, or in a shared link.
 */

import React, { useMemo } from 'react';
import { AwardedBadges, type AwardedBadge } from './AwardedBadges';

export interface ProfileShelfItem {
  id: string;
  title: string;
  author: string;
  format: string;
  readingProgress: number;
  favourite: boolean;
  currentlyReading: boolean;
  tbr: boolean;
  bookshelf: boolean;
  availableForSwap: boolean;
  addedAt: string;
}

export interface ReaderProfileData {
  readerId: string;
  name: string;
  fullName: string;
  area: string;
  genres: string;
  bio: string;
  memberSince: string;
  isActiveMember: boolean;
  booksListedCount: number;
  shelfCount: number;
  isSelf: boolean;
  // How reliably this reader answers requests. Absent on an older
  // backend, and null until they have had at least one request settle,
  // so both cases must render as "no figure yet" rather than as zero —
  // a new reader is not an unresponsive one.
  responseStats?: {
    requests: number;
    answered: number;
    responseRate: number | null;
    medianHours: number | null;
  };
  // Trust signals (Trust Gap Closure Plan, P0-1). Absent on an older
  // backend, so every read below defaults rather than assuming presence.
  completedSwapsCount?: number;
  avgRating?: number;
  ratingCount?: number;
  trustBadges?: string[];
  // Awarded by the SwapSutra team at a meetup, not computed.
  awardedBadges?: AwardedBadge[];
  books: any[];
  shelves: {
    currentlyReading: ProfileShelfItem[];
    tbr: ProfileShelfItem[];
    bookshelf: ProfileShelfItem[];
    favourites: ProfileShelfItem[];
  };
  achievements: {
    streak?: { currentStreak?: number; longestStreak?: number; totalActiveDays?: number };
    badges?: Record<string, boolean>;
  };
  journey: {
    activities: Array<{ type: string; title: string; description: string; at: string }>;
    metrics: Record<string, number>;
  };
}

/** Badge keys the backend computes, with reader-facing names. */
const BADGE_LABELS: Record<string, { name: string; note: string }> = {
  b1: { name: 'Joined the circle', note: 'Became a SwapSutra reader' },
  b2: { name: 'Three days running', note: 'Came back three days in a row' },
  b3: { name: 'First swap', note: 'Completed a book exchange' },
  b4: { name: 'Spoke up', note: 'Posted in a reading circle' },
  b5: { name: 'On the map', note: 'Added their reading neighbourhood' },
  b6: { name: 'Full member', note: 'Holds a paid membership' },
  b7: { name: 'Made a shelf', note: 'Started their reading space' },
  b8: { name: 'Put a book out', note: 'Listed or requested a book' },
  b9: { name: 'Reserved', note: 'Not yet awarded' },
  b10: { name: 'Met Quill', note: 'Talked with Quill' }
};

/** "August 2026" — never an exact join date. */
function joinedLabel(value: string): string {
  if (!value) return '';
  const then = new Date(value);
  if (isNaN(then.getTime())) return '';
  return then.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

/**
 * A response time a person can act on. "Usually in 4 hours" tells a
 * requester whether to wait; "usually in 3.7 hours" only tells them a
 * number was computed.
 */
function formatResponseTime(hours: number): string {
  if (hours < 1) return 'under an hour';
  if (hours < 24) {
    const h = Math.round(hours);
    return h === 1 ? 'about an hour' : `about ${h} hours`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? 'about a day' : `about ${days} days`;
}

function activityLabel(type: string): string {
  const map: Record<string, string> = {
    book_listed: 'Listed a book',
    book_requested: 'Asked for a book',
    swap_completed: 'Completed a swap',
    circle_message_posted: 'Spoke in a circle',
    reading_space_created: 'Started a shelf',
    quill_interacted: 'Talked with Quill',
    user_joined: 'Joined SwapSutra',
    event_attended: 'Went to an event'
  };
  return map[type] || type.replace(/_/g, ' ');
}

const Shelf = ({
  title,
  items,
  emptyNote
}: {
  title: string;
  items: ProfileShelfItem[];
  emptyNote: string;
}) => (
  <section className="rp-shelf">
    <h3 className="rp-shelf__title">
      {title} <span className="rp-shelf__count">{items.length}</span>
    </h3>
    {items.length === 0 ? (
      <p className="rp-shelf__empty">{emptyNote}</p>
    ) : (
      <ul className="rp-shelf__list">
        {items.map(item => (
          <li key={item.id || item.title} className="rp-book">
            <span className="rp-book__title">{item.title || 'Untitled'}</span>
            {item.author && <span className="rp-book__author">{item.author}</span>}
            <span className="rp-book__tags">
              {item.format && <span className="rp-tag">{item.format}</span>}
              {item.availableForSwap && <span className="rp-tag rp-tag--swap">Open to swap</span>}
              {item.currentlyReading && item.readingProgress > 0 && (
                <span className="rp-tag">{item.readingProgress}%</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

const ReaderProfile = ({
  profile,
  loading,
  error,
  onBack,
  onRetry,
  onOpenLibrary,
  renderShelf,
  onShareShelf
}: {
  profile: ReaderProfileData | null;
  loading: boolean;
  error?: string | null;
  onBack: () => void;
  onRetry: () => void;
  onOpenLibrary: () => void;
  /** Draws the reader's listed books as the 3-D shelf the Library uses. */
  renderShelf?: (books: any[]) => React.ReactNode;
  /** Opens the share panel for this shelf (picture + link). */
  onShareShelf?: () => void;
}) => {
  const earned = useMemo(() => {
    const badges = profile?.achievements?.badges || {};
    return Object.keys(BADGE_LABELS).filter(key => badges[key]);
  }, [profile]);

  const streak = profile?.achievements?.streak || {};

  if (loading) {
    return (
      <div className="rp-page">
        <div className="rp-card">
          <div className="sk" style={{ height: 96, borderRadius: 20 }} />
          <div className="sk sk-book__line" style={{ marginTop: 18, width: '40%' }} />
          <div className="sk sk-book__line" style={{ marginTop: 10 }} />
          <span className="sr-only">Opening this reader&rsquo;s profile…</span>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="rp-page">
        <div className="reader-empty reader-empty--panel">
          <h3 className="reader-empty__title text-lg">We couldn&rsquo;t open that profile</h3>
          <p className="reader-empty__body">
            {error || 'That reader may have left, or the link may be out of date.'}
          </p>
          <div className="reader-empty__actions">
            <button type="button" onClick={onRetry} className="btn-outline !py-3 px-7 text-2xs uppercase tracking-widest font-bold">
              Try again
            </button>
            <button type="button" onClick={onBack} className="btn-primary !py-3 px-7 text-2xs uppercase tracking-widest font-bold">
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const joined = joinedLabel(profile.memberSince);
  const genres = profile.genres
    ? profile.genres.split(/[,;|]/).map(g => g.trim()).filter(Boolean)
    : [];

  return (
    <div className="rp-page">
      <button type="button" className="rp-back" onClick={onBack}>
        &larr; Back
      </button>

      <header className="rp-card rp-head">
        <span className="rp-avatar" aria-hidden="true">
          {(profile.fullName || profile.name || 'R').charAt(0).toUpperCase()}
        </span>
        <div className="rp-head__ident">
          <h1 className="rp-name">{profile.fullName || profile.name}</h1>
          <p className="rp-meta">
            {profile.isActiveMember && <span className="rp-tag rp-tag--member">Reader</span>}
            {/* Area is the locality a reader typed for themselves. The
                pincode and coordinates beside it in the sheet are on the
                backend's forbidden list and never reach this page. */}
            {profile.area && <span>{profile.area}</span>}
            {joined && <span>Reading here since {joined}</span>}
          </p>
          {profile.bio && <p className="rp-bio">{profile.bio}</p>}
          {genres.length > 0 && (
            <p className="rp-genres">
              {genres.map(g => <span key={g} className="rp-tag">{g}</span>)}
            </p>
          )}
        </div>
      </header>

      {/* The shelf comes first: it is what a shared /reader/<id> link is
          for (owner's request, 23 Sep — "Share my shelf"). */}
      <section className="rp-card rp-bookshelf" aria-label={`${profile.fullName || profile.name}'s bookshelf`}>
        <div className="rp-bookshelf__head">
          <h2 className="rp-h2">
            Bookshelf <span className="rp-shelf__count">{profile.books.length}</span>
          </h2>
          {onShareShelf && profile.books.length > 0 && (
            <button type="button" onClick={onShareShelf} className="rp-share">
              {profile.isSelf ? 'Share my shelf' : 'Share this shelf'}
            </button>
          )}
        </div>
        {profile.books.length === 0 ? (
          <p className="rp-shelf__empty">Nothing on the shelf right now.</p>
        ) : renderShelf ? (
          renderShelf(profile.books)
        ) : (
          <ul className="rp-shelf__list">
            {profile.books.slice(0, 12).map((b: any) => (
              <li key={b.id || b.bookId || b.title} className="rp-book">
                <span className="rp-book__title">{b.title || 'Untitled'}</span>
                {b.author && <span className="rp-book__author">{b.author}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rp-stats" aria-label="At a glance">
        <div className="rp-stat">
          <span className="rp-stat__n">{profile.booksListedCount}</span>
          <span className="rp-stat__l">In the Library</span>
        </div>
        <div className="rp-stat">
          <span className="rp-stat__n">{profile.shelfCount}</span>
          <span className="rp-stat__l">On their shelves</span>
        </div>
        <div className="rp-stat">
          <span className="rp-stat__n">{Number(streak.longestStreak || 0)}</span>
          <span className="rp-stat__l">Longest streak</span>
        </div>
        <div className="rp-stat">
          <span className="rp-stat__n">{Number(streak.totalActiveDays || 0)}</span>
          <span className="rp-stat__l">Days here</span>
        </div>
        {typeof profile.responseStats?.responseRate === 'number' && (
          <div className="rp-stat">
            <span className="rp-stat__n">{profile.responseStats.responseRate}%</span>
            <span className="rp-stat__l">
              {typeof profile.responseStats.medianHours === 'number'
                ? `Answers requests · usually in ${formatResponseTime(profile.responseStats.medianHours)}`
                : 'Answers requests'}
            </span>
          </div>
        )}
        <div className="rp-stat">
          <span className="rp-stat__n">{profile.completedSwapsCount ?? 0}</span>
          <span className="rp-stat__l">Completed swaps</span>
        </div>
        {!!profile.ratingCount && (
          <div className="rp-stat">
            <span className="rp-stat__n">★ {(profile.avgRating ?? 0).toFixed(1)}</span>
            <span className="rp-stat__l">{profile.ratingCount} rating{profile.ratingCount === 1 ? '' : 's'} from other readers</span>
          </div>
        )}
      </section>

      {!!profile.awardedBadges?.length && (
        <section className="rp-card">
          <h2 className="rp-h2">Recognised by the community</h2>
          <AwardedBadges badges={profile.awardedBadges} align="start" />
        </section>
      )}

      {!!profile.trustBadges?.length && (
        <section className="rp-card">
          <h2 className="rp-h2">Trust</h2>
          <ul className="rp-badges">
            {profile.trustBadges.map(b => (
              <li key={b} className="rp-badge">
                <span className="rp-badge__name">{b}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {earned.length > 0 && (
        <section className="rp-card">
          <h2 className="rp-h2">Achievements</h2>
          <ul className="rp-badges">
            {earned.map(key => (
              <li key={key} className="rp-badge">
                <span className="rp-badge__name">{BADGE_LABELS[key].name}</span>
                <span className="rp-badge__note">{BADGE_LABELS[key].note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rp-card">
        <h2 className="rp-h2">Their shelves</h2>
        <Shelf
          title="Reading now"
          items={profile.shelves.currentlyReading}
          emptyNote="Nothing open at the moment."
        />
        <Shelf
          title="To be read"
          items={profile.shelves.tbr}
          emptyNote="No queue yet."
        />
        <Shelf
          title="Bookshelf"
          items={profile.shelves.bookshelf}
          emptyNote="Their shelf is still filling up."
        />
        <Shelf
          title="Favourites"
          items={profile.shelves.favourites}
          emptyNote="No favourites marked yet."
        />
      </section>

      {profile.journey.activities.length > 0 && (
        <section className="rp-card">
          <h2 className="rp-h2">Reading journey</h2>
          <ol className="rp-journey">
            {profile.journey.activities.slice().reverse().slice(0, 20).map((a, i) => (
              <li key={`${a.at}-${i}`} className="rp-journey__item">
                <span className="rp-journey__what">{a.title || activityLabel(a.type)}</span>
                <span className="rp-journey__when">
                  {a.at ? new Date(a.at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="rp-foot">
        Profiles show what a reader keeps and reads. Contact details are never
        shown — to reach someone, send a swap request on one of their books.
      </p>
    </div>
  );
};

export default ReaderProfile;
