import { useState, useEffect } from 'react'
import { Bar, Doughnut } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, doughnutOpts, fmtPct, fmtNum, fmtINR, fmtMonth, courierColor } from '../lib/chartConfig'
import { PageHeader, StatCard, ChartCard, TableCard, Thead, Th, Td, Spinner, EmptyState } from './ui'
import { useMonth } from '../lib/monthContext'

const CN_COLORS = { WEIGHT:'#f59e0b', LOST:'#ef4444', FREIGHT:'#3b82f6' }

export default function BillingAudit() {
  const { selectedMonth: month } = useMonth()
  const [weightAudit, setWeightAudit] = useState([])
  const [creditNotes, setCreditNotes] = useState([])
  const [overview, setOverview]       = useState(null)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)
      const { data: ov } = await supabase
        .from('monthly_overview').select('weight_discrepancy_count,zone_mismatch_count,total_orders,total_credit_note_amount')
        .eq('month', month).single()
      setOverview(ov)
      const [{ data: wa }, { data: cn }] = await Promise.all([
        supabase.from('weight_audit_monthly').select('*').eq('month', month).order('discrepancy_count', { ascending: false }),
        supabase.from('credit_notes_monthly').select('*').eq('month', month).order('total_amount', { ascending: false }),
      ])
      setWeightAudit(wa ?? [])
      setCreditNotes(cn ?? [])
      setLoading(false)
    }
    load()
  }, [month])

  if (loading) return <Spinner />
  if (!weightAudit.length && !creditNotes.length) return <EmptyState body="Upload a monthly CSV to see billing audit" />

  const totalCN      = creditNotes.reduce((a, c) => a + (c.total_amount ?? 0), 0)
  const totalDisc    = weightAudit.reduce((a, c) => a + (c.discrepancy_count ?? 0), 0)
  const totalAudited = weightAudit.reduce((a, c) => a + (c.total_orders_audited ?? 0), 0)
  const mismatchRate = overview ? ((overview.zone_mismatch_count / (overview.total_orders || 1)) * 100).toFixed(1) : 0

  return (
    <div>
      <PageHeader title="Billing Audit" subtitle={fmtMonth(month)} />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Weight Discrepancies" value={fmtNum(totalDisc)}       sub="orders with weight mismatch" accent="amber" />
        <StatCard label="Zone Mismatches"       value={fmtNum(overview?.zone_mismatch_count)} sub={`${mismatchRate}% of orders`} accent={+mismatchRate > 40 ? 'red' : 'amber'} alert={+mismatchRate > 40} />
        <StatCard label="Total Credit Notes"    value={fmtINR(totalCN)}        sub={`${fmtNum(creditNotes.reduce((a,c)=>a+(c.count??0),0))} claims`} accent="red" />
        <StatCard label="Overall Disc. Rate"    value={fmtPct(totalAudited > 0 ? totalDisc/totalAudited*100 : 0)} sub="across all couriers" accent="amber" />
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <ChartCard title="Discrepancy Rate by Courier">
          <Bar
            data={{
              labels: weightAudit.map(w => w.courier),
              datasets: [{ label: 'Discrepancy %', data: weightAudit.map(w => w.discrepancy_rate), backgroundColor: weightAudit.map(w => courierColor(w.courier, 0.8)), borderRadius: 5 }],
            }}
            options={barOpts({ scales: { y: { ticks: { callback: v => `${v}%` } } } })}
          />
        </ChartCard>

        <ChartCard title="Credit Notes by Reason (₹)">
          {creditNotes.length ? (
            <Doughnut
              data={{
                labels: creditNotes.map(c => c.reason),
                datasets: [{ data: creditNotes.map(c => c.total_amount), backgroundColor: creditNotes.map(c => CN_COLORS[c.reason] ?? '#64748b'), borderWidth: 2, borderColor: '#fff' }],
              }}
              options={doughnutOpts()}
            />
          ) : <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>No credit notes this month</p>}
        </ChartCard>
      </div>

      <TableCard title="Weight Discrepancy Detail" className="mb-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <Thead>
              <Th>Courier</Th><Th right>Audited</Th><Th right>Discrepancies</Th>
              <Th right>Rate</Th><Th right>Avg Overcharge</Th><Th right>Avg Undercharge</Th><Th right>Zone Mismatches</Th>
            </Thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
              {weightAudit.map(w => (
                <tr key={w.courier} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: courierColor(w.courier) }} />
                      <span className="font-medium text-sm" style={{ color: 'var(--color-text-primary)' }}>{w.courier}</span>
                    </div>
                  </td>
                  <Td right>{fmtNum(w.total_orders_audited)}</Td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-amber-600">{fmtNum(w.discrepancy_count)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                      w.discrepancy_rate > 20 ? 'bg-red-50 text-red-700 border-red-100' :
                      w.discrepancy_rate > 10 ? 'bg-amber-50 text-amber-700 border-amber-100' :
                      'bg-emerald-50 text-emerald-700 border-emerald-100'
                    }`}>{fmtPct(w.discrepancy_rate)}</span>
                  </td>
                  <Td right>{w.avg_overcharge_kg?.toFixed(3)} kg</Td>
                  <Td right>{w.avg_undercharge_kg?.toFixed(3)} kg</Td>
                  <Td right>{fmtNum(w.zone_mismatch_count)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>

      {creditNotes.length > 0 && (
        <TableCard title="Credit Note Summary">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <Thead>
                <Th>Reason</Th><Th right>Claims</Th><Th right>Total Amount</Th><Th right>% of Total</Th>
              </Thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
                {creditNotes.map(c => (
                  <tr key={c.reason} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: CN_COLORS[c.reason] ?? '#64748b' }} />
                        <span className="font-medium text-sm" style={{ color: 'var(--color-text-primary)' }}>{c.reason}</span>
                      </div>
                    </td>
                    <Td right>{fmtNum(c.count)}</Td>
                    <td className="px-4 py-3 text-right text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{fmtINR(c.total_amount)}</td>
                    <Td right>{((c.total_amount / (totalCN || 1)) * 100).toFixed(1)}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableCard>
      )}
    </div>
  )
}
