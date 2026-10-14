import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { BellRing, Boxes, ChartLine, Database, Menu, ReceiptText, Settings, ShoppingCart, Sprout, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useApp } from '@/lib/app-context'
import { apiFetch } from '@/lib/api'
import type { Alerts } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface NavItem {
  route: string
  label: string
  icon: ComponentType<{ className?: string }>
}

export const NAV: NavItem[] = [
  { route: 'pos', label: 'ขายสินค้า', icon: ShoppingCart },
  { route: 'sales', label: 'บิลขาย', icon: ReceiptText },
  { route: 'purchasing', label: 'รับเข้าสินค้า', icon: Truck },
  { route: 'stock', label: 'สต็อก', icon: Boxes },
  { route: 'alerts', label: 'แจ้งเตือน', icon: BellRing },
  { route: 'reports', label: 'กำไรขาดทุน', icon: ChartLine },
  { route: 'master', label: 'ข้อมูลหลัก', icon: Database },
  { route: 'settings', label: 'ตั้งค่า', icon: Settings },
]

const MOBILE_PRIMARY = ['pos', 'sales', 'stock', 'alerts']

/** Alert count for the nav badge, refreshed every 5 minutes. */
function useAlertCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () =>
      apiFetch<Alerts>('/alerts')
        .then((a) => alive && setCount(a.lowStock.length + a.nearExpiry.length + a.expired.length))
        .catch(() => undefined)
    void load()
    const t = window.setInterval(load, 5 * 60_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])
  return count
}

export function AppShell({ route, go, children }: { route: string; go: (r: string) => void; children: ReactNode }) {
  const app = useApp()
  const alertCount = useAlertCount()
  const [moreOpen, setMoreOpen] = useState(false)
  const isPos = route === 'pos'

  const badge = (r: string) =>
    r === 'alerts' && alertCount > 0 ? (
      <Badge variant="destructive" className="h-5 min-w-5 rounded-full px-1 text-[10px]">
        {alertCount > 99 ? '99+' : alertCount}
      </Badge>
    ) : null

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar: icon rail on tablets, full on desktop */}
      <nav className="hidden w-20 shrink-0 flex-col border-r bg-card md:flex lg:w-56">
        <div className="flex items-center gap-2 px-3 py-4 lg:px-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sprout className="size-5" />
          </div>
          <div className="hidden min-w-0 lg:block">
            <p className="truncate text-sm font-semibold">{app.data.settings.shopName}</p>
            <p className="text-xs text-muted-foreground">KasetLink POS</p>
          </div>
        </div>
        <ul className="flex-1 space-y-1 overflow-y-auto px-2">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = route === item.route
            return (
              <li key={item.route}>
                <button
                  type="button"
                  onClick={() => go(item.route)}
                  className={cn(
                    'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] transition-colors lg:flex-row lg:gap-3 lg:px-3 lg:text-sm',
                    active ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="lg:flex-1 lg:text-left">{item.label}</span>
                  <span className="absolute top-1 right-2 lg:static">{badge(item.route)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="hidden border-t px-4 py-3 text-xs text-muted-foreground lg:block">
          <p className="truncate">เครื่อง: {app.terminalName}</p>
          <p className="truncate">โซน: {app.location?.name ?? '-'}</p>
          {app.data.stage === 'dev' ? <p className="mt-1 font-semibold text-amber-700">โหมดทดสอบ (ข้อมูล dev)</p> : null}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone header */}
        <header className="flex items-center justify-between border-b bg-card px-4 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <Sprout className="size-5 text-primary" />
            <span className="font-semibold">{NAV.find((n) => n.route === route)?.label ?? 'KasetLink POS'}</span>
          </div>
          <span className="truncate text-xs text-muted-foreground">{app.location?.name}</span>
        </header>
        {app.data.stage === 'dev' ? (
          <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900 md:hidden dark:bg-amber-950 dark:text-amber-200">โหมดทดสอบ — ข้อมูลไม่ใช่ของจริง</div>
        ) : null}
        <main className={cn('min-h-0 flex-1 p-3 pb-20 sm:p-4 md:pb-4 lg:p-6', isPos ? 'flex flex-col overflow-hidden' : 'overflow-y-auto')}>
          {children}
        </main>
      </div>

      {/* Phone bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.filter((n) => MOBILE_PRIMARY.includes(n.route)).map((item) => {
          const Icon = item.icon
          const active = route === item.route
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => go(item.route)}
              className={cn('relative flex cursor-pointer flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'font-semibold text-primary' : 'text-muted-foreground')}
            >
              <Icon className="size-5" />
              {item.label}
              <span className="absolute top-1 right-3">{badge(item.route)}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-0.5 text-[11px]',
            !MOBILE_PRIMARY.includes(route) ? 'font-semibold text-primary' : 'text-muted-foreground',
          )}
        >
          <Menu className="size-5" /> เมนู
        </button>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>เมนูทั้งหมด</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-2 px-4 pb-4">
            {NAV.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => {
                    go(item.route)
                    setMoreOpen(false)
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-3 text-xs',
                    route === item.route ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
                  )}
                >
                  <Icon className="size-5" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
