/**
 * Batch-ingest a directory of CSV reports via POST /api/ingest.
 *
 * Usage:
 *   BRAND_ID=<uuid> node scripts/backfill-ingest.mjs ./backfill
 *
 * Env vars:
 *   BRAND_ID         (required) — brand UUID to pass on every ingest request
 *   INGEST_BASE_URL  (optional) — defaults to http://localhost:3000
 *
 * Files are sorted alphabetically before upload. Alphabetical order
 * satisfies FK ordering (business_report → sp_campaign → sp_search_term)
 * and chronological ordering within each report type.
 *
 * Uploads are sequential — the ingest handler is not concurrency-safe and
 * FK caches reset per request, so parallelism wouldn't help.
 */

import { readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'

// ── Config ──────────────────────────────────────────────────────────────────

const BASE_URL  = process.env.INGEST_BASE_URL ?? 'http://localhost:3000'
const BRAND_ID  = process.env.BRAND_ID

if (!BRAND_ID) {
  console.error('Error: BRAND_ID env var is required.')
  console.error('  export BRAND_ID=47a96175-ed58-4104-a2ff-c925d6143309')
  process.exit(1)
}

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node scripts/backfill-ingest.mjs <directory>')
  process.exit(1)
}

// ── Discover files ───────────────────────────────────────────────────────────

let files
try {
  files = readdirSync(dir)
    .filter(f => f.endsWith('.csv'))
    .sort()                          // alphabetical = FK + chronological order
    .map(f => join(dir, f))
} catch (err) {
  console.error(`Cannot read directory "${dir}": ${err.message}`)
  process.exit(1)
}

if (files.length === 0) {
  console.error(`No .csv files found in "${dir}"`)
  process.exit(1)
}

const total = files.length
console.log(`Found ${total} CSV file(s) in "${dir}". Files without __YYYY-MM will be skipped.\n`)

// ── Ingest loop ──────────────────────────────────────────────────────────────

const failed   = []
let successes  = 0
let partials   = 0
let failures   = 0

for (let i = 0; i < files.length; i++) {
  const filePath = files[i]
  const name     = basename(filePath)
  const prefix   = `[${i + 1}/${total}]`

  // ── Parse period from filename ────────────────────────────────────────────
  // Required: __YYYY-MM.csv suffix. Mappers that derive dates from CSV rows
  // (sp_campaign, search_term, business_report_daily) ignore these fields;
  // the monthly business_report mapper needs date_range_start to set
  // report_date because the by-ASIN export has no date column.
  const periodMatch = name.match(/__(\d{4})-(\d{2})\.csv$/)
  if (!periodMatch) {
    process.stderr.write(`SKIP  ${name} — no __YYYY-MM period in filename\n`)
    failures++
    failed.push(name)
    continue
  }
  const year  = parseInt(periodMatch[1], 10)
  const month = parseInt(periodMatch[2], 10)
  if (month < 1 || month > 12) {
    process.stderr.write(`SKIP  ${name} — month ${month} out of range\n`)
    failures++
    failed.push(name)
    continue
  }
  const dateStart = `${year}-${String(month).padStart(2, '0')}-01`
  // Day 0 of next month = last day of this month (JS Date months are 0-indexed).
  const lastDay   = new Date(year, month, 0).getDate()
  const dateEnd   = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

  let result
  try {
    const fileContent = readFileSync(filePath)
    const blob = new Blob([fileContent], { type: 'text/csv' })

    const form = new FormData()
    form.append('file', blob, name)
    form.append('brand_id', BRAND_ID)
    form.append('date_range_start', dateStart)
    form.append('date_range_end', dateEnd)

    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: 'POST',
      body: form,
      // No timeout — sp_search_term files can take several minutes.
    })

    if (!res.ok && res.headers.get('content-type')?.includes('application/json') === false) {
      // Non-JSON HTTP error (e.g. 500 HTML from Next.js)
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    result = await res.json()
  } catch (err) {
    failures++
    failed.push(name)
    console.log(`${prefix} ${name} → FETCH_ERROR`)
    console.log(`         ${err.message}`)
    continue
  }

  const status   = result.status ?? 'unknown'
  const received = result.rows_received ?? 0
  const stored   = result.rows_stored   ?? 0
  const rejected = result.rows_rejected ?? 0

  const summary = `received=${received} stored=${stored} rejected=${rejected}`

  if (result.error || status === 'error' || status === 'failed') {
    failures++
    failed.push(name)
    console.log(`${prefix} ${name} → FAILED | ${summary}`)
    if (result.error)          console.log(`         error: ${result.error}`)
    if (result.parse_errors?.length) {
      console.log(`         first parse error: ${result.parse_errors[0]}`)
    }
  } else if (rejected > 0) {
    partials++
    console.log(`${prefix} ${name} → partial | ${summary}`)
    if (result.parse_errors?.length) {
      console.log(`         first parse error: ${result.parse_errors[0]}`)
    }
  } else {
    successes++
    console.log(`${prefix} ${name} → ok | ${summary}`)
  }
}

// ── Final summary ────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`)
console.log(`Ingest complete: ${total} files`)
console.log(`  ok:       ${successes}`)
console.log(`  partial:  ${partials}`)
console.log(`  failed:   ${failures}`)

if (failed.length > 0) {
  console.log(`\nFailed files (re-run individually if needed):`)
  for (const f of failed) console.log(`  ${f}`)
}
