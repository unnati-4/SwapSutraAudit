// Vercel Serverless Function Proxy for SwapSutra
// Save this as /api/swapsutra.ts in your Vercel project

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

// Single source of truth for the backend URL: the APPS_SCRIPT_URL
// environment variable, and nothing else.
//
// There used to be a hardcoded deployment address here as a fallback.
// It caused a genuinely nasty outage: the deployment it named was
// archived during a key rotation, and because the fallback was silent,
// every request that arrived before APPS_SCRIPT_URL was set went to the
// dead deployment instead. Google answered with an HTML error page, the
// proxy reported "Apps Script returned non-JSON error", and the real
// cause — a missing environment variable — was nowhere in the message.
//
// A missing configuration value must fail loudly and say its own name.
// Guessing an address is how a misconfiguration turns into an hour of
// debugging the wrong thing.
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const ADMIN_EMAIL = 'swapsutra@gmail.com';
const QA_TEST_ACCESS_ENABLED = String(process.env.SWAPSUTRA_QA_TEST_ACCESS || '').toLowerCase() === 'true';
const TEST_QA_ADMIN_EMAIL = 'testqa_admin@swapsutra.test';

/**
 * Function configuration.
 *
 * maxDuration is the important one. Listing a book is the slowest thing
 * this proxy forwards: Apps Script writes the row and then pushes each
 * photo into Drive, and every Drive call — createFile, setSharing,
 * getUrl — is its own round trip. Two or three photos runs well past ten
 * seconds, and ten seconds is Vercel's DEFAULT function timeout. Past it
 * the function is killed and the browser receives Vercel's own error
 * page rather than our JSON, which is why the app reported "Unable to
 * connect to backend" for a backend that was working fine and simply had
 * not finished yet.
 *
 * NOTE — what used to be here was `api: { bodyParser: { sizeLimit } }`.
 * That is the Next.js Pages Router convention. This is a plain Vercel
 * serverless function, where that key means nothing and was silently
 * ignored: it documented a limit it was not setting. Vercel's real body
 * ceiling is 4.5MB regardless, which is what the story caps are sized
 * against, so nothing depended on it.
 */
export const config = {
  maxDuration: 60
};

function roleForEmail(email: unknown) {
  const normalized = String(email || '').trim().toLowerCase();
  if (normalized === ADMIN_EMAIL) return 'admin';
  if (QA_TEST_ACCESS_ENABLED && normalized === TEST_QA_ADMIN_EMAIL) return 'admin';
  return 'member';
}

// Actions reachable without a session: the auth handshake, checking your
// own eligibility, signing up, and public reads. Everything else needs a
// session token.
//
// server.ts has had this allowlist for a while, but vercel.json routes
// /api/swapsutra here, not there — so in production nothing enforced it
// and every action was reachable by anyone. Apps Script now enforces the
// same list authoritatively (it is the only choke point that cannot be
// bypassed by calling the deployment directly); this copy rejects
// unauthenticated calls one hop earlier so they never cost an Apps
// Script execution.
const PUBLIC_ACTIONS = new Set([
  'sendOTP', 'verifyOTP', 'logout',
  // Signing in with Google: the credential in the request is verified with
  // Google by Apps Script before it means anything.
  'googleSignIn',
  'checkSubscription', 'registerFreeReader', 'activateFreeMembership',
  'createSubscription', 'submitSubscription', 'validateMembershipCoupon',
  'getAppSettings', 'getBooks', 'getBookGenres', 'getEvents',
  'getTestimonials', 'getPublicReaderProfile', 'getReaderDirectory',
  // The Reader's Café and its 24-hour story wall are readable by anyone.
  'getReadersCafe', 'getCafeStories',
  // Reader profiles carry no private field — see getReaderProfile.
  'getReaderProfile',
  'healthCheck', 'listAvailableActions',
  'subscribeNewsletter', 'subscribeEventNotify', 'unsubscribeEventNotify', 'notifyEvent',
  // Past newsletters are public; unsubscribe carries its own signed token.
  'getNewsletterArchive', 'getNewsletterEdition', 'unsubscribeNewsletter',
  'createSupportMessage', 'submitHostEnquiry',
  // Funnel analytics: the top of the funnel happens before anyone has a
  // session, so gating this would leave exactly the steps that decide
  // whether someone signs up unmeasured. Apps Script takes the identity
  // from the session (never the body) and only accepts allowlisted event
  // names, so an unauthenticated call can record a visit and nothing else.
  'logFunnelEvent',
  // The footer visitor counter. Returns a number and stores nothing about
  // the visitor.
  'recordVisit',
  // Listing funnel counter: counts a listing-form open, stores nothing.
  'recordListingFormOpen',
  // An invited visitor needs to see whose invite they hold before they
  // have an account. Returns a first name and nothing else.
  'validateReferralCode',
  // Coffee mugs (30 Sep): the public shelf, and custom mug ideas from
  // visitors without an account (Apps Script validates and rate-limits).
  'getMugProducts', 'submitCustomMugEnquiry'
]);

// --- PUBLIC READ CACHE (perf) ---
//
// The Library, events, testimonials, genres and app settings are the same
// answer for every reader, and each is an Apps Script read of Google
// Sheets costing seconds. They were re-read for every visitor on every
// open, which is what makes opening the book listings slow — and what
// spends the Apps Script quota that makes it slower again under load.
//
// Cached per serverless instance for a short window, keyed by the exact
// query so a filtered call never answers an unfiltered one, bypassed by
// `fresh=1`, and cleared the moment a listing/event/testimonial changes
// through this proxy. Only the actions on this list — all public — are
// ever cached; nothing reader-specific is.
const PUBLIC_READ_CACHE_TTL_MS = 60 * 1000;
// How old a cached read may be when it stands in for a failed Apps Script call.
const STALE_READ_MAX_AGE_MS = 10 * 60 * 1000;
const CACHEABLE_READ_ACTIONS = new Set([
  'getBooks', 'getBookGenres', 'getEvents', 'getTestimonials', 'getAppSettings'
]);
const publicReadCache = new Map<string, { at: number; value: any }>();
// The last good answer per read key, kept past the 60 s TTL so it can stand
// in for a failed Apps Script call (see STALE_READ_MAX_AGE_MS).
const lastGoodRead = new Map<string, { at: number; value: any }>();

// PERF (22 Sep): answers that are byte-for-byte the same for every visitor
// (no session involved at all) are also cached by Vercel's CDN, so most
// requests never reach this function or Apps Script. getBooks is NOT on
// this list: its answer depends on who is asking.
const CDN_CACHEABLE_ACTIONS = new Set(['getAppSettings', 'getBookGenres', 'getEvents']);
function allowCdnCache(res: VercelResponse, action: string, data: any) {
  if (CDN_CACHEABLE_ACTIONS.has(action) && data && data.success !== false) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  }
}

// SECURITY (22 Sep): the Library answer differs by audience — admins get
// every field, members more than guests (see redactBookForAudience). The
// cache key used to ignore that, so one instance could hand an admin's or
// member's copy to a signed-out visitor. Guests now share one entry and
// each signed-in session has its own.
function publicReadCacheKey(query: any, sessionToken = ''): string {
  const audience = sessionToken
    ? 's:' + createHash('sha256').update(sessionToken).digest('hex').slice(0, 16)
    : 'g';
  return audience + '|' + Object.keys(query || {})
    .filter(k => k !== 'fresh' && k !== 'sessionToken' && k !== '_')
    .sort()
    .map(k => `${k}=${String(query[k])}`)
    .join('&');
}

// Anything that can change what those public reads would answer.
const PUBLIC_READ_MUTATING_ACTIONS = new Set([
  'createBook', 'updateBook', 'manageBook', 'approveBook', 'deleteBook', 'updateUserBook',
  'createEvent', 'updateEvent', 'deleteEvent',
  'approveTestimonial', 'submitTestimonial', 'createTestimonial',
  'updateAppSettings'
]);

// Anything that can change what a membership check would answer; used to
// drop the cached answer immediately (see the handler below).
const MEMBERSHIP_MUTATING_ACTIONS = new Set([
  'registerFreeReader', 'activateFreeMembership', 'createSubscription', 'submitSubscription',
  'approveSubscription', 'approveUser', 'manageMembershipApproval', 'manageSubscription',
  'updateSubscriptionDates', 'checkExpiredSubscriptions', 'syncUsersFromSubscriptions',
  'manageMembershipCoupon', 'validateMembershipCoupon', 'repairDatabase',
  'verifyOTP', 'logout'
]);

function readSessionToken(req: VercelRequest, body: any): string {
  const header = req.headers['authorization'];
  const bearer = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : '';
  return String(bearer || body?.sessionToken || req.query?.sessionToken || '').trim();
}

// --- ISBN scanning: validation + Google Books metadata lookup ---
// Mirrors the same helpers in server.ts (that file's local-dev/Express
// equivalent of this Vercel function) so both deployment paths validate and
// fetch identically. ISBN identifies an edition; it is never treated as
// proof a physical copy is genuine.
function normalizeIsbn(raw: unknown): string {
  return String(raw || '').replace(/[\s-]/g, '').toUpperCase();
}
function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(isbn[i], 10) * (10 - i);
  sum += (isbn[9] === 'X' ? 10 : parseInt(isbn[9], 10));
  return sum % 11 === 0;
}
function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(isbn[i], 10) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}
function isValidIsbn(raw: string): boolean {
  const clean = normalizeIsbn(raw);
  return isValidIsbn10(clean) || isValidIsbn13(clean);
}

// --- MEMBERSHIP / SESSION MICRO-CACHE (perf) ---
//
// Each of these is an Apps Script execution against Google Sheets, which
// costs seconds, and the same two answers are asked for over and over
// within a single page load: "who is this token" and "is this reader a
// member". Cached for a short window per serverless instance, so a burst
// of requests pays for the lookup once instead of once each.
//
// Short on purpose, and dropped immediately for any reader whose
// membership a request has just changed (see MEMBERSHIP_MUTATING_ACTIONS
// in the handler below) so an activation is never masked by a stale yes/no.
const MEMBERSHIP_CACHE_TTL_MS = 60 * 1000;
const SESSION_CACHE_TTL_MS = 60 * 1000;
const SUBSCRIPTION_CACHE_TTL_MS = 30 * 1000;

const membershipCache = new Map<string, { at: number; value: boolean }>();
const sessionCache = new Map<string, { at: number; value: { email: string; role: string } | null }>();
const subscriptionCache = new Map<string, { at: number; value: any }>();

function cacheGet<T>(store: Map<string, { at: number; value: T }>, key: string, ttl: number): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttl) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet<T>(store: Map<string, { at: number; value: T }>, key: string, value: T) {
  if (store.size > 5000) store.clear();
  store.set(key, { at: Date.now(), value });
}

function invalidateMembershipCaches(email?: string) {
  if (!email) {
    membershipCache.clear();
    subscriptionCache.clear();
    return;
  }
  const normalized = String(email).trim().toLowerCase();
  membershipCache.delete(normalized);
  subscriptionCache.delete(normalized);
}

// Reuses the exact SAME membership decision every other authenticated
// SwapSutra action already relies on — Apps Script's isApprovedActiveMember
// (the check that gates createBook itself) — rather than inventing a new
// auth mechanism. This file has no session/cookie of its own (unlike
// server.ts's JWT), so it asks Apps Script the same way the frontend
// already does everywhere else: the existing 'checkSubscription' action,
// interpreted with the identical trial/premium/expired logic server.ts
// uses in getUserMembershipInfo(). Mirrored here (not imported) because
// this file and server.ts are two independently-deployed entry points by
// this codebase's existing convention (see the ISBN validation helpers
// above, already duplicated the same way) — but both must agree on what
// counts as "active", so the interpretation itself is copied verbatim.
/**
 * Resolves a session token to a verified identity by asking Apps Script,
 * which holds the signing key. Returns null for a missing/expired/forged
 * token. This is how proxy-answered endpoints learn who is calling
 * without trusting an email supplied in the request body.
 */
async function resolveSession(token: string): Promise<{ email: string; role: string } | null> {
  if (!token) return null;
  // PERF: the same token is resolved on every request from the same
  // reader. Cached briefly per instance; the token's signature is still
  // verified by Apps Script on the call it authorises, so this only saves
  // the extra identity round trip, it does not become the authority.
  const cachedSession = cacheGet(sessionCache, token, SESSION_CACHE_TTL_MS);
  if (cachedSession !== undefined) return cachedSession;
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveSession', sessionToken: token })
    });
    const data: any = await response.json();
    if (!data?.success || !data?.email) {
      cacheSet(sessionCache, token, null);
      return null;
    }
    const resolved = { email: String(data.email).trim().toLowerCase(), role: String(data.role || 'member') };
    cacheSet(sessionCache, token, resolved);
    return resolved;
  } catch (err) {
    // Fail closed — an unverifiable caller is treated as unauthenticated.
    console.error('resolveSession failed:', err);
    return null;
  }
}

async function hasActiveSwapSutraMembership(email: string, role?: string): Promise<boolean> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  // Role now comes from a verified session, not from comparing a
  // caller-supplied string against the admin address.
  if (role === 'admin' || roleForEmail(normalized) === 'admin') return true;
  const cachedMembership = cacheGet(membershipCache, normalized, MEMBERSHIP_CACHE_TTL_MS);
  if (cachedMembership !== undefined) return cachedMembership;
  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.append('action', 'checkSubscription');
    url.searchParams.append('email', normalized);
    const response = await fetch(url.toString());
    const data: any = await response.json();
    cacheSet(subscriptionCache, normalized, data);
    const status = String(data?.membershipStatus || data?.status || '').toUpperCase();
    const isExpired = status === 'EXPIRED' || data?.isExpired === true;
    const isCancelled = status === 'CANCELLED';
    const isFailed = status === 'PAYMENT_FAILED';
    const isPremium = data?.isPremium === true || (status === 'PREMIUM' && !isExpired);
    const isTrial = (data?.isTrial === true || status === 'TRIAL' || status === 'FREE_TRIAL') && !isExpired && !isPremium;
    const active = (isPremium || isTrial) && !isExpired && !isCancelled && !isFailed;
    cacheSet(membershipCache, normalized, active);
    return active;
  } catch (err) {
    // Fail closed: if the membership check itself can't be answered, this
    // is authenticated-only functionality, so an unverifiable caller is
    // treated as unauthorized rather than let through.
    console.error('lookupIsbn membership check failed:', err);
    return false;
  }
}

/**
 * Classifies a price Google Books reports, and refuses to guess.
 *
 * Google's saleInfo carries `listPrice` and `retailPrice`, and neither of
 * them is the printed MRP. `retailPrice` is what Google Play is charging
 * today; `listPrice` is what it was charging before a discount. For an
 * ebook both describe a file, which has no cover to print anything on.
 *
 * The temptation is obvious — listPrice looks like an RRP, it is usually
 * the highest number available, and using it would fill in an MRP for
 * thousands of books at once. It would also be wrong for every one of
 * them, and MRP is what the rent and the deposit are computed from.
 *
 * So this returns NEW_RETAIL or EBOOK and never PRINTED_MRP. There is no
 * argument the caller can pass to make it return PRINTED_MRP, because a
 * printed MRP can only come from something that establishes what is
 * printed on the cover — a photograph of it, or a publisher stating it.
 */
export type GooglePriceKind = 'NEW_RETAIL' | 'EBOOK';

export function classifyGooglePrice(saleInfo: any, isEbook: boolean):
  { kind: GooglePriceKind; amount: number; currency: string } | null {
  const price = saleInfo?.retailPrice || saleInfo?.listPrice;
  const amount = Number(price?.amount);
  const currency = String(price?.currencyCode || '').toUpperCase();

  // No conversion, ever. A price in USD tells us nothing about what an
  // Indian edition costs, and converting it would produce a number with
  // the shape of evidence and none of the substance.
  if (!Number.isFinite(amount) || amount <= 0 || currency !== 'INR') return null;

  return { kind: isEbook ? 'EBOOK' : 'NEW_RETAIL', amount, currency };
}

async function lookupIsbnMetadata(isbn: string) {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || '';
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}${apiKey ? `&key=${apiKey}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Books API returned ${response.status}`);
  const data: any = await response.json();
  const item = Array.isArray(data.items) ? data.items[0] : null;
  if (!item) return { found: false };
  const info = item.volumeInfo || {};

  // Any price Google reports is classified, and the classification can
  // only ever be a retail or an ebook price. It is returned alongside the
  // metadata rather than written anywhere: an observation belongs in the
  // pricing database through the evidence-tiered path, not through a
  // metadata lookup that happens while a reader waits.
  const isEbook = Boolean(item.saleInfo?.isEbook)
    || String(info.printType || '').toUpperCase() === 'BOOK' && Boolean(item.accessInfo?.epub?.isAvailable
      && !info.printedPageCount);
  const googlePrice = classifyGooglePrice(item.saleInfo, isEbook);
  const rawCover = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '';
  return {
    found: true,
    book: {
      isbn,
      title: info.title || '',
      authors: Array.isArray(info.authors) ? info.authors.join(', ') : (info.authors || ''),
      publisher: info.publisher || '',
      publishedDate: info.publishedDate || '',
      description: info.description || '',
      pageCount: info.pageCount || null,
      categories: Array.isArray(info.categories) ? info.categories.join(', ') : (info.categories || ''),
      coverImageUrl: rawCover ? rawCover.replace(/^http:/, 'https:') : '',
      // Present so the caller can see what Google said. Deliberately NOT
      // named mrp, and deliberately not usable as one.
      observedPrice: googlePrice
    }
  };
}

/** What kind of non-JSON page Apps Script sent back (for logs and the error code). */
function classifyAppsScriptPage(text: string, status: number): string {
  const t = String(text || '').slice(0, 20000);
  if (/You need access|Access Denied|need permission to access/i.test(t)) return 'BACKEND_ACCESS_DENIED';
  if (/Authorization needed|Authorization is required|requires authorization|Authorisation required/i.test(t)) return 'BACKEND_NEEDS_AUTHORIZATION';
  if (/Sorry, unable to open the file|Page Not Found|404/i.test(t) && status === 404) return 'BACKEND_DEPLOYMENT_NOT_FOUND';
  if (/TypeError|ReferenceError|SyntaxError|Script function not found|Exception:/i.test(t)) return 'BACKEND_SCRIPT_ERROR';
  return 'BACKEND_BAD_RESPONSE';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configuration check, before anything else. Named explicitly so the
  // message points at the actual problem instead of at whatever the
  // backend happened to answer.
  if (!APPS_SCRIPT_URL) {
    return res.status(500).json({
      success: false,
      error: 'APPS_SCRIPT_URL_MISSING',
      message: 'APPS_SCRIPT_URL is not set on this deployment. Set it in the Vercel project\'s Environment Variables to the Apps Script web app address ending in /exec, then redeploy — environment variables only reach the site on a new build.'
    });
  }

  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  // Every response here is scoped to whoever holds the session token —
  // getReadersCafe marks a reader's own messages, getCafeStories reveals
  // view counts only to an author. A cached copy handed to the next
  // visitor would show them somebody else's view of the room, so nothing
  // from this endpoint may be stored by a browser or a shared cache.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // --- Self-diagnosis: GET /api/swapsutra?action=__diag -----------------
  //
  // Written after an evening lost to guessing. Every question we could
  // not answer — is the variable set, which deployment is it pointing
  // at, what does Google actually say to THIS server — is answered here
  // in one page load, from inside the running function, where the truth
  // lives. Testing an address in a browser proves nothing about what the
  // server is doing: that lesson cost hours.
  //
  // Deliberately safe to leave in place. It reveals no secret: only the
  // last twelve characters of a deployment address (enough to tell two
  // deployments apart, not enough to reconstruct one), and Google's own
  // reply. The address is not a credential — the session gate inside
  // Apps Script is what protects the data.
  if (req.method === 'GET' && String(req.query?.action || '') === '__diag') {
    const tail = APPS_SCRIPT_URL.slice(-24);
    const probe: Record<string, unknown> = {
      appsScriptUrlSet: Boolean(APPS_SCRIPT_URL),
      appsScriptUrlLength: APPS_SCRIPT_URL.length,
      appsScriptUrlEndsWithExec: APPS_SCRIPT_URL.trim().endsWith('/exec'),
      appsScriptUrlHasWhitespace: APPS_SCRIPT_URL !== APPS_SCRIPT_URL.trim(),
      appsScriptUrlTail: tail,
    };

    try {
      const probeUrl = new URL(APPS_SCRIPT_URL);
      probeUrl.searchParams.set('action', 'healthCheck');
      const started = Date.now();
      const r = await fetch(probeUrl.toString(), { method: 'GET' });
      const text = await r.text();
      probe.appsScriptStatus = r.status;
      probe.appsScriptMs = Date.now() - started;
      probe.appsScriptLooksLikeJson = text.trim().startsWith('{') || text.trim().startsWith('[');
      // Enough of the reply to recognise it — Drive's "Page Not Found",
      // a sign-in page, or real data — without pasting a wall of HTML.
      probe.appsScriptFirst200 = text.slice(0, 200);
      probe.diagnosis = probe.appsScriptLooksLikeJson
        ? 'Apps Script answered with JSON. The backend link is healthy.'
        : text.includes('Page Not Found') || text.includes('unable to open the file')
          ? 'Google says no script exists at this address. APPS_SCRIPT_URL points at a deleted, archived, or mistyped deployment.'
          : text.includes('accounts.google.com') || text.includes('ServiceLogin')
            ? 'Google is demanding a sign-in. The deployment\'s "Who has access" is not set to Anyone.'
            : 'Apps Script replied with something that is neither JSON nor a recognised Google error page.';
    } catch (err: unknown) {
      probe.appsScriptStatus = 'fetch threw';
      probe.diagnosis = 'The request to Apps Script could not be completed: ' + String(err);
    }

    // The same question, asked of the other outside service this function
    // depends on. ISBN lookup fails with one generic message whatever the
    // cause, which is right for a reader and useless for debugging: a book
    // Google has never heard of and a Google that is refusing this server
    // look identical from the form. Google Books allows unkeyed calls but
    // rate-limits them per IP, and on a shared serverless address that
    // budget is spent by strangers, so 429 is the failure to expect. This
    // asks Google directly and repeats the answer.
    probe.googleBooksKeySet = Boolean(process.env.GOOGLE_BOOKS_API_KEY);
    try {
      const gbKey = process.env.GOOGLE_BOOKS_API_KEY || '';
      const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:9780143441724${gbKey ? `&key=${gbKey}` : ''}`;
      const started = Date.now();
      const gb = await fetch(gbUrl);
      const gbText = await gb.text();
      probe.googleBooksStatus = gb.status;
      probe.googleBooksMs = Date.now() - started;
      probe.googleBooksFirst200 = gbText.slice(0, 200);
      probe.googleBooksDiagnosis =
        gb.status === 200
          ? 'Google Books answered this server normally. ISBN lookup failures are not coming from Google.'
          : gb.status === 429
            ? 'Google is rate-limiting this server (429). Unkeyed calls share a per-IP budget with every other site on this address. Set GOOGLE_BOOKS_API_KEY to get an allowance of your own.'
            : gb.status === 403
              ? 'Google refused this server (403). Either the key is restricted or unkeyed access is being denied from this address. Set GOOGLE_BOOKS_API_KEY.'
              : `Google answered ${gb.status}, which is neither success nor a recognised refusal.`;
    } catch (err: unknown) {
      probe.googleBooksStatus = 'fetch threw';
      probe.googleBooksDiagnosis = 'The request to Google Books could not be completed: ' + String(err);
    }

    return res.status(200).json(probe);
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (req.method === 'POST' && body.action === 'logout') {
      res.setHeader('Set-Cookie', 'swapsutra_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      return res.status(200).json({ success: true, message: 'Logged out' });
    }

    // ISBN metadata lookup (Add Book → Scan/Enter ISBN). Pure external-API
    // concern, answered directly rather than forwarded to Apps Script —
    // but it is still part of the authenticated List a Book flow, so it
    // needs the same gate createBook itself has. Without this, this
    // endpoint would be a free, unrestricted Google Books proxy reachable
    // by anyone, logged in or not.
    if (req.method === 'POST' && body.action === 'lookupIsbn') {
      // Identity comes from the signed session, never from an email in
      // the request body — otherwise "sign in to look up book details"
      // is satisfied by typing any member's address.
      const session = await resolveSession(readSessionToken(req, body));
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'AUTH_REQUIRED',
          message: 'Please sign in to look up book details.'
        });
      }
      const requesterEmail = session.email;
      if (!(await hasActiveSwapSutraMembership(requesterEmail, session.role))) {
        return res.status(403).json({
          success: false,
          error: 'MEMBERSHIP_REQUIRED',
          message: 'An active SwapSutra membership is required to look up book details. Please sign in or start your free trial.'
        });
      }

      const clean = normalizeIsbn(body.isbn);
      if (!clean || !isValidIsbn(clean)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ISBN',
          message: "That doesn't look like a valid ISBN. Please scan again or check the number."
        });
      }
      try {
        const result = await lookupIsbnMetadata(clean);
        return res.status(200).json({ success: true, ...result });
      } catch (err) {
        console.error('ISBN lookup error:', err);
        return res.status(502).json({
          success: false,
          error: 'ISBN_LOOKUP_FAILED',
          message: "We couldn't fetch the book details right now. You can enter them manually."
        });
      }
    }

    const action = String(
      (req.method === 'POST' ? body.action : req.query?.action) || ''
    ).trim();
    const sessionToken = readSessionToken(req, body);

    // PERF/correctness: any action that can change a membership drops the
    // cached answers for the readers it names, so an activation, payment
    // or admin approval is never hidden behind a moments-old "no".
    if (MEMBERSHIP_MUTATING_ACTIONS.has(action)) {
      const touched = [body?.email, body?.userEmail, body?.targetEmail, body?.memberEmail, body?.subscriberEmail]
        .map(e => String(e || '').trim().toLowerCase())
        .filter(Boolean);
      const bulk = action === 'checkExpiredSubscriptions'
        || action === 'syncUsersFromSubscriptions'
        || action === 'repairDatabase';
      if (bulk || !touched.length) invalidateMembershipCaches();
      else touched.forEach(e => invalidateMembershipCaches(e));
    }

    // PERF: the public shelf is identical for every reader, so it is
    // served from the short-lived cache unless `fresh=1` asks for a real
    // Sheets read (which the app sends right after listing a book).
    if (req.method === 'GET' && CACHEABLE_READ_ACTIONS.has(action)) {
      const wantsFresh = String(req.query?.fresh || '') === '1';
      const key = publicReadCacheKey(req.query, sessionToken);
      if (wantsFresh) publicReadCache.delete(key);
      else {
        const cached = cacheGet(publicReadCache as any, key, PUBLIC_READ_CACHE_TTL_MS);
        if (cached !== undefined) { allowCdnCache(res, action, cached); return res.status(200).json(cached); }
      }
    }

    // A new or changed listing must be visible on the very next read.
    if (PUBLIC_READ_MUTATING_ACTIONS.has(action)) {
      publicReadCache.clear();
    }

    // PERF: the membership check the app runs on every open is answered
    // from the same short-lived cache, so reopening the app no longer
    // waits on a Google Sheets read. `fresh=1` — which the app sends after
    // anything that changes membership, and when the reader asks — always
    // goes to Apps Script.
    if (req.method === 'GET' && action === 'checkSubscription') {
      const subjectEmail = String(req.query?.email || '').trim().toLowerCase();
      const wantsFresh = String(req.query?.fresh || '') === '1';
      if (subjectEmail && wantsFresh) invalidateMembershipCaches(subjectEmail);
      if (subjectEmail && !wantsFresh) {
        const cached = cacheGet(subscriptionCache, subjectEmail, SUBSCRIPTION_CACHE_TTL_MS);
        if (cached !== undefined) return res.status(200).json(cached);
      }
    }

    // Default-deny. Anything not on the public list needs a session
    // token present; Apps Script still verifies the signature, so a
    // forged token gets no further than this optimistic check.
    if (action && !PUBLIC_ACTIONS.has(action) && !sessionToken) {
      return res.status(401).json({
        success: false,
        error: 'SESSION_REQUIRED',
        message: 'Your session has expired. Please sign in again to continue.'
      });
    }

    const url = new URL(APPS_SCRIPT_URL);

    // Copy query parameters from request to Apps Script URL.
    // `adminEmail` is deliberately dropped: it used to be how the caller
    // claimed admin rights, and the frontend shipped it hardcoded. Admin
    // identity is now derived from the session inside Apps Script, so
    // forwarding a caller-supplied value would only be misleading.
    if (req.query) {
      Object.keys(req.query).forEach(key => {
        if (key === 'adminEmail') return;
        // Cache-bypass hint for this proxy only; Apps Script has no use
        // for it and it would only widen its parameter surface.
        if (key === 'fresh') return;
        url.searchParams.append(key, String(req.query[key]));
      });
    }
    if (sessionToken && !url.searchParams.has('sessionToken')) {
      url.searchParams.append('sessionToken', sessionToken);
    }

    const options: RequestInit = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (req.method === 'POST') {
      const { adminEmail: _droppedAdminEmail, ...forwardedBody } = body;
      options.body = JSON.stringify(
        sessionToken ? { ...forwardedBody, sessionToken } : forwardedBody
      );
    }

    // RESILIENCE (25 Sep): Apps Script now and then answers with Google's
    // "page not found" page for a deployment that is fine a second later
    // (seen live: 1 in 3 back-to-back getBooks calls). Reads are asked
    // again; a write is asked again only when Google refused to run the
    // script at all, so nothing can be written twice.
    const isRead = req.method === 'GET' || /^(get|list|search|lookup)[A-Z]/.test(action) || action === 'checkSubscription';
    let response: Response | null = null;
    let text = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(url.toString(), options);
        text = await response.text();
      } catch (netErr) {
        if (!isRead || attempt === 2) throw netErr;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      const looksJson = /^\s*[\[{]/.test(text);
      if (looksJson && response.status < 500) break;
      const kindNow = looksJson ? 'BACKEND_BAD_RESPONSE' : classifyAppsScriptPage(text, response.status);
      const retryable = isRead || kindNow === 'BACKEND_DEPLOYMENT_NOT_FOUND';
      if (!retryable || attempt === 2) break;
      console.warn(`[proxy] transient Apps Script answer (${response.status}, ${kindNow}) for "${action}", retrying`);
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    if (!response) throw new Error('No response from Apps Script');

    try {
      const data = JSON.parse(text);
      if (req.method === 'GET' && action === 'checkSubscription') {
        const subjectEmail = String(req.query?.email || '').trim().toLowerCase();
        if (subjectEmail) cacheSet(subscriptionCache, subjectEmail, data);
      }
      if (req.method === 'GET' && CACHEABLE_READ_ACTIONS.has(action)) {
        // Only a real answer is cached. A cached failure used to be served
        // to every reader for the next minute as if it were the Library.
        if (data && data.success !== false) {
          cacheSet(publicReadCache as any, publicReadCacheKey(req.query, sessionToken), data);
          lastGoodRead.set(publicReadCacheKey(req.query, sessionToken), { at: Date.now(), value: data });
          if (lastGoodRead.size > 500) { const k = lastGoodRead.keys().next().value; if (k !== undefined) lastGoodRead.delete(k); }
          if (!req.query?.fresh) allowCdnCache(res, action, data);
        } else {
          const stale = lastGoodRead.get(publicReadCacheKey(req.query, sessionToken));
          if (stale && Date.now() - stale.at < STALE_READ_MAX_AGE_MS) {
            res.setHeader('X-SwapSutra-Stale', '1');
            return res.status(200).json(stale.value);
          }
        }
      }
      if (req.method === 'POST' && body.action === 'verifyOTP' && data?.success) {
        // Apps Script now returns the authoritative role alongside a
        // signed session token. This used to recompute the role here
        // from the email in the request, which meant the answer came
        // from the same place as the question.
        return res.status(200).json({
          ...data,
          role: data.role || roleForEmail(data.email || body.email)
        });
      }
      return res.status(200).json(data);
    } catch (e) {
      // Apps Script answered with a web page instead of JSON — a Google
      // "You need access" / sign-in page (the deployment is not set to
      // "Anyone"), an authorisation prompt, or a script error page. That
      // HTML used to be forwarded as the `message`, so readers saw a wall
      // of Google's page source on their profile — and a 200 page was even
      // reported as success. Readers now get one plain sentence; the
      // details go to the server log for whoever deploys.
      const kind = classifyAppsScriptPage(text, response.status);
      // BACKEND_ACCESS_DENIED usually means the script owner has not yet
      // approved a new permission the latest version asks for (open the
      // /exec URL while signed in as the owner → Review permissions), or
      // the deployment is not shared with "Anyone".
      console.error(`[proxy] Apps Script returned non-JSON (${response.status}, ${kind}) for action "${action}":`, text.slice(0, 500));
      // A read that still failed after retrying falls back to the last good
      // answer this instance has (up to 10 minutes old) rather than an error.
      if (req.method === 'GET' && CACHEABLE_READ_ACTIONS.has(action)) {
        const stale = lastGoodRead.get(publicReadCacheKey(req.query, sessionToken));
        if (stale && Date.now() - stale.at < STALE_READ_MAX_AGE_MS) {
          res.setHeader('X-SwapSutra-Stale', '1');
          return res.status(200).json(stale.value);
        }
      }
      return res.status(502).json({
        success: false,
        error: kind,
        message: 'SwapSutra is having trouble reaching its library right now. Please try again in a few minutes.'
      });
    }
  } catch (error) {
    console.error("Proxy Error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Backend proxy failed", 
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
