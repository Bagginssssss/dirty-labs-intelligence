import { supabase } from '@/lib/supabase'
import { checkUpsertConstraintsLive } from '@/lib/upsert-constraint-check-db'

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
  const upsertCheck = await checkUpsertConstraintsLive()
  const degraded = upsertCheck.status === 'violations'

  return Response.json({
    status: 'ok',
    degraded,
    brands_count: count ?? 0,
    upsert_constraint_check: upsertCheck,
  })
}
