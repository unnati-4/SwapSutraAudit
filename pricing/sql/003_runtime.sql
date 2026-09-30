-- ══════════════════════════════════════════════════════════════════════════
-- 003 — the RUNTIME pricing engine, and the listing side of the catalogue.
--
-- WHY THIS EXISTS
-- 001 and 002 give the catalogue and the storage for bands. `boundaries.py`
-- gives the estimator — but it runs offline, so it cannot price an ISBN at
-- the moment a reader scans one. Shipping it as-is would mean a reader
-- scanning a new book waits for a batch job that runs tomorrow.
--
-- Rather than run a Python service beside the database, the estimator is
-- ported here, in plpgsql, so there is exactly ONE implementation on the
-- runtime path. `boundaries.py` stays as the readable reference and its 41
-- tests become a CONFORMANCE SUITE: tests/test_conformance.py runs the same
-- vectors through both and fails if they disagree by a rupee.
--
-- Everything below is deterministic. The same observations produce the same
-- band, every time, and `inputs_digest` records which observations those
-- were.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════ 1. CONFIGURATION, IN ONE PLACE

-- The spec is explicit that condition multipliers must not be scattered
-- through the app. They live in condition_price_ladder (001). Everything
-- else tunable lives here, as rows rather than constants, so changing a
-- policy is an UPDATE with an audit trail and not a redeploy.
CREATE TABLE IF NOT EXISTS pricing_config (
  key         TEXT PRIMARY KEY,
  value       NUMERIC NOT NULL,
  description TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO pricing_config (key, value, description) VALUES
  ('DEPOSIT_RATE',            0.60,  'Security deposit as a fraction of the REFERENCE price. Never of the seller''s chosen price.'),
  ('PRICE_VALIDITY_DAYS',     90,    'How long a computed band stays fresh before it is recomputed.'),
  ('HAMPEL_K',                3.0,   'Outlier threshold in MADs. NISTIR 8526 screens at 3, not Tukey''s 1.5.'),
  ('MAD_SCALE',               1.4826,'Makes MAD consistent with sigma under normality.'),
  ('MIN_LOG_SCALE',           0.10,  'Floor on the scale estimate. Guards MAD == 0, which is the MAJORITY case for MRP observations.'),
  ('MIN_N_FOR_OUTLIER_FILTER',5,     'Below this an outlier cannot be told apart from a small sample.'),
  ('ROUND_TO',                5,     'Rupee rounding for published figures.'),
  ('MRP_ANCHOR_WEIGHT',       0.50,  'Weight of printed MRP against market observations when both exist.'),
  ('UNOFFICIAL_FLAT_DEPOSIT', 100,   'Flat nominal deposit for an unauthorised copy in a swap or lend. NOT a valuation.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION cfg(p_key TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT value FROM pricing_config WHERE key = p_key;
$$;

-- The security deposit was a flat DEPOSIT_RATE (60%) of the reference price
-- regardless of the book's condition. It is now tiered by condition instead,
-- applied uniformly across SWAP/RENT/LEND/SELL wherever a deposit is a
-- percentage of a reference price (price_quote, validate_and_record_listing,
-- swap_deposits — every one of them takes p_condition/reads listing_prices.
-- condition already, so no new parameter is needed anywhere this is called).
--
-- Bucket mapping (against this schema's own book_condition ladder):
--   AS_NEW                    -> 60%  (New / Like New)
--   VERY_GOOD, GOOD, FAIR     -> 55%  (Mid)
--   POOR                      -> 50%  (Poor / Damaged)
-- DEPOSIT_RATE above is kept as the historical/default rate (and as
-- documentation of where 60% came from); this function is what every
-- deposit computation should call from here on.
CREATE OR REPLACE FUNCTION deposit_rate_for_condition(p_condition book_condition)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_condition
    WHEN 'AS_NEW' THEN 0.60
    WHEN 'VERY_GOOD' THEN 0.55
    WHEN 'GOOD' THEN 0.55
    WHEN 'FAIR' THEN 0.55
    WHEN 'POOR' THEN 0.50
    ELSE 0.55  -- unrecognised/NULL condition fails toward the middle rung,
               -- same "smallest error available" rule appsscript.js's
               -- normalizeConditionGrade already documents for GOOD.
  END;
$$;


-- ═══════════════════════════════════════════ 2. THE SELLER'S PRICE, SEPARATELY

-- The spec is emphatic that the seller's SELL price and the system's
-- REFERENCE price are different concepts and must not be mixed. They are
-- therefore in different tables: the reference lives in
-- book_price_boundaries (system-owned, client-unwritable), and what a
-- particular reader chose for a particular listing lives here.
--
-- This is also the table that turns SwapSutra's own trading into pricing
-- evidence. A validated listing price is an observation about the Indian
-- second-hand market that nobody else has.
CREATE TABLE IF NOT EXISTS listing_prices (
  id                BIGSERIAL PRIMARY KEY,
  listing_id        TEXT NOT NULL,          -- the Books sheet row id
  edition_id        BIGINT REFERENCES editions(id) ON DELETE SET NULL,
  isbn13            CHAR(13),
  owner_email       TEXT NOT NULL,

  format            book_format NOT NULL,
  edition_tier      book_edition_tier NOT NULL,
  condition         book_condition NOT NULL,

  mrp_inr           NUMERIC(10,2),
  mrp_source        price_source_kind,
  mrp_proof_url     TEXT,                   -- the reader's own photo of the cover

  -- What the reader chose, and the band they were held to when they chose
  -- it. Storing the band alongside the choice is what makes a later dispute
  -- answerable: "this was the allowed range on the day you listed it."
  sell_price        NUMERIC(10,2) CHECK (sell_price IS NULL OR sell_price > 0),
  allowed_min       NUMERIC(10,2),
  allowed_max       NUMERIC(10,2),
  suggested_price   NUMERIC(10,2),

  -- Copied from the boundary at listing time. The deposit any counterparty
  -- owes is computed from THIS, never from sell_price.
  reference_price   NUMERIC(10,2),
  deposit_amount    NUMERIC(10,2),

  methodology       boundary_method,
  confidence        REAL,

  outcome           TEXT,                   -- SOLD / SWAPPED / RENTED / LENT / WITHDRAWN
  outcome_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT listing_price_within_band CHECK (
    sell_price IS NULL OR allowed_min IS NULL
    OR (sell_price >= allowed_min AND sell_price <= allowed_max)
  ),
  -- An unauthorised copy carries no price and no deposit. Enforced here as
  -- well as on the boundary, because this is the table a listing writes to.
  CONSTRAINT listing_unofficial_has_no_price CHECK (
    edition_tier <> 'UNOFFICIAL'
    OR (sell_price IS NULL AND reference_price IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS listing_prices_listing_idx ON listing_prices (listing_id);
CREATE INDEX IF NOT EXISTS listing_prices_isbn_idx ON listing_prices (isbn13) WHERE isbn13 IS NOT NULL;
CREATE INDEX IF NOT EXISTS listing_prices_outcome_idx ON listing_prices (outcome, outcome_at DESC)
  WHERE outcome IS NOT NULL;


-- ═════════════════════════════════════════════ 3. ADMIN OVERRIDES, AUDITED

-- "Admin overrides must be auditable. Do not silently overwrite automated
-- values." So an override is a ROW, not an UPDATE to the computed band. The
-- band keeps its computed numbers; the override sits beside it and wins at
-- read time, and both are visible.
CREATE TABLE IF NOT EXISTS price_overrides (
  id               BIGSERIAL PRIMARY KEY,
  edition_id       BIGINT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  format           book_format NOT NULL,
  edition_tier     book_edition_tier NOT NULL,
  condition        book_condition,          -- NULL = applies to every grade

  override_mrp     NUMERIC(10,2) CHECK (override_mrp IS NULL OR override_mrp > 0),
  override_lower   NUMERIC(10,2),
  override_ref     NUMERIC(10,2),
  override_upper   NUMERIC(10,2),

  reason           TEXT NOT NULL,
  admin_email      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT,

  CONSTRAINT override_ordered CHECK (
    override_lower IS NULL
    OR (override_lower <= override_ref AND override_ref <= override_upper)
  ),
  CONSTRAINT override_says_something CHECK (
    override_mrp IS NOT NULL OR override_ref IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS price_overrides_active_idx
  ON price_overrides (edition_id, format, edition_tier, condition)
  WHERE revoked_at IS NULL;


-- ══════════════════════════════════════════ 4. ROBUST STATISTICS, IN PLPGSQL

CREATE OR REPLACE FUNCTION px_median(xs DOUBLE PRECISION[])
RETURNS DOUBLE PRECISION LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) FROM unnest(xs) AS v;
$$;

-- The MAD == 0 guard, which is the single most important line in this file.
--
-- Three sources all reporting Rs.399 is not an edge case — it is what MRP
-- observations are SUPPOSED to look like, because they are all reading the
-- same printed number. With MAD == 0 an unguarded Hampel filter gives every
-- non-identical point an infinite score and deletes every genuine
-- observation that differs at all. The floor is in log space, so it is a
-- fixed PERCENTAGE in rupees and means the same thing for a Rs.150 novel
-- and a Rs.4000 textbook.
CREATE OR REPLACE FUNCTION px_robust_scale(xs DOUBLE PRECISION[])
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE med DOUBLE PRECISION; mad DOUBLE PRECISION;
BEGIN
  IF array_length(xs, 1) IS NULL OR array_length(xs, 1) < 2 THEN
    RETURN cfg('MIN_LOG_SCALE');
  END IF;
  med := px_median(xs);
  SELECT px_median(array_agg(abs(v - med))) INTO mad FROM unnest(xs) AS v;
  RETURN greatest(cfg('MAD_SCALE') * mad, cfg('MIN_LOG_SCALE'));
END $$;

-- 20% trimmed mean: efficient under mild contamination, 20% breakdown point.
CREATE OR REPLACE FUNCTION px_trimmed_mean(xs DOUBLE PRECISION[])
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE n INT; k INT; result DOUBLE PRECISION;
BEGIN
  n := array_length(xs, 1);
  k := floor(n * 0.2)::INT;
  -- Trimming that would empty the sample trims nothing instead.
  IF n - 2 * k < 1 THEN
    SELECT avg(v) INTO result FROM unnest(xs) AS v;
    RETURN result;
  END IF;
  SELECT avg(v) INTO result FROM (
    SELECT v FROM unnest(xs) AS v ORDER BY v OFFSET k LIMIT n - 2 * k
  ) s;
  RETURN result;
END $$;

-- The centre estimator changes with n, because the right one does.
-- At n=2 the median IS the mean, so there is no robustness to buy; a 20%
-- trimmed mean at n=3 either trims nothing or degenerates to the median.
CREATE OR REPLACE FUNCTION px_robust_centre(xs DOUBLE PRECISION[], OUT centre DOUBLE PRECISION, OUT rule TEXT)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE n INT;
BEGIN
  n := coalesce(array_length(xs, 1), 0);
  IF n = 0 THEN centre := NULL; rule := 'no observations'; RETURN; END IF;
  IF n = 1 THEN centre := xs[1]; rule := 'single observation'; RETURN; END IF;
  IF n <= 4 THEN centre := px_median(xs); rule := 'median (n<=4: no robustness available)'; RETURN; END IF;
  IF n <= 7 THEN centre := px_median(xs); rule := 'median'; RETURN; END IF;
  centre := px_trimmed_mean(xs); rule := '20% trimmed mean';
END $$;

-- Returns the values that SURVIVE the filter. Only applied at n >= 5:
-- below that, discarding one of four genuine observations costs far more
-- than keeping one bad one, and shrinkage is what protects the estimate.
CREATE OR REPLACE FUNCTION px_hampel_keep(xs DOUBLE PRECISION[])
RETURNS DOUBLE PRECISION[] LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE n INT; med DOUBLE PRECISION; scale DOUBLE PRECISION; kept DOUBLE PRECISION[];
BEGIN
  n := coalesce(array_length(xs, 1), 0);
  IF n < cfg('MIN_N_FOR_OUTLIER_FILTER')::INT THEN RETURN xs; END IF;
  med := px_median(xs);
  scale := px_robust_scale(xs);
  SELECT array_agg(v) INTO kept FROM unnest(xs) AS v
   WHERE abs(v - med) <= cfg('HAMPEL_K') * scale;
  -- The filter never empties the sample.
  IF kept IS NULL OR array_length(kept, 1) = 0 THEN RETURN xs; END IF;
  RETURN kept;
END $$;

CREATE OR REPLACE FUNCTION px_round_inr(x DOUBLE PRECISION)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT greatest(cfg('ROUND_TO'), round((x / cfg('ROUND_TO'))::NUMERIC, 0) * cfg('ROUND_TO'));
$$;


-- ══════════════════════════════════════════════════ 5. THE BOUNDARY ENGINE

/*
  compute_price_band — the one place a band is decided at runtime.

  Structure, and the reason for it: an earlier version derived the band
  directly from the observation spread and produced an IDENTICAL band for
  an as-new copy and a fair one. Condition is the largest single driver of
  second-hand price, so the two questions are kept apart:

    1. What is this edition's NEW price?  (the anchor)
       MRP answers it; new-retail observations refine it.
    2. What is a copy in THIS condition worth?  (the band)
       The published condition ladder, applied to the anchor.

  Direct evidence about used copies at the matching grade is better than
  either, so where it exists it pulls the reference toward itself — but the
  ladder still bounds it, so a handful of unusually cheap listings move the
  point inside the band and never the band itself.
*/
CREATE OR REPLACE FUNCTION compute_price_band(
  p_edition_id BIGINT,
  p_format     book_format,
  p_tier       book_edition_tier,
  p_condition  book_condition
)
RETURNS TABLE (
  lower_boundary   NUMERIC,
  reference_price  NUMERIC,
  upper_boundary   NUMERIC,
  deposit_basis    NUMERIC,
  methodology      boundary_method,
  confidence       REAL,
  sample_size      INTEGER,
  shrinkage_weight REAL,
  mrp_inr          NUMERIC,
  discount_ratio   NUMERIC,
  notes            TEXT[],
  inputs_digest    TEXT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_mrp          NUMERIC;
  v_anchor       DOUBLE PRECISION;
  v_market       DOUBLE PRECISION;
  anchor_logs    DOUBLE PRECISION[];
  anchor_kept    DOUBLE PRECISION[];
  direct_logs    DOUBLE PRECISION[];
  direct_kept    DOUBLE PRECISION[];
  v_centre       DOUBLE PRECISION;
  v_rule         TEXT;
  v_lo_pct       NUMERIC; v_ref_pct NUMERIC; v_up_pct NUMERIC;
  v_lower        DOUBLE PRECISION;
  v_ref          DOUBLE PRECISION;
  v_upper        DOUBLE PRECISION;
  v_w            DOUBLE PRECISION;
  v_prior        RECORD;
  v_notes        TEXT[] := '{}';
  v_n_anchor     INT := 0;
  v_n_direct     INT := 0;
  v_n_rejected   INT := 0;
  v_conf         REAL;
  v_digest       TEXT;
  v_category     TEXT;
  v_override     RECORD;
BEGIN
  -- An unauthorised copy is refused before anything is computed. No path
  -- below can produce a number for one.
  IF p_tier = 'UNOFFICIAL' THEN
    RETURN QUERY SELECT NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
      'INSUFFICIENT_DATA'::boundary_method, 0.0::real, 0, NULL::real, NULL::NUMERIC, NULL::NUMERIC,
      ARRAY['Unofficial copies are not priced. They may still be swapped or lent.']::TEXT[], NULL::TEXT;
    RETURN;
  END IF;

  SELECT e.mrp_inr, w.category INTO v_mrp, v_category
  FROM editions e LEFT JOIN works w ON w.id = e.work_id
  WHERE e.id = p_edition_id;

  -- An active admin override on MRP replaces the stored one before anything
  -- is derived from it.
  SELECT * INTO v_override FROM price_overrides o
   WHERE o.edition_id = p_edition_id AND o.format = p_format
     AND o.edition_tier = p_tier
     AND (o.condition IS NULL OR o.condition = p_condition)
     AND o.revoked_at IS NULL
   ORDER BY o.created_at DESC LIMIT 1;

  IF FOUND AND v_override.override_mrp IS NOT NULL THEN
    v_mrp := v_override.override_mrp;
    v_notes := v_notes || format('MRP overridden to Rs.%s by %s: %s',
                                 v_mrp, v_override.admin_email, v_override.reason);
  END IF;

  -- ── The anchor: this edition's new-copy price level ──────────────────
  -- EBOOK is excluded structurally by the schema (it cannot carry a print
  -- format) and again here, because an ebook price is not evidence about a
  -- physical paperback.
  SELECT array_agg(ln(bp.price::DOUBLE PRECISION)) INTO anchor_logs
  FROM book_prices bp
  WHERE bp.edition_id = p_edition_id AND bp.format = p_format
    AND bp.kind IN ('MRP', 'NEW_RETAIL') AND NOT bp.excluded;

  IF anchor_logs IS NOT NULL THEN
    v_n_anchor := array_length(anchor_logs, 1);
    anchor_kept := px_hampel_keep(anchor_logs);
    v_n_rejected := v_n_anchor - array_length(anchor_kept, 1);
    SELECT centre, rule INTO v_centre, v_rule FROM px_robust_centre(anchor_kept);
    v_market := exp(v_centre);
    v_notes := v_notes || format('New-price anchor: %s of %s observation(s) = Rs.%s.',
                                 v_rule, array_length(anchor_kept, 1), round(v_market::NUMERIC));
    IF v_n_rejected > 0 THEN
      v_notes := v_notes || format('%s observation(s) rejected by the Hampel filter at %sx MAD.',
                                   v_n_rejected, cfg('HAMPEL_K'));
    ELSIF v_n_anchor < cfg('MIN_N_FOR_OUTLIER_FILTER')::INT THEN
      v_notes := v_notes || format('No outlier filtering at n=%s: below n=%s an outlier cannot be told apart from a small sample.',
                                   v_n_anchor, cfg('MIN_N_FOR_OUTLIER_FILTER')::INT);
    END IF;
  END IF;

  -- Printed MRP is a publisher-set number printed on the copy itself, which
  -- makes it more stable and more checkable than a scraped market figure. So
  -- where both exist the MRP anchors and the observations adjust it, rather
  -- than the other way round.
  IF v_mrp IS NOT NULL AND v_market IS NOT NULL THEN
    v_anchor := cfg('MRP_ANCHOR_WEIGHT') * v_market + (1 - cfg('MRP_ANCHOR_WEIGHT')) * v_mrp;
  ELSIF v_mrp IS NOT NULL THEN
    v_anchor := v_mrp;
    v_notes := v_notes || format('Anchored on the printed MRP of Rs.%s. No market observations yet.', v_mrp);
  ELSE
    v_anchor := v_market;
  END IF;

  IF v_anchor IS NULL THEN
    RETURN QUERY SELECT NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
      'INSUFFICIENT_DATA'::boundary_method, 0.0::real, 0, NULL::real, NULL::NUMERIC, NULL::NUMERIC,
      ARRAY['No printed MRP and no usable price observations for this edition.']::TEXT[], NULL::TEXT;
    RETURN;
  END IF;

  -- ── The band: the published condition ladder ─────────────────────────
  SELECT sell_lower_pct, sell_ref_pct, sell_upper_pct
    INTO v_lo_pct, v_ref_pct, v_up_pct
  FROM condition_price_ladder WHERE condition = p_condition;

  v_lower := v_anchor * v_lo_pct;
  v_ref   := v_anchor * v_ref_pct;
  v_upper := v_anchor * v_up_pct;
  v_notes := v_notes || format('Band from the published %s ladder (%s%%-%s%% of Rs.%s).',
                               p_condition, round(v_lo_pct * 100), round(v_up_pct * 100),
                               round(v_anchor::NUMERIC));

  -- ── Direct used-copy evidence pulls the reference ────────────────────
  SELECT array_agg(ln(bp.price::DOUBLE PRECISION)) INTO direct_logs
  FROM book_prices bp
  WHERE bp.edition_id = p_edition_id AND bp.format = p_format
    AND bp.kind IN ('USED_RETAIL', 'SWAPSUTRA_TXN')
    AND bp.condition = p_condition AND NOT bp.excluded;

  IF direct_logs IS NOT NULL THEN
    v_n_direct := array_length(direct_logs, 1);
    direct_kept := px_hampel_keep(direct_logs);
    SELECT centre, rule INTO v_centre, v_rule FROM px_robust_centre(direct_kept);

    SELECT * INTO v_prior FROM price_priors
     WHERE scope = 'category:' || coalesce(v_category, '')
       AND is_active AND (format IS NULL OR format = p_format)
     LIMIT 1;

    IF FOUND THEN
      v_w := v_prior.tau2 / (v_prior.tau2 + v_prior.sigma2 / array_length(direct_kept, 1));
    ELSE
      -- Without a fitted prior, the data earns weight by count alone.
      v_w := array_length(direct_kept, 1)::DOUBLE PRECISION
             / (array_length(direct_kept, 1) + 4.0);
    END IF;

    v_ref := exp(v_w * v_centre + (1 - v_w) * ln(v_ref));
    v_notes := v_notes || format('Reference pulled toward %s direct used-copy observation(s) (%s) with weight %s.',
                                 array_length(direct_kept, 1), v_rule, round(v_w::NUMERIC, 2));
    -- The ladder still bounds it.
    v_ref := least(greatest(v_ref, v_lower), v_upper);
  END IF;

  -- ── The MRP cap: a SwapSutra platform policy ─────────────────────────
  -- SwapSutra caps used-book pricing at the printed MRP. This is a platform
  -- policy decision, not a statement of law: a second-hand copy listed above
  -- the price of a new one is a bad outcome for the reader on the other side
  -- of the trade, so the platform does not allow it. The clamp holds
  -- whatever the statistics produced.
  IF v_mrp IS NOT NULL THEN
    v_upper := least(v_upper, v_mrp::DOUBLE PRECISION);
    v_ref   := least(v_ref, v_upper);
    v_lower := least(v_lower, v_ref);
  END IF;

  -- ── An active admin band override wins, and says so ──────────────────
  IF v_override.override_ref IS NOT NULL THEN
    v_lower := v_override.override_lower;
    v_ref   := v_override.override_ref;
    v_upper := v_override.override_upper;
    v_notes := v_notes || format('Band overridden by %s: %s',
                                 v_override.admin_email, v_override.reason);
  END IF;

  SELECT encode(digest(coalesce(string_agg(bp.id::TEXT, ',' ORDER BY bp.id), ''), 'sha256'), 'hex')
    INTO v_digest
  FROM book_prices bp
  WHERE bp.edition_id = p_edition_id AND bp.format = p_format AND NOT bp.excluded;

  -- Confidence: a number a person can act on, not a probability. Capped
  -- below 1.0 because a second-hand book price in India is never certain.
  v_conf := 0.35
          + least(v_n_anchor + v_n_direct, 12) * 0.035
          + CASE WHEN v_mrp IS NOT NULL THEN 0.12 ELSE 0 END
          + coalesce(v_w, 0) * 0.10
          - CASE WHEN v_n_rejected > 0 THEN 0.05 ELSE 0 END
          - CASE WHEN (v_n_anchor + v_n_direct) < 10 THEN 0.05 ELSE 0 END;
  v_conf := least(greatest(v_conf, 0.0), 0.95);

  RETURN QUERY SELECT
    px_round_inr(v_lower),
    px_round_inr(v_ref),
    px_round_inr(v_upper),
    px_round_inr(v_ref),                    -- deposit basis IS the reference
    CASE WHEN (v_n_anchor + v_n_direct) >= 3 THEN 'EDITION_OBSERVATIONS'::boundary_method
         WHEN v_mrp IS NOT NULL             THEN 'MRP_DERIVED'::boundary_method
         ELSE 'CATEGORY_PRIOR'::boundary_method END,
    round(v_conf::NUMERIC, 3)::real,
    v_n_anchor + v_n_direct,
    v_w::real,
    v_mrp,
    CASE WHEN v_mrp > 0 THEN round((v_ref / v_mrp)::NUMERIC, 4) END,
    v_notes,
    v_digest;
END $$;


-- ═══════════════════════════════════════ 6. CACHE-AWARE READ, AND HISTORY

/*
  get_or_compute_band — what the API actually calls.

  Reads the stored band if it is fresh; recomputes and stores it otherwise.
  Recomputation writes a price_history row whenever a number moved, so every
  change to a figure that decides money is on the record with a reason.
*/
CREATE OR REPLACE FUNCTION get_or_compute_band(
  p_edition_id BIGINT,
  p_format     book_format,
  p_tier       book_edition_tier,
  p_condition  book_condition,
  p_force      BOOLEAN DEFAULT FALSE,
  p_reason     TEXT DEFAULT 'scheduled recompute'
)
RETURNS book_price_boundaries
LANGUAGE plpgsql AS $$
DECLARE
  existing book_price_boundaries;
  fresh    book_price_boundaries;
  b        RECORD;
  v_isbn   CHAR(13);
BEGIN
  SELECT * INTO existing FROM book_price_boundaries
   WHERE edition_id = p_edition_id AND format = p_format
     AND edition_tier = p_tier AND condition = p_condition;

  IF FOUND AND NOT p_force AND existing.next_review_date > CURRENT_DATE THEN
    RETURN existing;   -- cached, still fresh
  END IF;

  SELECT * INTO b FROM compute_price_band(p_edition_id, p_format, p_tier, p_condition);
  SELECT isbn13 INTO v_isbn FROM editions WHERE id = p_edition_id;

  INSERT INTO book_price_boundaries (
    edition_id, isbn13, format, edition_tier, condition,
    lower_boundary, reference_price, upper_boundary, deposit_basis,
    methodology, confidence, sample_size, shrinkage_weight,
    mrp_inr, discount_ratio, calculated_at, next_review_date, inputs_digest
  ) VALUES (
    p_edition_id, v_isbn, p_format, p_tier, p_condition,
    b.lower_boundary, b.reference_price, b.upper_boundary, b.deposit_basis,
    b.methodology, b.confidence, b.sample_size, b.shrinkage_weight,
    b.mrp_inr, b.discount_ratio, now(),
    (CURRENT_DATE + (cfg('PRICE_VALIDITY_DAYS')::INT || ' days')::INTERVAL)::DATE,
    b.inputs_digest
  )
  ON CONFLICT (edition_id, format, edition_tier, condition) DO UPDATE SET
    lower_boundary = EXCLUDED.lower_boundary,
    reference_price = EXCLUDED.reference_price,
    upper_boundary = EXCLUDED.upper_boundary,
    deposit_basis = EXCLUDED.deposit_basis,
    methodology = EXCLUDED.methodology,
    confidence = EXCLUDED.confidence,
    sample_size = EXCLUDED.sample_size,
    shrinkage_weight = EXCLUDED.shrinkage_weight,
    mrp_inr = EXCLUDED.mrp_inr,
    discount_ratio = EXCLUDED.discount_ratio,
    calculated_at = EXCLUDED.calculated_at,
    next_review_date = EXCLUDED.next_review_date,
    inputs_digest = EXCLUDED.inputs_digest
  RETURNING * INTO fresh;

  -- History only when a figure actually moved. A recompute that changes
  -- nothing should not fill the audit trail with noise.
  IF existing.id IS NOT NULL AND (
       existing.lower_boundary IS DISTINCT FROM fresh.lower_boundary OR
       existing.reference_price IS DISTINCT FROM fresh.reference_price OR
       existing.upper_boundary IS DISTINCT FROM fresh.upper_boundary)
  THEN
    INSERT INTO price_history (
      edition_id, isbn13, format, condition,
      previous_lower, previous_reference, previous_upper,
      new_lower, new_reference, new_upper,
      previous_method, new_method, previous_sample, new_sample, reason)
    VALUES (
      p_edition_id, v_isbn, p_format, p_condition,
      existing.lower_boundary, existing.reference_price, existing.upper_boundary,
      fresh.lower_boundary, fresh.reference_price, fresh.upper_boundary,
      existing.methodology, fresh.methodology, existing.sample_size, fresh.sample_size,
      p_reason);
  END IF;

  RETURN fresh;
END $$;


-- ══════════════════════════════════════ 7. THE ONE CALL THE LISTING FORM MAKES

/*
  price_quote — everything the listing screen needs, in one round trip.

  Returns the SELL band (what the reader may charge), the REFERENCE price
  (the system's valuation), and the DEPOSIT (60% of the reference). The
  three are returned together and separately, because conflating them is
  precisely the failure this system exists to prevent.
*/
CREATE OR REPLACE FUNCTION price_quote(
  p_isbn13    CHAR(13),
  p_format    book_format,
  p_tier      book_edition_tier,
  p_condition book_condition
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  e   editions;
  b   book_price_boundaries;
  w   works;
BEGIN
  SELECT * INTO e FROM editions
   WHERE isbn13 = p_isbn13 AND is_canonical LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', FALSE,
      'reason', 'We do not have this edition in the catalogue yet.');
  END IF;

  SELECT * INTO w FROM works WHERE id = e.work_id;

  IF p_tier = 'UNOFFICIAL' THEN
    RETURN jsonb_build_object(
      'found', TRUE,
      'book', jsonb_build_object(
        'edition_id', e.id, 'isbn13', e.isbn13, 'title', e.title,
        'authors', e.authors, 'publisher', e.publisher,
        'publication_year', e.publication_year, 'format', e.format,
        'cover_id', e.cover_id, 'category', w.category),
      'priceable', FALSE,
      'reason', 'An unofficial copy cannot be given a price. It can still be swapped or lent, with a flat deposit.',
      'flat_deposit', cfg('UNOFFICIAL_FLAT_DEPOSIT'));
  END IF;

  b := get_or_compute_band(e.id, p_format, p_tier, p_condition);

  RETURN jsonb_build_object(
    'found', TRUE,
    'book', jsonb_build_object(
      'edition_id', e.id, 'isbn13', e.isbn13, 'isbn10', e.isbn10,
      'title', e.title, 'subtitle', e.subtitle, 'authors', e.authors,
      'publisher', e.publisher, 'publication_year', e.publication_year,
      'edition_name', e.edition_name, 'format', e.format,
      'language', e.language, 'page_count', e.page_count,
      'cover_id', e.cover_id, 'category', w.category,
      'cover_url', CASE WHEN e.cover_id IS NOT NULL
                        THEN 'https://covers.openlibrary.org/b/id/' || e.cover_id || '-M.jpg' END),
    'priceable', b.reference_price IS NOT NULL,
    'mrp', b.mrp_inr,
    -- What the reader may charge. Their choice, inside these bounds.
    'sell', jsonb_build_object(
      'allowed_min', b.lower_boundary,
      'suggested',   b.reference_price,
      'allowed_max', b.upper_boundary),
    -- The system's valuation. Not the reader's to move.
    'reference_price', b.reference_price,
    'deposit', px_round_inr((coalesce(b.reference_price, 0) * deposit_rate_for_condition(p_condition))::DOUBLE PRECISION),
    'deposit_rate_percent', round(deposit_rate_for_condition(p_condition) * 100),
    'methodology', b.methodology,
    'confidence', b.confidence,
    'sample_size', b.sample_size,
    'is_estimate', b.methodology IN ('MRP_DERIVED', 'CATEGORY_PRIOR'),
    'explanation', CASE b.methodology
      WHEN 'EDITION_OBSERVATIONS' THEN 'Based on price observations recorded for this exact edition.'
      WHEN 'MRP_DERIVED' THEN 'An MRP-derived estimate, using the printed MRP and SwapSutra''s condition policy. It is not based on observed sale prices.'
      WHEN 'CATEGORY_PRIOR' THEN 'An estimate from SwapSutra''s standard rate for this category. It is not based on observed sale prices.'
      ELSE 'We do not have enough information to price this edition yet.' END);
END $$;


-- ════════════════════════════════════ 8. SERVER-SIDE VALIDATION OF A LISTING

/*
  validate_and_record_listing — the ONLY way a listing price is accepted.

  Recomputes the band from the database, checks the submitted price against
  it, and records the listing with the band it was held to. Nothing the
  client sends influences the band or the deposit: the price is the only
  number taken from the request, and it is only ever compared, never used.
*/
CREATE OR REPLACE FUNCTION validate_and_record_listing(
  p_listing_id  TEXT,
  p_owner_email TEXT,
  p_isbn13      CHAR(13),
  p_format      book_format,
  p_tier        book_edition_tier,
  p_condition   book_condition,
  p_sell_price  NUMERIC,
  p_mrp_claim   NUMERIC DEFAULT NULL,
  p_mrp_proof   TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  e editions; b book_price_boundaries; q JSONB; v_dep NUMERIC;
BEGIN
  SELECT * INTO e FROM editions WHERE isbn13 = p_isbn13 AND is_canonical LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'BOOK_NOT_FOUND',
      'message', 'We could not find that ISBN in the catalogue.');
  END IF;

  -- An unauthorised copy is recorded, and carries no price.
  IF p_tier = 'UNOFFICIAL' THEN
    IF p_sell_price IS NOT NULL THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'UNOFFICIAL_NOT_SALEABLE',
        'message', 'An unofficial copy cannot be sold or rented on SwapSutra. You can still swap or lend it.');
    END IF;
    INSERT INTO listing_prices (listing_id, edition_id, isbn13, owner_email,
                                format, edition_tier, condition)
    VALUES (p_listing_id, e.id, p_isbn13, p_owner_email, p_format, p_tier, p_condition)
    ON CONFLICT (listing_id) DO UPDATE SET
      edition_tier = EXCLUDED.edition_tier, condition = EXCLUDED.condition,
      sell_price = NULL, reference_price = NULL, deposit_amount = NULL,
      updated_at = now();
    RETURN jsonb_build_object('ok', TRUE, 'priceable', FALSE,
      'flat_deposit', cfg('UNOFFICIAL_FLAT_DEPOSIT'));
  END IF;

  -- A reader-supplied MRP is EVIDENCE, not truth. It is recorded as an
  -- observation so the engine can weigh it against everything else, and it
  -- never becomes the edition's MRP by itself.
  IF p_mrp_claim IS NOT NULL AND p_mrp_claim > 0 THEN
    INSERT INTO book_prices (edition_id, isbn13, format, kind, price, source,
                             source_url, source_ref, confidence)
    VALUES (e.id, p_isbn13, p_format, 'MRP', p_mrp_claim, 'USER_DECLARED_MRP',
            p_mrp_proof, 'listing ' || p_listing_id, 0.45)
    ON CONFLICT DO NOTHING;
  END IF;

  b := get_or_compute_band(e.id, p_format, p_tier, p_condition, p_mrp_claim IS NOT NULL,
                           'reader-declared MRP on listing ' || p_listing_id);

  IF b.reference_price IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INSUFFICIENT_DATA',
      'message', 'We do not have enough price information for this edition yet.');
  END IF;

  IF p_sell_price IS NOT NULL THEN
    IF p_sell_price < b.lower_boundary OR p_sell_price > b.upper_boundary THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'PRICE_OUT_OF_RANGE',
        'message', format('For a %s copy of this edition the allowed range is Rs.%s to Rs.%s.',
                          lower(replace(p_condition::TEXT, '_', ' ')),
                          b.lower_boundary, b.upper_boundary),
        'allowed_min', b.lower_boundary, 'allowed_max', b.upper_boundary,
        'suggested', b.reference_price);
    END IF;
  END IF;

  -- The deposit comes from the REFERENCE, never from p_sell_price. Rate is
  -- tiered by condition (60/55/50%) rather than a flat DEPOSIT_RATE — see
  -- deposit_rate_for_condition above. NOTE: this function definition is
  -- superseded by the one in 005_mrp_evidence.sql, which runs after this
  -- file and is the version actually active on a fully-migrated database;
  -- kept in sync here anyway so the source stays readable end to end.
  v_dep := px_round_inr((b.reference_price * deposit_rate_for_condition(p_condition))::DOUBLE PRECISION);

  INSERT INTO listing_prices (
    listing_id, edition_id, isbn13, owner_email, format, edition_tier, condition,
    mrp_inr, mrp_source, mrp_proof_url, sell_price, allowed_min, allowed_max,
    suggested_price, reference_price, deposit_amount, methodology, confidence)
  VALUES (
    p_listing_id, e.id, p_isbn13, p_owner_email, p_format, p_tier, p_condition,
    b.mrp_inr, CASE WHEN p_mrp_claim IS NOT NULL THEN 'USER_DECLARED_MRP'::price_source_kind END,
    p_mrp_proof, p_sell_price, b.lower_boundary, b.upper_boundary,
    b.reference_price, b.reference_price, v_dep, b.methodology, b.confidence)
  ON CONFLICT (listing_id) DO UPDATE SET
    edition_id = EXCLUDED.edition_id, format = EXCLUDED.format,
    edition_tier = EXCLUDED.edition_tier, condition = EXCLUDED.condition,
    mrp_inr = EXCLUDED.mrp_inr, sell_price = EXCLUDED.sell_price,
    allowed_min = EXCLUDED.allowed_min, allowed_max = EXCLUDED.allowed_max,
    suggested_price = EXCLUDED.suggested_price,
    reference_price = EXCLUDED.reference_price,
    deposit_amount = EXCLUDED.deposit_amount,
    methodology = EXCLUDED.methodology, confidence = EXCLUDED.confidence,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', TRUE, 'priceable', TRUE,
    'sell_price', p_sell_price,
    'allowed_min', b.lower_boundary, 'allowed_max', b.upper_boundary,
    'suggested', b.reference_price,
    'reference_price', b.reference_price,
    'deposit', v_dep,
    'methodology', b.methodology, 'confidence', b.confidence);
END $$;


-- ═══════════════════════════════ 9. THE DEPOSIT, FOR A SWAP OF TWO BOOKS

/*
  swap_deposits — two books, valued independently.

  Each side deposits a condition-tiered percentage (60/55/50%, see
  deposit_rate_for_condition) of the OTHER book's reference price — tiered
  by THAT book's own condition, since the deposit protects the book its
  payer is holding, not the book they gave up. The two figures are
  deliberately different when the books, or their conditions, differ.

  Neither figure can be moved by either owner's chosen SELL price — this
  function does not accept one.
*/
CREATE OR REPLACE FUNCTION swap_deposits(
  p_listing_a TEXT,
  p_listing_b TEXT
)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE a listing_prices; b listing_prices; rate_a NUMERIC; rate_b NUMERIC;
BEGIN
  SELECT * INTO a FROM listing_prices WHERE listing_id = p_listing_a;
  SELECT * INTO b FROM listing_prices WHERE listing_id = p_listing_b;
  -- A holds B's book, so A's rate comes from B's condition, and vice versa.
  rate_a := deposit_rate_for_condition(b.condition);
  rate_b := deposit_rate_for_condition(a.condition);

  RETURN jsonb_build_object(
    'a', jsonb_build_object(
      'listing_id', p_listing_a,
      'reference_price', a.reference_price,
      'deposit_rate_percent', round(rate_a * 100),
      -- A holds B's book, so A's deposit is on B's value.
      'deposit_owed', CASE WHEN b.reference_price IS NOT NULL
                           THEN px_round_inr((b.reference_price * rate_a)::DOUBLE PRECISION)
                           ELSE cfg('UNOFFICIAL_FLAT_DEPOSIT') END),
    'b', jsonb_build_object(
      'listing_id', p_listing_b,
      'reference_price', b.reference_price,
      'deposit_rate_percent', round(rate_b * 100),
      'deposit_owed', CASE WHEN a.reference_price IS NOT NULL
                           THEN px_round_inr((a.reference_price * rate_b)::DOUBLE PRECISION)
                           ELSE cfg('UNOFFICIAL_FLAT_DEPOSIT') END));
END $$;


-- ═══════════════════════════════════ 10. OPEN LIBRARY ON-DEMAND UPSERT

/*
  upsert_edition_from_openlibrary — takes one normalised record and stores it.

  The API does the fetching and normalising (it has the HTTP client and the
  retry logic); this does the storing, so that duplicate prevention and
  canonical selection are decided in one place by the database rather than
  by whichever caller happened to write the row.
*/
CREATE OR REPLACE FUNCTION upsert_edition_from_openlibrary(p_rec JSONB)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_isbn CHAR(13); v_work_id BIGINT; v_edition_id BIGINT; v_existing BIGINT;
BEGIN
  v_isbn := p_rec->>'isbn13';
  IF v_isbn IS NULL OR v_isbn !~ '^97[89][0-9]{10}$' THEN
    RAISE EXCEPTION 'upsert_edition_from_openlibrary requires a well-formed isbn13, got %', v_isbn;
  END IF;

  -- Already have it? Return it. This is the duplicate-prevention point, and
  -- the reason the same ISBN never causes a second Open Library call.
  SELECT id INTO v_existing FROM editions WHERE isbn13 = v_isbn AND is_canonical LIMIT 1;
  IF FOUND THEN RETURN v_existing; END IF;

  IF p_rec->>'ol_work_key' IS NOT NULL THEN
    INSERT INTO works (ol_work_key, title, title_normalised, category)
    VALUES (p_rec->>'ol_work_key', p_rec->>'title',
            lower(regexp_replace(coalesce(p_rec->>'title',''), '[^a-zA-Z0-9 ]', '', 'g')),
            p_rec->>'category')
    ON CONFLICT (ol_work_key) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_work_id;
  END IF;

  INSERT INTO editions (
    work_id, isbn13, isbn10, title, subtitle, authors, publisher,
    publisher_normalised, publication_year, edition_name, format, edition_tier,
    language, page_count, cover_id, ol_edition_key, is_canonical, source, mrp_inr)
  VALUES (
    v_work_id, v_isbn, nullif(p_rec->>'isbn10',''), p_rec->>'title',
    nullif(p_rec->>'subtitle',''),
    coalesce((SELECT array_agg(value::TEXT) FROM jsonb_array_elements_text(
                coalesce(p_rec->'authors','[]'::jsonb)) AS value), '{}'),
    nullif(p_rec->>'publisher',''),
    lower(regexp_replace(coalesce(p_rec->>'publisher',''), '[^a-zA-Z0-9 ]', '', 'g')),
    (p_rec->>'publication_year')::SMALLINT,
    nullif(p_rec->>'edition_name',''),
    coalesce((p_rec->>'format')::book_format, 'UNKNOWN'),
    coalesce((p_rec->>'edition_tier')::book_edition_tier, 'NOT_SURE'),
    nullif(p_rec->>'language',''),
    (p_rec->>'page_count')::INTEGER,
    (p_rec->>'cover_id')::INTEGER,
    p_rec->>'ol_edition_key', TRUE, 'ADMIN_MANUAL',
    (p_rec->>'mrp_inr')::NUMERIC)
  RETURNING id INTO v_edition_id;

  RETURN v_edition_id;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() used above

COMMIT;


-- ══════════════════════════════════════════════════════════════ 11. SECURITY

ALTER TABLE listing_prices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_config  ENABLE ROW LEVEL SECURITY;

-- listing_prices, price_overrides and pricing_config get RLS with NO policy
-- for anon/authenticated, which makes them invisible to those roles
-- entirely. Every read the app needs goes through price_quote(), which
-- returns exactly the fields a listing screen needs and nothing else.
--
-- The functions are SECURITY INVOKER by design: they are called by the
-- server with the service role. A browser calling them directly with the
-- anon key gets nothing, because the tables underneath are closed.

REVOKE ALL ON FUNCTION compute_price_band(BIGINT, book_format, book_edition_tier, book_condition) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_or_compute_band(BIGINT, book_format, book_edition_tier, book_condition, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_and_record_listing(TEXT, TEXT, CHAR, book_format, book_edition_tier, book_condition, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_edition_from_openlibrary(JSONB) FROM PUBLIC;
