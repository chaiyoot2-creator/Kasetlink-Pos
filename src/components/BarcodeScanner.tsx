import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { CameraOff } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * Camera barcode scanner for phones / tablets (USB/Bluetooth scanners type into the search box instead).
 * Calls onDetected once per distinct code, then closes.
 */
export function BarcodeScanner({ open, onClose, onDetected }: { open: boolean; onClose: () => void; onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Callbacks via refs so a parent re-render does not restart the camera.
  const onCloseRef = useRef(onClose)
  const onDetectedRef = useRef(onDetected)
  onCloseRef.current = onClose
  onDetectedRef.current = onDetected

  useEffect(() => {
    if (!open) return
    let controls: IScannerControls | null = null
    let cancelled = false
    setError(null)
    const reader = new BrowserMultiFormatReader()

    // The video element mounts with the dialog; wait one frame for it.
    const start = window.setTimeout(() => {
      if (!videoRef.current) return
      reader
        .decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, videoRef.current, (result) => {
          if (result && !cancelled) {
            cancelled = true
            controls?.stop()
            if (navigator.vibrate) navigator.vibrate(60)
            onDetectedRef.current(result.getText())
            onCloseRef.current()
          }
        })
        .then((c) => {
          controls = c
          if (cancelled) c.stop()
        })
        .catch(() => setError('เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้อง หรือพิมพ์รหัสสินค้าแทน'))
    }, 50)

    return () => {
      cancelled = true
      window.clearTimeout(start)
      controls?.stop()
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>สแกนบาร์โค้ด</DialogTitle>
          <DialogDescription>หันกล้องไปที่บาร์โค้ดบนถุงหรือกล่องสินค้า</DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <CameraOff className="size-8" />
            {error}
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
