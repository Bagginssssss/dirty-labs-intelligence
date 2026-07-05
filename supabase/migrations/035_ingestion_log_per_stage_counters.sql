-- 035: per-stage ingest counters (INB-68). Additive + nullable: historical rows
-- genuinely have no value (NULL = "not recorded"); new ingests populate both.
-- Target identity for new rows: rows_stored = rows_mapped - rows_deduplicated - rows_rejected.

ALTER TABLE report_ingestion_log
  ADD COLUMN rows_mapped integer,
  ADD COLUMN rows_deduplicated integer;

COMMENT ON COLUMN report_ingestion_log.rows_mapped IS
  'Row count AFTER the report mapper, before dedup/validation/storage. Differs from rows_received when the mapper reshapes: < received = collapse (e.g. SmartScout variation rollup), > received = expansion (e.g. keyword-rank date-column unpivot). NULL = ingested before INB-68 (not recorded).';

COMMENT ON COLUMN report_ingestion_log.rows_deduplicated IS
  'Mapped rows collapsed by UPLOAD-WIDE last-occurrence-wins dedup on the table''s upsert natural key (INB-68; replaces the per-500-row-batch count from INB-108, which missed cross-batch duplicates). Identity for new rows: rows_stored = rows_mapped - rows_deduplicated - rows_rejected. NULL = not recorded.';
