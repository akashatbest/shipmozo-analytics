import { useState, useEffect, useMemo } from 'react'
import { supabase, fetchAllPaged } from '../lib/supabase'
import { fmtINR, fmtPct, fmtNum, fmtMonth } from '../lib/chartConfig'
import { useMonth } from '../lib/monthContext'
import { PageHeader, Spinner, EmptyState, MarginBadge } from './ui'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'
import { useNavigate } from 'react-router-dom'

// Turn raw sums (from RPC or fallback) into the display row with derived ratios
function deriveBranchStats(r) {
  const revenue = r.revenue ?? 0
  const orders  = r.orders ?? 0
  return {
    id:           r.branch_id,
    name:         r.branch_name,
    city:         r.city,
    spoc_count:   r.spoc_count ?? 0,
    seller_count: r.seller_count ?? 0,
    orders,
    revenue,
    margin:       r.margin ?? 0,
    margin_pct:   revenue > 0 ? (r.margin / revenue * 100) : 0,
    avg_charge:   orders > 0 ? (r.total_charge / orders) : 0,
    avg_weight:   (r.weight_orders ?? 0) > 0 ? (r.total_weight / r.weight_orders) : 0,
    disc_pct:     orders > 0 ? (r.disc_orders / orders * 100) : 0,
    rto_rate:     orders > 0 ? (r.rto_orders / orders * 100) : 0,
  }
}

export default function BranchReport() {
  const { selectedMonth: month } = useMonth()
  const navigate = useNavigate()

  const [branches, setBranches]     = useState([])
  const [rawStats, setRawStats]     = useState([])   // pre-aggregated branch rows
  const [unmapped, setUnmapped]     = useState(0)
  const [loading, setLoading]       = useState(true)
  const [expanded, setExpanded]     = useState(null) // branch_id
  const [branchSellers, setBranchSellers] = useState({}) // branchId → sellers[]
  const [loadingSellers, setLoadingSellers] = useState(false)
  const [sortKey, setSortKey]       = useState('revenue')
  const [sortDir, setSortDir]       = useState('desc')

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)
      setExpanded(null); setBranchSellers({})

      const { data: br } = await supabase.from('branches').select('*').order('name')
      setBranches(br ?? [])
      if (!br?.length) { setLoading(false); return }

      // ── Fast path: database-side aggregation via RPC ──
      const { data: rpc, error } = await supabase.rpc('get_branch_report', { p_month: month })

      if (!error && rpc) {
        setRawStats(rpc.map(r => deriveBranchStats(r)))
        // unmapped count (cheap RPC; fall back to 0 if not present)
        const { data: um } = await supabase.rpc('get_unmapped_seller_count', { p_month: month })
        setUnmapped(typeof um === 'number' ? um : 0)
        setLoading(false)
        return
      }

      // ── Fallback: client-side aggregation (used if RPC not installed) ──
      const [{ data: sbm }, team, sm] = await Promise.all([
        supabase.from('spoc_branch_map').select('spoc_name,branch_id'),
        fetchAllPaged(() => supabase.from('seller_team').select('user_id,spoc')),
        fetchAllPaged(() =>
          supabase.from('seller_monthly')
            .select('user_id,orders,revenue_billed,courier_cost,margin,rto_count,avg_shipping_charge,avg_weight,weight_discrepancy_count')
            .eq('month', month)
        ),
      ])
      const spocMap     = Object.fromEntries((sbm ?? []).map(r => [r.spoc_name, r.branch_id]))
      const sellerToSpoc = Object.fromEntries(team.map(t => [t.user_id, t.spoc]))  // build ONCE (was the O(n²) bug)

      const acc = {}
      let unmappedCount = 0
      for (const s of sm) {
        const branchId = spocMap[sellerToSpoc[s.user_id]]
        if (!branchId) { unmappedCount++; continue }
        if (!acc[branchId]) acc[branchId] = { branch_id: branchId, spocs: new Set(), sellers: 0, orders: 0, revenue: 0, courier_cost: 0, margin: 0, total_charge: 0, total_weight: 0, weight_orders: 0, disc_orders: 0, rto_orders: 0 }
        const a = acc[branchId]
        a.spocs.add(sellerToSpoc[s.user_id]); a.sellers++
        a.orders += s.orders ?? 0; a.revenue += s.revenue_billed ?? 0
        a.courier_cost += s.courier_cost ?? 0; a.margin += s.margin ?? 0
        a.total_charge += (s.avg_shipping_charge ?? 0) * (s.orders ?? 0)
        if (s.avg_weight > 0) { a.total_weight += s.avg_weight * (s.orders ?? 0); a.weight_orders += s.orders ?? 0 }
        a.disc_orders += s.weight_discrepancy_count ?? 0
        a.rto_orders += s.rto_count ?? 0
      }
      setRawStats((br ?? []).map(b => {
        const a = acc[b.id]
        return deriveBranchStats({
          branch_id: b.id, branch_name: b.name, city: b.city,
          spoc_count: a ? a.spocs.size : 0, seller_count: a ? a.sellers : 0,
          orders: a?.orders ?? 0, revenue: a?.revenue ?? 0, courier_cost: a?.courier_cost ?? 0,
          margin: a?.margin ?? 0, total_charge: a?.total_charge ?? 0,
          total_weight: a?.total_weight ?? 0, weight_orders: a?.weight_orders ?? 0,
          disc_orders: a?.disc_orders ?? 0, rto_orders: a?.rto_orders ?? 0,
        })
      }))
      setUnmapped(unmappedCount)
      setLoading(false)
    }
    load()
  }, [month])

  // Sort the small pre-aggregated set (≈ number of branches — trivial)
  const branchStats = useMemo(() => {
    return [...rawStats].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
      if (sortKey === 'name') return sortDir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [rawStats, sortKey, sortDir])

  const totalRevenue = rawStats.reduce((a, b) => a + b.revenue, 0)
  const totalMargin  = rawStats.reduce((a, b) => a + b.margin, 0)
  const totalOrders  = rawStats.reduce((a, b) => a + b.orders, 0)

  // Load a branch's top sellers on demand (only when expanded)
  async function toggleExpand(branchId) {
    if (expanded === branchId) { setExpanded(null); return }
    setExpanded(branchId)
    if (branchSellers[branchId]) return
    setLoadingSellers(true)
    let sellers = []
    const { data: rpc, error } = await supabase.rpc('get_branch_sellers', { p_month: month, p_branch_id: branchId })
    if (!error && rpc) {
      sellers = rpc.map(s => ({ ...s, revenue_billed: s.revenue_billed, spoc_name: s.spoc }))
    }
    setBranchSellers(prev => ({ ...prev, [branchId]: sellers }))
    setLoadingSellers(false)
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortTh = ({ col, children, right = false }) => (
    <th onClick={() => toggleSort(col)}
      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={{ color: sortKey === col ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
      {children} {sortKey === col ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </th>
  )

  const EXPORT_COLS = [
    { key:'name', label:'Branch Name' }, { key:'city', label:'City' },
    { key:'spoc_count', label:'No. of SPOCs' }, { key:'seller_count', label:'No. of Clients' },
    { key:'orders', label:'Orders' }, { key:'revenue', label:'Revenue ₹' },
    { key:'margin', label:'Margin ₹' }, { key:'margin_pct', label:'Margin %' },
    { key:'avg_charge', label:'Avg Charge ₹' }, { key:'avg_weight', label:'Avg Weight kg' },
    { key:'disc_pct', label:'Disc. %' }, { key:'rto_rate', label:'RTO %' },
  ]

  if (loading) return <Spinner />

  if (!branches.length) return (
    <div>
      <PageHeader title="Branch Report" subtitle={fmtMonth(month)} />
      <div className="rounded-xl p-8 text-center"
        style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
        <p className="font-semibold" style={{ color:'var(--color-text-primary)' }}>No branches created yet</p>
        <p className="text-sm mt-1 mb-4" style={{ color:'var(--color-text-muted)' }}>
          Create branches and assign SPOCs first
        </p>
        <button onClick={() => navigate('/branch-management')}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background:'var(--color-primary)' }}>
          Go to Branch Management →
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Branch Report"
        subtitle={`${fmtMonth(month)} · ${branches.length} branches`}
        action={<ExportButton onClick={() => exportCSV(`branch-report-${month}`, branchStats, EXPORT_COLS)} />}
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { l:'Total Revenue',   v: fmtINR(totalRevenue), accent:'#2563eb' },
          { l:'Total Margin ₹',  v: fmtINR(totalMargin),  accent: totalMargin >= 0 ? '#10b981' : '#ef4444',
            sub:`${totalRevenue > 0 ? (totalMargin/totalRevenue*100).toFixed(1) : 0}% margin rate` },
          { l:'Total Orders',    v: fmtNum(totalOrders),  accent:'#8b5cf6' },
          { l:'Unmapped Sellers',v: fmtNum(unmapped), accent:'#f59e0b',
            sub:'sellers with no branch assignment' },
        ].map(({ l, v, accent, sub }) => (
          <div key={l} className="relative overflow-hidden rounded-xl p-5"
            style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
            <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full" style={{ background: accent }} />
            <div className="absolute inset-0 rounded-xl" style={{ background:`${accent}07` }} />
            <div className="relative">
              <p className="text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color:'var(--color-text-muted)' }}>{l}</p>
              <p className="text-xl font-bold" style={{ color:'var(--color-text-primary)' }}>{v}</p>
              {sub && <p className="text-xs mt-1" style={{ color:'var(--color-text-muted)' }}>{sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {unmapped > 0 && (
        <div className="rounded-xl p-4 mb-5 flex items-center justify-between"
          style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.2)' }}>
          <p className="text-sm" style={{ color:'#92400e' }}>
            <strong>{fmtNum(unmapped)} sellers</strong> are not mapped to any branch (SPOC has no branch assigned).
            Revenue from these sellers won't appear in any branch report.
          </p>
          <button onClick={() => navigate('/branch-management')}
            className="ml-4 flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>
            Assign branches →
          </button>
        </div>
      )}

      {/* Main report table */}
      <div className="rounded-xl overflow-hidden"
        style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background:'var(--color-surface-2)', borderBottom:'1px solid var(--color-border-2)' }}>
                <SortTh col="name">Branch</SortTh>
                <SortTh col="spoc_count" right>SPOCs</SortTh>
                <SortTh col="seller_count" right>Clients</SortTh>
                <SortTh col="orders" right>Orders</SortTh>
                <SortTh col="revenue" right>Revenue</SortTh>
                <SortTh col="margin" right>Margin ₹</SortTh>
                <SortTh col="margin_pct" right>Margin %</SortTh>
                <SortTh col="avg_charge" right>Avg Charge</SortTh>
                <SortTh col="avg_weight" right>Avg Weight</SortTh>
                <SortTh col="disc_pct" right>Disc. %</SortTh>
                <SortTh col="rto_rate" right>RTO %</SortTh>
                <th className="px-4 py-3 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {branchStats.map((b, idx) => {
                const isOpen = expanded === b.id
                const isLast = idx === branchStats.length - 1
                const branchColor = `hsl(${(b.name.charCodeAt(0)*41)%360},60%,50%)`

                return (
                  <>
                    <tr key={b.id}
                      onClick={() => toggleExpand(b.id)}
                      className="cursor-pointer hover:bg-blue-50/30 transition-colors"
                      style={{ borderBottom: isOpen ? 'none' : isLast ? 'none' : '1px solid var(--color-border-2)' }}>

                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ background: branchColor }}>
                            {b.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-sm" style={{ color:'var(--color-text-primary)' }}>{b.name}</p>
                            {b.city && <p className="text-xs" style={{ color:'var(--color-text-muted)' }}>{b.city}</p>}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right text-sm font-medium" style={{ color:'var(--color-text-secondary)' }}>
                        {b.spoc_count}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-medium" style={{ color:'var(--color-text-secondary)' }}>
                        {fmtNum(b.seller_count)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-medium" style={{ color:'var(--color-text-secondary)' }}>
                        {fmtNum(b.orders)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-semibold" style={{ color:'var(--color-text-primary)' }}>
                        {fmtINR(b.revenue)}
                      </td>
                      <td className={`px-4 py-3.5 text-right text-sm font-semibold ${b.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {fmtINR(b.margin)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <MarginBadge pct={b.margin_pct} />
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm" style={{ color:'var(--color-text-secondary)' }}>
                        ₹{b.avg_charge.toFixed(0)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm" style={{ color:'var(--color-text-secondary)' }}>
                        {b.avg_weight > 0 ? `${b.avg_weight.toFixed(2)} kg` : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {b.disc_pct > 0 ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${b.disc_pct > 15 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                            {b.disc_pct.toFixed(1)}%
                          </span>
                        ) : <span style={{ color:'var(--color-border)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`text-sm font-semibold ${b.rto_rate > 25 ? 'text-red-600' : 'text-slate-500'}`}>
                          {fmtPct(b.rto_rate)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          style={{ color:'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </td>
                    </tr>

                    {/* SPOC breakdown for this branch */}
                    {isOpen && (
                      <tr key={`${b.id}-spoc`}>
                        <td colSpan={12} className="px-5 py-4"
                          style={{ background:'var(--color-surface-2)', borderBottom: isLast ? 'none' : '1px solid var(--color-border-2)' }}>
                          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color:'var(--color-text-muted)' }}>
                            {b.name} — Top Sellers
                          </p>
                          {loadingSellers && !branchSellers[b.id] ? (
                            <div className="flex items-center gap-2 py-3" style={{ color:'var(--color-text-muted)' }}>
                              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor:'var(--color-primary)', borderTopColor:'transparent' }} />
                              <span className="text-sm">Loading sellers…</span>
                            </div>
                          ) : (branchSellers[b.id]?.length === 0) ? (
                            <p className="text-sm py-3" style={{ color:'var(--color-text-muted)' }}>
                              No seller data. Run the SQL migration (get_branch_sellers) to enable this drill-down.
                            </p>
                          ) : (
                          <div className="rounded-xl overflow-hidden"
                            style={{ border:'1px solid var(--color-border)', background:'var(--color-surface)' }}>
                            <div className="overflow-x-auto" style={{ maxHeight: 320 }}>
                              <table className="w-full text-xs">
                                <thead className="sticky top-0" style={{ background:'var(--color-surface-2)', zIndex:1 }}>
                                  <tr style={{ borderBottom:'1px solid var(--color-border-2)' }}>
                                    {['Seller','SPOC','Orders','Revenue','Margin %','RTO %'].map(h => (
                                      <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide"
                                        style={{ color:'var(--color-text-muted)' }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(branchSellers[b.id] ?? []).map((s, i, arr) => {
                                    const mp = s.revenue_billed > 0 ? (s.margin / s.revenue_billed * 100) : 0
                                    return (
                                      <tr key={s.user_id} className="hover:bg-slate-50 transition-colors cursor-pointer"
                                        onClick={() => navigate(`/seller/${s.user_id}`)}
                                        style={{ borderBottom: i < arr.length-1 ? '1px solid var(--color-border-2)' : 'none' }}>
                                        <td className="px-3 py-2">
                                          <p className="font-medium" style={{ color:'var(--color-primary)' }}>{s.name || `Seller ${s.user_id}`}</p>
                                          <p className="opacity-60">{s.company_name}</p>
                                        </td>
                                        <td className="px-3 py-2 text-xs" style={{ color:'var(--color-text-muted)' }}>{s.spoc_name}</td>
                                        <td className="px-3 py-2" style={{ color:'var(--color-text-secondary)' }}>{fmtNum(s.orders)}</td>
                                        <td className="px-3 py-2 font-medium" style={{ color:'var(--color-text-primary)' }}>{fmtINR(s.revenue_billed)}</td>
                                        <td className="px-3 py-2">
                                          <MarginBadge pct={mp} />
                                        </td>
                                        <td className={`px-3 py-2 font-semibold ${s.rto_rate > 25 ? 'text-red-600' : 'text-slate-500'}`}>
                                          {fmtPct(s.rto_rate)}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
