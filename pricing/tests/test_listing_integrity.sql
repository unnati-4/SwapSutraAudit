-- Tests for 006_listing_integrity.sql.
--
-- These are constraint tests, and constraint tests are worth writing in a
-- particular way: the interesting assertion is almost always that
-- something is REFUSED. A test that only checks the happy path passes just
-- as well against a table with no constraints at all.
--
--   psql -d <db> -f tests/test_listing_integrity.sql

BEGIN;
\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE OR REPLACE FUNCTION t(label TEXT, cond BOOLEAN, detail TEXT DEFAULT '')
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(cond, FALSE) THEN 'PASS: ' || label
              WHEN cond IS NULL THEN 'FAIL: ' || label || ' (undecidable)'
              ELSE 'FAIL: ' || label
                || CASE WHEN detail <> '' THEN '  [' || detail || ']' ELSE '' END END;
$$;

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

-- A complete, well-formed listing to vary from.
CREATE OR REPLACE FUNCTION mk(p_id TEXT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO listing_prices (
    listing_id, owner_email, format, edition_tier, condition,
    authenticity_status, printed_mrp,
    open_to_sell, open_to_swap, open_to_rent, open_to_lend,
    front_cover_image, internal_book_image, internal_book_video, back_cover_image)
  VALUES (
    p_id, 'reader@example.com', 'TRADE_PAPERBACK', 'PUBLISHER', 'GOOD',
    'ORIGINAL', 500,
    TRUE, TRUE, TRUE, TRUE,
    'https://drive/f.jpg', 'https://drive/i.jpg', 'https://drive/v.mp4', 'https://drive/b.jpg');
$$;

\echo ''
\echo '--- an unauthorised copy carries no valuation ---'

SELECT t('1. Authenticity defaults to UNKNOWN, never ORIGINAL',
  (SELECT column_default FROM information_schema.columns
    WHERE table_name = 'listing_prices' AND column_name = 'authenticity_status')
    LIKE '%UNKNOWN%');

SELECT must_fail($q$
  INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition,
                              authenticity_status, sell_price)
  VALUES ('U1', 'r@x.com', 'TRADE_PAPERBACK', 'UNOFFICIAL', 'GOOD', 'UNAUTHORISED', 200)$q$,
  '2. An unauthorised copy cannot carry a sell price');

SELECT must_fail($q$
  INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition,
                              authenticity_status, reference_price)
  VALUES ('U2', 'r@x.com', 'TRADE_PAPERBACK', 'UNOFFICIAL', 'GOOD', 'UNAUTHORISED', 300)$q$,
  '3. ...nor a reference value');

SELECT must_fail($q$
  INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition,
                              authenticity_status, deposit_amount)
  VALUES ('U3', 'r@x.com', 'TRADE_PAPERBACK', 'UNOFFICIAL', 'GOOD', 'UNAUTHORISED', 180)$q$,
  '4. ...nor a deposit — which is what would let it be transacted at all');

SELECT must_fail($q$
  INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition,
                              authenticity_status, printed_mrp)
  VALUES ('U4', 'r@x.com', 'TRADE_PAPERBACK', 'UNOFFICIAL', 'GOOD', 'UNAUTHORISED', 500)$q$,
  '5. ...nor a printed MRP, which is where rent would come from');

SELECT must_fail($q$
  INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition,
                              authenticity_status, open_to_lend)
  VALUES ('U5', 'r@x.com', 'TRADE_PAPERBACK', 'UNOFFICIAL', 'GOOD', 'UNAUTHORISED', TRUE)$q$,
  '6. ...and it cannot be offered for lending either');

SELECT t('7. An unauthorised copy with nothing attached is still storable',
  (SELECT count(*) FROM (
    SELECT 1 FROM listing_prices WHERE listing_id = 'U6') s) = 0);
INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition,
                            authenticity_status)
VALUES ('U6', 'r@x.com', 'TRADE_PAPERBACK', 'UNOFFICIAL', 'GOOD', 'UNAUTHORISED');
SELECT t('8. ...because declaring one honestly must never be blocked',
  (SELECT count(*) FROM listing_prices WHERE listing_id = 'U6') = 1);

\echo ''
\echo '--- the printed MRP is never zero ---'

SELECT must_fail($q$
  INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition, printed_mrp)
  VALUES ('Z1', 'r@x.com', 'TRADE_PAPERBACK', 'PUBLISHER', 'GOOD', 0)$q$,
  '9. A printed MRP of zero is refused');

SELECT must_fail($q$
  INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition, printed_mrp)
  VALUES ('Z2', 'r@x.com', 'TRADE_PAPERBACK', 'PUBLISHER', 'GOOD', -100)$q$,
  '10. A negative printed MRP is refused');

INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition)
VALUES ('Z3', 'r@x.com', 'TRADE_PAPERBACK', 'PUBLISHER', 'GOOD');
SELECT t('11. An unknown printed MRP is NULL, and that is allowed',
  (SELECT printed_mrp IS NULL FROM listing_prices WHERE listing_id = 'Z3'));

\echo ''
\echo '--- rent is generated, not supplied ---'

SELECT mk('R1');
SELECT t('12. MRP 500 generates a monthly rent of 50',
  (SELECT monthly_rent FROM listing_prices WHERE listing_id = 'R1') = 50.00,
  (SELECT monthly_rent::TEXT FROM listing_prices WHERE listing_id = 'R1'));

UPDATE listing_prices SET printed_mrp = 599 WHERE listing_id = 'R1';
SELECT t('13. MRP 599 generates 59.90',
  (SELECT monthly_rent FROM listing_prices WHERE listing_id = 'R1') = 59.90,
  (SELECT monthly_rent::TEXT FROM listing_prices WHERE listing_id = 'R1'));

-- The rule this column exists to make unbreakable.
SELECT must_fail(
  $q$UPDATE listing_prices SET monthly_rent = 5 WHERE listing_id = 'R1'$q$,
  '14. Nobody can write a monthly rent — not even a direct UPDATE');

SELECT t('15. Raising the sell price does not move the rent',
  (SELECT monthly_rent FROM listing_prices WHERE listing_id = 'R1') = 59.90);
UPDATE listing_prices SET sell_price = 5000 WHERE listing_id = 'R1';
SELECT t('16. ...still not, after the seller asks for 5000',
  (SELECT monthly_rent FROM listing_prices WHERE listing_id = 'R1') = 59.90,
  (SELECT monthly_rent::TEXT FROM listing_prices WHERE listing_id = 'R1'));

SELECT must_fail($q$
  INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition, open_to_rent)
  VALUES ('R2', 'r@x.com', 'TRADE_PAPERBACK', 'PUBLISHER', 'GOOD', TRUE)$q$,
  '17. A book with no printed MRP cannot be offered for rent');

\echo ''
\echo '--- rent and lend are separate columns ---'

INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition,
                            printed_mrp, open_to_rent)
VALUES ('S1', 'r@x.com', 'TRADE_PAPERBACK', 'PUBLISHER', 'GOOD', 400, TRUE);
SELECT t('18. Offering rent leaves lending off',
  (SELECT open_to_rent AND NOT open_to_lend FROM listing_prices WHERE listing_id = 'S1'));

INSERT INTO listing_prices (listing_id, owner_email, format, edition_tier, condition, open_to_lend)
VALUES ('S2', 'r@x.com', 'TRADE_PAPERBACK', 'PUBLISHER', 'GOOD', TRUE);
SELECT t('19. Offering lending leaves rent off, and needs no MRP',
  (SELECT open_to_lend AND NOT open_to_rent FROM listing_prices WHERE listing_id = 'S2'));

SELECT t('20. They are two columns, not one field with two meanings',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'listing_prices'
      AND column_name IN ('open_to_sell','open_to_swap','open_to_rent','open_to_lend')) = 4);

\echo ''
\echo '--- the four media, four columns ---'

SELECT t('21. All four are stored separately',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'listing_prices'
      AND column_name IN ('front_cover_image','internal_book_image',
                          'internal_book_video','back_cover_image')) = 4);

SELECT t('22. A listing with all four reads as complete',
  (SELECT media_complete FROM listing_prices WHERE listing_id = 'R1'));

-- The inside pair is ONE requirement met by either item, so dropping the
-- video while an inside photo remains changes nothing.
UPDATE listing_prices SET internal_book_video = NULL WHERE listing_id = 'R1';
SELECT t('23. Removing the video is fine while an inside photo remains',
  (SELECT media_complete FROM listing_prices WHERE listing_id = 'R1'));

UPDATE listing_prices SET internal_book_image = NULL WHERE listing_id = 'R1';
SELECT t('23b. ...but removing both inside items makes it incomplete',
  (SELECT NOT media_complete FROM listing_prices WHERE listing_id = 'R1'));

UPDATE listing_prices SET internal_book_video = 'https://drive/v.mp4' WHERE listing_id = 'R1';
SELECT t('23c. A video alone satisfies the inside requirement',
  (SELECT media_complete FROM listing_prices WHERE listing_id = 'R1'));

-- Not "any three of four": three items with no back cover is incomplete.
UPDATE listing_prices SET internal_book_image = 'https://drive/i.jpg',
                          back_cover_image = NULL WHERE listing_id = 'R1';
SELECT t('23d. Three items with no back cover is still incomplete',
  (SELECT NOT media_complete FROM listing_prices WHERE listing_id = 'R1'));
UPDATE listing_prices SET back_cover_image = 'https://drive/b.jpg' WHERE listing_id = 'R1';

SELECT t('24. The covers are each their own requirement, not interchangeable',
  (SELECT front_cover_image IS NOT NULL AND back_cover_image IS NOT NULL
     FROM listing_prices WHERE listing_id = 'R1'));

SELECT must_fail(
  $q$UPDATE listing_prices SET media_complete = TRUE WHERE listing_id = 'R1'$q$,
  '25. Nobody can mark a listing media-complete by hand');

SELECT t('26. A complete listing reads as complete',
  (SELECT media_complete FROM listing_prices WHERE listing_id = 'R1'));

UPDATE listing_prices SET back_cover_image = '' WHERE listing_id = 'R1';
SELECT t('27. An empty string is not a photo',
  (SELECT NOT media_complete FROM listing_prices WHERE listing_id = 'R1'));
UPDATE listing_prices SET back_cover_image = 'https://drive/b.jpg' WHERE listing_id = 'R1';

\echo ''
\echo '--- eligibility, answered by the database ---'

SELECT t('28. A complete original listing is eligible for what it offers',
  (SELECT can_sell AND can_swap AND can_rent AND can_lend FROM listing_eligibility('R1')));

SELECT t('29. ...and reports the generated rent, not a stored one',
  (SELECT monthly_rent FROM listing_eligibility('R1')) = 59.90);

SELECT t('30. An unauthorised listing is refused everything',
  (SELECT NOT can_sell AND NOT can_swap AND NOT can_rent AND NOT can_lend
     FROM listing_eligibility('U6')));

SELECT t('31. ...with a reason a person can read',
  (SELECT reason FROM listing_eligibility('U6')) LIKE '%unauthorised%');

UPDATE listing_prices SET front_cover_image = NULL WHERE listing_id = 'R1';
SELECT t('32. An incomplete listing is not transactable at all',
  (SELECT NOT can_sell AND NOT can_rent FROM listing_eligibility('R1')));
SELECT t('33. ...and says a requirement is unmet',
  (SELECT reason FROM listing_eligibility('R1')) LIKE '%required%');
UPDATE listing_prices SET front_cover_image = 'https://drive/f.jpg' WHERE listing_id = 'R1';

SELECT t('34. An unknown listing id is refused rather than assumed eligible',
  (SELECT NOT can_sell AND NOT can_swap AND NOT can_rent AND NOT can_lend
     FROM listing_eligibility('does-not-exist')));

\pset tuples_only off
ROLLBACK;
