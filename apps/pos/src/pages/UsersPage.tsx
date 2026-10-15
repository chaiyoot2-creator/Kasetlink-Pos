import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Crown, Loader2, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorBox, Field, Loading, PageHeader, TableWrap } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { PERMISSION_LABEL, PasswordInput, useAuth, type Permission } from '@/lib/auth'
import { dateTime } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

interface Role {
  id: string
  name: string
  roleKey: string | null
  isOwner: boolean
  permissions: Permission[]
  userCount: number
}

interface User {
  id: string
  username: string
  displayName: string
  roleId: string
  roleName: string
  isOwner: boolean
  isActive: boolean
  lastLoginAt: string | null
  locked: boolean
}

const ALL = Object.keys(PERMISSION_LABEL) as Exclude<Permission, 'users.manage'>[]

/** Owner page: staff accounts (username / password) and what each role may do. */
export function UsersPage() {
  const users = useApi<User[]>('/auth/users')
  const roles = useApi<Role[]>('/auth/roles')
  const [editUser, setEditUser] = useState<User | 'new' | null>(null)
  const [editRole, setEditRole] = useState<Role | 'new' | null>(null)
  const reload = () => {
    void users.reload()
    void roles.reload()
  }

  return (
    <div>
      <PageHeader title="ผู้ใช้และสิทธิ์" subtitle="สร้างบัญชีพนักงาน (ชื่อผู้ใช้ + รหัสผ่าน) และกำหนดว่าแต่ละระดับใช้เมนูอะไรได้บ้าง" />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="cursor-pointer">
            ผู้ใช้
          </TabsTrigger>
          <TabsTrigger value="roles" className="cursor-pointer">
            ระดับและสิทธิ์
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-3 grid gap-3">
          <Button className="w-fit cursor-pointer" onClick={() => setEditUser('new')}>
            <Plus /> เพิ่มผู้ใช้
          </Button>
          {users.error ? <ErrorBox message={users.error} onRetry={() => void users.reload()} /> : null}
          {users.loading && !users.data ? <Loading /> : null}
          {users.data ? (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ชื่อ</TableHead>
                    <TableHead>ระดับ</TableHead>
                    <TableHead className="hidden sm:table-cell">เข้าใช้ล่าสุด</TableHead>
                    <TableHead>สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data.map((u) => (
                    <TableRow key={u.id} className={cn('cursor-pointer', !u.isActive && 'opacity-50')} onClick={() => setEditUser(u)}>
                      <TableCell>
                        <p className="font-medium">{u.displayName}</p>
                        <p className="text-xs text-muted-foreground">{u.username}</p>
                      </TableCell>
                      <TableCell>
                        {u.isOwner ? <Crown className="mr-1 inline size-3.5 text-amber-600" /> : null}
                        {u.roleName}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{u.lastLoginAt ? dateTime(u.lastLoginAt) : '-'}</TableCell>
                      <TableCell>
                        {!u.isActive ? <Badge variant="secondary">ปิดใช้งาน</Badge> : u.locked ? <Badge variant="destructive"><Lock className="size-3" /> ถูกล็อก</Badge> : <Badge variant="outline">ใช้งาน</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          ) : null}
        </TabsContent>
        <TabsContent value="roles" className="mt-3 grid gap-3">
          <Button className="w-fit cursor-pointer" onClick={() => setEditRole('new')}>
            <Plus /> เพิ่มระดับ
          </Button>
          {roles.error ? <ErrorBox message={roles.error} onRetry={() => void roles.reload()} /> : null}
          <div className="grid gap-2 md:grid-cols-2">
            {roles.data?.map((r) => (
              <button key={r.id} type="button" onClick={() => setEditRole(r)} className="grid cursor-pointer gap-2 rounded-lg border bg-card p-3 text-left hover:border-primary">
                <div className="flex items-center gap-2">
                  {r.isOwner ? <Crown className="size-4 text-amber-600" /> : <ShieldCheck className="size-4 text-primary" />}
                  <span className="font-semibold">{r.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{r.userCount} คน</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {r.isOwner ? (
                    <Badge>ทุกอย่าง + จัดการผู้ใช้</Badge>
                  ) : r.permissions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">ยังไม่มีสิทธิ์</span>
                  ) : (
                    r.permissions.map((p) =>
                      p in PERMISSION_LABEL ? (
                        <Badge key={p} variant="secondary" className="font-normal">
                          {PERMISSION_LABEL[p as keyof typeof PERMISSION_LABEL].label}
                        </Badge>
                      ) : null,
                    )
                  )}
                </div>
              </button>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      <UserDialog user={editUser} roles={roles.data ?? []} onClose={() => setEditUser(null)} onSaved={reload} />
      <RoleDialog role={editRole} onClose={() => setEditRole(null)} onSaved={reload} />
    </div>
  )
}

function UserDialog({ user, roles, onClose, onSaved }: { user: User | 'new' | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const { user: me } = useAuth()
  const isNew = user === 'new'
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [roleId, setRoleId] = useState('')
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    if (user === 'new') {
      setDisplayName('')
      setUsername('')
      setRoleId(roles.find((r) => r.roleKey === 'cashier')?.id ?? roles.find((r) => !r.isOwner)?.id ?? '')
      setIsActive(true)
    } else {
      setDisplayName(user.displayName)
      setUsername(user.username)
      setRoleId(user.roleId)
      setIsActive(user.isActive)
    }
    setPassword('')
  }, [user, roles])

  const uname = username.trim().toLowerCase()
  const valid = displayName.trim() && roleId && (isNew ? /^[a-z0-9._-]{3,32}$/.test(uname) && password.length >= 6 : !password || password.length >= 6)

  const save = async (unlock = false) => {
    if (!user) return
    setBusy(true)
    try {
      if (user === 'new') {
        await apiFetch('/auth/users', { method: 'POST', body: { displayName: displayName.trim(), username: uname, password, roleId } })
        toast.success(`สร้างผู้ใช้ ${uname} แล้ว`)
      } else {
        await apiFetch(`/auth/users/${user.id}`, {
          method: 'PUT',
          body: { displayName: displayName.trim(), roleId, isActive, newPassword: password || null, unlock },
        })
        toast.success(password ? 'บันทึกและตั้งรหัสผ่านใหม่แล้ว' : 'บันทึกแล้ว')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'เพิ่มผู้ใช้' : 'แก้ไขผู้ใช้'}</DialogTitle>
          <DialogDescription>{isNew ? 'แจ้งชื่อผู้ใช้และรหัสผ่านให้พนักงาน — เปลี่ยนรหัสเองได้หลังเข้าสู่ระบบ' : 'เปลี่ยนระดับ / ปิดใช้งาน / ตั้งรหัสใหม่ จะทำให้บัญชีนี้ต้องเข้าสู่ระบบใหม่'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="ชื่อที่แสดง">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="เช่น น้องแนน" />
          </Field>
          <Field label="ชื่อผู้ใช้" hint={isNew ? '3–32 ตัว: a-z 0-9 . _ - (เปลี่ยนภายหลังไม่ได้)' : undefined}>
            <Input value={username} disabled={!isNew} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" placeholder="nan" />
          </Field>
          <Field label="ระดับ">
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue placeholder="เลือกระดับ" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={isNew ? 'รหัสผ่าน' : 'ตั้งรหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)'} hint="อย่างน้อย 6 ตัว">
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
          </Field>
          {!isNew ? (
            <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm">
              ใช้งานได้
              <Switch checked={isActive} disabled={user?.id === me.id} onCheckedChange={setIsActive} />
            </label>
          ) : null}
        </div>
        <DialogFooter>
          {user && user !== 'new' && user.locked ? (
            <Button variant="outline" className="cursor-pointer" disabled={busy} onClick={() => void save(true)}>
              ปลดล็อก
            </Button>
          ) : null}
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={!valid || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog({ role, onClose, onSaved }: { role: Role | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const isNew = role === 'new'
  const isOwner = role !== null && role !== 'new' && role.isOwner
  const [name, setName] = useState('')
  const [perms, setPerms] = useState<Set<Permission>>(new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!role) return
    setName(role === 'new' ? '' : role.name)
    setPerms(new Set(role === 'new' ? ['pos.sell', 'sales.view'] : role.permissions))
  }, [role])

  const save = async () => {
    if (!role) return
    setBusy(true)
    try {
      const body = { name: name.trim(), permissions: [...perms].filter((p) => p !== 'users.manage') }
      if (role === 'new') await apiFetch('/auth/roles', { method: 'POST', body })
      else await apiFetch(`/auth/roles/${role.id}`, { method: 'PUT', body })
      toast.success('บันทึกระดับแล้ว — ผู้ใช้ในระดับนี้จะได้สิทธิ์ใหม่ภายใน 30 วินาที')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!role || role === 'new' || !window.confirm(`ลบระดับ “${role.name}”?`)) return
    setBusy(true)
    try {
      await apiFetch(`/auth/roles/${role.id}`, { method: 'DELETE' })
      toast.success('ลบระดับแล้ว')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={role !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'เพิ่มระดับผู้ใช้' : `ระดับ: ${role?.name ?? ''}`}</DialogTitle>
          <DialogDescription>{isOwner ? 'ระดับเจ้าของมีสิทธิ์ทุกอย่างเสมอ แก้ได้เฉพาะชื่อ' : 'ติ๊กเมนูและการทำงานที่ระดับนี้ใช้ได้ — ระบบตรวจสิทธิ์ที่เซิร์ฟเวอร์ด้วย'}</DialogDescription>
        </DialogHeader>
        <Field label="ชื่อระดับ">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น พนักงานขายหน้าร้าน" />
        </Field>
        <ul className="grid gap-1">
          {ALL.map((p) => (
            <li key={p}>
              <label className={cn('flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm', isOwner && 'cursor-default opacity-70')}>
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  disabled={isOwner}
                  checked={isOwner || perms.has(p)}
                  onChange={(e) =>
                    setPerms((s) => {
                      const n = new Set(s)
                      if (e.target.checked) n.add(p)
                      else n.delete(p)
                      return n
                    })
                  }
                />
                <span>
                  <span className="font-medium">{PERMISSION_LABEL[p].label}</span>
                  <span className="block text-xs text-muted-foreground">{PERMISSION_LABEL[p].hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          {role && role !== 'new' && !role.isOwner ? (
            <Button variant="ghost" className="mr-auto cursor-pointer text-destructive" disabled={busy} onClick={() => void remove()}>
              <Trash2 /> ลบระดับ
            </Button>
          ) : null}
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={!name.trim() || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
