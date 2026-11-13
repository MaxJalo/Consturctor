import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PositionKpiCompensation } from '../api/types'
import { loadSession } from '../store/session'
import { readGridCache, writeGridCache } from './gridDataCache'

const EMPTY: PositionKpiCompensation = {
  available: false,
  unlocked: false,
  currency: 'RUB',
  effectiveFrom: '',
  salary: null,
  bonus: null,
  total: null,
  history: []
}

/** Премия помесячная, как и плитки KPI должности: сервер берёт текущий месяц, календарь периода не влияет. */
export function usePositionCompensation(): {
  compensation: PositionKpiCompensation
  loading: boolean
  unlocking: boolean
  /** Пустая строка — зарплата открыта, иначе текст ошибки. */
  unlock: (pin: string) => Promise<string>
  hide: () => void
} {
  const cacheKey = `fio:${loadSession()?.fio || ''}:position-compensation`
  const cached = readGridCache<PositionKpiCompensation>(cacheKey)
  const [compensation, setCompensation] = useState<PositionKpiCompensation>(cached ?? EMPTY)
  const [loading, setLoading] = useState(!cached)
  const [unlocking, setUnlocking] = useState(false)

  useEffect(() => {
    let alive = true
    if (!readGridCache<PositionKpiCompensation>(cacheKey)) {
      setLoading(true)
      setCompensation(EMPTY)
    }
    void api
      .getPositionKpiCompensation()
      .then((next) => {
        if (!alive) return
        writeGridCache(cacheKey, next)
        setCompensation(next)
      })
      .catch(() => {
        if (alive) setCompensation(EMPTY)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [cacheKey])

  const unlock = useCallback(async (pin: string): Promise<string> => {
    setUnlocking(true)
    try {
      setCompensation(await api.unlockPositionKpiCompensation(pin))
      return ''
    } catch (err: unknown) {
      return err instanceof Error && err.message ? err.message : 'Не удалось показать зарплату'
    } finally {
      setUnlocking(false)
    }
  }, [])

  const hide = useCallback(() => {
    setCompensation((current) => ({
      ...current,
      unlocked: false,
      salary: null,
      bonus: null,
      total: null,
      history: []
    }))
  }, [])

  return { compensation, loading, unlocking, unlock, hide }
}
