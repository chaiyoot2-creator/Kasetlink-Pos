import { randomBytes } from 'node:crypto'
import { HttpError } from './errors.js'
import { query, transaction, type RequestCtx, type Row } from './gate.js'
import { bool, num, str, strOrNull } from './util.js'

/**
 * Backup to the shop's own Google Sheet. The sheet runs a small Apps Script web app
 * (see `appsScriptSource`) that accepts rows only when the shared secret matches.
 * Every run overwrites one tab per table, then appends a line to the log tab.
 */

export type Frequency = 'hourly' | 'every6h' | 'daily'

export interface BackupConfig {
  webAppUrl: string | null
  secret: string
  enabled: boolean
  frequency: Frequency
  runHour: number
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastMessage: string | null
  lastRows: number | null
  lastTrigger: string | null
}

/** Only Apps Script web-app URLs: the backend never posts shop data anywhere else. */
export const WEB_APP_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/

/** Tables copied to the sheet, in tab order. pos_events (raw device log) and secrets are left out. */
const TABLES: { table: string; sheet: string }[] = [
  { table: 'products', sheet: 'สินค้า' },
  { table: 'brands', sheet: 'แบรนด์' },
  { table: 'suppliers', sheet: 'ผู้จำหน่าย' },
  { table: 'customers', sheet: 'ลูกค้า' },
  { table: 'customer_prices', sheet: 'ราคาเฉพาะลูกค้า' },
  { table: 'quotations', sheet: 'ใบเสนอราคา' },
  { table: 'quotation_lines', sheet: 'รายการเสนอราคา' },
  { table: 'sales', sheet: 'บิลขาย' },
  { table: 'sale_lines', sheet: 'รายการขาย' },
  { table: 'ar_entries', sheet: 'ลูกหนี้-รายการ' },
  { table: 'ar_allocations', sheet: 'ลูกหนี้-ตัดชำระ' },
  { table: 'purchase_orders', sheet: 'ใบสั่งซื้อ' },
  { table: 'po_lines', sheet: 'รายการสั่งซื้อ' },
  { table: 'goods_receipts', sheet: 'ใบรับสินค้า' },
  { table: 'goods_receipt_lines', sheet: 'รายการรับสินค้า' },
  { table: 'stock_lots', sheet: 'สต็อกคงเหลือ' },
  { table: 'stock_movements', sheet: 'ความเคลื่อนไหวสต็อก' },
  { table: 'stock_documents', sheet: 'เอกสารสต็อก' },
  { table: 'agency_deliveries', sheet: 'ฟาร์มสุข-การส่ง' },
  { table: 'agency_delivery_lines', sheet: 'ฟาร์มสุข-รายการ' },
  { table: 'agency_payments', sheet: 'ฟาร์มสุข-รับเงิน' },
  { table: 'agency_loan_entries', sheet: 'ฟาร์มสุข-ยืมสต็อก' },
  { table: 'agency_stock_returns', sheet: 'ฟาร์มสุข-รับคืน' },
  { table: 'agency_customers', sheet: 'ฟาร์มสุข-ลูกค้า' },
  { table: 'agency_products', sheet: 'ฟาร์มสุข-สินค้า' },
  { table: 'agency_groups', sheet: 'ฟาร์มสุข-กลุ่ม' },
  { table: 'agency_routes', sheet: 'ฟาร์มสุข-ขนส่ง' },
  { table: 'delivery_orders', sheet: 'จัดส่ง-ออเดอร์' },
  { table: 'delivery_order_lines', sheet: 'จัดส่ง-รายการ' },
  { table: 'delivery_trips', sheet: 'จัดส่ง-เที่ยวรถ' },
  { table: 'delivery_trip_stops', sheet: 'จัดส่ง-จุดส่ง' },
  { table: 'vehicles', sheet: 'รถขนส่ง' },
  { table: 'expenses', sheet: 'ค่าใช้จ่าย' },
  { table: 'expense_categories', sheet: 'หมวดค่าใช้จ่าย' },
  { table: 'locations', sheet: 'โซน' },
  { table: 'terminals', sheet: 'เครื่อง' },
  { table: 'shop_settings', sheet: 'ตั้งค่าร้าน' },
]

const PAGE_ROWS = 2000
const SKIP_COLUMNS = new Set(['org_id'])
/** Google Sheets rejects cells longer than 50,000 characters. */
const MAX_CELL_CHARS = 49000

function newSecret(): string {
  return randomBytes(24).toString('hex')
}

function mapConfig(r: Row): BackupConfig {
  const freq = str(r, 'frequency')
  const status = str(r, 'last_status')
  return {
    webAppUrl: strOrNull(r, 'web_app_url'),
    secret: str(r, 'secret'),
    enabled: bool(r, 'enabled'),
    frequency: freq === 'hourly' || freq === 'every6h' ? freq : 'daily',
    runHour: num(r, 'run_hour'),
    lastRunAt: strOrNull(r, 'last_run_at'),
    lastStatus: status === 'ok' || status === 'error' ? status : null,
    lastMessage: strOrNull(r, 'last_message'),
    lastRows: r.last_rows === null || r.last_rows === undefined ? null : num(r, 'last_rows'),
    lastTrigger: strOrNull(r, 'last_trigger'),
  }
}

/** Current config; creates the row (with a fresh secret) on first use. */
export async function loadBackupConfig(ctx: RequestCtx): Promise<BackupConfig> {
  const rows = await query(ctx, 'SELECT * FROM backup_config LIMIT 1')
  if (rows[0]) return mapConfig(rows[0])
  const [created] = await transaction(ctx, [
    {
      sql: `INSERT INTO backup_config (secret) VALUES ($1)
            ON CONFLICT (org_id) DO UPDATE SET updated_at = backup_config.updated_at
            RETURNING *`,
      params: [newSecret()],
    },
  ])
  const row = created?.[0]
  if (!row) throw new HttpError(500, 'สร้างการตั้งค่าสำรองข้อมูลไม่สำเร็จ')
  return mapConfig(row)
}

export async function saveBackupConfig(
  ctx: RequestCtx,
  input: { webAppUrl: string | null; enabled: boolean; frequency: Frequency; runHour: number },
): Promise<BackupConfig> {
  await loadBackupConfig(ctx)
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE backup_config SET web_app_url = $1, enabled = $2::boolean, frequency = $3, run_hour = $4::smallint,
              updated_at = now()
            RETURNING *`,
      params: [input.webAppUrl, input.enabled, input.frequency, input.runHour],
    },
  ])
  const row = rows?.[0]
  if (!row) throw new HttpError(500, 'บันทึกการตั้งค่าไม่สำเร็จ')
  return mapConfig(row)
}

export async function rotateBackupSecret(ctx: RequestCtx): Promise<BackupConfig> {
  await loadBackupConfig(ctx)
  const [rows] = await transaction(ctx, [
    { sql: 'UPDATE backup_config SET secret = $1, updated_at = now() RETURNING *', params: [newSecret()] },
  ])
  const row = rows?.[0]
  if (!row) throw new HttpError(500, 'สร้างรหัสลับใหม่ไม่สำเร็จ')
  return mapConfig(row)
}

// ---------------------------------------------------------------- talking to the sheet

interface SheetReply {
  ok: boolean
  error?: string
  name?: string
  url?: string
}

async function postToSheet(url: string, payload: Record<string, unknown>): Promise<SheetReply> {
  if (!WEB_APP_URL_RE.test(url)) throw new Error('ลิงก์ Web App ไม่ถูกต้อง')
  let res: Response
  try {
    // Apps Script answers with a redirect to script.googleusercontent.com; fetch follows it.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new Error('เชื่อมต่อ Google Sheet ไม่ได้ (หมดเวลาหรือเครือข่ายขัดข้อง)')
  }
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    if (res.status === 404) throw new Error('ไม่พบเว็บแอปนี้ — ตรวจว่าคัดลอกลิงก์ Web app ครบ หรือ Deploy ใหม่แล้วใช้ลิงก์ใหม่')
    if (/accounts\.google\.com\/(ServiceLogin|v3\/signin)/i.test(text)) {
      throw new Error('Google ขอให้ล็อกอิน — ตอน Deploy ให้ตั้ง "ผู้ที่มีสิทธิ์เข้าถึง" เป็น "ทุกคน" (Anyone)')
    }
    if (/<html/i.test(text)) {
      throw new Error('Apps Script ตอบกลับเป็นหน้าเว็บ — ตรวจว่าวางโค้ดล่าสุด กดบันทึก แล้ว Deploy เวอร์ชันใหม่ (ตั้งสิทธิ์ "ทุกคน")')
    }
    throw new Error(`Google Sheet ตอบกลับไม่ถูกต้อง (HTTP ${res.status})`)
  }
  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
    throw new Error('Google Sheet ตอบกลับไม่ถูกต้อง — ตรวจว่าวางโค้ด Apps Script ล่าสุดแล้ว')
  }
  const reply = parsed as SheetReply
  if (!reply.ok) throw new Error(reply.error || 'Google Sheet ปฏิเสธการบันทึก')
  return reply
}

/** Check the URL + secret pair; returns the spreadsheet name. */
export async function pingSheet(config: BackupConfig): Promise<string> {
  if (!config.webAppUrl) throw new HttpError(400, 'ยังไม่ได้ใส่ลิงก์ Web App')
  try {
    const reply = await postToSheet(config.webAppUrl, { secret: config.secret, action: 'ping' })
    return reply.name ?? 'Google Sheet'
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : 'เชื่อมต่อไม่สำเร็จ', 'sheet_error')
  }
}

/** Numbers stay numbers; codes such as phones, barcodes and tax ids stay text. */
function cell(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') {
    if (/^-?(0|[1-9]\d{0,11})(\.\d+)?$/.test(v)) return Number(v)
    return v.length > MAX_CELL_CHARS ? v.slice(0, MAX_CELL_CHARS) : v
  }
  const json = JSON.stringify(v)
  return json.length > MAX_CELL_CHARS ? json.slice(0, MAX_CELL_CHARS) : json
}

async function tableColumns(ctx: RequestCtx): Promise<Map<string, string[]>> {
  const rows = await query(
    ctx,
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  )
  const map = new Map<string, string[]>()
  for (const r of rows) {
    const col = str(r, 'column_name')
    if (SKIP_COLUMNS.has(col)) continue
    const t = str(r, 'table_name')
    map.set(t, [...(map.get(t) ?? []), col])
  }
  return map
}

/** One full backup. Records the outcome on backup_config; throws nothing for sheet failures. */
export async function runBackup(ctx: RequestCtx, trigger: 'manual' | 'schedule'): Promise<{ ok: boolean; rows: number; message: string }> {
  const config = await loadBackupConfig(ctx)
  const startedAt = Date.now()
  let total = 0
  let ok = true
  let message: string
  try {
    if (!config.webAppUrl) throw new Error('ยังไม่ได้ใส่ลิงก์ Web App')
    const url = config.webAppUrl
    const columns = await tableColumns(ctx)
    const counts: string[] = []
    for (const { table, sheet } of TABLES) {
      const headers = columns.get(table)
      if (!headers) continue
      const select = headers.map((h) => `"${h}"`).join(', ')
      let offset = 0
      for (;;) {
        const rows = await query(ctx, `SELECT ${select} FROM ${table} ORDER BY 1 LIMIT ${PAGE_ROWS} OFFSET ${offset}`)
        await postToSheet(url, {
          secret: config.secret,
          action: 'write',
          sheet,
          headers,
          start: offset,
          rows: rows.map((r) => headers.map((h) => cell(r[h]))),
        })
        offset += rows.length
        if (rows.length < PAGE_ROWS) break
      }
      total += offset
      counts.push(`${sheet} ${offset}`)
    }
    const seconds = Math.round((Date.now() - startedAt) / 1000)
    message = `สำรอง ${total.toLocaleString('en-US')} แถว จาก ${counts.length} ตาราง ใช้เวลา ${seconds} วินาที`
    await postToSheet(url, {
      secret: config.secret,
      action: 'log',
      row: [bangkokStamp(new Date()), trigger === 'manual' ? 'กดสำรองเอง' : 'ตั้งเวลา', total, seconds, counts.join(', ')],
    })
  } catch (err) {
    ok = false
    message = err instanceof Error ? err.message : 'สำรองข้อมูลไม่สำเร็จ'
    console.error('[backup]', message)
  }
  await transaction(ctx, [
    {
      sql: `UPDATE backup_config SET last_run_at = now(), last_status = $1, last_message = $2, last_rows = $3::int,
              last_trigger = $4`,
      params: [ok ? 'ok' : 'error', message.slice(0, 500), total, trigger],
    },
  ])
  return { ok, rows: total, message }
}

/** `YYYY-MM-DD HH:mm:ss` in Bangkok time. */
function bangkokStamp(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 19)
}

/** Bangkok hour (UTC+7, no DST). */
export function bangkokHour(now: Date): number {
  return (now.getUTCHours() + 7) % 24
}

/** The cron fires every hour; decide whether this hour is a scheduled slot. */
export function isBackupDue(config: BackupConfig, now: Date): boolean {
  if (!config.enabled || !config.webAppUrl) return false
  if (config.lastRunAt && now.getTime() - Date.parse(config.lastRunAt) < 50 * 60 * 1000) return false
  const hour = bangkokHour(now)
  if (config.frequency === 'hourly') return true
  if (config.frequency === 'every6h') return hour % 6 === config.runHour % 6
  return hour === config.runHour
}

// ---------------------------------------------------------------- Apps Script source

/** Code the owner pastes into Extensions → Apps Script of their spreadsheet. */
export function appsScriptSource(secret: string): string {
  return `// KasetLink POS — รับข้อมูลสำรองเข้า Google Sheet นี้
// วางโค้ดนี้ทั้งหมดแทนที่โค้ดเดิม แล้ว Deploy เป็น Web app (Execute as: Me, Who has access: Anyone)
const SECRET = '${secret}';
const LOG_SHEET = 'บันทึกการสำรอง';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.secret !== SECRET) return reply_({ ok: false, error: 'รหัสลับไม่ตรงกัน — คัดลอกโค้ดล่าสุดจากหน้าตั้งค่า POS' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (req.action === 'ping') return reply_({ ok: true, name: ss.getName(), url: ss.getUrl() });
    if (req.action === 'write') {
      const sh = ss.getSheetByName(req.sheet) || ss.insertSheet(req.sheet);
      const width = req.headers.length;
      if (req.start === 0) {
        sh.clear();
        sh.getRange(1, 1, 1, width).setValues([req.headers]).setFontWeight('bold');
        sh.setFrozenRows(1);
      }
      if (req.rows.length > 0) {
        const range = sh.getRange(req.start + 2, 1, req.rows.length, width);
        // คอลัมน์ที่เป็นข้อความ (รหัส เบอร์โทร บาร์โค้ด) เก็บเป็นข้อความ ไม่ให้เลข 0 นำหน้าหาย
        for (let c = 0; c < width; c++) {
          if (req.rows.some(function (r) { return typeof r[c] === 'string' && r[c] !== ''; })) {
            sh.getRange(req.start + 2, c + 1, req.rows.length, 1).setNumberFormat('@');
          }
        }
        range.setValues(req.rows);
      }
      return reply_({ ok: true });
    }
    if (req.action === 'log') {
      const log = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET, 0);
      if (log.getLastRow() === 0) {
        log.appendRow(['เวลา', 'วิธี', 'จำนวนแถว', 'วินาที', 'รายละเอียด']);
        log.getRange(1, 1, 1, 5).setFontWeight('bold');
        log.setFrozenRows(1);
      }
      log.appendRow(req.row);
      return reply_({ ok: true });
    }
    return reply_({ ok: false, error: 'ไม่รู้จักคำสั่ง ' + req.action });
  } catch (err) {
    return reply_({ ok: false, error: String(err) });
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`
}
