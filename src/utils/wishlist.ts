import { useEffect, useState } from 'react';
import { apiUrl } from '../config/runtime';

/**
 * Wishlist — saved books (9 Oct 2026, owner's request).
 *
 * One small shared store, so every book card's ♡ and the book page's
 * "Add to wishlist" stay in step without passing props through the app.
 * The list lives on the server (getWishlist / toggleWishlist), so it
 * follows the reader across devices; a heart flips at once and is put
 * back if the server says no.
 */

const API_URL = apiUrl('/api/swapsutra');

export interface WishItem { bookId: string; bookTitle: string; savedAt: string }

let items: WishItem[] = [];
let loadedFor = '';
let signedIn = false;
let askToSignIn: () => void = () => {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function post(body: Record<string, unknown>) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

/** App calls this when the signed-in reader changes ('' when signed out). */
export async function loadWishlist(email: string, onNeedSignIn?: () => void) {
  if (onNeedSignIn) askToSignIn = onNeedSignIn;
  signedIn = !!email;
  if (!email) { items = []; loadedFor = ''; emit(); return; }
  if (loadedFor === email) return;
  loadedFor = email;
  try {
    const d = await post({ action: 'getWishlist' });
    if (d?.success && Array.isArray(d.items)) { items = d.items; emit(); }
  } catch { /* the hearts just start empty */ }
}

export function isWishlisted(bookId: string) {
  return items.some((i) => i.bookId === String(bookId));
}

/** Adds or removes one book. Returns the new state, or null if not signed in / failed. */
export async function toggleWishlist(bookId: string, bookTitle = ''): Promise<boolean | null> {
  if (!signedIn) { askToSignIn(); return null; }
  const id = String(bookId);
  const was = isWishlisted(id);
  const before = items;
  items = was ? items.filter((i) => i.bookId !== id) : [{ bookId: id, bookTitle, savedAt: new Date().toISOString() }, ...items];
  emit();
  try {
    const d = await post({ action: 'toggleWishlist', bookId: id, bookTitle, saved: !was });
    if (!d?.success) { items = before; emit(); return null; }
    return !was;
  } catch {
    items = before; emit();
    return null;
  }
}

/** The saved books, kept current. */
export function useWishlist(): WishItem[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return items;
}
