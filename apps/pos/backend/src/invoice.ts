import { guardTerm, type BatchOp } from './gate.js'
import { counterBumpSql, docNoSql } from './util.js'

/** `YYYYMM` in Bangkok time — tax invoice numbers run per month (IV202610-0001). */
export function bangkokMonth(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 7).replace('-', '')
}

export const TAX_INVOICE_GUARD = 'ออกใบเสร็จเต็มรูปไม่ได้ — บิลนี้ออกไปแล้ว ถูกยกเลิก หรือไม่มีลูกค้า'

/**
 * Ops that issue a full tax invoice for one sale inside an existing transaction:
 * take the next gap-free number and freeze the buyer's details on the sale.
 * Animal feed is VAT exempt, so no VAT is split (vat_rate / vat_amount stay NULL).
 * Aborts (guard) if the sale already has an invoice, is voided, or has no customer.
 */
export function taxInvoiceOps(saleId: string, issuedAt: string): BatchOp[] {
  return [
    { sql: counterBumpSql, params: ['IV', bangkokMonth(issuedAt)] },
    {
      sql: `UPDATE sales s
               SET for_accounting = true,
                   tax_invoice_no = ${docNoSql('$1', '$2')},
                   tax_invoice_at = $3::timestamptz,
                   vat_rate = NULL,
                   vat_amount = NULL,
                   buyer = (SELECT jsonb_build_object('name', c.name, 'code', c.code, 'taxId', c.tax_id,
                                                      'address', c.address, 'branchCode', c.branch_code, 'phone', c.phone)
                              FROM customers c WHERE c.id = s.customer_id),
                   total = s.total + ${guardTerm(`s.tax_invoice_no IS NULL AND s.status = 'completed' AND s.customer_id IS NOT NULL`)}
             WHERE s.id = $4::uuid
         RETURNING tax_invoice_no`,
      params: ['IV', bangkokMonth(issuedAt), issuedAt, saleId],
      guard: TAX_INVOICE_GUARD,
    },
  ]
}
