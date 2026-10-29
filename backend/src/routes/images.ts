import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { query, transaction } from '../db.js'
import { strOrNull, uuid } from '../util.js'

/**
 * Product photos. The browser shrinks the picture (≤ 500 KB JPEG) and PUTs the bytes here;
 * we store them under UPLOAD_DIR/products with an unguessable name and serve them publicly
 * from /api/files/products/<name>. The products row keeps the display URL and the file name.
 */
export const imageRoutes = new Hono<AppEnv>()

/** Served without a staff login (receipts and product cards load them as plain <img>). */
export const publicFileRoutes = new Hono<AppEnv>()

const MAX_BYTES = 500 * 1024
const NAME_RE = /^[a-f0-9]{32}\.jpg$/

function productDir(): string {
  return path.join(process.env.UPLOAD_DIR?.trim() || path.resolve('uploads'), 'products')
}

function publicUrl(c: Context, name: string): string {
  const base = process.env.PUBLIC_API_URL?.trim().replace(/\/$/, '') || new URL(c.req.url).origin
  return `${base}/api/files/products/${name}`
}

async function removeFile(name: string | null) {
  if (!name || !NAME_RE.test(name)) return
  // The product no longer points at it; a leftover file is harmless.
  await rm(path.join(productDir(), name), { force: true }).catch(() => undefined)
}

imageRoutes.put('/products/:id/image', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  if (bytes.length === 0) throw new HttpError(400, 'ไม่พบไฟล์รูป')
  if (bytes.length > MAX_BYTES) throw new HttpError(400, 'รูปต้องไม่เกิน 500 KB')
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new HttpError(400, 'รองรับเฉพาะไฟล์ JPEG')

  const current = await query(ctx, 'SELECT image_file_id FROM products WHERE id = $1::uuid', [id])
  if (!current[0]) throw new HttpError(404, 'ไม่พบสินค้า')

  const name = `${randomBytes(16).toString('hex')}.jpg`
  await mkdir(productDir(), { recursive: true })
  await writeFile(path.join(productDir(), name), bytes)
  const imageUrl = publicUrl(c, name)
  await transaction(ctx, [
    {
      sql: 'UPDATE products SET image_url = $2, image_file_id = $3, updated_at = now() WHERE id = $1::uuid',
      params: [id, imageUrl, name],
    },
  ])
  await removeFile(strOrNull(current[0], 'image_file_id'))
  return c.json({ imageUrl })
})

imageRoutes.delete('/products/:id/image', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const current = await query(ctx, 'SELECT image_file_id FROM products WHERE id = $1::uuid', [id])
  if (!current[0]) throw new HttpError(404, 'ไม่พบสินค้า')
  await transaction(ctx, [
    { sql: 'UPDATE products SET image_url = NULL, image_file_id = NULL, updated_at = now() WHERE id = $1::uuid', params: [id] },
  ])
  await removeFile(strOrNull(current[0], 'image_file_id'))
  return c.json({ imageUrl: null })
})

publicFileRoutes.get('/files/products/:name', async (c) => {
  const name = c.req.param('name')
  if (!NAME_RE.test(name)) throw new HttpError(404, 'ไม่พบไฟล์')
  let body: Buffer
  try {
    body = await readFile(path.join(productDir(), name))
  } catch {
    throw new HttpError(404, 'ไม่พบไฟล์')
  }
  return c.body(new Uint8Array(body), 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' })
})
