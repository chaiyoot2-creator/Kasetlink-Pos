import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Loader2 } from 'lucide-react'
import { decodePolyline, loadGoogleMaps, loadMapsConfig, type LatLng } from '@/lib/maps'
import { cn } from '@/lib/utils'

export interface MapPoint {
  id: string
  lat: number
  lng: number
  title: string
  /** Short text inside the pin, e.g. stop number. */
  label?: string
  color: string
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

/**
 * Map with pins and route lines. Uses Google Maps when a browser key is configured,
 * otherwise OpenStreetMap (Leaflet) so the shop can work before the key is set up.
 */
export function MapView(props: Props) {
  const [engine, setEngine] = useState<'google' | 'leaflet' | null>(null)
  useEffect(() => {
    let alive = true
    void loadMapsConfig().then(async (cfg) => {
      const ok = cfg.browserKey ? await loadGoogleMaps(cfg.browserKey) : false
      if (alive) setEngine(ok ? 'google' : 'leaflet')
    })
    return () => {
      alive = false
    }
  }, [])
  if (!engine) {
    return (
      <div className={cn('flex items-center justify-center rounded-lg border bg-muted', props.className)}>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return engine === 'google' ? <GoogleMapView {...props} /> : <LeafletMapView {...props} />
}

// ---------------------------------------------------------------- Leaflet (OpenStreetMap)

function LeafletMapView({ points, lines = [], editing, onEditingMove, onMapClick, onPointClick, fitKey, className }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const handlers = useRef({ onEditingMove, onMapClick, onPointClick })
  handlers.current = { onEditingMove, onMapClick, onPointClick }

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], zoom: 11 })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => handlers.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const g = layer.current
    if (!g) return
    g.clearLayers()
    for (const ln of lines) {
      const path = ln.polyline ? decodePolyline(ln.polyline) : (ln.path ?? [])
      if (path.length > 1) L.polyline(path.map((p) => [p.lat, p.lng] as [number, number]), { color: ln.color, weight: 4, opacity: 0.8 }).addTo(g)
    }
    for (const p of points) {
      const icon = L.divIcon({ html: pinSvg(p.color, p.label ?? ''), className: '', iconSize: [28, 38], iconAnchor: [14, 38] })
      L.marker([p.lat, p.lng], { icon, title: p.title })
        .bindTooltip(p.title)
        .on('click', () => handlers.current.onPointClick?.(p.id))
        .addTo(g)
    }
    if (editing) {
      const icon = L.divIcon({ html: pinSvg('#dc2626', '✚'), className: '', iconSize: [28, 38], iconAnchor: [14, 38] })
      const mk = L.marker([editing.lat, editing.lng], { icon, draggable: true, zIndexOffset: 1000 }).addTo(g)
      mk.on('dragend', () => {
        const ll = mk.getLatLng()
        handlers.current.onEditingMove?.({ lat: ll.lat, lng: ll.lng })
      })
    }
  }, [points, lines, editing])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const all = [...points.map((p) => [p.lat, p.lng] as [number, number]), ...(editing ? [[editing.lat, editing.lng] as [number, number]] : [])]
    if (all.length === 1) m.setView(all[0]!, 14)
    else if (all.length > 1) m.fitBounds(L.latLngBounds(all), { padding: [30, 30] })
    // Only refit when the caller says so.
  }, [fitKey])

  return <div ref={el} className={cn('z-0 rounded-lg border', className)} />
}

// ---------------------------------------------------------------- Google Maps

function GoogleMapView({ points, lines = [], editing, onEditingMove, onMapClick, onPointClick, fitKey, className }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map | null>(null)
  const drawn = useRef<{ setMap: (m: google.maps.Map | null) => void }[]>([])
  const handlers = useRef({ onEditingMove, onMapClick, onPointClick })
  handlers.current = { onEditingMove, onMapClick, onPointClick }

  useEffect(() => {
    if (!el.current || map.current) return
    const m = new google.maps.Map(el.current, {
      center: DEFAULT_CENTER,
      zoom: 11,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    })
    m.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) handlers.current.onMapClick?.({ lat: e.latLng.lat(), lng: e.latLng.lng() })
    })
    map.current = m
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
      const mk = new google.maps.Marker({
        map: m,
        position: { lat: p.lat, lng: p.lng },
        title: p.title,
        icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pinSvg(p.color, p.label ?? ''))}`, anchor: new google.maps.Point(14, 38) },
      })
      mk.addListener('click', () => handlers.current.onPointClick?.(p.id))
      drawn.current.push(mk)
    }
    if (editing) {
      const mk = new google.maps.Marker({
        map: m,
        position: editing,
        draggable: true,
        zIndex: 1000,
        icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pinSvg('#dc2626', '✚'))}`, anchor: new google.maps.Point(14, 38) },
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
  }, [fitKey])

  return <div ref={el} className={cn('rounded-lg border', className)} />
}
