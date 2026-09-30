-- ════════════════════════════════════════════════════════════════════════
-- 007 — INSIDE THE BOOK: A PHOTO **OR** A VIDEO
--
-- Migration 006 required all four media. This narrows that to three
-- requirements:
--
--   front cover                         required
--   inside the book (photo OR video)    required, either one
--   back cover                          required
--
-- The reason is that the two inside items were asking for the same
-- evidence twice. A photograph of a page and a clip flipping through the
-- pages both answer "what does the inside of this copy actually look
-- like", and a reader who has answered it once has answered it.
--
-- What this is NOT is "any three of the four". A listing holding a front
-- cover, an inside photo and an inside video has no back cover and is
-- still incomplete — which is exactly the failure a count cannot express,
-- and the reason the condition below is written as three clauses rather
-- than a total.
--
--   psql -d <db> -f sql/007_inside_media_either.sql
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- A generated column's expression cannot be altered in place, so it is
-- dropped and rebuilt. Nothing is lost: the value was always derived from
-- the four media columns, which are untouched.
ALTER TABLE listing_prices DROP COLUMN IF EXISTS media_complete;

ALTER TABLE listing_prices
  ADD COLUMN media_complete BOOLEAN
  GENERATED ALWAYS AS (
    front_cover_image IS NOT NULL AND front_cover_image <> ''
    AND back_cover_image IS NOT NULL AND back_cover_image <> ''
    AND (
      (internal_book_image IS NOT NULL AND internal_book_image <> '')
      OR
      (internal_book_video IS NOT NULL AND internal_book_video <> '')
    )
  ) STORED;

COMMENT ON COLUMN listing_prices.media_complete IS
  'Both covers, plus at least one of the two inside items. Generated, so '
  'nothing can mark a listing complete while a requirement is unmet — the '
  'flag has no setter at all.';

COMMIT;
