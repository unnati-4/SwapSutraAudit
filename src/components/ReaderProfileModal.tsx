import React, { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { AwardedBadges, type AwardedBadge } from './AwardedBadges';

// A single reader's public profile card, opened from "View this reader's
// profile" on a book detail page or from the reader directory below.
// Deliberately shows only privacy-safe fields (name, area, bio, genres,
// books-shared count, member-since year) -- matches the allowlist the
// backend's getPublicReaderProfile action already enforces server-side;
// this component has no opinion of its own about what to show beyond
// whatever the caller passes in as `profile`.

export interface ReaderPublicProfile {
  name?: string;
  area?: string;
  bio?: string;
  genres?: string;
  isActiveMember?: boolean;
  booksListedCount?: number;
  memberSince?: string;
  // Reputation — transparent, individually-labelled signals rather than
  // one blended score. completedSwapsCount/avgRating/ratingCount/badges
  // all come from the backend's publicReaderProfileFromUserRow, which
  // computes them from verified data (SwapRequests status, ReaderRatings
  // gated to a completed swap) — never from anything a reader can set on
  // their own profile.
  completedSwapsCount?: number;
  avgRating?: number;
  ratingCount?: number;
  badges?: string[];
  // Awarded by the SwapSutra team at a meetup, not computed.
  awardedBadges?: AwardedBadge[];
}

export interface ReaderProfileModalProps {
  email: string | null;
  profile: ReaderPublicProfile | null;
  loading: boolean;
  onClose: () => void;
}

export const ReaderProfileModal = memo(({ email, profile, loading, onClose }: ReaderProfileModalProps) => (
  <AnimatePresence>
    {email && (
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-brand-brown/50 backdrop-blur-md"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="surface-light night-modal bg-[var(--bg-page)] w-full max-w-md rounded-3xl p-8 sm:p-10 shadow-2xl relative z-10 border border-brand-border max-h-[85dvh] overflow-y-auto"
        >
          <button onClick={onClose} className="absolute top-6 right-6 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X size={22} />
          </button>
          {loading ? (
            <div className="py-16 text-center text-xs text-[var(--text-secondary)] uppercase tracking-widest">Loading reader...</div>
          ) : profile ? (
            <div className="space-y-6 text-center">
              <div className="w-20 h-20 rounded-full bg-brand-gold/10 border border-brand-gold/30 flex items-center justify-center mx-auto text-2xl font-serif text-brand-gold-text">
                {(profile.name || '?').charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="text-2xl font-serif text-[var(--text-primary)]">{profile.name}</h3>
                {profile.area && <p className="text-xs text-[var(--text-secondary)] mt-1">{profile.area}</p>}
                {profile.isActiveMember && (
                  <span className="inline-block mt-3 px-3 py-1 rounded-full text-2xs font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                    Verified Reader
                  </span>
                )}
              </div>
              {profile.bio && (
                <p className="text-sm text-[var(--text-secondary)] italic leading-relaxed">"{profile.bio}"</p>
              )}
              {profile.genres && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {String(profile.genres).split(',').map((g: string) => g.trim()).filter(Boolean).map((g: string, i: number) => (
                    <span key={i} className="px-3 py-1 rounded-full text-2xs font-bold uppercase tracking-wider bg-brand-gold/10 text-brand-gold-text border border-brand-gold/20">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-center gap-8 pt-6 border-t border-brand-border/30 flex-wrap">
                <div>
                  <p className="text-xl font-serif text-[var(--text-primary)]">{profile.booksListedCount}</p>
                  <p className="text-2xs text-[var(--text-secondary)] uppercase tracking-widest font-bold mt-1">Books Shared</p>
                </div>
                <div>
                  <p className="text-xl font-serif text-[var(--text-primary)]">{profile.completedSwapsCount ?? 0}</p>
                  <p className="text-2xs text-[var(--text-secondary)] uppercase tracking-widest font-bold mt-1">Completed Swaps</p>
                </div>
                {!!profile.ratingCount && (
                  <div>
                    <p className="text-xl font-serif text-[var(--text-primary)]">★ {profile.avgRating?.toFixed(1)}</p>
                    <p className="text-2xs text-[var(--text-secondary)] uppercase tracking-widest font-bold mt-1">{profile.ratingCount} Rating{profile.ratingCount === 1 ? '' : 's'}</p>
                  </div>
                )}
                {profile.memberSince && !isNaN(new Date(profile.memberSince).getTime()) && (
                  <div>
                    <p className="text-xl font-serif text-[var(--text-primary)]">{new Date(profile.memberSince).getFullYear()}</p>
                    <p className="text-2xs text-[var(--text-secondary)] uppercase tracking-widest font-bold mt-1">Reader Since</p>
                  </div>
                )}
              </div>
              {/* Awarded badges first: they are the ones with a story. */}
              {!!profile.awardedBadges?.length && (
                <div className="pt-2">
                  <AwardedBadges badges={profile.awardedBadges} />
                </div>
              )}
              {!!profile.badges?.length && (
                <div className="flex flex-wrap gap-2 justify-center pt-2">
                  {profile.badges.map((b, i) => (
                    <span key={i} className="px-3 py-1 rounded-full text-2xs font-bold uppercase tracking-wider bg-brand-brown/10 text-brand-brown border border-brand-brown/20">
                      {b}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="py-16 text-center text-xs text-[var(--text-secondary)] uppercase tracking-widest">
              This reader's profile isn't available right now.
            </div>
          )}
        </motion.div>
      </div>
    )}
  </AnimatePresence>
));
