/**
 * Reader's Café — Stories.
 *
 * A photo or short clip pinned to the café wall for 24 hours: the shelf
 * someone just reorganised, the page that undid them, the queue at a book
 * fair. Three pieces live here:
 *
 *   • CafeStoryRail    the row of rings above the conversation
 *   • CafeStoryViewer  the full-screen player, with tap-to-advance
 *   • CafeStoryComposer the pick-or-capture sheet
 *
 * Privacy shape (enforced server-side, mirrored here so the UI never
 * implies more than it can deliver):
 *   – Anyone may watch. Only a member may post.
 *   – `viewCount` arrives as null for stories that are not yours, so the
 *     count simply is not rendered for them.
 *   – The audience list is fetched on demand and only for your own story.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CafeStory {
  storyId: string;
  authorName: string;
  isMine: boolean;
  mediaType: 'image' | 'video' | string;
  mediaUrl: string;
  caption: string;
  createdAt: string;
  expiresAt: string;
  viewedByMe: boolean;
  /** null unless the story is yours — the server withholds it. */
  viewCount: number | null;
}

export interface CafeStoryGroup {
  authorName: string;
  isMine: boolean;
  stories: CafeStory[];
  latestAt: string;
  allViewed: boolean;
}

export interface CafeStoryViewerRecord {
  name: string;
  viewedAt: string;
}

/** Drive hands back a "view" page URL; these are what actually render. */
export function driveFileId(url: string): string {
  const value = String(url || '').trim();
  if (!value) return '';
  const patterns = [/\/file\/d\/([^/?]+)/, /[?&]id=([^&]+)/, /\/d\/([^/?]+)/];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match && match[1]) return match[1];
  }
  return '';
}

export function storyImageSrc(url: string): string {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1200` : String(url || '');
}

export function storyVideoSrc(url: string): string {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : String(url || '');
}

/** "3h left" — a story's whole point is that it is running out. */
export function storyTimeLeft(expiresAt: string): string {
  const end = new Date(expiresAt).getTime();
  if (isNaN(end)) return '';
  const minutes = Math.floor((end - Date.now()) / 60000);
  if (minutes <= 0) return 'gone';
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.floor(minutes / 60)}h left`;
}

export function normalizeStory(raw: any): CafeStory {
  return {
    storyId: String(raw?.storyId || raw?.story_id || ''),
    authorName: String(raw?.authorName || raw?.user_name || 'Reader'),
    isMine: raw?.isMine === true,
    mediaType: String(raw?.mediaType || raw?.media_type || 'image'),
    mediaUrl: String(raw?.mediaUrl || raw?.media_url || ''),
    caption: String(raw?.caption || ''),
    createdAt: String(raw?.createdAt || raw?.created_at || ''),
    expiresAt: String(raw?.expiresAt || raw?.expires_at || ''),
    viewedByMe: raw?.viewedByMe === true,
    viewCount:
      raw?.viewCount === null || raw?.viewCount === undefined
        ? null
        : Number(raw.viewCount)
  };
}

export function normalizeStoryGroups(payload: any): CafeStoryGroup[] {
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  if (groups.length) {
    return groups.map((g: any) => ({
      authorName: String(g?.authorName || 'Reader'),
      isMine: g?.isMine === true,
      stories: (Array.isArray(g?.stories) ? g.stories : []).map(normalizeStory),
      latestAt: String(g?.latestAt || ''),
      allViewed: g?.allViewed === true
    })).filter((g: CafeStoryGroup) => g.stories.length > 0);
  }

  // Fall back to grouping a flat list ourselves, so an older backend
  // deployment still renders something coherent instead of nothing.
  const flat = (Array.isArray(payload?.stories) ? payload.stories : []).map(normalizeStory);
  const byAuthor = new Map<string, CafeStoryGroup>();
  flat.forEach((story: CafeStory) => {
    const key = `${story.authorName}|${story.isMine ? 'me' : 'them'}`;
    if (!byAuthor.has(key)) {
      byAuthor.set(key, {
        authorName: story.authorName,
        isMine: story.isMine,
        stories: [],
        latestAt: story.createdAt,
        allViewed: true
      });
    }
    const group = byAuthor.get(key)!;
    group.stories.push(story);
    if (story.createdAt > group.latestAt) group.latestAt = story.createdAt;
    if (!story.viewedByMe && !story.isMine) group.allViewed = false;
  });
  return Array.from(byAuthor.values());
}

/* Drawn, not typed: an emoji is a font, and a device missing a colour
   emoji face would render these two choices as empty boxes. */
const bigIcon = {
  width: 26,
  height: 26,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false
};

const BigCameraIcon = () => (
  <svg {...bigIcon}>
    <path d="M4 8.5h2.6l1.3-2h8.2l1.3 2H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.2" />
  </svg>
);

const GalleryIcon = () => (
  <svg {...bigIcon}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.4" />
    <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
  </svg>
);

/* ─────────────────────────── The rail ─────────────────────────── */

export const CafeStoryRail = ({
  groups,
  canPost,
  loading,
  onOpen,
  onCompose
}: {
  groups: CafeStoryGroup[];
  canPost: boolean;
  loading: boolean;
  onOpen: (groupIndex: number) => void;
  onCompose: () => void;
}) => {
  const mine = groups.find(g => g.isMine);

  return (
    <div className="cafe-rail" aria-label="Stories from the café">
      <ul className="cafe-rail__track">
        {canPost && (
          <li className="cafe-rail__item">
            <button
              type="button"
              className="cafe-rail__ring cafe-rail__ring--add"
              onClick={() => {
                if (mine) onOpen(groups.indexOf(mine));
                else onCompose();
              }}
              aria-label={mine ? 'View your story' : 'Add a story to the café wall'}
            >
              <span className="cafe-rail__face" aria-hidden="true">
                {mine ? (
                  <img src={storyImageSrc(mine.stories[0].mediaUrl)} alt="" loading="lazy" />
                ) : (
                  '☕'
                )}
              </span>
              <span className="cafe-rail__plus" aria-hidden="true">+</span>
            </button>
            <span className="cafe-rail__name">Your story</span>
          </li>
        )}

        {groups.filter(g => !g.isMine).map((group) => {
          const index = groups.indexOf(group);
          const cover = group.stories[0];
          return (
            <li className="cafe-rail__item" key={`${group.authorName}-${group.latestAt}`}>
              <button
                type="button"
                className={`cafe-rail__ring${group.allViewed ? ' is-seen' : ''}`}
                onClick={() => onOpen(index)}
                aria-label={`Watch ${group.stories.length} ${group.stories.length === 1 ? 'story' : 'stories'} from ${group.authorName}`}
              >
                <span className="cafe-rail__face" aria-hidden="true">
                  {cover.mediaType === 'video' ? (
                    <span className="cafe-rail__clip">▶</span>
                  ) : (
                    <img src={storyImageSrc(cover.mediaUrl)} alt="" loading="lazy" />
                  )}
                </span>
              </button>
              <span className="cafe-rail__name">{group.authorName}</span>
            </li>
          );
        })}

        {!loading && groups.length === 0 && !canPost && (
          <li className="cafe-rail__quiet">No stories on the wall right now.</li>
        )}
      </ul>
    </div>
  );
};

/* ────────────────────────── The viewer ────────────────────────── */

const IMAGE_DURATION_MS = 5000;

export const CafeStoryViewer = ({
  groups,
  startGroup,
  onClose,
  onSeen,
  onFetchViewers,
  onDelete
}: {
  groups: CafeStoryGroup[];
  startGroup: number;
  onClose: () => void;
  onSeen: (storyId: string) => void;
  onFetchViewers: (storyId: string) => Promise<CafeStoryViewerRecord[]>;
  onDelete: (storyId: string) => Promise<boolean>;
}) => {
  const [groupIndex, setGroupIndex] = useState(startGroup);
  const [storyIndex, setStoryIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState<CafeStoryViewerRecord[] | null>(null);
  const [viewersLoading, setViewersLoading] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  const group = groups[groupIndex];
  const story = group?.stories[storyIndex];

  const advance = useCallback(() => {
    setViewers(null);
    setProgress(0);
    if (!group) return;
    if (storyIndex + 1 < group.stories.length) {
      setStoryIndex(storyIndex + 1);
      return;
    }
    if (groupIndex + 1 < groups.length) {
      setGroupIndex(groupIndex + 1);
      setStoryIndex(0);
      return;
    }
    onClose();
  }, [group, groupIndex, storyIndex, groups.length, onClose]);

  const rewind = useCallback(() => {
    setViewers(null);
    setProgress(0);
    if (storyIndex > 0) { setStoryIndex(storyIndex - 1); return; }
    if (groupIndex > 0) {
      const previous = groups[groupIndex - 1];
      setGroupIndex(groupIndex - 1);
      setStoryIndex(Math.max(0, previous.stories.length - 1));
    }
  }, [storyIndex, groupIndex, groups]);

  // Record the view exactly once per story per session; the server
  // de-duplicates as well, so a refresh never inflates anyone's count.
  useEffect(() => {
    if (!story || story.isMine) return;
    if (seenRef.current.has(story.storyId)) return;
    seenRef.current.add(story.storyId);
    onSeen(story.storyId);
  }, [story, onSeen]);

  // Images advance themselves. A video is left to its own duration —
  // cutting a reader off mid-sentence would be worse than a long story.
  useEffect(() => {
    if (!story || story.mediaType === 'video' || paused || viewers) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const ratio = Math.min(1, (Date.now() - started) / IMAGE_DURATION_MS);
      setProgress(ratio);
      if (ratio >= 1) { window.clearInterval(timer); advance(); }
    }, 60);
    return () => window.clearInterval(timer);
  }, [story, paused, viewers, advance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') advance();
      if (e.key === 'ArrowLeft') rewind();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, rewind, onClose]);

  const openViewers = async () => {
    if (!story) return;
    setPaused(true);
    setViewersLoading(true);
    try {
      setViewers(await onFetchViewers(story.storyId));
    } finally {
      setViewersLoading(false);
    }
  };

  if (!group || !story) return null;

  return (
    <div className="cafe-story" role="dialog" aria-modal="true" aria-label={`Story from ${group.authorName}`}>
      <div className="cafe-story__bars" aria-hidden="true">
        {group.stories.map((s, i) => (
          <span key={s.storyId} className="cafe-story__bar">
            <span
              className="cafe-story__barFill"
              style={{ width: i < storyIndex ? '100%' : i === storyIndex ? `${Math.round(progress * 100)}%` : '0%' }}
            />
          </span>
        ))}
      </div>

      <header className="cafe-story__head">
        <span className="cafe-story__seat" aria-hidden="true">{group.authorName.charAt(0).toUpperCase()}</span>
        <span className="cafe-story__who">{group.authorName}</span>
        <span className="cafe-story__left">{storyTimeLeft(story.expiresAt)}</span>
        <button type="button" className="cafe-story__close" onClick={onClose} aria-label="Close stories">×</button>
      </header>

      <div className="cafe-story__stage">
        {/* Tap zones sit under the media so a caption stays readable. */}
        <button type="button" className="cafe-story__tap cafe-story__tap--back" onClick={rewind} aria-label="Previous story" />
        <button type="button" className="cafe-story__tap cafe-story__tap--next" onClick={advance} aria-label="Next story" />

        {story.mediaType === 'video' ? (
          <iframe
            className="cafe-story__media"
            src={storyVideoSrc(story.mediaUrl)}
            title={`Story from ${group.authorName}`}
            allow="autoplay"
          />
        ) : (
          <img className="cafe-story__media" src={storyImageSrc(story.mediaUrl)} alt={story.caption || `Story from ${group.authorName}`} />
        )}

        {story.caption && <p className="cafe-story__caption">{story.caption}</p>}
      </div>

      {story.isMine && (
        <footer className="cafe-story__foot">
          <button type="button" className="cafe-story__seen" onClick={openViewers}>
            {`Seen by ${story.viewCount ?? 0}`}
          </button>
          <button
            type="button"
            className="cafe-story__remove"
            onClick={async () => {
              const ok = await onDelete(story.storyId);
              if (ok) onClose();
            }}
          >
            Remove
          </button>
        </footer>
      )}

      {(viewers || viewersLoading) && (
        <div className="cafe-story__sheet" role="region" aria-label="Readers who watched this story">
          <div className="cafe-story__sheetHead">
            <h3>Who watched this</h3>
            <button
              type="button"
              onClick={() => { setViewers(null); setPaused(false); }}
              aria-label="Close the viewer list"
            >×</button>
          </div>
          {viewersLoading ? (
            <p className="cafe-story__sheetQuiet">Counting the room…</p>
          ) : viewers && viewers.length ? (
            <ul className="cafe-story__sheetList">
              {viewers.map((v, i) => (
                <li key={`${v.name}-${i}`}>
                  <span className="cafe-story__seat cafe-story__seat--small" aria-hidden="true">
                    {v.name.charAt(0).toUpperCase()}
                  </span>
                  <span>{v.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cafe-story__sheetQuiet">Nobody has watched this one yet.</p>
          )}
        </div>
      )}
    </div>
  );
};

/* ───────────────────────── The composer ───────────────────────── */

export const CafeStoryComposer = ({
  onPost,
  onClose,
  posting
}: {
  onPost: (file: File, caption: string) => Promise<boolean>;
  onClose: () => void;
  posting: boolean;
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isVideo = useMemo(() => Boolean(file && file.type.startsWith('video/')), [file]);

  const choose = (picked: File | undefined) => { if (picked) setFile(picked); };

  return (
    <div className="cafe-post" role="dialog" aria-modal="true" aria-label="Post a story">
      <div className="cafe-post__panel">
        <header className="cafe-post__head">
          <h3>Pin something to the wall</h3>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>

        {!file ? (
          <div className="cafe-post__pick">
            <p className="cafe-post__hint">
              A photo or a short clip. It stays on the café wall for 24 hours, then clears itself.
            </p>
            <div className="cafe-post__choices">
              <button type="button" className="cafe-post__choice" onClick={() => cameraRef.current?.click()}>
                <BigCameraIcon />
                Take a photo
              </button>
              <button type="button" className="cafe-post__choice" onClick={() => galleryRef.current?.click()}>
                <GalleryIcon />
                From your gallery
              </button>
            </div>
            <p className="cafe-post__limits">
              Photos up to about 2MB after compression. Clips are capped near 3MB — roughly ten seconds — because
              that is the largest a story can travel through our servers intact.
            </p>

            {/* capture= asks the phone for the camera; the plain input is
                the gallery. Both accept video so either route can post a clip. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*,video/*"
              className="sr-only"
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div className="cafe-post__stage">
            {isVideo ? (
              <video className="cafe-post__preview" src={preview} controls playsInline />
            ) : (
              <img className="cafe-post__preview" src={preview} alt="Your story, before posting" />
            )}
            <label htmlFor="cafe-story-caption" className="sr-only">Add a caption</label>
            <input
              id="cafe-story-caption"
              className="input-classic w-full"
              value={caption}
              maxLength={240}
              placeholder="Say something about it (optional)"
              onChange={(e) => setCaption(e.target.value)}
            />
            <div className="cafe-post__actions">
              <button type="button" className="btn-outline px-6 py-3 text-2xs uppercase tracking-widest font-bold" onClick={() => setFile(null)}>
                Pick another
              </button>
              <button
                type="button"
                className="btn-primary px-8 py-3 text-2xs uppercase tracking-widest font-bold disabled:opacity-50"
                disabled={posting}
                onClick={async () => {
                  const ok = await onPost(file, caption.trim());
                  if (ok) onClose();
                }}
              >
                {posting ? 'Posting…' : 'Post story'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
