/**
 * Where SwapSutra's API and shareable links live.
 *
 * SwapSutra is a website only, so both are simply the current origin: API
 * calls stay relative, and preview, staging and production each keep
 * talking to themselves with no configuration.
 */

/**
 * Builds the URL for an API route. `apiUrl('/api/swapsutra')` returns
 * `/api/swapsutra`.
 */
export function apiUrl(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * The origin to use when building links meant to be *shared* — a book link
 * sent to WhatsApp, an invite.
 */
export const SHARE_ORIGIN: string =
  typeof window !== 'undefined' ? window.location.origin : '';
