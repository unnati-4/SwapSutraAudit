# SwapSutra — Price Boundary Engine

Decides the range a reader may price a book within, from its ISBN, format,
edition tier and condition. Architecture and rationale: see ARCHITECTURE.html.

## Setup

    createdb swapsutra
    psql -d swapsutra -f sql/001_schema.sql
    psql -d swapsutra -f sql/002_staging.sql

On Supabase, run both files in the SQL editor. `anon` and `authenticated`
already exist there; the guard in 001 is for plain Postgres and CI.

## Verify

    psql -d swapsutra -f tests/test_schema.sql     # 17 constraint checks
    python3 tests/test_boundaries.py               # 41 engine tests
    python3 pipeline/extract.py                    # the hallucination gate

The schema tests need a FRESH database. They run in a transaction that is
rolled back, so they are repeatable — but a database that already holds a
previous run's committed fixtures will collide.

## Load the existing spreadsheet

    python3 -m pipeline.import_legacy_xlsx --xlsx ../SwapSutra-Book-Prices.xlsx --out ./staging

## Load Open Library

Bulk catalogue ingestion uses the monthly **data dumps**, not the API. Open
Library asks explicitly that the API not be used for bulk download, and a
per-ISBN API call for millions of editions would be both slow and unwelcome.
The API is used only for the cache-miss case: a reader scanned an ISBN the
dump-loaded catalogue does not have (`api/books.ts`), which stores the record
permanently so the same ISBN is never fetched twice.

    Open Library dump -> staging_editions -> merge_staged_editions() -> catalogue

    python3 -m pipeline.ingest_openlibrary --resolve      # prints a dated URL
    # pin that URL, download it, then:
    python3 -m pipeline.ingest_openlibrary --dump ol_dump_editions_YYYY-MM-DD.txt.gz --out ./staging
    # the command prints the exact psql load sequence

Never point ingestion at the `_latest` URL. It is a redirect that is
documented to break after each monthly regeneration.

## Apps Script Script Properties

Apps Script reaches the catalogue directly (Extensions → Apps Script →
Project Settings → Script Properties):

    SUPABASE_URL                 https://your-project.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    the service role key

Without them, `resolveListingPricing()` falls back to the `BookPrices`
sheet and marks the listing `SHEET_FALLBACK`. Listings keep working; the
prices are weaker. Find them later with:

    SELECT listing_id, isbn13, created_at
    FROM listing_prices WHERE methodology = 'SHEET_FALLBACK';

### Gemini-estimated pricing (between the catalogue and the sheet)

    GEMINI_API_KEY                a Gemini API key

Most real ISBNs a reader scans are simply not in the catalogue yet — bulk
ingestion is a manual/periodic process (see "Load Open Library" above), not
a live per-request lookup. When the catalogue genuinely has no data for an
edition (not a price refusal — a miss), `resolveListingPricing()` now asks
Gemini for a realistic INR market-price range for that exact edition +
condition before falling all the way back to the sheet. The response is
validated server-side (see `validateGeminiPriceEstimate` in appsscript.js)
and, on success, written to `listing_prices` tagged
`methodology = 'GEMINI_ESTIMATED'` — run `sql/008_gemini_estimated_methodology.sql`
once so that value exists in the `boundary_method` enum, or the write
silently falls back to a `GeminiPriceEstimates` sheet cache instead. Without
`GEMINI_API_KEY` set, this tier is skipped cleanly and behaviour is
unchanged from before. Find these estimates later with:

    SELECT listing_id, isbn13, reference_price, confidence, created_at
    FROM listing_prices WHERE methodology = 'GEMINI_ESTIMATED';

## Runtime migration order

    psql $DATABASE_URL -f sql/001_schema.sql
    psql $DATABASE_URL -f sql/002_staging.sql
    psql $DATABASE_URL -f sql/003_runtime.sql

## Verify

    psql -d <fresh-db> -f tests/test_schema.sql       # 17 constraint checks
    psql -d <fresh-db> -f tests/test_runtime.sql      # 29 end-to-end checks
    python3 tests/test_boundaries.py                  # 41 engine tests
    python3 tests/test_conformance.py <db>            # 31 SQL-vs-Python checks
    psql -d <fresh-db> -f tests/test_corrections.sql  # 36 correction checks
    npx tsx tests/test_books_api.ts                   # API checks (repo root)
    node tests/test_catalogue_integration.cjs         # Apps Script checks

## The three figures, and why they are separate

    You may list this book for   Rs.X - Rs.Y   the ALLOWED LISTING RANGE
    SwapSutra reference value    Rs.Z          the engine's valuation
    Security deposit             Rs.D          a condition-tiered % of the reference value
                                                (60% New, 55% Mid, 50% Poor — see
                                                deposit_rate_for_condition)

The seller chooses inside the range. The reference value is SwapSutra's own
deterministic valuation for swap, rent and lend — it is not a claim about
what the book is worth on the open market, and where there are no
observations it is explicitly an MRP-derived estimate. The deposit comes from
the reference value and never from the seller's chosen price, so listing
higher cannot increase what the other reader puts down.

## MRP evidence hierarchy

    1. PHOTO_VERIFIED      admin confirmed the printed MRP in the reader's photo
    2. CATALOGUE_VERIFIED  already verified for this edition
    3. PUBLISHER_SOURCED   publisher/trade page, quote checked against the page
    4. USER_PROVISIONAL    reader typed it, nothing corroborates it

Tiers 1-3 anchor a price. Tier 4 is recorded and shown as provisional, and
does not participate in pricing. Category plausibility is a sanity check, not
proof. Find claims waiting on review with:

    SELECT bp.id, e.title, bp.price, bp.source_url
    FROM book_prices bp JOIN editions e ON e.id = bp.edition_id
    WHERE bp.kind = 'MRP' AND bp.evidence_tier = 'USER_PROVISIONAL'
      AND NOT bp.excluded;

## Platform policies (not legal rules)

The MRP cap and the exclusion of unauthorised copies are **SwapSutra policy
decisions**, recorded here so nobody later mistakes them for statutory
requirements:

* Used-book pricing is capped at the printed MRP because a second-hand copy
  listed above the price of a new one is a bad outcome for the buyer.
* Unauthorised copies can be declared but are excluded from pricing and from
  paid transactions, because facilitating their sale or rental creates
  unnecessary copyright and platform-risk exposure.

Neither is a legal conclusion. The statutory position is a question for
SwapSutra's own legal advice.
