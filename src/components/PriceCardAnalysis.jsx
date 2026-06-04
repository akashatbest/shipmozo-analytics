import { useState, useEffect } from 'react'
import { Bar } from 'react-chartjs-2'
import { supabase, fetchAllPaged } from '../lib/supabase'
import '../lib/chartConfig'
import { barOpts, fmtINR, fmtPct, fmtNum, fmtMonth } from '../lib/chartConfig'
import { useMonth } from '../lib/monthContext'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'

export default function PriceCardAnalysis() {
  const { selectedMonth: month } = useMonth()
  const [cards, setCards]       = useState([])
  const [sellers, setSellers]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [view, setView]         = useState('action')   // action | all | zone
  const [drillCard, setDrillCard] = useState(null)
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState('revenue_billed')
  const [sortDir, setSortDir]   = useState('desc')

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)

      const [cd, sd] = await Promise.all([
        // price_card_monthly is ~hundreds of rows but page anyway for safety
        fetchAllPaged(() => supabase.from('price_card_monthly').select('*')
          .eq('month', month).order('revenue_billed', { ascending: false })),
        // seller_monthly can be 5000+ rows — must page through all
        fetchAllPaged(() => supabase.from('seller_monthly')
          .select('user_id,name,company_name,orders,revenue_billed,margin,rto_rate,price_card_id,primary_courier,primary_zone')
          .eq('month', month).order('orders', { ascending: false })),
      ])
      setCards(cd)
      // margin_pct isn't a stored column on seller_monthly — compute it
      setSellers(sd.map(s => ({
        ...s,
        margin_pct: s.revenue_billed > 0 ? (s.margin / s.revenue_billed) * 100 : 0,
      })))
      setLoading(false)
    }
    load()
  }, [month])

  if (loading) return <Spinner />
  if (!cards.length) return <EmptyState />

  // Segment cards
  const negative   = cards.filter(c => c.margin_pct < 0).sort((a,b) => a.margin - b.margin)
  const thin       = cards.filter(c => c.margin_pct >= 0 && c.margin_pct < 8).sort((a,b) => b.revenue_billed - a.revenue_billed)
  const overpriced = cards.filter(c => c.margin_pct > 20).sort((a,b) => b.revenue_billed - a.revenue_billed)
  const healthy    = cards.filter(c => c.margin_pct >= 8 && c.margin_pct <= 20)

  const totalLoss     = negative.reduce((a, c) => a + Math.abs(c.margin ?? 0), 0)
  const revenueAtRisk = overpriced.reduce((a, c) => a + (c.revenue_billed ?? 0), 0)

  // Filtered all-cards list
  let allCards = [...cards]
  if (search.trim()) {
    const q = search.toLowerCase()
    allCards = allCards.filter(c => String(c.price_card_id).toLowerCase().includes(q))
  }
  allCards = allCards.sort((a, b) => {
    const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const drillCardData   = drillCard ? cards.find(c => c.price_card_id === drillCard) : null
  const drillSellers    = drillCard ? sellers.filter(s => s.price_card_id === drillCard) : []

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Price Card Analysis</h1>
          <p className="text-sm text-gray-400 mt-0.5">{fmtMonth(month)} · {cards.length} price cards</p>
        </div>
        {drillCard && (
          <button onClick={() => setDrillCard(null)}
            className="text-sm text-blue-600 hover:underline">← All price cards</button>
        )}
      </div>

      {/* ── DRILL DOWN VIEW ── */}
      {drillCard && drillCardData ? (
        <DrillDown card={drillCardData} sellers={drillSellers} />
      ) : (
        <>
          {/* Summary KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryKPI label="Loss-making cards" value={negative.length}
              sub={`${fmtINR(totalLoss)} total loss`} color="red" />
            <SummaryKPI label="Thin margin (0–8%)" value={thin.length}
              sub={`${fmtNum(thin.reduce((a,c)=>a+(c.seller_count??0),0))} sellers`} color="amber" />
            <SummaryKPI label="Healthy (8–20%)" value={healthy.length}
              sub={`${fmtNum(healthy.reduce((a,c)=>a+(c.seller_count??0),0))} sellers`} color="green" />
            <SummaryKPI label="Overpriced (>20%)" value={overpriced.length}
              sub={`${fmtINR(revenueAtRisk)} at risk`} color="orange" />
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
            {[['action','Action Required'],['all','All Cards'],['zone','Zone Risk']].map(([k,l]) => (
              <button key={k} onClick={() => setView(k)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${view === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* ── ACTION REQUIRED ── */}
          {view === 'action' && (
            <div className="space-y-6">

              {/* Negative margin top 10 by loss amount */}
              {negative.length > 0 && (
                <Section
                  title={`🔴 Negative Margin — ${negative.length} cards losing money`}
                  subtitle="Sorted by total loss this month. Update price card rates immediately."
                  headerColor="red"
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide text-left">
                        {['Price Card','Sellers','Orders','Revenue','Total Loss','Margin %','RTO %','Action'].map(h=>(
                          <th key={h} className="px-4 py-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {negative.slice(0, 15).map(c => (
                        <tr key={c.price_card_id}
                          onClick={() => setDrillCard(c.price_card_id)}
                          className="hover:bg-red-50 cursor-pointer transition-colors">
                          <td className="px-4 py-3 font-bold text-gray-900">{c.price_card_id}</td>
                          <td className="px-4 py-3 text-gray-600">{fmtNum(c.seller_count)}</td>
                          <td className="px-4 py-3 text-gray-600">{fmtNum(c.orders)}</td>
                          <td className="px-4 py-3 text-gray-600">{fmtINR(c.revenue_billed)}</td>
                          <td className="px-4 py-3 font-semibold text-red-600">{fmtINR(Math.abs(c.margin))}</td>
                          <td className="px-4 py-3"><Badge pct={c.margin_pct} /></td>
                          <td className="px-4 py-3 text-gray-600">{fmtPct(c.rto_rate)}</td>
                          <td className="px-4 py-3 text-blue-500 text-xs">View sellers →</td>
                        </tr>
                      ))}
                      {negative.length > 15 && (
                        <tr><td colSpan={8} className="px-4 py-2 text-center text-xs text-gray-400">
                          +{negative.length - 15} more — switch to "All Cards" to see them
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </Section>
              )}

              {/* Overpriced top 10 by revenue at risk */}
              {overpriced.length > 0 && (
                <Section
                  title={`🟡 Overpriced (>20% margin) — ${overpriced.length} cards, competitor risk`}
                  subtitle="Sellers on these cards may be poached by competitors offering lower rates. Consider revising."
                  headerColor="amber"
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide text-left">
                        {['Price Card','Sellers','Orders','Revenue','Margin','Margin %','Potential Rate Cut'].map(h=>(
                          <th key={h} className="px-4 py-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {overpriced.slice(0, 15).map(c => {
                        // How much we could reduce rates by 8% to bring margin to ~12% and retain seller
                        const potentialCut = c.revenue_billed * 0.08
                        return (
                          <tr key={c.price_card_id}
                            onClick={() => setDrillCard(c.price_card_id)}
                            className="hover:bg-amber-50 cursor-pointer transition-colors">
                            <td className="px-4 py-3 font-bold text-gray-900">{c.price_card_id}</td>
                            <td className="px-4 py-3 text-gray-600">{fmtNum(c.seller_count)}</td>
                            <td className="px-4 py-3 text-gray-600">{fmtNum(c.orders)}</td>
                            <td className="px-4 py-3 text-gray-600">{fmtINR(c.revenue_billed)}</td>
                            <td className="px-4 py-3 text-green-600 font-semibold">{fmtINR(c.margin)}</td>
                            <td className="px-4 py-3"><Badge pct={c.margin_pct} /></td>
                            <td className="px-4 py-3 text-xs text-amber-700 font-medium">
                              ↓ {fmtINR(potentialCut)} / mo headroom
                            </td>
                          </tr>
                        )
                      })}
                      {overpriced.length > 15 && (
                        <tr><td colSpan={7} className="px-4 py-2 text-center text-xs text-gray-400">
                          +{overpriced.length - 15} more — switch to "All Cards" to see them
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </Section>
              )}

              {/* Thin margin */}
              {thin.length > 0 && (
                <Section
                  title={`🟠 Thin Margin (0–8%) — ${thin.length} cards, any RTO spike = loss`}
                  subtitle="These are currently profitable but a rise in RTO rate or courier costs will push them negative."
                  headerColor="orange"
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide text-left">
                        {['Price Card','Sellers','Orders','Revenue','Margin','Margin %','RTO %','Risk Level'].map(h=>(
                          <th key={h} className="px-4 py-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {thin.slice(0, 10).map(c => {
                        const rtoRisk = c.rto_rate > 20 ? 'High' : c.rto_rate > 12 ? 'Medium' : 'Low'
                        const riskColor = { High: 'text-red-600 font-semibold', Medium: 'text-amber-600 font-semibold', Low: 'text-gray-500' }
                        return (
                          <tr key={c.price_card_id}
                            onClick={() => setDrillCard(c.price_card_id)}
                            className="hover:bg-orange-50 cursor-pointer transition-colors">
                            <td className="px-4 py-3 font-bold text-gray-900">{c.price_card_id}</td>
                            <td className="px-4 py-3 text-gray-600">{fmtNum(c.seller_count)}</td>
                            <td className="px-4 py-3 text-gray-600">{fmtNum(c.orders)}</td>
                            <td className="px-4 py-3 text-gray-600">{fmtINR(c.revenue_billed)}</td>
                            <td className="px-4 py-3 text-green-600 font-semibold">{fmtINR(c.margin)}</td>
                            <td className="px-4 py-3"><Badge pct={c.margin_pct} /></td>
                            <td className="px-4 py-3 text-gray-600">{fmtPct(c.rto_rate)}</td>
                            <td className={`px-4 py-3 text-sm ${riskColor[rtoRisk]}`}>{rtoRisk} RTO risk</td>
                          </tr>
                        )
                      })}
                      {thin.length > 10 && (
                        <tr><td colSpan={8} className="px-4 py-2 text-center text-xs text-gray-400">
                          +{thin.length - 10} more — switch to "All Cards"
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </Section>
              )}
            </div>
          )}

          {/* ── ALL CARDS ── */}
          {view === 'all' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search price card ID…"
                  className="w-64 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="flex gap-2 ml-auto text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block"/>Loss</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"/>Thin</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block"/>Healthy</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block"/>Overpriced</span>
                </div>
                <span className="text-sm text-gray-400">{allCards.length} cards</span>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide text-left">
                      {[['price_card_id','Price Card'],['seller_count','Sellers'],['orders','Orders'],['revenue_billed','Revenue'],['margin','Margin'],['margin_pct','Margin %'],['rto_rate','RTO %'],['avg_weight','Avg Wt']].map(([k,l]) => (
                        <th key={k} className="px-4 py-3 font-medium cursor-pointer hover:text-gray-600"
                          onClick={() => { setSortKey(k); setSortDir(d => k === sortKey ? (d==='desc'?'asc':'desc') : 'desc') }}>
                          {l} {sortKey===k ? (sortDir==='desc'?'↓':'↑') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {allCards.map(c => (
                      <tr key={c.price_card_id}
                        onClick={() => setDrillCard(c.price_card_id)}
                        className="hover:bg-blue-50 cursor-pointer transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.margin_pct < 0 ? 'bg-red-400' : c.margin_pct < 8 ? 'bg-amber-400' : c.margin_pct > 20 ? 'bg-orange-400' : 'bg-green-400'}`}/>
                            <span className="font-semibold text-gray-800">{c.price_card_id}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtNum(c.seller_count)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtNum(c.orders)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtINR(c.revenue_billed)}</td>
                        <td className={`px-4 py-2.5 font-medium ${c.margin < 0 ? 'text-red-500' : 'text-green-600'}`}>{fmtINR(c.margin)}</td>
                        <td className="px-4 py-2.5"><Badge pct={c.margin_pct} /></td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtPct(c.rto_rate)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{c.avg_weight?.toFixed(2)} kg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ZONE RISK ── */}
          {view === 'zone' && (
            <div>
              <p className="text-sm text-gray-500 mb-4">
                Cards with thin margin (&lt;10%) AND high Zone D+E exposure are at risk — long-distance shipments cost more, eroding already thin margins.
              </p>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide text-left">
                      <th className="px-4 py-3 font-medium">Price Card</th>
                      <th className="px-4 py-3 font-medium">Sellers</th>
                      <th className="px-4 py-3 font-medium">Margin %</th>
                      <th className="px-4 py-3 font-medium text-center">Zone A</th>
                      <th className="px-4 py-3 font-medium text-center">Zone B</th>
                      <th className="px-4 py-3 font-medium text-center">Zone C</th>
                      <th className="px-4 py-3 font-medium text-center bg-orange-50">Zone D</th>
                      <th className="px-4 py-3 font-medium text-center bg-red-50">Zone E</th>
                      <th className="px-4 py-3 font-medium">Risk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {cards
                      .filter(c => c.margin_pct < 15)
                      .sort((a,b) => {
                        const ta = (a.zone_d_orders+a.zone_e_orders)/(a.zone_a_orders+a.zone_b_orders+a.zone_c_orders+a.zone_d_orders+a.zone_e_orders||1)
                        const tb = (b.zone_d_orders+b.zone_e_orders)/(b.zone_a_orders+b.zone_b_orders+b.zone_c_orders+b.zone_d_orders+b.zone_e_orders||1)
                        return tb - ta
                      })
                      .slice(0, 30)
                      .map(c => {
                        const tot = (c.zone_a_orders+c.zone_b_orders+c.zone_c_orders+c.zone_d_orders+c.zone_e_orders)||1
                        const highZone = ((c.zone_d_orders+c.zone_e_orders)/tot*100)
                        const risky = c.margin_pct < 10 && highZone > 30
                        return (
                          <tr key={c.price_card_id}
                            onClick={() => setDrillCard(c.price_card_id)}
                            className={`cursor-pointer transition-colors ${risky ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-gray-50'}`}>
                            <td className="px-4 py-2.5 font-semibold text-gray-800">{c.price_card_id}</td>
                            <td className="px-4 py-2.5 text-gray-600">{fmtNum(c.seller_count)}</td>
                            <td className="px-4 py-2.5"><Badge pct={c.margin_pct} /></td>
                            {['zone_a_orders','zone_b_orders','zone_c_orders'].map(k => (
                              <td key={k} className="px-4 py-2.5 text-center text-xs text-gray-500">
                                {((c[k]/tot)*100).toFixed(0)}%
                              </td>
                            ))}
                            <td className={`px-4 py-2.5 text-center text-xs font-medium ${highZone>30&&c.margin_pct<10?'text-orange-700 bg-orange-50':'text-gray-500'}`}>
                              {((c.zone_d_orders/tot)*100).toFixed(0)}%
                            </td>
                            <td className={`px-4 py-2.5 text-center text-xs font-medium ${highZone>30&&c.margin_pct<10?'text-red-700 bg-red-50':'text-gray-500'}`}>
                              {((c.zone_e_orders/tot)*100).toFixed(0)}%
                            </td>
                            <td className="px-4 py-2.5 text-xs">
                              {risky
                                ? <span className="text-red-600 font-semibold">⚠ High-zone on thin margin</span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Drill-down for one price card ──────────────────────────────────────────────

function DrillDown({ card, sellers }) {
  const tot = (card.zone_a_orders+card.zone_b_orders+card.zone_c_orders+card.zone_d_orders+card.zone_e_orders)||1
  const zones = [
    { z:'A', orders:card.zone_a_orders, color:'#22c55e' },
    { z:'B', orders:card.zone_b_orders, color:'#3b82f6' },
    { z:'C', orders:card.zone_c_orders, color:'#f59e0b' },
    { z:'D', orders:card.zone_d_orders, color:'#f97316' },
    { z:'E', orders:card.zone_e_orders, color:'#ef4444' },
  ]

  return (
    <div className="space-y-6">
      {/* Card summary */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center gap-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Price Card {card.price_card_id}</h2>
            <p className="text-sm text-gray-400">{fmtNum(card.seller_count)} sellers · {fmtNum(card.orders)} orders</p>
          </div>
          <Badge pct={card.margin_pct} large />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {[
            { l:'Revenue', v:fmtINR(card.revenue_billed) },
            { l:'Courier Cost', v:fmtINR(card.courier_cost) },
            { l:'Margin', v:fmtINR(card.margin), red:card.margin<0 },
            { l:'RTO Rate', v:fmtPct(card.rto_rate) },
            { l:'Avg Weight', v:`${card.avg_weight?.toFixed(2)} kg` },
          ].map(({ l, v, red }) => (
            <div key={l} className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400">{l}</p>
              <p className={`font-semibold mt-0.5 ${red ? 'text-red-600' : 'text-gray-900'}`}>{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Zone + top sellers side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Zone Distribution</h3>
          <div className="space-y-2">
            {zones.map(({ z, orders, color }) => {
              const pct = (orders / tot) * 100
              return (
                <div key={z} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-500 w-12">Zone {z}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-5 rounded-full flex items-center pl-2 transition-all"
                      style={{ width: `${Math.max(pct, 2)}%`, background: color }}>
                      {pct > 8 && <span className="text-white text-xs font-medium">{pct.toFixed(0)}%</span>}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-16 text-right">{fmtNum(orders)}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Sellers on this Card</h3>
          <div className="space-y-2">
            {sellers.slice(0, 8).map(s => (
              <div key={s.user_id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-800 truncate max-w-[160px]">{s.name || `Seller ${s.user_id}`}</p>
                  <p className="text-xs text-gray-400">{fmtNum(s.orders)} orders · Zone {s.primary_zone || '?'}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <Badge pct={s.margin_pct} />
                  <p className="text-xs text-gray-400 mt-0.5">{fmtINR(s.revenue_billed)}</p>
                </div>
              </div>
            ))}
            {sellers.length === 0 && <p className="text-sm text-gray-400">No seller data — re-upload CSV to populate</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Shared pieces ──────────────────────────────────────────────────────────────

function Section({ title, subtitle, headerColor, children }) {
  const bg = { red:'bg-red-50 border-red-100', amber:'bg-amber-50 border-amber-100', orange:'bg-orange-50 border-orange-100' }
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className={`px-5 py-4 border-b ${bg[headerColor] ?? 'bg-gray-50 border-gray-100'}`}>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function SummaryKPI({ label, value, sub, color }) {
  const styles = {
    red:    'border-red-200    bg-red-50    text-red-700',
    amber:  'border-amber-200  bg-amber-50  text-amber-700',
    green:  'border-green-200  bg-green-50  text-green-700',
    orange: 'border-orange-200 bg-orange-50 text-orange-700',
  }
  return (
    <div className={`border rounded-xl p-5 ${styles[color] ?? 'border-gray-200 bg-white text-gray-700'}`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm font-semibold mt-1">{label}</p>
      {sub && <p className="text-xs opacity-70 mt-0.5">{sub}</p>}
    </div>
  )
}

function Badge({ pct, large = false }) {
  const p = pct ?? 0
  const color = p < 0 ? 'bg-red-100 text-red-700' : p < 8 ? 'bg-amber-100 text-amber-700' : p > 20 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
  return (
    <span className={`inline-flex rounded-full font-semibold ${large ? 'px-3 py-1 text-base' : 'px-2 py-0.5 text-xs'} ${color}`}>
      {fmtPct(p)}
    </span>
  )
}

function Spinner() { return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div> }
function EmptyState() { return <div className="flex flex-col items-center justify-center h-64 text-center"><p className="font-medium text-gray-700">No data yet</p><p className="text-sm text-gray-400 mt-1">Run the SQL migration then re-upload your CSV</p></div> }
