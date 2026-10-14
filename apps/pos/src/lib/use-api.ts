import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, errorMessage } from './api'

/** Fetch `path` (re-fetches when it changes). `null` path = skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (path === null) return
    const mine = ++seq.current
    setLoading(true)
    try {
      const res = await apiFetch<T>(path)
      if (mine === seq.current) {
        setData(res)
        setError(null)
      }
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  return { data, error, loading, reload: load, setData }
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Current hash route (`#/stock` → `stock`). */
export function useHashRoute(defaultRoute: string): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || defaultRoute
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = useCallback((r: string) => {
    window.location.hash = `/${r}`
  }, [])
  return [route, go]
}
