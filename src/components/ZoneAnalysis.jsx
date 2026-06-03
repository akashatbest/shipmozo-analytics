import { useState, useEffect } from 'react'
import { Bar, Doughnut } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, doughnutOpts, fmtPct, fmtNum, fmtINR, fmtMonth } from '../lib/chartConfig'
import { PageHeader, ChartCard, TableCard, Thead, Th, Td, Spinner, EmptyState } from './ui'
import { useMonth } from '../lib/monthContext'

const ZONE_COLORS = { A:'#10b981', B:'#3b82f6', C:'#f59e0b', D:'#f97316', E:'#ef4444' }
const zoneColor = z => ZONE_COLORS[z] ?? '#64748b'

export default function ZoneAnalysis() {
  const { selectedMonth: month } = useMonth()
  const [zones, setZones]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)
      const { data: zd } = await supabase.from('zone_monthly').select('*').eq('month', month).order('orders', { ascending: false })
      setZones(zd ?? [])
      setLoading(false)
    }
    load()
  }, [month])

  if (loading) return <Spinner />
  if (!zones.length) return <EmptyState body="Upload a monthly CSV to see zone analysis" />

  const totalOrders = zones.reduce((a, z) => a + (z.orders ?? 0), 0) || 1

  return (
    <div>
      <PageHeader title="Zone Analysis" subtitle={fmtMonth(month)} />

      {/* Zone KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
        {zones.map(z => (
          <div key={z.zone} className="rounded-xl p-4 relative overflow-hidden"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full" style={{ background: zoneColor(z.zone) }} />
            <div className="absolute inset-0" style={{ background: `${zoneColor(z.zone)}08` }} />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-muted)' }}>Zone {z.zone}</p>
              <p className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{fmtNum(z.orders)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {((z.orders / totalOrders) * 100).toFixed(1)}% · {fmtPct(z.rto_rate)} RTO
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <ChartCard title="Order Distribution by Zone">
          <Doughnut
            data={{
              labels: zones.map(z => `Zone ${z.zone}`),
              datasets: [{ data: zones.map(z => z.orders), backgroundColor: zones.map(z => zoneColor(z.zone)), borderWidth: 2, borderColor: '#fff' }],
            }}
            options={doughnutOpts()}
          />
        </ChartCard>

        <ChartCard title="Avg Shipping Charge by Zone (₹)">
          <Bar
            data={{
              labels: zones.map(z => `Zone ${z.zone}`),
              datasets: [{ label: 'Avg Charge', data: zones.map(z => z.avg_charge?.toFixed(2)), backgroundColor: zones.map(z => zoneColor(z.zone)), borderRadius: 5 }],
            }}
            options={barOpts({ scales: { y: { ticks: { callback: v => `₹${v}` } } } })}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <ChartCard title="RTO Rate by Zone">
          <Bar
            data={{
              labels: zones.map(z => `Zone ${z.zone}`),
              datasets: [{ label: 'RTO %', data: zones.map(z => z.rto_rate), backgroundColor: zones.map(z => z.rto_rate > 25 ? '#ef4444' : zoneColor(z.zone)), borderRadius: 5 }],
            }}
            options={barOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })}
          />
        </ChartCard>

        <ChartCard title="Revenue by Zone (₹L)">
          <Bar
            data={{
              labels: zones.map(z => `Zone ${z.zone}`),
              datasets: [{ label: 'Revenue', data: zones.map(z => +((z.revenue_billed ?? 0)/100000).toFixed(2)), backgroundColor: zones.map(z => zoneColor(z.zone)), borderRadius: 5 }],
            }}
            options={barOpts({ scales: { y: { ticks: { callback: v => `₹${v}L` } } } })}
          />
        </ChartCard>
      </div>

      <TableCard title="Zone Detail">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <Thead>
              <Th>Zone</Th><Th right>Orders</Th><Th right>Volume %</Th>
              <Th right>Revenue</Th><Th right>Avg Charge</Th><Th right>RTO Orders</Th><Th right>RTO Rate</Th>
            </Thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
              {zones.map(z => (
                <tr key={z.zone} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: zoneColor(z.zone) }} />
                      <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>Zone {z.zone}</span>
                    </div>
                  </td>
                  <Td right>{fmtNum(z.orders)}</Td>
                  <Td right>{((z.orders / totalOrders) * 100).toFixed(1)}%</Td>
                  <Td right>{fmtINR(z.revenue_billed)}</Td>
                  <Td right>₹{z.avg_charge?.toFixed(2)}</Td>
                  <Td right>{fmtNum(z.rto_count)}</Td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                      z.rto_rate > 25 ? 'bg-red-50 text-red-700 border-red-100' :
                      z.rto_rate > 15 ? 'bg-amber-50 text-amber-700 border-amber-100' :
                      'bg-emerald-50 text-emerald-700 border-emerald-100'
                    }`}>{fmtPct(z.rto_rate)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>
    </div>
  )
}
