import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fetchAllPaged } from '../lib/supabase'
import { fmtINR, fmtPct, fmtNum, fmtMonth, courierColor } from '../lib/chartConfig'
import { useMonth } from '../lib/monthContext'
import { PageHeader, TableCard, Spinner, EmptyState, MarginBadge, AlertBanner } from './ui'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'

const PAGE_SIZE = 100

// Fetch per-seller per-courier breakdown on demand
async function fetchSellerCourierBreakdown(userId, month) {
  const { data } = await supabase
    .from('seller_courier_monthly')
    .select('courier,orders,revenue_billed,courier_cost,margin,margin_pct,rto_rate,avg_shipping_charge,avg_weight')
    .eq('month', month)
    .eq('user_id', userId)
    .order('orders', { ascending: false })
  return data ?? []
}

export default function SellerPnL() {
  const { selectedMonth: month } = useMonth()
  const navigate = useNavigate()

  const [sellers, setSellers]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState('revenue_billed')
  const [sortDir, setSortDir]   = useState('desc')
  const [page, setPage]         = useState(1)
  const [marginFilter, setMarginFilter] = useState('all')
  const [expanded, setExpanded]         = useState(null)   // user_id
  const [courierBreakdown, setCourierBreakdown] = useState({}) // user_id → array
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)
      const data = await fetchAllPaged(() =>
        supabase.from('seller_monthly')
          .select('user_id,name,company_name,orders,revenue_billed,courier_cost,margin,rto_count,rto_rate,avg_shipping_charge,avg_weight,weight_discrepancy_count,primary_courier,primary_zone,price_card_id')
          .eq('month', month)
          .order('revenue_billed', { ascending: false })
      )
      setSellers(data.map(s => ({
        ...s,
        margin_pct:     s.revenue_billed > 0 ? (s.margin / s.revenue_billed * 100) : 0,
        disc_pct:       s.orders > 0 ? (s.weight_discrepancy_count / s.orders * 100) : 0,
      })))
      setLoading(false)
    }
    load()
  }, [month])

  const filtered = useMemo(() => {
    let out = sellers
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(s =>
        s.name?.toLowerCase().includes(q) ||
        s.company_name?.toLowerCase().includes(q) ||
        String(s.user_id).includes(q)
      )
    }
    if (marginFilter === 'negative')  out = out.filter(s => s.margin_pct < 0)
    if (marginFilter === 'thin')      out = out.filter(s => s.margin_pct >= 0 && s.margin_pct < 8)
    if (marginFilter === 'healthy')   out = out.filter(s => s.margin_pct >= 8 && s.margin_pct <= 20)
    if (marginFilter === 'overpriced') out = out.filter(s => s.margin_pct > 20)

    return [...out].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [sellers, search, marginFilter, sortKey, sortDir])

  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  // Summary stats
  const totalRevenue  = sellers.reduce((a, s) => a + s.revenue_billed, 0)
  const totalMargin   = sellers.reduce((a, s) => a + s.margin, 0)
  const totalOrders   = sellers.reduce((a, s) => a + s.orders, 0)
  const avgMarginPct  = totalRevenue > 0 ? (totalMargin / totalRevenue * 100) : 0
  const negativeCount = sellers.filter(s => s.margin_pct < 0).length
  const highRtoCount  = sellers.filter(s => s.rto_rate > 25 && s.orders >= 50).length

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortTh = ({ col, children, right = false }) => (
    <th onClick={() => { toggleSort(col); setPage(1) }}
      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={{ color: sortKey === col ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
      {children} {sortKey === col ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </th>
  )

  const EXPORT_COLS = [
    { key:'name', label:'Seller Name' }, { key:'company_name', label:'Company' },
    { key:'orders', label:'Orders' }, { key:'revenue_billed', label:'Revenue ₹' },
    { key:'courier_cost', label:'Courier Cost ₹' }, { key:'margin', label:'Margin ₹' },
    { key:'margin_pct', label:'Margin %' }, { key:'avg_shipping_charge', label:'Avg Charge ₹' },
    { key:'avg_weight', label:'Avg Weight kg' }, { key:'disc_pct', label:'Disc. %' },
    { key:'rto_rate', label:'RTO %' }, { key:'primary_courier', label:'Courier' },
    { key:'price_card_id', label:'Price Card' },
  ]

  if (loading) return <Spinner />
  if (!sellers.length) return <EmptyState body="Upload a monthly CSV to see seller P&L" />

  return (
    <div>
      <PageHeader
        title="Seller P&L"
        subtitle={`${fmtMonth(month)} · ${fmtNum(sellers.length)} sellers · ${fmtINR(totalRevenue)} total revenue`}
        action={<ExportButton onClick={() => exportCSV(`seller-pnl-${month}`, filtered, EXPORT_COLS)} />}
      />

      {/* Summary KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { l:'Total Revenue',    v:fmtINR(totalRevenue), accent:'#2563eb' },
          { l:'Total Margin ₹',   v:fmtINR(totalMargin), accent: totalMargin < 0 ? '#ef4444' : '#10b981',
            sub: `${avgMarginPct.toFixed(1)}% avg margin` },
          { l:'Negative Margin',  v:negativeCount, accent:'#ef4444',
            sub:'sellers losing money' },
          { l:'High RTO (>25%)',  v:highRtoCount, accent:'#f59e0b',
            sub:'50+ orders, RTO above 25%' },
        ].map(({ l, v, accent, sub }) => (
          <div key={l} className="relative overflow-hidden rounded-xl p-5"
            style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
            <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full" style={{ background: accent }} />
            <div className="absolute inset-0 rounded-xl" style={{ background: `${accent}07` }} />
            <div className="relative">
              <p className="text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color:'var(--color-text-muted)' }}>{l}</p>
              <p className="text-xl font-bold" style={{ color:'var(--color-text-primary)' }}>{typeof v === 'number' ? fmtNum(v) : v}</p>
              {sub && <p className="text-xs mt-1" style={{ color:'var(--color-text-muted)' }}>{sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Negative margin alert */}
      {negativeCount > 0 && (
        <AlertBanner type="error"
          title={`${negativeCount} sellers with negative margin this month`}
          body="Shipmozo is losing money on these sellers. Use the Margin filter below to isolate them." />
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4 flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search seller name, company or ID…"
          className="flex-1 min-w-[220px] rounded-lg px-4 py-2 text-sm focus:outline-none"
          style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-primary)' }} />

        {/* Margin filter */}
        <div className="flex gap-1 p-1 rounded-lg flex-shrink-0"
          style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
          {[
            ['all','All'],
            ['negative','Loss'],
            ['thin','Thin (0–8%)'],
            ['healthy','Healthy'],
            ['overpriced','Overpriced (>20%)'],
          ].map(([k,l]) => (
            <button key={k} onClick={() => { setMarginFilter(k); setPage(1) }}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap"
              style={{
                background: marginFilter === k ? 'var(--color-surface)' : 'transparent',
                color: marginFilter === k ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                boxShadow: marginFilter === k ? 'var(--shadow-sm)' : 'none',
              }}>
              {l}
            </button>
          ))}
        </div>

        <span className="text-sm flex-shrink-0" style={{ color:'var(--color-text-muted)' }}>
          {filtered.length} sellers
        </span>
      </div>

      {/* Table */}
      <TableCard>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background:'var(--color-surface-2)', borderBottom:'1px solid var(--color-border-2)' }}>
                <SortTh col="name">Seller</SortTh>
                <SortTh col="orders" right>Orders</SortTh>
                <SortTh col="revenue_billed" right>Revenue</SortTh>
                <SortTh col="courier_cost" right>Courier Cost</SortTh>
                <SortTh col="margin" right>Margin ₹</SortTh>
                <SortTh col="margin_pct" right>Margin %</SortTh>
                <SortTh col="avg_shipping_charge" right>Avg Charge</SortTh>
                <SortTh col="avg_weight" right>Avg Weight</SortTh>
                <SortTh col="disc_pct" right>Disc. %</SortTh>
                <SortTh col="rto_rate" right>RTO %</SortTh>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-left" style={{ color:'var(--color-text-muted)' }}>
                  Couriers
                  <span className="ml-1 font-normal opacity-60" title="All couriers used by this seller. Click row to see per-courier breakdown.">ⓘ</span>
                </th>
                <th className="px-4 py-3 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((s, idx) => {
                const isLast    = idx === paginated.length - 1
                const isOpen    = expanded === s.user_id
                const marginNeg  = s.margin_pct < 0
                const marginThin = !marginNeg && s.margin_pct < 8
                const rtoHigh    = s.rto_rate > 25
                const discHigh   = s.disc_pct > 20

                async function toggleBreakdown() {
                  if (isOpen) { setExpanded(null); return }
                  setExpanded(s.user_id)
                  if (!courierBreakdown[s.user_id]) {
                    setLoadingBreakdown(true)
                    const data = await fetchSellerCourierBreakdown(s.user_id, month)
                    setCourierBreakdown(prev => ({ ...prev, [s.user_id]: data }))
                    setLoadingBreakdown(false)
                  }
                }

                return (
                  <>
                  <tr key={s.user_id}
                    className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                    onClick={toggleBreakdown}
                    style={{ borderBottom: isOpen ? 'none' : isLast ? 'none' : '1px solid var(--color-border-2)' }}>

                    {/* Seller name */}
                    <td className="px-4 py-3">
                      <button onClick={e => { e.stopPropagation(); navigate(`/seller/${s.user_id}`) }}
                        className="font-semibold text-sm text-left hover:underline"
                        style={{ color:'var(--color-primary)' }}>
                        {s.name || `Seller ${s.user_id}`}
                      </button>
                      <p className="text-xs mt-0.5 truncate max-w-[160px]" style={{ color:'var(--color-text-muted)' }}>
                        {s.company_name}
                      </p>
                    </td>

                    {/* Orders */}
                    <td className="px-4 py-3 text-right font-medium text-sm" style={{ color:'var(--color-text-secondary)' }}>
                      {fmtNum(s.orders)}
                    </td>

                    {/* Revenue */}
                    <td className="px-4 py-3 text-right font-semibold text-sm" style={{ color:'var(--color-text-primary)' }}>
                      {fmtINR(s.revenue_billed)}
                    </td>

                    {/* Courier Cost */}
                    <td className="px-4 py-3 text-right text-sm" style={{ color:'var(--color-text-secondary)' }}>
                      {fmtINR(s.courier_cost)}
                    </td>

                    {/* Margin ₹ */}
                    <td className={`px-4 py-3 text-right text-sm font-semibold ${marginNeg ? 'text-red-600' : 'text-emerald-600'}`}>
                      {fmtINR(s.margin)}
                    </td>

                    {/* Margin % */}
                    <td className="px-4 py-3 text-right">
                      <MarginBadge pct={s.margin_pct} />
                    </td>

                    {/* Avg Charge */}
                    <td className="px-4 py-3 text-right text-sm" style={{ color:'var(--color-text-secondary)' }}>
                      ₹{(s.avg_shipping_charge ?? 0).toFixed(0)}
                    </td>

                    {/* Avg Weight */}
                    <td className="px-4 py-3 text-right text-sm" style={{ color:'var(--color-text-secondary)' }}>
                      {s.avg_weight ? `${s.avg_weight.toFixed(2)} kg` : '—'}
                    </td>

                    {/* Disc. % */}
                    <td className="px-4 py-3 text-right">
                      {s.weight_discrepancy_count > 0 ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${discHigh ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                          {s.disc_pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color:'var(--color-border)' }}>—</span>
                      )}
                    </td>

                    {/* RTO % */}
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold ${rtoHigh ? 'text-red-600' : 'text-slate-500'}`}>
                        {fmtPct(s.rto_rate)}
                      </span>
                    </td>

                    {/* Couriers (all, shown as dots) */}
                    <td className="px-4 py-3">
                      <span className="text-xs" style={{ color:'var(--color-text-muted)' }}>
                        {s.primary_courier || '—'}
                        {isOpen && <span className="ml-1 text-blue-400">(expand ↓)</span>}
                      </span>
                    </td>

                    {/* Expand arrow */}
                    <td className="px-4 py-3">
                      <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        style={{ color:'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </td>
                  </tr>

                  {/* ── Courier breakdown row ── */}
                  {isOpen && (
                    <tr key={`${s.user_id}-breakdown`}>
                      <td colSpan={12} className="px-5 py-4"
                        style={{ background:'var(--color-surface-2)', borderBottom: isLast ? 'none' : '1px solid var(--color-border-2)' }}>
                        <div className="flex items-center gap-2 mb-3">
                          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-xs font-semibold" style={{ color:'#1e40af' }}>
                            Per-courier breakdown for <strong>{s.name}</strong> — each row shows metrics for that courier only. Total row = sum of all couriers.
                          </p>
                        </div>

                        {(loadingBreakdown && !courierBreakdown[s.user_id]) ? (
                          <div className="flex items-center gap-2 py-2" style={{ color:'var(--color-text-muted)' }}>
                            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor:'var(--color-primary)', borderTopColor:'transparent' }} />
                            <span className="text-sm">Loading…</span>
                          </div>
                        ) : (courierBreakdown[s.user_id]?.length === 0) ? (
                          <p className="text-sm py-2" style={{ color:'var(--color-text-muted)' }}>
                            No per-courier data — re-upload the CSV to populate this breakdown.
                          </p>
                        ) : (
                          <div className="rounded-xl overflow-hidden"
                            style={{ border:'1px solid var(--color-border)', background:'var(--color-surface)' }}>
                            <table className="w-full text-xs">
                              <thead>
                                <tr style={{ background:'var(--color-surface-2)', borderBottom:'1px solid var(--color-border-2)' }}>
                                  {['Courier','Orders','% of Total','Revenue','Courier Cost','Margin ₹','Margin %','Avg Charge','Avg Weight','RTO %'].map(h => (
                                    <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide whitespace-nowrap"
                                      style={{ color:'var(--color-text-muted)' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(courierBreakdown[s.user_id] ?? []).map((cb, ci) => {
                                  const share = s.orders > 0 ? (cb.orders / s.orders * 100).toFixed(1) : 0
                                  return (
                                    <tr key={ci} className="hover:bg-slate-50 transition-colors"
                                      style={{ borderBottom: ci < (courierBreakdown[s.user_id]?.length ?? 0)-1 ? '1px solid var(--color-border-2)' : 'none' }}>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-full" style={{ background: courierColor(cb.courier) }} />
                                          <span className="font-semibold" style={{ color:'var(--color-text-primary)' }}>{cb.courier}</span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 font-medium" style={{ color:'var(--color-text-secondary)' }}>{fmtNum(cb.orders)}</td>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background:'var(--color-border)' }}>
                                            <div className="h-full rounded-full" style={{ width:`${share}%`, background: courierColor(cb.courier) }} />
                                          </div>
                                          <span style={{ color:'var(--color-text-muted)' }}>{share}%</span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 font-medium" style={{ color:'var(--color-text-primary)' }}>{fmtINR(cb.revenue_billed)}</td>
                                      <td className="px-3 py-2" style={{ color:'var(--color-text-secondary)' }}>{fmtINR(cb.courier_cost)}</td>
                                      <td className={`px-3 py-2 font-semibold ${cb.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtINR(cb.margin)}</td>
                                      <td className="px-3 py-2"><MarginBadge pct={cb.margin_pct} /></td>
                                      <td className="px-3 py-2" style={{ color:'var(--color-text-secondary)' }}>₹{cb.avg_shipping_charge?.toFixed(0)}</td>
                                      <td className="px-3 py-2" style={{ color:'var(--color-text-secondary)' }}>{cb.avg_weight > 0 ? `${cb.avg_weight.toFixed(2)} kg` : '—'}</td>
                                      <td className={`px-3 py-2 font-semibold ${cb.rto_rate > 25 ? 'text-red-600' : 'text-slate-500'}`}>{fmtPct(cb.rto_rate)}</td>
                                    </tr>
                                  )
                                })}
                                {/* Total row */}
                                <tr style={{ background:'var(--color-surface-2)', borderTop:'2px solid var(--color-border)' }}>
                                  <td className="px-3 py-2 font-bold text-xs" style={{ color:'var(--color-text-primary)' }}>TOTAL</td>
                                  <td className="px-3 py-2 font-bold text-xs" style={{ color:'var(--color-text-primary)' }}>{fmtNum(s.orders)}</td>
                                  <td className="px-3 py-2 text-xs" style={{ color:'var(--color-text-muted)' }}>100%</td>
                                  <td className="px-3 py-2 font-bold text-xs" style={{ color:'var(--color-text-primary)' }}>{fmtINR(s.revenue_billed)}</td>
                                  <td className="px-3 py-2 font-bold text-xs" style={{ color:'var(--color-text-primary)' }}>{fmtINR(s.courier_cost)}</td>
                                  <td className={`px-3 py-2 font-bold text-xs ${s.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtINR(s.margin)}</td>
                                  <td className="px-3 py-2"><MarginBadge pct={s.margin_pct} /></td>
                                  <td className="px-3 py-2 font-bold text-xs" style={{ color:'var(--color-text-primary)' }}>₹{(s.avg_shipping_charge ?? 0).toFixed(0)}</td>
                                  <td className="px-3 py-2 font-bold text-xs" style={{ color:'var(--color-text-primary)' }}>{s.avg_weight > 0 ? `${s.avg_weight.toFixed(2)} kg` : '—'}</td>
                                  <td className={`px-3 py-2 font-bold text-xs ${s.rto_rate > 25 ? 'text-red-600' : 'text-slate-500'}`}>{fmtPct(s.rto_rate)}</td>
                                </tr>
                              </tbody>
                            </table>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3"
            style={{ borderTop:'1px solid var(--color-border-2)' }}>
            <span className="text-sm" style={{ color:'var(--color-text-muted)' }}>
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, filtered.length)} of {fmtNum(filtered.length)}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors"
                style={{ borderColor:'var(--color-border)' }}>←</button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const p = totalPages <= 7 ? i+1 : page <= 4 ? i+1 : page >= totalPages-3 ? totalPages-6+i : page-3+i
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className="w-8 h-8 rounded-lg text-sm font-medium transition-all"
                    style={{
                      background: p === page ? 'var(--color-primary)' : 'transparent',
                      color: p === page ? '#fff' : 'var(--color-text-muted)',
                      border: p === page ? 'none' : '1px solid var(--color-border)',
                    }}>
                    {p}
                  </button>
                )
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors"
                style={{ borderColor:'var(--color-border)' }}>→</button>
            </div>
          </div>
        )}
      </TableCard>
    </div>
  )
}
