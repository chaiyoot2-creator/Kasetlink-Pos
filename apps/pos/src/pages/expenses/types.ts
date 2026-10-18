export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'other'

export const PAY_LABEL: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  card: 'บัตร',
  other: 'อื่น ๆ',
}

export interface ExpenseCategory {
  id: string
  name: string
  /** Expenses in this category must name a vehicle. */
  isVehicle: boolean
  isActive: boolean
  expenseCount: number
}

export interface Expense {
  id: string
  /** `YYYY-MM-DD` (Christian era). */
  expenseDate: string
  categoryId: string
  categoryName: string
  amount: number
  description: string
  vendor: string | null
  paymentMethod: PaymentMethod
  vehicleId: string | null
  vehicleLabel: string | null
  note: string | null
  createdByName: string | null
  updatedByName: string | null
  createdAt: string
  updatedAt: string
}

export interface ExpenseVehicle {
  id: string
  label: string
  name: string
  isActive: boolean
}

export interface ExpenseList {
  items: Expense[]
  total: number
  truncated: boolean
}

export interface ExpenseSummary {
  year: number
  total: number
  months: { month: number; total: number; count: number }[]
  categories: { categoryId: string; name: string; total: number; count: number }[]
  vehicles: { vehicleId: string; label: string; name: string; total: number; count: number }[]
  grid: { month: number; categoryId: string; total: number }[]
}

export interface VehicleExpenses {
  year: number
  total: number
  items: Expense[]
  categories: { categoryId: string; name: string; total: number; count: number }[]
  months: { month: number; total: number }[]
}

export const MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const MONTH_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

/** Christian-era year → Thai label, e.g. 2026 → "2569". */
export function thaiYear(year: number): string {
  return String(year + 543)
}

/** `YYYY-MM` → first and last day. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return `${MONTH_LONG[m - 1]} ${thaiYear(y)}`
}
