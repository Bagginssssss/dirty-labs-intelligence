-- 039: ScaleInsights rule audit layer — change logs + assignment snapshots (INB-148).
--
-- Two tables feeding the rule audit: observed behavior (import/negative/revive
-- rule change logs, rolling-window exports that overlap by design) and expected
-- behavior (weekly account-wide rule-assignment snapshots). Complements
-- scale_insights_bid_log, which is untouched.
--
-- Key normalization (deviation from the ticket's coalesce-expression key, by
-- necessity): PostgREST/supabase-js upsert(onConflict) can only target plain
-- column-list unique constraints, and the INB-88 checker introspects the same.
-- So dedup-key text columns are NOT NULL DEFAULT '' and the mapper normalizes
-- empty → '' — equivalent semantics, plain constraints.
--
-- Reconcile-verified against the real sample files (2026-07-09):
--   * The three change-log exports share a BYTE-IDENTICAL header with
--     BiddingRule_ChangeLogs.csv — detection is content-based on Action (code side).
--   * 0 duplicate keys within any sample file on the chosen change-log key.
--   * Assignments: (campaign, ad_group) unique within each file; Unassigned is an
--     exact subset of Assigned (105 all-rule-columns-empty twins) — is_assigned is
--     content-derived, so the two files commute under the upsert key.
--   * ELEVEN rule-list columns in the Assigned export (ticket said ten but lists
--     eleven): Bidding … Daily Budget.
--   * Empty AdGroup occurs on real SB/SBV rows → '' via the DEFAULT, key stays valid.

-- ── Observed behavior: rule change logs ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scale_insights_rule_change_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid NOT NULL DEFAULT '47a96175-ed58-4104-a2ff-c925d6143309',
  created_date      date NOT NULL,
  log_type          text NOT NULL CHECK (log_type IN ('import', 'negative', 'revive')),
  asin              text,
  sku               text,
  short_name        text,
  campaign          text NOT NULL DEFAULT '',
  ad_group          text NOT NULL DEFAULT '',
  -- Keyword column holds a keyword, a broad-match expression (+dirty +labs), or
  -- an ASIN product target (B0FZXTWWYK).
  keyword_or_target text NOT NULL DEFAULT '',
  rule_name         text NOT NULL DEFAULT '',
  criteria          text,
  -- Raw change text, e.g. '3.74 -> 3.81' (revive), 'exact (1.45)' (import),
  -- '' (negatives — 11/56 empty in the sample).
  change_value      text NOT NULL DEFAULT '',
  code              text,
  details           text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  CONSTRAINT scale_insights_rule_change_log_natural_key UNIQUE
    (brand_id, created_date, log_type, campaign, ad_group, keyword_or_target, rule_name, change_value)
);

CREATE INDEX IF NOT EXISTS idx_si_rule_log_date
  ON public.scale_insights_rule_change_log USING btree (created_date);
CREATE INDEX IF NOT EXISTS idx_si_rule_log_campaign_date
  ON public.scale_insights_rule_change_log USING btree (campaign, created_date);

COMMENT ON TABLE public.scale_insights_rule_change_log IS
  'ScaleInsights import/negative/revive rule change logs (INB-148). Rolling-window exports overlap by design; upsert on the natural key dedupes. Bidding-rule logs live in scale_insights_bid_log.';
COMMENT ON COLUMN public.scale_insights_rule_change_log.change_value IS
  'Raw change text (e.g. ''3.74 -> 3.81'', ''exact (1.45)''). '''' = no change payload (negatives). NOT NULL '''' because it is part of the dedup key.';

-- ── Expected behavior: rule assignment snapshots ────────────────────────────
CREATE TABLE IF NOT EXISTS public.scale_insights_rule_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            uuid NOT NULL DEFAULT '47a96175-ed58-4104-a2ff-c925d6143309',
  snapshot_date       date NOT NULL,
  -- 'Products' / 'Brands' / 'Display' today; no CHECK — SI may add surfaces.
  sponsored_type      text NOT NULL,
  portfolio           text,
  campaign            text NOT NULL DEFAULT '',
  ad_group            text NOT NULL DEFAULT '',
  custom_group        text,
  strategy            text,
  -- Content-derived: at least one rule list non-empty. NOT file-of-origin —
  -- Unassigned is an exact subset of Assigned, so origin is upload-order-dependent.
  is_assigned         boolean NOT NULL,
  bidding_rules       text[],
  import_rules        text[],
  negative_rules      text[],
  negative_word_rules text[],
  blacklist_rules     text[],
  revive_rules        text[],
  status_rules        text[],
  default_bid_rules   text[],
  day_parting_rules   text[],
  placement_rules     text[],
  daily_budget_rules  text[],
  -- Raw unparsed cell text per rule column ({"bidding_rules": "...", ...});
  -- parse-audit trail for the comma-in-rule-name split heuristic. NULL for rows
  -- from the Unassigned export (no rule columns exist there).
  rules_raw           jsonb,
  last_30d_spend      numeric,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT scale_insights_rule_assignments_natural_key UNIQUE
    (brand_id, snapshot_date, campaign, ad_group)
);

CREATE INDEX IF NOT EXISTS idx_si_rule_assign_snapshot
  ON public.scale_insights_rule_assignments USING btree (snapshot_date);

COMMENT ON TABLE public.scale_insights_rule_assignments IS
  'ScaleInsights weekly rule-assignment snapshots (INB-148). Account-wide regardless of SI tab; Assigned + Unassigned exports upsert into the same rows (Unassigned is a verified subset of Assigned with all rule columns empty).';
COMMENT ON COLUMN public.scale_insights_rule_assignments.is_assigned IS
  'Content-derived: any rule array non-empty. Rows from the Unassigned export and all-empty Assigned rows are both false.';
