import { ApiError } from '@fusebase/fusebase-gate-sdk'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { createFilesApi, query, transaction, type RequestCtx } from '../gate.js'
import { strOrNull, uuid } from '../util.js'

/**
 * Product photos. The browser shrinks the picture (≤ 500 KB JPEG), PUTs the bytes straight
 * to file storage with a presigned URL, then asks us to attach it to the product. The
 * products row keeps only the display URL and the bucket attachment id.
 */
export const imageRoutes = new Hono<AppEnv>()

const MAX_BYTES = 500 * 1024

function fileError(err: unknown, fallback: string): never {
  if (err instanceof HttpError) throw err
  if (err instanceof ApiError) {
    console.error('[images]', err.status, JSON.stringify(err.body ?? err.message))
    if (err.status === 401) throw new HttpError(401, 'เซสชันหมดอายุ กรุณารีเฟรชหน้า', 'auth_expired')
    if (err.status === 403) throw new HttpError(403, 'แอปยังไม่มีสิทธิ์อัปโหลดไฟล์ (files.write)', 'forbidden')
  } else {
    console.error('[images]', err)
  }
  throw new HttpError(502, fallback, 'file_error')
}

async function removeAttachment(ctx: RequestCtx, globalId: string | null) {
  if (!globalId) return
  try {
    await createFilesApi(ctx.token).removeBucketAttachment({ path: { orgId: ctx.orgId, globalId } })
  } catch (err) {
    // The product no longer points at it; a leftover file is harmless.
    console.warn('[images] could not remove old attachment', globalId, err instanceof Error ? err.message : err)
  }
}

const presignSchema = z.object({ size: z.number().int().positive().max(MAX_BYTES, 'รูปต้องไม่เกิน 500 KB') })

imageRoutes.post('/uploads/product-image', async (c) => {
  const ctx = c.get('ctx')
  const { size } = presignSchema.parse(await c.req.json())
  try {
    const res = await createFilesApi(ctx.token).createTempStoredFileUpload({
      path: { orgId: ctx.orgId },
      body: { name: `product-${Date.now()}.jpg`, type: 'image/jpeg', size, folder: 'apps' },
    })
    return c.json({ uploadUrl: res.uploadUrl, method: res.method, headers: res.headers, tempStoredFileName: res.tempStoredFileName })
  } catch (err) {
    fileError(err, 'ขอที่อัปโหลดรูปไม่สำเร็จ')
  }
})

const attachSchema = z.object({ tempStoredFileName: z.string().min(1).max(500) })

imageRoutes.put('/products/:id/image', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const { tempStoredFileName } = attachSchema.parse(await c.req.json())
  const current = await query(ctx, 'SELECT sku, image_file_id FROM products WHERE id = $1::uuid', [id])
  if (!current[0]) throw new HttpError(404, 'ไม่พบสินค้า')

  let attachment
  try {
    attachment = await createFilesApi(ctx.token).createBucketAttachment({
      path: { orgId: ctx.orgId },
      body: {
        tempStoredFileName,
        folder: 'apps',
        attributes: { source: 'kasetlink-pos', kind: 'product-image', productId: id, sku: strOrNull(current[0], 'sku') ?? '' },
        accessPrincipals: null,
      },
    })
  } catch (err) {
    fileError(err, 'บันทึกรูปไม่สำเร็จ')
  }

  await transaction(ctx, [
    {
      sql: 'UPDATE products SET image_url = $2, image_file_id = $3, updated_at = now() WHERE id = $1::uuid',
      params: [id, attachment.url, attachment.globalId],
    },
  ])
  await removeAttachment(ctx, strOrNull(current[0], 'image_file_id'))
  return c.json({ imageUrl: attachment.url })
})

imageRoutes.delete('/products/:id/image', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const current = await query(ctx, 'SELECT image_file_id FROM products WHERE id = $1::uuid', [id])
  if (!current[0]) throw new HttpError(404, 'ไม่พบสินค้า')
  await transaction(ctx, [
    { sql: 'UPDATE products SET image_url = NULL, image_file_id = NULL, updated_at = now() WHERE id = $1::uuid', params: [id] },
  ])
  await removeAttachment(ctx, strOrNull(current[0], 'image_file_id'))
  return c.json({ imageUrl: null })
})
