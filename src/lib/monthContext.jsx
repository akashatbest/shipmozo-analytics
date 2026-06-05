import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { fmtMonth, fmtNum, fmtPct } from './chartConfig'

const MonthContext = createContext({
  months: [], monthsData: [],
  selectedMonth: '', setSelectedMonth: () => {},
  compareMonth: null, setCompareMonth: () => {},
})

export function MonthProvider({ children }) {
  const [monthsData, setMonthsData]         = useState([])  // full overview rows
  const [selectedMonth, setSelectedMonth]   = useState('')
  const [compareMonth, setCompareMonth]     = useState(null)

  const months = monthsData.map(d => d.month)

  useEffect(() => {
    supabase
      .from('monthly_overview')
      .select('month,total_orders,total_revenue_billed,gross_margin,margin_pct,rto_rate')
      .order('month', { ascending: true })
      .then(({ data }) => {
        const rows = data ?? []
        setMonthsData(rows)
        if (rows.length) setSelectedMonth(rows[rows.length - 1].month)
      })
  }, [])

  return (
    <MonthContext.Provider value={{
      months, monthsData,
      selectedMonth, setSelectedMonth,
      compareMonth, setCompareMonth,
    }}>
      {children}
    </MonthContext.Provider>
  )
}

export function useMonth() { return useContext(MonthContext) }

// ── Legacy dropdown (kept for any page that still imports it) ─────────────────
export function MonthSelector() {
  const { months, selectedMonth, setSelectedMonth } = useMonth()
  if (months.length <= 1) return null
  return (
    <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
      className="rounded-lg px-3 py-1.5 text-sm font-medium cursor-pointer focus:outline-none appearance-none pr-7"
      style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-primary)' }}>
      {months.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
    </select>
  )
}

// ── Month Timeline Rail ───────────────────────────────────────────────────────
export function MonthRail() {
  const { monthsData, selectedMonth, setSelectedMonth, compareMonth, setCompareMonth } = useMonth()
  const railRef = useRef(null)

  // scroll selected card into view on mount / month change
  useEffect(() => {
    const el = railRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedMonth])

  if (monthsData.length <= 1) return null

  const maxOrders = Math.max(...monthsData.map(m => m.total_orders ?? 0), 1)

  function handleSelect(month) {
    if (month === selectedMonth) return
    if (compareMonth === month) setCompareMonth(null)
    setSelectedMonth(month)
  }

  function toggleCompare(e, month) {
    e.stopPropagation()
    setCompareMonth(prev => prev === month ? null : month)
  }

  const isComparing = !!compareMonth

  return (
    <div style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-3 px-4 md:px-8 py-2.5">

        {/* Compare badge */}
        {isComparing && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5"
              style={{ background:'rgba(124,58,237,0.1)', color:'#7c3aed', border:'1px solid rgba(124,58,237,0.2)' }}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
              </svg>
              Comparing
            </span>
            <button onClick={() => setCompareMonth(null)}
              className="text-xs px-2 py-1 rounded-full hover:bg-red-50 hover:text-red-600 transition-colors"
              style={{ color:'var(--color-text-muted)', border:'1px solid var(--color-border)' }}>
              Clear
            </button>
          </div>
        )}

        {/* Month cards */}
        <div ref={railRef}
          className="flex items-stretch gap-2 overflow-x-auto flex-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

          {monthsData.map(m => {
            const isPrimary  = m.month === selectedMonth
            const isCompare  = m.month === compareMonth
            const volPct     = Math.round(((m.total_orders ?? 0) / maxOrders) * 100)
            const marginGood = (m.margin_pct ?? 0) >= 15
            const marginWarn = (m.margin_pct ?? 0) >= 10 && (m.margin_pct ?? 0) < 15
            const marginBad  = (m.margin_pct ?? 0) < 10

            return (
              <button key={m.month}
                data-selected={isPrimary}
                onClick={() => handleSelect(m.month)}
                className="relative flex-shrink-0 rounded-xl px-3 pt-2.5 pb-2 text-left transition-all group"
                style={{
                  minWidth: 88,
                  background: isPrimary
                    ? 'var(--color-primary)'
                    : isCompare
                      ? 'rgba(124,58,237,0.06)'
                      : 'var(--color-surface-2)',
                  border: isPrimary
                    ? '1px solid var(--color-primary)'
                    : isCompare
                      ? '1px solid rgba(124,58,237,0.35)'
                      : '1px solid var(--color-border)',
                  boxShadow: isPrimary ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
                }}>

                {/* Month name */}
                <p className="text-xs font-bold leading-none mb-1.5"
                  style={{ color: isPrimary ? '#fff' : isCompare ? '#7c3aed' : 'var(--color-text-primary)' }}>
                  {fmtMonth(m.month)}
                </p>

                {/* Orders */}
                <p className="text-xs leading-none mb-1.5"
                  style={{ color: isPrimary ? 'rgba(255,255,255,0.75)' : 'var(--color-text-muted)' }}>
                  {fmtNum(m.total_orders ?? 0)} orders
                </p>

                {/* Margin badge */}
                <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-bold leading-none"
                  style={isPrimary
                    ? { background:'rgba(255,255,255,0.2)', color:'#fff' }
                    : marginGood ? { background:'rgba(16,185,129,0.1)', color:'#059669' }
                    : marginWarn ? { background:'rgba(245,158,11,0.1)', color:'#d97706' }
                    : { background:'rgba(239,68,68,0.1)', color:'#dc2626' }}>
                  {fmtPct(m.margin_pct ?? 0)}
                </span>

                {/* Volume bar at the bottom */}
                <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full overflow-hidden"
                  style={{ background: isPrimary ? 'rgba(255,255,255,0.15)' : 'var(--color-border)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${volPct}%`,
                      background: isPrimary ? 'rgba(255,255,255,0.6)'
                        : isCompare ? 'rgba(124,58,237,0.5)'
                        : 'var(--color-primary)',
                      opacity: 0.7,
                    }} />
                </div>

                {/* "vs" compare button on hover */}
                {!isPrimary && (
                  <button
                    onClick={e => toggleCompare(e, m.month)}
                    className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center transition-all
                      ${isCompare
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                      }`}
                    title={isCompare ? 'Remove comparison' : 'Compare this month'}
                    style={{
                      background: isCompare ? '#7c3aed' : 'var(--color-primary)',
                      color: '#fff',
                      border: '2px solid var(--color-surface)',
                      fontSize: 9,
                    }}>
                    {isCompare ? '×' : 'vs'}
                  </button>
                )}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="hidden md:flex items-center gap-3 flex-shrink-0 text-xs" style={{ color:'var(--color-text-muted)' }}>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />≥15% margin
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />10–15%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />&lt;10%
          </span>
          <span style={{ color:'var(--color-border)' }}>|</span>
          <span>Hover card → <strong>vs</strong> to compare</span>
        </div>
      </div>
    </div>
  )
}
