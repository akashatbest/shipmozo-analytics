import { useState, useEffect } from 'react'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, fmtINR, fmtPct, fmtNum, fmtMonth, courierColor } from '../lib/chartConfig'
import { PageHeader, StatCard, ChartCard, TableCard, Thead, Th, Td, AlertBanner, MarginBadge, Spinner, EmptyState } from './ui'
import { useMonth } from '../lib/monthContext'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'

export default function CourierPnL() {
  const { selectedMonth: month } = useMonth()
  const [couriers, setCouriers]         = useState([])
  const [serviceTypes, setServiceTypes] = useState([])
  const [loading, setLoading]           = useState(true)
  const [sortKey, setSortKey]           = useState(null)
  const [sortDir, setSortDir]           = useState('desc')
  const [svcSortKey, setSvcSortKey]     = useState(null)
  const [svcSortDir, setSvcSortDir]     = useState('desc')

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)
      const [{ data: cd }, { data: st }] = await Promise.all([
        supabase.from('courier_monthly').select('*').eq('month', month).order('orders', { ascending: false }),
        supabase.from('service_type_monthly').select('*').eq('month', month).order('orders', { ascending: false }),
      ])
      setCouriers(cd ?? [])
      setServiceTypes(st ?? [])
      setLoading(false)
    }
    load()
  }, [month])

  if (loading) return <Spinner />
  if (!couriers.length) return <EmptyState body="Upload a monthly CSV to see courier P&L" />

  const negativeMargin = couriers.filter(c => c.margin_pct < 0)
  const labels = couriers.map(c => c.courier)
  const colors = labels.map(l => courierColor(l))

  const sortedCouriers = sortKey
    ? [...couriers].sort((a, b) => {
        const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
        return sortDir === 'desc' ? bv - av : av - bv
      })
    : couriers

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

  const sortedServiceTypes = svcSortKey
    ? [...serviceTypes].sort((a, b) => {
        const av = a[svcSortKey] ?? 0, bv = b[svcSortKey] ?? 0
        return svcSortDir === 'desc' ? bv - av : av - bv
      })
    : serviceTypes

  function toggleSvcSort(key) {
    if (svcSortKey === key) setSvcSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSvcSortKey(key); setSvcSortDir('desc') }
  }

  const SvcSortTh = ({ col, children, right = false }) => (
    <th onClick={() => toggleSvcSort(col)}
      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={{ color: svcSortKey === col ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
      {children} {svcSortKey === col ? (svcSortDir === 'desc' ? '↓' : '↑') : ''}
    </th>
  )

  const EXPORT_COLS = [
    { key:'courier', label:'Courier' }, { key:'orders', label:'Orders' },
    { key:'revenue_billed', label:'Revenue' }, { key:'courier_cost', label:'Cost' },
    { key:'margin', label:'Margin' }, { key:'margin_pct', label:'Margin %' },
    { key:'rto_rate', label:'RTO %' }, { key:'avg_charge', label:'Avg Charge' },
  ]

  return (
    <div>
      <PageHeader title="Courier P&L" subtitle={fmtMonth(month)}
        action={<ExportButton onClick={() => exportCSV(`courier-pnl-${month}`, couriers, EXPORT_COLS)} />} />

      {negativeMargin.length > 0 && (
        <AlertBanner
          type="error"
          title={`${negativeMargin.length} courier${negativeMargin.length > 1 ? 's' : ''} running at negative margin`}
          body={negativeMargin.map(c => `${c.courier} (${fmtPct(c.margin_pct)})`).join(' · ')}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
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
              <Th>Courier</Th>
              <SortTh col="orders" right>Orders</SortTh>
              <SortTh col="revenue_billed" right>Revenue</SortTh>
              <SortTh col="courier_cost" right>Cost</SortTh>
              <SortTh col="margin" right>Margin</SortTh>
              <SortTh col="margin_pct" right>Margin %</SortTh>
              <SortTh col="avg_charge" right>Avg Charge</SortTh>
              <SortTh col="avg_weight" right>Avg Weight</SortTh>
              <SortTh col="rto_rate" right>RTO %</SortTh>
            </Thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
              {sortedCouriers.map(c => (
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
              <Th>Courier</Th><Th>Service Type</Th>
              <SvcSortTh col="orders" right>Orders</SvcSortTh>
              <SvcSortTh col="revenue_billed" right>Revenue</SvcSortTh>
              <SvcSortTh col="margin" right>Margin ₹</SvcSortTh>
              <SvcSortTh col="margin_pct" right>Margin %</SvcSortTh>
              <SvcSortTh col="avg_weight" right>Avg Weight</SvcSortTh>
              <SvcSortTh col="rto_rate" right>RTO %</SvcSortTh>
            </Thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
              {sortedServiceTypes.map((s, i) => (
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
                  <td className={`px-4 py-3 text-right text-sm font-semibold ${(s.margin ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {fmtINR(s.margin)}
                  </td>
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
