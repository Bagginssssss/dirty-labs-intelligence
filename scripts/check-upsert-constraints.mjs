// INB-88 — verifies every configured upsert conflict key has a matching UNIQUE
// constraint in the live database. Exit codes: 0 all aligned, 1 violations found,
// 2 introspection unavailable (RPC missing / DB unreachable). CI-safe.
//
// Run via: npm run check:upsert
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local or env).

const { checkUpsertConstraintsLive } = await import('../lib/upsert-constraint-check-db.ts')
const { ALL_UPSERT_CONFLICT_KEYS } = await import('../lib/upsert-config.ts')

const result = await checkUpsertConstraintsLive()

if (result.status === 'unavailable') {
  console.error(`UNAVAILABLE — ${result.message}`)
  process.exit(2)
}

if (result.status === 'ok') {
  console.log(`OK — all ${result.tables_checked} configured upsert conflict keys have a matching UNIQUE constraint:`)
  for (const [table, key] of Object.entries(ALL_UPSERT_CONFLICT_KEYS)) {
    console.log(`  ✓ ${table} (${key})`)
  }
  process.exit(0)
}

console.error(`VIOLATIONS — ${result.message}`)
for (const v of result.violations) {
  console.error(`  ✗ ${v.table}: configured (${v.configuredKey}) — ${v.reason}`)
}
process.exit(1)
