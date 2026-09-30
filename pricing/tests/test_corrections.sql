-- Tests for the targeted corrections.
--
-- Three things are being pinned here, and they are different in kind:
--
--   A. BEHAVIOUR — the MRP evidence hierarchy. A reader-entered MRP with
--      nothing behind it must not move a price band. This is a real change
--      and these are the tests that hold it.
--
--   B. UNCHANGED BEHAVIOUR — the corrections were meant to fix WORDING, not
--      pricing. So the MRP cap, the unofficial-copy exclusion and the
--      deposit contract are re-tested to prove the rewrite did not move them.
--
--   C. NO LEGAL CLAIMS AS LOGIC — nothing in the schema branches on a
--      statutory assertion. The cap is a platform policy; the exclusion is a
--      risk decision. Both are enforced structurally, neither is justified
--      in code by a claim about what the law requires.
--
--   psql -d <db> -f tests/test_corrections.sql

BEGIN;
\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- `cond` is nullable on purpose: NULL means the check could not be
-- evaluated, which must read as a failure rather than as a pass.
CREATE OR REPLACE FUNCTION t(label TEXT, cond BOOLEAN, detail TEXT DEFAULT '')
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(cond, FALSE) THEN 'PASS: ' || label
              WHEN cond IS NULL THEN 'FAIL: ' || label || ' (no rows / undecidable'
                                       || CASE WHEN detail <> '' THEN ': ' || detail ELSE '' END || ')'
              ELSE 'FAIL: ' || label || CASE WHEN detail <> '' THEN '  [' || detail || ']' ELSE '' END END;
$$;

-- Every check below is written as `SELECT t(..., (SELECT ...))` rather than
-- `SELECT t(...) FROM <table> WHERE ...`. The difference matters: the second
-- form emits NOTHING when the WHERE clause matches no rows, so a check that
-- should have failed simply disappears from the output and the run looks
-- clean. That happened during development — three checks vanished and the
-- suite reported 31 passes out of 35. A scalar subquery always returns a
-- row, so a missing row is a visible failure.

CREATE OR REPLACE FUNCTION must_fail(sql TEXT, label TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN 'FAIL: ' || label || ' (was allowed, should have been refused)';
EXCEPTION
  WHEN syntax_error OR undefined_column OR undefined_table OR undefined_object THEN
    RETURN 'BROKEN: ' || label || ' (' || SQLERRM || ')';
  WHEN OTHERS THEN RETURN 'PASS: ' || label;
END $$;

-- ── fixtures ────────────────────────────────────────────────────────────
INSERT INTO works (ol_work_key, title, title_normalised, category)
VALUES ('/works/CORR' || substr(md5(random()::text),1,8), 'Corrections Book', 'corrections book', 'Fiction');

CREATE TEMP TABLE fx AS SELECT 0::BIGINT AS ed, 0::BIGINT AS bare, 0::BIGINT AS unof, 0::BIGINT AS photo;

-- An edition with a PUBLISHER_SOURCED MRP: the ordinary, verified case.
INSERT INTO editions (isbn13, title, format, edition_tier, is_canonical,
                      mrp_inr, mrp_evidence_tier, work_id)
VALUES ('9789390085255', 'Corrections Book', 'TRADE_PAPERBACK', 'PUBLISHER', TRUE,
        400, 'PUBLISHER_SOURCED', (SELECT id FROM works WHERE title='Corrections Book'));
UPDATE fx SET ed = currval('editions_id_seq');

-- An edition with NO MRP at all, used to test what a bare reader claim does.
INSERT INTO editions (isbn13, title, format, edition_tier, is_canonical)
VALUES ('9788131267486', 'No MRP Book', 'TRADE_PAPERBACK', 'PUBLISHER', TRUE);
UPDATE fx SET bare = currval('editions_id_seq');

INSERT INTO editions (isbn13, title, format, edition_tier, is_canonical)
VALUES ('9780000098880', 'Unofficial Book', 'TRADE_PAPERBACK', 'UNOFFICIAL', TRUE);
UPDATE fx SET unof = currval('editions_id_seq');

-- A separate edition for the photo-verification case. The dedup index
-- permits ONE claim per source per edition per day, so a second claim on the
-- book used above is correctly dropped — which is the right behaviour and
-- the wrong fixture.
INSERT INTO editions (isbn13, title, format, edition_tier, is_canonical)
VALUES ('9780143417880', 'Photo Proof Book', 'TRADE_PAPERBACK', 'PUBLISHER', TRUE);
UPDATE fx SET photo = currval('editions_id_seq');


-- ═══════════════════════════ A. THE MRP EVIDENCE HIERARCHY (new behaviour)
\echo ''
\echo '--- a reader-entered MRP is provisional and does not move a price ---'

SELECT t('1. An MRP observation must declare its evidence tier',
  (SELECT count(*) FROM pg_constraint WHERE conname = 'prices_mrp_has_evidence') = 1);

-- An MRP arriving with no tier is not thrown away — a discarded observation
-- is a bug nobody can see. It is filed at the weakest tier instead, which is
-- the one the engine refuses to anchor on, so the writer that forgot to state
-- provenance gets the safe answer rather than a silent promotion.
INSERT INTO book_prices (edition_id, isbn13, format, kind, price, source)
SELECT bare, '9788131267486', 'TRADE_PAPERBACK', 'MRP', 1500, 'GOOGLE_BOOKS' FROM fx;

SELECT t('2. An MRP inserted with no tier is stored, not rejected',
  (SELECT count(*) FROM book_prices
    WHERE edition_id = (SELECT bare FROM fx) AND price = 1500) = 1);

SELECT t('2b. ...and defaults to USER_PROVISIONAL, which cannot anchor',
  (SELECT evidence_tier FROM book_prices
    WHERE edition_id = (SELECT bare FROM fx) AND price = 1500) = 'USER_PROVISIONAL',
  (SELECT evidence_tier::TEXT FROM book_prices
    WHERE edition_id = (SELECT bare FROM fx) AND price = 1500));

SELECT must_fail(
  $q$INSERT INTO book_prices (edition_id, isbn13, format, kind, price, source, evidence_tier)
     SELECT bare, '9788131267486', 'TRADE_PAPERBACK', 'MRP', 900, 'USER_DECLARED_MRP',
            'PHOTO_VERIFIED' FROM fx$q$,
  '3. PHOTO_VERIFIED without a photo is refused — a claim is not evidence');

SELECT t('4. A bare reader claim classifies as USER_PROVISIONAL',
  classify_mrp_evidence('USER_DECLARED_MRP', NULL, FALSE, FALSE) = 'USER_PROVISIONAL');

-- The point the whole migration exists for: attaching a photo raises the
-- claim's value as a lead, but nobody has looked at it yet.
SELECT t('5. A photo URL alone does NOT verify — it is unconfirmed until an admin looks',
  classify_mrp_evidence('USER_DECLARED_MRP', 'https://drive/x.jpg', FALSE, FALSE) = 'USER_PROVISIONAL');

SELECT t('6. A confirmed photo is the strongest tier',
  classify_mrp_evidence('USER_DECLARED_MRP', 'https://drive/x.jpg', TRUE, FALSE) = 'PHOTO_VERIFIED');

SELECT t('7. A publisher source counts only when its quote was actually checked',
  classify_mrp_evidence('PUBLISHER_SITE', NULL, FALSE, TRUE) = 'PUBLISHER_SOURCED'
  AND classify_mrp_evidence('PUBLISHER_SITE', NULL, FALSE, FALSE) = 'USER_PROVISIONAL');

SELECT t('8. Only three tiers may anchor a price',
  array_length(mrp_anchoring_tiers(), 1) = 3
  AND NOT ('USER_PROVISIONAL' = ANY (mrp_anchoring_tiers())));

-- The end-to-end version of the same thing.
SELECT validate_and_record_listing('C1','a@x.com','9788131267486',
  'TRADE_PAPERBACK','PUBLISHER','GOOD', NULL, 900, NULL);

SELECT t('9. A reader''s Rs.900 claim is stored, not discarded',
  (SELECT count(*) FROM book_prices WHERE price = 900 AND kind = 'MRP') = 1,
  (SELECT count(*)::TEXT FROM book_prices WHERE price = 900 AND kind = 'MRP'));

SELECT t('10. ...as USER_PROVISIONAL',
  (SELECT evidence_tier FROM book_prices WHERE price = 900 AND kind = 'MRP') = 'USER_PROVISIONAL',
  (SELECT evidence_tier::TEXT FROM book_prices WHERE price = 900 AND kind = 'MRP'));

SELECT t('11. ...and it does NOT produce a price for a book with no verified MRP',
  (b).reference_price IS NULL AND (b).methodology = 'INSUFFICIENT_DATA',
  coalesce((b).reference_price::TEXT,'NULL') || '/' || (b).methodology)
FROM (SELECT compute_price_band((SELECT bare FROM fx),'TRADE_PAPERBACK','PUBLISHER','GOOD') AS b) s;

SELECT t('12. ...and the band says the claim is being held, rather than silently dropping it',
  array_to_string((b).notes,' ') LIKE '%provisional%',
  array_to_string((b).notes,' '))
FROM (SELECT compute_price_band((SELECT bare FROM fx),'TRADE_PAPERBACK','PUBLISHER','GOOD') AS b) s;

SELECT t('13. The listing response tells the reader their MRP is provisional',
  (r->>'mrp_claim_status') = 'provisional', r::TEXT)
FROM (SELECT validate_and_record_listing('C2','a@x.com','9780143417880',
        'TRADE_PAPERBACK','PUBLISHER','GOOD', NULL, 950, 'https://drive/y.jpg') AS r) s;

-- An inflated provisional claim must not raise the band of a book that DOES
-- have a verified MRP. This is the manipulation the hierarchy prevents.
SELECT t('14. A verified Rs.400 MRP gives a Good band of 45-60%',
  (b).lower_boundary = 180 AND (b).upper_boundary = 240,
  (b).lower_boundary || '-' || (b).upper_boundary)
FROM (SELECT compute_price_band((SELECT ed FROM fx),'TRADE_PAPERBACK','PUBLISHER','GOOD') AS b) s;

SELECT validate_and_record_listing('C3','a@x.com','9789390085255',
  'TRADE_PAPERBACK','PUBLISHER','GOOD', NULL, 4000, NULL);

SELECT t('15. A reader claiming Rs.4000 on that book does not move the band at all',
  (b).lower_boundary = 180 AND (b).upper_boundary = 240,
  (b).lower_boundary || '-' || (b).upper_boundary)
FROM (SELECT compute_price_band((SELECT ed FROM fx),'TRADE_PAPERBACK','PUBLISHER','GOOD') AS b) s;

SELECT t('13b. A second identical claim on the same day is deduplicated, so a '
      || 'reader cannot manufacture a sample size by resubmitting',
  (SELECT count(*) FROM book_prices
    WHERE edition_id = (SELECT bare FROM fx) AND kind = 'MRP' AND price = 900) = 1,
  (SELECT count(*)::TEXT FROM book_prices
    WHERE edition_id = (SELECT bare FROM fx) AND kind = 'MRP' AND price = 900));

-- The consequence of 2/2b, stated end to end: an untiered MRP sitting in the
-- table alongside a reader's claim still leaves the book unpriceable.
SELECT t('15b. Neither the untiered MRP nor the reader claim makes the book priceable',
  (b).reference_price IS NULL AND (b).methodology = 'INSUFFICIENT_DATA',
  coalesce((b).reference_price::TEXT,'NULL') || '/' || (b).methodology)
FROM (SELECT compute_price_band((SELECT bare FROM fx),'TRADE_PAPERBACK','PUBLISHER','GOOD') AS b) s;

-- Promotion is a human act, and it does change the price.
SELECT verify_mrp_from_photo(
  (SELECT id FROM book_prices WHERE price = 950 AND kind = 'MRP' LIMIT 1),
  'swapsutra@gmail.com', 500);

SELECT t('16. An admin confirming the photo promotes the claim to PHOTO_VERIFIED',
  (SELECT evidence_tier FROM book_prices WHERE price = 500 AND kind = 'MRP') = 'PHOTO_VERIFIED',
  coalesce((SELECT evidence_tier::TEXT FROM book_prices WHERE price = 500 AND kind = 'MRP'),'no row'));

SELECT t('17. ...and the edition now has a verified MRP',
  (SELECT mrp_inr = 500 AND mrp_evidence_tier = 'PHOTO_VERIFIED'
     FROM editions WHERE id = (SELECT photo FROM fx)),
  (SELECT coalesce(mrp_inr::TEXT,'NULL') || '/' || coalesce(mrp_evidence_tier::TEXT,'NULL')
     FROM editions WHERE id = (SELECT photo FROM fx)));

SELECT t('18. ...so the book is now priceable, having been unpriceable before',
  (b).reference_price IS NOT NULL,
  coalesce((b).reference_price::TEXT,'NULL'))
FROM (SELECT compute_price_band((SELECT photo FROM fx),'TRADE_PAPERBACK','PUBLISHER','GOOD') AS b) s;


-- ══════════════════════════ B. THE CORRECTIONS DID NOT MOVE THE BEHAVIOUR
\echo ''
\echo '--- the MRP cap still holds, now as a stated platform policy ---'

INSERT INTO book_prices (edition_id, isbn13, format, kind, price, source, evidence_tier)
SELECT ed, '9789390085255', 'TRADE_PAPERBACK', 'NEW_RETAIL', 2000, 'ADMIN_MANUAL', NULL FROM fx;
INSERT INTO book_prices (edition_id, isbn13, format, kind, price, source, evidence_tier, collected_at)
SELECT ed, '9789390085255', 'TRADE_PAPERBACK', 'NEW_RETAIL', 2200, 'ADMIN_MANUAL', NULL,
       now() - interval '1 day' FROM fx;

SELECT t('19. Even with new-retail prices far above it, the band is capped at the MRP',
  (b).upper_boundary <= 400, (b).upper_boundary::TEXT)
FROM (SELECT compute_price_band((SELECT ed FROM fx),'TRADE_PAPERBACK','PUBLISHER','AS_NEW') AS b) s;

SELECT t('20. A NEW_RETAIL observation needs no evidence tier — it is a selling '
      || 'price, not an MRP claim, so the hierarchy does not apply to it',
  (SELECT count(*) FROM book_prices WHERE kind = 'NEW_RETAIL') = 2);

\echo ''
\echo '--- an unauthorised copy is still excluded, structurally ---'

SELECT t('21. No price is computed for one',
  (b).reference_price IS NULL AND (b).methodology = 'INSUFFICIENT_DATA')
FROM (SELECT compute_price_band((SELECT unof FROM fx),'TRADE_PAPERBACK','UNOFFICIAL','GOOD') AS b) s;

SELECT must_fail(
  $q$INSERT INTO book_price_boundaries
      (edition_id, format, edition_tier, condition, lower_boundary, reference_price,
       upper_boundary, deposit_basis, methodology, confidence, next_review_date)
     SELECT unof,'TRADE_PAPERBACK','UNOFFICIAL','GOOD',50,80,120,48,
            'CATEGORY_PRIOR',0.4,'2026-12-01' FROM fx$q$,
  '22. The database refuses to store a price band for one');

SELECT t('23. SELL is refused',
  (r->>'error') = 'UNOFFICIAL_NOT_SALEABLE')
FROM (SELECT validate_and_record_listing('C4','a@x.com','9780000098880',
        'TRADE_PAPERBACK','UNOFFICIAL','GOOD', 150) AS r) s;

SELECT must_fail(
  $q$INSERT INTO listing_prices (listing_id, edition_id, isbn13, owner_email, format,
                                 edition_tier, condition, sell_price)
     SELECT 'C5', unof, '9780000098880', 'a@x.com', 'TRADE_PAPERBACK',
            'UNOFFICIAL', 'GOOD', 150 FROM fx$q$,
  '24. ...and the listing table refuses a price on one too, independently');

SELECT t('25. Declaring one without a price still works — honesty is not punished',
  (r->>'ok')::BOOLEAN AND NOT (r->>'priceable')::BOOLEAN)
FROM (SELECT validate_and_record_listing('C6','a@x.com','9780000098880',
        'TRADE_PAPERBACK','UNOFFICIAL','GOOD', NULL) AS r) s;

\echo ''
\echo '--- the deposit still cannot be moved by the seller ---'

SELECT validate_and_record_listing('C7','low@x.com','9789390085255',
  'TRADE_PAPERBACK','PUBLISHER','GOOD', 180);
SELECT validate_and_record_listing('C8','high@x.com','9789390085255',
  'TRADE_PAPERBACK','PUBLISHER','GOOD', 240);

SELECT t('26. Listing at the floor and the ceiling gives an identical deposit',
  (SELECT deposit_amount FROM listing_prices WHERE listing_id='C7')
  = (SELECT deposit_amount FROM listing_prices WHERE listing_id='C8'),
  (SELECT deposit_amount::TEXT FROM listing_prices WHERE listing_id='C7') || ' vs ' ||
  (SELECT deposit_amount::TEXT FROM listing_prices WHERE listing_id='C8'));

SELECT t('27. ...even though the listing prices differ by a third',
  (SELECT sell_price FROM listing_prices WHERE listing_id='C7') = 180
  AND (SELECT sell_price FROM listing_prices WHERE listing_id='C8') = 240);

SELECT t('28. The deposit equals 60% of the reference value, not of either price',
  (SELECT deposit_amount = round(reference_price * cfg('DEPOSIT_RATE') / 5) * 5
     FROM listing_prices WHERE listing_id = 'C7'));


-- ═══════════════════════════ C. NO LEGAL CLAIM IS ENCODED AS LOGIC
\echo ''
\echo '--- the cap and the exclusion are policy, not statute ---'

-- The cap is a configurable platform decision, reachable and changeable
-- without touching code. A rule justified by law would not be a config row.
SELECT t('29. The deposit rate is a configuration row, not a constant',
  (SELECT count(*) FROM pricing_config WHERE key = 'DEPOSIT_RATE') = 1);

SELECT t('30. The condition ladder is data, so the multipliers are not scattered in code',
  (SELECT count(*) FROM condition_price_ladder) = 5);

-- No column, constraint or function name in the pricing schema asserts a
-- statutory basis. If one appeared, this would catch it.
SELECT t('31. No pricing object is named after a statute or a legal conclusion',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('book_prices','book_price_boundaries','editions',
                          'listing_prices','pricing_config','price_overrides')
       AND (column_name ILIKE '%legal%' OR column_name ILIKE '%statut%'
            OR column_name ILIKE '%safe_harbo%')));

SELECT t('32. ...and no such function name either',
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname ILIKE '%legal%' OR p.proname ILIKE '%statut%')));

-- The explanation a reader sees must describe the estimate honestly and must
-- not present it as an observed market value.
SELECT t('33. An MRP-derived quote calls itself an estimate, not a market price',
  q->>'explanation' LIKE '%estimate%'
  AND q->>'explanation' NOT ILIKE '%market price%'
  AND q->>'explanation' NOT ILIKE '%true value%',
  q->>'explanation')
FROM (SELECT price_quote('9789390085255','TRADE_PAPERBACK','PUBLISHER','FAIR') AS q) s;

SELECT t('34. The quote separates the allowed range, the reference value and the deposit',
  q ? 'sell' AND q ? 'reference_price' AND q ? 'deposit'
  AND (q->'sell') ? 'allowed_min' AND (q->'sell') ? 'allowed_max')
FROM (SELECT price_quote('9789390085255','TRADE_PAPERBACK','PUBLISHER','GOOD') AS q) s;

SELECT t('35. The three are genuinely different numbers, not aliases',
  (q->'sell'->>'allowed_min')::NUMERIC <> (q->>'reference_price')::NUMERIC
  AND (q->>'reference_price')::NUMERIC <> (q->>'deposit')::NUMERIC,
  (q->'sell'->>'allowed_min') || '/' || (q->>'reference_price') || '/' || (q->>'deposit'))
FROM (SELECT price_quote('9789390085255','TRADE_PAPERBACK','PUBLISHER','GOOD') AS q) s;

\pset tuples_only off
ROLLBACK;
