import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { chatWithHistory } from '../lib/openai'
import { fmtINR, fmtPct, fmtNum, fmtMonth } from '../lib/chartConfig'

// ── Suggested starter questions ───────────────────────────────────────────────

const SUGGESTIONS = [
  { icon: '📊', text: 'How did we perform this month overall?' },
  { icon: '🚚', text: 'Which courier is losing us money?' },
  { icon: '🔴', text: 'Which sellers should we review rates for?' },
  { icon: '↩️', text: "What's driving our RTO rate?" },
  { icon: '🏷️', text: 'Which price cards need to be updated?' },
  { icon: '💰', text: 'Who are our top 10 sellers by revenue?' },
  { icon: '📍', text: 'Which zones are most profitable?' },
  { icon: '⚠️', text: 'Which sellers are at risk of churning?' },
]

// ── Question → data category classifier ──────────────────────────────────────

function classify(q) {
  const t = q.toLowerCase()
  const cats = new Set()

  if (/courier|delhivery|bluedart|dtdc|amazon|xpressbee|ekart|shadow|b2b/i.test(t))       cats.add('couriers')
  if (/seller|customer|client|merchant|account|revenue.*who|who.*revenue/i.test(t))        cats.add('sellers')
  if (/rto|return|reverse|cod|impulse/i.test(t))                                           cats.add('rto')
  if (/zone|local|express|distance|zone [a-e]/i.test(t))                                   cats.add('zones')
  if (/price.?card|pricing|rate|card/i.test(t))                                            cats.add('price_cards')
  if (/weight|discrepancy|billing|credit.?note|audit|mismatch/i.test(t))                   cats.add('billing')
  if (/churn|risk|health|at.risk|losing|leave/i.test(t))                                   cats.add('health')
  if (/service.?type|product|plan|surface|express/i.test(t))                               cats.add('service_types')

  // Always include overview for general questions or if nothing else matched
  if (cats.size === 0 || /overall|perform|summary|total|revenue|margin|month|how.did/i.test(t)) {
    cats.add('overview')
  }

  return [...cats]
}

// ── Context fetcher — pulls only the relevant data ────────────────────────────

async function fetchContext(categories, month) {
  const parts = []

  await Promise.all(categories.map(async cat => {
    if (cat === 'overview') {
      const { data } = await supabase
        .from('monthly_overview').select('*').order('month', { ascending: false }).limit(3)
      if (data?.length) {
        parts.push(`MONTHLY OVERVIEW (last ${data.length} months):`)
        data.forEach(m => {
          parts.push(
            `  ${fmtMonth(m.month)}: ${fmtNum(m.total_orders)} orders | ` +
            `Revenue ${fmtINR(m.total_revenue_billed)} | ` +
            `Margin ${fmtINR(m.gross_margin)} (${fmtPct(m.margin_pct)}) | ` +
            `RTO ${fmtPct(m.rto_rate)} | ` +
            `${fmtNum(m.active_sellers)} sellers | ` +
            `${fmtNum(m.zone_mismatch_count)} zone mismatches`
          )
        })
      }
    }

    if (cat === 'couriers') {
      const { data } = await supabase
        .from('courier_monthly').select('*').eq('month', month).order('orders', { ascending: false })
      if (data?.length) {
        parts.push(`\nCOURIER PERFORMANCE (${fmtMonth(month)}):`)
        data.forEach(c => {
          const warn = c.margin_pct < 0 ? ' ⚠️ NEGATIVE MARGIN' : c.margin_pct < 5 ? ' ⚠️ THIN MARGIN' : ''
          parts.push(
            `  ${c.courier}: ${fmtNum(c.orders)} orders | ` +
            `Margin ${fmtPct(c.margin_pct)}${warn} | ` +
            `RTO ${fmtPct(c.rto_rate)} | ` +
            `Avg charge ₹${c.avg_charge?.toFixed(0)} | ` +
            `Weight disc. ${fmtNum(c.weight_discrepancy_count)}`
          )
        })
      }
    }

    if (cat === 'sellers') {
      const { data } = await supabase
        .from('seller_monthly')
        .select('user_id,name,company_name,orders,revenue_billed,margin,rto_rate,primary_courier,primary_zone')
        .eq('month', month).order('revenue_billed', { ascending: false }).limit(20)
      if (data?.length) {
        parts.push(`\nTOP 20 SELLERS BY REVENUE (${fmtMonth(month)}):`)
        data.forEach((s, i) => {
          const margin_pct = s.revenue_billed > 0 ? (s.margin / s.revenue_billed * 100).toFixed(1) : 0
          parts.push(
            `  ${i+1}. ${s.name || `Seller ${s.user_id}`} | ` +
            `${fmtNum(s.orders)} orders | ` +
            `${fmtINR(s.revenue_billed)} revenue | ` +
            `${margin_pct}% margin | ` +
            `${fmtPct(s.rto_rate)} RTO | ` +
            `${s.primary_courier || '?'} | Zone ${s.primary_zone || '?'}`
          )
        })
      }
    }

    if (cat === 'health') {
      const { data } = await supabase
        .from('seller_health')
        .select('user_id,health_score,risk_level,volume_trend,rto_trend,revenue_at_risk,recommended_action,sellers(name,company_name)')
        .in('risk_level', ['red', 'amber'])
        .order('revenue_at_risk', { ascending: false })
        .limit(15)
      if (data?.length) {
        parts.push(`\nAT-RISK SELLERS (${fmtMonth(month)}):`)
        data.forEach(s => {
          parts.push(
            `  ${s.sellers?.name || `Seller ${s.user_id}`}: ` +
            `score=${s.health_score} (${s.risk_level}) | ` +
            `volume=${s.volume_trend} | RTO=${s.rto_trend} | ` +
            `revenue at risk ${fmtINR(s.revenue_at_risk)}`
          )
        })
      }
    }

    if (cat === 'zones') {
      const { data } = await supabase
        .from('zone_monthly').select('*').eq('month', month).order('orders', { ascending: false })
      if (data?.length) {
        parts.push(`\nZONE ANALYSIS (${fmtMonth(month)}):`)
        data.forEach(z => {
          parts.push(
            `  Zone ${z.zone}: ${fmtNum(z.orders)} orders | ` +
            `Avg charge ₹${z.avg_charge?.toFixed(2)} | ` +
            `RTO ${fmtPct(z.rto_rate)}`
          )
        })
      }
    }

    if (cat === 'price_cards') {
      const { data } = await supabase
        .from('price_card_monthly').select('price_card_id,orders,revenue_billed,margin,margin_pct,rto_rate,seller_count')
        .eq('month', month).order('revenue_billed', { ascending: false }).limit(20)
      if (data?.length) {
        const neg = data.filter(c => c.margin_pct < 0)
        const over = data.filter(c => c.margin_pct > 20)
        parts.push(`\nPRICE CARD SUMMARY (${fmtMonth(month)}): ${data.length} cards shown of all active cards`)
        if (neg.length) {
          parts.push(`  NEGATIVE MARGIN cards: ${neg.map(c => `${c.price_card_id} (${fmtPct(c.margin_pct)}, ${c.seller_count} sellers)`).join(', ')}`)
        }
        if (over.length) {
          parts.push(`  OVERPRICED (>20%) cards: ${over.map(c => `${c.price_card_id} (${fmtPct(c.margin_pct)}, ${c.seller_count} sellers)`).join(', ')}`)
        }
        parts.push(`  Top cards by revenue:`)
        data.slice(0, 10).forEach(c => {
          parts.push(`    ${c.price_card_id}: ${fmtNum(c.orders)} orders | ${fmtINR(c.revenue_billed)} | margin ${fmtPct(c.margin_pct)} | ${c.seller_count} sellers`)
        })
      }
    }

    if (cat === 'billing') {
      const [{ data: wa }, { data: cn }] = await Promise.all([
        supabase.from('weight_audit_monthly').select('*').eq('month', month),
        supabase.from('credit_notes_monthly').select('*').eq('month', month),
      ])
      if (wa?.length) {
        parts.push(`\nWEIGHT AUDIT (${fmtMonth(month)}):`)
        wa.forEach(w => {
          parts.push(
            `  ${w.courier}: ${fmtNum(w.discrepancy_count)} discrepancies / ${fmtNum(w.total_orders_audited)} orders ` +
            `(${fmtPct(w.discrepancy_rate)}) | ${fmtNum(w.zone_mismatch_count)} zone mismatches`
          )
        })
      }
      if (cn?.length) {
        parts.push(`  CREDIT NOTES: ${cn.map(c => `${c.reason}: ${fmtNum(c.count)} claims, ${fmtINR(c.total_amount)}`).join(' | ')}`)
      }
    }

    if (cat === 'service_types') {
      const { data } = await supabase
        .from('service_type_monthly').select('courier,service_type,orders,margin_pct,rto_rate')
        .eq('month', month).order('orders', { ascending: false }).limit(15)
      if (data?.length) {
        parts.push(`\nSERVICE TYPE BREAKDOWN (${fmtMonth(month)}):`)
        data.forEach(s => {
          const warn = s.margin_pct < 0 ? ' ⚠️' : ''
          parts.push(`  ${s.courier} — ${s.service_type}: ${fmtNum(s.orders)} orders | ${fmtPct(s.margin_pct)} margin${warn} | ${fmtPct(s.rto_rate)} RTO`)
        })
      }
    }

    if (cat === 'rto') {
      const [{ data: cd }, { data: zd }, { data: dd }] = await Promise.all([
        supabase.from('courier_monthly').select('courier,orders,rto_count,rto_rate').eq('month', month).order('rto_rate', { ascending: false }),
        supabase.from('zone_monthly').select('zone,orders,rto_count,rto_rate').eq('month', month).order('rto_rate', { ascending: false }),
        supabase.from('daily_summary').select('day_of_week,orders,rto_count,rto_rate').eq('month', month),
      ])
      if (cd?.length) {
        parts.push(`\nRTO BY COURIER (${fmtMonth(month)}):`)
        cd.forEach(c => parts.push(`  ${c.courier}: ${fmtPct(c.rto_rate)} (${fmtNum(c.rto_count)} returns)`))
      }
      if (zd?.length) {
        parts.push(`\nRTO BY ZONE:`)
        zd.forEach(z => parts.push(`  Zone ${z.zone}: ${fmtPct(z.rto_rate)} RTO`))
      }
      if (dd?.length) {
        // Aggregate by day of week
        const dow = {}
        dd.forEach(d => {
          if (!d.day_of_week) return
          if (!dow[d.day_of_week]) dow[d.day_of_week] = { orders: 0, rto: 0 }
          dow[d.day_of_week].orders += d.orders ?? 0
          dow[d.day_of_week].rto    += d.rto_count ?? 0
        })
        parts.push(`\nRTO BY DAY OF WEEK:`)
        Object.entries(dow).forEach(([day, v]) => {
          const r = v.orders > 0 ? (v.rto / v.orders * 100).toFixed(1) : 0
          parts.push(`  ${day}: ${r}%`)
        })
      }
    }
  }))

  return parts.join('\n')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AskAnything() {
  const [messages, setMessages] = useState([])   // [{role, content, sources}]
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
      const context    = await fetchContext(categories, latestMonth)

      // Build history for multi-turn (last 6 messages to stay within token budget)
      const history = [...messages, userMsg]
        .slice(-6)
        .map(m => ({ role: m.role, content: m.content }))

      const reply = await chatWithHistory(history, context)

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: reply,
        sources: categories,
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I couldn't get an answer: ${e.message}`,
        error: true,
      }])
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
      <p className="font-medium text-gray-700">No data yet</p>
      <p className="text-sm text-gray-400 mt-1">Upload a monthly CSV first, then Ask Anything</p>
    </div>
  )

  return (
    <div className="flex flex-col h-full" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Header */}
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-2xl font-semibold text-gray-900">Ask Anything</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          AI analyst with live access to your {fmtMonth(latestMonth)} data
        </p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 min-h-0">

        {/* Welcome / suggestions */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-800 mb-1">Shipmozo AI Analyst</h2>
            <p className="text-sm text-gray-500 mb-8 max-w-sm">
              Ask questions about your shipping data. I'll pull live numbers from your database to answer.
            </p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map(s => (
                <button key={s.text} onClick={() => send(s.text)}
                  className="flex items-start gap-2 text-left px-4 py-3 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors text-sm text-gray-700 group">
                  <span className="text-base flex-shrink-0">{s.icon}</span>
                  <span className="group-hover:text-blue-700 transition-colors">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1 mr-2">
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
            )}
            <div className={`max-w-[75%] ${msg.role === 'user' ? 'order-first' : ''}`}>
              <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : msg.error
                    ? 'bg-red-50 border border-red-200 text-red-700 rounded-tl-sm'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
              }`}>
                <FormattedMessage content={msg.content} />
              </div>
              {msg.sources && (
                <div className="flex flex-wrap gap-1 mt-1.5 ml-1">
                  {msg.sources.map(s => (
                    <span key={s} className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {SOURCE_LABELS[s] ?? s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 pt-3 border-t border-gray-200">
        {messages.length > 0 && (
          <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
            {SUGGESTIONS.slice(0, 4).map(s => (
              <button key={s.text} onClick={() => send(s.text)}
                disabled={loading}
                className="flex-shrink-0 text-xs px-3 py-1.5 bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-600 rounded-full border border-gray-200 hover:border-blue-200 transition-colors disabled:opacity-40">
                {s.text}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about your shipping data… (Enter to send)"
            rows={1}
            disabled={loading}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            style={{ maxHeight: 120, overflowY: 'auto' }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white rounded-xl transition-colors flex items-center gap-2 text-sm font-medium flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2 text-center">
          AI pulls live data from your {fmtMonth(latestMonth)} database · Powered by Azure OpenAI
        </p>
      </div>
    </div>
  )
}

// ── Message renderer — handles bold, bullets, line breaks ─────────────────────

function FormattedMessage({ content }) {
  const lines = content.split('\n')
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />
        // Bold: **text**
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        const rendered = parts.map((p, j) =>
          p.startsWith('**') && p.endsWith('**')
            ? <strong key={j}>{p.slice(2, -2)}</strong>
            : p
        )
        // Bullet points
        if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
          return <div key={i} className="flex gap-2"><span className="text-gray-400 flex-shrink-0">•</span><span>{rendered}</span></div>
        }
        // Numbered
        if (/^\d+\./.test(line.trim())) {
          return <div key={i} className="flex gap-2"><span className="text-gray-400 flex-shrink-0">{line.match(/^\d+/)[0]}.</span><span>{rendered}</span></div>
        }
        return <p key={i}>{rendered}</p>
      })}
    </div>
  )
}

const SOURCE_LABELS = {
  overview:      '📊 overview',
  couriers:      '🚚 couriers',
  sellers:       '👥 sellers',
  health:        '❤️ health',
  zones:         '📍 zones',
  price_cards:   '🏷️ price cards',
  billing:       '📋 billing',
  service_types: '📦 service types',
  rto:           '↩️ RTO',
}
