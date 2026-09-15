import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { UserProfile } from '../api/types'
import { turboProjectTaskToTodayRow } from './specV04Mappers'
import type { TodayProjectTaskRow } from './useTodayProjectTasks'
import { turboProjectInvokeArgs } from './userContext'
import { turboTaskAssignedToActor } from './turboAssigneeMatch'

export type TurboProjectOpenTaskRow = TodayProjectTaskRow

export function useTurboProjectOpenTasks(
  projectId: string,
  user: UserProfile | null,
  erpFio: string,
  enabled: boolean
): { loading: boolean; rows: TurboProjectOpenTaskRow[]; error: string } {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<TurboProjectOpenTaskRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || !projectId || !user?.id) {
      setRows([])
      setError('')
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const res = await api.invokeServerTool(
          'turboproject.get_project_tasks',
          turboProjectInvokeArgs(user, {
            project_id: projectId,
            status: 'open',
            limit: 40
          })
        )
        if (!alive) return
        if (!res.ok || !res.result || typeof res.result !== 'object') {
          setRows([])
          setError((res.error || '').trim() || 'Не удалось загрузить задачи проекта')
          return
        }
        const payload = res.result as Record<string, unknown>
        const raw = Array.isArray(payload.tasks) ? payload.tasks : []
        const open = raw
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .filter((task) => turboTaskAssignedToActor(task, erpFio))
          .filter((task) => {
            const percent = Number(task.percent_complete ?? 0)
            return !Number.isFinite(percent) || percent < 1
          })
          .sort((left, right) => {
            const leftDelay = Number(left.delay_days ?? 0)
            const rightDelay = Number(right.delay_days ?? 0)
            if (rightDelay !== leftDelay) return rightDelay - leftDelay
            return String(left.finish_date || '').localeCompare(String(right.finish_date || ''))
          })
          .slice(0, 5)
          .map((task) => turboProjectTaskToTodayRow(task, projectId, erpFio))
        setRows(open)
      } catch (err) {
        if (!alive) return
        setRows([])
        setError(err instanceof Error ? err.message : 'Не удалось загрузить задачи проекта')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId, user?.id, erpFio, enabled])

  return { loading, rows, error }
}
