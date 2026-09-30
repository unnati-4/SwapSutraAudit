import React, { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

// Reader directory -- simple community discovery: search by name/area/genre,
// tap a card to open that reader's public profile page.
// Backed by the getReaderDirectory action, which already excludes the admin
// account and the caller themselves and caps results server-side; this
// component just renders whatever list it's handed.

export interface ReaderDirectoryEntry {
  email: string;
  readerId?: string;
  name?: string;
  area?: string;
  booksListedCount?: number;
  completedSwapsCount?: number;
  avgRating?: number;
  ratingCount?: number;
  badges?: string[];
}

export interface ReaderDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  readers: ReaderDirectoryEntry[];
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  onSearch: () => void;
  /** Receives the reader's opaque public id, not their address. */
  onSelectReader: (readerId: string) => void;
}

export const ReaderDirectoryModal = memo(({ isOpen, onClose, readers, loading, query, setQuery, onSearch, onSelectReader }: ReaderDirectoryModalProps) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-brand-brown/50 backdrop-blur-md"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 20 }}
          className="surface-light night-modal bg-[var(--bg-page)] w-full max-w-3xl rounded-3xl p-6 sm:p-10 shadow-2xl relative z-10 border border-brand-border max-h-[85dvh] overflow-y-auto"
        >
          <button onClick={onClose} className="absolute top-6 right-6 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X size={22} />
          </button>
          <div className="text-center mb-8">
            <span className="text-2xs font-bold uppercase tracking-eyebrow text-brand-gold-text block mb-2">SWAPSUTRA COMMUNITY</span>
            <h3 className="text-3xl font-serif text-[var(--text-primary)]">Discover Readers</h3>
            <p className="text-sm text-[var(--text-secondary)] mt-2">Find fellow readers near you, by genre, or by name.</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); onSearch(); }} className="flex gap-3 mb-8 max-w-md mx-auto">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, area or genre"
              className="input-classic flex-1"
            />
            <button type="submit" className="btn-primary !px-6 uppercase text-2xs tracking-widest">Search</button>
          </form>
          {loading ? (
            <div className="py-16 text-center text-xs text-[var(--text-secondary)] uppercase tracking-widest">Finding readers...</div>
          ) : readers && readers.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {readers.map((r) => (
                <button
                  key={r.email}
                  onClick={() => onSelectReader(r.readerId || '')}
                  className="text-left p-5 rounded-2xl border border-brand-border/60 hover:border-brand-gold/60 hover:bg-brand-gold/5 transition-all flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-full bg-brand-gold/10 border border-brand-gold/30 flex items-center justify-center text-lg font-serif text-brand-gold-text shrink-0">
                    {(r.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-serif text-[var(--text-primary)] truncate">{r.name}</p>
                    <p className="text-2xs text-[var(--text-secondary)] uppercase tracking-widest truncate">
                      {r.area || 'Reader'} • {r.booksListedCount} books
                      {!!r.completedSwapsCount && <> • {r.completedSwapsCount} swaps</>}
                      {!!r.ratingCount && <> • ★ {r.avgRating?.toFixed(1)}</>}
                    </p>
                    {!!r.badges?.length && (
                      <p className="text-2xs text-brand-brown font-bold uppercase tracking-widest mt-1 truncate">
                        {r.badges[0]}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-10 text-center border border-dashed border-brand-border rounded-3xl bg-[var(--bg-surface-inset)]/5">
              <p className="text-2xs text-[var(--text-secondary)] uppercase font-bold tracking-widest">
                No readers found yet. Be the first to fill out your profile!
              </p>
            </div>
          )}
        </motion.div>
      </div>
    )}
  </AnimatePresence>
));
