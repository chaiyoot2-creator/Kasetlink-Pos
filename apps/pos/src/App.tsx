import { useState, useEffect } from 'react'
import { Loader2, Sprout } from 'lucide-react'
import { AuthTokenExpiredError, getFeatureToken, onAuthExpired } from './lib/api'
import { MAGIC_LINK_ROUTE, buildLegacyMagicLinkRedirect } from './lib/magic-link'
import { AuthExpiredModal } from './components/AuthExpiredModal'
import { EnvPanel } from './components/EnvPanel'
import { AppShell } from './components/AppShell'
import { ErrorBox } from './components/common'
import { Toaster } from './components/ui/sonner'
import { AppProvider, useApp } from './lib/app-context'
import { useHashRoute } from './lib/use-api'
import { PosPage } from './pages/pos/PosPage'
import { SalesPage } from './pages/SalesPage'
import { PurchasingPage } from './pages/PurchasingPage'
import { StockPage } from './pages/StockPage'
import { AlertsPage } from './pages/AlertsPage'
import { ReportsPage } from './pages/ReportsPage'
import { MasterDataPage } from './pages/MasterDataPage'
import { SettingsPage } from './pages/SettingsPage'
import { FirstRunSetup } from './pages/FirstRunSetup'

function App() {
  if (typeof window !== 'undefined' && window.location.pathname === MAGIC_LINK_ROUTE) {
    return <LegacyMagicLinkRedirect />
  }
  return (
    <>
      <AppContent />
      <Toaster position="top-center" richColors closeButton />
      {/*
        Staff/debug environment panel (app environments). Deliberately outside
        the token gate — it must stay visible when auth is broken, which is
        exactly when you need to know which stage you are on. Hidden unless
        enabled with `?envpanel=1`; renders nothing on legacy deploys.
      */}
      <EnvPanel />
    </>
  )
}

/**
 * Old emails link to `/link?id={key}`; activation now happens server-side at
 * the platform `/_auth/magiclink/{key}` endpoint, so just forward there.
 */
function LegacyMagicLinkRedirect() {
  const target = buildLegacyMagicLinkRedirect(window.location.search)

  useEffect(() => {
    if (target) window.location.replace(target)
  }, [target])

  if (target) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">กำลังเปลี่ยนหน้า…</div>
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-2 text-lg font-semibold">ลิงก์ไม่ถูกต้อง</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">ลิงก์นี้ไม่มีข้อมูลที่จำเป็น กรุณาขอลิงก์เข้าสู่ระบบใหม่</p>
      </div>
    </div>
  )
}

function Splash({ error, retry }: { error: string | null; retry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Sprout className="size-6" />
      </div>
      {error ? (
        <div className="w-full max-w-md">
          <ErrorBox message={error} onRetry={retry} />
        </div>
      ) : (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> กำลังเปิด KasetLink POS…
        </p>
      )}
    </div>
  )
}

function AppContent() {
  const [appToken, setAppToken] = useState<string | null>(null)
  const [authExpired, setAuthExpired] = useState<AuthTokenExpiredError | null>(null)

  useEffect(() => {
    setAppToken(getFeatureToken())
    onAuthExpired((err) => setAuthExpired(err))
    return () => onAuthExpired(null)
  }, [])

  // In local dev the token arrives a moment later via postMessage; the cookie covers deployed apps.
  useEffect(() => {
    if (appToken) return
    const t = window.setInterval(() => {
      const token = getFeatureToken()
      if (token) setAppToken(token)
    }, 300)
    return () => window.clearInterval(t)
  }, [appToken])

  return (
    <>
      {appToken ? (
        <AppProvider fallback={(s) => <Splash error={s.error} retry={s.retry} />}>
          <Routed />
        </AppProvider>
      ) : (
        <Splash error={null} retry={() => window.location.reload()} />
      )}
      {authExpired && <AuthExpiredModal authError={authExpired} onClose={() => setAuthExpired(null)} />}
    </>
  )
}

function Routed() {
  const { data } = useApp()
  const [route, go] = useHashRoute('pos')
  if (data.locations.length === 0) return <FirstRunSetup />
  return (
    <AppShell route={route} go={go}>
      {route === 'pos' && <PosPage />}
      {route === 'sales' && <SalesPage />}
      {route === 'purchasing' && <PurchasingPage />}
      {route === 'stock' && <StockPage />}
      {route === 'alerts' && <AlertsPage />}
      {route === 'reports' && <ReportsPage />}
      {route === 'master' && <MasterDataPage />}
      {route === 'settings' && <SettingsPage />}
    </AppShell>
  )
}

export default App
