import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtINR, fmtPct, fmtNum, fmtMonth } from '../lib/chartConfig'
import { useMonth } from '../lib/monthContext'
import { PageHeader, Spinner, EmptyState } from './ui'
import { exportCSV, ExportButton } from '../lib/exportCSV.jsx'

// ── Recommendation algorithm ─────────────────────────────────────────────────

function cardZoneVec(card) {
  const t = (card.zone_a_orders + card.zone_b_orders + card.zone_c_orders + card.zone_d_orders + card.zone_e_orders) || 1
  return [card.zone_a_orders/t, card.zone_b_orders/t, card.zone_c_orders/t, card.zone_d_orders/t, card.zone_e_orders/t]
}

function sellerZoneVec(s) {
  return [(s.zone_a_pct??0)/100, (s.zone_b_pct??0)/100, (s.zone_c_pct??0)/100, (s.zone_d_pct??0)/100, (s.zone_e_pct??0)/100]
}

function cosine(a, b) {
  const dot = a.reduce((s, ai, i) => s + ai * b[i], 0)
  const magA = Math.sqrt(a.reduce((s, ai) => s + ai*ai, 0))
  const magB = Math.sqrt(b.reduce((s, bi) => s + bi*bi, 0))
  return magA && magB ? dot / (magA * magB) : 0
}

function buildRecommendations(sellers, cards) {
  // Only use price cards with enough data
  const validCards = cards.filter(c => c.orders >= 200 && c.seller_count >= 3)
  const cardVecCache = Object.fromEntries(validCards.map(c => [c.price_card_id, cardZoneVec(c)]))

  return sellers
    .filter(s => s.price_card_id && s.orders >= 50)
    .map(seller => {
      const currentMarginPct = seller.revenue_billed > 0
        ? (seller.margin / seller.revenue_billed) * 100
        : 0

      // Classify this seller
      let type
      if (currentMarginPct < 0)       type = 'recover'   // losing money
      else if (currentMarginPct < 8)  type = 'improve'   // thin margin
      else if (currentMarginPct > 20) type = 'retain'    // overpriced — churn risk
      else                            type = null         // healthy

      // Filter candidate cards
      const candidates = validCards.filter(card => {
        if (card.price_card_id === seller.price_card_id) return false
        if (type === 'recover' || type === 'improve') return card.margin_pct > currentMarginPct + 3
        if (type === 'retain')                         return card.margin_pct >= 8 && card.margin_pct < currentMarginPct - 3
        return false  // skip healthy sellers for now
      })

      if (!candidates.length) return null

      const sellerVec = sellerZoneVec(seller)

      // Score each candidate
      const scored = candidates.map(card => {
        const fit = cosine(sellerVec, cardVecCache[card.price_card_id]) * 100
        const marginDelta = card.margin_pct - currentMarginPct

        // For retention: prioritise zone fit (keep rates similar, better structure)
        // For recovery/improve: prioritise margin improvement
        const score = type === 'retain'
          ? fit * 0.65 + (20 - Math.abs(marginDelta + 8)) * 0.35
          : (Math.min(marginDelta, 30) / 30) * 0.65 + (fit / 100) * 0.35

        return { card, fit, marginDelta, score }
      }).sort((a, b) => b.score - a.score)

      const best = scored[0]
      if (!best || best.fit < 20) return null  // discard if zone fit is too poor

      // Conservative estimate: apply 70% of the card's margin advantage
      // (actual depends on seller's specific shipping, full card rates unknown)
      const adjFactor = type === 'retain' ? 1.0 : 0.7
      const estimatedMarginPct = currentMarginPct + best.marginDelta * adjFactor
      const monthlyImpact = (estimatedMarginPct - currentMarginPct) / 100 * seller.revenue_billed

      // Skip trivial impacts
      if (Math.abs(monthlyImpact) < 1000) return null

      return {
        user_id:              seller.user_id,
        name:                 seller.name,
        company_name:         seller.company_name,
        orders:               seller.orders,
        revenue:              seller.revenue_billed,
        current_card:         seller.price_card_id,
        current_margin_pct:   Math.round(currentMarginPct * 10) / 10,
        recommended_card:     best.card.price_card_id,
        rec_card_avg_margin:  Math.round(best.card.margin_pct * 10) / 10,
        zone_fit:             Math.round(best.fit),
        estimated_margin_pct: Math.round(estimatedMarginPct * 10) / 10,
        monthly_impact:       Math.round(monthlyImpact),
        annual_impact:        Math.round(monthlyImpact * 12),
        type,
        primary_zone:         seller.primary_zone,
        primary_courier:      seller.primary_courier,
      }
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.monthly_impact) - Math.abs(a.monthly_impact))
}

// ── Component ─────────────────────────────────────────────────────────────────

const TYPE_META = {
  recover: { label: 'Recover',     desc: 'Negative margin — losing money every shipment',    color: 'red',    bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  improve: { label: 'Improve',     desc: 'Thin margin (0–8%) — any RTO spike = negative',    color: 'amber',  bg: '#fffbeb', border: '#fde68a', text: '#d97706' },
  retain:  { label: 'Retain',      desc: 'Overpriced (>20%) — competitor poaching risk',     color: 'orange', bg: '#fff7ed', border: '#fed7aa', text: '#ea580c' },
}

const FIT_COLOR = f => f >= 80 ? 'text-emerald-600' : f >= 60 ? 'text-amber-600' : 'text-red-500'

export default function PricingEngine() {
  const { selectedMonth: month } = useMonth()
  const [sellers, setSellers]     = useState([])
  const [cards, setCards]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch]       = useState('')
  const [selected, setSelected]   = useState(new Set())

  useEffect(() => {
    if (!month) return
    async function load() {
      setLoading(true)
      const [{ data: sd }, { data: cd }] = await Promise.all([
        supabase.from('seller_monthly')
          .select('user_id,name,company_name,orders,revenue_billed,margin,zone_a_pct,zone_b_pct,zone_c_pct,zone_d_pct,zone_e_pct,price_card_id,primary_zone,primary_courier')
          .eq('month', month).order('revenue_billed', { ascending: false }),
        supabase.from('price_card_monthly')
          .select('price_card_id,orders,seller_count,revenue_billed,courier_cost,margin,margin_pct,zone_a_orders,zone_b_orders,zone_c_orders,zone_d_orders,zone_e_orders,avg_weight')
          .eq('month', month),
      ])
      setSellers(sd ?? [])
      setCards(cd ?? [])
      setLoading(false)
    }
    load()
  }, [month])

  const recs = useMemo(() => buildRecommendations(sellers, cards), [sellers, cards])

  const filtered = useMemo(() => {
    let out = recs
    if (typeFilter !== 'all') out = out.filter(r => r.type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(r => r.name?.toLowerCase().includes(q) || r.company_name?.toLowerCase().includes(q) || String(r.user_id).includes(q))
    }
    return out
  }, [recs, typeFilter, search])

  const selectedRecs    = filtered.filter(r => selected.has(r.user_id))
  const selectedImpact  = selectedRecs.reduce((a, r) => a + r.monthly_impact, 0)
  const totalImpact     = recs.reduce((a, r) => a + r.monthly_impact, 0)
  const typeCounts      = { recover: recs.filter(r=>r.type==='recover').length, improve: recs.filter(r=>r.type==='improve').length, retain: recs.filter(r=>r.type==='retain').length }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(r => r.user_id)))
  }

  function toggleOne(id) {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  const EXPORT_COLS = [
    { key:'name', label:'Seller' }, { key:'company_name', label:'Company' },
    { key:'orders', label:'Orders' }, { key:'revenue', label:'Revenue' },
    { key:'current_card', label:'Current Card' }, { key:'current_margin_pct', label:'Current Margin %' },
    { key:'recommended_card', label:'Recommended Card' }, { key:'rec_card_avg_margin', label:'Card Avg Margin %' },
    { key:'zone_fit', label:'Zone Fit %' }, { key:'estimated_margin_pct', label:'Est. New Margin %' },
    { key:'monthly_impact', label:'Monthly Impact ₹' }, { key:'annual_impact', label:'Annual Impact ₹' },
    { key:'type', label:'Type' }, { key:'primary_zone', label:'Primary Zone' },
  ]

  if (loading) return <Spinner />
  if (!recs.length && !loading) return (
    <div>
      <PageHeader title="Pricing Engine" subtitle={fmtMonth(month)} />
      <EmptyState
        title="No recommendations found"
        body="Either all sellers are on optimal cards, or price_card_id data isn't available yet. Re-upload your CSV to populate price card data."
      />
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Pricing Engine"
        subtitle={`${fmtMonth(month)} · ${recs.length} sellers with better card options identified`}
        action={
          <ExportButton
            label={selected.size > 0 ? `Export ${selected.size} selected` : 'Export all'}
            onClick={() => exportCSV(`pricing-recommendations-${month}`, selected.size > 0 ? selectedRecs : filtered, EXPORT_COLS)}
          />
        }
      />

      {/* How it works */}
      <div className="rounded-xl p-4 mb-6 flex items-start gap-3 text-sm"
        style={{ background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.12)' }}>
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <p style={{ color: '#1e40af' }}>
          <strong>How recommendations work:</strong> Each seller's zone profile (% A–E) is compared against all price cards using cosine similarity.
          Cards with better margin AND matching zone profiles surface as recommendations.
          <strong> Zone Fit</strong> = how closely the card was designed for this type of shipping.
          <strong> Est. Margin</strong> = conservative estimate (70% of card advantage applied).
          Monthly impact estimates are directional — exact amounts depend on full rate sheet.
        </p>
      </div>

      {/* Impact summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <ImpactCard label="Total Opportunity" value={fmtINR(totalImpact)} sub={`${recs.length} sellers · annually ${fmtINR(totalImpact * 12)}`} color="#2563eb" />
        {Object.entries(TYPE_META).map(([key, meta]) => (
          <ImpactCard key={key} label={`${meta.label} (${typeCounts[key]})`}
            value={fmtINR(recs.filter(r=>r.type===key).reduce((a,r)=>a+r.monthly_impact,0))}
            sub={meta.desc} color={meta.text}
            onClick={() => setTypeFilter(t => t === key ? 'all' : key)}
            active={typeFilter === key}
          />
        ))}
      </div>

      {/* Selected impact bar */}
      {selected.size > 0 && (
        <div className="rounded-xl p-4 mb-4 flex items-center justify-between"
          style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)' }}>
          <div>
            <span className="text-sm font-semibold" style={{ color: '#1e40af' }}>
              {selected.size} sellers selected
            </span>
            <span className="text-sm ml-2" style={{ color: '#3b82f6' }}>
              → {fmtINR(selectedImpact)}/month improvement if migrated
            </span>
          </div>
          <button onClick={() => setSelected(new Set())} className="text-xs text-blue-600 hover:underline">
            Clear selection
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          {[['all','All'], ['recover','Recover'], ['improve','Improve'], ['retain','Retain']].map(([k, l]) => (
            <button key={k} onClick={() => setTypeFilter(k)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: typeFilter === k ? 'var(--color-surface)' : 'transparent',
                color: typeFilter === k ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                boxShadow: typeFilter === k ? 'var(--shadow-sm)' : 'none',
              }}>
              {l} {k !== 'all' && <span className="ml-1 opacity-60">({typeCounts[k] ?? 0})</span>}
            </button>
          ))}
        </div>

        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search seller…"
          className="flex-1 min-w-[200px] rounded-lg px-4 py-2 text-sm focus:outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />

        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{filtered.length} recommendations</span>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border-2)' }}>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="rounded cursor-pointer" />
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-left" style={{ color: 'var(--color-text-muted)' }}>Seller</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-right" style={{ color: 'var(--color-text-muted)' }}>Orders</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-right" style={{ color: 'var(--color-text-muted)' }}>Revenue</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Type</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Current Card</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>→ Recommended</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-right" style={{ color: 'var(--color-text-muted)' }}>Zone Fit</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-right" style={{ color: 'var(--color-text-muted)' }}>Now → After</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-right" style={{ color: 'var(--color-text-muted)' }}>Monthly Impact</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => {
                const meta = TYPE_META[r.type]
                const isSelected = selected.has(r.user_id)
                const isLast = idx === filtered.length - 1
                const marginImproving = r.monthly_impact > 0

                return (
                  <tr key={r.user_id}
                    onClick={() => toggleOne(r.user_id)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                    style={{
                      borderBottom: isLast ? 'none' : '1px solid var(--color-border-2)',
                      background: isSelected ? 'rgba(37,99,235,0.04)' : undefined,
                    }}>

                    <td className="px-4 py-4" onClick={e => { e.stopPropagation(); toggleOne(r.user_id) }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(r.user_id)} className="rounded cursor-pointer" />
                    </td>

                    {/* Seller */}
                    <td className="px-4 py-4">
                      <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{r.name || `Seller ${r.user_id}`}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {r.company_name} · {r.primary_courier} · {r.primary_zone ? `Zone ${r.primary_zone}` : ''}
                      </p>
                    </td>

                    <td className="px-4 py-4 text-right text-sm" style={{ color: 'var(--color-text-secondary)' }}>{fmtNum(r.orders)}</td>
                    <td className="px-4 py-4 text-right text-sm" style={{ color: 'var(--color-text-secondary)' }}>{fmtINR(r.revenue)}</td>

                    {/* Type badge */}
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold border"
                        style={{ background: meta.bg, color: meta.text, borderColor: meta.border }}>
                        {meta.label}
                      </span>
                    </td>

                    {/* Current card */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold px-2 py-1 rounded"
                          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                          {r.current_card}
                        </span>
                      </div>
                    </td>

                    {/* Recommended card */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        <span className="font-mono text-xs font-bold px-2 py-1 rounded"
                          style={{ background: marginImproving ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', color: marginImproving ? '#059669' : '#dc2626', border: `1px solid ${marginImproving ? '#a7f3d0' : '#fecaca'}` }}>
                          {r.recommended_card}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>avg {fmtPct(r.rec_card_avg_margin)}</span>
                      </div>
                    </td>

                    {/* Zone fit */}
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-12 rounded-full h-1.5" style={{ background: 'var(--color-border)' }}>
                          <div className="h-1.5 rounded-full"
                            style={{ width: `${r.zone_fit}%`, background: r.zone_fit >= 80 ? '#10b981' : r.zone_fit >= 60 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        <span className={`text-xs font-semibold ${FIT_COLOR(r.zone_fit)}`}>{r.zone_fit}%</span>
                      </div>
                    </td>

                    {/* Margin now → after */}
                    <td className="px-4 py-4 text-right">
                      <span className={`text-xs font-medium ${r.current_margin_pct < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                        {fmtPct(r.current_margin_pct)}
                      </span>
                      <span className="text-xs mx-1.5" style={{ color: 'var(--color-text-muted)' }}>→</span>
                      <span className={`text-xs font-bold ${r.estimated_margin_pct >= 8 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {fmtPct(r.estimated_margin_pct)}
                      </span>
                    </td>

                    {/* Monthly impact */}
                    <td className="px-4 py-4 text-right">
                      <span className={`text-sm font-bold ${marginImproving ? 'text-emerald-600' : 'text-red-500'}`}>
                        {marginImproving ? '+' : ''}{fmtINR(r.monthly_impact)}
                      </span>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {fmtINR(r.annual_impact)}/yr
                      </p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center" style={{ color: 'var(--color-text-muted)' }}>
            No recommendations match the current filter.
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-xs mt-4 text-center" style={{ color: 'var(--color-text-muted)' }}>
        Estimates use 70% of the card's margin advantage as a conservative proxy. Exact impact depends on your full rate sheet.
        Use this as a prioritised outreach list — highest impact sellers first.
      </p>
    </div>
  )
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function ImpactCard({ label, value, sub, color, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl p-5 text-left transition-all w-full ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${active ? color : 'var(--color-border)'}`,
        boxShadow: active ? `0 0 0 3px ${color}22` : 'var(--shadow-sm)',
      }}>
      <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
    </button>
  )
}
