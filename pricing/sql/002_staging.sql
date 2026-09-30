-- ══════════════════════════════════════════════════════════════════════════
-- Bulk-load staging, and the merge into the live catalogue.
--
-- WHY A STAGING TABLE AND NOT A DIRECT COPY
-- The dump gives Open Library KEYS ('/works/OL27448W'); the catalogue uses
-- integer foreign keys. Those cannot be reconciled row by row during a COPY,
-- and resolving them with a per-row lookup across ~50M editions is the
-- difference between an hour and a week.
--
-- So: COPY into an unconstrained, unindexed staging table at full speed,
-- then resolve keys to ids in two set-based statements. This also gives the
-- run an abort point — a bad dump can be inspected and thrown away without
-- ever having touched the table the app reads.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS staging_editions;

CREATE UNLOGGED TABLE staging_editions (
  ol_edition_key       TEXT,
  ol_work_key          TEXT,
  isbn13               TEXT,
  isbn10               TEXT,
  title                TEXT,
  subtitle             TEXT,
  authors              TEXT,
  publisher            TEXT,
  publisher_normalised TEXT,
  publication_year     INTEGER,
  edition_name         TEXT,
  format               TEXT,
  edition_tier         TEXT,
  language             TEXT,
  page_count           INTEGER,
  cover_id             INTEGER,
  title_normalised     TEXT,
  source_records       TEXT,
  is_canonical         BOOLEAN
);

-- UNLOGGED and index-free on purpose: this table is written once, read once,
-- and dropped. Paying for WAL and index maintenance on 50M throwaway rows is
-- the single largest avoidable cost in the whole ingest.

COMMIT;


-- ══════════════════════════════════════════════════════════════ THE MERGE

CREATE OR REPLACE FUNCTION merge_staged_editions()
RETURNS TABLE (step TEXT, rows_affected BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  n BIGINT;
BEGIN
  -- 1. Works, from the distinct work keys the staged editions reference.
  --    Title comes from the canonical edition of each work, which is the
  --    best title available without also ingesting the works dump.
  INSERT INTO works (ol_work_key, title, title_normalised)
  SELECT DISTINCT ON (s.ol_work_key)
         s.ol_work_key, s.title, s.title_normalised
  FROM staging_editions s
  WHERE s.ol_work_key IS NOT NULL AND s.ol_work_key <> ''
  ORDER BY s.ol_work_key, s.is_canonical DESC, s.ol_edition_key
  ON CONFLICT (ol_work_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  step := 'works_inserted'; rows_affected := n; RETURN NEXT;

  -- 2. Editions, with the work key resolved to an id.
  --    ON CONFLICT on ol_edition_key makes the whole ingest idempotent:
  --    re-running last month's dump updates rows rather than duplicating
  --    them, which matters because the monthly dump is mostly the same data.
  INSERT INTO editions (
    ol_edition_key, work_id, isbn13, isbn10, title, subtitle, authors,
    publisher, publisher_normalised, publication_year, edition_name,
    format, edition_tier, language, page_count, cover_id, is_canonical, source
  )
  SELECT s.ol_edition_key,
         w.id,
         NULLIF(s.isbn13, ''),
         NULLIF(s.isbn10, ''),
         s.title,
         NULLIF(s.subtitle, ''),
         COALESCE(string_to_array(NULLIF(btrim(s.authors, '{}'), ''), ','), '{}'),
         NULLIF(s.publisher, ''),
         NULLIF(s.publisher_normalised, ''),
         s.publication_year,
         NULLIF(s.edition_name, ''),
         s.format::book_format,
         s.edition_tier::book_edition_tier,
         NULLIF(s.language, ''),
         s.page_count,
         s.cover_id,
         s.is_canonical,
         NULL::price_source_kind
  FROM staging_editions s
  LEFT JOIN works w ON w.ol_work_key = s.ol_work_key
  WHERE s.isbn13 IS NOT NULL AND s.isbn13 <> ''
  -- The WHERE clause is not decoration. editions_ol_key_uniq is a PARTIAL
  -- unique index, and Postgres will only infer a partial index for
  -- ON CONFLICT when the statement repeats the index predicate verbatim.
  -- Without it: "there is no unique or exclusion constraint matching the
  -- ON CONFLICT specification", at merge time rather than at deploy time.
  ON CONFLICT (ol_edition_key) WHERE ol_edition_key IS NOT NULL DO UPDATE SET
    work_id          = EXCLUDED.work_id,
    title            = EXCLUDED.title,
    publisher        = EXCLUDED.publisher,
    publication_year = EXCLUDED.publication_year,
    format           = EXCLUDED.format,
    edition_tier     = EXCLUDED.edition_tier,
    page_count       = EXCLUDED.page_count,
    cover_id         = EXCLUDED.cover_id,
    is_canonical     = EXCLUDED.is_canonical,
    updated_at       = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  step := 'editions_upserted'; rows_affected := n; RETURN NEXT;

  RETURN;
END $$;

-- ON CONFLICT (ol_edition_key) needs a unique constraint to conflict on.
CREATE UNIQUE INDEX IF NOT EXISTS editions_ol_key_uniq
  ON editions (ol_edition_key) WHERE ol_edition_key IS NOT NULL;
