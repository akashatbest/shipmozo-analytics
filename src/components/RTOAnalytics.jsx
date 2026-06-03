import { useState, useEffect } from 'react'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, fmtPct, fmtNum, fmtINR, fmtMonth, courierColor } from '../lib/chartConfig'
import { PageHeader, StatCard, ChartCard, TableCard, Thead, Th, Td, MarginBadge, Spinner, EmptyState } from './ui'

const DAYS_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

export default function RTOAnalytics() {
  const [couriers, setCouriers]     = useState([])
  const [zones, setZones]           = useState([])
  const [daily, setDaily]           = useState([])
  const [topSellers, setTopSellers] = useState([])
  const [month, setMonth]           = useState('')
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const { data: ov } = await supabase.from('monthly_overview').select('month').order('month', { ascending: false }).limit(1)
      const latest = ov?.[0]?.month
      if (!latest) { setLoading(false); return }
      setMonth(latest)
      const [{ data: cd }, { data: zd }, { data: dd }, { data: sd }] = await Promise.all([
        supabase.from('courier_monthly').select('courier,orders,rto_count,rto_rate,avg_charge').eq('month', latest).order('rto_rate', { ascending: false }),
        supabase.from('zone_monthly').select('zone,orders,rto_count,rto_rate').eq('month', latest).order('rto_rate', { ascending: false }),
        supabase.from('daily_summary').select('date,day_of_week,orders,rto_count,rto_rate').eq('month', latest).order('date'),
        supabase.from('seller_monthly').select('user_id,name,orders,rto_count,rto_rate,avg_shipping_charge').eq('month', latest).order('rto_count', { ascending: false }).limit(15),
      ])
      setCouriers(cd ?? [])
      setZones(zd ?? [])
      setDaily(dd ?? [])
      setTopSellers(sd ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Spinner />
  if (!couriers.length) return <EmptyState body="Upload a monthly CSV to see RTO analytics" />

  const dowMap = {}
  for (const d of daily) {
    if (!d.day_of_week) continue
    if (!dowMap[d.day_of_week]) dowMap[d.day_of_week] = { orders: 0, rto: 0 }
    dowMap[d.day_of_week].orders += d.orders ?? 0
    dowMap[d.day_of_week].rto    += d.rto_count ?? 0
  }
  const dowLabels = DAYS_ORDER.filter(d => dowMap[d])
  const dowRates  = dowLabels.map(d => dowMap[d].orders > 0 ? +((dowMap[d].rto / dowMap[d].orders) * 100).toFixed(2) : 0)

  const totalRto   = couriers.reduce((a, c) => a + (c.rto_count ?? 0), 0)
  const totalOrders = couriers.reduce((a, c) => a + (c.orders ?? 0), 0)
  const avgCharge  = couriers.reduce((a, c) => a + (c.avg_charge ?? 0) * (c.orders ?? 0), 0) / (totalOrders || 1)
  const rtoCostEst = totalRto * avgCharge * 2

  return (
    <div>
      <PageHeader title="RTO Analytics" subtitle={fmtMonth(month)} />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total RTO Orders"   value={fmtNum(totalRto)}   accent="red" />
        <StatCard label="Overall RTO Rate"   value={fmtPct(totalOrders > 0 ? totalRto/totalOrders*100 : 0)} accent={totalRto/totalOrders*100 > 25 ? 'red' : 'amber'} />
        <StatCard label="Worst Courier"      value={couriers[0]?.courier ?? '—'} sub={fmtPct(couriers[0]?.rto_rate)} accent="red" />
        <StatCard label="Est. RTO Cost"      value={fmtINR(rtoCostEst)} sub="fwd + return charge" accent="amber" />
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <ChartCard title="RTO Rate by Courier">
          <Bar
            data={{
              labels: couriers.map(c => c.courier),
              datasets: [{ label: 'RTO %', data: couriers.map(c => c.rto_rate), backgroundColor: couriers.map(c => courierColor(c.courier, 0.8)), borderRadius: 5 }],
            }}
            options={barOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })}
          />
        </ChartCard>

        <ChartCard title="RTO Rate by Zone">
          <Bar
            data={{
              labels: zones.map(z => `Zone ${z.zone}`),
              datasets: [{ label: 'RTO %', data: zones.map(z => z.rto_rate), backgroundColor: '#f97316', borderRadius: 5 }],
            }}
            options={barOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <ChartCard title="RTO Rate by Day of Week" subtitle="Sunday typically peaks — COD impulse returns">
          <Bar
            data={{
              labels: dowLabels,
              datasets: [{ label: 'RTO %', data: dowRates, backgroundColor: dowLabels.map(d => d === 'Sunday' ? '#ef4444' : '#3b82f6'), borderRadius: 5 }],
            }}
            options={barOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })}
          />
        </ChartCard>

        <div className="rounded-xl overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--color-border-2)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Savings per 1% RTO Reduction</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Monthly impact of lowering RTO by 1 percentage point</p>
          </div>
          <div className="divide-y px-5" style={{ borderColor: 'var(--color-border-2)' }}>
            {couriers.map(c => {
              const saving = c.orders * 0.01 * (c.avg_charge ?? 0) * 2
              return (
                <div key={c.courier} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: courierColor(c.courier) }} />
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{c.courier}</span>
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{fmtPct(c.rto_rate)}</span>
                  </div>
                  <span className="text-sm font-semibold text-emerald-600">+{fmtINR(saving)}/mo</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <TableCard title="Top 15 Sellers by RTO Volume">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <Thead>
              <Th>Seller</Th><Th right>Orders</Th><Th right>RTO Orders</Th><Th right>RTO %</Th><Th right>Avg Charge</Th>
            </Thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
              {topSellers.map(s => (
                <tr key={s.user_id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-sm" style={{ color: 'var(--color-text-primary)' }}>{s.name || `Seller ${s.user_id}`}</td>
                  <Td right>{fmtNum(s.orders)}</Td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-red-600">{fmtNum(s.rto_count)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                      s.rto_rate > 25 ? 'bg-red-50 text-red-700 border-red-100' :
                      s.rto_rate > 15 ? 'bg-amber-50 text-amber-700 border-amber-100' :
                      'bg-emerald-50 text-emerald-700 border-emerald-100'
                    }`}>{fmtPct(s.rto_rate)}</span>
                  </td>
                  <Td right>₹{s.avg_shipping_charge?.toFixed(0)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>
    </div>
  )
}
