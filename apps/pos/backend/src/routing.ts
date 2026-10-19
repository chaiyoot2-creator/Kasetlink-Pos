/**
 * Delivery routing: road distances (Google Routes API when a server key is configured,
 * otherwise a straight-line estimate), vehicle selection + splitting by capacity, and the
 * shortest visiting order per vehicle (exact for small trips, 2-opt beyond that).
 */

export interface LatLng {
  lat: number
  lng: number
}

export interface Matrix {
  /** km between point i and j (index 0 = depot). */
  km: number[][]
  /** minutes between point i and j. */
  min: number[][]
  source: 'google' | 'estimate'
}

const ROAD_FACTOR = 1.3
const EST_SPEED_KMH = 45

/** Backend-only key for the Routes API. Never returned to the browser. */
export function serverMapsKey(): string | null {
  return process.env.GOOGLE_MAPS_SERVER_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim() || null
}

/**
 * Key for the Maps JavaScript API in the browser. Only GOOGLE_MAPS_BROWSER_KEY is used
 * (it must be restricted to the app's web address); a generic or server key is never sent.
 */
export function browserMapsKey(): string | null {
  const key = process.env.GOOGLE_MAPS_BROWSER_KEY?.trim() || null
  if (!key) return null
  if (key === serverMapsKey()) {
    console.error('[maps] GOOGLE_MAPS_BROWSER_KEY equals the server key — not sending it to the browser. Use a separate referrer-restricted key.')
    return null
  }
  return key
}

export type MapsKeyCheck = 'ok' | 'missing' | 'denied' | 'error'

/** Calls the Routes API once with the server key and reports whether it works (no key in the result). */
export async function checkServerKey(): Promise<{ status: MapsKeyCheck; detail: string | null }> {
  const key = serverMapsKey()
  if (!key) return { status: 'missing', detail: null }
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters' },
      body: JSON.stringify({
        origin: waypoint({ lat: 19.9105, lng: 99.8406 }),
        destination: waypoint({ lat: 19.92, lng: 99.85 }),
        travelMode: 'DRIVE',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return { status: 'ok', detail: null }
    const text = (await res.text()).slice(0, 300).split(key).join('***')
    return { status: res.status === 401 || res.status === 403 ? 'denied' : 'error', detail: `HTTP ${res.status}: ${text}` }
  } catch (err) {
    return { status: 'error', detail: err instanceof Error ? err.message : 'network error' }
  }
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function estimateMatrix(points: LatLng[]): Matrix {
  const km = points.map((a) => points.map((b) => haversineKm(a, b) * ROAD_FACTOR))
  return { km, min: km.map((row) => row.map((d) => (d / EST_SPEED_KMH) * 60)), source: 'estimate' }
}

function waypoint(p: LatLng) {
  return { waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } }
}

function seconds(v: unknown): number {
  return typeof v === 'string' ? Number(v.replace(/s$/, '')) || 0 : 0
}

interface MatrixElement {
  originIndex?: number
  destinationIndex?: number
  distanceMeters?: number
  duration?: string
  condition?: string
}

function isMatrixElement(v: unknown): v is MatrixElement {
  return typeof v === 'object' && v !== null && ('originIndex' in v || 'destinationIndex' in v || 'condition' in v)
}

/** Road distance/time between every pair of points; falls back to an estimate if Google fails. */
export async function distanceMatrix(points: LatLng[]): Promise<Matrix> {
  const key = serverMapsKey()
  const n = points.length
  if (!key || n < 2 || n * n > 625) return estimateMatrix(points)
  try {
    const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,condition',
      },
      body: JSON.stringify({
        origins: points.map(waypoint),
        destinations: points.map(waypoint),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        languageCode: 'th',
        regionCode: 'TH',
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`Routes matrix HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body: unknown = await res.json()
    if (!Array.isArray(body)) throw new Error('Routes matrix: unexpected response')
    const est = estimateMatrix(points)
    const km = est.km.map((r) => [...r])
    const min = est.min.map((r) => [...r])
    for (const el of body) {
      if (!isMatrixElement(el)) continue
      const i = el.originIndex ?? 0
      const j = el.destinationIndex ?? 0
      if (i === j || el.condition !== 'ROUTE_EXISTS' || typeof el.distanceMeters !== 'number') continue
      km[i]![j] = el.distanceMeters / 1000
      min[i]![j] = seconds(el.duration) / 60
    }
    for (let i = 0; i < n; i++) {
      km[i]![i] = 0
      min[i]![i] = 0
    }
    return { km, min, source: 'google' }
  } catch (err) {
    console.error('[routing] Google distance matrix failed, using estimate', err instanceof Error ? err.message : err)
    return estimateMatrix(points)
  }
}

interface RouteLine {
  polyline: string | null
  km: number | null
  min: number | null
}

/** Encoded road polyline for an ordered stop list (≤ 25 intermediates). */
export async function routeLine(ordered: LatLng[]): Promise<RouteLine> {
  const key = serverMapsKey()
  if (!key || ordered.length < 2 || ordered.length > 27) return { polyline: null, km: null, min: null }
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: waypoint(ordered[0]!),
        destination: waypoint(ordered[ordered.length - 1]!),
        intermediates: ordered.slice(1, -1).map(waypoint),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        polylineEncoding: 'ENCODED_POLYLINE',
        languageCode: 'th',
        regionCode: 'TH',
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`Routes HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body: unknown = await res.json()
    const route =
      typeof body === 'object' && body !== null && 'routes' in body && Array.isArray(body.routes) ? (body.routes[0] as unknown) : null
    if (typeof route !== 'object' || route === null) return { polyline: null, km: null, min: null }
    const r = route as { distanceMeters?: unknown; duration?: unknown; polyline?: { encodedPolyline?: unknown } }
    return {
      polyline: typeof r.polyline?.encodedPolyline === 'string' ? r.polyline.encodedPolyline : null,
      km: typeof r.distanceMeters === 'number' ? r.distanceMeters / 1000 : null,
      min: seconds(r.duration) / 60 || null,
    }
  } catch (err) {
    console.error('[routing] Google route line failed', err instanceof Error ? err.message : err)
    return { polyline: null, km: null, min: null }
  }
}

// ---------------------------------------------------------------- shortest visiting order

function tourCost(order: number[], d: number[][], returnToDepot: boolean): number {
  let cost = 0
  let prev = 0
  for (const i of order) {
    cost += d[prev]![i]!
    prev = i
  }
  if (returnToDepot) cost += d[prev]![0]!
  return cost
}

/** Exact Held–Karp DP over stops (indices ≥ 1), start at depot 0. */
function heldKarp(stops: number[], d: number[][], returnToDepot: boolean): number[] {
  const n = stops.length
  const full = 1 << n
  const dp = new Float64Array(full * n).fill(Infinity)
  const parent = new Int16Array(full * n).fill(-1)
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = d[0]![stops[j]!]!
  for (let mask = 1; mask < full; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue
      const cur = dp[mask * n + j]!
      if (cur === Infinity) continue
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue
        const next = mask | (1 << k)
        const cost = cur + d[stops[j]!]![stops[k]!]!
        if (cost < dp[next * n + k]!) {
          dp[next * n + k] = cost
          parent[next * n + k] = j
        }
      }
    }
  }
  let best = Infinity
  let last = 0
  for (let j = 0; j < n; j++) {
    const cost = dp[(full - 1) * n + j]! + (returnToDepot ? d[stops[j]!]![0]! : 0)
    if (cost < best) {
      best = cost
      last = j
    }
  }
  const order: number[] = []
  let mask = full - 1
  let j = last
  while (j >= 0) {
    order.push(stops[j]!)
    const p = parent[mask * n + j]!
    mask ^= 1 << j
    j = p
  }
  return order.reverse()
}

/** Nearest neighbour, then 2-opt until no improvement. */
function heuristic(stops: number[], d: number[][], returnToDepot: boolean): number[] {
  const left = new Set(stops)
  const order: number[] = []
  let cur = 0
  while (left.size) {
    let best = -1
    let bestD = Infinity
    for (const s of left) {
      if (d[cur]![s]! < bestD) {
        bestD = d[cur]![s]!
        best = s
      }
    }
    order.push(best)
    left.delete(best)
    cur = best
  }
  let improved = true
  let guard = 0
  while (improved && guard++ < 200) {
    improved = false
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)]
        if (tourCost(candidate, d, returnToDepot) + 1e-9 < tourCost(order, d, returnToDepot)) {
          order.splice(0, order.length, ...candidate)
          improved = true
        }
      }
    }
  }
  return order
}

/** Shortest order to visit `stops` (matrix indices) starting from the depot (index 0). */
export function shortestOrder(stops: number[], d: number[][], returnToDepot: boolean): number[] {
  if (stops.length <= 1) return [...stops]
  return stops.length <= 12 ? heldKarp(stops, d, returnToDepot) : heuristic(stops, d, returnToDepot)
}

// ---------------------------------------------------------------- vehicles

export interface VehicleInfo {
  id: string
  name: string
  capacityKg: number
  minLoadKg: number
  costPerKm: number
}

export interface StopInfo {
  /** Matrix index (≥ 1). */
  index: number
  orderId: string
  weightKg: number
  point: LatLng
}

export interface VehiclePlan {
  vehicle: VehicleInfo
  stops: StopInfo[]
  weightKg: number
}

/** Bearing of a point seen from the depot, 0..360. */
function bearing(depot: LatLng, p: LatLng): number {
  const deg = (Math.atan2(p.lng - depot.lng, p.lat - depot.lat) * 180) / Math.PI
  return (deg + 360) % 360
}

/**
 * Pick vehicles for the total weight and split stops between them:
 *   - if one vehicle can carry everything, use the smallest that can;
 *   - otherwise use the fewest (largest first) vehicles whose capacity covers the weight, then
 *     sweep the stops by direction from the depot so each vehicle serves one area.
 * Returns stops that could not be placed (heavier than any free vehicle).
 */
export function assignVehicles(
  depot: LatLng,
  stops: StopInfo[],
  vehicles: VehicleInfo[],
): { plans: VehiclePlan[]; unassigned: StopInfo[] } {
  const total = stops.reduce((s, x) => s + x.weightKg, 0)
  const byCapAsc = [...vehicles].sort((a, b) => a.capacityKg - b.capacityKg)
  const single = byCapAsc.find((v) => v.capacityKg >= total)
  if (single) return { plans: [{ vehicle: single, stops: [...stops], weightKg: total }], unassigned: [] }

  // Fewest vehicles: largest first until capacity covers the load (10 % slack for packing).
  const chosen: VehicleInfo[] = []
  let cap = 0
  for (const v of [...byCapAsc].reverse()) {
    if (cap >= total * 1.1) break
    chosen.push(v)
    cap += v.capacityKg
  }

  // Sweep by direction, starting after the widest angular gap so areas are not cut in two.
  const sorted = [...stops].sort((a, b) => bearing(depot, a.point) - bearing(depot, b.point))
  let gapAt = 0
  let gap = -1
  for (let i = 0; i < sorted.length; i++) {
    const a = bearing(depot, sorted[i]!.point)
    const b = bearing(depot, sorted[(i + 1) % sorted.length]!.point) + (i + 1 === sorted.length ? 360 : 0)
    if (b - a > gap) {
      gap = b - a
      gapAt = (i + 1) % sorted.length
    }
  }
  const sweep = [...sorted.slice(gapAt), ...sorted.slice(0, gapAt)]

  const plans: VehiclePlan[] = chosen.map((v) => ({ vehicle: v, stops: [], weightKg: 0 }))
  const unassigned: StopInfo[] = []
  let vi = 0
  // Fill each vehicle to its share of the load so trips stay balanced.
  for (const stop of sweep) {
    while (vi < plans.length - 1 && plans[vi]!.weightKg > 0 && plans[vi]!.weightKg + stop.weightKg > plans[vi]!.vehicle.capacityKg) vi++
    const target = plans.find((p, i) => i >= vi && p.weightKg + stop.weightKg <= p.vehicle.capacityKg) ??
      plans.find((p) => p.weightKg + stop.weightKg <= p.vehicle.capacityKg)
    if (target) {
      target.stops.push(stop)
      target.weightKg += stop.weightKg
    } else {
      // Try a vehicle that has not been used yet.
      const spare = byCapAsc.find((v) => !plans.some((p) => p.vehicle.id === v.id) && v.capacityKg >= stop.weightKg)
      if (spare) plans.push({ vehicle: spare, stops: [stop], weightKg: stop.weightKg })
      else unassigned.push(stop)
    }
  }
  // Heaviest trip first: give each the smallest still-free vehicle that carries it.
  const used = new Set<string>()
  const result = plans.filter((p) => p.stops.length > 0).sort((a, b) => b.weightKg - a.weightKg)
  for (const p of result) {
    const fit = byCapAsc.find((v) => !used.has(v.id) && v.capacityKg >= p.weightKg)
    if (fit) p.vehicle = fit
    used.add(p.vehicle.id)
  }
  return { plans: result, unassigned }
}

// ---------------------------------------------------------------- feed weight

/**
 * Weight of one sack: the product's own value, else a number in the name ("30 กก."), else
 * by kind of feed — milk replacer 10 kg, aquatic/pet 20 kg, everything else 30 kg.
 */
export function unitWeightKg(p: { weightKg: number | null; name: string; category: string | null }): number {
  if (p.weightKg && p.weightKg > 0) return p.weightKg
  const m = /(\d+(?:\.\d+)?)\s*(?:กก|กิโล|kg)/i.exec(p.name)
  if (m) return Number(m[1])
  const text = `${p.name} ${p.category ?? ''}`
  if (/นม|เลี้ยงลูก|milk/i.test(text)) return 10
  if (/ปลา|กุ้ง|สัตว์น้ำ|กบ|สุนัข|หมา|แมว|สัตว์เลี้ยง|pet|fish/i.test(text)) return 20
  return 30
}
