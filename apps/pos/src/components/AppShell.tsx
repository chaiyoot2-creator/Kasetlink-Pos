import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Activity, BellRing, Boxes, ChartLine, Database, FileSignature, FileText, HandCoins, Handshake, KeyRound, LogOut, MapPinned, Menu, ReceiptText, ScanEye, Settings, ShoppingCart, Sprout, Truck, UserCog, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useApp } from '@/lib/app-context'
import { useAuth, type Permission, type StaffUser } from '@/lib/auth'
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog'
import { apiFetch } from '@/lib/api'
import type { Alerts } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface NavItem {
  route: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Any one of these lets the user open the page. */
  perms: Permission[]
  /** Replaces `perms` for pages gated on something other than a permission. */
  allow?: (user: StaffUser) => boolean
  /** Not built yet: shown with a "เร็วๆ นี้" tag. */
  soon?: boolean
}

export const NAV: NavItem[] = [
  { route: 'pos', label: 'ขายสินค้า', icon: ShoppingCart, perms: ['pos.sell'] },
  { route: 'quotations', label: 'ใบเสนอราคา', icon: FileSignature, perms: ['quotations'] },
  { route: 'sales', label: 'บิลขาย', icon: ReceiptText, perms: ['sales.view', 'pos.sell'] },
  { route: 'receivables', label: 'ลูกหนี้', icon: HandCoins, perms: ['receivables'] },
  { route: 'customers', label: 'ลูกค้า', icon: Users, perms: ['customers.insight'] },
  { route: 'agency', label: 'ฟาร์มสุข', icon: Handshake, perms: ['agency'] },
  { route: 'delivery', label: 'จัดส่ง', icon: MapPinned, perms: ['delivery'] },
  { route: 'purchasing', label: 'รับเข้าสินค้า', icon: Truck, perms: ['purchasing'] },
  { route: 'stock', label: 'สต็อก', icon: Boxes, perms: ['stock'] },
  { route: 'alerts', label: 'แจ้งเตือน', icon: BellRing, perms: ['alerts'] },
  { route: 'reports', label: 'กำไรขาดทุน', icon: ChartLine, perms: ['reports'] },
  { route: 'accounting', label: 'ส่งบัญชี', icon: FileText, perms: ['accounting'] },
  { route: 'master', label: 'ข้อมูลหลัก', icon: Database, perms: ['master'] },
  { route: 'settings', label: 'ตั้งค่า', icon: Settings, perms: ['settings'] },
  { route: 'users', label: 'ผู้ใช้และสิทธิ์', icon: UserCog, perms: ['users.manage'] },
  { route: 'analytics', label: 'สถิติการใช้งาน', icon: Activity, perms: [], allow: (u) => u.canViewAnalytics },
  { route: 'vision', label: 'AI Vision', icon: ScanEye, perms: ['pos.sell', 'stock'], soon: true },
]

export function canOpen(item: NavItem, auth: { user: StaffUser; can: (...perms: Permission[]) => boolean }): boolean {
  return item.allow ? item.allow(auth.user) : auth.can(...item.perms)
}

const MOBILE_PRIMARY = ['pos', 'sales', 'stock', 'alerts']

/** Alert count for the nav badge, refreshed every 5 minutes. */
function useAlertCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () =>
      apiFetch<Alerts>('/alerts')
        .then((a) => alive && setCount(a.lowStock.length + a.nearExpiry.length + a.expired.length + a.receivables.overdueCount))
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
  const [changingPassword, setChangingPassword] = useState(false)
  const auth = useAuth()
  const nav = NAV.filter((n) => canOpen(n, auth))
  const mobilePrimary = nav.filter((n) => MOBILE_PRIMARY.includes(n.route)).slice(0, 4)
  const userBox = (
    <div className="grid gap-1">
      <p className="truncate text-sm font-medium text-foreground">{auth.user.displayName}</p>
      <p className="truncate text-xs text-muted-foreground">
        {auth.user.roleName} · {auth.user.username}
      </p>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => setChangingPassword(true)} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted">
          <KeyRound className="size-3" /> เปลี่ยนรหัส
        </button>
        <button type="button" onClick={auth.logout} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs text-destructive hover:bg-muted">
          <LogOut className="size-3" /> ออก / สลับผู้ใช้
        </button>
      </div>
    </div>
  )
  const isPos = route === 'pos'

  const badge = (r: string) =>
    r === 'alerts' && alertCount > 0 ? (
      <Badge variant="destructive" className="h-5 min-w-5 rounded-full px-1 text-[10px]">
        {alertCount > 99 ? '99+' : alertCount}
      </Badge>
    ) : NAV.find((n) => n.route === r)?.soon ? (
      <Badge variant="secondary" className="h-5 rounded-full px-1.5 text-[10px] font-normal whitespace-nowrap">
        เร็วๆ นี้
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
          {nav.map((item) => {
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
        <div className="border-t px-2 py-2 md:block lg:hidden">
          <button type="button" onClick={auth.logout} title="ออกจากระบบ / สลับผู้ใช้" className="flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-muted-foreground hover:bg-muted">
            <LogOut className="size-5" />
            ออก
          </button>
        </div>
        <div className="hidden border-t px-4 py-3 text-xs text-muted-foreground lg:block">
          {userBox}
          <p className="mt-2 truncate">เครื่อง: {app.terminalName}</p>
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
      <nav
        style={{ gridTemplateColumns: `repeat(${mobilePrimary.length + 1}, minmax(0, 1fr))` }}
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {mobilePrimary.map((item) => {
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
            !mobilePrimary.some((n) => n.route === route) ? 'font-semibold text-primary' : 'text-muted-foreground',
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
          <div className="mx-4 rounded-lg border p-3">{userBox}</div>
          <div className="grid grid-cols-3 gap-2 px-4 pb-4">
            {nav.map((item) => {
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
                  {item.soon ? <span className="text-[10px] text-muted-foreground">เร็วๆ นี้</span> : null}
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
    </div>
  )
}
