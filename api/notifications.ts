// Vercel Serverless Function — push notification routes for SwapSutra
//
// WHY THIS FILE EXISTS
// --------------------
// The push endpoints (/api/notifications/*) were only ever implemented
// in server.ts, which runs for local development and for a self-hosted
// `npm start`. On Vercel, vercel.json forwards /api/:path* to a file of
// that name — and no such file existed, so in production every call to
// subscribe, unsubscribe or fetch the VAPID key hit the SPA fallback and
// returned index.html. The client swallowed the failure, and readers who
// enabled notifications were quietly never subscribed.
//
// This mirrors server.ts's implementation the way api/swapsutra.ts
// mirrors its proxy: duplicated rather than imported, by this codebase's
// existing convention for its two independently-deployed entry points.
// Both must agree, so any change here belongs in server.ts too.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import webpush from 'web-push';
import { timingSafeEqual } from 'crypto';

// ── Daily push copy from Gemini (28 Sep) ─────────────────────────────
// Kept in this file on purpose: Vercel runs api/*.ts as ES modules, and an
// extension-less relative import ("./_dailyCopy") cannot be found at
// runtime — that crashed this whole function (every notification route,
// even vapid-key) with FUNCTION_INVOCATION_FAILED. API files here import
// only packages, never each other.
//
// Apps Script sends a short brief once a day (date, festival, counts, the
// Wanted shelf's top titles — never a reader's name or email) through the
// push relay's secret. Gemini writes the four slots' lines in English;
// they are checked here and again in Apps Script, and anything that fails
// the checks is dropped so the hand-written lines take over.
export const DAILY_LINKS = ['library', 'list', 'wanted', 'cafe', 'events', 'tracker'] as const;
const SLOTS = ['morning', 'afternoon', 'evening', 'night'] as const;

// Tried in order; GEMINI_PUSH_MODEL (Vercel env) goes first when set.
export const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

export function buildPrompt(brief: any): string {
  return [
    'You write push notifications for SwapSutra, an Indian community app where readers list the physical books they have finished and swap them with readers nearby.',
    'Write exactly four notifications for today, one per time slot, in warm, simple English (Indian audience, like Swiggy or GIVA notifications: short, playful, specific).',
    'Slots and their jobs:',
    '- morning (9 am): bring people to the Library to see books.',
    '- afternoon (1 pm): the most important one — persuade people to LIST a book they own (only a front-cover photo is needed, it takes 30 seconds). link must be "list" or "wanted".',
    '- evening (6 pm): community — the Café chat or an event.',
    '- night (9 pm): a calm bedtime reading nudge.',
    'If a festival is today or coming up, theme several slots around it with a book angle (e.g. Diwali cleaning -> list old books; gifting -> gift a book; Navratri -> 9 nights 9 stories). Be respectful and inclusive; greet correctly; do not explain rituals. If phase is "soon", say it is coming (use daysAway), do not wish "Happy" yet.',
    'Rules: title max 60 characters, may start with one emoji. message max 150 characters, no emoji spam (max one). Only use numbers from the data, and never mention a number that is 0. Do not invent books, prices, discounts, prizes, delivery times or events. You may name a title only from mostWantedTitles. No links, emails, hashtags or @.',
    'You may personalise with the placeholder {name} only directly after a greeting, written as ", {name}" (e.g. "Good morning, {name}!"); it is removed for visitors.',
    'link is one of: library, list, wanted, cafe, events, tracker. Use "events" only if nextEvent is given.',
    'Today\'s data (JSON): ' + JSON.stringify(brief),
  ].join('\n');
}

const SLOT_SCHEMA = {
  type: 'OBJECT',
  properties: { title: { type: 'STRING' }, message: { type: 'STRING' }, link: { type: 'STRING', enum: [...DAILY_LINKS] } },
  required: ['title', 'message', 'link'],
};
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: Object.fromEntries(SLOTS.map((s) => [s, SLOT_SCHEMA])),
  required: [...SLOTS],
};

function clean(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > max) return '';
  if (/https?:|www\.|@|\.com\b|#\w/i.test(t)) return '';
  if (/[{}]/.test(t.replace(/\{name\}/g, ''))) return '';
  return t;
}

/** Keeps only well-formed slots. */
export function validateCopy(raw: any, brief?: any): Record<string, { title: string; message: string; link: string }> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, { title: string; message: string; link: string }> = {};
  for (const slot of SLOTS) {
    const s = raw[slot];
    if (!s || typeof s !== 'object') continue;
    const title = clean(s.title, 70);
    const message = clean(s.message, 170);
    const link = (DAILY_LINKS as readonly string[]).includes(s.link) ? s.link : '';
    if (!title || !message || !link) continue;
    if (link === 'events' && !brief?.nextEvent) continue;
    out[slot] = { title, message, link };
  }
  return Object.keys(out).length ? out : null;
}

export async function generateDailyCopy(brief: any, apiKey: string, opts: { model?: string; fetchImpl?: typeof fetch } = {}) {
  if (!apiKey) return { success: false, error: 'GEMINI_NOT_CONFIGURED' };
  const f = opts.fetchImpl || fetch;
  const models = [opts.model, ...DEFAULT_MODELS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  let lastError = '';
  for (const model of models) {
    try {
      const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPrompt(brief) }] }],
          generationConfig: { temperature: 0.9, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
      });
      if (!res.ok) { lastError = `${model}: ${res.status}`; continue; }
      const payload: any = await res.json();
      const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const copy = validateCopy(JSON.parse(text), brief);
      if (copy) return { success: true, model, copy };
      lastError = `${model}: unusable answer`;
    } catch (err: any) {
      lastError = `${model}: ${err?.message || err}`;
    }
  }
  return { success: false, error: 'GEMINI_FAILED', message: lastError };
}


const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';

// Values pasted into Vercel often carry quotes or a trailing newline.
const cleanEnv = (v: string | undefined) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
const VAPID_PUBLIC_KEY = cleanEnv(process.env.VAPID_PUBLIC_KEY);
const VAPID_PRIVATE_KEY = cleanEnv(process.env.VAPID_PRIVATE_KEY);
const VAPID_SUBJECT = cleanEnv(process.env.VAPID_SUBJECT) || 'mailto:swapsutra@gmail.com';

// setVapidDetails throws on a malformed key or subject. At module level
// that used to take the whole function down (every route, even the ones
// that do not push). Now a bad key only switches push off, and /status
// says why.
let vapidError = '';
let pushConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushConfigured = true;
  } catch (err: any) {
    vapidError = String(err?.message || err).slice(0, 200);
    console.error('[push] VAPID keys rejected:', vapidError);
  }
}

export const config = { maxDuration: 30 };

const PUSH_RELAY_SECRET = cleanEnv(process.env.PUSH_RELAY_SECRET);

function relaySecretMatches(given: unknown): boolean {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(PUSH_RELAY_SECRET);
  return PUSH_RELAY_SECRET.length >= 16 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/notifications/relay — called by Apps Script (never a browser)
 * when something happens that a reader should hear about even with the
 * site closed: a community badge, an @mention in the Reader's Café.
 * Guarded by PUSH_RELAY_SECRET, which must match the Script Property of
 * the same name. Without it configured this route refuses everything.
 */
async function handleRelay(req: VercelRequest, res: VercelResponse) {
  if (!relaySecretMatches(req.headers['x-relay-secret'])) {
    return res.status(401).json({ success: false, message: 'Unauthorized.' });
  }
  if (!pushConfigured) {
    return res.status(200).json({ success: false, configured: false, message: 'Push is not configured.' });
  }
  const items: any[] = Array.isArray((req.body || {}).items) ? req.body.items.slice(0, 50) : [];
  const emails = Array.from(new Set(items.map((i) => String(i?.userEmail || '').toLowerCase()).filter(Boolean)));
  if (!emails.length) return res.status(200).json({ success: true, sent: 0 });

  // The daily book updates (27 Sep) arrive with each reader's devices
  // attached, so a batch of 50 does not need a second trip to Apps Script.
  // Everything else (badges, @mentions) still looks the devices up.
  const embedded: any[] = [];
  items.forEach((i) => {
    if (!Array.isArray(i?.devices)) return;
    i.devices.slice(0, 10).forEach((d: any) => {
      if (d && typeof d.endpoint === 'string' && /^https:\/\//.test(d.endpoint) && d.keys?.p256dh && d.keys?.auth) {
        embedded.push({ userEmail: String(i.userEmail || '').toLowerCase(), endpoint: d.endpoint, keys: { p256dh: String(d.keys.p256dh), auth: String(d.keys.auth) } });
      }
    });
  });
  const needLookup = items.some((i) => !Array.isArray(i?.devices));
  const lookup = needLookup
    ? await callAppsScript({ action: 'getPushSubscriptionsForRelay', relaySecret: PUSH_RELAY_SECRET, emails })
    : { subscriptions: [] };
  const subs: any[] = (lookup?.subscriptions || []).concat(embedded);
  let sent = 0;
  let failed = 0;
  await Promise.all(items.map(async (item) => {
    const email = String(item?.userEmail || '').toLowerCase();
    const payload = JSON.stringify({
      title: String(item?.title || 'SwapSutra').slice(0, 120),
      message: String(item?.message || '').slice(0, 240),
      targetUrl: String(item?.targetUrl || '/').startsWith('/') ? String(item.targetUrl) : '/',
      tag: String(item?.tag || 'swapsutra-notification').slice(0, 80),
      type: String(item?.type || 'general')
    });
    const own = Array.isArray(item?.devices)
      ? embedded.filter((s) => s.userEmail === email)
      : subs.filter((s) => s.userEmail === email && !embedded.includes(s));
    await Promise.all(own.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, pushOptionsFor(item));
        sent++;
      } catch (err: any) {
        failed++;
        await callAppsScript({
          action: 'reportPushFailureForRelay',
          relaySecret: PUSH_RELAY_SECRET,
          endpoint: sub.endpoint,
          statusCode: Number(err?.statusCode || 0)
        }).catch(() => { /* reporting must not fail the relay */ });
      }
    }));
  }));
  return res.status(200).json({ success: true, sent, failed });
}


/**
 * How long the push service keeps a pop-up for a phone or laptop that is
 * off / whose browser is closed (28 Sep). When the reader next opens the
 * browser (or the phone comes back online) the waiting pop-ups arrive —
 * so a reader who opens Chrome in the evening still sees the day's
 * notifications. Daily updates keep 12 h (yesterday's "good morning" is
 * noise); everything else a day. "high" urgency so Android delivers it
 * straight away instead of batching it while the phone is idle.
 */
export function pushOptionsFor(item: any) {
  const daily = /^daily_/.test(String(item?.type || ''));
  return { TTL: daily ? 12 * 3600 : 24 * 3600, urgency: 'high' as const };
}

/** What is set up, as yes/no only (never a value) — for the admin check. */
export function pushStatus() {
  return {
    success: true,
    vapidKeys: pushConfigured,
    vapidKeyProblem: vapidError || (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY ? 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set on Vercel' : ''),
    relaySecret: PUSH_RELAY_SECRET.length >= 16,
    geminiKey: Boolean(process.env.GEMINI_API_KEY),
  };
}

function readSessionToken(req: VercelRequest): string {
  const header = req.headers['authorization'];
  const bearer = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : '';
  const body: any = req.body || {};
  return String(bearer || body.sessionToken || req.query?.sessionToken || '').trim();
}

async function callAppsScript(payload: any): Promise<any> {
  if (!APPS_SCRIPT_URL) throw new Error('APPS_SCRIPT_URL is not configured.');
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  return JSON.parse(text);
}

/**
 * The sub-route, taken from the path. vercel.json rewrites
 * /api/notifications/:action to this file, so the last segment is what
 * the caller asked for.
 */
function routeFor(req: VercelRequest): string {
  const fromQuery = String((req.query?.route as string) || '').trim();
  if (fromQuery) return fromQuery;
  const path = String(req.url || '').split('?')[0];
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = routeFor(req);

  try {
    if (route === 'status') return res.status(200).json(pushStatus());

    if (route === 'vapid-key') {
      if (!pushConfigured) {
        return res.status(200).json({
          success: false,
          configured: false,
          message: 'Push notifications are not configured on this server.'
        });
      }
      return res.status(200).json({ success: true, configured: true, publicKey: VAPID_PUBLIC_KEY });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method not allowed.' });
    }

    if (route === 'relay') return await handleRelay(req, res);
    // Daily push copy from Gemini (28 Sep). Apps Script only, with the
    // relay secret; GEMINI_API_KEY is the one Quill already uses.
    if (route === 'daily-copy') {
      if (!relaySecretMatches(req.headers['x-relay-secret'])) {
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
      }
      const result = await generateDailyCopy((req.body || {}).brief || {}, process.env.GEMINI_API_KEY || '', {
        model: process.env.GEMINI_PUSH_MODEL || undefined,
      });
      return res.status(200).json(result);
    }

    const body: any = req.body || {};
    const sessionToken = readSessionToken(req);

    if (route === 'subscribe-push') {
      const { userEmail, endpoint, keys, userAgent } = body;
      if (!userEmail) return res.status(400).json({ success: false, message: 'userEmail required' });
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ success: false, message: 'A complete push subscription is required.' });
      }
      const result = await callAppsScript({
        action: 'savePushSubscription',
        sessionToken,
        userEmail: String(userEmail).toLowerCase(),
        endpoint, keys, userAgent
      });
      return res.status(200).json(result);
    }

    // ── Daily book updates (27 Sep) ────────────────────────────────
    // A visitor who is not signed in can allow notifications too. The
    // device is saved as a guest; it becomes the reader's when they sign
    // in (subscribe-push with the same endpoint).
    if (route === 'subscribe-guest') {
      const { endpoint, keys, userAgent } = body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ success: false, message: 'A complete push subscription is required.' });
      }
      return res.status(200).json(await callAppsScript({ action: 'saveGuestPushSubscription', endpoint, keys, userAgent }));
    }
    // A daily push was tapped. Counts only.
    if (route === 'push-open') {
      return res.status(200).json(await callAppsScript({ action: 'recordPushOpen', slot: String(body.slot || '') }));
    }

    if (route === 'unsubscribe-push') {
      const result = await callAppsScript({
        action: 'deletePushSubscription',
        sessionToken,
        userEmail: body.userEmail ? String(body.userEmail).toLowerCase() : '',
        endpoint: body.endpoint || ''
      });
      return res.status(200).json(result);
    }

    if (route === 'send-push') {
      if (!pushConfigured) {
        return res.status(200).json({
          success: false,
          configured: false,
          message: 'Push notifications are not configured on this server.'
        });
      }
      const { userEmail, title, message, targetUrl, tag, type, entityId } = body;
      if (!userEmail || !title) {
        return res.status(400).json({ success: false, message: 'userEmail and title are required.' });
      }

      const lookup = await callAppsScript({
        action: 'getPushSubscriptions',
        sessionToken,
        userEmail: String(userEmail).toLowerCase()
      });
      const subscriptions: any[] = lookup?.subscriptions || [];
      if (!subscriptions.length) {
        return res.status(200).json({ success: true, sent: 0, message: 'No registered devices for this reader.' });
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
      let failed = 0;

      await Promise.all(subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
          sent++;
        } catch (err: any) {
          failed++;
          // A 404 or 410 means the browser threw the subscription away;
          // reporting it retires the row instead of retrying for ever.
          await callAppsScript({
            action: 'reportPushFailure',
            sessionToken,
            endpoint: sub.endpoint,
            statusCode: Number(err?.statusCode || 0)
          }).catch(() => { /* a failed report must not fail the send */ });
        }
      }));

      return res.status(200).json({ success: true, sent, failed });
    }

    return res.status(404).json({ success: false, message: 'Unknown notification route.' });
  } catch (err: any) {
    console.error('[Push] route failed:', err?.message || err);
    return res.status(502).json({ success: false, message: 'Could not complete the notification request.' });
  }
}
