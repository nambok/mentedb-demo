import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Landing from './pages/Landing'

// Explicit GA4 page_view per SPA route change, so /chat and /graph views are
// tracked regardless of the property's Enhanced Measurement setting.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}
function RouteTracker() {
  const location = useLocation()
  useEffect(() => {
    window.gtag?.('event', 'page_view', {
      page_path: location.pathname + location.search,
      page_location: window.location.href,
    })
  }, [location])
  return null
}

// Lazy routes: the landing stays featherweight; the force-graph bundle only
// loads when someone opens the explorer.
const Chat = lazy(() => import('./pages/Chat'))
const GraphExplorer = lazy(() => import('./pages/GraphExplorer'))

function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <RouteTracker />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/graph" element={<GraphExplorer />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
