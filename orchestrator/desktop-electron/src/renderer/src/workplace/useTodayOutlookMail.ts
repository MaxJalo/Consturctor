import { useEffect, useState } from 'react'
import type { SpecMailRow } from './specV04DemoData'
import { imapMessageToMailRow, outlookMessageToMailRow } from './specV04Mappers'
import { attachOutlookEntryIds, probeMailToday } from './mailProbe'
import { fetchImapSearch, isImapStubMode } from '../utils/imapMail'
import { dayKeyLocal, fetchOutlookMailForDay, formatMailTime, skipOutlookCom } from '../utils/outlookMail'
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
  imapPrimary: boolean
  comError: string
  imapError: string
  imapStatus: string
}

type TodayMailCache = {
  error: string
  source: string
  rows: SpecMailRow[]
  imapPrimary: boolean
  comError: string
  imapError: string
  imapStatus: string
}

function formatRows(rows: SpecMailRow[]): SpecMailRow[] {
  return rows.map((row) => ({ ...row, time: formatMailTime(row.time) }))
}

export function useTodayOutlookMail(periodDay: Date): TodayOutlookMailState {
  const generation = useGridRefreshGeneration()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<SpecMailRow[]>([])
  const [imapPrimary, setImapPrimary] = useState(false)
  const [comError, setComError] = useState('')
  const [imapError, setImapError] = useState('')
  const [imapStatus, setImapStatus] = useState('')

  const dayKey = dayKeyFrom(periodDay)

  useEffect(() => {
    let alive = true
    const cacheKey = `today-outlook-mail:${dayKey}`
    const cached = readGridCache<TodayMailCache>(cacheKey)
    if (!shouldRunGridFetch(cacheKey, generation) && cached) {
      setError(cached.error)
      setSource(cached.source)
      setRows(cached.rows)
      setImapPrimary(cached.imapPrimary)
      setComError(cached.comError)
      setImapError(cached.imapError)
      setImapStatus(cached.imapStatus)
      setLoading(false)
      return
    }
    if (cached) {
      setError(cached.error)
      setSource(cached.source)
      setRows(cached.rows)
      setImapPrimary(cached.imapPrimary)
      setComError(cached.comError)
      setImapError(cached.imapError)
      setImapStatus(cached.imapStatus)
    } else {
      setError('')
    }
    setLoading(!cached)

    const period = dayKeyLocal(periodDay)
    const today = dayKeyLocal(new Date())

    void (async () => {
      const probe = await probeMailToday()
      const imapStub = isImapStubMode(probe.imapMode) || !probe.imapUsable
      const comPromise = skipOutlookCom()
        ? Promise.resolve({ ok: false, messages: [] as Record<string, unknown>[], error: 'Outlook COM отключён' })
        : period === today
          ? Promise.resolve({ ok: !probe.comError, messages: probe.comToday, error: probe.comError })
          : fetchOutlookMailForDay(periodDay, { folder: 'Inbox', maxResults: 50 })
      const imapPromise = imapStub
        ? Promise.resolve({ ok: true, mode: 'stub', messages: [] as Record<string, unknown>[], error: '' })
        : period === today
          ? Promise.resolve({
              ok: !probe.imapError,
              mode: probe.imapMode,
              messages: probe.imapToday,
              error: probe.imapError
            })
          : fetchImapSearch({ date: period, limit: 50 })

      const [comRes, imapRes] = await Promise.all([
        comPromise.catch((err) => ({
          ok: false,
          messages: [] as Record<string, unknown>[],
          error: err instanceof Error ? err.message : 'Outlook недоступен'
        })),
        imapPromise.catch((err) => ({
          ok: false,
          mode: '',
          messages: [] as Record<string, unknown>[],
          error: err instanceof Error ? err.message : 'IMAP недоступен'
        }))
      ])
      if (!alive) return

      const imapUsable = probe.imapUsable && !imapStub
      const imapDay = imapUsable ? imapRes.messages : []
      const comDay = comRes.ok ? comRes.messages : []
      const imapRows = formatRows(
        attachOutlookEntryIds(
          imapDay.map((msg, index) => imapMessageToMailRow(msg, index)),
          comDay
        )
      )
      const comRows = formatRows(comDay.map((msg, index) => outlookMessageToMailRow(msg, index)))
      const nextRows = comRows.length ? comRows : imapUsable ? imapRows : []
      const nextComError = comRes.ok ? '' : comRes.error || probe.comError
      const nextImapError = imapStub || imapRes.ok || !imapUsable ? '' : imapRes.error || probe.imapError
      const nextSource = comRes.ok
        ? 'outlook_com'
        : imapUsable && probe.imapPrimary
          ? `imap (primary, extras=${probe.extrasCount})`
          : ''
      const nextError = nextComError
      const nextImapStatus = ''

      setImapPrimary(false)
      setComError(nextComError)
      setImapError(nextImapError)
      setImapStatus(nextImapStatus)
      setSource(nextSource)
      setRows(nextRows)
      setError(nextError)
      writeGridCache(cacheKey, {
        error: nextError,
        source: nextSource,
        rows: nextRows,
        imapPrimary: false,
        comError: nextComError,
        imapError: nextImapError,
        imapStatus: nextImapStatus
      })
    })()
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Ошибка загрузки почты')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [dayKey, generation, periodDay])

  return { loading, error, source, rows, imapPrimary, comError, imapError, imapStatus }
}
