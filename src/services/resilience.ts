/**
 * Why numbers dropped to 0 in the middle of using the site (25 Sep).
 *
 * Apps Script sometimes fails for a moment — Google answers "page not
 * found" for a deployment that is fine a second later, or the script hits a
 * quota or lock and replies "Server Error: …". Measured on swapsutra.in:
 * 1 of 3 back-to-back getBooks calls came back 502. Screens that refresh in
 * the background (Library on tab focus, profile, notifications, chats) then
 * read that error as "nothing": the shelf showed 0 books, counters 0.
 *
 * This module decides, for one request, whether a failure is TRANSIENT
 * (worth another try, and never a reason to wipe what is on screen), and
 * keeps the last good answer for each read so the app can fall back to it.
 * It is pure logic; the fetch wrapper in App.tsx applies it.
 */

/** Read actions sent as POST bodies (most reads are GETs). */
const READ_ACTION = /^(get|list|search|lookup)[A-Z]/;
const READ_EXACT = new Set(['checkSubscription', 'healthCheck']);

export function isReadRequest(method: string, action: string): boolean {
  if ((method || 'GET').toUpperCase() === 'GET') return true;
  return READ_ACTION.test(action) || READ_EXACT.has(action);
}

/** The action name, from the URL (?action=) or a JSON body. */
export function actionOf(url: string, body: unknown): string {
  try {
    const q = new URL(url, 'http://x').searchParams.get('action');
    if (q) return q;
  } catch { /* fall through */ }
  if (typeof body === 'string' && body) {
    try { return String(JSON.parse(body)?.action || ''); } catch { return ''; }
  }
  return '';
}

const TRANSIENT_MESSAGE = /server error:|exception:|too many times|too many simultaneous|service spreadsheets|service invoked|timed out|exceeded maximum execution|lock timeout|could not (obtain|acquire) (a )?lock|temporarily unavailable|try again in a few minutes|backend proxy failed|service error|internal error|rate limit/i;

/**
 * Is this response a passing failure rather than a real answer?
 *  - status 5xx (our proxy's 502 for a Google error page, Vercel timeouts)
 *  - JSON { success:false } whose error is a BACKEND_* code or whose
 *    message is a quota/lock/"Server Error" from Apps Script.
 * A real "no" (not found, unauthorized, validation) is NOT transient.
 */
export function isTransientFailure(status: number, json: any): boolean {
  if (status >= 500) return true;
  if (status === 429 || status === 408) return true;
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  if (json.success !== false) return false;
  const code = String(json.error || json.code || '');
  if (/^BACKEND_/.test(code) || code === 'APPS_SCRIPT_URL_MISSING') return true;
  return TRANSIENT_MESSAGE.test(String(json.message || ''));
}

/**
 * A write is retried only when Google refused to run the script at all
 * (its "page not found" page), because then nothing was written and a
 * second try cannot create a duplicate.
 */
export function isSafeToRetryWrite(status: number, json: any): boolean {
  return String(json?.error || '') === 'BACKEND_DEPLOYMENT_NOT_FOUND';
}

/** Last good answer per read, kept for the life of the page. */
const MAX_ENTRIES = 120;
const lastGood = new Map<string, { at: number; text: string; status: number }>();

export function rememberGood(key: string, text: string, status = 200) {
  if (lastGood.has(key)) lastGood.delete(key);
  lastGood.set(key, { at: Date.now(), text, status });
  while (lastGood.size > MAX_ENTRIES) {
    const oldest = lastGood.keys().next().value;
    if (oldest === undefined) break;
    lastGood.delete(oldest);
  }
}

export function recallGood(key: string) {
  return lastGood.get(key) || null;
}

export function forgetAllGood() {
  lastGood.clear();
}

export const RETRY_DELAYS_MS = [700, 1800];
