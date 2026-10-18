import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { query, transaction, type RequestCtx, type Row } from '../gate.js'
import { bool, dateOnly, json, num, round2, str, strOrNull, uuid } from '../util.js'

/** Business expenses (fuel, repairs, utilities, rent, wages …) with categories and vehicle links. */
export const expenseRoutes = new Hono<AppEnv>()

const DEFAULT_CATEGORIES: { name: string; isVehicle: boolean }[] = [
  { name: 'ค่าน้ำมันรถ', isVehicle: true },
  { name: 'ค่าซ่อมบำรุงรถ', isVehicle: true },
  { name: 'ค่าประกัน / พ.ร.บ. / ภาษีรถ', isVehicle: true },
  { name: 'ค่าไฟฟ้า', isVehicle: false },
  { name: 'ค่าน้ำประปา', isVehicle: false },
  { name: 'ค่าโทรศัพท์ / อินเทอร์เน็ต', isVehicle: false },
  { name: 'ค่าเช่า', isVehicle: false },
  { name: 'เงินเดือน / ค่าแรง', isVehicle: false },
  { name: 'วัสดุสิ้นเปลือง', isVehicle: false },
  { name: 'อื่น ๆ', isVehicle: false },
]

export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'other'] as const

/** Default categories on first use. */
async function ensureCategories(ctx: RequestCtx): Promise<void> {
  const [r] = await query(ctx, 'SELECT count(*) AS n FROM expense_categories')
  if (num(r ?? {}, 'n') > 0) return
  await transaction(ctx, [
    {
      sql: `INSERT INTO expense_categories (name, is_vehicle, sort_order)
            SELECT x.name, x.is_vehicle, x.sort_order
              FROM jsonb_to_recordset($1::jsonb) AS x(name text, is_vehicle boolean, sort_order int)
            ON CONFLICT (org_id, name) DO NOTHING`,
      params: [json(DEFAULT_CATEGORIES.map((c, i) => ({ name: c.name, is_vehicle: c.isVehicle, sort_order: i + 1 })))],
    },
  ])
}

function mapCategory(r: Row) {
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    isVehicle: bool(r, 'is_vehicle'),
    isActive: bool(r, 'is_active'),
    expenseCount: num(r, 'expense_count'),
  }
}

expenseRoutes.get('/expenses/categories', async (c) => {
  const ctx = c.get('ctx')
  await ensureCategories(ctx)
  const rows = await query(
    ctx,
    `SELECT c.*, (SELECT count(*) FROM expenses e WHERE e.category_id = c.id) AS expense_count
       FROM expense_categories c ORDER BY c.is_active DESC, c.sort_order, c.name`,
  )
  return c.json(rows.map(mapCategory))
})

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  isVehicle: z.boolean().default(false),
  isActive: z.boolean().default(true),
})

expenseRoutes.post('/expenses/categories', async (c) => {
  const b = categorySchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `INSERT INTO expense_categories (name, is_vehicle, is_active, sort_order)
            VALUES ($1, $2::boolean, $3::boolean, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM expense_categories)) RETURNING *`,
      params: [b.name, b.isVehicle, b.isActive],
    },
  ])
  return c.json(mapCategory(rows?.[0] ?? {}), 201)
})

expenseRoutes.put('/expenses/categories/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const b = categorySchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `UPDATE expense_categories SET name = $1, is_vehicle = $2::boolean, is_active = $3::boolean, updated_at = now()
            WHERE id = $4::uuid RETURNING *`,
      params: [b.name, b.isVehicle, b.isActive, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบหมวด')
  return c.json(mapCategory(rows[0]))
})

/** Only an unused category can be removed; a used one is switched off to keep history. */
expenseRoutes.delete('/expenses/categories/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const ctx = c.get('ctx')
  const [used] = await query(ctx, 'SELECT EXISTS (SELECT 1 FROM expenses WHERE category_id = $1::uuid) AS used', [id])
  if (bool(used ?? {}, 'used')) throw new HttpError(409, 'หมวดนี้มีรายการค่าใช้จ่ายแล้ว ลบไม่ได้ — ปิดใช้งานแทน', 'in_use')
  const [rows] = await transaction(ctx, [{ sql: 'DELETE FROM expense_categories WHERE id = $1::uuid RETURNING id', params: [id] }])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบหมวด')
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- expenses

export const EXPENSE_SELECT = `
  SELECT e.*, c.name AS category_name, c.is_vehicle, v.name AS vehicle_name, v.plate AS vehicle_plate
    FROM expenses e
    JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN vehicles v ON v.id = e.vehicle_id`

export function mapExpense(r: Row) {
  return {
    id: str(r, 'id'),
    expenseDate: dateOnly(r, 'expense_date') ?? '',
    categoryId: str(r, 'category_id'),
    categoryName: str(r, 'category_name'),
    amount: num(r, 'amount'),
    description: str(r, 'description'),
    vendor: strOrNull(r, 'vendor'),
    paymentMethod: str(r, 'payment_method'),
    vehicleId: strOrNull(r, 'vehicle_id'),
    vehicleLabel: strOrNull(r, 'vehicle_plate') ?? strOrNull(r, 'vehicle_name'),
    note: strOrNull(r, 'note'),
    createdByName: strOrNull(r, 'created_by_name'),
    updatedByName: strOrNull(r, 'updated_by_name'),
    createdAt: str(r, 'created_at'),
    updatedAt: str(r, 'updated_at'),
  }
}

/** Christian-era calendar date (a Buddhist-era year typed by mistake is refused). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => d >= '2000-01-01' && d <= '2100-12-31', 'ปีต้องเป็น ค.ศ. (เช่น 2026) ไม่ใช่ พ.ศ.')

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null)

const expenseSchema = z.object({
  clientRef: uuid,
  expenseDate: isoDate,
  categoryId: uuid,
  amount: z.number().positive().max(100_000_000),
  description: z.string().trim().min(1).max(200),
  vendor: optText(120),
  paymentMethod: z.enum(PAYMENT_METHODS).default('cash'),
  vehicleId: uuid.nullish().transform((v) => v ?? null),
  note: optText(500),
})

async function checkCategoryAndVehicle(ctx: RequestCtx, categoryId: string, vehicleId: string | null): Promise<void> {
  const [cat] = await query(ctx, 'SELECT is_vehicle, is_active FROM expense_categories WHERE id = $1::uuid', [categoryId])
  if (!cat) throw new HttpError(400, 'ไม่พบหมวดค่าใช้จ่าย')
  if (bool(cat, 'is_vehicle') && !vehicleId) throw new HttpError(400, 'หมวดนี้ต้องเลือกรถ', 'vehicle_required')
  if (vehicleId) {
    const [v] = await query(ctx, 'SELECT id FROM vehicles WHERE id = $1::uuid', [vehicleId])
    if (!v) throw new HttpError(400, 'ไม่พบรถที่เลือก')
  }
}

expenseRoutes.get('/expenses', async (c) => {
  const ctx = c.get('ctx')
  const from = isoDate.parse(c.req.query('from'))
  const to = isoDate.parse(c.req.query('to'))
  if (from > to) throw new HttpError(400, 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด')
  const categoryId = c.req.query('categoryId') || ''
  const vehicleId = c.req.query('vehicleId') || ''
  if (categoryId) uuid.parse(categoryId)
  if (vehicleId) uuid.parse(vehicleId)
  const q = (c.req.query('q') ?? '').trim().slice(0, 80)
  const rows = await query(
    ctx,
    `${EXPENSE_SELECT}
      WHERE e.expense_date BETWEEN $1::date AND $2::date
        AND ($3 = '' OR e.category_id = NULLIF($3, '')::uuid)
        AND ($4 = '' OR e.vehicle_id = NULLIF($4, '')::uuid)
        AND ($5 = '' OR e.description ILIKE '%' || $5 || '%' OR e.vendor ILIKE '%' || $5 || '%' OR e.note ILIKE '%' || $5 || '%')
      ORDER BY e.expense_date DESC, e.created_at DESC
      LIMIT 1000`,
    [from, to, categoryId, vehicleId, q],
  )
  const items = rows.map(mapExpense)
  return c.json({ items, total: round2(items.reduce((s, e) => s + e.amount, 0)), truncated: items.length === 1000 })
})

expenseRoutes.post('/expenses', async (c) => {
  const ctx = c.get('ctx')
  const me = c.get('appUser')
  const b = expenseSchema.parse(await c.req.json())
  await checkCategoryAndVehicle(ctx, b.categoryId, b.vehicleId)
  // A repeated save (double tap, retry after a timeout) carries the same clientRef and is ignored.
  await transaction(ctx, [
    {
      sql: `INSERT INTO expenses (client_ref, expense_date, category_id, amount, description, vendor, payment_method, vehicle_id, note, created_by, created_by_name)
            VALUES ($1::uuid, $2::date, $3::uuid, $4::numeric, $5, $6, $7, $8::uuid, $9, $10::uuid, $11)
            ON CONFLICT (org_id, client_ref) DO NOTHING`,
      params: [b.clientRef, b.expenseDate, b.categoryId, b.amount, b.description, b.vendor, b.paymentMethod, b.vehicleId, b.note, me?.id ?? null, me?.displayName ?? null],
    },
  ])
  const [row] = await query(ctx, `${EXPENSE_SELECT} WHERE e.client_ref = $1::uuid`, [b.clientRef])
  if (!row) throw new HttpError(500, 'บันทึกค่าใช้จ่ายไม่สำเร็จ')
  return c.json(mapExpense(row), 201)
})

expenseRoutes.put('/expenses/:id', async (c) => {
  const ctx = c.get('ctx')
  const me = c.get('appUser')
  const id = uuid.parse(c.req.param('id'))
  const b = expenseSchema.omit({ clientRef: true }).parse(await c.req.json())
  await checkCategoryAndVehicle(ctx, b.categoryId, b.vehicleId)
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE expenses SET expense_date = $1::date, category_id = $2::uuid, amount = $3::numeric, description = $4, vendor = $5,
              payment_method = $6, vehicle_id = $7::uuid, note = $8, updated_by_name = $9, updated_at = now()
            WHERE id = $10::uuid RETURNING id`,
      params: [b.expenseDate, b.categoryId, b.amount, b.description, b.vendor, b.paymentMethod, b.vehicleId, b.note, me?.displayName ?? null, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบรายการ')
  const [row] = await query(ctx, `${EXPENSE_SELECT} WHERE e.id = $1::uuid`, [id])
  return c.json(mapExpense(row ?? {}))
})

expenseRoutes.delete('/expenses/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const [rows] = await transaction(c.get('ctx'), [{ sql: 'DELETE FROM expenses WHERE id = $1::uuid RETURNING id', params: [id] }])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบรายการ')
  return c.json({ ok: true })
})

/** Year summary: totals per month, per category, per vehicle and a month × category grid. */
expenseRoutes.get('/expenses/summary', async (c) => {
  const ctx = c.get('ctx')
  const year = z.coerce.number().int().min(2000).max(2100).parse(c.req.query('year'))
  const params = [`${year}-01-01`, `${year}-12-31`]
  const RANGE = `e.expense_date BETWEEN $1::date AND $2::date`
  const [monthRows, catRows, vehRows, gridRows] = await Promise.all([
    query(ctx, `SELECT EXTRACT(MONTH FROM e.expense_date)::int AS m, SUM(e.amount) AS total, COUNT(*) AS n FROM expenses e WHERE ${RANGE} GROUP BY 1 ORDER BY 1`, params),
    query(
      ctx,
      `SELECT c.id, c.name, SUM(e.amount) AS total, COUNT(*) AS n
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id
        WHERE ${RANGE} GROUP BY c.id, c.name ORDER BY total DESC`,
      params,
    ),
    query(
      ctx,
      `SELECT v.id, v.name, v.plate, SUM(e.amount) AS total, COUNT(*) AS n
         FROM expenses e JOIN vehicles v ON v.id = e.vehicle_id
        WHERE ${RANGE} GROUP BY v.id, v.name, v.plate ORDER BY total DESC`,
      params,
    ),
    query(ctx, `SELECT EXTRACT(MONTH FROM e.expense_date)::int AS m, e.category_id, SUM(e.amount) AS total FROM expenses e WHERE ${RANGE} GROUP BY 1, 2`, params),
  ])
  const months = Array.from({ length: 12 }, (_, i) => {
    const r = monthRows.find((x) => num(x, 'm') === i + 1)
    return { month: i + 1, total: r ? round2(num(r, 'total')) : 0, count: r ? num(r, 'n') : 0 }
  })
  return c.json({
    year,
    total: round2(months.reduce((s, m) => s + m.total, 0)),
    months,
    categories: catRows.map((r) => ({ categoryId: str(r, 'id'), name: str(r, 'name'), total: round2(num(r, 'total')), count: num(r, 'n') })),
    vehicles: vehRows.map((r) => ({ vehicleId: str(r, 'id'), label: strOrNull(r, 'plate') ?? str(r, 'name'), name: str(r, 'name'), total: round2(num(r, 'total')), count: num(r, 'n') })),
    grid: gridRows.map((r) => ({ month: num(r, 'm'), categoryId: str(r, 'category_id'), total: round2(num(r, 'total')) })),
  })
})

/** Vehicles to pick from when entering an expense (staff without the delivery menu need it too). */
expenseRoutes.get('/expenses/vehicles', async (c) => {
  const rows = await query(c.get('ctx'), 'SELECT id, name, plate, is_active FROM vehicles ORDER BY is_active DESC, plate NULLS LAST, name')
  return c.json(rows.map((r) => ({ id: str(r, 'id'), label: strOrNull(r, 'plate') ?? str(r, 'name'), name: str(r, 'name'), isActive: bool(r, 'is_active') })))
})
