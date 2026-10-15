import { createPortal } from 'react-dom'
import { useApp } from '@/lib/app-context'
import { bahtText } from '@/lib/bahttext'
import { PAYMENT_LABEL, baht, dateOnly, qty } from '@/lib/format'
import type { SaleDetail, Settings } from '@/lib/types'

function branchLabel(code: string | null | undefined): string {
  if (!code || code === '00000') return 'สำนักงานใหญ่'
  return `สาขาที่ ${code}`
}

/**
 * Full receipt / delivery note on A4 for the accounting office. The shop sells
 * VAT-exempt animal feed, so the document carries no VAT lines.
 */
export function TaxInvoice({ sale, settings, copy }: { sale: SaleDetail; settings: Settings; copy: 'original' | 'copy' }) {
  // A credit sale is not paid yet: it is a delivery note / invoice; the receipt comes with payment.
  const title = sale.paymentMethod === 'credit' ? 'ใบส่งสินค้า / ใบแจ้งหนี้' : 'ใบเสร็จรับเงิน / ใบส่งสินค้า'
  const buyer = sale.buyer
  const voided = sale.status === 'voided'

  return (
    <div className="tax-invoice-page relative bg-white p-[10mm] text-[12px] leading-snug text-black">
      {voided ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[64px] font-bold text-red-600/25 -rotate-12">
          ยกเลิก
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[16px] font-bold">{settings.shopName}</p>
          {settings.address ? <p className="whitespace-pre-line">{settings.address}</p> : null}
          {settings.phone ? <p>โทร {settings.phone}</p> : null}
          {settings.taxId ? (
            <p>
              เลขประจำตัวผู้เสียภาษี {settings.taxId} ({branchLabel(settings.branchCode)})
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-[18px] font-bold">{title}</p>
          <p className="mt-1 inline-block border border-black px-2">{copy === 'original' ? 'ต้นฉบับ' : 'สำเนา'}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-4 border border-black p-3">
        <div>
          <p>
            <span className="font-semibold">ลูกค้า</span> {buyer?.name ?? sale.customerName ?? '-'}
            {buyer?.code ? ` (${buyer.code})` : ''}
          </p>
          <p>
            <span className="font-semibold">ที่อยู่</span> {buyer?.address || '-'}
          </p>
          <p>
            <span className="font-semibold">เลขประจำตัวผู้เสียภาษี</span> {buyer?.taxId || '-'}
            {buyer?.taxId ? ` (${branchLabel(buyer.branchCode)})` : ''}
          </p>
          {buyer?.phone ? (
            <p>
              <span className="font-semibold">โทร</span> {buyer.phone}
            </p>
          ) : null}
        </div>
        <div className="min-w-[45mm] text-right">
          <p>
            <span className="font-semibold">เลขที่</span> {sale.taxInvoiceNo ?? '-'}
          </p>
          <p>
            <span className="font-semibold">วันที่</span> {dateOnly(sale.soldAt)}
          </p>
          <p>
            <span className="font-semibold">อ้างอิงบิล</span> {sale.billNo}
          </p>
        </div>
      </div>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="w-[10mm] py-1 text-center">ลำดับ</th>
            <th className="py-1 text-left">รายการ</th>
            <th className="w-[20mm] py-1 text-right">จำนวน</th>
            <th className="w-[26mm] py-1 text-right">ราคา/หน่วย</th>
            <th className="w-[22mm] py-1 text-right">ส่วนลด</th>
            <th className="w-[28mm] py-1 text-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.lineNo} className="align-top">
              <td className="py-1 text-center">{l.lineNo}</td>
              <td className="py-1">{l.productName}</td>
              <td className="py-1 text-right">
                {qty(l.qty)} {l.unit}
              </td>
              <td className="py-1 text-right">{baht(l.unitPrice)}</td>
              <td className="py-1 text-right">{l.lineDiscount > 0 ? baht(l.lineDiscount) : '-'}</td>
              <td className="py-1 text-right">{baht(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 grid grid-cols-[1fr_70mm] gap-4 border-t border-black pt-2">
        <div>
          <p className="font-semibold">({bahtText(sale.total)})</p>
          <p className="mt-1">ชำระโดย {PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod}</p>
          {sale.paymentMethod === 'credit' ? (
            <p>* ขายเชื่อ — ยังไม่ได้รับชำระ{sale.dueDate ? ` · ครบกำหนดชำระ ${dateOnly(sale.dueDate)}` : ''} · ออกใบเสร็จเมื่อรับเงิน</p>
          ) : null}
        </div>
        <div className="space-y-0.5">
          <Line label="รวมเงิน" value={baht(sale.subtotal - sale.lineDiscountTotal)} />
          {sale.billDiscount > 0 ? <Line label="ส่วนลด" value={`-${baht(sale.billDiscount)}`} /> : null}
          <Line label="รวมทั้งสิ้น" value={baht(sale.total)} bold />
        </div>
      </div>

      <div className="mt-16 grid grid-cols-2 gap-16 text-center">
        <div>
          <p className="border-t border-dotted border-black pt-1">ผู้รับสินค้า / ผู้ซื้อ</p>
          <p>วันที่ ........../........../..........</p>
        </div>
        <div>
          <p className="border-t border-dotted border-black pt-1">ผู้รับเงิน / ผู้ขาย</p>
          <p>วันที่ ........../........../..........</p>
        </div>
      </div>
    </div>
  )
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'border-t border-black pt-1 text-[14px] font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

/** Print portal for one or more tax invoices (original + copy each), one A4 page per document. */
export function TaxInvoicePrint({ sales, withCopy = true }: { sales: SaleDetail[]; withCopy?: boolean }) {
  const { data } = useApp()
  return createPortal(
    <div id="print-root" data-paper="doc">
      {sales.flatMap((s) => [
        <TaxInvoice key={`${s.id}-o`} sale={s} settings={data.settings} copy="original" />,
        ...(withCopy ? [<TaxInvoice key={`${s.id}-c`} sale={s} settings={data.settings} copy="copy" />] : []),
      ])}
    </div>,
    document.body,
  )
}
