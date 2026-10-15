import { createPortal } from 'react-dom'
import { useApp } from '@/lib/app-context'
import { bahtText } from '@/lib/bahttext'
import { baht, dateOnly, qty } from '@/lib/format'

export interface QuotationLine {
  lineNo: number
  productId: string
  productName: string
  unit: string
  qty: number
  unitPrice: number
  lineDiscount: number
  lineTotal: number
  priceSource: string | null
}

export interface Quotation {
  id: string
  docNo: string
  quoteDate: string
  validUntil: string
  status: 'open' | 'expired' | 'converted' | 'cancelled'
  customerId: string | null
  customerName: string
  customerCode: string | null
  phone: string | null
  address: string | null
  taxId: string | null
  priceLevel: number
  subtotal: number
  lineDiscountTotal: number
  billDiscount: number
  total: number
  note: string | null
  saleId: string | null
  saleBillNo: string | null
  convertedAt: string | null
  cancelReason: string | null
  createdByName: string | null
  itemCount: number
}

export interface QuotationDetail extends Quotation {
  lines: QuotationLine[]
}

/** ใบเสนอราคา on A4. */
export function QuotationDoc({ q }: { q: QuotationDetail }) {
  const { data } = useApp()
  const s = data.settings
  return (
    <div className="tax-invoice-page bg-white p-[10mm] text-[12px] leading-snug text-black">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[16px] font-bold">{s.shopName}</p>
          {s.address ? <p className="whitespace-pre-line">{s.address}</p> : null}
          {s.phone ? <p>โทร {s.phone}</p> : null}
          {s.taxId ? <p>เลขประจำตัวผู้เสียภาษี {s.taxId}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[20px] font-bold">ใบเสนอราคา</p>
          <p className="text-[11px]">QUOTATION</p>
          <p className="mt-1">
            เลขที่ <b>{q.docNo}</b>
          </p>
          <p>วันที่ {dateOnly(q.quoteDate)}</p>
          <p>ยืนราคาถึง {dateOnly(q.validUntil)}</p>
        </div>
      </div>

      <div className="mt-4 border border-black p-3">
        <p>
          <span className="font-semibold">เรียน</span> {q.customerName}
          {q.customerCode ? ` (${q.customerCode})` : ''}
        </p>
        {q.address ? <p className="whitespace-pre-line">ที่อยู่ {q.address}</p> : null}
        {q.phone ? <p>โทร {q.phone}</p> : null}
        {q.taxId ? <p>เลขประจำตัวผู้เสียภาษี {q.taxId}</p> : null}
        <p className="mt-1">ทางร้านมีความยินดีเสนอราคาสินค้าดังรายการต่อไปนี้</p>
      </div>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="w-8 py-1 text-left">#</th>
            <th className="text-left">รายการ</th>
            <th className="text-right">จำนวน</th>
            <th className="text-right">ราคา/หน่วย</th>
            <th className="text-right">ส่วนลด</th>
            <th className="text-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {q.lines.map((l) => (
            <tr key={l.lineNo} className="border-b border-gray-300">
              <td className="py-1">{l.lineNo}</td>
              <td>{l.productName}</td>
              <td className="text-right">
                {qty(l.qty)} {l.unit}
              </td>
              <td className="text-right">{baht(l.unitPrice)}</td>
              <td className="text-right">{l.lineDiscount > 0 ? baht(l.lineDiscount) : '-'}</td>
              <td className="text-right">{baht(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-between gap-6">
        <div className="flex-1">
          <p className="rounded border border-black px-2 py-1 text-center font-semibold">({bahtText(q.total)})</p>
          {q.note ? <p className="mt-2 whitespace-pre-line">หมายเหตุ: {q.note}</p> : null}
          <p className="mt-2 text-[11px]">ราคานี้ยืนถึงวันที่ {dateOnly(q.validUntil)} · ราคาอาจเปลี่ยนแปลงหลังจากนี้</p>
        </div>
        <div className="w-64">
          <div className="flex justify-between">
            <span>รวมเป็นเงิน</span>
            <span>{baht(q.subtotal)}</span>
          </div>
          {q.lineDiscountTotal + q.billDiscount > 0 ? (
            <div className="flex justify-between">
              <span>ส่วนลด</span>
              <span>-{baht(q.lineDiscountTotal + q.billDiscount)}</span>
            </div>
          ) : null}
          <div className="mt-1 flex justify-between border-t border-black pt-1 text-[14px] font-bold">
            <span>ยอดรวมทั้งสิ้น</span>
            <span>{baht(q.total)}</span>
          </div>
        </div>
      </div>

      <div className="mt-14 grid grid-cols-2 gap-8 text-center">
        <div>
          <p>.................................................</p>
          <p>ผู้เสนอราคา{q.createdByName ? ` (${q.createdByName})` : ''}</p>
        </div>
        <div>
          <p>.................................................</p>
          <p>ผู้อนุมัติสั่งซื้อ / ลูกค้า</p>
          <p className="text-[11px]">วันที่ ........../........../..........</p>
        </div>
      </div>
    </div>
  )
}

export function QuotationPrint({ q }: { q: QuotationDetail }) {
  return createPortal(
    <div id="print-root" data-paper="doc">
      <QuotationDoc q={q} />
    </div>,
    document.body,
  )
}
