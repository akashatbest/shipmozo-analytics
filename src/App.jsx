import { HashRouter as BrowserRouter, Routes, Route } from 'react-router-dom'
import { MonthProvider } from './lib/monthContext'
import Layout from './components/Layout'
import ExecutiveOverview from './components/ExecutiveOverview'
import CourierPnL from './components/CourierPnL'
import SellerHealth from './components/SellerHealth'
import SellerIntelligence from './components/SellerIntelligence'
import PriceCardAnalysis from './components/PriceCardAnalysis'
import RTOAnalytics from './components/RTOAnalytics'
import ZoneAnalysis from './components/ZoneAnalysis'
import BillingAudit from './components/BillingAudit'
import AskAnything from './components/AskAnything'
import UploadPage from './components/UploadPage'
import SellerProfile from './components/SellerProfile'
import PricingEngine from './components/PricingEngine'

export default function App() {
  return (
    <BrowserRouter>
      <MonthProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<ExecutiveOverview />} />
            <Route path="courier-pnl" element={<CourierPnL />} />
            <Route path="seller-health" element={<SellerHealth />} />
            <Route path="seller-intel" element={<SellerIntelligence />} />
            <Route path="price-cards" element={<PriceCardAnalysis />} />
            <Route path="rto" element={<RTOAnalytics />} />
            <Route path="zones" element={<ZoneAnalysis />} />
            <Route path="billing" element={<BillingAudit />} />
            <Route path="ask" element={<AskAnything />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="seller/:userId" element={<SellerProfile />} />
            <Route path="pricing-engine" element={<PricingEngine />} />
          </Route>
        </Routes>
      </MonthProvider>
    </BrowserRouter>
  )
}
