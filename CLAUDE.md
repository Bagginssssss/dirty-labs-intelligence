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
- Current migration: 023

## Tech Stack
- Next.js 16, TypeScript, Tailwind CSS, App Router
- Supabase (PostgreSQL) — database
- Vercel — hosting, auto-deploys on GitHub push
- Anthropic API — claude-sonnet-4-6
- Claude Code (VS Code) — build tool

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
These tables use upsert not insert — conflict keys matter:
- business_report: (brand_id, asin_id, report_date)
- sp_campaign_performance: (brand_id, campaign_id, report_date, ad_type)
- subscribe_and_save: (brand_id, asin_id, sku, report_date)
- search_query_performance: (brand_id, search_query, report_date)
- scale_insights_keyword_rank: (brand_id, asin_id, keyword, report_date)
- scale_insights_bid_log: (brand_id, campaign_id, target, change_timestamp, bid_before, bid_after)
- smartscout_subcategory_products: (brand_id, parent_asin, subcategory, snapshot_date)
- smartscout_subcategory_brands: (brand_id, brand_name, snapshot_date)

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
supabase/migrations/     — 023 migration files (001–023)
```

## Database Tables (23 migrations)
- Reference: brands, asins, campaigns, ad_groups
- Reports: sp_search_term_report, sp_targeting_report, sp_campaign_performance,
           business_report, purchased_product_report, scale_insights_bid_log,
           scale_insights_keyword_rank, subscribe_and_save, search_query_performance,
           smartscout_subcategory_products, smartscout_subcategory_brands
- Derived: derived_metrics_daily, derived_metrics_weekly, derived_asin_metrics_daily
- Memory: platform_insights, platform_knowledge, platform_watchlist
- System: goals, report_ingestion_log

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
