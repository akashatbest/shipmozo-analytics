import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'
import { fmtMonth } from './chartConfig'

const MonthContext = createContext({ months: [], selectedMonth: '', setSelectedMonth: () => {} })

export function MonthProvider({ children }) {
  const [months, setMonths]               = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')

  useEffect(() => {
    supabase
      .from('monthly_overview')
      .select('month')
      .order('month', { ascending: false })
      .then(({ data }) => {
        const ms = (data ?? []).map(d => d.month)
        setMonths(ms)
        if (ms.length) setSelectedMonth(ms[0])
      })
  }, [])

  return (
    <MonthContext.Provider value={{ months, selectedMonth, setSelectedMonth }}>
      {children}
    </MonthContext.Provider>
  )
}

export function useMonth() {
  return useContext(MonthContext)
}

export function MonthSelector() {
  const { months, selectedMonth, setSelectedMonth } = useMonth()
  if (months.length <= 1) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Viewing</span>
      <select
        value={selectedMonth}
        onChange={e => setSelectedMonth(e.target.value)}
        className="rounded-lg px-3 py-1.5 text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 appearance-none pr-7"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
        }}
      >
        {months.map(m => (
          <option key={m} value={m}>{fmtMonth(m)}</option>
        ))}
      </select>
    </div>
  )
}
