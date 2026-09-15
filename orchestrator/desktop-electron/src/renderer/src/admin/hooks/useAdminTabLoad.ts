import { useCallback, useEffect, useState } from 'react'
import { formatAdminLoadError } from '../adminLoadError'

export function useAdminTabLoad<T>(
  fallback: T,
  fetcher: () => Promise<T>
): {
  data: T
  loading: boolean
  error: string | null
  reload: () => Promise<void>
} {
  const [data, setData] = useState<T>(fallback)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetcher()
      setData(next)
    } catch (err) {
      setError(formatAdminLoadError(err))
    } finally {
      setLoading(false)
    }
  }, [fallback, fetcher])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload }
}
