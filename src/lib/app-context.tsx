import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch, errorMessage } from './api'
import { getSavedLocationId, getTerminalId, saveLocationId } from './terminal'
import type { Bootstrap, Location } from './types'

interface AppState {
  data: Bootstrap
  terminalId: string
  terminalName: string
  /** Zone this device works in — default location for sales and stock actions. */
  locationId: string
  location: Location | undefined
  activeLocations: Location[]
  setLocationId: (id: string) => void
  reload: () => Promise<void>
  locationName: (id: string | null | undefined) => string
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}

export function AppProvider({ children, fallback }: { children: ReactNode; fallback: (state: { error: string | null; retry: () => void }) => ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [locationId, setLocationIdState] = useState<string>(getSavedLocationId() ?? '')
  const terminalId = getTerminalId()

  const reload = useCallback(async () => {
    try {
      const b = await apiFetch<Bootstrap>('/bootstrap')
      setData(b)
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const activeLocations = useMemo(() => (data?.locations ?? []).filter((l) => l.isActive), [data])

  // Fall back to this terminal's registered zone, then to the first store.
  const resolvedLocationId = useMemo(() => {
    if (activeLocations.some((l) => l.id === locationId)) return locationId
    const registered = data?.terminals.find((t) => t.id === terminalId)?.locationId
    if (registered && activeLocations.some((l) => l.id === registered)) return registered
    return activeLocations.find((l) => l.kind === 'store')?.id ?? activeLocations[0]?.id ?? ''
  }, [activeLocations, locationId, data, terminalId])

  const setLocationId = useCallback((id: string) => {
    saveLocationId(id)
    setLocationIdState(id)
  }, [])

  const value = useMemo<AppState | null>(() => {
    if (!data) return null
    const byId = new Map(data.locations.map((l) => [l.id, l]))
    return {
      data,
      terminalId,
      terminalName: data.terminals.find((t) => t.id === terminalId)?.name ?? terminalId,
      locationId: resolvedLocationId,
      location: byId.get(resolvedLocationId),
      activeLocations,
      setLocationId,
      reload,
      locationName: (id) => (id ? (byId.get(id)?.name ?? '-') : '-'),
    }
  }, [data, terminalId, resolvedLocationId, activeLocations, setLocationId, reload])

  if (!value) return <>{fallback({ error, retry: () => void reload() })}</>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
