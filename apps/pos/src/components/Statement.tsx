import { createPortal } from 'react-dom'
import { useApp } from '@/lib/app-context'
import { bahtText } from '@/lib/bahttext'
import { baht, dateOnly, todayISO } from '@/lib/format'
import type { Customer, OpenBill, Settings } from '@/lib/types'

/** ใบแจ้งหนี้ / ใบวางบิล — open credit bills of one customer on A4. */
export function Statement({
  customer,
  bills,
  settings,
  qr,
}: {
  customer: Customer
  bills: OpenBill[]
  settings: Settings
  qr: string | null
}) {
  const total = bills.reduce((s, b) => s + b.outstanding, 0)
  const overdue = bills.filter((b) => b.daysOverdue > 0).reduce((s, b) => s + b.outstanding, 0)
  const lastDue = bills.reduce((d, b) => (b.dueDate > d ? b.dueDate : d), '')

  return (
    <div className="tax-invoice-page bg-white p-[10mm] text-[12px] leading-snug text-black">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[16px] font-bold">{settings.shopName}</p>
          {settings.address ? <p className="whitespace-pre-line">{settings.address}</p> : null}
          {settings.phone ? <p>โทร {settings.phone}</p> : null}
          {settings.taxId ? <p>เลขประจำตัวผู้เสียภาษี {settings.taxId}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[18px] font-bold">ใบแจ้งหนี้ / ใบวางบิล</p>
          <p>วันที่ {dateOnly(todayISO())}</p>
        </div>
      </div>

      <div className="mt-4 border border-black p-3">
        <p>
          <span className="font-semibold">ลูกค้า</span> {customer.name} ({customer.code})
        </p>
        {customer.address ? (
          <p>
            <span className="font-semibold">ที่อยู่</span> {customer.address}
          </p>
        ) : null}
        {customer.taxId ? (
          <p>
            <span className="font-semibold">เลขประจำตัวผู้เสียภาษี</span> {customer.taxId}
          </p>
        ) : null}
        <p>
          <span className="font-semibold">เครดิต</span> {customer.creditTermDays} วัน
          {customer.phone ? ` · โทร ${customer.phone}` : ''}
        </p>
      </div>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="w-[10mm] py-1 text-center">ลำดับ</th>
            <th className="py-1 text-left">เลขที่เอกสาร</th>
            <th className="py-1 text-left">วันที่ขาย</th>
            <th className="py-1 text-left">ครบกำหนด</th>
            <th className="py-1 text-right">ยอดบิล</th>
            <th className="py-1 text-right">ชำระแล้ว</th>
            <th className="py-1 text-right">ค้างชำระ</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b, i) => (
            <tr key={b.saleId} className="align-top">
              <td className="py-1 text-center">{i + 1}</td>
              <td className="py-1">
                {b.taxInvoiceNo ?? b.billNo}
                {b.taxInvoiceNo ? <span className="block text-[10px]">บิล {b.billNo}</span> : null}
              </td>
              <td className="py-1">{dateOnly(b.soldAt)}</td>
              <td className="py-1">
                {dateOnly(b.dueDate)}
                {b.daysOverdue > 0 ? <span className="block text-[10px] font-semibold">เกินกำหนด {b.daysOverdue} วัน</span> : null}
              </td>
              <td className="py-1 text-right">{baht(b.total)}</td>
              <td className="py-1 text-right">{b.paid > 0 ? baht(b.paid) : '-'}</td>
              <td className="py-1 text-right font-semibold">{baht(b.outstanding)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 grid grid-cols-[1fr_70mm] gap-4 border-t border-black pt-2">
        <div>
          <p className="font-semibold">({bahtText(total)})</p>
          <p className="mt-1">จำนวน {bills.length} รายการ</p>
          {lastDue ? <p>กรุณาชำระภายในวันที่ {dateOnly(lastDue)}</p> : null}
        </div>
        <div className="space-y-0.5">
          {overdue > 0 ? (
            <div className="flex justify-between">
              <span>เกินกำหนดแล้ว</span>
              <span>{baht(overdue)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-black pt-1 text-[14px] font-bold">
            <span>ยอดค้างชำระทั้งสิ้น</span>
            <span>{baht(total)}</span>
          </div>
        </div>
      </div>

      {qr ? (
        <div className="mt-6 flex items-center gap-4">
          <img src={qr} alt="QR พร้อมเพย์" className="size-[32mm]" />
          <div>
            <p className="font-semibold">ชำระผ่านพร้อมเพย์</p>
            <p>พร้อมเพย์ {settings.promptpayId}</p>
            <p>ยอด {baht(total)} บาท (สแกนแล้วยอดขึ้นอัตโนมัติ)</p>
          </div>
        </div>
      ) : null}

      <div className="mt-16 grid grid-cols-2 gap-16 text-center">
        <div>
          <p className="border-t border-dotted border-black pt-1">ผู้วางบิล</p>
          <p>วันที่ ........../........../..........</p>
        </div>
        <div>
          <p className="border-t border-dotted border-black pt-1">ผู้รับวางบิล</p>
          <p>วันนัดชำระ ........../........../..........</p>
        </div>
      </div>
    </div>
  )
}

export function StatementPrint(props: { customer: Customer; bills: OpenBill[]; qr: string | null }) {
  const { data } = useApp()
  return createPortal(
    <div id="print-root" data-paper="doc">
      <Statement {...props} settings={data.settings} />
    </div>,
    document.body,
  )
}
