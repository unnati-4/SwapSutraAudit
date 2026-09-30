/**
 * Web Push & browser notification manager for SwapSutra (a normal website; the service worker is push-only)
 */

import { PushSubscriptionData } from '../types/notification';
import {apiUrl} from '../config/runtime';

/**
 * The VAPID public key comes from the server, not from this file.
 *
 * It used to be a hardcoded placeholder string — not a real key, and one
 * no push service would ever accept. pushManager.subscribe() therefore
 * failed on every browser, and because the failure was caught and
 * logged, a reader who granted notification permission was shown success
 * and then never received anything.
 *
 * Fetched once per page and cached in memory. When the server has no
 * keys configured it says so, and subscribeUserToPush stops rather than
 * repeating the same silent lie.
 */
let cachedVapidKey: string | null = null;

export async function getPublicVapidKey(): Promise<string> {
  if (cachedVapidKey !== null) return cachedVapidKey;
  try {
    const res = await fetch(apiUrl('/api/notifications/vapid-key'));
    const data = await res.json();
    cachedVapidKey = data?.success && data?.publicKey ? String(data.publicKey) : '';
  } catch (err) {
    console.warn('[WebPushManager] Could not fetch the VAPID key:', err);
    cachedVapidKey = '';
  }
  return cachedVapidKey;
}

export function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export class WebPushManager {
  private static swRegistration: ServiceWorkerRegistration | null = null;

  /**
   * Register service worker if supported
   */
  public static async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.warn('Service Worker is not supported in this environment');
      return null;
    }

    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      this.swRegistration = reg;
      console.log('[WebPushManager] Service Worker registered with scope:', reg.scope);
      return reg;
    } catch (err) {
      console.error('[WebPushManager] Service Worker registration failed:', err);
      return null;
    }
  }

  /**
   * Check current Notification permission status
   */
  public static getPermissionStatus(): NotificationPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  }

  /**
   * Request Notification permission from the user
   */
  public static async requestPermission(): Promise<NotificationPermission> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      console.log('[WebPushManager] Notification permission result:', permission);
      return permission;
    } catch (err) {
      console.error('[WebPushManager] Error requesting notification permission:', err);
      return 'denied';
    }
  }

  /**
   * Subscribe user device to Web Push
   */
  public static async subscribeUserToPush(userEmail: string): Promise<PushSubscriptionData | null> {
    const permission = await this.requestPermission();
    if (permission !== 'granted') {
      console.warn('[WebPushManager] Permission not granted for push notifications');
      return null;
    }

    let reg = this.swRegistration;
    if (!reg && 'serviceWorker' in navigator) {
      reg = await navigator.serviceWorker.ready;
      this.swRegistration = reg;
    }

    if (!reg) {
      console.error('[WebPushManager] Service worker registration missing');
      return null;
    }

    try {
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        const publicKey = await getPublicVapidKey();
        if (!publicKey) {
          // Push is not configured on this deployment. Say so instead of
          // subscribing to nothing and reporting success.
          console.warn('[WebPushManager] Push is not configured on this server; skipping subscription.');
          return null;
        }
        const convertedKey = urlBase64ToUint8Array(publicKey);
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey as BufferSource
        });
      }

      const p256dh = subscription.getKey('p256dh');
      const auth = subscription.getKey('auth');

      const subData: PushSubscriptionData = {
        userEmail: userEmail.toLowerCase(),
        endpoint: subscription.endpoint,
        keys: {
          p256dh: p256dh ? btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(p256dh)))) : '',
          auth: auth ? btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(auth)))) : ''
        },
        userAgent: navigator.userAgent,
        subscribedAt: new Date().toISOString()
      };

      // Store subscription in localStorage
      localStorage.setItem(`swapsutra_push_sub_${userEmail.toLowerCase()}`, JSON.stringify(subData));

      // Sync subscription to backend server
      try {
        await fetch(apiUrl('/api/notifications/subscribe-push'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subData)
        });
      } catch (e) {
        console.warn('[WebPushManager] Failed to sync push subscription to server endpoint:', e);
      }

      return subData;

    } catch (err) {
      console.error('[WebPushManager] Error subscribing to push:', err);
      return null;
    }
  }

  /**
   * Unsubscribe user device from Web Push
   */
  public static async unsubscribeUserFromPush(userEmail: string): Promise<boolean> {
    let unsubscribedEndpoint = '';
    try {
      if (this.swRegistration) {
        const subscription = await this.swRegistration.pushManager.getSubscription();
        if (subscription) {
          // Captured before unsubscribing — afterwards the endpoint is
          // gone, and it is what identifies this one device.
          unsubscribedEndpoint = subscription.endpoint;
          await subscription.unsubscribe();
        }
      }

      localStorage.removeItem(`swapsutra_push_sub_${userEmail.toLowerCase()}`);

      await fetch(apiUrl('/api/notifications/unsubscribe-push'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Endpoint as well as email: without it the backend retires
        // every device the reader has, so turning notifications off on a
        // laptop would also silence their phone.
        body: JSON.stringify({ userEmail: userEmail.toLowerCase(), endpoint: unsubscribedEndpoint })
      }).catch(() => {});

      return true;
    } catch (err) {
      console.error('[WebPushManager] Error unsubscribing:', err);
      return false;
    }
  }

  /**
   * Display an immediate browser notification (from the open site)
   */
  public static displayLocalNotification(title: string, options: {
    body: string;
    targetUrl?: string;
    icon?: string;
    tag?: string;
  }) {
    if (this.getPermissionStatus() !== 'granted') return;

    const { body, targetUrl = '/', icon = '/swapsutra-logo.png', tag = 'swapsutra' } = options;

    const popup = {
      body,
      icon,
      tag,
      // Same tag as the server push for this event: replace it quietly
      // instead of ringing twice.
      renotify: false,
      data: { targetUrl },
      vibrate: [100, 50, 100]
    } as any;
    const reg = this.swRegistration;
    if (reg && reg.showNotification) {
      // Already on screen from the server push? Leave it alone.
      reg.getNotifications({ tag }).then((open) => {
        if (!open.length) reg.showNotification(title, popup);
      }).catch(() => reg.showNotification(title, popup));
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((r) => { this.swRegistration = r; return r.showNotification(title, popup); })
        .catch(() => { try { new Notification(title, { body, icon, tag }); } catch { /* ignore */ } });
    } else {
      const n = new Notification(title, { body, icon, tag });
      n.onclick = () => {
        window.focus();
        if (targetUrl) window.location.href = targetUrl;
        n.close();
      };
    }
  }
}
