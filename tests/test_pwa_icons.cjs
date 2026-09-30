/**
 * test_pwa_icons.cjs — renamed in spirit (30 Sep 2026): "SwapSutra is no
 * longer a PWA". The old version checked the install icons; those are
 * gone. This checks the PWA really is removed, and that the notifications
 * which depend on a service worker still work.
 */
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log('PASS: ' + label); }
  else { failed++; console.log('FAIL: ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');
const main = read('src/main.tsx');
const app = read('src/App.tsx');
const sw = read('public/sw.js');
const vercel = JSON.parse(read('vercel.json'));
const pkg = JSON.parse(read('package.json'));
const vite = read('vite.config.ts');

console.log('--- the install / app shell is gone ---');
check('1. No web app manifest is linked', !/rel="manifest"/.test(html));
check('2. No iOS home-screen app tags or icon', !/apple-mobile-web-app|mobile-web-app-capable|apple-touch-icon/.test(html));
check('3. No install prompt: beforeinstallprompt / appinstalled / "Add to home screen" are gone',
  !/beforeinstallprompt|appinstalled|Add to home screen|Add SwapSutra to your home screen|swapsutraInstallPromptDismissed/.test(app));
check('4. No standalone-app detection left', !/display-mode: standalone|navigator as any\)\.standalone/.test(app));
check('5. main.tsx no longer registers the old worker or announces "new version" updates', !/serviceWorker\.register|sw-updated|onupdatefound/.test(main));
check('6. No PWA build plugin / Workbox', !/vite-plugin-pwa|workbox|next-pwa/i.test(JSON.stringify(pkg) + vite));

console.log('--- no offline cache ---');
check('7. The worker has no fetch handler (pages, scripts and images come from the network)', !/addEventListener\(['"]fetch['"]/.test(sw) && !/respondWith/.test(sw));
check('8. It precaches nothing', !/cache\.addAll|STATIC_ASSETS|CACHE_NAME/.test(sw));
check('9. It deletes every cache the old PWA worker left (swapsutra-cache-v1…v7)', /caches\.keys\(\)[\s\S]*caches\.delete\(key\)/.test(sw) && /skipWaiting\(\)/.test(sw) && /clients\.claim\(\)/.test(sw));
check('10. The page also clears old swapsutra-cache-* caches itself', /caches\.keys\(\)[\s\S]*swapsutra-cache-[\s\S]*caches\.delete/.test(main));
check('11. /sw.js is never cached by the browser, so the clean-up worker reaches every phone',
  (vercel.headers || []).some((h) => h.source === '/sw.js' && h.headers.some((x) => /no-cache/.test(x.value))));

console.log('--- notifications still work ---');
check('12. The worker still shows push notifications and handles taps', /addEventListener\('push'/.test(sw) && /showNotification/.test(sw) && /addEventListener\('notificationclick'/.test(sw));
check('13. Pop-ups use the site logo, not a PWA icon file', /icon: '\/swapsutra-logo\.png'/.test(sw) && !/icon-\d+x\d+|icon-maskable/.test(sw + read('src/services/webPushManager.ts')));
check('14. The push worker is still registered (by WebPushManager)', /navigator\.serviceWorker\.register\('\/sw\.js'/.test(read('src/services/webPushManager.ts')) && /WebPushManager\.registerServiceWorker\(\)/.test(app));
check('15. Nothing in the site still points at the removed icon files or manifest',
  !/icon-\d+x\d+\.png|icon-maskable|apple-touch-icon\.png|manifest\.json/.test(html + app + main + sw + read('src/index.css')));
check('16. The browser tab icon (favicon) is kept', /rel="icon" type="image\/png" href="\/swapsutra-logo\.png/.test(html));

console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
process.exit(failed === 0 ? 0 : 1);
