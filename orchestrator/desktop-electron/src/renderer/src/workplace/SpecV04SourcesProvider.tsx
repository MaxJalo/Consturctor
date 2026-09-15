import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { api } from '../api/client'
import type { UserProfile } from '../api/types'
import {
  countMeetingsOnDay,
  dedupeMeetingEvents,
  ensureOutlookMeetings,
  type MeetingEvent
} from '../utils/outlookMeetings'
import { fetchOutlookMailForRange, outlookMailWeekRange } from '../utils/outlookMail'
import { hasComPassword } from '../store/session'
import {
  enrichEmptyOneCErrors,
  formatComToolError,
  formatGatewayToolError,
  isOneCAuthFailure
} from './onecSessionHints'
import { erpActorFio, onecGatewayInvokeArgs, outlookMailboxAddress } from './userContext'
import {
  agentToProcessRow,
  erpTaskToProcessRow,
  erpTaskToRow,
  mailRowToProcessRow,
  meetingToProcessRow,
  outlookMessageToMailRow,
  turboProjectToProcessRow,
  turboProjectToRow
} from './specV04Mappers'
import type { SpecMailRow, SpecProcessRow, SpecProjectRow, SpecTaskRow } from './specV04DemoData'
import { useWorkplaceData } from './WorkplaceBoard'
import { useGridRefreshGeneration } from './GridDataRefreshContext'
import { isTurboNoSessionError } from './turboSession'
import { comSearchTasksToErpRecords, invokeLocalAcTool } from '../utils/localAcTool'
import type { SpecV04SourcesState } from './useSpecV04Data'

const EMPTY: SpecV04SourcesState = {
  sourcesLoading: false,
  tableLoading: false,
  loading: false,
  error: '',
  outlookMailbox: '',
  erpFio: '',
  erpTasks: [],
  erpTaskCount: 0,
  projects: [],
  projectCount: 0,
  mailRows: [],
  mailCount: 0,
  processRows: [],
  allProcessRows: [],
  meetingCount: 0,
  meetingCountToday: 0,
  meetings: [],
  erpError: '',
  sources: { erp: '—', turbo: '—', mail: '—' },
  turboNoSession: false,
  comPasswordInSession: false,
  oneCAuthFailure: false
}

export const SpecV04SourcesContext = createContext<SpecV04SourcesState>(EMPTY)

function parseErpToolTasks(
  res: { ok: boolean; result?: unknown; error?: string },
  erpFio: string
): { rows: SpecTaskRow[]; source: string; error: string } {
  if (!res.ok || !res.result || typeof res.result !== 'object') {
    return {
      rows: [],
      source: '',
      error: res.error ? formatGatewayToolError(res.error) : res.error || ''
    }
  }
  const payload = res.result as Record<string, unknown>
  const source = String(payload.source || 'erp_pm')
  const warning = String(payload.docflow_warning || payload.warning || '').trim()
  const raw = Array.isArray(payload.tasks) ? payload.tasks : []
  const rows = raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => erpTaskToRow(item, erpFio))
  return { rows, source, error: warning }
}

function mergeErpTaskRows(primary: SpecTaskRow[], extra: SpecTaskRow[]): SpecTaskRow[] {
  const seen = new Set<string>()
  const merged: SpecTaskRow[] = []
  for (const row of [...primary, ...extra]) {
    const key = `${row.id}:${row.title}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(row)
  }
  return merged
}

function isComTaskSource(source: string): boolean {
  const key = source.toLowerCase()
  return key.includes('onec_com') || key.includes('com32')
}

function uniqueErrorJoin(...chunks: (string | undefined | null)[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const chunk of chunks) {
    if (!chunk?.trim()) continue
    for (const piece of chunk.split(' · ')) {
      const text = piece.trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      parts.push(text)
    }
  }
  return parts.join(' · ')
}

async function loadComErpTasks(
  erpFio: string,
  priorError: string
): Promise<{ rows: SpecTaskRow[]; source: string; error: string }> {
  const comRes = await invokeLocalAcTool('onec.search_tasks', {
    mine_only: true,
    limit: 80
  })
  if (comRes.ok && comRes.result) {
    const comRecords = comSearchTasksToErpRecords(comRes.result)
    if (comRecords.length) {
      const note = priorError.trim()
        ? `Gateway/ OData без задач; показаны через COM 1С (${priorError.trim()})`
        : 'Задачи через COM 1С (сеанс desktop)'
      return {
        rows: comRecords.map((item) => erpTaskToRow(item, erpFio)),
        source: String(comRes.result.source || 'onec_com'),
        error: note
      }
    }
    const payloadErr = formatComToolError(
      String((comRes.result as Record<string, unknown>).error || '').trim()
    )
    return {
      rows: [],
      source: '',
      error: uniqueErrorJoin(priorError, payloadErr, formatComToolError(comRes.error || ''))
    }
  }
  return {
    rows: [],
    source: '',
    error: uniqueErrorJoin(priorError, formatComToolError(comRes.error || ''))
  }
}

export function SpecV04SourcesProvider({
  user,
  comCredsRevision = 0,
  children
}: {
  user: UserProfile
  /** From getComCredentialsRevision() — refetch 1C after password re-entry. */
  comCredsRevision?: number
  children: ReactNode
}): React.JSX.Element {
  const erpFio = erpActorFio(user)
  const outlookMailbox = outlookMailboxAddress(user)
  const generation = useGridRefreshGeneration(user.id)
  const { agents, loading: agentsLoading } = useWorkplaceData({
    userId: user.id || '',
    fio: erpFio
  })

  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [turboNoSession, setTurboNoSession] = useState(false)
  const [error, setError] = useState('')
  const [erpTasks, setErpTasks] = useState<SpecTaskRow[]>([])
  const [erpSource, setErpSource] = useState('—')
  const [erpError, setErpError] = useState('')
  const [projects, setProjects] = useState<SpecProjectRow[]>([])
  const [turboSource, setTurboSource] = useState('—')
  const [mailRows, setMailRows] = useState<SpecMailRow[]>([])
  const [mailSource, setMailSource] = useState('—')
  const [meetings, setMeetings] = useState<MeetingEvent[]>([])
  const [oneCAuthFailure, setOneCAuthFailure] = useState(false)

  useEffect(() => {
    if (!user.id) {
      setSourcesLoading(false)
      setTurboNoSession(false)
      return
    }
    let alive = true
    ;(async () => {
      setSourcesLoading(true)
      setError('')
      setOneCAuthFailure(false)
      try {
        const onecArgs = onecGatewayInvokeArgs(user, { limit: 80 })
        const mailRange = outlookMailWeekRange()
        const [erpRes, docflowRes, turboRes, outlookMailRes, turboStatus] = await Promise.all([
          api.invokeServerTool('onec.erp_tasks_current', onecArgs),
          api.invokeServerTool('onec.docflow_tasks', onecGatewayInvokeArgs(user, { limit: 80, only_open: true })),
          api.invokeServerTool('turboproject.get_user_portfolio', { employee: erpFio, limit: 40 }),
          fetchOutlookMailForRange(mailRange.dateFrom, mailRange.dateTo, {
            folder: 'All',
            maxResults: 50
          }),
          api.getToolStatus('turboproject').catch(() => null)
        ])
        if (!alive) return

        const erpParsed = parseErpToolTasks(erpRes, erpFio)
        let docParsed = parseErpToolTasks(docflowRes, erpFio)
        const docflowOdataFailed =
          Boolean(docflowRes.error?.trim()) ||
          Boolean(docParsed.error?.trim()) ||
          (!docflowRes.ok && !docParsed.rows.length)

        const gatewayPriorErrors = [
          erpRes.error,
          docflowRes.error,
          erpParsed.error,
          docParsed.error,
          !erpRes.ok && !erpParsed.rows.length ? 'onec.erp_tasks_current недоступен' : '',
          erpParsed.source === 'stub' ? 'erp_pm stub (нет SQL gateway)' : ''
        ]
          .filter((item): item is string => Boolean(item && item.trim()))
          .join(' · ')

        let comParsed: { rows: SpecTaskRow[]; source: string; error: string } | null = null

        if (docflowOdataFailed && !docParsed.rows.length && !isComTaskSource(docParsed.source)) {
          comParsed = await loadComErpTasks(
            erpFio,
            docParsed.error || docflowRes.error || 'OData документооборота'
          )
          if (!alive) return
          if (comParsed.rows.length) {
            docParsed = {
              rows: comParsed.rows,
              source: comParsed.source,
              error: comParsed.error
            }
          } else if (comParsed.error) {
            docParsed = { ...docParsed, error: comParsed.error }
          }
        }

        let mergedTasks = mergeErpTaskRows(erpParsed.rows, docParsed.rows)

        if (
          mergedTasks.length === 0 &&
          !isComTaskSource(docParsed.source) &&
          !(comParsed?.rows.length)
        ) {
          comParsed = await loadComErpTasks(erpFio, gatewayPriorErrors)
          if (!alive) return
          if (comParsed.rows.length) {
            mergedTasks = mergeErpTaskRows(erpParsed.rows, comParsed.rows)
            if (!docParsed.rows.length) {
              docParsed = {
                rows: comParsed.rows,
                source: comParsed.source,
                error: comParsed.error
              }
            }
          } else if (comParsed.error) {
            docParsed = {
              ...docParsed,
              error: uniqueErrorJoin(docParsed.error, comParsed.error)
            }
          }
        }
        setErpTasks(mergedTasks)
        const sourceParts = [erpParsed.source, docParsed.source].filter(Boolean)
        setErpSource(
          mergedTasks.length
            ? [...new Set(sourceParts)].join(' + ') || '1С'
            : sourceParts[0] || erpRes.error || docflowRes.error || '—'
        )
        const erpErrorJoined = enrichEmptyOneCErrors(
          uniqueErrorJoin(
            erpRes.error ? formatGatewayToolError(erpRes.error) : '',
            docflowRes.error ? formatGatewayToolError(docflowRes.error) : '',
            erpParsed.error,
            docParsed.error
          ),
          {
            erpSource: erpParsed.source,
            docSource: docParsed.source,
            mergedCount: mergedTasks.length
          }
        )
        setErpError(erpErrorJoined)
        setOneCAuthFailure(
          mergedTasks.length === 0 &&
            (!hasComPassword() ||
              isOneCAuthFailure(
                erpRes.error,
                docflowRes.error,
                erpParsed.error,
                docParsed.error,
                comParsed?.error,
                erpErrorJoined
              ))
        )

        if (turboStatus && !turboStatus.configured) {
          setProjects([])
          setTurboSource('TurboProject не настроен')
          setTurboNoSession(true)
        } else if (turboRes.ok && turboRes.result && typeof turboRes.result === 'object') {
          const payload = turboRes.result as Record<string, unknown>
          setTurboSource(String(payload.source || 'turboproject'))
          setTurboNoSession(false)
          const raw = Array.isArray(payload.projects) ? payload.projects : []
          setProjects(
            raw
              .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
              .map((item) => turboProjectToRow(item))
          )
        } else {
          setProjects([])
          const turboErr = turboRes.error || 'недоступно'
          setTurboSource(turboErr)
          setTurboNoSession(isTurboNoSessionError(turboErr))
        }

        if (outlookMailRes.ok && outlookMailRes.messages.length) {
          setMailSource(
            outlookMailRes.source ||
              `outlook.search_mail (${mailRange.dateFrom}…${mailRange.dateTo}, All)`
          )
          setMailRows(
            outlookMailRes.messages.map((item, index) => outlookMessageToMailRow(item, index))
          )
        } else {
          setMailRows([])
          const mailHint = outlookMailRes.error
            ? `Outlook: ${outlookMailRes.error}`
            : outlookMailbox
              ? `Outlook: ${outlookMailbox}`
              : 'outlook.search_mail (локальный профиль)'
          setMailSource(
            outlookMailRes.ok
              ? `outlook.search_mail (${mailRange.dateFrom}…${mailRange.dateTo}, All)`
              : mailHint
          )
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Не удалось загрузить данные')
      } finally {
        if (alive) setSourcesLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [user.id, erpFio, outlookMailbox, generation, comCredsRevision])

  useEffect(() => {
    if (!user.id) return
    let alive = true
    const today = new Date()
    void ensureOutlookMeetings('week', today, { owner: erpFio })
      .then((cal) => {
        if (alive) setMeetings(dedupeMeetingEvents(cal.meetings || []))
      })
      .catch(() => {
        if (alive) setMeetings([])
      })
    return () => {
      alive = false
    }
  }, [user.id, erpFio, generation])

  const regRows = useMemo(() => {
    return agents.filter((a) => !a.standalone).map(agentToProcessRow)
  }, [agents])

  const allProcessRows = useMemo(() => {
    const erpRows = erpTasks.map(erpTaskToProcessRow)
    const projRows = projects.map(turboProjectToProcessRow)
    const mailProcessRows = mailRows.map((m, index) => mailRowToProcessRow(m, index))
    const meetRows = meetings.map(meetingToProcessRow)
    return [...regRows, ...erpRows, ...projRows, ...mailProcessRows, ...meetRows]
  }, [regRows, erpTasks, projects, mailRows, meetings])

  const meetingCountToday = useMemo(() => countMeetingsOnDay(meetings), [meetings])

  const tableLoading = agentsLoading
  const value = useMemo(
    (): SpecV04SourcesState => ({
      sourcesLoading,
      tableLoading,
      loading: sourcesLoading || tableLoading,
      error,
      outlookMailbox,
      erpFio,
      erpError,
      erpTasks,
      erpTaskCount: erpTasks.length,
      projects,
      projectCount: projects.length,
      mailRows,
      mailCount: mailRows.length,
      processRows: regRows,
      allProcessRows,
      meetingCount: meetings.length,
      meetingCountToday,
      meetings,
      sources: { erp: erpSource, turbo: turboSource, mail: mailSource },
      turboNoSession,
      comPasswordInSession: hasComPassword(),
      oneCAuthFailure
    }),
    [
      sourcesLoading,
      tableLoading,
      error,
      outlookMailbox,
      erpFio,
      erpError,
      erpTasks,
      projects,
      mailRows,
      regRows,
      allProcessRows,
      meetings,
      meetingCountToday,
      erpSource,
      turboSource,
      mailSource,
      turboNoSession,
      comCredsRevision,
      oneCAuthFailure
    ]
  )

  return <SpecV04SourcesContext.Provider value={value}>{children}</SpecV04SourcesContext.Provider>
}

export function useSpecV04SourcesContext(): SpecV04SourcesState {
  return useContext(SpecV04SourcesContext)
}
