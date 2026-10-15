import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/common'
import { apiFetch, errorMessage, setSession } from '@/lib/api'
import { PasswordInput } from '@/lib/auth'

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setCurrent('')
    setNext('')
    setConfirm('')
  }, [open])

  const save = async () => {
    setBusy(true)
    try {
      const res = await apiFetch<{ token: string }>('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } })
      setSession(res.token)
      toast.success('เปลี่ยนรหัสผ่านแล้ว — เครื่องอื่นที่ใช้บัญชีนี้จะต้องเข้าสู่ระบบใหม่')
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>เปลี่ยนรหัสผ่าน</DialogTitle>
          <DialogDescription>รหัสผ่านใหม่อย่างน้อย 6 ตัว</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="รหัสผ่านเดิม">
            <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
          </Field>
          <Field label="รหัสผ่านใหม่">
            <PasswordInput value={next} onChange={setNext} autoComplete="new-password" />
          </Field>
          <Field label="ยืนยันรหัสผ่านใหม่">
            <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </Field>
          {confirm && confirm !== next ? <p className="text-sm text-destructive">รหัสผ่านไม่ตรงกัน</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={!current || next.length < 6 || next !== confirm || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
