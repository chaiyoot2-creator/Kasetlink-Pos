import { createPortal } from 'react-dom'
import { useApp } from '@/lib/app-context'
import { bahtText } from '@/lib/bahttext'
import { PAYMENT_LABEL, baht, dateOnly, dateTime } from '@/lib/format'
import { getPrintPrefs } from '@/lib/print'
import type { PaymentReceipt as Receipt } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * ใบเสร็จรับเงิน for a debt payment: which credit bills were paid and how much.
 * Slip layout for roll printers, document layout for A4.
 */
export function PaymentReceiptView({ receipt, layout }: { receipt: Receipt; layout: 'slip' | 'doc' }) {
  const { data } = useApp()
  const s = data.settings
  const doc = layout === 'doc'

  return (
    <div className={cn('bg-white text-black', doc ? 'tax-invoice-page p-[10mm] text-[12px]' : 'mx-auto w-full p-1 font-mono text-[12px] leading-snug')}>
      <div className={doc ? 'flex items-start justify-between gap-4' : 'text-center'}>
        <div>
          <p className={cn('font-bold', doc ? 'text-[16px]' : 'text-[14px]')}>{s.shopName}</p>
          {s.address ? <p className="whitespace-pre-line">{s.address}</p> : null}
          {s.phone ? <p>โทร {s.phone}</p> : null}
          {s.taxId ? <p>เลขประจำตัวผู้เสียภาษี {s.taxId}</p> : null}
        </div>
        <div className={doc ? 'text-right' : 'mt-1'}>
          <p className={cn('font-bold', doc ? 'text-[18px]' : '')}>ใบเสร็จรับเงิน</p>
          <p>เลขที่ {receipt.receiptNo ?? '-'}</p>
          <p>วันที่ {doc ? dateOnly(receipt.paidAt) : dateTime(receipt.paidAt)}</p>
        </div>
      </div>

      <div className={cn('mt-2', doc ? 'border border-black p-3' : 'border-t border-dashed border-black pt-1')}>
        <p>
          ได้รับเงินจาก {receipt.customer.name} ({receipt.customer.code})
        </p>
        {doc && receipt.customer.address ? <p>ที่อยู่ {receipt.customer.address}</p> : null}
        {doc && receipt.customer.taxId ? <p>เลขประจำตัวผู้เสียภาษี {receipt.customer.taxId}</p> : null}
      </div>

      <div className={cn('mt-2', doc ? '' : 'border-t border-dashed border-black pt-1')}>
        <p className={doc ? 'mb-1 font-semibold' : ''}>เพื่อชำระค่าสินค้าตามเอกสาร</p>
        {doc ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black">
                <th className="py-1 text-left">เลขที่เอกสาร</th>
                <th className="py-1 text-left">วันที่ขาย</th>
                <th className="py-1 text-right">ยอดบิล</th>
                <th className="py-1 text-right">ชำระครั้งนี้</th>
              </tr>
            </thead>
            <tbody>
              {receipt.bills.map((b) => (
                <tr key={b.saleId}>
                  <td className="py-1">
                    {b.taxInvoiceNo ?? b.billNo}
                    {b.taxInvoiceNo ? <span className="block text-[10px]">บิล {b.billNo}</span> : null}
                  </td>
                  <td className="py-1">{dateOnly(b.soldAt)}</td>
                  <td className="py-1 text-right">{baht(b.total)}</td>
                  <td className="py-1 text-right">{baht(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          receipt.bills.map((b) => (
            <div key={b.saleId} className="flex justify-between">
              <span>{b.taxInvoiceNo ?? b.billNo}</span>
              <span>{baht(b.amount)}</span>
            </div>
          ))
        )}
      </div>

      <div className={cn('mt-2 border-t border-black pt-1', doc ? 'ml-auto w-[70mm]' : '')}>
        <div className={cn('flex justify-between font-bold', doc ? 'text-[14px]' : 'text-[14px]')}>
          <span>รับเงินทั้งสิ้น</span>
          <span>{baht(receipt.amount)}</span>
        </div>
        <p>ชำระโดย {PAYMENT_LABEL[receipt.method ?? ''] ?? receipt.method ?? '-'}</p>
      </div>
      <p className="mt-1 font-semibold">({bahtText(receipt.amount)})</p>
      {receipt.note ? <p>หมายเหตุ {receipt.note}</p> : null}

      {doc ? (
        <div className="mt-16 grid grid-cols-2 gap-16 text-center">
          <div>
            <p className="border-t border-dotted border-black pt-1">ผู้จ่ายเงิน</p>
          </div>
          <div>
            <p className="border-t border-dotted border-black pt-1">ผู้รับเงิน</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 border-t border-dashed border-black pt-1 text-center">ขอบคุณที่ชำระตรงเวลา</p>
      )}
    </div>
  )
}

/** Print portal; uses this device's paper setting (roll → slip, A4 → document). */
export function PaymentReceiptPrint({ receipt }: { receipt: Receipt }) {
  const paper = getPrintPrefs().paper
  const layout = paper === 'a4' ? 'doc' : 'slip'
  return createPortal(
    <div id="print-root" data-paper={layout === 'doc' ? 'doc' : paper}>
      <PaymentReceiptView receipt={receipt} layout={layout} />
    </div>,
    document.body,
  )
}
