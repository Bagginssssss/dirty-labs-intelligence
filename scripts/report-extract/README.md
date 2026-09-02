# report-extract (INB-178 Phase 2)

Read-only extractor that assembles `report-data.json` — the static file the reports app bakes in.
It is an **artifact**: written to `./out/` (gitignored) and moved into the reports repo by hand. Nothing
in this intelligence app imports it.

## Run

```
node --env-file-if-exists=.env.local scripts/report-extract/run.mjs
```

Output: `scripts/report-extract/out/report-data.json` (full precision — rounding is a report-layer concern).

## Layout

- `db.mjs` — read-only Supabase connection (existing service-role credential pattern; SELECT-only helper).
- `conventions.mjs` — brand ID, coverage windows, and the metric definitions (ROAS/ACOS/TACOS/conversion)
  as named functions. Defined **once**; every section imports from here.
- `sections/index.mjs` — ordered registry of section modules. The runner runs each and merges its output.
- `run.mjs` — the runner.

## Rules (query plan v1.2)

- Every query is a SELECT. No writes of any kind.
- ROAS/ACOS/TACOS/conversion are **sum-then-divide over the period**, never averages of daily ratios.
- Ad attribution is `sales_7d`; account revenue is `business_report_daily.ordered_product_sales`.
- August 2026 is 29 days of data, February is 28 — every monthly total needs a daily-rate companion.
- Do not read `derived_metrics_daily` as a source; compute from raw rows and report any disagreement.
