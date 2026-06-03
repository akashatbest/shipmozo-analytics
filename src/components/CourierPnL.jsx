import { useState, useEffect } from 'react'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, fmtINR, fmtPct, fmtNum, fmtMonth, courierColor } from '../lib/chartConfig'
import { PageHeader, StatCard, ChartCard, TableCard, Thead, Th, Td, AlertBanner, MarginBadge, Spinner, EmptyState } from './ui'

export default function CourierPnL() {
  const [couriers, setCouriers]         = useState([])
  const [serviceTypes, setServiceTypes] = useState([])
  const [month, setMonth]               = useState('')
  const [loading, setLoading]           = useState(true)

  useEffect(() => {
    async function load() {
      const { data: ov } = await supabase.from('monthly_overview').select('month').order('month', { ascending: false }).limit(1)
      const latest = ov?.[0]?.month
      if (!latest) { setLoading(false); return }
      setMonth(latest)
      const [{ data: cd }, { data: st }] = await Promise.all([
        supabase.from('courier_monthly').select('*').eq('month', latest).order('orders', { ascending: false }),
        supabase.from('service_type_monthly').select('*').eq('month', latest).order('orders', { ascending: false }),
      ])
      setCouriers(cd ?? [])
      setServiceTypes(st ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Spinner />
  if (!couriers.length) return <EmptyState body="Upload a monthly CSV to see courier P&L" />

  const negativeMargin = couriers.filter(c => c.margin_pct < 0)
  const labels = couriers.map(c => c.courier)
  const colors = labels.map(l => courierColor(l))

  return (
    <div>
      <PageHeader title="Courier P&L" subtitle={fmtMonth(month)} />

      {negativeMargin.length > 0 && (
        <AlertBanner
          type="error"
          title={`${negativeMargin.length} courier${negativeMargin.length > 1 ? 's' : ''} running at negative margin`}
          body={negativeMargin.map(c => `${c.courier} (${fmtPct(c.margin_pct)})`).join(' · ')}
        />
      )}

      <div className="grid grid-cols-2 gap-5 mb-5">
        <ChartCard title="Margin % by Courier">
          <Bar
            data={{
              labels,
              datasets: [{
                label: 'Margin %',
                data: couriers.map(c => c.margin_pct),
                backgroundColor: couriers.map(c => c.margin_pct < 0 ? '#fca5a5' : courierColor(c.courier, 0.8)),
                borderColor:     couriers.map(c => c.margin_pct < 0 ? '#ef4444' : courierColor(c.courier)),
                borderWidth: 1, borderRadius: 5,
              }],
            }}
            options={barOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })}
          />
        </ChartCard>

        <ChartCard title="Revenue vs Courier Cost (₹L)">
          <Bar
            data={{
              labels,
              datasets: [
                { label: 'Revenue', data: couriers.map(c => +(c.revenue_billed/100000).toFixed(2)), backgroundColor: colors.map(c => c+'cc'), borderRadius: 5 },
                { label: 'Cost',    data: couriers.map(c => +(c.courier_cost/100000).toFixed(2)),   backgroundColor: '#fca5a5', borderRadius: 5 },
              ],
            }}
            options={barOpts({ plugins: { legend: { display: true } } })}
          />
        </ChartCard>
      </div>

      <TableCard title="Courier Summary" className="mb-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <Thead>
              <Th>Courier</Th><Th right>Orders</Th><Th right>Revenue</Th>
              <Th right>Cost</Th><Th right>Margin</Th><Th right>Margin %</Th>
              <Th right>Avg Charge</Th><Th right>Avg Weight</Th><Th right>RTO %</Th>
            </Thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
              {couriers.map(c => (
                <tr key={c.courier} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: courierColor(c.courier) }} />
                      <span className="font-medium text-sm" style={{ color: 'var(--color-text-primary)' }}>{c.courier}</span>
                    </div>
                  </td>
                  <Td right>{fmtNum(c.orders)}</Td>
                  <Td right>{fmtINR(c.revenue_billed)}</Td>
                  <Td right>{fmtINR(c.courier_cost)}</Td>
                  <td className={`px-4 py-3 text-right text-sm font-semibold ${c.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {fmtINR(c.margin)}
                  </td>
                  <td className="px-4 py-3 text-right"><MarginBadge pct={c.margin_pct} /></td>
                  <Td right>₹{c.avg_charge?.toFixed(0)}</Td>
                  <Td right>{c.avg_weight?.toFixed(2)} kg</Td>
                  <Td right>{fmtPct(c.rto_rate)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>

      <TableCard title="Service Type Breakdown">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <Thead>
              <Th>Courier</Th><Th>Service Type</Th><Th right>Orders</Th>
              <Th right>Revenue</Th><Th right>Margin %</Th><Th right>Avg Weight</Th><Th right>RTO %</Th>
            </Thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
              {serviceTypes.map((s, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: courierColor(s.courier) }} />
                      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{s.courier}</span>
                    </div>
                  </td>
                  <Td><span className="text-xs">{s.service_type}</span></Td>
                  <Td right>{fmtNum(s.orders)}</Td>
                  <Td right>{fmtINR(s.revenue_billed)}</Td>
                  <td className="px-4 py-3 text-right"><MarginBadge pct={s.margin_pct} /></td>
                  <Td right>{s.avg_weight?.toFixed(2)} kg</Td>
                  <Td right>{fmtPct(s.rto_rate)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>
    </div>
  )
}
