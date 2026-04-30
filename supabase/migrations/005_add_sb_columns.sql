ALTER TABLE sp_search_term_report
ADD COLUMN IF NOT EXISTS viewable_impressions integer,
ADD COLUMN IF NOT EXISTS vcpm               decimal(10,4),
ADD COLUMN IF NOT EXISTS cost_type          text,
ADD COLUMN IF NOT EXISTS attribution_window integer,
ADD COLUMN IF NOT EXISTS acos_click         decimal(10,6),
ADD COLUMN IF NOT EXISTS roas_click         decimal(10,4),
ADD COLUMN IF NOT EXISTS sales_click        decimal(14,2),
ADD COLUMN IF NOT EXISTS orders_click       integer,
ADD COLUMN IF NOT EXISTS units_click        integer;
