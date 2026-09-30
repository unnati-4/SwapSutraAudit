import React, { useState, useRef, useEffect } from 'react';
import { shareLink, siteUrl } from '../utils/share';
import ShareSheet from './ShareSheet';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Book, Users, MoreVertical, Search, MessageSquare, Info,
  TrendingUp, Paperclip, Star, Smile, Mic, Send, Play, Pause, Plus,
  CheckCheck, AlertTriangle, X, Camera, Feather, Loader, Trash2, Share2, BookOpen,
  LogOut, PauseCircle, Archive
} from 'lucide-react';

export interface DedicatedCurrentReadChatProps {
  circle: any;
  currentUser: any;
  onBack: () => void;
  onSendMessage: (text: string, isSpoiler: boolean, attachedImage: any) => Promise<void>;
  onSendRichMessage: (type: string, data: any, isSpoiler?: boolean) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onLeaveCircle?: (circleId: string) => Promise<void>;
  onEndCircle?: (circleId: string) => Promise<void>;
  onArchiveCircle?: (circleId: string) => Promise<void>;
  onViewProfile: (userData: any) => void;
  onRequestBook: (bookTitle: string, author?: string) => void;
  onNavigateToTab: (tab: string) => void;
  submitting: boolean;
  API_URL: string;
}

export const DedicatedCurrentReadChat: React.FC<DedicatedCurrentReadChatProps> = ({
  circle,
  currentUser,
  onBack,
  onSendMessage,
  onSendRichMessage,
  onDeleteMessage,
  onLeaveCircle,
  onEndCircle,
  onArchiveCircle,
  onViewProfile,
  onRequestBook,
  onNavigateToTab,
  submitting
}) => {
  // Navigation & View State
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'members' | 'about' | 'progress' | 'resources' | 'pinned'>('chat');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);

  // Form Input State
  const [messageText, setMessageText] = useState('');
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [attachedImage, setAttachedImage] = useState<{ file: File; base64: string } | null>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  
  // Interactive Overlays & Spoilers
  const [revealedSpoilers, setRevealedSpoilers] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  // Invites: with the book's cover attached when the circle has one.
  const [inviteShareOpen, setInviteShareOpen] = useState(false);
  const [inviteNote, setInviteNote] = useState('');
  const invitePayload = () => {
    const id = circle?.id || circle?.circle_id;
    return {
      title: 'Join my reading circle',
      text: `I'm reading "${circle?.bookTitle || 'a book'}" with a small group on SwapSutra — join the circle and read along with us!`,
      url: siteUrl(`/readers-circle/${encodeURIComponent(id)}`),
    };
  };
  const inviteReaders = async () => {
    if (circle?.coverUrl) { setInviteShareOpen(true); return; }
    const r = await shareLink(invitePayload());
    if (r === 'copied') {
      setInviteNote('Invite link copied — paste it in WhatsApp or anywhere to invite readers.');
      window.setTimeout(() => setInviteNote(''), 3000);
    }
  };
  
  // Voice Recording & Audio State
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  // Modals for Lifecycle & Actions
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [quoteForm, setQuoteForm] = useState({ quote: '', author: '' });
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [actionProcessing, setActionProcessing] = useState(false);

  // DOM Refs & Media Stream
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Voice recording timer
  useEffect(() => {
    let interval: any = null;
    if (isRecordingVoice) {
      setRecordingSeconds(0);
      interval = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecordingVoice]);

  // Auto scroll to bottom when messages update
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  };

  useEffect(() => {
    scrollToBottom('auto');
  }, [circle?.id]);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [circle?.messages?.length]);

  const normalizeBookImageUrl = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://images.unsplash.com/photo-1544947950-fa07a98d237f?q=80&w=400&auto=format&fit=crop`;
  };

  const handleVoiceRecordToggle = async () => {
    if (isRecordingVoice) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecordingVoice(false);
    } else {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          alert('Voice recording is not supported in this browser.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = () => {
            onSendRichMessage('audio', {
              base64: reader.result as string,
              size: `${recordingSeconds || 1}s`
            }, isSpoiler);
          };
          reader.readAsDataURL(audioBlob);
          stream.getTracks().forEach(t => t.stop());
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecordingVoice(true);
      } catch (err) {
        console.error('Mic access error:', err);
        alert('Microphone access was denied or is unavailable. Please check browser permissions.');
      }
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageText.trim() && !attachedImage) return;

    const txt = messageText;
    const sp = isSpoiler;
    const img = attachedImage;

    setMessageText('');
    setIsSpoiler(false);
    setAttachedImage(null);
    setShowEmojiPicker(false);
    setShowAttachmentMenu(false);

    await onSendMessage(txt, sp, img);
    setTimeout(() => scrollToBottom('smooth'), 100);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('Image size exceeds 10MB limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAttachedImage({ file, base64: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const handleDocumentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase() || 'file';
    const reader = new FileReader();
    reader.onload = async () => {
      await onSendRichMessage(ext, {
        name: file.name,
        size: `${(file.size / 1024).toFixed(0)} KB`,
        base64: reader.result as string
      }, isSpoiler);
    };
    reader.readAsDataURL(file);
  };

  const insertEmoji = (char: string) => {
    setMessageText(prev => prev + char);
  };

  const membersList = circle?.members || [];
  const messagesList = circle?.messages || [];
  const readerCount = membersList.length > 0 ? membersList.length : (circle?.readerCount || 0);

  const isEnded = String(circle?.status || '').toLowerCase() === 'ended';
  const isArchived = String(circle?.status || '').toLowerCase() === 'archived';

  const userEmail = (currentUser?.email || currentUser?.id || '').toLowerCase();
  const creatorEmail = (circle?.createdByUserId || circle?.created_by_user_id || '').toLowerCase();
  const isCreator = Boolean((creatorEmail && creatorEmail === userEmail) || currentUser?.isAdmin);
  const isMember = Boolean(membersList.some((m: any) => (m.userId || m.user_id || m.email || m.id || '').toLowerCase() === userEmail));

  // REAL DATA ONLY: Derive last active timestamp from latest message
  const lastMessage = messagesList.length > 0 ? messagesList[messagesList.length - 1] : null;
  const lastActiveText = lastMessage?.createdAt 
    ? new Date(lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Active Today';

  // Filter messages by search if search query is present
  const filteredMessages = searchQuery.trim()
    ? messagesList.filter((m: any) => (m.message || '').toLowerCase().includes(searchQuery.toLowerCase()) || (m.firstName || m.userName || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : messagesList;

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[var(--bg-page)] text-[var(--text-primary)] overflow-hidden relative font-sans">
      
      {inviteShareOpen && (
        <ShareSheet
          heading="Invite readers"
          {...invitePayload()}
          images={[normalizeBookImageUrl(circle?.coverUrl)].filter(Boolean)}
          onClose={() => setInviteShareOpen(false)}
        />
      )}
      {inviteNote && (
        <div role="status" className="fixed left-1/2 top-20 z-[130] -translate-x-1/2 rounded-full bg-brand-brown px-4 py-2 text-xs font-semibold text-brand-offwhite shadow-lg">
          {inviteNote}
        </div>
      )}

      {/* ================= 1. HEADER (RESPONSIVE: CLEAN MOBILE & FULL DESKTOP) ================= */}
      
      {/* MOBILE HEADER */}
      <div className="flex md:hidden items-center justify-between w-full px-3 py-2.5 bg-[var(--bg-surface)] border-b border-[#E5DEC9] z-30 shrink-0 shadow-2xs text-left">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-full hover:bg-[var(--bg-surface-inset)] text-[var(--text-secondary)] transition-colors shrink-0"
            aria-label="Back to circles"
          >
            <ArrowLeft size={18} className="stroke-[2.5]" />
          </button>

          {/* Book Cover */}
          <div className="h-10 w-7 rounded border border-[#D5CBB3] bg-[var(--bg-surface-inset)] flex-shrink-0 overflow-hidden shadow-2xs relative">
            {circle?.coverUrl ? (
              <img src={normalizeBookImageUrl(circle.coverUrl)} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[var(--text-accent)]"><Book size={14} /></div>
            )}
          </div>

          {/* Title, Author, Reader Count */}
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-sm font-bold text-[var(--text-primary)] leading-snug truncate">
              {circle?.bookTitle || 'White Nights'}
            </h1>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] truncate">
              <span className="truncate">{circle?.author || 'Fyodor Dostoevsky'}</span>
              <span className="text-[var(--text-muted)]">•</span>
              <span className="font-bold text-[var(--text-primary)] shrink-0">{readerCount} Readers</span>
            </div>
          </div>
        </div>

        {/* Invite readers (share sheet on phones, copied link elsewhere) */}
        <button
          type="button"
          onClick={() => { inviteReaders(); }}
          className="p-2 rounded-full hover:bg-[var(--bg-surface-inset)] text-[var(--text-accent)] shrink-0"
          aria-label="Invite readers to this circle"
          title="Invite readers"
        >
          <Share2 size={19} />
        </button>

        {/* Mobile Menu Action */}
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="p-2 rounded-full hover:bg-[var(--bg-surface-inset)] text-[var(--text-secondary)] shrink-0"
          aria-label="Open discussion menu"
          title="Menu"
        >
          <MoreVertical size={20} />
        </button>
      </div>

      {/* DESKTOP HEADER */}
      <header className="hidden md:flex h-[72px] shrink-0 border-b border-[#E5DEC9] bg-[var(--bg-surface)] px-6 items-center justify-between z-30 shadow-2xs text-left">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-full hover:bg-[var(--bg-surface-inset)] text-[var(--text-secondary)] transition-colors shrink-0"
            aria-label="Back to Circles"
            title="Back to Circles"
          >
            <ArrowLeft size={20} className="stroke-[2.5]" />
          </button>

          <div className="h-12 w-9 rounded-md border border-[#D5CBB3] bg-[var(--bg-surface-inset)] flex-shrink-0 overflow-hidden shadow-2xs relative">
            {circle?.coverUrl ? (
              <img src={normalizeBookImageUrl(circle.coverUrl)} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[var(--text-accent)]"><Book size={16} /></div>
            )}
          </div>

          <div className="min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-base font-bold text-[var(--text-primary)] leading-tight truncate max-w-sm">
                {circle?.bookTitle || 'White Nights'}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider bg-[var(--bg-surface-inset)] text-[var(--text-accent)] border border-[#E8D5C0] shrink-0">
                Current Read Group
              </span>
              {isEnded && (
                <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                  Ended (Read Only)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] truncate mt-0.5">
              <span className="font-medium truncate">{circle?.author || 'Fyodor Dostoevsky'}</span>
              <span className="text-[var(--text-muted)]">•</span>
              <span className="flex items-center gap-1 font-semibold text-[var(--text-primary)] shrink-0">
                <Users size={12} className="text-[#8B5EE3]" /> {readerCount} Readers
              </span>
              {/* ONLY display online count if real-time presence system actually provides it */}
              {circle?.onlineCount !== undefined && typeof circle?.onlineCount === 'number' && circle.onlineCount <= readerCount && (
                <span className="flex items-center gap-1 font-semibold text-[#2E7D32] shrink-0">
                  <span className="w-2 h-2 rounded-full bg-[#2E7D32] animate-pulse"></span> {circle.onlineCount} Online
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => { inviteReaders(); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1.5 text-xs font-semibold text-[var(--text-accent)] hover:border-brand-gold"
            aria-label="Invite readers to this circle"
          >
            <Share2 size={14} /> Invite
          </button>
          <button
            type="button"
            onClick={() => setShowSearchInput(prev => !prev)}
            className="p-2 rounded-full hover:bg-[var(--bg-surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Search messages"
            title="Search Messages"
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab('members')}
            className="p-2 rounded-full hover:bg-[var(--bg-surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="View group members"
            title="Group Members"
          >
            <Users size={18} />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMenu(prev => !prev)}
              className="p-2 rounded-full hover:bg-[var(--bg-surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="More options"
              title="More options"
            >
              <MoreVertical size={18} />
            </button>

            <AnimatePresence>
              {showMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  className="absolute right-0 mt-2 w-56 rounded-2xl border border-[#E5DEC9] bg-[var(--bg-surface)] p-2 shadow-xl z-50 text-xs text-[var(--text-primary)] text-left"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      setSidebarTab('members');
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-surface-inset)] text-[var(--text-primary)] font-medium"
                  >
                    <Users size={15} className="text-[var(--text-accent)]" />
                    <span>View Readers ({readerCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      onRequestBook(circle?.bookTitle, circle?.author);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-surface-inset)] text-[var(--text-primary)] font-medium"
                  >
                    <BookOpen size={15} className="text-[var(--text-accent)]" />
                    <span>Request Physical Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowMenu(false); inviteReaders(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-surface-inset)] text-[var(--text-primary)] font-medium"
                  >
                    <Share2 size={15} className="text-[var(--text-accent)]" />
                    <span>Invite Readers</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Search Input Bar */}
      {showSearchInput && (
        <div className="bg-[var(--bg-surface)] border-b border-[#E5DEC9] px-4 py-2 flex items-center gap-2 shrink-0 z-20">
          <Search size={16} className="text-[var(--text-secondary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search discussion messages..."
            className="flex-1 text-xs bg-transparent border-0 outline-none focus:ring-0 text-[var(--text-primary)]"
            autoFocus
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-xs text-[var(--text-secondary)] font-bold">Clear</button>
          )}
          <button onClick={() => setShowSearchInput(false)} className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="Close search">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ================= 2. MAIN BODY LAYOUT ================= */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        
        {/* --- DESKTOP LEFT SIDEBAR (Width constrained to 240px, non-disruptive) --- */}
        <aside className="hidden md:flex flex-col w-[240px] border-r border-[#E5DEC9] bg-[var(--bg-page)] p-4 shrink-0 overflow-y-auto text-left select-none">
          
          {/* GROUP MENU SECTION */}
          <div className="mb-5">
            <h2 className="text-2xs font-bold uppercase tracking-eyebrow text-[#8B5EE3] mb-2.5">
              CURRENT READ
            </h2>
            <nav className="space-y-1">
              {[
                { id: 'chat', label: 'Chat', icon: <MessageSquare size={16} /> },
                { id: 'members', label: 'Members', icon: <Users size={16} /> },
                { id: 'about', label: 'About', icon: <Info size={16} /> },
                { id: 'progress', label: 'Reading Progress', icon: <TrendingUp size={16} /> },
                { id: 'resources', label: 'Resources', icon: <Paperclip size={16} /> },
                { id: 'pinned', label: 'Pinned Messages', icon: <Star size={16} /> }
              ].map((item) => {
                const isActive = sidebarTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSidebarTab(item.id as any)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-[var(--bg-surface-inset)] text-[var(--text-accent)] shadow-2xs'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80 hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span className={isActive ? 'text-[var(--text-accent)]' : 'text-[var(--text-secondary)]'}>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* LIFECYCLE ACTION BUTTONS (Leave / End / Archive) */}
          <div className="mb-5 pt-3 border-t border-[#E5DEC9]/80 space-y-1.5">
            {isMember && !isCreator && (
              <button
                type="button"
                onClick={() => setShowLeaveModal(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-red-700 bg-red-50/80 hover:bg-red-100 transition-all border border-red-200/60"
                title="Leave Current Read"
              >
                <LogOut size={15} />
                <span>Leave Current Read</span>
              </button>
            )}

            {isCreator && !isEnded && (
              <button
                type="button"
                onClick={() => setShowEndModal(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-amber-800 bg-amber-50/80 hover:bg-amber-100 transition-all border border-amber-200/60"
                title="End Current Read"
              >
                <PauseCircle size={15} />
                <span>End Current Read</span>
              </button>
            )}

            {isCreator && (
              <button
                type="button"
                onClick={() => setShowArchiveModal(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 transition-all border border-stone-200"
                title="Archive Group"
              >
                <Archive size={15} />
                <span>Archive Circle</span>
              </button>
            )}
          </div>

          {/* CHAT SUMMARY (REAL DATA DERIVED ONLY) */}
          <div className="mt-auto pt-3 border-t border-[#E5DEC9]/80">
            <h2 className="text-2xs font-bold uppercase tracking-eyebrow text-[#8B5EE3] mb-2.5">
              CHAT SUMMARY
            </h2>
            <div className="space-y-2 text-xs text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[#E5DEC9] p-3 rounded-2xl shadow-2xs">
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-secondary)] font-medium text-xs">Readers</span>
                <span className="font-bold text-[var(--text-accent)]">{readerCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-secondary)] font-medium text-xs">Messages</span>
                <span className="font-bold text-[var(--text-primary)]">{messagesList.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-secondary)] font-medium text-xs">Last Active</span>
                <span className="font-semibold text-[#2E7D32]">{lastActiveText}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* --- MOBILE GROUP DRAWER --- */}
        <AnimatePresence>
          {mobileSidebarOpen && (
            <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileSidebarOpen(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-2xs"
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                className="relative bg-[var(--bg-page)] border-t border-[#E5DEC9] rounded-t-3xl p-5 shadow-2xl max-h-[85dvh] overflow-y-auto z-10 text-left"
              >
                <div className="w-12 h-1.5 bg-[#D5CBB3] rounded-full mx-auto mb-4" />
                <div className="flex items-center justify-between pb-3 border-b border-[#E5DEC9] mb-4">
                  <div className="min-w-0">
                    <h2 className="font-serif font-bold text-base text-[var(--text-primary)] truncate">{circle?.bookTitle}</h2>
                    <p className="text-xs text-[var(--text-secondary)]">{readerCount} Readers enrolled</p>
                  </div>
                  <button onClick={() => setMobileSidebarOpen(false)} className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="Close menu">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-2 mb-6">
                  {[
                    { id: 'chat', label: 'Discussion Chat', icon: <MessageSquare size={18} /> },
                    { id: 'members', label: `Group Members (${readerCount})`, icon: <Users size={18} /> },
                    { id: 'about', label: 'About Book & Circle', icon: <Info size={18} /> },
                    { id: 'progress', label: 'Reading Schedule', icon: <TrendingUp size={18} /> },
                    { id: 'resources', label: 'Shared Resources', icon: <Paperclip size={18} /> },
                    { id: 'pinned', label: 'Pinned Highlights', icon: <Star size={18} /> }
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSidebarTab(item.id as any);
                        setMobileSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl text-xs font-bold transition-colors ${
                        sidebarTab === item.id ? 'bg-[var(--bg-surface-inset)] text-[var(--text-accent)]' : 'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[#E5DEC9]'
                      }`}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>

                <div className="pt-3 border-t border-[#E5DEC9] space-y-2">
                  {isMember && !isCreator && (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileSidebarOpen(false);
                        setShowLeaveModal(true);
                      }}
                      className="w-full py-2.5 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
                    >
                      <LogOut size={16} />
                      <span>Leave Current Read</span>
                    </button>
                  )}

                  {isCreator && !isEnded && (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileSidebarOpen(false);
                        setShowEndModal(true);
                      }}
                      className="w-full py-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
                    >
                      <PauseCircle size={16} />
                      <span>End Current Read</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMobileSidebarOpen(false);
                      onRequestBook(circle?.bookTitle, circle?.author);
                    }}
                    className="w-full py-3 bg-[#5C3A21] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <BookOpen size={16} />
                    <span>Request Physical Book Copy</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* --- MAIN CHAT AREA --- */}
        <main className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-page)] relative text-left">
          
          {/* TAB PANELS: If user selected non-chat tab */}
          {sidebarTab !== 'chat' ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-3xl mx-auto w-full text-left">
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={() => setSidebarTab('chat')}
                  className="flex items-center gap-2 text-xs font-bold text-[var(--text-accent)] hover:underline"
                >
                  <ArrowLeft size={16} /> Back to Discussion Chat
                </button>
                <span className="text-xs font-bold uppercase tracking-wider text-[#8B5EE3]">
                  {sidebarTab}
                </span>
              </div>

              {/* MEMBERS VIEW */}
              {sidebarTab === 'members' && (
                <div className="bg-[var(--bg-surface)] border border-[#E5DEC9] rounded-2xl p-5 shadow-2xs space-y-4">
                  <h3 className="font-serif text-lg font-bold text-[var(--text-primary)]">Circle Readers ({readerCount})</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {membersList.map((member: any) => (
                      <div
                        key={member.id || member.userId || member.user_id || member.firstName}
                        onClick={() => onViewProfile(member)}
                        className="flex items-center gap-3 p-3 rounded-xl border border-[#E5DEC9] bg-[var(--bg-page)] hover:bg-[var(--bg-surface-inset)] cursor-pointer transition-colors"
                      >
                        <div className="w-10 h-10 rounded-full bg-[#5C3A21] text-white flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden">
                          {member.avatarUrl ? (
                            <img src={member.avatarUrl} alt={member.firstName} className="w-full h-full object-cover" />
                          ) : (
                            member.firstName?.charAt(0) || 'R'
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-xs text-[var(--text-primary)] truncate">{member.firstName || member.user_name || 'Reader'}</p>
                          <p className="text-2xs text-[var(--text-secondary)] truncate">{member.city || 'Member'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ABOUT VIEW */}
              {sidebarTab === 'about' && (
                <div className="bg-[var(--bg-surface)] border border-[#E5DEC9] rounded-2xl p-5 shadow-2xs space-y-4">
                  <h3 className="font-serif text-lg font-bold text-[var(--text-primary)]">About "{circle?.bookTitle || 'White Nights'}"</h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Written by {circle?.author || 'Fyodor Dostoevsky'}, this Current Read Group brings together readers to discuss character arcs, themes, and personal reflections chapter by chapter.
                  </p>
                  <div className="pt-3 border-t border-[#E5DEC9] flex items-center gap-4 text-xs font-bold text-[var(--text-accent)]">
                    <span>📖 Total Readers: {readerCount}</span>
                  </div>
                </div>
              )}

              {/* READING PROGRESS VIEW */}
              {sidebarTab === 'progress' && (
                <div className="bg-[var(--bg-surface)] border border-[#E5DEC9] rounded-2xl p-5 shadow-2xs space-y-4">
                  <h3 className="font-serif text-lg font-bold text-[var(--text-primary)]">Reading Schedule</h3>
                  <div className="p-3.5 border border-[#E5DEC9] rounded-xl bg-[var(--bg-page)]">
                    <span className="text-2xs font-black uppercase tracking-wider text-[#2E7D32]">Current Goal</span>
                    <p className="font-bold text-xs text-[var(--text-primary)] mt-0.5">Chapters 1–4</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">Read and share reflections on chapter highlights with fellow circle members.</p>
                  </div>
                </div>
              )}

              {/* RESOURCES VIEW */}
              {sidebarTab === 'resources' && (
                <div className="bg-[var(--bg-surface)] border border-[#E5DEC9] rounded-2xl p-5 shadow-2xs space-y-4">
                  <h3 className="font-serif text-lg font-bold text-[var(--text-primary)]">Group Resources</h3>
                  <p className="text-xs text-[var(--text-secondary)]">No external documents attached yet. Share files using the (+) button in chat!</p>
                </div>
              )}

              {/* PINNED MESSAGES VIEW */}
              {sidebarTab === 'pinned' && (
                <div className="bg-[var(--bg-surface)] border border-[#E5DEC9] rounded-2xl p-5 shadow-2xs space-y-4">
                  <h3 className="font-serif text-lg font-bold text-[var(--text-primary)]">Pinned Highlights</h3>
                  <div className="p-3.5 border border-[#E5DEC9] bg-[var(--bg-surface-inset)] rounded-xl text-xs">
                    <p className="font-serif italic text-[var(--text-primary)]">“A room without books is like a body without a soul.”</p>
                    <p className="text-2xs text-[var(--text-accent)] font-bold text-right mt-1.5">— Cicero</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* --- SCROLLABLE CHAT MESSAGES AREA --- */
            <div
              ref={chatContainerRef}
              className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4 scroll-smooth"
            >
              {/* READ-ONLY BANNER IF GROUP IS ENDED */}
              {isEnded && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-center text-xs text-amber-900 font-medium shrink-0 flex items-center justify-center gap-2">
                  <AlertTriangle size={16} className="text-amber-700" />
                  <span>This Current Read has ended. The historical chat remains accessible in read-only mode.</span>
                </div>
              )}

              {/* Centered Date Pill */}
              <div className="flex items-center justify-center my-2">
                <span className="px-3 py-1 bg-[var(--bg-surface-inset)]/60 text-[var(--text-accent)] rounded-full text-2xs sm:text-xs font-bold uppercase tracking-wider">
                  Today
                </span>
              </div>

              {/* Message Items */}
              {filteredMessages.length > 0 ? (
                filteredMessages.map((message: any) => {
                  const isMe = String(message.userId || message.senderEmail || message.user_id || '').toLowerCase() === userEmail;
                  const isSystem = message.firstName === 'SwapSutra' || message.userName === 'SwapSutra' || message.isSystem;
                  const isRevealed = revealedSpoilers.includes(message.id || message.message_id);

                  if (isSystem || message.type === 'system_join') {
                    return (
                      <div key={message.id || message.message_id} className="flex justify-center my-2.5">
                        <span className="px-3.5 py-1.5 bg-[#E8F5E9] text-[#2E7D32] border border-[#A5D6A7] rounded-full text-xs font-semibold shadow-2xs flex items-center gap-2">
                          <span>{message.message || `${message.firstName || 'A reader'} joined the group`}</span>
                        </span>
                      </div>
                    );
                  }

                  let isAudio = message.type === 'audio';
                  let audioData: any = null;
                  let isQuote = message.type === 'quote';
                  let quoteData: any = null;

                  const rawMsg = message.message || '';
                  if (typeof rawMsg === 'string' && rawMsg.trim().startsWith('{')) {
                    try {
                      const parsed = JSON.parse(rawMsg.trim());
                      if (parsed && typeof parsed === 'object') {
                        if (parsed.type === 'audio' || parsed.audioUrl || parsed.size) {
                          isAudio = true;
                          audioData = parsed;
                        } else if (parsed.type === 'quote') {
                          isQuote = true;
                          quoteData = parsed;
                        }
                      }
                    } catch (e) {
                      // fallback text
                    }
                  } else if (typeof rawMsg === 'object' && rawMsg !== null) {
                    if (rawMsg.type === 'audio') { isAudio = true; audioData = rawMsg; }
                    else if (rawMsg.type === 'quote') { isQuote = true; quoteData = rawMsg; }
                  }

                  return (
                    <div
                      key={message.id || message.message_id}
                      className={`flex items-start gap-2.5 max-w-[85%] sm:max-w-[75%] group relative ${
                        isMe ? 'self-end ml-auto flex-row-reverse' : 'self-start mr-auto'
                      }`}
                    >
                      {/* Avatar */}
                      <div
                        onClick={() => !isMe && onViewProfile(message)}
                        className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden cursor-pointer select-none shadow-2xs ${
                          isMe ? 'bg-[#5C3A21] text-white' : 'bg-[var(--bg-surface-inset)] text-[var(--text-primary)]'
                        }`}
                      >
                        {message.avatarUrl ? (
                          <img src={message.avatarUrl} alt={message.firstName} className="w-full h-full object-cover" />
                        ) : (
                          (message.firstName || message.user_name || 'R').charAt(0)
                        )}
                      </div>

                      {/* Message Bubble Container */}
                      <div className="flex-1 flex flex-col min-w-0">
                        {!isMe && (
                          <span className="text-xs font-bold text-[var(--text-accent)] mb-0.5 pl-1">
                            {message.firstName || message.user_name || message.userName || 'Reader'}
                          </span>
                        )}

                        <div
                          className={`relative rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-2xs border text-xs sm:text-sm leading-relaxed ${
                            isMe
                              ? 'bg-[var(--bg-surface-inset)] text-[var(--text-primary)] border-[#E8D5C0] rounded-tr-xs'
                              : 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[#E5DEC9] rounded-tl-xs'
                          }`}
                        >
                          {/* Render Voice Note Audio Player */}
                          {isAudio ? (
                            <div className="flex items-center gap-3 p-2 bg-[var(--bg-page)] rounded-xl border border-[#E5DEC9] min-w-[190px] sm:min-w-[220px]">
                              <button
                                type="button"
                                onClick={() => setPlayingAudioId(playingAudioId === (message.id || message.message_id) ? null : (message.id || message.message_id))}
                                className="w-8 h-8 rounded-full bg-[#5C3A21] text-white flex items-center justify-center shrink-0 hover:bg-[#4A2E18] transition-colors"
                                aria-label="Play audio"
                              >
                                {playingAudioId === (message.id || message.message_id) ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1 h-4">
                                  {[4, 10, 16, 8, 12, 18, 10, 6, 14, 9, 5, 12, 7, 4].map((h, idx) => (
                                    <div
                                      key={idx}
                                      className={`flex-1 rounded-full transition-all ${
                                        playingAudioId === (message.id || message.message_id) ? 'bg-[#8B5EE3] animate-pulse' : 'bg-[#C4B8A5]'
                                      }`}
                                      style={{ height: `${h}px` }}
                                    />
                                  ))}
                                </div>
                                <div className="flex items-center justify-between text-2xs text-[var(--text-secondary)] font-bold mt-1">
                                  <span>Voice Note</span>
                                  <span>{audioData?.size || '0:02'}</span>
                                </div>
                              </div>
                            </div>
                          ) : isQuote ? (
                            /* Quote Card */
                            <div className="p-3 bg-[var(--bg-surface-inset)] border border-amber-200 rounded-xl">
                              <p className="font-serif italic font-bold text-[var(--text-primary)]">“{quoteData?.quote}”</p>
                              {quoteData?.author && <p className="text-2xs text-[var(--text-accent)] font-bold text-right mt-1">— {quoteData.author}</p>}
                            </div>
                          ) : (message.isSpoiler || message.is_spoiler === 'TRUE') && !isRevealed ? (
                            /* Spoiler Card */
                            <div className="p-2 bg-[#FFF3E0] border border-[#FFE0B2] rounded-xl flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-[#B45309]">
                                <AlertTriangle size={16} />
                                <span className="font-bold text-xs">Spoiler Content</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setRevealedSpoilers(prev => [...prev, message.id || message.message_id])}
                                className="px-2.5 py-1 bg-[#B45309] text-white text-2xs font-bold uppercase rounded-lg hover:bg-[#8C3E05]"
                              >
                                Reveal
                              </button>
                            </div>
                          ) : (
                            /* Clean Text Bubble */
                            <p className="whitespace-pre-wrap break-words font-normal text-[var(--text-primary)]">
                              {message.message}
                            </p>
                          )}

                          {/* Image Attachment */}
                          {message.imageUrl && (
                            <div className="mt-2 rounded-xl overflow-hidden border border-[#E5DEC9]">
                              <img src={message.imageUrl} alt="Attachment" className="max-h-60 w-full object-cover" />
                            </div>
                          )}

                          {/* Timestamp & Read Receipt */}
                          <div className={`flex items-center gap-1.5 mt-1 text-2xs text-[var(--text-secondary)] ${isMe ? 'justify-end' : 'justify-start'}`}>
                            <span>{message.createdAt || message.created_at ? new Date(message.createdAt || message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today'}</span>
                            {isMe && <CheckCheck size={13} className="text-[#2E7D32]" />}
                            {isMe && (
                              <button
                                type="button"
                                onClick={() => onDeleteMessage(message.id || message.message_id)}
                                className="ml-1 text-[var(--text-secondary)] hover:text-red-600 transition-colors p-0.5"
                                aria-label="Delete message"
                                title="Delete Message"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12 text-[var(--text-secondary)]">
                  <MessageSquare size={36} className="mx-auto mb-2 text-[var(--text-accent)] opacity-50" />
                  <p className="font-serif text-lg font-bold text-[var(--text-primary)]">Start the Discussion</p>
                  <p className="text-xs mt-1">Share your thoughts on the latest chapter below!</p>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* ================= 3. ANCHORED CHAT COMPOSER ================= */}
          {isEnded || isArchived ? (
            <footer className="shrink-0 border-t border-[#E5DEC9] bg-[var(--bg-surface)] px-4 py-3 z-30 shadow-lg text-center">
              <div className="w-full max-w-xl mx-auto py-2.5 px-4 bg-[var(--bg-surface-inset)] border border-[#E8D5C0] rounded-full text-xs font-bold text-[var(--text-accent)] flex items-center justify-center gap-2">
                <PauseCircle size={16} />
                <span>This Current Read group has ended. Messages are read-only.</span>
              </div>
            </footer>
          ) : (
            <footer className="shrink-0 border-t border-[#E5DEC9] bg-[var(--bg-surface)] px-3 py-2.5 sm:px-6 sm:py-3.5 z-30 shadow-lg text-left relative">
              
              {/* Popovers Backdrop */}
              {(showAttachmentMenu || showEmojiPicker) && (
                <div
                  className="fixed inset-0 z-40 bg-black/5"
                  onClick={() => {
                    setShowAttachmentMenu(false);
                    setShowEmojiPicker(false);
                  }}
                />
              )}

              {/* LIVE VOICE RECORDING FEEDBACK BAR */}
              {isRecordingVoice && (
                <div className="mb-2 p-2.5 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-between gap-3 text-xs z-50 relative">
                  <div className="flex items-center gap-2 font-bold text-red-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                    <span>Recording Voice Note: 00:{recordingSeconds < 10 ? `0${recordingSeconds}` : recordingSeconds}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleVoiceRecordToggle}
                      className="px-3 py-1 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 text-xs"
                    >
                      Stop & Send
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (mediaRecorderRef.current) {
                          mediaRecorderRef.current.onstop = null;
                          mediaRecorderRef.current.stop();
                        }
                        setIsRecordingVoice(false);
                      }}
                      className="px-2 py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* ANCHORED ATTACHMENT MENU */}
              <AnimatePresence>
                {showAttachmentMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-3 sm:left-6 mb-2 bg-[var(--bg-surface)] border border-[#E5DEC9] p-2.5 rounded-2xl shadow-xl w-64 sm:w-72 grid grid-cols-3 gap-2 z-50 text-left"
                  >
                    {[
                      { id: 'camera', name: 'Photo', icon: <Camera size={16} />, color: 'bg-teal-100 text-teal-900' },
                      { id: 'file', name: 'Document', icon: <Paperclip size={16} />, color: 'bg-neutral-100 text-[var(--text-primary)]' },
                      { id: 'voice', name: 'Voice Note', icon: <Mic size={16} />, color: 'bg-purple-100 text-purple-900' },
                      { id: 'quote', name: 'Quote Card', icon: <Feather size={16} />, color: 'bg-amber-100 text-[#5C3A21]' }
                    ].map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setShowAttachmentMenu(false);
                          if (item.id === 'file') docInputRef.current?.click();
                          else if (item.id === 'camera') fileInputRef.current?.click();
                          else if (item.id === 'voice') handleVoiceRecordToggle();
                          else setActiveModal(item.id);
                        }}
                        className="flex flex-col items-center gap-1 p-2 rounded-xl border border-[#E5DEC9] hover:bg-[var(--bg-surface-inset)] transition-colors"
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${item.color}`}>{item.icon}</div>
                        <span className="text-2xs font-bold text-[var(--text-primary)]">{item.name}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ANCHORED EMOJI PICKER */}
              <AnimatePresence>
                {showEmojiPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-10 sm:left-14 mb-2 z-50 w-64 sm:w-72 rounded-2xl border border-[#E5DEC9] bg-[var(--bg-surface)] p-3 shadow-xl text-left"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-accent)]">Choose Emoji</span>
                      <button onClick={() => setShowEmojiPicker(false)} className="p-1 text-[var(--text-secondary)]" aria-label="Close emoji picker">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-6 gap-1 max-h-40 overflow-y-auto">
                      {['😀', '😂', '😊', '😍', '🥰', '😎', '🤔', '😭', '👍', '❤️', '✨', '⭐', '🎉', '🙌', '📚', '📖', '📕', '☕'].map(em => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => insertEmoji(em)}
                          className="h-8 w-8 rounded-lg text-base hover:bg-[var(--bg-surface-inset)] flex items-center justify-center"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Hidden File Inputs */}
              <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageChange} />
              <input type="file" ref={docInputRef} className="hidden" onChange={handleDocumentChange} />

              {/* Input Bar */}
              <form onSubmit={handleSend} className="w-full max-w-4xl mx-auto flex items-center gap-1.5 sm:gap-2 bg-[var(--bg-page)] border border-[#E5DEC9] rounded-full px-2.5 py-1.5 focus-within:border-[#5C3A21] focus-within:bg-[var(--bg-surface)] transition-all shadow-2xs">
                
                {/* Attachment + Button */}
                <button
                  type="button"
                  onClick={() => {
                    setShowEmojiPicker(false);
                    setShowAttachmentMenu(prev => !prev);
                  }}
                  className="p-1.5 sm:p-2 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-inset)]/50 transition-colors shrink-0"
                  aria-label="Add attachment"
                  title="Attach"
                >
                  <Plus size={18} className="sm:w-5 sm:h-5" />
                </button>

                {/* Emoji 🙂 Button */}
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachmentMenu(false);
                    setShowEmojiPicker(prev => !prev);
                  }}
                  className="p-1.5 sm:p-2 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-inset)]/50 transition-colors shrink-0"
                  aria-label="Insert emoji"
                  title="Emoji"
                >
                  <Smile size={18} className="sm:w-5 sm:h-5" />
                </button>

                {/* Text Input Field */}
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type your message..."
                  className="flex-1 bg-transparent border-0 ring-0 focus:ring-0 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[#6B584A] outline-none px-1 sm:px-2 min-w-0"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />

                {/* Voice Button */}
                <button
                  type="button"
                  onClick={handleVoiceRecordToggle}
                  className={`p-1.5 sm:p-2 rounded-full shrink-0 transition-colors ${
                    isRecordingVoice ? 'bg-red-600 text-white animate-pulse' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-inset)]/50'
                  }`}
                  aria-label="Record voice note"
                  title="Record Voice Note"
                >
                  <Mic size={18} className="sm:w-5 sm:h-5" />
                </button>

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={submitting || (!messageText.trim() && !attachedImage)}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#5C3A21] text-white flex items-center justify-center shrink-0 hover:bg-[#4A2E18] active:scale-95 transition-all disabled:opacity-40 shadow-xs"
                  aria-label="Send message"
                  title="Send"
                >
                  {submitting ? <Loader size={14} className="animate-spin" /> : <Send size={15} className="ml-0.5 sm:w-4 sm:h-4" />}
                </button>
              </form>
            </footer>
          )}
        </main>
      </div>

      {/* LEAVE GROUP MODAL */}
      <AnimatePresence>
        {showLeaveModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[var(--bg-surface)] border border-[#E5DEC9] p-6 rounded-3xl shadow-2xl max-w-sm w-full space-y-4 text-left"
            >
              <h3 className="font-serif text-lg font-bold text-[var(--text-primary)]">Leave Current Read?</h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                You will no longer be able to participate in this group's discussion. Your previous messages will remain saved in the reading history.
              </p>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  disabled={actionProcessing}
                  className="flex-1 py-2.5 border border-[#E5DEC9] rounded-xl text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--bg-surface-inset)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionProcessing}
                  onClick={async () => {
                    if (!onLeaveCircle) return;
                    setActionProcessing(true);
                    try {
                      await onLeaveCircle(circle?.id || circle?.circle_id);
                    } finally {
                      setActionProcessing(false);
                      setShowLeaveModal(false);
                    }
                  }}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 flex items-center justify-center gap-1.5"
                >
                  {actionProcessing ? <Loader size={14} className="animate-spin" /> : 'Leave Group'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* END GROUP MODAL */}
      <AnimatePresence>
        {showEndModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[var(--bg-surface)] border border-[#E5DEC9] p-6 rounded-3xl shadow-2xl max-w-sm w-full space-y-4 text-left"
            >
              <h3 className="font-serif text-lg font-bold text-[var(--text-primary)]">End this Current Read?</h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                This will close the group for all readers. The conversation and reading history will be preserved, but members will no longer be able to send new messages or participate in the active group.
              </p>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEndModal(false)}
                  disabled={actionProcessing}
                  className="flex-1 py-2.5 border border-[#E5DEC9] rounded-xl text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--bg-surface-inset)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionProcessing}
                  onClick={async () => {
                    if (!onEndCircle) return;
                    setActionProcessing(true);
                    try {
                      await onEndCircle(circle?.id || circle?.circle_id);
                    } finally {
                      setActionProcessing(false);
                      setShowEndModal(false);
                    }
                  }}
                  className="flex-1 py-2.5 bg-amber-800 text-white rounded-xl text-xs font-bold hover:bg-amber-900 flex items-center justify-center gap-1.5"
                >
                  {actionProcessing ? <Loader size={14} className="animate-spin" /> : 'End Current Read'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ARCHIVE GROUP MODAL */}
      <AnimatePresence>
        {showArchiveModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[var(--bg-surface)] border border-[#E5DEC9] p-6 rounded-3xl shadow-2xl max-w-sm w-full space-y-4 text-left"
            >
              <h3 className="font-serif text-lg font-bold text-[var(--text-primary)]">Archive this Current Read?</h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                This will remove the group from active Current Read listings. Historical discussion data will remain preserved in the backend.
              </p>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowArchiveModal(false)}
                  disabled={actionProcessing}
                  className="flex-1 py-2.5 border border-[#E5DEC9] rounded-xl text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--bg-surface-inset)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionProcessing}
                  onClick={async () => {
                    if (!onArchiveCircle) return;
                    setActionProcessing(true);
                    try {
                      await onArchiveCircle(circle?.id || circle?.circle_id);
                    } finally {
                      setActionProcessing(false);
                      setShowArchiveModal(false);
                    }
                  }}
                  className="flex-1 py-2.5 bg-stone-800 text-white rounded-xl text-xs font-bold hover:bg-stone-900 flex items-center justify-center gap-1.5"
                >
                  {actionProcessing ? <Loader size={14} className="animate-spin" /> : 'Archive'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODALS FOR RICH COMPOSER */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--bg-surface)] border border-[#E5DEC9] p-5 sm:p-6 rounded-3xl shadow-2xl max-w-md w-full space-y-4 text-left">
              <div className="flex justify-between items-start">
                <h3 className="font-serif text-base sm:text-lg font-bold text-[var(--text-primary)]">
                  {activeModal === 'quote' && 'Share Quote Card'}
                </h3>
                <button onClick={() => setActiveModal(null)} className="p-1 text-[var(--text-secondary)]" aria-label="Close modal">
                  <X size={18} />
                </button>
              </div>

              {activeModal === 'quote' && (
                <div className="space-y-3">
                  <textarea
                    rows={3}
                    placeholder="Enter inspiring quote..."
                    value={quoteForm.quote}
                    onChange={(e) => setQuoteForm(p => ({ ...p, quote: e.target.value }))}
                    className="w-full p-3 rounded-xl border border-[#E5DEC9] text-xs text-[var(--text-primary)] outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Author Name"
                    value={quoteForm.author}
                    onChange={(e) => setQuoteForm(p => ({ ...p, author: e.target.value }))}
                    className="w-full p-2.5 rounded-xl border border-[#E5DEC9] text-xs text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!quoteForm.quote) return;
                      await onSendRichMessage('quote', quoteForm, isSpoiler);
                      setActiveModal(null);
                    }}
                    className="w-full py-3 bg-[#5C3A21] text-white rounded-xl text-xs font-bold"
                  >
                    Post Quote Card
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
