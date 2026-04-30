ALTER TABLE scale_insights_keyword_rank
DROP COLUMN IF EXISTS organic_rank,
DROP COLUMN IF EXISTS sponsored_rank;
