import { apiFetch } from './api'

export interface LatLng {
  lat: number
  lng: number
}

export interface MapsConfig {
  browserKey: string | null
  hasServerKey: boolean
}

let configPromise: Promise<MapsConfig> | null = null

/** Map settings from the backend (the browser key is restricted to the app's web address). */
export function loadMapsConfig(): Promise<MapsConfig> {
  configPromise ??= apiFetch<MapsConfig>('/maps/config').catch(() => ({ browserKey: null, hasServerKey: false }))
  return configPromise
}

/** True once the Google Maps script has defined its classes. */
function googleReady(): boolean {
  return typeof google !== 'undefined' && typeof google.maps?.Map === 'function'
}

let googlePromise: Promise<boolean> | null = null

/** Load the Google Maps JavaScript API once. Resolves false when it cannot be loaded. */
export function loadGoogleMaps(key: string): Promise<boolean> {
  if (googleReady()) return Promise.resolve(true)
  googlePromise ??= new Promise<boolean>((resolve) => {
    const cb = `__kasetGmaps${Date.now()}`
    Object.assign(window, { [cb]: () => resolve(true) })
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=th&region=TH&loading=async&callback=${cb}`
    s.async = true
    s.onerror = () => resolve(false)
    document.head.appendChild(s)
    window.setTimeout(() => resolve(googleReady()), 15000)
  })
  return googlePromise
}

/** Decode a Google encoded polyline into points. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0
      let shift = 0
      let b: number
      do {
        b = encoded.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20 && index < encoded.length)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lng += delta
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

/** Google Maps navigation link (free, opens the app on phones). Up to 9 stops in between. */
export function navigationUrl(origin: LatLng, stops: LatLng[], returnTo?: LatLng): string {
  const all = returnTo ? [...stops, returnTo] : stops
  const destination = all[all.length - 1]
  const waypoints = all.slice(0, -1)
  const p = (x: LatLng) => `${x.lat},${x.lng}`
  const params = new URLSearchParams({ api: '1', origin: p(origin), travelmode: 'driving' })
  if (destination) params.set('destination', p(destination))
  if (waypoints.length) params.set('waypoints', waypoints.map(p).join('|'))
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/** Parse "19.91, 99.84" or a Google Maps link (…@19.91,99.84… / ?q=19.91,99.84). */
export function parseLatLng(text: string): LatLng | null {
  const m = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(text)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

export function fmtKm(km: number): string {
  return `${km.toLocaleString('th-TH', { maximumFractionDigits: 1 })} กม.`
}

export function fmtMin(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m} นาที`
  return `${Math.floor(m / 60)} ชม. ${m % 60} นาที`
}
