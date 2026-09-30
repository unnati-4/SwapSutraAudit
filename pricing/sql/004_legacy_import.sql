-- ══════════════════════════════════════════════════════════════════════════
-- 004 — importing the existing spreadsheet, idempotently.
--
-- pipeline/import_legacy_xlsx.py reads the xlsx (never modifying it) and
-- writes three TSVs. This loads them, and can be run repeatedly without
-- creating a duplicate: every insert has a conflict target, and the
-- observation dedup index (one per source, per edition, per UTC day) is
-- what stops a re-run inflating a sample size from 3 to 6.
--
--   python3 -m pipeline.import_legacy_xlsx --xlsx SwapSutra-Book-Prices.xlsx --out ./staging
--   psql $DATABASE_URL -f sql/004_legacy_import.sql
--   psql $DATABASE_URL -c "\copy staging_legacy_editions FROM 'staging/legacy_editions.tsv' WITH (FORMAT csv, DELIMITER E'\t', NULL '')"
--   psql $DATABASE_URL -c "\copy staging_legacy_prices   FROM 'staging/legacy_prices.tsv'   WITH (FORMAT csv, DELIMITER E'\t', NULL '')"
--   psql $DATABASE_URL -c "\copy staging_legacy_priors   FROM 'staging/legacy_priors.tsv'   WITH (FORMAT csv, DELIMITER E'\t', NULL '')"
--   psql $DATABASE_URL -c "SELECT * FROM merge_legacy_import();"
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS staging_legacy_editions;
DROP TABLE IF EXISTS staging_legacy_prices;
DROP TABLE IF EXISTS staging_legacy_priors;

CREATE UNLOGGED TABLE staging_legacy_editions (
  isbn13 TEXT, title TEXT, author TEXT, publisher TEXT, format TEXT,
  edition_tier TEXT, category TEXT, is_set TEXT, volume_count TEXT,
  mrp_inr NUMERIC, mrp_confidence REAL, title_normalised TEXT, source TEXT
);

CREATE UNLOGGED TABLE staging_legacy_prices (
  isbn13 TEXT, format TEXT, kind TEXT, price NUMERIC, currency TEXT,
  source TEXT, source_ref TEXT, confidence REAL
);

CREATE UNLOGGED TABLE staging_legacy_priors (
  scope TEXT, format TEXT, condition TEXT, mu_log_ratio DOUBLE PRECISION,
  tau2 DOUBLE PRECISION, sigma2 DOUBLE PRECISION, n_observations INTEGER
);

COMMIT;


CREATE OR REPLACE FUNCTION merge_legacy_import()
RETURNS TABLE (step TEXT, rows_affected BIGINT)
LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  -- 1. Works, one per distinct title. The legacy sheet has no work keys, so
  --    the normalised title is the grouping key — which is exactly the sort
  --    of soft match that must NOT be used for pricing, and is fine for
  --    grouping a 72-row seed set.
  INSERT INTO works (ol_work_key, title, title_normalised, category)
  SELECT DISTINCT ON (s.title_normalised)
         'legacy:' || s.title_normalised, s.title, s.title_normalised, s.category
  FROM staging_legacy_editions s
  WHERE s.title_normalised IS NOT NULL AND s.title_normalised <> ''
  ORDER BY s.title_normalised, s.title
  ON CONFLICT (ol_work_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  step := 'works_inserted'; rows_affected := n; RETURN NEXT;

  -- 2. Editions WITH an ISBN.
  --
  --    DISTINCT ON (isbn13) matters, and the reason is a real modelling
  --    point rather than a SQL detail. The legacy sheet has ONE row per
  --    book with THREE format price columns, and the importer fans those
  --    into three rows — but an ISBN identifies one specific published
  --    edition, which has exactly one format. Three rows sharing an ISBN
  --    are not three editions; they are three price observations about the
  --    same title in different bindings.
  --
  --    So one canonical edition per ISBN is created here, and all three
  --    prices land in book_prices in step 4, each carrying its own format.
  --    The engine reads observations by format, so a hardcover price stays
  --    available to a reader who lists that ISBN as a hardcover.
  --
  --    The ordering makes the choice deterministic: a re-run picks the same
  --    row rather than flip-flopping and rewriting the catalogue.
  INSERT INTO editions (work_id, isbn13, title, authors, format, edition_tier,
                        is_canonical, is_set, volume_count, mrp_inr,
                        mrp_confidence, mrp_verified_at, source)
  SELECT DISTINCT ON (s.isbn13)
         w.id, s.isbn13, s.title,
         CASE WHEN s.author <> '' THEN ARRAY[s.author] ELSE '{}' END,
         s.format::book_format, s.edition_tier::book_edition_tier, TRUE,
         s.is_set = 't', nullif(s.volume_count,'')::SMALLINT,
         s.mrp_inr, s.mrp_confidence, now(), 'LEGACY_SHEET'
  FROM staging_legacy_editions s
  LEFT JOIN works w ON w.ol_work_key = 'legacy:' || s.title_normalised
  WHERE s.isbn13 IS NOT NULL AND s.isbn13 <> ''
  -- Publisher paperback first: it is the commonest Indian binding, so it is
  -- the likeliest thing a bare ISBN in that sheet actually refers to.
  ORDER BY s.isbn13,
           CASE s.edition_tier WHEN 'PUBLISHER' THEN 0 ELSE 1 END,
           CASE s.format WHEN 'TRADE_PAPERBACK' THEN 0
                         WHEN 'HARDCOVER' THEN 1 ELSE 2 END
  -- The predicate must match editions_one_canonical_per_isbn VERBATIM,
  -- including the IS NOT NULL half. Postgres will not infer a partial index
  -- from a predicate that is merely equivalent.
  ON CONFLICT (isbn13) WHERE is_canonical AND isbn13 IS NOT NULL DO UPDATE SET
    mrp_inr = COALESCE(editions.mrp_inr, EXCLUDED.mrp_inr),
    mrp_confidence = GREATEST(COALESCE(editions.mrp_confidence,0), COALESCE(EXCLUDED.mrp_confidence,0)),
    updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  step := 'editions_with_isbn'; rows_affected := n; RETURN NEXT;

  -- 3. Editions WITHOUT an ISBN. Kept, because the title, the price and the
  --    confidence flag are all still worth having — but not canonical, so
  --    they can never be resolved by a scan and can never price a listing.
  --    Idempotency here keys on the title, since there is no ISBN to key on.
  INSERT INTO editions (work_id, title, authors, format, edition_tier,
                        is_canonical, mrp_inr, mrp_confidence, source, ol_edition_key)
  SELECT DISTINCT ON (s.title_normalised, s.format, s.edition_tier)
         w.id, s.title,
         CASE WHEN s.author <> '' THEN ARRAY[s.author] ELSE '{}' END,
         s.format::book_format, s.edition_tier::book_edition_tier, FALSE,
         s.mrp_inr, s.mrp_confidence, 'LEGACY_SHEET',
         'legacy-noisbn:' || s.title_normalised || ':' || s.format || ':' || s.edition_tier
  FROM staging_legacy_editions s
  LEFT JOIN works w ON w.ol_work_key = 'legacy:' || s.title_normalised
  WHERE (s.isbn13 IS NULL OR s.isbn13 = '')
  ORDER BY s.title_normalised, s.format, s.edition_tier, s.mrp_inr DESC
  ON CONFLICT (ol_edition_key) WHERE ol_edition_key IS NOT NULL DO UPDATE SET
    mrp_inr = EXCLUDED.mrp_inr, updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  step := 'editions_without_isbn'; rows_affected := n; RETURN NEXT;

  -- 4. The price observations. Every figure in the legacy sheet is a printed
  --    MRP rather than a street price, which is why they can be loaded as
  --    MRP observations directly.
  --
  --    The V/E confidence flag survives as a per-observation confidence, so
  --    a rough estimate stays findable and correctable instead of becoming
  --    indistinguishable from a verified figure the moment it lands here.
  INSERT INTO book_prices (edition_id, isbn13, format, kind, price, currency,
                           source, source_ref, confidence)
  SELECT e.id, s.isbn13, s.format::book_format, s.kind::price_kind, s.price,
         'INR', s.source::price_source_kind, s.source_ref, s.confidence
  FROM staging_legacy_prices s
  JOIN editions e ON e.isbn13 = s.isbn13 AND e.is_canonical
  ON CONFLICT DO NOTHING;   -- the per-source-per-day dedup index
  GET DIAGNOSTICS n = ROW_COUNT;
  step := 'price_observations'; rows_affected := n; RETURN NEXT;

  -- 5. The genre priors. Seeds with deliberately wide variances, meant to be
  --    replaced by a fit against real transactions rather than believed.
  INSERT INTO price_priors (scope, format, condition, mu_log_ratio, tau2, sigma2, n_observations)
  SELECT s.scope, s.format::book_format, s.condition::book_condition,
         s.mu_log_ratio, s.tau2, s.sigma2, s.n_observations
  FROM staging_legacy_priors s
  ON CONFLICT (scope, format, condition) WHERE is_active DO UPDATE SET
    mu_log_ratio = EXCLUDED.mu_log_ratio, fitted_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  step := 'priors'; rows_affected := n; RETURN NEXT;

  RETURN;
END $$;


