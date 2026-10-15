import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorBox, Loading, PageHeader } from '@/components/common'
import { addDaysISO, todayISO } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { MapTab } from './MapTab'
import { OrdersTab } from './OrdersTab'
import { PlanTab } from './PlanTab'
import { TripsTab } from './TripsTab'
import type { DeliveryOrder, Place, Vehicle } from './types'
import { VehiclesTab } from './VehiclesTab'

/** Delivery: orders of the day, shortest routes per vehicle, trips, map pins and vehicles. */
export function DeliveryPage() {
  // Orders taken in the morning usually go out the same day; after 15:00 default to tomorrow.
  const [date, setDate] = useState(() => (new Date().getHours() >= 15 ? addDaysISO(todayISO(), 1) : todayISO()))
  const [tab, setTab] = useState('orders')
  const places = useApi<Place[]>('/delivery/places')
  const vehicles = useApi<Vehicle[]>('/delivery/vehicles')
  const orders = useApi<DeliveryOrder[]>(`/delivery/orders?from=${date}&to=${date}`)

  return (
    <div>
      <PageHeader title="จัดส่ง" subtitle="ปักหมุดลูกค้า วางแผนเส้นทางที่สั้นที่สุด และเลือกรถตามน้ำหนักสินค้า" />
      {places.error ? <ErrorBox message={places.error} onRetry={() => void places.reload()} /> : null}
      {!places.data && !places.error ? <Loading /> : null}
      {places.data ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="orders" className="cursor-pointer">
              ออเดอร์จัดส่ง
            </TabsTrigger>
            <TabsTrigger value="plan" className="cursor-pointer">
              วางแผนเส้นทาง
            </TabsTrigger>
            <TabsTrigger value="trips" className="cursor-pointer">
              เที่ยวรถ
            </TabsTrigger>
            <TabsTrigger value="map" className="cursor-pointer">
              แผนที่
            </TabsTrigger>
            <TabsTrigger value="vehicles" className="cursor-pointer">
              รถขนส่ง
            </TabsTrigger>
          </TabsList>
          <TabsContent value="orders" className="mt-3">
            <OrdersTab date={date} setDate={setDate} orders={orders} places={places.data} />
          </TabsContent>
          <TabsContent value="plan" className="mt-3">
            <PlanTab
              date={date}
              setDate={setDate}
              orders={orders.data ?? []}
              vehicles={vehicles.data ?? []}
              places={places.data}
              onSaved={() => {
                void orders.reload()
                setTab('trips')
              }}
            />
          </TabsContent>
          <TabsContent value="trips" className="mt-3">
            <TripsTab date={date} setDate={setDate} onChanged={() => void orders.reload()} />
          </TabsContent>
          <TabsContent value="map" className="mt-3">
            <MapTab
              places={places.data}
              onChanged={() => {
                void places.reload()
                void orders.reload()
              }}
            />
          </TabsContent>
          <TabsContent value="vehicles" className="mt-3">
            <VehiclesTab vehicles={vehicles.data ?? []} onChanged={() => void vehicles.reload()} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}
