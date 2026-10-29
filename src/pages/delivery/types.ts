export type PlaceKind = 'location' | 'customer' | 'agency'

export interface Place {
  kind: PlaceKind
  id: string
  name: string
  code: string | null
  subtitle: string
  lat: number | null
  lng: number | null
  address: string | null
  note: string | null
  phone: string | null
  isActive: boolean
}

export interface Vehicle {
  id: string
  name: string
  plate: string | null
  vehicleType: string
  minLoadKg: number
  capacityKg: number
  costPerKm: number
  driverName: string | null
  note: string | null
  isActive: boolean
}

export interface DeliveryOrder {
  id: string
  docNo: string
  deliveryDate: string
  source: string
  saleId: string | null
  saleBillNo: string | null
  customerId: string | null
  agencyCustomerId: string | null
  recipientName: string
  phone: string | null
  address: string | null
  lat: number | null
  lng: number | null
  totalBags: number
  totalWeightKg: number
  status: 'pending' | 'planned' | 'delivered' | 'cancelled'
  note: string | null
  tripId: string | null
  tripNo: string | null
}

export interface PlanStop {
  orderId: string
  docNo: string
  name: string
  address: string | null
  phone: string | null
  lat: number
  lng: number
  weightKg: number
  bags: number
  legKm: number
  legMin: number
}

export interface PlannedTrip {
  vehicleId: string
  vehicleName: string
  capacityKg: number
  minLoadKg: number
  weightKg: number
  bags: number
  stops: PlanStop[]
  distanceKm: number
  durationMin: number
  returnKm: number
  fuelCost: number
  polyline: string | null
  source: 'google' | 'estimate'
  warnings: string[]
}

export interface Plan {
  depot: { lat: number; lng: number; name: string }
  returnToDepot: boolean
  distanceSource: 'google' | 'estimate'
  trips: PlannedTrip[]
  totals: { distanceKm: number; durationMin: number; weightKg: number; fuelCost: number }
  unassigned: { orderId: string; docNo: string; name: string; weightKg: number }[]
  noPin: { orderId: string; docNo: string; name: string }[]
}

export interface Trip {
  id: string
  docNo: string
  tripDate: string
  vehicleId: string
  vehicleName: string
  plate: string | null
  driverName: string | null
  depotLocationId: string
  depotName: string | null
  depotLat: number | null
  depotLng: number | null
  returnToDepot: boolean
  weightKg: number
  bags: number
  distanceKm: number
  durationMin: number
  distanceSource: string
  polyline: string | null
  status: 'planned' | 'done' | 'cancelled'
  stopCount: number
}

export interface TripDetail extends Trip {
  stops: {
    seq: number
    orderId: string
    docNo: string
    name: string
    phone: string | null
    address: string | null
    lat: number | null
    lng: number | null
    bags: number
    weightKg: number
    legKm: number
    legMin: number
    status: string
    note: string | null
    items: string
  }[]
}

export const PLACE_COLOR: Record<PlaceKind, string> = { location: '#15803d', customer: '#2563eb', agency: '#d97706' }
export const TRIP_COLORS = ['#2563eb', '#dc2626', '#9333ea', '#d97706', '#0891b2', '#65a30d', '#db2777', '#4b5563']

export const ORDER_STATUS_LABEL: Record<DeliveryOrder['status'], string> = {
  pending: 'รอจัดเส้นทาง',
  planned: 'จัดรถแล้ว',
  delivered: 'ส่งแล้ว',
  cancelled: 'ยกเลิก',
}

export const VEHICLE_TYPE_LABEL: Record<string, string> = {
  pickup: 'กระบะ',
  truck4: 'รถ 4 ล้อ',
  truck6: 'รถ 6 ล้อ',
  truck10: 'รถ 10 ล้อ',
  other: 'อื่น ๆ',
}

/** Weight of one sack, same rule as the server: product value → name → feed kind. */
export function unitWeightKg(p: { weightKg?: number | null; name: string; category?: string | null }): number {
  if (p.weightKg && p.weightKg > 0) return p.weightKg
  const m = /(\d+(?:\.\d+)?)\s*(?:กก|กิโล|kg)/i.exec(p.name)
  if (m) return Number(m[1])
  const text = `${p.name} ${p.category ?? ''}`
  if (/นม|เลี้ยงลูก|milk/i.test(text)) return 10
  if (/ปลา|กุ้ง|สัตว์น้ำ|กบ|สุนัข|หมา|แมว|สัตว์เลี้ยง|pet|fish/i.test(text)) return 20
  return 30
}

export function kg(n: number): string {
  return `${n.toLocaleString('th-TH', { maximumFractionDigits: 1 })} กก.`
}
