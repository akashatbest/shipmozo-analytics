import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fetchAllPaged } from '../lib/supabase'
import { fmtINR, fmtPct, fmtNum, fmtMonth } from '../lib/chartConfig'
import { useMonth } from '../lib/monthContext'
import { PageHeader, Spinner, EmptyState } from './ui'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'

// ── Build aggregated person-level metrics ────────────────────────────────────

function buildPersonStats(teamMap, sellerMonthly, sellerHealth, role) {
  // Group sellers by person (SPOC or KAM)
  const groups = {}

  for (const [userId, person] of Object.entries(teamMap)) {
    const name = role === 'spoc' ? person.spoc : person.kam
    if (!name) continue
    if (!groups[name]) groups[name] = { name, sellers: [] }
    groups[name].sellers.push(userId)
  }

  const monthlyMap = Object.fromEntries((sellerMonthly ?? []).map(s => [String(s.user_id), s]))
  const healthMap  = Object.fromEntries((sellerHealth  ?? []).map(s => [String(s.user_id), s]))

  return Object.values(groups).map(({ name, sellers }) => {
    let totalOrders = 0, totalRevenue = 0, totalMargin = 0
    let totalRtoOrders = 0, totalOrdersForRto = 0
    let atRiskCount = 0, healthyCount = 0, redCount = 0
    let totalRtoCost = 0

    const sellerDetails = sellers.map(uid => {
      const sm = monthlyMap[uid]
      const sh = healthMap[uid]
      const orders  = sm?.orders ?? 0
      const revenue = sm?.revenue_billed ?? 0
      const margin  = sm?.margin ?? 0
      const rto     = sm?.rto_rate ?? 0
      const rtoCount = sm?.rto_count ?? 0
      const avgCharge = sm?.avg_shipping_charge ?? 0

      totalOrders       += orders
      totalRevenue      += revenue
      totalMargin       += margin
      totalRtoOrders    += rtoCount
      totalOrdersForRto += orders
      totalRtoCost      += rtoCount * avgCharge * 2

      const risk = sh?.risk_level ?? 'unknown'
      if (risk === 'red')                        redCount++
      if (risk === 'red' || risk === 'amber')    atRiskCount++
      else if (risk === 'green')                 healthyCount++

      return {
        user_id:         uid,
        name:            sm?.name ?? `Seller ${uid}`,
        company_name:    sm?.company_name ?? '',
        orders,
        revenue,
        margin,
        margin_pct:      revenue > 0 ? (margin / revenue * 100) : 0,
        rto_rate:        rto,
        rto_count:       rtoCount,
        rto_cost:        rtoCount * avgCharge * 2,
        health_score:    sh?.health_score ?? 0,
        risk_level:      risk,
        volume_trend:    sh?.volume_trend ?? '—',
        primary_courier: sm?.primary_courier ?? '—',
        primary_zone:    sm?.primary_zone,
      }
    }).sort((a, b) => b.revenue - a.revenue)

    const marginPct    = totalRevenue > 0 ? (totalMargin / totalRevenue * 100) : 0
    const rtoRate      = totalOrdersForRto > 0 ? (totalRtoOrders / totalOrdersForRto * 100) : 0
    const atRiskRevenue = sellerDetails.filter(s => s.risk_level === 'red' || s.risk_level === 'amber')
                                        .reduce((a, s) => a + s.revenue, 0)
    const activeSellers = sellerDetails.filter(s => s.orders > 0).length

    return {
      name,
      total_sellers:  sellers.length,
      active_sellers: activeSellers,
      total_orders:   totalOrders,
      total_revenue:  totalRevenue,
      total_margin:   totalMargin,
      margin_pct:     marginPct,
      rto_rate:       rtoRate,
      rto_cost:       totalRtoCost,
      at_risk_count:  atRiskCount,
      red_count:      redCount,
      healthy_count:  healthyCount,
      at_risk_revenue: atRiskRevenue,
      at_risk_pct:    sellers.length > 0 ? (atRiskCount / sellers.length * 100) : 0,
      sellers:        sellerDetails,
    }
  }).sort((a, b) => b.total_revenue - a.total_revenue)
}

// ── Component ─────────────────────────────────────────────────────────────────

const ROLE_META = {
  spoc: { label: 'SPOC', sublabel: 'Sales Person of Contact', desc: 'Who acquired and manages the seller relationship' },
  kam:  { label: 'KAM',  sublabel: 'Key Account Manager',     desc: 'Who handles ongoing account health and retention' },
}

export default function TeamAnalytics() {
  const { selectedMonth: month } = useMonth()
  const navigate = useNavigate()

  const [teamMap, setTeamMap]           = useState({})   // { user_id: { spoc, kam } }
  const [sellerMonthly, setSellerMonthly] = useState([])
  const [sellerHealth, setSellerHealth]   = useState([])
  const [loading, setLoading]             = useState(true)
  const [role, setRole]                   = useState('spoc')
  const [sortKey, setSortKey]             = useState('total_revenue')
  const [sortDir, setSortDir]             = useState('desc')
  const [expanded, setExpanded]           = useState(null)  // expanded person name
  const [search, setSearch]               = useState('')

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)
      // All three tables can exceed 1000 rows — page through the full sets
      const [team, sm, sh] = await Promise.all([
        fetchAllPaged(() => supabase.from('seller_team').select('user_id,spoc,kam')),
        fetchAllPaged(() => supabase.from('seller_monthly')
          .select('user_id,name,company_name,orders,revenue_billed,margin,rto_count,rto_rate,avg_shipping_charge,primary_courier,primary_zone')
          .eq('month', month)),
        fetchAllPaged(() => supabase.from('seller_health')
          .select('user_id,health_score,risk_level,volume_trend')),
      ])
      const map = Object.fromEntries(team.map(t => [String(t.user_id), t]))
      setTeamMap(map)
      setSellerMonthly(sm)
      setSellerHealth(sh)
      setLoading(false)
    }
    load()
  }, [month])

  const stats = useMemo(
    () => buildPersonStats(teamMap, sellerMonthly, sellerHealth, role),
    [teamMap, sellerMonthly, sellerHealth, role]
  )

  const filtered = useMemo(() => {
    let out = stats
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(s => s.name.toLowerCase().includes(q))
    }
    return [...out].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [stats, search, sortKey, sortDir])

  const totalMapped       = Object.keys(teamMap).length
  const spocCount         = new Set(Object.values(teamMap).map(t => t.spoc).filter(Boolean)).size
  const kamCount          = new Set(Object.values(teamMap).map(t => t.kam).filter(Boolean)).size
  const sellersWithKam    = Object.values(teamMap).filter(t => t.kam).length
  const sellersWithSpoc   = Object.values(teamMap).filter(t => t.spoc).length
  const kamCoveragePct    = totalMapped > 0 ? Math.round(sellersWithKam / totalMapped * 100) : 0
  const totalRevenue      = stats.reduce((a, s) => a + s.total_revenue, 0)
  const totalMargin       = stats.reduce((a, s) => a + s.total_margin, 0)
  const totalAtRiskRev    = stats.reduce((a, s) => a + s.at_risk_revenue, 0)
  const highRiskPeople    = filtered.filter(s => s.at_risk_pct > 40)

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const RISK_COLOR = { red:'text-red-600', amber:'text-amber-600', green:'text-emerald-600', unknown:'text-slate-400' }
  const RISK_BG    = { red:'bg-red-50 text-red-700 border-red-100', amber:'bg-amber-50 text-amber-700 border-amber-100', green:'bg-emerald-50 text-emerald-700 border-emerald-100' }

  const EXPORT_COLS = [
    { key:'name', label:ROLE_META[role].label }, { key:'total_sellers', label:'Sellers' },
    { key:'active_sellers', label:'Active Sellers' }, { key:'total_orders', label:'Orders' },
    { key:'total_revenue', label:'Revenue' }, { key:'total_margin', label:'Margin ₹' },
    { key:'margin_pct', label:'Margin %' },
    { key:'rto_rate', label:'RTO Rate %' }, { key:'at_risk_count', label:'At-Risk Sellers' },
    { key:'at_risk_revenue', label:'Revenue at Risk' }, { key:'rto_cost', label:'RTO Cost' },
  ]

  if (loading) return <Spinner />

  if (totalMapped === 0) return (
    <div>
      <PageHeader title="Team Analytics" subtitle="SPOC & KAM Performance" />
      <div className="rounded-xl p-8 text-center"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <svg className="w-7 h-7" style={{ color: 'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        </div>
        <p className="font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>No team mapping uploaded yet</p>
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
          Upload a CSV with columns: <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>User Id, SPOC, KAM</code>
        </p>
        <button onClick={() => navigate('/upload')}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
          style={{ background: 'var(--color-primary)' }}>
          Go to Upload Data →
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Team Analytics"
        subtitle={`${fmtMonth(month)} · ${spocCount} SPOCs · ${kamCount} KAMs · ${fmtNum(totalMapped)} sellers mapped`}
        action={<ExportButton onClick={() => exportCSV(`team-${role}-${month}`, filtered, EXPORT_COLS)} />}
      />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {[
          { l:'Total Revenue',   v:fmtINR(totalRevenue),   accent:'#2563eb' },
          { l:'Total Margin ₹',  v:fmtINR(totalMargin),    accent: totalMargin < 0 ? '#ef4444' : '#10b981',
            sub: `${(totalRevenue > 0 ? totalMargin/totalRevenue*100 : 0).toFixed(1)}% margin rate` },
          { l:'Revenue at Risk', v:fmtINR(totalAtRiskRev), accent:'#ef4444', sub:'if at-risk sellers churn' },
          { l:`${ROLE_META[role].label}s Active`, v:filtered.length, accent:'#8b5cf6',
            sub:`${role==='spoc' ? sellersWithSpoc : sellersWithKam} sellers assigned` },
        ].map(({ l, v, accent, sub }) => (
          <div key={l} className="relative overflow-hidden rounded-xl p-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full" style={{ background: accent }} />
            <div className="absolute inset-0 rounded-xl" style={{ background: `${accent}07` }} />
            <div className="relative">
              <p className="text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{l}</p>
              <p className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{v}</p>
              {sub && <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* KAM coverage gap explanation */}
      {role === 'kam' && sellersWithKam < totalMapped && (
        <div className="rounded-xl p-4 mb-4 flex items-start gap-3"
          style={{ background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.12)' }}>
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm" style={{ color: '#1e40af' }}>
            <strong>Why KAM revenue is lower than SPOC:</strong>
            {' '}{fmtNum(sellersWithKam)} of {fmtNum(totalMapped)} sellers ({kamCoveragePct}%) have a KAM assigned.
            {' '}{fmtNum(totalMapped - sellersWithKam)} sellers have no KAM — their revenue doesn't appear in any KAM's total.
            {' '}Upload an updated mapping CSV with KAM filled in for all sellers to get full coverage.
          </div>
        </div>
      )}

      {/* High-risk portfolio alert */}
      {highRiskPeople.length > 0 && (
        <div className="rounded-xl p-4 mb-5 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm" style={{ color: '#991b1b' }}>
            <strong>{highRiskPeople.length} {ROLE_META[role].label}{highRiskPeople.length > 1 ? 's' : ''} with &gt;40% at-risk portfolio:</strong>
            {' '}{highRiskPeople.map(p => `${p.name} (${p.at_risk_pct.toFixed(0)}%)`).join(', ')}
          </p>
        </div>
      )}

      {/* Role tab + search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          {(['spoc','kam'] ).map(r => (
            <button key={r} onClick={() => { setRole(r); setExpanded(null); setSearch('') }}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: role === r ? 'var(--color-surface)' : 'transparent',
                color: role === r ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                boxShadow: role === r ? 'var(--shadow-sm)' : 'none',
              }}>
              {ROLE_META[r].label}
              <span className="ml-1.5 text-xs opacity-60">
                ({role === r ? filtered.length : (r === 'spoc' ? spocCount : kamCount)})
              </span>
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${ROLE_META[role].sublabel}…`}
          className="flex-1 rounded-lg px-4 py-2 text-sm focus:outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
        <p className="text-sm flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {filtered.length} {ROLE_META[role].label}s
        </p>
      </div>

      {/* Description */}
      <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>{ROLE_META[role].desc}</p>

      {/* Leaderboard table */}
      <div className="rounded-xl overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border-2)' }}>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                  {ROLE_META[role].label}
                </th>
                {[
                  ['total_sellers',   'Sellers'],
                  ['active_sellers',  'Active'],
                  ['total_orders',    'Orders'],
                  ['total_revenue',   'Revenue'],
                  ['total_margin',    'Margin ₹'],
                  ['margin_pct',      'Margin %'],
                  ['rto_rate',        'RTO Rate'],
                  ['rto_cost',        'RTO Cost'],
                  ['at_risk_count',   'At Risk'],
                  ['at_risk_revenue', 'Revenue at Risk'],
                ].map(([key, label]) => (
                  <th key={key} onClick={() => toggleSort(key)}
                    className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide cursor-pointer hover:opacity-80 select-none whitespace-nowrap"
                    style={{ color: sortKey === key ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                    {label} {sortKey === key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                ))}
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                  Portfolio Health
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((person, idx) => {
                const isExpanded    = expanded === person.name
                const atRiskPct     = person.at_risk_pct
                const marginIsLow   = person.margin_pct < 8
                const marginIsNeg   = person.margin_pct < 0
                const rtoHigh       = person.rto_rate > 25
                const isLast        = idx === filtered.length - 1

                return (
                  <>
                    <tr key={person.name}
                      onClick={() => setExpanded(isExpanded ? null : person.name)}
                      className="cursor-pointer hover:bg-blue-50/40 transition-colors"
                      style={{ borderBottom: isExpanded ? 'none' : isLast ? 'none' : '1px solid var(--color-border-2)' }}>

                      {/* Name + expand arrow */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white"
                            style={{ background: `hsl(${(person.name.charCodeAt(0) * 37) % 360}, 60%, 50%)` }}>
                            {person.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{person.name}</p>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                              {person.active_sellers}/{person.total_sellers} sellers active
                            </p>
                          </div>
                          <svg className={`w-4 h-4 ml-1 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                            style={{ color: 'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </td>

                      <td className="px-4 py-4 text-right font-medium" style={{ color: 'var(--color-text-secondary)' }}>{fmtNum(person.total_sellers)}</td>
                      <td className="px-4 py-4 text-right" style={{ color: 'var(--color-text-secondary)' }}>{fmtNum(person.active_sellers)}</td>
                      <td className="px-4 py-4 text-right font-medium" style={{ color: 'var(--color-text-secondary)' }}>{fmtNum(person.total_orders)}</td>
                      <td className="px-4 py-4 text-right font-semibold" style={{ color: 'var(--color-text-primary)' }}>{fmtINR(person.total_revenue)}</td>

                      {/* Margin ₹ */}
                      <td className={`px-4 py-4 text-right text-sm font-semibold ${marginIsNeg ? 'text-red-600' : 'text-emerald-600'}`}>
                        {fmtINR(person.total_margin)}
                      </td>

                      {/* Margin % */}
                      <td className="px-4 py-4 text-right">
                        <span className={`text-sm font-bold ${marginIsNeg ? 'text-red-600' : marginIsLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {fmtPct(person.margin_pct)}
                        </span>
                      </td>

                      {/* RTO Rate */}
                      <td className="px-4 py-4 text-right">
                        <span className={`text-sm font-semibold ${rtoHigh ? 'text-red-600' : 'text-slate-500'}`}>
                          {fmtPct(person.rto_rate)}
                        </span>
                      </td>

                      {/* RTO Cost */}
                      <td className="px-4 py-4 text-right text-sm font-medium text-orange-600">{fmtINR(person.rto_cost)}</td>

                      {/* At-risk count */}
                      <td className="px-4 py-4 text-right">
                        <span className={`text-sm font-bold ${person.at_risk_count > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {person.at_risk_count}
                          {person.total_sellers > 0 && (
                            <span className="text-xs font-normal ml-1" style={{ color: 'var(--color-text-muted)' }}>
                              ({person.at_risk_pct.toFixed(0)}%)
                            </span>
                          )}
                        </span>
                      </td>

                      {/* Revenue at risk */}
                      <td className="px-4 py-4 text-right text-sm font-semibold text-red-500">{fmtINR(person.at_risk_revenue)}</td>

                      {/* Portfolio health bar */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5 min-w-[80px]">
                          {person.total_sellers > 0 && (
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(person.healthy_count / person.total_sellers) * 100}%` }} />
                            </div>
                          )}
                          <span className="text-xs font-medium text-emerald-600">{person.healthy_count}</span>
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                          of {person.total_sellers} healthy
                        </p>
                      </td>
                    </tr>

                    {/* Expanded seller portfolio */}
                    {isExpanded && (
                      <tr key={`${person.name}-expanded`}
                        style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-border-2)' }}>
                        <td colSpan={11} className="px-5 py-4" style={{ background: 'var(--color-surface-2)' }}>
                          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
                            {person.name}'s seller portfolio — {person.sellers.length} sellers
                          </p>
                          <div className="rounded-xl overflow-hidden"
                            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                            <table className="w-full text-xs">
                              <thead>
                                <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border-2)' }}>
                                  {['Seller','Orders','Revenue','Margin ₹','Margin %','RTO %','RTO Cost','Health','Courier','Trend'].map(h => (
                                    <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {person.sellers.slice(0, 20).map((s, i) => (
                                  <tr key={s.user_id}
                                    onClick={() => navigate(`/seller/${s.user_id}`)}
                                    className="cursor-pointer hover:bg-blue-50 transition-colors"
                                    style={{ borderBottom: i < Math.min(person.sellers.length, 20) - 1 ? '1px solid var(--color-border-2)' : 'none' }}>
                                    <td className="px-3 py-2">
                                      <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                                        {s.name || `Seller ${s.user_id}`}
                                      </p>
                                      <p className="opacity-60">{s.company_name}</p>
                                    </td>
                                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{fmtNum(s.orders)}</td>
                                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>{fmtINR(s.revenue)}</td>
                                    <td className={`px-3 py-2 font-semibold text-xs ${s.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                      {fmtINR(s.margin)}
                                    </td>
                                    <td className="px-3 py-2">
                                      <span className={`font-bold ${s.margin_pct < 0 ? 'text-red-600' : s.margin_pct < 8 ? 'text-amber-600' : s.margin_pct > 20 ? 'text-orange-600' : 'text-emerald-600'}`}>
                                        {s.margin_pct.toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="px-3 py-2">
                                      <span className={s.rto_rate > 25 ? 'text-red-600 font-bold' : 'text-slate-500'}>{fmtPct(s.rto_rate)}</span>
                                    </td>
                                    <td className="px-3 py-2 text-orange-600">{s.rto_cost > 0 ? fmtINR(s.rto_cost) : '—'}</td>
                                    <td className="px-3 py-2">
                                      <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${RISK_BG[s.risk_level] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                                        {s.health_score} · {s.risk_level}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>{s.primary_courier}</td>
                                    <td className="px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>{s.volume_trend}</td>
                                  </tr>
                                ))}
                                {person.sellers.length > 20 && (
                                  <tr>
                                    <td colSpan={9} className="px-3 py-2 text-center" style={{ color: 'var(--color-text-muted)' }}>
                                      +{person.sellers.length - 20} more sellers · click seller name to view full profile
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          {/* Per-person export */}
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={e => { e.stopPropagation(); exportCSV(`${person.name.replace(/\s+/g,'-')}-sellers-${month}`, person.sellers, [
                                { key:'name', label:'Seller' }, { key:'company_name', label:'Company' },
                                { key:'orders', label:'Orders' }, { key:'revenue', label:'Revenue' },
                                { key:'margin', label:'Margin ₹' }, { key:'margin_pct', label:'Margin %' },
                                { key:'rto_rate', label:'RTO %' },
                                { key:'risk_level', label:'Health' }, { key:'primary_courier', label:'Courier' },
                              ]) }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-slate-100"
                              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                              Export {person.name}'s sellers
                            </button>
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
