import { z } from 'zod'
import type { Row } from './db.js'

// ---- Row readers (Gate returns NUMERIC as string, DATE/TIMESTAMPTZ as string) ----

export function str(row: Row, key: string): string {
  const v = row[key]
  return v === null || v === undefined ? '' : String(v)
}

export function strOrNull(row: Row, key: string): string | null {
  const v = row[key]
  return v === null || v === undefined ? null : String(v)
}

export function num(row: Row, key: string): number {
  const v = row[key]
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function bool(row: Row, key: string): boolean {
  const v = row[key]
  return v === true || v === 1 || v === 't' || v === 'true'
}

/** DATE columns as `YYYY-MM-DD` (or null). */
export function dateOnly(row: Row, key: string): string | null {
  const v = row[key]
  if (v === null || v === undefined || v === '') return null
  return String(v).slice(0, 10)
}

// ---- Money / quantity arithmetic in integer units to avoid float drift ----

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000
}

// ---- Shared request schemas ----

export const uuid = z.string().uuid()

/** Fields every stock- or bill-affecting command carries (event sourcing for AI Vision). */
export const eventEnvelope = {
  eventId: uuid,
  terminalId: z.string().min(1).max(80),
  occurredAt: z.string().datetime({ offset: true }),
}

export const qty = z.number().positive().max(1_000_000)
export const money = z.number().min(0).max(100_000_000)
export const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v ?? null)

/** `YYYYMMDD` period in Bangkok time for running document numbers. */
export function bangkokPeriod(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

export function json(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Running document numbers (S20261014-0001). Two statements in the same transaction:
 * `counterBumpSql` takes the row lock and increments; `docNoSql` reads it back inside
 * the document INSERT. Gate's `execute` rejects WITH-prefixed statements, so no CTE.
 */
export const counterBumpSql = `INSERT INTO doc_counters (doc_type, period, last_no) VALUES ($1::text, $2::text, 1)
  ON CONFLICT (org_id, doc_type, period) DO UPDATE SET last_no = doc_counters.last_no + 1`

export function docNoSql(prefixParam: string, periodParam: string): string {
  return `(SELECT ${prefixParam}::text || ${periodParam}::text || '-' || lpad(last_no::text, 4, '0')
             FROM doc_counters WHERE doc_type = ${prefixParam}::text AND period = ${periodParam}::text)`
}
