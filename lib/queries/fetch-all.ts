// PostgREST silently returns at most 1000 rows by default (its max-rows setting).
// Queries touching large tables (sp_campaign_performance, sp_search_term_report,
// scale_insights_keyword_rank, business_report) must paginate through all pages.
//
// Usage: pass a factory that returns a FRESH query chain on each call —
// the Supabase builder is mutable, so reusing the same chain causes bad state.
//
//   const rows = await fetchAll<MyRow>(() =>
//     supabaseAdmin.from('my_table').select('col').eq('brand_id', id).gte('date', start)
//   )

interface RangeableQuery {
  range(
    from: number,
    to: number
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

export async function fetchAll<T>(buildQuery: () => RangeableQuery): Promise<T[]> {
  const PAGE_SIZE = 5000
  const all: T[] = []
  let offset = 0

  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...(data as T[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return all
}
