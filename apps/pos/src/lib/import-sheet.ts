import { readSheet } from 'read-excel-file/browser'
import writeXlsxFile from 'write-excel-file/browser'

/**
 * Reading master data exported from the old POS: .xlsx or .csv into a grid of cells,
 * guessing which column holds which field from its header (Thai or English), and
 * turning rows into the shapes `/import/*` expects.
 */

export type Cell = string | number | boolean | Date | null
export type Grid = Cell[][]

export type FieldType = 'text' | 'number' | 'bool' | 'date'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  hint?: string
  /** Lower-case header words that identify this column; the first one is the template header. */
  aliases: string[]
  example: Cell
}

export const SUPPLIER_FIELDS: FieldDef[] = [
  { key: 'name', label: 'ชื่อผู้จำหน่าย', type: 'text', required: true, aliases: ['ชื่อผู้จำหน่าย', 'ผู้จำหน่าย', 'ชื่อซัพพลายเออร์', 'ซัพพลายเออร์', 'ชื่อบริษัท', 'บริษัท', 'ชื่อ', 'supplier', 'supplier name', 'vendor', 'name'], example: 'บริษัท ตัวอย่างอาหารสัตว์ จำกัด' },
  { key: 'phone', label: 'เบอร์โทร', type: 'text', aliases: ['เบอร์โทร', 'โทรศัพท์', 'เบอร์', 'โทร', 'phone', 'tel', 'mobile'], example: '053-123456' },
  { key: 'note', label: 'หมายเหตุ', type: 'text', aliases: ['หมายเหตุ', 'ที่อยู่', 'ผู้ติดต่อ', 'note', 'remark', 'address'], example: 'เซลล์: คุณสมชาย' },
]

export const PRODUCT_FIELDS: FieldDef[] = [
  { key: 'sku', label: 'รหัสสินค้า', type: 'text', hint: 'ว่างได้ ระบบสร้าง P00001… ให้', aliases: ['รหัสสินค้า', 'รหัส', 'sku', 'code', 'product code', 'item code'], example: '' },
  { key: 'barcode', label: 'บาร์โค้ด', type: 'text', hint: 'ว่างได้ ระบบสร้าง EAN-13 ให้', aliases: ['บาร์โค้ด', 'barcode', 'bar code', 'ean'], example: '' },
  { key: 'name', label: 'ชื่อสินค้า', type: 'text', required: true, aliases: ['ชื่อสินค้า', 'สินค้า', 'ชื่อ', 'รายการ', 'product', 'product name', 'item', 'name', 'description'], example: 'อาหารหมูขุน สูตร 1 (30 กก.)' },
  { key: 'unit', label: 'หน่วย', type: 'text', aliases: ['หน่วย', 'หน่วยนับ', 'unit', 'uom'], example: 'กระสอบ' },
  { key: 'category', label: 'หมวดหมู่', type: 'text', aliases: ['หมวดหมู่', 'หมวด', 'กลุ่มสินค้า', 'ประเภท', 'category', 'group', 'type'], example: 'อาหารหมู' },
  { key: 'brand', label: 'แบรนด์', type: 'text', aliases: ['แบรนด์', 'ยี่ห้อ', 'brand'], example: 'ตัวอย่างฟีด' },
  { key: 'supplier', label: 'ผู้จำหน่าย', type: 'text', hint: 'ใช้สร้างแบรนด์ใหม่', aliases: ['ผู้จำหน่าย', 'ซัพพลายเออร์', 'บริษัท', 'supplier', 'vendor'], example: 'บริษัท ตัวอย่างอาหารสัตว์ จำกัด' },
  { key: 'price1', label: 'ราคาระดับ 1', type: 'number', aliases: ['ราคาระดับ 1', 'ราคา 1', 'ราคาขาย', 'ราคาปลีก', 'ราคา', 'price', 'price 1', 'retail price', 'sell price'], example: 520 },
  { key: 'price2', label: 'ราคาระดับ 2', type: 'number', aliases: ['ราคาระดับ 2', 'ราคา 2', 'ราคาส่ง', 'price 2', 'wholesale price'], example: 510 },
  { key: 'price3', label: 'ราคาระดับ 3', type: 'number', aliases: ['ราคาระดับ 3', 'ราคา 3', 'price 3'], example: 500 },
  { key: 'price4', label: 'ราคาระดับ 4', type: 'number', aliases: ['ราคาระดับ 4', 'ราคา 4', 'price 4'], example: '' },
  { key: 'price5', label: 'ราคาระดับ 5', type: 'number', aliases: ['ราคาระดับ 5', 'ราคา 5', 'price 5'], example: '' },
  { key: 'weightKg', label: 'น้ำหนักต่อหน่วย (กก.)', type: 'number', aliases: ['น้ำหนักต่อหน่วย (กก.)', 'น้ำหนัก', 'นน', 'weight', 'kg'], example: 30 },
  { key: 'reorderPoint', label: 'จุดสั่งซื้อ', type: 'number', aliases: ['จุดสั่งซื้อ', 'จุดสั่งซื้อขั้นต่ำ', 'สต็อกขั้นต่ำ', 'ขั้นต่ำ', 'reorder point', 'min stock', 'minimum'], example: 10 },
  { key: 'trackExpiry', label: 'ติดตามวันหมดอายุ', type: 'bool', hint: 'ใช่ / ไม่', aliases: ['ติดตามวันหมดอายุ', 'มีวันหมดอายุ', 'track expiry'], example: 'ใช่' },
  { key: 'openingQty', label: 'จำนวนคงเหลือ', type: 'number', hint: 'ยอดยกมา', aliases: ['จำนวนคงเหลือ', 'คงเหลือ', 'ยอดคงเหลือ', 'สต็อก', 'สต๊อก', 'จำนวน', 'qty', 'quantity', 'stock', 'on hand', 'balance'], example: 25 },
  { key: 'unitCost', label: 'ต้นทุนต่อหน่วย', type: 'number', aliases: ['ต้นทุนต่อหน่วย', 'ต้นทุน', 'ราคาทุน', 'ทุน', 'cost', 'unit cost', 'cost price'], example: 455 },
  { key: 'lotNo', label: 'เลขล็อต', type: 'text', aliases: ['เลขล็อต', 'ล็อต', 'lot', 'lot no', 'batch'], example: '' },
  { key: 'expiryDate', label: 'วันหมดอายุ', type: 'date', hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.)', aliases: ['วันหมดอายุ', 'หมดอายุ', 'exp', 'expiry', 'expiry date', 'exp date'], example: '31/03/2570' },
]

// ---------------------------------------------------------------- reading files

/** Old Thai software often writes CSV in Windows-874 (TIS-620) instead of UTF-8. */
function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-874').decode(buf)
  }
}

function parseCsv(textIn: string): Grid {
  const firstLine = textIn.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',')
  const rows: Grid = []
  let row: Cell[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i]
    if (quoted) {
      if (ch === '"' && textIn[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && textIn[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export class UnsupportedFileError extends Error {}

export async function readGrid(file: File): Promise<Grid> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(decodeText(await file.arrayBuffer()))
  if (name.endsWith('.xlsx')) {
    const data = await readSheet(file)
    return data.map((r) => r.map((v) => (v === null || v === undefined ? null : (v as Cell))))
  }
  if (name.endsWith('.xls')) {
    throw new UnsupportedFileError('ไฟล์ .xls (Excel รุ่นเก่า) ยังอ่านไม่ได้ — เปิดใน Excel แล้ว "บันทึกเป็น" .xlsx หรือ .csv ก่อน')
  }
  throw new UnsupportedFileError('รองรับเฉพาะไฟล์ .xlsx และ .csv')
}

const isBlank = (v: Cell) => v === null || (typeof v === 'string' && v.trim() === '')

/** Header = first row with at least two filled cells (old exports often start with a title line). */
export function splitHeader(grid: Grid): { headers: string[]; rows: Grid } {
  const idx = grid.findIndex((r) => r.filter((v) => !isBlank(v)).length >= 2)
  if (idx < 0) return { headers: [], rows: [] }
  const headers = (grid[idx] ?? []).map((v) => (isBlank(v) ? '' : String(v).trim()))
  const rows = grid.slice(idx + 1).filter((r) => r.some((v) => !isBlank(v)))
  return { headers, rows }
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_.:*()-]+/g, ' ').trim()

/**
 * Column index per field key (-1 = not mapped). Each (field, column) pair is scored by
 * its best alias — exact matches first, then the longest alias contained in the header —
 * and pairs are assigned best-first, so "ราคาทุน/หน่วย" goes to cost, not to price.
 */
export function autoMap(fields: FieldDef[], headers: string[]): Record<string, number> {
  const h = headers.map(norm)
  const pairs: { field: string; col: number; score: number }[] = []
  for (const f of fields) {
    for (const [col, header] of h.entries()) {
      if (header === '') continue
      let score = 0
      for (const a of f.aliases.map(norm)) {
        if (header === a) score = Math.max(score, 1000 + a.length)
        else if (a.length >= 3 && header.includes(a)) score = Math.max(score, a.length)
      }
      if (score > 0) pairs.push({ field: f.key, col, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score)
  const map: Record<string, number> = {}
  const usedCols = new Set<number>()
  for (const p of pairs) {
    if (map[p.field] !== undefined || usedCols.has(p.col)) continue
    map[p.field] = p.col
    usedCols.add(p.col)
  }
  for (const f of fields) map[f.key] ??= -1
  return map
}

// ---------------------------------------------------------------- cell conversion

function toText(v: Cell): string | null {
  if (isBlank(v)) return null
  if (typeof v === 'number') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

function toNumber(v: Cell): number | null | undefined {
  if (isBlank(v)) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const s = String(v).replace(/[,\s฿]|บาท/g, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function toBool(v: Cell): boolean | null | undefined {
  if (isBlank(v)) return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['ใช่', 'มี', 'yes', 'y', 'true', '1', '✓', '/', 'x'].includes(s)) return true
  if (['ไม่', 'ไม่ใช่', 'ไม่มี', 'no', 'n', 'false', '0', '-'].includes(s)) return false
  return undefined
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Dates as `YYYY-MM-DD`; Thai Buddhist-era years (> 2400) are converted. */
function toDate(v: Cell): string | null | undefined {
  if (isBlank(v)) return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined
    const y = v.getUTCFullYear()
    return `${y > 2400 ? y - 543 : y}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`
  }
  const s = String(v).trim()
  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])]
  else return undefined
  if (y < 100) y += y > 50 ? 2500 : 2000
  if (y > 2400) y -= 543
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined
  return `${y}-${pad2(m)}-${pad2(d)}`
}

export interface ConvertedRow {
  values: Record<string, string | number | boolean | null>
  /** Cells that could not be read, e.g. "ราคาระดับ 1: "abc" ไม่ใช่ตัวเลข". */
  problems: string[]
}

export function convertRows(fields: FieldDef[], mapping: Record<string, number>, rows: Grid): ConvertedRow[] {
  return rows.map((r) => {
    const values: ConvertedRow['values'] = {}
    const problems: string[] = []
    for (const f of fields) {
      const idx = mapping[f.key] ?? -1
      const cell = idx >= 0 ? (r[idx] ?? null) : null
      let out: string | number | boolean | null | undefined
      if (f.type === 'number') out = toNumber(cell)
      else if (f.type === 'bool') out = toBool(cell)
      else if (f.type === 'date') out = toDate(cell)
      else out = toText(cell)
      if (out === undefined) {
        problems.push(`${f.label}: อ่านค่า "${String(cell)}" ไม่ได้`)
        out = null
      }
      values[f.key] = out
    }
    return { values, problems }
  })
}

// ---------------------------------------------------------------- template

export async function downloadTemplate(fields: FieldDef[], fileName: string): Promise<void> {
  const header = fields.map((f) => ({ value: f.aliases[0] ?? f.label, fontWeight: 'bold' as const }))
  const example = fields.map((f) => ({ value: f.example === '' ? undefined : (f.example ?? undefined) }))
  await writeXlsxFile([header, example], { columns: fields.map(() => ({ width: 22 })), stickyRowsCount: 1 }).toFile(fileName)
}
