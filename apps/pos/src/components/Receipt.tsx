import { useApp } from '@/lib/app-context'
import { PAYMENT_LABEL, PRICE_TIER_LABEL, baht, dateTime, qty } from '@/lib/format'
import type { SaleDetail } from '@/lib/types'

/** 80mm-style receipt; wrapped in `.print-area` so window.print() prints only this. */
export function Receipt({ sale }: { sale: SaleDetail }) {
  const { data } = useApp()
  const s = data.settings
  return (
    <div className="print-area mx-auto w-full max-w-[320px] bg-white p-3 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <p className="text-[14px] font-bold">{s.shopName}</p>
        {s.address ? <p>{s.address}</p> : null}
        {s.phone ? <p>โทร {s.phone}</p> : null}
        {s.taxId ? <p>เลขประจำตัวผู้เสียภาษี {s.taxId}</p> : null}
        <p className="mt-1 font-semibold">{sale.status === 'voided' ? '*** บิลยกเลิก ***' : 'ใบเสร็จรับเงิน'}</p>
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1">
        <p>เลขที่ {sale.billNo}</p>
        <p>วันที่ {dateTime(sale.soldAt)}</p>
        <p>
          ราคา{PRICE_TIER_LABEL[sale.priceTier]} · {sale.locationName ?? ''}
        </p>
        {sale.customerName ? <p>ลูกค้า {sale.customerName}</p> : null}
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        {sale.lines.map((l) => (
          <div key={l.lineNo} className="py-0.5">
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
        {sale.paymentMethod === 'credit' ? <p className="mt-1">* ยอดนี้บันทึกเป็นลูกหนี้ (เงินเชื่อ)</p> : null}
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1 text-center">
        <p>{s.receiptFooter || 'ขอบคุณที่ใช้บริการ'}</p>
        <p className="text-[10px]">เครื่อง {sale.terminalId}</p>
      </div>
    </div>
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
