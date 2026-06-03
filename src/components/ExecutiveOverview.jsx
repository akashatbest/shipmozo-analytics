import { useState, useEffect } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, lineOpts, fmtINR, fmtPct, fmtNum, fmtMonth, courierColor } from '../lib/chartConfig'
import { useMonth } from '../lib/monthContext'

function momDelta(curr, prev) {
  if (!prev || prev === 0) return null
  return ((curr - prev) / prev) * 100
}

const ACCENT = {
  blue:  { bar: '#3b82f6', bg: 'rgba(59,130,246,0.06)' },
  green: { bar: '#10b981', bg: 'rgba(16,185,129,0.06)' },
  amber: { bar: '#f59e0b', bg: 'rgba(245,158,11,0.06)' },
  red:   { bar: '#ef4444', bg: 'rgba(239,68,68,0.06)'  },
}

export default function ExecutiveOverview() {
  const { selectedMonth } = useMonth()
  const [months, setMonths]     = useState([])
  const [couriers, setCouriers] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!selectedMonth) return
    async function load() {
      setLoading(true)
      const { data: ov } = await supabase
        .from('monthly_overview').select('*').order('month', { ascending: false }).limit(6)
      const { data: cd } = await supabase
        .from('courier_monthly').select('courier,orders,revenue_billed,margin,margin_pct,rto_rate')
        .eq('month', selectedMonth).order('orders', { ascending: false })
      setMonths(ov ?? [])
      setCouriers(cd ?? [])
      setLoading(false)
    }
    load()
  }, [selectedMonth])

  if (loading || !months.length) return <EmptyState />

  // Find the overview row for the selected month (may not be months[0] if user picked older month)
  const cur  = months.find(m => m.month === selectedMonth) ?? months[0]
  const all  = [...months].reverse()
  const prev = months[months.findIndex(m => m.month === cur.month) + 1]
  const labels = all.map(m => fmtMonth(m.month))

  const kpis = [
    { label: 'Total Orders',   value: fmtNum(cur.total_orders),         d: momDelta(cur.total_orders, prev?.total_orders),                 accent: 'blue' },
    { label: 'Revenue Billed', value: fmtINR(cur.total_revenue_billed), d: momDelta(cur.total_revenue_billed, prev?.total_revenue_billed), accent: 'blue' },
    { label: 'Gross Margin',   value: fmtINR(cur.gross_margin),         d: momDelta(cur.gross_margin, prev?.gross_margin),                 accent: cur.gross_margin < 0 ? 'red' : 'green' },
    { label: 'Margin %',       value: fmtPct(cur.margin_pct),           d: momDelta(cur.margin_pct, prev?.margin_pct),                    accent: cur.margin_pct < 5 ? 'red' : cur.margin_pct < 10 ? 'amber' : 'green' },
    { label: 'RTO Rate',       value: fmtPct(cur.rto_rate),             d: momDelta(cur.rto_rate, prev?.rto_rate), lowerIsBetter: true,   accent: cur.rto_rate > 25 ? 'red' : cur.rto_rate > 15 ? 'amber' : 'green' },
    { label: 'Active Sellers', value: fmtNum(cur.active_sellers),       d: momDelta(cur.active_sellers, prev?.active_sellers),             accent: 'blue' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Executive Overview</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {fmtMonth(cur.month)}{prev ? ` · compared to ${fmtMonth(prev.month)}` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-7">
        {kpis.map(k => <KPICard key={k.label} {...k} />)}
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <ChartCard title="Monthly Orders">
          <Bar data={{ labels, datasets: [{ label:'Orders', data: all.map(m => m.total_orders), backgroundColor:'#3b82f6', borderRadius:5 }] }}
            options={barOpts({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtNum(ctx.raw) } } } })} />
        </ChartCard>
        <ChartCard title="Revenue vs Cost (₹L)">
          <Bar data={{ labels, datasets: [
            { label:'Revenue', data: all.map(m => +(m.total_revenue_billed/100000).toFixed(2)), backgroundColor:'#3b82f6cc', borderRadius:5 },
            { label:'Cost',    data: all.map(m => +(m.total_courier_cost/100000).toFixed(2)),   backgroundColor:'#f87171',   borderRadius:5 },
          ]}} options={barOpts({ plugins: { legend: { display: true } } })} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <ChartCard title="Margin % Trend">
          <Line data={{ labels, datasets: [{ label:'Margin %', data: all.map(m => m.margin_pct), borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.08)', fill:true, tension:0.35, pointRadius:4 }] }}
            options={lineOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })} />
        </ChartCard>
        <ChartCard title="RTO Rate Trend">
          <Line data={{ labels, datasets: [{ label:'RTO %', data: all.map(m => m.rto_rate), borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)', fill:true, tension:0.35, pointRadius:4 }] }}
            options={lineOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })} />
        </ChartCard>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
        <div className="px-5 py-4" style={{ borderBottom:'1px solid var(--color-border-2)' }}>
          <h3 className="text-sm font-semibold" style={{ color:'var(--color-text-secondary)' }}>Courier Breakdown — {fmtMonth(cur.month)}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background:'var(--color-surface-2)', borderBottom:'1px solid var(--color-border-2)' }}>
                {['Courier','Orders','Revenue','Margin','Margin %','RTO %'].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-left" style={{ color:'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor:'var(--color-border-2)' }}>
              {couriers.map(c => (
                <tr key={c.courier} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: courierColor(c.courier) }} />
                      <span className="font-medium" style={{ color:'var(--color-text-primary)' }}>{c.courier}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3" style={{ color:'var(--color-text-secondary)' }}>{fmtNum(c.orders)}</td>
                  <td className="px-5 py-3" style={{ color:'var(--color-text-secondary)' }}>{fmtINR(c.revenue_billed)}</td>
                  <td className={`px-5 py-3 font-medium ${c.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtINR(c.margin)}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${c.margin_pct < 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                      {fmtPct(c.margin_pct)}
                    </span>
                  </td>
                  <td className="px-5 py-3" style={{ color:'var(--color-text-secondary)' }}>{fmtPct(c.rto_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function KPICard({ label, value, d, lowerIsBetter = false, accent = 'blue' }) {
  const isPositive = d > 0
  const isGood = lowerIsBetter ? !isPositive : isPositive
  const { bar, bg } = ACCENT[accent] ?? ACCENT.blue
  return (
    <div className="relative overflow-hidden rounded-xl p-5 card-hover"
      style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
      <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full" style={{ background: bar }} />
      <div className="absolute inset-0 rounded-xl" style={{ background: bg }} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wide mb-2.5" style={{ color:'var(--color-text-muted)', letterSpacing:'0.06em' }}>{label}</p>
        <p className="text-2xl font-bold leading-none" style={{ color:'var(--color-text-primary)', fontVariantNumeric:'tabular-nums' }}>{value}</p>
        {d !== null && d !== undefined && (
          <p className={`flex items-center gap-1 mt-2.5 text-xs font-semibold ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
            {isPositive ? '↑' : '↓'} {Math.abs(d).toFixed(1)}% vs last month
          </p>
        )}
        {(d === null || d === undefined) && <p className="mt-2.5 text-xs" style={{ color:'var(--color-text-muted)' }}>First month</p>}
      </div>
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className="rounded-xl p-5" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
      <h3 className="text-sm font-semibold mb-4" style={{ color:'var(--color-text-secondary)' }}>{title}</h3>
      {children}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-96 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
        <svg className="w-8 h-8" style={{ color:'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      </div>
      <p className="font-semibold text-base" style={{ color:'var(--color-text-primary)' }}>No data uploaded yet</p>
      <p className="text-sm mt-1.5 max-w-xs" style={{ color:'var(--color-text-muted)' }}>Upload your monthly CSV to see the overview</p>
    </div>
  )
}
