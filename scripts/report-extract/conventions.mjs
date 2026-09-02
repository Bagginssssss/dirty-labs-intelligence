// INB-178 Phase 2 — global conventions (query plan v1.2 §A). Defined ONCE, imported by every section.
//
// The whole point of this module: ROAS (and every other base) is defined here and NOWHERE else, so no
// section can quietly redefine a base mid-report. Most reconciliation failures come from mixing bases.

export const BRAND_ID = '47a96175-ed58-4104-a2ff-c925d6143309'

// Revenue basis — ordered_product_sales, never shipped_product_sales.
export const REVENUE_COLUMN = 'ordered_product_sales'
// Ad attribution — sales_7d, never sales_click (null on all SP rows; SB/SBV only from March 2026).
export const AD_SALES_COLUMN = 'sales_7d'
// Ad types — SP, SB, SBV only. No Sponsored Display exists in the data.
export const AD_TYPES = ['SP', 'SB', 'SBV']

// Coverage windows (query plan §C, corrected). August end dates differ BY SOURCE — every August figure
// is labeled with its own end date; do not let one August column imply another's completeness.
//
// sp_targeting_report and sp_search_term_report are DIFFERENT tables with DIFFERENT SB/SBV coverage —
// do NOT collapse them: targeting has SP+SB+SBV from 2026-03-01; the search-term report has SP from
// 2026-03-01 but SB/SBV only from 2026-05-01. (The query plan originally carried the 2026-05-01 date on
// the targeting row by mistake; verified against prod — targeting has 1,411 SB + 4,891 SBV rows in
// March 2026.)
export const COVERAGE = {
  business_report_daily: { start: '2025-05-01', end: '2026-08-29' },
  sp_campaign: { sp_start: '2025-05-01', sbsbv_start: '2026-03-01', end: '2026-08-29' },
  sp_targeting: { start: '2026-03-01', sbsbv_start: '2026-03-01', end: '2026-08-29' },
  sp_search_term: { start: '2026-03-01', sbsbv_start: '2026-05-01', end: '2026-08-29' },
}
// SB/SBV coverage begins here for the campaign table (sp_campaign_performance) — before this date,
// all-types spend == SP-only spend by construction. (Same date for sp_targeting; NOT sp_search_term.)
export const SBSBV_START = '2026-03-01'

// ── Metric definitions — SUM over the period, THEN divide. NEVER the average of daily ratios. ──
// Each takes pre-summed inputs, so "sum first" is structural rather than a rule to remember. Guarded
// denominators return null (not 0, not NaN) so an absent period is distinguishable from a real zero.
export function roas(salesSum, spendSum) { return spendSum > 0 ? salesSum / spendSum : null }
export function acos(spendSum, salesSum) { return salesSum > 0 ? spendSum / salesSum : null }
export function tacos(spendSum, revenueSum) { return revenueSum > 0 ? spendSum / revenueSum : null }
export function conversion(unitsSum, sessionsSum) { return sessionsSum > 0 ? unitsSum / sessionsSum : null }
export function dailyRate(total, days) { return days > 0 ? total / days : null }

// Calendar length of a month, for the day-count audit (calendar vs the DISTINCT report_date count the
// section actually observes). The daily rate uses observed days, never this — Aug is 29 observed days.
export function calendarDaysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

// Sum a numeric column across rows, coercing null → 0. Full precision (no rounding — display concern).
export function sumBy(rows, key) {
  let s = 0
  for (const r of rows) s += Number(r[key] ?? 0)
  return s
}

// ── Reconciliation tolerance ──────────────────────────────────────────────────────────────────────
// ordered_product_sales and spend are Postgres numeric; JS Number accumulation over tens of thousands
// of rows drifts by fractions of a cent. Currency comparisons allow $0.01 of float noise. Unit / order /
// session counts are integers and must match EXACTLY. A difference above tolerance is a real
// disagreement — stop and report, never adjust a query toward the expected number.
export const TOLERANCE = { currency: 0.01, count: 0 }

// Compare two numbers against the tolerance for `kind` ('currency' | 'count'). Returns
// { pass, diff, tol }. `count` uses exact equality (tol 0).
export function reconcile(actual, expected, kind) {
  const tol = kind === 'count' ? TOLERANCE.count : TOLERANCE.currency
  const diff = actual - expected
  return { pass: Math.abs(diff) <= tol, diff, tol }
}

// ── DELIBERATE EXCEPTION to the sum-then-divide rule (INB-178 Batch B, §4/§5) ──────────────────────
// sns_dashboard_daily stores reorder_rate / sns_sales_share / coupon_subs_share as daily scalars ALREADY
// divided by Amazon — no numerator or denominator is available — so a weekly/monthly aggregate can only
// be an UNWEIGHTED MEAN of daily rates. This is exactly the average-of-daily-ratios the rest of this
// module exists to prevent; it is used ONLY here, ONLY because the inputs to comply do not exist. NEVER
// use it where a numerator and denominator ARE available — e.g. sns_sales_share has a true rate,
// sum(sns_sales)/sum(ordered_revenue), which must be computed alongside for validation. Every JSON
// figure produced this way carries aggregation: "mean_of_daily_rates".
export function meanOfDailyRates(values) {
  const v = values.filter(x => x != null).map(Number)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

// Shared date helpers — Monday-anchored weeks (matches §0/§1 anchoring) and month/day keys.
export function mondayOf(dateStr) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)) // Mon=0 … Sun=6
  return d.toISOString().slice(0, 10)
}
export const monthKey = d => String(d).slice(0, 7)
export const dayKey = d => String(d).slice(0, 10)

// Inclusive day span between two ISO dates (both endpoints counted): 2026-04-01 → 2026-04-30 = 30.
export function daysInclusive(startStr, endStr) {
  const a = Date.parse(dayKey(startStr) + 'T00:00:00Z')
  const b = Date.parse(dayKey(endStr) + 'T00:00:00Z')
  return Math.round((b - a) / 86400000) + 1
}

// ── §6 category performance (query plan v1.4 §6) ───────────────────────────────────────────────────
// Five category slugs (asins.product_line, INB-179). Storage values only — display labels live in the
// report layer; never query against a label.
export const CATEGORY_SLUGS = ['laundry_detergent', 'laundry_booster', 'dish', 'toilet', 'accessories']

// The four business_report windows, keyed by their window-START report_date. business_report stores one
// aggregated row per ASIN per window start; the window END is NOT in that table, so it is looked up from
// report_coverage (report_key='business_report_child_asin') at extract time and NEVER assumed. Closed
// intervals, both endpoints inclusive → lengths 30/32/31/32 days; P1 and P2 overlap by 3 days
// (Jun 26–28), disclosed on the period. Windows are 30–32 days, so raw totals are NEVER compared across
// them — every cross-window comparison runs on a daily rate.
export const S6_WINDOWS = [
  { key: 'baseline', period_start: '2026-04-01' },
  { key: 'p1', period_start: '2026-05-28' },
  { key: 'p2', period_start: '2026-06-26' },
  { key: 'p3', period_start: '2026-07-30' },
]
export const S6_COVERAGE_REPORT_KEY = 'business_report_child_asin'

// ── §7d/§8 brand classifier (query plan v1.4 §B4, Batch D) ──────────────────────────────────────────
// Classifies a search term OR a target into branded / competitor / non_branded. A misclassification is
// invisible — it shifts a percentage nobody can reconcile — so the rules are deliberate and audited
// before any section uses this.
//
// Normalisation (applied to BOTH the text and every brand name, so they meet on the same footing):
//   lowercase · '&' → ' and ' · apostrophes removed (molly's → mollys) · every other non-alphanumeric
//   run → a single space · trim. Verified necessary against the data: competitor brands arrive
//   punctuation-stripped — 'arm and hammer' ($1,005) dominates 'arm & hammer' ($201); 'mrs meyers' and
//   'mollys suds' appear with no apostrophe at all. Brands containing '&' ALSO get an elided variant
//   ('arm & hammer' → both 'arm and hammer' and 'arm hammer') so all three written forms match.
export function normalizeBrandText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Dirty Labs → branded. The name spellings + scent/line/tech names that act as brand terms. phytolase
// (enzyme tech) and verdure (toilet scent) are DL-coined; 'dirt labs' is a high-converting typo of the
// brand (103 orders / $289) — all confirmed at the G1 audit.
export const DL_BRAND_PATTERNS = ['dirty labs', 'dirtylabs', 'dirty lab', 'dirt labs', 'murasaki', 'aestival', 'phytolase', 'verdure']

// Competitor tiers. ALL three tiers are competitors for classification; the tier only controls whether a
// brand is foregrounded in §8b's conquest map. Batch D G1 audit changes: added Woolite (giant) + Febu
// (other), then a second wave from the non_branded>$250 brand scan (tiered by Darren). OUT was DROPPED
// entirely — its only matches were the preposition "out" (iron out / stains out / …); no genuine OUT-brand
// term appears, and verb+out cannot be enumerated, so it was an open-ended false-positive class for ~$0.
export const COMPETITOR_TIERS = {
  peer: ['Blueland', 'Seventh Generation', 'The Clean People', 'Truly Free', 'Branch Basics', 'Dropps', 'Puracy', "Molly's Suds", 'The Laundress', "Mrs. Meyer's", 'ECOS', 'Zum', 'Kinara', 'Tyler Candle Company', "Miss Mouth's", 'ACTIVE', 'Attitude', 'Defunkify', 'Guests on Earth', 'Koala Eco', 'Clean Cult', 'Biokleen', 'Laundry Sauce', 'Dedcool', 'Pronounce'],
  giant: ['Tide', 'Cascade', 'Finish', 'Dawn', 'Clorox', 'OxiClean', 'Arm & Hammer', 'Gain', 'All', 'Dreft', 'Persil', 'Shout', 'Lysol', 'Scrubbing Bubbles', 'Soft Scrub', 'Zep', 'Kaboom', '20 Mule Team', 'Amazon Basics', 'Lemi Shine', 'Woolite', 'Method'],
  other: ['Carbona', 'Dryel', 'Zout', 'Bissell', 'Fels Naptha', 'Miele', 'Vacplus', 'krazy klean', 'X-ALL', 'KIISIISO', 'LosKremari', 'Febu', 'Restorabowl', 'Mozi', 'Ewe Dew', 'Eucalan', 'Norwex', 'Friendsheep'],
}

// Explicit alias map (Batch D G1). A brand also matches these exact spellings — NEVER fuzzy/edit-distance
// matching (that trades a known false-negative for unknown false-positives). Printed in full at audit.
// Diva Wash / Tyler Diva are the SAME competitor as Tyler Candle Company — aliased, not a separate entry,
// so §8b never double-counts them.
export const BRAND_ALIASES = {
  OxiClean: ['oxyclean'],
  Blueland: ['blue land'],
  'X-ALL': ['xall'],
  'The Laundress': ['laundress'],
  'Tyler Candle Company': ['diva wash', 'tyler diva'],
}

// Ordinary English words that must NOT match bare — only with a category term alongside (rule 2). OUT was
// dropped from the brand set entirely (see COMPETITOR_TIERS note), so it is no longer here.
export const AMBIGUOUS_BRANDS = new Set(['all', 'gain', 'dawn', 'tide', 'finish', 'shout', 'persil', 'active', 'dropps', 'zum'])
// Category context that licenses an ambiguous-brand match. 'free and clear' / 'free and gentle' are
// laundry-specific product-line phrases (Batch D G1) that recover genuine Tide/Gain/etc. demand.
export const CATEGORY_CONTEXT_TERMS = ['detergent', 'laundry', 'dish', 'dishwasher', 'pods', 'toilet', 'bowl', 'stain', 'cleaner', 'booster', 'wash', 'free and clear', 'free and gentle']
// Ambiguous brands that ALSO match when the search term IS the bare brand name and nothing else ("tide"
// alone on a laundry ad is the brand). EXCLUDES 'all' — a bare "all" is a broad-match artifact, not intent.
export const EXACT_BARE_BRANDS = new Set(['tide', 'gain', 'dawn', 'finish', 'persil', 'shout', 'dropps', 'zum', 'active'])

// Negative-context stopwords (Batch D G1 ruling). Two ambiguous brands — All and ACTIVE — also occur as
// an adjective ALONGSIDE a category term, which rule 2 alone cannot separate (OUT had the same problem and
// was dropped outright). When any of these phrases appears (word-boundary), the brand is suppressed for
// that term even if a category term is present. Keyed by normalised brand. Genuine brand demand is
// preserved: 'all free and clear', 'all detergent' still match All; 'active enzyme laundry booster' still
// matches ACTIVE (the Booster/stain bucket Darren flagged). The full list is printed at audit and every
// surviving match is enumerated in the §7d/§8 artifact so the rule stays inspectable.
export const AMBIGUOUS_NEGATIVES = {
  all: ['all natural', 'all purpose', 'all in one', 'all around', 'all fabric', 'all temperature', 'all season'],
  active: ['active wear', 'activewear'],
}

// Word-boundary match on already-normalised strings: the pattern may not be flanked by an alphanumeric
// character (so `all` never matches `smallest`, `out` never matches `outdoor`). Never substring.
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = pat => new RegExp('(?<![a-z0-9])' + escapeRe(pat) + '(?![a-z0-9])')
const brandPatterns = brand => {
  const pats = new Set([normalizeBrandText(brand)])
  if (/&/.test(brand)) pats.add(normalizeBrandText(brand.replace(/&/g, ' ')))       // elided: "arm hammer"
  if (/['’]s\b/i.test(brand)) pats.add(normalizeBrandText(brand.replace(/['’]s\b/gi, ''))) // possessive: Molly's → molly
  for (const a of (BRAND_ALIASES[brand] ?? [])) pats.add(normalizeBrandText(a))      // explicit aliases
  return [...pats]
}

const DL_RE = DL_BRAND_PATTERNS.map(p => ({ raw: p, re: wordRe(normalizeBrandText(p)) }))
const COMPETITOR_INDEX = Object.entries(COMPETITOR_TIERS).flatMap(([tier, brands]) =>
  brands.map(brand => ({ brand, tier, ambiguous: AMBIGUOUS_BRANDS.has(normalizeBrandText(brand)), res: brandPatterns(brand).map(wordRe) })))
const CONTEXT_RE = CATEGORY_CONTEXT_TERMS.map(term => ({ term, re: wordRe(term) }))
const NEGATIVE_RE = Object.fromEntries(Object.entries(AMBIGUOUS_NEGATIVES).map(([b, phrases]) => [b, phrases.map(p => wordRe(normalizeBrandText(p)))]))

// Full list of the competitor brand display names (65 after the G1 audit), for the zero-match audit.
export const COMPETITOR_BRANDS = COMPETITOR_INDEX.map(c => c.brand)

// Classify one term/target. Precedence: branded → competitor → non_branded (rule 3). A term carrying
// both a Dirty Labs pattern and a competitor name is branded. Returns { class, brand?, tier?, context?,
// all_brands? } — context is the category term that licensed an ambiguous-brand match.
// Competitor match on an ALREADY-normalised string, ignoring Dirty Labs precedence. Returns
// { brand, tier, context, all_brands } or null. Factored out so the audit can detect dual-match
// (branded-by-precedence terms that ALSO name a competitor).
function competitorMatchNorm(t) {
  const matches = []
  for (const c of COMPETITOR_INDEX) {
    if (!c.res.some(re => re.test(t))) continue
    if (c.ambiguous) {
      const nb = normalizeBrandText(c.brand)
      if (EXACT_BARE_BRANDS.has(nb) && t === nb) { // bare one-word brand term on a laundry ad → the brand
        matches.push({ brand: c.brand, tier: c.tier, context: 'exact_bare_term' })
        continue
      }
      const negs = NEGATIVE_RE[nb]
      if (negs && negs.some(re => re.test(t))) continue // adjective/preposition use (e.g. "all natural") → not the brand
      const ctx = CONTEXT_RE.find(x => x.re.test(t))
      if (!ctx) continue // ambiguous word with no category context → not a brand match
      matches.push({ brand: c.brand, tier: c.tier, context: ctx.term })
    } else {
      matches.push({ brand: c.brand, tier: c.tier, context: null })
    }
  }
  if (!matches.length) return null
  matches.sort((a, b) => b.brand.length - a.brand.length) // primary = most specific (longest) brand
  return { brand: matches[0].brand, tier: matches[0].tier, context: matches[0].context, all_brands: [...new Set(matches.map(m => m.brand))] }
}

export function classifyBrand(term) {
  const t = normalizeBrandText(term)
  for (const p of DL_RE) if (p.re.test(t)) return { class: 'branded', brand: 'Dirty Labs', pattern: p.raw }
  const m = competitorMatchNorm(t)
  if (m) return { class: 'competitor', ...m }
  return { class: 'non_branded' }
}

// Competitor match ignoring DL precedence — for audit/dual-match introspection only.
export function competitorMatch(term) { return competitorMatchNorm(normalizeBrandText(term)) }

// ── §8a campaign → category join (Batch D §8, Darren's spec) ────────────────────────────────────────
// DL campaign names are structured: TYPE.CLASS.TARGETING - SUBJECT - DESCRIPTOR. The SUBJECT slot holds
// either a literal ASIN (e.g. "SP.BR.KT - B09B7YS1VK - Branded KW") or a product word. Resolve in strict
// precedence, reporting the tier used; NEVER dominant-advertised-ASIN weighting (collapses cross-category
// campaigns and leans on purchased_product_report, which attributes to bundle ASINs).
const CAMPAIGN_ASIN_RE = /\bB0[A-Z0-9]{8}\b/
// Tier 2 product words — ORDER MATTERS: toilet/dish/booster/accessories BEFORE laundry, or "laundry
// booster" lands in detergent.
// Trailing s? on every noun — campaigns are named in the plural ("Dryer Balls", "Scent Oils") and a
// singular-only \bword\b silently misses them (this sent ~$33k of accessories spend to unmapped on the
// first run).
const CAMPAIGN_CATEGORY_WORDS = [
  { cat: 'toilet', re: /\b(toilets?|bowls?)\b/i },
  { cat: 'dish', re: /\bdish(es)?\b/i },
  { cat: 'laundry_booster', re: /\b(boosters?|stains?)\b/i },
  { cat: 'accessories', re: /\b(dryer balls?|canisters?|oils?|beakers?|dispensers?|cloths?|scrapers?|pumps?)\b/i },
  // "hand wash" → laundry_detergent (the Hand Wash & Delicates product B0BL8MWLM5 is laundry_detergent).
  { cat: 'laundry_detergent', re: /\b(laundry|detergents?|signature|murasaki|delicates|free clear|hand wash)\b/i },
]
// Tier 3 specific bundle-named campaigns → §8 anchors. NOT "Catch All - Bundles" (excluded).
const CAMPAIGN_BUNDLE_ANCHORS = [
  { cat: 'laundry_detergent', re: /\b(starter kit|sustainable set|clean cleaning bundle|refill.*pump|pump.*refill|signature scent set|detergent.*dryer ball)\b/i },
  { cat: 'accessories', re: /\bscent boost set\b/i },
  { cat: 'dish', re: /\bdish.*2.?pack.*sampler\b/i },
]

// Classify a campaign name into a category. `asinToCategory` maps upper-case ASIN → product_line (or
// null for bundles). Returns { category|null, tier: 1|2|3|4, matched }. Precedence: ASIN-in-name →
// product-word → specific-bundle-anchor → unmapped.
export function classifyCampaignCategory(name, asinToCategory) {
  const n = String(name ?? '')
  const m = n.match(CAMPAIGN_ASIN_RE)
  if (m) { const cat = asinToCategory.get(m[0].toUpperCase()); if (cat) return { category: cat, tier: 1, matched: m[0] } }
  for (const r of CAMPAIGN_CATEGORY_WORDS) if (r.re.test(n)) return { category: r.cat, tier: 2, matched: r.re.source }
  if (!/catch all/i.test(n)) for (const r of CAMPAIGN_BUNDLE_ANCHORS) if (r.re.test(n)) return { category: r.cat, tier: 3, matched: r.re.source }
  return { category: null, tier: 4, matched: null }
}

// ── §7d target-type branch (Batch D §7d correction) ─────────────────────────────────────────────────
// A three-way branded/non_branded/competitor split describes only what SHOPPERS TYPE. The account also
// runs conquest by PLACEMENT — targeting a competitor's ASIN detail page — which produces no brand-name
// search term at all (a shopper on a Tide page never types "tide"). So §7d classifies TARGETS, not just
// keyword text, into six buckets (auto_category is reported split into auto + category → seven fields).
// sp_targeting_report.targeting shapes (verified Aug 2026):
//   asin="B0…" | asin-expanded="B0…"                       → ASIN target
//   loose-match | close-match | substitutes | complements  → auto (Amazon chose the placement)
//   category="…" | keyword-group="…"                       → category (a deliberate choice)
//   anything else                                          → keyword (→ classifyBrand on the text)
export const S7D_BUCKETS = ['branded_keyword', 'non_branded_keyword', 'competitor_keyword', 'competitor_asin', 'own_asin_defensive', 'auto', 'category']
const ASIN_TARGET_RE = /^asin(?:-expanded)?\s*=\s*"?([a-z0-9]{10})"?\s*$/i
const AUTO_MODES = new Set(['loose-match', 'close-match', 'substitutes', 'complements'])

export function parseTarget(value) {
  const v = String(value ?? '').trim()
  const m = v.match(ASIN_TARGET_RE)
  if (m) return { kind: 'asin', asin: m[1].toUpperCase() }
  const low = v.toLowerCase()
  if (AUTO_MODES.has(low)) return { kind: 'auto', mode: low }
  if (/^category\s*=/i.test(v) || /^keyword-group\s*=/i.test(v)) return { kind: 'category', expr: v }
  return { kind: 'keyword', keyword: v }
}

// Classify one sp_targeting_report target into a §7d bucket. `ownAsinSet` is the set of OUR catalogue
// ASINs (uppercase) — an ASIN target resolves to own_asin_defensive if present, competitor_asin if not
// (a LOOSE proxy for competitor: some absent ASINs may be complementary/unrelated — audited separately).
export function classifyTarget(value, ownAsinSet) {
  const p = parseTarget(value)
  if (p.kind === 'asin') return { bucket: ownAsinSet.has(p.asin) ? 'own_asin_defensive' : 'competitor_asin', kind: 'asin', asin: p.asin }
  if (p.kind === 'auto') return { bucket: 'auto', kind: 'auto', mode: p.mode }
  if (p.kind === 'category') return { bucket: 'category', kind: 'category' }
  const c = classifyBrand(p.keyword)
  const bucket = c.class === 'branded' ? 'branded_keyword' : c.class === 'competitor' ? 'competitor_keyword' : 'non_branded_keyword'
  return { bucket, kind: 'keyword', keyword: p.keyword, brand: c.brand, tier: c.tier, context: c.context }
}
