// INB-160 — Amazon reviews mapper + rating-snapshot builder (the pure core of the JSON loader).
//
// Built to two pre-verified schema facts (checked chat-side against both real sample exports):
//  (1) `filters` is a per-item object; unfiltered = {reviewerType,mediaType,formatType} with NO
//      filterByStar; filtered adds filterByStar. Per-item; missing/malformed/present-key → filtered.
//  (2) `reviewSummary` is nested: {fiveStar:{percentage:75}, ...}.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseUsLongDate, parseReviewDate, parseStarRating, isUnfilteredRun,
  mapAmazonReviews, buildRatingSnapshots, amazonReviewsWarnings,
} from '../lib/mappers/amazon-reviews.ts'
import { dedupeByConflictKey } from '../lib/ingest-validation.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// A schema-lock-shaped UNFILTERED item (B09B7WLWW3 sample: rating 4.4, 2969/635, 75/10/4/4/7).
function unfilteredItem(over: Record<string, unknown> = {}) {
  return {
    reviewId: 'R1UNFILT',
    title: 'Great detergent',
    text: 'Cleans well and smells nice',
    date: 'Reviewed in the United States on July 18, 2026',
    rating: '5.0 out of 5 stars',
    userName: 'Jane D',
    numberOfHelpful: 3,
    verified: true,
    vine: false,
    variationId: 'B0VARIANTX',
    variationList: ['Scent: Fresh', 'Size: Large'],
    imageUrlList: ['u1', 'u2'],
    videoUrlList: [],
    profilePath: '/gp/profile/x',
    locale: null,
    asin: 'B09B7WLWW3',
    countRatings: 2969,
    countReviews: 635,
    productRating: '4.4 out of 5',
    reviewSummary: {
      fiveStar: { percentage: 75 }, fourStar: { percentage: 10 }, threeStar: { percentage: 4 },
      twoStar: { percentage: 4 }, oneStar: { percentage: 7 },
    },
    filters: { reviewerType: 'all_reviews', mediaType: 'all_contents', formatType: 'all_formats' },
    ...over,
  }
}
// Same item under a star filter (adds filterByStar) — the 65-item 5-star backfill shape.
function filteredItem(over: Record<string, unknown> = {}) {
  return unfilteredItem({
    filters: { reviewerType: 'all_reviews', mediaType: 'all_contents', formatType: 'all_formats', filterByStar: 'five_star' },
    ...over,
  })
}

// ── date + rating parsing ──────────────────────────────────────────────────────
test('parseUsLongDate: US month-name → ISO; bad forms → null', () => {
  assert.equal(parseUsLongDate('July 18, 2026'), '2026-07-18')
  assert.equal(parseUsLongDate('January 1, 2025'), '2025-01-01')
  assert.equal(parseUsLongDate('Notamonth 5, 2026'), null)
  assert.equal(parseUsLongDate('2026-07-18'), null) // not the US long form
})

test('parseReviewDate: splits country + date', () => {
  assert.deepEqual(
    parseReviewDate('Reviewed in the United States on July 18, 2026'),
    { country: 'the United States', date: '2026-07-18' },
  )
  assert.deepEqual(parseReviewDate('garbage'), { country: null, date: null })
})

test('parseStarRating: "N.N out of 5 stars" / "N.N out of 5" / number', () => {
  assert.equal(parseStarRating('5.0 out of 5 stars'), 5)
  assert.equal(parseStarRating('4.4 out of 5'), 4.4)
  assert.equal(parseStarRating(4.4), 4.4)
  assert.equal(parseStarRating('no number'), null)
})

// ── unfiltered detection (per item) ─────────────────────────────────────────────
test('isUnfilteredRun: well-formed filters w/o filterByStar = unfiltered; everything else filtered', () => {
  assert.equal(isUnfilteredRun(unfilteredItem()), true)
  assert.equal(isUnfilteredRun(filteredItem()), false)                    // filterByStar present
  assert.equal(isUnfilteredRun(unfilteredItem({ filters: undefined })), false) // missing
  assert.equal(isUnfilteredRun(unfilteredItem({ filters: null })), false)
  assert.equal(isUnfilteredRun(unfilteredItem({ filters: 'nope' })), false)     // malformed
  assert.equal(isUnfilteredRun(unfilteredItem({ filters: { reviewerType: 'x' } })), false) // incomplete
})

// ── review mapping ──────────────────────────────────────────────────────────────
test('mapAmazonReviews: parses every field incl. counts, bools, variation jsonb, provenance', () => {
  const [r] = mapAmazonReviews([unfilteredItem()], BRAND, { sourceRun: 'run.json', scrapedAt: '2026-07-29T00:00:00.000Z' })
  assert.equal(r.brand_id, BRAND)
  assert.equal(r.review_id, 'R1UNFILT')
  assert.equal(r.asin, 'B09B7WLWW3')
  assert.equal(r.variation_id, 'B0VARIANTX')
  assert.equal(r.rating, 5)
  assert.equal(r.review_date, '2026-07-18')
  assert.equal(r.review_country, 'the United States')
  assert.equal(r.verified, true)
  assert.equal(r.vine, false)
  assert.equal(r.helpful_votes, 3)
  assert.equal(r.image_count, 2)
  assert.equal(r.video_count, 0)
  assert.deepEqual(r.variation_list, ['Scent: Fresh', 'Size: Large'])
  assert.equal(r.source_run, 'run.json')
  assert.equal(r.scraped_at, '2026-07-29T00:00:00.000Z')
})

test('cross-child dedup: same review_id under two ASINs collapses to 1 (last-write asin)', () => {
  // Reviews are shared across a parent's children — same reviewId returns under each queried ASIN.
  const rows = mapAmazonReviews(
    [unfilteredItem({ asin: 'B00CHILD1' }), unfilteredItem({ asin: 'B00CHILD2' })],
    BRAND,
  )
  assert.equal(rows.length, 2, 'mapper does not dedup — the handler does')
  const { rows: unique, collapsed } = dedupeByConflictKey(
    rows as unknown as Record<string, unknown>[], 'brand_id,review_id',
  )
  assert.equal(unique.length, 1)
  assert.equal(collapsed, 1)
  assert.equal(unique[0].asin, 'B00CHILD2', 'last-write wins on asin')
})

// ── rating snapshots (unfiltered only, nested reviewSummary) ─────────────────────
test('buildRatingSnapshots: unfiltered item → 1 snapshot with nested star percentages', () => {
  const snaps = buildRatingSnapshots([unfilteredItem()], BRAND, '2026-07-29')
  assert.equal(snaps.length, 1)
  const s = snaps[0]
  assert.equal(s.snapshot_date, '2026-07-29')
  assert.equal(s.asin, 'B09B7WLWW3')
  assert.equal(s.product_rating, 4.4)
  assert.equal(s.count_ratings, 2969)
  assert.equal(s.count_reviews, 635)
  assert.deepEqual(
    [s.pct_5_star, s.pct_4_star, s.pct_3_star, s.pct_2_star, s.pct_1_star],
    [75, 10, 4, 4, 7],
  )
})

test('buildRatingSnapshots: filtered run → 0 snapshots (countReviews is filter-dependent)', () => {
  assert.equal(buildRatingSnapshots([filteredItem()], BRAND, '2026-07-29').length, 0)
})

test('buildRatingSnapshots: mixed export → snapshot only for the unfiltered items ASINs', () => {
  const snaps = buildRatingSnapshots(
    [unfilteredItem({ reviewId: 'RA', asin: 'B00AAA' }), filteredItem({ reviewId: 'RB', asin: 'B00BBB' })],
    BRAND, '2026-07-29',
  )
  assert.deepEqual(snaps.map(s => s.asin), ['B00AAA'])
})

// ── warnings ─────────────────────────────────────────────────────────────────────
test('amazonReviewsWarnings: filtered items info; unparseable date warns; clean unfiltered silent', () => {
  assert.equal(amazonReviewsWarnings([unfilteredItem()]).length, 0)
  const filtered = amazonReviewsWarnings([filteredItem()])
  assert.ok(filtered.some(w => /star-filtered runs/.test(w)))
  const badDate = amazonReviewsWarnings([unfilteredItem({ date: 'Reviewed in the United States on Notamonth 5, 2026' })])
  assert.ok(badDate.some(w => /unparseable date/.test(w)))
})
