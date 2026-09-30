/**
 * Daily book updates (27 Sep) — the browser side.
 *
 * The founder wants anyone who opens SwapSutra in a browser, or has the
 * app installed, to get 3–4 short pushes a day (fresh books near them,
 * a nudge to list, café, tonight's pick). The sending happens in Apps
 * Script (runDailyEngagementPush). This file:
 *   · turns notifications on by default (28 Sep): the browser's own
 *     "Allow" box opens on the visitor's first tap — browsers only show it
 *     after a tap, and only the visitor can press Allow;
 *   · saves the device — as the signed-in reader's, or as a guest's;
 *   · keeps an already-allowed device registered (e.g. after sign-in, the
 *     guest device becomes the reader's);
 *   · counts a tap on a daily push (?ss_push=<slot>).
 * There is no on/off switch in the app: a reader who wants them off turns
 * them off in the browser or phone settings.
 */
import { apiUrl } from '../config/runtime';
import { getPublicVapidKey, urlBase64ToUint8Array } from './webPushManager';

const K = { syncedFor: 'ss_daily_push_synced_for', askedAt: 'ss_push_auto_asked_at' };

function ls(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
function lsGet(k: string) { try { return ls()?.getItem(k) ?? null; } catch { return null; } }
function lsSet(k: string, v: string) { try { ls()?.setItem(k, v); } catch { /* private mode */ } }

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function permission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

/**
 * Should the browser's "Allow notifications?" box be opened now? Only
 * while the visitor has not decided (a "Block" is final — browsers do not
 * let a site ask again), and at most once a day so a dismissed box is not
 * pushed at every tap (Chrome starts hiding boxes that are dismissed a lot).
 */
export function shouldAutoAsk(opts: { supported: boolean; permission: string; askedAt: number | null; now: number }): boolean {
  if (!opts.supported || opts.permission !== 'default') return false;
  if (opts.askedAt && opts.now - opts.askedAt < 24 * 3600 * 1000) return false;
  return true;
}

export function autoAskAllowedNow(): boolean {
  return shouldAutoAsk({ supported: pushSupported(), permission: String(permission()), askedAt: Number(lsGet(K.askedAt) || 0) || null, now: Date.now() });
}

export function markAutoAsked() { lsSet(K.askedAt, String(Date.now())); }

async function deviceSubscription(create: boolean): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await navigator.serviceWorker.getRegistration('/') || undefined;
    if (!reg) reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    reg = await navigator.serviceWorker.ready;
  } catch { return null; }
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    const key = await getPublicVapidKey();
    if (!key) return null; // push not configured on this deployment
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource });
  }
  return sub;
}

function toBody(sub: PushSubscription) {
  const json: any = sub.toJSON ? sub.toJSON() : {};
  return { endpoint: sub.endpoint, keys: { p256dh: json?.keys?.p256dh || '', auth: json?.keys?.auth || '' }, userAgent: navigator.userAgent };
}

async function post(path: string, body: any) {
  const res = await fetch(apiUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { return await res.json(); } catch { return { success: false }; }
}

/** Saves this device for the signed-in reader, or as a guest. */
async function register(sub: PushSubscription, userEmail?: string | null) {
  const body = toBody(sub);
  if (userEmail) return post('/api/notifications/subscribe-push', { ...body, userEmail: userEmail.toLowerCase() });
  return post('/api/notifications/subscribe-guest', body);
}

/**
 * Opens the browser's permission box (must run inside a tap), then saves
 * the device.
 */
export async function enableDailyUpdates(userEmail?: string | null): Promise<'on' | 'denied' | 'unsupported' | 'failed'> {
  if (!pushSupported()) return 'unsupported';
  let p: NotificationPermission = Notification.permission;
  if (p === 'default') { try { p = await Notification.requestPermission(); } catch { p = 'denied'; } }
  if (p !== 'granted') return 'denied';
  try {
    const sub = await deviceSubscription(true);
    if (!sub) return 'failed';
    const saved = await register(sub, userEmail);
    if (!saved?.success) return 'failed';
    lsSet(K.syncedFor, `${userEmail || 'guest'}|${new Date().toISOString().slice(0, 10)}`);
    return 'on';
  } catch { return 'failed'; }
}

/**
 * A device that already allowed notifications is kept registered: once a
 * day, and again whenever the reader changes (a guest signs in).
 */
export async function syncDevice(userEmail?: string | null): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const mark = `${userEmail || 'guest'}|${new Date().toISOString().slice(0, 10)}`;
  if (lsGet(K.syncedFor) === mark) return false;
  try {
    const sub = await deviceSubscription(true);
    if (!sub) return false;
    const saved = await register(sub, userEmail);
    if (saved?.success) lsSet(K.syncedFor, mark);
    return Boolean(saved?.success);
  } catch { return false; }
}

/** The slot in ?ss_push=<slot>, if the page was opened from a daily push. */
export function pushSlotFromUrl(href: string): string {
  try {
    const slot = new URL(href, 'http://x').searchParams.get('ss_push') || '';
    return /^(morning|afternoon|evening|night)$/.test(slot) ? slot : '';
  } catch { return ''; }
}

/** Counts the tap and removes the marker from the address bar. */
export function recordPushOpenFromUrl() {
  if (typeof window === 'undefined') return;
  const slot = pushSlotFromUrl(window.location.href);
  if (!slot) return;
  post('/api/notifications/push-open', { slot }).catch(() => { /* counting only */ });
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('ss_push');
    window.history.replaceState(window.history.state, '', url.pathname + (url.search || '') + url.hash);
  } catch { /* cosmetic */ }
}
