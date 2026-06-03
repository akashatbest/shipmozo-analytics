import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fmtINR, fmtPct, fmtNum, fmtMonth } from '../lib/chartConfig'
import { PageHeader, TableCard, Thead, Th, Td, MarginBadge, Spinner, EmptyState } from './ui'
import { useMonth } from '../lib/monthContext'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'

const TABS = [
  { key:'overpriced', label:'Competitor Risk',  count_key:'overpriced', desc:'Margin >20% — seller may be poached by a cheaper platform' },
  { key:'loss',       label:'Loss Makers',       count_key:'loss',       desc:'Negative margin — you are paying to serve these sellers' },
  { key:'thin',       label:'Thin Margin',       count_key:'thin',       desc:'0–8% margin — any RTO spike pushes them to negative' },
  { key:'rto_cost',   label:'RTO Eating Margin', count_key:'rto_cost',   desc:'Estimated RTO cost exceeds 50% of earned margin' },
  { key:'high_rto',   label:'High RTO',          count_key:'high_rto',   desc:'RTO rate above 25% — high reverse logistics cost' },
]

export default function SellerIntelligence() {
  const { selectedMonth: month } = useMonth()
  const navigate = useNavigate()
  const [sellers, setSellers] = useState([])
  const [tab, setTab]         = useState('overpriced')
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!month) return
    async function load() {
      const latest = month

      let { data, error } = await supabase
        .from('seller_monthly')
        .select('user_id,name,company_name,orders,revenue_billed,courier_cost,margin,rto_count,rto_rate,avg_shipping_charge,primary_courier,primary_zone,price_card_id,credit_note_count,credit_note_amount,weight_discrepancy_count')
        .eq('month', latest).order('revenue_billed', { ascending: false })

      if (error) {
        const { data: fb } = await supabase
          .from('seller_monthly')
          .select('user_id,name,company_name,orders,revenue_billed,courier_cost,margin,rto_count,rto_rate,avg_shipping_charge,primary_courier,primary_zone,credit_note_count,credit_note_amount,weight_discrepancy_count')
          .eq('month', latest).order('revenue_billed', { ascending: false })
        data = fb
      }

      const enriched = (data ?? []).map(s => ({
        ...s,
        margin_pct: s.revenue_billed > 0 ? Math.round((s.margin / s.revenue_billed) * 10000) / 100 : 0,
      }))
      setSellers(enriched)
      setLoading(false)
    }
    load()
  }, [month])

  if (loading) return <Spinner />
  if (!sellers.length) return <EmptyState body="Upload a monthly CSV to see seller intelligence" />

  const overpriced = sellers.filter(s => (s.margin_pct ?? 0) > 20)
  const loss       = sellers.filter(s => (s.margin_pct ?? 0) < 0)
  const thin       = sellers.filter(s => (s.margin_pct ?? 0) >= 0 && (s.margin_pct ?? 0) < 8)
  const highRTO    = sellers.filter(s => (s.rto_rate ?? 0) > 25)
  const rtoCostRisk = sellers.filter(s => {
    const cost = (s.rto_count ?? 0) * (s.avg_shipping_charge ?? 0) * 2
    return cost > 0 && s.margin > 0 && cost > s.margin * 0.5
  }).map(s => ({ ...s, est_rto_cost: Math.round(s.rto_count * s.avg_shipping_charge * 2), rto_cost_ratio: Math.round((s.rto_count * s.avg_shipping_charge * 2 / s.margin) * 100) }))
    .sort((a,b) => b.rto_cost_ratio - a.rto_cost_ratio)

  const listMap = { overpriced, loss, thin, rto_cost: rtoCostRisk, high_rto: highRTO }
  let list = listMap[tab] ?? []
  if (search.trim()) {
    const q = search.toLowerCase()
    list = list.filter(s => s.name?.toLowerCase().includes(q) || s.company_name?.toLowerCase().includes(q) || String(s.user_id).includes(q))
  }

  const totalRevenueAtRisk = overpriced.reduce((a, s) => a + (s.revenue_billed ?? 0), 0)
  const totalLoss          = loss.reduce((a, s) => a + Math.abs(s.margin ?? 0), 0)

  const ACTIONS = {
    overpriced: s => `Review price card ${s.price_card_id ?? ''} — consider reducing rate by 5–8% to retain`,
    loss:       s => `Immediate: update ${s.price_card_id ?? 'price card'} or restrict zones D/E`,
    thin:       () => 'Monitor — reduce Zone D/E exposure or renegotiate courier rate',
    rto_cost:   () => 'RTO management: consider COD restrictions or address verification',
    high_rto:   () => 'Investigate return reason — consider COD cap or zone restriction',
  }

  return (
    <div>
      <PageHeader title="Seller Intelligence" subtitle={`${fmtMonth(month)} · ${sellers.length} active sellers`} />

      {/* Summary banners */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {overpriced.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <p className="text-sm font-semibold" style={{ color: '#92400e' }}>{overpriced.length} sellers overpriced (&gt;20% margin)</p>
            <p className="text-sm mt-1" style={{ color: '#b45309' }}>{fmtINR(totalRevenueAtRisk)} revenue at risk — a competitor offering 5–10% less could win them over</p>
          </div>
        )}
        {loss.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm font-semibold" style={{ color: '#991b1b' }}>{loss.length} sellers with negative margin</p>
            <p className="text-sm mt-1" style={{ color: '#b91c1c' }}>{fmtINR(totalLoss)} total loss this month — immediate price card review needed</p>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-1 p-1 rounded-xl w-full overflow-x-auto" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
        {TABS.map(t => {
          const count = (listMap[t.key] ?? []).length
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setSearch('') }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all min-w-fit"
              style={{
                background: tab === t.key ? 'var(--color-surface)' : 'transparent',
                color: tab === t.key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                boxShadow: tab === t.key ? 'var(--shadow-sm)' : 'none',
              }}>
              {t.label}
              <span className="px-1.5 py-0.5 rounded-full text-xs font-bold"
                style={{ background: tab === t.key ? 'rgba(37,99,235,0.1)' : 'var(--color-border)', color: tab === t.key ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-xs mb-4 px-1" style={{ color: 'var(--color-text-muted)' }}>
        {TABS.find(t => t.key === tab)?.desc}
      </p>

      <div className="flex items-center gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search seller name, company or ID…"
          className="flex-1 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{list.length} sellers</span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="font-semibold text-emerald-600">No sellers in this category</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Good news — nothing to action here</p>
        </div>
      ) : (
        <TableCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <Thead>
                <Th>Seller</Th><Th right>Orders</Th><Th right>Revenue</Th>
                <Th right>Margin</Th><Th right>Margin %</Th><Th right>RTO %</Th>
                {tab === 'rto_cost' && <><Th right>Est. RTO Cost</Th><Th right>RTO/Margin</Th></>}
                <Th>Price Card</Th><Th>Recommended Action</Th>
              </Thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--color-border-2)' }}>
                {list.map(s => (
                  <tr key={s.user_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <button onClick={() => navigate(`/seller/${s.user_id}`)}
                        className="font-medium text-sm text-left hover:underline"
                        style={{ color: 'var(--color-primary)' }}>
                        {s.name || `Seller ${s.user_id}`}
                      </button>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{s.company_name || `ID: ${s.user_id}`}</p>
                    </td>
                    <Td right>{fmtNum(s.orders)}</Td>
                    <Td right>{fmtINR(s.revenue_billed)}</Td>
                    <td className={`px-4 py-3 text-right text-sm font-semibold ${(s.margin ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtINR(s.margin)}</td>
                    <td className="px-4 py-3 text-right"><MarginBadge pct={s.margin_pct} /></td>
                    <td className="px-4 py-3 text-right text-sm" style={{ color: (s.rto_rate??0) > 25 ? '#dc2626' : 'var(--color-text-secondary)' }}>
                      {fmtPct(s.rto_rate)}
                    </td>
                    {tab === 'rto_cost' && (
                      <>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-orange-600">{fmtINR(s.est_rto_cost)}</td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-red-600">{s.rto_cost_ratio}%</td>
                      </>
                    )}
                    <Td><span className="text-xs">{s.price_card_id || '—'}</span></Td>
                    <td className="px-4 py-3 text-xs max-w-[200px]" style={{ color: 'var(--color-text-muted)' }}>
                      {ACTIONS[tab]?.(s) ?? '—'}
                    </td>
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
