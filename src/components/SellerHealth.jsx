import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fmtINR, fmtPct, fmtNum, fmtMonth } from '../lib/chartConfig'
import { PageHeader, TableCard, Spinner, EmptyState } from './ui'
import { useMonth } from '../lib/monthContext'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'

const PAGE_SIZE = 50

function getRiskTags(seller) {
  const tags = []
  if ((seller.current_rto ?? 0) > 35)      tags.push({ label: `${fmtPct(seller.current_rto)} RTO`, color: 'red' })
  else if ((seller.current_rto ?? 0) > 25) tags.push({ label: `${fmtPct(seller.current_rto)} RTO`, color: 'amber' })
  if (seller.rto_trend === 'worsening')     tags.push({ label: 'RTO ↑', color: 'red' })
  if (seller.volume_trend === 'declining')  tags.push({ label: 'Volume ↓', color: 'amber' })
  if (seller.volume_trend === 'new')        tags.push({ label: 'New', color: 'blue' })
  if (seller.volume_trend === 'growing')    tags.push({ label: 'Growing ↑', color: 'green' })
  return tags
}

const TAG_STYLES = {
  red:   'bg-red-50   text-red-700   border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue:  'bg-blue-50  text-blue-700  border-blue-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const SCORE_COLOR = s => s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : '#ef4444'
const RISK_STYLES = {
  red:   { bg:'#fef2f2', text:'#dc2626', border:'#fecaca' },
  amber: { bg:'#fffbeb', text:'#d97706', border:'#fde68a' },
  green: { bg:'#f0fdf4', text:'#16a34a', border:'#a7f3d0' },
}

const MIN_ORDER_OPTIONS = [
  { label: 'All', value: 0 },
  { label: '50+ orders', value: 50 },
  { label: '200+ orders', value: 200 },
  { label: '1000+ orders', value: 1000 },
]

export default function SellerHealth() {
  const { selectedMonth } = useMonth()
  const navigate = useNavigate()
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [riskFilter, setRisk]   = useState('all')
  const [minOrders, setMinOrders] = useState(50)
  const [sortKey, setSortKey]   = useState('health_score')
  const [sortDir, setSortDir]   = useState('asc')
  const [page, setPage]         = useState(1)

  useEffect(() => {
    if (!selectedMonth) return
    async function load() {
      const latest = selectedMonth

      const { data: health } = await supabase
        .from('seller_health')
        .select('user_id,health_score,risk_level,volume_trend,rto_trend,revenue_at_risk,sellers!inner(name,company_name,primary_courier)')
        .order('health_score', { ascending: true })

      let revenueMap = {}
      if (latest && health?.length) {
        const ids = health.map(h => h.user_id)
        for (let i = 0; i < ids.length; i += 100) {
          const { data: sm } = await supabase
            .from('seller_monthly')
            .select('user_id,orders,revenue_billed,margin,rto_count,rto_rate,avg_shipping_charge')
            .eq('month', latest).in('user_id', ids.slice(i, i + 100))
          for (const r of sm ?? []) revenueMap[r.user_id] = r
        }
      }

      setRows((health ?? []).map(h => ({
        ...h,
        name:            h.sellers?.name ?? '',
        company_name:    h.sellers?.company_name ?? '',
        primary_courier: h.sellers?.primary_courier ?? '',
        current_orders:  revenueMap[h.user_id]?.orders ?? 0,
        current_revenue: revenueMap[h.user_id]?.revenue_billed ?? 0,
        current_margin:  revenueMap[h.user_id]?.margin ?? 0,
        current_rto:     revenueMap[h.user_id]?.rto_rate ?? 0,
        rto_count:       revenueMap[h.user_id]?.rto_count ?? 0,
        avg_charge:      revenueMap[h.user_id]?.avg_shipping_charge ?? 0,
      })))
      setLoading(false)
    }
    load()
  }, [selectedMonth])

  // Filter + sort
  const filtered = (() => {
    let out = rows
    if (riskFilter !== 'all') out = out.filter(r => r.risk_level === riskFilter)
    if (minOrders > 0) out = out.filter(r => r.current_orders >= minOrders)
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(r => r.name?.toLowerCase().includes(q) || r.company_name?.toLowerCase().includes(q) || String(r.user_id).includes(q))
    }
    return [...out].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
      return sortDir === 'asc' ? av - bv : bv - av
    })
  })()

  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const counts = {
    red:   rows.filter(r => r.risk_level === 'red').length,
    amber: rows.filter(r => r.risk_level === 'amber').length,
    green: rows.filter(r => r.risk_level === 'green').length,
  }
  const highRtoCount     = rows.filter(r => r.current_rto > 35 && r.current_orders >= 50).length
  const totalAtRiskRev   = rows.filter(r => r.risk_level !== 'green' && r.current_orders >= 50).reduce((a, r) => a + r.current_revenue, 0)

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortHeader = ({ col, children, right = false }) => (
    <button onClick={() => toggleSort(col)}
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide w-full ${right ? 'justify-end' : ''}`}
      style={{ color: sortKey === col ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
      {children}
      <span className="opacity-60">{sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
    </button>
  )

  if (loading) return <Spinner />
  if (!rows.length) return <EmptyState body="Upload a monthly CSV to see seller health scores" />

  return (
    <div>
      <PageHeader title="Seller Health" subtitle={fmtMonth(selectedMonth)}
      action={<ExportButton onClick={() => exportCSV(`seller-health-${selectedMonth}`, filtered, [
        { key:'name', label:'Seller' }, { key:'company_name', label:'Company' },
        { key:'health_score', label:'Score' }, { key:'risk_level', label:'Risk' },
        { key:'current_orders', label:'Orders' }, { key:'current_revenue', label:'Revenue' },
        { key:'current_margin', label:'Margin ₹' }, { key:'current_rto', label:'RTO %' },
        { key:'primary_courier', label:'Courier' },
      ])} />} />

      {/* How to read */}
      <div className="rounded-xl p-4 mb-5 flex items-start gap-3 text-sm"
        style={{ background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.12)' }}>
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p style={{ color: '#1e40af' }}>
          <strong>Score</strong> 0–100: volume trend + RTO + consistency + tenure.
          {' '}<strong>RTO cost</strong> = returns × avg charge × 2 (you pay both ways).
          {' '}<strong>Revenue at risk</strong> = monthly loss if seller churns due to poor experience.
        </p>
      </div>

      {/* Alert */}
      {highRtoCount > 0 && (
        <div className="rounded-xl p-4 mb-5 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm" style={{ color: '#991b1b' }}>
            <strong>{highRtoCount} sellers with RTO above 35%</strong> (50+ orders) — 1 in 3 shipments returning.
            Investigate: wrong addresses, COD fraud, or product quality issues.
          </p>
        </div>
      )}

      {/* Risk summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {(['red','amber','green']).map(key => {
          const s = RISK_STYLES[key]
          const labels = { red: 'High Risk', amber: 'At Risk', green: 'Healthy' }
          const subs   = { red: 'Score < 40', amber: 'Score 40–69', green: 'Score ≥ 70' }
          return (
            <button key={key} onClick={() => setRisk(f => f === key ? 'all' : f === key ? 'all' : key)}
              className="rounded-xl p-5 text-left transition-all"
              style={{
                background: s.bg, border: `1px solid ${riskFilter === key ? s.text : s.border}`,
                boxShadow: riskFilter === key ? `0 0 0 3px ${s.text}22` : 'var(--shadow-sm)',
              }}>
              <p className="text-3xl font-bold" style={{ color: s.text }}>{counts[key]}</p>
              <p className="text-sm font-semibold mt-1" style={{ color: s.text }}>{labels[key]}</p>
              <p className="text-xs mt-0.5 opacity-70" style={{ color: s.text }}>{subs[key]}</p>
            </button>
          )
        })}
      </div>

      {/* Revenue at risk summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl px-5 py-4" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
          <p className="text-xs uppercase tracking-wide" style={{ color:'var(--color-text-muted)' }}>Revenue at risk</p>
          <p className="text-2xl font-bold mt-1" style={{ color:'var(--color-text-primary)' }}>{fmtINR(totalAtRiskRev)}</p>
          <p className="text-xs mt-0.5" style={{ color:'var(--color-text-muted)' }}>Monthly if non-green sellers churn</p>
        </div>
        <div className="rounded-xl px-5 py-4" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
          <p className="text-xs uppercase tracking-wide" style={{ color:'var(--color-text-muted)' }}>Critical RTO sellers</p>
          <p className="text-2xl font-bold mt-1 text-red-600">{highRtoCount}</p>
          <p className="text-xs mt-0.5" style={{ color:'var(--color-text-muted)' }}>50+ orders, &gt;35% RTO rate</p>
        </div>
        <div className="rounded-xl px-5 py-4" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
          <p className="text-xs uppercase tracking-wide" style={{ color:'var(--color-text-muted)' }}>Healthy sellers</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600">{counts.green}</p>
          <p className="text-xs mt-0.5" style={{ color:'var(--color-text-muted)' }}>Score ≥ 70 — stable &amp; growing</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search seller or company…"
          className="flex-1 min-w-[200px] rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-primary)' }} />

        {/* Min orders filter */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
          {MIN_ORDER_OPTIONS.map(o => (
            <button key={o.value} onClick={() => { setMinOrders(o.value); setPage(1) }}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: minOrders === o.value ? 'var(--color-surface)' : 'transparent',
                color: minOrders === o.value ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                boxShadow: minOrders === o.value ? 'var(--shadow-sm)' : 'none',
              }}>
              {o.label}
            </button>
          ))}
        </div>

        <span className="text-sm" style={{ color:'var(--color-text-muted)' }}>{filtered.length} sellers</span>
      </div>

      {/* Table */}
      <TableCard>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background:'var(--color-surface-2)', borderBottom:'1px solid var(--color-border-2)' }}>
                <th className="px-5 py-3 text-left w-64">
                  <SortHeader col="name">Seller</SortHeader>
                </th>
                <th className="px-4 py-3 text-left w-28">
                  <SortHeader col="health_score">Score</SortHeader>
                </th>
                <th className="px-4 py-3 text-right w-24">
                  <SortHeader col="current_orders" right>Orders</SortHeader>
                </th>
                <th className="px-4 py-3 text-right w-28">
                  <SortHeader col="current_revenue" right>Revenue</SortHeader>
                </th>
                <th className="px-4 py-3 text-right w-28">
                  <SortHeader col="current_margin" right>Margin ₹</SortHeader>
                </th>
                <th className="px-4 py-3 text-right w-24">
                  <SortHeader col="current_rto" right>RTO %</SortHeader>
                </th>
                <th className="px-4 py-3 text-right w-28">
                  <div className="flex items-center justify-end gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color:'var(--color-text-muted)' }}>
                    RTO Cost
                    <span className="text-xs font-normal opacity-50 cursor-help" title="RTO orders × avg charge × 2 (forward + return)">ⓘ</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-right w-28">
                  <div className="flex items-center justify-end gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color:'var(--color-text-muted)' }}>
                    Churn Risk
                    <span className="text-xs font-normal opacity-50 cursor-help" title="Revenue lost if this seller churns this month">ⓘ</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color:'var(--color-text-muted)' }}>Courier</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((r, idx) => {
                const rtoCost  = r.rto_count * r.avg_charge * 2
                const tags     = getRiskTags(r)
                const scoreCol = SCORE_COLOR(r.health_score)
                const riskS    = RISK_STYLES[r.risk_level] ?? RISK_STYLES.amber
                const isLastRow = idx === paginated.length - 1

                return (
                  <tr key={r.user_id} className="hover:bg-slate-50/70 transition-colors"
                    style={{ borderBottom: isLastRow ? 'none' : '1px solid var(--color-border-2)' }}>

                    {/* Seller + inline tags */}
                    <td className="px-5 py-4">
                      <button onClick={() => navigate(`/seller/${r.user_id}`)}
                        className="font-semibold text-sm text-left hover:underline"
                        style={{ color: 'var(--color-primary)' }}>
                        {r.name || `Seller ${r.user_id}`}
                      </button>
                      <p className="text-xs mt-0.5 mb-2" style={{ color:'var(--color-text-muted)' }}>
                        {r.company_name || `ID: ${r.user_id}`}
                      </p>
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {tags.map((t, i) => (
                            <span key={i} className={`inline-flex px-1.5 py-0.5 rounded text-xs font-semibold border ${TAG_STYLES[t.color]}`}>
                              {t.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Score — big coloured number + thin ring */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="relative w-9 h-9 flex-shrink-0">
                          <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                            <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" stroke="#f1f5f9" />
                            <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3"
                              stroke={scoreCol}
                              strokeDasharray={`${(r.health_score / 100) * 94.2} 94.2`}
                              strokeLinecap="round" />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: scoreCol }}>
                            {r.health_score}
                          </span>
                        </div>
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border"
                          style={{ background: riskS.bg, color: riskS.text, borderColor: riskS.border }}>
                          {r.risk_level}
                        </span>
                      </div>
                    </td>

                    {/* Orders */}
                    <td className="px-4 py-4 text-right text-sm font-medium" style={{ color:'var(--color-text-secondary)' }}>
                      {fmtNum(r.current_orders)}
                    </td>

                    {/* Revenue */}
                    <td className="px-4 py-4 text-right text-sm font-medium" style={{ color:'var(--color-text-secondary)' }}>
                      {fmtINR(r.current_revenue)}
                    </td>

                    {/* Margin ₹ */}
                    <td className={`px-4 py-4 text-right text-sm font-semibold ${(r.current_margin ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {r.current_margin !== 0 ? fmtINR(r.current_margin) : <span style={{ color:'var(--color-border)' }}>—</span>}
                    </td>

                    {/* RTO % */}
                    <td className="px-4 py-4 text-right">
                      <span className={`text-sm font-bold ${r.current_rto > 35 ? 'text-red-600' : r.current_rto > 25 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {fmtPct(r.current_rto)}
                      </span>
                    </td>

                    {/* RTO Cost */}
                    <td className="px-4 py-4 text-right">
                      {rtoCost > 0 ? (
                        <span className="text-sm font-bold text-red-600">{fmtINR(rtoCost)}</span>
                      ) : (
                        <span className="text-sm" style={{ color:'var(--color-border)' }}>—</span>
                      )}
                    </td>

                    {/* Churn Risk (revenue at risk) */}
                    <td className="px-4 py-4 text-right">
                      {r.risk_level !== 'green' && r.current_revenue > 0 ? (
                        <span className="text-sm font-semibold" style={{ color:'var(--color-text-secondary)' }}>
                          {fmtINR(r.current_revenue)}
                        </span>
                      ) : (
                        <span className="text-sm" style={{ color:'var(--color-border)' }}>—</span>
                      )}
                    </td>

                    {/* Courier */}
                    <td className="px-4 py-4 text-sm" style={{ color:'var(--color-text-muted)' }}>
                      {r.primary_courier || '—'}
                    </td>
                  </tr>
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
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex gap-2">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className="w-8 h-8 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: p === page ? 'var(--color-primary)' : 'transparent',
                    color: p === page ? '#fff' : 'var(--color-text-muted)',
                    border: p === page ? 'none' : '1px solid var(--color-border)',
                  }}>
                  {p}
                </button>
              ))}
              {totalPages > 7 && <span className="text-sm self-center" style={{ color:'var(--color-text-muted)' }}>…{totalPages}</span>}
            </div>
          </div>
        )}
      </TableCard>
    </div>
  )
}
