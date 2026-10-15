import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Crosshair, ExternalLink, Loader2, MapPin, Search, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/common'
import { MapView, type MapPoint } from '@/components/MapView'
import { apiFetch, errorMessage } from '@/lib/api'
import { parseLatLng, type LatLng } from '@/lib/maps'
import { cn } from '@/lib/utils'
import { PLACE_COLOR, type Place, type PlaceKind } from './types'

const KIND_LABEL: Record<PlaceKind, string> = { location: 'ร้าน/โกดัง', customer: 'ลูกค้าร้าน', agency: 'ลูกค้าฟาร์มสุข' }

/** Overview of every pinned point and pin editing (add / move / details / remove). */
export function MapTab({ places, onChanged }: { places: Place[]; onChanged: () => void }) {
  const [kinds, setKinds] = useState<Record<PlaceKind, boolean>>({ location: true, customer: true, agency: true })
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Place | null>(null)
  const [pos, setPos] = useState<LatLng | null>(null)
  const [coordText, setCoordText] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [fitKey, setFitKey] = useState('init')

  const shown = places.filter((p) => kinds[p.kind] && p.isActive)
  const pinned = shown.filter((p) => p.lat !== null && p.lng !== null)
  const term = q.trim().toLowerCase()
  const list = shown
    .filter((p) => !term || p.name.toLowerCase().includes(term) || (p.code ?? '').toLowerCase().includes(term) || (p.phone ?? '').includes(term))
    .sort((a, b) => Number(a.lat !== null) - Number(b.lat !== null) || a.name.localeCompare(b.name, 'th'))
  const missing = shown.filter((p) => p.lat === null).length

  const points: MapPoint[] = useMemo(
    () =>
      pinned
        .filter((p) => !sel || p.id !== sel.id)
        .map((p) => ({ id: `${p.kind}:${p.id}`, lat: p.lat ?? 0, lng: p.lng ?? 0, title: `${p.name} (${KIND_LABEL[p.kind]})`, color: PLACE_COLOR[p.kind], label: p.kind === 'location' ? '★' : '' })),
    [pinned, sel],
  )

  const select = (p: Place) => {
    setSel(p)
    const at = p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null
    setPos(at)
    setCoordText(at ? `${at.lat.toFixed(6)}, ${at.lng.toFixed(6)}` : '')
    setAddress(p.address ?? '')
    setNote(p.note ?? '')
    if (at) setFitKey(`sel-${p.id}`)
  }

  const movePin = (p: LatLng) => {
    setPos(p)
    setCoordText(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`)
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast.error('อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง')
    navigator.geolocation.getCurrentPosition(
      (g) => {
        movePin({ lat: g.coords.latitude, lng: g.coords.longitude })
        setFitKey(`gps-${Date.now()}`)
      },
      () => toast.error('หาตำแหน่งไม่ได้ — อนุญาตการเข้าถึงตำแหน่งในเบราว์เซอร์'),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const save = async () => {
    if (!sel || !pos) return
    setBusy(true)
    try {
      await apiFetch(`/delivery/places/${sel.kind}/${sel.id}`, {
        method: 'PUT',
        body: { lat: pos.lat, lng: pos.lng, address: address.trim() || null, note: note.trim() || null },
      })
      toast.success(`ปักหมุด ${sel.name} แล้ว`)
      setSel(null)
      setPos(null)
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!sel || !window.confirm(`ลบหมุดของ ${sel.name}? (ข้อมูลลูกค้ายังอยู่)`)) return
    setBusy(true)
    try {
      await apiFetch(`/delivery/places/${sel.kind}/${sel.id}`, { method: 'DELETE' })
      toast.success('ลบหมุดแล้ว')
      setSel(null)
      setPos(null)
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(Object.keys(KIND_LABEL) as PlaceKind[]).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1">
              <input type="checkbox" className="accent-primary" checked={kinds[k]} onChange={(e) => setKinds((s) => ({ ...s, [k]: e.target.checked }))} />
              <span className="inline-block size-2.5 rounded-full" style={{ background: PLACE_COLOR[k] }} />
              {KIND_LABEL[k]}
            </label>
          ))}
          <span className="text-muted-foreground">
            ปักหมุดแล้ว {pinned.length} · ยังไม่มีหมุด {missing}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto cursor-pointer" onClick={() => setFitKey(`all-${Date.now()}`)}>
            ดูทั้งหมด
          </Button>
        </div>
        <MapView
          className="h-[60vh] min-h-80 w-full"
          points={points}
          editing={sel ? pos : null}
          onEditingMove={movePin}
          onMapClick={(p) => sel && movePin(p)}
          onPointClick={(key) => {
            const [kind, id] = key.split(':')
            const p = places.find((x) => x.kind === kind && x.id === id)
            if (p) select(p)
          }}
          fitKey={fitKey}
        />
        <p className="text-xs text-muted-foreground">
          {sel ? 'คลิกบนแผนที่หรือลากหมุดสีแดงเพื่อวางตำแหน่ง แล้วกดบันทึก' : 'กดหมุดหรือเลือกรายชื่อด้านขวาเพื่อแก้ไข · ★ = ร้าน/โกดัง'}
        </p>
      </div>

      <div className="grid content-start gap-3">
        {sel ? (
          <div className="grid gap-3 rounded-lg border p-3">
            <div>
              <p className="font-semibold">{sel.name}</p>
              <p className="text-xs text-muted-foreground">
                {KIND_LABEL[sel.kind]}
                {sel.code ? ` · ${sel.code}` : ''}
                {sel.phone ? ` · ${sel.phone}` : ''}
              </p>
            </div>
            <Field label="พิกัด (ละติจูด, ลองจิจูด)" hint="วางพิกัดหรือลิงก์ Google Maps ได้ เช่น 19.910500, 99.840600">
              <Input
                value={coordText}
                onChange={(e) => {
                  setCoordText(e.target.value)
                  const p = parseLatLng(e.target.value)
                  if (p) {
                    setPos(p)
                    setFitKey(`typed-${p.lat}-${p.lng}`)
                  }
                }}
                placeholder="19.910500, 99.840600"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={useMyLocation}>
                <Crosshair /> ตำแหน่งปัจจุบัน
              </Button>
              {pos ? (
                <Button variant="ghost" size="sm" className="cursor-pointer" asChild>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${pos.lat},${pos.lng}`} target="_blank" rel="noreferrer">
                    <ExternalLink /> เปิดใน Google Maps
                  </a>
                </Button>
              ) : null}
            </div>
            <Field label={sel.kind === 'location' ? 'ที่อยู่' : 'ที่อยู่ / หมู่บ้าน'}>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            {sel.kind !== 'location' ? (
              <Field label="รายละเอียดจุดส่ง" hint="เช่น ทางเข้าฟาร์ม จุดลงของ เวลาที่สะดวก">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </Field>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button className="cursor-pointer" disabled={!pos || busy} onClick={() => void save()}>
                {busy ? <Loader2 className="animate-spin" /> : <MapPin />} บันทึกหมุด
              </Button>
              <Button variant="outline" className="cursor-pointer" disabled={busy} onClick={() => setSel(null)}>
                ปิด
              </Button>
              {sel.lat !== null ? (
                <Button variant="ghost" className="ml-auto cursor-pointer text-destructive" disabled={busy} onClick={() => void remove()}>
                  <Trash2 /> ลบหมุด
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="ค้นหาชื่อ / รหัส / เบอร์โทร" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
          {list.map((p) => (
            <li key={`${p.kind}:${p.id}`}>
              <button
                type="button"
                onClick={() => select(p)}
                className={cn('flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50', sel?.id === p.id && 'bg-primary/5')}
              >
                <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: PLACE_COLOR[p.kind] }} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.lat === null ? (
                  <Badge variant="outline" className="shrink-0 border-amber-400 text-amber-700">
                    ยังไม่ปักหมุด
                  </Badge>
                ) : (
                  <MapPin className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
