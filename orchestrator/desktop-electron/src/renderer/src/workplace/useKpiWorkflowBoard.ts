import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { WorkflowBoard } from '../api/types'

const EMPTY: WorkflowBoard = { stats: { activeAgents: 0, runsToday: 0, errorsToday: 0, needsAttention: 0, nextRunAt: '' }, agents: [], events: [] }
const boardCache = new Map<string, WorkflowBoard>()

/** Календарь запусков агентов за выбранный KPI-период. */
export function useKpiWorkflowBoard(from: string, to: string): {
  board: WorkflowBoard
  loading: boolean
} {
  const cacheKey = `${from}:${to}`
  const [board, setBoard] = useState<WorkflowBoard>(boardCache.get(cacheKey) ?? EMPTY)
  const [loading, setLoading] = useState(!boardCache.has(cacheKey))

  useEffect(() => {
    let cancelled = false
    if (!boardCache.has(cacheKey)) setLoading(true)
    void api
      .getWorkflowBoard({ window_from: from, window_to: to })
      .then((next) => {
        if (cancelled) return
        boardCache.set(cacheKey, next)
        setBoard(next)
      })
      .catch(() => {
        if (!cancelled) setBoard(EMPTY)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cacheKey, from, to])

  return { board, loading }
}
