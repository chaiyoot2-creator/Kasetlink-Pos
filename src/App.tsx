import { useState, useEffect } from 'react'
import { Loader2, Sprout } from 'lucide-react'
import { AuthTokenExpiredError, onAuthExpired } from './lib/api'
import { AuthExpiredModal } from './components/AuthExpiredModal'
import { AppShell, NAV } from './components/AppShell'
import { AuthGate, useAuth } from './lib/auth'
import { UsersPage } from './pages/UsersPage'
import { QuotationsPage } from './pages/QuotationsPage'
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
import { AccountingPage } from './pages/AccountingPage'
import { ReceivablesPage } from './pages/ReceivablesPage'
import { CustomersPage } from './pages/CustomersPage'
import { AgencyPage } from './pages/AgencyPage'
import { DeliveryPage } from './pages/delivery/DeliveryPage'
import { MasterDataPage } from './pages/MasterDataPage'
import { SettingsPage } from './pages/SettingsPage'
import { FirstRunSetup } from './pages/FirstRunSetup'

function App() {
  return (
    <>
      <AppContent />
      <Toaster position="top-center" richColors closeButton />
    </>
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
  const [authExpired, setAuthExpired] = useState<AuthTokenExpiredError | null>(null)

  useEffect(() => {
    onAuthExpired((err) => setAuthExpired(err))
    return () => onAuthExpired(null)
  }, [])

  return (
    <>
      <AuthGate>
        <AppProvider fallback={(s) => <Splash error={s.error} retry={s.retry} />}>
          <Routed />
        </AppProvider>
      </AuthGate>
      {authExpired && <AuthExpiredModal authError={authExpired} onClose={() => setAuthExpired(null)} />}
    </>
  )
}

function Routed() {
  const { data } = useApp()
  const { can } = useAuth()
  const [route, go] = useHashRoute('pos')
  const allowed = NAV.filter((n) => can(...n.perms))
  const current = NAV.find((n) => n.route === route)
  // Pages this account may not open fall back to the first one it may.
  useEffect(() => {
    if ((!current || !can(...current.perms)) && allowed[0] && allowed[0].route !== route) go(allowed[0].route)
  }, [route])
  if (data.locations.length === 0) return can('settings') ? <FirstRunSetup /> : <Splash error="ร้านยังไม่ได้ตั้งค่าสาขา — ให้เจ้าของร้านเข้าสู่ระบบเพื่อตั้งค่าก่อน" retry={() => window.location.reload()} />
  if (allowed.length === 0) return <Splash error="บัญชีนี้ยังไม่มีสิทธิ์ใช้งานเมนูใด — ติดต่อเจ้าของร้าน" retry={() => window.location.reload()} />
  if (!current || !can(...current.perms)) return null
  return (
    <AppShell route={route} go={go}>
      {route === 'pos' && <PosPage />}
      {route === 'sales' && <SalesPage />}
      {route === 'purchasing' && <PurchasingPage />}
      {route === 'stock' && <StockPage />}
      {route === 'alerts' && <AlertsPage />}
      {route === 'reports' && <ReportsPage />}
      {route === 'accounting' && <AccountingPage />}
      {route === 'receivables' && <ReceivablesPage />}
      {route === 'customers' && <CustomersPage />}
      {route === 'agency' && <AgencyPage />}
      {route === 'delivery' && <DeliveryPage />}
      {route === 'master' && <MasterDataPage />}
      {route === 'settings' && <SettingsPage />}
      {route === 'users' && <UsersPage />}
      {route === 'quotations' && <QuotationsPage />}
    </AppShell>
  )
}

export default App
