import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// PostgREST caps every query at 1000 rows by default. Tables like
// seller_monthly and seller_team have thousands of rows per month, so a
// single .select() silently truncates. fetchAllPaged() pages through the
// full result set using .range().
//
// Pass a factory that returns a FRESH query builder each call (a builder can
// only be awaited once):
//   const rows = await fetchAllPaged(() =>
//     supabase.from('seller_monthly').select('*').eq('month', month))
export async function fetchAllPaged(makeQuery, pageSize = 1000) {
  const all = []
  let from = 0
  // Hard cap to avoid an accidental infinite loop (200k rows)
  for (let guard = 0; guard < 200; guard++) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}
