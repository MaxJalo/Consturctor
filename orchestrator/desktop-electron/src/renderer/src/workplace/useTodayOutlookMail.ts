import { useEffect, useMemo, useState } from 'react'
import type { SpecMailRow } from './specV04DemoData'
import { outlookMessageToMailRow } from './specV04Mappers'
import {
  dayKeyLocal,
  ensureOutlookMailRange,
  formatMailReceivedLabel,
  formatMailTime
} from '../utils/outlookMail'
import { filterMessagesOnDay } from './mailProbe'
import { useGridRefreshGeneration } from './GridDataRefreshContext'
import { readGridCache, shouldRunGridFetch, writeGridCache } from './gridDataCache'

function dayKeyFrom(day: Date): string {
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
}

export interface TodayOutlookMailState {
  loading: boolean
  error: string
  source: string
  rows: SpecMailRow[]
}

/** Письма дня из Outlook этого компьютера (ящик его профиля). */
function cachedTodayMail(dayKey: string): { error: string; source: string; rows: SpecMailRow[] } | undefined {
  return readGridCache(`today-outlook-mail-inout:profile:${dayKey}`)
}

export function useTodayOutlookMail(periodDay: Date): TodayOutlookMailState {
  const generation = useGridRefreshGeneration()
  const dayKey = dayKeyFrom(periodDay)
  const initial = cachedTodayMail(dayKey)
  const [loading, setLoading] = useState(!initial)
  const [error, setError] = useState(initial?.error ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [rows, setRows] = useState<SpecMailRow[]>(initial?.rows ?? [])

  useEffect(() => {
    let alive = true
    const cacheKey = `today-outlook-mail-inout:profile:${dayKey}`
    if (!shouldRunGridFetch(cacheKey, generation)) {
      const cached = readGridCache<{ error: string; source: string; rows: SpecMailRow[] }>(cacheKey)
      if (cached) {
        setError(cached.error)
        setSource(cached.source)
        setRows(cached.rows)
        setLoading(false)
        return
      }
    }
    if (!cachedTodayMail(dayKey)) setLoading(true)
    setError('')
    void (async () => {
      try {
        const dayIso = dayKeyLocal(periodDay)
        const batch = await ensureOutlookMailRange(dayIso, dayIso, {
          folder: 'All',
          maxResults: 80
        })
        if (!alive) return
        if (!batch.ok) {
          setRows([])
          setSource('')
          setError(batch.error || 'Outlook недоступен')
          return
        }
        const onDay = filterMessagesOnDay(batch.messages, dayIso)
        const combined = (onDay.length ? onDay : batch.messages).sort((left, right) =>
          String(right.datetime || right.sent_at || right.received_at || '').localeCompare(
            String(left.datetime || left.sent_at || left.received_at || '')
          )
        )
        const mapped = combined.map(
          (msg, index) => {
            const row = outlookMessageToMailRow(msg, index)
            return {
              ...row,
              receivedAt: String(msg.datetime || msg.received_at || msg.sent_at || row.receivedAt || row.time),
              time: formatMailTime(String(msg.datetime || msg.received_at || msg.sent_at || row.time)),
              receivedLabel: formatMailReceivedLabel(
                String(msg.datetime || msg.received_at || msg.sent_at || row.time)
              )
            }
          }
        )
        const seen = new Set<string>()
        const nextRows = mapped.filter((row) => {
          const key = row.id
          if (!key || seen.has(key)) return false
          seen.add(key)
          return true
        })
        const nextSource = batch.cached ? 'outlook_com (cache)' : 'outlook_com (All)'
        setSource(nextSource)
        setRows(nextRows)
        setError('')
        if (onDay.length && !batch.warning && !batch.offline) {
          writeGridCache(cacheKey, { error: '', source: nextSource, rows: nextRows })
        }
      } catch (err) {
        if (!alive) return
        setRows([])
        setSource('')
        setError(err instanceof Error ? err.message : 'Ошибка загрузки почты')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [dayKey, generation, periodDay])

  const resolvedRows = useMemo(() => {
    return rows
  }, [rows])

  return {
    loading: loading && resolvedRows.length === 0,
    error: resolvedRows.length ? '' : error,
    source,
    rows: resolvedRows
  }
}
