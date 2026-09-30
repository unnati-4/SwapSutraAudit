// Standalone mirror of the "Show books near me" filter inside filteredBooks
// (src/App.tsx). Reproduces and verifies the fix for the reported bug:
// listed, approved books were not visible on the Discover/Library page.
//
// Root cause: the old filter hard-excluded ANY book lacking BOTH latitude
// and longitude the instant a user turned on "Show books near me"
// (`return false` for every book without coordinates, no fallback).
// Location-tagging a listing is an entirely optional step in the listing
// form (a "Tag My Location" button the reader must actively tap), so
// almost no real listing ever has coordinates -- meaning "near me" was
// silently wiping out nearly the entire Library the moment it was used.

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// OLD (buggy) behavior, kept only to prove the bug existed / regress-test
// against it ever coming back.
function applyNearbyFilterOLD(books, userCoords) {
  if (!userCoords) return books;
  let result = books.filter(book => {
    if (book.latitude && book.longitude) {
      const dist = haversineDistance(userCoords.lat, userCoords.lng, book.latitude, book.longitude);
      return dist <= 25;
    }
    return false;
  });
  result.sort((a, b) => {
    const distA = haversineDistance(userCoords.lat, userCoords.lng, a.latitude, a.longitude);
    const distB = haversineDistance(userCoords.lat, userCoords.lng, b.latitude, b.longitude);
    return distA - distB;
  });
  return result;
}

// FIXED behavior, exact mirror of the new App.tsx logic.
function applyNearbyFilterFIXED(books, userCoords) {
  if (!userCoords) return books;
  return books
    .map(book => ({
      book,
      dist: (book.latitude && book.longitude)
        ? haversineDistance(userCoords.lat, userCoords.lng, book.latitude, book.longitude)
        : null
    }))
    .filter(({ dist }) => dist === null || dist <= 25)
    .sort((a, b) => {
      if (a.dist === null && b.dist === null) return 0;
      if (a.dist === null) return 1;
      if (b.dist === null) return -1;
      return a.dist - b.dist;
    })
    .map(({ book }) => book);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}  ${detail ? JSON.stringify(detail) : ''}`); }
}

const userCoords = { lat: 28.6139, lng: 77.2090 }; // New Delhi
const nearbyCoords = { lat: 28.7041, lng: 77.1025 }; // ~14km away, Delhi
const farCoords = { lat: 19.0760, lng: 72.8777 }; // Mumbai, ~1150km away

const books = [
  { id: 'b1', title: 'Untagged Book (never location-tagged, the common case)' }, // no lat/lng at all
  { id: 'b2', title: 'Nearby Tagged Book', latitude: nearbyCoords.lat, longitude: nearbyCoords.lng },
  { id: 'b3', title: 'Far Away Tagged Book', latitude: farCoords.lat, longitude: farCoords.lng },
  { id: 'b4', title: 'Another Untagged Book' },
];

(async () => {
  // --- Prove the OLD behavior was the bug ---
  const oldResult = applyNearbyFilterOLD(books, userCoords);
  check('OLD (buggy): untagged books vanish entirely once "near me" is on', !oldResult.some(b => b.id === 'b1' || b.id === 'b4'));
  check('OLD (buggy): only the one geotagged nearby book survives', oldResult.length === 1 && oldResult[0].id === 'b2');

  // --- Verify the FIX ---
  const fixedResult = applyNearbyFilterFIXED(books, userCoords);
  check('1. Fixed: untagged books stay visible (this is the actual reported bug)', fixedResult.some(b => b.id === 'b1') && fixedResult.some(b => b.id === 'b4'));
  check('2. Fixed: a genuinely nearby geotagged book is included', fixedResult.some(b => b.id === 'b2'));
  check('3. Fixed: a genuinely far-away geotagged book (>25km) is still excluded', !fixedResult.some(b => b.id === 'b3'));
  check('4. Fixed: total count is untagged(2) + nearby(1) = 3, far one dropped', fixedResult.length === 3, fixedResult.map(b => b.id));
  check('5. Fixed: the nearby geotagged book sorts first (known-distance before unknown-distance)', fixedResult[0].id === 'b2', fixedResult.map(b => b.id));
  check('6. No "near me" filter active -> nothing is touched at all', applyNearbyFilterFIXED(books, null).length === books.length);

  // A library with only untagged listings (the realistic common case) must
  // not go empty just because someone taps "Show books near me".
  const onlyUntagged = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }];
  check('7. A Library of only untagged books stays fully visible under "near me"', applyNearbyFilterFIXED(onlyUntagged, userCoords).length === 3);

  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
})();
