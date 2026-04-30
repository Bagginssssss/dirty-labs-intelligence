ALTER TABLE sp_campaign_performance
ADD COLUMN IF NOT EXISTS last_year_impressions integer,
ADD COLUMN IF NOT EXISTS last_year_clicks       integer,
ADD COLUMN IF NOT EXISTS last_year_spend        decimal(10,2),
ADD COLUMN IF NOT EXISTS last_year_cpc          decimal(10,4),
ADD COLUMN IF NOT EXISTS program_type           text,
ADD COLUMN IF NOT EXISTS status                 text,
ADD COLUMN IF NOT EXISTS budget_amount          decimal(10,2),
ADD COLUMN IF NOT EXISTS targeting_type         text,
ADD COLUMN IF NOT EXISTS bidding_strategy       text;
