import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { GRID_DATA_TTL_MS, clearGridCacheForUser } from './gridDataCache'

type GridDataRefreshContextValue = {
  /** Монотонный счётчик: фокус после blur, visibility, интервал TTL, смена пользователя. */
  generation: number
  forceRefresh: () => void
}

const GridDataRefreshContext = createContext<GridDataRefreshContextValue | null>(null)

export function GridDataRefreshProvider({
  userId,
  children
}: {
  userId?: string
  children: ReactNode
}): React.JSX.Element {
  const [generation, setGeneration] = useState(0)
  const blurredRef = useRef(false)
  const prevUserIdRef = useRef<string | undefined>(undefined)

  const bumpTimerRef = useRef<number | undefined>(undefined)

  const bump = useCallback((): void => {
    setGeneration((value) => value + 1)
  }, [])

  const bumpDebounced = useCallback((): void => {
    if (bumpTimerRef.current != null) {
      window.clearTimeout(bumpTimerRef.current)
    }
    bumpTimerRef.current = window.setTimeout(() => {
      bumpTimerRef.current = undefined
      bump()
    }, 400)
  }, [bump])

  useEffect(() => {
    const uid = (userId || '').trim()
    if (!uid) return
    if (prevUserIdRef.current !== uid) {
      if (prevUserIdRef.current) clearGridCacheForUser(prevUserIdRef.current)
      prevUserIdRef.current = uid
      bump()
    }
  }, [userId, bump])

  useEffect(() => {
    const onBlur = (): void => {
      blurredRef.current = true
    }
    const onFocus = (): void => {
      if (!blurredRef.current) return
      blurredRef.current = false
      if (document.visibilityState === 'hidden') return
      bumpDebounced()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        blurredRef.current = true
        return
      }
      if (blurredRef.current) {
        blurredRef.current = false
        bumpDebounced()
      }
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [bumpDebounced])

  useEffect(() => {
    const timer = window.setInterval(bump, GRID_DATA_TTL_MS)
    return () => window.clearInterval(timer)
  }, [bump])

  const value = useMemo(
    () => ({
      generation,
      forceRefresh: bump
    }),
    [generation, bump]
  )

  return <GridDataRefreshContext.Provider value={value}>{children}</GridDataRefreshContext.Provider>
}

export function useGridDataRefreshContext(): GridDataRefreshContextValue {
  const ctx = useContext(GridDataRefreshContext)
  if (!ctx) {
    throw new Error('useGridDataRefreshContext requires GridDataRefreshProvider')
  }
  return ctx
}

/** @deprecated scopeKey ignored — используйте локальные deps эффекта для смены дня/фильтра. */
export function useGridRefreshGeneration(_scopeKey?: string): number {
  return useGridDataRefreshContext().generation
}
