import { Boxes, ScanBarcode, ScanEye, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/common'

const PLANNED = [
  { icon: ScanBarcode, title: 'ขายด้วยกล้อง', text: 'ส่องสินค้าที่เคาน์เตอร์ ระบบหยิบลงตะกร้าให้แทนการยิงบาร์โค้ด' },
  { icon: Boxes, title: 'นับสต็อกด้วยกล้อง', text: 'ถ่ายกองกระสอบในโกดัง ระบบนับและเทียบกับยอดในระบบ' },
  { icon: Truck, title: 'ตรวจของขึ้นรถ', text: 'เช็กสินค้าที่ขึ้นรถส่งให้ตรงกับรายการจัดส่ง' },
]

/** AI Vision: placeholder until the camera module is built. */
export function VisionPage() {
  return (
    <div className="grid gap-4">
      <PageHeader title="AI Vision" subtitle="ตรวจจับสินค้าด้วยกล้อง AI" actions={<Badge variant="secondary">เร็วๆ นี้</Badge>} />
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
        <ScanEye className="size-10 text-muted-foreground" />
        <p className="font-semibold">เร็วๆ นี้</p>
        <p className="max-w-md text-sm text-muted-foreground">กำลังพัฒนาระบบกล้อง AI สำหรับตรวจจับสินค้าในร้าน ทุกบิลและการเคลื่อนไหวสต็อกบันทึกรหัสเครื่องและโซนไว้แล้วเพื่อใช้กับระบบนี้</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {PLANNED.map((p) => (
          <div key={p.title} className="grid gap-1 rounded-lg border p-4">
            <p.icon className="size-5 text-primary" />
            <p className="font-medium">{p.title}</p>
            <p className="text-sm text-muted-foreground">{p.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
