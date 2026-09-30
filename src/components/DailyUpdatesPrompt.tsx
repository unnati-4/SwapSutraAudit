import { useEffect } from 'react';
import { autoAskAllowedNow, enableDailyUpdates, markAutoAsked } from '../services/dailyPush';

/**
 * Notifications on by default (28 Sep).
 *
 * Every visitor and member gets notifications without choosing anything in
 * the app. Browsers still require the visitor's own "Allow" in their box —
 * no site can switch that on for them — and they only show that box in
 * response to a tap. So on the first tap anywhere, the box opens; once it
 * is allowed the device is saved and the daily updates start. There is no
 * on/off switch in SwapSutra: to stop them, a reader uses the browser or
 * phone settings.
 */
export function NotificationAutoEnable({ userEmail }: { userEmail: string | null }) {
  useEffect(() => {
    if (!autoAskAllowedNow()) return;
    let done = false;
    const onTap = () => {
      if (done) return;
      done = true;
      remove();
      if (!autoAskAllowedNow()) return;
      markAutoAsked();
      // Called straight from the tap: iPhone and Firefox only open the
      // box when the request comes from a user gesture.
      enableDailyUpdates(userEmail).catch(() => { /* the browser said no */ });
    };
    const remove = () => {
      window.removeEventListener('pointerup', onTap, true);
      window.removeEventListener('keydown', onTap, true);
    };
    window.addEventListener('pointerup', onTap, true);
    window.addEventListener('keydown', onTap, true);
    return remove;
  }, [userEmail]);
  return null;
}
