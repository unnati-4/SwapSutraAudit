import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 30 Sep: SwapSutra is no longer a PWA. There is no install and no
// offline cache. The only service worker left (/sw.js) delivers push
// notifications; WebPushManager registers it. Anything the old app-shell
// worker cached (swapsutra-cache-v1…v7) is deleted here too, so a visitor
// never sees a stale copy of the site even before the new worker runs.
if (typeof window !== 'undefined' && 'caches' in window) {
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => /^swapsutra-cache-/.test(k)).map((k) => caches.delete(k))))
    .catch(() => { /* nothing to clear */ });
}
