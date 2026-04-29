import { supabase } from '@/lib/supabase'

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

  return Response.json({ status: 'ok', brands_count: count ?? 0 })
}
