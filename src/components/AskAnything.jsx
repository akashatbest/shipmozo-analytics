import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { chatWithHistory } from '../lib/openai'
import { fmtINR, fmtPct, fmtNum, fmtMonth, courierColor } from '../lib/chartConfig'

// ── Starter questions ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { icon: '📊', text: 'How did we perform this month overall?' },
  { icon: '🚚', text: 'Which courier is losing us money?' },
  { icon: '↩️', text: "What's driving our RTO rate?" },
  { icon: '💰', text: 'Who are our top 10 sellers by revenue?' },
  { icon: '🏷️', text: 'Which price cards need to be updated?' },
  { icon: '⚠️', text: 'Which sellers are at risk of churning?' },
  { icon: '📍', text: 'Which zones are most profitable?' },
  { icon: '🔍', text: 'Show me sellers with negative margin' },
]

// ── Question classifier ───────────────────────────────────────────────────────

function classify(q) {
  const t = q.toLowerCase()
  const cats = new Set()
  if (/courier|delhivery|bluedart|dtdc|amazon|xpressbee|ekart|shadow|b2b/i.test(t))       cats.add('couriers')
  if (/seller|customer|client|merchant|account|who.*revenue|revenue.*who/i.test(t))        cats.add('sellers')
  if (/rto|return|reverse|cod/i.test(t))                                                   cats.add('rto')
  if (/zone|local|express|distance|zone [a-e]/i.test(t))                                   cats.add('zones')
  if (/price.?card|pricing|rate|card/i.test(t))                                            cats.add('price_cards')
  if (/weight|discrepancy|billing|credit.?note|audit|mismatch/i.test(t))                   cats.add('billing')
  if (/churn|risk|health|at.risk|losing|leave/i.test(t))                                   cats.add('health')
  if (/service.?type|product|plan|surface/i.test(t))                                       cats.add('service_types')
  if (cats.size === 0 || /overall|perform|summary|total|revenue|margin|month|how.did/i.test(t)) {
    cats.add('overview')
  }
  return [...cats]
}

// ── Context fetcher — returns text for AI + raw data for viz ──────────────────

async function fetchContext(categories, month) {
  const textParts = []
  const vizData   = {}

  await Promise.all(categories.map(async cat => {
    if (cat === 'overview') {
      const { data } = await supabase.from('monthly_overview').select('*').order('month', { ascending: false }).limit(3)
      if (data?.length) {
        vizData.overview = data
        textParts.push(`MONTHLY OVERVIEW (last ${data.length} months):`)
        data.forEach(m => textParts.push(
          `  ${fmtMonth(m.month)}: ${fmtNum(m.total_orders)} orders | Revenue ${fmtINR(m.total_revenue_billed)} | Margin ${fmtINR(m.gross_margin)} (${fmtPct(m.margin_pct)}) | RTO ${fmtPct(m.rto_rate)} | ${fmtNum(m.active_sellers)} sellers`
        ))
      }
    }
    if (cat === 'couriers') {
      const { data } = await supabase.from('courier_monthly').select('*').eq('month', month).order('orders', { ascending: false })
      if (data?.length) {
        vizData.couriers = data
        textParts.push(`\nCOURIER PERFORMANCE (${fmtMonth(month)}):`)
        data.forEach(c => {
          const warn = c.margin_pct < 0 ? ' ⚠️ NEGATIVE' : c.margin_pct < 5 ? ' ⚠️ THIN' : ''
          textParts.push(`  ${c.courier}: ${fmtNum(c.orders)} orders | Margin ${fmtPct(c.margin_pct)}${warn} | RTO ${fmtPct(c.rto_rate)} | Avg ₹${c.avg_charge?.toFixed(0)}`)
        })
      }
    }
    if (cat === 'sellers') {
      const { data } = await supabase.from('seller_monthly')
        .select('user_id,name,company_name,orders,revenue_billed,margin,rto_rate,primary_courier,primary_zone')
        .eq('month', month).order('revenue_billed', { ascending: false }).limit(20)
      if (data?.length) {
        vizData.sellers = data.map(s => ({
          ...s,
          margin_pct: s.revenue_billed > 0 ? (s.margin / s.revenue_billed * 100) : 0,
        }))
        textParts.push(`\nTOP 20 SELLERS:`)
        data.forEach((s, i) => {
          const mp = s.revenue_billed > 0 ? (s.margin / s.revenue_billed * 100).toFixed(1) : 0
          textParts.push(`  ${i+1}. ${s.name || `Seller ${s.user_id}`} | ${fmtNum(s.orders)} orders | ${fmtINR(s.revenue_billed)} | ${mp}% margin | ${fmtPct(s.rto_rate)} RTO`)
        })
      }
    }
    if (cat === 'health') {
      const { data } = await supabase.from('seller_health')
        .select('user_id,health_score,risk_level,volume_trend,rto_trend,revenue_at_risk,sellers(name,company_name)')
        .in('risk_level', ['red', 'amber']).order('revenue_at_risk', { ascending: false }).limit(15)
      if (data?.length) {
        vizData.health = data.map(s => ({ ...s, name: s.sellers?.name ?? `Seller ${s.user_id}` }))
        textParts.push(`\nAT-RISK SELLERS:`)
        data.forEach(s => textParts.push(`  ${s.sellers?.name}: score=${s.health_score} (${s.risk_level}) | volume=${s.volume_trend} | RTO=${s.rto_trend} | rev at risk ${fmtINR(s.revenue_at_risk)}`))
      }
    }
    if (cat === 'zones') {
      const { data } = await supabase.from('zone_monthly').select('*').eq('month', month).order('orders', { ascending: false })
      if (data?.length) {
        vizData.zones = data
        textParts.push(`\nZONE ANALYSIS:`)
        data.forEach(z => textParts.push(`  Zone ${z.zone}: ${fmtNum(z.orders)} orders | Avg ₹${z.avg_charge?.toFixed(2)} | RTO ${fmtPct(z.rto_rate)}`))
      }
    }
    if (cat === 'price_cards') {
      const { data } = await supabase.from('price_card_monthly').select('price_card_id,orders,revenue_billed,margin,margin_pct,rto_rate,seller_count').eq('month', month).order('revenue_billed', { ascending: false }).limit(20)
      if (data?.length) {
        vizData.price_cards = data
        const neg  = data.filter(c => c.margin_pct < 0)
        const over = data.filter(c => c.margin_pct > 20)
        textParts.push(`\nPRICE CARD SUMMARY: ${data.length} cards shown`)
        if (neg.length)  textParts.push(`  NEGATIVE: ${neg.map(c => `${c.price_card_id} (${fmtPct(c.margin_pct)}, ${c.seller_count} sellers)`).join(', ')}`)
        if (over.length) textParts.push(`  OVERPRICED: ${over.map(c => `${c.price_card_id} (${fmtPct(c.margin_pct)}, ${c.seller_count} sellers)`).join(', ')}`)
      }
    }
    if (cat === 'billing') {
      const [{ data: wa }, { data: cn }] = await Promise.all([
        supabase.from('weight_audit_monthly').select('*').eq('month', month),
        supabase.from('credit_notes_monthly').select('*').eq('month', month),
      ])
      if (wa?.length) {
        vizData.billing = { weightAudit: wa, creditNotes: cn ?? [] }
        textParts.push(`\nWEIGHT AUDIT:`)
        wa.forEach(w => textParts.push(`  ${w.courier}: ${fmtNum(w.discrepancy_count)}/${fmtNum(w.total_orders_audited)} (${fmtPct(w.discrepancy_rate)}) | ${fmtNum(w.zone_mismatch_count)} zone mismatches`))
        if (cn?.length) textParts.push(`  CREDIT NOTES: ${cn.map(c => `${c.reason}: ${fmtNum(c.count)} claims, ${fmtINR(c.total_amount)}`).join(' | ')}`)
      }
    }
    if (cat === 'rto') {
      const [{ data: cd }, { data: zd }, { data: dd }] = await Promise.all([
        supabase.from('courier_monthly').select('courier,orders,rto_count,rto_rate').eq('month', month).order('rto_rate', { ascending: false }),
        supabase.from('zone_monthly').select('zone,orders,rto_count,rto_rate').eq('month', month).order('rto_rate', { ascending: false }),
        supabase.from('daily_summary').select('day_of_week,orders,rto_count,rto_rate').eq('month', month),
      ])
      if (cd?.length) {
        vizData.rto = { couriers: cd, zones: zd ?? [], daily: dd ?? [] }
        textParts.push(`\nRTO BREAKDOWN:`)
        cd.forEach(c => textParts.push(`  ${c.courier}: ${fmtPct(c.rto_rate)} (${fmtNum(c.rto_count)} returns)`))
      }
    }
    if (cat === 'service_types') {
      const { data } = await supabase.from('service_type_monthly').select('courier,service_type,orders,margin_pct,rto_rate').eq('month', month).order('orders', { ascending: false }).limit(15)
      if (data?.length) {
        vizData.service_types = data
        textParts.push(`\nSERVICE TYPES:`)
        data.forEach(s => textParts.push(`  ${s.courier} — ${s.service_type}: ${fmtNum(s.orders)} orders | ${fmtPct(s.margin_pct)} margin | ${fmtPct(s.rto_rate)} RTO`))
      }
    }
  }))

  return { contextText: textParts.join('\n'), vizData }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AskAnything() {
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [latestMonth, setLatestMonth] = useState('')
  const [noData, setNoData]     = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    supabase.from('monthly_overview').select('month').order('month', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0]) setLatestMonth(data[0].month)
        else setNoData(true)
      })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(text) {
    const q = (text ?? input).trim()
    if (!q || loading) return
    setInput('')

    const userMsg = { role: 'user', content: q }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const categories = classify(q)
      const { contextText, vizData } = await fetchContext(categories, latestMonth)

      const history = [...messages, userMsg].slice(-6).map(m => ({ role: m.role, content: m.content }))
      const reply   = await chatWithHistory(history, contextText)

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: reply,
        sources: categories,
        vizData,
      }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, I couldn't get an answer: ${e.message}`, error: true }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  if (noData) return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>No data yet</p>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Upload a monthly CSV first</p>
    </div>
  )

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Header */}
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Ask Anything</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          AI analyst with live {fmtMonth(latestMonth)} data + automatic visualizations
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-6 pb-4 min-h-0">

        {/* Welcome */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}>
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Shipmozo AI Analyst</h2>
            <p className="text-sm mb-8 max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
              Ask questions — I'll pull live data and show it as charts, tables, and insights.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map(s => (
                <button key={s.text} onClick={() => send(s.text)}
                  className="flex items-start gap-2.5 text-left px-4 py-3 rounded-xl border hover:shadow-sm transition-all text-sm group"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <span className="text-base flex-shrink-0">{s.icon}</span>
                  <span className="group-hover:text-blue-600 transition-colors">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1 mr-2"
                style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}>
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
            )}

            <div className={`${msg.role === 'user' ? 'max-w-[70%]' : 'flex-1 max-w-2xl'}`}>

              {/* AI response: viz panel + narrative in one card */}
              {msg.role === 'assistant' && !msg.error && (
                <div className="rounded-2xl rounded-tl-sm overflow-hidden"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)' }}>

                  {/* Data visualization panel */}
                  {msg.vizData && Object.keys(msg.vizData).length > 0 && (
                    <DataViz vizData={msg.vizData} />
                  )}

                  {/* AI narrative */}
                  <div className="px-4 py-3">
                    <FormattedMessage content={msg.content} />
                  </div>

                  {/* Source chips */}
                  {msg.sources?.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-4 pb-3">
                      {msg.sources.map(s => (
                        <span key={s} className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                          {SOURCE_LABELS[s] ?? s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {msg.role === 'assistant' && msg.error && (
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-red-700"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  {msg.content}
                </div>
              )}

              {/* User message */}
              {msg.role === 'user' && (
                <div className="px-4 py-3 rounded-2xl rounded-tr-sm text-sm text-white leading-relaxed"
                  style={{ background: 'var(--color-primary)' }}>
                  {msg.content}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}>
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#94a3b8', animationDelay:'0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#94a3b8', animationDelay:'120ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#94a3b8', animationDelay:'240ms' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        {messages.length > 0 && (
          <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
            {SUGGESTIONS.slice(0, 4).map(s => (
              <button key={s.text} onClick={() => send(s.text)} disabled={loading}
                className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                {s.text}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
            placeholder="Ask about your shipping data… (Enter to send)"
            rows={1} disabled={loading}
            className="flex-1 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 disabled:opacity-60"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', maxHeight: 120, overflowY: 'auto' }} />
          <button onClick={() => send()} disabled={!input.trim() || loading}
            className="px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 flex-shrink-0 transition-all disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: '#fff' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

// ── DataViz — renders the right visualization for the data fetched ────────────

function DataViz({ vizData }) {
  const panels = []

  if (vizData.overview?.length) {
    const latest = vizData.overview[0]
    const prev   = vizData.overview[1]
    panels.push(
      <div key="overview" className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
          {fmtMonth(latest.month)} Overview
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { l:'Orders',  v:fmtNum(latest.total_orders),         pv:prev?.total_orders,         curr:latest.total_orders,         good:true },
            { l:'Revenue', v:fmtINR(latest.total_revenue_billed), pv:prev?.total_revenue_billed, curr:latest.total_revenue_billed, good:true },
            { l:'Margin%', v:fmtPct(latest.margin_pct),           pv:prev?.margin_pct,           curr:latest.margin_pct,           good:true,  isRed:latest.margin_pct<5 },
            { l:'RTO Rate',v:fmtPct(latest.rto_rate),             pv:prev?.rto_rate,             curr:latest.rto_rate,             good:false, isRed:latest.rto_rate>25 },
          ].map(({ l, v, pv, curr, good, isRed }) => {
            const delta = pv ? ((curr - pv) / pv * 100) : null
            const isGood = good ? (delta > 0) : (delta < 0)
            return (
              <div key={l} className="rounded-lg p-3"
                style={{ background: isRed ? 'rgba(239,68,68,0.05)' : 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{l}</p>
                <p className="text-base font-bold mt-0.5" style={{ color: isRed ? '#dc2626' : 'var(--color-text-primary)' }}>{v}</p>
                {delta !== null && (
                  <p className={`text-xs mt-0.5 font-medium ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
                    {delta > 0 ? '↑' : '↓'}{Math.abs(delta).toFixed(1)}% MoM
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (vizData.couriers?.length) {
    const max = Math.max(...vizData.couriers.map(c => Math.abs(c.margin_pct ?? 0)), 1)
    panels.push(
      <div key="couriers" className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
          Courier Margin %
        </p>
        <div className="space-y-2">
          {vizData.couriers.map(c => {
            const isNeg  = c.margin_pct < 0
            const isThin = !isNeg && c.margin_pct < 8
            const barW   = (Math.abs(c.margin_pct) / max) * 100
            return (
              <div key={c.courier} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 w-28 flex-shrink-0">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: courierColor(c.courier) }} />
                  <span className="text-xs truncate font-medium" style={{ color: 'var(--color-text-secondary)' }}>{c.courier}</span>
                </div>
                <div className="flex-1 h-5 rounded" style={{ background: 'var(--color-surface-2)', position: 'relative' }}>
                  <div className="h-full rounded transition-all"
                    style={{ width: `${barW}%`, background: isNeg ? '#ef4444' : isThin ? '#f59e0b' : '#10b981', opacity: 0.85 }} />
                </div>
                <span className={`text-xs font-bold w-14 text-right flex-shrink-0 ${isNeg ? 'text-red-600' : isThin ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {isNeg && '−'}{fmtPct(Math.abs(c.margin_pct))}
                </span>
                <span className="text-xs w-14 text-right flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  {fmtPct(c.rto_rate)} RTO
                </span>
                {(isNeg || c.rto_rate > 25) && (
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background:'#fef2f2', color:'#dc2626' }}>
                    {isNeg ? 'Loss' : 'High RTO'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (vizData.sellers?.length) {
    const maxRev = Math.max(...vizData.sellers.map(s => s.revenue_billed ?? 0), 1)
    panels.push(
      <div key="sellers" className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
          Top Sellers by Revenue
        </p>
        <div className="space-y-2">
          {vizData.sellers.slice(0, 8).map((s, i) => {
            const barW = (s.revenue_billed / maxRev) * 100
            const isNegMargin = s.margin_pct < 0
            return (
              <div key={s.user_id} className="flex items-center gap-3">
                <span className="text-xs w-4 text-right flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{i+1}</span>
                <span className="text-xs w-28 truncate font-medium flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                  {s.name || `Seller ${s.user_id}`}
                </span>
                <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                  <div className="h-full rounded" style={{ width: `${barW}%`, background: '#3b82f6', opacity: 0.7 }} />
                </div>
                <span className="text-xs w-16 text-right flex-shrink-0 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {fmtINR(s.revenue_billed)}
                </span>
                <span className={`text-xs w-14 text-right flex-shrink-0 font-semibold ${isNegMargin ? 'text-red-500' : s.margin_pct > 20 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {s.margin_pct.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (vizData.zones?.length) {
    const maxRTO = Math.max(...vizData.zones.map(z => z.rto_rate ?? 0), 1)
    const ZONE_COLORS = { A:'#10b981', B:'#3b82f6', C:'#f59e0b', D:'#f97316', E:'#ef4444' }
    panels.push(
      <div key="zones" className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
          Zone Performance
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {vizData.zones.map(z => (
            <div key={z.zone} className="rounded-lg p-2.5 text-center"
              style={{ background: `${ZONE_COLORS[z.zone] ?? '#64748b'}12`, border: `1px solid ${ZONE_COLORS[z.zone] ?? '#64748b'}30` }}>
              <p className="text-xs font-bold" style={{ color: ZONE_COLORS[z.zone] ?? '#64748b' }}>Zone {z.zone}</p>
              <p className="text-sm font-bold mt-1" style={{ color: 'var(--color-text-primary)' }}>{fmtNum(z.orders)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>₹{z.avg_charge?.toFixed(0)} avg</p>
              <p className={`text-xs font-semibold mt-0.5 ${z.rto_rate > 25 ? 'text-red-500' : 'text-slate-500'}`}>{fmtPct(z.rto_rate)} RTO</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (vizData.rto) {
    const couriers = vizData.rto.couriers ?? []
    const maxRTO   = Math.max(...couriers.map(c => c.rto_rate ?? 0), 1)
    if (couriers.length) panels.push(
      <div key="rto" className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
          RTO Rate by Courier
        </p>
        <div className="space-y-2">
          {couriers.map(c => (
            <div key={c.courier} className="flex items-center gap-3">
              <span className="text-xs w-24 truncate font-medium flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{c.courier}</span>
              <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                <div className="h-full rounded" style={{ width: `${(c.rto_rate / maxRTO)*100}%`, background: c.rto_rate > 25 ? '#ef4444' : '#f59e0b', opacity: 0.8 }} />
              </div>
              <span className={`text-xs font-bold w-12 text-right flex-shrink-0 ${c.rto_rate > 25 ? 'text-red-600' : 'text-amber-600'}`}>
                {fmtPct(c.rto_rate)}
              </span>
              <span className="text-xs w-20 text-right flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                {fmtNum(c.rto_count)} returns
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (vizData.health?.length) {
    panels.push(
      <div key="health" className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>
          At-Risk Sellers
        </p>
        <div className="space-y-2">
          {vizData.health.slice(0, 6).map(s => {
            const RISK = { red: { bg:'#fef2f2', text:'#dc2626', border:'#fecaca' }, amber: { bg:'#fffbeb', text:'#d97706', border:'#fde68a' } }
            const rs = RISK[s.risk_level] ?? RISK.amber
            return (
              <div key={s.user_id} className="flex items-center gap-3 rounded-lg px-3 py-2"
                style={{ background: rs.bg, border: `1px solid ${rs.border}` }}>
                <div className="relative w-8 h-8 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-8 h-8 -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" stroke="#f1f5f9" />
                    <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" stroke={rs.text}
                      strokeDasharray={`${(s.health_score/100)*87.9} 87.9`} strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: rs.text }}>{s.health_score}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: rs.text }}>{s.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: rs.text, opacity: 0.7 }}>{s.volume_trend} volume · {s.rto_trend} RTO</p>
                </div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full capitalize flex-shrink-0"
                  style={{ background: rs.border, color: rs.text }}>{s.risk_level}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (vizData.billing) {
    const wa = vizData.billing.weightAudit ?? []
    const cn = vizData.billing.creditNotes ?? []
    const maxDisc = Math.max(...wa.map(w => w.discrepancy_rate ?? 0), 1)
    if (wa.length) panels.push(
      <div key="billing" className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>Weight Discrepancy Rate</p>
            <div className="space-y-1.5">
              {wa.map(w => (
                <div key={w.courier} className="flex items-center gap-2">
                  <span className="text-xs w-20 truncate" style={{ color: 'var(--color-text-secondary)' }}>{w.courier}</span>
                  <div className="flex-1 h-3 rounded overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                    <div className="h-full rounded" style={{ width: `${(w.discrepancy_rate/maxDisc)*100}%`, background: w.discrepancy_rate > 20 ? '#ef4444' : '#f59e0b', opacity: 0.8 }} />
                  </div>
                  <span className="text-xs font-semibold w-10 text-right" style={{ color: w.discrepancy_rate > 20 ? '#dc2626' : '#d97706' }}>{fmtPct(w.discrepancy_rate)}</span>
                </div>
              ))}
            </div>
          </div>
          {cn.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>Credit Notes</p>
              {cn.map(c => (
                <div key={c.reason} className="flex justify-between py-1 border-b" style={{ borderColor: 'var(--color-border-2)' }}>
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{c.reason}</span>
                  <span className="text-xs font-bold text-red-600">{fmtINR(c.total_amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!panels.length) return null

  return (
    <div style={{ borderBottom: '1px solid var(--color-border-2)' }}>
      {panels.map((panel, i) => (
        <div key={i} style={{ borderBottom: i < panels.length - 1 ? '1px solid var(--color-border-2)' : 'none' }}>
          {panel}
        </div>
      ))}
    </div>
  )
}

// ── Text formatter ────────────────────────────────────────────────────────────

function FormattedMessage({ content }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
      {content.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1.5" />
        const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith('**') && p.endsWith('**') ? <strong key={j} style={{ color: 'var(--color-text-primary)' }}>{p.slice(2,-2)}</strong> : p
        )
        if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
          return <div key={i} className="flex gap-2"><span className="text-blue-400 flex-shrink-0 mt-0.5">•</span><span>{parts}</span></div>
        }
        if (/^\d+\./.test(line.trim())) {
          return <div key={i} className="flex gap-2"><span className="text-blue-400 flex-shrink-0">{line.match(/^\d+/)[0]}.</span><span>{parts}</span></div>
        }
        return <p key={i}>{parts}</p>
      })}
    </div>
  )
}

const SOURCE_LABELS = {
  overview:'📊 overview', couriers:'🚚 couriers', sellers:'👥 sellers',
  health:'❤️ health', zones:'📍 zones', price_cards:'🏷️ price cards',
  billing:'📋 billing', service_types:'📦 service types', rto:'↩️ RTO',
}
