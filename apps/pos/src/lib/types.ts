// Response shapes of the app backend (`/api/*`). The backend owns its own copies.

export type PriceTier = 'retail' | 'wholesale' | 'member'
export type PaymentMethod = 'cash' | 'promptpay' | 'credit'

export interface Settings {
  shopName: string
  address: string | null
  phone: string | null
  taxId: string | null
  promptpayId: string | null
  receiptFooter: string | null
  expiryAlertDays: number
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
  priceRetail: number
  priceWholesale: number
  priceMember: number
  avgCost: number
  reorderPoint: number
  trackExpiry: boolean
  isActive: boolean
  qtyTotal: number
  qtyHere: number
}

export interface Customer {
  id: string
  code: string
  name: string
  phone: string | null
  customerType: PriceTier
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
  priceTier: PriceTier
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
}

export interface SaleDetail extends SaleHeader {
  lines: {
    lineNo: number
    productId: string
    productName: string
    unit: string
    qty: number
    unitPrice: number
    lineDiscount: number
    lineTotal: number
    billDiscountShare: number
    netAmount: number
    unitCost: number
    costTotal: number
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
  movementType: 'sale' | 'sale_void' | 'receive' | 'transfer_out' | 'transfer_in' | 'adjust'
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
  createdAt: string
}
