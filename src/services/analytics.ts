/**
 * SwapSutra funnel analytics — the smallest thing that answers "where do
 * readers drop?".
 *
 * Deliberately not a third-party SDK. Events go to the same
 * /api/swapsutra endpoint as everything else and land in an
 * AnalyticsEvents sheet beside the rest of the database, which means no
 * new vendor, no consent banner, no script to block, and no second place
 * where reader data lives.
 *
 * Three rules this module keeps:
 *
 *   1. Analytics never breaks a feature. Every call is fire-and-forget
 *      and every error is swallowed. If the endpoint is down, the reader
 *      never learns about it.
 *   2. Once means once. The events that define the funnel are
 *      first-time-only per reader (first listing, first request), so they
 *      are de-duplicated locally rather than counted again on every
 *      subsequent action.
 *   3. Identity comes from the session, not from here. This module sends
 *      an anonymous id so a visitor's pre-signup steps can be tied to
 *      their post-signup ones; the backend attaches the real address
 *      itself when there is a verified session.
 */

import {apiUrl} from '../config/runtime';

const API_URL = apiUrl('/api/swapsutra');

const ANON_ID_KEY = 'swapsutraAnonId';
const ONCE_KEY_PREFIX = 'swapsutraEvtOnce:';
const REFERRAL_KEY = 'swapsutraReferralCode';

/** Every event the backend will accept. Kept in step with FUNNEL_EVENTS in appsscript.js. */
export type FunnelEvent =
  | 'landing_viewed'
  | 'pincode_submitted'
  | 'nearby_shelf_viewed'
  | 'signup_started'
  | 'otp_sent'
  | 'otp_verified'
  | 'registration_completed'
  | 'first_listing_prompted'
  | 'first_listing_created'
  | 'first_request_sent'
  | 'handover_confirmed'
  | 'upgrade_viewed'
  | 'upgrade_started'
  | 'upgrade_paid'
  | 'referral_link_shared'
  | 'referral_link_opened'
  | 'referral_qualified';

function safeLocal(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Private windows and blocked site data both throw on access.
    return null;
  }
}

/**
 * A first-party random id, generated once per browser. Not a
 * fingerprint and not shared with anyone: its only job is to let one
 * visitor's landing view and their eventual signup be counted as the
 * same person rather than as two.
 */
function anonId(): string {
  const store = safeLocal();
  if (!store) return '';
  try {
    let id = store.getItem(ANON_ID_KEY);
    if (!id) {
      id = 'a_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      store.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/**
 * Reads a ?ref= invite code out of the URL on first arrival and keeps
 * it, so the code still applies after the reader has been through the
 * OTP round trip and come back on a different screen.
 */
export function captureReferralFromUrl(): string {
  try {
    if (typeof window === 'undefined') return '';
    const fromUrl = new URLSearchParams(window.location.search).get('ref') || '';
    const clean = fromUrl.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    const store = safeLocal();
    if (clean && store) {
      store.setItem(REFERRAL_KEY, clean);
      track('referral_link_opened', { code: clean });
    }
    return clean || storedReferralCode();
  } catch {
    return '';
  }
}

export function storedReferralCode(): string {
  const store = safeLocal();
  if (!store) return '';
  try {
    return store.getItem(REFERRAL_KEY) || '';
  } catch {
    return '';
  }
}

export function clearStoredReferralCode(): void {
  const store = safeLocal();
  if (!store) return;
  try {
    store.removeItem(REFERRAL_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Record one event. Never awaited by a caller, never throws.
 *
 * `tab` is the route the reader was on, which is what turns a flat event
 * count into a picture of where in the app the drop happened.
 */
export function track(event: FunnelEvent, meta?: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined') return;

    const body = JSON.stringify({
      action: 'logFunnelEvent',
      event,
      anonId: anonId(),
      tab: window.location.pathname.replace(/^\//, '') || 'home',
      referrerCode: storedReferralCode(),
      meta: meta || undefined,
    });

    // keepalive lets the request survive the page unloading, which is
    // exactly when the most interesting drop-off events fire.
    void fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* analytics must never surface an error to the reader */
    });
  } catch {
    /* nor may it throw one */
  }
}

/**
 * Record an event at most once per browser. Use for the milestones that
 * are only meaningful the first time — a reader's first listing is a
 * funnel step; their fortieth is not.
 */
export function trackOnce(event: FunnelEvent, meta?: Record<string, unknown>): void {
  const store = safeLocal();
  const key = ONCE_KEY_PREFIX + event;
  try {
    if (store && store.getItem(key)) return;
    if (store) store.setItem(key, '1');
  } catch {
    // If we cannot remember, send it anyway — an over-count is far less
    // damaging to a funnel than a silent under-count.
  }
  track(event, meta);
}

const VISIT_COUNTED_KEY = 'swapsutraVisitCounted';
let visitRequest: Promise<number | null> | null = null;

/**
 * Counts this browser once (the first time it ever opens SwapSutra) and
 * returns the site's total visitor count for the footer. Later page loads
 * only read the total. Resolves to null when the count is unavailable, so
 * the footer simply leaves it out. Never throws.
 */
export function recordVisit(): Promise<number | null> {
  if (visitRequest) return visitRequest;
  visitRequest = (async () => {
    try {
      if (typeof window === 'undefined') return null;
      const store = safeLocal();
      let alreadyCounted = false;
      try {
        alreadyCounted = !!store?.getItem(VISIT_COUNTED_KEY);
      } catch {
        alreadyCounted = false;
      }

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recordVisit',
          newVisitor: !alreadyCounted,
        }),
      });
      const data = await res.json();

      if (data?.counted) {
        try {
          store?.setItem(VISIT_COUNTED_KEY, '1');
        } catch {
          /* storage unavailable — this browser may be counted again */
        }
      }

      const count = Number(data?.count);
      return data?.success && Number.isFinite(count) && count > 0 ? count : null;
    } catch {
      return null;
    }
  })();
  return visitRequest;
}

/**
 * Listing funnel counter (24 Sep): one +1 each time the listing form
 * opens, kept in an Apps Script Script Property beside the visitor count.
 * Paired with the listings-created count so the front-cover-only change can
 * be judged. Fire-and-forget: a failure never touches the form.
 */
export function recordListingFormOpen(): void {
  try {
    void fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recordListingFormOpen' }),
      keepalive: true,
    }).catch(() => { /* counting is best-effort */ });
  } catch { /* counting is best-effort */ }
}
