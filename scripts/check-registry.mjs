// INB-145 — verifies lib/report-registry.ts (REPORT_REGISTRY_SEED) mirrors the
// live report_registry table exactly. Exit codes: 0 aligned, 1 drift found,
// 2 unavailable (table missing / DB unreachable). CI-safe. Re-run after ANY
// registry migration (INB-146/147/149 all touch the registry).
//
// Run via: npm run check:registry
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local or env).

const { checkRegistryMirrorLive } = await import('../lib/report-registry-check-db.ts')

const result = await checkRegistryMirrorLive()

if (result.status === 'unavailable') {
  console.error(`UNAVAILABLE — ${result.message}`)
  process.exit(2)
}

if (result.status === 'ok') {
  console.log(`OK — report_registry mirror aligned: ${result.rows_checked} rows match lib/report-registry.ts`)
  process.exit(0)
}

console.error(`DRIFT — ${result.message}`)
for (const d of result.diffs) {
  console.error(`  ✗ ${d.report_key}: ${d.reason}`)
}
process.exit(1)
