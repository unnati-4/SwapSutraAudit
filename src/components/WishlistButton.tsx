import { isWishlisted, toggleWishlist, useWishlist } from '../utils/wishlist';

/**
 * "Add to wishlist" for a book (9 Oct 2026, owner's request).
 *   WishHeart       — the ♡ on a book card's cover (does not open the book)
 *   WishlistButton  — the full-width button on the book's page
 * Both read and write the shared wishlist store, so they always agree.
 */

const Heart = ({ filled, size = 18 }: { filled: boolean; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path d="M12 20.5s-7.5-4.6-9.4-9.3C1.3 7.9 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.5 0 5.6 3.4 4.3 6.7-1.9 4.7-9.4 9.3-9.4 9.3z"
      fill={filled ? "#DC2626" : "none"} stroke={filled ? "#DC2626" : "currentColor"} strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

export function WishHeart({ bookId, title }: { bookId: string; title: string }) {
  useWishlist();
  const on = isWishlisted(bookId);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${title} from your wishlist` : `Add ${title} to your wishlist`}
      title={on ? 'In your wishlist' : 'Add to wishlist'}
      onClick={(e) => { e.stopPropagation(); void toggleWishlist(bookId, title); }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`flex h-9 w-9 items-center justify-center rounded-full shadow-md backdrop-blur-md transition-colors ${on ? 'bg-white text-red-600' : 'bg-white/85 text-brand-brown hover:text-red-600'}`}
      data-testid="wish-heart"
    >
      <Heart filled={on} />
    </button>
  );
}

export function WishlistButton({ bookId, title }: { bookId: string; title: string }) {
  useWishlist();
  const on = isWishlisted(bookId);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => { void toggleWishlist(bookId, title); }}
      className={`btn-outline w-full !py-4 uppercase text-2xs tracking-widest flex items-center justify-center gap-2 transition-all ${on ? '!border-red-300 text-red-700' : ''}`}
      data-testid="wishlist-button"
    >
      <Heart filled={on} size={16} /> {on ? 'In your wishlist' : 'Add to wishlist'}
    </button>
  );
}
