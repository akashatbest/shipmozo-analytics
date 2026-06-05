import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// PostgREST caps every query at 1000 rows by default. Tables like
// seller_monthly and seller_team have thousands of rows per month, so a
// single .select() silently truncates. fetchAllPaged() pages through the
// full result set using .range().
//
// Pages are fetched in PARALLEL BATCHES (not sequentially) — for a 13k-row
// table this turns ~14 sequential round-trips into ~3 parallel batches,
// roughly a 5x speedup.
//
// Pass a factory that returns a FRESH query builder each call (a builder can
// only be awaited once):
//   const rows = await fetchAllPaged(() =>
//     supabase.from('seller_monthly').select('*').eq('month', month))
export async function fetchAllPaged(makeQuery, pageSize = 1000, concurrency = 6) {
  const all = []
  let from = 0

  // Fire `concurrency` page requests at once. If every page in the batch came
  // back full, there may be more — fire the next batch. Stop as soon as any
  // page returns fewer than pageSize rows (we've reached the end).
  for (let guard = 0; guard < 50; guard++) {
    const batch = []
    for (let i = 0; i < concurrency; i++) {
      const start = from + i * pageSize
      batch.push(makeQuery().range(start, start + pageSize - 1))
    }
    const results = await Promise.all(batch)

    let fullPages = 0
    for (const { data, error } of results) {
      if (error) throw new Error(error.message)
      const rows = data ?? []
      all.push(...rows)
      if (rows.length === pageSize) fullPages++
    }

    if (fullPages < concurrency) break  // reached the end
    from += concurrency * pageSize
  }
  return all
}
