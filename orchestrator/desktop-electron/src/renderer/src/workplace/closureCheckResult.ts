import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { UserProfile } from '../api/types'
import { extractClosureCheck, type ClosureCheckAssignment } from '../components/agentfeed/docflowActions'
import type { RunEntry } from '../store/runs'
import { clearDocflowPages } from './docflowPageCache'
import { onecGatewayInvokeArgs } from './userContext'

export type ClosureCheckResult = {
  assignments: ClosureCheckAssignment[]
  /** Когда агент закончил проверку (ISO), если известно. */
  at: string
  /** Запуск из истории, в котором агент вернул этот итог; пусто для живого запуска. */
  runId: string
}

function liveResultText(entry: RunEntry | undefined): string {
  const items = entry?.state?.items ?? []
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item.kind === 'result' && item.text) return item.text
  }
  return ''
}

/** Последний итог агента «Проверка поручений к закрытию»: живой запуск, иначе история запусков. */
export function useClosureCheckResult(workflowId: string, entry: RunEntry | undefined): ClosureCheckResult | null {
  const [stored, setStored] = useState<ClosureCheckResult | null>(null)
  const running = Boolean(entry?.state?.running)

  useEffect(() => {
    if (!workflowId || running) return
    let cancelled = false
    void api
      .listAgentRuns(workflowId)
      .then((runs) => {
        if (cancelled) return
        const sorted = [...runs].sort((a, b) => (b.finishedAt || b.startedAt).localeCompare(a.finishedAt || a.startedAt))
        for (const run of sorted) {
          const { assignments } = extractClosureCheck(run.answer || run.summary || '')
          if (assignments.length) {
            setStored({ assignments, at: run.finishedAt || run.startedAt, runId: run.runId })
            return
          }
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [workflowId, running])

  const liveText = liveResultText(entry)
  const live = useMemo(() => {
    const { assignments } = extractClosureCheck(liveText)
    return assignments.length ? { assignments, at: new Date().toISOString(), runId: '' } : null
  }, [liveText])

  if (live && stored && !running) return { ...live, at: stored.at, runId: stored.runId }
  return live ?? stored
}

export function closureConclusionTone(conclusion: string): 'close' | 'partial' | 'none' {
  const value = conclusion.toLowerCase()
  if (value.startsWith('можно')) return 'close'
  if (value.includes('частично')) return 'partial'
  return 'none'
}

export type AutoCloseState = { state: 'closing' | 'closed' | 'kept' | 'error'; message: string }

function readyToClose(item: ClosureCheckAssignment): boolean {
  return closureConclusionTone(item.conclusion) === 'close' && item.total > 0 && item.done === item.total
}

/**
 * Поручения с выводом «Можно закрыть» закрываются в 1С сами («Принято»).
 * Сервер перечитывает задачи ДО и закрывает, только если каждое мероприятие принято проверяющим.
 */
export function useClosureAutoClose(
  result: ClosureCheckResult | null,
  running: boolean,
  user: UserProfile,
  isOpen: (number: string) => boolean | undefined,
  onClosed: () => void
): Record<string, AutoCloseState> {
  const [states, setStates] = useState<Record<string, AutoCloseState>>({})
  const tried = useRef(new Set<string>())
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen
  const onClosedRef = useRef(onClosed)
  onClosedRef.current = onClosed

  useEffect(() => {
    if (running) tried.current.clear()
  }, [running])

  useEffect(() => {
    if (running || !result) return
    const queue = result.assignments.filter(
      (item) => readyToClose(item) && !tried.current.has(item.number) && isOpenRef.current(item.number) !== false
    )
    if (!queue.length) return
    for (const item of queue) tried.current.add(item.number)
    const put = (number: string, next: AutoCloseState): void =>
      setStates((current) => ({ ...current, [number]: next }))
    void (async () => {
      let closedAny = false
      for (const item of queue) {
        put(item.number, { state: 'closing', message: 'Закрываю в 1С…' })
        const res = await api.invokeServerTool(
          'onec.erp_assignments_write',
          onecGatewayInvokeArgs(user, { action: 'close_if_accepted', number: item.number, ref_key: item.targetId }),
          180_000
        )
        const payload = res.result && typeof res.result === 'object' ? (res.result as Record<string, unknown>) : {}
        const message = String(payload.summary || res.error || '').trim()
        if (res.ok && payload.closed === true) {
          closedAny = closedAny || payload.already !== true
          put(item.number, { state: 'closed', message: message || 'Поручение закрыто в 1С' })
        } else if (res.ok) {
          put(item.number, { state: 'kept', message: message || 'Не все мероприятия приняты в ДО' })
        } else {
          put(item.number, { state: 'error', message: message || 'Не удалось закрыть поручение в 1С' })
        }
      }
      if (closedAny) {
        clearDocflowPages()
        onClosedRef.current()
      }
    })()
  }, [result, running, user])

  return states
}
