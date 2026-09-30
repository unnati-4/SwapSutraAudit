-- ══════════════════════════════════════════════════════════════════════════
-- SwapSutra — pricing catalogue schema
-- PostgreSQL 15+ / Supabase
--
-- WHAT THIS IS FOR
-- One question, asked millions of times: "a reader scanned this ISBN and
-- chose this format and condition — what may they price it at?"
-- Everything here exists to answer that in a single indexed lookup, and to
-- make the answer auditable afterwards.
--
-- THE SPINE IS MRP, NOT SCRAPED MARKET PRICE
-- Indian books are, in practice, printed with an MRP on the cover, so most
-- physical copies carry a publisher-set INR number that needs no API, no
-- scraping and no ToS risk to obtain. (Whether and exactly how that is
-- mandated is a question for SwapSutra's own legal review — this system
-- relies on the number being PRESENT and legible, not on any particular
-- statutory characterisation of it.) Amazon's PA-API is deprecated and its
-- successor needs 10 qualifying affiliate sales a month; amazon.in and
-- flipkart.com both prohibit scraping in terms (Flipkart names "page-scrape"
-- explicitly); Google Books saleInfo returns Play Books EBOOK prices, which
-- are not print prices. So market observations are modelled here as a
-- CORRECTION to MRP rather than as the primary signal — and every
-- observation carries enough provenance that an ebook price can never
-- silently contaminate a print band.
--
-- THE UNIT OF PRICING IS THE EDITION, NOT THE TITLE
-- A Penguin India paperback and an imported hardcover of the same novel are
-- different price objects. Open Library models this as work (the abstract
-- book) vs edition (a specific published manifestation); ISBNs live only on
-- editions. That grain is preserved here.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fuzzy title match, tier-2 lookup
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid


-- ═══════════════════════════════════════════════════ 1. CONTROLLED VOCABULARY

-- Format and edition are two independent axes. They are frequently modelled
-- as one field ("what kind of copy is this?"), which is why hardcover tends
-- to have nowhere to live: a hardcover can be a publisher edition OR a budget
-- reprint, and one column can only say one of those.
CREATE TYPE book_format AS ENUM (
  'HARDCOVER',
  'TRADE_PAPERBACK',        -- the standard publisher paperback
  'MASS_MARKET_PAPERBACK',  -- smaller, cheaper newsprint stock
  'BOARD_BOOK',
  'SPIRAL',
  'UNKNOWN'
);

CREATE TYPE book_edition_tier AS ENUM (
  'PUBLISHER',      -- the standard edition from the publisher
  'INDIAN_REPRINT', -- licensed Indian printing / South Asia / student edition
  'IMPORT',         -- imported copy, prices like an import
  'UNOFFICIAL',     -- see the note on UNOFFICIAL below
  'NOT_SURE'
);

-- ── On UNOFFICIAL ────────────────────────────────────────────────────────
-- This value exists so a reader can tell the truth. If the platform offers
-- no honest option, unauthorised copies get declared as "publisher edition"
-- instead, and the entire price dataset silently rots — a worse outcome for
-- data quality AND for the reader on the other side of the swap.
--
-- What it does NOT do is acquire a price. No market observation is ever
-- collected for an UNOFFICIAL copy, no boundary row is computed for one, and
-- the constraint on book_price_boundaries below makes that structural rather
-- than a matter of pipeline discipline. Such a copy is ineligible for SELL
-- and RENT; for SWAP and LEND it carries a flat platform-set nominal deposit
-- that represents "someone is trusting you with a physical object", not a
-- valuation.
--
-- The reason is a risk decision, not a legal conclusion: unauthorised copies
-- are excluded from pricing and from paid transactions because facilitating
-- their sale or rental creates unnecessary copyright and platform-risk
-- exposure for SwapSutra. This file does not assert what any particular
-- statute would or would not require; that is for SwapSutra's own legal
-- advice to determine. The engineering position is simply that the platform
-- does not price or monetise them.

CREATE TYPE book_condition AS ENUM (
  'AS_NEW',      -- indistinguishable from new
  'VERY_GOOD',   -- read once or twice, no marks
  'GOOD',        -- normal shelf wear, fully intact
  'FAIR',        -- heavy wear, highlighting, intact and readable
  'POOR'         -- readable but damaged; usually give-away only
);

CREATE TYPE price_kind AS ENUM (
  'MRP',            -- printed cover price. The anchor.
  'NEW_RETAIL',     -- a live new-copy selling price
  'USED_RETAIL',    -- a live used-copy selling price
  'EBOOK',          -- Play Books et al. NEVER mixed into a print band.
  'SWAPSUTRA_TXN'   -- a completed transaction on our own platform
);

CREATE TYPE price_source_kind AS ENUM (
  'PUBLISHER_SITE',
  'GOOGLE_BOOKS',
  'NIELSEN_BOOKDATA',
  'AMAZON_CREATORS_API',
  'ISBNDB',
  'ADMIN_MANUAL',
  'USER_DECLARED_MRP',   -- typed or OCR'd from the reader's own photo
  'SWAPSUTRA_INTERNAL',
  'LEGACY_SHEET'         -- the original 72-row xlsx
);

-- Where a boundary's numbers actually came from. Stored on every boundary row
-- so a number can always be traced back to the rule that produced it.
CREATE TYPE boundary_method AS ENUM (
  'EDITION_OBSERVATIONS',  -- tier 1: enough observations for this exact edition
  'TITLE_OBSERVATIONS',    -- tier 2: same title + format, other editions
  'PUBLISHER_PRIOR',       -- tier 3: same publisher + format + category
  'CATEGORY_PRIOR',        -- tier 4: category/genre fallback
  'MRP_DERIVED',           -- MRP known, discount ratio from the group prior
  'INSUFFICIENT_DATA'      -- nothing defensible. No band is published.
);


-- ═══════════════════════════════════════════════════════════ 2. THE CATALOGUE

-- A work is the abstract book; an edition is a published manifestation.
-- Deduplication happens at the work level, pricing at the edition level.
CREATE TABLE works (
  id                BIGSERIAL PRIMARY KEY,
  ol_work_key       TEXT UNIQUE,                  -- '/works/OL27448W'
  title             TEXT NOT NULL,
  title_normalised  TEXT NOT NULL,                -- lowercased, punctuation stripped
  author_primary    TEXT,
  subjects          TEXT[] DEFAULT '{}',
  category          TEXT,                         -- our own genre taxonomy
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN works.title_normalised IS
  'Lowercase, punctuation and articles stripped. Open Library has duplicate '
  'works for the same book (author name order varies: "Gelman Andrew" vs '
  '"Andrew Gelman"), so title matching needs a normalised form, not the raw '
  'title.';

CREATE TABLE editions (
  id                 BIGSERIAL PRIMARY KEY,
  work_id            BIGINT REFERENCES works(id) ON DELETE SET NULL,

  -- ISBN-13 is the canonical key. ISBN-10 is stored for lookup only: every
  -- 10 is convertible to a 13, never the reverse, so the 13 is the one that
  -- can be relied on to exist.
  isbn13             CHAR(13),
  isbn10             CHAR(10),

  title              TEXT NOT NULL,
  subtitle           TEXT,
  authors            TEXT[] DEFAULT '{}',
  publisher          TEXT,
  publisher_normalised TEXT,
  publication_year   SMALLINT,
  edition_name       TEXT,                        -- "3rd South Asia Edition"
  format             book_format NOT NULL DEFAULT 'UNKNOWN',
  edition_tier       book_edition_tier NOT NULL DEFAULT 'NOT_SURE',
  language           CHAR(3),                     -- MARC code: 'eng', 'hin'
  page_count         INTEGER,
  cover_id           INTEGER,                     -- covers.openlibrary.org
  is_set             BOOLEAN NOT NULL DEFAULT FALSE,
  volume_count       SMALLINT,

  ol_edition_key     TEXT,                        -- '/books/OL7353617M'
  source             price_source_kind,
  source_record_ids  TEXT[] DEFAULT '{}',

  -- Populated by the pricing pipeline, read on every listing.
  mrp_inr            NUMERIC(10,2),
  mrp_confidence     REAL CHECK (mrp_confidence BETWEEN 0 AND 1),
  mrp_verified_at    TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A checksum-valid ISBN-13 or nothing. Open Library does not guarantee
  -- valid ISBNs, and an invalid one silently prices the wrong book.
  CONSTRAINT editions_isbn13_shape CHECK (isbn13 IS NULL OR isbn13 ~ '^97[89][0-9]{10}$'),
  CONSTRAINT editions_isbn10_shape CHECK (isbn10 IS NULL OR isbn10 ~ '^[0-9]{9}[0-9X]$'),
  CONSTRAINT editions_year_sane    CHECK (publication_year IS NULL
                                          OR publication_year BETWEEN 1400 AND 2100),
  CONSTRAINT editions_mrp_positive CHECK (mrp_inr IS NULL OR mrp_inr > 0)
);

-- ── Why isbn13 is NOT UNIQUE ─────────────────────────────────────────────
-- The Open Library dumps genuinely contain multiple edition records carrying
-- the same ISBN pair (a documented duplicate class, e.g. two records for
-- "How to solve it" both with the same two ISBNs). A UNIQUE constraint would
-- reject ~real data at import and force a lossy choice at 9GB scale.
-- Instead: many edition rows may share an ISBN, and exactly one of them is
-- marked canonical. Lookups go through the canonical one.
ALTER TABLE editions ADD COLUMN is_canonical BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX editions_one_canonical_per_isbn
  ON editions (isbn13) WHERE is_canonical AND isbn13 IS NOT NULL;

-- The hot path: ISBN -> edition. Partial, because ~36% of Open Library
-- editions have no ISBN at all and indexing those nulls buys nothing.
CREATE INDEX editions_isbn13_idx ON editions (isbn13) WHERE isbn13 IS NOT NULL;
CREATE INDEX editions_isbn10_idx ON editions (isbn10) WHERE isbn10 IS NOT NULL;
CREATE INDEX editions_work_idx   ON editions (work_id);
CREATE INDEX editions_ol_key_idx ON editions (ol_edition_key);

-- Tier-2 fallback: same title + format, different edition.
CREATE INDEX editions_title_trgm ON editions USING gin (title gin_trgm_ops);
-- Tier-3 fallback: same publisher + format.
CREATE INDEX editions_publisher_format_idx ON editions (publisher_normalised, format)
  WHERE publisher_normalised IS NOT NULL;


-- ═══════════════════════════════════════════════ 3. RAW PRICE OBSERVATIONS

-- Append-only. Every number that ever influenced a boundary stays here with
-- its provenance, which is what makes a published band auditable rather than
-- merely plausible.
CREATE TABLE book_prices (
  id            BIGSERIAL PRIMARY KEY,
  edition_id    BIGINT REFERENCES editions(id) ON DELETE CASCADE,
  isbn13        CHAR(13),

  format        book_format NOT NULL,
  kind          price_kind NOT NULL,
  condition     book_condition,          -- only meaningful for USED_RETAIL

  price         NUMERIC(10,2) NOT NULL CHECK (price > 0),
  currency      CHAR(3) NOT NULL DEFAULT 'INR',

  source        price_source_kind NOT NULL,
  source_url    TEXT,
  source_ref    TEXT,                    -- listing id, ONIX record id, admin note

  collected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_at   TIMESTAMPTZ,             -- when the price was true, if known

  -- Set by the ingest classifier. An observation is never deleted; it is
  -- excluded. `excluded_reason` is why, so a filter can be audited and
  -- reversed rather than silently eating data.
  excluded      BOOLEAN NOT NULL DEFAULT FALSE,
  excluded_reason TEXT,

  confidence    REAL NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),

  CONSTRAINT prices_inr_only CHECK (currency = 'INR'),
  -- An ebook price is not a print price. Enforced here so a careless join
  -- cannot put one into a print band.
  CONSTRAINT prices_ebook_has_no_format CHECK (kind <> 'EBOOK' OR format = 'UNKNOWN')
);

CREATE INDEX prices_edition_idx  ON book_prices (edition_id, format, kind)
  WHERE NOT excluded;
CREATE INDEX prices_isbn_idx     ON book_prices (isbn13, format)
  WHERE NOT excluded AND isbn13 IS NOT NULL;
CREATE INDEX prices_collected_idx ON book_prices (collected_at DESC);

-- One observation per source per edition per day. Re-running an ingest must
-- not manufacture a fake sample size — which is the single easiest way to
-- turn n=1 into a confident-looking n=30.
--
-- The day is a stored generated column rather than `(collected_at::date)`
-- in the index expression: casting timestamptz to date depends on the
-- session TimeZone, so it is STABLE rather than IMMUTABLE and Postgres
-- rejects it outright in an index. Pinning to UTC makes it immutable, and
-- makes the dedup window mean the same thing regardless of who runs the
-- ingest or from where.
ALTER TABLE book_prices
  ADD COLUMN collected_on DATE
  GENERATED ALWAYS AS (((collected_at AT TIME ZONE 'UTC'))::date) STORED;

CREATE UNIQUE INDEX prices_dedup_idx
  ON book_prices (edition_id, source, kind, format, collected_on)
  WHERE edition_id IS NOT NULL;


-- ═══════════════════════════════════════════════════ 4. COMPUTED BOUNDARIES

-- The table the app actually reads. One row per (edition, format, condition)
-- that a reader may list.
CREATE TABLE book_price_boundaries (
  id               BIGSERIAL PRIMARY KEY,
  edition_id       BIGINT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  isbn13           CHAR(13),
  format           book_format NOT NULL,
  edition_tier     book_edition_tier NOT NULL,
  condition        book_condition NOT NULL,
  category         TEXT,

  -- The band a reader may choose a SELL price within.
  lower_boundary   NUMERIC(10,2) CHECK (lower_boundary > 0),
  reference_price  NUMERIC(10,2) CHECK (reference_price > 0),
  upper_boundary   NUMERIC(10,2) CHECK (upper_boundary > 0),

  -- The deposit basis. Deliberately a SEPARATE column from reference_price
  -- and never the reader's chosen price: the deposit is paid by the OTHER
  -- reader, so an owner free to choose it has every incentive to pick the
  -- top of the band and no incentive not to. Pinning it to the reference
  -- removes the incentive rather than merely capping it.
  deposit_basis    NUMERIC(10,2) CHECK (deposit_basis > 0),

  methodology      boundary_method NOT NULL,
  confidence       REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  sample_size      INTEGER NOT NULL DEFAULT 0,
  shrinkage_weight REAL CHECK (shrinkage_weight BETWEEN 0 AND 1),

  mrp_inr          NUMERIC(10,2),
  discount_ratio   NUMERIC(6,4),          -- reference_price / mrp

  calculated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_review_date DATE NOT NULL,
  inputs_digest    TEXT,                  -- sha256 of the observation ids used

  CONSTRAINT boundaries_ordered CHECK (
    lower_boundary IS NULL
    OR (lower_boundary <= reference_price AND reference_price <= upper_boundary)
  ),
  -- INSUFFICIENT_DATA publishes no numbers at all rather than a guess
  -- dressed as a measurement.
  CONSTRAINT boundaries_insufficient_is_empty CHECK (
    methodology <> 'INSUFFICIENT_DATA'
    OR (lower_boundary IS NULL AND reference_price IS NULL AND upper_boundary IS NULL)
  ),
  -- Structural: an unauthorised copy never carries a price.
  CONSTRAINT boundaries_no_unofficial_pricing CHECK (
    edition_tier <> 'UNOFFICIAL'
    OR (lower_boundary IS NULL AND reference_price IS NULL
        AND upper_boundary IS NULL AND deposit_basis IS NULL)
  )
);

CREATE UNIQUE INDEX boundaries_key_idx
  ON book_price_boundaries (edition_id, format, edition_tier, condition);

-- The single hot lookup. Covering, so the read never touches the heap.
CREATE INDEX boundaries_lookup_idx
  ON book_price_boundaries (isbn13, format, edition_tier, condition)
  INCLUDE (lower_boundary, reference_price, upper_boundary, deposit_basis,
           confidence, methodology)
  WHERE isbn13 IS NOT NULL;

-- Drives the recomputation queue.
CREATE INDEX boundaries_review_idx ON book_price_boundaries (next_review_date)
  WHERE methodology <> 'INSUFFICIENT_DATA';


-- ═══════════════════════════════════════════════════════ 5. PRICE HISTORY

-- Append-only audit trail. Partitioned by month: this is the fastest-growing
-- table in the system and old partitions can be detached rather than deleted.
CREATE TABLE price_history (
  id                BIGSERIAL,
  edition_id        BIGINT NOT NULL,
  isbn13            CHAR(13),
  format            book_format NOT NULL,
  condition         book_condition NOT NULL,

  previous_lower    NUMERIC(10,2),
  previous_reference NUMERIC(10,2),
  previous_upper    NUMERIC(10,2),
  new_lower         NUMERIC(10,2),
  new_reference     NUMERIC(10,2),
  new_upper         NUMERIC(10,2),

  previous_method   boundary_method,
  new_method        boundary_method,
  previous_sample   INTEGER,
  new_sample        INTEGER,

  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason            TEXT NOT NULL,
  changed_by        TEXT NOT NULL DEFAULT 'pricing_engine',

  PRIMARY KEY (id, changed_at)
) PARTITION BY RANGE (changed_at);

CREATE INDEX price_history_edition_idx ON price_history (edition_id, changed_at DESC);

-- Bootstrap partitions. Create the next month's in a monthly cron; a missing
-- partition makes the INSERT fail, which fails the recompute, which is
-- exactly the loud failure you want rather than silent data loss.
CREATE TABLE price_history_2026_09 PARTITION OF price_history
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE price_history_2026_10 PARTITION OF price_history
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE price_history_2026_11 PARTITION OF price_history
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');


-- ═══════════════════════════════════════════ 6. PRIORS AND CONDITION LADDER

-- The group prior the estimator shrinks toward. Fitted from our own data,
-- re-fitted monthly. Modelled on ln(price / MRP) — the DISCOUNT RATIO — not
-- on absolute price, because ratios pool across price scales: a Rs.200 novel
-- and a Rs.2000 textbook can share a prior in ratio space and cannot in
-- rupee space.
CREATE TABLE price_priors (
  id             BIGSERIAL PRIMARY KEY,
  scope          TEXT NOT NULL,     -- 'category:Competitive Exams' | 'publisher:Arihant' | 'global'
  format         book_format,
  condition      book_condition,

  mu_log_ratio   DOUBLE PRECISION NOT NULL,  -- prior mean of ln(price/MRP)
  tau2           DOUBLE PRECISION NOT NULL CHECK (tau2 > 0),  -- between-book variance
  sigma2         DOUBLE PRECISION NOT NULL CHECK (sigma2 > 0),-- within-book variance
  n_observations INTEGER NOT NULL DEFAULT 0,

  fitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX price_priors_scope_idx
  ON price_priors (scope, format, condition) WHERE is_active;

-- The SELL ladder: what fraction of MRP a second-hand copy may be listed at.
-- Deterministic, auditable, and needs no market data — which is why SELL
-- pricing works from day one while the observation corpus is still empty.
CREATE TABLE condition_price_ladder (
  condition       book_condition PRIMARY KEY,
  sell_lower_pct  NUMERIC(5,4) NOT NULL CHECK (sell_lower_pct BETWEEN 0 AND 1),
  sell_ref_pct    NUMERIC(5,4) NOT NULL CHECK (sell_ref_pct   BETWEEN 0 AND 1),
  sell_upper_pct  NUMERIC(5,4) NOT NULL CHECK (sell_upper_pct BETWEEN 0 AND 1),
  note            TEXT,
  CONSTRAINT ladder_ordered CHECK (sell_lower_pct <= sell_ref_pct
                                   AND sell_ref_pct <= sell_upper_pct)
);

INSERT INTO condition_price_ladder VALUES
  ('AS_NEW',    0.7000, 0.7750, 0.8000, 'Indistinguishable from new. 75-80% of MRP.'),
  ('VERY_GOOD', 0.6000, 0.6750, 0.7500, 'Read once or twice, no marks.'),
  ('GOOD',      0.4500, 0.5250, 0.6000, 'Normal shelf wear, fully intact.'),
  ('FAIR',      0.3000, 0.3500, 0.4500, 'Heavy wear or highlighting; readable.'),
  ('POOR',      0.1500, 0.2000, 0.3000, 'Damaged. Usually give-away rather than sale.');


-- ═══════════════════════════════════════════════════ 7. THE LOOKUP FUNCTION

-- One call, one plan, no round trips. The app never assembles a price from
-- parts client-side, because a price assembled client-side is a price the
-- client can choose.
CREATE OR REPLACE FUNCTION lookup_price_band(
  p_isbn13     CHAR(13),
  p_format     book_format,
  p_tier       book_edition_tier,
  p_condition  book_condition
)
RETURNS TABLE (
  edition_id       BIGINT,
  title            TEXT,
  authors          TEXT[],
  publisher        TEXT,
  publication_year SMALLINT,
  category         TEXT,
  mrp_inr          NUMERIC,
  lower_boundary   NUMERIC,
  reference_price  NUMERIC,
  upper_boundary   NUMERIC,
  deposit_basis    NUMERIC,
  methodology      boundary_method,
  confidence       REAL,
  sample_size      INTEGER
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT e.id, e.title, e.authors, e.publisher, e.publication_year,
         w.category, e.mrp_inr,
         b.lower_boundary, b.reference_price, b.upper_boundary, b.deposit_basis,
         COALESCE(b.methodology, 'INSUFFICIENT_DATA'::boundary_method),
         COALESCE(b.confidence, 0.0::real),
         COALESCE(b.sample_size, 0)
  FROM editions e
  LEFT JOIN works w ON w.id = e.work_id
  LEFT JOIN book_price_boundaries b
         ON b.edition_id = e.id
        AND b.format = p_format
        AND b.edition_tier = p_tier
        AND b.condition = p_condition
  WHERE e.isbn13 = p_isbn13
    AND e.is_canonical
  LIMIT 1;
$$;

-- Server-side validation. The ONLY place a submitted price is judged.
-- Returns the verdict AND the band, so a rejection can explain itself
-- without the caller having to have been told the band beforehand.
CREATE OR REPLACE FUNCTION validate_listing_price(
  p_isbn13     CHAR(13),
  p_format     book_format,
  p_tier       book_edition_tier,
  p_condition  book_condition,
  p_price      NUMERIC
)
RETURNS TABLE (
  is_valid        BOOLEAN,
  reason          TEXT,
  lower_boundary  NUMERIC,
  reference_price NUMERIC,
  upper_boundary  NUMERIC,
  deposit_basis   NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  band RECORD;
BEGIN
  IF p_tier = 'UNOFFICIAL' THEN
    RETURN QUERY SELECT FALSE,
      'An unofficial copy cannot be given a price. It can still be swapped or lent.',
      NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  SELECT * INTO band
  FROM lookup_price_band(p_isbn13, p_format, p_tier, p_condition);

  IF band IS NULL OR band.reference_price IS NULL THEN
    RETURN QUERY SELECT FALSE,
      'We do not have enough price information for this edition yet.',
      NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF p_price < band.lower_boundary THEN
    RETURN QUERY SELECT FALSE,
      format('That is below the allowed range for a %s copy of this edition (Rs.%s to Rs.%s).',
             lower(replace(p_condition::text, '_', ' ')),
             band.lower_boundary, band.upper_boundary),
      band.lower_boundary, band.reference_price, band.upper_boundary, band.deposit_basis;
    RETURN;
  END IF;

  IF p_price > band.upper_boundary THEN
    RETURN QUERY SELECT FALSE,
      format('That is above the allowed range for a %s copy of this edition (Rs.%s to Rs.%s).',
             lower(replace(p_condition::text, '_', ' ')),
             band.lower_boundary, band.upper_boundary),
      band.lower_boundary, band.reference_price, band.upper_boundary, band.deposit_basis;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'ok'::TEXT,
    band.lower_boundary, band.reference_price, band.upper_boundary, band.deposit_basis;
END;
$$;


-- ═══════════════════════════════════════════════════════════════ 8. SECURITY

-- Supabase RLS. The client may READ bands and never write anything in this
-- schema. Everything that computes a price runs as the service role.
ALTER TABLE editions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE works                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_price_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_prices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_priors          ENABLE ROW LEVEL SECURITY;

-- `anon` and `authenticated` are created by Supabase. Creating them when
-- absent lets this same file run on a plain Postgres — which is what makes
-- the schema testable in CI instead of only ever being validated by
-- deploying it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE POLICY read_editions   ON editions              FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY read_works      ON works                 FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY read_boundaries ON book_price_boundaries FOR SELECT TO anon, authenticated USING (TRUE);

-- No policy on book_prices, price_history or price_priors: with RLS enabled
-- and no policy, those tables are invisible to anon and authenticated
-- entirely. Raw observations are the input to the number that decides how
-- much money changes hands, and there is no reason a client needs them.

COMMIT;
