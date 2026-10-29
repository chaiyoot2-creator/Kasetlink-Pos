const bahtFmt = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qtyFmt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 })
const pctFmt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 })

export function baht(n: number): string {
  return bahtFmt.format(n)
}

export function qty(n: number): string {
  return qtyFmt.format(n)
}

export function pct(n: number): string {
  return `${pctFmt.format(n)}%`
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

const dateTimeFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const dateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' })

export function dateTime(iso: string): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '-'
}

/** `YYYY-MM-DD` (date-only) or ISO timestamp → Thai short date. */
export function dateOnly(value: string | null): string {
  if (!value) return '-'
  const d = value.length === 10 ? new Date(`${value}T00:00:00+07:00`) : new Date(value)
  return dateFmt.format(d)
}

/** Today in Bangkok as `YYYY-MM-DD`. */
export function todayISO(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${todayISO()}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

/** Parse a user-typed number ("1,250.50" → 1250.5). Empty / invalid → NaN. */
export function parseNum(text: string): number {
  const cleaned = text.replace(/,/g, '').trim()
  if (cleaned === '') return Number.NaN
  return Number(cleaned)
}

export const PAYMENT_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  promptpay: 'พร้อมเพย์',
  credit: 'เงินเชื่อ',
  transfer: 'โอนเงิน',
}

export const MOVEMENT_LABEL: Record<string, string> = {
  sale: 'ขาย',
  sale_void: 'ยกเลิกบิล (คืนสต็อก)',
  receive: 'รับเข้า',
  transfer_out: 'โอนออก',
  transfer_in: 'โอนเข้า',
  adjust: 'ปรับยอด',
  agency_lend: 'ส่งลูกค้าฟาร์มสุขแทน (ยืม)',
  agency_lend_void: 'ยกเลิกส่งฟาร์มสุข (คืนสต็อก)',
  agency_return: 'ฟาร์มสุขส่งคืน',
}

export const ADJUST_REASON_LABEL: Record<string, string> = {
  count: 'ตรวจนับสต็อก',
  damaged: 'สินค้าเสียหาย',
  expired: 'สินค้าหมดอายุ',
  lost: 'สูญหาย',
  opening: 'ยอดยกมา',
  internal_use: 'เบิกใช้ภายใน',
  other: 'อื่น ๆ',
}

export const PO_STATUS_LABEL: Record<string, string> = {
  open: 'รอรับ',
  partial: 'รับบางส่วน',
  received: 'รับครบ',
  cancelled: 'ยกเลิก',
}
