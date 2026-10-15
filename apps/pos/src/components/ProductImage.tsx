import { useState } from 'react'
import { Package } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Product photo with a neutral placeholder when there is none (or it fails to load). */
export function ProductImage({ url, alt, className }: { url: string | null | undefined; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!url || failed === url) {
    return (
      <div className={cn('flex items-center justify-center rounded-md bg-muted text-muted-foreground', className)} aria-hidden>
        <Package className="size-1/2 max-h-8 max-w-8" />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(url)}
      className={cn('rounded-md bg-white object-contain', className)}
    />
  )
}
