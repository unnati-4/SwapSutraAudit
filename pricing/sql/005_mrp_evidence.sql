-- ══════════════════════════════════════════════════════════════════════════
-- 005 — MRP evidence hierarchy.
--
-- THE PROBLEM THIS FIXES
-- Before this migration, a reader who typed "MRP 900" on a Rs.200 paperback
-- had that number stored as an MRP observation and fed straight into the
-- price anchor. It carried a lower confidence, but confidence is a weight,
-- not a gate — the number still moved the band, and the band decides how
-- much the OTHER reader deposits.
--
-- Plausibility bounds did not close this. A category range rejects the
-- absurd (Rs.12, Rs.90,000); it says nothing about whether Rs.900 is the
-- MRP of THIS book. Plausibility is a sanity check, never proof.
--
-- THE HIERARCHY
--   1. PHOTO_VERIFIED     the printed MRP was read off the reader's own
--                         photo of the cover and confirmed by an admin.
--                         Strongest: the evidence is the object itself.
--   2. CATALOGUE_VERIFIED an MRP already verified for this edition.
--   3. PUBLISHER_SOURCED  a publisher or trade-catalogue page, with a
--                         verbatim quote that was checked against the page.
--   4. USER_PROVISIONAL   a reader typed it and nothing corroborates it.
--                         Recorded, visible, reviewable — and NOT used to
--                         anchor a price.
--
-- Tiers 1-3 anchor. Tier 4 does not. That is the whole change: a provisional
-- MRP is kept (it is a lead worth following up) but it cannot move money.
--
-- WHERE GEMINI SITS
-- Unchanged: extraction only. An extracted MRP arrives as evidence and is
-- classified by the deterministic rules below like any other. An extraction
-- whose quote could not be checked against a supplied source can only ever
-- reach USER_PROVISIONAL, so an LLM-produced number never becomes a trusted
-- MRP on its own.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  CREATE TYPE mrp_evidence_tier AS ENUM (
    'PHOTO_VERIFIED',
    'CATALOGUE_VERIFIED',
    'PUBLISHER_SOURCED',
    'USER_PROVISIONAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE book_prices
  ADD COLUMN IF NOT EXISTS evidence_tier mrp_evidence_tier;

ALTER TABLE editions
  ADD COLUMN IF NOT EXISTS mrp_evidence_tier mrp_evidence_tier;

COMMENT ON COLUMN book_prices.evidence_tier IS
  'How well supported an MRP observation is. Only PHOTO_VERIFIED, '
  'CATALOGUE_VERIFIED and PUBLISHER_SOURCED are allowed to anchor a price. '
  'NULL on non-MRP observations, which are governed by kind and source '
  'instead.';

-- An MRP observation must say how well supported it is. Anything else is a
-- number of unknown provenance sitting in the table that decides prices.
ALTER TABLE book_prices DROP CONSTRAINT IF EXISTS prices_mrp_has_evidence;
ALTER TABLE book_prices ADD CONSTRAINT prices_mrp_has_evidence CHECK (
  kind <> 'MRP' OR evidence_tier IS NOT NULL
);

-- A reader's photo is the strongest evidence there is, but only once
-- somebody has confirmed the MRP is legible in it. A claim of PHOTO_VERIFIED
-- with no photo attached is not evidence, it is an assertion.
ALTER TABLE book_prices DROP CONSTRAINT IF EXISTS prices_photo_tier_has_photo;
ALTER TABLE book_prices ADD CONSTRAINT prices_photo_tier_has_photo CHECK (
  evidence_tier <> 'PHOTO_VERIFIED' OR source_url IS NOT NULL
);

-- The constraint above must never become a reason for a real observation to
-- be lost. An MRP arriving with no tier is not rejected; it is filed at the
-- weakest tier, which is the one the pricing engine refuses to anchor on.
-- Failing closed here (drop the row) and failing open there (assume it is
-- trustworthy) are both worse than recording it honestly as unverified.
-- Callers that know the provenance pass evidence_tier explicitly and this
-- trigger leaves them alone.
CREATE OR REPLACE FUNCTION default_mrp_evidence_tier()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'MRP' AND NEW.evidence_tier IS NULL THEN
    NEW.evidence_tier := 'USER_PROVISIONAL';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_default_mrp_evidence_tier ON book_prices;
CREATE TRIGGER trg_default_mrp_evidence_tier
  BEFORE INSERT OR UPDATE ON book_prices
  FOR EACH ROW EXECUTE FUNCTION default_mrp_evidence_tier();

-- Backfill. Everything already in the table predates the hierarchy, so it is
-- classified by where it came from rather than being assumed trustworthy.
UPDATE book_prices SET evidence_tier =
  CASE
    WHEN source IN ('PUBLISHER_SITE', 'NIELSEN_BOOKDATA', 'LEGACY_SHEET',
                    'ADMIN_MANUAL', 'ISBNDB', 'AMAZON_CREATORS_API')
      THEN 'PUBLISHER_SOURCED'::mrp_evidence_tier
    ELSE 'USER_PROVISIONAL'::mrp_evidence_tier
  END
WHERE kind = 'MRP' AND evidence_tier IS NULL;

UPDATE editions SET mrp_evidence_tier = 'PUBLISHER_SOURCED'
WHERE mrp_inr IS NOT NULL AND mrp_evidence_tier IS NULL;

-- The tiers that may anchor a price. One list, read by every caller, so the
-- rule cannot be applied differently in two places.
CREATE OR REPLACE FUNCTION mrp_anchoring_tiers()
RETURNS mrp_evidence_tier[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['PHOTO_VERIFIED', 'CATALOGUE_VERIFIED', 'PUBLISHER_SOURCED']::mrp_evidence_tier[];
$$;

/**
 * Classifies a submitted MRP.
 *
 * Deterministic, in the database, and deliberately pessimistic: a claim
 * reaches an anchoring tier only when something outside the claim itself
 * supports it. A photo URL alone is NOT enough — the photo has to have been
 * confirmed, which is an admin action, so `p_photo_confirmed` is never set
 * from a reader's own request.
 */
CREATE OR REPLACE FUNCTION classify_mrp_evidence(
  p_source          price_source_kind,
  p_proof_url       TEXT,
  p_photo_confirmed BOOLEAN DEFAULT FALSE,
  p_quote_verified  BOOLEAN DEFAULT FALSE
)
RETURNS mrp_evidence_tier LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    -- 1. The reader's own photo, confirmed legible by an admin.
    WHEN p_photo_confirmed AND p_proof_url IS NOT NULL THEN 'PHOTO_VERIFIED'
    -- 3. A publisher or trade source, with a quote that was checked against
    --    the page it claims to come from. An unchecked quote is not a source.
    WHEN p_source IN ('PUBLISHER_SITE','NIELSEN_BOOKDATA','ISBNDB','AMAZON_CREATORS_API')
         AND p_quote_verified THEN 'PUBLISHER_SOURCED'
    WHEN p_source = 'ADMIN_MANUAL' AND p_quote_verified THEN 'PUBLISHER_SOURCED'
    -- 4. Everything else, including an unconfirmed photo and any extraction
    --    whose quote could not be checked.
    ELSE 'USER_PROVISIONAL'
  END::mrp_evidence_tier;
$$;

COMMIT;


-- ═══════════════════════ THE ENGINE ONLY ANCHORS ON SUPPORTED EVIDENCE

/*
  compute_price_band, revised in exactly one respect: the anchor query now
  excludes USER_PROVISIONAL MRP observations.

  Nothing else about the estimator changes. Log space, discount-ratio
  modelling, group priors, shrinkage, the sample-size-aware centre, Hampel at
  n>=5, the MAD==0 floor, the condition ladder, the MRP cap, MRP_DERIVED and
  INSUFFICIENT_DATA all behave exactly as before.
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
  v_mrp_tier     mrp_evidence_tier;
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
  v_n_provisional INT := 0;
  v_conf         REAL;
  v_digest       TEXT;
  v_category     TEXT;
  v_override     RECORD;
BEGIN
  IF p_tier = 'UNOFFICIAL' THEN
    RETURN QUERY SELECT NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
      'INSUFFICIENT_DATA'::boundary_method, 0.0::real, 0, NULL::real, NULL::NUMERIC, NULL::NUMERIC,
      ARRAY['Unofficial copies are not priced. They may still be swapped or lent.']::TEXT[], NULL::TEXT;
    RETURN;
  END IF;

  SELECT e.mrp_inr, e.mrp_evidence_tier, w.category
    INTO v_mrp, v_mrp_tier, v_category
  FROM editions e LEFT JOIN works w ON w.id = e.work_id
  WHERE e.id = p_edition_id;

  -- An edition MRP that is itself only provisional does not anchor either.
  IF v_mrp IS NOT NULL AND v_mrp_tier = 'USER_PROVISIONAL' THEN
    v_notes := v_notes || format(
      'The stored MRP of Rs.%s is provisional (reader-entered, unverified) and is not used to anchor the price.',
      v_mrp);
    v_mrp := NULL;
  END IF;

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

  -- ── The anchor ───────────────────────────────────────────────────────
  -- MRP observations must carry an anchoring evidence tier. NEW_RETAIL is a
  -- selling price rather than an MRP claim, so it is governed by its source
  -- and its own outlier filtering, not by this hierarchy.
  SELECT array_agg(ln(bp.price::DOUBLE PRECISION)) INTO anchor_logs
  FROM book_prices bp
  WHERE bp.edition_id = p_edition_id AND bp.format = p_format
    AND NOT bp.excluded
    AND (
      (bp.kind = 'MRP' AND bp.evidence_tier = ANY (mrp_anchoring_tiers()))
      OR bp.kind = 'NEW_RETAIL'
    );

  SELECT count(*) INTO v_n_provisional
  FROM book_prices bp
  WHERE bp.edition_id = p_edition_id AND bp.format = p_format
    AND NOT bp.excluded AND bp.kind = 'MRP'
    AND bp.evidence_tier = 'USER_PROVISIONAL';

  IF v_n_provisional > 0 THEN
    v_notes := v_notes || format(
      '%s reader-entered MRP claim(s) held as provisional and excluded from the price until verified.',
      v_n_provisional);
  END IF;

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
  -- makes it more stable and more checkable than a scraped figure. Where
  -- both exist the MRP anchors and the observations adjust it.
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
      v_notes || 'No verified MRP and no usable price observations for this edition.'::TEXT,
      NULL::TEXT;
    RETURN;
  END IF;

  -- ── The band: the published condition ladder ─────────────────────────
  SELECT sell_lower_pct, sell_ref_pct, sell_upper_pct
    INTO v_lo_pct, v_ref_pct, v_up_pct
  FROM condition_price_ladder WHERE condition = p_condition;

  v_lower := v_anchor * v_lo_pct;
  v_ref   := v_anchor * v_ref_pct;
  v_upper := v_anchor * v_up_pct;
  v_notes := v_notes || format('Allowed listing range from the published %s ladder (%s%%-%s%% of Rs.%s).',
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
      v_w := array_length(direct_kept, 1)::DOUBLE PRECISION
             / (array_length(direct_kept, 1) + 4.0);
    END IF;

    v_ref := exp(v_w * v_centre + (1 - v_w) * ln(v_ref));
    v_notes := v_notes || format('Reference value pulled toward %s direct used-copy observation(s) (%s) with weight %s.',
                                 array_length(direct_kept, 1), v_rule, round(v_w::NUMERIC, 2));
    v_ref := least(greatest(v_ref, v_lower), v_upper);
  END IF;

  -- ── The MRP cap: a SwapSutra platform policy ─────────────────────────
  -- SwapSutra caps used-book pricing at the printed MRP. This is a platform
  -- policy decision, not a statement of law: a second-hand copy listed above
  -- the price of a new one is a bad outcome for the reader on the other side
  -- of the trade, so the platform does not allow it.
  IF v_mrp IS NOT NULL THEN
    v_upper := least(v_upper, v_mrp::DOUBLE PRECISION);
    v_ref   := least(v_ref, v_upper);
    v_lower := least(v_lower, v_ref);
  END IF;

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
    px_round_inr(v_ref),
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


-- ═══════════════ A READER'S MRP CLAIM IS PROVISIONAL UNTIL VERIFIED

/*
  validate_and_record_listing, revised in one respect: a reader's MRP claim
  is classified before it is stored, and a provisional claim does not force a
  recompute — because it does not participate in the price.

  Everything else is unchanged. The seller's chosen price is still checked
  against a band the server computes; the deposit still comes from the
  reference value and never from the seller's chosen price.
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
  e editions; b book_price_boundaries; v_dep NUMERIC; v_tier mrp_evidence_tier;
BEGIN
  SELECT * INTO e FROM editions WHERE isbn13 = p_isbn13 AND is_canonical LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'BOOK_NOT_FOUND',
      'message', 'We could not find that ISBN in the catalogue.');
  END IF;

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

  -- A reader-supplied MRP is a CLAIM. It is recorded with its evidence tier
  -- so it can be reviewed and promoted later, and — being provisional — it
  -- does not enter the anchor and does not force a recompute. A photo URL
  -- raises the claim's value as a lead; it does not by itself verify it,
  -- because nobody has yet looked at the photo.
  IF p_mrp_claim IS NOT NULL AND p_mrp_claim > 0 THEN
    v_tier := classify_mrp_evidence('USER_DECLARED_MRP', p_mrp_proof, FALSE, FALSE);
    INSERT INTO book_prices (edition_id, isbn13, format, kind, price, source,
                             source_url, source_ref, confidence, evidence_tier)
    VALUES (e.id, p_isbn13, p_format, 'MRP', p_mrp_claim, 'USER_DECLARED_MRP',
            p_mrp_proof, 'listing ' || p_listing_id, 0.25, v_tier)
    ON CONFLICT DO NOTHING;
  END IF;

  b := get_or_compute_band(e.id, p_format, p_tier, p_condition);

  IF b.reference_price IS NULL THEN
    -- The claim status travels even on this path. A reader who just typed an
    -- MRP and got back "not enough information" would otherwise have no idea
    -- their number was recorded and is waiting on verification.
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INSUFFICIENT_DATA',
      'message', CASE WHEN v_tier = 'USER_PROVISIONAL'
        THEN 'Thanks — we have recorded that MRP. We check reader-entered prices before using them, so this book is not priced yet.'
        ELSE 'We do not have enough verified price information for this edition yet.' END,
      'mrp_claim_status', CASE WHEN p_mrp_claim IS NULL THEN NULL
                               WHEN v_tier = 'USER_PROVISIONAL' THEN 'provisional'
                               ELSE 'verified' END);
  END IF;

  IF p_sell_price IS NOT NULL THEN
    IF p_sell_price < b.lower_boundary OR p_sell_price > b.upper_boundary THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'PRICE_OUT_OF_RANGE',
        'message', format('For a %s copy of this edition you may list between Rs.%s and Rs.%s.',
                          lower(replace(p_condition::TEXT, '_', ' ')),
                          b.lower_boundary, b.upper_boundary),
        'allowed_min', b.lower_boundary, 'allowed_max', b.upper_boundary,
        'suggested', b.reference_price);
    END IF;
  END IF;

  -- The deposit comes from the REFERENCE VALUE, never from p_sell_price.
  -- Rate is tiered by condition (60/55/50%, see deposit_rate_for_condition
  -- in 003_runtime.sql) rather than a flat DEPOSIT_RATE. This is the
  -- version of validate_and_record_listing that is actually active on a
  -- fully-migrated database (this CREATE OR REPLACE runs after 003's).
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
    'mrp_claim_status', CASE WHEN p_mrp_claim IS NULL THEN NULL
                             WHEN v_tier = 'USER_PROVISIONAL' THEN 'provisional'
                             ELSE 'verified' END,
    'methodology', b.methodology, 'confidence', b.confidence);
END $$;


/*
  verify_mrp_from_photo — the admin action that promotes a claim.

  This is the ONLY way a reader's MRP reaches PHOTO_VERIFIED, and it is a
  deliberate human step: somebody looked at the photo and read the printed
  MRP off it. Promotion re-anchors the edition and forces a recompute, and
  the change is recorded in price_history like any other.
*/
CREATE OR REPLACE FUNCTION verify_mrp_from_photo(
  p_observation_id BIGINT,
  p_admin_email    TEXT,
  p_confirmed_mrp  NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE o book_prices;
BEGIN
  SELECT * INTO o FROM book_prices WHERE id = p_observation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'OBSERVATION_NOT_FOUND');
  END IF;
  IF o.source_url IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NO_PHOTO',
      'message', 'That claim has no photo attached, so it cannot be photo-verified.');
  END IF;

  UPDATE book_prices
     SET evidence_tier = 'PHOTO_VERIFIED',
         price = p_confirmed_mrp,
         confidence = 0.95,
         source_ref = coalesce(source_ref, '') || ' | photo-verified by ' || p_admin_email
   WHERE id = p_observation_id;

  UPDATE editions
     SET mrp_inr = p_confirmed_mrp,
         mrp_evidence_tier = 'PHOTO_VERIFIED',
         mrp_confidence = 0.95,
         mrp_verified_at = now(),
         updated_at = now()
   WHERE id = o.edition_id;

  PERFORM get_or_compute_band(o.edition_id, o.format, 'PUBLISHER', c.condition, TRUE,
                              'MRP photo-verified by ' || p_admin_email)
  FROM (SELECT unnest(enum_range(NULL::book_condition)) AS condition) c;

  RETURN jsonb_build_object('ok', TRUE, 'mrp', p_confirmed_mrp, 'tier', 'PHOTO_VERIFIED');
END $$;

REVOKE ALL ON FUNCTION verify_mrp_from_photo(BIGINT, TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION classify_mrp_evidence(price_source_kind, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
