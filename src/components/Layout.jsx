import { NavLink, Outlet } from 'react-router-dom'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: DashboardIcon },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/courier-pnl',  label: 'Courier P&L',    icon: TruckIcon },
      { to: '/rto',          label: 'RTO Analytics',  icon: RTOIcon },
      { to: '/zones',        label: 'Zone Analysis',  icon: MapIcon },
      { to: '/billing',      label: 'Billing Audit',  icon: AuditIcon },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/seller-health', label: 'Seller Health',      icon: HealthIcon },
      { to: '/seller-intel',  label: 'Seller Intelligence', icon: IntelIcon },
      { to: '/price-cards',   label: 'Price Cards',        icon: TagIcon },
      { to: '/ask',           label: 'Ask AI',             icon: AIIcon },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/upload', label: 'Upload Data', icon: UploadIcon },
    ],
  },
]

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className="w-60 flex-shrink-0 flex flex-col" style={{ background: 'var(--sidebar-bg)' }}>

        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-primary)' }}>
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0v10l-8 4m-8-4V7m8 4v10" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-none">Shipmozo</p>
            <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>Analytics</p>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 mb-3" style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto space-y-4 pb-4">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: '#334155' }}>
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) => [
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ].join(' ')}
                    style={({ isActive }) => isActive
                      ? { background: 'var(--sidebar-active)', color: '#93c5fd' }
                      : {}}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute left-0 w-0.5 h-5 rounded-r-full"
                            style={{ background: '#60a5fa' }} />
                        )}
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        {label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
            <p className="text-xs" style={{ color: '#475569' }}>Connected to Supabase</p>
          </div>
          <p className="text-xs mt-0.5" style={{ color: '#334155' }}>v0.1.0</p>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="flex-shrink-0 h-14 flex items-center justify-between px-8"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em' }}>
            Shipmozo Analytics
          </p>
          <div className="flex items-center gap-2 text-xs font-medium"
            style={{ color: '#16a34a' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Connected
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto px-8 py-7 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/* ── Icons ───────────────────────────────────────────────────────────────────── */

function DashboardIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}
function TruckIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M8.25 18.75V6.375m0 12.375H14.25m0-12.375V5.625a.375.375 0 00-.375-.375H8.625a.375.375 0 00-.375.375v.75M14.25 6.375h1.875a.375.375 0 01.375.375V11.25" />
    </svg>
  )
}
function RTOIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
    </svg>
  )
}
function MapIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  )
}
function AuditIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function HealthIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}
function IntelIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  )
}
function TagIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  )
}
function AIIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  )
}
function UploadIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.522 7.095A4.5 4.5 0 0117.25 19.5H6.75z" />
    </svg>
  )
}
