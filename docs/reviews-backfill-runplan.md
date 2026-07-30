# Amazon Reviews — Backfill & Incremental Run Plan (INB-160)

Design deliverable for the reviews workstream (GATE V4). **Executed by Darren** after V4 close-out —
this is the plan, not automation (Apify webhook/API automation is out of scope, a later follow-up).

## What feeds what

One Axesso Apify actor (`axesso_data/amazon-reviews-scraper`, `domainCode: com`, `$0.90/1K reviews`)
exports a **flat JSON array** (one item per review, product/page metadata repeated on every item).
That single file feeds **two** tables via the JSON upload path (`/upload` → `/api/ingest` sniffs a
leading `[` → `handleReviewsUpload`):

- `amazon_reviews` — upsert on `(brand_id, review_id)`. review_id is shared across a parent's child
  ASINs, so it dedupes alone; re-uploads/overlaps are idempotent.
- `amazon_rating_snapshots` — upsert on `(brand_id, asin, snapshot_date)`, **written ONLY from
  unfiltered runs** (per-item `filters.filterByStar` absent). countReviews is filter-dependent;
  countRatings/productRating are filter-stable.

Upload has `requires_period_dates = false`. Enter the **run date** in the form's Date Range Start to
anchor `snapshot_date` (else it defaults to the ingest date — fine for same-day uploads).

## Run list — 11 representative child ASINs

`lib/reviews/run-config.ts` → `REVIEW_RUN_TARGETS`: one child per Dirty Labs parent family (the
top-selling child), derived from the live `sku_economics_weekly` parent_asin map on 2026-07-30.
Refresh with `REVIEW_RUN_TARGETS`'s `REFRESH_QUERY` when the catalog changes.

**Why one child per parent:** Axesso bills per result and Amazon shares reviews across a parent's
children, so querying every child pays for the same reviewId repeatedly. One representative child
captures the family's reviews once. (Store the queried `asin` last-write + `variationId`.)

## (1) Migrate the existing `dirtylabs-voc` Apify dataset first

Migrate the Amazon-review slice of the existing `dirtylabs-voc` dataset before fresh runs — it may
hold reviews no longer publicly reachable. Confirm its date coverage; export as the actor's JSON
shape (or map to it) and upload through `/upload`. Idempotent on review_id, so it can run before or
after fresh runs without duplication.

## (2) Fresh permutation backfill (history — reviews only)

Amazon caps **public pagination at ~10 pages/filter (~100 reviews/filter)**, so "full history" =
what's publicly reachable. To widen the window per family, permute:

- **star filter × sort:** `filterByStar` ∈ {1,2,3,4,5} × `sortBy` ∈ {recent, helpful}.
- Small buckets (1–3★, typically < ~100) capture completely from `recent` alone.
- Large buckets (5★, sometimes 4★) exceed the page cap → add `sortBy: helpful` as a second
  permutation on those buckets to reach more of the tail.
- Dedup is automatic (upsert on review_id).
- **These runs are star-filtered → they write reviews only, never rating snapshots.**

Critical/negative history (1–3★) is fully recoverable catalog-wide; 4–5★ history is bounded by the
page cap. Note the ceiling in any operator write-up.

## (3) Monthly unfiltered incrementals (reviews + snapshots)

Monthly (registry cadence `monthly`), **unfiltered**, `sortBy: recent`, all run-list ASINs in one
run input. Unfiltered → each ASIN's item yields one `amazon_rating_snapshots` row (productRating,
countRatings, countReviews, reviewSummary star %). Ad-hoc pulls are allowed anytime (idempotent).

## Trend views (migration 055)

- `amazon_review_trend` — weekly incoming-review volume + avg rating per ASIN, Sunday-anchored on
  review_date. Bucketed by *when the review was written* (not pulled) → early weeks only as complete
  as the page cap allowed.
- `amazon_rating_trend` — product-level rating/star-mix trend per ASIN with LAG deltas vs the prior
  snapshot. Needs ≥2 snapshots per ASIN for non-NULL deltas (i.e. two monthly runs).

## Accepted gaps (documented, not solved)

- Refunds-without-return and CS contacts/buyer-messages also feed Amazon's NCX and are not
  exportable → the returns-based NCX proxy (sku_return_rates) tracks direction, not Amazon's number.
- VoC dashboard grades/key phrases are manual-only, not a feed.
- SP-API Customer Feedback (review-topic NLP) = compliant phase-2 enrichment; out of scope here.
- Competitor-roster reviews — DL ASINs only this pass.
