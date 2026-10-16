import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { apiFetch, errorMessage } from './api'

export interface LatLng {
  lat: number
  lng: number
}

export interface MapsConfig {
  browserKey: string | null
  hasServerKey: boolean
}

/** Why the Google map could not be shown; the message is shown to staff as-is (Thai). */
export type MapsLoadResult = { ok: true } | { ok: false; reason: 'config' | 'no-key' | 'load' | 'auth'; message: string }

let configPromise: Promise<MapsConfig> | null = null

/** Map settings from the backend (the browser key is restricted to the app's web address). */
export function loadMapsConfig(): Promise<MapsConfig> {
  configPromise ??= apiFetch<MapsConfig>('/maps/config').catch((err: unknown) => {
    configPromise = null // let the next attempt retry
    throw err
  })
  return configPromise
}

declare global {
  interface Window {
    /** Called by the Maps JavaScript API when the key is invalid or not allowed for this site. */
    gm_authFailure?: () => void
  }
}

const AUTH_MESSAGE =
  'Google Maps ปฏิเสธคีย์ — ตรวจว่า GOOGLE_MAPS_BROWSER_KEY ถูกต้อง เปิดใช้ Maps JavaScript API แล้ว ผูกบัญชีชำระเงินแล้ว และอนุญาตที่อยู่เว็บของแอปนี้ (HTTP referrer)'

let authFailed = false
const authListeners = new Set<() => void>()

/** Subscribe to key/referrer rejections reported by Google after the script has loaded. */
export function onMapsAuthFailure(cb: () => void): () => void {
  if (authFailed) cb()
  authListeners.add(cb)
  return () => authListeners.delete(cb)
}

function installAuthHook() {
  window.gm_authFailure = () => {
    authFailed = true
    console.error('[maps] Google Maps rejected the browser key (gm_authFailure). Check API + HTTP referrer restrictions.')
    for (const cb of authListeners) cb()
  }
}

let googlePromise: Promise<MapsLoadResult> | null = null

/**
 * Fetch the browser key from the backend and load the Maps JavaScript API once with the
 * official loader. Resolves with a reason instead of throwing so the page can explain it.
 */
export function loadGoogleMaps(): Promise<MapsLoadResult> {
  googlePromise ??= (async (): Promise<MapsLoadResult> => {
    let cfg: MapsConfig
    try {
      cfg = await loadMapsConfig()
    } catch (err) {
      googlePromise = null
      return { ok: false, reason: 'config', message: `โหลดการตั้งค่าแผนที่ไม่ได้: ${errorMessage(err)}` }
    }
    if (!cfg.browserKey) {
      googlePromise = null
      return {
        ok: false,
        reason: 'no-key',
        message: 'ยังไม่ได้ตั้งค่า GOOGLE_MAPS_BROWSER_KEY ใน App Secrets ของ FuseBase (ตั้งค่าแล้วต้อง deploy ใหม่เพื่อให้มีผล)',
      }
    }
    installAuthHook()
    setOptions({ key: cfg.browserKey, v: 'weekly', language: 'th', region: 'TH' })
    try {
      await Promise.all([importLibrary('core'), importLibrary('maps'), importLibrary('marker')])
    } catch (err) {
      console.error('[maps] Google Maps JavaScript API failed to load', err instanceof Error ? err.message : err)
      return { ok: false, reason: 'load', message: 'โหลด Google Maps ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต หรือส่วนขยายบล็อกโฆษณาในเบราว์เซอร์' }
    }
    if (authFailed) return { ok: false, reason: 'auth', message: AUTH_MESSAGE }
    return { ok: true }
  })()
  return googlePromise
}

export const MAPS_AUTH_MESSAGE = AUTH_MESSAGE

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
