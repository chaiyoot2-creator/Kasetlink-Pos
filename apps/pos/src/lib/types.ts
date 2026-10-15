// Response shapes of the app backend (`/api/*`). The backend owns its own copies.

export type PaymentMethod = 'cash' | 'promptpay' | 'credit'

export interface Settings {
  shopName: string
  address: string | null
  phone: string | null
  taxId: string | null
  promptpayId: string | null
  receiptFooter: string | null
  expiryAlertDays: number
  /** Names of price levels 1..5. */
  priceLevelNames: string[]
  vatRegistered: boolean
  vatRate: number
  /** Shop branch code for tax invoices (00000 = head office). */
  branchCode: string
}

export interface Location {
  id: string
  code: string
  name: string
  kind: 'store' | 'warehouse' | string
  isActive: boolean
}

export interface Terminal {
  id: string
  name: string
  locationId: string | null
}

export interface Bootstrap {
  me: { userId: string; orgId: string; orgRole: string | null }
  stage: 'dev' | 'prod'
  settings: Settings
  locations: Location[]
  terminals: Terminal[]
}

export interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  category: string | null
  unit: string
  /** Prices for levels 1..5 (0 = not set). */
  priceLevels: number[]
  avgCost: number
  reorderPoint: number
  trackExpiry: boolean
  isActive: boolean
  qtyTotal: number
  qtyHere: number
  brandId: string | null
  brandName: string | null
  /** Supplier of the product's brand. */
  supplierId: string | null
  supplierName: string | null
  imageUrl?: string | null
  /** Weight of one selling unit (sack), kg; null = from the name / feed kind. */
  weightKg?: number | null
}

export interface Brand {
  id: string
  name: string
  supplierId: string
  supplierName: string | null
  note: string | null
  isActive: boolean
  productCount: number
}

export interface Customer {
  id: string
  code: string
  name: string
  phone: string | null
  /** Price level 1..5. */
  priceLevel: number
  fixedPriceCount: number
  taxId: string | null
  address: string | null
  branchCode: string | null
  /** Bills of this customer default to a full tax invoice for the accounting office. */
  sendToAccounting: boolean
  /** Days of credit; each credit bill is due sold date + this. */
  creditTermDays: number
  creditLimit: number
  balance: number
  note: string | null
  isActive: boolean
}

export interface Supplier {
  id: string
  name: string
  phone: string | null
  note: string | null
  isActive: boolean
}

export interface SaleResult {
  id: string
  billNo: string
  total: number
  change: number | null
  taxInvoiceNo?: string | null
  duplicate: boolean
}

export interface SaleHeader {
  id: string
  billNo: string
  eventId: string
  terminalId: string
  locationId: string
  locationName: string | null
  customerId: string | null
  customerName: string | null
  priceLevel: number
  subtotal: number
  lineDiscountTotal: number
  billDiscount: number
  total: number
  costTotal: number
  profit: number
  paymentMethod: PaymentMethod
  cashReceived: number | null
  changeAmount: number | null
  status: 'completed' | 'voided'
  voidReason: string | null
  note: string | null
  soldAt: string
  createdBy: string | null
  forAccounting: boolean
  taxInvoiceNo: string | null
  taxInvoiceAt: string | null
  vatRate: number | null
  vatAmount: number | null
  buyer: Buyer | null
  accountingSentAt: string | null
  /** Credit bills: payment due date (YYYY-MM-DD). */
  dueDate: string | null
}

/** Buyer details frozen on the bill when its tax invoice was issued. */
export interface Buyer {
  name: string
  code: string | null
  taxId: string | null
  address: string | null
  branchCode: string | null
  phone: string | null
}

export interface SaleDetail extends SaleHeader {
  lines: {
    lineNo: number
    productId: string
    productName: string
    imageUrl?: string | null
    unit: string
    qty: number
    unitPrice: number
    lineDiscount: number
    lineTotal: number
    billDiscountShare: number
    netAmount: number
    unitCost: number
    costTotal: number
    priceSource: string | null
  }[]
  lots: { productId: string; lotNo: string; expiryDate: string | null; qty: number }[]
}

export interface PurchaseOrder {
  id: string
  poNo: string
  supplierId: string
  supplierName: string | null
  locationId: string
  locationName: string | null
  status: 'open' | 'partial' | 'received' | 'cancelled'
  orderDate: string | null
  expectedDate: string | null
  note: string | null
  total: number
  receivedPercent: number
  createdAt: string
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: {
    id: string
    lineNo: number
    productId: string
    productName: string
    sku: string
    unit: string
    trackExpiry: boolean
    qtyOrdered: number
    qtyReceived: number
    unitCost: number
  }[]
  receipts: { id: string; receiptNo: string; supplierInvoiceNo: string | null; total: number; receivedAt: string }[]
}

export interface ReceiptSummary {
  id: string
  receiptNo: string
  poNo: string | null
  supplierName: string | null
  locationName: string
  supplierInvoiceNo: string | null
  total: number
  receivedAt: string
}

export interface StockBalance {
  productId: string
  sku: string
  name: string
  unit: string
  category: string | null
  reorderPoint: number
  avgCost: number
  isActive: boolean
  qtyTotal: number
  stockValue: number
  byLocation: Record<string, number>
}

export interface Lot {
  id: string
  productId: string
  productName: string | null
  unit: string | null
  locationId: string
  locationName: string | null
  lotNo: string
  expiryDate: string | null
  qty: number
  lastUnitCost: number
  receivedAt: string
}

export interface Movement {
  id: string
  eventId: string
  terminalId: string
  zoneId: string
  occurredAt: string
  movementType:
    | 'sale'
    | 'sale_void'
    | 'receive'
    | 'transfer_out'
    | 'transfer_in'
    | 'adjust'
    | 'agency_lend'
    | 'agency_lend_void'
    | 'agency_return'
  productId: string
  productName: string
  unit: string
  locationName: string
  lotNo: string
  expiryDate: string | null
  qtyChange: number
  unitCost: number
  refType: string
  docNo: string | null
  reason: string | null
}

export interface StockDocument {
  id: string
  docNo: string
  docType: 'transfer' | 'adjustment'
  fromName: string | null
  toName: string | null
  reasonCode: string | null
  note: string | null
  itemCount: number
  occurredAt: string
  eventId: string
  terminalId: string
}

export interface Alerts {
  expiryAlertDays: number
  receivables: ReceivablesSummary
  lowStock: { productId: string; sku: string; name: string; unit: string; reorderPoint: number; qty: number }[]
  expired: Lot[]
  nearExpiry: Lot[]
}

export interface DailyReport {
  from: string
  to: string
  days: {
    day: string
    bills: number
    grossSales: number
    discounts: number
    revenue: number
    cogs: number
    profit: number
    marginPct: number
    cash: number
    promptpay: number
    credit: number
  }[]
  totals: {
    bills: number
    grossSales: number
    discounts: number
    revenue: number
    cogs: number
    profit: number
    marginPct: number
    cash: number
    promptpay: number
    credit: number
  }
}

export interface ProductReport {
  from: string
  to: string
  items: {
    productId: string
    productName: string
    sku: string
    category: string | null
    unit: string
    qty: number
    bills: number
    revenue: number
    cogs: number
    profit: number
    marginPct: number
  }[]
}

export interface BillReport {
  from: string
  to: string
  bills: {
    id: string
    billNo: string
    soldAt: string
    status: string
    paymentMethod: PaymentMethod
    customerName: string | null
    locationName: string
    items: number
    discounts: number
    revenue: number
    cogs: number
    profit: number
    marginPct: number
    voided: boolean
  }[]
  totals: { bills: number; voided: number; revenue: number; cogs: number; profit: number; marginPct: number }
}

export interface LedgerEntry {
  id: string
  entryType: 'sale' | 'payment' | 'sale_void'
  amount: number
  paymentMethod: string | null
  note: string | null
  billNo: string | null
  receiptNo: string | null
  createdAt: string
}

export interface CustomerPrice {
  productId: string
  productName: string
  sku: string
  unit: string
  brandName: string | null
  price: number
  /** Product price at the customer's level, for comparison. */
  levelPrice: number
  note: string | null
  updatedAt: string
}

/** A credit bill not yet fully paid (payments settle the oldest bills first). */
export interface OpenBill {
  saleId: string
  customerId: string
  customerName: string
  customerCode: string
  customerPhone: string | null
  billNo: string
  taxInvoiceNo: string | null
  soldAt: string
  dueDate: string
  total: number
  paid: number
  outstanding: number
  /** > 0 overdue by N days, 0 due today, < 0 due in N days. */
  daysOverdue: number
}

export interface ReceivablesSummary {
  outstanding: number
  overdue: number
  overdueCount: number
  dueSoon: number
  dueSoonCount: number
}

/** Receipt (ใบเสร็จรับเงิน) for one debt payment and the bills it settled. */
export interface PaymentReceipt {
  paymentId: string
  receiptNo: string | null
  amount: number
  method: string | null
  note: string | null
  paidAt: string
  customer: { id: string; name: string; code: string; address: string | null; taxId: string | null; phone: string | null }
  bills: { saleId: string; billNo: string; taxInvoiceNo: string | null; soldAt: string; dueDate: string | null; total: number; amount: number }[]
}

export interface Ledger {
  customer: Customer
  openBills: OpenBill[]
  summary: { outstanding: number; overdue: number; unappliedCredit: number }
  entries: LedgerEntry[]
}
