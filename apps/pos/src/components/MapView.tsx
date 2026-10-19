import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPinOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch, errorMessage } from '@/lib/api'
import { decodePolyline, loadGoogleMaps, MAPS_AUTH_MESSAGE, onMapsAuthFailure, type LatLng } from '@/lib/maps'
import { cn } from '@/lib/utils'

export interface MapPoint {
  id: string
  lat: number
  lng: number
  title: string
  /** Short text inside the pin, e.g. stop number. */
  label?: string
  color: string
  /** Extra lines shown in the info window under the title (phone, address …). */
  info?: string[]
}

export interface MapLine {
  id: string
  color: string
  /** Encoded Google polyline, or explicit points (straight segments). */
  polyline?: string | null
  path?: LatLng[]
}

interface Props {
  points: MapPoint[]
  lines?: MapLine[]
  /** Draggable pin being edited. */
  editing?: LatLng | null
  onEditingMove?: (p: LatLng) => void
  /** Click on the map (e.g. to drop a new pin). */
  onMapClick?: (p: LatLng) => void
  onPointClick?: (id: string) => void
  /** Change this to re-fit the view to the points. */
  fitKey?: string
  className?: string
}

const DEFAULT_CENTER: LatLng = { lat: 19.9105, lng: 99.8406 }

function pinSvg(color: string, label: string): string {
  const text = label ? `<text x="14" y="18" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="700" fill="#fff">${label}</text>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38"><path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 38 14 38s14-13.7 14-24.1C28 6.2 21.7 0 14 0z" fill="${color}" stroke="#fff" stroke-width="2"/>${text}</svg>`
}

function pinIcon(color: string, label: string): google.maps.Icon {
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pinSvg(color, label))}`,
    anchor: new google.maps.Point(14, 38),
    scaledSize: new google.maps.Size(28, 38),
  }
}

/** Info window body built with textContent (names come from the database). */
function infoContent(p: MapPoint): HTMLElement {
  const box = document.createElement('div')
  box.style.cssText = 'font-family:"IBM Plex Sans Thai",sans-serif;font-size:13px;line-height:1.45;max-width:240px;color:#111'
  const title = document.createElement('div')
  title.style.fontWeight = '600'
  title.textContent = p.title
  box.appendChild(title)
  for (const line of p.info ?? []) {
    if (!line) continue
    const row = document.createElement('div')
    row.style.color = '#555'
    row.textContent = line
    box.appendChild(row)
  }
  const nav = document.createElement('a')
  nav.href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`
  nav.target = '_blank'
  nav.rel = 'noreferrer'
  nav.textContent = 'นำทางด้วย Google Maps'
  nav.style.cssText = 'display:inline-block;margin-top:4px;color:#1a73e8'
  box.appendChild(nav)
  return box
}

type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }

/** Map with pins, info windows and route lines on Google Maps. */
export function MapView(props: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    void loadGoogleMaps().then((r) => {
      if (alive) setState(r.ok ? { status: 'ready' } : { status: 'error', message: r.message })
    })
    const off = onMapsAuthFailure(() => {
      if (alive) setState({ status: 'error', message: MAPS_AUTH_MESSAGE })
    })
    return () => {
      alive = false
      off()
    }
  }, [attempt])

  if (state.status === 'loading') {
    return (
      <div className={cn('flex items-center justify-center rounded-lg border bg-muted', props.className)}>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (state.status === 'error') return <MapError message={state.message} className={props.className} onRetry={() => setAttempt((n) => n + 1)} />
  return <GoogleMapView {...props} />
}

interface MapsStatus {
  browserKey: 'set' | 'missing'
  serverKey: 'ok' | 'missing' | 'denied' | 'error'
  serverDetail: string | null
}

const SERVER_KEY_LABEL: Record<MapsStatus['serverKey'], string> = {
  ok: 'ใช้งานได้',
  missing: 'ยังไม่ได้ตั้งค่า (ระยะทางจะเป็นค่าประมาณ)',
  denied: 'ถูกปฏิเสธ — ตรวจว่าเปิดใช้ Routes API และข้อจำกัดของคีย์',
  error: 'เชื่อมต่อไม่สำเร็จ',
}

function MapError({ message, className, onRetry }: { message: string; className?: string; onRetry: () => void }) {
  const [status, setStatus] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    try {
      const s = await apiFetch<MapsStatus>('/delivery/maps-status')
      setStatus(
        `คีย์เบราว์เซอร์: ${s.browserKey === 'set' ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'} · คีย์เซิร์ฟเวอร์ (Routes API): ${SERVER_KEY_LABEL[s.serverKey]}${s.serverDetail ? ` (${s.serverDetail})` : ''}`,
      )
    } catch (err) {
      setStatus(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border bg-muted p-6 text-center text-sm', className)}>
      <MapPinOff className="size-6 text-muted-foreground" />
      <p className="max-w-md font-medium">แสดงแผนที่ไม่ได้</p>
      <p className="max-w-md text-muted-foreground">{message}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" className="cursor-pointer" onClick={onRetry}>
          <RefreshCw /> ลองใหม่
        </Button>
        <Button variant="ghost" size="sm" className="cursor-pointer" disabled={checking} onClick={() => void check()}>
          {checking ? <Loader2 className="animate-spin" /> : null} ตรวจสอบการตั้งค่า
        </Button>
      </div>
      {status ? <p className="max-w-md text-xs break-words text-muted-foreground">{status}</p> : null}
    </div>
  )
}

function GoogleMapView({ points, lines = [], editing, onEditingMove, onMapClick, onPointClick, fitKey, className }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map | null>(null)
  const info = useRef<google.maps.InfoWindow | null>(null)
  const drawn = useRef<{ setMap: (m: google.maps.Map | null) => void }[]>([])
  const handlers = useRef({ onEditingMove, onMapClick, onPointClick })
  handlers.current = { onEditingMove, onMapClick, onPointClick }

  useEffect(() => {
    if (!el.current || map.current) return
    const m = new google.maps.Map(el.current, {
      center: DEFAULT_CENTER,
      zoom: 11,
      zoomControl: true,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
    })
    info.current = new google.maps.InfoWindow()
    m.addListener('click', (e: google.maps.MapMouseEvent) => {
      info.current?.close()
      if (e.latLng) handlers.current.onMapClick?.({ lat: e.latLng.lat(), lng: e.latLng.lng() })
    })
    map.current = m
    return () => {
      for (const d of drawn.current) d.setMap(null)
      drawn.current = []
      info.current?.close()
      google.maps.event.clearInstanceListeners(m)
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const d of drawn.current) d.setMap(null)
    drawn.current = []
    for (const ln of lines) {
      const path = ln.polyline ? decodePolyline(ln.polyline) : (ln.path ?? [])
      if (path.length > 1) drawn.current.push(new google.maps.Polyline({ map: m, path, strokeColor: ln.color, strokeWeight: 4, strokeOpacity: 0.85 }))
    }
    for (const p of points) {
      const mk = new google.maps.Marker({ map: m, position: { lat: p.lat, lng: p.lng }, title: p.title, icon: pinIcon(p.color, p.label ?? '') })
      mk.addListener('click', () => {
        info.current?.setContent(infoContent(p))
        info.current?.open({ map: m, anchor: mk })
        handlers.current.onPointClick?.(p.id)
      })
      drawn.current.push(mk)
    }
    if (editing) {
      const mk = new google.maps.Marker({
        map: m,
        position: editing,
        draggable: true,
        zIndex: 1000,
        title: 'ลากเพื่อย้ายหมุด',
        icon: pinIcon('#dc2626', '✚'),
      })
      mk.addListener('dragend', () => {
        const ll = mk.getPosition()
        if (ll) handlers.current.onEditingMove?.({ lat: ll.lat(), lng: ll.lng() })
      })
      drawn.current.push(mk)
    }
  }, [points, lines, editing])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const all = [...points.map((p) => ({ lat: p.lat, lng: p.lng })), ...(editing ? [editing] : [])]
    if (all.length === 1) {
      m.setCenter(all[0]!)
      m.setZoom(14)
    } else if (all.length > 1) {
      const b = new google.maps.LatLngBounds()
      for (const p of all) b.extend(p)
      m.fitBounds(b, 40)
    }
    // Only refit when the caller says so.
  }, [fitKey])

  return <div ref={el} className={cn('rounded-lg border', className)} />
}
