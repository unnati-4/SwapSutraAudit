// Loads .env for local development (`npm run dev`). On Vercel the
// variables come from the project settings and this is a no-op.
import 'dotenv/config';
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { GoogleGenAI, Type } from "@google/genai";
import webpush from "web-push";

// Support both ESM (dev) and CJS (prod) environments safely
let currentDirname = "";
try {
  currentDirname = path.dirname(fileURLToPath(import.meta.url));
} catch (e) {
  currentDirname = typeof __dirname !== "undefined" ? __dirname : process.cwd();
}

// Constants
const PORT = 3000;
// No fallback, deliberately.
//
// This used to default to a literal string when JWT_SECRET was unset,
// which meant a deployment missing that variable signed real reader
// sessions with a value published in the source code — anyone could
// mint a token for any account, and nothing anywhere would look wrong.
// A missing signing key must stop the server, not quietly downgrade it.
const JWT_SECRET = process.env.JWT_SECRET || '';

// Must match api/swapsutra.ts, which reads the same variable and has the
// same rule: the address comes from the environment or not at all.
//
// A hardcoded deployment address used to sit here as a fallback. When
// that deployment was archived during a key rotation, every request that
// arrived before APPS_SCRIPT_URL was set went to the dead address
// instead of failing — Google returned an HTML error page, and the real
// cause (a missing environment variable) appeared nowhere in the error.
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';

// Checked at startup rather than per request, so a misconfigured server
// refuses to run instead of serving a broken site.
const missingConfig = [
  !JWT_SECRET && 'JWT_SECRET',
  !APPS_SCRIPT_URL && 'APPS_SCRIPT_URL'
].filter(Boolean);

if (missingConfig.length > 0) {
  console.error(
    '\n[SwapSutra] Cannot start — missing required environment variable(s): ' + missingConfig.join(', ') +
    '\n  Copy .env.example to .env and fill in the real values there.' +
    '\n  APPS_SCRIPT_URL is the Apps Script web app address ending in /exec.\n'
  );
  process.exit(1);
}
const ADMIN_EMAIL = 'swapsutra@gmail.com';
const QA_TEST_ACCESS_ENABLED = String(process.env.SWAPSUTRA_QA_TEST_ACCESS || '').toLowerCase() === 'true';
const TEST_QA_ADMIN_EMAIL = 'testqa_admin@swapsutra.test';

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

function roleForEmail(email: unknown) {
  const normalized = normalizeEmail(email);
  if (normalized === ADMIN_EMAIL) return 'admin';
  if (QA_TEST_ACCESS_ENABLED && normalized === TEST_QA_ADMIN_EMAIL) return 'admin';
  return 'member';
}

// --- ISBN scanning: validation + Google Books metadata lookup ---
// ISBN identifies a book edition; it does NOT prove a physical copy is
// genuine (a pirated/reprinted copy can carry the same barcode as the
// original), so this is used only to populate listing fields — never
// surfaced as an "authenticity verified" signal.
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

async function lookupIsbnMetadata(isbn: string) {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || '';
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}${apiKey ? `&key=${apiKey}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Books API returned ${response.status}`);
  const data: any = await response.json();
  const item = Array.isArray(data.items) ? data.items[0] : null;
  if (!item) return { found: false };
  const info = item.volumeInfo || {};
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
      // https upgrade avoids mixed-content blocks when the app is served over TLS.
      coverImageUrl: rawCover ? rawCover.replace(/^http:/, 'https:') : ''
    }
  };
}

// ── Comparable price observations ───────────────────────────────────────
//
// Apps Script asks this endpoint for OBSERVATIONS and never for a price.
// The arithmetic that decides how much money changes hands — outliers out,
// median, condition factor — lives in appsscript.js next to the sheet that
// stores it, so there is exactly one answer to "what is this book worth"
// and it is not one a browser can reach.
//
// Each observation is tagged with the format it belongs to and whether it
// is an ebook, because those are the two mistakes that cost real money: a
// hardcover price in a paperback's sample over-prices it, and an ebook
// price in any print sample roughly halves the deposit its owner is
// protected by. Tagging happens here; excluding happens there; both sides
// are tested.

type PriceObservation = {
  price: number;
  currency: string;
  kind: 'RETAIL' | 'EBOOK';
  format: string;
  source: string;
  sourceRef?: string;
};

/** Google Books' printType/subtitle blob -> one of our formats. */
function inferObservationFormat(volumeInfo: any): string {
  const blob = [
    volumeInfo?.subtitle, volumeInfo?.title, volumeInfo?.printType,
    ...(Array.isArray(volumeInfo?.industryIdentifiers)
      ? volumeInfo.industryIdentifiers.map((i: any) => i?.type) : []),
  ].filter(Boolean).join(' ');
  if (/mass[\s-]?market|rack size/i.test(blob)) return 'MASS_MARKET';
  if (/illustrat|collector|deluxe|boxed/i.test(blob)) return 'ILLUSTRATED';
  if (/hard\s*(cover|back|bound)|hardbound/i.test(blob)) return 'HARDCOVER';
  if (/paper\s*(back|bound)|softcover/i.test(blob)) return 'PAPERBACK';
  return 'UNKNOWN';   // never a guess — an unplaceable price is filtered out upstream
}

function observationsFromVolume(item: any): PriceObservation[] {
  const sale = item?.saleInfo || {};
  const info = item?.volumeInfo || {};
  const out: PriceObservation[] = [];
  // isEbook is Google's own flag and it is the one that matters: almost
  // every price Google Books carries is a digital one, and passing those
  // off as print prices would be the single most damaging thing this
  // function could do.
  const kind: 'RETAIL' | 'EBOOK' = sale.isEbook ? 'EBOOK' : 'RETAIL';
  const format = sale.isEbook ? 'UNKNOWN' : inferObservationFormat(info);
  for (const field of ['listPrice', 'retailPrice']) {
    const p = sale[field];
    if (!p || typeof p.amount !== 'number' || p.amount <= 0) continue;
    out.push({
      price: p.amount,
      currency: String(p.currencyCode || '').toUpperCase(),
      kind, format,
      source: 'GOOGLE_BOOKS',
      sourceRef: `${item?.id || ''}:${field}`,
    });
  }
  return out;
}

async function googleBooksSearch(query: string): Promise<any[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || '';
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}`
    + `&country=IN&maxResults=20${apiKey ? `&key=${apiKey}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data: any = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

/**
 * Comparable prices for one book, from the sources we already have.
 *
 * Two passes: the exact ISBN, then other editions of the same title and
 * author. The second pass is what makes a median possible at all — one
 * ISBN yields one or two prices, and the pricing code labels that a
 * midpoint rather than pretending it is a median.
 *
 * Returns [] rather than throwing. A book that cannot be priced lists as
 * "Value Unverified", which is a worse listing than a priced one and a far
 * better outcome than a wrong price or a blocked reader.
 */
async function collectPriceObservations(
  isbn: string, title?: string, author?: string
): Promise<PriceObservation[]> {
  const observations: PriceObservation[] = [];
  const seen = new Set<string>();
  const add = (list: PriceObservation[]) => {
    for (const o of list) {
      const key = `${o.source}:${o.sourceRef}:${o.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      observations.push(o);
    }
  };

  try {
    if (isbn) for (const item of await googleBooksSearch(`isbn:${isbn}`)) add(observationsFromVolume(item));
  } catch (err) {
    console.error('[pricing] ISBN observation pass failed:', err);
  }

  try {
    if (title) {
      const q = `intitle:${JSON.stringify(title)}` + (author ? ` inauthor:${JSON.stringify(author)}` : '');
      for (const item of await googleBooksSearch(q)) add(observationsFromVolume(item));
    }
  } catch (err) {
    console.error('[pricing] title observation pass failed:', err);
  }

  return observations;
}

// Actions that must work for a visitor who is NOT a registered (trial or paid)
// member — auth flow, checking your own status, signing up for the trial or
// the ₹49/month plan, and contacting support. Nothing else is reachable
// without an active membership; see the default-deny gate below.
const PUBLIC_ACTIONS = new Set([
  'sendOTP', 'verifyOTP', 'logout',
  // Signing in with Google: the credential in the request is verified with
  // Google by Apps Script before it means anything.
  'googleSignIn',
  'checkSubscription', 'registerFreeReader', 'activateFreeMembership', 'createSubscription',
  'validateMembershipCoupon', 'getAppSettings',
  'subscribeEventNotify', 'unsubscribeEventNotify',
  'getNewsletterArchive', 'getNewsletterEdition', 'unsubscribeNewsletter',
  'createSupportMessage', 'submitHostEnquiry',
  // The Reader's Café and its 24-hour story wall are readable by anyone.
  'getReadersCafe', 'getCafeStories',
  // Funnel analytics: the top of the funnel happens before anyone has a
  // membership, so gating this would leave exactly the steps that decide
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
  // How many Founding Reader seats remain. Counts only — no reader details
  // — and it renders on the homepage for people who have never signed in,
  // which is the whole purpose of the offer.
  'getFoundingReaderStatus',
  // A reader searching a city SwapSutra has not opened yet has no account
  // by definition; requiring one would gate the exact moment this exists
  // to capture.
  'joinLibraryWaitlist',
  // Coffee mugs (30 Sep): the public shelf and custom mug ideas.
  'getMugProducts', 'submitCustomMugEnquiry',
  // Sponsored ads (9 Oct): the live ads for the Library, and a bare click count.
  'getSponsoredAds', 'recordAdClick',
  // 30 Sep: pages are open to look at; the Reading Room feed is readable
  // signed-out (Apps Script strips every email for a visitor).
  'getReadingRoomFeed'
]);

// --- MEMBERSHIP MICRO-CACHE (perf) ---
//
// Every authenticated request that is not on PUBLIC_ACTIONS runs the
// default-deny gate below, and that gate asked Apps Script
// 'checkSubscription' — a Google Sheets read, typically one to several
// seconds — BEFORE forwarding the real call. So a single page load
// (listings + events + profile + notifications + chats) paid that cost
// once per request, serially, on top of the work it actually wanted.
//
// The answer to "is this reader a member" does not change between two
// requests a few seconds apart. Cached per email for a short window, the
// gate costs one Sheets read per reader per window instead of one per
// request, which roughly halves the latency of every authenticated call.
//
// Deliberately short, and deliberately invalidated the moment anything
// that CHANGES membership goes through this server (see
// MEMBERSHIP_MUTATING_ACTIONS) — so an activation, a payment or an admin
// approval is visible immediately rather than up to a window later.
const MEMBERSHIP_CACHE_TTL_MS = 60 * 1000;
const membershipCache = new Map<string, { at: number; value: any }>();

function getCachedMembership(email: string): any | null {
  const hit = membershipCache.get(email);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMBERSHIP_CACHE_TTL_MS) {
    membershipCache.delete(email);
    return null;
  }
  return hit.value;
}

function setCachedMembership(email: string, value: any) {
  // Bounded so a long-running process cannot grow this without limit.
  if (membershipCache.size > 5000) membershipCache.clear();
  membershipCache.set(email, { at: Date.now(), value });
}

function invalidateMembership(email?: string) {
  if (email) membershipCache.delete(normalizeEmail(email));
  else membershipCache.clear();
}

// Anything that can change what a membership check would answer. After one
// of these the cached answer for that reader is dropped, so the very next
// check goes to Sheets.
const MEMBERSHIP_MUTATING_ACTIONS = new Set([
  'registerFreeReader', 'activateFreeMembership', 'createSubscription',
  'approveSubscription', 'approveUser', 'manageMembershipApproval',
  'manageSubscription', 'updateSubscriptionDates', 'checkExpiredSubscriptions',
  'syncUsersFromSubscriptions', 'manageMembershipCoupon', 'validateMembershipCoupon',
  'verifyOTP', 'logout'
]);

// --- PUBLIC READ CACHE (perf) ---
//
// The Library, the events list, the testimonials and the app settings are
// the SAME answer for every reader, and each one is an Apps Script read of
// Google Sheets costing seconds. They were re-read from Sheets for every
// visitor, on every open, and on every tab switch back into the Library —
// which is what made opening the book listings feel slow, and what burns
// the Apps Script quota that makes it slower still under load.
//
// Cached here for a short window, keyed by the exact query (so a filtered
// call never answers an unfiltered one), bypassed by `fresh=1`, and
// dropped the moment a listing/event/testimonial changes through this
// server. Nothing reader-specific is ever cached here — only the actions
// on this list, all of which are the public shelf.
const PUBLIC_READ_CACHE_TTL_MS = 60 * 1000;
const CACHEABLE_READ_ACTIONS = new Set([
  'getBooks', 'getBookGenres', 'getEvents', 'getTestimonials', 'getAppSettings'
]);
const publicReadCache = new Map<string, { at: number; value: any }>();

// Keyed by audience as well as query — see api/swapsutra.ts for why.
function publicReadCacheKey(query: Record<string, any>, sessionToken = ''): string {
  const audience = sessionToken ? 's:' + sessionToken.slice(-24) : 'g';
  return audience + '|' + Object.keys(query)
    .filter(k => k !== 'fresh' && k !== 'sessionToken' && k !== '_')
    .sort()
    .map(k => `${k}=${String(query[k])}`)
    .join('&');
}

function getCachedPublicRead(key: string): any | null {
  const hit = publicReadCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PUBLIC_READ_CACHE_TTL_MS) {
    publicReadCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCachedPublicRead(key: string, value: any) {
  if (publicReadCache.size > 500) publicReadCache.clear();
  publicReadCache.set(key, { at: Date.now(), value });
}

// Anything that can change what those public reads would answer. A reader
// who has just listed a book must see it, so the cache is cleared rather
// than waited out.
const PUBLIC_READ_MUTATING_ACTIONS = new Set([
  'createBook', 'updateBook', 'manageBook', 'approveBook', 'deleteBook', 'updateUserBook',
  'createEvent', 'updateEvent', 'deleteEvent',
  'approveTestimonial', 'submitTestimonial', 'createTestimonial',
  'updateAppSettings'
]);

// Shared membership lookup used by both the POST and GET /api/swapsutra
// routes so neither can drift out of sync with the other.
async function getUserMembershipInfo(userEmail: string, isAdminUser: boolean, callAppsScript: (payload: any, method?: string) => Promise<any>): Promise<{
  isRegistered: boolean;
  isPremium: boolean;
  isTrial: boolean;
  isExpired: boolean;
  hasActiveAccess: boolean;
  status: string;
  daysRemaining?: number;
}> {
  if (!userEmail) return { isRegistered: false, isPremium: false, isTrial: false, isExpired: false, hasActiveAccess: false, status: 'guest' };
  if (isAdminUser || roleForEmail(userEmail) === 'admin') {
    return { isRegistered: true, isPremium: true, isTrial: false, isExpired: false, hasActiveAccess: true, status: 'PREMIUM' };
  }
  try {
    // PERF: one Sheets read per reader per cache window instead of one per
    // request. A miss behaves exactly as before.
    let subData = getCachedMembership(userEmail);
    if (!subData) {
      subData = await callAppsScript({ action: 'checkSubscription', email: userEmail }, 'GET');
      setCachedMembership(userEmail, subData);
    }
    const status = String(subData?.membershipStatus || subData?.status || '').toUpperCase();
    const isExpired = status === 'EXPIRED' || subData?.isExpired === true;
    const isCancelled = status === 'CANCELLED';
    const isFailed = status === 'PAYMENT_FAILED';
    const isPrem = subData?.isPremium === true || (status === 'PREMIUM' && !isExpired);
    const isTrial = (subData?.isTrial === true || status === 'TRIAL' || status === 'FREE_TRIAL') && !isExpired && !isPrem;
    const hasActiveAccess = (isPrem || isTrial) && !isExpired && !isCancelled && !isFailed;

    return {
      isRegistered: hasActiveAccess || (subData?.isRegistered === true && !isExpired),
      isPremium: isPrem,
      isTrial: isTrial,
      isExpired: isExpired,
      hasActiveAccess: hasActiveAccess,
      status: status || (isTrial ? 'TRIAL' : (isPrem ? 'PREMIUM' : 'TRIAL')),
      daysRemaining: subData?.daysRemaining || 0
    };
  } catch {
    return { isRegistered: false, isPremium: false, isTrial: false, isExpired: false, hasActiveAccess: false, status: 'pending' };
  }
}

function membershipDeniedResponse(res: any, memberInfo: { isExpired: boolean }) {
  if (memberInfo.isExpired) {
    return res.status(403).json({
      success: false,
      error: 'MEMBERSHIP_EXPIRED',
      code: 'MEMBERSHIP_EXPIRED',
      message: "Your 30-Day Free Trial has expired. Please subscribe to SwapSutra Chapters (₹49/month) to continue enjoying full access to all book services."
    });
  }
  return res.status(403).json({
    success: false,
    error: 'MEMBERSHIP_REQUIRED',
    code: 'MEMBERSHIP_REQUIRED',
    message: "Active SwapSutra membership required. Please start your 1-Month Free Trial or subscribe to Chapters (₹49/month)."
  });
}

const app = express();
app.set('trust proxy', 1);

async function startServer() {

  // Basic Security Headers
  app.use(helmet({
    contentSecurityPolicy: false, // Vite needs this disabled in dev or carefully configured
    crossOriginEmbedderPolicy: false
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Rate Limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests from this IP, please try again after 15 minutes" }
  });

  const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 login attempts per hour
    message: { success: false, message: "Too many login attempts, please try again after an hour" }
  });

  // JWT Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const token = req.cookies.swapsutra_session || req.headers['authorization']?.split(' ')[1];
    
    if (!token) return next(); // Not logged in, but some routes might be public

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return next(); // Invalid token, treat as guest
      req.user = user;
      next();
    });
  };

  app.use(authenticateToken);

  // Helper to call Apps Script
  const callAppsScript = async (payload: any, method: string = 'POST') => {
    const url = new URL(APPS_SCRIPT_URL);
    if (method === 'GET') {
      Object.keys(payload).forEach(key => url.searchParams.append(key, payload[key]));
    }

    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'text/plain' }
    };

    if (method === 'POST') {
      options.body = JSON.stringify(payload);
    }

    const response = await fetch(url.toString(), options);
    const text = await response.text();
    return JSON.parse(text);
  };

  // Auth Routes Interception
  // Server-to-server only. Apps Script calls this with a shared secret; no
  // browser ever does, and there is no reader-facing route to it. The
  // response is raw observations — the caller decides the price, which is
  // the whole point of putting this behind a secret rather than behind a
  // session.
  app.post("/api/books/price-observations", async (req, res) => {
    const expected = process.env.PRICING_SERVICE_SECRET || '';
    if (!expected) {
      // Fail closed and say why. An unset secret used to be the kind of
      // thing that silently degraded into an open endpoint.
      return res.status(503).json({
        success: false, error: 'NOT_CONFIGURED',
        message: 'PRICING_SERVICE_SECRET is not set on this deployment.'
      });
    }
    if (String(req.body?.secret || '') !== expected) {
      return res.status(403).json({ success: false, error: 'UNAUTHORIZED' });
    }
    const clean = normalizeIsbn(String(req.body?.isbn || ''));
    if (clean && !isValidIsbn(clean)) {
      return res.status(400).json({ success: false, error: 'INVALID_ISBN', observations: [] });
    }
    try {
      const observations = await collectPriceObservations(
        clean, String(req.body?.title || ''), String(req.body?.author || ''));
      return res.json({ success: true, observations });
    } catch (err) {
      console.error('[pricing] observation collection failed:', err);
      // Not a 500. A listing must not fail because a price source did.
      return res.json({ success: true, observations: [] });
    }
  });

  app.post("/api/swapsutra", async (req, res, next) => {
    const { action, email, otp } = req.body;

    // Apply strict rate limit to auth actions
    if (action === 'sendOTP' || action === 'verifyOTP') {
      return authLimiter(req, res, next);
    }
    next();
  }, async (req: any, res) => {
    const { action, email, otp } = req.body;

    // PERF/correctness: anything that can change a membership drops the
    // cached answer for that reader first, so the next check is a real
    // Sheets read and an activation or approval shows up immediately.
    if (MEMBERSHIP_MUTATING_ACTIONS.has(action)) {
      // The reader whose membership changed is not always the caller — an
      // admin approving someone else carries the subject in the body — so
      // every email the request names is dropped.
      const touched = [
        req.user?.email, email, req.body?.userEmail, req.body?.targetEmail,
        req.body?.memberEmail, req.body?.subscriberEmail
      ].map(normalizeEmail).filter(Boolean);
      // These change many readers at once, so the whole cache goes.
      const bulk = action === 'checkExpiredSubscriptions'
        || action === 'syncUsersFromSubscriptions'
        || action === 'repairDatabase';
      if (bulk || !touched.length) invalidateMembership();
      else touched.forEach(e => invalidateMembership(e));
    }

    // A new or changed listing (or event, or testimonial) must be visible
    // on the very next read, not up to a cache window later.
    if (PUBLIC_READ_MUTATING_ACTIONS.has(action)) {
      publicReadCache.clear();
    }

    try {
      // 1. Handle Verify OTP specially to issue JWT
      if (action === 'verifyOTP') {
        const result = await callAppsScript(req.body);
        if (result.success) {
          const userRole = roleForEmail(email);
          const token = jwt.sign(
            { email: normalizeEmail(email), role: userRole }, 
            JWT_SECRET, 
            { expiresIn: '7d' }
          );

          res.cookie('swapsutra_session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
          });

          // Check if this verified user already has a membership registration in the backend
          let isRegistered = userRole === 'admin';
          let membershipStatus = userRole === 'admin' ? 'premium' : 'pending';
          let userTier = userRole === 'admin' ? 'premium' : 'pending';

          if (userRole !== 'admin') {
            try {
              const subData = await callAppsScript({ action: 'checkSubscription', email: normalizeEmail(email) }, 'GET');
              // Sign-in has just paid for this lookup; the check the app
              // runs immediately afterwards reuses it instead of paying
              // for it a second time.
              setCachedMembership(normalizeEmail(email), subData);
              if (subData?.isRegistered === true) {
                isRegistered = true;
                membershipStatus = subData.membershipStatus || 'free';
                userTier = subData.userTier || 'free';
              } else if (subData?.success && subData?.subscription) {
                isRegistered = true;
                membershipStatus = subData.subscription.computedStatus === 'Active' ? 'premium' : 'free';
                userTier = subData.subscription.computedStatus === 'Active' ? 'premium' : 'free';
              }
            } catch (err) {
              console.warn("Membership check on verifyOTP warning:", err);
            }
          }

          return res.json({ 
            ...result, 
            role: userRole, 
            isRegistered, 
            membershipStatus, 
            userTier 
          });
        }
        return res.json(result);
      }

      // 2. Handle Logout
      if (action === 'logout') {
        res.clearCookie('swapsutra_session');
        return res.json({ success: true, message: "Logged out" });
      }

      // 3. Authorization Checks for Sensitive Actions
      const authenticatedEmail = req.user?.email;
      const isAdmin = req.user?.role === 'admin';

      // Admin-only actions
      const adminActions = [
        'getNewsletters', 'previewNewsletter', 'createNewsletter', 'updateNewsletter', 'scheduleNewsletter', 
        'cancelNewsletter', 'testSendNewsletter', 'getEventSubscribers', 'getHostEnquiries', 'updateHostEnquiryStatus', 
        'approveSubscription', 'approveUser', 'approveBook', 'approveTestimonial', 'createEvent', 'updateEvent', 
        'deleteEvent', 'sendTrustEmailToExistingRegisteredUsers', 'markRefundIssued', 'reopenArchivedChatForAdmin', 
        'getArchivedChatsForAdmin', 'archiveCompletedChat', 'updateAdminNotes', 'seedTestQARecords', 'cleanupTestQARecords',
        'manageMembershipApproval', 'manageSubscription', 'manageMembershipCoupon', 'manageBook', 'manageSupport',
        'updateAppSettings', 'updateSubscriptionDates', 'checkExpiredSubscriptions', 'syncUsersFromSubscriptions',
        'cleanupSheets', 'repairDatabase', 'backupData', 'getPendingMembershipApprovals', 'getAdminDashboardMetrics',
        'getSubscriptions', 'getUsers', 'getBookRequestsForAdmin', 'getMembershipCoupons'
      ];
      
      if (adminActions.includes(action) && !isAdmin) {
        return res.status(403).json({ success: false, message: "Unauthorized: Admin access required." });
      }

      // User-specific actions (ensure they only act on their own data)
      const userActions = [
        'getUserProfile', 'checkSubscription', 'getNotifications', 'getSwapRequests', 'getUserChats',
        'getChatMessages', 'sendChatMessage', 'deleteChatMessage', 'deleteCircleMessage', 'deleteReadingRoomPost',
        // markHandedOver and markOwnerFinalConfirmation removed: both are
        // now permanently disabled server-side (appsscript.js) — they
        // always return { success: false, error: 'DEPRECATED_ENDPOINT' }
        // regardless of caller, having been superseded by the master
        // state machine (getSwapStage / stageAction / SwapStageEvents).
        'deletePostComment', 'uploadSwapProof', 'subscribeNewsletter',
        'createReadingRoomPost', 'togglePostReaction', 'addPostComment', 'saveBookRecommendation',
        'cancelSwapRequest', 'disputeSwapRequest', 'getReadingJourney', 'getReaderActivities', 'logReaderActivity',
        'registerFreeReader', 'activateFreeMembership', 'createSubscription', 'upsertReadingSpaceBook', 'getReadingSpace',
        'getAccountDeletionCheck', 'deleteMyAccount', 'getMyNewsletterSubscription', 'setMyNewsletterSubscription'
      ];
      
      if (userActions.includes(action)) {
        if (!authenticatedEmail) {
          return res.status(401).json({ success: false, message: "Authentication required." });
        }
        
        // Inject or override email from JWT to prevent spoofing
        if (req.body.email) req.body.email = authenticatedEmail;
        if (req.body.user_id) req.body.user_id = authenticatedEmail;
        if (req.body.userId) req.body.userId = authenticatedEmail;
      }

      // 4. Membership Verification & Tier Enforcement on Backend.
      // Default-deny: unless an action is explicitly public (PUBLIC_ACTIONS,
      // e.g. OTP, checking your own status, signing up) or the caller is an
      // admin, it requires an active trial or paid membership. This replaces
      // the old narrow "member-only" list — that list only covered a handful
      // of write actions and left every read endpoint (getBooks, getEvents,
      // getTestimonials, getCurrentReadCircles, etc.) reachable by anyone,
      // including someone who verified an OTP but never registered, or an
      // anonymous caller hitting the API directly.
      // Deleting your account is a right, not a membership perk: a reader
      // whose membership lapsed must still be able to do it. It still
      // needs a signed-in session (userActions above), and Apps Script
      // acts only on the session's own address.
      const MEMBERSHIP_EXEMPT_ACTIONS = new Set(['getAccountDeletionCheck', 'deleteMyAccount', 'getMyNewsletterSubscription', 'setMyNewsletterSubscription']);
      if (!isAdmin && !PUBLIC_ACTIONS.has(action) && !MEMBERSHIP_EXEMPT_ACTIONS.has(action)) {
        const userEmail = normalizeEmail(authenticatedEmail || req.body.email || req.body.ownerEmail || req.body.requesterEmail || req.body.senderEmail);
        if (!userEmail) {
          return res.status(401).json({ success: false, error: 'AUTH_REQUIRED', message: 'Please sign in to continue.' });
        }
        const memberInfo = await getUserMembershipInfo(userEmail, isAdmin, callAppsScript);
        if (!memberInfo.hasActiveAccess) {
          return membershipDeniedResponse(res, memberInfo);
        }
      }

      // ISBN metadata lookup (Add Book → Scan/Enter ISBN flow). This is a
      // pure external-API concern — Google Books, not Google Sheets — so it
      // is answered directly here rather than forwarded to Apps Script. It
      // still passes through every gate above it (membership required,
      // since 'lookupIsbn' is intentionally not in PUBLIC_ACTIONS), and any
      // API key stays server-side via process.env, never shipped to the
      // client.
      if (action === 'lookupIsbn') {
        const clean = normalizeIsbn(req.body.isbn);
        if (!clean || !isValidIsbn(clean)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_ISBN',
            message: "That doesn't look like a valid ISBN. Please scan again or check the number."
          });
        }
        try {
          const result = await lookupIsbnMetadata(clean);
          return res.json({ success: true, ...result });
        } catch (err) {
          console.error("ISBN lookup error:", err);
          return res.status(502).json({
            success: false,
            error: 'ISBN_LOOKUP_FAILED',
            message: "We couldn't fetch the book details right now. You can enter them manually."
          });
        }
      }

      // PROXY ALL OTHER REQUESTS
      const proxyResult = await callAppsScript(req.method === 'POST' ? req.body : req.query, req.method);
      res.json(proxyResult);

    } catch (error) {
      console.error("Proxy Error:", error);
      res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  });

  // --- CENTRALIZED NOTIFICATION ENGINE BACKEND ROUTES ---
  //
  // Push used to be a Map in this process and a placeholder VAPID key on
  // the wire, which meant no notification was ever delivered while the
  // reader was told notifications were on. Subscriptions now live in the
  // Sheets database like everything else (see savePushSubscription in
  // appsscript.js) and sending is real.
  //
  // Keys come from the environment. With none set, the routes report
  // that push is unavailable rather than pretending — an honest "off" is
  // recoverable; a silent "on" is not.
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:swapsutra@gmail.com';
  const pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

  if (pushConfigured) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } else {
    console.warn('[Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set — push notifications are disabled.');
  }

  // The reader's Apps Script session, forwarded so the backend can
  // authorize the write. Same convention as api/swapsutra.ts.
  const readSessionToken = (req: express.Request): string => {
    const header = req.headers['authorization'];
    const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    return String(bearer || req.body?.sessionToken || req.query?.sessionToken || '').trim();
  };

  app.post("/api/notifications/subscribe-push", async (req, res) => {
    const { userEmail, endpoint, keys, userAgent } = req.body || {};
    if (!userEmail) return res.status(400).json({ success: false, message: "userEmail required" });
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ success: false, message: "A complete push subscription is required." });
    }
    try {
      const result = await callAppsScript({
        action: 'savePushSubscription',
        sessionToken: readSessionToken(req),
        userEmail: String(userEmail).toLowerCase(),
        endpoint, keys, userAgent
      });
      res.json(result);
    } catch (err: any) {
      console.error('[Push] subscribe failed:', err?.message || err);
      res.status(502).json({ success: false, message: "Could not save your notification settings. Please try again." });
    }
  });

  // Daily book updates (27 Sep). Mirrors api/notifications.ts.
  app.post("/api/notifications/subscribe-guest", async (req, res) => {
    const { endpoint, keys, userAgent } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ success: false, message: "A complete push subscription is required." });
    try { res.json(await callAppsScript({ action: 'saveGuestPushSubscription', endpoint, keys, userAgent })); }
    catch (err: any) { res.status(502).json({ success: false, message: "Could not save your notification settings." }); }
  });
  app.post("/api/notifications/push-open", async (req, res) => {
    try { res.json(await callAppsScript({ action: 'recordPushOpen', slot: String(req.body?.slot || '') })); }
    catch { res.json({ success: false }); }
  });

  app.post("/api/notifications/unsubscribe-push", async (req, res) => {
    const { userEmail, endpoint } = req.body || {};
    try {
      const result = await callAppsScript({
        action: 'deletePushSubscription',
        sessionToken: readSessionToken(req),
        userEmail: userEmail ? String(userEmail).toLowerCase() : '',
        endpoint: endpoint || ''
      });
      res.json(result);
    } catch (err: any) {
      console.error('[Push] unsubscribe failed:', err?.message || err);
      res.status(502).json({ success: false, message: "Could not update your notification settings." });
    }
  });

  app.get("/api/notifications/vapid-key", (req, res) => {
    if (!pushConfigured) {
      return res.json({ success: false, configured: false, message: "Push notifications are not configured on this server." });
    }
    res.json({ success: true, configured: true, publicKey: VAPID_PUBLIC_KEY });
  });

  /**
   * Actually delivers a push. Sends to every live device the reader has,
   * and retires the ones the push service says are gone — a browser that
   * discarded its subscription answers 404 or 410, and a row that keeps
   * failing is a row that will never succeed.
   */
  app.post("/api/notifications/send-push", async (req, res) => {
    if (!pushConfigured) {
      return res.json({ success: false, configured: false, message: "Push notifications are not configured on this server." });
    }
    const { userEmail, title, message, targetUrl, tag, type, entityId } = req.body || {};
    if (!userEmail || !title) {
      return res.status(400).json({ success: false, message: "userEmail and title are required." });
    }

    try {
      const sessionToken = readSessionToken(req);
      const lookup = await callAppsScript({
        action: 'getPushSubscriptions',
        sessionToken,
        userEmail: String(userEmail).toLowerCase()
      });
      const subscriptions: any[] = lookup?.subscriptions || [];
      if (!subscriptions.length) {
        return res.json({ success: true, sent: 0, message: "No registered devices for this reader." });
      }

      const payload = JSON.stringify({
        title,
        message: message || '',
        targetUrl: targetUrl || '/',
        tag: tag || 'swapsutra-notification',
        type: type || 'general',
        entityId: entityId || null
      });

      let sent = 0;
      const retired: string[] = [];

      await Promise.all(subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            payload
          );
          sent++;
        } catch (err: any) {
          const statusCode = Number(err?.statusCode || 0);
          retired.push(sub.endpoint);
          // Report it so the row is retired at the source of truth
          // rather than retried for ever from here.
          await callAppsScript({
            action: 'reportPushFailure',
            sessionToken,
            endpoint: sub.endpoint,
            statusCode
          }).catch(() => { /* a failed report must not fail the send */ });
        }
      }));

      res.json({ success: true, sent, failed: retired.length });
    } catch (err: any) {
      console.error('[Push] send failed:', err?.message || err);
      res.status(502).json({ success: false, message: "Could not deliver the notification." });
    }
  });

  // (Daily push copy from Gemini lives only in api/notifications.ts; the
  // local dev server falls back to Apps Script's built-in lines.)

  // Mirror of api/notifications.ts → handleRelay. Keep the two in step.
  app.post("/api/notifications/relay", async (req, res) => {
    const secret = process.env.PUSH_RELAY_SECRET || '';
    const given = Buffer.from(String(req.headers['x-relay-secret'] || ''));
    const want = Buffer.from(secret);
    const { timingSafeEqual } = await import('crypto');
    if (secret.length < 16 || given.length !== want.length || !timingSafeEqual(given, want)) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    if (!pushConfigured) return res.json({ success: false, configured: false, message: "Push is not configured." });
    const items: any[] = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : [];
    const emails = Array.from(new Set(items.map((i) => String(i?.userEmail || '').toLowerCase()).filter(Boolean)));
    if (!emails.length) return res.json({ success: true, sent: 0 });
    try {
      // Daily book updates carry their devices (see api/notifications.ts).
      const embedded: any[] = [];
      items.forEach((i) => (Array.isArray(i?.devices) ? i.devices.slice(0, 10) : []).forEach((d: any) => {
        if (d && typeof d.endpoint === 'string' && /^https:\/\//.test(d.endpoint) && d.keys?.p256dh && d.keys?.auth) {
          embedded.push({ userEmail: String(i.userEmail || '').toLowerCase(), endpoint: d.endpoint, keys: { p256dh: String(d.keys.p256dh), auth: String(d.keys.auth) } });
        }
      }));
      const needLookup = items.some((i) => !Array.isArray(i?.devices));
      const lookup = needLookup ? await callAppsScript({ action: 'getPushSubscriptionsForRelay', relaySecret: secret, emails }) : { subscriptions: [] };
      const looked: any[] = lookup?.subscriptions || [];
      let sent = 0, failed = 0;
      await Promise.all(items.map(async (item) => {
        const email = String(item?.userEmail || '').toLowerCase();
        const payload = JSON.stringify({
          title: String(item?.title || 'SwapSutra').slice(0, 120),
          message: String(item?.message || '').slice(0, 240),
          targetUrl: String(item?.targetUrl || '/').startsWith('/') ? String(item.targetUrl) : '/',
          tag: String(item?.tag || 'swapsutra-notification').slice(0, 80),
          type: String(item?.type || 'general')
        });
        const own = Array.isArray(item?.devices) ? embedded.filter((s) => s.userEmail === email) : looked.filter((s) => s.userEmail === email);
        await Promise.all(own.map(async (sub) => {
          try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: /^daily_/.test(String(item?.type || '')) ? 43200 : 86400, urgency: 'high' }); sent++; }
          catch (err: any) {
            failed++;
            await callAppsScript({ action: 'reportPushFailureForRelay', relaySecret: secret, endpoint: sub.endpoint, statusCode: Number(err?.statusCode || 0) }).catch(() => {});
          }
        }));
      }));
      res.json({ success: true, sent, failed });
    } catch (err: any) {
      console.error('[Push] relay failed:', err?.message || err);
      res.status(502).json({ success: false, message: "Relay failed." });
    }
  });

  app.post("/api/notifications/send-email", async (req, res) => {
    const { to, subject, html } = req.body;
    if (!to || !subject || !html) return res.status(400).json({ success: false, message: "to, subject, and html are required" });

    try {
      // Proxy to Apps Script mailer or Google Apps Script MailApp API
      const result = await callAppsScript({
        action: 'sendNotificationEmail',
        toEmail: to,
        subject: subject,
        htmlBody: html
      }, 'POST');

      res.json({ success: true, message: "Email notification dispatched", result });
    } catch (err: any) {
      console.warn("[Notification Mailer] Email dispatch log:", err?.message || err);
      // Return success gracefully so notification flow completes
      res.json({ success: true, message: "Email notification processed", deliveredLocally: true });
    }
  });

  // GET requests proxy
  app.get("/api/swapsutra", apiLimiter, async (req: any, res) => {
    try {
      const action = req.query.action as string;
      const authenticatedEmail = req.user?.email;
      const isAdmin = req.user?.role === 'admin';

      // Prevent unauthorized scraping/data access
      const sensitiveGetActions = ['getUserProfile', 'checkSubscription', 'getNotifications', 'getSwapRequests', 'getUserChats', 'getChatMessages', 'getReadingJourney', 'getReaderActivities'];
      if (sensitiveGetActions.includes(action)) {
        if (!authenticatedEmail) return res.status(401).json({ success: false, message: "Auth required" });
        // Override query email with authenticated email
        req.query.email = authenticatedEmail;
        req.query.user_id = authenticatedEmail;
        req.query.userId = authenticatedEmail;
      }

      const adminGetActions = [
        'getNewsletters', 'previewNewsletter', 'getEventSubscribers', 'getHostEnquiries', 'getArchivedChatsForAdmin',
        'getPendingMembershipApprovals', 'getAdminDashboardMetrics', 'getSubscriptions', 'getUsers', 'getBookRequestsForAdmin', 'getMembershipCoupons'
      ];
      if (adminGetActions.includes(action) && !isAdmin) {
        return res.status(403).json({ success: false, message: "Admin required" });
      }

      // Default-deny gate — mirrors the POST route. Without this, anyone
      // (logged in or not) could hit getBooks / getEvents / getTestimonials /
      // getCurrentReadCircles / getBookRequestFeed / etc. directly and see
      // full site content without ever registering.
      if (!isAdmin && !adminGetActions.includes(action) && !PUBLIC_ACTIONS.has(action)) {
        const userEmail = normalizeEmail(authenticatedEmail || (req.query.email as string));
        if (!userEmail) {
          return res.status(401).json({ success: false, error: 'AUTH_REQUIRED', message: 'Please sign in to continue.' });
        }
        const memberInfo = await getUserMembershipInfo(userEmail, isAdmin, callAppsScript);
        if (!memberInfo.hasActiveAccess) {
          return membershipDeniedResponse(res, memberInfo);
        }
      }

      // PERF: the membership check the app runs on every open (and on its
      // periodic re-sync) is answered from the same short-lived cache the
      // gate above uses, so reopening the app is a local round trip rather
      // than a Sheets read. `fresh=1` — sent by the app after anything that
      // changes membership, and when the reader asks explicitly — always
      // bypasses it.
      if (action === 'checkSubscription') {
        const subjectEmail = normalizeEmail(authenticatedEmail || (req.query.email as string));
        const wantsFresh = String(req.query.fresh || '') === '1';
        if (subjectEmail && !wantsFresh) {
          const cached = getCachedMembership(subjectEmail);
          if (cached) return res.json(cached);
        }
        if (subjectEmail && wantsFresh) invalidateMembership(subjectEmail);
        const { fresh: _dropFresh, ...upstreamQuery } = req.query;
        const fresh = await callAppsScript(upstreamQuery, 'GET');
        if (subjectEmail) setCachedMembership(subjectEmail, fresh);
        return res.json(fresh);
      }

      // PERF: the public shelf (listings, events, testimonials, settings)
      // is the same answer for everyone — served from the short-lived
      // cache unless `fresh=1` asks for a real read.
      if (CACHEABLE_READ_ACTIONS.has(action)) {
        const cacheKey = publicReadCacheKey(req.query, readSessionToken(req));
        const wantsFresh = String(req.query.fresh || '') === '1';
        if (!wantsFresh) {
          const cached = getCachedPublicRead(cacheKey);
          if (cached) return res.json(cached);
        }
        const { fresh: _dropFresh, ...upstreamQuery } = req.query;
        const fresh = await callAppsScript(upstreamQuery, 'GET');
        setCachedPublicRead(cacheKey, fresh);
        return res.json(fresh);
      }

      const result = await callAppsScript(req.query, 'GET');
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  });

  // --- QUILL AI READING COMPANION ENDPOINTS ---

  const quillResponseSchema = {
    type: Type.OBJECT,
    properties: {
      message: { 
        type: Type.STRING, 
        description: "Quill's warm, natural text response. If using richData, this is a fallback or summary text." 
      },
      isSpoiler: { 
        type: Type.BOOLEAN, 
        description: "True if the response contains major spoilers for the book." 
      },
      isPdfWarning: { 
        type: Type.BOOLEAN, 
        description: "True if the user was requesting a PDF/download and you are reminding them to use the Book Request feature." 
      },
      richData: {
        type: Type.OBJECT,
        description: "Optional rich message payload. If not applicable, return null.",
        properties: {
          type: { type: Type.STRING, description: "One of: 'recommendation', 'quote', 'poll', 'progress_card'" },
          bookTitle: { type: Type.STRING },
          why: { type: Type.STRING },
          quote: { type: Type.STRING },
          author: { type: Type.STRING },
          page: { type: Type.STRING },
          question: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          progressDesc: { type: Type.STRING },
          progressPercent: { type: Type.INTEGER },
          pageNum: { type: Type.INTEGER },
          mood: { type: Type.STRING }
        },
        required: ["type"]
      }
    },
    required: ["message", "isSpoiler", "isPdfWarning"]
  };

  // Lazy GoogleGenAI client
  let aiClient: any = null;
  function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return null;
    }
    if (!aiClient) {
      aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
    }
    return aiClient;
  }

  app.post("/api/quill/chat", async (req, res) => {
    const { circleId, bookTitle, author, messages, currentMessage, spoilersEnabled, trigger, userName } = req.body;

    try {
      const client = getGeminiClient();
      if (!client) {
        // Fallback responses when API key is missing
        let fallbackMsg = "Hello there! I am Quill, your reading companion.";
        let isPdf = false;
        let rich: any = null;

        if (trigger === 'pdf_request' || (currentMessage && /pdf|download|epub|mobi/i.test(currentMessage))) {
          fallbackMsg = "SwapSutra celebrates sharing books through readers, not file distribution. You can request this book using the Book Request feature and connect with someone who owns it.";
          isPdf = true;
        } else if (trigger === 'inactive_12h') {
          fallbackMsg = "The room is quiet. What was the moment that stayed with you after finishing the latest pages of " + (bookTitle || "this book") + "?";
          rich = {
            type: "quote",
            quote: "A room without books is like a body without a soul.",
            author: "Cicero",
            page: "Intro"
          };
        } else if (trigger === 'new_circle') {
          fallbackMsg = "Welcome to this new Readers Circle! I'm delighted to embark on this journey with you. Let's begin our discussion on " + (bookTitle || "this book") + ".";
        } else if (trigger === 'new_reader') {
          fallbackMsg = `A warm welcome to our newest reader, ${userName || "fellow reader"}! What are your first impressions or expectations for this read?`;
        } else if (trigger === 'milestone_finish') {
          fallbackMsg = `Congratulations on completing this book, ${userName || "reader"}! Every completed book is a new world explored. What did you think of the closing pages?`;
        } else {
          fallbackMsg = "I am listening! (Configure GEMINI_API_KEY to enable my full literary wisdom)";
        }

        return res.json({
          success: true,
          message: fallbackMsg,
          isSpoiler: false,
          isPdfWarning: isPdf,
          richData: rich
        });
      }

      // Build discussion history string for context
      const historyStr = Array.isArray(messages) 
        ? messages.slice(-15).map(m => `${m.userName || m.firstName || 'Reader'}: ${m.message}`).join("\n")
        : "";

      const prompt = `
Context details:
- Book Title: ${bookTitle || "Unknown Book"}
- Author: ${author || "Unknown Author"}
- Spoilers Allowed: ${spoilersEnabled ? "Yes" : "No"}
- Trigger reason: ${trigger || "mention"}
- Reader's Name (if active): ${userName || "Reader"}
- Current User input (if mention): ${currentMessage || ""}

Recent discussion history for context:
${historyStr}

Please generate a reply in character as Quill (warm, intelligent, concise literature companion). Return a JSON object matching the requested schema.
`;

      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `You are "Quill", SwapSutra's AI Reading Companion, a thoughtful librarian, and a fellow literature-loving reader.
Your personality is warm, intelligent, calm, and deeply passionate about books.
Never sound like a generic AI or chatbot. Avoid phrases like "How may I assist you?", "As an AI, ...", "I am a large language model", or "I'm programmed to...". Instead, use humble, natural, human language.
Keep your response concise, warm, and highly engaging.

Rules:
1. SPOCK/SPOILER AWARENESS:
   If spoilers are NOT allowed (spoilersEnabled = false), you MUST strictly avoid revealing any major plot twists, endings, or character deaths.
   If spoilers ARE allowed (spoilersEnabled = true), and you discuss a major plot twist or ending, wrap the spoiler text inside a spoiler block or warn the user. (Note: you can set "isSpoiler": true).

2. PDF/DOWNLOAD BOOK REQUESTS:
   If the trigger is a PDF request or if the user asks for a PDF/download (e.g., "Can someone send me the PDF?", "I need this book PDF"), you MUST politely reply:
   "SwapSutra celebrates sharing books through readers, not file distribution. You can request this book using the Book Request feature and connect with someone who owns it."
   And set isPdfWarning: true in the output.

3. RICH MESSAGE TEMPLATES:
   You can choose to return a standard text message, OR format your response using one of the following rich JSON structures in "richData" when it adds genuine value:
   - Book Recommendation:
     {
       "type": "recommendation",
       "bookTitle": "Name of Recommended Book",
       "why": "A highly personalized, warm, 1-2 sentence explanation of why they will love it based on their mood, genre, or the current book."
     }
   - Literary Quote:
     {
       "type": "quote",
       "quote": "A beautiful literary quote from the current book or a related work.",
       "author": "Author Name",
       "page": "Optional page number or chapter"
     }
   - Discussion Poll:
     {
       "type": "poll",
       "question": "A fascinating question about the book's themes, characters, or dilemma.",
       "options": ["Option A", "Option B", "Option C"]
     }
   - Progress Card:
     {
       "type": "progress_card",
       "progressDesc": "A supportive reading prompt or milestone message.",
       "progressPercent": 100,
       "pageNum": 200,
       "mood": "Fascinated"
     }
`,
          responseMimeType: "application/json",
          responseSchema: quillResponseSchema
        }
      });

      const responseText = response.text;
      const data = JSON.parse(responseText);

      res.json({
        success: true,
        message: data.message,
        isSpoiler: data.isSpoiler || false,
        isPdfWarning: data.isPdfWarning || false,
        richData: data.richData || null
      });

    } catch (err: any) {
      console.error("Quill chat endpoint error:", err);
      res.status(500).json({ success: false, message: "Error communicating with Quill.", error: err.message });
    }
  });

  app.get("/api/quill/insights", async (req, res) => {
    try {
      // Fetch all Readers Circles
      const circlesData = await callAppsScript({ action: 'getCurrentReadCircles' });
      const circles = circlesData?.circles || [];

      // If we don't have circles or they are empty, provide empty states gracefully
      const totalCircles = circles.length;
      let totalMessages = 0;
      const circlesList: any[] = [];
      const userMessageCounts: Record<string, number> = {};
      const hourCounts: Record<number, number> = {};
      const quietCircles: string[] = [];

      // Limit concurrent calls
      for (const circle of circles) {
        const circleId = circle.id || circle.id;
        const messagesData = await callAppsScript({ action: 'getCircleMessages', circle_id: circleId });
        const messages = messagesData?.messages || [];
        
        const msgCount = messages.length;
        totalMessages += msgCount;

        circlesList.push({
          title: circle.book_title || circle.bookTitle || "Unknown",
          messageCount: msgCount,
          readerCount: circle.reader_count || circle.readerCount || 0
        });

        if (msgCount === 0) {
          quietCircles.push(circle.book_title || circle.bookTitle || "Unknown");
        }

        messages.forEach((m: any) => {
          const author = m.user_name || m.userName || "Reader";
          if (author !== 'Quill' && author !== 'SwapSutra') {
            userMessageCounts[author] = (userMessageCounts[author] || 0) + 1;
          }

          if (m.created_at || m.createdAt) {
            const date = new Date(m.created_at || m.createdAt);
            const hour = date.getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
          }
        });
      }

      // Sort and find top readers
      const topReaders = Object.entries(userMessageCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      // Find most active circle
      const sortedCircles = [...circlesList].sort((a, b) => b.messageCount - a.messageCount);
      const mostActiveBook = sortedCircles[0]?.title || "None";

      // Formulate community stats payload
      const communityStats = {
        totalCircles,
        totalMessages,
        mostActiveBook,
        topReaders,
        quietCircles,
        peakHours: Object.entries(hourCounts).map(([h, count]) => ({ hour: `${h}:00`, count }))
      };

      const client = getGeminiClient();
      if (!client) {
        // Return structured statistics and a default literary fallback report
        return res.json({
          success: true,
          stats: communityStats,
          report: `### SwapSutra Community Activity Report

Our community of physical book lovers is gathered around **${totalCircles} reading circles**, exchanging thoughts, quotes, and reflections. 

- **Total Activity**: A total of **${totalMessages} messages** have been shared across the circles.
- **Top Discussion**: Currently, readers are most engaged in discussing **“${mostActiveBook}”**.
- **Star Contributors**: Special mentions to our most active discussion participants: ${topReaders.map(r => `${r.name} (${r.count} posts)`).join(", ") || "our active members"}.

*Note: Configure GEMINI_API_KEY to unlock Quill's deep, AI-powered community insights, engagement strategies, and literary icebreakers.*`
        });
      }

      // Generate report using Gemini
      const prompt = `
You are Quill, the AI Reading Companion of SwapSutra. You are presenting your monthly/live "Quill Community Insights" report to the SwapSutra Admins.
Here are the raw discussion statistics computed from Google Apps Script databases:
- Total Reading Circles: ${totalCircles}
- Total Messages Exchanged: ${totalMessages}
- Most Discussed Book: "${mostActiveBook}"
- Top Active Readers: ${JSON.stringify(topReaders)}
- Books with No Activity (Need engagement): ${JSON.stringify(quietCircles)}
- Peak discussion hours: ${JSON.stringify(communityStats.peakHours)}

Please write an elegant, editorial-style report (under 300 words) using Markdown:
1. Summarize community activity in a warm, literate, and non-robotic tone.
2. Provide concrete recommendations for the Admins on how to spark engagement in the quiet circles (e.g. suggesting specific icebreaker questions or prompts).
3. Celebrate the star readers and peak hours to help plan meetups.
Do not output raw JSON, only the beautiful markdown report itself. Keep it highly readable and visually polished.
`;

      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are Quill, the literary AI companion. Write beautiful, elegant markdown summaries for SwapSutra Admins."
        }
      });

      res.json({
        success: true,
        stats: communityStats,
        report: response.text
      });

    } catch (err: any) {
      console.error("Quill insights error:", err);
      res.status(500).json({ success: false, message: "Error compiling Quill insights.", error: err.message });
    }
  });

  // Vite/Static serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, server.cjs is bundled inside the 'dist' directory.
    // This means __dirname refers directly to 'dist', while process.cwd() may refer to the project root
    // or a serverless execution root (like /var/task on Vercel).
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
}

startServer();

export default app;
