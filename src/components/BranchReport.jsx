import { useState, useEffect, useMemo } from 'react'
import { supabase, fetchAllPaged } from '../lib/supabase'
import { fmtINR, fmtPct, fmtNum, fmtMonth } from '../lib/chartConfig'
import { useMonth } from '../lib/monthContext'
import { PageHeader, Spinner, EmptyState, MarginBadge } from './ui'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'
import { useNavigate } from 'react-router-dom'

export default function BranchReport() {
  const { selectedMonth: month } = useMonth()
  const navigate = useNavigate()

  const [branches, setBranches]   = useState([])
  const [spocMap, setSpocMap]     = useState({})   // spoc_name → branch_id
  const [sellerTeam, setSellerTeam] = useState([]) // user_id → spoc_name
  const [sellerData, setSellerData] = useState([]) // seller_monthly rows
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState(null) // branch_id
  const [sortKey, setSortKey]     = useState('revenue')
  const [sortDir, setSortDir]     = useState('desc')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: br }, { data: sbm }, team, sm] = await Promise.all([
        supabase.from('branches').select('*').order('name'),
        supabase.from('spoc_branch_map').select('spoc_name,branch_id'),
        fetchAllPaged(() => supabase.from('seller_team').select('user_id,spoc')),
        fetchAllPaged(() =>
          supabase.from('seller_monthly')
            .select('user_id,name,company_name,orders,revenue_billed,courier_cost,margin,rto_count,rto_rate,avg_shipping_charge,avg_weight,weight_discrepancy_count')
            .eq('month', month)
        ),
      ])
      setBranches(br ?? [])
      const sMap = Object.fromEntries((sbm ?? []).map(r => [r.spoc_name, r.branch_id]))
      setSpocMap(sMap)
      setSellerTeam(team)
      setSellerData(sm)
      setLoading(false)
    }
    if (month) load()
  }, [month])

  // ── Build branch-level aggregates ──────────────────────────────────────────

  const branchStats = useMemo(() => {
    if (!branches.length) return []

    // seller_id → spoc_name
    const sellerToSpoc = Object.fromEntries(sellerTeam.map(t => [t.user_id, t.spoc]))

    // spoc_name → branch_id
    // branchId → accumulator
    const acc = {}
    const branchSellers = {}  // branchId → seller details array

    for (const s of sellerData) {
      const spoc     = sellerToSpoc[s.user_id]
      const branchId = spocMap[spoc]
      if (!branchId) continue

      if (!acc[branchId]) {
        acc[branchId] = {
          spocs: new Set(), sellers: new Set(),
          orders: 0, revenue: 0, margin: 0,
          totalCharge: 0, totalWeight: 0, weightOrders: 0,
          discOrders: 0, rtoOrders: 0,
        }
        branchSellers[branchId] = []
      }
      const a = acc[branchId]
      a.spocs.add(spoc)
      a.sellers.add(s.user_id)
      a.orders   += s.orders ?? 0
      a.revenue  += s.revenue_billed ?? 0
      a.margin   += s.margin ?? 0
      a.totalCharge  += (s.avg_shipping_charge ?? 0) * (s.orders ?? 0)
      if (s.avg_weight > 0) { a.totalWeight += (s.avg_weight ?? 0) * (s.orders ?? 0); a.weightOrders += s.orders ?? 0 }
      a.discOrders   += s.weight_discrepancy_count ?? 0
      a.rtoOrders    += s.rto_count ?? 0
      branchSellers[branchId].push({ ...s, spoc_name: spoc })
    }

    return branches
      .map(b => {
        const a = acc[b.id]
        if (!a) return { ...b, orders: 0, revenue: 0, margin: 0, margin_pct: 0, avg_charge: 0, avg_weight: 0, disc_pct: 0, rto_rate: 0, spoc_count: 0, seller_count: 0, sellers: [] }
        const margin_pct = a.revenue > 0 ? (a.margin / a.revenue * 100) : 0
        return {
          ...b,
          spoc_count:  a.spocs.size,
          seller_count: a.sellers.size,
          orders:      a.orders,
          revenue:     a.revenue,
          margin:      a.margin,
          margin_pct,
          avg_charge:  a.orders > 0 ? a.totalCharge / a.orders : 0,
          avg_weight:  a.weightOrders > 0 ? a.totalWeight / a.weightOrders : 0,
          disc_pct:    a.orders > 0 ? (a.discOrders / a.orders * 100) : 0,
          rto_rate:    a.orders > 0 ? (a.rtoOrders / a.orders * 100) : 0,
          sellers:     (branchSellers[b.id] ?? []).sort((x, y) => y.revenue_billed - x.revenue_billed),
        }
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
        return sortDir === 'desc' ? bv - av : av - bv
      })
  }, [branches, spocMap, sellerTeam, sellerData, sortKey, sortDir])

  const totalRevenue = branchStats.reduce((a, b) => a + b.revenue, 0)
  const totalMargin  = branchStats.reduce((a, b) => a + b.margin, 0)
  const totalOrders  = branchStats.reduce((a, b) => a + b.orders, 0)
  const unmapped     = sellerData.filter(s => {
    const spoc = Object.fromEntries(sellerTeam.map(t => [t.user_id, t.spoc]))[s.user_id]
    return !spocMap[spoc]
  }).length

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
                      onClick={() => setExpanded(isOpen ? null : b.id)}
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
                                  {b.sellers.slice(0, 25).map((s, i) => {
                                    const mp = s.revenue_billed > 0 ? (s.margin / s.revenue_billed * 100) : 0
                                    return (
                                      <tr key={s.user_id} className="hover:bg-slate-50 transition-colors cursor-pointer"
                                        onClick={() => navigate(`/seller/${s.user_id}`)}
                                        style={{ borderBottom: i < Math.min(b.sellers.length, 25)-1 ? '1px solid var(--color-border-2)' : 'none' }}>
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
                                  {b.sellers.length > 25 && (
                                    <tr><td colSpan={6} className="px-3 py-2 text-center" style={{ color:'var(--color-text-muted)' }}>
                                      +{b.sellers.length - 25} more sellers in this branch
                                    </td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
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
