import { useState, useEffect } from 'react'
import { Bar, Doughnut } from 'react-chartjs-2'
import { supabase, fetchAllPaged } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, doughnutOpts, fmtPct, fmtNum, fmtINR, fmtMonth, courierColor } from '../lib/chartConfig'
import { PageHeader, StatCard, ChartCard, TableCard, Thead, Th, Td, Spinner, EmptyState } from './ui'
import { useMonth } from '../lib/monthContext'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'

const CN_COLORS = { WEIGHT:'#f59e0b', LOST:'#ef4444', FREIGHT:'#3b82f6' }
const TABS = [
  { key:'weight',  label:'Weight Discrepancies', icon:'⚖️' },
  { key:'zone',    label:'Zone Mismatches',       icon:'📍' },
  { key:'credits', label:'Credit Notes',          icon:'📋' },
]

export default function BillingAudit() {
  const { selectedMonth: month } = useMonth()
  const [tab, setTab]             = useState('weight')

  // Raw data
  const [weightAudit, setWeightAudit] = useState([])
  const [creditNotes, setCreditNotes] = useState([])
  const [overview, setOverview]       = useState(null)
  const [couriers, setCouriers]       = useState([])   // courier_monthly for rate/kg calc
  const [zones, setZones]             = useState([])   // zone_monthly for avg charges
  const [sellers, setSellers]         = useState([])   // seller_monthly for seller breakdown
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)
      const [ov, wa, cn, cm, zm, sm] = await Promise.all([
        supabase.from('monthly_overview').select('month,weight_discrepancy_count,zone_mismatch_count,total_orders,total_credit_note_amount,total_courier_cost,total_revenue_billed,gross_margin,margin_pct').eq('month', month).single().then(r => r.data),
        supabase.from('weight_audit_monthly').select('*').eq('month', month).order('discrepancy_count', { ascending: false }).then(r => r.data ?? []),
        supabase.from('credit_notes_monthly').select('*').eq('month', month).order('total_amount', { ascending: false }).then(r => r.data ?? []),
        supabase.from('courier_monthly').select('courier,orders,avg_charge,avg_weight,courier_cost,revenue_billed,margin,margin_pct').eq('month', month).then(r => r.data ?? []),
        supabase.from('zone_monthly').select('zone,orders,avg_charge,revenue_billed').eq('month', month).order('zone').then(r => r.data ?? []),
        fetchAllPaged(() => supabase.from('seller_monthly').select('user_id,name,company_name,orders,weight_discrepancy_count,zone_a_pct,zone_b_pct,zone_c_pct,zone_d_pct,zone_e_pct,revenue_billed,margin').eq('month', month).order('weight_discrepancy_count', { ascending: false })),
      ])
      setOverview(ov)
      setWeightAudit(wa)
      setCreditNotes(cn)
      setCouriers(cm)
      setZones(zm)
      setSellers(sm)
      setLoading(false)
    }
    load()
  }, [month])

  if (loading) return <Spinner />
  if (!weightAudit.length && !creditNotes.length) return <EmptyState body="Upload a monthly CSV to see billing audit" />

  // ── Weight Discrepancy Calculations ──────────────────────────────────────
  const courierMap = Object.fromEntries(couriers.map(c => [c.courier, c]))

  const weightCalc = weightAudit.map(w => {
    const cm       = courierMap[w.courier] ?? {}
    const ratePerKg = cm.avg_weight > 0 ? (cm.avg_charge / cm.avg_weight) : 0
    const estOvercharge = w.discrepancy_count * (w.avg_overcharge_kg ?? 0) * ratePerKg
    const estUndercharge = w.discrepancy_count * (w.avg_undercharge_kg ?? 0) * ratePerKg
    const netImpact = estOvercharge - estUndercharge
    return { ...w, ratePerKg, estOvercharge, estUndercharge, netImpact }
  })

  const totalEstOvercharge  = weightCalc.reduce((a, w) => a + w.estOvercharge, 0)
  const totalEstUndercharge = weightCalc.reduce((a, w) => a + w.estUndercharge, 0)
  const netWeightImpact     = totalEstOvercharge - totalEstUndercharge
  const totalDiscrepancies  = weightCalc.reduce((a, w) => a + (w.discrepancy_count ?? 0), 0)
  const totalAudited        = weightCalc.reduce((a, w) => a + (w.total_orders_audited ?? 0), 0)

  // ── Zone Mismatch Calculations ────────────────────────────────────────────
  const zoneMap  = Object.fromEntries(zones.map(z => [z.zone, z]))
  const zoneOrder = ['A','B','C','D','E']

  // Average cost to upgrade 1 zone level (weighted by zone order)
  const zonePairs = []
  for (let i = 0; i < zoneOrder.length - 1; i++) {
    const lo = zoneMap[zoneOrder[i]]
    const hi = zoneMap[zoneOrder[i+1]]
    if (lo && hi) zonePairs.push({ from: zoneOrder[i], to: zoneOrder[i+1], diff: hi.avg_charge - lo.avg_charge })
  }
  const avgUpgradeCost = zonePairs.length
    ? zonePairs.reduce((a, p) => a + Math.max(p.diff, 0), 0) / zonePairs.length
    : 0

  const totalZoneMismatches    = overview?.zone_mismatch_count ?? 0
  const totalOrders            = overview?.total_orders ?? 1
  const zoneMatchRate          = ((totalOrders - totalZoneMismatches) / totalOrders) * 100
  const estimatedExtraZoneCost = totalZoneMismatches * avgUpgradeCost
  const actualCourierCost      = overview?.total_courier_cost ?? 0
  const actualRevenue          = overview?.total_revenue_billed ?? 0
  const currentMargin          = actualRevenue > 0 ? (overview?.gross_margin / actualRevenue * 100) : 0
  const fixedCourierCost       = actualCourierCost - estimatedExtraZoneCost
  const fixedMarginPct         = actualRevenue > 0 ? ((actualRevenue - fixedCourierCost) / actualRevenue * 100) : 0
  const marginImprovement      = fixedMarginPct - currentMargin

  // Zone mismatch breakdown per courier
  const zoneMismatchByCourier = weightAudit.map(w => ({
    ...w,
    mismatch_rate:    w.total_orders_audited > 0 ? (w.zone_mismatch_count / w.total_orders_audited) * 100 : 0,
    est_extra_cost:   (w.zone_mismatch_count ?? 0) * avgUpgradeCost,
  })).sort((a, b) => b.zone_mismatch_count - a.zone_mismatch_count)

  // Top sellers by weight discrepancy
  const topDiscSellers = sellers
    .filter(s => (s.weight_discrepancy_count ?? 0) > 0)
    .sort((a, b) => b.weight_discrepancy_count - a.weight_discrepancy_count)
    .slice(0, 15)

  // Top sellers by zone mismatch exposure (high Zone D/E pct = more mismatches likely)
  const highZoneSellers = sellers
    .map(s => ({
      ...s,
      high_zone_pct: ((s.zone_d_pct ?? 0) + (s.zone_e_pct ?? 0)),
      est_zone_impact: ((s.zone_d_pct ?? 0) + (s.zone_e_pct ?? 0)) / 100 * (s.orders ?? 0) * 0.3 * avgUpgradeCost,
    }))
    .filter(s => s.high_zone_pct > 20 && (s.orders ?? 0) > 50)
    .sort((a, b) => b.est_zone_impact - a.est_zone_impact)
    .slice(0, 10)

  const totalCN  = creditNotes.reduce((a, c) => a + (c.total_amount ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="Billing Audit"
        subtitle={`${fmtMonth(month)} · Deep-dive into discrepancies, zone mismatches, and credit notes`}
        action={
          <ExportButton
            label="Export"
            onClick={() => exportCSV(`billing-audit-${month}`, weightCalc, [
              { key:'courier', label:'Courier' }, { key:'total_orders_audited', label:'Audited' },
              { key:'discrepancy_count', label:'Discrepancies' }, { key:'discrepancy_rate', label:'Disc. Rate %' },
              { key:'avg_overcharge_kg', label:'Avg Overcharge (kg)' }, { key:'estOvercharge', label:'Est. Extra Charged ₹' },
              { key:'zone_mismatch_count', label:'Zone Mismatches' },
            ])}
          />
        }
      />

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: tab === t.key ? 'var(--color-surface)' : 'transparent',
              color: tab === t.key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              boxShadow: tab === t.key ? 'var(--shadow-sm)' : 'none',
            }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── WEIGHT DISCREPANCY TAB ── */}
      {tab === 'weight' && (
        <div>
          {/* How it works */}
          <div className="rounded-xl p-4 mb-6 flex items-start gap-3"
            style={{ background:'rgba(37,99,235,0.05)', border:'1px solid rgba(37,99,235,0.12)' }}>
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm" style={{ color:'#1e40af' }}>
              <strong>What is a weight discrepancy?</strong> Sellers declare a weight when creating a shipment (label weight = <em>Courier Invoice Weight</em>).
              The courier then weighs the actual package and bills for the higher weight (<em>Charged Weight</em>).
              The gap — <em>Charged Weight − Courier Invoice Weight</em> — is always a loss for Shipmozo since we pay the courier more than what was agreed.
              Financial impact is estimated as: <em>discrepancy count × avg extra kg × rate per kg (avg charge ÷ avg weight)</em>.
            </p>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Discrepancies"   value={fmtNum(totalDiscrepancies)} sub={`${fmtPct(totalAudited > 0 ? totalDiscrepancies/totalAudited*100 : 0)} of all orders`} accent="amber" />
            <StatCard label="Est. Loss ₹"           value={fmtINR(totalEstOvercharge)} sub="courier over-billed vs agreed weight" accent="red" />
            <StatCard label="Avg Loss per Order"    value={`₹${totalDiscrepancies > 0 ? (totalEstOvercharge / totalDiscrepancies).toFixed(1) : 0}`} sub="extra charged per discrepant order" accent="red" />
            <StatCard label="Recoverable ₹"         value={fmtINR(totalEstOvercharge)} sub="total disputable with couriers" accent="amber" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <ChartCard title="Estimated Extra Charged by Courier (₹)" subtitle="Based on avg overcharge kg × rate per kg">
              <Bar
                data={{
                  labels: weightCalc.map(w => w.courier),
                  datasets: [{
                    label: 'Est. Overcharge ₹',
                    data: weightCalc.map(w => Math.round(w.estOvercharge)),
                    backgroundColor: weightCalc.map(w => courierColor(w.courier, 0.8)),
                    borderRadius: 5,
                  }],
                }}
                options={barOpts({ scales: { y: { ticks: { callback: v => fmtINR(v), font:{size:10}, color:'#94a3b8' }, grid:{color:'#f1f5f9'} } } })}
              />
            </ChartCard>

            <ChartCard title="Discrepancy Rate by Courier" subtitle="% of orders with weight mismatch">
              <Bar
                data={{
                  labels: weightCalc.map(w => w.courier),
                  datasets: [{
                    label: 'Discrepancy %',
                    data: weightCalc.map(w => w.discrepancy_rate),
                    backgroundColor: weightCalc.map(w => w.discrepancy_rate > 20 ? '#ef4444' : w.discrepancy_rate > 10 ? '#f59e0b' : '#10b981'),
                    borderRadius: 5,
                  }],
                }}
                options={barOpts({ scales: { y: { ticks: { callback: v => `${v}%`, font:{size:10}, color:'#94a3b8' }, grid:{color:'#f1f5f9'} } } })}
              />
            </ChartCard>
          </div>

          {/* Courier detail table */}
          <TableCard title="Discrepancy Detail by Courier" subtitle="Sorted by estimated financial impact" className="mb-5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <Thead>
                  <Th>Courier</Th><Th right>Audited</Th><Th right>Discrepancies</Th><Th right>Rate</Th>
                  <Th right>Avg Extra (kg)</Th><Th right>Rate/kg</Th>
                  <Th right>Est. Loss ₹</Th><Th right>Avg Loss/Order</Th>
                </Thead>
                <tbody className="divide-y" style={{ borderColor:'var(--color-border-2)' }}>
                  {weightCalc.sort((a,b) => b.estOvercharge - a.estOvercharge).map(w => (
                    <tr key={w.courier} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: courierColor(w.courier) }} />
                          <span className="font-medium text-sm" style={{ color:'var(--color-text-primary)' }}>{w.courier}</span>
                        </div>
                      </td>
                      <Td right>{fmtNum(w.total_orders_audited)}</Td>
                      <Td right>{fmtNum(w.discrepancy_count)}</Td>
                      <td className="px-4 py-3 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${w.discrepancy_rate > 20 ? 'bg-red-50 text-red-700 border-red-100' : w.discrepancy_rate > 10 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                          {fmtPct(w.discrepancy_rate)}
                        </span>
                      </td>
                      <Td right>{w.avg_overcharge_kg?.toFixed(3)} kg</Td>
                      <Td right>₹{w.ratePerKg.toFixed(1)}/kg</Td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-red-600">{fmtINR(w.estOvercharge)}</td>
                      <td className="px-4 py-3 text-right text-sm" style={{ color:'var(--color-text-secondary)' }}>
                        {w.discrepancy_count > 0 ? `₹${(w.estOvercharge / w.discrepancy_count).toFixed(0)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableCard>

          {/* Top sellers — fast aggregated view */}
          {topDiscSellers.length > 0 && (
            <TableCard title="Top Sellers by Discrepancy Count" subtitle="Focus dispute efforts here — highest order volume with discrepancies">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <Thead>
                    <Th>Seller</Th><Th right>Orders</Th><Th right>Discrepancies</Th>
                    <Th right>Disc. Rate</Th><Th right>Revenue</Th>
                  </Thead>
                  <tbody className="divide-y" style={{ borderColor:'var(--color-border-2)' }}>
                    {topDiscSellers.map(s => {
                      const rate = s.orders > 0 ? (s.weight_discrepancy_count / s.orders * 100) : 0
                      return (
                        <tr key={s.user_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-sm" style={{ color:'var(--color-text-primary)' }}>{s.name || `Seller ${s.user_id}`}</p>
                            <p className="text-xs mt-0.5" style={{ color:'var(--color-text-muted)' }}>{s.company_name}</p>
                          </td>
                          <Td right>{fmtNum(s.orders)}</Td>
                          <td className="px-4 py-3 text-right text-sm font-semibold text-amber-600">{fmtNum(s.weight_discrepancy_count)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${rate > 20 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                              {rate.toFixed(1)}%
                            </span>
                          </td>
                          <Td right>{fmtINR(s.revenue_billed)}</Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </TableCard>
          )}
        </div>
      )}

      {/* ── ZONE MISMATCH TAB ── */}
      {tab === 'zone' && (
        <div>
          {/* Financial impact hero */}
          <div className="rounded-xl p-5 mb-6" style={{ background:'linear-gradient(135deg, #fef3c7, #fff7ed)', border:'1px solid #fde68a' }}>
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <p className="text-sm font-semibold" style={{ color:'#92400e' }}>Zone Mismatch Financial Impact</p>
                <p className="text-xs mt-1 max-w-lg" style={{ color:'#b45309' }}>
                  When your courier assigns a higher zone than what Shipmozo recorded, you pay more per shipment.
                  Estimated using: <em>mismatch count × avg cost difference between adjacent zones</em>.
                  Average 1-zone upgrade cost: <strong>₹{avgUpgradeCost.toFixed(0)}</strong> per shipment.
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold" style={{ color:'#b45309' }}>{fmtINR(estimatedExtraZoneCost)}</p>
                <p className="text-xs mt-0.5" style={{ color:'#d97706' }}>estimated extra courier cost this month</p>
              </div>
            </div>

            {/* Margin impact */}
            <div className="mt-4 pt-4 flex items-center gap-6 flex-wrap" style={{ borderTop:'1px solid #fde68a' }}>
              <div>
                <p className="text-xs" style={{ color:'#92400e' }}>Current margin</p>
                <p className="text-xl font-bold" style={{ color:'#dc2626' }}>{fmtPct(currentMargin)}</p>
              </div>
              <svg className="w-6 h-6" style={{ color:'#f59e0b' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
              <div>
                <p className="text-xs" style={{ color:'#92400e' }}>If zones were correct</p>
                <p className="text-xl font-bold" style={{ color:'#059669' }}>{fmtPct(fixedMarginPct)}</p>
              </div>
              <div className="ml-2 px-3 py-1.5 rounded-full text-sm font-bold" style={{ background:'rgba(16,185,129,0.15)', color:'#059669', border:'1px solid rgba(16,185,129,0.3)' }}>
                +{marginImprovement.toFixed(2)}pp improvement
              </div>
            </div>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Zone Mismatches"      value={fmtNum(totalZoneMismatches)}     sub={`${fmtPct(100 - zoneMatchRate)} of orders`} accent="red" />
            <StatCard label="Correctly Zoned"      value={fmtPct(zoneMatchRate)}            sub={`${fmtNum(totalOrders - totalZoneMismatches)} orders`} accent="green" />
            <StatCard label="Est. Extra Paid ₹"    value={fmtINR(estimatedExtraZoneCost)}   sub="due to zone upgrades" accent="amber" />
            <StatCard label="Avg Upgrade Cost"     value={`₹${avgUpgradeCost.toFixed(0)}`}  sub="per 1-zone upgrade" accent="blue" />
          </div>

          {/* Zone cost table */}
          {zonePairs.length > 0 && (
            <div className="rounded-xl p-5 mb-5" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color:'var(--color-text-secondary)' }}>Zone Charge Differences (Source of Extra Cost)</h3>
              <div className="flex items-center gap-3 flex-wrap">
                {zonePairs.map(p => (
                  <div key={`${p.from}-${p.to}`} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                    style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                    <span className="font-semibold" style={{ color:'var(--color-text-primary)' }}>Zone {p.from}</span>
                    <svg className="w-4 h-4" style={{ color:'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                    <span className="font-semibold" style={{ color:'var(--color-text-primary)' }}>Zone {p.to}</span>
                    <span className={`font-bold text-xs px-1.5 py-0.5 rounded ${p.diff > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {p.diff > 0 ? '+' : ''}₹{p.diff.toFixed(0)} per order
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <ChartCard title="Zone Mismatch Count by Courier" subtitle="Couriers causing the most zone upgrades">
              <Bar
                data={{
                  labels: zoneMismatchByCourier.map(w => w.courier),
                  datasets: [{
                    label: 'Zone Mismatches',
                    data: zoneMismatchByCourier.map(w => w.zone_mismatch_count ?? 0),
                    backgroundColor: zoneMismatchByCourier.map(w => courierColor(w.courier, 0.8)),
                    borderRadius: 5,
                  }],
                }}
                options={barOpts()}
              />
            </ChartCard>

            <ChartCard title="Estimated Extra Cost by Courier (₹)" subtitle="Zone upgrade cost = mismatches × avg zone diff">
              <Bar
                data={{
                  labels: zoneMismatchByCourier.map(w => w.courier),
                  datasets: [{
                    label: 'Est. Extra Cost ₹',
                    data: zoneMismatchByCourier.map(w => Math.round(w.est_extra_cost)),
                    backgroundColor: zoneMismatchByCourier.map(w => courierColor(w.courier, 0.7)),
                    borderRadius: 5,
                  }],
                }}
                options={barOpts({ scales: { y: { ticks: { callback: v => fmtINR(v), font:{size:10}, color:'#94a3b8' }, grid:{color:'#f1f5f9'} } } })}
              />
            </ChartCard>
          </div>

          {/* Courier zone mismatch detail */}
          <TableCard title="Zone Mismatch by Courier" subtitle="Sorted by estimated financial impact" className="mb-5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <Thead>
                  <Th>Courier</Th><Th right>Total Orders</Th><Th right>Mismatches</Th>
                  <Th right>Mismatch Rate</Th><Th right>Est. Extra Cost</Th><Th right>Margin Impact</Th>
                </Thead>
                <tbody className="divide-y" style={{ borderColor:'var(--color-border-2)' }}>
                  {zoneMismatchByCourier.map(w => {
                    const courierRev = courierMap[w.courier]?.revenue_billed ?? 0
                    const marginImpact = courierRev > 0 ? (w.est_extra_cost / courierRev * 100) : 0
                    return (
                      <tr key={w.courier} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ background: courierColor(w.courier) }} />
                            <span className="font-medium text-sm" style={{ color:'var(--color-text-primary)' }}>{w.courier}</span>
                          </div>
                        </td>
                        <Td right>{fmtNum(w.total_orders_audited)}</Td>
                        <Td right>{fmtNum(w.zone_mismatch_count)}</Td>
                        <td className="px-4 py-3 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${w.mismatch_rate > 40 ? 'bg-red-50 text-red-700 border-red-100' : w.mismatch_rate > 20 ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                            {fmtPct(w.mismatch_rate)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-orange-600">{fmtINR(w.est_extra_cost)}</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-red-500">-{marginImpact.toFixed(2)}pp</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </TableCard>

          {/* High zone exposure sellers */}
          {highZoneSellers.length > 0 && (
            <TableCard title="Sellers with High Zone D/E Exposure" subtitle="These sellers likely have the most zone upgrade impact — worth a direct conversation with the courier">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <Thead>
                    <Th>Seller</Th><Th right>Orders</Th><Th right>Zone D+E %</Th>
                    <Th right>Zone A%</Th><Th right>Zone B%</Th><Th right>Est. Zone Impact</Th>
                  </Thead>
                  <tbody className="divide-y" style={{ borderColor:'var(--color-border-2)' }}>
                    {highZoneSellers.map(s => (
                      <tr key={s.user_id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-sm" style={{ color:'var(--color-text-primary)' }}>{s.name || `Seller ${s.user_id}`}</p>
                          <p className="text-xs mt-0.5" style={{ color:'var(--color-text-muted)' }}>{s.company_name}</p>
                        </td>
                        <Td right>{fmtNum(s.orders)}</Td>
                        <td className="px-4 py-3 text-right font-bold text-red-500">{fmtPct(s.high_zone_pct)}</td>
                        <Td right>{fmtPct(s.zone_a_pct ?? 0)}</Td>
                        <Td right>{fmtPct(s.zone_b_pct ?? 0)}</Td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-orange-600">{fmtINR(s.est_zone_impact)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableCard>
          )}
        </div>
      )}

      {/* ── CREDIT NOTES TAB ── */}
      {tab === 'credits' && (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Credit Notes" value={fmtINR(totalCN)} sub={`${fmtNum(creditNotes.reduce((a,c) => a+(c.count??0), 0))} claims`} accent="red" />
            <StatCard label="Weight Claims"    value={fmtINR(creditNotes.find(c=>c.reason==='WEIGHT')?.total_amount ?? 0)} sub={`${fmtNum(creditNotes.find(c=>c.reason==='WEIGHT')?.count ?? 0)} claims`} accent="amber" />
            <StatCard label="Lost Shipments"   value={fmtINR(creditNotes.find(c=>c.reason==='LOST')?.total_amount ?? 0)}   sub={`${fmtNum(creditNotes.find(c=>c.reason==='LOST')?.count ?? 0)} claims`} accent="red" />
            <StatCard label="Freight Claims"   value={fmtINR(creditNotes.find(c=>c.reason==='FREIGHT')?.total_amount ?? 0)} sub={`${fmtNum(creditNotes.find(c=>c.reason==='FREIGHT')?.count ?? 0)} claims`} accent="blue" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            {creditNotes.length > 0 && (
              <ChartCard title="Credit Notes by Reason (₹)">
                <Doughnut
                  data={{
                    labels: creditNotes.map(c => c.reason),
                    datasets: [{ data: creditNotes.map(c => c.total_amount), backgroundColor: creditNotes.map(c => CN_COLORS[c.reason] ?? '#64748b'), borderWidth: 2, borderColor:'#fff' }],
                  }}
                  options={doughnutOpts()}
                />
              </ChartCard>
            )}

            <div className="rounded-xl p-5" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color:'var(--color-text-secondary)' }}>Credit Note Breakdown</h3>
              <div className="space-y-3">
                {creditNotes.map(c => (
                  <div key={c.reason} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor:'var(--color-border-2)' }}>
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: CN_COLORS[c.reason] ?? '#64748b' }} />
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <span className="font-semibold text-sm" style={{ color:'var(--color-text-primary)' }}>{c.reason}</span>
                        <span className="text-sm font-bold text-red-600">{fmtINR(c.total_amount)}</span>
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <span className="text-xs" style={{ color:'var(--color-text-muted)' }}>{fmtNum(c.count)} claims</span>
                        <span className="text-xs" style={{ color:'var(--color-text-muted)' }}>{((c.total_amount / (totalCN || 1)) * 100).toFixed(1)}% of total</span>
                      </div>
                    </div>
                  </div>
                ))}
                {creditNotes.length === 0 && <p className="text-sm text-center py-4" style={{ color:'var(--color-text-muted)' }}>No credit notes this month</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
