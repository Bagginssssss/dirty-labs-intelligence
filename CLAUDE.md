@AGENTS.md

# Dirty Labs PPC Intelligence Platform

## Project Overview
Full-stack AI-powered PPC intelligence platform for Dirty Labs on Amazon.
Agentic PPC manager — not primarily a dashboard. AI agent understands Dirty Labs business context deeply.

## Key Constants
- Brand UUID: 47a96175-ed58-4104-a2ff-c925d6143309
- Live URL: https://dirty-labs-intelligence.vercel.app
- GitHub: https://github.com/Bagginssssss/dirty-labs-intelligence
- Local: /Users/darrenbilbao/dirty-labs-intelligence
- Current migration: 053

## Tech Stack
- Next.js 16, TypeScript, Tailwind CSS, App Router
- Supabase (PostgreSQL) — database
- Vercel — hosting, auto-deploys on GitHub push
- Anthropic API — claude-sonnet-4-6
- Claude Code (VS Code) — build tool

### Local startup modes
- Development (editing code): `npm run dev` — hot reload, on-demand compilation.
- Reporting session (no editing): `npm run report` (= production build + start) — removes dev
  compilation/hot-reload overhead, more stable for long sessions. Stop the dev server first (port 3000).
  NOTE (INB-137, measured 2026-07-05): prod mode does NOT meaningfully cut dashboard load — ~3 min in
  BOTH dev and prod. Bottleneck is server-side data loading (~20 Supabase queries / fetch-all-then-
  aggregate), not compilation (dev logs: application-code in minutes, next.js in ms). The render-time
  fix is INB-74 (caching) + INB-77 (RPC aggregation), not this ticket.

## Critical Rules

### Campaign Ad Type Detection
Detected from campaign name prefix ONLY — no column in reports:
- SBV. prefix → ad_type = 'SBV'
- SB. prefix → ad_type = 'SB'
- Everything else → ad_type = 'SP'
MANDATORY: All new campaigns must follow this convention.

### Attribution Windows
- SP: 7-day | SB/SBV: 14-day
- Stored in same _7d columns — attribution_window column indicates which applies
- SP and SB ROAS are NOT directly comparable

### AOV Calculation
CORRECT: sum(ordered_product_sales) / sum(total_order_items) from business_report
WRONG: revenue / orders_7d from campaign data

### Rank Sentinel Value
rank_value = 98 means "97+" — display as "97+" never as 98

### Upsert Tables
Source of truth: lib/upsert-config.ts (UPSERT_CONFLICT_KEYS for the ingest route,
ALL_UPSERT_CONFLICT_KEYS adds keys hardcoded at non-ingest call sites). Do not
enumerate the keys elsewhere — earlier copies of this list drifted (INB-88 found
this section missing 10 tables and stating a wrong key for smartscout_subcategory_brands).

Every configured conflict key MUST have a matching UNIQUE constraint in the DB.
A key without its constraint means ON CONFLICT catches nothing and re-uploads
silently duplicate rows (INB-82: purchased_product_report reached 1,031 dupes).
Detection (INB-88): tests/upsert-constraint-check.test.ts (suite fails),
`npm run check:upsert` (live DB, exit 1 on violations), and /api/health
(`upsert_constraint_check` + `degraded: true` — always HTTP 200; the suite and
script are the enforcing surfaces).

#### Adding a new ingestion table — checklist (MANDATORY)
1. The table's migration MUST include the UNIQUE constraint matching the upsert
   conflict key (see migration 030 for the pattern).
2. Add the key to UPSERT_CONFLICT_KEYS in lib/upsert-config.ts (or
   ALL_UPSERT_CONFLICT_KEYS if upserted outside the ingest route).
3. Update the aligned-DB fixture in tests/upsert-constraint-check.test.ts —
   the suite fails until the fixture matches the config.
4. After applying the migration, run `npm run check:upsert` and confirm all-clear.

## File Structure
```
lib/
  csv-parser.ts          — PapaParse wrapper, BOM stripping, metadata row skip
  report-detector.ts     — header signature detection, 14 report types
  field-formats.ts       — 115+ column format registry
  supabase.ts            — anon key client (frontend safe)
  supabase-admin.ts      — service role client (server only)
  derived-metrics.ts     — calculateDerivedMetrics, calculateDerivedMetricsRange
  analysis-context.ts    — DIRTY_LABS_SYSTEM_PROMPT, DATA_COMPLETENESS_NOTE
  mappers/
    types.ts             — makeGetter, norm, MapperContext
    index.ts             — getMapper, getBatchMapper dispatchers
    [14 mapper files]    — one per report type
  memory/
    episodic.ts          — saveInsight, getRecentInsights, markActioned
    semantic.ts          — saveKnowledge, getKnowledge, seedInitialKnowledge
    watchlist.ts         — addWatch, checkWatchlist, triggerAlert, seedDefaultWatches
    index.ts             — buildMemoryContext(brandId)
  queries/
    types.ts             — shared TypeScript interfaces
    account.ts           — getAccountSummary
    campaigns.ts         — getTopCampaigns, getWasteCampaigns, getCampaignsByAdType
    keywords.ts          — getWasteSearchTerms, getTopSearchTerms, getHarvestCandidates
    products.ts          — getASINPerformance, getSSPerformance
    opportunities.ts     — getSearchQueryGaps, getCompetitiveLandscape, getMarketShareByBrand
    anomalies.ts         — getAnomalies (6 checks)
    goals.ts             — getGoalProgress (hardcoded 2026 targets)
    rank.ts              — getKeywordRankSummary, getRankMovers
    index.ts             — exports all query functions
app/
  upload/page.tsx        — CSV upload UI at /upload
  api/
    ingest/route.ts      — POST handler, batch 500, upsert + deduplication
    analyze/route.ts     — POST AI analysis endpoint, all analysis types
    calculate-metrics/route.ts — POST derived metrics calculation
    health/route.ts      — GET health check
supabase/migrations/     — 053 migration files (001–053)
```

## Database Tables (53 migrations)
- Reference: brands, asins, campaigns, ad_groups
- Reports: sp_search_term_report, sp_targeting_report, sp_campaign_performance,
           business_report, purchased_product_report, scale_insights_bid_log,
           scale_insights_keyword_rank, subscribe_and_save, search_query_performance,
           smartscout_subcategory_products, smartscout_subcategory_brands
- Fees/COGS (INB-162): sku_economics_weekly (weekly MSKU fee economics; Amazon Net
           proceeds is PRE-COGS), sku_economics_fees (long fee lines; component rollup:
           Base fulfillment + Fuel surcharge = FBA fulfillment fees), cogs (internal
           effective-dated unit costs, internal_sku-primary = MSKU base, SCD-2 write)
- Profitability views (INB-162, migration 051): sku_profitability_weekly (msku),
           _monthly, _yearly, _weekly_by_asin, _weekly_by_parent_asin. net_profit =
           net_proceeds − net_units×unit_cost (COGS on NET units — flatters high-return/
           destroyed-return SKUs). cogs_missing = "cost needed (net_units<>0) & not found"
           → net_profit NULL, never treated as 0. COGS joined on split_part(msku,'-',1) =
           internal_sku (MSKU base), msku-exact override preferred.
- Customer Voice (INB-160): fba_customer_returns (Amazon FBA Customer Returns; one row
           per returned unit; Windows-1252 flat file — the loader's decodeFileContent
           has a strict-UTF-8→windows-1252 fallback; NO natural key, unique on
           (brand_id, return_ts, order_id, sku, lpn, occurrence) where occurrence =
           row-number within identical-row groups computed at map time → idempotent
           since return history is immutable; comments stored raw), return_reason_map
           (22-code reason→fault bucket seed; mirror lib/return-reason-map.ts; the LIVE
           join is authoritative, the row fault_class is an ingest-time snapshot).
           (amazon_reviews + amazon_rating_snapshots DEFERRED — later session.)
- NCX-proxy view (INB-160, migration 053): sku_return_rates — weekly product-fault
           return rate per SKU, Sunday-anchored (return_date − DOW) to match
           sku_economics_weekly; product-fault via LIVE return_reason_map join;
           denominator units_sold from sku_economics_weekly at (week, msku=sku); rates
           NULL where no sales row. PERIOD-RATE PROXY (return week ≠ sale week) and
           excludes refunds-without-return + CS contacts → won't match Amazon's NCX.
- Derived: derived_metrics_daily, derived_metrics_weekly, derived_asin_metrics_daily
- Memory: platform_insights, platform_knowledge, platform_watchlist
- System: goals, report_ingestion_log

### Schema naming exceptions (INB-93 — documented, intentionally not renamed)
Two historical naming inconsistencies are left as-is. Renaming them is high-blast-radius (mapper,
UPSERT_CONFLICT_KEYS, unique constraints, the INB-88 constraint checker, report registry, dashboard
queries/RPCs) for zero functional gain, so per INB-93 the decision is to document rather than rename:
- `search_query_performance` omits the `brand_analytics_` prefix used by other Brand Analytics source
  tables (e.g. `brand_analytics_customer_loyalty`); it IS a BA-sourced table despite the name.
- `smartscout_subcategory_products` uses `created_at` for its ingestion timestamp where most tables use
  `ingested_at` (same value/semantics, different column name).
Both are intentional. Do not rename without a dedicated migration + reconcile-every-reference pass.

## Memory Layer — Important Notes
seedInitialKnowledge(brandId) and seedDefaultWatches(brandId) are called automatically
by app/api/analyze/route.ts on first analysis run — DO NOT call manually.

## Data Status
- March 2026 fully ingested: 66,179 rows across 14 report types
- Derived metrics calculated for March 2026
- Historical backfill (12 months) in progress

## Environment Variables Required
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- ANTHROPIC_API_KEY

## Active Linear Project
Project: Dirty Labs PPC Intelligence Platform
Current milestone: Milestone 2 — Intelligence Layer
Remaining: INB-10 (dashboard), INB-11 (chat), INB-15 (data quality)

## Quality Control & Verification Protocol

**Governing principle:** No change is "done" because the summary says so. It's done when
an independent path confirms it — a fail-first test, a reviewed diff, and (for data/DB work)
an out-of-band check. Claude self-verifies as far as possible on every task; a defined set
of cases stop for human QC.

### Definition of Done (every ticket)
ALL must be true:
- Acceptance criteria from the goal brief are met.
- A regression test exists that FAILS on pre-change code and PASSES after — both states shown.
- Full suite green (`npm test`) and `tsc --noEmit` clean.
- The actual diff has been reported, not just a prose summary.
- Any "Human QC required" case has been flagged, not silently assumed.
- A QC note is posted to the Linear ticket (format below).

### Test discipline (the default — autonomous)
- Every behavioral change gets a test. No behavioral change ships untested.
- **Fail-first rule (non-negotiable):** write the test, run it against current code and show it
  FAILING, then implement the fix and show it PASSING. A test green both before and after the
  change proves nothing and is not acceptable evidence.
- Run the full suite + typecheck before declaring done; paste the transcript.
- Never weaken, skip, or delete a test to get green. If an existing test must change, stop and
  explain why first.
- Favor targeted "success tests" that assert the specific corrected behavior, alongside the
  failing case that motivated the fix.

### Honest reporting
- Show the diff. The prose summary is an index, never the evidence.
- Call out anything changed beyond the ticket's stated scope.
- State plainly what you could NOT verify. Never imply coverage you don't have.
- Distinguish "tests pass" (logic internally consistent) from "verified in the real system"
  (confirmed against live data). Only the latter is proof for data-affecting work.

### Human QC required — STOP and hand off
Implement and self-test as far as possible, then pause and hand Darren a concrete checklist when
the change:
- Can only be validated with a real report upload / live data (ingest correctness for a report
  type, derived-metrics recalc after upload, anything whose test needs data not in fixtures).
- Is UI-visible (dashboard labels, panels, rails) — needs a visual check at localhost:3000.
- Touches DB schema, migrations, unique constraints, or any destructive operation.
- Moves business-critical numbers (hero-ASIN units/sales, revenue, ACOS, NTB, KPI rails).
- Involved a low-confidence judgment call or an ambiguous spec.

The hand-off states: what to look at, what "correct" looks like, and what data to load to see it.
Do not mark the ticket done — mark it "pending human QC."

### Independent verification (out-of-band)
For data- or DB-touching changes, the test alone is not proof. Produce the specific Supabase
query or spot-check that re-derives the result through a different path than the code under test
(e.g., after an ingest fix, the query that reads stored rows back and checks the totals). Run by
the chat-side reviewer or Darren before close.

### Data-integrity canary (the "nothing broke silently" check)
Surface these whenever a change could affect ingest or metrics:
- Hero-ASIN units/sales match source for a spot-checked ASIN.
- Per-period row counts are as expected (no silent halving/collapse).
- No NULLs in required columns; no unexpected duplicates on natural keys.

### Repair-script ordering (NULL-key dedup playbook — INB-148/149/150)
When a repair NULL-normalizes a column (`NULL→''`) that sits inside a still-live UNIQUE
constraint, the normalization can collide a `NULL` row with an existing `''` twin under the
OLD key and roll back the whole statement (hit in INB-150). Order it so this can't happen:
normalize the key column only AFTER the keep-one dedupe (group with `COALESCE(col,'')` so
NULL/'' twins collapse together), OR drop the old constraint first. The key-swap migration
should likewise `DROP CONSTRAINT` before any `NULL→''` backfill.

### QC note (post to the Linear ticket on completion)
- Commit SHA + branch
- Files changed
- What the fail→pass test proves (one line)
- Human-QC items flagged (or "none")
- Independent verification run + result (or "pending")
- Build/deploy status

### Git & autonomy guardrails
- One ticket = one branch off fresh `main` (`darren/inb-<n>-<slug>`) = one focused commit = one push.
- Pre-approved without asking: `npm test`, `npm run build`, lint, `tsc --noEmit`.
- Require explicit human go-ahead: DB migrations / schema changes, destructive git ops, every `git push`.
- Never commit secrets; `.env.local` stays gitignored.

### Push safety (added after INB-136 order-of-operations slip)
- Before any commit, verify the current branch with `git status -sb` — never commit a ticket on `main`.
- One ticket = one branch off fresh `main`; create it with `git checkout -b` BEFORE any implementation.
- Push the explicit named branch only. NEVER chain a fallback push (e.g. `git push origin <branch> || git push origin HEAD`) — a missing or wrong branch must fail loudly, never silently fall back to pushing HEAD/main.
