import React, { useState, useEffect, useMemo } from 'react';
import {
  MessageSquare, BookOpen, Heart, Image as ImageIcon, Bookmark, Eye, Plus, Send, Trash2, Volume2, ShieldAlert, CheckCircle, Star, RefreshCw, UserPlus, X, Share2
} from 'lucide-react';
import { shareLink, siteUrl } from '../utils/share';
import ShareSheet from './ShareSheet';
import { VoiceRecorder } from './VoiceRecorder';
import { NotificationEngine } from '../services/notificationEngine';

export interface ReadingRoomPost {
  id: string;
  authorEmail: string;
  authorName: string;
  postType: 'thought' | 'recommendation' | 'review' | 'quote' | 'poem' | 'voice' | 'recognition';
  /** Recognition posts: who is being recognised (names + public profile ids) and, for admin announcements, the badge. */
  recognizedNames?: string[];
  recognizedReaderIds?: string[];
  badgeLabel?: string;
  content: string;
  bookTitle?: string;
  bookAuthor?: string;
  bookCoverUrl?: string;
  bookGenre?: string;
  bookMood?: string;
  rating?: number;
  recommendFor?: string;
  mediaType?: string;
  mediaUrl?: string;
  audioUrl?: string;
  audioDuration?: number;
  isSpoiler: boolean;
  reactionsCount: number;
  userReaction?: 'like' | 'love' | 'thoughtful' | null;
  commentsCount: number;
  comments: Array<{
    id: string;
    postId: string;
    userEmail: string;
    userName: string;
    comment: string;
    audioUrl?: string;
    createdAt: string;
  }>;
  isSaved?: boolean;
  isAvailableForSwap?: boolean;
  swapOwnersCount?: number;
  createdAt: string;
}

export interface ReadingRoomProps {
  userEmail: string | null;
  userName: string;
  isMember: boolean;
  books: any[];
  onNavigateToTab: (tab: string) => void;
  onRequestSwap: (bookTitle: string) => void;
  apiBaseUrl: string;
  initialSubTab?: string;
  currentReadCircles?: any[];
  onJoinCurrentReadCircle?: (circleId: string) => void;
  onOpenCurrentReadCircle?: (circleId: string) => void;
  /** Opens a reader's public profile by their public id. */
  onOpenReader?: (readerId: string) => void;
  /** Community's own Posts / Shout-outs tabs (30 Sep): hides the duplicate
   *  shout-outs chip and hears when the feed switches in or out of it. */
  onShoutoutsChange?: (on: boolean) => void;
  /** 30 Sep: anyone can read the room; any action by a visitor or an
   *  unregistered reader asks them to sign in / register instead. */
  onRequireAuth?: (why: string) => void;
}

/* Photos in posts ------------------------------------------------------
   A phone photo is 3–8 MB. It is shrunk in the browser to at most 1600px
   on the long side and re-encoded as JPEG (usually 200–500 KB) before it
   is sent, so it fits the upload limit and loads fast for other readers.
   The server stores it in Drive; the feed shows it through Drive's
   thumbnail endpoint, the same way Café stories do. */
const POST_IMAGE_MAX_SIDE = 1600;
const POST_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const shrinkPostImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a photo we can read.'));
      img.onload = () => {
        const scale = Math.min(1, POST_IMAGE_MAX_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(String(reader.result)); return; }
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

export const postImageSrc = (url?: string) => {
  const value = String(url || '');
  const m = value.match(/\/file\/d\/([^/?]+)/) || value.match(/[?&]id=([^&]+)/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200` : value;
};

/* Google Sheets hands back whatever type a cell looks like: a book called
   "1984" arrives as the number 1984, an empty cell as "" or null. Calling
   .trim() or .toLowerCase() on a number throws, and one such book took the
   whole Reading Room down with a blank page. Everything that comes from the
   sheet goes through txt() before any string method touches it. */
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const low = (v: unknown): string => txt(v).trim().toLowerCase();

/** One post, with every field in the type the page expects. */
export const normalizePost = (p: any): ReadingRoomPost => ({
  ...p,
  id: txt(p?.id),
  authorEmail: txt(p?.authorEmail),
  authorName: txt(p?.authorName).trim() || 'Reader',
  postType: (txt(p?.postType).trim() || 'thought') as ReadingRoomPost['postType'],
  content: txt(p?.content),
  bookTitle: txt(p?.bookTitle).trim() || undefined,
  bookAuthor: txt(p?.bookAuthor).trim() || undefined,
  mediaType: txt(p?.mediaType) || undefined,
  mediaUrl: txt(p?.mediaUrl) || undefined,
  audioUrl: txt(p?.audioUrl) || undefined,
  rating: Number(p?.rating) || undefined,
  isSpoiler: p?.isSpoiler === true || ['true', 'yes'].includes(low(p?.isSpoiler)),
  reactionsCount: Number(p?.reactionsCount) || 0,
  commentsCount: Number(p?.commentsCount) || 0,
  comments: (Array.isArray(p?.comments) ? p.comments : []).map((c: any) => ({
    ...c,
    id: txt(c?.id),
    postId: txt(c?.postId),
    userEmail: txt(c?.userEmail),
    userName: txt(c?.userName).trim() || 'Reader',
    comment: txt(c?.comment),
    audioUrl: txt(c?.audioUrl) || undefined,
    createdAt: txt(c?.createdAt),
  })),
  createdAt: txt(p?.createdAt),
  badgeLabel: txt(p?.badgeLabel).trim() || undefined,
  recognizedNames: (Array.isArray(p?.recognizedNames) ? p.recognizedNames : []).map(txt).filter(Boolean),
  recognizedReaderIds: (Array.isArray(p?.recognizedReaderIds) ? p.recognizedReaderIds : []).map(txt).filter(Boolean),
});

/** 10 Oct 2026: a post with nothing to read, see or hear is not shown (blank sheet rows). */
export const postHasContent = (p: ReadingRoomPost): boolean =>
  !!p.id.trim() && !!(p.content.trim() || p.bookTitle || p.mediaUrl || p.audioUrl || (p.recognizedNames && p.recognizedNames.length));

/** What each post type is called on screen. */
export const POST_TYPE_LABEL: Record<string, string> = {
  thought: 'Thought', recommendation: 'Recommendation', review: 'Review',
  quote: 'Quote', poem: 'Poem', voice: 'Voice note', recognition: 'Shout-out',
};

export const ReadingRoom: React.FC<ReadingRoomProps> = ({
  userEmail,
  userName,
  isMember,
  books,
  onNavigateToTab,
  onRequestSwap,
  apiBaseUrl,
  initialSubTab,
  currentReadCircles: passedCircles,
  onJoinCurrentReadCircle,
  onOpenCurrentReadCircle,
  onOpenReader,
  onShoutoutsChange,
  onRequireAuth,
}) => {
  // True when the reader may act; otherwise asks them to join and says why.
  const canAct = (why: string) => {
    if (userEmail && isMember) return true;
    if (onRequireAuth) onRequireAuth(why); else alert(why);
    return false;
  };
  // Two sections only. Older links (?tab=saved, joined-circles, …) still
  // land somewhere sensible.
  const CIRCLE_TABS = ['current-reads', 'readers-circles', 'circles', 'groups', 'joined-circles', 'joined', 'you-can-join', 'discover'];
  const tabFor = (t?: string): 'posts' | 'circles' => (t && CIRCLE_TABS.includes(t) ? 'circles' : 'posts');
  const [activeSubTab, setActiveSubTab] = useState<'posts' | 'circles'>(() => tabFor(initialSubTab));
  const [postFilter, setPostFilter] = useState<'all' | 'recommendation' | 'recognition' | 'saved'>(() =>
    initialSubTab === 'saved' ? 'saved' : initialSubTab === 'recommendations' ? 'recommendation' : initialSubTab === 'shoutouts' ? 'recognition' : 'all');

  useEffect(() => {
    if (!initialSubTab) return;
    setActiveSubTab(tabFor(initialSubTab));
    if (initialSubTab === 'saved') setPostFilter('saved');
    else if (initialSubTab === 'recommendations') setPostFilter('recommendation');
    // Community → "Shout-outs" opens the feed on shout-outs; "Posts" resets it.
    else if (initialSubTab === 'shoutouts') setPostFilter('recognition');
    else if (initialSubTab === 'feed') setPostFilter((f) => (f === 'recognition' ? 'all' : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubTab]);
  useEffect(() => { onShoutoutsChange?.(postFilter === 'recognition'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [postFilter]);

  const [posts, setPosts] = useState<ReadingRoomPost[]>([]);
  // A shared link (/reading-room?post=ID) opens the Room on that post.
  const [linkedPostId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('post') || ''; } catch { return ''; }
  });
  const [linkedPostShown, setLinkedPostShown] = useState(false);
  useEffect(() => {
    if (!linkedPostId || linkedPostShown || !posts.some(p => p.id === linkedPostId)) return;
    setLinkedPostShown(true);
    setActiveSubTab('posts');
    window.setTimeout(() => {
      const el = document.getElementById(`post-${linkedPostId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-brand-gold');
        window.setTimeout(() => el.classList.remove('ring-2', 'ring-brand-gold'), 3000);
      }
    }, 300);
  }, [posts, linkedPostId, linkedPostShown]);
  const [circlesList, setCirclesList] = useState<any[]>(passedCircles || []);
  const [loading, setLoading] = useState(true);

  // Synchronize passed circles from App.tsx when updated
  useEffect(() => {
    if (Array.isArray(passedCircles) && passedCircles.length > 0) {
      setCirclesList(passedCircles);
    }
  }, [passedCircles]);

  // Saved Posts Local Storage Helper Key
  const getSavedKey = (email: string | null) => `swapsutra_saved_posts_${(email || 'guest').toLowerCase()}`;

  // Create Post Modal State
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [postType, setPostType] = useState<'thought' | 'recommendation' | 'review' | 'quote' | 'poem' | 'recognition'>('thought');
  // Shout-out: which reader is being recognised (picked from the directory).
  const [shoutReader, setShoutReader] = useState<{ readerId: string; name: string } | null>(null);
  const [readerQuery, setReaderQuery] = useState('');
  const [readerMatches, setReaderMatches] = useState<{ readerId: string; name: string; area?: string }[]>([]);
  const [readerSearching, setReaderSearching] = useState(false);
  useEffect(() => {
    if (postType !== 'recognition' || shoutReader) return;
    const q = readerQuery.trim();
    if (q.length < 2) { setReaderMatches([]); return; }
    let cancelled = false;
    setReaderSearching(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ action: 'getReaderDirectory', q });
        if (userEmail) params.set('excludeEmail', userEmail);
        const res = await fetch(`${apiBaseUrl}?${params.toString()}`);
        const data = await res.json();
        if (!cancelled) {
          setReaderMatches((Array.isArray(data?.readers) ? data.readers : [])
            .filter((r: any) => r && r.readerId)
            .slice(0, 6)
            .map((r: any) => ({ readerId: txt(r.readerId), name: txt(r.name).trim() || 'Reader', area: txt(r.area).trim() })));
        }
      } catch { if (!cancelled) setReaderMatches([]); }
      finally { if (!cancelled) setReaderSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [postType, readerQuery, shoutReader, apiBaseUrl, userEmail]);
  const [postContent, setPostContent] = useState('');
  const [selectedBookTitle, setSelectedBookTitle] = useState('');
  const [selectedBookAuthor, setSelectedBookAuthor] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [selectedMood, setSelectedMood] = useState('');
  const rating = 5;
  const [recommendFor, setRecommendFor] = useState('');
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [attachedVoiceUrl, setAttachedVoiceUrl] = useState<string | null>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);

  const pickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageError('');
    if (!POST_IMAGE_TYPES.includes(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
      setImageError('Please pick a photo (JPG, PNG or WebP).');
      return;
    }
    setImageBusy(true);
    try {
      setAttachedImage(await shrinkPostImage(file));
    } catch (err: any) {
      setImageError(err?.message || 'Could not use that photo.');
    } finally {
      setImageBusy(false);
    }
  };
  const [attachedVoiceDuration, setAttachedVoiceDuration] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create Circle Modal State
  const [isCreatingCircleOpen, setIsCreatingCircleOpen] = useState(false);
  const [circleBookTitle, setCircleBookTitle] = useState('');
  const [circleAuthor, setCircleAuthor] = useState('');
  const [circleDescription, setCircleDescription] = useState('');
  const [circleSchedule, setCircleSchedule] = useState('');
  const [circleFormat, setCircleFormat] = useState('Physical Book');
  const [isCreatingCircleSubmitting, setIsCreatingCircleSubmitting] = useState(false);

  // Revealed Spoilers state
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});

  // Active Comment inputs
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [activeCommentVoice, setActiveCommentVoice] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'post' | 'comment'; id: string; postId?: string } | null>(null);

  useEffect(() => {
    fetchFeed();
    fetchCircles();
  }, [userEmail]);

  // Load local saved IDs into posts
  useEffect(() => {
    if (!userEmail) return;
    try {
      const stored = localStorage.getItem(getSavedKey(userEmail));
      if (stored) {
        const savedIds: string[] = JSON.parse(stored);
        if (Array.isArray(savedIds) && savedIds.length > 0) {
          setPosts(prev => prev.map(p => savedIds.includes(p.id) ? { ...p, isSaved: true } : p));
        }
      }
    } catch (e) {
      console.warn('Error loading saved items:', e);
    }
  }, [userEmail, posts.length]);

  const fetchFeed = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}?action=getReadingRoomFeed&userEmail=${encodeURIComponent(userEmail || '')}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.posts)) {
        // Merge with local storage saved items
        let savedIds: string[] = [];
        if (userEmail) {
          try {
            const stored = localStorage.getItem(getSavedKey(userEmail));
            if (stored) savedIds = JSON.parse(stored);
          } catch (e) {}
        }
        const mapped = data.posts.map((raw: any) => {
          const p = normalizePost(raw);
          return { ...p, isSaved: p.isSaved || savedIds.includes(p.id) };
        }).filter(postHasContent);
        setPosts(mapped);
      }
    } catch (err) {
      console.error('Error fetching feed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCircles = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}?action=getCurrentReadCircles`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setCirclesList(data.data);
      }
    } catch (err) {
      console.error('Error fetching circles:', err);
    }
  };

  // Helper to check listing status in canonical books
  const getBookListingStatus = (title?: string, author?: string) => {
    if (!title) return null;
    const normalizedTitle = low(title);
    if (!normalizedTitle) return null;
    
    const match = (books || []).find((b: any) => {
      const bTitle = low(b?.title);
      return bTitle === normalizedTitle || (bTitle.length > 3 && normalizedTitle.length > 3 && (bTitle.includes(normalizedTitle) || normalizedTitle.includes(bTitle)));
    });

    if (!match) {
      return { isListed: false, mode: 'bookshelf', label: '' };
    }

    const isApproved = match.status === 'Approved' || match.status === 'Active' || match.status === 'Available' || !match.status;
    if (!isApproved) {
      return { isListed: false, mode: 'bookshelf', label: '' };
    }

    const isSwap = match.available_for_swap === true || String(match.available_for_swap).toLowerCase() === 'true' || match.permanent_exchange || match.temporary_exchange || match.swapType;
    const isRent = match.rent === true || String(match.rent).toLowerCase() === 'true' || match.rent_sale_mode === 'Rent';
    const isSale = match.sell === true || String(match.sell).toLowerCase() === 'true' || match.rent_sale_mode === 'Sale';

    if (isSwap) {
      return { isListed: true, mode: 'swap', label: 'Available for Swap in Community', ctaText: 'Request Swap', book: match };
    } else if (isRent) {
      return { isListed: true, mode: 'rent', label: 'Available for Rent in Community', ctaText: 'Request Rent', book: match };
    } else if (isSale) {
      return { isListed: true, mode: 'sale', label: 'Available for Sale in Community', ctaText: 'Request Purchase', book: match };
    }

    return { isListed: false, mode: 'bookshelf', label: '', book: match };
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAct('Register to post in the Reading Room.')) return;
    if (postType === 'recognition') {
      if (!shoutReader) { alert('Pick the reader you want to recognise.'); return; }
      if (!postContent.trim()) { alert('Say what they did that deserves the shout-out.'); return; }
    } else if (!postContent.trim() && !attachedVoiceUrl && !attachedImage) {
      alert('Write something or add a photo.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        action: 'createReadingRoomPost',
        authorEmail: userEmail,
        authorName: userName,
        postType,
        content: postContent,
        bookTitle: selectedBookTitle,
        bookAuthor: selectedBookAuthor,
        bookGenre: selectedGenre,
        bookMood: selectedMood,
        rating: postType === 'recommendation' || postType === 'review' ? rating : undefined,
        recommendFor: postType === 'recommendation' ? recommendFor : undefined,
        audioUrl: attachedVoiceUrl || undefined,
        audioDuration: attachedVoiceDuration || undefined,
        fileData: attachedImage || undefined,
        recognizedReaderId: postType === 'recognition' ? shoutReader?.readerId : undefined,
        fileName: attachedImage ? 'reading-room.jpg' : undefined,
        isSpoiler,
      };

      const res = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setIsComposerOpen(false);
        setPostContent('');
        setSelectedBookTitle('');
        setSelectedBookAuthor('');
        setSelectedGenre('');
        setSelectedMood('');
        setRecommendFor('');
        setAttachedVoiceUrl(null);
        setAttachedImage(null);
        setShoutReader(null);
        setReaderQuery('');
        setPostType('thought');
        setIsSpoiler(false);
        fetchFeed();
      } else {
        alert(data.message || 'Failed to create post');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to post. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateCircleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!circleBookTitle.trim()) {
      alert('Please enter a book title for the circle.');
      return;
    }
    if (!canAct('Register to start a reading circle.')) return;

    setIsCreatingCircleSubmitting(true);
    try {
      const payload = {
        action: 'addCurrentRead',
        user_id: userEmail,
        user_name: userName,
        book_title: circleBookTitle.trim(),
        author: circleAuthor.trim(),
        description: circleDescription.trim(),
        reading_schedule: circleSchedule.trim(),
        format: circleFormat
      };

      const res = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        const newCircleItem = {
          id: data.circle_id || data.id || `circle_${Date.now()}`,
          bookTitle: circleBookTitle.trim(),
          author: circleAuthor.trim() || 'Author not added',
          description: circleDescription.trim(),
          members: [{ userId: userEmail, firstName: userName }],
          status: 'Active Discussion',
          readerCount: 1,
          creator: userName,
          schedule: circleSchedule.trim() || 'Flexible Pace',
          format: circleFormat
        };

        setCirclesList(prev => [newCircleItem, ...prev]);
        setIsCreatingCircleOpen(false);
        setCircleBookTitle('');
        setCircleAuthor('');
        setCircleDescription('');
        setCircleSchedule('');

        // Move user directly to Joined Circles tab
        setActiveSubTab('circles');
      } else {
        alert(data.message || 'Could not create circle. Please try again.');
      }
    } catch (err) {
      console.error('Error creating circle:', err);
      alert('Could not create circle.');
    } finally {
      setIsCreatingCircleSubmitting(false);
    }
  };

  const handleToggleReaction = async (postId: string, reactionType: 'like' | 'love' | 'thoughtful') => {
    if (!canAct('Register to react to posts.')) return;

    setPosts(prev =>
      prev.map(p => {
        if (p.id !== postId) return p;
        const currentRx = p.userReaction;
        let newRx: 'like' | 'love' | 'thoughtful' | null = reactionType;
        let newCount = p.reactionsCount;

        if (currentRx === reactionType) {
          newRx = null;
          newCount = Math.max(0, newCount - 1);
        } else if (!currentRx) {
          newCount += 1;
        }

        return { ...p, userReaction: newRx, reactionsCount: newCount };
      })
    );

    try {
      await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'togglePostReaction',
          userEmail,
          postId,
          reactionType,
        }),
      });

      const post = posts.find(p => p.id === postId);
      if (post && post.authorEmail && low(post.authorEmail) !== low(userEmail)) {
        NotificationEngine.notifyPostReaction(post.authorEmail, userName || 'A fellow reader', postId, post.bookTitle || txt(post.content).slice(0, 30));
      }
    } catch (err) {
      console.error('Reaction error:', err);
    }
  };

  const handleAddComment = async (postId: string) => {
    const text = commentInputs[postId] || '';
    const voiceUrl = activeCommentVoice[postId] || '';
    if (!text.trim() && !voiceUrl) return;
    if (!canAct('Register to comment.')) return;

    try {
      const res = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addPostComment',
          userEmail,
          userName,
          postId,
          comment: text,
          audioUrl: voiceUrl,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCommentInputs(prev => ({ ...prev, [postId]: '' }));
        setActiveCommentVoice(prev => ({ ...prev, [postId]: '' }));

        const post = posts.find(p => p.id === postId);
        if (post && post.authorEmail && low(post.authorEmail) !== low(userEmail)) {
          NotificationEngine.notifyPostComment(post.authorEmail, userName || 'A fellow reader', postId, text || 'Voice comment');
        }

        fetchFeed();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveRecommendation = async (postId: string) => {
    if (!canAct('Register to save posts.')) return;

    let isNowSaved = false;

    setPosts(prev =>
      prev.map(p => {
        if (p.id === postId) {
          isNowSaved = !p.isSaved;
          return { ...p, isSaved: isNowSaved };
        }
        return p;
      })
    );

    // Persist to local storage
    try {
      const key = getSavedKey(userEmail);
      const stored = localStorage.getItem(key);
      let savedIds: string[] = stored ? JSON.parse(stored) : [];
      if (isNowSaved) {
        if (!savedIds.includes(postId)) savedIds.push(postId);
      } else {
        savedIds = savedIds.filter(id => id !== postId);
      }
      localStorage.setItem(key, JSON.stringify(savedIds));
    } catch (e) {
      console.warn('Error saving locally:', e);
    }

    // Backend API sync
    try {
      await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveBookRecommendation',
          userEmail,
          postId,
        }),
      });

      const post = posts.find(p => p.id === postId);
      if (isNowSaved && post && post.authorEmail && low(post.authorEmail) !== low(userEmail)) {
        NotificationEngine.dispatchEvent({
          type: 'community_recommendation_saved',
          category: 'recommendation',
          recipientEmails: [post.authorEmail],
          senderName: userName || 'A reader',
          title: 'Your Recommendation Was Saved! 📚',
          message: `${userName || 'A reader'} saved your book recommendation for "${post.bookTitle || 'a book'}".`,
          entityType: 'post',
          entityId: postId,
          targetUrl: `/reading-room?post=${postId}`
        });
      }
    } catch (err) {
      console.error('Error saving item:', err);
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    try {
      const action = deleteTarget.type === 'post' ? 'deleteReadingRoomPost' : 'deletePostComment';
      const body =
        deleteTarget.type === 'post'
          ? { action, userEmail, postId: deleteTarget.id }
          : { action, userEmail, commentId: deleteTarget.id };

      const res = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        setDeleteTarget(null);
        fetchFeed();
      } else {
        alert(data.message || 'Could not delete item.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleJoinCircleAction = async (circleId: string) => {
    if (!canAct('Register to join a reading circle.')) return;

    // Optimistically add user to circle members
    setCirclesList(prev => prev.map(c => {
      const cId = c.id || c.circle_id;
      if (cId === circleId) {
        const membersArr = Array.isArray(c.members) ? c.members : [];
        const alreadyIn = membersArr.some((m: any) => low(m?.userId || m?.user_id) === low(userEmail));
        if (alreadyIn) return c;
        const updatedMembers = [...membersArr, { userId: userEmail, firstName: userName }];
        return { ...c, members: updatedMembers, reader_count: updatedMembers.length, readerCount: updatedMembers.length };
      }
      return c;
    }));

    if (onJoinCurrentReadCircle) {
      onJoinCurrentReadCircle(circleId);
    }

    try {
      await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'joinCurrentReadCircle',
          circle_id: circleId,
          user_id: userEmail,
          user_name: userName,
        }),
      });
    } catch (err) {
      console.error('Error joining circle:', err);
    }
  };

  const handleOpenCircleAction = (circleId: string) => {
    if (onOpenCurrentReadCircle) {
      onOpenCurrentReadCircle(circleId);
    } else {
      onNavigateToTab('reader-circle');
    }
  };

  // Filtered Circles: Joined vs You Can Join
  const joinedCircles = useMemo(() => {
    if (!userEmail) return [];
    const normalizedUser = userEmail.trim().toLowerCase();
    return circlesList.filter(c => {
      const membersArr = Array.isArray(c.members) ? c.members : [];
      return membersArr.some((m: any) => low(m?.userId || m?.user_id) === normalizedUser);
    });
  }, [circlesList, userEmail]);

  const youCanJoinCircles = useMemo(() => {
    if (!userEmail) return circlesList;
    const normalizedUser = userEmail.trim().toLowerCase();
    return circlesList.filter(c => {
      const membersArr = Array.isArray(c.members) ? c.members : [];
      return !membersArr.some((m: any) => low(m?.userId || m?.user_id) === normalizedUser);
    });
  }, [circlesList, userEmail]);


  // Saved posts (kept per reader in this browser, as before).
  const savedPosts = useMemo(() => {
    if (!userEmail) return [];
    return posts.filter(p => p.isSaved);
  }, [posts, userEmail]);

  const feedPosts = useMemo(() => {
    if (postFilter === 'saved') return posts.filter(p => p.isSaved);
    if (postFilter === 'recommendation') return posts.filter(p => p.postType === 'recommendation' || p.postType === 'review');
    if (postFilter === 'recognition') return posts.filter(p => p.postType === 'recognition');
    return posts;
  }, [posts, postFilter]);

  const openComposer = () => {
    if (!canAct('Register to post in the Reading Room.')) return;
    if (postFilter === 'recognition') setPostType('recognition');
    setIsComposerOpen(true);
  };
  const openCircleCreator = () => {
    if (!userEmail) { onNavigateToTab('profile'); return; }
    setIsCreatingCircleOpen(true);
  };

  const renderPost = (post: ReadingRoomPost) => (
      <div
        key={post.id}
        id={`post-${post.id}`}
        className="bg-[var(--bg-surface)] rounded-2xl border border-brand-border p-5 sm:p-6 shadow-2xs space-y-4 transition-all hover:border-brand-gold"
      >
        {/* Post Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-surface-inset)] border border-brand-border flex items-center justify-center text-[var(--text-accent)] font-serif font-bold text-sm">
              {(txt(post.authorName).trim().charAt(0) || 'R').toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-serif font-semibold text-[var(--text-primary)] text-sm">{post.authorName}</span>
                <span className="px-2 py-0.5 bg-[var(--bg-surface-inset)] text-[var(--text-accent)] text-2xs font-medium rounded-full uppercase tracking-wider">
                  {post.postType === 'recognition' && post.badgeLabel ? 'Badge' : (POST_TYPE_LABEL[post.postType] || post.postType)}
                </span>
              </div>
              <span className="text-2xs text-[var(--text-muted)]">
                {new Date(post.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>

          {/* Delete Post option */}
          {userEmail && (low(userEmail) === low(post.authorEmail) || userEmail === 'swapsutra@gmail.com') && (
            <button
              onClick={() => setDeleteTarget({ type: 'post', id: post.id })}
              className="p-1.5 text-[var(--text-muted)] hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              title="Delete Post"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Recognition: who is being celebrated, and for which badge */}
        {post.postType === 'recognition' && (post.recognizedNames?.length || 0) > 0 && (
          <div className="rounded-2xl border border-brand-border bg-gradient-to-br from-brand-beige/70 via-brand-offwhite/60 to-transparent p-4 text-center space-y-2">
            <p className="text-2xl" aria-hidden="true">{post.badgeLabel ? '🏅' : '🎉'}</p>
            <p className="text-2xs font-bold uppercase tracking-eyebrow text-brand-brown">
              {post.badgeLabel ? post.badgeLabel : 'Shout-out'}
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {(post.recognizedNames || []).slice(0, 24).map((name, i) => {
                const rid = post.recognizedReaderIds?.[i];
                return rid && onOpenReader ? (
                  <button key={`${rid}-${i}`} type="button" onClick={() => onOpenReader(rid)}
                    className="px-3 py-1 rounded-full bg-white/80 border border-brand-border text-sm font-serif font-semibold text-[var(--text-primary)] hover:border-brand-gold">
                    {name}
                  </button>
                ) : (
                  <span key={`${name}-${i}`} className="px-3 py-1 rounded-full bg-white/80 border border-brand-border text-sm font-serif font-semibold text-[var(--text-primary)]">{name}</span>
                );
              })}
              {(post.recognizedNames || []).length > 24 && (
                <span className="px-3 py-1 text-sm text-[var(--text-secondary)]">+{(post.recognizedNames || []).length - 24} more</span>
              )}
            </div>
          </div>
        )}

        {/* Connected Book Badge & Swap Action */}
        {post.bookTitle && (() => {
          const status = getBookListingStatus(post.bookTitle, post.bookAuthor);
          return (
            <div className="p-3 bg-[var(--bg-surface-inset)]/80 border border-brand-border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <BookOpen className="w-4 h-4 text-[var(--text-accent)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="font-serif font-bold text-[var(--text-primary)] text-xs sm:text-sm truncate block">{post.bookTitle}</span>
                  {post.bookAuthor && <span className="text-xs text-[var(--text-secondary)] truncate block">by {post.bookAuthor}</span>}
                </div>
              </div>

              {status?.isListed ? (
                <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
                  <span className="inline-flex items-center gap-1 text-2xs sm:text-xs font-bold bg-emerald-100 text-emerald-900 px-2.5 py-1 rounded-full whitespace-nowrap">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-700" />
                    {status.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRequestSwap(post.bookTitle!)}
                    className="px-3 py-1.5 bg-brand-gold text-white text-xs font-bold rounded-xl hover:bg-brand-brown transition-colors whitespace-nowrap shrink-0 shadow-2xs"
                  >
                    {status.ctaText}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })()}

        {/* Post Content */}
        {post.isSpoiler && !revealedSpoilers[post.id] ? (
          <div className="p-4 bg-brand-brown/5 border border-brand-border rounded-xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-[var(--text-secondary)] text-xs">
              <ShieldAlert className="w-4 h-4 text-brand-gold-text shrink-0" />
              <span>This post contains story spoilers for {post.bookTitle || 'this book'}.</span>
            </div>
            <button
              onClick={() => setRevealedSpoilers(prev => ({ ...prev, [post.id]: true }))}
              className="px-3 py-1.5 bg-brand-gold text-white text-xs font-semibold rounded-lg hover:bg-brand-brown flex items-center gap-1.5 shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Reveal Spoiler</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {post.content && (
              <p className="text-[var(--text-primary)] text-xs sm:text-sm leading-relaxed whitespace-pre-line font-sans">
                {post.content}
              </p>
            )}

            {post.mediaUrl && (!post.mediaType || post.mediaType === 'image') && (
              <img
                src={postImageSrc(post.mediaUrl)}
                alt={post.bookTitle ? `Photo about ${post.bookTitle}` : `Photo shared by ${post.authorName}`}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full max-h-[480px] object-cover rounded-xl border border-brand-border bg-[var(--bg-surface-inset)]"
              />
            )}

            {/* Attached Voice Player */}
            {post.audioUrl && (
              <div className="p-3 bg-[var(--bg-surface-inset)]/80 rounded-xl border border-brand-border flex items-center gap-3">
                <Volume2 className="w-4 h-4 text-[var(--text-accent)] shrink-0" />
                <audio controls src={post.audioUrl} className="w-full h-8 max-w-md" />
              </div>
            )}
          </div>
        )}

        {/* Rating Badge */}
        {post.rating && (
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-accent)]">
            <div className="flex text-white0">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`w-3.5 h-3.5 ${i < post.rating! ? 'fill-brand-gold-muted text-brand-gold-muted' : 'text-[var(--text-muted)]'}`}
                />
              ))}
            </div>
            <span>{post.rating}/5 Rating</span>
          </div>
        )}

        {/* Interaction Bar */}
        <div className="flex items-center justify-between pt-3 border-t border-stone-200 text-xs font-semibold text-[var(--text-secondary)] gap-2">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => handleToggleReaction(post.id, 'like')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl transition-colors whitespace-nowrap ${
                post.userReaction === 'like'
                  ? 'bg-rose-50 text-rose-600 font-bold'
                  : 'hover:bg-[var(--bg-surface-inset)] text-[var(--text-secondary)]'
              }`}
            >
              <Heart className={`w-4 h-4 shrink-0 ${post.userReaction === 'like' ? 'fill-rose-500 text-rose-500' : ''}`} />
              <span>{post.reactionsCount || 'React'}</span>
            </button>

            <button
              type="button"
              onClick={() => setOpenComments(prev => ({ ...prev, [post.id]: !prev[post.id] }))}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl hover:bg-[var(--bg-surface-inset)] transition-colors whitespace-nowrap text-[var(--text-secondary)]"
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span>{post.commentsCount === 1 ? '1 comment' : `${post.commentsCount || 0} comments`}</span>
            </button>
          </div>

          <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => sharePost(post)}
            aria-label="Share this post"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl hover:bg-[var(--bg-surface-inset)] transition-colors whitespace-nowrap text-[var(--text-secondary)]"
          >
            <Share2 className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Share</span>
          </button>
          <button
            type="button"
            onClick={() => handleSaveRecommendation(post.id)}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl transition-colors whitespace-nowrap ${
              post.isSaved
                ? 'bg-[var(--bg-surface-inset)] text-[var(--text-accent)] font-bold border border-brand-border'
                : 'hover:bg-[var(--bg-surface-inset)] text-[var(--text-secondary)]'
            }`}
          >
            <Bookmark className={`w-4 h-4 shrink-0 ${post.isSaved ? 'fill-brand-gold text-[var(--text-accent)]' : ''}`} />
            <span>{post.isSaved ? 'Saved' : 'Save'}</span>
          </button>
          </div>
        </div>

        {/* Comments Section */}
        {openComments[post.id] && (
          <div className="pt-4 border-t border-brand-border space-y-4">
            {post.comments && post.comments.length > 0 ? (
              <div className="space-y-3">
                {post.comments.map(comment => (
                  <div key={comment.id} className="p-3 bg-[var(--bg-surface-inset)]/80 rounded-xl text-xs space-y-1">
                    <div className="flex items-center justify-between text-[var(--text-secondary)] font-semibold">
                      <span>{comment.userName}</span>
                      {userEmail && (low(userEmail) === low(comment.userEmail) || userEmail === 'swapsutra@gmail.com') && (
                        <button
                          onClick={() => setDeleteTarget({ type: 'comment', id: comment.id })}
                          className="text-[var(--text-muted)] hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-[var(--text-primary)]">{comment.comment}</p>
                    {comment.audioUrl && (
                      <audio controls src={comment.audioUrl} className="w-full h-7 mt-1" />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-2xs text-[var(--text-muted)] italic">No comments yet. Share your thoughts!</p>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Write a comment..."
                value={commentInputs[post.id] || ''}
                onChange={e => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && handleAddComment(post.id)}
                className="flex-1 px-3 py-2 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
              />
              <button
                onClick={() => handleAddComment(post.id)}
                className="p-2 bg-brand-gold text-white rounded-xl hover:bg-brand-brown"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
  );

  // ── Sharing ──────────────────────────────────────────────────────────
  const [shareNote, setShareNote] = useState('');
  const flashShare = (msg: string) => { setShareNote(msg); window.setTimeout(() => setShareNote(''), 2500); };
  // A post with a picture opens the share panel so the picture goes along
  // as an attachment; a text-only post shares straight away.
  const [postShare, setPostShare] = useState<null | { title: string; text: string; url: string; images: string[] }>(null);
  const sharePost = async (post: ReadingRoomPost) => {
    const snippet = txt(post.content).replace(/\s+/g, ' ').trim().slice(0, 120);
    const about = post.bookTitle ? ` about "${post.bookTitle}"` : '';
    const payload = {
      title: 'SwapSutra Reading Room',
      text: `${post.authorName || 'A reader'} posted${about} in the SwapSutra Reading Room${snippet ? `: "${snippet}${txt(post.content).length > 120 ? '…' : ''}"` : ''}`,
      url: siteUrl(`/reading-room?post=${encodeURIComponent(post.id)}`),
    };
    const images = [
      post.mediaUrl && (!post.mediaType || post.mediaType === 'image') ? postImageSrc(post.mediaUrl) : '',
      post.bookCoverUrl || '',
    ].filter(Boolean) as string[];
    if (images.length) { setPostShare({ ...payload, images: images.slice(0, 1) }); return; }
    const r = await shareLink(payload);
    if (r === 'copied') flashShare('Link copied — paste it anywhere to share.');
    else if (r === 'failed') flashShare('Could not share this post.');
  };
  const inviteToCircle = async (c: any) => {
    const cId = c.id || c.circle_id;
    const title = c.bookTitle || c.book_title || 'a book';
    const r = await shareLink({
      title: 'Join my reading circle',
      text: `I'm reading "${title}" with a small group on SwapSutra — join the circle and read along with us!`,
      url: siteUrl(`/readers-circle/${encodeURIComponent(cId)}`),
    });
    if (r === 'copied') flashShare('Invite link copied — send it to a friend.');
    else if (r === 'failed') flashShare('Could not create the invite.');
  };

  const renderCircle = (c: any, joined: boolean) => {
    const cId = c.id || c.circle_id;
    const membersArr = Array.isArray(c.members) ? c.members : [];
    const count = membersArr.length || c.readerCount || c.reader_count || 1;
    return (
      <li key={cId} className="bg-[var(--bg-surface)] rounded-2xl border border-brand-border p-4 shadow-2xs flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="w-11 h-14 shrink-0 rounded-md bg-[var(--bg-surface-inset)] border border-brand-border flex items-center justify-center text-[var(--text-accent)]">
          <BookOpen className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif font-bold text-base text-[var(--text-primary)] leading-snug truncate">{c.bookTitle || c.book_title}</h3>
          <p className="text-xs text-[var(--text-muted)] truncate">
            {c.author && c.author !== 'Author not added' ? `${c.author} · ` : ''}{count} {count === 1 ? 'reader' : 'readers'}
          </p>
          {c.schedule && c.schedule !== 'Flexible Pace' && <p className="text-xs text-[var(--text-secondary)] truncate">{c.schedule}</p>}
        </div>
        {/* Actions sit under the title on a phone, so the book name is readable. */}
        <div className="flex w-full sm:w-auto items-center justify-end gap-2">
        <button type="button" onClick={() => inviteToCircle(c)} aria-label={`Invite readers to ${c.bookTitle || c.book_title || 'this circle'}`}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-brand-border text-xs font-bold text-[var(--text-accent)] hover:border-brand-gold" title="Invite readers">
          <Share2 className="w-4 h-4" /> Invite
        </button>
        {joined ? (
          <button type="button" onClick={() => handleOpenCircleAction(cId)}
            className="shrink-0 px-4 py-2.5 bg-brand-gold text-white rounded-xl text-xs font-bold hover:bg-brand-brown">
            Open chat
          </button>
        ) : (
          <button type="button" onClick={() => handleJoinCircleAction(cId)}
            className="shrink-0 px-4 py-2.5 border border-brand-gold text-[var(--text-accent)] rounded-xl text-xs font-bold hover:bg-[var(--bg-surface-inset)] inline-flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" /> Join
          </button>
        )}
        </div>
      </li>
    );
  };

  const tabBtn = (active: boolean) =>
    `flex-1 min-h-[40px] rounded-xl text-sm sm:text-sm font-semibold transition-colors ${active ? 'bg-brand-gold text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-inset)]'}`;
  const chip = (active: boolean) =>
    `px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${active ? 'bg-brand-gold text-white border-brand-gold' : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-stone-200 hover:border-brand-gold'}`;

  return (
    <div className="max-w-3xl mx-auto px-0 sm:px-4 pt-1 pb-6 sm:py-6 space-y-4 sm:space-y-6">
      {shareNote && (
        <div role="status" className="fixed left-1/2 top-20 z-[130] -translate-x-1/2 rounded-full bg-brand-brown px-4 py-2 text-xs font-semibold text-brand-offwhite shadow-lg">
          {shareNote}
        </div>
      )}
      {postShare && (
        <ShareSheet
          heading="Share this post"
          title={postShare.title}
          text={postShare.text}
          url={postShare.url}
          images={postShare.images}
          onClose={() => setPostShare(null)}
        />
      )}
      {/* Two tabs, both always visible — nothing scrolls sideways. */}
      <div role="tablist" aria-label="Reading Room sections" className="flex gap-1 p-1 rounded-2xl bg-[var(--bg-surface)] border border-brand-border">
        <button role="tab" aria-selected={activeSubTab === 'posts'} type="button" onClick={() => setActiveSubTab('posts')} className={tabBtn(activeSubTab === 'posts')}>
          Posts
        </button>
        <button role="tab" aria-selected={activeSubTab === 'circles'} type="button" onClick={() => setActiveSubTab('circles')} className={tabBtn(activeSubTab === 'circles')}>
          Reading circles{joinedCircles.length ? ` · ${joinedCircles.length}` : ''}
        </button>
      </div>

      {activeSubTab === 'posts' && (
        <section className="space-y-5">
          <button type="button" onClick={openComposer}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-[var(--bg-surface)] border border-brand-border rounded-2xl text-left text-sm text-[var(--text-muted)] hover:border-brand-gold shadow-2xs">
            <span className="w-9 h-9 shrink-0 rounded-full bg-brand-gold text-white flex items-center justify-center"><Plus className="w-4 h-4" /></span>
            <span>What are you reading? Write a post or share a photo…</span>
          </button>

          <div className="flex gap-2 overflow-x-auto scrollbar-hide sm:flex-wrap" aria-label="Show">
            <button type="button" onClick={() => setPostFilter('all')} className={chip(postFilter === 'all')}>All posts</button>
            <button type="button" onClick={() => setPostFilter('recommendation')} className={chip(postFilter === 'recommendation')}>Recommendations</button>
            {!onShoutoutsChange && (
              <button type="button" onClick={() => setPostFilter('recognition')} className={chip(postFilter === 'recognition')}>🎉 Shout-outs</button>
            )}
            {userEmail && (
              <button type="button" onClick={() => setPostFilter('saved')} className={chip(postFilter === 'saved')}>
                Saved{savedPosts.length ? ` · ${savedPosts.length}` : ''}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <RefreshCw className="w-6 h-6 text-[var(--text-accent)] animate-spin" />
              <p className="text-xs text-[var(--text-muted)]">Loading posts…</p>
            </div>
          ) : feedPosts.length === 0 ? (
            <div className="text-center py-12 bg-[var(--bg-surface)] rounded-3xl border border-stone-200/80 p-8 space-y-3">
              <BookOpen className="w-10 h-10 text-[var(--text-accent)]/40 mx-auto" />
              <h3 className="text-lg font-serif font-semibold text-[var(--text-primary)]">
                {postFilter === 'saved' ? 'Nothing saved yet' : postFilter === 'recommendation' ? 'No recommendations yet' : postFilter === 'recognition' ? 'No shout-outs yet' : 'No posts yet'}
              </h3>
              <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
                {postFilter === 'saved'
                  ? 'Tap Save on any post to keep it here.'
                  : postFilter === 'recognition'
                  ? 'Thank a reader who made your reading better — write a shout-out.'
                  : 'Be the first — tell other readers about a book you loved.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {feedPosts.map(renderPost)}
            </div>
          )}
        </section>
      )}

      {activeSubTab === 'circles' && (
        <section className="space-y-6">
          <button type="button" onClick={openCircleCreator}
            className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-brand-gold hover:bg-brand-brown text-white rounded-2xl text-sm font-semibold shadow-sm">
            <Plus className="w-4 h-4" /> Start a circle for a book
          </button>

          {joinedCircles.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Your circles</h2>
              <ul className="space-y-3">{joinedCircles.map(c => renderCircle(c, true))}</ul>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
              {joinedCircles.length > 0 ? 'More circles you can join' : 'Circles you can join'}
            </h2>
            {youCanJoinCircles.length > 0 ? (
              <ul className="space-y-3">{youCanJoinCircles.map(c => renderCircle(c, false))}</ul>
            ) : (
              <p className="text-sm text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-2xl border border-dashed border-stone-300 p-6 text-center">
                {joinedCircles.length > 0 ? "You're in every open circle." : 'No circles yet. Start one for the book you are reading.'}
              </p>
            )}
          </div>
        </section>
      )}

      {/* CREATE POST MODAL */}
      {isComposerOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-[120] flex items-end sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-[var(--bg-surface)] rounded-3xl max-w-lg w-full max-h-[92dvh] overflow-y-auto p-5 sm:p-6 space-y-5 shadow-2xl border border-brand-border animate-scale-up">
            <div className="flex items-center justify-between border-b border-stone-100 pb-4">
              <h3 className="font-serif font-bold text-lg text-[var(--text-primary)]">Share to Reading Room</h3>
              <button onClick={() => setIsComposerOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePost} className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {(['thought', 'recommendation', 'review', 'quote', 'poem', 'recognition'] as const).map(type => (
                  <button
                    type="button"
                    key={type}
                    onClick={() => setPostType(type)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize whitespace-nowrap transition-all ${
                      postType === type
                        ? 'bg-brand-gold text-white font-semibold'
                        : 'bg-[var(--bg-surface-inset)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-inset)]'
                    }`}
                  >
                    {type === 'recognition' ? '🎉 Shout-out' : POST_TYPE_LABEL[type]}
                  </button>
                ))}
              </div>

              {postType === 'recognition' ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-secondary)]">Recognise a reader — for a great swap, a book they lent you, hosting a meetup, anything.</p>
                  {shoutReader ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-border bg-[var(--bg-surface-inset)] px-3 py-2.5">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">🎉 {shoutReader.name}</span>
                      <button type="button" onClick={() => { setShoutReader(null); setReaderQuery(''); }}
                        className="text-xs font-semibold text-[var(--text-accent)] underline underline-offset-4">Change</button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={readerQuery}
                        onChange={e => setReaderQuery(e.target.value)}
                        placeholder="Type a reader's name…"
                        aria-label="Reader to recognise"
                        className="w-full px-3 py-2 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
                      />
                      {readerSearching && <p className="text-xs text-[var(--text-muted)]">Looking…</p>}
                      {readerMatches.length > 0 && (
                        <ul className="rounded-xl border border-stone-200 divide-y divide-stone-100 overflow-hidden" role="listbox" aria-label="Matching readers">
                          {readerMatches.map(r => (
                            <li key={r.readerId}>
                              <button type="button" role="option" aria-selected="false"
                                onClick={() => { setShoutReader({ readerId: r.readerId, name: r.name }); setReaderMatches([]); }}
                                className="w-full text-left px-3 py-2.5 text-sm hover:bg-[var(--bg-surface-inset)]">
                                <span className="font-semibold text-[var(--text-primary)]">{r.name}</span>
                                {r.area && <span className="text-[var(--text-muted)]"> · {r.area}</span>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!readerSearching && readerQuery.trim().length >= 2 && readerMatches.length === 0 && (
                        <p className="text-xs text-[var(--text-muted)]">No reader found with that name.</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Book name (optional)"
                  value={selectedBookTitle}
                  onChange={e => setSelectedBookTitle(e.target.value)}
                  className="px-3 py-2 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Author (optional)"
                  value={selectedBookAuthor}
                  onChange={e => setSelectedBookAuthor(e.target.value)}
                  className="px-3 py-2 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
                />
              </div>
              )}

              <textarea
                rows={4}
                placeholder={
                  postType === 'recognition'
                    ? 'What did they do? e.g. "Lent me her copy of Gitanjali and waited two months for it back!"'
                    : postType === 'recommendation'
                    ? 'Why do you recommend this book? Who would love it?'
                    : postType === 'quote'
                    ? 'Share a favorite passage or excerpt...'
                    : 'What are your reading thoughts today?'
                }
                value={postContent}
                onChange={e => setPostContent(e.target.value)}
                className="w-full p-3 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
              />

              {/* Photo (optional) */}
              <div className="space-y-2">
                {attachedImage ? (
                  <div className="relative">
                    <img src={attachedImage} alt="Your photo" className="w-full max-h-72 object-contain rounded-xl border border-stone-200 bg-[var(--bg-surface-inset)]" />
                    <button type="button" onClick={() => setAttachedImage(null)} aria-label="Remove photo"
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-stone-900/70 text-white flex items-center justify-center">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-brand-border text-sm font-semibold text-[var(--text-accent)] cursor-pointer hover:bg-[var(--bg-surface-inset)]">
                    <ImageIcon className="w-4 h-4" />
                    <span>{imageBusy ? 'Preparing photo…' : 'Add a photo'}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/*" className="sr-only"
                      aria-label="Add a photo" onChange={pickImage} disabled={imageBusy} />
                  </label>
                )}
                {imageError && <p className="text-xs text-red-700">{imageError}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold text-[var(--text-secondary)]">Attach Voice Note (Optional)</label>
                <VoiceRecorder
                  onRecordingComplete={(url, dur) => {
                    setAttachedVoiceUrl(url);
                    setAttachedVoiceDuration(dur);
                  }}
                  onCancel={() => setAttachedVoiceUrl(null)}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={isSpoiler}
                  onChange={e => setIsSpoiler(e.target.checked)}
                  className="rounded text-[var(--text-accent)] focus:ring-brand-gold"
                />
                <span className="text-xs text-[var(--text-secondary)] font-medium">Contains story plot spoilers</span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsComposerOpen(false)}
                  className="px-4 py-2 text-[var(--text-secondary)] text-xs font-semibold hover:bg-[var(--bg-surface-inset)] rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-brand-gold text-white text-xs font-semibold rounded-xl hover:bg-brand-brown disabled:opacity-50"
                >
                  {isSubmitting ? 'Posting...' : 'Post to Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE READERS CIRCLE MODAL */}
      {isCreatingCircleOpen && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-[120] flex items-end sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-[var(--bg-surface)] rounded-3xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-5 sm:p-6 space-y-5 shadow-2xl border border-brand-border animate-scale-up">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <span className="text-2xs font-bold uppercase tracking-widest text-[var(--text-accent)]">Reading Community</span>
                <h3 className="font-serif font-bold text-xl text-[var(--text-primary)]">Create a Readers Circle</h3>
              </div>
              <button onClick={() => setIsCreatingCircleOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCircleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-[var(--text-secondary)] block mb-1">Book Title *</label>
                <input
                  type="text"
                  placeholder="e.g. The Shadow of the Wind"
                  required
                  value={circleBookTitle}
                  onChange={e => setCircleBookTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[var(--text-secondary)] block mb-1">Author</label>
                <input
                  type="text"
                  placeholder="e.g. Carlos Ruiz Zafón"
                  value={circleAuthor}
                  onChange={e => setCircleAuthor(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[var(--text-secondary)] block mb-1">Discussion Focus / Note</label>
                <textarea
                  rows={3}
                  placeholder="What makes you want to read this together with fellow readers?"
                  value={circleDescription}
                  onChange={e => setCircleDescription(e.target.value)}
                  className="w-full p-3 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[var(--text-secondary)] block mb-1">Schedule / Pace</label>
                  <input
                    type="text"
                    placeholder="e.g. 2 chapters/week"
                    value={circleSchedule}
                    onChange={e => setCircleSchedule(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[var(--text-secondary)] block mb-1">Reading Format</label>
                  <select
                    value={circleFormat}
                    onChange={e => setCircleFormat(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-stone-200 rounded-xl text-base sm:text-sm focus:ring-2 focus:ring-brand-gold focus:outline-none"
                  >
                    <option value="Physical Book">Physical Book</option>
                    <option value="eBook / Kindle">eBook / Kindle</option>
                    <option value="Audiobook">Audiobook</option>
                    <option value="Flexible">Flexible</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsCreatingCircleOpen(false)}
                  className="px-4 py-2 text-[var(--text-secondary)] text-xs font-semibold hover:bg-[var(--bg-surface-inset)] rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingCircleSubmitting}
                  className="px-5 py-2 bg-brand-gold text-white text-xs font-semibold rounded-xl hover:bg-brand-brown disabled:opacity-50"
                >
                  {isCreatingCircleSubmitting ? 'Creating...' : 'Create & Join Circle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-[120] flex items-end sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-[var(--bg-surface)] rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-xl border border-stone-200 text-center">
            <Trash2 className="w-10 h-10 text-red-600 mx-auto" />
            <h3 className="font-serif font-bold text-lg text-[var(--text-primary)]">Delete {deleteTarget.type}?</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Are you sure you want to delete this {deleteTarget.type}? This action cannot be undone.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-[var(--text-secondary)] text-xs font-semibold hover:bg-[var(--bg-surface-inset)] rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                className="px-5 py-2 bg-red-600 text-white text-xs font-semibold rounded-xl hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
