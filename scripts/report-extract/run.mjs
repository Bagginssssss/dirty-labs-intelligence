// INB-178 Phase 2 — runner. Executes each registered section and assembles ONE report-data.json.
//
// Full precision: no rounding here — rounding is a display concern for the report layer.
// The output is an ARTIFACT, not a served file: written to ./out/ (gitignored) and moved into the
// reports repo by hand. Nothing in the intelligence app imports it.
//
// Invoke:  node --env-file-if-exists=.env.local scripts/report-extract/run.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db.mjs'
import * as conventions from './conventions.mjs'
import { SECTIONS } from './sections/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(here, 'out', 'report-data.json')

const report = {
  meta: {
    batch: 'A',
    sections_included: SECTIONS.map(s => s.key),
    generated_at: new Date().toISOString(),
    brand_id: conventions.BRAND_ID,
    coverage: conventions.COVERAGE,
    // Provenance: derived_metrics_daily holds pre-computed ROAS/MER/NTB but is NOT validated against
    // source, so it is NOT a source for this artifact — every figure here is computed from raw rows.
    // It was compared for validation: 7 of 8 months (Jan–Apr, Jun–Aug) match sp_campaign_performance to
    // the cent; May 2026 diverges by $18,759.08 of PPC spend with 31 days of coverage on both sides (a
    // stale/partial recalculation for one month, not a definitional difference — filed separately). Its
    // avg-of-daily blended_roas also differs from sum-then-divide (Feb 2.58 vs 2.35), the averaging
    // error the conventions guard against.
    derived_metrics_daily: {
      used_as_source: false,
      note: 'Compared for validation, not used. 7 of 8 months match sp_campaign_performance to the cent; May 2026 PPC spend diverges by $18,759.08 (stale/partial recalc, filed separately). All figures here are from raw rows.',
    },
    conventions: {
      revenue_column: conventions.REVENUE_COLUMN,
      ad_sales_column: conventions.AD_SALES_COLUMN,
      ad_types: conventions.AD_TYPES,
      sbsbv_start: conventions.SBSBV_START,
      note: 'ROAS/ACOS/TACOS/conversion are sum-then-divide over the period, never averages of daily ratios. Full precision — rounding is a report-layer concern.',
    },
  },
  sections: {},
}

for (const section of SECTIONS) {
  process.stderr.write(`· extracting ${section.key}\n`)
  report.sections[section.key] = await section.extract({ db, conventions })
}

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n')
process.stderr.write(`wrote ${OUT_PATH} (${SECTIONS.length} section(s))\n`)
