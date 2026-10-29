import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sprout } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import type { Location } from '@/lib/types'

/** Shown until the shop has at least one location: creates the zones and names this device. */
export function FirstRunSetup() {
  const app = useApp()
  const [shopName, setShopName] = useState(app.data.settings.shopName)
  const [front, setFront] = useState('หน้าร้าน')
  const [warehouse, setWarehouse] = useState('โกดัง')
  const [terminalName, setTerminalName] = useState('แคชเชียร์ 1')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      await apiFetch('/settings', { method: 'PUT', body: { ...app.data.settings, shopName: shopName.trim() } })
      const store = await apiFetch<Location>('/locations', { method: 'POST', body: { code: 'FRONT', name: front.trim(), kind: 'store', isActive: true } })
      if (warehouse.trim()) {
        await apiFetch<Location>('/locations', { method: 'POST', body: { code: 'WH1', name: warehouse.trim(), kind: 'warehouse', isActive: true } })
      }
      await apiFetch('/terminals', { method: 'PUT', body: { id: app.terminalId, name: terminalName.trim() || app.terminalId, locationId: store.id } })
      app.setLocationId(store.id)
      await app.reload()
      toast.success('ตั้งค่าร้านเรียบร้อย')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sprout className="size-6" />
          </div>
          <CardTitle className="text-xl">เริ่มใช้งาน KasetLink POS</CardTitle>
          <CardDescription>ตั้งชื่อร้านและโซนเก็บสินค้า (แก้ไขภายหลังได้ที่เมนู ตั้งค่า)</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="ชื่อร้าน">
            <Input value={shopName} onChange={(e) => setShopName(e.target.value)} />
          </Field>
          <Field label="โซนขายหน้าร้าน">
            <Input value={front} onChange={(e) => setFront(e.target.value)} />
          </Field>
          <Field label="โกดัง (เว้นว่างได้)">
            <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
          </Field>
          <Field label="ชื่อเครื่องนี้">
            <Input value={terminalName} onChange={(e) => setTerminalName(e.target.value)} />
          </Field>
          <Button className="mt-2 h-11 cursor-pointer" disabled={busy || !shopName.trim() || !front.trim()} onClick={() => void start()}>
            {busy ? <Loader2 className="animate-spin" /> : null} เริ่มใช้งาน
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
