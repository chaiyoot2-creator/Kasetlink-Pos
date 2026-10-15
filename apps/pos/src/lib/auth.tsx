import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, LogIn, Sprout } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorBox, Field } from '@/components/common'
import { ApiFailure, apiFetch, clearSession, errorMessage, onSessionEnded, setSession } from './api'

export type Permission =
  | 'pos.sell'
  | 'quotations'
  | 'sales.view'
  | 'sales.void'
  | 'receivables'
  | 'customers.insight'
  | 'agency'
  | 'delivery'
  | 'purchasing'
  | 'stock'
  | 'alerts'
  | 'reports'
  | 'accounting'
  | 'master'
  | 'settings'
  | 'view.cost'
  | 'users.manage'

export const PERMISSION_LABEL: Record<Exclude<Permission, 'users.manage'>, { label: string; hint: string }> = {
  'pos.sell': { label: 'ขายสินค้า', hint: 'หน้าขาย POS เปิดบิล' },
  quotations: { label: 'ใบเสนอราคา', hint: 'ออก แก้ไข พิมพ์ใบเสนอราคา' },
  'sales.view': { label: 'ดูบิลขาย', hint: 'ประวัติบิล พิมพ์ซ้ำ' },
  'sales.void': { label: 'ยกเลิกบิล', hint: 'ยกเลิกบิลและคืนสต็อก' },
  receivables: { label: 'ลูกหนี้ / รับชำระ', hint: 'ดูยอดค้าง รับชำระ ออกใบเสร็จ' },
  'customers.insight': { label: 'วิเคราะห์ลูกค้า', hint: 'หน้าลูกค้า ประวัติการซื้อ' },
  agency: { label: 'ฟาร์มสุข', hint: 'บันทึกการส่ง รายได้ ยืมสต็อก' },
  delivery: { label: 'จัดส่ง', hint: 'ออเดอร์จัดส่ง วางแผนเส้นทาง รถ แผนที่' },
  purchasing: { label: 'รับเข้าสินค้า', hint: 'ใบสั่งซื้อ รับสินค้า' },
  stock: { label: 'สต็อก', hint: 'ดูคงเหลือ โอน ปรับยอด' },
  alerts: { label: 'แจ้งเตือน', hint: 'สต็อกต่ำ ใกล้หมดอายุ' },
  reports: { label: 'กำไรขาดทุน', hint: 'รายงานกำไร ยอดขาย' },
  accounting: { label: 'ส่งบัญชี', hint: 'ใบเสร็จเต็มรูป ส่งสำนักงานบัญชี' },
  master: { label: 'ข้อมูลหลัก', hint: 'เพิ่ม/แก้สินค้า ลูกค้า แบรนด์ ผู้จำหน่าย' },
  settings: { label: 'ตั้งค่าร้าน', hint: 'ข้อมูลร้าน เครื่องพิมพ์ สำรองข้อมูล' },
  'view.cost': { label: 'เห็นต้นทุน/กำไร', hint: 'ทุนเฉลี่ยและกำไรในบิล/สินค้า' },
}

export interface StaffUser {
  id: string
  username: string
  displayName: string
  roleName: string
  isOwner: boolean
  permissions: Permission[]
}

interface AuthStatus {
  setupRequired: boolean
  user: StaffUser | null
}

interface SessionResponse {
  token: string
  user: StaffUser
}

interface AuthValue {
  user: StaffUser
  can: (...perms: Permission[]) => boolean
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth outside AuthGate')
  return v
}

/** Shows the owner setup / login screen until a staff member is signed in on this device. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setStatus(await apiFetch<AuthStatus>('/auth/status'))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    onSessionEnded(() => setStatus((s) => (s ? { ...s, user: null } : s)))
    return () => onSessionEnded(null)
  }, [refresh])

  const signedIn = (res: SessionResponse) => {
    setSession(res.token)
    setStatus({ setupRequired: false, user: res.user })
  }

  const logout = useCallback(() => {
    void apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
    clearSession()
    setStatus((s) => (s ? { ...s, user: null } : s))
  }, [])

  if (error) {
    return (
      <Screen>
        <ErrorBox message={error} onRetry={() => void refresh()} />
      </Screen>
    )
  }
  if (!status) {
    return (
      <Screen>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </Screen>
    )
  }
  if (status.setupRequired) return <SetupScreen onDone={signedIn} />
  if (!status.user) return <LoginScreen onDone={signedIn} />

  const user = status.user
  const can = (...perms: Permission[]) => user.isOwner || perms.some((p) => user.permissions.includes(p))
  return <AuthContext.Provider value={{ user, can, logout, refresh }}>{children}</AuthContext.Provider>
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Sprout className="size-6" />
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}

function PasswordInput({ value, onChange, autoComplete, id }: { value: string; onChange: (v: string) => void; autoComplete: string; id?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className="pr-10" />
      <button
        type="button"
        className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted-foreground"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export { PasswordInput }

function LoginScreen({ onDone }: { onDone: (r: SessionResponse) => void }) {
  const [username, setUsername] = useState(() => {
    try {
      return window.localStorage.getItem('kasetlink.lastUser') ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch<SessionResponse>('/auth/login', { method: 'POST', body: { username: username.trim().toLowerCase(), password } })
      try {
        window.localStorage.setItem('kasetlink.lastUser', res.user.username)
      } catch {
        // ignore
      }
      toast.success(`สวัสดี ${res.user.displayName}`)
      onDone(res)
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : errorMessage(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">เข้าสู่ระบบ KasetLink POS</h1>
          <p className="text-sm text-muted-foreground">ใช้ชื่อผู้ใช้และรหัสผ่านที่เจ้าของร้านตั้งให้</p>
        </div>
        <Field label="ชื่อผู้ใช้" htmlFor="login-user">
          <Input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus={!username} />
        </Field>
        <Field label="รหัสผ่าน" htmlFor="login-pass">
          <PasswordInput id="login-pass" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="cursor-pointer" disabled={busy || !username.trim() || !password}>
          {busy ? <Loader2 className="animate-spin" /> : <LogIn />} เข้าสู่ระบบ
        </Button>
        <p className="text-xs text-muted-foreground">ลืมรหัสผ่าน: ให้เจ้าของร้านตั้งรหัสใหม่ที่เมนู “ผู้ใช้และสิทธิ์”</p>
      </form>
    </Screen>
  )
}

function SetupScreen({ onDone }: { onDone: (r: SessionResponse) => void }) {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = displayName.trim() && /^[a-z0-9._-]{3,32}$/.test(username.trim().toLowerCase()) && password.length >= 6 && password === confirm

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      onDone(
        await apiFetch<SessionResponse>('/auth/setup', {
          method: 'POST',
          body: { displayName: displayName.trim(), username: username.trim().toLowerCase(), password },
        }),
      )
      toast.success('สร้างบัญชีเจ้าของร้านแล้ว')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">ตั้งบัญชีเจ้าของร้าน</h1>
          <p className="text-sm text-muted-foreground">ครั้งแรกเท่านั้น — บัญชีนี้มีสิทธิ์ทุกอย่างและใช้สร้างบัญชีพนักงาน</p>
        </div>
        <Field label="ชื่อที่แสดง">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="เช่น คุณชัยยุทธ" />
        </Field>
        <Field label="ชื่อผู้ใช้ (ภาษาอังกฤษ)" hint="3–32 ตัว: a-z 0-9 . _ -">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" placeholder="owner" />
        </Field>
        <Field label="รหัสผ่าน" hint="อย่างน้อย 6 ตัว">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        <Field label="ยืนยันรหัสผ่าน">
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        {confirm && confirm !== password ? <p className="text-sm text-destructive">รหัสผ่านไม่ตรงกัน</p> : null}
        <Button type="submit" className="cursor-pointer" disabled={!valid || busy}>
          {busy ? <Loader2 className="animate-spin" /> : null} สร้างบัญชีเจ้าของ
        </Button>
      </form>
    </Screen>
  )
}
