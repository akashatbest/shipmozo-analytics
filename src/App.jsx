import { HashRouter as BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { MonthProvider } from './lib/monthContext'
import LoginPage from './components/LoginPage'
import Layout from './components/Layout'
import ExecutiveOverview from './components/ExecutiveOverview'
import CourierPnL from './components/CourierPnL'
import SellerHealth from './components/SellerHealth'
import SellerIntelligence from './components/SellerIntelligence'
import PriceCardAnalysis from './components/PriceCardAnalysis'
import PricingEngine from './components/PricingEngine'
import TeamAnalytics from './components/TeamAnalytics'
import RTOAnalytics from './components/RTOAnalytics'
import ZoneAnalysis from './components/ZoneAnalysis'
import BillingAudit from './components/BillingAudit'
import AskAnything from './components/AskAnything'
import UploadPage from './components/UploadPage'
import SellerProfile from './components/SellerProfile'

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
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#2563eb', borderTopColor: 'transparent' }} />
      </div>
    </div>
  )

  if (!user) return <LoginPage />

  return (
    <MonthProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<ExecutiveOverview />} />
          <Route path="courier-pnl" element={<CourierPnL />} />
          <Route path="seller-health" element={<SellerHealth />} />
          <Route path="seller-intel" element={<SellerIntelligence />} />
          <Route path="price-cards" element={<PriceCardAnalysis />} />
          <Route path="pricing-engine" element={<PricingEngine />} />
          <Route path="rto" element={<RTOAnalytics />} />
          <Route path="zones" element={<ZoneAnalysis />} />
          <Route path="billing" element={<BillingAudit />} />
          <Route path="ask" element={<AskAnything />} />
          <Route path="team" element={<TeamAnalytics />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="seller/:userId" element={<SellerProfile />} />
        </Route>
      </Routes>
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
