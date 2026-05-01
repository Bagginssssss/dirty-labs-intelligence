-- Episodic memory: findings, decisions, and weekly briefings
CREATE TABLE IF NOT EXISTS platform_insights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  insight_type    text NOT NULL,
  severity        text NOT NULL DEFAULT 'info',
  title           text NOT NULL,
  content         text NOT NULL,
  supporting_data jsonb,
  actioned        boolean NOT NULL DEFAULT false,
  actioned_at     timestamptz,
  actioned_notes  text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pi_brand_id    ON platform_insights(brand_id);
CREATE INDEX IF NOT EXISTS idx_pi_created_at  ON platform_insights(created_at);
CREATE INDEX IF NOT EXISTS idx_pi_insight_type ON platform_insights(insight_type);
ALTER TABLE platform_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON platform_insights FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Semantic memory: persistent facts that emerge from data analysis
CREATE TABLE IF NOT EXISTS platform_knowledge (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  category   text NOT NULL,
  key        text NOT NULL,
  value      text NOT NULL,
  confidence text NOT NULL DEFAULT 'probable',
  source     text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_platform_knowledge UNIQUE (brand_id, category, key)
);

CREATE INDEX IF NOT EXISTS idx_pk_brand_id ON platform_knowledge(brand_id);
CREATE INDEX IF NOT EXISTS idx_pk_category ON platform_knowledge(category);
ALTER TABLE platform_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON platform_knowledge FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Prospective memory: active monitoring items with trigger conditions
CREATE TABLE IF NOT EXISTS platform_watchlist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  watch_type      text NOT NULL,
  entity_id       text,
  entity_name     text NOT NULL,
  metric          text NOT NULL,
  threshold       decimal(14,4),
  direction       text NOT NULL DEFAULT 'below',
  status          text NOT NULL DEFAULT 'active',
  notes           text,
  last_checked_at timestamptz,
  triggered_at    timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pw_brand_id   ON platform_watchlist(brand_id);
CREATE INDEX IF NOT EXISTS idx_pw_status     ON platform_watchlist(status);
CREATE INDEX IF NOT EXISTS idx_pw_watch_type ON platform_watchlist(watch_type);
ALTER TABLE platform_watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated ON platform_watchlist FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Extend platform_insights with outcome tracking
ALTER TABLE platform_insights
  ADD COLUMN IF NOT EXISTS outcome_notes     text,
  ADD COLUMN IF NOT EXISTS outcome_positive  boolean;
