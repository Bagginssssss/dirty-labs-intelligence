import { parseInteger } from '@/lib/csv-parser'

// INB-160 — Amazon reviews (Axesso Apify actor) → amazon_reviews + amazon_rating_snapshots.
// The export is a flat JSON array (one item per review; product/page metadata repeated on every
// item), so this mapper takes parsed JSON objects, NOT the CSV RawRow. The route sniffs JSON and
// hands off to lib/reviews-ingest.ts (a bespoke handler, like COGS) — this module is the PURE
// parsing/derivation core it calls.
//
// Two pre-verified schema facts (INB-160 comments, checked against both real samples):
//  * `filters` is a per-item structured object. Unfiltered items carry
//    {reviewerType, mediaType, formatType} with NO filterByStar key; filtered items add
//    filterByStar. isUnfilteredRun is PER-ITEM (a mixed export writes snapshots only for its
//    unfiltered items' ASINs). Missing/malformed/filterByStar-present all → filtered (conservative:
//    never write a rating snapshot from a possibly-filtered run, since countReviews is filter-dependent).
//  * `reviewSummary` is NESTED: {fiveStar:{percentage:75}, fourStar:{percentage:10}, ...} — the
//    star percentages live one level down under `percentage`.

export type ReviewItem = Record<string, unknown>

// ── Field accessors (JSON values may be string | number | boolean | array | null) ──
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function strOrNull(v: unknown): string | null {
  const s = str(v)
  return s !== '' ? s : null
}
function boolOrNull(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (t === 'true') return true
    if (t === 'false') return false
  }
  return null
}
function intOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  if (typeof v === 'string') return parseInteger(v)
  return null
}
// Array length (image/video URL lists → counts). Non-array (absent) → null; [] → 0.
function arrLen(v: unknown): number | null {
  return Array.isArray(v) ? v.length : null
}

// ── Date + rating parsing ──────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

// "July 18, 2026" → "2026-07-18". Explicit month-name map avoids raw new Date() tz parsing
// (AGENTS.md). Returns null on any non-US-long-form or impossible day.
export function parseUsLongDate(s: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim())
  if (!m) return null
  const mon = MONTHS[m[1].toLowerCase()]
  if (!mon) return null
  const day = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  if (day < 1 || day > 31) return null
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// "Reviewed in the United States on July 18, 2026" → { country, date }.
const REVIEWED_RE = /^Reviewed in (.+) on (.+)$/
export function parseReviewDate(raw: string): { country: string | null; date: string | null } {
  const m = REVIEWED_RE.exec(raw.trim())
  if (!m) return { country: null, date: null }
  return { country: m[1].trim() || null, date: parseUsLongDate(m[2].trim()) }
}

// "5.0 out of 5 stars" / "4.4 out of 5" → 5.0 / 4.4 (also tolerates a bare number).
export function parseStarRating(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const m = /(\d+(?:\.\d+)?)/.exec(raw)
  return m ? parseFloat(m[1]) : null
}

// ── Unfiltered detection (per item) ──────────────────────────────────────────────
const UNFILTERED_MARKER_KEYS = ['reviewerType', 'mediaType', 'formatType']
export function isUnfilteredRun(item: ReviewItem): boolean {
  const f = item.filters
  if (f === null || typeof f !== 'object' || Array.isArray(f)) return false
  const obj = f as Record<string, unknown>
  if ('filterByStar' in obj) return false                     // any star filter → filtered
  return UNFILTERED_MARKER_KEYS.every(k => k in obj)          // well-formed unfiltered shape
}

// ── amazon_reviews rows ──────────────────────────────────────────────────────────
export interface AmazonReviewRow {
  brand_id: string
  review_id: string
  asin: string | null
  variation_id: string | null
  rating: number | null
  title: string | null
  body: string | null
  review_date: string | null
  review_country: string | null
  user_name: string | null
  verified: boolean | null
  vine: boolean | null
  helpful_votes: number | null
  image_count: number | null
  video_count: number | null
  variation_list: unknown        // jsonb — the raw variationList array (or null)
  source_run: string | null      // upload filename (Apify run provenance)
  scraped_at: string | null      // ingest run marker (ISO) — set by the handler
}

export interface ReviewsMapOpts { sourceRun?: string | null; scrapedAt?: string | null }

// One row per item. No within-file dedup here — the handler runs partitionRequiredNotNull
// (empty review_id) then dedupeByConflictKey(brand_id,review_id) so cross-child overlap collapses
// with honest counts, exactly as the CSV pipeline does.
export function mapAmazonReviews(items: ReviewItem[], brandId: string, opts: ReviewsMapOpts = {}): AmazonReviewRow[] {
  const sourceRun = opts.sourceRun ?? null
  const scrapedAt = opts.scrapedAt ?? null
  return items.map(item => {
    const { country, date } = parseReviewDate(str(item.date))
    return {
      brand_id:       brandId,
      review_id:      str(item.reviewId),
      asin:           strOrNull(item.asin),
      variation_id:   strOrNull(item.variationId),
      rating:         parseStarRating(item.rating),
      title:          strOrNull(item.title),
      body:           strOrNull(item.text),
      review_date:    date,
      review_country: country,
      user_name:      strOrNull(item.userName),
      verified:       boolOrNull(item.verified),
      vine:           boolOrNull(item.vine),
      helpful_votes:  intOrNull(item.numberOfHelpful),
      image_count:    arrLen(item.imageUrlList),
      video_count:    arrLen(item.videoUrlList),
      variation_list: Array.isArray(item.variationList) ? item.variationList : null,
      source_run:     sourceRun,
      scraped_at:     scrapedAt,
    }
  })
}

// ── amazon_rating_snapshots rows ─────────────────────────────────────────────────
export interface AmazonRatingSnapshotRow {
  brand_id: string
  snapshot_date: string
  asin: string
  product_rating: number | null
  count_ratings: number | null
  count_reviews: number | null
  pct_5_star: number | null
  pct_4_star: number | null
  pct_3_star: number | null
  pct_2_star: number | null
  pct_1_star: number | null
}

// reviewSummary is nested: {fiveStar:{percentage:75}, ...}. Pull `<star>.percentage`.
function starPct(summary: unknown, key: string): number | null {
  if (summary === null || typeof summary !== 'object') return null
  const bucket = (summary as Record<string, unknown>)[key]
  if (bucket === null || typeof bucket !== 'object') return null
  return intOrNull((bucket as Record<string, unknown>).percentage)
}

// One row per distinct ASIN, ONLY from unfiltered items (countReviews is filter-dependent).
// Last unfiltered item per ASIN wins. Items with an empty asin are skipped (no key).
export function buildRatingSnapshots(items: ReviewItem[], brandId: string, snapshotDate: string): AmazonRatingSnapshotRow[] {
  const byAsin = new Map<string, AmazonRatingSnapshotRow>()
  for (const item of items) {
    if (!isUnfilteredRun(item)) continue
    const asin = str(item.asin)
    if (asin === '') continue
    const summary = item.reviewSummary
    byAsin.set(asin, {
      brand_id:       brandId,
      snapshot_date:  snapshotDate,
      asin,
      product_rating: parseStarRating(item.productRating),
      count_ratings:  intOrNull(item.countRatings),
      count_reviews:  intOrNull(item.countReviews),
      pct_5_star:     starPct(summary, 'fiveStar'),
      pct_4_star:     starPct(summary, 'fourStar'),
      pct_3_star:     starPct(summary, 'threeStar'),
      pct_2_star:     starPct(summary, 'twoStar'),
      pct_1_star:     starPct(summary, 'oneStar'),
    })
  }
  return [...byAsin.values()]
}

// ── Non-fatal upload guards (surfaced in the response summary + ingestion log) ──
export function amazonReviewsWarnings(items: ReviewItem[]): string[] {
  const warnings: string[] = []
  const total = items.length
  const unfiltered = items.filter(isUnfilteredRun).length
  const filtered = total - unfiltered
  if (filtered > 0) {
    warnings.push(
      `[info] ${filtered} of ${total} item(s) are from star-filtered runs — rating snapshots are ` +
      `written only from unfiltered items (countReviews is filter-dependent).`,
    )
  }
  let badDates = 0
  let badRatings = 0
  for (const item of items) {
    const rawDate = str(item.date)
    if (rawDate !== '' && parseReviewDate(rawDate).date === null) badDates++
    const rawRating = str(item.rating)
    if (rawRating !== '' && parseStarRating(item.rating) === null) badRatings++
  }
  if (badDates > 0) warnings.push(`[warning] ${badDates} review(s) had an unparseable date — review_date stored NULL.`)
  if (badRatings > 0) warnings.push(`[warning] ${badRatings} review(s) had an unparseable rating — rating stored NULL.`)
  return warnings
}
