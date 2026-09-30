// Simulates the full Priority 1 flow: createBook (genre normalization) ->
// Books sheet row -> getBooks (header-driven read, unchanged mechanism) ->
// frontend genre filter/search logic. Verifies backward compatibility with
// a pre-existing listing row that predates the genre column.

const BOOK_GENRE_OPTIONS = [
  "Fiction", "Romance", "Mystery & Thriller", "Fantasy", "Science Fiction",
  "Historical Fiction", "Young Adult", "Self Help", "Biography", "Memoir",
  "Business", "Psychology", "Philosophy", "Poetry", "Indian Literature",
  "Classics", "Academic", "Children's", "Other"
];
function normalizeBookGenre(raw) {
  const value = String(raw || '').trim();
  return BOOK_GENRE_OPTIONS.includes(value) ? value : '';
}

function getBookHeaders() {
  return [
    "id", "ownerEmail", "title", "author", "condition", "genre", "area", "pincode",
    "favourite", "currently_reading", "tbr", "bookshelf",
    "permanent_exchange", "temporary_exchange", "rent", "sell",
    "available_for_swap", "swapType", "rent_sale_mode", "status"
  ];
}

// Simulates createBook()'s row-construction loop for the fields relevant here.
function simulateCreateBookRow(data, headers) {
  const row = new Array(headers.length).fill("");
  headers.forEach((h, i) => {
    if (h === 'id') row[i] = data.id;
    else if (h === 'ownerEmail') row[i] = data.ownerEmail;
    else if (h === 'title') row[i] = data.title;
    else if (h === 'author') row[i] = data.author;
    else if (h === 'condition') row[i] = data.condition;
    else if (h === 'genre') row[i] = normalizeBookGenre(data.genre);
    else if (h === 'area') row[i] = data.area;
    else if (h === 'bookshelf') row[i] = 'TRUE';
    else if (h === 'status') row[i] = 'Approved'; // pretend already approved for this test
  });
  return row;
}

// Simulates getBooks()'s header-driven object reconstruction (unchanged mechanism —
// any column present in the live sheet header row flows through automatically).
function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i]; });
  return obj;
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  ${detail || ''}`); }
}

const headers = getBookHeaders();

// 1. Create a book WITH a valid genre -> flows through to the read side unchanged.
{
  const row = simulateCreateBookRow({ id: 'B1', ownerEmail: 'a@x.com', title: 'Dune', author: 'Herbert', condition: 'Good', genre: 'Science Fiction', area: 'Andheri' }, headers);
  const obj = rowToObject(headers, row);
  check('1. Valid genre written and read back exactly', obj.genre === 'Science Fiction', JSON.stringify(obj));
}

// 2. Create a book with genre omitted entirely (optional field) -> stored blank, never blocks listing.
{
  const row = simulateCreateBookRow({ id: 'B2', ownerEmail: 'a@x.com', title: 'Untitled Notes', author: 'Someone', condition: 'Fair', area: 'Andheri' }, headers);
  const obj = rowToObject(headers, row);
  check('2. Omitted genre -> stored blank, listing still created', obj.genre === '' && obj.id === 'B2', JSON.stringify(obj));
}

// 3. Create a book with a bogus/unrecognized genre string (API bypass / stale client) -> normalized to blank, not rejected.
{
  const row = simulateCreateBookRow({ id: 'B3', ownerEmail: 'a@x.com', title: 'Hacked Input', author: 'X', condition: 'Good', genre: '<script>evil</script>', area: 'Andheri' }, headers);
  const obj = rowToObject(headers, row);
  check('3. Unrecognized genre string -> normalized to blank, listing still created', obj.genre === '' && obj.id === 'B3', JSON.stringify(obj));
}

// 4. "Other" is a legitimate first-class category, not rejected.
{
  const row = simulateCreateBookRow({ id: 'B4', ownerEmail: 'a@x.com', title: 'Niche Manual', author: 'Y', condition: 'Good', genre: 'Other', area: 'Andheri' }, headers);
  const obj = rowToObject(headers, row);
  check('4. "Other" genre accepted as-is', obj.genre === 'Other', JSON.stringify(obj));
}

// 5. BACKWARD COMPATIBILITY: an old listing row created before the genre column
//    existed. ensureSheetHeaders only APPENDS new columns, so an old row simply
//    has an empty cell in the new genre position when read via header-index mapping.
{
  const oldHeaders = ["id", "ownerEmail", "title", "author", "condition", "area"]; // pre-Priority-1 shape
  const oldRow = ['B0_LEGACY', 'legacy@x.com', 'Legacy Book', 'Old Author', 'Good', 'Bandra'];
  // After ensureSheetHeaders runs, the LIVE header row gains "genre" appended at
  // the end; old rows are untouched, so reading with the NEW header list and the
  // OLD row (shorter array) must not throw and must yield genre === undefined/blank.
  const newHeadersAfterMigration = [...oldHeaders, 'genre'];
  const obj = rowToObject(newHeadersAfterMigration, oldRow); // row has no 6th element -> undefined
  const displayedGenre = obj.genre || 'Genre not specified';
  check('5. Legacy row (no genre column originally) -> reads safely, displays fallback', displayedGenre === 'Genre not specified' && obj.title === 'Legacy Book', JSON.stringify(obj));
}

// --- Frontend filter/search simulation ---
function matchesLibraryFilters(book, { search = '', genreFilter = '' } = {}) {
  const searchLower = search.toLowerCase();
  const matchesSearch = !searchLower
    || book.title.toLowerCase().includes(searchLower)
    || book.author.toLowerCase().includes(searchLower)
    || (book.genre || '').toLowerCase().includes(searchLower);
  const matchesGenre = !genreFilter || book.genre === genreFilter;
  return matchesSearch && matchesGenre;
}

const library = [
  { title: 'Dune', author: 'Frank Herbert', genre: 'Science Fiction' },
  { title: 'Legacy Book', author: 'Old Author', genre: '' }, // no genre
  { title: 'Pride and Prejudice', author: 'Jane Austen', genre: 'Classics' },
];

// 6. Genre filter: selecting "Science Fiction" shows only that book, excludes genre-less legacy book.
check('6. Genre filter excludes non-matching + genre-less books', library.filter(b => matchesLibraryFilters(b, { genreFilter: 'Science Fiction' })).length === 1);

// 7. "All Genres" (empty filter) shows everything, INCLUDING the genre-less legacy book.
check('7. No genre filter selected -> legacy genre-less book still visible', library.filter(b => matchesLibraryFilters(b, { genreFilter: '' })).length === 3);

// 8. Search by genre keyword works (search box promises "title, author, or genre").
check('8. Search "classics" matches by genre', library.filter(b => matchesLibraryFilters(b, { search: 'classics' })).length === 1);

// 9. Search still matches by title/author as before (no regression).
check('9. Search "dune" still matches by title', library.filter(b => matchesLibraryFilters(b, { search: 'dune' })).length === 1);
check('9b. Search "austen" still matches by author', library.filter(b => matchesLibraryFilters(b, { search: 'austen' })).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
