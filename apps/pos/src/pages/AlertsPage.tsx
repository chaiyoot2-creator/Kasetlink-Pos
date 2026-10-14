import { AlertTriangle, CalendarClock, PackageX } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Empty, ErrorBox, Loading, PageHeader, Stat, TableWrap } from '@/components/common'
import { qty } from '@/lib/format'
import type { Alerts, Lot } from '@/lib/types'
import { useApi } from '@/lib/use-api'
import { ExpiryBadge } from './StockPage'

export function AlertsPage() {
  const { data, error, loading, reload } = useApi<Alerts>('/alerts')

  return (
    <div>
      <PageHeader title="แจ้งเตือน" subtitle={data ? `สินค้าใกล้หมดอายุภายใน ${data.expiryAlertDays} วัน (ตั้งค่าได้ที่เมนู ตั้งค่า)` : undefined} />
      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="grid gap-5">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="สต็อกต่ำ" value={data.lowStock.length} tone={data.lowStock.length ? 'warn' : undefined} />
            <Stat label="ใกล้หมดอายุ" value={data.nearExpiry.length} tone={data.nearExpiry.length ? 'warn' : undefined} />
            <Stat label="หมดอายุแล้ว" value={data.expired.length} tone={data.expired.length ? 'bad' : undefined} />
          </div>

          <section>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 text-amber-600" /> สต็อกต่ำกว่าจุดสั่งซื้อ
            </h2>
            {data.lowStock.length === 0 ? (
              <Empty title="ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อ" hint="กำหนด “จุดสั่งซื้อ” ของสินค้าได้ที่เมนู สินค้า" />
            ) : (
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สินค้า</TableHead>
                      <TableHead className="text-right">คงเหลือรวม</TableHead>
                      <TableHead className="text-right">จุดสั่งซื้อ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.lowStock.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell>
                          {p.name}
                          <p className="text-xs text-muted-foreground">{p.sku}</p>
                        </TableCell>
                        <TableCell className={`tabular text-right font-semibold ${p.qty <= 0 ? 'text-destructive' : 'text-amber-700'}`}>
                          {qty(p.qty)} {p.unit}
                        </TableCell>
                        <TableCell className="tabular text-right">{qty(p.reorderPoint)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            )}
          </section>

          <LotSection title="ใกล้หมดอายุ" icon={<CalendarClock className="size-4 text-amber-600" />} lots={data.nearExpiry} empty="ไม่มีล็อตที่ใกล้หมดอายุ" />
          <LotSection
            title="หมดอายุแล้ว (ระบบไม่ตัดขาย — ปรับยอดเหตุผล “สินค้าหมดอายุ” เพื่อตัดออก)"
            icon={<PackageX className="size-4 text-destructive" />}
            lots={data.expired}
            empty="ไม่มีล็อตที่หมดอายุค้างในสต็อก"
          />
        </div>
      ) : null}
    </div>
  )
}

function LotSection({ title, icon, lots, empty }: { title: string; icon: React.ReactNode; lots: Lot[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        {icon} {title}
      </h2>
      {lots.length === 0 ? (
        <Empty title={empty} />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>สินค้า</TableHead>
                <TableHead>ล็อต</TableHead>
                <TableHead>วันหมดอายุ</TableHead>
                <TableHead className="hidden sm:table-cell">ที่เก็บ</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.productName}</TableCell>
                  <TableCell>{l.lotNo || '-'}</TableCell>
                  <TableCell>
                    <ExpiryBadge date={l.expiryDate} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{l.locationName}</TableCell>
                  <TableCell className="tabular text-right">
                    {qty(l.qty)} {l.unit}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </section>
  )
}
