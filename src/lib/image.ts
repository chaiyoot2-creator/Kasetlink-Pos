import { API_BASE, apiFetch, getSession } from './api'

/** Upper limit agreed with the shop: product photos never exceed 500 KB. */
export const MAX_IMAGE_BYTES = 500 * 1024
/** Longest side in pixels — plenty for a product card and a receipt thumbnail. */
const MAX_SIDE = 800

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('เปิดไฟล์รูปไม่ได้ — ใช้ไฟล์ JPG, PNG หรือ WEBP'))
    }
    img.src = url
  })
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ย่อรูปไม่สำเร็จ'))), 'image/jpeg', quality)
  })
}

/**
 * Shrink a photo to at most 800 px on the longest side and re-encode as JPEG, lowering
 * quality (then size) until it fits in 500 KB. Transparent areas become white.
 */
export async function resizeImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ')
  const img = await loadImage(file)
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const g = canvas.getContext('2d')
    if (!g) throw new Error('เบราว์เซอร์นี้ย่อรูปไม่ได้')
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.75, 0.65, 0.55]) {
      const blob = await toJpeg(canvas, quality)
      if (blob.size <= MAX_IMAGE_BYTES) return blob
    }
    scale *= 0.75
  }
  throw new Error('รูปใหญ่เกินไป ย่อให้ต่ำกว่า 500 KB ไม่ได้')
}

/** Resize, upload to the shop server, and attach to the product. Returns the new image URL. */
export async function uploadProductImage(productId: string, file: File): Promise<string> {
  const blob = await resizeImage(file)
  const headers: Record<string, string> = { 'Content-Type': 'image/jpeg', Accept: 'application/json' }
  const session = getSession()
  if (session) headers['x-kl-session'] = session
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/products/${productId}/image`, { method: 'PUT', headers, body: await blob.arrayBuffer() })
  } catch {
    throw new Error('อัปโหลดรูปไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')
  }
  const body = (await res.json().catch(() => null)) as { imageUrl?: string; error?: string } | null
  if (!res.ok || !body?.imageUrl) throw new Error(body?.error ?? `อัปโหลดรูปไม่สำเร็จ (HTTP ${res.status})`)
  return body.imageUrl
}

export async function removeProductImage(productId: string): Promise<void> {
  await apiFetch(`/products/${productId}/image`, { method: 'DELETE' })
}
