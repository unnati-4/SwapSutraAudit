/**
 * Full-screen viewer for the photos a lister attached to a book (cover,
 * inside pages, condition shots). Readers asked to open those pages and
 * actually read them before asking for a swap, so the viewer:
 *  - fills the screen, photo shown whole (object-contain), never cropped
 *  - swipes left/right on phones, arrow keys on desktop, Esc closes
 *  - double-tap (or the zoom button) zooms 2.5x; drag to pan while zoomed
 *  - asks Google Drive for a larger rendition than the 800px card thumbnail
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const FALLBACK = 'https://images.unsplash.com/photo-1543003928-a390cfd0b405?w=800&auto=format&fit=crop&q=80';

/** Card thumbnails are w800; the viewer wants something readable. */
export const largePhotoUrl = (url: string) =>
  /drive\.google\.com\/thumbnail/.test(url) ? url.replace(/([?&])sz=w\d+/, '$1sz=w2000') : url;

export default function PhotoViewer({
  images,
  startIndex = 0,
  title,
  onClose,
}: {
  images: string[];
  startIndex?: number;
  title?: string;
  onClose: () => void;
}) {
  const count = images.length;
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0)));
  const [zoom, setZoom] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragX, setDragX] = useState(0);
  const touch = useRef<{ x: number; y: number; t: number; panX: number; panY: number; dx: number } | null>(null);
  const lastTap = useRef(0);

  const go = useCallback((dir: number) => {
    if (count < 2) return;
    setIndex((i) => (i + dir + count) % count);
    setZoom(false);
    setPan({ x: 0, y: 0 });
  }, [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [go, onClose]);

  const toggleZoom = () => { setZoom((z) => !z); setPan({ x: 0, y: 0 }); };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now(), panX: pan.x, panY: pan.y, dx: 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current.dx = dx;
    if (zoom) setPan({ x: touch.current.panX + dx, y: touch.current.panY + dy });
    else setDragX(dx);
  };
  const onTouchEnd = () => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const moved = Math.abs(start.dx);
    if (!zoom && moved > 50) go(start.dx < 0 ? 1 : -1);
    setDragX(0);
    if (moved < 8 && Date.now() - start.t < 250) {
      const now = Date.now();
      if (now - lastTap.current < 300) { toggleZoom(); lastTap.current = 0; }
      else lastTap.current = now;
    }
  };

  if (!count) return null;
  const src = largePhotoUrl(images[index]);

  // Portalled to <body>: the modals that open this are framer-motion
  // panels with transforms, which would otherwise trap position:fixed.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Photos of ${title}` : 'Book photos'}
      className="fixed inset-0 z-[140] flex flex-col bg-[#4A3B32]/[0.97] text-[#F9F6F0] backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <div className="min-w-0">
          {title && <p className="truncate font-serif text-base !text-[#F9F6F0]">{title}</p>}
          <p className="text-xs font-bold uppercase tracking-widest text-[#E5DDD3]/70">
            Photo {index + 1} of {count}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={toggleZoom} aria-label={zoom ? 'Zoom out' : 'Zoom in'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg hover:bg-white/20">
            {zoom ? '−' : '+'}
          </button>
          <button type="button" onClick={onClose} aria-label="Close photos"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/20">
            ✕
          </button>
        </div>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2 touch-none select-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={toggleZoom}
        onClick={(e) => { if (e.target === e.currentTarget && !zoom) onClose(); }}
      >
        <img
          key={src}
          src={src}
          alt={title ? `${title} — photo ${index + 1}` : `Photo ${index + 1}`}
          referrerPolicy="no-referrer"
          draggable={false}
          onError={(e) => {
            const small = images[index];
            if (e.currentTarget.src !== small && small) e.currentTarget.src = small;
            else e.currentTarget.src = FALLBACK;
          }}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          style={{
            transform: zoom
              ? `translate(${pan.x}px, ${pan.y}px) scale(2.5)`
              : `translateX(${dragX}px)`,
            transition: touch.current ? 'none' : 'transform 0.25s ease',
            cursor: zoom ? 'zoom-out' : 'zoom-in',
          }}
        />

        {count > 1 && !zoom && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo"
              className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl hover:bg-white/20 sm:flex">
              ‹
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo"
              className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl hover:bg-white/20 sm:flex">
              ›
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setIndex(i); setZoom(false); setPan({ x: 0, y: 0 }); }}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              className={`h-14 w-11 shrink-0 overflow-hidden rounded-md border-2 transition ${i === index ? 'border-[#A85D6D] opacity-100' : 'border-transparent opacity-50'}`}
            >
              <img src={img} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover"
                onError={(e) => { e.currentTarget.src = FALLBACK; }} />
            </button>
          ))}
        </div>
      )}
      {count > 1 && <p className="pb-2 text-center text-2xs text-[#E5DDD3]/60 sm:hidden">Swipe to see more · double-tap to zoom</p>}
    </div>,
    document.body,
  );
}
