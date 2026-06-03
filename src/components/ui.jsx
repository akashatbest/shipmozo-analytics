// Shared UI primitives — used across all dashboard pages

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-7">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</h1>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export function Card({ children, className = '', padding = 'p-5', onClick, hover = false }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl ${padding} ${hover ? 'card-hover cursor-pointer' : ''} ${className}`}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between px-5 py-4"
      style={{ borderBottom: '1px solid var(--color-border-2)' }}>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{title}</h3>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function StatCard({ label, value, sub, accent = 'blue', alert = false }) {
  const ACCENT = {
    blue:  { bar: '#3b82f6', bg: 'rgba(59,130,246,0.05)' },
    green: { bar: '#10b981', bg: 'rgba(16,185,129,0.05)' },
    amber: { bar: '#f59e0b', bg: 'rgba(245,158,11,0.05)' },
    red:   { bar: '#ef4444', bg: 'rgba(239,68,68,0.05)'  },
  }
  const { bar, bg } = ACCENT[accent] ?? ACCENT.blue
  return (
    <div className="relative overflow-hidden rounded-xl p-5"
      style={{
        background: alert ? 'rgba(245,158,11,0.06)' : 'var(--color-surface)',
        border: `1px solid ${alert ? 'rgba(245,158,11,0.25)' : 'var(--color-border)'}`,
        boxShadow: 'var(--shadow-sm)',
      }}>
      <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full" style={{ background: bar }} />
      <div className="absolute inset-0 rounded-xl" style={{ background: bg }} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wide mb-2"
          style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{label}</p>
        <p className="text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
        {sub && <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
      </div>
    </div>
  )
}

export function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-xl p-5"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{title}</h3>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export function TableCard({ title, subtitle, action, children }) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border-2)' }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{title}</h3>
            {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

export function Th({ children, right = false, center = false }) {
  return (
    <th className={`px-4 py-3 font-medium text-xs uppercase tracking-wide whitespace-nowrap
      ${right ? 'text-right' : center ? 'text-center' : 'text-left'}`}
      style={{ color: 'var(--color-text-muted)' }}>
      {children}
    </th>
  )
}

export function Td({ children, right = false, center = false, className = '' }) {
  return (
    <td className={`px-4 py-3 text-sm ${right ? 'text-right' : center ? 'text-center' : ''} ${className}`}
      style={{ color: 'var(--color-text-secondary)' }}>
      {children}
    </td>
  )
}

export function Thead({ children }) {
  return (
    <thead>
      <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border-2)' }}>
        {children}
      </tr>
    </thead>
  )
}

export function AlertBanner({ type = 'error', title, body }) {
  const styles = {
    error:   { bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.2)',   icon: '#ef4444',  title: '#991b1b', body: '#b91c1c' },
    warning: { bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.2)',  icon: '#f59e0b',  title: '#92400e', body: '#b45309' },
    info:    { bg: 'rgba(59,130,246,0.06)',  border: 'rgba(59,130,246,0.2)',  icon: '#3b82f6',  title: '#1e40af', body: '#1d4ed8' },
  }
  const s = styles[type] ?? styles.error
  return (
    <div className="flex items-start gap-3 rounded-xl p-4 mb-5"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}>
      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: s.icon }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <div>
        <p className="text-sm font-semibold" style={{ color: s.title }}>{title}</p>
        {body && <p className="text-sm mt-0.5" style={{ color: s.body }}>{body}</p>}
      </div>
    </div>
  )
}

export function Badge({ label, color = 'gray' }) {
  const colors = {
    green:  'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber:  'bg-amber-50  text-amber-700  border-amber-100',
    red:    'bg-red-50    text-red-700    border-red-100',
    blue:   'bg-blue-50   text-blue-700   border-blue-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    gray:   'bg-slate-50  text-slate-600  border-slate-200',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${colors[color] ?? colors.gray}`}>
      {label}
    </span>
  )
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
    </div>
  )
}

export function EmptyState({ title = 'No data yet', body = 'Upload a monthly CSV to see this page' }) {
  return (
    <div className="flex flex-col items-center justify-center h-80 text-center">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <svg className="w-6 h-6" style={{ color: 'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
      </div>
      <p className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{title}</p>
      <p className="text-sm mt-1 max-w-xs" style={{ color: 'var(--color-text-muted)' }}>{body}</p>
    </div>
  )
}

export function MarginBadge({ pct }) {
  const p = pct ?? 0
  const color = p < 0 ? 'red' : p < 8 ? 'amber' : p > 20 ? 'orange' : 'green'
  const colors = {
    red:    'bg-red-50    text-red-700    border-red-100',
    amber:  'bg-amber-50  text-amber-700  border-amber-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    green:  'bg-emerald-50 text-emerald-700 border-emerald-100',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${colors[color]}`}>
      {p.toFixed(1)}%
    </span>
  )
}
