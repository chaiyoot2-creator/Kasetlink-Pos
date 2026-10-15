import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProductImage } from '@/components/ProductImage'
import { errorMessage } from '@/lib/api'
import { removeProductImage, resizeImage, uploadProductImage } from '@/lib/image'
import { cn } from '@/lib/utils'

/**
 * Photo picker in the product form. Existing products upload as soon as a file is chosen;
 * a new product keeps the (already resized) file until it has been created.
 */
export function ProductImageField({
  productId,
  name,
  initialUrl,
  pending,
  onPending,
  onChanged,
  className,
}: {
  productId: string | null
  name: string
  initialUrl: string | null
  pending: File | null
  onPending: (file: File | null) => void
  onChanged: () => void
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setUrl(initialUrl), [initialUrl, productId])
  useEffect(() => {
    if (!pending) {
      setPreview(null)
      return
    }
    const objectUrl = URL.createObjectURL(pending)
    setPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [pending])

  const choose = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      if (productId) {
        setUrl(await uploadProductImage(productId, file))
        toast.success('บันทึกรูปสินค้าแล้ว')
        onChanged()
      } else {
        const blob = await resizeImage(file)
        onPending(new File([blob], 'product.jpg', { type: 'image/jpeg' }))
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    if (!productId) {
      onPending(null)
      return
    }
    setBusy(true)
    try {
      await removeProductImage(productId)
      setUrl(null)
      toast.success('ลบรูปสินค้าแล้ว')
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const shown = productId ? url : preview
  return (
    <div className={cn('flex items-center gap-3 rounded-lg border p-3', className)}>
      <ProductImage url={shown} alt={name || 'รูปสินค้า'} className="size-20 shrink-0 border" />
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">รูปสินค้า</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="cursor-pointer" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {shown ? 'เปลี่ยนรูป' : 'เลือกรูป / ถ่ายรูป'}
          </Button>
          {shown ? (
            <Button type="button" size="sm" variant="ghost" className="cursor-pointer text-destructive" disabled={busy} onClick={() => void remove()}>
              <Trash2 /> ลบรูป
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">ระบบย่อรูปให้อัตโนมัติ (ไม่เกิน 800 px และไม่เกิน 500 KB)</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
    </div>
  )
}
