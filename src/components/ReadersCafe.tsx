/**
 * ReadersCafe — SwapSutra's permanent community table.
 *
 * Structurally this is the Current Read Circle chat with one difference:
 * nobody joins it. It reads and writes the SAME `current_read_messages`
 * sheet under a reserved circle id, reuses the same message shape, the
 * same spoiler mechanic and the same polling approach — so there is no
 * second chat system to maintain and Current Read Circles are untouched.
 *
 * The two behaviours that make it a café rather than a circle:
 *   • A visitor can read the whole room without an account. Listening at
 *     the door is how someone decides SwapSutra has people in it.
 *   • A member can speak immediately. There is no join step, because
 *     everyone already has a seat.
 *
 * Layout note. This room was originally a page section with a capped
 * scroll area, which meant the composer sat below the fold on a phone and
 * could not be reached at all. It is now a proper chat screen: a fixed
 * header, a flexible scroll region, and a composer pinned to the bottom
 * of the viewport above the mobile nav. The ergonomics are borrowed from
 * the messaging apps every reader already knows — bubbles, day dividers,
 * an emoji key, a round send button — while the paper, the lamp and the
 * palette stay SwapSutra's.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CafeEmojiPicker from './CafeEmojiPicker';
import {
  CafeStoryRail,
  CafeStoryViewer,
  CafeStoryComposer,
  type CafeStoryGroup,
  type CafeStoryViewerRecord
} from './CafeStories';

export const READERS_CAFE_CIRCLE_ID = 'SS_READERS_CAFE';

export interface CafeReaction {
  emoji: string;
  count: number;
  /** Whether THIS reader is one of them — the server decides, not the UI. */
  mine: boolean;
}

export interface CafeMessage {
  id: string;
  firstName: string;
  message: string;
  isSpoiler: boolean;
  createdAt: string;
  imageUrl?: string;
  /** Computed by the server against the verified session. */
  isMine: boolean;
  reactions: CafeReaction[];
  /** Opaque public id of the sender — never their address. */
  authorId: string;
}

export interface CafeSnapshot {
  messages: CafeMessage[];
  readerCount: number;
  totalMessages: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageBy: string;
  /** House note, set by the owner in Script Properties. '' = no bar. */
  pinnedMessage: string;
  /** The emoji the backend will actually accept. */
  reactionChoices: string[];
}

export const EMPTY_CAFE: CafeSnapshot = {
  messages: [],
  readerCount: 0,
  totalMessages: 0,
  lastMessageAt: '',
  lastMessagePreview: '',
  lastMessageBy: '',
  pinnedMessage: '',
  reactionChoices: []
};

/**
 * Normalises the backend payload into the shape this room renders.
 *
 * `user_name` is already reduced to a public display name server-side —
 * an email never reaches this function any more. The defensive strip
 * below stays because a stale Apps Script deployment would otherwise put
 * an address on screen, and that is not a failure worth risking.
 */
export function toCafeSnapshot(payload: any): CafeSnapshot {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return {
    messages: rows.map((m: any) => ({
      id: String(m.message_id || m.id || ''),
      firstName: publicName(m.user_name),
      message: String(m.message || ''),
      isSpoiler: m.is_spoiler === true || String(m.is_spoiler).toLowerCase() === 'true',
      createdAt: String(m.created_at || ''),
      imageUrl: String(m.image_url || m.imageUrl || ''),
      isMine: m.is_mine === true || m.isMine === true,
      authorId: String(m.author_id || m.authorId || ''),
      reactions: Array.isArray(m.reactions)
        ? m.reactions
            .map((r: any) => ({
              emoji: String(r?.emoji || ''),
              count: Number(r?.count || 0),
              mine: r?.mine === true
            }))
            .filter((r: CafeReaction) => r.emoji && r.count > 0)
        : []
    })),
    readerCount: Number(payload?.readerCount || 0),
    totalMessages: Number(payload?.totalMessages || 0),
    lastMessageAt: String(payload?.lastMessageAt || ''),
    lastMessagePreview: String(payload?.lastMessagePreview || ''),
    lastMessageBy: publicName(payload?.lastMessageBy),
    pinnedMessage: String(payload?.pinnedMessage || ''),
    reactionChoices: Array.isArray(payload?.reactionChoices)
      ? payload.reactionChoices.map((e: any) => String(e))
      : []
  };
}

/**
 * Last line of defence against an address reaching the screen. A stored
 * value with an "@" in it is an email, and an email is not a name: reduce
 * it to its human part rather than publishing it.
 */
export function publicName(value: any): string {
  const raw = String(value || '').trim();
  if (!raw) return 'Reader';
  if (raw.includes('@')) {
    const local = raw.split('@')[0].replace(/[._+\-]+/g, ' ').replace(/[0-9]+/g, ' ').trim();
    const first = local.split(/\s+/)[0];
    return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : 'Reader';
  }
  return raw.split(/\s+/)[0] || 'Reader';
}

/** "just now" / "18:42" / "12 Aug" — quiet, never a countdown. */
export function cafeTime(value: string): string {
  if (!value) return '';
  const then = new Date(value);
  if (isNaN(then.getTime())) return '';
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const sameDay = then.toDateString() === new Date().toDateString();
  if (sameDay) return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return then.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** The clock stamp inside a bubble — always a time, never "3m ago". */
function bubbleClock(value: string): string {
  const then = new Date(value);
  if (isNaN(then.getTime())) return '';
  return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ── Composer icons ──────────────────────────────────────────────────
   Drawn rather than typed. An emoji glyph is a font, and a font can be
   missing: on a device without a colour emoji face the whole control row
   renders as empty boxes, which is exactly what happened when this was
   first built. Inline SVG always draws, inherits currentColor, and
   follows day/night with the rest of the room.
   ──────────────────────────────────────────────────────────────────── */
const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false
};

const SmileIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    <path d="M9 9.5h.01M15 9.5h.01" />
  </svg>
);

const CameraIcon = () => (
  <svg {...iconProps}>
    <path d="M4 8.5h2.6l1.3-2h8.2l1.3 2H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.2" />
  </svg>
);

const SpoilerIcon = () => (
  <svg {...iconProps}>
    <path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6Z" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M4 20 20 4" />
  </svg>
);

const SendIcon = () => (
  <svg {...iconProps} strokeWidth={1.9}>
    <path d="M4.5 12 20 4.5 15.5 20l-3.6-5.6L4.5 12Z" />
  </svg>
);

const PinIcon = () => (
  <svg {...iconProps} width={15} height={15}>
    <path d="M9 4h6l-1 5 3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3-1-5Z" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg {...iconProps} width={16} height={16} style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const MoreIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="5" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="12" cy="19" r="1.4" />
  </svg>
);

const BackIcon = () => (
  <svg {...iconProps}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);

const AddReactionIcon = () => (
  <svg {...iconProps} width={15} height={15}>
    <path d="M20.9 12.9A9 9 0 1 1 11.1 3.1" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    <path d="M9 9.5h.01M15 9.5h.01" />
    <path d="M18 3v5M15.5 5.5h5" />
  </svg>
);

/* ── Who is speaking ─────────────────────────────────────────────────
   Every reader gets a colour and it is always the same colour, because
   it is derived from their name rather than from their position in the
   list. Six hues, all pulled far enough apart to be told apart, and all
   dark enough to read as text on the room's paper.

   The palette is fixed rather than token-derived on purpose: these are
   identity marks, not theme accents, and a reader being "the green one"
   should not change when the room does. Each hue is checked against both
   the day and night bubble backgrounds.
   ──────────────────────────────────────────────────────────────────── */
const SPEAKER_COLOURS = [
  { name: '#8E4A59', seat: '#F0DFE3' }, // mauve — the house colour
  { name: '#2F6B4F', seat: '#DCEBE1' }, // moss
  { name: '#5A4B9C', seat: '#E3DFF3' }, // iris
  { name: '#9A5A2B', seat: '#F3E3D3' }, // amber
  { name: '#1F6572', seat: '#D8EAEE' }, // teal
  { name: '#8A3D5F', seat: '#F2DEE7' }  // plum
];

/** Stable hash so a name always lands on the same hue. */
export function speakerColour(name: string) {
  const raw = String(name || 'Reader');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return SPEAKER_COLOURS[hash % SPEAKER_COLOURS.length];
}

/**
 * Renders @Name mentions as their own mark, so being spoken to is
 * visible at a glance in a busy room. Everything else stays plain text —
 * no markdown, no HTML, nothing a message can inject.
 */
export function renderMessageText(text: string): React.ReactNode[] {
  const parts = String(text || '').split(/(@[A-Za-z][A-Za-z0-9_'-]{0,30})/g);
  return parts.map((part, i) =>
    part.startsWith('@') && part.length > 1
      ? <span key={i} className="cafe-bubble__mention">{part}</span>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

/** "Today" / "Yesterday" / "12 August" — the divider between days. */
export function cafeDayLabel(value: string): string {
  const then = new Date(value);
  if (isNaN(then.getTime())) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (then.toDateString() === today.toDateString()) return 'Today';
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return then.toLocaleDateString([], { day: 'numeric', month: 'long' });
}

const ReadersCafe = ({
  snapshot,
  loading,
  error,
  canSpeak,
  isSignedIn,
  inviteReason = 'guest',
  onSend,
  onRetry,
  onRequestJoin,
  sending = false,
  storyGroups = [],
  storiesLoading = false,
  storyPosting = false,
  onPostStory,
  onStorySeen,
  onFetchStoryViewers,
  onDeleteStory,
  onOpenCircles,
  onToggleReaction,
  onBack,
  onOpenReader
}: {
  snapshot: CafeSnapshot;
  loading: boolean;
  error?: string | null;
  /** Signed in AND an active member — may post. */
  canSpeak: boolean;
  isSignedIn: boolean;
  /** Why this reader cannot speak yet, so the invitation tells the truth. */
  inviteReason?: 'guest' | 'pending' | 'expired';
  onSend: (message: string, isSpoiler: boolean) => Promise<boolean>;
  onRetry: () => void;
  onRequestJoin: () => void;
  sending?: boolean;
  storyGroups?: CafeStoryGroup[];
  storiesLoading?: boolean;
  storyPosting?: boolean;
  onPostStory?: (file: File, caption: string) => Promise<boolean>;
  onStorySeen?: (storyId: string) => void;
  onFetchStoryViewers?: (storyId: string) => Promise<CafeStoryViewerRecord[]>;
  onDeleteStory?: (storyId: string) => Promise<boolean>;
  onOpenCircles?: () => void;
  /** Absent = reactions are unavailable, so no chips render at all. */
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onBack?: () => void;
  /** Absent = names stay plain text rather than becoming dead links. */
  onOpenReader?: (readerId: string) => void;
}) => {
  const [draft, setDraft] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [viewerGroup, setViewerGroup] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  /** Which bubble's reaction picker is open, if any. */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  const messages = snapshot.messages;
  const lastId = messages.length ? messages[messages.length - 1].id : '';

  // Follow the conversation only while the reader is already at the
  // bottom — yanking someone away from a message they are reading is
  // the rudest thing a chat can do.
  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lastId]);

  // A fresh arrival should land at the newest message, not at the top of
  // an hours-old backlog.
  useEffect(() => {
    if (loading) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  /** Grows the input with the message, up to a ceiling. */
  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // An EMPTY box is always one line. Measuring scrollHeight with nothing
    // typed measures the PLACEHOLDER, and on a narrow phone the
    // placeholder wraps onto a second line — which is why the composer
    // opened at double height before a single character was entered.
    // Leaving the inline height off lets the CSS min-height decide.
    if (!el.value) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => { resizeInput(); }, [draft, resizeInput]);

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    const ok = await onSend(text, spoiler);
    if (ok) {
      setDraft('');
      setSpoiler(false);
      setEmojiOpen(false);
      stickToBottom.current = true;
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) { setDraft(prev => prev + emoji); return; }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    // Put the caret back after the emoji so typing continues naturally.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const life = useMemo(() => {
    const bits: string[] = [];
    if (snapshot.readerCount > 0) {
      bits.push(`${snapshot.readerCount} ${snapshot.readerCount === 1 ? 'reader' : 'readers'} at the table`);
    }
    if (snapshot.lastMessageAt) {
      const when = cafeTime(snapshot.lastMessageAt);
      if (when) bits.push(`last said ${when}`);
    }
    return bits.length ? bits.join(' · ') : 'Come in. There’s always a book being discussed.';
  }, [snapshot.readerCount, snapshot.lastMessageAt]);

  /**
   * Messages, with a day divider before the first of each date and a
   * "grouped" flag for consecutive messages from the same reader — the
   * two things that stop a wall of bubbles reading as noise.
   */
  const rendered = useMemo(() => {
    let previousDay = '';
    let previousWho = '';
    return messages.map(m => {
      const day = cafeDayLabel(m.createdAt);
      const dayBreak = day !== previousDay;
      const who = `${m.firstName}|${m.isMine ? 'me' : 'them'}`;
      const grouped = !dayBreak && who === previousWho;
      previousDay = day;
      previousWho = who;
      return { message: m, day, dayBreak, grouped };
    });
  }, [messages]);

  const storiesEnabled = Boolean(onPostStory && onStorySeen && onFetchStoryViewers && onDeleteStory);

  return (
    <section className="cafe-room" aria-labelledby="cafe-heading">
      {/* ── The bar ──
             Brand mark, name, and a line of REAL life. Deliberately no
             call or video buttons: this is a room you read in.

             The subtitle says how many readers have actually spoken and
             when the last one did. It does NOT say "12 online" — nothing
             in this stack tracks presence, so that number could only be
             invented. */}
      <header className="cafe-room__bar">
        {onBack && (
          <button type="button" className="cafe-room__back" onClick={onBack} aria-label="Go back">
            <BackIcon />
          </button>
        )}
        <span className="cafe-room__mark" aria-hidden="true">
          <img src="/swapsutra-logo.png" alt="" loading="lazy" />
        </span>
        <div className="cafe-room__ident">
          <h2 id="cafe-heading" className="cafe-room__title">
            Reader&rsquo;s Café <span aria-hidden="true">☕</span>
          </h2>
          <p className="cafe-room__life">{life}</p>
        </div>

        <div className="cafe-room__tools">
          <button
            type="button"
            className="cafe-room__tool"
            aria-label="Room options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
          >
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className="cafe-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRetry(); }}>
                Refresh the room
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  const el = logRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                  stickToBottom.current = true;
                }}
              >
                Jump to latest
              </button>
              {onOpenCircles && (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenCircles(); }}>
                  Open a Readers Circle
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* The house note. Rendered only when the owner has actually
          written one — an empty pinned bar with placeholder text would be
          a rule nobody made. */}
      {snapshot.pinnedMessage && (
        <div className={`cafe-pinned${pinnedOpen ? ' is-open' : ''}`}>
          <span className="cafe-pinned__icon" aria-hidden="true"><PinIcon /></span>
          <div className="cafe-pinned__body">
            <p className="cafe-pinned__label">Pinned Message</p>
            <p className="cafe-pinned__text">{snapshot.pinnedMessage}</p>
          </div>
          <button
            type="button"
            className="cafe-pinned__toggle"
            onClick={() => setPinnedOpen(open => !open)}
            aria-expanded={pinnedOpen}
            aria-label={pinnedOpen ? 'Collapse the pinned message' : 'Read the whole pinned message'}
          >
            <ChevronIcon open={pinnedOpen} />
          </button>
        </div>
      )}

      {/* A visitor who cannot post and has nothing to watch gets no rail
          at all, rather than an empty band saying so. */}
      {storiesEnabled && (canSpeak || storiesLoading || storyGroups.length > 0) && (
        <CafeStoryRail
          groups={storyGroups}
          canPost={canSpeak}
          loading={storiesLoading}
          onOpen={(index) => setViewerGroup(index)}
          onCompose={() => setComposerOpen(true)}
        />
      )}

      <div
        ref={logRef}
        onScroll={onScroll}
        className="cafe-room__log"
        role="log"
        aria-live="polite"
        aria-label="Reader's Café conversation"
        aria-busy={loading || undefined}
        tabIndex={0}
      >
        {loading && messages.length === 0 ? (
          <>
            <span className="sr-only">Listening in on the café…</span>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`cafe-line${i % 3 === 2 ? ' cafe-line--mine' : ''}`} aria-hidden="true">
                <div className="sk cafe-bubble cafe-bubble--ghost" style={{ width: i % 2 ? '58%' : '72%' }} />
              </div>
            ))}
          </>
        ) : error ? (
          <div className="reader-empty reader-empty--panel">
            <h3 className="reader-empty__title text-lg">The café is quiet for a moment</h3>
            <p className="reader-empty__body">We couldn&rsquo;t reach the room just now. It&rsquo;s usually a passing thing.</p>
            <div className="reader-empty__actions">
              <button type="button" onClick={onRetry} className="btn-outline !py-3 px-7 text-2xs uppercase tracking-widest font-bold">
                Try the door again
              </button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="reader-empty reader-empty--panel">
            <h3 className="reader-empty__title text-lg">The first chair is yours</h3>
            <p className="reader-empty__body">
              Nobody has spoken here yet. Tell the room what you&rsquo;re reading — that&rsquo;s usually how it starts.
            </p>
          </div>
        ) : (
          rendered.map(({ message: m, day, dayBreak, grouped }) => {
            const isOpen = !m.isSpoiler || revealed.includes(m.id);
            const hue = speakerColour(m.firstName);
            const canReact = Boolean(onToggleReaction) && canSpeak;
            const choices = snapshot.reactionChoices;
            return (
              <React.Fragment key={m.id}>
                {dayBreak && day && (
                  <div className="cafe-day"><span>{day}</span></div>
                )}
                <div className={`cafe-line${m.isMine ? ' cafe-line--mine' : ''}${grouped ? ' cafe-line--grouped' : ''}`}>
                  {!m.isMine && !grouped && (
                    onOpenReader && m.authorId ? (
                      <button
                        type="button"
                        className="cafe-line__seat cafe-line__seat--link"
                        style={{ background: hue.seat, color: hue.name }}
                        onClick={() => onOpenReader(m.authorId)}
                        aria-label={`Open ${m.firstName}'s profile`}
                      >
                        {m.firstName.charAt(0).toUpperCase()}
                      </button>
                    ) : (
                      <span
                        className="cafe-line__seat"
                        aria-hidden="true"
                        style={{ background: hue.seat, color: hue.name }}
                      >
                        {m.firstName.charAt(0).toUpperCase()}
                      </span>
                    )
                  )}

                  <div className="cafe-line__stack">
                    <article className={`cafe-bubble${m.isMine ? ' cafe-bubble--mine' : ''}`}>
                      {!m.isMine && !grouped && (
                        <p className="cafe-bubble__head">
                          {onOpenReader && m.authorId ? (
                            <button
                              type="button"
                              className="cafe-bubble__who cafe-bubble__who--link"
                              style={{ color: hue.name }}
                              onClick={() => onOpenReader(m.authorId)}
                              aria-label={`Open ${m.firstName}'s profile`}
                            >
                              {m.firstName}
                            </button>
                          ) : (
                            <span className="cafe-bubble__who" style={{ color: hue.name }}>{m.firstName}</span>
                          )}
                          {m.isSpoiler && (
                            <span className="cafe-bubble__flag">
                              <SpoilerIcon /> Spoiler
                            </span>
                          )}
                        </p>
                      )}
                      {isOpen ? (
                        <p className="cafe-bubble__text">{renderMessageText(m.message)}</p>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setRevealed(prev => [...prev, m.id])}
                            className="cafe-bubble__text cafe-bubble__spoiler"
                            aria-label={`Reveal a message from ${m.firstName} marked as a spoiler`}
                          >
                            {m.message}
                          </button>
                          <span className="cafe-bubble__spoilerHint">Tap to reveal</span>
                        </>
                      )}
                      <time className="cafe-bubble__when" dateTime={m.createdAt}>{bubbleClock(m.createdAt)}</time>
                    </article>

                    {(m.reactions.length > 0 || canReact) && (
                      <div className="cafe-reacts">
                        {m.reactions.map(r => (
                          <button
                            key={r.emoji}
                            type="button"
                            className={`cafe-react${r.mine ? ' is-mine' : ''}`}
                            disabled={!canReact}
                            onClick={() => onToggleReaction && onToggleReaction(m.id, r.emoji)}
                            aria-pressed={r.mine}
                            aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
                          >
                            <span aria-hidden="true">{r.emoji}</span>
                            <span className="cafe-react__n">{r.count}</span>
                          </button>
                        ))}

                        {canReact && choices.length > 0 && (
                          <button
                            type="button"
                            className="cafe-react cafe-react--add"
                            onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                            aria-expanded={pickerFor === m.id}
                            aria-label={`React to ${m.firstName}'s message`}
                          >
                            <AddReactionIcon />
                          </button>
                        )}

                        {pickerFor === m.id && (
                          <div className="cafe-react-pick" role="menu">
                            {choices.map(e => (
                              <button
                                key={e}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setPickerFor(null);
                                  if (onToggleReaction) onToggleReaction(m.id, e);
                                }}
                                aria-label={`React with ${e}`}
                              >
                                <span aria-hidden="true">{e}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>

      <div className="cafe-room__counter">
        {canSpeak ? (
          /* No join step: a member already has a seat, so the composer is
             simply here. */
          <>
            {emojiOpen && (
              <CafeEmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
            )}

            {spoiler && (
              <p className="cafe-compose__flag">
                This will be hidden until someone taps it.
                <button type="button" onClick={() => setSpoiler(false)}>Undo</button>
              </p>
            )}

            {/* The controls live INSIDE the pill, as they do in the app
                every reader already has on their phone. The send button
                is the only thing outside it. */}
            <form onSubmit={submit} className="cafe-compose">
              <div className="cafe-compose__pill">
                <button
                  type="button"
                  className="cafe-compose__key"
                  aria-label={emojiOpen ? 'Close the emoji picker' : 'Open the emoji picker'}
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen(open => !open)}
                >
                  <SmileIcon />
                </button>

                <label htmlFor="cafe-draft" className="sr-only">Say something to the café</label>
                <textarea
                  ref={inputRef}
                  id="cafe-draft"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() => { stickToBottom.current = true; }}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter starts a new line. This is what
                    // a reader's thumbs already expect from every other chat.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={1}
                  maxLength={1200}
                  className="cafe-compose__input"
                  /* Short on purpose: with the emoji, spoiler and camera
                     keys sharing the pill, a longer placeholder was the
                     thing that wrapped the box onto a second line on a
                     narrow phone — and it truncated anyway once a reader
                     turned their system text size up. */
                  placeholder="Message…"
                />

                <button
                  type="button"
                  className={`cafe-compose__key cafe-compose__key--flag${spoiler ? ' is-on' : ''}`}
                  aria-pressed={spoiler}
                  aria-label="Mark this message as a spoiler"
                  title="Mark as a spoiler"
                  onClick={() => setSpoiler(s => !s)}
                >
                  <SpoilerIcon />
                </button>

                {storiesEnabled && (
                  <button
                    type="button"
                    className="cafe-compose__key"
                    aria-label="Post a story to the café wall"
                    onClick={() => setComposerOpen(true)}
                  >
                    <CameraIcon />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={!draft.trim() || sending}
                className="cafe-compose__send"
                aria-label={sending ? 'Sending your message' : 'Send'}
              >
                <SendIcon />
              </button>
            </form>
          </>
        ) : (
          /* The invitation. An offer of a chair, not a paywall — the
             reader has already been allowed to read the whole room. */
          <div className="cafe-invite">
            <p className="cafe-invite__line">
              {inviteReason === 'expired'
                ? 'Your chair is still here. Renew your membership to rejoin the conversation.'
                : inviteReason === 'pending'
                  ? 'Almost in. Start your free trial and the table is yours.'
                  : 'Pull up a chair. Become a SwapSutra reader to join the conversation.'}
            </p>
            <button
              type="button"
              onClick={onRequestJoin}
              className="btn-primary px-8 py-3 text-2xs uppercase tracking-widest font-bold"
            >
              {inviteReason === 'expired'
                ? 'Renew to rejoin'
                : inviteReason === 'pending'
                  ? 'Start your free trial'
                  : 'Register to join'}
            </button>
          </div>
        )}
      </div>

      {storiesEnabled && viewerGroup !== null && storyGroups[viewerGroup] && (
        <CafeStoryViewer
          groups={storyGroups}
          startGroup={viewerGroup}
          onClose={() => setViewerGroup(null)}
          onSeen={onStorySeen!}
          onFetchViewers={onFetchStoryViewers!}
          onDelete={onDeleteStory!}
        />
      )}

      {storiesEnabled && composerOpen && (
        <CafeStoryComposer
          posting={storyPosting}
          onPost={onPostStory!}
          onClose={() => setComposerOpen(false)}
        />
      )}
    </section>
  );
};

export default ReadersCafe;
