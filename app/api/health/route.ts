import { supabase } from '@/lib/supabase'
import { checkUpsertConstraintsLive } from '@/lib/upsert-constraint-check-db'
import { checkRegistryMirrorLive } from '@/lib/report-registry-check-db'

export async function GET() {
  const { count, error } = await supabase
    .from('brands')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return Response.json(
      { status: 'error', message: error.message },
      { status: 500 }
    )
  }

  // INB-88: upsert-config vs DB-constraint integrity. A violation is a latent
  // data-integrity warning, not an app-down condition — always HTTP 200 with
  // degraded: true so uptime monitors don't read config drift as downtime. The
  // enforcing (failing) surfaces are the test suite and `npm run check:upsert`.
  // INB-145: the report-registry TS↔DB mirror. Drift means the ingest code's
  // report_key derivation is reasoning off a stale copy — surfaced the same way
  // as the upsert check (degraded, never a failed HTTP). The enforcing surface
  // is `npm run check:registry` + the test suite.
  const [upsertCheck, registryMirror] = await Promise.all([
    checkUpsertConstraintsLive(),
    checkRegistryMirrorLive(),
  ])
  const degraded = upsertCheck.status === 'violations' || registryMirror.status === 'drift'

  return Response.json({
    status: 'ok',
    degraded,
    brands_count: count ?? 0,
    upsert_constraint_check: upsertCheck,
    registry_mirror_check: registryMirror,
  })
}
