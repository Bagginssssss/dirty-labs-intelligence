-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. brands
-- ============================================================
CREATE TABLE brands (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  text NOT NULL,
  amazon_seller_id      text,
  amazon_ads_profile_id text,
  business_context      jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brands_amazon_seller_id ON brands (amazon_seller_id);

-- ============================================================
-- 2. asins
-- ============================================================
CREATE TABLE asins (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id     uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  asin         text NOT NULL,
  parent_asin  text,
  title        text,
  product_line text,
  price        decimal(10, 2),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_asins_brand_id ON asins (brand_id);
CREATE INDEX idx_asins_asin     ON asins (asin);

-- ============================================================
-- 3. campaigns
-- ============================================================
CREATE TABLE campaigns (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id         uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  campaign_id      text NOT NULL,
  campaign_name    text,
  portfolio_name   text,
  ad_type          text,
  targeting_type   text,
  status           text,
  daily_budget     decimal(10, 2),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_brand_id    ON campaigns (brand_id);
CREATE INDEX idx_campaigns_campaign_id ON campaigns (campaign_id);

-- ============================================================
-- 4. ad_groups
-- ============================================================
CREATE TABLE ad_groups (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  ad_group_id   text NOT NULL,
  ad_group_name text,
  default_bid   decimal(10, 4),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_groups_campaign_id ON ad_groups (campaign_id);

-- ============================================================
-- 5. sp_search_term_report
-- ============================================================
CREATE TABLE sp_search_term_report (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id               uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  campaign_id            uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  ad_group_id            uuid NOT NULL REFERENCES ad_groups (id) ON DELETE CASCADE,
  report_date            date NOT NULL,
  customer_search_term   text,
  targeting              text,
  match_type             text,
  ad_type                text,
  impressions            integer,
  clicks                 integer,
  ctr                    decimal(10, 6),
  cpc                    decimal(10, 4),
  spend                  decimal(10, 2),
  sales_7d               decimal(10, 2),
  acos                   decimal(10, 6),
  roas                   decimal(10, 4),
  orders_7d              integer,
  units_7d               integer,
  cvr                    decimal(10, 6),
  advertised_sku_units   integer,
  other_sku_units        integer,
  advertised_sku_sales   decimal(10, 2),
  other_sku_sales        decimal(10, 2),
  video_views            integer,
  view_through_rate      decimal(10, 6),
  five_second_views      integer,
  ingested_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sp_str_brand_id    ON sp_search_term_report (brand_id);
CREATE INDEX idx_sp_str_campaign_id ON sp_search_term_report (campaign_id);
CREATE INDEX idx_sp_str_report_date ON sp_search_term_report (report_date);

-- ============================================================
-- 6. sp_targeting_report
-- ============================================================
CREATE TABLE sp_targeting_report (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id             uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  campaign_id          uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  ad_group_id          uuid NOT NULL REFERENCES ad_groups (id) ON DELETE CASCADE,
  report_date          date NOT NULL,
  targeting            text,
  match_type           text,
  ad_type              text,
  impressions          integer,
  top_of_search_is     decimal(10, 6),
  clicks               integer,
  ctr                  decimal(10, 6),
  cpc                  decimal(10, 4),
  spend                decimal(10, 2),
  acos                 decimal(10, 6),
  roas                 decimal(10, 4),
  sales_7d             decimal(10, 2),
  orders_7d            integer,
  units_7d             integer,
  cvr                  decimal(10, 6),
  advertised_sku_units integer,
  other_sku_units      integer,
  advertised_sku_sales decimal(10, 2),
  other_sku_sales      decimal(10, 2),
  ingested_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sp_tr_brand_id    ON sp_targeting_report (brand_id);
CREATE INDEX idx_sp_tr_campaign_id ON sp_targeting_report (campaign_id);
CREATE INDEX idx_sp_tr_report_date ON sp_targeting_report (report_date);

-- ============================================================
-- 7. sp_campaign_performance
-- ============================================================
CREATE TABLE sp_campaign_performance (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id    uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  report_date date NOT NULL,
  ad_type     text,
  impressions integer,
  clicks      integer,
  ctr         decimal(10, 6),
  cpc         decimal(10, 4),
  spend       decimal(10, 2),
  sales_7d    decimal(10, 2),
  acos        decimal(10, 6),
  roas        decimal(10, 4),
  orders_7d   integer,
  units_7d    integer,
  cvr         decimal(10, 6),
  ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sp_cp_brand_id    ON sp_campaign_performance (brand_id);
CREATE INDEX idx_sp_cp_campaign_id ON sp_campaign_performance (campaign_id);
CREATE INDEX idx_sp_cp_report_date ON sp_campaign_performance (report_date);

-- ============================================================
-- 8. business_report
-- ============================================================
CREATE TABLE business_report (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id                uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  asin_id                 uuid NOT NULL REFERENCES asins (id) ON DELETE CASCADE,
  report_date             date NOT NULL,
  sessions_total          integer,
  sessions_mobile         integer,
  sessions_browser        integer,
  session_pct             decimal(10, 6),
  page_views_total        integer,
  page_views_pct          decimal(10, 6),
  buy_box_pct             decimal(10, 6),
  units_ordered           integer,
  unit_session_pct        decimal(10, 6),
  ordered_product_sales   decimal(10, 2),
  total_order_items       integer,
  units_refunded          integer,
  refund_rate             decimal(10, 6),
  shipped_product_sales   decimal(10, 2),
  units_shipped           integer,
  ingested_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_br_brand_id    ON business_report (brand_id);
CREATE INDEX idx_br_asin_id     ON business_report (asin_id);
CREATE INDEX idx_br_report_date ON business_report (report_date);

-- ============================================================
-- 9. purchased_product_report
-- ============================================================
CREATE TABLE purchased_product_report (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id         uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  campaign_id      uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  report_date      date NOT NULL,
  advertised_asin  text,
  purchased_asin   text,
  purchased_title  text,
  orders_7d        integer,
  units_7d         integer,
  sales_7d         decimal(10, 2),
  ingested_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ppr_brand_id    ON purchased_product_report (brand_id);
CREATE INDEX idx_ppr_campaign_id ON purchased_product_report (campaign_id);
CREATE INDEX idx_ppr_report_date ON purchased_product_report (report_date);

-- ============================================================
-- 10. scale_insights_bid_log
-- ============================================================
CREATE TABLE scale_insights_bid_log (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id         uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  campaign_id      uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  ad_group_id      uuid NOT NULL REFERENCES ad_groups (id) ON DELETE CASCADE,
  change_timestamp timestamptz,
  target           text,
  match_type       text,
  bid_before       decimal(10, 4),
  bid_after        decimal(10, 4),
  rule_name        text,
  rule_trigger     text,
  change_reason    text,
  ingested_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sibl_brand_id    ON scale_insights_bid_log (brand_id);
CREATE INDEX idx_sibl_campaign_id ON scale_insights_bid_log (campaign_id);

-- ============================================================
-- 11. scale_insights_keyword_rank
-- ============================================================
CREATE TABLE scale_insights_keyword_rank (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id       uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  asin_id        uuid NOT NULL REFERENCES asins (id) ON DELETE CASCADE,
  report_date    date NOT NULL,
  keyword        text,
  organic_rank   integer,
  sponsored_rank integer,
  search_volume  integer,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sikr_brand_id    ON scale_insights_keyword_rank (brand_id);
CREATE INDEX idx_sikr_asin_id     ON scale_insights_keyword_rank (asin_id);
CREATE INDEX idx_sikr_report_date ON scale_insights_keyword_rank (report_date);

-- ============================================================
-- 12. subscribe_and_save
-- ============================================================
CREATE TABLE subscribe_and_save (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id             uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  asin_id              uuid NOT NULL REFERENCES asins (id) ON DELETE CASCADE,
  report_date          date NOT NULL,
  active_subscriptions integer,
  new_subscriptions    integer,
  cancelled_subscriptions integer,
  ss_units_shipped     integer,
  ss_revenue           decimal(10, 2),
  ss_discount_amount   decimal(10, 2),
  reorder_rate         decimal(10, 6),
  ingested_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sns_brand_id    ON subscribe_and_save (brand_id);
CREATE INDEX idx_sns_asin_id     ON subscribe_and_save (asin_id);
CREATE INDEX idx_sns_report_date ON subscribe_and_save (report_date);

-- ============================================================
-- 13. smartscout_share_of_voice
-- ============================================================
CREATE TABLE smartscout_share_of_voice (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id         uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  report_date      date NOT NULL,
  keyword          text,
  brand_name       text,
  impression_share decimal(10, 6),
  click_share      decimal(10, 6),
  search_volume    integer,
  ingested_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ssov_brand_id    ON smartscout_share_of_voice (brand_id);
CREATE INDEX idx_ssov_report_date ON smartscout_share_of_voice (report_date);

-- ============================================================
-- 14. smartscout_brand_revenue
-- ============================================================
CREATE TABLE smartscout_brand_revenue (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id           uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  report_date        date NOT NULL,
  competitor_brand   text,
  estimated_revenue  decimal(14, 2),
  estimated_units    decimal(14, 2),
  market_share_pct   decimal(10, 6),
  category           text,
  ingested_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ssbr_brand_id    ON smartscout_brand_revenue (brand_id);
CREATE INDEX idx_ssbr_report_date ON smartscout_brand_revenue (report_date);

-- ============================================================
-- 15. derived_metrics_daily
-- ============================================================
CREATE TABLE derived_metrics_daily (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id                uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  metric_date             date NOT NULL,
  total_ppc_spend         decimal(10, 2),
  total_ppc_sales         decimal(10, 2),
  blended_roas            decimal(10, 4),
  sp_roas                 decimal(10, 4),
  sb_roas                 decimal(10, 4),
  total_revenue           decimal(10, 2),
  organic_revenue         decimal(10, 2),
  mer                     decimal(10, 6),
  ntb_orders              integer,
  ntb_rate                decimal(10, 6),
  total_orders            integer,
  aov                     decimal(10, 2),
  cac                     decimal(10, 4),
  total_clicks            integer,
  total_impressions       integer,
  account_cvr             decimal(10, 6),
  new_customer_pct        decimal(10, 6),
  returning_customer_pct  decimal(10, 6),
  ss_active_subscriptions integer,
  ss_new_subscriptions    integer,
  ss_revenue              decimal(10, 2),
  ss_revenue_pct_of_total decimal(10, 6),
  calculated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_derived_metrics_daily UNIQUE (brand_id, metric_date)
);

CREATE INDEX idx_dmd_brand_id    ON derived_metrics_daily (brand_id);
CREATE INDEX idx_dmd_metric_date ON derived_metrics_daily (metric_date);

-- ============================================================
-- 16. derived_metrics_weekly
-- ============================================================
CREATE TABLE derived_metrics_weekly (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id           uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  week_start         date NOT NULL,
  week_end           date NOT NULL,
  total_ppc_spend    decimal(10, 2),
  total_ppc_sales    decimal(10, 2),
  blended_roas       decimal(10, 4),
  total_revenue      decimal(10, 2),
  organic_revenue    decimal(10, 2),
  mer                decimal(10, 6),
  ntb_rate           decimal(10, 6),
  aov                decimal(10, 2),
  cac                decimal(10, 4),
  spend_pacing_gap   decimal(10, 2),
  revenue_pacing_gap decimal(10, 2),
  calculated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_derived_metrics_weekly UNIQUE (brand_id, week_start)
);

CREATE INDEX idx_dmw_brand_id   ON derived_metrics_weekly (brand_id);
CREATE INDEX idx_dmw_week_start ON derived_metrics_weekly (week_start);

-- ============================================================
-- 17. derived_asin_metrics_daily
-- ============================================================
CREATE TABLE derived_asin_metrics_daily (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id              uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  asin_id               uuid NOT NULL REFERENCES asins (id) ON DELETE CASCADE,
  metric_date           date NOT NULL,
  sessions              integer,
  page_views            integer,
  buy_box_pct           decimal(10, 6),
  units_ordered         integer,
  cvr                   decimal(10, 6),
  ordered_product_sales decimal(10, 2),
  ppc_spend             decimal(10, 2),
  ppc_sales             decimal(10, 2),
  asin_roas             decimal(10, 4),
  organic_sales         decimal(10, 2),
  organic_pct           decimal(10, 6),
  refund_rate           decimal(10, 6),
  ss_units              integer,
  ss_revenue            decimal(10, 2),
  calculated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_damd_brand_id    ON derived_asin_metrics_daily (brand_id);
CREATE INDEX idx_damd_asin_id     ON derived_asin_metrics_daily (asin_id);
CREATE INDEX idx_damd_metric_date ON derived_asin_metrics_daily (metric_date);

-- ============================================================
-- 18. goals
-- ============================================================
CREATE TABLE goals (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id     uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  metric_name  text NOT NULL,
  period_type  text,
  period_start date,
  period_end   date,
  target_value decimal(14, 4),
  unit         text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_goals_brand_id ON goals (brand_id);

-- ============================================================
-- 19. report_ingestion_log
-- ============================================================
CREATE TABLE report_ingestion_log (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id          uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  report_type       text NOT NULL,
  source_platform   text,
  date_range_start  date,
  date_range_end    date,
  rows_received     integer,
  rows_stored       integer,
  rows_rejected     integer,
  status            text,
  error_message     text,
  ingestion_method  text,
  ingested_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ril_brand_id    ON report_ingestion_log (brand_id);
CREATE INDEX idx_ril_ingested_at ON report_ingestion_log (ingested_at);
CREATE INDEX idx_ril_report_type ON report_ingestion_log (report_type);
