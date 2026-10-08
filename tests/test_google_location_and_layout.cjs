/**
 * test_google_location_and_layout.cjs  (8 Oct 2026, owner's request)
 *   • Meeting points use Google: place search (Apps Script's Maps geocoder),
 *     current location with its address, and pasted Google Maps links —
 *     including short maps.app.goo.gl links, followed on the server.
 *   • Shared pins show on a Google map with "Open in Google Maps" / Directions.
 *   • The exchange room is full screen: steps on the left, chat on the right
 *     (stacked on a phone).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const gs = fs.readFileSync(path.join(root, 'appsscript.js'), 'utf8');
const pinSrc = fs.readFileSync(path.join(root, 'src/components/LocationPin.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
}
const cache = {};
let session = 'a@x.com';
const fetches = [];
const geocodeCalls = [];
const ctx = vm.createContext({
  console: { log() {} }, Logger: { log() {} },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  Maps: { newGeocoder: () => {
    const g = {
      setRegion() { return g; }, setLanguage() { return g; },
      geocode(q) { geocodeCalls.push(q); return q === 'nowhere' ? { results: [] } : { results: [
        { formatted_address: 'Hazratganj Metro Station, Hazratganj, Lucknow, Uttar Pradesh 226001, India', geometry: { location: { lat: 26.8505123, lng: 80.9466789 } } },
        { formatted_address: 'Hazratganj, Lucknow, Uttar Pradesh, India', geometry: { location: { lat: 26.85, lng: 80.94 } } }] }; },
      reverseGeocode(lat, lng) { return { results: [{ formatted_address: 'Gate 2, Sector 5, Noida, India', geometry: { location: { lat, lng } } }] }; }
    };
    return g;
  } },
  UrlFetchApp: { fetch: (url) => { fetches.push(url);
    if (url === 'https://maps.app.goo.gl/abc123') return { getHeaders: () => ({ Location: 'https://www.google.com/maps/place/Cafe+Coffee+Day/@26.86,80.95,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d26.8612345!4d80.9512345' }) };
    return { getHeaders: () => ({}) };
  } },
});
vm.runInContext(gs, ctx);
ctx.getAuthenticatedEmail = () => session;
const run = (fn, arg) => JSON.parse(JSON.stringify(ctx[fn](arg)));

const s = run('geocodePlace', { query: 'Hazratganj metro' });
check('1. Place search returns Google places', s.success && s.places.length === 2 && s.places[0].label === 'Hazratganj Metro Station' && s.places[0].lat === 26.85051, JSON.stringify(s));
run('geocodePlace', { query: 'Hazratganj metro' });
check('2. ...and caches them (one Google call for a repeated search)', geocodeCalls.length === 1);
check('3. Too short a search is refused', run('geocodePlace', { query: 'ab' }).success === false);
check('4. Nothing found → a helpful message', /no place/i.test(run('geocodePlace', { query: 'nowhere' }).message));
session = '';
check('5. Signed out: no searching (protects the daily quota)', run('geocodePlace', { query: 'Lucknow' }).error === 'SESSION_REQUIRED');
session = 'a@x.com';
const r = run('reversePlace', { lat: 28.5355, lng: 77.391 });
check('6. Current location gets its address', r.success && /Noida/.test(r.place.address) && r.place.lat === 28.5355);

const p1 = ctx.pointFromMapsUrl_('https://www.google.com/maps/place/Cafe+Coffee+Day/@26.86,80.95,17z/data=!3d26.8612345!4d80.9512345');
check('7. A full link: the place itself (!3d!4d), not the map centre', p1.pin.lat === 26.86123 && p1.pin.lng === 80.95123 && p1.name === 'Cafe Coffee Day', JSON.stringify(p1));
check('8. ?q=lat,lng links', ctx.pointFromMapsUrl_('https://maps.google.com/?q=28.6139,77.2090').pin.lat === 28.6139);
check('9. @lat,lng links', ctx.pointFromMapsUrl_('https://www.google.com/maps/@19.076,72.8777,15z').pin.lng === 72.8777);
const short = run('resolveMapsLink', { url: 'Cafe Coffee Day https://maps.app.goo.gl/abc123' });
check('10. A short maps.app.goo.gl link (with share text around it) is followed to the place', short.success && short.place.lat === 26.86123 && short.place.label === 'Cafe Coffee Day', JSON.stringify(short));
const named = run('resolveMapsLink', { url: 'https://www.google.com/maps/search/?api=1&query=Hazratganj+metro' });
check('11. A link with only a place name is looked up', named.success && named.place.lat === 26.85051, JSON.stringify(named));
check('12. Non-Google links are refused (no fetching arbitrary sites)', run('resolveMapsLink', { url: 'https://evil.example/x' }).success === false && !fetches.includes('https://evil.example/x'));
check('13. The three actions are routed', ['geocodePlace', 'reversePlace', 'resolveMapsLink'].every(a => gs.includes(`action === '${a}'`)));

check('14. The picker uses Google, not OpenStreetMap/Leaflet', /maps\.google\.com\/maps\?q=/.test(pinSrc) && !/leaflet/i.test(pinSrc) && !/openstreetmap/i.test(pinSrc));
check('15. Picker: search, current location, paste a link', /action: 'geocodePlace'/.test(pinSrc) && /navigator\.geolocation/.test(pinSrc) && /action: 'resolveMapsLink'/.test(pinSrc));
check('16. A shared pin opens in Google Maps, with directions', /Open in Google Maps/.test(pinSrc) && /maps\/dir\/\?api=1&destination=/.test(pinSrc));

check('17. The exchange room fills the screen', /w-full h-\[100dvh\][^"]*" data-testid="exchange-room-screen"/.test(app) && !/max-w-2xl h-\[88dvh\]/.test(app));
check('18. Steps on the left, chat on the right (stacked on a phone)', /flex-1 min-h-0 flex flex-col md:flex-row/.test(app) && /md:w-\[400px\][^"]*md:border-r/.test(app) && /data-testid="room-chat"/.test(app));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
