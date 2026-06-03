import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, lineOpts, doughnutOpts, fmtINR, fmtPct, fmtNum, fmtMonth, courierColor } from '../lib/chartConfig'
import { Spinner } from './ui'

const ZONE_COLORS = { A:'#10b981', B:'#3b82f6', C:'#f59e0b', D:'#f97316', E:'#ef4444' }
const SCORE_COLOR = s => s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : '#ef4444'
const RISK_STYLES = {
  green: { bg:'#f0fdf4', text:'#16a34a', border:'#a7f3d0' },
  amber: { bg:'#fffbeb', text:'#d97706', border:'#fde68a' },
  red:   { bg:'#fef2f2', text:'#dc2626', border:'#fecaca' },
}

export default function SellerProfile() {
  const { userId } = useParams()
  const navigate   = useNavigate()
  const [seller, setSeller]   = useState(null)
  const [health, setHealth]   = useState(null)
  const [history, setHistory] = useState([])   // seller_monthly last 6 months
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const id = parseInt(userId, 10)
      const [{ data: sellerData }, { data: healthData }, { data: historyData }] = await Promise.all([
        supabase.from('sellers').select('*').eq('user_id', id).single(),
        supabase.from('seller_health').select('*').eq('user_id', id).single(),
        supabase.from('seller_monthly').select('*').eq('user_id', id).order('month', { ascending: false }).limit(6),
      ])
      setSeller(sellerData)
      setHealth(healthData)
      setHistory((historyData ?? []).reverse())  // oldest first for charts
      setLoading(false)
    }
    load()
  }, [userId])

  if (loading) return <Spinner />
  if (!seller && !history.length) return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>Seller not found</p>
      <button onClick={() => navigate(-1)} className="mt-3 text-sm text-blue-600 hover:underline">← Go back</button>
    </div>
  )

  const latest    = history[history.length - 1]
  const prev      = history[history.length - 2]
  const labels    = history.map(m => fmtMonth(m.month))
  const riskS     = RISK_STYLES[health?.risk_level ?? 'amber']
  const scoreVal  = health?.health_score ?? 0
  const scoreCol  = SCORE_COLOR(scoreVal)
  const margin_pct = latest?.revenue_billed > 0 ? (latest.margin / latest.revenue_billed * 100).toFixed(1) : 0

  // Courier breakdown from latest month - using primary_courier as proxy
  const courierName = latest?.primary_courier ?? seller?.primary_courier ?? 'Unknown'

  // Zone breakdown from latest month
  const zonePcts = latest ? [
    { z:'A', pct: latest.zone_a_pct ?? 0 },
    { z:'B', pct: latest.zone_b_pct ?? 0 },
    { z:'C', pct: latest.zone_c_pct ?? 0 },
    { z:'D', pct: latest.zone_d_pct ?? 0 },
    { z:'E', pct: latest.zone_e_pct ?? 0 },
  ].filter(z => z.pct > 0) : []

  function delta(curr, prev) {
    if (!prev || prev === 0) return null
    return ((curr - prev) / prev * 100).toFixed(1)
  }

  return (
    <div>
      {/* Back button */}
      <button onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm mb-5 hover:underline"
        style={{ color: 'var(--color-text-muted)' }}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back
      </button>

      {/* Seller header card */}
      <div className="rounded-xl p-6 mb-6"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-5">
            {/* Score ring */}
            <div className="relative w-16 h-16 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" strokeWidth="2.5" stroke="#f1f5f9" />
                <circle cx="18" cy="18" r="15" fill="none" strokeWidth="2.5"
                  stroke={scoreCol}
                  strokeDasharray={`${(scoreVal / 100) * 94.2} 94.2`}
                  strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color: scoreCol }}>
                {scoreVal}
              </span>
            </div>

            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {seller?.name || `Seller ${userId}`}
                </h1>
                {health?.risk_level && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize"
                    style={{ background: riskS.bg, color: riskS.text, borderColor: riskS.border }}>
                    {health.risk_level} health
                  </span>
                )}
              </div>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {seller?.company_name}
                {seller?.primary_courier && ` · ${seller.primary_courier}`}
                {seller?.first_seen_month && ` · Since ${fmtMonth(seller.first_seen_month)}`}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {health?.months_active && <span>📅 {health.months_active} month{health.months_active > 1 ? 's' : ''} active</span>}
                {health?.volume_trend && <span>📦 Volume: <strong style={{ color: 'var(--color-text-secondary)' }}>{health.volume_trend}</strong></span>}
                {health?.rto_trend && <span>↩ RTO: <strong style={{ color: 'var(--color-text-secondary)' }}>{health.rto_trend}</strong></span>}
              </div>
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Lifetime orders</p>
            <p className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{fmtNum(seller?.lifetime_orders)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {fmtINR(seller?.lifetime_revenue)} lifetime revenue
            </p>
          </div>
        </div>

        {/* Recommended action */}
        {health?.recommended_action && (
          <div className="mt-4 pt-4 flex items-center gap-2"
            style={{ borderTop: '1px solid var(--color-border-2)' }}>
            <svg className="w-4 h-4 flex-shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            <p className="text-sm" style={{ color: '#1e40af' }}>
              <strong>Recommended:</strong> {health.recommended_action}
            </p>
          </div>
        )}
      </div>

      {/* KPI row — latest month */}
      {latest && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: `Orders (${fmtMonth(latest.month)})`, value: fmtNum(latest.orders), d: delta(latest.orders, prev?.orders) },
            { label: 'Revenue', value: fmtINR(latest.revenue_billed), d: delta(latest.revenue_billed, prev?.revenue_billed) },
            { label: 'Margin %', value: `${margin_pct}%`, d: delta(+margin_pct, prev?.revenue_billed > 0 ? prev.margin/prev.revenue_billed*100 : null), accent: +margin_pct < 0 ? 'red' : +margin_pct < 8 ? 'amber' : 'green' },
            { label: 'RTO Rate', value: fmtPct(latest.rto_rate), d: delta(latest.rto_rate, prev?.rto_rate), lowerBetter: true, accent: latest.rto_rate > 35 ? 'red' : latest.rto_rate > 25 ? 'amber' : 'green' },
          ].map(kpi => {
            const ACCENT = { blue:'#3b82f6', green:'#10b981', amber:'#f59e0b', red:'#ef4444' }
            const col = ACCENT[kpi.accent ?? 'blue']
            const isPos = +kpi.d > 0
            const isGood = kpi.lowerBetter ? !isPos : isPos
            return (
              <div key={kpi.label} className="relative overflow-hidden rounded-xl p-5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full" style={{ background: col }} />
                <div className="absolute inset-0 rounded-xl" style={{ background: `${col}08` }} />
                <div className="relative">
                  <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>{kpi.label}</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{kpi.value}</p>
                  {kpi.d !== null && kpi.d !== undefined && (
                    <p className={`text-xs font-semibold mt-1.5 ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
                      {isPos ? '↑' : '↓'} {Math.abs(kpi.d)}% MoM
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Charts row */}
      {history.length > 1 && (
        <div className="grid grid-cols-2 gap-5 mb-5">
          <div className="rounded-xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-secondary)' }}>Monthly Orders</h3>
            <Bar
              data={{
                labels,
                datasets: [{
                  label: 'Orders',
                  data: history.map(m => m.orders),
                  backgroundColor: '#3b82f6',
                  borderRadius: 5,
                }],
              }}
              options={barOpts()}
            />
          </div>

          <div className="rounded-xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-secondary)' }}>RTO Rate Trend</h3>
            <Line
              data={{
                labels,
                datasets: [{
                  label: 'RTO %',
                  data: history.map(m => m.rto_rate),
                  borderColor: '#ef4444',
                  backgroundColor: 'rgba(239,68,68,0.08)',
                  fill: true,
                  tension: 0.35,
                  pointRadius: 4,
                }],
              }}
              options={lineOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })}
            />
          </div>
        </div>
      )}

      {/* Revenue + Margin trend & Zone breakdown */}
      <div className="grid grid-cols-2 gap-5 mb-5">
        {history.length > 1 && (
          <div className="rounded-xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-secondary)' }}>Revenue & Margin (₹L)</h3>
            <Bar
              data={{
                labels,
                datasets: [
                  { label: 'Revenue', data: history.map(m => +((m.revenue_billed ?? 0)/100000).toFixed(2)), backgroundColor: '#3b82f6cc', borderRadius: 4 },
                  { label: 'Margin',  data: history.map(m => +((m.margin ?? 0)/100000).toFixed(2)),         backgroundColor: '#10b981cc', borderRadius: 4 },
                ],
              }}
              options={barOpts({ plugins: { legend: { display: true } } })}
            />
          </div>
        )}

        {zonePcts.length > 0 && (
          <div className="rounded-xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-secondary)' }}>Zone Distribution ({fmtMonth(latest?.month)})</h3>
            <Doughnut
              data={{
                labels: zonePcts.map(z => `Zone ${z.z}`),
                datasets: [{
                  data: zonePcts.map(z => z.pct),
                  backgroundColor: zonePcts.map(z => ZONE_COLORS[z.z] ?? '#64748b'),
                  borderWidth: 2, borderColor: '#fff',
                }],
              }}
              options={doughnutOpts()}
            />
          </div>
        )}
      </div>

      {/* Month-by-month history table */}
      {history.length > 0 && (
        <div className="rounded-xl overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--color-border-2)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Month-by-Month History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border-2)' }}>
                  {['Month','Orders','Revenue','Margin','Margin %','RTO Orders','RTO %','Price Card','Primary Zone'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left"
                      style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((m, i) => {
                  const mp = m.revenue_billed > 0 ? (m.margin / m.revenue_billed * 100).toFixed(1) : 0
                  return (
                    <tr key={m.month} className="hover:bg-slate-50 transition-colors"
                      style={{ borderBottom: i < history.length - 1 ? '1px solid var(--color-border-2)' : 'none' }}>
                      <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-text-primary)' }}>{fmtMonth(m.month)}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text-secondary)' }}>{fmtNum(m.orders)}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text-secondary)' }}>{fmtINR(m.revenue_billed)}</td>
                      <td className={`px-4 py-3 font-medium ${m.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtINR(m.margin)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          +mp < 0 ? 'bg-red-50 text-red-700 border-red-100' :
                          +mp < 8 ? 'bg-amber-50 text-amber-700 border-amber-100' :
                          +mp > 20 ? 'bg-orange-50 text-orange-700 border-orange-100' :
                          'bg-emerald-50 text-emerald-700 border-emerald-100'
                        }`}>{mp}%</span>
                      </td>
                      <td className="px-4 py-3 text-red-500 font-medium">{fmtNum(m.rto_count)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-semibold ${m.rto_rate > 35 ? 'text-red-600' : m.rto_rate > 25 ? 'text-amber-600' : 'text-slate-500'}`}>
                          {fmtPct(m.rto_rate)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>{m.price_card_id || '—'}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>{m.primary_zone ? `Zone ${m.primary_zone}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
