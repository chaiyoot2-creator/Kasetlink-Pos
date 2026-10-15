import { createPortal } from 'react-dom'
import { useApp } from '@/lib/app-context'
import { PAYMENT_LABEL, baht, dateOnly, dateTime, qty } from '@/lib/format'
import { levelName } from '@/lib/pricing'
import { getPrintPrefs, type PaperSize } from '@/lib/print'
import type { SaleDetail } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Receipt as shown on screen (and, inside ReceiptPrint, as printed). */
export function Receipt({ sale, paper, showImages = false }: { sale: SaleDetail; paper?: PaperSize; showImages?: boolean }) {
  const { data } = useApp()
  const s = data.settings
  return (
    <div
      className={cn(
        'mx-auto w-full bg-white font-mono leading-snug text-black',
        paper === undefined && 'max-w-[320px] p-3 text-[12px]',
        paper === '58' && 'text-[10px]',
        paper === '80' && 'text-[12px]',
        paper === 'a4' && 'text-[13px]',
      )}
    >
      <div className="text-center">
        <p className="text-[14px] font-bold">{s.shopName}</p>
        {s.address ? <p>{s.address}</p> : null}
        {s.phone ? <p>โทร {s.phone}</p> : null}
        {s.taxId ? <p>เลขประจำตัวผู้เสียภาษี {s.taxId}</p> : null}
        <p className="mt-1 font-semibold">
          {sale.status === 'voided' ? '*** บิลยกเลิก ***' : sale.paymentMethod === 'credit' ? 'ใบส่งของ / ใบแจ้งหนี้ (ยังไม่ชำระ)' : 'ใบเสร็จรับเงิน'}
        </p>
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1">
        {sale.taxInvoiceNo ? (
          <>
            <p className="font-semibold">เลขที่ {sale.taxInvoiceNo}</p>
            <p className="text-[10px]">อ้างอิงบิล {sale.billNo}</p>
          </>
        ) : (
          <p>เลขที่ {sale.billNo}</p>
        )}
        <p>วันที่ {dateTime(sale.soldAt)}</p>
        <p>
          ราคา{levelName(s.priceLevelNames, sale.priceLevel)} · {sale.locationName ?? ''}
        </p>
        {sale.customerName ? <p>ลูกค้า {sale.customerName}</p> : null}
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        {sale.lines.map((l) => (
          <div key={l.lineNo} className="py-0.5">
            {showImages && l.imageUrl ? (
              <img
                src={l.imageUrl}
                alt=""
                className={cn('mb-0.5 object-contain', paper === 'a4' ? 'h-20 w-20' : 'h-14 w-14')}
              />
            ) : null}
            <p>{l.productName}</p>
            <div className="flex justify-between">
              <span>
                {qty(l.qty)} {l.unit} x {baht(l.unitPrice)}
              </span>
              <span>{baht(l.lineTotal + l.lineDiscount)}</span>
            </div>
            {l.lineDiscount > 0 ? (
              <div className="flex justify-between">
                <span> ส่วนลด</span>
                <span>-{baht(l.lineDiscount)}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        <Row label="รวม" value={baht(sale.subtotal)} />
        {sale.lineDiscountTotal + sale.billDiscount > 0 ? (
          <Row label="ส่วนลดรวม" value={`-${baht(sale.lineDiscountTotal + sale.billDiscount)}`} />
        ) : null}
        <Row label="ยอดสุทธิ" value={baht(sale.total)} bold />
        <Row label={`ชำระโดย${PAYMENT_LABEL[sale.paymentMethod] ?? ''}`} value={sale.cashReceived !== null ? baht(sale.cashReceived) : baht(sale.total)} />
        {sale.changeAmount !== null && sale.changeAmount > 0 ? <Row label="เงินทอน" value={baht(sale.changeAmount)} /> : null}
        {sale.paymentMethod === 'credit' ? (
          <p className="mt-1">
            * ยอดนี้บันทึกเป็นลูกหนี้ (เงินเชื่อ){sale.dueDate ? ` · ครบกำหนดชำระ ${dateOnly(sale.dueDate)}` : ''}
          </p>
        ) : null}
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1 text-center">
        <p>{s.receiptFooter || 'ขอบคุณที่ใช้บริการ'}</p>
        <p className="text-[10px]">เครื่อง {sale.terminalId}</p>
      </div>
    </div>
  )
}

/**
 * "Print product photos" tick box. Off unless ticked for this receipt; hidden when no line has a photo.
 */
export function ReceiptImageToggle({ sale, checked, onChange }: { sale: SaleDetail; checked: boolean; onChange: (v: boolean) => void }) {
  if (!sale.lines.some((l) => l.imageUrl)) return null
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      พิมพ์รูปสินค้าในใบเสร็จ
    </label>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'text-[14px] font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

/**
 * Off-screen copy of the receipt under <body> that only appears when printing
 * (see #print-root in globals.css). Mount it while a receipt can be printed.
 */
export function ReceiptPrint({ sale, showImages = false }: { sale: SaleDetail; showImages?: boolean }) {
  const paper = getPrintPrefs().paper
  return createPortal(
    <div id="print-root" data-paper={paper}>
      <Receipt sale={sale} paper={paper} showImages={showImages} />
    </div>,
    document.body,
  )
}
