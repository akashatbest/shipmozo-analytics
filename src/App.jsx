import { lazy, Suspense } from 'react'
import { HashRouter as BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { MonthProvider } from './lib/monthContext'

// LoginPage + Layout load eagerly (needed before auth check)
import LoginPage from './components/LoginPage'
import Layout from './components/Layout'

// All page components load lazily — each becomes its own JS chunk
// Chart.js (~400KB) only loads when a chart page is first visited
const ExecutiveOverview  = lazy(() => import('./components/ExecutiveOverview'))
const CourierPnL         = lazy(() => import('./components/CourierPnL'))
const SellerPnL          = lazy(() => import('./components/SellerPnL'))
const SellerHealth       = lazy(() => import('./components/SellerHealth'))
const SellerIntelligence = lazy(() => import('./components/SellerIntelligence'))
const PriceCardAnalysis  = lazy(() => import('./components/PriceCardAnalysis'))
const PricingEngine      = lazy(() => import('./components/PricingEngine'))
const RTOAnalytics       = lazy(() => import('./components/RTOAnalytics'))
const ZoneAnalysis       = lazy(() => import('./components/ZoneAnalysis'))
const BillingAudit       = lazy(() => import('./components/BillingAudit'))
const AskAnything        = lazy(() => import('./components/AskAnything'))
const TeamAnalytics      = lazy(() => import('./components/TeamAnalytics'))
const BranchReport       = lazy(() => import('./components/BranchReport'))
const BranchManagement   = lazy(() => import('./components/BranchManagement'))
const UploadPage         = lazy(() => import('./components/UploadPage'))
const SellerProfile      = lazy(() => import('./components/SellerProfile'))

// Shown while a lazy page chunk is downloading (~100–300ms first visit)
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      </div>
    </div>
  )
}

function AppContent() {
  const { user, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#2563eb' }}>
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0v10l-8 4m-8-4V7m8 4v10" />
          </svg>
        </div>
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: '#2563eb', borderTopColor: 'transparent' }} />
      </div>
    </div>
  )

  if (!user) return <LoginPage />

  return (
    <MonthProvider>
      {/* Single Suspense boundary wraps all lazy routes */}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<ExecutiveOverview />} />
            <Route path="courier-pnl"        element={<CourierPnL />} />
            <Route path="seller-pnl"         element={<SellerPnL />} />
            <Route path="seller-health"      element={<SellerHealth />} />
            <Route path="seller-intel"       element={<SellerIntelligence />} />
            <Route path="price-cards"        element={<PriceCardAnalysis />} />
            <Route path="pricing-engine"     element={<PricingEngine />} />
            <Route path="rto"                element={<RTOAnalytics />} />
            <Route path="zones"              element={<ZoneAnalysis />} />
            <Route path="billing"            element={<BillingAudit />} />
            <Route path="ask"                element={<AskAnything />} />
            <Route path="team"               element={<TeamAnalytics />} />
            <Route path="branch-report"      element={<BranchReport />} />
            <Route path="branch-management"  element={<BranchManagement />} />
            <Route path="upload"             element={<UploadPage />} />
            <Route path="seller/:userId"     element={<SellerProfile />} />
          </Route>
        </Routes>
      </Suspense>
    </MonthProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  )
}
