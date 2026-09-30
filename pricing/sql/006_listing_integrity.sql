-- ════════════════════════════════════════════════════════════════════════
-- 006 — LISTING INTEGRITY
--
-- Four facts about a listing that were being kept only in the Google Sheet,
-- moved into the database that decides money — with constraints, so they
-- cannot be violated by anything, including by us.
--
--   authenticity_status   ORIGINAL / UNAUTHORISED / UNKNOWN
--   open_to_*             four independent transaction offers
--   the four media        four separate columns, all required to publish
--   monthly_rent          10% of the printed MRP, generated, not supplied
--
-- WHY THIS EXISTS AT ALL
--
-- Every one of these was already enforced in the application layer, and
-- that was already an improvement on where they started. But an
-- application rule is a rule that holds as long as every writer remembers
-- it. There are two writers today (the Apps Script backend and this
-- database) and the number only ever goes up. A CHECK constraint holds
-- against a writer that has not been written yet, against a migration run
-- at midnight, and against a well-meant manual UPDATE in a SQL console.
--
-- The specific thing being protected: an unauthorised copy must never
-- acquire a price, and a book nobody has photographed must never become
-- publishable. Both of those decide what one reader hands another.
--
--   psql -d <db> -f sql/006_listing_integrity.sql
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  CREATE TYPE book_authenticity AS ENUM ('ORIGINAL', 'UNAUTHORISED', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Authenticity ────────────────────────────────────────────────────────
-- UNKNOWN is the default, and it is the honest one: a row that arrives
-- without an answer has not been asked the question. Defaulting to
-- ORIGINAL would manufacture a claim about somebody's physical book.
ALTER TABLE listing_prices
  ADD COLUMN IF NOT EXISTS authenticity_status book_authenticity NOT NULL DEFAULT 'UNKNOWN';

COMMENT ON COLUMN listing_prices.authenticity_status IS
  'The owner''s declaration about the copy. UNKNOWN means undeclared, and '
  'is never to be rendered as ORIGINAL. An UNAUTHORISED copy carries no '
  'price and no transaction eligibility.';

-- ── The four offers, four columns ───────────────────────────────────────
-- Not one enum, not a bitmask, not a "mode" string. Rent and Lend were
-- conflated once already — a LEND request was authorised by the temporary
-- swap flag — and a single column is how that happens: two facts sharing
-- one storage location eventually share one value.
ALTER TABLE listing_prices
  ADD COLUMN IF NOT EXISTS open_to_sell BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS open_to_swap BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS open_to_rent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS open_to_lend BOOLEAN NOT NULL DEFAULT FALSE;

-- ── The four required media ─────────────────────────────────────────────
-- Four columns rather than one array. An array can hold four items and
-- still not answer "is there a back cover", which is the only question
-- that matters when deciding whether a listing may be published.
ALTER TABLE listing_prices
  ADD COLUMN IF NOT EXISTS front_cover_image   TEXT,
  ADD COLUMN IF NOT EXISTS internal_book_image TEXT,
  ADD COLUMN IF NOT EXISTS internal_book_video TEXT,
  ADD COLUMN IF NOT EXISTS back_cover_image    TEXT;

COMMENT ON COLUMN listing_prices.internal_book_video IS
  'The owner''s own video of the inside of this copy. Separate from the '
  'images because no count of files can require that one of them moves.';

-- Published means all four. The flag is derived, so it cannot drift out of
-- step with the columns it describes: nothing can set "published" while a
-- medium is missing, because nothing sets it at all.
ALTER TABLE listing_prices
  ADD COLUMN IF NOT EXISTS media_complete BOOLEAN
  GENERATED ALWAYS AS (
    front_cover_image   IS NOT NULL AND front_cover_image   <> ''
    AND internal_book_image IS NOT NULL AND internal_book_image <> ''
    AND internal_book_video IS NOT NULL AND internal_book_video <> ''
    AND back_cover_image    IS NOT NULL AND back_cover_image    <> ''
  ) STORED;

-- ── The printed MRP, and the rent that follows from it ──────────────────
-- Separate from mrp_inr above, which this schema already uses for the
-- edition's resolved MRP. This one is the number on THIS copy's cover.
ALTER TABLE listing_prices
  ADD COLUMN IF NOT EXISTS printed_mrp NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS printed_mrp_evidence_tier mrp_evidence_tier,
  ADD COLUMN IF NOT EXISTS printed_mrp_verification_status TEXT;

-- Zero is not a price. A book we could not price is unpriced, and the
-- column says so with NULL.
ALTER TABLE listing_prices DROP CONSTRAINT IF EXISTS listing_printed_mrp_positive;
ALTER TABLE listing_prices ADD CONSTRAINT listing_printed_mrp_positive CHECK (
  printed_mrp IS NULL OR printed_mrp > 0
);

-- Monthly rent is GENERATED. It is not a column anybody writes, which is
-- the point: a stored rent is a rent somebody can set, and the whole rule
-- is that the person setting the price does not set the rent. Ten percent
-- of the printed MRP, or nothing at all when there is no MRP.
ALTER TABLE listing_prices
  ADD COLUMN IF NOT EXISTS monthly_rent NUMERIC(10,2)
  GENERATED ALWAYS AS (
    CASE WHEN printed_mrp IS NULL OR printed_mrp <= 0
         THEN NULL
         ELSE round(printed_mrp * 0.10, 2) END
  ) STORED;

COMMENT ON COLUMN listing_prices.monthly_rent IS
  'Exactly 10%% of printed_mrp, per month. Generated so that no writer can '
  'supply it: not the seller, not the client, not a future migration. NULL '
  'when there is no printed MRP, and rent is then unavailable — never free.';

-- ── An unauthorised copy carries no price ───────────────────────────────
-- The rule that matters most, and the one that most deserves to be a
-- constraint rather than an if-statement: if the copy is declared
-- unauthorised, it has no valuation of any kind attached to it. Nothing to
-- deposit against, nothing to rent from, nothing to sell at.
ALTER TABLE listing_prices DROP CONSTRAINT IF EXISTS listing_unauthorised_has_no_price;
ALTER TABLE listing_prices ADD CONSTRAINT listing_unauthorised_has_no_price CHECK (
  authenticity_status <> 'UNAUTHORISED'
  OR (sell_price IS NULL AND reference_price IS NULL
      AND deposit_amount IS NULL AND printed_mrp IS NULL)
);

-- ...and no transaction eligibility either.
ALTER TABLE listing_prices DROP CONSTRAINT IF EXISTS listing_unauthorised_not_transactable;
ALTER TABLE listing_prices ADD CONSTRAINT listing_unauthorised_not_transactable CHECK (
  authenticity_status <> 'UNAUTHORISED'
  OR (open_to_sell = FALSE AND open_to_swap = FALSE
      AND open_to_rent = FALSE AND open_to_lend = FALSE)
);

-- Renting needs a printed MRP, because the charge is a fraction of it.
-- Offering rent without one would put a listing in front of a reader that
-- the server must then refuse — better to make that state unreachable.
ALTER TABLE listing_prices DROP CONSTRAINT IF EXISTS listing_rent_needs_mrp;
ALTER TABLE listing_prices ADD CONSTRAINT listing_rent_needs_mrp CHECK (
  open_to_rent = FALSE OR printed_mrp IS NOT NULL
);


/**
 * Transaction eligibility, answered by the database.
 *
 * Four separate answers. A caller asking "can this be rented" gets a
 * reason when the answer is no, because "no" without a reason is what
 * makes a support conversation take four messages instead of one.
 */
CREATE OR REPLACE FUNCTION listing_eligibility(p_listing_id TEXT)
RETURNS TABLE (
  can_sell BOOLEAN, can_swap BOOLEAN, can_rent BOOLEAN, can_lend BOOLEAN,
  monthly_rent NUMERIC, authenticity book_authenticity, reason TEXT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r listing_prices%ROWTYPE;
BEGIN
  SELECT * INTO r FROM listing_prices
   WHERE listing_id = p_listing_id
   ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, FALSE, NULL::NUMERIC,
                        'UNKNOWN'::book_authenticity,
                        'No listing found with that id.'::TEXT;
    RETURN;
  END IF;

  IF r.authenticity_status = 'UNAUTHORISED' THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, FALSE, NULL::NUMERIC, r.authenticity_status,
      'A copy declared unauthorised cannot be sold, swapped, rented or lent.'::TEXT;
    RETURN;
  END IF;

  IF NOT r.media_complete THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, FALSE, r.monthly_rent, r.authenticity_status,
      'This listing is missing one or more of its required photos.'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    r.open_to_sell,
    r.open_to_swap,
    -- Rent additionally needs an MRP. The constraint above already makes
    -- the contradictory state unreachable; this repeats the condition so
    -- the function stays correct on its own terms rather than by relying
    -- on a constraint remaining in place.
    r.open_to_rent AND r.printed_mrp IS NOT NULL,
    r.open_to_lend,
    r.monthly_rent,
    r.authenticity_status,
    ''::TEXT;
END $$;

COMMIT;
